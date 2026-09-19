'use strict';
function registerWebBilling(router, { billing, wrap }) {
  router.post('/payments/:idFactura', wrap(async (req, res) => {
    const result = await billing.submit({ invoiceId: Number(req.params.idFactura), body: req.body,
      requestKey: req.headers['idempotency-key'], userId: req.session.userId });
    res.status(result.ok ? 200 : 202).json(result);
  }));
  router.get('/invoices/:id/payment-options', wrap(async (req, res) => res.json(await billing.options(Number(req.params.id)))));
  router.post('/operations/:id/verify', wrap(async (req, res) => {
    const result = await billing.reconcile(req.params.id);
    res.status(result.ok ? 200 : 202).json(result);
  }));
  router.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'No se pudo confirmar la operacion. Consulta su estado antes de continuar.', code: error.status ? error.code || 'PAYMENT_ERROR' : 'PAYMENT_STORAGE_ERROR' });
  });
}
module.exports = { registerWebBilling };
