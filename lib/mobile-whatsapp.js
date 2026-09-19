'use strict';

const crypto = require('node:crypto');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function registerMobileWhatsapp(router, { prisma, wrap, permission, pagination, positiveId, searchWhere, statusProvider, sendWhatsapp }) {
  router.get('/whatsapp/status', permission(['cobranza']), wrap(async (_req, res) => {
    const latest = await prisma.whatsappLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true, status: true } });
    const status = statusProvider ? await statusProvider() : { status: 'unavailable' };
    res.json({ status: status.status || 'unavailable', latest, canSend: Boolean(sendWhatsapp) && status.status === 'connected', fetchedAt: new Date() });
  }));

  router.get('/whatsapp/history', permission(['cobranza']), wrap(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const where = searchWhere(req.query, ['phone', 'clientName', 'message', 'messageType'], 'id');
    if (req.query.status) where.status = String(req.query.status).slice(0, 30);
    if (req.query.clientId) where.idServicio = positiveId(req.query.clientId);
    const [total, items, groups] = await prisma.$transaction([
      prisma.whatsappLog.count({ where }), prisma.whatsappLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.whatsappLog.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    res.json({ items, total, page, pageSize, hasMore: skip + items.length < total, summary: Object.fromEntries(groups.map((row) => [row.status, row._count._all])), source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/whatsapp/templates', permission(['cobranza']), wrap(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const where = searchWhere(req.query, ['name', 'category', 'content'], 'id');
    const [total, items] = await prisma.$transaction([prisma.whatsappTemplate.count({ where }), prisma.whatsappTemplate.findMany({ where, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], skip, take })]);
    res.json({ items, total, page, pageSize, hasMore: skip + items.length < total, source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/whatsapp/bot', permission(['cobranza']), wrap(async (req, res) => {
    const [setting, incoming, outgoing, conversationRows, status] = await Promise.all([
      prisma.appSetting.findUnique({ where: { key: 'whatsapp_bot_enabled' }, select: { value: true, updatedAt: true } }),
      prisma.whatsappLog.count({ where: { messageType: 'incoming' } }),
      prisma.whatsappLog.count({ where: { messageType: { startsWith: 'bot_' } } }),
      prisma.whatsappLog.findMany({
        where: { OR: [{ messageType: 'incoming' }, { messageType: { startsWith: 'bot_' } }] },
        select: { phone: true }, distinct: ['phone'], take: 10_000,
      }),
      statusProvider ? statusProvider() : Promise.resolve({ status: 'unavailable' }),
    ]);
    res.json({
      enabled: setting?.value === 'true', waConnected: status?.status === 'connected',
      canManage: ['super_admin', 'admin'].includes(req.mobileUser.role),
      stats: { incoming, outgoing, conversations: conversationRows.length },
      updatedAt: setting?.updatedAt || null, source: 'sqlite', fetchedAt: new Date(),
    });
  }));

  router.get('/whatsapp/bot/conversations', permission(['cobranza']), wrap(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const logs = await prisma.whatsappLog.findMany({
      where: { OR: [{ messageType: 'incoming' }, { messageType: { startsWith: 'bot_' } }] },
      orderBy: { createdAt: 'desc' }, take: Math.min(500, limit * 10),
      select: { id: true, phone: true, clientName: true, idServicio: true, messageType: true, message: true, status: true, createdAt: true },
    });
    const conversations = new Map();
    for (const log of logs) {
      if (!conversations.has(log.phone)) conversations.set(log.phone, {
        phone: log.phone, clientName: log.clientName, idServicio: log.idServicio,
        messageCount: 0, lastMessage: log.message, lastAt: log.createdAt, messages: [],
      });
      const item = conversations.get(log.phone);
      item.messageCount += 1;
      if (item.messages.length < 20) item.messages.push({ id: log.id, type: log.messageType, message: log.message, status: log.status, at: log.createdAt });
    }
    res.json({ items: [...conversations.values()].slice(0, limit), total: conversations.size, source: 'sqlite', fetchedAt: new Date() });
  }));

  router.post('/whatsapp/bot/toggle', permission([]), wrap(async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Estado del bot invalido', code: 'INVALID_BOT_STATE' });
    const requestKey = String(req.headers['idempotency-key'] || '');
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey)) return res.status(400).json({ error: 'Falta la clave de operacion', code: 'INVALID_IDEMPOTENCY_KEY' });
    const enabled = req.body.enabled;
    const requestHash = hash(JSON.stringify({ operation: 'whatsapp-bot-toggle', enabled }));
    const key = { userId: req.mobileUser.id, requestKey };
    const old = await prisma.mobileMutation.findUnique({ where: { userId_requestKey: key } });
    if (old) {
      if (old.requestHash !== requestHash) return res.status(409).json({ error: 'La clave pertenece a otra operacion', code: 'IDEMPOTENCY_CONFLICT' });
      return res.json(JSON.parse(old.resultJson));
    }
    const current = await prisma.appSetting.findUnique({ where: { key: 'whatsapp_bot_enabled' }, select: { value: true } });
    const result = { enabled, confirmed: true, changed: current?.value !== String(enabled), updatedAt: new Date().toISOString() };
    await prisma.$transaction(async (tx) => {
      await tx.appSetting.upsert({ where: { key: 'whatsapp_bot_enabled' }, update: { value: String(enabled) }, create: { key: 'whatsapp_bot_enabled', value: String(enabled), category: 'whatsapp' } });
      await tx.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(result) } });
      await tx.activity.create({ data: { action: 'mobile.whatsapp.bot.toggle', entityType: 'setting', entityId: 'whatsapp_bot_enabled', details: JSON.stringify({ actor: req.mobileUser.username, enabled, requestKey }) } });
    });
    res.json(result);
  }));

  router.post('/whatsapp/messages', permission(['cobranza']), wrap(async (req, res) => {
    if (!sendWhatsapp) return res.status(503).json({ error: 'Envio movil no configurado', code: 'WHATSAPP_UNAVAILABLE' });
    const requestKey = String(req.headers['idempotency-key'] || '');
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey)) return res.status(400).json({ error: 'Falta la clave de operacion', code: 'INVALID_IDEMPOTENCY_KEY' });
    const idServicio = positiveId(req.body?.idServicio);
    const message = String(req.body?.message || '').trim();
    if (!message || message.length > 2000) return res.status(400).json({ error: 'Escriba un mensaje de hasta 2000 caracteres', code: 'INVALID_MESSAGE' });
    const client = await prisma.client.findUnique({ where: { idServicio }, select: { idServicio: true, nombre: true, aliasNombre: true, telefono: true, aliasTelefono: true } });
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado', code: 'CLIENT_NOT_FOUND' });
    const phone = String(client.aliasTelefono || client.telefono || '').trim();
    if (!phone) return res.status(409).json({ error: 'El cliente no tiene telefono', code: 'CLIENT_WITHOUT_PHONE' });
    const requestHash = hash(JSON.stringify({ operation: 'whatsapp-message', idServicio, message }));
    const key = { userId: req.mobileUser.id, requestKey };
    const initial = { state: 'pending_review', idServicio, clientName: client.aliasNombre || client.nombre, createdAt: new Date().toISOString(), message: 'Envio reservado; si queda pendiente no se repetira automaticamente.' };
    try { await prisma.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(initial) } }); }
    catch (error) {
      if (error.code !== 'P2002') throw error;
      const old = await prisma.mobileMutation.findUnique({ where: { userId_requestKey: key } });
      if (!old || old.requestHash !== requestHash) return res.status(409).json({ error: 'La clave pertenece a otro mensaje', code: 'IDEMPOTENCY_CONFLICT' });
      const stored = JSON.parse(old.resultJson); return res.status(stored.state === 'sent' ? 200 : 202).json(stored);
    }
    let result;
    try { result = await sendWhatsapp({ idServicio, phone, message, messageType: 'mobile_manual', clientName: client.aliasNombre || client.nombre }); }
    catch (error) { result = { ok: false, error: error.message || 'Resultado incierto', code: 'SEND_UNCERTAIN', uncertain: true }; }
    const response = { ...initial, state: result.ok ? 'sent' : result.uncertain ? 'pending_review' : 'failed', sentAt: result.ok ? new Date().toISOString() : null, errorCode: result.code || null, error: result.ok ? null : result.error || 'No enviado' };
    await prisma.$transaction([prisma.mobileMutation.update({ where: { userId_requestKey: key }, data: { resultJson: JSON.stringify(response) } }), prisma.activity.create({ data: { action: `mobile.whatsapp.${response.state}`, entityType: 'client', entityId: String(idServicio), entityName: response.clientName, details: JSON.stringify({ actor: req.mobileUser.username, requestKey, errorCode: response.errorCode }) } })]);
    res.status(result.ok ? 200 : result.uncertain ? 202 : 409).json(response);
  }));
}

module.exports = { registerMobileWhatsapp };
