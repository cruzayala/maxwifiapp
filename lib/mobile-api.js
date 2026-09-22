'use strict';

const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { invoiceDocument } = require('./mobile-documents');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(48).toString('base64url');
const publicUser = (u) => ({ id: u.id, username: u.username, fullName: u.fullName, role: u.role });
const validRoles = new Set(['super_admin', 'admin', 'tecnico', 'cobranza', 'viewer']);
function allowed(role, roles) {
  return validRoles.has(role) && (role === 'super_admin' || role === 'admin' || roles.includes(role));
}
const readRoles = ['tecnico', 'cobranza', 'viewer'];
const selectFields = (names) => Object.fromEntries(names.split(' ').map((name) => [name, true]));
const clientSelect = selectFields('idServicio nombre aliasNombre usuario telefono aliasTelefono email cedula aliasCedula aliasNotas direccion estado ip snOnu planInternetName precioPlan saldo zonaNombre fechaCorte creditScore gpsLat gpsLng gpsAccuracy gpsCapturedAt gpsCapturedBy syncedAt mtSyncedAt mtQueueName mtQueueLimit');
const invoiceSelect = selectFields('idFactura clienteIdServicio clienteNombre folio estado total totalCobrado saldo fechaEmision fechaVencimiento fechaPago formaPagoNombre zonaNombre syncedAt');
const catalogs = {
  plans: { model: 'internetPlan', id: 'id', title: 'nombre', search: ['nombre'], fields: 'id nombre tipo syncedAt', roles: readRoles, order: 'nombre' },
  zones: { model: 'zone', id: 'id', title: 'nombre', search: ['nombre'], fields: 'id nombre syncedAt', roles: readRoles, order: 'nombre' },
  tickets: { model: 'cachedTicket', id: 'idTicket', title: 'asunto', search: ['asunto', 'cliente'], fields: 'idTicket asunto descripcion estado prioridad asignado cliente fechaCreacion lastChangedAt', roles: ['tecnico'], order: 'idTicket' },
  onus: { model: 'oltOnu', id: 'id', title: 'name', search: ['name', 'serial', 'onuIndex'], fields: 'id name serial onuIndex interfaceName rack shelf pon onuId model online phaseState rxPowerDbm txPowerDbm lastOfflineCause clientIdServicio lastSeenAt', roles: ['tecnico'], order: 'onuIndex' },
  incidents: { model: 'networkIncident', id: 'id', title: 'title', search: ['title', 'scopeLabel'], fields: 'id title description severity status scopeLabel affectedClients detectedAt lastSeenAt', roles: ['tecnico'], order: 'detectedAt' },
  inventory: { model: 'equipment', id: 'id', title: 'model', search: ['serialNumber', 'brand', 'model'], fields: 'id serialNumber macAddress brand model status unitCost assignedToClientId assignedAt notes', roles: [], order: 'id' },
  expenses: { model: 'expense', id: 'id', title: 'description', search: ['description', 'category'], fields: 'id description category amount expenseDate paymentMethod reference clientIdServicio', roles: [], order: 'expenseDate' },
  payroll: { model: 'payrollEntry', id: 'id', title: 'period', search: ['period'], fields: 'id employeeId period netAmount status paidAt periodStart periodEnd', roles: [], order: 'periodStart' },
};

function pagination(query) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 30);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw Object.assign(new Error('Paginacion invalida'), { status: 400 });
  }
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
function searchWhere(query, fields, numericId) {
  const q = String(query.q ?? '').trim().slice(0, 120);
  if (!q) return {};
  const OR = fields.map((field) => ({ [field]: { contains: q } }));
  if (numericId && /^\d+$/.test(q) && Number.isSafeInteger(Number(q))) OR.push({ [numericId]: Number(q) });
  return { OR };
}
function positiveId(value) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw Object.assign(new Error('Identificador invalido'), { status: 400 });
  }
  return Number(value);
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const permission = (roles) => (req, res, next) => allowed(req.mobileUser.role, roles)
  ? next() : res.status(403).json({ error: 'Permisos insuficientes', code: 'FORBIDDEN' });

