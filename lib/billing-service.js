'use strict';

const { createHash } = require('node:crypto');
const { wisphubTaskState } = require('./core-safety');
const fail = (message, status = 400, code = 'INVALID_PAYMENT') => { throw Object.assign(new Error(message), { status, code }); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cents = value => Math.round(Number(value) * 100);
function validatePayment(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['amount', 'paymentMethodId', 'paidAt', 'invoiceVersion'].includes(k))) fail('Datos de pago invalidos.');
  if (!['number', 'string'].includes(typeof body.amount) || !/^\d+(?:\.\d{1,2})?$/.test(String(body.amount)) || Number(body.amount) <= 0 || Number(body.amount) > 1e9) fail('Importe positivo con hasta dos decimales requerido.');
  if (!Number.isSafeInteger(body.paymentMethodId) || body.paymentMethodId <= 0) fail('Selecciona una forma de pago.');
  if (typeof body.paidAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(body.paidAt)) fail('Fecha de pago con zona horaria requerida.');
  const paidAt = new Date(body.paidAt);
  if (!Number.isFinite(paidAt.getTime()) || paidAt < new Date('2000-01-01') || paidAt.getTime() > Date.now() + 300000) fail('Fecha de pago invalida o futura.');
  const day = body.paidAt.slice(0, 10);
  const calendarDate = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== day) fail('Fecha de pago inexistente.');
  if (!/^[a-f0-9]{64}$/.test(body.invoiceVersion || '')) fail('Actualiza la factura antes de cobrar.', 428, 'INVOICE_VERSION_REQUIRED');
  return { amount: Number(body.amount), paymentMethodId: body.paymentMethodId, paidAt: paidAt.toISOString(), invoiceVersion: body.invoiceVersion };
}
function invoiceSnapshot(payload, id) {
  if (Number(payload?.id_factura) !== id || ['saldo', 'total_cobrado', 'total'].some(k => payload[k] == null || payload[k] === '' || !Number.isFinite(Number(payload[k])) || Number(payload[k]) < 0)) fail('WispHub no devolvio importes verificables.', 502, 'INVALID_INVOICE_RESPONSE');
  const row = { id, balance: Number(payload.saldo), collected: Number(payload.total_cobrado), total: Number(payload.total), status: String(payload.estado || '') };
  return { ...row, version: digest(row) };
}
function publicOperation(row) {
  return { id: row.id, invoiceId: row.invoiceId, amount: row.amount, clientName: row.clientName, paymentMethodName: row.paymentMethodName,
    paidAt: row.paidAt, state: row.state, taskId: row.taskId, errorCode: row.errorCode, localLogSaved: !!row.paymentLogId,
    paymentLogId: row.paymentLogId, createdAt: row.createdAt, updatedAt: row.updatedAt,
    ok: row.state === 'confirmed', canVerify: row.state !== 'confirmed' && row.activeInvoiceId != null, retrySubmission: false };
}
function createWisphubBillingAdapter(apiKey, fetchImpl = fetch) {
  async function request(path, body) {
    if (!apiKey) fail('WispHub no está configurado.', 503, 'WISPHUB_UNAVAILABLE');
    const response = await fetchImpl(`https://api.wisphub.io/api/${path}`, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Api-Key ${apiKey}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(body ? 15000 : 10000) });
    const payload = await response.json();
    // An HTTP failure alone does not prove that a submitted payment had no effect.
    if (!response.ok) fail('No se pudo confirmar la respuesta de WispHub.', 502, 'WISPHUB_RESPONSE_ERROR');
    return payload;
  }
  return {
    configured: !!apiKey,
    invoice: id => request(`facturas/${id}/`),
    task: id => request(`tasks/${encodeURIComponent(id)}/`),
    submit: op => {
      const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santo_Domingo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(op.paidAt));
      return request(`facturas/reportar-pago/${op.invoiceId}/`, { forma_pago: op.paymentMethodId, accion: '1', fecha_pago: date, total_cobrado: op.amount });
    },
  };
}
function createBillingService({ prisma, adapter }) {
  async function find(id) {
    const op = await prisma.billingOperation.findUnique({ where: { id } });
    if (!op) fail('Solicitud de pago no encontrada.', 404, 'NOT_FOUND');
    return op;
  }
  async function options(invoiceId) {
    if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) fail('Factura invalida.');
    const local = await prisma.invoice.findUnique({ where: { idFactura: invoiceId } });
    if (!local) fail('Factura no encontrada en ISP Max.', 404, 'NOT_FOUND');
    const active = await prisma.billingOperation.findUnique({ where: { activeInvoiceId: invoiceId } });
    const methods = await prisma.paymentMethod.findMany({ select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } });
    if (active) return { activeOperation: publicOperation(active), methods, clientName: local.clienteNombre, fetchedAt: new Date() };
    const invoice = invoiceSnapshot(await adapter.invoice(invoiceId), invoiceId);
    const last = await prisma.billingOperation.findFirst({ where: { invoiceId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return { invoice, methods, clientName: local.clienteNombre, activeOperation: null, previousOperation: last ? publicOperation(last) : null, fetchedAt: new Date() };
  }
  async function reconcile(id) {
    let op = await find(id);
    if (op.state === 'confirmed' || op.activeInvoiceId == null) return publicOperation(op);
    if (op.taskId && op.state !== 'confirmed_external') {
      let state;
      try { state = wisphubTaskState(await adapter.task(op.taskId)); }
      catch { return publicOperation(op); }
      if (state.state === 'success') {
        await prisma.billingOperation.updateMany({ where: { id, activeInvoiceId: { not: null }, state: { in: ['pending', 'uncertain'] } }, data: { state: 'confirmed_external', errorCode: null } });
        op = await find(id);
      } else if (state.state === 'failure') {
        await prisma.billingOperation.updateMany({ where: { id, state: { in: ['pending', 'uncertain'] } }, data: { state: 'rejected', errorCode: 'WISPHUB_REJECTED' } });
        op = await find(id);
      }
    }
    if (op.state !== 'confirmed_external' && op.state !== 'rejected') return publicOperation(op);
    let invoice;
    try { invoice = invoiceSnapshot(await adapter.invoice(op.invoiceId), op.invoiceId); }
    catch { return publicOperation(op); }
    if (op.state === 'rejected') {
      if (cents(invoice.collected) === cents(op.baselineCollected)) await prisma.billingOperation.updateMany({ where: { id, state: 'rejected' }, data: { activeInvoiceId: null } });
      return publicOperation(await find(id));
    }
    if (cents(invoice.collected) < cents(op.baselineCollected) + cents(op.amount)) return publicOperation(op);
    return prisma.$transaction(async tx => {
      const current = await tx.billingOperation.findUnique({ where: { id } });
      if (current.state === 'confirmed') return publicOperation(current);
      const payment = await tx.paymentLog.create({ data: {
        idFactura: op.invoiceId, idServicio: op.clientId, clientName: op.clientName, amount: op.amount,
        paymentMethodId: op.paymentMethodId, paymentMethodName: op.paymentMethodName, paidAt: op.paidAt,
        success: true, wasRegisteredOnWisphub: true, taskId: op.taskId,
      } });
      const saved = await tx.billingOperation.update({ where: { id }, data: { state: 'confirmed', paymentLogId: payment.id, activeInvoiceId: null, errorCode: null } });
      await tx.activity.create({ data: { action: 'payment_confirmed', entityType: 'invoice', entityId: String(op.invoiceId), details: JSON.stringify({ operationId: id, actorUserId: op.userId, paymentId: payment.id, amount: op.amount }) } });
      return publicOperation(saved);
    });
  }
  async function submit({ invoiceId, body, requestKey, userId }) {
    if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0 || !Number.isSafeInteger(userId) || userId <= 0) fail('Factura o usuario invalido.');
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey || '')) fail('Clave de operacion requerida.', 428, 'IDEMPOTENCY_REQUIRED');
    const data = validatePayment(body);
    const requestHash = digest({ invoiceId, ...data });
    const key = { userId, requestKey };
    const existing = await prisma.billingOperation.findUnique({ where: { userId_requestKey: key } });
    if (existing) {
      if (existing.requestHash !== requestHash) fail('La clave pertenece a otro pago.', 409, 'IDEMPOTENCY_CONFLICT');
      return publicOperation(existing);
    }
    const prepared = await options(invoiceId);
    if (prepared.activeOperation) fail('Esta factura tiene un pago pendiente de verificacion.', 409, 'PAYMENT_IN_PROGRESS');
    if (prepared.invoice.version !== data.invoiceVersion) fail('Los importes cambiaron. Recarga la factura.', 409, 'STALE_INVOICE');
    if (prepared.invoice.status === 'Anulada' || cents(data.amount) > cents(prepared.invoice.balance)) fail('El importe supera el saldo actual o la factura esta anulada.', 409, 'INVALID_BALANCE');
    const method = prepared.methods.find(m => m.id === data.paymentMethodId);
    if (!method) fail('Forma de pago no disponible. Actualiza el catalogo.');
    let op;
    try {
      op = await prisma.$transaction(async tx => {
        const local = await tx.invoice.findUnique({ where: { idFactura: invoiceId } });
        const row = await tx.billingOperation.create({ data: { ...key, requestHash, invoiceId, activeInvoiceId: invoiceId,
          clientId: local.clienteIdServicio, clientName: local.clienteNombre || `Factura #${invoiceId}`, amount: data.amount,
          baselineCollected: prepared.invoice.collected, paymentMethodId: method.id, paymentMethodName: method.nombre, paidAt: new Date(data.paidAt) } });
        await tx.activity.create({ data: { action: 'payment_requested', entityType: 'invoice', entityId: String(invoiceId), details: JSON.stringify({ operationId: row.id, actorUserId: userId, amount: data.amount }) } });
        return row;
      });
    } catch (error) {
      if (['P2002', 'P2034', 'P2028'].includes(error.code)) {
        const same = await prisma.billingOperation.findUnique({ where: { userId_requestKey: key } });
        if (same?.requestHash === requestHash) return publicOperation(same);
        fail('Ya existe una solicitud para esta factura. Consulta su estado.', 409, 'PAYMENT_IN_PROGRESS');
      }
      throw error;
    }
    // Only the transaction winner may submit. A restart never replays this POST.
    try {
      const payload = await adapter.submit(op);
      const taskId = payload?.task_id || payload?.task?.id || null;
      const state = wisphubTaskState(payload);
      if (taskId && (typeof taskId !== 'string' && typeof taskId !== 'number' || String(taskId).length > 200)) throw new Error('Invalid task');
      await prisma.billingOperation.update({ where: { id: op.id }, data: {
        taskId: taskId == null ? null : String(taskId), state: state.state === 'success' ? 'confirmed_external' : taskId ? 'pending' : state.state === 'failure' ? 'rejected' : 'uncertain',
        errorCode: state.state === 'failure' ? 'WISPHUB_REJECTED' : !taskId && state.state !== 'success' ? 'UNCONFIRMED_RESPONSE' : null,
      } });
    } catch {
      // Never persist provider error bodies: they may include sensitive data.
      await prisma.billingOperation.updateMany({ where: { id: op.id, state: 'uncertain' }, data: { errorCode: 'SUBMISSION_UNCERTAIN' } });
    }
    return reconcile(op.id);
  }
  async function request(userId, requestKey) {
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey || '')) fail('Clave invalida.');
    const op = await prisma.billingOperation.findUnique({ where: { userId_requestKey: { userId, requestKey } } });
    if (!op) fail('La solicitud no esta registrada. Puede reenviarse con la misma clave.', 404, 'REQUEST_NOT_FOUND');
    return publicOperation(op);
  }
  return { options, submit, reconcile, request, read: async id => publicOperation(await find(id)) };
}
module.exports = { createBillingService, createWisphubBillingAdapter, validatePayment, invoiceSnapshot };
