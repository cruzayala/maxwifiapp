const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOltAssociationPlan, normalizeIdentity } = require('../lib/olt-association');

test('normaliza nombres, usuarios y acentos para asociacion OLT', () => {
  assert.equal(normalizeIdentity('María_Estefany'), 'mariaestefany');
  assert.equal(normalizeIdentity('maria-estefany@maxwifird'), 'mariaestefany');
});

test('propone coincidencias exactas por serial y luego por identidad', () => {
  const plan = buildOltAssociationPlan([
    { onuIndex: '1/1/1:1', serial: 'HWTC-001', name: 'Sin_nombre', clientIdServicio: null },
    { onuIndex: '1/1/1:2', serial: 'HWTC002', name: 'Lucia_Mela', clientIdServicio: null },
  ], [
    { idServicio: 10, nombre: 'Cliente serial', usuario: 'cliente@maxwifird', snOnu: 'HWTC001' },
    { idServicio: 11, nombre: 'Lucia Mela', usuario: 'lucia-mela@maxwifird', snOnu: '' },
  ]);

  assert.equal(plan.summary.safeMatches, 2);
  assert.equal(plan.summary.exactSerial, 1);
  assert.equal(plan.summary.exactName, 1);
  assert.equal(plan.requiredConfirmation, 'ASOCIAR 2 ONUS');
});

test('no sobrescribe clientes vinculados ni decide entre dos ONU candidatas', () => {
  const plan = buildOltAssociationPlan([
    { onuIndex: '1/1/1:1', serial: 'A1', name: 'Juan_Carlos', clientIdServicio: 20 },
    { onuIndex: '1/1/1:2', serial: 'A2', name: 'Maria_Petro', clientIdServicio: null },
    { onuIndex: '1/1/1:3', serial: 'A3', name: 'Maria-Petro', clientIdServicio: null },
    { onuIndex: '1/1/1:4', serial: 'A4', name: 'Juan Carlos', clientIdServicio: null },
  ], [
    { idServicio: 20, nombre: 'Juan Carlos', usuario: 'juan-carlos@maxwifird', snOnu: '' },
    { idServicio: 21, nombre: 'Maria Petro', usuario: 'maria-petro@maxwifird', snOnu: '' },
  ]);

  assert.equal(plan.summary.safeMatches, 0);
  assert.equal(plan.summary.conflicts, 3);
  assert.deepEqual(new Set(plan.conflicts.map((item) => item.reason)), new Set(['client_already_linked', 'multiple_onus_for_client']));
});

test('rechaza identidades ambiguas entre varios clientes', () => {
  const plan = buildOltAssociationPlan([
    { onuIndex: '1/1/1:1', serial: 'A1', name: 'La_Casa', clientIdServicio: null },
  ], [
    { idServicio: 30, nombre: 'La Casa', usuario: 'casa-uno@maxwifird', snOnu: '' },
    { idServicio: 31, nombre: 'La Casa', usuario: 'casa-dos@maxwifird', snOnu: '' },
  ]);

  assert.equal(plan.summary.safeMatches, 0);
  assert.equal(plan.conflicts[0].reason, 'ambiguous_client');
});
