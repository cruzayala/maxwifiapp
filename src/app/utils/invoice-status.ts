import { Invoice } from '../models/invoice.model';

/**
 * Reglas compartidas para saber si una factura de WispHub sigue debiéndose.
 * Vivían repetidas en el expediente del cliente y en Cobranza; al separarse
 * una copia se quedaba atrás y los montos no cuadraban entre pantallas.
 */

/** Facturas cerradas sin dinero de por medio: anuladas, canceladas o transferidas a otra factura. */
export function isInvoiceClosedWithoutPayment(invoice: Invoice): boolean {
  const status = (invoice.estado || '').toLowerCase();
  // WispHub escribe "Se Transfirió": buscar solo 'transfer' dejaba fuera ese estado.
  return status.includes('cancelad') || status.includes('anulad') ||
    status.includes('transfer') || status.includes('transfir');
}

/** Cobrada por completo. */
export function isInvoicePaid(invoice: Invoice): boolean {
  const status = (invoice.estado || '').toLowerCase();
  if (isInvoiceClosedWithoutPayment(invoice)) return false;
  if (status.includes('pendiente')) return false;
  if (status.includes('pagad') || status.includes('cobro completo')) return true;
  const total = invoice.total || 0;
  return Boolean(invoice.fecha_pago) && total > 0 && (invoice.total_cobrado || 0) >= total - 0.01;
}

/** Sigue pendiente de cobro (lo que suma a la cartera vencida). */
export function isInvoicePending(invoice: Invoice): boolean {
  return !isInvoiceClosedWithoutPayment(invoice) && !isInvoicePaid(invoice);
}

/** Lo que falta por cobrar de una factura, en pesos. */
export function invoicePendingBalance(invoice: Invoice): number {
  if (!isInvoicePending(invoice)) return 0;
  const balance = Number(invoice.saldo || 0);
  if (balance > 0) return balance;
  return Math.max((invoice.total || 0) - (invoice.total_cobrado || 0), 0);
}

/** Convierte "dd/mm/aaaa", "aaaa-mm-dd" o una fecha ISO en Date; null si no se entiende. */
export function parseInvoiceDate(value: string | null | undefined): Date | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const latin = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (latin) return new Date(Number(latin[3]), Number(latin[2]) - 1, Number(latin[1]));
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
