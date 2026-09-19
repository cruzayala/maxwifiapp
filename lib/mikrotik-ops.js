function ipv4ToInt(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    result = ((result << 8) | octet) >>> 0;
  }
  return result >>> 0;
}

function isValidIpv4(value) {
  return ipv4ToInt(value) != null;
}

function isRouterId(value) {
  return /^\*[0-9a-f]+$/i.test(String(value || ''));
}

function isValidMac(value) {
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(String(value || ''));
}

function cleanRouterText(value, field, maxLength = 120) {
  const text = String(value || '').trim();
  if (!text || text.length > maxLength || /[\x00-\x1f\x7f]/.test(text)) {
    const error = new Error(`${field} es requerido, admite hasta ${maxLength} caracteres y no acepta caracteres de control`);
    error.statusCode = 400;
    throw error;
  }
  return text;
}

function sanitizeRouterFileName(value) {
  const text = String(value || '').trim().replace(/\.(backup|rsc)$/i, '');
  if (!/^[a-z0-9][a-z0-9._-]{2,47}$/i.test(text)) {
    const error = new Error('El nombre debe tener 3 a 48 caracteres y usar solo letras, numeros, punto, guion o guion bajo');
    error.statusCode = 400;
    throw error;
  }
  return text;
}

function sanitizeSpeedTemplate(value) {
  const source = value || {};
  return {
    id: source.id ? String(source.id).trim() : null,
    name: cleanRouterText(source.name, 'name', 50),
    uploadMbps: normalizeMbps(source.uploadMbps, 'uploadMbps') / 1_000_000,
    downloadMbps: normalizeMbps(source.downloadMbps, 'downloadMbps') / 1_000_000,
  };
}

function sanitizeNetwatchMutation(value, { partial = false } = {}) {
  const source = value || {};
  const result = {};
  if (!partial || source.host != null) {
    const host = String(source.host || '').trim();
    const validHost = isValidIpv4(host)
      || (/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(host) && !host.includes('..'));
    if (!validHost) {
      const error = new Error('host debe ser una IP o dominio valido');
      error.statusCode = 400;
      throw error;
    }
    result.host = host;
  }
  if (!partial || source.type != null) {
    const type = String(source.type || 'icmp');
    if (!['simple', 'icmp', 'tcp-conn', 'http-get', 'https-get', 'dns'].includes(type)) {
      const error = new Error('Tipo de sonda Netwatch invalido');
      error.statusCode = 400;
      throw error;
    }
    result.type = type;
  }
  if (!partial || source.interval != null) {
    const interval = String(source.interval || '1m').trim();
    if (!/^\d{1,4}[smhd]$/.test(interval)) {
      const error = new Error('interval debe usar formato como 30s, 5m, 1h o 1d');
      error.statusCode = 400;
      throw error;
    }
    result.interval = interval;
  }
  if (source.port != null && source.port !== '') {
    const port = Number(source.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      const error = new Error('port debe estar entre 1 y 65535');
      error.statusCode = 400;
      throw error;
    }
    result.port = port;
  }
  if (source.comment != null) result.comment = cleanRouterText(source.comment, 'comment', 120);
  if (source.disabled != null) result.disabled = source.disabled === true;
  if (partial && Object.keys(result).length === 0) {
    const error = new Error('No hay cambios validos para aplicar');
    error.statusCode = 400;
    throw error;
  }
  return result;
}

function ipInCidr(ip, cidr) {
  const [network, rawPrefix = '32'] = String(cidr || '').trim().split('/');
  const ipNumber = ipv4ToInt(ip);
  const networkNumber = ipv4ToInt(network);
  const prefix = Number(rawPrefix);
  if (ipNumber == null || networkNumber == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNumber & mask) === (networkNumber & mask);
}

function intToIpv4(value) {
  const number = Number(value) >>> 0;
  return [24, 16, 8, 0].map((shift) => (number >>> shift) & 255).join('.');
}

