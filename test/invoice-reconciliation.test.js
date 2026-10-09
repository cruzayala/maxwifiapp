'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { reconcilePendingInvoices, MISSING_STATE } = require('../lib/invoice-reconciliation');
const { saveWisphubInvoices } = require('../lib/wisphub-invoices');

const notFound = () => Object.assign(new Error('WispHub factura: No encontrado.'), { code: 'WISPHUB_NOT_FOUND' });
const down = () => Object.assign(new Error('WispHub factura: WispHub está caído (521)'), { code: 'WISPHUB_DOWN' });

function remote(id, estado, extra = {}) {
  return {
    id_factura: id, estado, total: 700, sub_total: 700, total_cobrado: 700, saldo: 0,
    fecha_emision: '2026-06-01', fecha_pago: '2026-09-11T20:32:00-05:00',
    cliente: { nombre: 'Ana Gomez' }, articulos: [{ id: id * 10, cantidad: 1, descripcion: 'Internet', precio: '700', servicio: { id_servicio: 9 } }],
    ...extra,
  };
}

async function database() {
  const { PrismaClient } = require('@prisma/client');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ispmax-reconcile-'));
  const file = path.join(dir, 'r.db');
  const url = 'file:' + file.replaceAll('\\', '/');
  fs.closeSync(fs.openSync(file, 'wx'));
  const push = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(push.status, 0, push.stderr);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.client.create({ data: { idServicio: 9, nombre: 'Ana Gomez' } });
  const pendingRow = (idFactura) => ({ idFactura, clienteIdServicio: 9, clienteNombre: 'Ana Gomez', estado: 'Pendiente de Pago', total: 700, subTotal: 700, saldo: 700, totalCobrado: 0, fechaEmision: '2026-06-01' });
  await prisma.invoice.createMany({ data: [1, 2, 3, 4, 5].map(pendingRow).concat({ ...pendingRow(6), estado: 'Pagada', saldo: 0, totalCobrado: 700 }) });
  return { prisma, close: async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('pending invoices are checked one by one: paid, transferred and deleted ones stop counting as debt', async () => {
  const { prisma, close } = await database();
  try {
    const calls = {};
    const answers = {
      1: () => remote(1, 'Pagada'),
      2: () => remote(2, 'Se Transfirió', { fecha_pago: '2026-06-01T00:00:00-05:00' }),
      3: () => { throw notFound(); },
      4: () => remote(4, 'Pendiente de Pago'),
      // Un 404 pasajero: al confirmar, la factura si existe.
      5: () => { if (calls[5] === 1) throw notFound(); return remote(5, 'Pendiente de Pago'); },
    };
    const fetchInvoice = async (id) => { calls[id] = (calls[id] || 0) + 1; return answers[id](); };
    const result = await reconcilePendingInvoices({ prisma, fetchInvoice, save: (list) => saveWisphubInvoices(prisma, list), gapMs: 0 });

    assert.equal(result.checked, 5, 'invoices already paid locally are not asked again');
    assert.equal(calls[6], undefined);
    assert.deepEqual(result.missingIds, [3]);
    assert.equal(result.markedMissing, 1);
    assert.deepEqual(result.changed, { Pagada: 1, 'Se Transfirió': 1, [MISSING_STATE]: 1 });
    assert.equal(calls[3], 2, 'a 404 is confirmed twice before marking');

    const rows = Object.fromEntries((await prisma.invoice.findMany()).map((row) => [row.idFactura, row]));
    assert.equal(rows[1].estado, 'Pagada'); assert.equal(rows[1].saldo, 0); assert.equal(rows[1].totalCobrado, 700);
    assert.equal(rows[1].clienteIdServicio, 9, 'the invoice keeps its client');
    assert.equal(rows[2].estado, 'Se Transfirió'); assert.equal(rows[2].saldo, 0); assert.equal(rows[2].totalCobrado, 0);
    assert.equal(rows[3].estado, MISSING_STATE); assert.equal(rows[3].saldo, 0);
    assert.ok(rows[3], 'nothing is deleted');
    assert.equal(rows[4].estado, 'Pendiente de Pago'); assert.equal(rows[4].saldo, 700, 'a real pending invoice keeps its full debt');
    assert.equal(rows[5].estado, 'Pendiente de Pago');

    // Si la factura reaparece en WispHub, la sincronizacion normal la devuelve a su estado.
    await saveWisphubInvoices(prisma, [remote(3, 'Pendiente de Pago')]);
    const back = await prisma.invoice.findUnique({ where: { idFactura: 3 } });
    assert.equal(back.estado, 'Pendiente de Pago'); assert.equal(back.saldo, 700);
  } finally {
    await close();
  }
});

test('when WispHub goes down halfway nothing is marked as deleted and the rest waits for the next pass', async () => {
  const { prisma, close } = await database();
  try {
    let n = 0;
    const fetchInvoice = async (id) => {
      n++;
      if (id === 1) throw notFound();
      throw down();
    };
    const result = await reconcilePendingInvoices({ prisma, fetchInvoice, save: (list) => saveWisphubInvoices(prisma, list), gapMs: 0, maxConsecutiveFailures: 3 });
    assert.match(result.aborted, /caído/);
    assert.equal(result.markedMissing, 0, 'a 404 seen just before an outage is not trusted');
    assert.equal(n, 4, 'it stops after three failures in a row');
    assert.equal(await prisma.invoice.count({ where: { estado: 'Pendiente de Pago' } }), 5);
  } finally {
    await close();
  }
});
