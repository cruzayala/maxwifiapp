'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  inferPlanBandwidth,
  matchesExistingWisphubClient,
  sanitizeClientProvisioning,
  taskResultError,
} = require('../lib/client-provisioning');

test('client provisioning validates network and converts Mbps for MikroTik', () => {
  const input = sanitizeClientProvisioning({
    zoneId: 1109,
    planId: 200241,
    serviceName: 'Cliente Nuevo',
    ip: '192.168.16.170',
    uploadMbps: 10,
    downloadMbps: 10,
    phone: '809-555-0101',
  });
  assert.equal(input.queue.targetIp, '192.168.16.170');
  assert.equal(input.queue.uploadBps, 10_000_000);
  assert.equal(input.profile.phone, '809-555-0101');
});

test('client provisioning rejects IPs outside customer ranges', () => {
  assert.throws(() => sanitizeClientProvisioning({
    zoneId: 1, planId: 2, serviceName: 'Invalid', ip: '8.8.8.8', uploadMbps: 5, downloadMbps: 5,
  }), /rangos de clientes/);
});

test('existing WispHub client must match IP, name, plan and zone for a safe retry', () => {
  const input = { ip: '192.168.16.170', serviceName: 'Maria Perez', planId: 20, zoneId: 10 };
  const existing = {
    ip: input.ip,
    usuario_rb: '  Maria   Perez ',
    plan_internet: { id: 20 },
    zona: { id: 10 },
  };
  assert.equal(matchesExistingWisphubClient(existing, input), true);
  assert.equal(matchesExistingWisphubClient({ ...existing, plan_internet: { id: 21 } }, input), false);
});

test('WispHub task result does not accept agregar false', () => {
  assert.match(taskResultError({ agregar: false, errores: 'IP repetida' }), /IP repetida/);
  assert.match(taskResultError({ agregar: false, errores: [] }), /no agrego/);
  assert.equal(taskResultError({ agregar: true }), null);
  assert.equal(taskResultError({ agregar: true, errores: [] }), null);
});

test('plan bandwidth inference supports Mbps and legacy Kbps names', () => {
  assert.deepEqual(inferPlanBandwidth('10M | 10M Fibra'), { uploadMbps: 10, downloadMbps: 10 });
  assert.deepEqual(inferPlanBandwidth('3300k/3300k'), { uploadMbps: 3.3, downloadMbps: 3.3 });
  assert.deepEqual(inferPlanBandwidth('15 |15 FInra'), { uploadMbps: 15, downloadMbps: 15 });
});