function cidrHostRange(cidr) {
  const [rawNetwork, rawPrefix = '32'] = String(cidr || '').trim().split('/');
  const ipNumber = ipv4ToInt(rawNetwork);
  const prefix = Number(rawPrefix);
  if (ipNumber == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const networkNumber = (ipNumber & mask) >>> 0;
  const addressCount = 2 ** (32 - prefix);
  const capacity = prefix >= 31 ? 0 : addressCount - 2;
  return {
    cidr: `${intToIpv4(networkNumber)}/${prefix}`,
    network: intToIpv4(networkNumber),
    prefix,
    capacity,
    firstHost: capacity ? (networkNumber + 1) >>> 0 : null,
    lastHost: capacity ? (networkNumber + addressCount - 2) >>> 0 : null,
  };
}

function ipInPoolRanges(ip, pools = []) {
  const number = ipv4ToInt(ip);
  if (number == null) return null;
  for (const pool of pools) {
    for (const rawRange of String(pool.ranges || '').split(',')) {
      const [start, end = start] = rawRange.trim().split('-');
      const startNumber = ipv4ToInt(start);
      const endNumber = ipv4ToInt(end);
      if (startNumber != null && endNumber != null && number >= startNumber && number <= endNumber) {
        return pool.name || 'DHCP';
      }
    }
  }
  return null;
}

function parseClientCidrs(value) {
  return String(value || '192.168.10.0/23,192.168.12.0/22,192.168.16.0/24')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildIpamReport({ leases = [], arp = [], clients = [], queues = [], routerAddresses = [], pools = [], cidrs = [] }) {
  const clientsByIp = new Map(clients.filter((client) => isValidIpv4(client.ip)).map((client) => [client.ip, client]));
  const leasesByIp = new Map();
  const arpByIp = new Map();
  const queuesByIp = new Map();
  const routerByIp = new Map();
  const ipsByMac = new Map();

  for (const lease of leases) {
    if (!isValidIpv4(lease.address)) continue;
    const rows = leasesByIp.get(lease.address) || [];
    rows.push(lease);
    leasesByIp.set(lease.address, rows);
  }
  for (const entry of arp) {
    if (!isValidIpv4(entry.address)) continue;
    const rows = arpByIp.get(entry.address) || [];
    rows.push(entry);
    arpByIp.set(entry.address, rows);
    const mac = String(entry['mac-address'] || '').toUpperCase();
    if (isValidMac(mac)) {
      const ips = ipsByMac.get(mac) || new Set();
      ips.add(entry.address);
      ipsByMac.set(mac, ips);
    }
  }

  for (const queue of queues) {
    const ip = queueTargetIp(queue.target);
    if (isValidIpv4(ip) && !queuesByIp.has(ip)) queuesByIp.set(ip, queue);
  }
  for (const address of routerAddresses) {
    const ip = String(address.address || '').split('/')[0];
    if (isValidIpv4(ip)) routerByIp.set(ip, address);
  }

  const configuredCidrs = cidrs.length ? cidrs : parseClientCidrs();
  const ranges = configuredCidrs.map(cidrHostRange).filter(Boolean);
  const totalCapacity = ranges.reduce((sum, range) => sum + range.capacity, 0);
  const truncated = totalCapacity > 65_536;
  const addresses = new Set([
    ...leasesByIp.keys(), ...arpByIp.keys(), ...clientsByIp.keys(), ...queuesByIp.keys(), ...routerByIp.keys(),
  ]);
  if (!truncated) {
    for (const range of ranges) {
      for (let value = range.firstHost; value != null && value <= range.lastHost; value++) {
        addresses.add(intToIpv4(value));
      }
    }
  }

  const rows = [...addresses].map((ip) => {
    const leaseRows = leasesByIp.get(ip) || [];
    const arpRows = arpByIp.get(ip) || [];
    const lease = leaseRows[0] || null;
    // RouterOS keeps incomplete ARP probes without a MAC. They are evidence
    // that an address was queried, not evidence that a device owns it.
    const arpEntry = arpRows.find((entry) => isValidMac(String(entry['mac-address'] || '').toUpperCase())) || null;
    const arpProbe = !arpEntry && arpRows.length ? arpRows[0] : null;
    const queue = queuesByIp.get(ip) || null;
    const routerAddress = routerByIp.get(ip) || null;
    const macs = new Set([...leaseRows, ...arpRows]
      .map((entry) => String(entry['mac-address'] || '').toUpperCase())
      .filter(isValidMac));
    const client = clientsByIp.get(ip) || null;
    const poolName = ipInPoolRanges(ip, pools);
    const cidr = ranges.find((range) => ipInCidr(ip, range.cidr))?.cidr || null;
    const sources = [
      client ? 'wisphub' : null,
      queue ? 'queue' : null,
      lease ? 'dhcp' : null,
      arpEntry ? 'arp' : null,
      arpProbe ? 'arp_probe' : null,
      routerAddress ? 'router' : null,
      poolName ? 'pool' : null,
    ].filter(Boolean);
    const classification = routerAddress ? 'router'
      : client ? 'client'
        : lease ? 'unknown_lease'
          : queue ? 'queue_only'
            : arpEntry ? 'arp_only'
              : poolName ? 'pool_reserved'
                : 'available';
    return {
      ip,
      cidr,
      macAddress: [...macs][0] || null,
      macAddresses: [...macs],
      interface: (arpEntry || arpProbe)?.interface || null,
      leaseId: lease?.['.id'] || null,
      hostName: lease?.['host-name'] || null,
      server: lease?.server || null,
      queueId: queue?.['.id'] || null,
      queueName: queue?.name || null,
      poolName,
      status: classification === 'available' ? 'available' : lease?.status || (arpEntry ? 'arp' : 'reserved'),
      dynamic: lease ? lease.dynamic === 'true' || lease.dynamic === true : false,
      disabled: lease ? lease.disabled === 'true' || lease.disabled === true : false,
      client: client ? { id: client.idServicio, name: client.nombre, username: client.usuario } : null,
      classification,
      available: classification === 'available',
      availabilityConfidence: arpProbe ? 'probe_required' : 'verified',
      observed: Boolean(arpEntry || arpProbe),
      sources,
      conflict: macs.size > 1 || leaseRows.length > 1,
    };
  }).sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));

  for (const range of ranges) {
    const candidates = rows.filter((row) => row.cidr === range.cidr && row.available).slice(0, 5);
    for (const row of candidates) row.recommended = true;
  }
  for (const row of rows) row.recommended = row.recommended === true;

  const macMoves = [...ipsByMac.entries()]
    .filter(([, ips]) => ips.size > 1)
    .map(([macAddress, ips]) => ({ macAddress, ips: [...ips].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) }));
  const ipConflicts = rows.filter((row) => row.conflict).map((row) => ({ ip: row.ip, macAddresses: row.macAddresses }));
  const networks = ranges.map((range) => {
    const networkRows = rows.filter((row) => row.cidr === range.cidr);
    const used = networkRows.filter((row) => !row.available).length;
    const available = truncated ? Math.max(0, range.capacity - used) : networkRows.filter((row) => row.available).length;
    return {
      cidr: range.cidr,
      network: range.network,
      prefix: range.prefix,
      capacity: range.capacity,
      used,
      available,
      utilization: range.capacity ? Math.round((used / range.capacity) * 1000) / 10 : 0,
      recommended: networkRows.filter((row) => row.recommended).map((row) => row.ip),
    };
  });

  return {
    timestamp: new Date().toISOString(),
    stats: {
      total: rows.length,
      matchedClients: rows.filter((row) => row.classification === 'client').length,
      unknownLeases: rows.filter((row) => row.classification === 'unknown_lease').length,
      arpOnly: rows.filter((row) => row.classification === 'arp_only').length,
      arpProbes: rows.filter((row) => row.availabilityConfidence === 'probe_required').length,
      queueOnly: rows.filter((row) => row.classification === 'queue_only').length,
      poolReserved: rows.filter((row) => row.classification === 'pool_reserved').length,
      routerAddresses: rows.filter((row) => row.classification === 'router').length,
      occupiedWithoutClient: rows.filter((row) => !row.available && !['client', 'router'].includes(row.classification)).length,
      available: networks.reduce((sum, network) => sum + network.available, 0),
      ipConflicts: ipConflicts.length,
      macMoves: macMoves.length,
    },
    source: 'live',
    truncated,
    networks,
    conflicts: { ip: ipConflicts, mac: macMoves },
    rows,
  };
}

