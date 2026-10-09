'use strict';

// Repasa contra WispHub, una por una, las facturas que ISP Max tiene como pendientes.
//
// Por que existe: la sincronizacion de cada minuto solo trae las facturas emitidas o
// pagadas en los ultimos dos dias. Un cambio de estado sin fecha nueva (factura
// transferida a otra), un pago que se escapo de esa ventana o una factura borrada en
// WispHub no llegaban nunca: el 8-oct-2026, de 271 "pendientes" en ISP Max, 36 ya
// estaban pagadas, 57 transferidas y 32 borradas en WispHub.

const MISSING_STATE = 'Eliminada en WispHub';
const OUTAGE_CODES = new Set(['WISPHUB_DOWN', 'WISPHUB_TIMEOUT', 'WISPHUB_UNREACHABLE', 'WISPHUB_RATE_LIMITED', 'WISPHUB_INVALID_RESPONSE', 'WISPHUB_AUTH']);

/**
 * fetchInvoice(id) devuelve la factura de WispHub o lanza un error con code
 * WISPHUB_NOT_FOUND si ya no existe. save(lista) guarda las facturas recibidas.
 */
async function reconcilePendingInvoices({
  prisma,
  fetchInvoice,
  save,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  gapMs = 100,
  maxConsecutiveFailures = 5,
  now = () => new Date(),
}) {
  const pending = await prisma.invoice.findMany({
    where: { estado: { contains: 'pendiente' } },
    select: { idFactura: true, estado: true },
    orderBy: { idFactura: 'asc' },
  });
  const before = new Map(pending.map((row) => [row.idFactura, row.estado]));
  const received = [];
  const notFound = [];
  let failed = 0;
  let consecutiveFailures = 0;
  let aborted = null;

  const check = async (id) => {
    try {
      received.push(await fetchInvoice(id));
      consecutiveFailures = 0;
      return 'ok';
    } catch (error) {
      if (error?.code === 'WISPHUB_NOT_FOUND') {
        consecutiveFailures = 0;
        return 'missing';
      }
      failed++;
      consecutiveFailures++;
      // WispHub se cayo a mitad del repaso: se deja para la proxima vuelta.
      if (OUTAGE_CODES.has(error?.code) && consecutiveFailures >= maxConsecutiveFailures) aborted = error.message;
      return 'failed';
    }
  };

  for (const { idFactura } of pending) {
    if (aborted) break;
    if (await check(idFactura) === 'missing') notFound.push(idFactura);
    if (gapMs) await sleep(gapMs);
  }

  // Un 404 se confirma una segunda vez: un error pasajero de WispHub no debe sacar
  // una deuda real de la lista de pendientes.
  const missing = [];
  if (!aborted) {
    for (const id of notFound) {
      if (await check(id) === 'missing') missing.push(id);
      if (gapMs) await sleep(gapMs);
    }
  }

  const saved = received.length ? await save(received) : { saved: 0 };
  let markedMissing = 0;
  if (missing.length) {
    // No se borra nada: queda el registro, sin saldo, con el estado real.
    markedMissing = (await prisma.invoice.updateMany({
      where: { idFactura: { in: missing }, estado: { contains: 'pendiente' } },
      data: { estado: MISSING_STATE, saldo: 0, totalCobrado: 0, sourceHash: null, syncedAt: now() },
    })).count;
  }

  const after = await prisma.invoice.findMany({
    where: { idFactura: { in: [...before.keys()] } },
    select: { idFactura: true, estado: true },
  });
  const changed = {};
  for (const row of after) {
    if (row.estado !== before.get(row.idFactura)) changed[row.estado || 'sin estado'] = (changed[row.estado || 'sin estado'] || 0) + 1;
  }
  return {
    checked: pending.length,
    received: received.length,
    saved: saved.saved || 0,
    changed,
    markedMissing,
    missingIds: missing,
    failed,
    aborted,
  };
}

module.exports = { reconcilePendingInvoices, MISSING_STATE };
