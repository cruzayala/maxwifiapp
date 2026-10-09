'use strict';

// Las metricas de credito y consumo se recalculan cada 2 minutos para todos los clientes.
// Antes se escribian todas siempre, una transaccion de SQLite por cliente (416 cada 2 min,
// unas 300.000 escrituras al dia). Ahora solo se escribe lo que cambio, en lotes.
//
// El consumo (MB del contador de la cola) sube sin parar en cualquier cliente en linea:
// se reescribe cuando cambia al menos 1 GB o un 5 %, suficiente para un indicador mensual.

const MIN_CONSUMPTION_DELTA_MB = 1024;
const MIN_CONSUMPTION_DELTA_RATIO = 0.05;

/** true si las metricas nuevas difieren de las guardadas lo bastante para escribirlas. */
function metricsNeedWrite(current, next) {
  if (!current) return true;
  for (const key of ['creditScore', 'creditTier', 'creditFactors', 'consumptionTier']) {
    if ((current[key] ?? null) !== (next[key] ?? null)) return true;
  }
  const before = current.consumptionMb30d ?? null;
  const after = next.consumptionMb30d ?? null;
  if ((before === null) !== (after === null)) return true;
  if (before === null) return false;
  const delta = Math.abs(after - before);
  // Un contador que baja (cola reiniciada) siempre se escribe.
  return after < before || delta >= MIN_CONSUMPTION_DELTA_MB || (before > 0 && delta / before >= MIN_CONSUMPTION_DELTA_RATIO);
}

module.exports = { metricsNeedWrite, MIN_CONSUMPTION_DELTA_MB };
