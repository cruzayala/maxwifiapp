'use strict';

// Encuestas de satisfaccion en la app movil: el mismo resumen y la misma pausa global
// de recordatorios que la pantalla web /encuestas. Enviar encuestas nuevas sigue
// siendo tarea de la web, porque exige elegir clientes y listas del MikroTik.

const crypto = require('node:crypto');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const statuses = ['pending', 'submitted', 'expired', 'cancelled'];

function registerMobileSurveys(router, { prisma, wrap, permission, pagination, surveyConfig, invalidateSurveyConfig }) {
  router.get('/surveys', permission(['cobranza']), wrap(async (req, res) => {
    const status = String(req.query.status || '');
    if (status && !statuses.includes(status)) return res.status(400).json({ error: 'Estado de encuesta invalido', code: 'INVALID_STATUS' });
    const { page, pageSize, skip, take } = pagination(req.query);
    const where = status ? { status } : {};
    const q = String(req.query.q || '').trim().slice(0, 120);
    if (q) where.OR = [{ fullName: { contains: q } }, { phone: { contains: q } }, { clientIp: { contains: q } }, { client: { nombre: { contains: q } } }];
    const [total, rows, groups, config] = await Promise.all([
      prisma.surveyResponse.count({ where }),
      prisma.surveyResponse.findMany({
        where, orderBy: { sentAt: 'desc' }, skip, take,
        select: {
          id: true, clientIp: true, idServicio: true, fullName: true, phone: true, status: true, sentBy: true, sentAt: true,
          submittedAt: true, lastReminderAt: true, nextReminderAt: true, reminderCount: true, paused: true,
          client: { select: { nombre: true, aliasNombre: true, planInternetName: true } },
        },
      }),
      prisma.surveyResponse.groupBy({ by: ['status'], _count: { _all: true } }),
      surveyConfig ? surveyConfig() : Promise.resolve({ pausedGlobally: false, intervalHours: null, maxReminders: null }),
    ]);
    const counts = Object.fromEntries(groups.map((row) => [row.status, row._count._all]));
    const sent = Object.values(counts).reduce((sum, value) => sum + value, 0);
    res.json({
      items: rows.map(({ client, ...row }) => ({ ...row, clientName: client?.aliasNombre || client?.nombre || null, plan: client?.planInternetName || null })),
      total, page, pageSize, hasMore: skip + rows.length < total,
      summary: {
        sent, pending: counts.pending || 0, submitted: counts.submitted || 0, expired: counts.expired || 0, cancelled: counts.cancelled || 0,
        responseRate: sent ? Math.round(((counts.submitted || 0) / sent) * 1000) / 10 : 0,
      },
      reminders: { pausedGlobally: Boolean(config.pausedGlobally), intervalHours: config.intervalHours ?? null, maxReminders: config.maxReminders ?? null },
      canManage: ['super_admin', 'admin'].includes(req.mobileUser.role),
      source: 'sqlite', fetchedAt: new Date(),
    });
  }));

  // Pausa o reanuda todos los recordatorios automaticos. Mismo ajuste que la web.
  router.post('/surveys/reminders', permission([]), wrap(async (req, res) => {
    if (typeof req.body?.paused !== 'boolean') return res.status(400).json({ error: 'Estado de pausa invalido', code: 'INVALID_PAUSE_STATE' });
    const requestKey = String(req.headers['idempotency-key'] || '');
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey)) return res.status(400).json({ error: 'Falta la clave de operacion', code: 'INVALID_IDEMPOTENCY_KEY' });
    const paused = req.body.paused;
    const requestHash = hash(JSON.stringify({ operation: 'survey-reminders-pause', paused }));
    const key = { userId: req.mobileUser.id, requestKey };
    const old = await prisma.mobileMutation.findUnique({ where: { userId_requestKey: key } });
    if (old) {
      if (old.requestHash !== requestHash) return res.status(409).json({ error: 'La clave pertenece a otra operacion', code: 'IDEMPOTENCY_CONFLICT' });
      return res.json(JSON.parse(old.resultJson));
    }
    const current = await prisma.appSetting.findUnique({ where: { key: 'survey_reminder_paused' }, select: { value: true } });
    const result = { pausedGlobally: paused, confirmed: true, changed: current?.value !== String(paused), updatedAt: new Date().toISOString() };
    await prisma.$transaction(async (tx) => {
      await tx.appSetting.upsert({
        where: { key: 'survey_reminder_paused' },
        update: { value: String(paused), category: 'survey' },
        create: { key: 'survey_reminder_paused', value: String(paused), category: 'survey' },
      });
      await tx.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(result) } });
      await tx.activity.create({ data: {
        action: paused ? 'mobile.survey.reminders.pause' : 'mobile.survey.reminders.resume', entityType: 'setting',
        entityId: 'survey_reminder_paused', details: JSON.stringify({ actor: req.mobileUser.username, paused, requestKey }),
      } });
    });
    // El planificador lee la configuracion con cache: se invalida para que la pausa rija ya.
    if (invalidateSurveyConfig) invalidateSurveyConfig();
    res.json(result);
  }));
}

module.exports = { registerMobileSurveys };
