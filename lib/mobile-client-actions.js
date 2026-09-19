'use strict';

const crypto = require('node:crypto');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function registerMobileClientActions(router, { prisma, wrap, permission, positiveId, executeClientAction }) {
  router.get('/clients/:id/service-actions', permission(['cobranza']), wrap(async (req, res) => {
    const idServicio = positiveId(req.params.id);
    const [client, events] = await prisma.$transaction([
      prisma.client.findUnique({ where: { idServicio }, select: { idServicio: true, nombre: true, aliasNombre: true, ip: true, estado: true, crmAction: true, crmActionReason: true, crmActionAt: true, paymentPilotEnabled: true } }),
      prisma.blockEvent.findMany({ where: { idServicio }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado', code: 'CLIENT_NOT_FOUND' });
    res.json({ client, events, capabilities: { moroso: Boolean(executeClientAction && client.ip), clear: Boolean(executeClientAction && client.ip && client.crmAction), block: Boolean(executeClientAction && client.ip && client.paymentPilotEnabled && ['admin', 'super_admin'].includes(req.mobileUser.role)) }, fetchedAt: new Date() });
  }));

  router.post('/clients/:id/service-actions', permission(['cobranza']), wrap(async (req, res) => {
    if (!executeClientAction) return res.status(503).json({ error: 'Control MikroTik movil no configurado', code: 'CLIENT_ACTION_UNAVAILABLE' });
    const idServicio = positiveId(req.params.id); const action = String(req.body?.action || '');
    if (!['moroso', 'clear', 'block'].includes(action)) return res.status(400).json({ error: 'Accion de servicio invalida', code: 'INVALID_CLIENT_ACTION' });
    if (action === 'block' && !['admin', 'super_admin'].includes(req.mobileUser.role)) return res.status(403).json({ error: 'Solo un administrador puede bloquear totalmente', code: 'FORBIDDEN' });
    const reason = String(req.body?.reason || (action === 'clear' ? 'Reactivado desde Android' : 'Falta de pago')).trim().replace(/[\r\n\t]+/g, ' ').slice(0, 240);
    if (!reason) return res.status(400).json({ error: 'Indique el motivo', code: 'INVALID_REASON' });
    const client = await prisma.client.findUnique({ where: { idServicio }, select: { idServicio: true, nombre: true, ip: true, paymentPilotEnabled: true } });
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado', code: 'CLIENT_NOT_FOUND' });
    if (!client.ip) return res.status(409).json({ error: 'Cliente sin IP asignada', code: 'CLIENT_WITHOUT_IP' });
    if (action === 'block' && (!client.paymentPilotEnabled || req.body?.pilotConfirmed !== true)) return res.status(409).json({ error: 'El bloqueo total requiere piloto de pago habilitado y confirmacion visual', code: 'PAYMENT_PILOT_REQUIRED' });
    const requestKey = String(req.headers['idempotency-key'] || '');
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey)) return res.status(400).json({ error: 'Falta la clave de operacion', code: 'INVALID_IDEMPOTENCY_KEY' });
    const requestHash = hash(JSON.stringify({ operation: 'client-service-action', idServicio, action, reason })); const key = { userId: req.mobileUser.id, requestKey };
    const initial = { state: 'pending_review', idServicio, action, reason, createdAt: new Date().toISOString() };
    try { await prisma.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(initial) } }); }
    catch (error) {
      if (error.code !== 'P2002') throw error;
      const old = await prisma.mobileMutation.findUnique({ where: { userId_requestKey: key } });
      if (!old || old.requestHash !== requestHash) return res.status(409).json({ error: 'La clave pertenece a otra accion', code: 'IDEMPOTENCY_CONFLICT' });
      const stored = JSON.parse(old.resultJson); return res.status(stored.state === 'complete' ? 200 : 202).json(stored);
    }
    let result;
    try { result = await executeClientAction({ idServicio, action, reason, actor: { username: req.mobileUser.username, role: req.mobileUser.role } }); }
    catch (error) { result = { ok: false, error: error.message || 'Resultado incierto', uncertain: true }; }
    const response = { ...initial, state: result.ok ? 'complete' : result.uncertain ? 'pending_review' : 'failed', ok: Boolean(result.ok), result: result.ok ? result : null, error: result.ok ? null : result.error || 'No aplicado' };
    await prisma.$transaction([prisma.mobileMutation.update({ where: { userId_requestKey: key }, data: { resultJson: JSON.stringify(response) } }), prisma.activity.create({ data: { action: `mobile.client.${action}.${response.state}`, entityType: 'client', entityId: String(idServicio), entityName: client.nombre, details: JSON.stringify({ actor: req.mobileUser.username, reason, requestKey }) } })]);
    res.status(result.ok ? 200 : result.uncertain ? 202 : 409).json(response);
  }));
}

module.exports = { registerMobileClientActions };
