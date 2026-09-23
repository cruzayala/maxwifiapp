'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { enableWal, enableWalWithRetry, isDue, readConfig, runMaintenance, saveResult, maintenanceStatus } = require('../lib/db-maintenance');

const DAY = 86_400_000;

test('maintenance runs the first time and then every interval at the configured hour', () => {
  const config = readConfig({ DB_MAINTENANCE_INTERVAL_DAYS: '15', DB_MAINTENANCE_RUN_HOUR: '3' });
  // 3:10 a.m. en Santo Domingo (UTC-4) son las 07:10 UTC.
  const at3 = new Date('2026-09-30T07:10:00Z');
  assert.equal(isDue(null, at3, config), true);
  assert.equal(isDue(new Date(at3.getTime() - 14 * DAY).toISOString(), at3, config), false);
  assert.equal(isDue(new Date(at3.getTime() - 15 * DAY).toISOString(), at3, config), true);
  // 3:10 UTC son las 11:10 p.m. en Santo Domingo: no corre aunque ya pasaron los dias.
  assert.equal(isDue(new Date(at3.getTime() - 20 * DAY).toISOString(), new Date('2026-09-30T03:10:00Z'), config), false);
});

test('retention settings cannot go below a week', () => {
  const config = readConfig({ DB_KEEP_SYNC_LOG_DAYS: '1', DB_KEEP_OLT_SNAPSHOT_DAYS: '0', DB_MAINTENANCE_INTERVAL_DAYS: '-3' });
  assert.equal(config.syncLogDays, 7);
  assert.equal(config.oltSnapshotDays, 30);
  assert.equal(config.intervalDays, 15);
});

test('maintenance switches SQLite to WAL, prunes only old history and keeps business data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ispmax-maintenance-'));
  const file = path.join(dir, 'm.db');
  const url = 'file:' + file.replaceAll('\\', '/');
  fs.closeSync(fs.openSync(file, 'wx'));
  const push = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(push.status, 0, push.stderr);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const now = new Date('2026-09-23T03:00:00Z');
    const old = new Date(now.getTime() - 200 * DAY);
    const recent = new Date(now.getTime() - 2 * DAY);
    const device = await prisma.tr069Device.create({ data: { serial: 'HWTCMAINT0001' } });
    await prisma.syncLog.createMany({ data: [
      { entity: 'clients', status: 'success', startedAt: old },
      { entity: 'clients', status: 'success', startedAt: recent },
    ] });
    await prisma.oltSnapshot.createMany({ data: [{ status: 'ok', capturedAt: old }, { status: 'ok', capturedAt: recent }] });
    await prisma.oltAlarm.createMany({ data: [
      { alarmId: 'viejo-resuelto', level: 'minor', description: 'x', active: false, lastSeenAt: old },
      { alarmId: 'viejo-activo', level: 'major', description: 'x', active: true, lastSeenAt: old },
      { alarmId: 'reciente', level: 'minor', description: 'x', active: false, lastSeenAt: recent },
    ] });
    await prisma.tr069Telemetry.createMany({ data: [
      { deviceId: device.id, serial: device.serial, collectedAt: old, metricsJson: '{}' },
      { deviceId: device.id, serial: device.serial, collectedAt: recent, metricsJson: '{}' },
    ] });
    await prisma.client.create({ data: { idServicio: 1, nombre: 'Cliente viejo', estado: 'Activo', syncedAt: old } });

    assert.equal(await enableWal(prisma), 'wal');
    const result = await runMaintenance(prisma, { now, config: readConfig({}) });
    await saveResult(prisma, result);

    assert.deepEqual(result.pruned, { syncLog: 1, oltSnapshot: 1, oltAlarm: 1, tr069Telemetry: 1 });
    assert.equal(await prisma.syncLog.count(), 1);
    assert.equal(await prisma.oltSnapshot.count(), 1);
    // Una alarma vieja pero activa nunca se borra.
    assert.deepEqual((await prisma.oltAlarm.findMany({ orderBy: { alarmId: 'asc' } })).map((row) => row.alarmId), ['reciente', 'viejo-activo']);
    assert.equal(await prisma.tr069Telemetry.count(), 1);
    assert.equal(await prisma.client.count(), 1);

    const status = await maintenanceStatus(prisma);
    assert.equal(status.journalMode, 'wal');
    assert.equal(status.last.at, now.toISOString());
    assert.equal(status.nextRunAfter, new Date(now.getTime() + 15 * DAY).toISOString());
  } finally {
    await prisma.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('WAL is retried while SQLite reports the database is locked', async () => {
  let calls = 0;
  const prisma = {
    async $queryRawUnsafe(sql) {
      if (sql.startsWith('PRAGMA journal_mode=WAL')) {
        calls += 1;
        if (calls < 3) throw new Error('database is locked');
        return [{ journal_mode: 'wal' }];
      }
      return [{}];
    },
  };
  assert.equal(await enableWalWithRetry(prisma, { attempts: 5, wait: async () => {} }), 'wal');
  assert.equal(calls, 3);
  await assert.rejects(enableWalWithRetry({ $queryRawUnsafe: async () => { throw new Error('database is locked'); } }, { attempts: 2, wait: async () => {} }), /locked/);
});
