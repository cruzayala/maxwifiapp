'use strict';

const ticketFields = {
  idTicket: true, remoteId: true, asunto: true, cliente: true, idServicio: true, estado: true, prioridad: true,
  fechaCreacion: true, fechaActualizacion: true, asignado: true, descripcion: true, firstSeenAt: true, lastChangedAt: true,
};

function registerMobileSupport(router, { prisma, wrap, permission, pagination, positiveId, searchWhere }) {
  router.get('/tickets', permission(['tecnico']), wrap(async (req, res) => {
    const where = searchWhere(req.query, ['asunto', 'cliente', 'asignado', 'descripcion'], 'idTicket');
    if (req.query.status) where.estado = String(req.query.status).trim().slice(0, 100);
    if (req.query.priority) where.prioridad = String(req.query.priority).trim().slice(0, 100);
    const { page, pageSize, skip, take } = pagination(req.query);
    const [total, rows, statuses, priorities, last] = await prisma.$transaction([
      prisma.cachedTicket.count({ where }),
      prisma.cachedTicket.findMany({ where, select: ticketFields, orderBy: [{ lastChangedAt: 'desc' }, { idTicket: 'desc' }], skip, take }),
      prisma.cachedTicket.groupBy({ by: ['estado'], _count: { _all: true } }),
      prisma.cachedTicket.groupBy({ by: ['prioridad'], _count: { _all: true } }),
      prisma.cachedTicket.findFirst({ orderBy: { lastChangedAt: 'desc' }, select: { lastChangedAt: true } }),
    ]);
    res.json({ items: rows, total, page, pageSize, hasMore: skip + rows.length < total,
      summary: { byStatus: Object.fromEntries(statuses.map(row => [row.estado || 'Sin estado', row._count._all])),
        byPriority: Object.fromEntries(priorities.map(row => [row.prioridad || 'Sin prioridad', row._count._all])) },
      source: 'sqlite', syncedAt: last?.lastChangedAt || null, fetchedAt: new Date() });
  }));
  router.get('/tickets/:id', permission(['tecnico']), wrap(async (req, res) => {
    const row = await prisma.cachedTicket.findUnique({ where: { idTicket: positiveId(req.params.id) }, select: ticketFields });
    if (!row) return res.status(404).json({ error: 'Ticket no encontrado', code: 'NOT_FOUND' });
    const client = row.idServicio ? await prisma.client.findUnique({ where: { idServicio: row.idServicio }, select: { idServicio: true, nombre: true, telefono: true, ip: true, estado: true } }) : null;
    res.json({ ...row, client, source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/plans', permission(['tecnico', 'cobranza', 'viewer']), wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 120);
    const plans = await prisma.internetPlan.findMany({ orderBy: [{ nombre: 'asc' }, { id: 'asc' }] });
    const clients = await prisma.client.findMany({ select: { planInternetId: true, planInternetName: true, precioPlan: true, estado: true } });
    const byId = new Map();
    const byName = new Map();
    for (const client of clients) {
      const key = client.planInternetId || 0;
      const name = String(client.planInternetName || '').trim().toLowerCase();
      const current = key ? byId.get(key) || { clients: 0, active: 0, monthly: 0, prices: [] } : byName.get(name) || { clients: 0, active: 0, monthly: 0, prices: [] };
      const price = Number(client.precioPlan) || 0;
      current.clients += 1;
      if (client.estado === 'Activo') { current.active += 1; current.monthly += price; }
      if (price) current.prices.push(price);
      if (key) byId.set(key, current); else if (name) byName.set(name, current);
    }
    const enriched = plans.map(plan => {
      const stats = byId.get(plan.id) || byName.get(plan.nombre.toLowerCase()) || { clients: 0, active: 0, monthly: 0, prices: [] };
      const prices = [...new Set(stats.prices)].sort((a, b) => a - b);
      // Precio del plan: el que paga la mayoria (el mas alto confundia cuando habia descuentos).
      const frequency = new Map();
      for (const price of stats.prices) frequency.set(price, (frequency.get(price) || 0) + 1);
      const typicalPrice = [...frequency.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 0;
      const review = [];
      if (!stats.clients) review.push('Sin clientes');
      if (prices.length > 1) review.push('Clientes pagando montos distintos');
      return { ...plan, clientCount: stats.clients, activeCount: stats.active, expectedMonthly: Math.round(stats.monthly * 100) / 100,
        observedPriceMin: prices[0] || 0, observedPriceMax: prices.at(-1) || 0, priceVariants: prices.length, typicalPrice,
        averagePerActive: stats.active ? Math.round((stats.monthly / stats.active) * 100) / 100 : 0, review };
    }).filter(plan => !q || plan.nombre.toLowerCase().includes(q) || String(plan.tipo || '').toLowerCase().includes(q));
    const summary = enriched.reduce((value, plan) => ({ clients: value.clients + plan.clientCount, active: value.active + plan.activeCount,
      expectedMonthly: Math.round((value.expectedMonthly + plan.expectedMonthly) * 100) / 100, toReview: value.toReview + (plan.review.length ? 1 : 0) }),
    { clients: 0, active: 0, expectedMonthly: 0, toReview: 0 });
    res.json({ items: enriched.sort((a, b) => b.clientCount - a.clientCount || a.nombre.localeCompare(b.nombre)), total: enriched.length,
      summary, source: 'sqlite', syncedAt: plans.reduce((last, plan) => !last || plan.syncedAt > last ? plan.syncedAt : last, null), fetchedAt: new Date() });
  }));
}

module.exports = { registerMobileSupport };
