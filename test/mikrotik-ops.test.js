const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildIpamReport,
  buildSecurityAudit,
  buildUnknownDevices,
  ipInCidr,
  sanitizeNetwatchMutation,
  sanitizeQueueMutation,
  sanitizeRouterFileName,
  sanitizeSpeedTemplate,
} = require('../lib/mikrotik-ops');

test('IPv4 CIDR matching is exact across customer networks', () => {
  assert.equal(ipInCidr('192.168.15.151', '192.168.12.0/22'), true);
  assert.equal(ipInCidr('192.168.16.1', '192.168.12.0/22'), false);
  assert.equal(ipInCidr('not-an-ip', '192.168.12.0/22'), false);
});

test('queue mutation validates targets and converts Mbps to RouterOS bps', () => {
  assert.deepEqual(sanitizeQueueMutation({
    targetIp: '192.168.15.151', name: 'DESCONOCIDO', uploadMbps: 1, downloadMbps: 1,
  }), {
    targetIp: '192.168.15.151', name: 'DESCONOCIDO', uploadBps: 1_000_000, downloadBps: 1_000_000,
  });
  assert.throws(() => sanitizeQueueMutation({ targetIp: '999.1.1.1', name: 'x', uploadMbps: 1, downloadMbps: 1 }), /IPv4 valida/);
  assert.throws(() => sanitizeQueueMutation({ targetIp: '10.0.0.1', name: 'x', uploadMbps: 0, downloadMbps: 1 }), /entre 0.1 y 10000/);
});

test('queue mutation rejects control characters and cleans comments', () => {
  assert.throws(
    () => sanitizeQueueMutation({ targetIp: '192.168.10.8', name: 'cliente\nmal', uploadMbps: 1, downloadMbps: 1 }),
    /caracteres de control/,
  );
  const result = sanitizeQueueMutation({
    targetIp: '192.168.10.8', name: 'Cliente', uploadMbps: 1, downloadMbps: 1, comment: 'linea 1\nlinea 2',
  });
  assert.equal(result.comment, 'linea 1 linea 2');
});

