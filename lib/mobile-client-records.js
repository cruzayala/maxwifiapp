'use strict';

const { createHash } = require('node:crypto');
const { aliasSelect, presentAlias, presentPromise, validateAlias, validatePromise, changeAlias, changePromise, calendarDay } = require('./client-record-service');

function registerMobileClientRecords(router, { prisma, wrap, permission, pagination, positiveId, searchWhere }) {
  async function mutate(req, kind) {
    const id = req.params.id ? positiveId(req.params.id) : null;
    const data = kind === 'alias' ? validateAlias(req.body) : validatePromise(req.body, !!id);
    const requestKey = String(req.headers['idempotency-key'] || '');
    const expectedVersion = String(req.headers['if-match'] || '');
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey) || id && !/^[a-f0-9]{64}$/.test(expectedVersion)) throw Object.assign(new Error('Falta clave de operacion o version.'), { status: 400 });
    const requestHash = createHash('sha256').update(JSON.stringify({ kind, id, data, expectedVersion })).digest('hex');
    const key = { userId: req.mobileUser.id, requestKey };
    return prisma.$transaction(async tx => {
      const old = await tx.mobileMutation.findUnique({ where: { userId_requestKey: key } });
      if (old) {
        if (old.requestHash !== requestHash) throw Object.assign(new Error('Clave usada para otra operacion.'), { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
        return JSON.parse(old.resultJson);
      }
      const result = await (kind === 'alias' ? changeAlias : changePromise)(tx, { id, data, expectedVersion, actor: req.mobileUser.username });
      await tx.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(result) } });
      return result;
    });
  }
  router.get('/clients/:id/record', permission(['tecnico', 'cobranza']), wrap(async (req, res) => {
    const row = await prisma.client.findUnique({ where: { idServicio: positiveId(req.params.id) }, select: aliasSelect });
    if (!row) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(presentAlias(row));
  }));
  router.patch('/clients/:id/record', permission(['tecnico', 'cobranza']), wrap(async (req, res) => res.json(await mutate(req, 'alias'))));
  router.get('/clients/:id/history', permission(['tecnico', 'cobranza']), wrap(async (req, res) => {
    const id = positiveId(req.params.id);
    const { page, pageSize, skip, take } = pagination(req.query);
    const actions = ['client_alias_updated', 'mobile.client.note', 'client_provisioned', 'client_created'];
    if (['admin', 'super_admin', 'cobranza'].includes(req.mobileUser.role)) actions.push('payment_promise_created', 'payment_promise_updated');
    const where = { entityType: 'client', entityId: String(id), action: { in: actions } };
    const [total, rows] = await prisma.$transaction([prisma.activity.count({ where }), prisma.activity.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take })]);
    res.json({ items: rows.map(row => {
      let details = {}; try { details = JSON.parse(row.details || '{}'); } catch {}
      return { id: row.id, action: row.action, createdAt: row.createdAt, actor: typeof details.actor === 'string' ? details.actor : null,
        fields: Array.isArray(details.fields) ? details.fields.filter(f => ['aliasNombre', 'aliasCedula', 'aliasTelefono', 'aliasNotas'].includes(f)) : [],
        promiseId: Number.isSafeInteger(details.promiseId) ? details.promiseId : null };
    }), total, page, pageSize, hasMore: skip + rows.length < total, fetchedAt: new Date() });
  }));
  router.get('/promises', permission(['cobranza']), wrap(async (req, res) => {
    const where = searchWhere(req.query, ['clientName', 'notes'], 'id');
    if (req.query.clientId) where.idServicio = positiveId(req.query.clientId);
    if (req.query.status) {
      if (!['pending', 'paid', 'broken'].includes(req.query.status)) return res.status(400).json({ error: 'Estado invalido' });
      where.status = req.query.status;
    }
    const today = calendarDay(new Date().toISOString().slice(0, 10));
    if (req.query.overdue === 'true') { where.status = 'pending'; where.promisedDate = { lt: today }; }
    const { page, pageSize, skip, take } = pagination(req.query);
    const [total, rows, sum] = await prisma.$transaction([
      prisma.paymentPromise.count({ where }), prisma.paymentPromise.findMany({ where, orderBy: [{ promisedDate: 'asc' }, { id: 'asc' }], skip, take }),
      prisma.paymentPromise.aggregate({ where, _sum: { amount: true } }),
    ]);
    res.json({ items: rows.map(presentPromise), total, page, pageSize, hasMore: skip + rows.length < total, summary: { amount: sum._sum.amount || 0 }, fetchedAt: new Date() });
  }));
  router.get('/promises/:id', permission(['cobranza']), wrap(async (req, res) => {
    const row = await prisma.paymentPromise.findUnique({ where: { id: positiveId(req.params.id) } });
    if (!row) return res.status(404).json({ error: 'Promesa no encontrada' });
    res.json(presentPromise(row));
  }));
  router.post('/promises', permission(['cobranza']), wrap(async (req, res) => res.status(201).json(await mutate(req, 'promise'))));
  router.patch('/promises/:id', permission(['cobranza']), wrap(async (req, res) => res.json(await mutate(req, 'promise'))));
}

module.exports = { registerMobileClientRecords };
