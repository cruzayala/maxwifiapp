'use strict';

const { createHash } = require('node:crypto');
const { isIP } = require('node:net');
const { parseAffectedClientIds } = require('./noc-incidents');

const fail = (message, status = 400, code = 'INVALID_NETWORK_DATA') => {
  throw Object.assign(new Error(message), { status, code });
};
const incidentVersion = (row) => createHash('sha256').update(JSON.stringify({
  id: row.id, status: row.status, severity: row.severity, assignedTo: row.assignedTo,
  acknowledgedAt: row.acknowledgedAt, resolvedAt: row.resolvedAt, resolutionNote: row.resolutionNote,
  affectedClients: row.affectedClients, updatedAt: row.updatedAt,
})).digest('hex');
const presentIncident = (row) => ({ ...row, affectedClientIds: undefined, version: incidentVersion(row) });
const boundedInt = (value, fallback, min, max, label) => {
  const parsed = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) fail(`${label} invalido.`);
  return parsed;
};
const jsonList = (value) => {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
};

function aggregateClientDaily(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.idServicio) || {
      idServicio: row.idServicio, sampleCount: 0, onlineSamples: 0, stableSamples: 0,
      degradedSamples: 0, offlineSamples: 0, uploadBpsSum: 0, downloadBpsSum: 0,
      peakUploadBps: 0, peakDownloadBps: 0, rxPowerSum: 0, rxPowerSamples: 0,
      minRxPowerDbm: null, maxRxPowerDbm: null, latest: null,
    };
    for (const field of ['sampleCount', 'onlineSamples', 'stableSamples', 'degradedSamples', 'offlineSamples', 'uploadBpsSum', 'downloadBpsSum', 'rxPowerSum', 'rxPowerSamples']) current[field] += row[field] || 0;
    current.peakUploadBps = Math.max(current.peakUploadBps, row.peakUploadBps || 0);
    current.peakDownloadBps = Math.max(current.peakDownloadBps, row.peakDownloadBps || 0);
    if (row.minRxPowerDbm != null) current.minRxPowerDbm = current.minRxPowerDbm == null ? row.minRxPowerDbm : Math.min(current.minRxPowerDbm, row.minRxPowerDbm);
    if (row.maxRxPowerDbm != null) current.maxRxPowerDbm = current.maxRxPowerDbm == null ? row.maxRxPowerDbm : Math.max(current.maxRxPowerDbm, row.maxRxPowerDbm);
    if (!current.latest || new Date(row.lastCapturedAt) > new Date(current.latest.lastCapturedAt)) current.latest = row;
    grouped.set(row.idServicio, current);
  }
  return grouped;
}

