'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOnuRelocationPlan, buildPendingPonRelocation, selectCanonicalOnuIndexes } = require('../lib/olt-relocation');

const serial = 'HWTC60C98CAF';
const baseInfo = [
  { onuIndex: '1/1/1:18', serial, model: 'HG8545M' },
  { onuIndex: '1/1/13:2', serial, model: 'HG8546M' },
];
const states = [
  { onuIndex: '1/1/1:18', online: true, phaseState: 'working', omccState: 'enable' },
  { onuIndex: '1/1/13:2', online: false, phaseState: 'DyingGasp', omccState: 'disable' },
];

test('relocation cleanup keeps the single online serial location and retires only stale locations', () => {
  const plan = buildOnuRelocationPlan({
    selectedOnuIndex: '1/1/13:2', serial, states, baseInfo,
    dbOnus: [
      { onuIndex: '1/1/1:18', name: 'Francis', clientIdServicio: 1015 },
      { onuIndex: '1/1/13:2', name: 'Francis_old', clientIdServicio: 1015 },
    ],
  });
  assert.equal(plan.allowed, true);
  assert.equal(plan.activeLocation.onuIndex, '1/1/1:18');
  assert.deepEqual(plan.staleLocations.map((row) => row.onuIndex), ['1/1/13:2']);
  assert.equal(plan.identitySource.onuIndex, '1/1/13:2');
  assert.equal(plan.preservedName, 'Francis_old');
  assert.equal(plan.renameRequired, true);
  assert.equal(plan.requiredConfirmation, `LIMPIAR ${serial}`);
});

test('relocation preserves the selected stale identity instead of the accidental active-port name', () => {
  const plan = buildOnuRelocationPlan({
    selectedOnuIndex: '1/1/1:24', serial: 'HWTCD980284B',
    states: [
      { onuIndex: '1/1/1:24', online: false, phaseState: 'LOS', omccState: 'disable' },
      { onuIndex: '1/1/10:11', online: true, phaseState: 'working', omccState: 'enable' },
    ],
    baseInfo: [
      { onuIndex: '1/1/1:24', serial: 'HWTCD980284B', model: 'HG8546M' },
      { onuIndex: '1/1/10:11', serial: 'HWTCD980284B', model: 'HG8546M' },
    ],
    dbOnus: [
      { onuIndex: '1/1/1:24', name: 'BRIH__HIGLEIA' },
      { onuIndex: '1/1/10:11', name: 'Brish_higuero' },
    ],
  });
  assert.equal(plan.allowed, true);
  assert.equal(plan.activeLocation.onuIndex, '1/1/10:11');
  assert.equal(plan.identitySource.onuIndex, '1/1/1:24');
  assert.equal(plan.preservedName, 'BRIH__HIGLEIA');
  assert.equal(plan.renameRequired, true);
});

test('relocation blocks multiple historical identities unless the operator selected one', () => {
  const duplicateBase = [
    { onuIndex: '1/1/1:1', serial, model: 'HG8546M' },
    { onuIndex: '1/1/2:1', serial, model: 'HG8546M' },
    { onuIndex: '1/1/3:1', serial, model: 'HG8546M' },
  ];
  const duplicateStates = [
    { onuIndex: '1/1/1:1', online: true, phaseState: 'working' },
    { onuIndex: '1/1/2:1', online: false, phaseState: 'LOS' },
    { onuIndex: '1/1/3:1', online: false, phaseState: 'DyingGasp' },
  ];
  const plan = buildOnuRelocationPlan({
    selectedOnuIndex: '1/1/1:1', serial, states: duplicateStates, baseInfo: duplicateBase,
    dbOnus: [
      { onuIndex: '1/1/1:1', name: 'Puerto_nuevo' },
      { onuIndex: '1/1/2:1', name: 'Cliente_A' },
      { onuIndex: '1/1/3:1', name: 'Cliente_B' },
    ],
  });
  assert.equal(plan.allowed, false);
  assert.match(plan.reasons.join(' '), /nombres diferentes/);
});

test('relocation cleanup blocks ambiguous, pending and cross-client serials', () => {
  const plan = buildOnuRelocationPlan({
    selectedOnuIndex: '1/1/1:18', serial,
    states: states.map((row) => ({ ...row, online: true })), baseInfo,
    dbOnus: [
      { onuIndex: '1/1/1:18', clientIdServicio: 1015 },
      { onuIndex: '1/1/13:2', clientIdServicio: 999 },
    ],
    unconfigured: [{ ponIndex: '1/1/14', serial }],
  });
  assert.equal(plan.allowed, false);
  assert.match(plan.reasons.join(' '), /mas de una ubicacion en linea/);
  assert.match(plan.reasons.join(' '), /pendiente de autorizacion/);
  assert.match(plan.reasons.join(' '), /clientes diferentes/);
});

test('pending serial on a different PON becomes a safe reauthorization candidate', () => {
  const relocation = buildPendingPonRelocation({
    pending: { serial: 'HWTC12345678', ponIndex: '1/1/4' },
    dbOnus: [{
      onuIndex: '1/1/2:17', serial: 'hwtc12345678', name: 'cliente_uno',
      online: false, clientIdServicio: 501, lastSeenAt: new Date('2026-08-20T10:00:00Z'),
    }],
  });

  assert.equal(relocation.type, 'pon_relocation');
  assert.equal(relocation.allowed, true);
  assert.equal(relocation.previousLocation.onuIndex, '1/1/2:17');
  assert.equal(relocation.targetPonIndex, '1/1/4');
  assert.equal(relocation.clientIdServicio, 501);
});

test('pending PON reauthorization is blocked while the previous location is online', () => {
  const relocation = buildPendingPonRelocation({
    pending: { serial: 'HWTC12345678', ponIndex: '1/1/4' },
    dbOnus: [{ onuIndex: '1/1/2:17', serial: 'HWTC12345678', online: true, clientIdServicio: 501 }],
  });

  assert.equal(relocation.allowed, false);
  assert.match(relocation.reasons.join(' '), /sigue en linea/i);
});

test('pending PON reauthorization is blocked when old identities are ambiguous', () => {
  const relocation = buildPendingPonRelocation({
    pending: { serial: 'HWTC12345678', ponIndex: '1/1/4' },
    dbOnus: [
      { onuIndex: '1/1/2:17', serial: 'HWTC12345678', online: false, clientIdServicio: 501 },
      { onuIndex: '1/1/3:8', serial: 'HWTC12345678', online: false, clientIdServicio: 502 },
    ],
  });

  assert.equal(relocation.allowed, false);
  assert.match(relocation.reasons.join(' '), /clientes diferentes/i);
});

test('canonical serial mapping always selects the online OMCI location', () => {
  const selected = selectCanonicalOnuIndexes(states, baseInfo);
  assert.equal(selected.get(serial), '1/1/1:18');
});
