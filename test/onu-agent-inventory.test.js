'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOnuAgentInventory, summarizeOnuAgentInventory } = require('../lib/onu-agent-inventory');

function sampleInventory() {
  return {
    collected_at: '2026-08-09T12:00:00Z',
    identity: { serial: '485754439EC8CEAF', serial_raw: '485754439EC8CEAF', authentication_mode: 'sn_password' },
    device: { model: 'EG8141A5', hardware_version: '1.0', software_version: 'V5', mac: 'AA:BB:CC:DD:EE:FF', cpu_usage: '12%' },
    optical: { rx_power_dbm: '-19.24 dBm', signal_available: true },
    wan: [{ service: 'INTERNET', ip_address: '192.168.16.245', vlan_id: '101', nat_enabled: true }],
    ethernet: { ports: [{ port: 1, link: 'Up', rx_bytes: '1200' }] },
    wifi: { radios: [{ ssid: 'Cliente', enabled: true }], clients: [{ mac: '11:22:33:44:55:66', signal_dbm: '-48' }] },
  };
}

test('normalizes a full ONU Studio inventory for the shared OLT record', () => {
  const inventory = normalizeOnuAgentInventory(sampleInventory(), 'HWTC9EC8CEAF', { phase: 'post_provision', agentVersion: '1.4.0', host: '192.168.100.1' });
  assert.equal(inventory.identity.serial, 'HWTC9EC8CEAF');
  assert.equal(inventory.optical.rx_power_dbm, -19.24);
  assert.equal(inventory.wan[0].vlan_id, 101);
  assert.equal(inventory.device.cpu_usage, 12);
  assert.equal(inventory.wifi.clients[0].signal_dbm, -48);
  assert.deepEqual(summarizeOnuAgentInventory(inventory), {
    serial: 'HWTC9EC8CEAF', collectedAt: '2026-08-09T12:00:00.000Z', receivedAt: inventory.received_at,
    phase: 'post_provision', agentVersion: '1.4.0', host: '192.168.100.1', model: 'EG8141A5',
    hardwareVersion: '1.0', softwareVersion: 'V5', registrationStatus: null, mac: 'AA:BB:CC:DD:EE:FF',
    rxPowerDbm: -19.24, wanIp: '192.168.16.245', vlan: 101, ssid: 'Cliente', lanPortsUp: 1, wifiClients: 1, partial: false,
  });
});

test('rejects an inventory belonging to another ONU', () => {
  assert.throws(
    () => normalizeOnuAgentInventory(sampleInventory(), 'ZTEG12345678'),
    /no coincide con el expediente/,
  );
});

test('drops unknown and credential-like fields', () => {
  const payload = sampleInventory();
  payload.password = 'secret';
  payload.wifi.radios[0].password = 'secret';
  const inventory = normalizeOnuAgentInventory(payload, 'HWTC9EC8CEAF');
  assert.equal(inventory.password, undefined);
  assert.equal(inventory.wifi.radios[0].password, undefined);
});
