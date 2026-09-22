'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { allowed, pagination, positiveId } = require('../lib/mobile-api');
const { startQa } = require('../scripts/mobile-qa-server');
let qa;
before(async () => { qa = await startQa(); });
after(async () => { await qa?.close(); });
async function api(path, { token, method = 'GET', body, key, version } = {}) {
  const response = await fetch(`${qa.url}/mobile/v1${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}), ...(version ? { 'if-match': version } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
async function login(role = 'admin') {
  const result = await api('/sessions', { method: 'POST', body: { username: `qa-${role}`, password: 'qa-only-12345', deviceName: 'Test Android' } });
  assert.equal(result.status, 201); return result.data;
}
test('mobile roles are explicit, never tecnico/cobranza by numeric level', () => {
  assert.equal(allowed('tecnico', ['cobranza']), false);
  assert.equal(allowed('cobranza', ['tecnico']), false);
  assert.equal(allowed('viewer', []), false);
  assert.equal(allowed('admin', ['tecnico']), true);
  assert.equal(allowed('unknown', ['unknown']), false);
});

test('payments enforce finance permissions and persist duplicate protection with live invoice confirmation', async () => {
  const fixture = { idFactura: 9999, clienteIdServicio: 302, clienteNombre: 'Luis Rodriguez', total: 100, subTotal: 100, saldo: 100 };
  await qa.prisma.invoice.create({ data: fixture });
  try {
    for (const role of ['tecnico', 'viewer']) {
      const session = await login(role);
      assert.equal((await api('/invoices/9999/payment-options', { token: session.accessToken })).status, 403);
      assert.equal((await api('/invoices/9999/payments', { token: session.accessToken, method: 'POST', key: crypto.randomUUID(), body: {} })).status, 403);
      assert.equal((await api('/me', { token: session.accessToken })).data.capabilities.paymentsWrite, false);
    }
    const { accessToken: token } = await login('cobranza');
    const options = await api('/invoices/9999/payment-options', { token });
    assert.equal(options.data.invoice.balance, 100);
    const key = crypto.randomUUID();
    const args = { token, method: 'POST', key, body: { amount: 40, paymentMethodId: 1, paidAt: new Date().toISOString(), invoiceVersion: options.data.invoice.version } };
    const result = await api('/invoices/9999/payments', args);
    assert.equal(result.status, 200); assert.equal(result.data.state, 'confirmed');
    assert.equal((await api('/invoices/9999/payments', args)).data.id, result.data.id);
    assert.equal((await api(`/payment-requests/${key}`, { token })).data.id, result.data.id);
    assert.equal((await api(`/payments/${result.data.id}/verify`, { token, method: 'POST' })).data.paymentLogId, result.data.paymentLogId);
    assert.equal(await qa.prisma.paymentLog.count({ where: { idFactura: 9999 } }), 1);
    assert.equal((await api('/invoices/9999/payment-options', { token })).data.invoice.balance, 60);
    const journal = await api('/payments?state=confirmed&q=Luis', { token });
    assert.equal(journal.data.items[0].id, result.data.id);
    assert.equal((await api('/payments?state=open&q=Luis', { token })).data.total, 0);
    assert.equal((await api('/payments?state=bad', { token })).status, 400);
    const viewer = await login('viewer');
    assert.equal((await api('/payments', { token: viewer.accessToken })).status, 403);
  } finally {
    await qa.prisma.billingOperation.deleteMany({ where: { invoiceId: 9999 } });
    await qa.prisma.paymentLog.deleteMany({ where: { idFactura: 9999 } });
    await qa.prisma.invoice.delete({ where: { idFactura: 9999 } });
  }
});

test('client record edits are local, versioned, idempotent and shared with web service', async () => {
  const { accessToken: token } = await login('tecnico');
  const original = await qa.prisma.client.findUnique({ where: { idServicio: 301 } });
  const record = await api('/clients/301/record', { token });
  assert.equal(record.data.scope, 'ispmax_local');
  const args = { token, method: 'PATCH', key: crypto.randomUUID(), version: record.data.version, body: { aliasNombre: 'Ana local QA', aliasTelefono: '8095550011' } };
  const result = await api('/clients/301/record', args);
  assert.equal(result.status, 200);
  assert.equal((await api('/clients/301/record', args)).data.version, result.data.version);
  assert.equal((await api('/clients/301/record', { ...args, key: crypto.randomUUID() })).data.code, 'STALE_CLIENT');
  assert.equal((await api('/clients/301/record', { ...args, body: { ip: '192.0.2.99' } })).status, 400);
  const current = await qa.prisma.client.findUnique({ where: { idServicio: 301 } });
  for (const key of ['nombre', 'ip', 'usuario', 'estado', 'snOnu']) assert.equal(current[key], original[key]);
  const { changeAlias } = require('../lib/client-record-service');
  await qa.prisma.$transaction(tx => changeAlias(tx, { id: 301, data: { aliasNombre: null, aliasTelefono: null }, actor: 'web-test' }));
  assert.equal((await api('/clients/301/record', { ...args, key: crypto.randomUUID(), version: result.data.version })).data.code, 'STALE_CLIENT');
  const viewer = await login('viewer');
  assert.equal((await api('/clients/301/record', { token: viewer.accessToken })).status, 403);
  assert.equal((await api('/clients/301/history', { token })).data.items[0].actor, 'web-test');
  assert.equal(JSON.stringify((await api('/clients/301/history', { token })).data).includes('8095550011'), false);
});

test('external client edits are live, versioned, idempotent, verified and never expose WiFi passwords', async () => {
  const { accessToken: token } = await login('admin');
  const initial = await api('/clients/301/external', { token });
  assert.equal(initial.status, 200);
  assert.equal(initial.data.source, 'wisphub_live');
  assert.equal(initial.data.service.wifiPasswordConfigured, true);
  assert.equal(JSON.stringify(initial.data).includes('qa-secret-must-not-leak'), false);
  assert.equal((await api('/me', { token })).data.capabilities.clientExternalWrite, true);

  const profileKey = crypto.randomUUID();
  const profileArgs = { token, method: 'PATCH', key: profileKey, version: initial.data.version, body: { section: 'profile', changes: { displayName: 'Ana Torres QA', phone: '8095550101' } } };
  const profile = await api('/clients/301/external', profileArgs);
  assert.equal(profile.status, 200);
  assert.equal(profile.data.verified, true);
  assert.deepEqual(profile.data.changedFields, ['displayName', 'phone']);
  assert.equal(profile.data.client.profile.displayName, 'Ana Torres QA');
  assert.equal((await api('/clients/301/external', profileArgs)).data.client.version, profile.data.client.version);
  assert.equal((await api('/clients/301/external', { ...profileArgs, body: { section: 'profile', changes: { displayName: 'Otro' } } })).data.code, 'IDEMPOTENCY_CONFLICT');
  const localProfile = await qa.prisma.client.findUnique({ where: { idServicio: 301 } });
  assert.equal(localProfile.nombre, 'Ana Torres QA'); assert.equal(localProfile.telefono, '8095550101');

  const stale = await api('/clients/301/external', { token, method: 'PATCH', key: crypto.randomUUID(), version: initial.data.version, body: { section: 'profile', changes: { phone: '8095550102' } } });
  assert.equal(stale.status, 409); assert.equal(stale.data.code, 'STALE_EXTERNAL_CLIENT');

  const current = await api('/clients/301/external', { token });
  const service = await api('/clients/301/external', { token, method: 'PATCH', key: crypto.randomUUID(), version: current.data.version, body: { section: 'service', changes: { ip: '192.0.2.20', wifiSsid: 'Ana Nueva', wifiPassword: 'nueva-clave-qa' } } });
  assert.equal(service.status, 200); assert.equal(service.data.verified, true);
  assert.equal(service.data.client.service.ip, '192.0.2.20');
  assert.equal(service.data.client.service.wifiSsid, 'Ana Nueva');
  assert.equal(JSON.stringify(service.data).includes('nueva-clave-qa'), false);
  const localService = await qa.prisma.client.findUnique({ where: { idServicio: 301 } });
  assert.equal(localService.ip, '192.0.2.20'); assert.equal(localService.ssidRouterWifi, 'Ana Nueva');
  assert.equal(localService.passwordSsidWifi, 'MUST-NOT-LEAK');
  assert.equal(await qa.prisma.activity.count({ where: { action: 'mobile.client.external_updated', entityId: '301' } }), 2);

  const ignoredVersion = service.data.client.version;
  const previousUpdate = qa.externalClient.update;
  qa.externalClient.update = async ({ idServicio }) => JSON.parse(JSON.stringify(qa.externalClients.get(idServicio)));
  const ignored = await api('/clients/301/external', { token, method: 'PATCH', key: crypto.randomUUID(), version: ignoredVersion, body: { section: 'service', changes: { ip: '192.0.2.22' } } });
  qa.externalClient.update = previousUpdate;
  assert.equal(ignored.status, 502);
  assert.equal((await qa.prisma.client.findUnique({ where: { idServicio: 301 } })).ip, '192.0.2.20');

  for (const body of [
    { section: 'service', changes: { ip: '999.1.1.1' } },
    { section: 'service', changes: { wifiPassword: 'corta' } },
    { section: 'profile', changes: { unknown: 'x' } },
  ]) assert.equal((await api('/clients/301/external', { token, method: 'PATCH', key: crypto.randomUUID(), version: service.data.client.version, body })).status, 400);
  const technician = await login('tecnico');
  assert.equal((await api('/clients/301/external', { token: technician.accessToken })).status, 403);
});

test('payment promise lifecycle never records payment or changes invoices', async () => {
  const { accessToken: token } = await login('cobranza');
  const beforeInvoices = await qa.prisma.invoice.findMany();
  const beforePayments = await qa.prisma.paymentLog.count();
  const body = { idServicio: 302, amount: '450.50', promisedDate: '2026-09-10', notes: 'Compromiso QA' };
  const args = { token, method: 'POST', key: crypto.randomUUID(), body };
  const created = await api('/promises', args);
  assert.equal(created.status, 201);
  assert.equal(created.data.clientName, 'Luis Rodriguez');
  assert.equal((await api('/promises', args)).data.id, created.data.id);
  assert.equal((await api('/promises', { ...args, body: { ...body, amount: '20' } })).data.code, 'IDEMPOTENCY_CONFLICT');
  const id = created.data.id;
  const edit = { token, method: 'PATCH', key: crypto.randomUUID(), version: created.data.version, body: { status: 'paid' } };
  const fulfilled = await api(`/promises/${id}`, edit);
  assert.equal(fulfilled.status, 200);
  assert.ok(fulfilled.data.completedAt);
  assert.equal((await api(`/promises/${id}`, edit)).data.version, fulfilled.data.version);
  assert.equal((await api(`/promises/${id}`, { ...edit, key: crypto.randomUUID() })).data.code, 'STALE_PROMISE');
  assert.equal((await api(`/promises/${id}`, { ...edit, body: { idServicio: 301 } })).status, 400);
  const reopened = await api(`/promises/${id}`, { ...edit, key: crypto.randomUUID(), version: fulfilled.data.version, body: { status: 'pending' } });
  assert.equal(reopened.data.completedAt, null);
  assert.equal((await api('/promises?clientId=302&status=pending', { token })).data.total, 1);
  assert.deepEqual(await qa.prisma.invoice.findMany(), beforeInvoices);
  assert.equal(await qa.prisma.paymentLog.count(), beforePayments);
  for (const role of ['tecnico', 'viewer']) {
    const session = await login(role);
    assert.equal((await api('/promises', { token: session.accessToken })).status, 403);
    assert.equal((await api('/promises', { ...args, token: session.accessToken })).status, 403);
    if (role === 'tecnico') assert.equal((await api('/clients/302/history', { token: session.accessToken })).data.items.some(e => e.action.startsWith('payment_')), false);
  }
  for (const patch of [{ promisedDate: '2026-02-30' }, { amount: '-1' }, { amount: '1.234' }, { amount: null }, { reminderSent: true }, { clientName: 'Otro' }]) {
    assert.equal((await api('/promises', { ...args, key: crypto.randomUUID(), body: { ...body, ...patch } })).status, 400);
  }
  await qa.prisma.paymentPromise.delete({ where: { id } });
});

test('mobile client and invoice filters use complete filtered totals and strict calendar dates', async () => {
  const { accessToken: token } = await login('cobranza');
  assert.equal((await api('/clients?zone=Sector%20QA', { token })).data.total, 2);
  assert.equal((await api('/clients?plan=Fibra%2050M', { token })).data.total, 1);
  assert.equal((await api('/clients?missingIp=true', { token })).data.total, 0);
  const result = await api('/invoices?from=2026-09-01&to=2026-09-01&pageSize=1', { token });
  assert.equal(result.status, 200);
  assert.equal(result.data.items.length, 1);
  assert.equal(result.data.total, 2);
  assert.deepEqual(result.data.summary, { billed: 2100, collected: 1200, balance: 900 });
  assert.equal((await api('/invoices?dateField=due&from=2026-09-06&to=2026-09-06', { token })).data.total, 2);
  assert.equal((await api('/invoices?from=2026-09-02&to=2026-09-01', { token })).status, 400);
  assert.equal((await api('/invoices?from=2026-02-30', { token })).status, 400);
  assert.equal((await api('/invoices?dateField=__proto__', { token })).status, 400);
});

test('mobile exports read complete filtered sets from SQLite and enforce finance permissions', async () => {
  const { accessToken: token } = await login('cobranza');
  const clients = await api('/exports/clients?zone=Sector%20QA', { token });
  assert.equal(clients.status, 200);
  assert.equal(clients.data.source, 'sqlite');
  assert.equal(clients.data.total, 2);
  assert.equal(clients.data.items.length, clients.data.total);
  const invoices = await api('/exports/invoices?from=2026-09-01&to=2026-09-01', { token });
  assert.equal(invoices.status, 200);
  assert.equal(invoices.data.total, 2);
  assert.equal(invoices.data.items.length, invoices.data.total);
  const technician = await login('tecnico');
  assert.equal((await api('/exports/invoices', { token: technician.accessToken })).status, 403);
  assert.equal((await api('/exports/unknown', { token })).status, 404);
});

test('billing report compares invoice cohorts, fills empty months and protects financial access', async () => {
  const { accessToken: token } = await login('cobranza');
  const result = await api('/reports/billing?month=2026-09&months=3', { token });
  assert.equal(result.status, 200);
  assert.equal(result.data.items.length, 3);
  assert.deepEqual(result.data.items.map(r => r.month), ['2026-07', '2026-08', '2026-09']);
  assert.equal(result.data.current.billed, 2100);
  assert.equal(result.data.current.collected, 1200);
  assert.equal(result.data.billedChangePercent, null);
  assert.equal(result.data.basis, 'invoice_issue_month');
  const t = await login('tecnico');
  assert.equal((await api('/reports/billing', { token: t.accessToken })).status, 403);
  for (const query of ['months=100000', 'months=-1', 'month=2026-99', 'month=NaN']) assert.equal((await api(`/reports/billing?${query}`, { token })).status, 400);
});
test('pagination and ids are bounded', () => {
  assert.equal(pagination({ page: '2', pageSize: '30' }).skip, 30);
  for (const query of [{ page: -1 }, { pageSize: 1000 }, { page: 'x' }, { page: 1.1 }]) assert.throws(() => pagination(query));
  assert.throws(() => positiveId('1x'));
});
test('login, refresh rotation, no token stored in plaintext and revoke', async () => {
  const session = await login();
  const stored = await qa.prisma.mobileSession.findUnique({ where: { id: session.sessionId } });
  assert.notEqual(stored.accessHash, session.accessToken);
  assert.equal(JSON.stringify(stored).includes(session.refreshToken), false);
  const refresh = await api('/sessions/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } });
  assert.equal(refresh.status, 200);
  assert.notEqual(refresh.data.refreshToken, session.refreshToken);
  assert.equal((await api('/sessions/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } })).status, 401);
  assert.equal((await api('/me', { token: session.accessToken })).status, 401);
  assert.equal((await api('/me', { token: refresh.data.accessToken })).status, 200);
  assert.equal((await api('/sessions/current', { method: 'DELETE', token: refresh.data.accessToken })).status, 200);
  assert.equal((await api('/me', { token: refresh.data.accessToken })).status, 401);
});
test('password change and inactive user revoke access immediately', async () => {
  const session = await login('viewer');
  await qa.prisma.user.update({ where: { username: 'qa-viewer' }, data: { isActive: false } });
  assert.equal((await api('/me', { token: session.accessToken })).status, 401);
  await qa.prisma.user.update({ where: { username: 'qa-viewer' }, data: { isActive: true } });
  const user = await qa.prisma.user.findUnique({ where: { username: 'qa-viewer' } });
  await qa.prisma.user.update({ where: { id: user.id }, data: { passwordHash: 'different' } });
  assert.equal((await api('/sessions/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } })).status, 401);
  await qa.prisma.user.update({ where: { id: user.id }, data: { passwordHash: user.passwordHash } });
});
test('client pagination, filters, detail and cache projections exclude credentials', async () => {
  const { accessToken: token } = await login();
  const list = await api('/clients?pageSize=1', { token });
  assert.equal(list.data.items.length, 1); assert.equal(list.data.total, 3); assert.equal(list.data.hasMore, true);
  assert.equal((await api('/clients?q=192.0.2.11', { token })).data.items[0].idServicio, 302);
  assert.equal((await api('/clients?status=Activo', { token })).data.total, 2);
  assert.equal((await api('/clients?pageSize=999', { token })).status, 400);
  const detail = await api('/clients/301', { token });
  assert.equal(detail.status, 200); assert.equal(JSON.stringify(detail.data).includes('MUST-NOT-LEAK'), false);
  assert.equal((await api('/clients/999', { token })).status, 404);
});
test('technical users cannot access invoices and finance users cannot access network', async () => {
  const t = await login('tecnico'), c = await login('cobranza');
  assert.equal((await api('/invoices', { token: t.accessToken })).status, 403);
  assert.equal((await api('/catalog/onus', { token: c.accessToken })).status, 403);
  assert.equal((await api('/overview', { token: t.accessToken })).data.billing, undefined);
  assert.equal((await api('/overview', { token: c.accessToken })).data.wan, undefined);
});
test('pending invoices and per-client filters do not mix portfolios', async () => {
  const { accessToken: token } = await login();
  assert.equal((await api('/invoices?pending=true', { token })).data.total, 1);
  assert.equal((await api('/invoices?clientId=301&pending=true', { token })).data.total, 0);
  assert.equal((await api('/invoices?clientId=301', { token })).data.items[0].idFactura, 9001);
});
test('note retries commit exactly once with durable receipt and audit', async () => {
  const { accessToken: token } = await login('tecnico');
  const key = crypto.randomUUID();
  const args = { token, key, method: 'POST', body: { note: 'Revision local de prueba' } };
  const first = await api('/clients/301/notes', args);
  assert.equal(first.status, 201);
  const second = await api('/clients/301/notes', args);
  assert.equal(first.data.id, second.data.id);
  assert.equal(await qa.prisma.clientNote.count(), 1);
  assert.equal(await qa.prisma.activity.count({ where: { action: 'mobile.client.note' } }), 1);
  assert.equal((await api('/clients/301/notes', { ...args, body: { note: 'Otra nota' } })).status, 409);
  assert.equal((await api('/clients/999/notes', { ...args, key: crypto.randomUUID() })).status, 404);
});
test('catalog allowlist and admin-only sessions', async () => {
  const { accessToken: token } = await login();
  for (const name of ['plans', 'tickets', 'onus', 'incidents', 'inventory', 'expenses', 'payroll']) assert.equal((await api(`/catalog/${name}`, { token })).status, 200, name);
  assert.equal((await api('/catalog/tickets', { token })).data.items[0].asunto, 'Revision de potencia');
  assert.equal((await api('/catalog/constructor', { token })).status, 404);
  const viewer = await login('viewer');
  assert.equal((await api('/sessions', { token: viewer.accessToken })).status, 403);
  const sessions = await api('/sessions', { token });
  assert.equal(sessions.status, 200);
  assert.equal(JSON.stringify(sessions.data).includes('Hash'), false);
});
test('invoice documents use shared templates and role checks', async () => {
  const { accessToken: token } = await login('cobranza');
  for (const paper of ['A4', '58mm', '80mm']) {
    const result = await api(`/invoices/9001/document?paper=${paper}`, { token });
    assert.equal(result.status, 200);
    assert.match(result.data.html, /Ana Torres/);
    assert.match(result.data.html, /1,200\.00/);
    assert.equal(result.data.html.includes('<script>'), false);
  }
  assert.equal((await api('/invoices/9001/document?paper=invalid', { token })).status, 400);
  assert.equal((await api('/invoices/999/document', { token })).status, 404);
  const technical = await login('tecnico');
  assert.equal((await api('/invoices/9001/document', { token: technical.accessToken })).status, 403);
});

test('expense CRUD is idempotent, audited and rejects stale edits from the web', async () => {
  const { accessToken: token } = await login();
  const body = { category: 'transporte', description: 'Movil QA', amount: '125.50', expenseDate: '2026-09-04', clientIdServicio: 301 };
  const args = { token, method: 'POST', body, key: crypto.randomUUID() };
  const first = await api('/expenses', args);
  assert.equal(first.status, 201);
  assert.equal((await api('/expenses', args)).data.id, first.data.id);
  assert.equal((await api('/expenses', { ...args, body: { ...body, amount: '126.50' } })).status, 409);
  const id = first.data.id;
  const update = { token, method: 'PATCH', version: first.data.version, key: crypto.randomUUID(), body: { description: 'Movil QA actualizado' } };
  const second = await api(`/expenses/${id}`, update);
  assert.equal(second.status, 200);
  assert.equal((await api(`/expenses/${id}`, update)).data.version, second.data.version);
  assert.equal((await api(`/expenses/${id}`, { ...update, key: crypto.randomUUID() })).data.code, 'STALE_EXPENSE');
  const { changeExpense } = require('../lib/expense-service');
  await qa.prisma.$transaction(tx => changeExpense(tx, { id, data: { reference: 'Cambio web' }, actor: 'qa-admin' }));
  assert.equal((await api(`/expenses/${id}`, { ...update, version: second.data.version, key: crypto.randomUUID() })).status, 409);
  const current = await api(`/expenses/${id}`, { token });
  const remove = { token, method: 'DELETE', version: current.data.version, key: crypto.randomUUID() };
  assert.equal((await api(`/expenses/${id}`, remove)).status, 200);
  assert.equal((await api(`/expenses/${id}`, remove)).status, 200);
  assert.equal((await api(`/expenses/${id}`, { token })).status, 404);
  assert.equal(await qa.prisma.activity.count({ where: { entityType: 'expense', entityId: String(id) } }), 4);
});

test('expenses reject invalid data, missing keys and unrelated roles', async () => {
  const { accessToken: token } = await login();
  const body = { category: 'otros', description: 'Validar gasto', amount: 20, expenseDate: '2026-09-04' };
  for (const patch of [{ amount: -1 }, { amount: true }, { amount: '' }, { amount: '1.005' }, { amount: 1e13 }, { category: 'invalida' }, { description: ' ' }, { expenseDate: '2026-02-30' }, { clientIdServicio: '301' }, { purchaseId: 99 }]) {
    assert.equal((await api('/expenses', { token, method: 'POST', key: crypto.randomUUID(), body: { ...body, ...patch } })).status, 400, JSON.stringify(patch));
  }
  assert.equal((await api('/expenses', { token, method: 'POST', body })).status, 400);
  assert.equal((await api('/expenses', { token, method: 'POST', key: crypto.randomUUID(), body: { ...body, clientIdServicio: 999999 } })).status, 404);
  for (const role of ['tecnico', 'cobranza', 'viewer']) {
    const user = await login(role);
    for (const method of ['GET', 'POST']) assert.equal((await api('/expenses', { token: user.accessToken, method, ...(method === 'POST' ? { body, key: crypto.randomUUID() } : {}) })).status, 403);
    assert.equal((await api('/expenses/1', { token: user.accessToken, method: 'PATCH', body, key: crypto.randomUUID(), version: 'a'.repeat(64) })).status, 403);
  }
});

test('expense filtered totals include all pages and linked expenses remain protected', async () => {
  const { accessToken: token } = await login();
  const purchase = await qa.prisma.purchase.create({ data: { purchasedAt: new Date(), total: 200 } });
  const linked = await qa.prisma.expense.create({ data: { description: 'Compra vinculada QA', category: 'inventario', amount: 200, expenseDate: new Date('2026-09-04T23:59:59Z'), purchaseId: purchase.id } });
  await qa.prisma.expense.create({ data: { description: 'Inventario QA', category: 'inventario', amount: 50, expenseDate: new Date('2026-09-04T00:00:00Z') } });
  const result = await api('/expenses?category=inventario&from=2026-09-04&to=2026-09-04&pageSize=1', { token });
  assert.equal(result.data.total, 2); assert.equal(result.data.items.length, 1); assert.equal(result.data.summary.amount, 250);
  const current = (await api(`/expenses/${linked.id}`, { token })).data;
  assert.equal(current.editable, false);
  for (const method of ['PATCH', 'DELETE']) {
    const response = await api(`/expenses/${linked.id}`, { token, method, key: crypto.randomUUID(), version: current.version, ...(method === 'PATCH' ? { body: { amount: 100 } } : {}) });
    assert.equal(response.status, 409); assert.equal(response.data.code, 'LINKED_EXPENSE');
  }
  assert.ok(await qa.prisma.purchase.findUnique({ where: { id: purchase.id } }));
  assert.equal((await api('/expenses?from=2026-09-10&to=2026-09-01', { token })).status, 400);
});

test('session management reports current session and revokes once with audit', async () => {
  const admin = await login();
  const target = await login('tecnico');
  const list = await api('/sessions', { token: admin.accessToken });
  assert.equal(list.data.items.find(s => s.id === admin.sessionId).current, true);
  assert.equal(list.data.items.find(s => s.id === target.sessionId).username, 'qa-tecnico');
  const path = `/sessions/${target.sessionId}`;
  assert.equal((await api(path, { token: admin.accessToken, method: 'DELETE' })).status, 200);
  assert.equal((await api(path, { token: admin.accessToken, method: 'DELETE' })).status, 200);
  assert.equal((await api('/me', { token: target.accessToken })).status, 401);
  assert.equal(await qa.prisma.activity.count({ where: { action: 'mobile.session.revoke', entityId: target.sessionId } }), 1);
});

test('equipment lifecycle shares business service, retains client history and is idempotent', async () => {
  const { accessToken: token } = await login();
  const args = { token, method: 'POST', key: crypto.randomUUID(), body: { typeId: 1, serialNumber: ' TEST-LIFECYCLE ', model: 'ONU QA', unitCost: '100.25', macAddress: 'aa-bb-cc-dd-ee-01' } };
  const first = await api('/equipment', args);
  assert.equal(first.status, 201); const id = first.data.id;
  assert.equal(first.data.macAddress, 'AA:BB:CC:DD:EE:01');
  assert.equal((await api('/equipment', args)).data.id, id);
  assert.equal((await api('/equipment', { ...args, body: { ...args.body, model: 'Other' } })).status, 409);
  assert.equal((await api('/equipment', { ...args, key: crypto.randomUUID(), body: { typeId: 1, serialNumber: 'test-lifecycle' } })).data.code, 'DUPLICATE_SERIAL');
  const assignment = { token, method: 'POST', key: crypto.randomUUID(), version: first.data.version, body: { clientId: 301, notes: 'Instalacion QA' } };
  const assigned = await api(`/equipment/${id}/assign`, assignment);
  assert.equal(assigned.status, 200);
  assert.equal((await api(`/equipment/${id}/assign`, assignment)).data.assignedToClientId, 301);
  assert.equal((await api('/clients/301', { token })).data.equipment[0].id, id);
  assert.equal((await api(`/equipment/${id}`, { token, method: 'DELETE', key: crypto.randomUUID(), version: assigned.data.version })).data.code, 'EQUIPMENT_ASSIGNED');
  assert.equal((await api(`/equipment/${id}/assign`, { ...assignment, key: crypto.randomUUID(), version: assigned.data.version, body: { clientId: 302 } })).data.code, 'EQUIPMENT_UNAVAILABLE');
  assert.equal((await api(`/equipment/${id}`, { token, method: 'PATCH', key: crypto.randomUUID(), version: assigned.data.version, body: { status: 'stock' } })).status, 409);
  const returned = await api(`/equipment/${id}/return`, { token, method: 'POST', key: crypto.randomUUID(), version: assigned.data.version });
  assert.equal(returned.data.status, 'stock');
  assert.equal((await api('/clients/301', { token })).data.equipment.length, 0);
  const { changeEquipment, validateEquipment } = require('../lib/equipment-service');
  await qa.prisma.$transaction(tx => changeEquipment(tx, { id, operation: 'update', data: validateEquipment({ model: 'Edicion web' }, true), actor: 'qa-web' }));
  assert.equal((await api(`/equipment/${id}`, { token, method: 'PATCH', key: crypto.randomUUID(), version: returned.data.version, body: { model: 'Viejo' } })).data.code, 'STALE_EQUIPMENT');
  const detail = (await api(`/equipment/${id}`, { token })).data;
  assert.equal(detail.history.length, 4);
  assert.ok(detail.history.some(h => h.toClient === 301));
  assert.ok(detail.history.some(h => h.fromClient === 301));
  const remove = { token, method: 'DELETE', key: crypto.randomUUID(), version: detail.version };
  assert.equal((await api(`/equipment/${id}`, remove)).status, 200);
  assert.equal((await api(`/equipment/${id}`, remove)).status, 200);
  assert.equal((await api(`/equipment/${id}`, { token })).status, 404);
  assert.equal(await qa.prisma.activity.count({ where: { entityType: 'equipment', entityId: String(id) } }), 5);
  assert.equal(await qa.prisma.invoice.count({ where: { clienteIdServicio: 301 } }), 1);
});

test('equipment permissions, validation and purchase provenance are protected', async () => {
  const { accessToken: token } = await login();
  for (const role of ['viewer', 'tecnico', 'cobranza']) {
    const loginResult = await login(role);
    assert.equal((await api('/equipment', { token: loginResult.accessToken })).status, 403);
    assert.equal((await api('/equipment', { token: loginResult.accessToken, method: 'POST', key: crypto.randomUUID(), body: { typeId: 1 } })).status, 403);
  }
  const cable = await qa.prisma.equipmentType.create({ data: { name: 'Cable QA metros', category: 'cable', unit: 'm' } });
  for (const body of [{ typeId: cable.id }, { typeId: 1, assignedToClientId: 301 }, { typeId: 1, unitCost: -1 }, { typeId: 1, unitCost: '1.001' }, { typeId: 1, macAddress: 'bad' }, { typeId: 1, status: 'assigned' }]) {
    assert.equal((await api('/equipment', { token, method: 'POST', key: crypto.randomUUID(), body })).status, 400);
  }
  const purchase = await qa.prisma.purchase.create({ data: { purchasedAt: new Date(), total: 100 } });
  const row = await qa.prisma.equipment.create({ data: { typeId: 1, purchaseId: purchase.id, serialNumber: 'TEST-PURCHASE', unitCost: 100 } });
  const current = (await api(`/equipment/${row.id}`, { token })).data;
  assert.equal((await api(`/equipment/${row.id}`, { token, method: 'PATCH', key: crypto.randomUUID(), version: current.version, body: { unitCost: 20 } })).data.code, 'LINKED_PURCHASE');
  assert.equal((await api(`/equipment/${row.id}`, { token, method: 'DELETE', key: crypto.randomUUID(), version: current.version })).data.code, 'LINKED_PURCHASE');
  const list = await api('/equipment?q=TEST-PURCHASE&pageSize=1&status=stock', { token });
  assert.equal(list.data.total, 1); assert.equal(list.data.summary.cost, 100);
  assert.equal(list.data.items[0].typeName, 'ONU de prueba');
  assert.equal((await api('/equipment?status=invalid', { token })).status, 400);
  assert.equal((await api('/equipment/types?q=ONU', { token })).data.items[0].id, 1);
  assert.equal((await api('/equipment/types', { token })).data.items.some(t => t.id === cable.id), false);
});

test('simultaneous equipment reservations cannot assign a serial to two clients', async () => {
  const { accessToken: token } = await login();
  const row = (await api('/equipment', { token, method: 'POST', key: crypto.randomUUID(), body: { typeId: 1, serialNumber: 'TEST-RACE' } })).data;
  const results = await Promise.all([301, 302].map(clientId => api(`/equipment/${row.id}/assign`, { token, method: 'POST', key: crypto.randomUUID(), version: row.version, body: { clientId } })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 1);
  assert.equal(await qa.prisma.activity.count({ where: { entityType: 'equipment', entityId: String(row.id), action: 'assign_equipment' } }), 1);
});

test('inventory types and purchases are complete, idempotent and preserve provenance', async () => {
  const { accessToken: token } = await login();
  const typeRequest = { token, method: 'POST', key: crypto.randomUUID(), body: {
    name: `Router movil QA ${Date.now()}`, category: 'wifi', unit: 'u', description: 'Tipo temporal',
  } };
  const type = (await api('/inventory/types', typeRequest)).data;
  assert.ok(type.id > 0);
  assert.equal(type.version.length, 64);
  assert.equal((await api('/inventory/types', typeRequest)).data.id, type.id);
  let material;
  let purchase;
  try {
    material = (await api('/inventory/types', { token, method: 'POST', key: crypto.randomUUID(), body: {
      name: `Cable movil QA ${Date.now()}`, category: 'cable', unit: 'm',
    } })).data;
    const purchaseRequest = { token, method: 'POST', key: crypto.randomUUID(), body: {
      supplier: 'Proveedor QA', invoiceRef: `FAC-${Date.now()}`, purchasedAt: '2026-09-15',
      items: [
        { typeId: type.id, quantity: 2, unitPrice: '100.25', serials: [`MOV-${Date.now()}-1`, `MOV-${Date.now()}-2`], brand: 'QA', model: 'R1' },
        { typeId: material.id, quantity: '10.5', unitPrice: '2.50' },
      ],
    } };
    const response = await api('/inventory/purchases', purchaseRequest);
    assert.equal(response.status, 201);
    purchase = response.data;
    assert.equal(purchase.total, 226.75);
    assert.equal(purchase.equipmentCount, 2);
    assert.equal(purchase.canDelete, false);
    assert.equal((await api('/inventory/purchases', purchaseRequest)).data.id, purchase.id);
    assert.equal(await qa.prisma.expense.count({ where: { purchaseId: purchase.id, amount: 226.75 } }), 1);
    assert.equal(await qa.prisma.equipment.count({ where: { purchaseId: purchase.id, status: 'stock' } }), 2);
    const detail = await api(`/inventory/purchases/${purchase.id}`, { token });
    assert.equal(detail.data.items.length, 2);
    assert.equal(detail.data.equipment.length, 2);
    const blocked = await api(`/inventory/purchases/${purchase.id}`, { token, method: 'DELETE', key: crypto.randomUUID(), version: purchase.version });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.code, 'PURCHASE_HAS_EQUIPMENT');
    assert.ok(await qa.prisma.purchase.findUnique({ where: { id: purchase.id } }));
    const typeInUse = await api(`/inventory/types/${type.id}`, { token, method: 'DELETE', key: crypto.randomUUID(), version: type.version });
    assert.equal(typeInUse.data.code, 'TYPE_IN_USE');
    const list = await api('/inventory/purchases?q=Proveedor&pageSize=1&from=2026-09-15&to=2026-09-15', { token });
    assert.ok(list.data.total >= 1);
    assert.ok(list.data.summary.total >= 226.75);
    assert.equal((await api('/me', { token })).data.capabilities.inventoryPurchasesWrite, true);
  } finally {
    if (purchase?.id) {
      await qa.prisma.expense.deleteMany({ where: { purchaseId: purchase.id } });
      await qa.prisma.equipment.deleteMany({ where: { purchaseId: purchase.id } });
      await qa.prisma.purchase.deleteMany({ where: { id: purchase.id } });
    }
    for (const id of [type?.id, material?.id].filter(Boolean)) await qa.prisma.equipmentType.deleteMany({ where: { id } });
  }
});

test('material purchases can be removed safely and invalid purchase data is rejected', async () => {
  const { accessToken: token } = await login();
  const material = (await api('/inventory/types', { token, method: 'POST', key: crypto.randomUUID(), body: {
    name: `Fibra QA ${Date.now()}`, category: 'cable', unit: 'm',
  } })).data;
  try {
    for (const body of [
      { purchasedAt: '2026-02-30', items: [{ typeId: material.id, quantity: 1, unitPrice: 1 }] },
      { purchasedAt: '2026-09-15', items: [] },
      { purchasedAt: '2026-09-15', items: [{ typeId: material.id, quantity: 0, unitPrice: 1 }] },
      { purchasedAt: '2026-09-15', items: [{ typeId: material.id, quantity: 1, unitPrice: '1.001' }] },
    ]) assert.equal((await api('/inventory/purchases', { token, method: 'POST', key: crypto.randomUUID(), body })).status, 400);
    assert.equal((await api('/inventory/purchases', { token, method: 'POST', key: crypto.randomUUID(), body: {
      purchasedAt: '2026-09-15', items: [{ typeId: 999999, quantity: 1, unitPrice: 1 }],
    } })).status, 409);
    const purchase = (await api('/inventory/purchases', { token, method: 'POST', key: crypto.randomUUID(), body: {
      purchasedAt: '2026-09-15', createEquipment: true, items: [{ typeId: material.id, quantity: '12.5', unitPrice: '3.20' }],
    } })).data;
    assert.equal(purchase.equipmentCount, 0);
    const remove = { token, method: 'DELETE', key: crypto.randomUUID(), version: purchase.version };
    assert.equal((await api(`/inventory/purchases/${purchase.id}`, remove)).status, 200);
    assert.equal((await api(`/inventory/purchases/${purchase.id}`, remove)).status, 200);
    assert.equal(await qa.prisma.expense.count({ where: { purchaseId: purchase.id } }), 0);
  } finally {
    await qa.prisma.equipmentType.deleteMany({ where: { id: material.id } });
  }
  for (const role of ['tecnico', 'cobranza', 'viewer']) {
    const session = await login(role);
    assert.equal((await api('/inventory/purchases', { token: session.accessToken })).status, 403);
    assert.equal((await api('/inventory/types', { token: session.accessToken })).status, 403);
  }
});

test('employee and payroll lifecycle is versioned, idempotent and preserves paid history', async () => {
  const { accessToken: token } = await login();
  const createEmployee = { token, method: 'POST', key: crypto.randomUUID(), body: {
    fullName: 'Tecnico Nomina QA', documentId: `QA-${Date.now()}`, position: 'Tecnico', baseSalary: '25000.50', hiredAt: '2026-09-01',
  } };
  const employee = (await api('/employees', createEmployee)).data;
  assert.ok(employee.id > 0);
  assert.equal(employee.version.length, 64);
  assert.equal((await api('/employees', createEmployee)).data.id, employee.id);
  assert.equal((await api('/employees', { ...createEmployee, body: { ...createEmployee.body, fullName: 'Otro' } })).data.code, 'IDEMPOTENCY_CONFLICT');
  try {
    const update = { token, method: 'PATCH', key: crypto.randomUUID(), version: employee.version, body: { phone: '8095550199' } };
    const edited = await api(`/employees/${employee.id}`, update);
    assert.equal(edited.status, 200);
    assert.equal(edited.data.phone, '8095550199');
    assert.equal((await api(`/employees/${employee.id}`, update)).data.version, edited.data.version);
    assert.equal((await api(`/employees/${employee.id}`, { ...update, key: crypto.randomUUID() })).data.code, 'STALE_EMPLOYEE');

    const createPayroll = { token, method: 'POST', key: crypto.randomUUID(), body: {
      employeeId: employee.id, period: '2026-09', periodStart: '2026-09-01', periodEnd: '2026-09-30',
      baseAmount: '25000.50', bonus: '500', deductions: '250.25', status: 'pending',
    } };
    const payroll = (await api('/payroll', createPayroll)).data;
    assert.equal(payroll.netAmount, 25250.25);
    assert.equal((await api('/payroll', createPayroll)).data.id, payroll.id);
    const pay = { token, method: 'POST', key: crypto.randomUUID(), version: payroll.version, body: { paidAt: '2026-09-15', paymentMethod: 'transferencia' } };
    const paid = await api(`/payroll/${payroll.id}/pay`, pay);
    assert.equal(paid.status, 200);
    assert.equal(paid.data.status, 'paid');
    assert.equal((await api(`/payroll/${payroll.id}/pay`, pay)).data.version, paid.data.version);
    assert.equal(await qa.prisma.expense.count({ where: { payrollId: payroll.id } }), 1);
    assert.equal((await api(`/payroll/${payroll.id}`, { token, method: 'DELETE', key: crypto.randomUUID(), version: paid.data.version })).data.code, 'PAID_PAYROLL_LOCKED');

    const removeEmployee = await api(`/employees/${employee.id}`, { token, method: 'DELETE', key: crypto.randomUUID(), version: edited.data.version });
    assert.equal(removeEmployee.status, 200);
    assert.equal(removeEmployee.data.deactivated, true);
    assert.equal((await api(`/employees/${employee.id}`, { token })).data.active, false);
    assert.equal((await api('/payroll?status=paid', { token })).data.items.some((row) => row.id === payroll.id), true);
    assert.equal((await api('/me', { token })).data.capabilities.payrollWrite, true);
  } finally {
    await qa.prisma.expense.deleteMany({ where: { payroll: { employeeId: employee.id } } });
    await qa.prisma.payrollEntry.deleteMany({ where: { employeeId: employee.id } });
    await qa.prisma.employee.deleteMany({ where: { id: employee.id } });
  }
  for (const role of ['tecnico', 'cobranza', 'viewer']) {
    const session = await login(role);
    assert.equal((await api('/employees', { token: session.accessToken })).status, 403);
    assert.equal((await api('/payroll', { token: session.accessToken })).status, 403);
    assert.equal((await api('/me', { token: session.accessToken })).data.capabilities.payrollWrite, false);
  }
});

test('mobile user administration shares web accounts and revokes sessions after password changes', async () => {
  const superSession = await login('super_admin');
  const username = `qa-mobile-${Date.now()}`;
  const create = { token: superSession.accessToken, method: 'POST', key: crypto.randomUUID(), body: {
    username, password: 'temporary-12345', fullName: 'Usuario Movil QA', role: 'viewer', isActive: true,
  } };
  const createdResponse = await api('/users', create);
  assert.equal(createdResponse.status, 201);
  const created = createdResponse.data;
  assert.equal(created.username, username);
  assert.equal(Object.hasOwn(created, 'passwordHash'), false);
  assert.equal(JSON.stringify(created).includes('temporary-12345'), false);
  assert.equal((await api('/users', create)).data.id, created.id);
  try {
    const signedIn = await api('/sessions', { method: 'POST', body: { username, password: 'temporary-12345', deviceName: 'QA user lifecycle' } });
    assert.equal(signedIn.status, 201);
    const update = { token: superSession.accessToken, method: 'PATCH', key: crypto.randomUUID(), version: created.version, body: { role: 'tecnico', fullName: 'Tecnico Movil QA' } };
    const edited = await api(`/users/${created.id}`, update);
    assert.equal(edited.status, 200);
    assert.equal(edited.data.role, 'tecnico');
    assert.equal((await api(`/users/${created.id}`, { ...update, key: crypto.randomUUID() })).data.code, 'STALE_USER');
    const password = { token: superSession.accessToken, method: 'POST', key: crypto.randomUUID(), version: edited.data.version, body: { newPassword: 'replacement-12345' } };
    assert.equal((await api(`/users/${created.id}/password`, password)).data.sessionsRevoked, true);
    assert.equal((await api('/me', { token: signedIn.data.accessToken })).status, 401);
    assert.equal((await api('/sessions', { method: 'POST', body: { username, password: 'temporary-12345', deviceName: 'old password' } })).status, 401);
    assert.equal((await api('/sessions', { method: 'POST', body: { username, password: 'replacement-12345', deviceName: 'new password' } })).status, 201);
    const current = (await api(`/users/${created.id}`, { token: superSession.accessToken })).data;
    assert.equal((await api(`/users/${created.id}`, { token: superSession.accessToken, method: 'DELETE', key: crypto.randomUUID(), version: current.version })).status, 200);
    assert.equal((await api(`/users/${created.id}`, { token: superSession.accessToken })).status, 404);
  } finally {
    await qa.prisma.mobileSession.deleteMany({ where: { userId: created.id } });
    await qa.prisma.user.deleteMany({ where: { id: created.id } });
  }
  const admin = await login('admin');
  assert.equal((await api('/users', { token: admin.accessToken })).status, 200);
  assert.equal((await api('/users', { token: admin.accessToken, method: 'POST', key: crypto.randomUUID(), body: { username: 'forbidden-user', password: 'forbidden-12345' } })).status, 403);
  const viewer = await login('viewer');
  assert.equal((await api('/users', { token: viewer.accessToken })).status, 403);
});

test('mobile NOC incidents support a versioned and auditable operational lifecycle', async () => {
  const row = await qa.prisma.networkIncident.create({ data: {
    fingerprint: `qa-mobile-${Date.now()}`, source: 'mikrotik', category: 'collective_outage', title: 'Incidente movil QA',
    description: 'Prueba aislada', severity: 'high', status: 'open', scopeType: 'zone', scopeKey: 'qa', scopeLabel: 'Zona QA',
    affectedClients: 2, affectedClientIds: '[301,302]',
  } });
  const { accessToken: token } = await login('tecnico');
  try {
    const detail = await api(`/incidents/${row.id}`, { token });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.clients.length, 2);
    assert.equal(detail.data.version.length, 64);
    const acknowledge = { token, method: 'PATCH', key: crypto.randomUUID(), version: detail.data.version, body: { action: 'acknowledge', note: 'Revisando zona' } };
    const acknowledged = await api(`/incidents/${row.id}`, acknowledge);
    assert.equal(acknowledged.data.status, 'acknowledged');
    assert.equal((await api(`/incidents/${row.id}`, acknowledge)).data.version, acknowledged.data.version);
    assert.equal((await api(`/incidents/${row.id}`, { ...acknowledge, key: crypto.randomUUID() })).data.code, 'STALE_INCIDENT');
    const resolve = await api(`/incidents/${row.id}`, { token, method: 'PATCH', key: crypto.randomUUID(), version: acknowledged.data.version, body: { action: 'resolve', note: 'Enlace recuperado' } });
    assert.equal(resolve.data.status, 'resolved');
    const reopen = await api(`/incidents/${row.id}`, { token, method: 'PATCH', key: crypto.randomUUID(), version: resolve.data.version, body: { action: 'reopen' } });
    assert.equal(reopen.data.status, 'open');
    assert.equal((await api('/incidents?status=active&q=movil', { token })).data.items.some((incident) => incident.id === row.id), true);
    assert.equal((await api('/network/summary', { token })).status, 200);
    assert.equal(await qa.prisma.networkIncidentEvent.count({ where: { incidentId: row.id } }), 3);
    assert.equal(await qa.prisma.activity.count({ where: { entityType: 'network_incident', entityId: String(row.id) } }), 3);
  } finally {
    await qa.prisma.networkIncidentEvent.deleteMany({ where: { incidentId: row.id } });
    await qa.prisma.networkIncident.deleteMany({ where: { id: row.id } });
  }
  for (const role of ['cobranza', 'viewer']) {
    const session = await login(role);
    assert.equal((await api('/incidents', { token: session.accessToken })).status, 403);
    assert.equal((await api('/network/summary', { token: session.accessToken })).status, 403);
  }
});

test('mobile network audit exposes durable client, WAN and IPAM evidence with technical permissions', async () => {
  const now = new Date();
  const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
  const cidr = '192.0.2.0/24'; const ip = '192.0.2.77';
  await qa.prisma.clientNetworkSample.deleteMany({ where: { idServicio: 301, capturedAt: now } });
  await qa.prisma.clientNetworkDaily.deleteMany({ where: { idServicio: 301, day } });
  await qa.prisma.ipamAddress.deleteMany({ where: { ip } });
  await qa.prisma.ipamNetwork.deleteMany({ where: { cidr } });
  try {
    await qa.prisma.clientNetworkSample.create({ data: { idServicio: 301, capturedAt: now, ip, uploadBps: 1e6, downloadBps: 5e6, mikrotikOnline: true, transmitting: true, serviceOnline: true, healthState: 'stable', stabilityScore: 100 } });
    await qa.prisma.clientNetworkDaily.create({ data: { idServicio: 301, day, sampleCount: 2, onlineSamples: 2, stableSamples: 2, uploadBpsSum: 2e6, downloadBpsSum: 10e6, peakUploadBps: 1e6, peakDownloadBps: 5e6, lastHealthState: 'stable', lastServiceOnline: true, lastUploadBps: 1e6, lastDownloadBps: 5e6, lastCapturedAt: now } });
    await qa.prisma.ipamNetwork.create({ data: { cidr, network: '192.0.2.0', prefix: 24, capacity: 254, used: 1, available: 253, utilization: 0.39, recommended: JSON.stringify([ip]), stateHash: 'qa-ipam-network' } });
    await qa.prisma.ipamAddress.create({ data: { ip, cidr, classification: 'available', available: true, recommended: true, sources: JSON.stringify(['arp']), macAddresses: '[]', stateHash: 'qa-ipam-address' } });
    const { accessToken: token } = await login('tecnico');
    const audit = await api('/network/audit/clients?q=Ana&days=30', { token });
    assert.equal(audit.status, 200); assert.equal(audit.data.items[0].idServicio, 301); assert.equal(audit.data.items[0].stabilityPercent, 100);
    const detail = await api('/network/audit/clients/301?days=7', { token });
    assert.equal(detail.data.samples.some((sample) => sample.ip === ip), true);
    assert.ok((await api('/network/wan?hours=24', { token })).data.summary.samples >= 0);
    const networks = await api('/ipam/networks', { token });
    assert.equal(networks.data.items.find((row) => row.cidr === cidr).recommended[0], ip);
    const addresses = await api(`/ipam/addresses?cidr=${encodeURIComponent(cidr)}&available=true`, { token });
    assert.equal(addresses.data.items[0].sources[0], 'arp');
    const me = await api('/me', { token }); assert.equal(me.data.capabilities.networkAudit, true); assert.equal(me.data.capabilities.ipamRead, true);
    for (const role of ['cobranza', 'viewer']) {
      const session = await login(role);
      assert.equal((await api('/network/audit/clients', { token: session.accessToken })).status, 403);
      assert.equal((await api('/ipam/networks', { token: session.accessToken })).status, 403);
    }
  } finally {
    await qa.prisma.clientNetworkSample.deleteMany({ where: { idServicio: 301, capturedAt: now } });
    await qa.prisma.clientNetworkDaily.deleteMany({ where: { idServicio: 301, day } });
    await qa.prisma.ipamAddress.deleteMany({ where: { ip } });
    await qa.prisma.ipamNetwork.deleteMany({ where: { cidr } });
  }
});

test('mobile live network and MikroTik summaries are filtered, paginated and permission scoped', async () => {
  const { accessToken: token } = await login('tecnico');
  const live = await api('/network/live?page=1&pageSize=1&state=online&sort=traffic', { token });
  assert.equal(live.status, 200);
  assert.equal(live.data.total, 2);
  assert.equal(live.data.items.length, 1);
  assert.equal(live.data.items[0].idServicio, 301);
  assert.equal(live.data.items[0].downloadBps, 10_000_000);
  assert.equal(live.data.source, 'mikrotik_shared_snapshot');
  assert.equal(JSON.stringify(live.data).includes('MUST-NOT-LEAK'), false);
  const differences = await api('/network/live?q=luis&state=differences', { token });
  assert.equal(differences.data.total, 1);
  assert.equal(differences.data.items[0].syncState, 'queue_mismatch');
  assert.equal((await api('/network/live?state=invalid', { token })).status, 400);
  assert.equal((await api('/network/live?sort=invalid', { token })).status, 400);
  const mikrotik = await api('/mikrotik/summary', { token });
  assert.equal(mikrotik.status, 200);
  assert.equal(mikrotik.data.system.identity, 'MikroTik-QA');
  assert.equal(mikrotik.data.interfaces[0].running, true);
  const me = await api('/me', { token });
  assert.equal(me.data.capabilities.networkLive, true);
  assert.equal(me.data.capabilities.mikrotikRead, true);
  for (const role of ['cobranza', 'viewer']) {
    const session = await login(role);
    assert.equal((await api('/network/live', { token: session.accessToken })).status, 403);
    assert.equal((await api('/mikrotik/summary', { token: session.accessToken })).status, 403);
  }
});

test('mobile MikroTik ping is typed, bounded, audited and permission scoped', async () => {
  const { accessToken: token } = await login('tecnico');
  const result = await api('/mikrotik/ping', { token, method: 'POST', body: { address: '192.0.2.1', count: 3 } });
  assert.equal(result.status, 200);
  assert.deepEqual({ address: result.data.address, sent: result.data.sent, received: result.data.received, lossPercent: result.data.lossPercent, verified: result.data.verified },
    { address: '192.0.2.1', sent: 3, received: 3, lossPercent: 0, verified: true });
  const audit = await qa.prisma.activity.findFirst({ where: { action: 'mobile.mikrotik.ping', entityId: '192.0.2.1' }, orderBy: { id: 'desc' } });
  assert.equal(JSON.parse(audit.details).actor, 'qa-tecnico');
  for (const body of [{ address: 'example.com' }, { address: '192.0.2.1', count: 0 }, { address: '192.0.2.1', count: 6 }]) {
    assert.equal((await api('/mikrotik/ping', { token, method: 'POST', body })).status, 400);
  }
  const viewer = await login('viewer');
  assert.equal((await api('/mikrotik/ping', { token: viewer.accessToken, method: 'POST', body: { address: '192.0.2.1' } })).status, 403);
  assert.equal((await api('/me', { token })).data.capabilities.mikrotikDiagnostics, true);
  assert.equal((await api('/me', { token: viewer.accessToken })).data.capabilities.mikrotikDiagnostics, false);
});

test('mobile map validates coordinates and system status never returns infrastructure secrets', async () => {
  const original = await qa.prisma.client.findUniqueOrThrow({ where: { idServicio: 301 } });
  try {
    await qa.prisma.client.update({ where: { idServicio: 301 }, data: { gpsLat: 19.4517, gpsLng: -70.6970, gpsAccuracy: 8, gpsCapturedBy: 'qa-tecnico', gpsCapturedAt: new Date() } });
    const { accessToken: token } = await login('tecnico');
    const map = await api('/map/clients?q=Ana', { token });
    assert.equal(map.status, 200); assert.equal(map.data.items[0].idServicio, 301); assert.equal(map.data.items[0].source, 'technician');
    const key = crypto.randomUUID();
    const capture = { token, method: 'POST', key, body: { lat: 19.452, lng: -70.698, accuracy: 6.5 } };
    const saved = await api('/clients/301/gps', capture);
    assert.equal(saved.status, 200); assert.equal(saved.data.client.gpsCapturedBy, 'qa-tecnico'); assert.equal(saved.data.client.gpsLat, 19.452);
    assert.equal((await api('/clients/301/gps', capture)).data.client.gpsLng, -70.698);
    assert.equal((await api('/clients/301/gps', { ...capture, body: { ...capture.body, lat: 20 } })).data.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await api('/clients/999999/gps', { ...capture, key: crypto.randomUUID() })).status, 404);
    for (const body of [{ lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: 0, lng: 0, accuracy: -1 }]) assert.equal((await api('/clients/301/gps', { token, method: 'POST', key: crypto.randomUUID(), body })).status, 400);
    const system = await api('/system/status', { token });
    assert.equal(system.status, 200); assert.ok(system.data.integrations.wisphub);
    const serialized = JSON.stringify(system.data).toLowerCase();
    for (const secret of ['password', 'tokenhash', 'community', 'credential']) assert.equal(serialized.includes(secret), false);
    const viewer = await login('viewer'); assert.equal((await api('/map/clients', { token: viewer.accessToken })).status, 403); assert.equal((await api('/clients/301/gps', { token: viewer.accessToken, method: 'POST', key: crypto.randomUUID(), body: { lat: 0, lng: 0 } })).status, 403); assert.equal((await api('/system/status', { token: viewer.accessToken })).status, 200);
  } finally {
    await qa.prisma.client.update({ where: { idServicio: 301 }, data: { gpsLat: original.gpsLat, gpsLng: original.gpsLng, gpsAccuracy: original.gpsAccuracy, gpsCapturedAt: original.gpsCapturedAt, gpsCapturedBy: original.gpsCapturedBy } });
  }
});

test('mobile WhatsApp keeps a durable pre-send receipt and never repeats the same operation key', async () => {
  let calls = 0;
  const isolated = await startQa(0, undefined, undefined, {
    whatsappStatus: async () => ({ status: 'connected' }),
    sendWhatsapp: async ({ idServicio, phone, message }) => { calls += 1; assert.equal(idServicio, 301); assert.ok(phone); assert.equal(message, 'Mensaje movil QA'); return { ok: true, jid: 'qa@s.whatsapp.net' }; },
  });
  const call = async (path, options = {}) => { const response = await fetch(`${isolated.url}/mobile/v1${path}`, { method: options.method || 'GET', headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(options.key ? { 'idempotency-key': options.key } : {}) }, body: options.body === undefined ? undefined : JSON.stringify(options.body) }); return { status: response.status, data: await response.json() }; };
  const originalBot = await isolated.prisma.appSetting.findUnique({ where: { key: 'whatsapp_bot_enabled' } });
  const botLogs = await isolated.prisma.whatsappLog.createMany({ data: [
    { phone: '18095550101', message: 'saldo', messageType: 'incoming', status: 'received', clientName: 'Cliente QA' },
    { phone: '18095550101', message: 'Saldo QA', messageType: 'bot_balance', status: 'sent', clientName: 'Cliente QA' },
  ] });
  try {
    const session = await call('/sessions', { method: 'POST', body: { username: 'qa-cobranza', password: 'qa-only-12345' } }); const token = session.data.accessToken;
    assert.equal((await call('/whatsapp/status', { token })).data.canSend, true);
    const bot = await call('/whatsapp/bot', { token }); assert.equal(bot.status, 200); assert.equal(bot.data.waConnected, true); assert.equal(bot.data.canManage, false); assert.ok(bot.data.stats.conversations >= 1);
    const conversations = await call('/whatsapp/bot/conversations', { token }); assert.equal(conversations.status, 200); assert.equal(conversations.data.items.some(item => item.phone === '18095550101' && item.messageCount === 2), true);
    assert.equal((await call('/whatsapp/bot/toggle', { token, method: 'POST', key: crypto.randomUUID(), body: { enabled: true } })).status, 403);
    const admin = await call('/sessions', { method: 'POST', body: { username: 'qa-admin', password: 'qa-only-12345' } });
    const toggleKey = crypto.randomUUID(); const toggle = { token: admin.data.accessToken, method: 'POST', key: toggleKey, body: { enabled: true } };
    const toggled = await call('/whatsapp/bot/toggle', toggle); assert.equal(toggled.status, 200); assert.equal(toggled.data.confirmed, true); assert.equal(toggled.data.enabled, true);
    assert.equal((await call('/whatsapp/bot/toggle', toggle)).data.enabled, true);
    assert.equal((await call('/whatsapp/bot/toggle', { ...toggle, body: { enabled: false } })).data.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await call('/whatsapp/bot', { token: admin.data.accessToken })).data.canManage, true);
    const key = crypto.randomUUID(); const send = { token, method: 'POST', key, body: { idServicio: 301, message: 'Mensaje movil QA' } };
    const first = await call('/whatsapp/messages', send); assert.equal(first.status, 200); assert.equal(first.data.state, 'sent');
    assert.equal((await call('/whatsapp/messages', send)).data.state, 'sent'); assert.equal(calls, 1);
    assert.equal((await call('/whatsapp/messages', { ...send, body: { ...send.body, message: 'Otro' } })).data.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await call('/whatsapp/history', { token })).status, 200);
    const technical = await call('/sessions', { method: 'POST', body: { username: 'qa-tecnico', password: 'qa-only-12345' } });
    assert.equal((await call('/whatsapp/history', { token: technical.data.accessToken })).status, 403);
  } finally {
    await isolated.prisma.whatsappLog.deleteMany({ where: { phone: '18095550101', messageType: { in: ['incoming', 'bot_balance'] } } });
    if (originalBot) await isolated.prisma.appSetting.update({ where: { key: originalBot.key }, data: { value: originalBot.value, category: originalBot.category, description: originalBot.description } });
    else await isolated.prisma.appSetting.deleteMany({ where: { key: 'whatsapp_bot_enabled' } });
    assert.equal(botLogs.count, 2);
    await isolated.close();
  }
});

test('mobile client service actions are role-scoped and reserved before touching MikroTik', async () => {
  let calls = 0;
  const isolated = await startQa(0, undefined, undefined, { clientAction: async ({ idServicio, action, reason, actor }) => { calls += 1; assert.equal(idServicio, 301); assert.equal(action, 'moroso'); assert.equal(actor.role, 'cobranza'); return { ok: true, ip: '192.0.2.10', connectionsKilled: 1, reason }; } });
  const call = async (path, options = {}) => { const response = await fetch(`${isolated.url}/mobile/v1${path}`, { method: options.method || 'GET', headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(options.key ? { 'idempotency-key': options.key } : {}) }, body: options.body === undefined ? undefined : JSON.stringify(options.body) }); return { status: response.status, data: await response.json() }; };
  try {
    const signed = await call('/sessions', { method: 'POST', body: { username: 'qa-cobranza', password: 'qa-only-12345' } }); const token = signed.data.accessToken;
    assert.equal((await call('/clients/301/service-actions', { token })).data.capabilities.moroso, true);
    const args = { token, method: 'POST', key: crypto.randomUUID(), body: { action: 'moroso', reason: 'Prueba QA' } };
    const first = await call('/clients/301/service-actions', args); assert.equal(first.status, 200); assert.equal(first.data.state, 'complete');
    assert.equal((await call('/clients/301/service-actions', args)).data.state, 'complete'); assert.equal(calls, 1);
    assert.equal((await call('/clients/301/service-actions', { ...args, body: { ...args.body, reason: 'Otro motivo' } })).data.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await call('/clients/301/service-actions', { ...args, key: crypto.randomUUID(), body: { action: 'block', reason: 'No permitido', pilotConfirmed: true } })).status, 403);
    const technical = await call('/sessions', { method: 'POST', body: { username: 'qa-tecnico', password: 'qa-only-12345' } }); assert.equal((await call('/clients/301/service-actions', { token: technical.data.accessToken })).status, 403);
  } finally { await isolated.close(); }
});

test('mobile tickets expose filters, summary and linked client detail without fake mutations', async () => {
  const ticket = await qa.prisma.cachedTicket.create({ data: {
    idTicket: 900001, remoteId: 900001, asunto: 'Revision fibra movil QA', cliente: 'Cliente QA', idServicio: 301,
    estado: 'Abierto', prioridad: 'Alta', descripcion: 'Sin enlace', asignado: 'Tecnico QA', stateHash: 'qa-ticket',
  } });
  const { accessToken: token } = await login('tecnico');
  try {
    const list = await api('/tickets?q=fibra&status=Abierto&priority=Alta&pageSize=1', { token });
    assert.equal(list.status, 200);
    assert.equal(list.data.items[0].idTicket, ticket.idTicket);
    assert.ok(list.data.summary.byStatus.Abierto >= 1);
    const detail = await api(`/tickets/${ticket.idTicket}`, { token });
    assert.equal(detail.data.client.idServicio, 301);
    assert.equal(detail.data.descripcion, 'Sin enlace');
  } finally { await qa.prisma.cachedTicket.deleteMany({ where: { idTicket: ticket.idTicket } }); }
  for (const role of ['cobranza', 'viewer']) {
    const session = await login(role);
    assert.equal((await api('/tickets', { token: session.accessToken })).status, 403);
  }
});

test('mobile ticket writes are versioned, idempotent and confirmed against WispHub readback', async () => {
  const records = new Map();
  let creates = 0; let updates = 0; let ignoreUpdate = false;
  const raw = (id, input) => ({ id_ticket: id, asunto: input.subject, descripcion: `<p>${input.description}</p>`, estado: ({ 1: 'Nuevo', 2: 'En Progreso', 3: 'Resuelto', 4: 'Cerrado' })[input.state], prioridad: ({ 1: 'Baja', 2: 'Normal', 3: 'Alta', 4: 'Muy Alta' })[input.priority],
    servicio: { id_servicio: input.clientId, nombre: 'Ana Torres' }, tecnico: { id: input.technicianId, nombre: 'Tecnico QA' }, fecha_creacion: '2026-09-15 10:00:00', fecha_actualizacion: '2026-09-15 10:01:00' });
  records.set(50, raw(50, { clientId: 301, subject: 'Internet Lento', technicianId: 501, description: 'Revision inicial', state: 1, priority: 2 }));
  const isolated = await startQa(0, undefined, undefined, { ticketProvider: {
    read: async (id) => structuredClone(records.get(id)),
    create: async (input) => { creates += 1; const value = raw(910001, input); records.set(910001, value); return structuredClone(value); },
    update: async (id, input) => { updates += 1; if (!ignoreUpdate) records.set(id, raw(id, input)); return structuredClone(records.get(id)); },
  } });
  const call = async (path, options = {}) => { const response = await fetch(`${isolated.url}/mobile/v1${path}`, { method: options.method || 'GET', headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(options.key ? { 'idempotency-key': options.key } : {}), ...(options.version ? { 'if-match': options.version } : {}) }, body: options.body === undefined ? undefined : JSON.stringify(options.body) }); return { status: response.status, data: await response.json() }; };
  try {
    await isolated.prisma.client.update({ where: { idServicio: 301 }, data: { tecnicoId: 501, tecnicoNombre: 'Tecnico QA' } });
    const signed = await call('/sessions', { method: 'POST', body: { username: 'qa-tecnico', password: 'qa-only-12345' } }); const token = signed.data.accessToken;
    assert.equal((await call('/me', { token })).data.capabilities.ticketWrite, true);
    const options = await call('/tickets/options', { token }); assert.equal(options.status, 200); assert.equal(options.data.technicians[0].id, 501); assert.ok(options.data.subjects.includes('Internet Lento'));
    const body = { clientId: 301, subject: 'Internet Intermitente', technicianId: 501, description: 'Cortes durante la tarde', state: 1, priority: 3 };
    const create = { token, method: 'POST', key: crypto.randomUUID(), body };
    const created = await call('/tickets', create); assert.equal(created.status, 201); assert.equal(created.data.verified, true); assert.equal(created.data.ticket.idTicket, 910001);
    assert.equal((await call('/tickets', create)).data.ticket.idTicket, 910001); assert.equal(creates, 1);
    assert.equal((await call('/tickets', { ...create, body: { ...body, description: 'Otro' } })).data.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await isolated.prisma.cachedTicket.findUnique({ where: { idTicket: 910001 } })).estado, 'Nuevo');
    const current = await call('/tickets/910001/manage', { token }); assert.equal(current.status, 200); assert.equal(current.data.source, 'wisphub_live');
    const changedBody = { ...body, description: 'Servicio verificado', state: 4 };
    const edit = { token, method: 'PATCH', key: crypto.randomUUID(), version: current.data.version, body: changedBody };
    const changed = await call('/tickets/910001', edit); assert.equal(changed.status, 200); assert.equal(changed.data.ticket.stateLabel, 'Cerrado'); assert.equal(updates, 1);
    assert.equal((await call('/tickets/910001', { ...edit, key: crypto.randomUUID() })).data.code, 'STALE_TICKET');
    const after = await call('/tickets/910001/manage', { token }); ignoreUpdate = true;
    const ignored = await call('/tickets/910001', { token, method: 'PATCH', key: crypto.randomUUID(), version: after.data.version, body: { ...changedBody, state: 3 } });
    assert.equal(ignored.status, 502); assert.equal(ignored.data.code, 'WISPHUB_TICKET_NOT_CONFIRMED');
    assert.equal((await isolated.prisma.cachedTicket.findUnique({ where: { idTicket: 910001 } })).estado, 'Cerrado');
    assert.equal((await call('/tickets', { token, method: 'POST', key: crypto.randomUUID(), body: { ...body, technicianId: 999999 } })).data.code, 'TECHNICIAN_NOT_FOUND');
    const viewer = await call('/sessions', { method: 'POST', body: { username: 'qa-viewer', password: 'qa-only-12345' } });
    assert.equal((await call('/tickets/options', { token: viewer.data.accessToken })).status, 403);
    assert.equal(await isolated.prisma.activity.count({ where: { entityType: 'ticket', entityId: '910001' } }), 2);
  } finally { await isolated.close(); }
});

test('mobile plans calculate client mix and expected active revenue from SQLite', async () => {
  const { accessToken: token } = await login();
  const result = await api('/plans?q=qa', { token });
  assert.equal(result.status, 200);
  assert.equal(Array.isArray(result.data.items), true);
  for (const item of result.data.items) {
    assert.equal(typeof item.clientCount, 'number');
    assert.equal(typeof item.expectedMonthly, 'number');
    assert.ok(item.priceVariants >= 0);
  }
  const viewer = await login('viewer');
  assert.equal((await api('/plans', { token: viewer.accessToken })).status, 200);
});

test('mobile client provisioning reuses the server workflow and stores an idempotent receipt', async () => {
  let calls = 0;
  let reservations = 0;
  const isolated = await startQa(0, undefined, async (req, res) => {
    calls += 1;
    assert.equal(req.session.username, 'qa-admin');
    res.status(201).json({ ok: true, status: 'complete', client: { idServicio: 777, nombre: req.body.serviceName },
      wisphub: { ok: true, idServicio: 777 }, mikrotik: { ok: true }, sqlite: { ok: true, idServicio: 777 } });
  }, {
    queryIpam: async ({ cidrs, userId }) => ({ source: 'live', stale: false, networks: cidrs, rows: [{ ip: '192.0.2.77', cidr: cidrs[0], available: true }], userId }),
    reserveIp: async (req, res) => { reservations += 1; res.status(201).json({ token: 'qa-reservation-token', ip: req.body.ip, status: 'active', expiresAt: new Date(Date.now() + 60000) }); },
    releaseIp: async (req, res) => res.json({ token: req.params.token, ip: '192.0.2.77', status: 'released' }),
  });
  const call = async (path, options = {}) => {
    const response = await fetch(`${isolated.url}/mobile/v1${path}`, { method: options.method || 'GET', headers: {
      'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.key ? { 'idempotency-key': options.key } : {}),
    }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const signed = await call('/sessions', { method: 'POST', body: { username: 'qa-admin', password: 'qa-only-12345' } });
    const ipam = await call('/ipam/query', { token: signed.data.accessToken, method: 'POST', body: { cidrs: ['192.0.2.0/24'] } });
    assert.equal(ipam.data.rows[0].ip, '192.0.2.77');
    const reserve = { token: signed.data.accessToken, method: 'POST', key: crypto.randomUUID(), body: { ip: '192.0.2.77', cidrs: ['192.0.2.0/24'] } };
    const reserved = await call('/ipam/reservations', reserve);
    assert.equal(reserved.status, 201);
    assert.equal((await call('/ipam/reservations', reserve)).data.token, 'qa-reservation-token');
    assert.equal(reservations, 1);
    const request = { token: signed.data.accessToken, method: 'POST', key: crypto.randomUUID(), body: {
      serviceName: 'Cliente Android QA', ip: '192.0.2.77', zoneId: 1, planId: 1, uploadMbps: 10, downloadMbps: 10,
    } };
    const first = await call('/client-provisioning', request);
    assert.equal(first.status, 201);
    assert.equal(first.data.client.idServicio, 777);
    assert.equal((await call('/client-provisioning', request)).data.client.idServicio, 777);
    assert.equal(calls, 1);
    assert.equal((await call('/client-provisioning', { ...request, body: { ...request.body, serviceName: 'Otro' } })).data.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await call('/me', { token: signed.data.accessToken })).data.capabilities.clientProvisioningWrite, true);
    assert.equal((await call('/me', { token: signed.data.accessToken })).data.capabilities.ipamLive, true);
    assert.equal((await call('/ipam/reservations/qa-reservation-token', { token: signed.data.accessToken, method: 'DELETE', key: crypto.randomUUID() })).data.status, 'released');
  } finally { await isolated.close(); }
});