test('unknown devices include unmanaged ARP and queues without an ERP client', () => {
  const rows = buildUnknownDevices({
    cidrs: ['192.168.15.0/24'],
    clients: [{ ip: '192.168.15.20', nombre: 'Registrado' }],
    arp: [
      { address: '192.168.15.20', 'mac-address': 'AA:AA:AA:AA:AA:20', interface: 'bridge1' },
      { address: '192.168.15.151', 'mac-address': 'AA:AA:AA:AA:AA:51', interface: 'bridge1' },
    ],
    queues: [{ '.id': '*1', name: 'DESCONOCIDO', target: '192.168.15.151/32', rate: '100/200', bytes: '1000/2000', 'max-limit': '1000000/1000000' }],
    connections: [{ 'src-address': '192.168.15.151:5000', 'orig-bytes': '400', 'repl-bytes': '800' }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ip, '192.168.15.151');
  assert.equal(rows[0].classification, 'unregistered_queue');
  assert.equal(rows[0].risk, 'high');
  assert.equal(rows[0].connectionCount, 1);
});

test('security audit flags outdated RouterOS and unrestricted management', () => {
  const audit = buildSecurityAudit({
    resource: { version: '7.9.2 (stable)' },
    minimumVersion: '7.20.8',
    services: [{ name: 'winbox', port: '8291', address: '', disabled: 'false' }],
    users: [{ name: 'admin', group: 'full', address: '', disabled: 'false' }],
    activeUsers: [],
    ipSettings: { 'rp-filter': 'no' },
    dns: { 'allow-remote-requests': 'false' },
    filters: [],
  });
  assert.ok(audit.score < 60);
  assert.ok(audit.findings.some((finding) => finding.code === 'routeros_outdated'));
  assert.ok(audit.findings.some((finding) => finding.code === 'service_open_winbox'));
});

test('router backup names cannot inject RouterOS commands', () => {
  assert.equal(sanitizeRouterFileName('ispmax-manual_2026'), 'ispmax-manual_2026');
  assert.equal(sanitizeRouterFileName('respaldo.backup'), 'respaldo');
  assert.throws(() => sanitizeRouterFileName('x'), /3 a 48/);
  assert.throws(() => sanitizeRouterFileName('backup;remove=*1'), /solo letras/);
});

test('speed templates validate labels and convert limits consistently', () => {
  assert.deepEqual(sanitizeSpeedTemplate({ name: 'Plan 20M', uploadMbps: 10, downloadMbps: 20 }), {
    id: null,
    name: 'Plan 20M',
    uploadMbps: 10,
    downloadMbps: 20,
  });
  assert.throws(() => sanitizeSpeedTemplate({ name: 'Plan', uploadMbps: 0, downloadMbps: 20 }), /entre 0.1 y 10000/);
});

test('netwatch mutations only accept supported probe settings', () => {
  assert.deepEqual(sanitizeNetwatchMutation({ host: '1.1.1.1', type: 'icmp', interval: '30s' }), {
    host: '1.1.1.1', type: 'icmp', interval: '30s',
  });
  assert.deepEqual(sanitizeNetwatchMutation({ disabled: true }, { partial: true }), { disabled: true });
  assert.throws(() => sanitizeNetwatchMutation({ host: ';reboot', type: 'icmp', interval: '1m' }), /IP o dominio/);
  assert.throws(() => sanitizeNetwatchMutation({ host: 'example.com', type: 'script', interval: '1m' }), /invalido/);
});

test('IPAM report detects duplicate IPs and MAC movement across addresses', () => {
  const report = buildIpamReport({
    cidrs: ['192.168.10.0/24'],
    clients: [{ idServicio: 7, nombre: 'Cliente', usuario: 'cliente', ip: '192.168.10.2' }],
    leases: [
      { '.id': '*1', address: '192.168.10.2', 'mac-address': 'AA:BB:CC:DD:EE:01', dynamic: 'true', status: 'bound' },
      { '.id': '*2', address: '192.168.10.3', 'mac-address': 'AA:BB:CC:DD:EE:02', dynamic: 'true', status: 'bound' },
      { '.id': '*3', address: '192.168.10.3', 'mac-address': 'AA:BB:CC:DD:EE:03', dynamic: 'true', status: 'bound' },
    ],
    arp: [
      { address: '192.168.10.2', 'mac-address': 'AA:BB:CC:DD:EE:01' },
      { address: '192.168.10.4', 'mac-address': 'AA:BB:CC:DD:EE:01' },
    ],
  });
  assert.equal(report.stats.matchedClients, 1);
  assert.equal(report.stats.ipConflicts, 1);
  assert.equal(report.stats.macMoves, 1);
  assert.equal(report.networks[0].capacity, 254);
  assert.equal(report.networks[0].used, 3);
  assert.equal(report.networks[0].available, 251);
  assert.equal(report.rows.find((row) => row.ip === '192.168.10.5').classification, 'available');
});

test('IPAM only suggests addresses absent from clients, queues, leases, ARP, router and DHCP pools', () => {
  const report = buildIpamReport({
    cidrs: ['192.168.16.0/28'],
    clients: [{ idServicio: 9, nombre: 'Cliente', ip: '192.168.16.2' }],
    queues: [{ '.id': '*9', name: 'reservada', target: '192.168.16.3/32' }],
    leases: [{ '.id': '*4', address: '192.168.16.4', 'mac-address': 'AA:BB:CC:DD:EE:04' }],
    arp: [{ address: '192.168.16.5', 'mac-address': 'AA:BB:CC:DD:EE:05' }],
    routerAddresses: [{ address: '192.168.16.1/28', interface: 'vlan101' }],
    pools: [{ name: 'clientes-dhcp', ranges: '192.168.16.10-192.168.16.12' }],
  });
  assert.equal(report.rows.find((row) => row.ip === '192.168.16.1').classification, 'router');
  assert.equal(report.rows.find((row) => row.ip === '192.168.16.3').classification, 'queue_only');
  assert.equal(report.rows.find((row) => row.ip === '192.168.16.10').classification, 'pool_reserved');
  assert.equal(report.rows.find((row) => row.ip === '192.168.16.6').classification, 'available');
  assert.ok(report.networks[0].recommended.includes('192.168.16.6'));
  assert.equal(report.stats.available, 6);
});

test('IPAM does not treat incomplete ARP probes without a MAC as occupied addresses', () => {
  const report = buildIpamReport({
    cidrs: ['192.168.16.0/29'],
    arp: [{ address: '192.168.16.2', interface: 'bridge-fibra', complete: 'false' }],
  });
  const row = report.rows.find((item) => item.ip === '192.168.16.2');
  assert.equal(row.classification, 'available');
  assert.equal(row.available, true);
  assert.equal(row.availabilityConfidence, 'probe_required');
  assert.deepEqual(row.sources, ['arp_probe']);
  assert.equal(report.stats.arpProbes, 1);
});
