'use strict';

const parseJson = (value, fallback = null) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};

function registerMobileOlt(router, { prisma, wrap, permission, pagination, positiveId, searchWhere }) {
  router.get('/olt/status', permission(['tecnico']), wrap(async (_req, res) => {
    const [latest, total, online, linked, pending, alarms, signalAlerts] = await prisma.$transaction([
      prisma.oltSnapshot.findFirst({ orderBy: { capturedAt: 'desc' } }), prisma.oltOnu.count(),
      prisma.oltOnu.count({ where: { online: true } }), prisma.oltOnu.count({ where: { clientIdServicio: { not: null } } }),
      prisma.oltUnconfiguredOnu.count({ where: { active: true } }), prisma.oltAlarm.count({ where: { active: true } }),
      prisma.oltSignalAlert.count({ where: { active: true } }),
    ]);
    res.json({ latest, totals: { total, online, offline: total - online, linked, unlinked: total - linked, pending, alarms, signalAlerts }, source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/olt/onus', permission(['tecnico']), wrap(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const where = searchWhere(req.query, ['onuIndex', 'name', 'model', 'serial'], 'id');
    if (req.query.pon) where.pon = positiveId(req.query.pon);
    if (req.query.rack) where.rack = positiveId(req.query.rack);
    if (req.query.shelf) where.shelf = positiveId(req.query.shelf);
    const status = String(req.query.status || 'all');
    if (!['all', 'online', 'offline'].includes(status)) throw Object.assign(new Error('Estado ONU invalido.'), { status: 400, code: 'INVALID_ONU_FILTER' });
    if (status !== 'all') where.online = status === 'online';
    const mapping = String(req.query.mapping || 'all');
    if (!['all', 'linked', 'unlinked'].includes(mapping)) throw Object.assign(new Error('Filtro de asociacion invalido.'), { status: 400, code: 'INVALID_ONU_FILTER' });
    if (mapping === 'linked') where.clientIdServicio = { not: null };
    if (mapping === 'unlinked') where.clientIdServicio = null;
    const [total, rows] = await prisma.$transaction([
      prisma.oltOnu.count({ where }), prisma.oltOnu.findMany({ where, orderBy: [{ rack: 'asc' }, { shelf: 'asc' }, { pon: 'asc' }, { onuId: 'asc' }], skip, take }),
    ]);
    const ids = [...new Set(rows.map((row) => row.clientIdServicio).filter(Number.isInteger))];
    const clients = ids.length ? await prisma.client.findMany({ where: { idServicio: { in: ids } }, select: { idServicio: true, nombre: true, aliasNombre: true, usuario: true, telefono: true, ip: true, planInternetName: true, estado: true } }) : [];
    const byId = new Map(clients.map((client) => [client.idServicio, client]));
    res.json({ items: rows.map((row) => ({ ...row, client: row.clientIdServicio ? byId.get(row.clientIdServicio) || null : null })), total, page, pageSize, hasMore: skip + rows.length < total, source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/olt/onus/:id', permission(['tecnico']), wrap(async (req, res) => {
    const id = positiveId(req.params.id);
    const onu = await prisma.oltOnu.findUnique({ where: { id } });
    if (!onu) return res.status(404).json({ error: 'ONU no encontrada', code: 'ONU_NOT_FOUND' });
    const [client, opticalHistory, alerts, tr069] = await prisma.$transaction([
      onu.clientIdServicio == null ? prisma.client.findFirst({ where: { idServicio: -1 }, select: { idServicio: true } }) : prisma.client.findUnique({ where: { idServicio: onu.clientIdServicio }, select: { idServicio: true, nombre: true, aliasNombre: true, usuario: true, telefono: true, ip: true, snOnu: true, planInternetName: true, estado: true, estadoFacturas: true } }),
      prisma.oltOpticalReading.findMany({ where: { onuIndex: onu.onuIndex }, orderBy: { capturedAt: 'desc' }, take: 120 }),
      prisma.oltSignalAlert.findMany({ where: { onuIndex: onu.onuIndex }, orderBy: [{ active: 'desc' }, { lastSeenAt: 'desc' }], take: 100 }),
      onu.serial ? prisma.tr069Device.findUnique({ where: { serial: onu.serial }, select: { id: true, serial: true, onuIndex: true, enabled: true, status: true, acsDeviceId: true, manufacturer: true, model: true, softwareVersion: true, lastInformAt: true, lastAgentAt: true, capabilitiesJson: true } }) : prisma.tr069Device.findFirst({ where: { id: -1 }, select: { id: true } }),
    ]);
    res.json({ onu, client, opticalHistory: opticalHistory.reverse(), alerts, tr069: tr069 ? { ...tr069, capabilitiesJson: undefined, capabilities: parseJson(tr069.capabilitiesJson, {}) } : null, source: 'sqlite', fetchedAt: new Date(), operations: { enabled: false, reason: 'Las operaciones OLT moviles requieren ejecucion compartida y verificacion posterior.' } });
  }));

  router.get('/olt/unconfigured', permission(['tecnico']), wrap(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const where = { active: true, ...searchWhere(req.query, ['serial', 'ponIndex', 'authorizationReason'], 'id') };
    const [total, items] = await prisma.$transaction([prisma.oltUnconfiguredOnu.count({ where }), prisma.oltUnconfiguredOnu.findMany({ where, orderBy: { lastSeenAt: 'desc' }, skip, take })]);
    res.json({ items, total, page, pageSize, hasMore: skip + items.length < total, source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/olt/alarms', permission(['tecnico']), wrap(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const active = req.query.active !== 'false';
    const where = { ...(active ? { active: true } : {}), ...searchWhere(req.query, ['alarmId', 'code', 'level', 'description']) };
    const [total, items] = await prisma.$transaction([prisma.oltAlarm.count({ where }), prisma.oltAlarm.findMany({ where, orderBy: [{ active: 'desc' }, { lastSeenAt: 'desc' }], skip, take })]);
    res.json({ items, total, page, pageSize, hasMore: skip + items.length < total, source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/olt/activity', permission(['tecnico']), wrap(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const where = { entityType: 'olt', ...searchWhere(req.query, ['action', 'entityName', 'entityId']) };
    const [total, rows] = await prisma.$transaction([prisma.activity.count({ where }), prisma.activity.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take })]);
    res.json({ items: rows.map((row) => ({ ...row, details: parseJson(row.details, {}) })), total, page, pageSize, hasMore: skip + rows.length < total, source: 'sqlite', fetchedAt: new Date() });
  }));
}

module.exports = { registerMobileOlt };
