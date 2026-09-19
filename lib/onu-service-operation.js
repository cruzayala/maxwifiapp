'use strict';

const SERVICE_OPERATION_MODES = new Set([
  'new_client',
  'existing_client',
  'restore_same_onu',
  'replace_onu',
  'migrate_pon',
]);

function normalizeSerial(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizePonIndex(value) {
  const ponIndex = String(value || '').trim();
  if (!/^\d+\/\d+\/\d+$/.test(ponIndex)) {
    throw Object.assign(new Error('El PON de destino debe tener formato rack/tarjeta/puerto, por ejemplo 1/1/14'), { statusCode: 400 });
  }
  return ponIndex;
}

function prepareExistingServiceOperation({ mode, client, currentOnu, detectedSerial, targetPonIndex, reason }) {
  if (!['existing_client', 'restore_same_onu', 'replace_onu', 'migrate_pon'].includes(mode)) {
    throw Object.assign(new Error('Operacion de servicio existente invalida'), { statusCode: 400 });
  }
  if (!client?.idServicio || !client.ip) {
    throw Object.assign(new Error('El cliente debe existir y conservar una IP valida'), { statusCode: 409 });
  }

  const oldSerial = normalizeSerial(currentOnu?.serial || client.snOnu);
  const newSerial = normalizeSerial(detectedSerial);
  if (!newSerial) throw Object.assign(new Error('La operacion requiere el serial real leido por ONU Studio'), { statusCode: 400 });

  if (mode === 'restore_same_onu' && oldSerial && newSerial !== oldSerial) {
    throw Object.assign(new Error(`La ONU detectada no es la asignada al cliente. Use Cambiar ONU (${oldSerial} -> ${newSerial})`), { statusCode: 409 });
  }
  if (mode === 'replace_onu' && oldSerial && newSerial === oldSerial) {
    throw Object.assign(new Error('El serial detectado es el mismo. Use Restaurar misma ONU'), { statusCode: 409 });
  }
  if (mode === 'migrate_pon') {
    if (oldSerial && newSerial !== oldSerial) {
      throw Object.assign(new Error('Una migracion de PON conserva la misma ONU y el mismo serial'), { statusCode: 409 });
    }
    if (!String(targetPonIndex || '').trim()) {
      throw Object.assign(new Error('Seleccione el PON de destino para la migracion'), { statusCode: 400 });
    }
    const normalizedTarget = normalizePonIndex(targetPonIndex);
    const currentPon = String(currentOnu?.onuIndex || '').split(':')[0];
    if (currentPon && normalizedTarget === currentPon) {
      throw Object.assign(new Error('El PON de destino debe ser diferente al PON actual'), { statusCode: 409 });
    }
  }

  return {
    mode,
    clientIdServicio: client.idServicio,
    clientName: client.nombre,
    ip: client.ip,
    zoneId: client.zonaId || null,
    planId: client.planInternetId || null,
    serial: newSerial,
    previousSerial: oldSerial || null,
    previousOnuIndex: currentOnu?.onuIndex || null,
    targetPonIndex: mode === 'migrate_pon' ? normalizePonIndex(targetPonIndex) : String(targetPonIndex || '').trim() || null,
    operationReason: String(reason || '').trim().slice(0, 300) || null,
    cutoverStatus: mode === 'restore_same_onu' ? 'local_restore_pending' : 'preparation_pending',
    preserved: {
      wisphubClient: true,
      invoices: true,
      ip: true,
      mikrotikQueue: true,
      clientIdServicio: true,
    },
  };
}

function operationCompletion(mode) {
  return mode === 'restore_same_onu'
    ? { status: 'complete', stage: 'service_restored', cutoverStatus: 'not_required' }
    : { status: 'waiting_optical', stage: 'onu_configured', cutoverStatus: 'waiting_new_onu' };
}

module.exports = { SERVICE_OPERATION_MODES, normalizePonIndex, normalizeSerial, prepareExistingServiceOperation, operationCompletion };
