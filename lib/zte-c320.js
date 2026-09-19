'use strict';

const net = require('net');

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;
const ONU_INDEX_RE = /^(\d+)\/(\d+)\/(\d+):(\d+)$/;
const PON_INDEX_RE = /^(\d+)\/(\d+)\/(\d+)$/;

function cleanCliText(value) {
  return String(value || '')
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .replace(/[^\x09\x0a\x20-\x7e]/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n');
}

function normalizeGponSerial(value) {
  let serial = String(value || '').replace(/^SN:/i, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (/^[0-9A-F]{16}$/.test(serial)) {
    const vendor = Buffer.from(serial.slice(0, 8), 'hex').toString('ascii').toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(vendor)) serial = `${vendor}${serial.slice(8)}`;
  }
  return serial;
}

function valueAfterColon(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(text).match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+?)\\s*$`, 'im'));
  return match?.[1]?.trim() || null;
}

function parseSystemGroup(text) {
  return {
    systemName: valueAfterColon(text, 'System Name'),
    location: valueAfterColon(text, 'Location'),
    contact: valueAfterColon(text, 'Contact') || valueAfterColon(text, 'Contact with'),
    uptimeText: valueAfterColon(text, 'System Uptime') || valueAfterColon(text, 'Uptime') || valueAfterColon(text, 'Started before'),
  };
}

function parseVersionRunning(text) {
  const source = cleanCliText(text);
  const model = source.match(/\b(C320|C300|C600|C650|C620)\b/i)?.[1]?.toUpperCase() || 'C320';
  const version = source.match(/(?:Software|Running|MVR)\s+(?:Version\s*)?[: ]\s*(V?\d+(?:\.\d+)+[^\n]*)/i)?.[1]?.trim()
    || source.match(/\bV\d+\.\d+\.\d+(?:[^\n]*)?/i)?.[0]?.trim()
    || null;
  return { model, version };
}

function parseCards(text) {
  const cards = [];
  for (const line of cleanCliText(text).split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+(\d+))?(?:\s+(.*?))?\s+(INSERVICE|STANDBY|OFFLINE|FAULT|POWERDOWN)\s*$/i);
    if (!match) continue;
    cards.push({
      location: `${match[1]}/${match[2]}/${match[3]}`,
      rack: Number(match[1]),
      shelf: Number(match[2]),
      slot: Number(match[3]),
      configuredType: match[4],
      realType: match[5],
      ports: match[6] ? Number(match[6]) : null,
      hardwareVersion: match[7]?.trim() || null,
      status: match[8].toUpperCase(),
    });
  }
  return cards;
}

function parseTemperatures(text) {
  const temperatures = new Map();
  for (const line of cleanCliText(text).split('\n')) {
    const row = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+(?:\.\d+)?)\s+/);
    if (row) {
      temperatures.set(`${row[1]}/${row[2]}/${row[3]}`, Number(row[4]));
      continue;
    }
    const location = line.match(/\b(\d+\/\d+\/\d+)\b/)?.[1];
    const temperature = line.match(/(-?\d+(?:\.\d+)?)\s*(?:C|degree)/i)?.[1]
      || line.match(/\b(-?\d+(?:\.\d+)?)\s*$/)?.[1];
    if (location && temperature) temperatures.set(location, Number(temperature));
  }
  return temperatures;
}

function parseOnuStates(text) {
  const onus = [];
  for (const line of cleanCliText(text).split('\n')) {
    const match = line.match(/^\s*(\d+)\/(\d+)\/(\d+):(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$/);
    if (!match) continue;
    const phaseState = match[7];
    onus.push({
      onuIndex: `${match[1]}/${match[2]}/${match[3]}:${match[4]}`,
      interfaceName: `gpon-onu_${match[1]}/${match[2]}/${match[3]}:${match[4]}`,
      rack: Number(match[1]),
      shelf: Number(match[2]),
      pon: Number(match[3]),
      onuId: Number(match[4]),
      adminState: match[5],
      omccState: match[6],
      phaseState,
      channel: match[8].trim(),
      online: /working|online/i.test(phaseState),
    });
  }
  return onus;
}

function parseOnuBaseInfo(text) {
  const onus = [];
  for (const line of cleanCliText(text).split('\n')) {
    const match = line.match(/^\s*gpon-onu_(\d+)\/(\d+)\/(\d+):(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/i);
    if (!match) continue;
    onus.push({
      onuIndex: `${match[1]}/${match[2]}/${match[3]}:${match[4]}`,
      model: match[5] === '-' ? null : match[5],
      authMode: match[6] === '-' ? null : match[6],
      serial: match[7].replace(/^SN:/i, '') === '-' ? null : match[7].replace(/^SN:/i, ''),
      phaseState: match[8],
    });
  }
  return onus;
}

function parseUnconfiguredOnus(text) {
  if (/No related information/i.test(text)) return [];
  const onus = [];
  for (const line of cleanCliText(text).split('\n')) {
    // Firmware variants report either a PON or a temporary ONU index before the serial.
    const match = line.match(/(?:gpon-(?:olt|onu)_)?(\d+)\/(\d+)\/(\d+)(?::\d+)?\s+(?:SN:)?([A-Z0-9]{8,})/i);
    if (!match) continue;
    onus.push({ ponIndex: `${match[1]}/${match[2]}/${match[3]}`, serial: match[4] });
  }
  return onus;
}

function assertPonIndex(value) {
  const match = String(value || '').match(PON_INDEX_RE);
  if (!match) throw new Error('Puerto PON invalido');
  const numbers = match.slice(1).map(Number);
  if (numbers.some((number) => !Number.isInteger(number) || number < 0 || number > 255)) {
    throw new Error('Puerto PON fuera de rango');
  }
  return value;
}

function parseProvisioningCatalog(text) {
  const source = cleanCliText(text);
  const typeUsage = new Map();
  for (const match of source.matchAll(/^\s*onu\s+\d+\s+type\s+(\S+)\s+sn\s+/gmi)) {
    typeUsage.set(match[1], (typeUsage.get(match[1]) || 0) + 1);
  }
  const onuTypes = [...typeUsage.entries()]
    .map(([name, usage]) => ({ name, usage }))
    .sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name));
  const tcontProfiles = [...source.matchAll(/^\s*profile tcont (\S+)\s+(.+)$/gmi)]
    .map((match) => ({ name: match[1], definition: match[2].trim() }));
  const trafficProfiles = [...source.matchAll(/^\s*profile traffic (\S+)\s+(.+)$/gmi)]
    .map((match) => ({ name: match[1], definition: match[2].trim() }));
  return { onuTypes, tcontProfiles, trafficProfiles };
}

function parseOnuTypeCatalog(text) {
  const blocks = cleanCliText(text).split(/(?=ONU type name:\s*)/i);
  return blocks.map((block) => {
    const name = valueAfterColon(block, 'ONU type name');
    if (!name) return null;
    const number = (label) => {
      const value = Number(valueAfterColon(block, label));
      return Number.isFinite(value) ? value : null;
    };
    return {
      name,
      ponType: valueAfterColon(block, 'PON type'),
      description: valueAfterColon(block, 'Description'),
      maxTcont: number('Max T-CONT'),
      maxGemport: number('Max GEM port'),
      maxSwitchPerSlot: number('Max switch per slot'),
      maxFlowPerSwitch: number('Max flow per switch'),
      maxIpHost: number('Max IP host'),
      omciSendMode: valueAfterColon(block, 'OMCI send mode'),
      extendedOmci: valueAfterColon(block, 'Extended OMCI'),
    };
  }).filter(Boolean);
}

function buildOnuTypeProfileCommands(model) {
  const normalized = String(model || '').trim().toUpperCase();
  if (normalized !== 'F670L') throw new Error('Modelo de perfil ONU no admitido');
  return [
    'configure terminal',
    'pon',
    'onu-type F670L gpon',
    'onu-type F670L gpon max-tcont 8',
    'onu-type F670L gpon max-gemport 32',
    'onu-type F670L gpon max-switch-perslot 8',
    'onu-type F670L gpon max-flow-perswitch 8',
    'onu-type F670L gpon max-iphost 5',
    'exit',
    'end',
  ];
}

function parseConfiguredOnuIds(text) {
  const ids = [];
  for (const match of cleanCliText(text).matchAll(/^\s*onu\s+(\d+)\s+type\s+\S+\s+sn\s+/gmi)) {
    ids.push(Number(match[1]));
  }
  return [...new Set(ids)].sort((a, b) => a - b);
}

function profileRateKbps(profile, direction) {
  const definition = String(profile?.definition || '');
  const pattern = direction === 'up' ? /\bmaximum\s+(\d+)\b/i : /\bpir\s+(\d+)\b/i;
  const value = Number(definition.match(pattern)?.[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function findInternetSpeedProfile(profiles, speedMbps, direction) {
  const expectedKbps = Math.round(Number(speedMbps) * 1024);
  return (profiles || []).find((profile) => {
    if (/IPTV/i.test(String(profile?.name || ''))) return false;
    return profileRateKbps(profile, direction) === expectedKbps;
  }) || null;
}

function buildInternetProfileCommands(speeds, catalog = {}) {
  const normalized = [...new Set((speeds || []).map(Number))]
    .filter((speed) => Number.isInteger(speed) && speed >= 1 && speed <= 1000)
    .sort((a, b) => a - b);
  if (!normalized.length) throw new Error('No hay velocidades OLT validas');
  const plans = normalized.map((speedMbps) => {
    const tcontExisting = findInternetSpeedProfile(catalog.tcontProfiles, speedMbps, 'up');
    const trafficExisting = findInternetSpeedProfile(catalog.trafficProfiles, speedMbps, 'down');
    return {
      speedMbps,
      rateKbps: speedMbps * 1024,
      tcontProfile: tcontExisting?.name || `ISPMAX-${speedMbps}M-UP`,
      trafficProfile: trafficExisting?.name || `ISPMAX-${speedMbps}M-DOWN`,
      createTcont: !tcontExisting,
      createTraffic: !trafficExisting,
    };
  });
  const commands = ['configure terminal', 'gpon'];
  for (const plan of plans) {
    if (plan.createTcont) {
      commands.push(`profile tcont ${plan.tcontProfile} type 5 fixed 64 assured 64 maximum ${plan.rateKbps}`);
    }
    if (plan.createTraffic) {
      commands.push(`profile traffic ${plan.trafficProfile} sir ${plan.rateKbps} pir ${plan.rateKbps}`);
    }
  }
  commands.push('exit', 'end');
  return { plans, commands };
}

function buildProvisioningCommands(input) {
  const ponIndex = assertPonIndex(input.ponIndex);
  const onuId = Number(input.onuId);
  if (!Number.isInteger(onuId) || onuId < 1 || onuId > 128) throw new Error('ID ONU invalido');
  const token = (value, label, pattern = /^[A-Za-z0-9_.-]{1,64}$/) => {
    const text = String(value || '').trim();
    if (!pattern.test(text)) throw new Error(`${label} invalido`);
    return text;
  };
  const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const serial = token(String(input.serial || '').toUpperCase(), 'Serial', /^[A-Z0-9]{8,24}$/);
  const onuType = token(input.onuType, 'Modelo ONU');
  const name = token(input.name, 'Nombre ONU', /^[A-Za-z0-9_.-]{1,32}$/);
  const tcontProfile = token(input.tcontProfile, 'Perfil T-CONT');
  const trafficProfile = token(input.trafficProfile, 'Perfil de trafico');
  const vlan = Number(input.vlan);
  if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) throw new Error('VLAN invalida');
  const serviceMode = String(input.serviceMode || 'router').toLowerCase();
  if (!['router', 'bridge'].includes(serviceMode)) throw new Error('Modo de servicio invalido');
  const lanPorts = [...new Set((input.lanPorts || [1]).map(Number))].sort();
  if (!lanPorts.length || lanPorts.some((port) => !Number.isInteger(port) || port < 1 || port > 4)) throw new Error('Puertos LAN invalidos');
  const managementIp = serviceMode === 'router' ? token(input.managementIp, 'IP de gestion', ipv4Pattern) : null;
  const mask = serviceMode === 'router' ? token(input.mask, 'Mascara', ipv4Pattern) : null;
  const gateway = serviceMode === 'router' ? token(input.gateway, 'Gateway', ipv4Pattern) : null;
  const primaryDns = serviceMode === 'router' ? token(input.primaryDns, 'DNS primario', ipv4Pattern) : null;
  const secondaryDns = serviceMode === 'router' ? token(input.secondaryDns, 'DNS secundario', ipv4Pattern) : null;
  const onuIndex = `${ponIndex}:${onuId}`;
  const managementCommands = serviceMode === 'router' ? [
    `pon-onu-mng gpon-onu_${onuIndex}`,
    'flow mode 1 tag-filter vlan-filter untag-filter discard',
    `flow 1 pri 0 vlan ${vlan}`,
    'gemport 1 flow 1',
    'switchport-bind switch_0/1 iphost 1',
    'switchport-bind switch_0/1 veip 1',
    `ip-host 1 ip ${managementIp} mask ${mask} gateway ${gateway}`,
    `ip-host 1 primary-dns ${primaryDns} second-dns ${secondaryDns}`,
    'vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard',
    `vlan-filter iphost 1 pri 0 vlan ${vlan}`,
    'exit', 'end',
  ] : [
    `pon-onu-mng gpon-onu_${onuIndex}`,
    'flow mode 1 tag-filter vlan-filter untag-filter discard',
    `flow 1 pri 0 vlan ${vlan}`,
    'gemport 1 flow 1',
    ...lanPorts.map((port) => `vlan port eth_0/${port} mode tag vlan ${vlan}`),
    'exit', 'end',
  ];
  return {
    onuIndex, serviceMode,
    groups: [
      {
        key: 'authorize',
        commands: ['configure terminal', `interface gpon-olt_${ponIndex}`, `onu ${onuId} type ${onuType} sn ${serial}`, 'exit'],
      },
      {
        key: 'service',
        commands: [
          `interface gpon-onu_${onuIndex}`,
          `name ${name}`,
          'sn-bind enable sn',
          `tcont 1 profile ${tcontProfile}`,
          'gemport 1 tcont 1',
          `gemport 1 traffic-limit downstream ${trafficProfile}`,
          `service-port 1 vport 1 user-vlan ${vlan} vlan ${vlan}`,
          'exit',
        ],
      },
      {
        key: 'management',
        commands: managementCommands,
      },
    ],
  };
}

function normalizeAlarmLevel(value) {
  const level = String(value || '').toLowerCase();
  if (level.startsWith('crit')) return 'critical';
  if (level.startsWith('maj')) return 'major';
  if (level.startsWith('min')) return 'minor';
  if (level.startsWith('warn')) return 'warning';
  return level || 'unknown';
}

function parseAlarms(text) {
  const alarms = [];
  let current = null;
  for (const line of cleanCliText(text).split('\n')) {
    const compact = line.trim();
    if (!compact) continue;
    const idMatch = compact.match(/^(\d+)\s+(critical|major|minor|warning)\s+(.+)$/i);
    if (idMatch) {
      current = { alarmId: idMatch[1], level: normalizeAlarmLevel(idMatch[2]), description: idMatch[3].trim() };
      alarms.push(current);
      continue;
    }
    const labeledId = compact.match(/^Alarm\s+(?:ID|No\.)\s*:\s*(\S+)/i);
    if (labeledId) {
      current = { alarmId: labeledId[1], level: 'unknown', description: '' };
      alarms.push(current);
      continue;
    }
    if (!current) continue;
    const level = compact.match(/^(?:Alarm\s+)?Level\s*:\s*(\S+)/i)?.[1];
    const code = compact.match(/^(?:Alarm\s+)?Code\s*:\s*(\S+)/i)?.[1];
    const time = compact.match(/^(?:Raise\s+)?Time\s*:\s*(.+)$/i)?.[1];
    const description = compact.match(/^(?:Description|Detail|Alarm\s+Name|AlarmDesInfo)\s*:\s*(.+)$/i)?.[1];
    if (level) current.level = normalizeAlarmLevel(level);
    else if (code) current.code = code;
    else if (time) current.alarmTime = time.trim();
    else if (description) current.description = description.trim();
    else if (current.description && !/^-+$/.test(compact)) current.description += ` ${compact}`;
  }
  return alarms.filter((alarm) => alarm.alarmId && alarm.description);
}

function parseOnuDetail(text) {
  const source = cleanCliText(text);
  const field = (...labels) => {
    for (const label of labels) {
      const value = valueAfterColon(source, label);
      if (value) return value;
    }
    return null;
  };
  const distance = source.match(/(?:ONU\s+)?Distance\s*:\s*(\d+)/i)?.[1]
    || source.match(/\b(\d+)\s*(?:m|meter)\b/i)?.[1];
  return {
    name: field('Name', 'ONU name'),
    model: field('Type', 'ONU type'),
    serial: field('Serial number', 'SN')?.replace(/^SN:/i, '') || null,
    onlineDuration: field('Online Duration', 'Online duration'),
    lastOfflineCause: field('Last offline reason', 'Last down cause'),
    distanceM: distance ? Number(distance) : null,
  };
}

function firstDbm(text) {
  const match = cleanCliText(text).match(/(-?\d+(?:\.\d+)?)\s*\(?dBm\)?/i);
  return match ? Number(match[1]) : null;
}

function parseAttenuation(text) {
  const source = cleanCliText(text);
  const up = source.match(/up(?:stream)?[^\n]*?(-?\d+(?:\.\d+)?)\s*\(?dB(?!m)\)?/i)?.[1];
  const down = source.match(/down(?:stream)?[^\n]*?(-?\d+(?:\.\d+)?)\s*\(?dB(?!m)\)?/i)?.[1];
  return {
    attenuationUpDb: up ? Number(up) : null,
    attenuationDownDb: down ? Number(down) : null,
  };
}

function summarizePons(onus) {
  const pons = new Map();
  for (const onu of onus) {
    const key = `${onu.rack}/${onu.shelf}/${onu.pon}`;
    const current = pons.get(key) || { ponIndex: key, rack: onu.rack, shelf: onu.shelf, pon: onu.pon, total: 0, online: 0, offline: 0 };
    current.total += 1;
    if (onu.online) current.online += 1;
    else current.offline += 1;
    pons.set(key, current);
  }
  return [...pons.values()].sort((a, b) => a.pon - b.pon);
}

function assertOnuIndex(value) {
  const match = String(value || '').match(ONU_INDEX_RE);
  if (!match) throw new Error('Identificador ONU invalido');
  const numbers = match.slice(1).map(Number);
  if (numbers.some((number) => !Number.isInteger(number) || number < 0 || number > 255)) {
    throw new Error('Identificador ONU fuera de rango');
  }
  return value;
}

function assertOnuName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,32}$/.test(name)) throw new Error('Nombre ONU invalido');
  return name;
}

function buildOnuRenameCommands(onuIndex, name) {
  assertOnuIndex(onuIndex);
  const safeName = assertOnuName(name);
  return ['configure terminal', `interface gpon-onu_${onuIndex}`, `name ${safeName}`, 'exit', 'end', 'write'];
}

function buildOnuOperationCommands(onuIndex, action) {
  assertOnuIndex(onuIndex);
  if (action !== 'reboot') throw new Error('Operacion ONU no soportada');
  return ['configure terminal', `pon-onu-mng gpon-onu_${onuIndex}`, 'reboot', 'exit', 'end'];
}

function extractOnuManagementBlock(runningConfig, onuIndex) {
  assertOnuIndex(onuIndex);
  const lines = cleanCliText(runningConfig).split('\n');
  const header = `pon-onu-mng gpon-onu_${onuIndex}`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return '';
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index] && !/^\s/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

function parseOnuInterfaceStats(text) {
  const source = String(text || '');
  const rate = (direction) => source.match(new RegExp(`${direction} rate\\s*:\\s*(\\d+)\\s*Bps\\s*(\\d+)\\s*pps`, 'i'));
  const peak = (direction) => source.match(new RegExp(`${direction} peak rate\\s*:\\s*(\\d+)\\s*Bps\\s*(\\d+)\\s*pps`, 'i'));
  const totals = [...source.matchAll(/Bytes:\s*(\d+)\s+Packets:\s*(\d+)/gi)];
  const inputRate = rate('Input');
  const outputRate = rate('Output');
  const inputPeak = peak('Input');
  const outputPeak = peak('Output');
  if (!inputRate && !outputRate && totals.length < 2) return null;
  return {
    upstreamBps: Number(inputRate?.[1] || 0) * 8,
    downstreamBps: Number(outputRate?.[1] || 0) * 8,
    upstreamPps: Number(inputRate?.[2] || 0),
    downstreamPps: Number(outputRate?.[2] || 0),
    peakUpstreamBps: Number(inputPeak?.[1] || 0) * 8,
    peakDownstreamBps: Number(outputPeak?.[1] || 0) * 8,
    totalUpstreamBytes: Number(totals[0]?.[1] || 0),
    totalDownstreamBytes: Number(totals[1]?.[1] || 0),
    totalUpstreamPackets: Number(totals[0]?.[2] || 0),
    totalDownstreamPackets: Number(totals[1]?.[2] || 0),
    capturedAt: new Date().toISOString(),
  };
}

function normalizeMacAddress(value) {
  const compact = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(compact)) return null;
  return compact.match(/.{2}/g).join(':');
}

function parseOnuMacTable(text) {
  const rows = [];
  for (const line of cleanCliText(text).split('\n')) {
    const match = line.match(/^\s*([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})\s+(\d+)\s+(\S+)\s+(gpon-onu_\d+\/\d+\/\d+:\d+)\s+(.+?)\s*$/i);
    if (!match) continue;
    const macAddress = normalizeMacAddress(match[1]);
    if (!macAddress) continue;
    rows.push({
      macAddress,
      vlan: Number(match[2]),
      type: match[3],
      interfaceName: match[4],
      vport: match[5].trim(),
    });
  }
  return rows;
}

function classifyOnuServiceMode({ interfaceConfig = '', managementConfig = '', model = '', macCount = 0 } = {}) {
  const interfaceText = cleanCliText(interfaceConfig);
  const managementText = cleanCliText(managementConfig);
  const combined = `${interfaceText}\n${managementText}`;
  const routerEvidence = [];
  const bridgeEvidence = [];

  if (/^\s*ip-host\s+\d+\s+ip\s+(?:\d{1,3}\.){3}\d{1,3}\b/im.test(managementText)) {
    routerEvidence.push('WAN/IP host configurada en la ONU');
  }
  if (/^\s*switchport-bind\s+\S+\s+veip\s+\d+\b/im.test(managementText)) {
    routerEvidence.push('Interfaz VEIP vinculada');
  }
  if (/^\s*(?:wan-ip|wan-service|nat)\b/im.test(managementText)) {
    routerEvidence.push('Servicio WAN/NAT configurado');
  }

  if (/^\s*vlan\s+port\s+eth_\S+\s+mode\s+(?:tag|transparent)\b/im.test(managementText)) {
    bridgeEvidence.push('VLAN entregada directamente al puerto Ethernet');
  }
  if (/^\s*gemport\s+\d+\s+flow\s+\d+\b/im.test(managementText)
      && /^\s*flow\s+\d+\s+pri\s+\d+\s+vlan\s+\d+\b/im.test(managementText)) {
    bridgeEvidence.push('Flujo GEM conectado directamente a la VLAN');
  }
  if (/\b(?:HG8010H|HG8310M)\b/i.test(String(model || ''))) {
    bridgeEvidence.push(`Modelo ${String(model).trim()} usado como bridge Ethernet`);
  }
  if (Number(macCount) > 1) {
    bridgeEvidence.push(`${Number(macCount)} MAC de abonados aprendidas por la OLT`);
  }

  if (routerEvidence.length) {
    return {
      mode: 'router',
      confidence: routerEvidence.length >= 2 ? 'high' : 'medium',
      evidence: routerEvidence,
      limitation: 'La OLT ve la WAN del router; los dispositivos LAN/WiFi requieren TR-069 o lectura local.',
    };
  }
  if (bridgeEvidence.length) {
    return {
      mode: 'bridge',
      confidence: bridgeEvidence.length >= 2 ? 'high' : 'medium',
      evidence: bridgeEvidence,
      limitation: null,
    };
  }
  if (/service-port\s+\d+\s+vport\s+\d+/i.test(combined)) {
    return {
      mode: 'unknown',
      confidence: 'low',
      evidence: ['Servicio GPON presente, sin evidencia suficiente de bridge o router'],
      limitation: 'Se necesita leer la configuracion OMCI/WAN para clasificar esta ONU.',
    };
  }
  return {
    mode: 'unknown',
    confidence: 'low',
    evidence: ['Configuracion de servicio no identificada'],
    limitation: 'No hay datos suficientes para clasificar esta ONU.',
  };
}

function resolveClientMapping(existing, matchedClientId, hasInventory, mappedAt = new Date()) {
  if (!hasInventory || existing?.mappingSource === 'manual') return {};
  if (matchedClientId) {
    return { clientIdServicio: matchedClientId, mappingSource: 'serial', mappedAt, mappedBy: 'system' };
  }
  return { clientIdServicio: null, mappingSource: null, mappedAt: null, mappedBy: null };
}

class ZteC320Client {
  constructor(options = {}) {
    this.host = options.host;
    this.port = Number(options.port || 23);
    this.username = options.username;
    this.password = options.password;
    this.connectTimeoutMs = Number(options.connectTimeoutMs || 8000);
    this.commandTimeoutMs = Number(options.commandTimeoutMs || 12000);
    this.socket = null;
    this.buffer = '';
    this.telnetState = 'normal';
    this.telnetCommand = null;
  }

  isConfigured() {
    return Boolean(this.host && this.username && this.password);
  }

  async connect() {
    if (!this.isConfigured()) throw new Error('OLT no configurada');
    if (this.socket) return;
    this.socket = net.createConnection({ host: this.host, port: this.port });
    this.socket.setKeepAlive(true, 5000);
    this.socket.on('data', (chunk) => this.#onData(chunk));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Tiempo agotado conectando con OLT')), this.connectTimeoutMs);
      this.socket.once('connect', () => { clearTimeout(timer); resolve(); });
      this.socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    await this.#waitFor(/(?:Username|Login)\s*:/i, this.connectTimeoutMs);
    this.#write(this.username);
    await this.#waitFor(/Password\s*:/i, this.connectTimeoutMs);
    this.#write(this.password);
    await this.#waitFor(/[>#]\s*$/, this.connectTimeoutMs);
    await this.command('terminal length 0');
  }

  close() {
    if (this.socket) this.socket.destroy();
    this.socket = null;
  }

  async command(command) {
    if (!this.socket) throw new Error('OLT no conectada');
    this.buffer = '';
    this.#write(command);
    const output = await this.#waitFor(/[>#]\s*$/, this.commandTimeoutMs);
    const lines = cleanCliText(output).split('\n');
    if (lines[0]?.trim() === command) lines.shift();
    if (/[>#]\s*$/.test(lines.at(-1) || '')) lines.pop();
    const result = lines.join('\n').trim();
    if (/%Error|Invalid input|Unrecognized command/i.test(result)) {
      throw new Error(`La OLT rechazo una consulta permitida: ${command}`);
    }
    return result;
  }

  async fetchOverview({ includeInventory = true } = {}) {
    await this.connect();
    // A Telnet CLI is a single ordered stream; commands must never overlap.
    const systemText = await this.command('show system-group');
    const versionText = await this.command('show version-running');
    const cardsText = await this.command('show card');
    const temperatureText = await this.command('show card-temperature');
    const statesText = await this.command('show gpon onu state');
    const alarmsText = await this.command('show alarm pool');
    const unconfiguredText = await this.command('show gpon onu uncfg');
    const onus = parseOnuStates(statesText);
    const baseInfo = [];
    if (includeInventory) {
      const ponIndexes = [...new Set(onus.map((onu) => `${onu.rack}/${onu.shelf}/${onu.pon}`))];
      for (const ponIndex of ponIndexes) {
        const text = await this.command(`show gpon onu baseinfo gpon-olt_${ponIndex}`);
        baseInfo.push(...parseOnuBaseInfo(text));
      }
    }
    const temperatures = parseTemperatures(temperatureText);
    const cards = parseCards(cardsText).map((card) => ({ ...card, temperatureC: temperatures.get(card.location) ?? null }));
    return {
      system: { ...parseSystemGroup(systemText), ...parseVersionRunning(versionText) },
      cards,
      onus,
      baseInfo,
      pons: summarizePons(onus),
      alarms: parseAlarms(alarmsText),
      unconfigured: parseUnconfiguredOnus(unconfiguredText),
    };
  }

  async fetchProvisioningOptions(ponIndex) {
    assertPonIndex(ponIndex);
    await this.connect();
    const runningConfig = await this.command('show running-config');
    const ponConfig = await this.command(`show running-config interface gpon-olt_${ponIndex}`);
    const catalog = parseProvisioningCatalog(runningConfig);
    const usedOnuIds = parseConfiguredOnuIds(ponConfig);
    const recommendedOnuId = Array.from({ length: 128 }, (_, index) => index + 1)
      .find((id) => !usedOnuIds.includes(id)) || null;
    return { ...catalog, usedOnuIds, recommendedOnuId, ponConfig };
  }

  async fetchProfileCatalog() {
    await this.connect();
    return parseProvisioningCatalog(await this.command('show running-config'));
  }

  async fetchOnuTypeCatalog() {
    await this.connect();
    return parseOnuTypeCatalog(await this.command('show onu-type'));
  }

  async ensureOnuTypeProfile(model) {
    const before = await this.fetchOnuTypeCatalog();
    if (before.some((item) => item.name.toUpperCase() === String(model).toUpperCase())) {
      return { changed: false, profile: before.find((item) => item.name.toUpperCase() === String(model).toUpperCase()) };
    }
    for (const command of buildOnuTypeProfileCommands(model)) await this.command(command);
    await this.command('write');
    const after = await this.fetchOnuTypeCatalog();
    const profile = after.find((item) => item.name.toUpperCase() === String(model).toUpperCase());
    if (!profile) throw new Error(`La OLT no confirmo el perfil ONU ${model}`);
    return { changed: true, profile };
  }

  async createInternetSpeedProfiles(speeds) {
    const before = await this.fetchProfileCatalog();
    const plan = buildInternetProfileCommands(speeds, before);
    if (!plan.plans.some((item) => item.createTcont || item.createTraffic)) {
      return { changed: false, profiles: plan.plans };
    }
    for (const command of plan.commands) await this.command(command);
    await this.command('write');
    const after = await this.fetchProfileCatalog();
    const profiles = plan.plans.map((item) => ({
      ...item,
      tcontProfile: findInternetSpeedProfile(after.tcontProfiles, item.speedMbps, 'up')?.name || null,
      trafficProfile: findInternetSpeedProfile(after.trafficProfiles, item.speedMbps, 'down')?.name || null,
    }));
    const failed = profiles.filter((item) => !item.tcontProfile || !item.trafficProfile);
    if (failed.length) throw new Error(`La OLT no confirmo los perfiles de ${failed.map((item) => item.speedMbps).join(', ')} Mbps`);
    return { changed: true, profiles };
  }

  async checkWriteAccess() {
    await this.connect();
    await this.command('configure terminal');
    await this.command('end');
    return true;
  }

  async provisionOnu(input, onProgress = () => {}) {
    await this.connect();
    const plan = buildProvisioningCommands(input);
    const completedGroups = [];
    for (const group of plan.groups) {
      for (const command of group.commands) await this.command(command);
      completedGroups.push(group.key);
      onProgress(group.key);
    }
    await this.command('write');
    onProgress('saved');
    return { onuIndex: plan.onuIndex, completedGroups };
  }

  async verifyProvisionedOnu(ponIndex, onuId, serial, serviceMode = 'router', vlan = null, lanPorts = [1]) {
    assertPonIndex(ponIndex);
    const onuIndex = `${ponIndex}:${Number(onuId)}`;
    assertOnuIndex(onuIndex);
    const baseInfo = await this.command(`show gpon onu baseinfo gpon-olt_${ponIndex}`);
    const interfaceConfig = await this.command(`show running-config interface gpon-onu_${onuIndex}`);
    const managementConfig = await this.command('show running-config');
    const stateText = await this.command('show gpon onu state');
    const inventory = parseOnuBaseInfo(baseInfo).find((onu) => onu.onuIndex === onuIndex);
    const state = parseOnuStates(stateText).find((onu) => onu.onuIndex === onuIndex);
    const managementHeader = `pon-onu-mng gpon-onu_${onuIndex}`;
    const managementStart = managementConfig.split('\n').findIndex((line) => line.trim() === managementHeader);
    const managementBlock = managementStart < 0 ? '' : managementConfig.split('\n').slice(managementStart, managementStart + 20).join('\n');
    const normalizedExpected = String(serial || '').toUpperCase();
    return {
      onuIndex,
      inventory,
      state,
      serialMatches: String(inventory?.serial || '').toUpperCase() === normalizedExpected,
      serviceConfigured: /service-port\s+1\s+vport\s+1/i.test(interfaceConfig),
      serviceMode,
      managementConfigured: serviceMode === 'bridge'
        ? Boolean(/gemport\s+1\s+flow\s+1/i.test(managementBlock)
          && lanPorts.every((port) => new RegExp(`vlan\\s+port\\s+eth_0/${port}\\s+mode\\s+tag\\s+vlan\\s+${Number(vlan)}`, 'i').test(managementBlock))
          && !/ip-host\s+\d+\s+ip\s+/i.test(managementBlock))
        : /ip-host\s+1\s+ip\s+/i.test(managementBlock),
    };
  }

  async rollbackProvisioning(ponIndex, onuId) {
    assertPonIndex(ponIndex);
    const id = Number(onuId);
    if (!Number.isInteger(id) || id < 1 || id > 128) throw new Error('ID ONU invalido');
    await this.connect();
    try { await this.command('end'); } catch {}
    await this.command('configure terminal');
    await this.command(`interface gpon-olt_${ponIndex}`);
    await this.command(`no onu ${id}`);
    await this.command('exit');
    await this.command('end');
    await this.command('write');
    return true;
  }

  async fetchOnuConfigSnapshot(onuIndex, runningConfig = null) {
    assertOnuIndex(onuIndex);
    await this.connect();
    const interfaceConfig = await this.command(`show running-config interface gpon-onu_${onuIndex}`);
    const fullConfig = runningConfig == null ? await this.command('show running-config') : runningConfig;
    return {
      onuIndex,
      capturedAt: new Date().toISOString(),
      interfaceConfig,
      managementConfig: extractOnuManagementBlock(fullConfig, onuIndex),
    };
  }

  async fetchOnuAccessTopology(onuIndex, model = null) {
    assertOnuIndex(onuIndex);
    await this.connect();
    const snapshot = await this.fetchOnuConfigSnapshot(onuIndex);
    const macTable = parseOnuMacTable(await this.command(`show mac gpon onu gpon-onu_${onuIndex}`));
    return {
      onuIndex,
      ...classifyOnuServiceMode({
        interfaceConfig: snapshot.interfaceConfig,
        managementConfig: snapshot.managementConfig,
        model,
        macCount: macTable.length,
      }),
      macTable,
      capturedAt: new Date().toISOString(),
    };
  }

  async fetchOnuLocation(onuIndex) {
    assertOnuIndex(onuIndex);
    await this.connect();
    const [ponIndex] = onuIndex.split(':');
    const baseInfo = await this.command(`show gpon onu baseinfo gpon-olt_${ponIndex}`);
    const stateText = await this.command('show gpon onu state');
    const inventory = parseOnuBaseInfo(baseInfo).find((onu) => onu.onuIndex === onuIndex) || null;
    const state = parseOnuStates(stateText).find((onu) => onu.onuIndex === onuIndex) || null;
    return { onuIndex, inventory, state, exists: Boolean(inventory || state), online: state?.online === true };
  }

  async executeOnuOperation(onuIndex, action) {
    await this.connect();
    const commands = buildOnuOperationCommands(onuIndex, action);
    for (const command of commands) await this.command(command);
    return { onuIndex, action, commandsExecuted: commands.length };
  }

  async renameOnu(onuIndex, name) {
    await this.connect();
    const safeName = assertOnuName(name);
    const before = await this.fetchOnuDetail(onuIndex);
    if (before.name === safeName) return { onuIndex, oldName: before.name, newName: safeName, changed: false, verified: true };
    for (const command of buildOnuRenameCommands(onuIndex, safeName)) await this.command(command);
    const after = await this.fetchOnuDetail(onuIndex);
    if (after.name !== safeName) {
      const rollback = { attempted: false, ok: false };
      if (before.name && /^[A-Za-z0-9_.-]{1,32}$/.test(before.name)) {
        rollback.attempted = true;
        try {
          for (const command of buildOnuRenameCommands(onuIndex, before.name)) await this.command(command);
          rollback.ok = (await this.fetchOnuDetail(onuIndex)).name === before.name;
        } catch {}
      }
      const error = new Error('La OLT no confirmo el nuevo nombre de la ONU');
      error.rollback = rollback;
      throw error;
    }
    return { onuIndex, oldName: before.name, newName: safeName, changed: true, verified: true };
  }

  async fetchOnuDetail(onuIndex) {
    assertOnuIndex(onuIndex);
    await this.connect();
    const interfaceName = `gpon-onu_${onuIndex}`;
    const detailText = await this.command(`show gpon onu detail-info ${interfaceName}`);
    const distanceText = await this.command(`show gpon onu distance ${interfaceName}`);
    const rxText = await this.command(`show pon power onu-rx ${interfaceName}`);
    const txText = await this.command(`show pon power onu-tx ${interfaceName}`);
    const attenuationText = await this.command(`show pon power attenuation ${interfaceName}`);
    const trafficText = await this.command(`show interface ${interfaceName}`);
    return {
      onuIndex,
      ...parseOnuDetail(`${detailText}\n${distanceText}`),
      rxPowerDbm: firstDbm(rxText),
      txPowerDbm: firstDbm(txText),
      ...parseAttenuation(attenuationText),
      traffic: parseOnuInterfaceStats(trafficText),
    };
  }

  #write(value) {
    this.socket.write(`${value}\r\n`);
  }

  #waitFor(pattern, timeoutMs) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        if (pattern.test(this.buffer)) return resolve(this.buffer);
        if (!this.socket || this.socket.destroyed) return reject(new Error('Conexion OLT cerrada'));
        if (Date.now() - startedAt >= timeoutMs) return reject(new Error('Tiempo agotado esperando respuesta de OLT'));
        setTimeout(check, 25);
      };
      check();
    });
  }

  #onData(chunk) {
    const output = [];
    for (const byte of chunk) {
      if (this.telnetState === 'subnegotiation') {
        if (byte === IAC) this.telnetState = 'subnegotiation-iac';
        continue;
      }
      if (this.telnetState === 'subnegotiation-iac') {
        this.telnetState = byte === SE ? 'normal' : 'subnegotiation';
        continue;
      }
      if (this.telnetState === 'option') {
        const reply = this.telnetCommand === WILL || this.telnetCommand === WONT ? DONT : WONT;
        this.socket?.write(Buffer.from([IAC, reply, byte]));
        this.telnetState = 'normal';
        continue;
      }
      if (this.telnetState === 'iac') {
        if ([WILL, WONT, DO, DONT].includes(byte)) {
          this.telnetCommand = byte;
          this.telnetState = 'option';
        } else if (byte === SB) {
          this.telnetState = 'subnegotiation';
        } else {
          this.telnetState = 'normal';
          if (byte === IAC) output.push(byte);
        }
        continue;
      }
      if (byte === IAC) this.telnetState = 'iac';
      else output.push(byte);
    }
    if (output.length) this.buffer += Buffer.from(output).toString('utf8');
  }
}

module.exports = {
  ZteC320Client,
  assertPonIndex,
  assertOnuIndex,
  assertOnuName,
  buildOnuOperationCommands,
  buildOnuRenameCommands,
  extractOnuManagementBlock,
  buildInternetProfileCommands,
  buildOnuTypeProfileCommands,
  buildProvisioningCommands,
  cleanCliText,
  firstDbm,
  findInternetSpeedProfile,
  normalizeGponSerial,
  parseAlarms,
  parseAttenuation,
  parseCards,
  parseOnuBaseInfo,
  parseOnuDetail,
  parseOnuInterfaceStats,
  parseOnuMacTable,
  parseOnuStates,
  parseOnuTypeCatalog,
  parseConfiguredOnuIds,
  parseProvisioningCatalog,
  parseSystemGroup,
  parseTemperatures,
  parseUnconfiguredOnus,
  parseVersionRunning,
  resolveClientMapping,
  classifyOnuServiceMode,
  normalizeMacAddress,
  summarizePons,
};
