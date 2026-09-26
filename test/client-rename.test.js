'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renameClientService, normalizeClientName } = require('../lib/client-rename');

/** WispHub, MikroTik y la base local en memoria, con registro de llamadas. */
function fakeWorld({ name = 'max wifi 4', ip = '192.168.16.40', queue = { id: '*A1', name: 'max wifi 4' }, otherQueues = [], failQueue = false, wisphubIgnores = false } = {}) {
  const state = { usuario_rb: name, ip, queue: queue ? { ...queue } : null, local: name, calls: [] };
  const deps = {
    readService: async () => ({ usuario_rb: state.usuario_rb, ip: state.ip }),
    writeServiceName: async (_id, value) => { state.calls.push(`wisphub:${value}`); if (!wisphubIgnores) state.usuario_rb = value; },
    findQueue: async (target) => (state.queue && target === state.ip ? { ...state.queue } : null),
    queueNameTaken: async (value, exceptId) => otherQueues.some((q) => q.name === value && q.id !== exceptId),
    renameQueue: async (_id, value) => { state.calls.push(`mikrotik:${value}`); if (failQueue) throw new Error('timeout'); state.queue.name = value; },
    saveLocal: async (_id, value) => { state.calls.push(`local:${value}`); state.local = value; },
  };
  return { state, deps };
}

test('rename changes WispHub, the MikroTik queue and ISP Max', async () => {
  const { state, deps } = fakeWorld();
  const result = await renameClientService({ idServicio: 1046, name: '  Juan   Perez ', deps });
  assert.equal(result.name, 'Juan Perez');
  assert.equal(result.wisphub, 'renamed');
  assert.equal(result.mikrotik, 'renamed');
  assert.equal(state.usuario_rb, 'Juan Perez');
  assert.equal(state.queue.name, 'Juan Perez');
  assert.equal(state.local, 'Juan Perez');
});

test('a duplicated queue name stops before touching anything', async () => {
  const { state, deps } = fakeWorld({ otherQueues: [{ id: '*B2', name: 'Juan Perez' }] });
  await assert.rejects(renameClientService({ idServicio: 1046, name: 'Juan Perez', deps }), { code: 'QUEUE_NAME_TAKEN', status: 409 });
  assert.deepEqual(state.calls, []);
});

test('if MikroTik fails, WispHub goes back to the previous name', async () => {
  const { state, deps } = fakeWorld({ failQueue: true });
  await assert.rejects(renameClientService({ idServicio: 1046, name: 'Juan Perez', deps }), { code: 'MIKROTIK_RENAME_FAILED' });
  assert.equal(state.usuario_rb, 'max wifi 4');
  assert.equal(state.local, 'max wifi 4');
  assert.deepEqual(state.calls, ['wisphub:Juan Perez', 'mikrotik:Juan Perez', 'wisphub:max wifi 4']);
});

test('when WispHub does not confirm, MikroTik is not touched', async () => {
  const { state, deps } = fakeWorld({ wisphubIgnores: true });
  await assert.rejects(renameClientService({ idServicio: 1046, name: 'Juan Perez', deps }), { code: 'WISPHUB_NOT_CONFIRMED' });
  assert.equal(state.queue.name, 'max wifi 4');
  assert.ok(!state.calls.some((call) => call.startsWith('mikrotik')));
});

test('a client without a queue is renamed in WispHub and ISP Max', async () => {
  const { state, deps } = fakeWorld({ queue: null });
  const result = await renameClientService({ idServicio: 7, name: 'Ana Gomez', deps });
  assert.equal(result.mikrotik, 'no_queue');
  assert.equal(state.usuario_rb, 'Ana Gomez');
  assert.equal(state.local, 'Ana Gomez');
});

test('a queue left with an old name gets fixed even if WispHub already had the new one', async () => {
  const { state, deps } = fakeWorld({ name: 'Ana Gomez', queue: { id: '*A1', name: 'ana vieja' } });
  const result = await renameClientService({ idServicio: 7, name: 'Ana Gomez', deps });
  assert.equal(result.wisphub, 'unchanged');
  assert.equal(result.mikrotik, 'renamed');
  assert.deepEqual(state.calls, ['mikrotik:Ana Gomez', 'local:Ana Gomez']);
});

test('names are validated before any call', () => {
  assert.throws(() => normalizeClientName(' '), /al menos 2/);
  assert.throws(() => normalizeClientName('x'.repeat(101)), /100/);
  assert.throws(() => normalizeClientName('Ana\u0007'), /no permitidos/);
  assert.equal(normalizeClientName('  Ana \t Gomez '), 'Ana Gomez');
});