function createMobileRouter({ prisma, loginLimiter, billing, provisionClient, queryIpam, reserveIp, releaseIp, whatsappStatus, sendWhatsapp, clientAction, externalClient, ticketProvider, liveNetwork, mikrotikOverview, mikrotikPing, linkTest, surveyConfig, invalidateSurveyConfig }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/version', (_req, res) => res.json({ apiVersion: 1, minAppVersion: 1, status: 'preview' }));
  router.post('/sessions', loginLimiter, wrap(async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 120 || password.length > 1024) {
      return res.status(400).json({ error: 'Usuario y clave requeridos' });
    }
    const user = await prisma.user.findUnique({ where: { username: username.trim() } });
    // Equalize password work for unknown users without disclosing their existence.
    const valid = await bcrypt.compare(password, user?.passwordHash || '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.');
    if (!valid || !user?.isActive || !validRoles.has(user.role)) return res.status(401).json({ error: 'Usuario o clave incorrectos', code: 'LOGIN_FAILED' });
    const accessToken = randomToken(), refreshToken = randomToken();
    const accessExpiresAt = new Date(Date.now() + 15 * 60000), expiresAt = new Date(Date.now() + 30 * 86400000);
    const deviceName = String(req.body.deviceName || 'Android').trim().slice(0, 120) || 'Android';
    const session = await prisma.mobileSession.create({ data: {
      userId: user.id, deviceName, accessHash: hash(accessToken), refreshHash: hash(refreshToken),
      passwordStamp: hash(user.passwordHash), accessExpiresAt, expiresAt,
    } });
    res.status(201).json({ sessionId: session.id, accessToken, refreshToken, accessExpiresAt, expiresAt, user: publicUser(user) });
  }));
  const refreshLimiter = rateLimit({ windowMs: 15 * 60000, limit: 120, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Demasiadas renovaciones. Intenta de nuevo mas tarde.', code: 'RATE_LIMITED' } });
  router.post('/sessions/refresh', refreshLimiter, wrap(async (req, res) => {
    const token = String(req.body?.refreshToken || '');
    if (token.length < 40 || token.length > 200) return res.status(401).json({ error: 'Sesion revocada', code: 'SESSION_REVOKED' });
    const oldHash = hash(token);
    const old = await prisma.mobileSession.findUnique({ where: { refreshHash: oldHash } });
    const user = old && await prisma.user.findUnique({ where: { id: old.userId } });
    if (!old || old.revokedAt || old.expiresAt <= new Date() || !user?.isActive || !validRoles.has(user.role) || old.passwordStamp !== hash(user.passwordHash)) {
      return res.status(401).json({ error: 'Sesion revocada o vencida', code: 'SESSION_REVOKED' });
    }
    const accessToken = randomToken(), refreshToken = randomToken();
    const accessExpiresAt = new Date(Date.now() + 15 * 60000);
    const result = await prisma.mobileSession.updateMany({ where: { id: old.id, refreshHash: oldHash, revokedAt: null }, data: {
      accessHash: hash(accessToken), refreshHash: hash(refreshToken), accessExpiresAt, lastSeenAt: new Date(),
    } });
    if (result.count !== 1) return res.status(409).json({ error: 'La sesion ya fue renovada', code: 'TOKEN_ROTATED' });
    res.json({ sessionId: old.id, accessToken, refreshToken, accessExpiresAt, expiresAt: old.expiresAt, user: publicUser(user) });
  }));
  router.use(wrap(async (req, res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (token.length < 40 || token.length > 200) return res.status(401).json({ error: 'Inicia sesion', code: 'ACCESS_EXPIRED' });
    const session = await prisma.mobileSession.findUnique({ where: { accessHash: hash(token) } });
    const user = session && await prisma.user.findUnique({ where: { id: session.userId } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !user?.isActive || !validRoles.has(user.role) || session.passwordStamp !== hash(user.passwordHash)) {
      return res.status(401).json({ error: 'Sesion revocada', code: 'SESSION_REVOKED' });
    }
    if (session.accessExpiresAt <= new Date()) return res.status(401).json({ error: 'Renueva la sesion', code: 'ACCESS_EXPIRED' });
    req.mobileUser = user; req.mobileSession = session;
    next();
  }));
  require('./mobile-equipment').registerMobileEquipment(router, { prisma, wrap, permission, pagination, positiveId, searchWhere });
  require('./mobile-client-records').registerMobileClientRecords(router, { prisma, wrap, permission, pagination, positiveId, searchWhere });
  require('./mobile-client-external').registerMobileClientExternal(router, { prisma, wrap, permission, positiveId, provider: externalClient });
  require('./mobile-billing-report').registerMobileBillingReport(router, { prisma, wrap, permission });
  require('./mobile-payments').registerMobilePayments(router, { billing, prisma, wrap, permission, positiveId, pagination });
  require('./mobile-network').registerMobileNetwork(router, { prisma, wrap, permission, pagination, positiveId, searchWhere, liveNetwork, mikrotikOverview, mikrotikPing, linkTest });
  require('./mobile-collections').registerMobileCollections(router, { prisma, wrap, permission, pagination });
  require('./mobile-surveys').registerMobileSurveys(router, { prisma, wrap, permission, pagination, surveyConfig, invalidateSurveyConfig });
  require('./mobile-olt').registerMobileOlt(router, { prisma, wrap, permission, pagination, positiveId, searchWhere });
  require('./mobile-inventory').registerMobileInventory(router, { prisma, wrap, permission, pagination, positiveId, searchWhere });
  require('./mobile-tickets').registerMobileTickets(router, { prisma, wrap, permission, positiveId, provider: ticketProvider });
  require('./mobile-support').registerMobileSupport(router, { prisma, wrap, permission, pagination, positiveId, searchWhere });
  require('./mobile-operations').registerMobileOperations(router, { prisma, wrap, permission, pagination, positiveId, searchWhere });
  require('./mobile-whatsapp').registerMobileWhatsapp(router, { prisma, wrap, permission, pagination, positiveId, searchWhere, statusProvider: whatsappStatus, sendWhatsapp });
  require('./mobile-client-actions').registerMobileClientActions(router, { prisma, wrap, permission, positiveId, executeClientAction: clientAction });
  if (queryIpam) router.post('/ipam/query', permission([]), wrap(async (req, res) => {
    const result = await queryIpam({ cidrs: req.body?.cidrs, userId: req.mobileUser.id });
    res.json(result);
  }));
  async function forwardIdempotent(req, res, operation, handler) {
    const requestKey = String(req.headers['idempotency-key'] || '');
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey)) return res.status(400).json({ error: 'Falta la clave de operacion', code: 'INVALID_IDEMPOTENCY_KEY' });
    const requestHash = hash(JSON.stringify({ operation, body: req.body || {}, params: req.params || {} }));
    const key = { userId: req.mobileUser.id, requestKey };
    const old = await prisma.mobileMutation.findUnique({ where: { userId_requestKey: key } });
    if (old) {
      if (old.requestHash !== requestHash) return res.status(409).json({ error: 'La clave pertenece a otra operacion', code: 'IDEMPOTENCY_CONFLICT' });
      const stored = JSON.parse(old.resultJson);
      return res.status(stored.httpStatus || 200).json(stored.body);
    }
    let httpStatus = 200; let body = null;
    const capture = { status(value) { httpStatus = value; return this; }, json(value) { body = value; return value; } };
    req.session = { username: req.mobileUser.username, role: req.mobileUser.role, userId: req.mobileUser.id };
    await handler(req, capture);
    if (httpStatus < 400 && body) {
      const stored = { httpStatus, body };
      try { await prisma.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(stored) } }); }
      catch (error) {
        if (error.code !== 'P2002') throw error;
        const winner = await prisma.mobileMutation.findUnique({ where: { userId_requestKey: key } });
        if (!winner || winner.requestHash !== requestHash) return res.status(409).json({ error: 'Conflicto de operacion', code: 'IDEMPOTENCY_CONFLICT' });
        const won = JSON.parse(winner.resultJson); return res.status(won.httpStatus || 200).json(won.body);
      }
    }
    return res.status(httpStatus).json(body || { error: 'No se recibio confirmacion', code: 'INVALID_RESPONSE' });
  }
  if (reserveIp) router.post('/ipam/reservations', permission([]), wrap((req, res) => forwardIdempotent(req, res, 'ipam-reserve', reserveIp)));
  if (releaseIp) router.delete('/ipam/reservations/:token', permission([]), wrap((req, res) => forwardIdempotent(req, res, 'ipam-release', releaseIp)));
  if (provisionClient) router.post('/client-provisioning', permission([]), wrap(async (req, res) => {
    return forwardIdempotent(req, res, 'client-provisioning', provisionClient);
  }));
  router.get('/me', (req, res) => res.json({ user: publicUser(req.mobileUser), catalogs: Object.keys(catalogs).filter((k) => allowed(req.mobileUser.role, catalogs[k].roles)),
    capabilities: { clients: true, clientProvisioningWrite: !!provisionClient && allowed(req.mobileUser.role, []), clientExternalWrite: !!externalClient && allowed(req.mobileUser.role, []), clientServiceActions: !!clientAction && allowed(req.mobileUser.role, ['cobranza']), ticketWrite: !!ticketProvider && allowed(req.mobileUser.role, ['tecnico']), ipamLive: !!queryIpam && !!reserveIp && allowed(req.mobileUser.role, []), ipamRead: allowed(req.mobileUser.role, ['tecnico']), networkAudit: allowed(req.mobileUser.role, ['tecnico']), networkLive: !!liveNetwork && allowed(req.mobileUser.role, ['tecnico']), mikrotikRead: !!mikrotikOverview && allowed(req.mobileUser.role, ['tecnico']), mikrotikDiagnostics: !!mikrotikPing && allowed(req.mobileUser.role, ['tecnico']), linkTest: !!linkTest && allowed(req.mobileUser.role, ['tecnico']), collectionsQueue: allowed(req.mobileUser.role, ['cobranza']), surveysRead: allowed(req.mobileUser.role, ['cobranza']), surveysManage: allowed(req.mobileUser.role, []), whatsappBotSearch: allowed(req.mobileUser.role, ['cobranza']), plansRevenue: true, mapRead: allowed(req.mobileUser.role, ['tecnico']), gpsWrite: allowed(req.mobileUser.role, ['tecnico']), oltRead: allowed(req.mobileUser.role, ['tecnico']), oltOperations: false, whatsappRead: allowed(req.mobileUser.role, ['cobranza']), whatsappSend: !!sendWhatsapp && allowed(req.mobileUser.role, ['cobranza']), whatsappBotManage: allowed(req.mobileUser.role, []), paymentsWrite: !!billing && allowed(req.mobileUser.role, ['cobranza']), advancedFilters: true, billingReport: allowed(req.mobileUser.role, ['cobranza']), clientRecordsWrite: allowed(req.mobileUser.role, ['tecnico', 'cobranza']), promisesWrite: allowed(req.mobileUser.role, ['cobranza']), invoices: allowed(req.mobileUser.role, ['cobranza']), notesWrite: allowed(req.mobileUser.role, ['tecnico', 'cobranza']), expensesWrite: allowed(req.mobileUser.role, []), equipmentWrite: allowed(req.mobileUser.role, []), inventoryPurchasesWrite: allowed(req.mobileUser.role, []), inventoryTypesWrite: allowed(req.mobileUser.role, []), payrollWrite: allowed(req.mobileUser.role, []), usersManage: allowed(req.mobileUser.role, []), usersCreate: req.mobileUser.role === 'super_admin', sessionsManage: allowed(req.mobileUser.role, []), onuLocalWrite: false } }));
  router.delete('/sessions/current', wrap(async (req, res) => {
    await prisma.mobileSession.update({ where: { id: req.mobileSession.id }, data: { revokedAt: new Date() } });
    res.json({ success: true });
  }));
  router.get('/sessions', permission([]), wrap(async (req, res) => {
    const sessions = await prisma.mobileSession.findMany({ select: selectFields('id userId deviceName lastSeenAt createdAt revokedAt expiresAt'), orderBy: { createdAt: 'desc' }, take: 100 });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(sessions.map((s) => s.userId))] } }, select: { id: true, username: true, role: true } });
    const index = new Map(users.map((u) => [u.id, u]));
    res.json({ items: sessions.map((s) => ({ ...s, username: index.get(s.userId)?.username || 'Usuario eliminado',
      current: s.id === req.mobileSession.id, canRevoke: req.mobileUser.role === 'super_admin' || index.get(s.userId)?.role !== 'super_admin',
      status: s.revokedAt ? 'revoked' : s.expiresAt <= new Date() ? 'expired' : 'active' })), fetchedAt: new Date() });
  }));
  router.delete('/sessions/:id', permission([]), wrap(async (req, res) => {
    const target = await prisma.mobileSession.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'Sesion no encontrada' });
    const owner = await prisma.user.findUnique({ where: { id: target.userId } });
    if (owner?.role === 'super_admin' && req.mobileUser.role !== 'super_admin') return res.status(403).json({ error: 'Solo super_admin puede revocar esta sesion' });
    await prisma.$transaction(async (tx) => {
      const result = await tx.mobileSession.updateMany({ where: { id: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (result.count) await tx.activity.create({ data: { action: 'mobile.session.revoke', entityType: 'mobileSession', entityId: target.id, details: JSON.stringify({ actor: req.mobileUser.username, userId: target.userId }) } });
    });
    res.json({ success: true });
  }));
  require('./mobile-administration').registerMobileAdministration(router, { prisma, wrap, permission, pagination, positiveId, searchWhere });
  router.get('/overview', wrap(async (req, res) => {
    const clients = await prisma.client.count();
    const active = await prisma.client.count({ where: { estado: 'Activo' } });
    const suspended = await prisma.client.count({ where: { estado: 'Suspendido' } });
    const lastSync = await prisma.client.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } });
    const data = { clients, active, suspended, source: 'sqlite', syncedAt: lastSync?.syncedAt || null, fetchedAt: new Date() };
    if (allowed(req.mobileUser.role, ['cobranza'])) {
      const totals = await prisma.invoice.aggregate({ _sum: { total: true, totalCobrado: true, saldo: true }, _count: { idFactura: true } });
      data.billing = { invoices: totals._count.idFactura, billed: totals._sum.total || 0, collected: totals._sum.totalCobrado || 0, balance: totals._sum.saldo || 0 };
    }
    if (allowed(req.mobileUser.role, ['tecnico'])) {
      data.onus = await prisma.oltOnu.count();
      data.onusOnline = await prisma.oltOnu.count({ where: { online: true } });
      data.incidents = await prisma.networkIncident.count({ where: { status: { not: 'resolved' } } });
      data.wan = await prisma.wanNetworkSample.findFirst({ orderBy: { capturedAt: 'desc' }, select: { capturedAt: true, ifaceName: true, rxBps: true, txBps: true } });
    }
    res.json(data);
  }));
  async function pageResult(model, query, args) {
    const { page, pageSize, skip, take } = pagination(query);
    const [total, items] = await prisma.$transaction([
      model.count({ where: args.where }), model.findMany({ ...args, skip, take }),
    ]);
    return { items, total, page, pageSize, hasMore: skip + items.length < total, fetchedAt: new Date(), source: 'sqlite' };
  }
  router.get('/clients', wrap(async (req, res) => {
    const where = searchWhere(req.query, ['nombre', 'aliasNombre', 'usuario', 'telefono', 'ip', 'snOnu', 'zonaNombre'], 'idServicio');
    if (req.query.status) where.estado = String(req.query.status).slice(0, 40);
    if (req.query.zone) where.zonaNombre = String(req.query.zone).slice(0, 200);
    if (req.query.plan) where.planInternetName = String(req.query.plan).slice(0, 200);
    if (req.query.missingIp === 'true') where.AND = [{ OR: [{ ip: null }, { ip: '' }] }];
    res.json(await pageResult(prisma.client, req.query, { where, select: clientSelect, orderBy: [{ nombre: 'asc' }, { idServicio: 'asc' }] }));
  }));
  router.get('/clients/:id', wrap(async (req, res) => {
    const idServicio = positiveId(req.params.id);
    const client = await prisma.client.findUnique({ where: { idServicio }, select: clientSelect });
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    const notes = await prisma.clientNote.findMany({ where: { idServicio }, orderBy: { createdAt: 'desc' }, take: 100 });
    const equipment = await prisma.equipment.findMany({ where: { assignedToClientId: idServicio }, select: selectFields('id serialNumber brand model status assignedAt'), take: 100 });
    res.json({ client, notes, equipment, fetchedAt: new Date() });
  }));
  router.post('/clients/:id/notes', permission(['tecnico', 'cobranza']), wrap(async (req, res) => {
    const idServicio = positiveId(req.params.id);
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    const requestKey = String(req.headers['idempotency-key'] || '');
    if (!note || note.length > 4000 || !/^[A-Za-z0-9_-]{16,120}$/.test(requestKey)) return res.status(400).json({ error: 'Nota o clave de operacion invalida' });
    const requestHash = hash(JSON.stringify({ idServicio, note }));
    const key = { userId: req.mobileUser.id, requestKey };
    const result = await prisma.$transaction(async (tx) => {
      const old = await tx.mobileMutation.findUnique({ where: { userId_requestKey: key } });
      if (old) {
        if (old.requestHash !== requestHash) throw Object.assign(new Error('La clave ya pertenece a otra operacion'), { status: 409 });
        return JSON.parse(old.resultJson);
      }
      const client = await tx.client.findUnique({ where: { idServicio }, select: { nombre: true } });
      if (!client) throw Object.assign(new Error('Cliente no encontrado'), { status: 404 });
      const created = await tx.clientNote.create({ data: { idServicio, clientName: client.nombre, note } });
      await tx.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(created) } });
      await tx.activity.create({ data: { action: 'mobile.client.note', entityType: 'client', entityId: String(idServicio), details: JSON.stringify({ actor: req.mobileUser.username, noteId: created.id }) } });
      return created;
    });
    res.status(201).json(result);
  }));
  router.get('/invoices', permission(['cobranza']), wrap(async (req, res) => {
    const where = searchWhere(req.query, ['clienteNombre', 'folio', 'clienteUsuario', 'referencia'], 'idFactura');
    if (req.query.clientId) where.clienteIdServicio = positiveId(req.query.clientId);
    if (req.query.status) where.estado = String(req.query.status).slice(0, 40);
    if (req.query.pending === 'true') where.saldo = { gt: 0 };
    if (req.query.zone) where.zonaNombre = String(req.query.zone).slice(0, 200);
    if (req.query.method) where.formaPagoNombre = String(req.query.method).slice(0, 200);
    const { calendarDay } = require('./client-record-service');
    const dateFields = { issued: 'fechaEmision', due: 'fechaVencimiento', paid: 'fechaPago' };
    const field = req.query.dateField || 'issued';
    if (!Object.hasOwn(dateFields, field)) return res.status(400).json({ error: 'Tipo de fecha invalido' });
    if (req.query.from || req.query.to) {
      const from = req.query.from ? calendarDay(req.query.from) : null;
      const to = req.query.to ? calendarDay(req.query.to) : null;
      if (from && to && from > to) return res.status(400).json({ error: 'Rango de fechas invertido' });
      where[dateFields[field]] = { ...(from ? { gte: from.toISOString().slice(0, 10) } : {}), ...(to ? { lt: new Date(to.getTime() + 86400000).toISOString().slice(0, 10) } : {}) };
    }
    const { page, pageSize, skip, take } = pagination(req.query);
    const [total, items, totals] = await prisma.$transaction([
      prisma.invoice.count({ where }), prisma.invoice.findMany({ where, select: invoiceSelect, orderBy: { idFactura: 'desc' }, skip, take }),
      prisma.invoice.aggregate({ where, _sum: { total: true, totalCobrado: true, saldo: true } }),
    ]);
    res.json({ items, total, page, pageSize, hasMore: skip + items.length < total, fetchedAt: new Date(), source: 'sqlite', summary: {
      billed: totals._sum.total || 0, collected: totals._sum.totalCobrado || 0, balance: totals._sum.saldo || 0,
    } });
  }));
  router.get('/exports/:section', wrap(async (req, res) => {
    const section = String(req.params.section || '');
    let model; let where; let select; let orderBy;
    if (section === 'clients') {
      model = prisma.client;
      where = searchWhere(req.query, ['nombre', 'aliasNombre', 'usuario', 'telefono', 'ip', 'snOnu', 'zonaNombre'], 'idServicio');
      if (req.query.status) where.estado = String(req.query.status).slice(0, 40);
      if (req.query.zone) where.zonaNombre = String(req.query.zone).slice(0, 200);
      if (req.query.plan) where.planInternetName = String(req.query.plan).slice(0, 200);
      if (req.query.missingIp === 'true') where.AND = [{ OR: [{ ip: null }, { ip: '' }] }];
      select = clientSelect;
      orderBy = [{ nombre: 'asc' }, { idServicio: 'asc' }];
    } else if (section === 'invoices') {
      if (!allowed(req.mobileUser.role, ['cobranza'])) return res.status(403).json({ error: 'Permisos insuficientes', code: 'FORBIDDEN' });
      model = prisma.invoice;
      where = searchWhere(req.query, ['clienteNombre', 'folio', 'clienteUsuario', 'referencia'], 'idFactura');
      if (req.query.clientId) where.clienteIdServicio = positiveId(req.query.clientId);
      if (req.query.status) where.estado = String(req.query.status).slice(0, 40);
      if (req.query.pending === 'true') where.saldo = { gt: 0 };
      if (req.query.zone) where.zonaNombre = String(req.query.zone).slice(0, 200);
      if (req.query.method) where.formaPagoNombre = String(req.query.method).slice(0, 200);
      const { calendarDay } = require('./client-record-service');
      const dateFields = { issued: 'fechaEmision', due: 'fechaVencimiento', paid: 'fechaPago' };
      const field = req.query.dateField || 'issued';
      if (!Object.hasOwn(dateFields, field)) return res.status(400).json({ error: 'Tipo de fecha invalido' });
      if (req.query.from || req.query.to) {
        const from = req.query.from ? calendarDay(req.query.from) : null;
        const to = req.query.to ? calendarDay(req.query.to) : null;
        if (from && to && from > to) return res.status(400).json({ error: 'Rango de fechas invertido' });
        where[dateFields[field]] = { ...(from ? { gte: from.toISOString().slice(0, 10) } : {}), ...(to ? { lt: new Date(to.getTime() + 86400000).toISOString().slice(0, 10) } : {}) };
      }
      select = invoiceSelect;
      orderBy = { idFactura: 'desc' };
    } else {
      return res.status(404).json({ error: 'Exportacion no disponible', code: 'NOT_FOUND' });
    }
    const total = await model.count({ where });
    if (total > 20000) return res.status(413).json({ error: 'La exportacion supera 20,000 registros. Aplica mas filtros.', code: 'EXPORT_TOO_LARGE' });
    const items = await model.findMany({ where, select, orderBy, take: 20000 });
    if (items.length !== total) throw Object.assign(new Error('La exportacion quedo incompleta'), { status: 409, code: 'EXPORT_INCOMPLETE' });
    res.json({ items, total, source: 'sqlite', fetchedAt: new Date() });
  }));
  router.get('/pons', permission(['tecnico']), wrap(async (_req, res) => {
    const groups = await prisma.oltOnu.groupBy({ by: ['rack', 'shelf', 'pon', 'online'], _count: { id: true }, _max: { lastSeenAt: true }, orderBy: [{ rack: 'asc' }, { shelf: 'asc' }, { pon: 'asc' }] });
    const ports = new Map();
    for (const group of groups) {
      const key = `${group.rack}/${group.shelf}/${group.pon}`;
      const port = ports.get(key) || { key, rack: group.rack, shelf: group.shelf, pon: group.pon, online: 0, offline: 0, total: 0, lastSeenAt: null };
      port[group.online ? 'online' : 'offline'] += group._count.id;
      port.total += group._count.id;
      if (!port.lastSeenAt || group._max.lastSeenAt > port.lastSeenAt) port.lastSeenAt = group._max.lastSeenAt;
      ports.set(key, port);
    }
    res.json({ items: [...ports.values()], fetchedAt: new Date(), source: 'sqlite' });
  }));
  router.get('/invoices/:id/document', permission(['cobranza']), wrap(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({ where: { idFactura: positiveId(req.params.id) }, include: { articles: true } });
    if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
    const settings = await prisma.appSetting.findMany({ where: { key: { in: ['companyName', 'companySlogan', 'companyPhone', 'companyAddress', 'rnc'] } } });
    const company = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    res.json(invoiceDocument(invoice, company, String(req.query.paper || 'A4')));
  }));
  router.get('/catalog/:section', wrap(async (req, res) => {
    const definition = Object.hasOwn(catalogs, req.params.section) ? catalogs[req.params.section] : null;
    if (!definition) return res.status(404).json({ error: 'Modulo no disponible' });
    if (!allowed(req.mobileUser.role, definition.roles)) return res.status(403).json({ error: 'Permisos insuficientes' });
    const where = searchWhere(req.query, definition.search, definition.id);
    if (req.params.section === 'onus' && req.query.pon) where.pon = positiveId(req.query.pon);
    if (req.params.section === 'onus' && req.query.rack) where.rack = positiveId(req.query.rack);
    if (req.params.section === 'onus' && req.query.shelf) where.shelf = positiveId(req.query.shelf);
    const result = await pageResult(prisma[definition.model], req.query, { where, select: selectFields(definition.fields), orderBy: { [definition.order]: 'asc' } });
    res.json({ ...result, titleField: definition.title, idField: definition.id });
  }));
  router.use((error, _req, res, _next) => {
    const status = error.status || (['P2002', 'P2034', 'P2028'].includes(error.code) ? 409 : 500);
    res.status(status).json({ error: status === 500 ? 'No se pudo completar la consulta. Intenta de nuevo.' : error.status ? error.message : status === 409 ? 'Conflicto de operacion. Consulta el estado antes de reintentar.' : error.message, code: status === 500 ? 'MOBILE_API_ERROR' : error.status && error.code || 'REQUEST_FAILED' });
  });
  return router;
}

module.exports = { createMobileRouter, allowed, pagination, searchWhere, positiveId, catalogs };
