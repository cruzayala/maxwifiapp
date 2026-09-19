const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decryptSecret,
  encryptSecret,
  selectBestTr069Onu,
  snapshotDto,
  tr069SerialCandidates,
  validateTaskInput,
} = require('../lib/tr069-control');

test('converts the OLT vendor prefix to the TR-069 hexadecimal serial', () => {
  assert.deepEqual(
    tr069SerialCandidates('HWTC26D9D8AF'),
    ['HWTC26D9D8AF', '4857544326D9D8AF'],
  );
  assert.ok(tr069SerialCandidates('4857544326D9D8AF').includes('HWTC26D9D8AF'));
});

test('prefers the active OMCI record when a serial remains on old PON ports', () => {
  const selected = selectBestTr069Onu([
    { onuIndex: '1/1/13:1', online: false, phaseState: 'OffLine', omccState: 'disable', updatedAt: '2026-08-14T12:00:00Z' },
    { onuIndex: '1/1/4:1', online: false, phaseState: 'not-seen', omccState: 'disable', updatedAt: '2026-08-14T13:00:00Z' },
    { onuIndex: '1/1/11:18', online: true, phaseState: 'working', omccState: 'enable', updatedAt: '2026-08-14T11:00:00Z' },
  ]);
  assert.equal(selected.onuIndex, '1/1/11:18');
});

test('validates WiFi tasks without exposing the password in public payload', () => {
  const result = validateTaskInput('set_wifi', {
    ssid: 'Casa Maximo', password: 'clave-segura', enabled: true, broadcast: true, channel: 11,
  }, 'HWTC26D9D8AF');
  assert.deepEqual(result.payload, {
    ssid: 'Casa Maximo', enabled: true, broadcast: true, channel: 11, passwordChanged: true,
  });
  assert.deepEqual(result.secret, { password: 'clave-segura' });
  assert.equal(JSON.stringify(result.payload).includes('clave-segura'), false);
});

test('requires the exact ONU serial for reboot confirmation', () => {
  assert.throws(
    () => validateTaskInput('reboot', { confirmation: 'REINICIAR' }, 'HWTC26D9D8AF'),
    /REINICIAR HWTC26D9D8AF/,
  );
  assert.equal(
    validateTaskInput('reboot', { confirmation: 'reiniciar hwtc26d9d8af' }, 'HWTC26D9D8AF').action,
    'reboot',
  );
});

test('encrypts protected task data with authentication', () => {
  const key = 'test-key-with-at-least-thirty-two-characters';
  const encrypted = encryptSecret({ password: 'never-plain' }, key);
  assert.equal(encrypted.includes('never-plain'), false);
  assert.deepEqual(decryptSecret(encrypted, key), { password: 'never-plain' });
  assert.throws(() => decryptSecret(encrypted, `${key}-wrong`));
});

test('normalizes snapshots to the safe fields accepted by Railway', () => {
  const snapshot = snapshotDto({
    deviceId: 'acs-1', online: true, wifi: { ssid: 'Casa', enabled: true, channel: '6', password: 'hidden' },
    wan: { ip: '192.168.16.8', vlan: '101', password: 'hidden' },
  });
  assert.equal(snapshot.deviceId, 'acs-1');
  assert.equal(snapshot.wifi.ssid, 'Casa');
  assert.equal(snapshot.wifi.channel, 6);
  assert.equal(snapshot.wan.ip, '192.168.16.8');
  assert.equal(snapshot.wan.vlan, 101);
  assert.deepEqual(snapshot.fiber, {
    status: null, rxPower: null, txPower: null, temperature: null, voltage: null,
    biasCurrent: null, fecErrors: null, hecErrors: null, dropPackets: null,
    bytesReceived: null, bytesSent: null,
  });
  assert.match(snapshot.collectedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('validates advanced reversible TR-069 actions with typed values', () => {
  const lan = validateTaskInput('set_lan_port', { port: 2, enabled: true, speed: 'Auto', duplex: 'Full' }, 'HWTC26D9D8AF');
  assert.equal(lan.payload.port, 2);
  assert.equal(lan.definition.risk, 'change');
  const ping = validateTaskInput('run_ping', { host: '8.8.8.8', repetitions: 4, timeout: 10000 }, 'HWTC26D9D8AF');
  assert.equal(ping.payload.host, '8.8.8.8');
  assert.equal(ping.definition.risk, 'diagnostic');
});

test('rejects invalid network values before they reach the agent', () => {
  assert.throws(() => validateTaskInput('set_dhcp', { minAddress: 'not-an-ip' }, 'HWTC26D9D8AF'), /IP inicial invalida/);
  assert.throws(() => validateTaskInput('set_wan', { confirmation: 'CAMBIAR WAN HWTC26D9D8AF', vlan: 5000 }, 'HWTC26D9D8AF'), /VLAN invalido/);
});

test('protects ACS credentials outside the public task payload', () => {
  const task = validateTaskInput('set_acs', {
    confirmation: 'CAMBIAR ACS HWTC26D9D8AF', acsUrl: 'http://acs.local:7547/',
    username: 'onu-user', password: 'private', connectionRequestPassword: 'also-private',
  }, 'HWTC26D9D8AF');
  assert.equal(JSON.stringify(task.payload).includes('private'), false);
  assert.equal(task.secret.password, 'private');
});