function queueTargetIp(target) {
  return String(target || '').split(',')[0].trim().split('/')[0];
}

function splitAddressPort(value) {
  const text = String(value || '');
  const match = text.match(/^(\d+\.\d+\.\d+\.\d+)(?::\d+)?$/);
  return match ? match[1] : text;
}

function parseRatePair(value) {
  const [upload = '0', download = '0'] = String(value || '0/0').split('/');
  return {
    uploadBps: Math.max(0, Number.parseInt(upload, 10) || 0),
    downloadBps: Math.max(0, Number.parseInt(download, 10) || 0),
  };
}

function parseBytesPair(value) {
  const [upload = '0', download = '0'] = String(value || '0/0').split('/');
  return {
    uploadBytes: Math.max(0, Number.parseInt(upload, 10) || 0),
    downloadBytes: Math.max(0, Number.parseInt(download, 10) || 0),
  };
}

function normalizeMbps(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0.1 || number > 10_000) {
    const error = new Error(`${field} debe estar entre 0.1 y 10000 Mbps`);
    error.statusCode = 400;
    throw error;
  }
  return Math.round(number * 1_000_000);
}

function sanitizeQueueMutation(body, { partial = false } = {}) {
  const source = body || {};
  const result = {};

  if (!partial || source.targetIp != null) {
    const targetIp = String(source.targetIp || '').trim();
    if (!isValidIpv4(targetIp)) {
      const error = new Error('targetIp debe ser una direccion IPv4 valida');
      error.statusCode = 400;
      throw error;
    }
    result.targetIp = targetIp;
  }

  if (!partial || source.name != null) {
    const name = String(source.name || '').trim();
    if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) {
      const error = new Error('name es requerido, admite hasta 80 caracteres y no acepta caracteres de control');
      error.statusCode = 400;
      throw error;
    }
    result.name = name;
  }

  if (!partial || source.uploadMbps != null) result.uploadBps = normalizeMbps(source.uploadMbps, 'uploadMbps');
  if (!partial || source.downloadMbps != null) result.downloadBps = normalizeMbps(source.downloadMbps, 'downloadMbps');

  if (source.comment != null) {
    result.comment = String(source.comment).replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 200);
  }
  if (source.disabled != null) result.disabled = source.disabled === true;

  if (partial && Object.keys(result).length === 0) {
    const error = new Error('No hay cambios validos para aplicar');
    error.statusCode = 400;
    throw error;
  }
  return result;
}

