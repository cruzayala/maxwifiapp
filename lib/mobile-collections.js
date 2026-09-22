'use strict';

// Cola de cobranza movil. Aplica exactamente las reglas de la pantalla web de
// Cobranza (src/app/utils/invoice-status.ts y pages/morosos): una factura anulada,
// cancelada o transferida no se debe, y los suspendidos tambien deben (dejarlos
// fuera escondia la mayor parte de la cartera vencida).

const DEFAULT_OVERDUE_MESSAGE = 'Hola {nombre}, su servicio de internet con {empresa} tiene un pago pendiente vencido hace {dias_vencido} días. Monto: RD$ {precio}. Para evitar la suspensión, por favor regularice a la brevedad.';

const lower = (value) => String(value || '').toLowerCase();

function isClosedWithoutPayment(invoice) {
  const status = lower(invoice.estado);
  // WispHub escribe "Se Transfirió": buscar solo 'transfer' dejaba fuera ese estado.
  return status.includes('cancelad') || status.includes('anulad') || status.includes('transfer') || status.includes('transfir');
}

function isPaid(invoice) {
  const status = lower(invoice.estado);
  if (isClosedWithoutPayment(invoice)) return false;
  if (status.includes('pendiente')) return false;
  if (status.includes('pagad') || status.includes('cobro completo')) return true;
  const total = Number(invoice.total) || 0;
  return Boolean(invoice.fechaPago) && total > 0 && (Number(invoice.totalCobrado) || 0) >= total - 0.01;
}

const isPending = (invoice) => !isClosedWithoutPayment(invoice) && !isPaid(invoice);

/** Lo que falta por cobrar de una factura, en centavos para no arrastrar errores de coma flotante. */
function pendingCents(invoice) {
  if (!isPending(invoice)) return 0;
  const balance = Number(invoice.saldo) || 0;
  if (balance > 0) return Math.round(balance * 100);
  return Math.max(Math.round(((Number(invoice.total) || 0) - (Number(invoice.totalCobrado) || 0)) * 100), 0);
}

/** "dd/mm/aaaa", "aaaa-mm-dd" o ISO; null si no se entiende. */
function parseInvoiceDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const latin = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (latin) return Date.UTC(Number(latin[3]), Number(latin[2]) - 1, Number(latin[1]));
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

const serviceKind = (estado) => {
  const state = lower(estado).trim();
  if (state === 'activo') return 'activo';
  if (state.includes('suspend') || state.includes('cortad')) return 'suspendido';
  return 'otro';
};

const managementOf = (crmAction) => crmAction === 'block' ? 'corte' : crmAction === 'moroso' ? 'aviso' : 'none';

