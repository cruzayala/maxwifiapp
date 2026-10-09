'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createOutageTracker } = require('../lib/wisphub-http');
const { recordWisphubOutage, resolveWisphubOutage, WISPHUB_FINGERPRINT } = require('../lib/integration-incidents');

test('a long WispHub outage opens one incident, escalates, and closes itself when WispHub returns', async () => {
  const { PrismaClient } = require('@prisma/client');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ispmax-outage-'));
  const file = path.join(dir, 'o.db');
  const url = 'file:' + file.replaceAll('\\', '/');
  fs.closeSync(fs.openSync(file, 'wx'));
  const push = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(push.status, 0, push.stderr);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    // 9:10 a.m. en Santo Domingo = 13:10 UTC, como la caida del 8 de octubre.
    let clock = Date.parse('2026-10-08T13:10:00Z');
    const tracker = createOutageTracker({ now: () => clock });
    const fail = () => tracker.failure(Object.assign(new Error('WispHub clientes: WispHub esta caido (521)'), { code: 'WISPHUB_DOWN' }));

    fail();
    clock += 5 * 60_000;
    fail();
    assert.equal(await recordWisphubOutage(prisma, tracker.snapshot(), { now: new Date(clock) }), null, 'five minutes is not an incident yet');
    assert.equal(await prisma.networkIncident.count(), 0);

    clock += 6 * 60_000;
    fail();
    assert.equal(await recordWisphubOutage(prisma, tracker.snapshot(), { now: new Date(clock) }), 'created');
    clock += 60 * 60_000;
    fail();
    assert.equal(await recordWisphubOutage(prisma, tracker.snapshot(), { now: new Date(clock) }), 'updated');

    const open = await prisma.networkIncident.findMany({ where: { fingerprint: WISPHUB_FINGERPRINT }, include: { events: true } });
    assert.equal(open.length, 1, 'never a duplicate incident for the same outage');
    assert.equal(open[0].status, 'open');
    assert.equal(open[0].severity, 'critical', 'more than an hour down is critical');
    assert.equal(open[0].category, 'integration_outage');
    assert.equal(open[0].detectedAt.toISOString(), '2026-10-08T13:10:00.000Z', 'the incident starts when WispHub stopped answering');
    assert.match(open[0].description, /caido \(521\)/);
    assert.match(open[0].description, /9:10/);
    assert.equal(open[0].events.length, 1);

    clock += 2 * 60_000;
    const outage = tracker.success();
    assert.equal(await resolveWisphubOutage(prisma, outage, { now: new Date(clock) }), 1);
    const closed = await prisma.networkIncident.findFirst({ where: { fingerprint: WISPHUB_FINGERPRINT }, include: { events: { orderBy: { id: 'asc' } } } });
    assert.equal(closed.status, 'resolved');
    assert.equal(closed.resolvedBy, 'system');
    assert.match(closed.resolutionNote, /tras 73 min sin servicio \(4 intentos fallidos\)/);
    assert.equal(closed.events.at(-1).type, 'auto_resolved');
    assert.equal(await resolveWisphubOutage(prisma, null), 0, 'nothing to close when no incident is open');
  } finally {
    await prisma.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
