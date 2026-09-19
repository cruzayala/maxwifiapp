'use strict';

function reportPeriod(query, now = new Date()) {
  const months = Number(query.months || 6);
  if (![3, 6, 12, 24].includes(months)) throw Object.assign(new Error('Periodo de 3, 6, 12 o 24 meses requerido.'), { status: 400 });
  const last = String(query.month || now.toISOString().slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(last) || +last.slice(0, 4) < 2000 || +last.slice(0, 4) > 2200) throw Object.assign(new Error('Mes invalido.'), { status: 400 });
  const end = new Date(`${last}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const start = new Date(end); start.setUTCMonth(start.getUTCMonth() - months);
  const previous = new Date(start); previous.setUTCMonth(previous.getUTCMonth() - months);
  return { months, start, end, previous };
}
function summarizeCohorts(groups, period) {
  const buckets = [];
  for (let date = new Date(period.previous); date < period.end; date.setUTCMonth(date.getUTCMonth() + 1)) {
    buckets.push({ month: date.toISOString().slice(0, 7), count: 0, billedCents: 0, collectedCents: 0, balanceCents: 0 });
  }
  const byMonth = new Map(buckets.map(row => [row.month, row]));
  for (const group of groups) {
    const bucket = byMonth.get(String(group.fechaEmision || '').slice(0, 7));
    if (!bucket) continue;
    bucket.count += group._count.idFactura;
    for (const [key, field] of [['billedCents', 'total'], ['collectedCents', 'totalCobrado'], ['balanceCents', 'saldo']]) bucket[key] += Math.round((group._sum[field] || 0) * 100);
  }
  const publicRow = row => ({ month: row.month, count: row.count, billed: row.billedCents / 100, collected: row.collectedCents / 100, balance: row.balanceCents / 100 });
  const total = rows => publicRow(rows.reduce((sum, row) => ({ count: sum.count + row.count, billedCents: sum.billedCents + row.billedCents, collectedCents: sum.collectedCents + row.collectedCents, balanceCents: sum.balanceCents + row.balanceCents }), { count: 0, billedCents: 0, collectedCents: 0, balanceCents: 0 }));
  const previous = total(buckets.slice(0, period.months)), current = total(buckets.slice(period.months));
  return { items: buckets.slice(period.months).map(publicRow), current, previous,
    billedChangePercent: previous.billed === 0 ? null : Math.round((current.billed - previous.billed) / previous.billed * 10000) / 100,
    basis: 'invoice_issue_month', from: period.start.toISOString().slice(0, 10), until: period.end.toISOString().slice(0, 10) };
}
function registerMobileBillingReport(router, { prisma, wrap, permission }) {
  router.get('/reports/billing', permission(['cobranza']), wrap(async (req, res) => {
    const period = reportPeriod(req.query);
    const where = { fechaEmision: { gte: period.previous.toISOString().slice(0, 10), lt: period.end.toISOString().slice(0, 10) }, estado: { not: 'Anulada' } };
    const groups = await prisma.invoice.groupBy({ by: ['fechaEmision'], where, _count: { idFactura: true }, _sum: { total: true, totalCobrado: true, saldo: true } });
    res.json({ ...summarizeCohorts(groups, period), fetchedAt: new Date(), source: 'sqlite', excludedStatus: 'Anulada' });
  }));
}
module.exports = { reportPeriod, summarizeCohorts, registerMobileBillingReport };
