'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MikrotikCommandQueue, isMikrotikMutationCommand } = require('../lib/mikrotik-command-queue');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('MikroTik mutations are detected and prioritized over pending reads', async () => {
  assert.equal(isMikrotikMutationCommand('/queue/simple/set'), true);
  assert.equal(isMikrotikMutationCommand('/queue/simple/print'), false);
  const queue = new MikrotikCommandQueue();
  const order = [];
  const first = queue.enqueue(async () => { await sleep(15); order.push('first'); }, { timeoutMs: 100, label: 'first' });
  const read = queue.enqueue(async () => { order.push('read'); }, { timeoutMs: 100, label: 'read' });
  const mutation = queue.enqueue(async () => { order.push('mutation'); }, { timeoutMs: 100, label: 'mutation', priority: 10 });
  await Promise.all([first, read, mutation]);
  assert.deepEqual(order, ['first', 'mutation', 'read']);
});

test('MikroTik queue recovers after a timed out command', async () => {
  const queue = new MikrotikCommandQueue();
  let reset = 0;
  await assert.rejects(
    queue.enqueue(() => new Promise(() => {}), { timeoutMs: 10, label: 'stuck', onTimeout: async () => { reset += 1; } }),
    (error) => error.code === 'MIKROTIK_TIMEOUT',
  );
  const result = await queue.enqueue(async () => 'ok', { timeoutMs: 100, label: 'next' });
  assert.equal(result, 'ok');
  assert.equal(reset, 1);
  assert.equal(queue.snapshot().timeouts, 1);
});

test('MikroTik queue keeps draining when timeout recovery hangs', async () => {
  const queue = new MikrotikCommandQueue({ recoveryTimeoutMs: 10 });
  await assert.rejects(
    queue.enqueue(() => new Promise(() => {}), {
      timeoutMs: 10,
      label: 'stuck-command',
      onTimeout: () => new Promise(() => {}),
    }),
    (error) => error.code === 'MIKROTIK_TIMEOUT',
  );

  const result = await queue.enqueue(async () => 'recovered', { timeoutMs: 100, label: 'next-command' });
  assert.equal(result, 'recovered');
  assert.equal(queue.snapshot().recoveryTimeouts, 1);
});
