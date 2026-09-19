'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { startQa } = require('../scripts/mobile-qa-server');
const { createBillingService, validatePayment, invoiceSnapshot } = require('../lib/billing-service');
let qa, sequence = 11000;
before(async () => { qa = await startQa(); });
after(async () => { await qa?.close(); });
async function fixture(behavior = 'success') {
  const id = ++sequence;
  await qa.prisma.invoice.create({ data: { idFactura: id, clienteIdServicio: 301, clienteNombre: 'Ana QA', total: 100, subTotal: 100, saldo: 100 } });
  const invoice = { id_factura: id, total: 100, total_cobrado: 0, saldo: 100, estado: 'Pendiente de Pago' };
  let calls = 0, taskState = 'PENDING';
  const adapter = { invoice: async () => ({ ...invoice }), task: async () => ({ status: taskState }), submit: async () => {
    calls++;
    if (behavior === 'lost') throw new Error('secret-provider-payload');
    if (behavior === 'pending') return { task_id: 'test-task' };
    if (behavior === 'reject') return { status: 'FAILURE' };
    if (behavior !== 'mismatch') { invoice.total_cobrado = 40; invoice.saldo = 60; }
    return { status: 'SUCCESS' };
  } };
  const service = createBillingService({ prisma: qa.prisma, adapter });
  const request = { invoiceId: id, userId: 1, requestKey: randomUUID(), body: { amount: 40, paymentMethodId: 1, paidAt: new Date().toISOString(), invoiceVersion: invoiceSnapshot(invoice, id).version } };
  return { service, request, invoice, adapter, calls: () => calls, task: status => { taskState = status; } };
}
test('validates money, real calendar date, timezone and invoice version', () => {
  const body = { amount: '40.20', paymentMethodId: 1, paidAt: '2026-01-01T12:00:00Z', invoiceVersion: 'a'.repeat(64) };
  assert.equal(validatePayment(body).amount, 40.2);
  for (const patch of [{ amount: 0 }, { amount: -1 }, { amount: '1.999' }, { paymentMethodId: '1' }, { paidAt: '2026-02-30T12:00:00Z' }, { paidAt: '2026-13-01T12:00:00Z' }, { paidAt: '2026-01-01' }, { invoiceVersion: '' }, { arbitrary: true }]) assert.throws(() => validatePayment({ ...body, ...patch }), e => e.status >= 400);
});
test('confirmed payment requires provider and invoice readback; same key never sends twice after restart', async () => {
  const f = await fixture();
  const result = await f.service.submit(f.request);
  assert.equal(result.state, 'confirmed'); assert.equal(result.localLogSaved, true);
  const restarted = createBillingService({ prisma: qa.prisma, adapter: f.adapter });
  assert.equal((await restarted.submit(f.request)).id, result.id);
  assert.equal((await restarted.reconcile(result.id)).paymentLogId, result.paymentLogId);
  assert.equal(f.calls(), 1);
  assert.equal(await qa.prisma.paymentLog.count({ where: { idFactura: f.request.invoiceId } }), 1);
  await assert.rejects(restarted.submit({ ...f.request, body: { ...f.request.body, amount: 20 } }), e => e.code === 'IDEMPOTENCY_CONFLICT');
});
test('lost provider response persists uncertainty and invoice lock across users without replay', async () => {
  const f = await fixture('lost'); const result = await f.service.submit(f.request);
  assert.equal(result.state, 'uncertain'); assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes('secret-provider'), false);
  assert.equal((await f.service.options(f.request.invoiceId)).activeOperation.id, result.id);
  const restarted = createBillingService({ prisma: qa.prisma, adapter: f.adapter });
  await restarted.submit(f.request); await restarted.reconcile(result.id);
  await assert.rejects(restarted.submit({ ...f.request, requestKey: randomUUID(), userId: 2 }), e => e.code === 'PAYMENT_IN_PROGRESS');
  assert.equal(f.calls(), 1); assert.equal(await qa.prisma.paymentLog.count({ where: { idFactura: f.request.invoiceId } }), 0);
});
test('pending task and confirmed external remain pending until invoice reflects the payment', async () => {
  const f = await fixture('pending'); const result = await f.service.submit(f.request);
  assert.equal(result.state, 'pending');
  f.task('SUCCESS'); assert.equal((await f.service.reconcile(result.id)).state, 'confirmed_external');
  f.invoice.total_cobrado = 40; f.invoice.saldo = 60;
  assert.equal((await f.service.reconcile(result.id)).state, 'confirmed'); assert.equal(f.calls(), 1);
});
test('rejected task releases lock only with unchanged invoice, never creates a successful payment', async () => {
  const f = await fixture('reject'); const result = await f.service.submit(f.request);
  assert.equal(result.state, 'rejected'); assert.equal(result.canVerify, false);
  assert.equal((await f.service.options(f.request.invoiceId)).activeOperation, null);
  assert.equal(await qa.prisma.paymentLog.count({ where: { idFactura: f.request.invoiceId } }), 0);
});
test('stale invoice, invalid method and excess amount stop before external submission', async () => {
  const f = await fixture();
  for (const body of [{ ...f.request.body, invoiceVersion: 'b'.repeat(64) }, { ...f.request.body, amount: 101 }, { ...f.request.body, paymentMethodId: 999 }]) await assert.rejects(f.service.submit({ ...f.request, body }));
  assert.equal(f.calls(), 0);
});
test('concurrent submissions for one invoice have one provider winner', async () => {
  const f = await fixture('pending');
  const results = await Promise.allSettled([f.service.submit(f.request), f.service.submit({ ...f.request, requestKey: randomUUID(), userId: 2 })]);
  assert.ok(results.some(r => r.status === 'fulfilled')); assert.equal(f.calls(), 1);
  assert.equal(await qa.prisma.billingOperation.count({ where: { activeInvoiceId: f.request.invoiceId } }), 1);
});
test('local receipt failure after provider confirmation remains recoverable without another charge', async () => {
  const f = await fixture();
  const failingPrisma = new Proxy(qa.prisma, { get(target, property) {
    if (property !== '$transaction') return Reflect.get(target, property);
    return callback => target.$transaction(tx => callback(new Proxy(tx, { get(inner, name) {
      if (name === 'paymentLog') return { create: async () => { throw new Error('SQLite write fixture failure'); } };
      return Reflect.get(inner, name);
    } })));
  } });
  const failing = createBillingService({ prisma: failingPrisma, adapter: f.adapter });
  await assert.rejects(failing.submit(f.request), /SQLite write fixture/);
  const active = (await f.service.options(f.request.invoiceId)).activeOperation;
  assert.equal(active.state, 'confirmed_external'); assert.equal(active.localLogSaved, false);
  assert.equal((await f.service.reconcile(active.id)).state, 'confirmed'); assert.equal(f.calls(), 1);
});
test('external success with mismatched invoice amounts never reports success', async () => {
  const f = await fixture('mismatch');
  const result = await f.service.submit(f.request);
  assert.equal(result.ok, false); assert.equal(result.state, 'confirmed_external');
  assert.equal(await qa.prisma.paymentLog.count({ where: { idFactura: f.request.invoiceId } }), 0);
});
test('concurrent verification retains one local receipt', async () => {
  const f = await fixture('pending'); const op = await f.service.submit(f.request);
  f.task('SUCCESS'); f.invoice.total_cobrado = 40; f.invoice.saldo = 60;
  await Promise.allSettled([f.service.reconcile(op.id), f.service.reconcile(op.id)]);
  assert.equal((await f.service.reconcile(op.id)).state, 'confirmed');
  assert.equal(await qa.prisma.paymentLog.count({ where: { idFactura: f.request.invoiceId } }), 1);
});
