'use strict';

const { createHash } = require('node:crypto');

const PUBLIC_SETTINGS = new Set(['companyName', 'companySlogan', 'companyPhone', 'companyAddress', 'rnc', 'whatsapp_bot_enabled', 'notifications.lastRunAt', 'ipam.lastScanAt']);
const coordinate = (row) => {
  if (Number.isFinite(row.gpsLat) && Number.isFinite(row.gpsLng)) return { lat: row.gpsLat, lng: row.gpsLng, source: 'technician', accuracy: row.gpsAccuracy, capturedAt: row.gpsCapturedAt };
  const parts = String(row.coordenadas || '').split(/[,\s]+/).filter(Boolean).map(Number);
  if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[0] >= -90 && parts[0] <= 90 && parts[1] >= -180 && parts[1] <= 180) return { lat: parts[0], lng: parts[1], source: 'wisphub', accuracy: null, capturedAt: null };
  return null;
};

function registerMobileOperations(router, { prisma, wrap, permission, pagination, searchWhere }) {
  router.post('/clients/:id/gps', permission(['tecnico']), wrap(async (req, res) => {
    const idServicio = Number(req.params.id);
    const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
    const accuracy = req.body?.accuracy == null || req.body.accuracy === '' ? null : Number(req.body.accuracy);
    const requestKey = String(req.headers['idempotency-key'] || '');
    if (!Number.isSafeInteger(idServicio) || idServicio < 1) throw Object.assign(new Error('Cliente invalido.'), { status: 400, code: 'INVALID_CLIENT' });
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180 || accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 10_000)) {
      throw Object.assign(new Error('Coordenadas o precision invalidas.'), { status: 400, code: 'INVALID_COORDINATES' });
    }
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey)) throw Object.assign(new Error('Falta la clave de operacion.'), { status: 400, code: 'INVALID_IDEMPOTENCY_KEY' });
    const requestHash = createHash('sha256').update(JSON.stringify({ idServicio, lat, lng, accuracy })).digest('hex');
    const key = { userId: req.mobileUser.id, requestKey };
    const response = await prisma.$transaction(async (tx) => {
      const previous = await tx.mobileMutation.findUnique({ where: { userId_requestKey: key } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw Object.assign(new Error('La clave pertenece a otra operacion.'), { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
        return JSON.parse(previous.resultJson);
      }
      const current = await tx.client.findUnique({ where: { idServicio }, select: { idServicio: true, nombre: true, gpsLat: true, gpsLng: true, gpsAccuracy: true } });
      if (!current) throw Object.assign(new Error('Cliente no encontrado.'), { status: 404, code: 'NOT_FOUND' });
      const client = await tx.client.update({ where: { idServicio }, data: { gpsLat: lat, gpsLng: lng, gpsAccuracy: accuracy, gpsCapturedAt: new Date(), gpsCapturedBy: req.mobileUser.username }, select: { idServicio: true, nombre: true, gpsLat: true, gpsLng: true, gpsAccuracy: true, gpsCapturedAt: true, gpsCapturedBy: true } });
      const result = { ok: true, client };
      await tx.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(result) } });
      await tx.activity.create({ data: { action: 'mobile.client.gps', entityType: 'client', entityId: String(idServicio), entityName: current.nombre, details: JSON.stringify({ actor: req.mobileUser.username, before: { lat: current.gpsLat, lng: current.gpsLng, accuracy: current.gpsAccuracy }, after: { lat, lng, accuracy } }) } });
      return result;
    });
    res.json(response);
  }));

  router.get('/map/clients', permission(['tecnico']), wrap(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const where = searchWhere(req.query, ['nombre', 'aliasNombre', 'usuario', 'ip', 'zonaNombre', 'direccion'], 'idServicio');
    if (req.query.status) where.estado = String(req.query.status).slice(0, 40);
    const candidates = await prisma.client.findMany({ where: { ...where, OR: where.OR ? where.OR : [{ gpsLat: { not: null } }, { coordenadas: { not: null } }] }, select: { idServicio: true, nombre: true, aliasNombre: true, usuario: true, telefono: true, ip: true, planInternetName: true, estado: true, estadoFacturas: true, zonaNombre: true, direccion: true, gpsLat: true, gpsLng: true, gpsAccuracy: true, gpsCapturedAt: true, coordenadas: true }, orderBy: { nombre: 'asc' } });
    // When a search is present, the OR belongs to search. Coordinate validation below remains authoritative.
    const items = candidates.map((client) => ({ client, point: coordinate(client) })).filter((row) => row.point).map(({ client, point }) => ({ idServicio: client.idServicio, name: client.aliasNombre || client.nombre, username: client.usuario, phone: client.telefono, ip: client.ip, plan: client.planInternetName, status: client.estado, invoiceStatus: client.estadoFacturas, zone: client.zonaNombre, address: client.direccion, ...point }));
    const total = items.length;
    res.json({ items: items.slice(skip, skip + take), total, page, pageSize, hasMore: skip + take < total, source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/system/status', permission(['tecnico', 'cobranza', 'viewer']), wrap(async (_req, res) => {
    const [settings, lastClient, lastInvoice, lastWan, lastOlt, lastIpam, mobileSessions] = await prisma.$transaction([
      prisma.appSetting.findMany({ where: { key: { in: [...PUBLIC_SETTINGS] } }, select: { key: true, value: true } }),
      prisma.client.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
      prisma.invoice.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
      prisma.wanNetworkSample.findFirst({ orderBy: { capturedAt: 'desc' }, select: { capturedAt: true, healthState: true, mikrotikConnected: true } }),
      prisma.oltSnapshot.findFirst({ orderBy: { capturedAt: 'desc' }, select: { capturedAt: true, status: true, errorMessage: true } }),
      prisma.ipamNetwork.findFirst({ orderBy: { lastChangedAt: 'desc' }, select: { lastChangedAt: true } }),
      prisma.mobileSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    res.json({ company: Object.fromEntries(settings.filter((row) => ['companyName', 'companySlogan', 'companyPhone', 'companyAddress', 'rnc'].includes(row.key)).map((row) => [row.key, row.value])), settings: Object.fromEntries(settings.filter((row) => !['companyName', 'companySlogan', 'companyPhone', 'companyAddress', 'rnc'].includes(row.key)).map((row) => [row.key, row.value])), integrations: { wisphub: { lastClientSyncAt: lastClient?.syncedAt || null, lastInvoiceSyncAt: lastInvoice?.syncedAt || null }, mikrotik: lastWan || null, olt: lastOlt || null, ipam: { lastChangedAt: lastIpam?.lastChangedAt || null }, mobileSessions }, source: 'sqlite', fetchedAt: new Date() });
  }));
}

module.exports = { registerMobileOperations, coordinate, PUBLIC_SETTINGS };
