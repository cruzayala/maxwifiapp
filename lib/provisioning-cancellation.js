'use strict';

function buildProvisioningCancellationPreview(job, reservation = null, configuredOnu = null) {
  if (!job) throw new Error('Instalacion no encontrada');
  const terminalStages = new Set(['olt_authorized', 'service_ready']);
  const hasOltChanges = Boolean(job.onuIndex || configuredOnu || terminalStages.has(job.stage));
  const alreadyCancelled = job.status === 'cancelled';
  const operation = job.status === 'complete' ? 'close' : 'cancel';
  const reservationAction = reservation?.status === 'active'
    ? 'release'
    : reservation?.status === 'committed'
      ? 'keep_committed'
      : 'none';
  const servicePreserved = Boolean(job.clientIdServicio);
  const warnings = [];
  if (servicePreserved) warnings.push('El cliente de WispHub y su cola MikroTik se conservaran.');
  if (reservationAction === 'keep_committed') warnings.push('La IP ya pertenece al cliente y no volvera al inventario libre.');
  if (job.serial) warnings.push('El serial se conserva en el historial del expediente cancelado.');
  if (hasOltChanges) warnings.push('La ONU ya tiene cambios en la OLT; use un flujo de baja controlada.');

  return {
    allowed: !alreadyCancelled && !hasOltChanges,
    operation,
    alreadyCancelled,
    hasOltChanges,
    servicePreserved,
    reservationAction,
    warnings,
    requiredConfirmation: `CANCELAR ${String(job.id).slice(0, 8).toUpperCase()}`,
  };
}

module.exports = { buildProvisioningCancellationPreview };
