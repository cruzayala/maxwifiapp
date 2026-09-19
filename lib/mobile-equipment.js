'use strict';
const { createHash } = require('node:crypto');
const { statuses, validateEquipment, validateAssignment, presentEquipment, changeEquipment } = require('./equipment-service');

function registerMobileEquipment(router, { prisma, wrap, permission, pagination, positiveId, searchWhere }) {
  router.get('/equipment/types', permission([]), wrap(async (req, res) => {
    const where = { ...searchWhere(req.query, ['name'], 'id'), unit: 'u' };
    const { page, pageSize, skip, take } = pagination(req.query);
    const [total, items] = await prisma.$transaction([prisma.equipmentType.count({ where }), prisma.equipmentType.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip, take })]);
    res.json({ items, total, page, pageSize, hasMore: skip + items.length < total, fetchedAt: new Date() });
  }));
  router.get('/equipment', permission([]), wrap(async (req, res) => {
    const where = searchWhere(req.query, ['serialNumber', 'macAddress', 'brand', 'model'], 'id');
    if (req.query.status) {
      if (!statuses.includes(req.query.status)) throw Object.assign(new Error('Estado invalido.'), { status: 400 });
      where.status = req.query.status;
    }
    if (req.query.clientId) where.assignedToClientId = positiveId(req.query.clientId);
    if (req.query.typeId) where.typeId = positiveId(req.query.typeId);
    const { page, pageSize, skip, take } = pagination(req.query);
    const [total, rows, sums, groups] = await prisma.$transaction([
      prisma.equipment.count({ where }), prisma.equipment.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      prisma.equipment.aggregate({ where, _sum: { unitCost: true } }), prisma.equipment.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);
    const types = await prisma.equipmentType.findMany({ where: { id: { in: [...new Set(rows.map(r => r.typeId))] } }, select: { id: true, name: true } });
    const clients = await prisma.client.findMany({ where: { idServicio: { in: [...new Set(rows.map(r => r.assignedToClientId).filter(Boolean))] } }, select: { idServicio: true, nombre: true } });
    res.json({ items: rows.map(row => ({ ...presentEquipment(row), typeName: types.find(t => t.id === row.typeId)?.name, clientName: clients.find(c => c.idServicio === row.assignedToClientId)?.nombre })),
      total, page, pageSize, hasMore: skip + rows.length < total, summary: { cost: sums._sum.unitCost || 0, byStatus: Object.fromEntries(groups.map(g => [g.status, g._count._all])) }, fetchedAt: new Date() });
  }));
  router.get('/equipment/:id', permission([]), wrap(async (req, res) => {
    const id = positiveId(req.params.id);
    const row = await prisma.equipment.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: 'Equipo no encontrado' });
    const type = await prisma.equipmentType.findUnique({ where: { id: row.typeId }, select: { name: true } });
    const client = row.assignedToClientId ? await prisma.client.findUnique({ where: { idServicio: row.assignedToClientId }, select: { nombre: true } }) : null;
    const history = await prisma.activity.findMany({ where: { entityType: 'equipment', entityId: String(id) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50, select: { id: true, action: true, createdAt: true, details: true } });
    res.json({ ...presentEquipment(row), typeName: type?.name, clientName: client?.nombre,
      history: history.map(h => { const d = (() => { try { return JSON.parse(h.details || '{}'); } catch { return {}; } })();
        return { id: h.id, action: h.action, createdAt: h.createdAt, actor: d.actor || null, fromClient: d.before?.assignedToClientId || null, toClient: d.after?.assignedToClientId || d.clientId || null }; }), fetchedAt: new Date() });
  }));
  async function mutate(req, operation) {
    const id = operation === 'create' ? null : positiveId(req.params.id);
    const data = operation === 'assign' ? validateAssignment(req.body) : ['create', 'update'].includes(operation) ? validateEquipment(req.body, !!id) : {};
    const requestKey = String(req.headers['idempotency-key'] || '');
    const expectedVersion = String(req.headers['if-match'] || '');
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey) || id && !/^[a-f0-9]{64}$/.test(expectedVersion)) throw Object.assign(new Error('Falta la clave de operacion o version del equipo.'), { status: 400 });
    const requestHash = createHash('sha256').update(JSON.stringify({ module: 'equipment', operation, id, data, expectedVersion })).digest('hex');
    const key = { userId: req.mobileUser.id, requestKey };
    return prisma.$transaction(async tx => {
      const old = await tx.mobileMutation.findUnique({ where: { userId_requestKey: key } });
      if (old) {
        if (old.requestHash !== requestHash) throw Object.assign(new Error('La clave pertenece a otra operacion.'), { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
        return JSON.parse(old.resultJson);
      }
      const result = await changeEquipment(tx, { id, data, operation, expectedVersion, actor: req.mobileUser.username });
      await tx.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(result) } });
      return result;
    });
  }
  router.post('/equipment', permission([]), wrap(async (req, res) => res.status(201).json(await mutate(req, 'create'))));
  router.patch('/equipment/:id', permission([]), wrap(async (req, res) => res.json(await mutate(req, 'update'))));
  router.post('/equipment/:id/assign', permission([]), wrap(async (req, res) => res.json(await mutate(req, 'assign'))));
  router.post('/equipment/:id/return', permission([]), wrap(async (req, res) => res.json(await mutate(req, 'return'))));
  router.delete('/equipment/:id', permission([]), wrap(async (req, res) => res.json(await mutate(req, 'delete'))));
}
module.exports = { registerMobileEquipment };
