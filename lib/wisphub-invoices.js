'use strict';

const { createHash } = require('node:crypto');
const { normalizeInvoiceAmounts } = require('./invoice-amounts');
const { fetchWisphubJson } = require('./wisphub-http');

const DEFAULT_INVOICE_START_DATE = '2010-01-01';
const DEFAULT_WISPHUB_INVOICES_URL = 'https://api.wisphub.io/api/facturas/';

function formatDateOnly(value) {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Fecha invalida: ${value}`);
  return date.toISOString().slice(0, 10);
}

const BUSINESS_TIME_ZONE = process.env.BUSINESS_TZ || 'America/Santo_Domingo';

/**
 * Fecha calendario del negocio (YYYY-MM-DD). El servidor corre en UTC: de 8 p. m. a
 * medianoche en Santo Domingo el UTC ya es el dia siguiente.
 */
function businessDate(value = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

/**
 * Ventana de la sincronizacion de cada minuto: ayer y hoy del negocio. Antes pedia solo
 * "hoy" en UTC, asi que desde las 8 p. m. pedia la fecha de manana y los pagos de esas
 * horas no se traian nunca. Ayer cubre el cambio de dia y la hora de WispHub.
 */
function recentInvoiceWindow(now = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  return { from: businessDate(new Date(now.getTime() - 86_400_000), timeZone), to: businessDate(now, timeZone) };
}

function addUtcMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function buildInvoiceDateWindows(startDate, endDate) {
  let cursor = new Date(`${formatDateOnly(startDate)}T00:00:00Z`);
  const finalDate = new Date(`${formatDateOnly(endDate)}T00:00:00Z`);
  if (cursor > finalDate) return [];

  const windows = [];
  while (cursor <= finalDate) {
    const exclusiveEnd = addUtcMonths(cursor, 3);
    const candidateEnd = new Date(exclusiveEnd.getTime() - 86_400_000);
    const windowEnd = candidateEnd < finalDate ? candidateEnd : finalDate;
    windows.push({ from: formatDateOnly(cursor), to: formatDateOnly(windowEnd) });
    cursor = new Date(windowEnd.getTime() + 86_400_000);
  }
  return windows;
}

function mapWisphubInvoice(invoice, existingClientIds = new Set()) {
  const idFactura = Number(invoice?.id_factura);
  if (!Number.isInteger(idFactura) || idFactura <= 0) return null;

  const remoteClientId = Number(invoice?.articulos?.[0]?.servicio?.id_servicio);
  const clienteIdServicio = Number.isInteger(remoteClientId) && existingClientIds.has(remoteClientId)
    ? remoteClientId
    : null;

  return {
    idFactura,
    folio: invoice.folio == null ? null : String(invoice.folio),
    fechaEmision: invoice.fecha_emision || null,
    fechaVencimiento: invoice.fecha_vencimiento || null,
    fechaPago: invoice.fecha_pago || null,
    estado: invoice.estado || null,
    tipo: Number.isFinite(Number(invoice.tipo)) ? Number(invoice.tipo) : null,
    subTotal: Number(invoice.sub_total) || 0,
    descuento: Number(invoice.descuento) || 0,
    impuestosTotal: Number(invoice.impuestos_total) || 0,
    total: Number(invoice.total) || 0,
    // saldo = lo que falta por cobrar y totalCobrado = lo cobrado, segun el estado:
    // los campos de importe de WispHub no lo dicen (ver lib/invoice-amounts.js).
    ...normalizeInvoiceAmounts({ estado: invoice.estado, total: invoice.total, totalCobrado: invoice.total_cobrado, saldo: invoice.saldo }),
    saldoNuevo: Number(invoice.saldo_nuevo) || 0,
    comprobantePago: invoice.comprobante_pago || null,
    referencia: invoice.referencia == null ? null : String(invoice.referencia),
    referenciaOxxo: invoice.referencia_oxxo || null,
    totalPasarela: Number(invoice.total_pasarela) || 0,
    totalOpenpay: Number(invoice.total_openpay) || 0,
    totalOxxo: Number(invoice.total_oxxo) || 0,
    idMercadopago: invoice.id_mercadopago == null ? null : String(invoice.id_mercadopago),
    idPayu: invoice.id_payu == null ? null : String(invoice.id_payu),
    urlPayu: invoice.url_payu || null,
    retencionPorcentaje: Number(invoice.retencion_porcentaje) || 0,
    retencionesTotal: Number(invoice.retenciones_total) || 0,
    zonaId: Number.isFinite(Number(invoice.zona?.id)) ? Number(invoice.zona.id) : null,
    zonaNombre: invoice.zona?.nombre || null,
    formaPagoId: Number.isFinite(Number(invoice.forma_pago?.id)) ? Number(invoice.forma_pago.id) : null,
    formaPagoNombre: invoice.forma_pago?.nombre || null,
    cajeroId: Number.isFinite(Number(invoice.cajero?.id)) ? Number(invoice.cajero.id) : null,
    cajeroNombre: invoice.cajero?.nombre || null,
    clienteIdServicio,
    clienteNombre: invoice.cliente?.nombre || '',
    clienteUsuario: invoice.cliente?.usuario || null,
    clienteCedula: invoice.cliente?.cedula || null,
    clienteTelefono: invoice.cliente?.telefono || null,
    clienteDireccion: invoice.cliente?.direccion || null,
    clienteEmail: invoice.cliente?.email || null,
    clienteRfc: invoice.cliente?.rfc || null,
    syncedAt: new Date(),
  };
}

function mapWisphubInvoiceArticle(article, idFactura) {
  return {
    idFactura,
    remoteId: Number.isFinite(Number(article?.id)) ? Number(article.id) : null,
    uuidEquipo: article?.uuid_equipo || null,
    categoriaStock: article?.categoria_stock || null,
    cantidad: Number(article?.cantidad) || 1,
    descripcion: article?.descripcion || '',
    precio: String(article?.precio || 0),
    idServicio: Number.isFinite(Number(article?.servicio?.id_servicio))
      ? Number(article.servicio.id_servicio)
      : null,
  };
}

async function fetchWisphubInvoices({
  apiKey,
  from,
  to,
  dateField = 'fecha_emision',
  fetchImpl = fetch,
  baseUrl = DEFAULT_WISPHUB_INVOICES_URL,
  pageSize = 100,
  maxPages = 500,
  requestOptions = {},
}) {
  if (!apiKey) throw new Error('WISPHUB_API_KEY no esta configurada');
  if (!['fecha_emision', 'fecha_pago', 'fecha_vencimiento'].includes(dateField)) {
    throw new Error(`Filtro de fecha no permitido: ${dateField}`);
  }

  const all = [];
  let offset = 0;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const url = new URL(baseUrl);
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set(`${dateField}__range_0`, formatDateOnly(from));
    url.searchParams.set(`${dateField}__range_1`, formatDateOnly(to));

    const page = await fetchWisphubJson(url, { apiKey, fetchImpl, label: 'WispHub facturas', ...requestOptions });
    if (!page || !Array.isArray(page.results)) {
      throw new Error('WispHub devolvio una pagina de facturas invalida');
    }
    all.push(...page.results);
    if (!page.next) return all;
    offset += pageSize;
  }
  throw new Error(`La paginacion de facturas excedio ${maxPages} paginas`);
}

/** Mismo calculo que sourceStateHash de server.js: los hashes ya guardados siguen valiendo. */
function invoiceSourceHash(data, articles) {
  const comparable = { ...data };
  delete comparable.syncedAt;
  delete comparable.mtSyncedAt;
  return createHash('sha256').update(JSON.stringify({ data: comparable, extra: articles })).digest('hex');
}

/** Guarda facturas de WispHub y sus articulos; omite las que no cambiaron desde la ultima vez. */
async function saveWisphubInvoices(prisma, invoices) {
  const list = Array.isArray(invoices) ? invoices : [];
  const referencedClientIds = [...new Set(list
    .map((invoice) => Number(invoice?.articulos?.[0]?.servicio?.id_servicio))
    .filter((id) => Number.isInteger(id) && id > 0))];
  const existingClients = referencedClientIds.length
    ? await prisma.client.findMany({
      where: { idServicio: { in: referencedClientIds } },
      select: { idServicio: true },
    })
    : [];
  const existingClientIds = new Set(existingClients.map((client) => client.idServicio));
  // Solo las facturas recibidas: antes se leian las ~9.700 guardadas en cada ciclo de un minuto.
  const receivedIds = [...new Set(list.map((invoice) => Number(invoice?.id_factura)).filter((id) => Number.isInteger(id) && id > 0))];
  const existingInvoiceHashes = new Map();
  for (let start = 0; start < receivedIds.length; start += 500) {
    const rows = await prisma.invoice.findMany({
      where: { idFactura: { in: receivedIds.slice(start, start + 500) } },
      select: { idFactura: true, sourceHash: true },
    });
    for (const row of rows) existingInvoiceHashes.set(row.idFactura, row.sourceHash);
  }

  let saved = 0;
  let invalid = 0;
  let created = 0;
  let changed = 0;
  let unchanged = 0;
  for (let start = 0; start < list.length; start += 25) {
    const operations = [];
    for (const invoice of list.slice(start, start + 25)) {
      const data = mapWisphubInvoice(invoice, existingClientIds);
      if (!data) {
        invalid++;
        continue;
      }
      const articles = Array.isArray(invoice.articulos)
        ? invoice.articulos.map((article) => mapWisphubInvoiceArticle(article, data.idFactura))
        : [];
      const sourceHash = invoiceSourceHash(data, articles);
      if (existingInvoiceHashes.get(data.idFactura) === sourceHash) {
        unchanged++;
        continue;
      }
      if (existingInvoiceHashes.has(data.idFactura)) changed++;
      else created++;
      operations.push(prisma.invoice.upsert({
        where: { idFactura: data.idFactura },
        update: { ...data, sourceHash },
        create: { ...data, sourceHash },
      }));
      if (Array.isArray(invoice.articulos)) {
        operations.push(prisma.invoiceArticle.deleteMany({ where: { idFactura: data.idFactura } }));
        if (articles.length) {
          operations.push(prisma.invoiceArticle.createMany({
            data: articles,
          }));
        }
      }
      existingInvoiceHashes.set(data.idFactura, sourceHash);
      saved++;
    }
    if (operations.length) await prisma.$transaction(operations);
  }
  return { saved, created, changed, unchanged, invalid };
}

function mergeInvoicesById(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const invoice of list || []) {
      const id = Number(invoice?.id_factura);
      if (Number.isInteger(id) && id > 0) byId.set(id, invoice);
    }
  }
  return [...byId.values()];
}

module.exports = {
  DEFAULT_INVOICE_START_DATE,
  businessDate,
  recentInvoiceWindow,
  saveWisphubInvoices,
  invoiceSourceHash,
  buildInvoiceDateWindows,
  fetchWisphubInvoices,
  formatDateOnly,
  mapWisphubInvoice,
  mapWisphubInvoiceArticle,
  mergeInvoicesById,
};
