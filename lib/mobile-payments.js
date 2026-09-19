'use strict';
function registerMobilePayments(router, { billing, prisma, wrap, permission, positiveId, pagination }) {
  if (!billing) return;
  router.get('/payments', permission(['cobranza']), wrap(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const state = String(req.query.state || 'open');
    if (!['all', 'open', 'confirmed', 'rejected'].includes(state)) return res.status(400).json({ error: 'Estado invalido' });
    const where = { ...(state === 'open' ? { activeInvoiceId: { not: null } } : state === 'all' ? {} : { state }),
      ...(req.query.q ? { clientName: { contains: String(req.query.q).trim().slice(0, 120) } } : {}) };
    const [total, items] = await prisma.$transaction([
      prisma.billingOperation.count({ where }), prisma.billingOperation.findMany({ where, skip, take, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, invoiceId: true, clientName: true, amount: true, paymentMethodName: true, state: true, errorCode: true, paidAt: true, createdAt: true, updatedAt: true } }),
    ]);
    res.json({ items, total, page, pageSize, hasMore: skip + items.length < total, fetchedAt: new Date(), source: 'sqlite' });
  }));
  router.get('/payment-requests/:key', permission(['cobranza']), wrap(async (req, res) => res.json(await billing.request(req.mobileUser.id, req.params.key))));
  router.get('/invoices/:id/payment-options', permission(['cobranza']), wrap(async (req, res) => res.json(await billing.options(positiveId(req.params.id)))));
  router.post('/invoices/:id/payments', permission(['cobranza']), wrap(async (req, res) => {
    const result = await billing.submit({ invoiceId: positiveId(req.params.id), body: req.body, requestKey: req.headers['idempotency-key'], userId: req.mobileUser.id });
    res.status(result.ok ? 200 : 202).json(result);
  }));
  router.get('/payments/:id', permission(['cobranza']), wrap(async (req, res) => res.json(await billing.read(req.params.id))));
  router.post('/payments/:id/verify', permission(['cobranza']), wrap(async (req, res) => {
    const result = await billing.reconcile(req.params.id);
    res.status(result.ok ? 200 : 202).json(result);
  }));
}
module.exports = { registerMobilePayments };
