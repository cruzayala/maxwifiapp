'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planMacAutoLinks, normalizeMac } = require('../lib/olt-mac-autolink');

const clients = [
  { idServicio: 1, nombre: 'Juan Carlos 2', ip: '192.168.16.120' },
  { idServicio: 2, nombre: 'Crisbel Rosa', ip: '192.168.16.121', mtMacAddress: 'D0:EF:C1:00:00:02' },
  { idServicio: 3, nombre: 'Marlyn', ip: '192.168.16.122' },
];
const arpRows = [
  { address: '192.168.16.120', 'mac-address': 'AA:AA:AA:00:00:01' },
  { address: '192.168.16.122', 'mac-address': 'AA:AA:AA:00:00:03' },
  { address: '192.168.16.199', 'mac-address': 'AA:AA:AA:00:00:09', complete: 'false' },
];

test('the MAC behind the ONU leads to its client through the MikroTik ARP', () => {
  const plan = planMacAutoLinks({ onuMacs: [{ onuIndex: '1/1/1:6', macs: ['aaaa.aa00.0001'] }], arpRows, clients, linkedClientIds: [] });
  assert.deepEqual(plan.links, [{ onuIndex: '1/1/1:6', mac: 'AA:AA:AA:00:00:01', ip: '192.168.16.120', client: { idServicio: 1, nombre: 'Juan Carlos 2', ip: '192.168.16.120' } }]);
});

test('a MAC saved on the client also identifies it without ARP', () => {
  const plan = planMacAutoLinks({ onuMacs: [{ onuIndex: '1/1/1:2', macs: ['D0-EF-C1-00-00-02'] }], arpRows, clients, linkedClientIds: [] });
  assert.equal(plan.links[0].client.idServicio, 2);
});

test('it never links when the evidence is doubtful', () => {
  const plan = planMacAutoLinks({
    onuMacs: [
      { onuIndex: '1/1/1:1', macs: [] },                                             // sin MAC
      { onuIndex: '1/1/1:2', macs: ['AA:AA:AA:00:00:09'] },                          // ARP incompleto
      { onuIndex: '1/1/1:3', macs: ['AA:AA:AA:00:00:01', 'AA:AA:AA:00:00:03'] },     // dos clientes detras
      { onuIndex: '1/1/1:4', macs: ['AA:AA:AA:00:00:03'] },                          // cliente ya asociado
    ],
    arpRows, clients, linkedClientIds: [3],
  });
  assert.deepEqual(plan.links, []);
  assert.deepEqual(plan.skipped.map((row) => row.reason), ['no_mac', 'no_client', 'several_clients', 'client_already_linked']);
});

test('two ONUs pointing to the same client are both left for review', () => {
  const plan = planMacAutoLinks({
    onuMacs: [{ onuIndex: '1/1/2:1', macs: ['AA:AA:AA:00:00:01'] }, { onuIndex: '1/1/2:2', macs: ['AA:AA:AA:00:00:01'] }],
    arpRows, clients, linkedClientIds: [],
  });
  assert.deepEqual(plan.links, []);
  assert.deepEqual(plan.skipped.map((row) => row.reason), ['client_on_several_onus', 'client_on_several_onus']);
});

test('MAC formats from the OLT and MikroTik are normalized', () => {
  assert.equal(normalizeMac('d0ef.c116.567c'), 'D0:EF:C1:16:56:7C');
  assert.equal(normalizeMac('D0-EF-C1-16-56-7C'), 'D0:EF:C1:16:56:7C');
  assert.equal(normalizeMac('nope'), null);
});
