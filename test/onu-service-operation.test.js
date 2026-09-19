'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareExistingServiceOperation, operationCompletion } = require('../lib/onu-service-operation');

const client = { idServicio: 1024, nombre: 'Cliente prueba', ip: '192.168.16.8', snOnu: 'HWTC12345678', zonaId: 4, planInternetId: 7 };
const onu = { serial: 'HWTC12345678', onuIndex: '1/1/13:8' };

test('restaurar la misma ONU conserva cliente, IP, facturas y MikroTik', () => {
  const result = prepareExistingServiceOperation({ mode: 'restore_same_onu', client, currentOnu: onu, detectedSerial: 'HWTC12345678' });
  assert.equal(result.ip, client.ip);
  assert.equal(result.previousOnuIndex, onu.onuIndex);
  assert.deepEqual(Object.values(result.preserved), [true, true, true, true, true]);
  assert.deepEqual(operationCompletion(result.mode), { status: 'complete', stage: 'service_restored', cutoverStatus: 'not_required' });
});

test('un serial distinto obliga a usar reemplazo', () => {
  assert.throws(() => prepareExistingServiceOperation({ mode: 'restore_same_onu', client, currentOnu: onu, detectedSerial: 'HWTC99999999' }), /Use Cambiar ONU/);
});

test('reemplazo rechaza reutilizar el serial anterior', () => {
  assert.throws(() => prepareExistingServiceOperation({ mode: 'replace_onu', client, currentOnu: onu, detectedSerial: onu.serial }), /Use Restaurar misma ONU/);
});

test('migracion conserva serial y requiere PON de destino', () => {
  assert.throws(() => prepareExistingServiceOperation({ mode: 'migrate_pon', client, currentOnu: onu, detectedSerial: onu.serial }), /PON de destino/);
  const result = prepareExistingServiceOperation({ mode: 'migrate_pon', client, currentOnu: onu, detectedSerial: onu.serial, targetPonIndex: '1/1/14' });
  assert.equal(result.targetPonIndex, '1/1/14');
  assert.equal(operationCompletion(result.mode).status, 'waiting_optical');
});

test('migracion exige otro PON y un indice con formato valido', () => {
  assert.throws(() => prepareExistingServiceOperation({ mode: 'migrate_pon', client, currentOnu: onu, detectedSerial: onu.serial, targetPonIndex: 'gpon_olt-1/1/14' }), /formato/);
  assert.throws(() => prepareExistingServiceOperation({ mode: 'migrate_pon', client, currentOnu: onu, detectedSerial: onu.serial, targetPonIndex: '1/1/13' }), /diferente/);
});
