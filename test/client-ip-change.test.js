'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { changeClientIp, normalizeClientIp } = require('../lib/client-ip-change');

function world({ ip = '192.168.16.40', queues = [{ id: '*A1', name: 'max wifi 4', target: '192.168.16.40' }], owners = {}, failQueue = false, wisphubIgnores = false } = {}) {
  const state = { ip, queues: queues.map((q) => ({ ...q })), local: ip, calls: [] };
  const deps = {
    readService: async () => ({ ip: state.ip }),
    writeServiceIp: async (_id, value) => { state.calls.push(`wisphub:${value}`); if (!wisphubIgnores) state.ip = value; },
    localOwner: async (value, exceptId) => owners[value] && owners[value].idServicio !== exceptId ? owners[value] : null,
    findQueue: async (value) => { const q = state.queues.find((item) => item.target === value); return q ? { id: q.id, name: q.name } : null; },
    retargetQueue: async (id, value) => { state.calls.push(`mikrotik:${value}`); if (failQueue) throw new Error('timeout'); state.queues.find((q) => q.id === id).target = value; },
    saveLocal: async (_id, value) => { state.calls.push(`local:${value}`); state.local = value; },
  };
  return { state, deps };
}

test('the IP changes in WispHub, the MikroTik queue moves with it and ISP Max is updated', async () => {
  const { state, deps } = world();
  const result = await changeClientIp({ idServicio: 1046, ip: ' 192.168.16.41 ', deps });
  assert.equal(result.ip, '192.168.16.41');
  assert.equal(result.mikrotik, 'moved');
  assert.equal(state.ip, '192.168.16.41');
  assert.equal(state.queues[0].target, '192.168.16.41');
  assert.equal(state.local, '192.168.16.41');
});

test('an IP used by another client or another queue is refused before touching anything', async () => {
  const taken = world({ owners: { '192.168.16.41': { idServicio: 7, nombre: 'Ana Gomez' } } });
  await assert.rejects(changeClientIp({ idServicio: 1046, ip: '192.168.16.41', deps: taken.deps }), { code: 'IP_IN_USE', message: /Ana Gomez/ });
  assert.deepEqual(taken.state.calls, []);
  const queued = world({ queues: [{ id: '*A1', name: 'max wifi 4', target: '192.168.16.40' }, { id: '*B2', name: 'otro', target: '192.168.16.41' }] });
  await assert.rejects(changeClientIp({ idServicio: 1046, ip: '192.168.16.41', deps: queued.deps }), { code: 'IP_IN_USE', message: /otro/ });
  assert.deepEqual(queued.state.calls, []);
});

test('if the MikroTik fails, WispHub goes back to the previous IP', async () => {
  const { state, deps } = world({ failQueue: true });
  await assert.rejects(changeClientIp({ idServicio: 1046, ip: '192.168.16.41', deps }), { code: 'MIKROTIK_IP_FAILED' });
  assert.equal(state.ip, '192.168.16.40');
  assert.equal(state.local, '192.168.16.40');
});

test('when WispHub does not confirm, the MikroTik is not touched', async () => {
  const { state, deps } = world({ wisphubIgnores: true });
  await assert.rejects(changeClientIp({ idServicio: 1046, ip: '192.168.16.41', deps }), { code: 'WISPHUB_NOT_CONFIRMED' });
  assert.ok(!state.calls.some((call) => call.startsWith('mikrotik')));
});

test('a client deleted in WispHub is reported clearly', async () => {
  const { state, deps } = world();
  deps.readService = async () => { throw Object.assign(new Error('No encontrado.'), { statusCode: 404 }); };
  await assert.rejects(changeClientIp({ idServicio: 850, ip: '192.168.16.41', deps }), { code: 'CLIENT_NOT_IN_WISPHUB' });
  assert.deepEqual(state.calls, []);
});

test('invalid or reserved addresses are refused', () => {
  for (const bad of ['', '192.168.16', '192.168.16.256', '10.0.0.0', '192.168.16.255', '127.0.0.1', 'abc']) assert.throws(() => normalizeClientIp(bad));
  assert.equal(normalizeClientIp('192.168.16.41'), '192.168.16.41');
});
