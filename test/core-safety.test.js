const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  inspectPaymentPortalConfiguration,
  isOriginAllowed,
  mapWisphubClient,
  parseAllowedOrigins,
  resolveSqliteDatabasePath,
  sanitizePaymentPilotToggle,
  wisphubTaskState,
} = require('../lib/core-safety');

test('CORS normalizes and restricts configured origins', () => {
  const origins = parseAllowedOrigins('https://isp.example.com/, https://ops.example.com', [
    'http://localhost:4200',
    undefined,
  ]);
  assert.equal(isOriginAllowed(undefined, origins), true);
  assert.equal(isOriginAllowed('https://isp.example.com', origins), true);
  assert.equal(isOriginAllowed('https://attacker.example', origins), false);
});

test('SQLite backup path follows Prisma relative URL semantics', () => {
  const root = path.resolve('temporary-app-root');
  assert.equal(
    resolveSqliteDatabasePath('file:./data.db', root),
    path.resolve(root, 'prisma', 'data.db'),
  );
});

test('sync preserves MikroTik fields when the router is unavailable', () => {
  const data = mapWisphubClient({ id_servicio: 10, nombre: 'Cliente', ip: '10.0.0.10' }, {
    mikrotikAvailable: false,
  });
  assert.equal(Object.hasOwn(data, 'mtQueueName'), false);
  assert.equal(Object.hasOwn(data, 'mtMacAddress'), false);
});

test('sync clears stale MikroTik fields only after a successful router read', () => {
  const data = mapWisphubClient({ id_servicio: 10, nombre: 'Cliente', ip: '10.0.0.10' }, {
    mikrotikAvailable: true,
  });
  assert.equal(data.mtQueueName, null);
  assert.equal(data.mtMacAddress, null);
  assert.ok(data.mtSyncedAt instanceof Date);
});

test('client sync only updates fields that WispHub actually returned', () => {
  const update = mapWisphubClient({ id_servicio: 10, estado: 'Activo' });
  assert.equal(update.estado, 'Activo');
  assert.equal(Object.hasOwn(update, 'nombre'), false);
  assert.equal(Object.hasOwn(update, 'telefono'), false);
  assert.equal(Object.hasOwn(update, 'planInternetId'), false);
});

test('client sync respects explicit remote clears without touching local-only fields', () => {
  const update = mapWisphubClient({
    id_servicio: 10,
    telefono: null,
    plan_internet: null,
  });
  assert.equal(update.telefono, null);
  assert.equal(update.planInternetId, null);
  assert.equal(update.planInternetName, null);
  assert.equal(Object.hasOwn(update, 'aliasNombre'), false);
  assert.equal(Object.hasOwn(update, 'gpsLat'), false);
  assert.equal(Object.hasOwn(update, 'paymentPilotEnabled'), false);
});

test('new clients still receive the required SQLite name fallback', () => {
  const create = mapWisphubClient({ id_servicio: 11 }, {}, { forCreate: true });
  assert.equal(create.nombre, 'Sin nombre');
});

test('WispHub task parser distinguishes success, pending, and failure', () => {
  assert.equal(wisphubTaskState({ task: { status: 'SUCCESS', result: { ok: true } } }).state, 'success');
  assert.equal(wisphubTaskState({ task: { status: 'PENDING' } }).state, 'pending');
  assert.equal(wisphubTaskState({ task: { status: 'FAILURE', error: 'fallo' } }).state, 'failure');
  assert.equal(wisphubTaskState({ task: { status: 'SUCCESS', result: { errores: 'rechazado' } } }).state, 'failure');
  assert.equal(wisphubTaskState({ task: { status: 'SUCCESS', result: { agregar: true, errores: [] } } }).state, 'success');
});

test('payment portal pilot requires an explicit transition confirmation', () => {
  assert.deepEqual(sanitizePaymentPilotToggle({ enabled: true, confirmation: 'HABILITAR PORTAL' }), { enabled: true });
  assert.deepEqual(sanitizePaymentPilotToggle({ enabled: false, confirmation: 'deshabilitar portal' }), { enabled: false });
  assert.throws(() => sanitizePaymentPilotToggle({ enabled: true }), /Confirmacion requerida/);
  assert.throws(() => sanitizePaymentPilotToggle({ enabled: 'true', confirmation: 'HABILITAR PORTAL' }), /true o false/);
});

test('payment portal rejects placeholder accounts and support numbers', () => {
  const incomplete = inspectPaymentPortalConfiguration({
    businessName: 'MaxWifi',
    bankInfo: 'Banco: XXXXXX|Transferencia: 829-XXX-XXXX',
    supportPhone: '829-XXX-XXXX',
  });
  assert.equal(incomplete.ready, false);
  assert.deepEqual(incomplete.paymentMethods, []);

  const ready = inspectPaymentPortalConfiguration({
    businessName: 'MaxWifi',
    bankInfo: 'Banco BHD: 1234567890 - MaxWifi SRL',
    supportPhone: '8295551234',
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.paymentMethods.length, 1);
});
