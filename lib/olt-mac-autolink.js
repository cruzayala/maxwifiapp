'use strict';

// Asociacion automatica ONU -> cliente por la red, sin depender del serial ni del nombre.
// La OLT dice que MAC hay detras de cada ONU (show mac gpon onu); el MikroTik dice que IP
// tiene esa MAC (ARP); la IP identifica al cliente. Es la misma evidencia que el
// "Diagnostico extremo a extremo" ya mostraba al abrir una ONU, pero sin guardarla.
//
// Reglas para no asociar mal:
//   - las MAC de la ONU deben llevar a UN solo cliente;
//   - ese cliente no puede estar ya asociado a otra ONU;
//   - si dos ONUs llevan al mismo cliente en la misma pasada, no se asocia ninguna.

function normalizeMac(value) {
  const compact = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(compact) ? compact.match(/.{2}/g).join(':') : null;
}

/** Clientes que aparecen detras de una ONU, por ARP (MAC -> IP -> cliente) o por la MAC guardada. */
function clientsBehindOnu(macs, { arpByMac, clientByIp, clientByMac }) {
  const found = new Map();
  for (const raw of macs) {
    const mac = normalizeMac(raw);
    if (!mac) continue;
    for (const ip of arpByMac.get(mac) || []) {
      const client = clientByIp.get(ip);
      if (client) found.set(client.idServicio, { client, mac, ip });
    }
    const direct = clientByMac.get(mac);
    if (direct && !found.has(direct.idServicio)) found.set(direct.idServicio, { client: direct, mac, ip: direct.ip || null });
  }
  return [...found.values()];
}

/**
 * onuMacs:  [{ onuIndex, macs: ['AA:BB:..'] }]      (solo ONUs sin cliente)
 * arpRows:  filas de /ip/arp/print del MikroTik
 * clients:  [{ idServicio, nombre, ip, mtMacAddress, macCpe }]
 * linkedClientIds: clientes ya asociados a alguna ONU
 */
function planMacAutoLinks({ onuMacs, arpRows, clients, linkedClientIds }) {
  const arpByMac = new Map();
  for (const row of arpRows || []) {
    const mac = normalizeMac(row['mac-address']);
    const ip = String(row.address || '').trim();
    if (!mac || !ip || row.complete === 'false') continue;
    if (!arpByMac.has(mac)) arpByMac.set(mac, new Set());
    arpByMac.get(mac).add(ip);
  }
  const clientByIp = new Map();
  const clientByMac = new Map();
  for (const client of clients || []) {
    if (client.ip) clientByIp.set(String(client.ip).trim(), client);
    for (const value of [client.mtMacAddress, client.macCpe]) {
      const mac = normalizeMac(value);
      if (mac && !clientByMac.has(mac)) clientByMac.set(mac, client);
    }
  }
  const linked = new Set(linkedClientIds || []);

  const provisional = [];
  const skipped = [];
  for (const { onuIndex, macs } of onuMacs || []) {
    if (!macs?.length) { skipped.push({ onuIndex, reason: 'no_mac' }); continue; }
    const behind = clientsBehindOnu(macs, { arpByMac, clientByIp, clientByMac });
    if (!behind.length) { skipped.push({ onuIndex, reason: 'no_client' }); continue; }
    if (behind.length > 1) { skipped.push({ onuIndex, reason: 'several_clients', clients: behind.map((row) => row.client.idServicio) }); continue; }
    const [{ client, mac, ip }] = behind;
    if (linked.has(client.idServicio)) { skipped.push({ onuIndex, reason: 'client_already_linked', client: client.idServicio }); continue; }
    provisional.push({ onuIndex, client, mac, ip });
  }

  const byClient = new Map();
  for (const row of provisional) {
    if (!byClient.has(row.client.idServicio)) byClient.set(row.client.idServicio, []);
    byClient.get(row.client.idServicio).push(row);
  }
  const links = [];
  for (const rows of byClient.values()) {
    if (rows.length > 1) {
      for (const row of rows) skipped.push({ onuIndex: row.onuIndex, reason: 'client_on_several_onus', client: row.client.idServicio });
      continue;
    }
    const [row] = rows;
    links.push({
      onuIndex: row.onuIndex,
      mac: row.mac,
      ip: row.ip,
      client: { idServicio: row.client.idServicio, nombre: row.client.nombre, ip: row.client.ip || null },
    });
  }
  links.sort((a, b) => a.onuIndex.localeCompare(b.onuIndex, undefined, { numeric: true }));
  return { links, skipped };
}

module.exports = { planMacAutoLinks, normalizeMac };
