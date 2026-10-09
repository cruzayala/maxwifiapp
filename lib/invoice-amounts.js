'use strict';

// Importes de una factura de WispHub con el significado que usa ISP Max.
//
// La API de WispHub NO trae lo cobrado ni lo adeudado en sus campos de importe
// (comprobado el 08/10/2026 con las facturas 21603-21607):
//   - `total_cobrado` es el importe A cobrar: vale lo mismo que `total` este pagada o no;
//   - `saldo` viene en 0 casi siempre (a veces un saldo a favor del cliente);
//   - `fecha_pago` viene llena aunque la factura siga pendiente.
// Lo unico confiable es `estado`. Por eso: lo adeudado es el total si esta pendiente,
// lo cobrado es el total si esta pagada, y las canceladas o transferidas no suman nada.
// Los descuentos ya vienen restados en `total` (total = sub_total - descuento).

function invoiceState(estado) {
  const status = String(estado || '').toLowerCase();
  if (!status.trim()) return 'unknown';
  if (status.includes('cancelad') || status.includes('anulad') || status.includes('transfer') || status.includes('transfir')) return 'closed';
  if (status.includes('pendiente')) return 'pending';
  if (status.includes('pagad') || status.includes('cobro completo')) return 'paid';
  return 'unknown';
}

const money = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

/**
 * { saldo, totalCobrado } a guardar: saldo = lo que falta por cobrar,
 * totalCobrado = lo que efectivamente se cobro. Sin estado reconocible se dejan
 * los valores tal como vinieron.
 */
function normalizeInvoiceAmounts({ estado, total, totalCobrado, saldo }) {
  const state = invoiceState(estado);
  const amount = Math.max(money(total), 0);
  if (state === 'pending') {
    const charged = money(totalCobrado);
    const balance = money(saldo);
    // Abono parcial coherente (cobrado + saldo = total): se respeta tal cual.
    if (balance > 0 && Math.abs(charged + balance - amount) < 0.01) return { saldo: balance, totalCobrado: charged };
    // Abono parcial sin saldo: debe lo que falta.
    if (charged > 0 && charged < amount - 0.01) return { saldo: Math.round((amount - charged) * 100) / 100, totalCobrado: charged };
    // Lo normal en WispHub: cobrado = total (importe a cobrar) y saldo 0 -> debe todo.
    return { saldo: amount, totalCobrado: 0 };
  }
  if (state === 'paid') return { saldo: 0, totalCobrado: money(totalCobrado) > 0 ? money(totalCobrado) : amount };
  if (state === 'closed') return { saldo: 0, totalCobrado: 0 };
  return { saldo: money(saldo), totalCobrado: money(totalCobrado) };
}

/**
 * Corrige las facturas ya guardadas con el criterio anterior (saldo 0 y cobrado = total
 * en las pendientes). Es idempotente: solo toca las filas que no cumplen la regla.
 */
async function normalizeStoredInvoiceAmounts(prisma) {
  const pendingRule = "(lower(estado) LIKE '%pendiente%')";
  const closedRule = "(lower(estado) LIKE '%cancelad%' OR lower(estado) LIKE '%anulad%' OR lower(estado) LIKE '%transf%')";
  const paidRule = "(lower(estado) LIKE '%pagad%' OR lower(estado) LIKE '%cobro completo%')";
  // Solo el patron de WispHub (cobrado = total, saldo que no lo compensa); los abonos
  // parciales coherentes no se tocan.
  const pending = await prisma.$executeRawUnsafe(
    `UPDATE "Invoice" SET saldo = total, totalCobrado = 0 WHERE ${pendingRule} AND NOT ${closedRule}
     AND total > 0 AND totalCobrado >= total - 0.01 AND NOT (saldo > 0 AND abs(totalCobrado + saldo - total) < 0.01)`);
  const closed = await prisma.$executeRawUnsafe(
    `UPDATE "Invoice" SET saldo = 0, totalCobrado = 0 WHERE ${closedRule} AND (saldo <> 0 OR totalCobrado <> 0)`);
  const paid = await prisma.$executeRawUnsafe(
    `UPDATE "Invoice" SET saldo = 0, totalCobrado = CASE WHEN totalCobrado > 0 THEN totalCobrado ELSE total END
     WHERE ${paidRule} AND NOT ${closedRule} AND NOT ${pendingRule} AND (saldo <> 0 OR (totalCobrado <= 0 AND total > 0))`);
  return { pending: Number(pending), closed: Number(closed), paid: Number(paid) };
}

module.exports = { invoiceState, normalizeInvoiceAmounts, normalizeStoredInvoiceAmounts };