function formatAmount(cents) {
  return (cents / 100).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Misma plantilla que los avisos automaticos, para que el cliente reciba siempre lo mismo. */
function renderMessage(template, company, item) {
  const amount = formatAmount(item.debtCents);
  return String(template || DEFAULT_OVERDUE_MESSAGE)
    .replace(/\{nombre\}/g, item.name || 'cliente')
    .replace(/\{empresa\}/g, company || '')
    .replace(/\{fecha_corte\}/g, item.cutoffDate || '')
    .replace(/\{precio\}/g, amount)
    .replace(/\{monto\}/g, amount)
    .replace(/\{facturas\}/g, String(item.invoiceCount))
    .replace(/\{dias_vencido\}/g, String(item.overdueDays))
    .replace(/\{plan\}/g, item.plan || '');
}

/**
 * Arma la cola completa a partir de clientes y facturas ya leidos de SQLite.
 * Es una funcion pura para poder probar cada regla sin base de datos.
 */
function buildCollectionQueue({ clients, invoices, template, company, now = new Date() }) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const byClient = new Map();
  const byName = new Map();
  for (const invoice of invoices) {
    if (!isPending(invoice)) continue;
    if (invoice.clienteIdServicio) {
      const list = byClient.get(invoice.clienteIdServicio) || [];
      list.push(invoice);
      byClient.set(invoice.clienteIdServicio, list);
    } else if (invoice.clienteNombre) {
      const key = lower(invoice.clienteNombre).trim();
      const list = byName.get(key) || [];
      list.push(invoice);
      byName.set(key, list);
    }
  }

  const items = [];
  for (const client of clients) {
    if (!lower(client.estadoFacturas).includes('pendiente')) continue;
    const own = [...(byClient.get(client.idServicio) || []), ...(byName.get(lower(client.nombre).trim()) || [])]
      .sort((a, b) => (parseInvoiceDate(a.fechaVencimiento) ?? 0) - (parseInvoiceDate(b.fechaVencimiento) ?? 0));
    const invoiceCents = own.reduce((sum, invoice) => sum + pendingCents(invoice), 0);
    const oldestDue = parseInvoiceDate(own[0]?.fechaVencimiento);
    const cutoff = oldestDue ?? parseInvoiceDate(client.fechaCorte);
    const overdueDays = cutoff === null ? 0 : Math.max(0, Math.floor((today - cutoff) / 86400000));
    const risk = overdueDays > 15 ? 'alto' : overdueDays > 5 ? 'medio' : 'bajo';
    const phone = String(client.aliasTelefono || client.telefono || '').trim();
    const item = {
      idServicio: client.idServicio,
      name: client.aliasNombre || client.nombre,
      username: client.usuario || null,
      phone: phone || null,
      ip: client.ip || null,
      plan: client.planInternetName || null,
      zone: client.zonaNombre || null,
      service: String(client.estado || '').trim() || 'Sin estado',
      serviceKind: serviceKind(client.estado),
      invoiceCount: own.length || 1,
      debtCents: invoiceCents || Math.round((parseFloat(client.precioPlan) || 0) * 100),
      overdueDays,
      risk,
      oldestDue: own[0]?.fechaVencimiento || null,
      oldestInvoiceId: own[0]?.idFactura || null,
      invoiceIds: own.map((invoice) => invoice.idFactura),
      cutoffDate: client.fechaCorte || null,
      management: managementOf(client.crmAction),
      crmAction: client.crmAction || null,
      paymentPilot: Boolean(client.paymentPilotEnabled),
    };
    item.message = renderMessage(template, company, item);
    items.push(item);
  }

  const activeClients = clients.filter((client) => lower(client.estado) === 'activo').length;
  const activeDebtors = items.filter((item) => item.serviceKind === 'activo').length;
  const summary = {
    debtors: items.length,
    debtCents: items.reduce((sum, item) => sum + item.debtCents, 0),
    invoices: items.reduce((sum, item) => sum + item.invoiceCount, 0),
    contactable: items.filter((item) => item.phone).length,
    unmanaged: items.filter((item) => item.management === 'none').length,
    withNotice: items.filter((item) => item.management === 'aviso').length,
    cut: items.filter((item) => item.management === 'corte').length,
    withService: activeDebtors,
    suspended: items.filter((item) => item.serviceKind === 'suspendido').length,
    riskHigh: items.filter((item) => item.risk === 'alto').length,
    riskMedium: items.filter((item) => item.risk === 'medio').length,
    riskLow: items.filter((item) => item.risk === 'bajo').length,
    averageOverdueDays: items.length ? Math.round(items.reduce((sum, item) => sum + item.overdueDays, 0) / items.length) : 0,
    // La cartera al dia se mide solo entre los activos, que son los que deberian pagar este mes.
    onTimePercent: activeClients ? Math.round(((activeClients - activeDebtors) / activeClients) * 1000) / 10 : 100,
  };
  return { items, summary };
}

const riskOrder = { alto: 3, medio: 2, bajo: 1 };

