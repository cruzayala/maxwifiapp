'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { createSnapshot, listSnapshots, snapshotPath } = require('../lib/db-snapshots');

test('a daily compressed copy is a working database, and only the last days are kept', async () => {
  const { PrismaClient } = require('@prisma/client');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ispmax-snap-'));
  const file = path.join(dir, 'live.db');
  const url = 'file:' + file.replaceAll('\\', '/');
  fs.closeSync(fs.openSync(file, 'wx'));
  const push = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(push.status, 0, push.stderr);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const backups = path.join(dir, 'backups', 'daily');
  try {
    await prisma.client.create({ data: { idServicio: 1, nombre: 'Ana' } });
    await prisma.clientNote.create({ data: { idServicio: 1, clientName: 'Ana', note: 'Solo existe en ISP Max' } });
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) {
      await createSnapshot(prisma, { dir: backups, date, keep: 3 });
    }
    const rows = await listSnapshots(backups);
    assert.deepEqual(rows.map((row) => row.date), ['2026-10-04', '2026-10-03', '2026-10-02'], 'the oldest copy is pruned');
    assert.deepEqual(fs.readdirSync(backups).sort(), rows.map((row) => row.file).sort(), 'no temporary files are left behind');

    // La copia se descomprime y abre como base: la nota esta adentro.
    const restored = path.join(dir, 'restored.db');
    fs.writeFileSync(restored, zlib.gunzipSync(fs.readFileSync(path.join(backups, rows[0].file))));
    const copy = new PrismaClient({ datasources: { db: { url: 'file:' + restored.replaceAll('\\', '/') } } });
    try {
      const notes = await copy.clientNote.findMany();
      assert.equal(notes[0].note, 'Solo existe en ISP Max');
    } finally {
      await copy.$disconnect();
    }

    assert.equal(snapshotPath(backups, '../live.db'), null, 'only snapshot names can be downloaded');
    assert.equal(snapshotPath(backups, 'ispmax-2026-10-04.db.gz'), path.join(backups, 'ispmax-2026-10-04.db.gz'));
    assert.deepEqual(await listSnapshots(path.join(dir, 'none')), []);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
