#!/usr/bin/env node

const dns = require('node:dns').promises;
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const { RouterOSAPI } = require('node-routeros');
const { buildAddressSet, extractLoginHosts } = require('../lib/poe2-vpn');

const APPLY = process.argv.includes('--apply');
const WATCH = process.argv.includes('--watch');
const BACKUP = APPLY && !process.argv.includes('--no-backup');
const ADDRESS_LIST = 'ISPMax_POE2_VPN';
const CONNECTION_MARK = 'poe2-proton';
const ROUTING_TABLE = 'proton-totolin';
const WG_INTERFACE = 'wg-proton-totolin';
const GENERAL_RULE_COMMENT = 'ISPMax TOTOLIN via Proton';
const NAT_COMMENT = 'ISPMax Proton TOTOLIN NAT';
const CONNECTION_RULE_COMMENT = 'ISPMax PoE2 marcar conexiones';
const ROUTING_RULE_COMMENT = 'ISPMax PoE2 via Proton exclusivo';
const MSS_OUT_RULE_COMMENT = 'ISPMax PoE2 Proton MSS salida';
const MSS_IN_RULE_COMMENT = 'ISPMax PoE2 Proton MSS entrada';
const PROTON_TCP_MSS = '1360';
const LOGIN_HOSTS = ['us.login.pathofexile.com', 'patch.pathofexile.com'];
const DEFAULT_LOGS = [
  'D:\\SteamLibrary\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt',
  'D:\\SteamLibrary\\steamapps\\common\\Path of Exile 2\\logs\\LatestClient.txt',
];