function filterAndSort(items, { q, service, manage, risk, contact, sort } = {}) {
  let result = [...items];
  const term = lower(q).trim();
  if (term) {
    result = result.filter((item) => lower(item.name).includes(term) || lower(item.username).includes(term) ||
      String(item.phone || '').includes(term) || String(item.ip || '').includes(term));
  }
  if (risk) result = result.filter((item) => item.risk === risk);
  if (contact === 'with-phone') result = result.filter((item) => item.phone);
  if (contact === 'without-phone') result = result.filter((item) => !item.phone);
  if (manage === 'pending') result = result.filter((item) => item.management === 'none');
  if (manage === 'aviso' || manage === 'corte') result = result.filter((item) => item.management === manage);
  if (service) result = result.filter((item) => item.serviceKind === service);
  result.sort((left, right) => {
    if (sort === 'amount') return right.debtCents - left.debtCents;
    if (sort === 'invoices') return right.invoiceCount - left.invoiceCount || right.debtCents - left.debtCents;
    if (sort === 'name') return String(left.name || '').localeCompare(String(right.name || ''), 'es');
    // Prioridad: primero el que aun tiene servicio (se le puede cortar), luego lo que
    // nadie ha tocado todavia y, dentro de eso, lo mas grave.
    const active = (item) => item.serviceKind === 'activo' ? 0 : 1;
    const untouched = (item) => item.management === 'none' ? 0 : 1;
    return active(left) - active(right) || untouched(left) - untouched(right) ||
      riskOrder[right.risk] - riskOrder[left.risk] || right.overdueDays - left.overdueDays || right.debtCents - left.debtCents;
  });
  return result;
}

const allowedValues = {
  service: ['', 'activo', 'suspendido', 'otro'],
  manage: ['', 'pending', 'aviso', 'corte'],
  risk: ['', 'alto', 'medio', 'bajo'],
  contact: ['', 'with-phone', 'without-phone'],
  sort: ['', 'priority', 'amount', 'invoices', 'name'],
};

function queueOptions(query) {
  const options = { q: String(query.q || '').slice(0, 120) };
  for (const [key, values] of Object.entries(allowedValues)) {
    const value = String(query[key] || '');
    if (!values.includes(value)) throw Object.assign(new Error(`Filtro ${key} invalido`), { status: 400 });
    options[key] = value;
  }
  return options;
}

const publicItem = ({ debtCents, ...item }) => ({ ...item, debt: debtCents / 100 });

function registerMobileCollections(router, { prisma, wrap, permission, pagination }) {
  router.get('/collections/queue', permission(['cobranza']), wrap(async (req, res) => {
    const options = queueOptions(req.query);
    const { page, pageSize, skip, take } = pagination(req.query);
    const [clients, invoices, settings] = await Promise.all([
      prisma.client.findMany({ select: {
        idServicio: true, nombre: true, aliasNombre: true, usuario: true, telefono: true, aliasTelefono: true, ip: true,
        planInternetName: true, precioPlan: true, zonaNombre: true, estado: true, estadoFacturas: true, fechaCorte: true,
        crmAction: true, paymentPilotEnabled: true,
      } }),
      prisma.invoice.findMany({ select: {
        idFactura: true, clienteIdServicio: true, clienteNombre: true, estado: true, total: true, totalCobrado: true,
        saldo: true, fechaPago: true, fechaVencimiento: true,
      } }),
      prisma.appSetting.findMany({ where: { key: { in: ['autoNotifOverdueMsg', 'companyName'] } } }),
    ]);
    const setting = Object.fromEntries(settings.map((row) => [row.key, row.value]));
    const { items, summary } = buildCollectionQueue({ clients, invoices, template: setting.autoNotifOverdueMsg, company: setting.companyName || 'ISP Max' });
    const filtered = filterAndSort(items, options);
    const pageItems = filtered.slice(skip, skip + take).map(publicItem);
    const visibleCents = filtered.reduce((sum, item) => sum + item.debtCents, 0);
    res.json({
      items: pageItems, total: filtered.length, page, pageSize, hasMore: skip + pageItems.length < filtered.length,
      summary: { ...summary, debt: summary.debtCents / 100, visibleDebt: visibleCents / 100, debtCents: undefined },
      source: 'sqlite', fetchedAt: new Date(),
    });
  }));
}

module.exports = {
  DEFAULT_OVERDUE_MESSAGE, isClosedWithoutPayment, isPaid, isPending, pendingCents, parseInvoiceDate,
  buildCollectionQueue, filterAndSort, queueOptions, renderMessage, registerMobileCollections,
};