function aggregateConnections(connections) {
  const totals = new Map();
  for (const connection of connections || []) {
    const ip = splitAddressPort(connection['src-address']);
    if (!isValidIpv4(ip)) continue;
    const current = totals.get(ip) || { connectionCount: 0, uploadBytes: 0, downloadBytes: 0 };
    current.connectionCount += 1;
    current.uploadBytes += Number.parseInt(connection['orig-bytes'] || '0', 10) || 0;
    current.downloadBytes += Number.parseInt(connection['repl-bytes'] || '0', 10) || 0;
    totals.set(ip, current);
  }
  return totals;
}

function buildUnknownDevices({ arp = [], queues = [], clients = [], neighbors = [], bridgeHosts = [], connections = [], cidrs = [] }) {
  const configuredCidrs = cidrs.length ? cidrs : parseClientCidrs();
  const clientsByIp = new Map(clients.filter((client) => client.ip).map((client) => [client.ip, client]));
  const queuesByIp = new Map();
  for (const queue of queues) {
    const ip = queueTargetIp(queue.target);
    if (ip) queuesByIp.set(ip, queue);
  }
  const arpByIp = new Map(arp.filter((entry) => entry.address).map((entry) => [entry.address, entry]));
  const neighborsByIp = new Map(neighbors.filter((entry) => entry.address).map((entry) => [entry.address, entry]));
  const bridgeByMac = new Map(bridgeHosts.filter((entry) => entry['mac-address']).map((entry) => [entry['mac-address'], entry]));
  const connectionTotals = aggregateConnections(connections);
  const candidateIps = new Set([...arpByIp.keys(), ...queuesByIp.keys()]);
  const result = [];

  for (const ip of candidateIps) {
    if (!configuredCidrs.some((cidr) => ipInCidr(ip, cidr)) || clientsByIp.has(ip)) continue;
    const arpEntry = arpByIp.get(ip);
    const queue = queuesByIp.get(ip);
    const neighbor = neighborsByIp.get(ip);
    const bridgeHost = bridgeByMac.get(arpEntry?.['mac-address']);
    const traffic = queue ? parseRatePair(queue.rate) : { uploadBps: 0, downloadBps: 0 };
    const accumulated = queue ? parseBytesPair(queue.bytes) : { uploadBytes: 0, downloadBytes: 0 };
    const tracked = connectionTotals.get(ip) || { connectionCount: 0, uploadBytes: 0, downloadBytes: 0 };
    const likelyInfrastructure = Boolean(neighbor?.identity || neighbor?.platform) || ip.startsWith('192.168.12.');
    const hasTrafficEvidence = traffic.uploadBps + traffic.downloadBps > 0 || tracked.connectionCount > 0;

    result.push({
      ip,
      macAddress: arpEntry?.['mac-address'] || null,
      interface: arpEntry?.interface || null,
      bridgePort: bridgeHost?.interface || null,
      identity: neighbor?.identity || null,
      platform: neighbor?.platform || null,
      version: neighbor?.version || null,
      queueId: queue?.['.id'] || null,
      queueName: queue?.name || null,
      maxLimit: queue?.['max-limit'] || null,
      disabled: queue?.disabled === 'true' || queue?.disabled === true,
      uploadBps: traffic.uploadBps,
      downloadBps: traffic.downloadBps,
      totalUploadBytes: accumulated.uploadBytes || tracked.uploadBytes,
      totalDownloadBytes: accumulated.downloadBytes || tracked.downloadBytes,
      connectionCount: tracked.connectionCount,
      likelyInfrastructure,
      classification: queue ? 'unregistered_queue' : likelyInfrastructure ? 'infrastructure_candidate' : 'unmanaged_device',
      risk: queue || hasTrafficEvidence ? 'high' : likelyInfrastructure ? 'low' : 'medium',
    });
  }

  const riskOrder = { high: 0, medium: 1, low: 2 };
  return result.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk]
    || (b.uploadBps + b.downloadBps) - (a.uploadBps + a.downloadBps)
    || a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}

function parseRouterOsVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 0)] : null;
}

function compareVersions(left, right) {
  const a = parseRouterOsVersion(left);
  const b = parseRouterOsVersion(right);
  if (!a || !b) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function buildSecurityAudit({ resource = {}, services = [], users = [], activeUsers = [], ipSettings = {}, dns = {}, filters = [], minimumVersion = '7.20.8' }) {
  const findings = [];
  const addFinding = (severity, code, title, detail) => findings.push({ severity, code, title, detail });
  const version = resource.version || '';

  if (compareVersions(version, minimumVersion) < 0) {
    addFinding('high', 'routeros_outdated', 'RouterOS desactualizado', `Version instalada ${version || 'desconocida'}; minimo operativo configurado ${minimumVersion}.`);
  }

  for (const service of services) {
    if (service.disabled === 'true' || service.disabled === true) continue;
    if (!service.address && ['ssh', 'winbox', 'www', 'www-ssl', 'api'].includes(service.name)) {
      addFinding('critical', `service_open_${service.name}`, `${service.name} sin restriccion de origen`, `El servicio TCP ${service.port} acepta conexiones desde cualquier direccion permitida por firewall.`);
    }
  }

  const broadLocalRule = filters.find((rule) => rule.chain === 'input'
    && rule.action === 'accept'
    && ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'].includes(rule['src-address']));
  if (broadLocalRule) {
    addFinding('medium', 'broad_local_management', 'Administracion abierta a toda la red privada', `La regla ${broadLocalRule.comment || broadLocalRule['.id']} permite acceso al router desde una red privada completa.`);
  }

  if (dns['allow-remote-requests'] === 'true' || dns['allow-remote-requests'] === true) {
    const wanDnsDrop = filters.some((rule) => rule.chain === 'input' && rule.action === 'drop' && ['53', '53,853'].includes(rule['dst-port']));
    addFinding(wanDnsDrop ? 'low' : 'high', 'dns_remote_requests', 'Resolvedor DNS remoto habilitado', wanDnsDrop
      ? 'Existe al menos una regla de bloqueo DNS, pero debe cubrir todas las interfaces WAN.'
      : 'No se encontro una regla clara que bloquee DNS desde Internet.');
  }

  if (String(ipSettings['rp-filter'] || '').toLowerCase() === 'no') {
    addFinding('medium', 'rp_filter_disabled', 'Validacion de origen deshabilitada', 'rp-filter esta en no; revise rutas asimetricas antes de habilitarlo.');
  }

  const unrestrictedUsers = users.filter((user) => user.disabled !== 'true' && !user.address && user.group === 'full');
  if (unrestrictedUsers.length) {
    addFinding('medium', 'unrestricted_full_users', 'Usuarios full sin restriccion de IP', unrestrictedUsers.map((user) => user.name).join(', '));
  }

  const counts = findings.reduce((acc, finding) => ({ ...acc, [finding.severity]: (acc[finding.severity] || 0) + 1 }), {});
  return {
    score: Math.max(0, 100 - (counts.critical || 0) * 30 - (counts.high || 0) * 18 - (counts.medium || 0) * 8 - (counts.low || 0) * 2),
    version,
    minimumVersion,
    activeAdministrators: activeUsers.map((entry) => ({ name: entry.name, address: entry.address, via: entry.via, when: entry.when })),
    findings,
    counts: { critical: counts.critical || 0, high: counts.high || 0, medium: counts.medium || 0, low: counts.low || 0 },
  };
}

module.exports = {
  buildIpamReport,
  buildSecurityAudit,
  buildUnknownDevices,
  cidrHostRange,
  compareVersions,
  intToIpv4,
  ipInCidr,
  isValidIpv4,
  isRouterId,
  isValidMac,
  parseClientCidrs,
  parseRatePair,
  queueTargetIp,
  sanitizeNetwatchMutation,
  sanitizeQueueMutation,
  sanitizeRouterFileName,
  sanitizeSpeedTemplate,
};