function registerMobileNetwork(router, { prisma, wrap, permission, pagination, positiveId, searchWhere, liveNetwork, mikrotikOverview, mikrotikPing }) {
  if (liveNetwork) router.get('/network/live', permission(['tecnico']), wrap(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const query = String(req.query.q || '').trim().toLocaleLowerCase('es').slice(0, 120);
    const state = String(req.query.state || 'all');
    const sort = String(req.query.sort || 'traffic');
    if (!['all', 'online', 'offline', 'transmitting', 'differences', 'disabled'].includes(state)) fail('Estado en vivo invalido.');
    if (!['traffic', 'name', 'zone', 'status'].includes(sort)) fail('Orden en vivo invalido.');
    const snapshot = await liveNetwork();
    const source = Array.isArray(snapshot?.clients) ? snapshot.clients : [];
    let rows = source.map((row) => ({
      idServicio: Number(row.client?.id) || null,
      name: String(row.client?.name || row.queueName || row.ip || 'Sin nombre').slice(0, 300),
      username: row.client?.username ? String(row.client.username).slice(0, 300) : null,
      ip: row.ip ? String(row.ip).slice(0, 80) : null,
      plan: row.client?.plan ? String(row.client.plan).slice(0, 200) : null,
      zone: row.client?.zone ? String(row.client.zone).slice(0, 200) : null,
      clientStatus: row.client?.status ? String(row.client.status).slice(0, 80) : null,
      invoiceStatus: row.client?.invoiceStatus ? String(row.client.invoiceStatus).slice(0, 100) : null,
      queueName: row.queueName ? String(row.queueName).slice(0, 300) : null,
      uploadBps: Number(row.uploadBps) || 0,
      downloadBps: Number(row.downloadBps) || 0,
      maxUploadBps: Number(row.maxUploadBps) || 0,
      maxDownloadBps: Number(row.maxDownloadBps) || 0,
      uploadPercent: Number(row.uploadPct) || 0,
      downloadPercent: Number(row.downloadPct) || 0,
      online: Boolean(row.isOnline), transmitting: Boolean(row.isTransmitting), disabled: Boolean(row.isDisabled),
      interface: row.interface ? String(row.interface).slice(0, 120) : null,
      macAddress: row.macAddress ? String(row.macAddress).slice(0, 40) : null,
      sessionUptime: row.sessionUptime ? String(row.sessionUptime).slice(0, 80) : null,
      syncState: String(row.syncState || 'unknown').slice(0, 80),
    }));
    if (query) rows = rows.filter((row) => [row.name, row.username, row.ip, row.zone, row.queueName].some((value) => String(value || '').toLocaleLowerCase('es').includes(query)));
    if (state === 'online') rows = rows.filter((row) => row.online);
    if (state === 'offline') rows = rows.filter((row) => !row.online);
    if (state === 'transmitting') rows = rows.filter((row) => row.transmitting);
    if (state === 'differences') rows = rows.filter((row) => row.syncState !== 'synced');
    if (state === 'disabled') rows = rows.filter((row) => row.disabled);
    const comparison = {
      traffic: (a, b) => b.uploadBps + b.downloadBps - a.uploadBps - a.downloadBps,
      name: (a, b) => a.name.localeCompare(b.name, 'es'),
      zone: (a, b) => String(a.zone || '').localeCompare(String(b.zone || ''), 'es') || a.name.localeCompare(b.name, 'es'),
      status: (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'es'),
    }[sort];
    rows.sort(comparison);
    const total = rows.length;
    res.json({
      items: rows.slice(skip, skip + take), total, page, pageSize, hasMore: skip + take < total,
      summary: {
        totalClients: Number(snapshot?.stats?.totalClients) || source.length,
        onlineClients: Number(snapshot?.stats?.onlineClients) || 0,
        offlineClients: Number(snapshot?.stats?.offlineClients) || 0,
        transmittingClients: Number(snapshot?.stats?.transmittingClients) || 0,
        differences: Number(snapshot?.stats?.differences) || 0,
        disabledQueues: Number(snapshot?.stats?.disabledQueues) || 0,
        totalUploadBps: Number(snapshot?.stats?.totalUploadBps) || 0,
        totalDownloadBps: Number(snapshot?.stats?.totalDownloadBps) || 0,
      },
      sampledAt: snapshot?.timestamp || new Date(), source: 'mikrotik_shared_snapshot', fetchedAt: new Date(),
    });
  }));

  if (mikrotikOverview) router.get('/mikrotik/summary', permission(['tecnico']), wrap(async (_req, res) => {
    const snapshot = await mikrotikOverview();
    res.json({ ...snapshot, source: 'mikrotik_shared_cache', fetchedAt: new Date() });
  }));

  if (mikrotikPing) router.post('/mikrotik/ping', permission(['tecnico']), wrap(async (req, res) => {
    const address = String(req.body?.address || '').trim();
    const count = boundedInt(req.body?.count, 4, 1, 5, 'Cantidad de paquetes');
    if (isIP(address) === 0) fail('Introduce una direccion IP valida.', 400, 'INVALID_PING_ADDRESS');
    const result = await mikrotikPing({ address, count });
    if (result?.address !== address || result?.sent !== count || !Number.isFinite(result?.received)) {
      fail('MikroTik no confirmo el diagnostico.', 502, 'INVALID_MIKROTIK_RESPONSE');
    }
    await prisma.activity.create({ data: {
      action: 'mobile.mikrotik.ping', entityType: 'mikrotik', entityId: address,
      details: JSON.stringify({ actor: req.mobileUser.username, count, received: result.received, lossPercent: result.lossPercent }),
    } });
    res.json({ ...result, verified: true, source: 'mikrotik_live', fetchedAt: new Date() });
  }));

  router.get('/network/summary', permission(['tecnico']), wrap(async (_req, res) => {
    const since = new Date(Date.now() - 15 * 60_000);
    const [open, acknowledged, critical, affected, wan, lastScan, clientsObserved, onus, onusOnline] = await prisma.$transaction([
      prisma.networkIncident.count({ where: { status: 'open' } }),
      prisma.networkIncident.count({ where: { status: 'acknowledged' } }),
      prisma.networkIncident.count({ where: { status: { in: ['open', 'acknowledged'] }, severity: 'critical' } }),
      prisma.networkIncident.aggregate({ where: { status: { in: ['open', 'acknowledged'] } }, _sum: { affectedClients: true } }),
      prisma.wanNetworkSample.findFirst({ orderBy: { capturedAt: 'desc' } }),
      prisma.networkScan.findFirst({ orderBy: { startedAt: 'desc' } }),
      prisma.clientNetworkSample.count({ where: { capturedAt: { gte: since } } }),
      prisma.oltOnu.count(),
      prisma.oltOnu.count({ where: { online: true } }),
    ]);
    res.json({ incidents: { open, acknowledged, critical, affectedClients: affected._sum.affectedClients || 0 },
      wan, lastScan, clientsObserved, onus: { total: onus, online: onusOnline, offline: onus - onusOnline },
      source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/network/wan', permission(['tecnico']), wrap(async (req, res) => {
    const hours = Number(req.query.hours || 24);
    if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 31) fail('Rango WAN invalido.');
    const since = new Date(Date.now() - hours * 3_600_000);
    const rows = await prisma.wanNetworkSample.findMany({ where: { capturedAt: { gte: since } }, orderBy: { capturedAt: 'asc' }, take: 5000 });
    const peakRxBps = rows.reduce((max, row) => Math.max(max, row.rxBps || 0), 0);
    const peakTxBps = rows.reduce((max, row) => Math.max(max, row.txBps || 0), 0);
    const avgRxBps = rows.length ? rows.reduce((sum, row) => sum + (row.rxBps || 0), 0) / rows.length : 0;
    const avgTxBps = rows.length ? rows.reduce((sum, row) => sum + (row.txBps || 0), 0) / rows.length : 0;
    res.json({ items: rows, summary: { peakRxBps, peakTxBps, avgRxBps, avgTxBps, samples: rows.length }, hours, fetchedAt: new Date(), source: 'sqlite' });
  }));

  router.get('/network/audit/status', permission(['tecnico']), wrap(async (_req, res) => {
    const [clientSamples, dailyRows, wanSamples, latestClient, latestWan] = await prisma.$transaction([
      prisma.clientNetworkSample.count(), prisma.clientNetworkDaily.count(), prisma.wanNetworkSample.count(),
      prisma.clientNetworkSample.findFirst({ orderBy: { capturedAt: 'desc' }, select: { capturedAt: true } }),
      prisma.wanNetworkSample.findFirst({ orderBy: { capturedAt: 'desc' } }),
    ]);
    res.json({ clientSamples, dailyRows, wanSamples, latestClientAt: latestClient?.capturedAt || null, latestWan, source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/network/audit/clients', permission(['tecnico']), wrap(async (req, res) => {
    const days = boundedInt(req.query.days, 30, 1, 3650, 'Rango de dias');
    const { page, pageSize, skip, take } = pagination(req.query);
    const search = String(req.query.q || '').trim().slice(0, 120);
    const state = String(req.query.state || 'all');
    if (!['all', 'stable', 'degraded', 'offline', 'unknown'].includes(state)) fail('Estado de red invalido.');
    const cutoff = new Date(Date.now() - (days - 1) * 86_400_000);
    cutoff.setUTCHours(0, 0, 0, 0);
    const clients = await prisma.client.findMany({
      where: search ? { OR: [
        { nombre: { contains: search } }, { aliasNombre: { contains: search } }, { usuario: { contains: search } },
        { ip: { contains: search } }, { zonaNombre: { contains: search } },
      ] } : {},
      select: { idServicio: true, nombre: true, aliasNombre: true, usuario: true, ip: true, planInternetName: true, zonaNombre: true, estado: true },
    });
    const byId = new Map(clients.map((client) => [client.idServicio, client]));
    const daily = clients.length ? await prisma.clientNetworkDaily.findMany({
      where: { day: { gte: cutoff }, idServicio: { in: clients.map((client) => client.idServicio) } }, orderBy: { day: 'asc' },
    }) : [];
    let items = [...aggregateClientDaily(daily).values()].map((row) => {
      const client = byId.get(row.idServicio); const samples = Math.max(1, row.sampleCount); const latest = row.latest || {};
      return {
        idServicio: row.idServicio, name: client?.aliasNombre || client?.nombre || `Cliente ${row.idServicio}`,
        username: client?.usuario || null, ip: client?.ip || null, plan: client?.planInternetName || null,
        zone: client?.zonaNombre || null, clientStatus: client?.estado || null, sampleCount: row.sampleCount,
        availabilityPercent: Number((row.onlineSamples / samples * 100).toFixed(2)),
        stabilityPercent: Number((row.stableSamples / samples * 100).toFixed(2)),
        degradedSamples: row.degradedSamples, offlineSamples: row.offlineSamples,
        avgUploadMbps: Number((row.uploadBpsSum / samples / 1e6).toFixed(3)),
        avgDownloadMbps: Number((row.downloadBpsSum / samples / 1e6).toFixed(3)),
        peakUploadMbps: Number((row.peakUploadBps / 1e6).toFixed(3)), peakDownloadMbps: Number((row.peakDownloadBps / 1e6).toFixed(3)),
        avgRxPowerDbm: row.rxPowerSamples ? Number((row.rxPowerSum / row.rxPowerSamples).toFixed(2)) : null,
        minRxPowerDbm: row.minRxPowerDbm, maxRxPowerDbm: row.maxRxPowerDbm,
        latestState: latest.lastHealthState || 'unknown', latestOnline: latest.lastServiceOnline || false,
        latestUploadMbps: Number(((latest.lastUploadBps || 0) / 1e6).toFixed(3)), latestDownloadMbps: Number(((latest.lastDownloadBps || 0) / 1e6).toFixed(3)),
        latestRxPowerDbm: latest.lastRxPowerDbm ?? null, opticalState: latest.lastOpticalState || 'unknown', onuIndex: latest.lastOnuIndex || null,
        lastCapturedAt: latest.lastCapturedAt || null,
      };
    });
    if (state !== 'all') items = items.filter((item) => item.latestState === state);
    const order = { offline: 0, degraded: 1, stable: 2, unknown: 3 };
    items.sort((a, b) => (order[a.latestState] ?? 4) - (order[b.latestState] ?? 4) || a.stabilityPercent - b.stabilityPercent || a.name.localeCompare(b.name));
    const totals = items.reduce((sum, item) => ({ samples: sum.samples + item.sampleCount, online: sum.online + item.sampleCount * item.availabilityPercent / 100, stable: sum.stable + item.sampleCount * item.stabilityPercent / 100, attention: sum.attention + (item.latestState === 'stable' ? 0 : 1) }), { samples: 0, online: 0, stable: 0, attention: 0 });
    const total = items.length;
    res.json({ days, items: items.slice(skip, skip + take), total, page, pageSize, hasMore: skip + take < total,
      summary: { monitoredClients: total, attentionClients: totals.attention, availabilityPercent: totals.samples ? Number((totals.online / totals.samples * 100).toFixed(2)) : 0, stabilityPercent: totals.samples ? Number((totals.stable / totals.samples * 100).toFixed(2)) : 0, totalSamples: totals.samples },
      source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/network/audit/clients/:id', permission(['tecnico']), wrap(async (req, res) => {
    const idServicio = positiveId(req.params.id);
    const days = boundedInt(req.query.days, 7, 1, 90, 'Rango de dias');
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const [client, samples, daily] = await prisma.$transaction([
      prisma.client.findUnique({ where: { idServicio }, select: { idServicio: true, nombre: true, aliasNombre: true, usuario: true, ip: true, planInternetName: true, zonaNombre: true } }),
      prisma.clientNetworkSample.findMany({ where: { idServicio, capturedAt: { gte: cutoff } }, orderBy: { capturedAt: 'desc' }, take: 2500 }),
      prisma.clientNetworkDaily.findMany({ where: { idServicio }, orderBy: { day: 'desc' }, take: 365 }),
    ]);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado', code: 'CLIENT_NOT_FOUND' });
    res.json({ client, samples, daily, days, source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/ipam/networks', permission(['tecnico']), wrap(async (_req, res) => {
    const items = await prisma.ipamNetwork.findMany({ orderBy: [{ utilization: 'desc' }, { cidr: 'asc' }] });
    const totals = items.reduce((sum, row) => ({ capacity: sum.capacity + row.capacity, used: sum.used + row.used, available: sum.available + row.available }), { capacity: 0, used: 0, available: 0 });
    res.json({ items: items.map((row) => ({ ...row, recommended: jsonList(row.recommended) })), summary: { ...totals, utilization: totals.capacity ? Number((totals.used / totals.capacity * 100).toFixed(2)) : 0 }, source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/ipam/addresses', permission(['tecnico']), wrap(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const where = searchWhere(req.query, ['ip', 'macAddress', 'clientName', 'clientUsername', 'queueName', 'hostName']);
    if (req.query.cidr) where.cidr = String(req.query.cidr).slice(0, 50);
    if (req.query.classification) where.classification = String(req.query.classification).slice(0, 50);
    if (req.query.available === 'true') where.available = true;
    if (req.query.conflict === 'true') where.conflict = true;
    where.active = true;
    const [total, items] = await prisma.$transaction([
      prisma.ipamAddress.count({ where }), prisma.ipamAddress.findMany({ where, orderBy: [{ recommended: 'desc' }, { available: 'desc' }, { ip: 'asc' }], skip, take }),
    ]);
    res.json({ items: items.map((row) => ({ ...row, sources: jsonList(row.sources), macAddresses: jsonList(row.macAddresses) })), total, page, pageSize, hasMore: skip + items.length < total, source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/incidents', permission(['tecnico']), wrap(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const where = searchWhere(req.query, ['title', 'scopeLabel', 'assignedTo'], 'id');
    const status = String(req.query.status || 'active');
    if (status === 'active') where.status = { in: ['open', 'acknowledged'] };
    else if (status !== 'all') {
      if (!['open', 'acknowledged', 'resolved'].includes(status)) fail('Estado de incidente invalido.');
      where.status = status;
    }
    if (req.query.severity) {
      if (!['medium', 'high', 'critical'].includes(String(req.query.severity))) fail('Severidad invalida.');
      where.severity = String(req.query.severity);
    }
    const [total, rows, groups] = await prisma.$transaction([
      prisma.networkIncident.count({ where }),
      prisma.networkIncident.findMany({ where, orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }], skip, take }),
      prisma.networkIncident.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    res.json({ items: rows.map(presentIncident), total, page, pageSize, hasMore: skip + rows.length < total,
      summary: Object.fromEntries(groups.map((group) => [group.status, group._count._all])), fetchedAt: new Date() });
  }));

  router.get('/incidents/:id', permission(['tecnico']), wrap(async (req, res) => {
    const id = positiveId(req.params.id);
    const row = await prisma.networkIncident.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: 'desc' }, take: 200 } } });
    if (!row) return res.status(404).json({ error: 'Incidente no encontrado', code: 'INCIDENT_NOT_FOUND' });
    const clientIds = parseAffectedClientIds(row.affectedClientIds);
    const clients = clientIds.length ? await prisma.client.findMany({ where: { idServicio: { in: clientIds } }, select: {
      idServicio: true, nombre: true, aliasNombre: true, usuario: true, ip: true, telefono: true, zonaNombre: true, estado: true,
    }, orderBy: { nombre: 'asc' } }) : [];
    res.json({ ...presentIncident(row), clients });
  }));

  router.patch('/incidents/:id', permission(['tecnico']), wrap(async (req, res) => {
    const id = positiveId(req.params.id);
    const action = String(req.body?.action || '');
    const note = String(req.body?.note || '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, 500);
    const assignedTo = String(req.body?.assignedTo || '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, 80);
    if (!['acknowledge', 'resolve', 'reopen', 'assign', 'note'].includes(action) || action === 'note' && !note) fail('Accion de incidente invalida.');
    const requestKey = String(req.headers['idempotency-key'] || '');
    const expected = String(req.headers['if-match'] || '');
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey) || !/^[a-f0-9]{64}$/.test(expected)) fail('Falta la clave de operacion o la version del incidente.');
    const payload = { id, action, note, assignedTo, expected };
    const requestHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const key = { userId: req.mobileUser.id, requestKey };
    const result = await prisma.$transaction(async (tx) => {
      const mutation = await tx.mobileMutation.findUnique({ where: { userId_requestKey: key } });
      if (mutation) {
        if (mutation.requestHash !== requestHash) fail('Clave reutilizada con otra accion.', 409, 'IDEMPOTENCY_CONFLICT');
        return JSON.parse(mutation.resultJson);
      }
      const old = await tx.networkIncident.findUnique({ where: { id } });
      if (!old) fail('Incidente no encontrado.', 404, 'INCIDENT_NOT_FOUND');
      if (incidentVersion(old) !== expected) fail('El incidente cambio. Actualiza antes de continuar.', 409, 'STALE_INCIDENT');
      if (action === 'acknowledge' && old.status !== 'open') fail('Solo se puede reconocer un incidente abierto.', 409, 'INVALID_INCIDENT_TRANSITION');
      if (action === 'resolve' && old.status === 'resolved') fail('El incidente ya esta resuelto.', 409, 'INVALID_INCIDENT_TRANSITION');
      if (action === 'reopen' && old.status !== 'resolved') fail('Solo se puede reabrir un incidente resuelto.', 409, 'INVALID_INCIDENT_TRANSITION');
      const actor = req.mobileUser.username;
      const actions = {
        acknowledge: { data: { status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: actor }, type: 'acknowledged', message: note || `Reconocido por ${actor}` },
        resolve: { data: { status: 'resolved', resolvedAt: new Date(), resolvedBy: actor, resolutionNote: note || null }, type: 'resolved', message: note || `Cerrado por ${actor}` },
        reopen: { data: { status: 'open', resolvedAt: null, resolvedBy: null, resolutionNote: null, recoveryStreak: 0 }, type: 'reopened', message: note || `Reabierto por ${actor}` },
        assign: { data: { assignedTo: assignedTo || null }, type: 'assigned', message: assignedTo ? `Asignado a ${assignedTo}` : 'Asignacion eliminada' },
        note: { data: {}, type: 'note', message: note },
      };
      const selected = actions[action];
      const row = await tx.networkIncident.update({ where: { id }, data: { ...selected.data, events: { create: { type: selected.type, message: selected.message, createdBy: actor } } }, include: { events: { orderBy: { createdAt: 'desc' }, take: 200 } } });
      await tx.activity.create({ data: { action: `mobile.incident.${action}`, entityType: 'network_incident', entityId: String(id), details: JSON.stringify({ actor, assignedTo: assignedTo || null }) } });
      const response = presentIncident(row);
      await tx.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(response) } });
      return response;
    });
    res.json(result);
  }));
}

module.exports = { registerMobileNetwork, incidentVersion, presentIncident };
