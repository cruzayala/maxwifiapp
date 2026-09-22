'use strict';
// Modulos moviles que alcanzan a la web: cola de cobranza, encuestas, prueba de enlace,
// busqueda en el bot y precio tipico por plan.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildCollectionQueue, filterAndSort, isPending, pendingCents, queueOptions, renderMessage } = require('../lib/mobile-collections');
const { startQa } = require('../scripts/mobile-qa-server');

let qa;
before(async () => { qa = await startQa(); });
after(async () => { await qa?.close(); });

async function api(path, { token, method = 'GET', body, key } = {}) {
  const response = await fetch(`${qa.url}/mobile/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
async function login(role = 'admin') {
  const result = await api('/sessions', { method: 'POST', body: { username: `qa-${role}`, password: 'qa-only-12345', deviceName: 'Test Android' } });
  assert.equal(result.status, 201);
  return result.data.accessToken;
}

test('cobranza usa las mismas reglas de factura pendiente que la web', () => {
  assert.equal(isPending({ estado: 'Pendiente de Pago', total: 900, saldo: 900 }), true);
  assert.equal(isPending({ estado: 'Anulada', total: 900, saldo: 900 }), false);
  assert.equal(isPending({ estado: 'Se Transfirió', total: 900, saldo: 900 }), false);
  assert.equal(isPending({ estado: 'Pagada', total: 900, saldo: 0 }), false);
  assert.equal(isPending({ estado: '', total: 900, totalCobrado: 900, fechaPago: '2026-09-02' }), false);
  assert.equal(pendingCents({ estado: 'Pendiente de Pago', total: 900.1, totalCobrado: 0.05, saldo: 0 }), 90005);
  assert.equal(pendingCents({ estado: 'Anulada', total: 900, saldo: 900 }), 0);
});

test('la cola incluye suspendidos, prioriza a quien aun tiene servicio y arma el mensaje real', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const clients = [
    { idServicio: 1, nombre: 'Activo Sin Gestion', estado: 'Activo', estadoFacturas: 'Pendiente de pago', telefono: '8095550001', fechaCorte: '05/09/2026', crmAction: null },
    { idServicio: 2, nombre: 'Suspendido', estado: 'Suspendido', estadoFacturas: 'Pendiente de pago', telefono: '', crmAction: 'block' },
    { idServicio: 3, nombre: 'Al Dia', estado: 'Activo', estadoFacturas: 'Pagadas', crmAction: null },
    { idServicio: 4, nombre: 'Activo Con Aviso', estado: 'Activo', estadoFacturas: 'Pendiente de pago', telefono: '8095550004', crmAction: 'moroso' },
  ];
  const invoices = [
    { idFactura: 10, clienteIdServicio: 1, estado: 'Pendiente de Pago', total: 1200, saldo: 1200, fechaVencimiento: '2026-09-01' },
    { idFactura: 11, clienteIdServicio: 1, estado: 'Anulada', total: 1200, saldo: 1200, fechaVencimiento: '2026-08-01' },
    { idFactura: 20, clienteIdServicio: 2, estado: 'Pendiente de Pago', total: 900, saldo: 900, fechaVencimiento: '2026-08-01' },
    { idFactura: 40, clienteIdServicio: 4, estado: 'Pendiente de Pago', total: 500, saldo: 500, fechaVencimiento: '2026-09-18' },
  ];
  const { items, summary } = buildCollectionQueue({ clients, invoices, template: 'Hola {nombre}: debes RD$ {monto} ({facturas}) hace {dias_vencido} dias', company: 'QA', now });
  assert.equal(items.length, 3, 'el cliente al dia no entra y el suspendido si');
  const first = items.find((item) => item.idServicio === 1);
  assert.equal(first.debtCents, 120000, 'la factura anulada no infla la deuda');
  assert.equal(first.invoiceCount, 1);
  assert.equal(first.overdueDays, 20);
  assert.equal(first.risk, 'alto');
  assert.match(first.message, /^Hola Activo Sin Gestion: debes RD\$ 1,200\.00 \(1\) hace 20 dias$/);
  assert.equal(summary.debtors, 3);
  assert.equal(summary.cut, 1);
  assert.equal(summary.withNotice, 1);
  assert.equal(summary.withService, 2);
  assert.equal(summary.onTimePercent, 33.3, 'la cartera al dia se mide solo entre activos');
  const ordered = filterAndSort(items, {}).map((item) => item.idServicio);
  assert.deepEqual(ordered, [1, 4, 2], 'primero con servicio y sin gestionar; los cortados al final');
  assert.deepEqual(filterAndSort(items, { service: 'suspendido' }).map((item) => item.idServicio), [2]);
  assert.deepEqual(filterAndSort(items, { manage: 'pending' }).map((item) => item.idServicio), [1]);
  assert.deepEqual(filterAndSort(items, { contact: 'without-phone' }).map((item) => item.idServicio), [2]);
  assert.deepEqual(filterAndSort(items, { sort: 'amount' }).map((item) => item.idServicio), [1, 2, 4]);
  assert.throws(() => queueOptions({ sort: 'drop table' }), /invalido/);
  assert.match(renderMessage(null, 'Empresa', { name: 'X', debtCents: 5000, invoiceCount: 1, overdueDays: 2 }), /Empresa/);
});

test('la cola movil de cobranza exige permiso de cobranza y respeta filtros y paginacion', async () => {
  await qa.prisma.client.update({ where: { idServicio: 302 }, data: { estadoFacturas: 'Pendiente de pago' } });
  try {
    for (const role of ['tecnico', 'viewer']) {
      const token = await login(role);
      assert.equal((await api('/collections/queue', { token })).status, 403);
      assert.equal((await api('/me', { token })).data.capabilities.collectionsQueue, false);
    }
    const token = await login('cobranza');
    assert.equal((await api('/me', { token })).data.capabilities.collectionsQueue, true);
    const queue = await api('/collections/queue', { token });
    assert.equal(queue.status, 200);
    const luis = queue.data.items.find((item) => item.idServicio === 302);
    assert.ok(luis, 'el suspendido que debe aparece en la cola');
    assert.equal(luis.serviceKind, 'suspendido');
    assert.equal(luis.debt, 900);
    assert.equal(luis.oldestInvoiceId, 9002);
    assert.equal(typeof luis.message, 'string');
    assert.equal(queue.data.source, 'sqlite');
    assert.ok(queue.data.summary.debt >= 900);
    assert.equal((await api('/collections/queue?service=activo', { token })).data.items.some((item) => item.idServicio === 302), false);
    assert.equal((await api('/collections/queue?q=luis', { token })).data.total, 1);
    assert.equal((await api('/collections/queue?sort=bad', { token })).status, 400);
    assert.equal((await api('/collections/queue?pageSize=500', { token })).status, 400);
  } finally {
    await qa.prisma.client.update({ where: { idServicio: 302 }, data: { estadoFacturas: null } });
  }
});

test('encuestas se consultan con cobranza y la pausa global es solo de admin, idempotente y auditada', async () => {
  await qa.prisma.surveyResponse.createMany({ data: [
    { clientIp: '192.0.2.10', idServicio: 301, status: 'submitted', sentBy: 'qa', fullName: 'Ana Torres' },
    { clientIp: '192.0.2.11', idServicio: 302, status: 'pending', sentBy: 'qa' },
  ] });
  try {
    const tecnico = await login('tecnico');
    assert.equal((await api('/surveys', { token: tecnico })).status, 403);
    const cobranza = await login('cobranza');
    const list = await api('/surveys', { token: cobranza });
    assert.equal(list.status, 200);
    assert.equal(list.data.summary.sent, 2);
    assert.equal(list.data.summary.submitted, 1);
    assert.equal(list.data.summary.responseRate, 50);
    assert.equal(list.data.canManage, false);
    assert.equal((await api('/surveys?status=pending', { token: cobranza })).data.items[0].clientName, 'Luis Rodriguez');
    assert.equal((await api('/surveys?status=bogus', { token: cobranza })).status, 400);
    assert.equal((await api('/surveys/reminders', { token: cobranza, method: 'POST', key: crypto.randomUUID(), body: { paused: true } })).status, 403);

    const admin = await login('admin');
    assert.equal((await api('/surveys/reminders', { token: admin, method: 'POST', body: { paused: true } })).status, 400, 'sin clave de operacion');
    const key = crypto.randomUUID();
    const paused = await api('/surveys/reminders', { token: admin, method: 'POST', key, body: { paused: true } });
    assert.equal(paused.status, 200);
    assert.equal(paused.data.pausedGlobally, true);
    assert.equal((await api('/surveys/reminders', { token: admin, method: 'POST', key, body: { paused: true } })).data.updatedAt, paused.data.updatedAt);
    assert.equal((await api('/surveys/reminders', { token: admin, method: 'POST', key, body: { paused: false } })).status, 409);
    assert.equal((await api('/surveys', { token: admin })).data.reminders.pausedGlobally, true);
    assert.equal(await qa.prisma.activity.count({ where: { action: 'mobile.survey.reminders.pause' } }), 1);
    await api('/surveys/reminders', { token: admin, method: 'POST', key: crypto.randomUUID(), body: { paused: false } });
    assert.equal((await api('/surveys', { token: admin })).data.reminders.pausedGlobally, false);
  } finally {
    await qa.prisma.surveyResponse.deleteMany({ where: { sentBy: 'qa' } });
    await qa.prisma.appSetting.deleteMany({ where: { key: 'survey_reminder_paused' } });
  }
});

test('la prueba de enlace es tecnica, acotada y queda auditada', async () => {
  const cobranza = await login('cobranza');
  assert.equal((await api('/clients/301/link-test', { token: cobranza, method: 'POST', body: {} })).status, 403);
  const token = await login('tecnico');
  assert.equal((await api('/me', { token })).data.capabilities.linkTest, true);
  assert.equal((await api('/clients/301/link-test', { token, method: 'POST', body: { seconds: 60 } })).status, 400);
  const result = await api('/clients/301/link-test', { token, method: 'POST', body: { seconds: 5 } });
  assert.equal(result.status, 200);
  assert.equal(result.data.verified, true);
  assert.equal(result.data.client.idServicio, 301);
  assert.equal(result.data.traffic.seconds, 5);
  assert.equal(result.data.presence.inArp, true);
  assert.equal((await api('/clients/999999/link-test', { token, method: 'POST', body: {} })).status, 404);
  assert.equal(await qa.prisma.activity.count({ where: { action: 'mobile.mikrotik.link_test', entityId: '301' } }), 1);
});

test('el bot busca conversaciones por nombre o numero', async () => {
  await qa.prisma.whatsappLog.createMany({ data: [
    { phone: '18095550101', clientName: 'Ana Torres', idServicio: 301, messageType: 'incoming', message: 'hola', status: 'received' },
    { phone: '18095550202', clientName: 'Luis Rodriguez', idServicio: 302, messageType: 'incoming', message: 'pago', status: 'received' },
  ] });
  try {
    const token = await login('cobranza');
    const all = await api('/whatsapp/bot/conversations', { token });
    assert.ok(all.data.total >= 2);
    const byName = await api('/whatsapp/bot/conversations?q=luis', { token });
    assert.deepEqual(byName.data.items.map((item) => item.idServicio), [302]);
    const byPhone = await api('/whatsapp/bot/conversations?q=' + encodeURIComponent('809-555-0101'), { token });
    assert.deepEqual(byPhone.data.items.map((item) => item.idServicio), [301]);
  } finally {
    await qa.prisma.whatsappLog.deleteMany({ where: { phone: { in: ['18095550101', '18095550202'] } } });
  }
});

test('planes usan el precio que paga la mayoria y marcan lo que conviene revisar', async () => {
  await qa.prisma.client.createMany({ data: [
    { idServicio: 391, nombre: 'Plan QA 1', estado: 'Activo', planInternetName: 'Fibra 50M', precioPlan: '1200' },
    { idServicio: 392, nombre: 'Plan QA 2', estado: 'Activo', planInternetName: 'Fibra 50M', precioPlan: '1000' },
  ] });
  try {
    const token = await login('cobranza');
    const plans = await api('/plans', { token });
    const fibra = plans.data.items.find((plan) => plan.nombre === 'Fibra 50M');
    assert.equal(fibra.typicalPrice, 1200, 'dos de tres pagan 1200');
    assert.deepEqual(fibra.review, ['Clientes pagando montos distintos']);
    assert.equal(fibra.averagePerActive, Math.round((3400 / 3) * 100) / 100);
    assert.ok(plans.data.summary.toReview >= 1);
  } finally {
    await qa.prisma.client.deleteMany({ where: { idServicio: { in: [391, 392] } } });
  }
});
