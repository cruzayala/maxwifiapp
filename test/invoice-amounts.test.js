'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { invoiceState, normalizeInvoiceAmounts, normalizeStoredInvoiceAmounts } = require('../lib/invoice-amounts');
const { mapWisphubInvoice } = require('../lib/wisphub-invoices');
const { invoiceSnapshot } = require('../lib/billing-service');

// Facturas tal como las devuelve la API real de WispHub (08/10/2026).
const pendingRaw = { id_factura: 21607, estado: 'Pendiente de Pago', sub_total: 700, descuento: 0, total: 700, total_cobrado: 700, saldo: 0, fecha_pago: '2026-10-01T00:00:00-05:00' };
const paidWithDiscountRaw = { id_factura: 21606, estado: 'Pagada', sub_total: 700, descuento: 200, total: 500, total_cobrado: 500, saldo: 0, fecha_pago: '2026-10-03T14:26:00-05:00' };
const transferredRaw = { id_factura: 21150, estado: 'Se Transfirió', sub_total: 1000, total: 1000, total_cobrado: 1000, saldo: 0 };

test('WispHub states are classified, including the accented "Se Transfirió"', () => {
  assert.equal(invoiceState('Pendiente de Pago'), 'pending');
  assert.equal(invoiceState('Pagada'), 'paid');
  assert.equal(invoiceState('Cancelada'), 'closed');
  assert.equal(invoiceState('Se Transfirió'), 'closed');
  assert.equal(invoiceState('Se Transfirio'), 'closed');
  assert.equal(invoiceState(null), 'unknown');
});

test('a pending invoice owes its full total even though WispHub says cobrado = total and saldo = 0', () => {
  const mapped = mapWisphubInvoice(pendingRaw);
  assert.equal(mapped.saldo, 700);
  assert.equal(mapped.totalCobrado, 0);
});

test('a paid invoice with a discount counts what was actually charged and owes nothing', () => {
  const mapped = mapWisphubInvoice(paidWithDiscountRaw);
  assert.equal(mapped.saldo, 0);
  assert.equal(mapped.totalCobrado, 500);
});

test('cancelled and transferred invoices neither owe nor count as collected', () => {
  const mapped = mapWisphubInvoice(transferredRaw);
  assert.equal(mapped.saldo, 0);
  assert.equal(mapped.totalCobrado, 0);
  assert.deepEqual(normalizeInvoiceAmounts({ estado: 'Cancelada', total: 1400, totalCobrado: 1400, saldo: 700 }), { saldo: 0, totalCobrado: 0 });
});

test('partial payments on a pending invoice keep what is still owed', () => {
  // Coherente: cobrado + saldo = total.
  assert.deepEqual(normalizeInvoiceAmounts({ estado: 'Pendiente de Pago', total: 100, totalCobrado: 40, saldo: 60 }), { saldo: 60, totalCobrado: 40 });
  // Sin saldo pero con un cobrado menor al total.
  assert.deepEqual(normalizeInvoiceAmounts({ estado: 'Pendiente de Pago', total: 900.1, totalCobrado: 0.05, saldo: 0 }), { saldo: 900.05, totalCobrado: 0.05 });
  // El patron real de WispHub (cobrado = total, saldo 0) debe todo.
  assert.deepEqual(normalizeInvoiceAmounts({ estado: 'Pendiente de Pago', total: 700, totalCobrado: 700, saldo: 0 }), { saldo: 700, totalCobrado: 0 });
});

test('without a known state the original values are kept', () => {
  assert.deepEqual(normalizeInvoiceAmounts({ estado: '', total: 100, totalCobrado: 40, saldo: 60 }), { saldo: 60, totalCobrado: 40 });
});

test('invoices already stored with the old meaning are corrected once, on a real SQLite', async () => {
  const { PrismaClient } = require('@prisma/client');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ispmax-invoices-'));
  const file = path.join(dir, 'i.db');
  const url = 'file:' + file.replaceAll('\\', '/');
  fs.closeSync(fs.openSync(file, 'wx'));
  const push = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(push.status, 0, push.stderr);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.invoice.createMany({ data: [
      { idFactura: 1, clienteNombre: 'A', estado: 'Pendiente de Pago', total: 700, totalCobrado: 700, saldo: 0 },
      { idFactura: 2, clienteNombre: 'A', estado: 'Pagada', total: 500, totalCobrado: 500, saldo: 0 },
      { idFactura: 3, clienteNombre: 'A', estado: 'Se Transfirió', total: 1000, totalCobrado: 1000, saldo: 0 },
      { idFactura: 4, clienteNombre: 'A', estado: 'Cancelada', total: 1400, totalCobrado: 1400, saldo: 700 },
      { idFactura: 5, clienteNombre: 'A', estado: 'Pagada', total: 900, totalCobrado: 900, saldo: 200 },
    ] });
    assert.deepEqual(await normalizeStoredInvoiceAmounts(prisma), { pending: 1, closed: 2, paid: 1 });
    const rows = Object.fromEntries((await prisma.invoice.findMany()).map((row) => [row.idFactura, [row.saldo, row.totalCobrado]]));
    assert.deepEqual(rows, { 1: [700, 0], 2: [0, 500], 3: [0, 0], 4: [0, 0], 5: [0, 900] });
    // Segunda vez: ya esta todo bien y no toca nada.
    assert.deepEqual(await normalizeStoredInvoiceAmounts(prisma), { pending: 0, closed: 0, paid: 0 });
  } finally {
    await prisma.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the payment form gets the real balance from a live WispHub invoice', () => {
  const pending = invoiceSnapshot(pendingRaw, 21607);
  assert.equal(pending.balance, 700);
  assert.equal(pending.collected, 0);
  const paid = invoiceSnapshot(paidWithDiscountRaw, 21606);
  assert.equal(paid.balance, 0);
  assert.equal(paid.collected, 500);
});
