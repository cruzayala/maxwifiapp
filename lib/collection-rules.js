'use strict';

// Reglas de cobranza automatica (moroso, corte y recordatorios), separadas para probarlas.

/**
 * Que haria el auto-bloqueo con un cliente que WispHub marca con deuda.
 *   owing:       tiene una factura pendiente con saldo (repasada contra WispHub)
 *   crmAction:   'moroso' | 'block' | null (lo que ya tiene aplicado)
 *   overdueDays: dias calendario desde la fecha de corte (null si no hay fecha)
 * Devuelve { wouldDo: 'block' | 'moroso' | null, skip: motivo | null }.
 */
function autoBlockDecision({ owing, crmAction, overdueDays }, { hardDays, morosoDays }) {
  if (!owing) return { wouldDo: null, skip: 'sin_factura_pendiente' };
  if (crmAction === 'block') return { wouldDo: null, skip: 'ya_bloqueado' };
  if (overdueDays === null || overdueDays === undefined || overdueDays < 0) return { wouldDo: null, skip: 'no_vencido' };
  if (overdueDays >= hardDays) return { wouldDo: 'block', skip: null };
  if (overdueDays >= morosoDays && !crmAction) return { wouldDo: 'moroso', skip: null };
  return { wouldDo: null, skip: null };
}

/** Recordatorio de WhatsApp que toca segun los dias desde el corte (negativo = antes). */
function reminderType(overdueDays) {
  return {
    [-3]: 'reminder_t-3',
    [-1]: 'reminder_t-1',
    0: 'due_today',
    3: 'overdue_t3',
    7: 'overdue_t7',
  }[overdueDays] || null;
}

module.exports = { autoBlockDecision, reminderType };
