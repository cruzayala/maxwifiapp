'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchWisphubJson, createOutageTracker } = require('../lib/wisphub-http');

const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const html = (status) => ({ ok: status < 400, status, text: async () => '<!DOCTYPE html><html><title>Sistema Para ISP</title></html>' });
const noSleep = async () => {};

function sequence(...responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
}

test('a passing Cloudflare failure is retried and the sync gets its data', async () => {
  const { calls, fetchImpl } = sequence(html(521), json({ results: [1] }));
  const page = await fetchWisphubJson('https://api.wisphub.io/api/clientes/', { apiKey: 'k', fetchImpl, sleep: noSleep });
  assert.deepEqual(page, { results: [1] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, 'Api-Key k');
  assert.ok(calls[0].options.signal, 'every request carries a time limit');
});

test('a WispHub outage ends in a clear error after the retries, never in a hang', async () => {
  const { calls, fetchImpl } = sequence(html(521), html(524), html(521));
  await assert.rejects(
    fetchWisphubJson('https://api.wisphub.io/api/clientes/', { apiKey: 'k', fetchImpl, sleep: noSleep }),
    (error) => error.code === 'WISPHUB_DOWN' && error.httpStatus === 521 && error.statusCode === 502 && /caído/.test(error.message) && error.attempts === 3,
  );
  assert.equal(calls.length, 3);
});

test('a request that runs out of time is reported as a timeout', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const { fetchImpl } = sequence(timeout, timeout, timeout);
  await assert.rejects(
    fetchWisphubJson('https://api.wisphub.io/api/clientes/', { apiKey: 'k', fetchImpl, sleep: noSleep, timeoutMs: 30_000 }),
    { code: 'WISPHUB_TIMEOUT', message: /30 s/ },
  );
});

test('an HTML page with status 200 is not taken as API data', async () => {
  const { fetchImpl } = sequence(html(200), json({ ok: true }));
  assert.deepEqual(await fetchWisphubJson('https://x', { apiKey: 'k', fetchImpl, sleep: noSleep }), { ok: true });
});

test('a 404 or a rejected key is not retried and never looks like an expired session', async () => {
  const missing = sequence(json({ detail: 'No encontrado.' }, 404));
  await assert.rejects(fetchWisphubJson('https://x', { apiKey: 'k', fetchImpl: missing.fetchImpl, sleep: noSleep }), { code: 'WISPHUB_NOT_FOUND', statusCode: 404 });
  assert.equal(missing.calls.length, 1);
  const denied = sequence(json({ detail: 'Invalid' }, 401));
  await assert.rejects(fetchWisphubJson('https://x', { apiKey: 'k', fetchImpl: denied.fetchImpl, sleep: noSleep }), { code: 'WISPHUB_AUTH', statusCode: 502 });
  assert.equal(denied.calls.length, 1);
});

test('retries wait longer each time', async () => {
  const waits = [];
  const { fetchImpl } = sequence(html(503), html(503), json({}));
  await fetchWisphubJson('https://x', { apiKey: 'k', fetchImpl, retryDelayMs: 1000, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [1000, 2000]);
});

test('while WispHub is down the attempts are spaced out, and a success resets everything', () => {
  let clock = Date.parse('2026-10-08T13:10:00Z');
  const tracker = createOutageTracker({ now: () => clock, baseDelayMs: 60_000, maxDelayMs: 300_000 });
  assert.equal(tracker.shouldWait(), false);
  const gaps = [];
  for (let i = 0; i < 6; i++) {
    tracker.failure(Object.assign(new Error('WispHub está caído (521)'), { code: 'WISPHUB_DOWN', httpStatus: 521 }));
    gaps.push(Date.parse(tracker.snapshot().nextAttemptAt) - clock);
    assert.equal(tracker.shouldWait(), true);
    clock += 30_000;
  }
  assert.deepEqual(gaps, [60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
  const down = tracker.snapshot();
  assert.equal(down.state, 'down');
  assert.equal(down.consecutiveFailures, 6);
  assert.equal(down.since, '2026-10-08T13:10:00.000Z');
  assert.equal(down.lastCode, 'WISPHUB_DOWN');
  assert.equal(down.lastHttpStatus, 521);

  const outage = tracker.success();
  assert.equal(outage.failures, 6);
  assert.equal(outage.until - outage.since, 180_000);
  assert.equal(tracker.snapshot().state, 'ok');
  assert.equal(tracker.shouldWait(), false);
  assert.equal(tracker.success(), null, 'a success without a previous outage reports nothing');
});