function requireRouterConfig() {
  const missing = ['MIKROTIK_HOST', 'MIKROTIK_USER', 'MIKROTIK_PASS'].filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Faltan variables MikroTik: ${missing.join(', ')}`);
}

function getSourceIpv4() {
  const configured = process.env.POE2_SOURCE_IP;
  if (configured) return configured;
  const candidates = Object.values(os.networkInterfaces()).flat().filter(Boolean);
  const totolin = candidates.find((item) => item.family === 'IPv4' && !item.internal && item.address.startsWith('192.168.120.'));
  if (!totolin) throw new Error('No se encontro una IPv4 de TOTOLIN (192.168.120.0/24)');
  return totolin.address;
}

async function readLogs() {
  const configured = (process.env.POE2_LOG_PATHS || '').split(path.delimiter).filter(Boolean);
  const files = configured.length ? configured : DEFAULT_LOGS;
  const texts = [];
  for (const file of files) {
    try {
      texts.push(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!texts.length) throw new Error('No se encontraron logs de Path of Exile 2');
  return texts;
}

async function resolveLoginAddresses(logTexts = []) {
  const addresses = [];
  const discoveredHosts = logTexts.flatMap(extractLoginHosts);
  for (const host of new Set([...LOGIN_HOSTS, ...discoveredHosts])) {
    try {
      const records = await dns.resolve4(host);
      addresses.push(...records);
    } catch {
      // Instance routing remains functional if a login hostname is temporarily unavailable.
    }
  }
  return addresses;
}

function routerConnection() {
  return new RouterOSAPI({
    host: process.env.MIKROTIK_HOST,
    user: process.env.MIKROTIK_USER,
    password: process.env.MIKROTIK_PASS,
    port: Number(process.env.MIKROTIK_PORT || 8728),
    timeout: 10,
  });
}

async function setDisabled(conn, menu, item, disabled) {
  if (!item || item.disabled === String(disabled)) return false;
  await conn.write(`${menu}/set`, `=numbers=${item['.id']}`, `=disabled=${disabled ? 'yes' : 'no'}`);
  return true;
}

async function upsertMangleRule(conn, rules, comment, values) {
  const existing = rules.find((rule) => rule.comment === comment);
  const params = Object.entries(values).map(([key, value]) => `=${key}=${value}`);
  if (existing) {
    await conn.write('/ip/firewall/mangle/set', `=numbers=${existing['.id']}`, ...params, '=disabled=no');
    return 'updated';
  }
  await conn.write('/ip/firewall/mangle/add', ...params, `=comment=${comment}`);
  return 'created';
}

async function prioritizePoe2MangleRules(conn) {
  const rules = await conn.write('/ip/firewall/mangle/print');
  const connectionRule = rules.find((rule) => rule.comment === CONNECTION_RULE_COMMENT);
  const routingRule = rules.find((rule) => rule.comment === ROUTING_RULE_COMMENT);
  const managedComments = [
    CONNECTION_RULE_COMMENT,
    ROUTING_RULE_COMMENT,
    MSS_OUT_RULE_COMMENT,
    MSS_IN_RULE_COMMENT,
  ];
  const firstOtherRule = rules.find((rule) => !managedComments.includes(rule.comment));
  if (!connectionRule || !routingRule) throw new Error('No se pudieron priorizar las reglas PoE 2');
  if (firstOtherRule) {
    await conn.write('/ip/firewall/mangle/move', `=numbers=${routingRule['.id']}`, `=destination=${firstOtherRule['.id']}`);
  }
  await conn.write('/ip/firewall/mangle/move', `=numbers=${connectionRule['.id']}`, `=destination=${routingRule['.id']}`);
}

async function createBackup(conn) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const name = `pre-poe2-vpn-${stamp}`;
  await conn.write('/system/backup/save', `=name=${name}`, `=password=${process.env.MIKROTIK_PASS}`);
  await conn.write('/export', `=file=${name}`);
  return name;
}

async function synchronize({ backup = false } = {}) {
  requireRouterConfig();
  const sourceIp = getSourceIpv4();
  const logTexts = await readLogs();
  const addresses = buildAddressSet(logTexts, await resolveLoginAddresses(logTexts));
  const conn = routerConnection();
  await conn.connect();
  try {
    const [interfaces, peers, natRules, routingRules, mangleRules, listEntries] = await Promise.all([
      conn.write('/interface/wireguard/print'),
      conn.write('/interface/wireguard/peers/print'),
      conn.write('/ip/firewall/nat/print'),
      conn.write('/routing/rule/print'),
      conn.write('/ip/firewall/mangle/print'),
      conn.write('/ip/firewall/address-list/print'),
    ]);
    const wireguard = interfaces.find((item) => item.name === WG_INTERFACE);
    const peer = peers.find((item) => item.interface === WG_INTERFACE);
    const nat = natRules.find((item) => item.comment === NAT_COMMENT);
    const generalRule = routingRules.find((item) => item.comment === GENERAL_RULE_COMMENT);
    if (!wireguard || !peer || !nat || !generalRule) {
      throw new Error('La configuracion Proton esperada esta incompleta en MikroTik');
    }

    const existing = new Set(listEntries
      .filter((item) => item.list === ADDRESS_LIST)
      .map((item) => item.address.includes('/') ? item.address : `${item.address}/32`));
    const missing = [...addresses].filter((address) => !existing.has(address));
    console.log(`PoE 2: ${addresses.size} destinos; ${missing.length} nuevos; origen ${sourceIp}`);
    if (!APPLY) return { applied: false, addresses: addresses.size, missing: missing.length, sourceIp };

    const backupName = backup ? await createBackup(conn) : null;
    await setDisabled(conn, '/interface/wireguard', wireguard, false);
    await setDisabled(conn, '/ip/firewall/nat', nat, false);
    await setDisabled(conn, '/routing/rule', generalRule, true);
    for (const address of missing) {
      await conn.write('/ip/firewall/address-list/add', `=list=${ADDRESS_LIST}`, `=address=${address}`, '=comment=ISPMax PoE2 auto');
    }

    const refreshedMangle = await conn.write('/ip/firewall/mangle/print');
    await upsertMangleRule(conn, refreshedMangle, CONNECTION_RULE_COMMENT, {
      chain: 'prerouting',
      action: 'mark-connection',
      'src-address': `${sourceIp}/32`,
      'dst-address-list': ADDRESS_LIST,
      'connection-mark': 'no-mark',
      'new-connection-mark': CONNECTION_MARK,
      passthrough: 'yes',
    });
    const afterConnectionRule = await conn.write('/ip/firewall/mangle/print');
    await upsertMangleRule(conn, afterConnectionRule, ROUTING_RULE_COMMENT, {
      chain: 'prerouting',
      action: 'mark-routing',
      'src-address': `${sourceIp}/32`,
      'connection-mark': CONNECTION_MARK,
      'new-routing-mark': ROUTING_TABLE,
      passthrough: 'yes',
    });
    const afterRoutingRule = await conn.write('/ip/firewall/mangle/print');
    await upsertMangleRule(conn, afterRoutingRule, MSS_OUT_RULE_COMMENT, {
      chain: 'forward',
      action: 'change-mss',
      protocol: 'tcp',
      'tcp-flags': 'syn',
      'src-address': `${sourceIp}/32`,
      'out-interface': WG_INTERFACE,
      'new-mss': PROTON_TCP_MSS,
      passthrough: 'yes',
    });
    const afterMssOutRule = await conn.write('/ip/firewall/mangle/print');
    await upsertMangleRule(conn, afterMssOutRule, MSS_IN_RULE_COMMENT, {
      chain: 'forward',
      action: 'change-mss',
      protocol: 'tcp',
      'tcp-flags': 'syn',
      'dst-address': `${sourceIp}/32`,
      'in-interface': WG_INTERFACE,
      'new-mss': PROTON_TCP_MSS,
      passthrough: 'yes',
    });
    await prioritizePoe2MangleRules(conn);

    return {
      applied: true,
      addresses: addresses.size,
      added: missing.length,
      backupName,
      sourceIp,
    };
  } finally {
    try { await conn.close(); } catch {}
  }
}

async function main() {
  const first = await synchronize({ backup: BACKUP });
  console.log(JSON.stringify(first));
  if (!WATCH) return;
  const latestLog = DEFAULT_LOGS[1];
  let initialLogs = await readLogs();
  let known = buildAddressSet(initialLogs, await resolveLoginAddresses(initialLogs));
  let debounce;
  console.log(`Vigilando nuevos servidores PoE 2 en ${latestLog}`);
  fsSync.watch(latestLog, () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        const latestText = await fs.readFile(latestLog, 'utf8');
        const latest = buildAddressSet([latestText], await resolveLoginAddresses([latestText]));
        const hasNewAddress = [...latest].some((address) => !known.has(address));
        if (!hasNewAddress) return;
        const result = await synchronize();
        const allLogs = await readLogs();
        known = buildAddressSet(allLogs, await resolveLoginAddresses(allLogs));
        if (result.added) console.log(`Agregados ${result.added} destinos nuevos`);
      } catch (error) {
        console.error(`[PoE2 VPN] ${error.message}`);
      }
    }, 3_000);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[PoE2 VPN] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { getSourceIpv4, synchronize };
