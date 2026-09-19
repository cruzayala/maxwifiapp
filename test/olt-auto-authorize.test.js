'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAgentAutoAuthorization, selectSpeedProfile } = require('../lib/olt-auto-authorize');

const serial = 'HWTC9EC8CEAF';
const inventory = {
  identity: { serial }, device: { model: 'EG8141A5' }, errors: {},
  wan: [{ service: 'INTERNET', ip_address: '192.168.16.173', vlan_id: 101 }],
};

test('auto authorization requires an exact ONU Studio chain', () => {
  const result = evaluateAgentAutoAuthorization({
    pending: { active: true, serial, firstSeenAt: new Date(Date.now() - 60_000) },
    job: {
      source: 'onu_studio', mode: 'new_client', status: 'in_progress', serial,
      clientIdServicio: 1021, ip: '192.168.16.173', vlan: 101,
      agentInventoryPhase: 'post_provision', agentVersion: '1.4.0',
    },
    inventory,
    client: { idServicio: 1021, ip: '192.168.16.173' },
  });
  assert.equal(result.eligible, true);
});

test('ONU Studio can auto authorize a validated replacement without creating another client', () => {
  const result = evaluateAgentAutoAuthorization({
    pending: { active: true, serial, firstSeenAt: new Date(Date.now() - 60_000) },
    job: {
      source: 'onu_studio', mode: 'replace_onu', status: 'waiting_optical', serial,
      previousSerial: 'HWTC11111111', previousOnuIndex: '1/1/13:8',
      clientIdServicio: 1021, ip: '192.168.16.173', vlan: 101,
      agentInventoryPhase: 'post_provision', agentVersion: '1.7.0',
    },
    inventory,
    client: { idServicio: 1021, ip: '192.168.16.173' },
  });
  assert.equal(result.eligible, true);
});

test('ONU Studio can transfer the same offline ONU to its approved destination PON', () => {
  const result = evaluateAgentAutoAuthorization({
    pending: { active: true, serial, ponIndex: '1/1/14', firstSeenAt: new Date(Date.now() - 60_000) },
    job: {
      source: 'onu_studio', mode: 'migrate_pon', status: 'waiting_optical', serial,
      previousSerial: serial, previousOnuIndex: '1/1/13:8', targetPonIndex: '1/1/14',
      clientIdServicio: 1021, ip: '192.168.16.173', vlan: 101,
      agentInventoryPhase: 'post_provision', agentVersion: '1.10.12',
    },
    previousOnu: { onuIndex: '1/1/13:8', serial, online: false, clientIdServicio: 1021 },
    inventory,
    client: { idServicio: 1021, ip: '192.168.16.173' },
  });
  assert.equal(result.eligible, true);
});

test('PON migration never authorizes on an unapproved port or while the old ONU is online', () => {
  const base = {
    pending: { active: true, serial, ponIndex: '1/1/15', firstSeenAt: new Date(Date.now() - 60_000) },
    job: {
      source: 'onu_studio', mode: 'migrate_pon', status: 'waiting_optical', serial,
      previousSerial: serial, previousOnuIndex: '1/1/13:8', targetPonIndex: '1/1/14',
      clientIdServicio: 1021, ip: '192.168.16.173', vlan: 101,
      agentInventoryPhase: 'post_provision', agentVersion: '1.10.12',
    },
    previousOnu: { onuIndex: '1/1/13:8', serial, online: true, clientIdServicio: 1021 },
    inventory,
    client: { idServicio: 1021, ip: '192.168.16.173' },
  };
  const result = evaluateAgentAutoAuthorization(base);
  assert.equal(result.eligible, false);
  assert.match(result.reasons.join(' '), /todavia figura en linea/);
  assert.match(result.reasons.join(' '), /PON de destino aprobado/);
});

test('manual jobs and mismatched WAN data never auto authorize', () => {
  const result = evaluateAgentAutoAuthorization({
    pending: { active: true, serial, firstSeenAt: new Date(Date.now() - 60_000) },
    job: {
      source: 'manual', mode: 'new_client', status: 'in_progress', serial,
      clientIdServicio: 1021, ip: '192.168.16.173', vlan: 101,
      agentInventoryPhase: 'post_provision', agentVersion: '1.4.0',
    },
    inventory: { ...inventory, wan: [{ service: 'INTERNET', ip_address: '192.168.16.99', vlan_id: 101 }] },
    client: { idServicio: 1021, ip: '192.168.16.173' },
  });
  assert.equal(result.eligible, false);
  assert.match(result.reasons.join(' '), /ONU Studio/);
  assert.match(result.reasons.join(' '), /IP no coincide/);
});

test('bridge authorization validates serial and VLAN without requiring an IP', () => {
  const now = Date.now();
  const result = evaluateAgentAutoAuthorization({
    pending: { serial: 'ZXIC12345678', active: true, firstSeenAt: new Date(now - 60_000) },
    job: { serial: 'ZXIC12345678', source: 'onu_studio', mode: 'new_client', serviceMode: 'bridge', status: 'waiting_optical', clientIdServicio: 10, vlan: 101, ip: null, agentInventoryPhase: 'post_provision', agentVersion: '1.11.0' },
    client: { idServicio: 10, ip: '192.168.16.30' },
    inventory: { identity: { serial: 'ZXIC12345678' }, device: { model: 'F670L' }, wan: [{ vlan_id: 101, service: 'INTERNET' }], errors: {} },
    now,
  });
  assert.equal(result.eligible, true, result.reasons.join(', '));
});

test('selects the smallest OLT profile that can carry the commercial speed', () => {
  const profiles = [{ name: 'ADMINOLT-100-MEGAS-UP' }, { name: 'ADMINOLT-25-MEGAS-UP' }];
  assert.equal(selectSpeedProfile(profiles, 5, 'up'), 'ADMINOLT-25-MEGAS-UP');
  assert.equal(selectSpeedProfile(profiles, 80, 'up'), 'ADMINOLT-100-MEGAS-UP');
  assert.equal(selectSpeedProfile([
    { name: 'ADMINOLT-IPTV-IPTV-10M-DOWN' },
    { name: 'ADMINOLT-25-MEGAS-DOWN' },
    { name: 'ADMINOLT-1G-UP-DOWN' },
  ], 5, 'down'), 'ADMINOLT-25-MEGAS-DOWN');
  assert.equal(selectSpeedProfile([{ name: 'ADMINOLT-1G-UP-DOWN' }], 500, 'down'), 'ADMINOLT-1G-UP-DOWN');
});
