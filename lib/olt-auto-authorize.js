'use strict';

const { normalizeGponSerial } = require('./zte-c320');

function profileSpeed(name) {
  const gigabit = String(name || '').match(/(?:^|[^0-9])(\d+(?:\.\d+)?)\s*G(?:BPS)?(?=[^A-Z]|$)/i);
  if (gigabit) return Number(gigabit[1]) * 1000;
  const megabit = String(name || '').match(/(?:^|[^0-9])(\d+(?:\.\d+)?)\s*M(?:BPS|EGAS?)?(?=[^A-Z]|$)/i);
  if (megabit) return Number(megabit[1]);
  const values = [...String(name || '').matchAll(/(?:^|[^0-9])(\d{1,4})(?=[^0-9]|$)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 1 && value <= 1000);
  return values[0] || null;
}

function selectSpeedProfile(profiles, desiredMbps, direction) {
  const suffix = direction === 'up' ? /UP/i : /DOWN/i;
  const candidates = (profiles || [])
    .map((profile) => ({ name: String(profile?.name || ''), speed: profileSpeed(profile?.name) }))
    .filter((profile) => profile.name && profile.speed && suffix.test(profile.name) && !/IPTV/i.test(profile.name))
    .sort((a, b) => a.speed - b.speed || a.name.localeCompare(b.name));
  const desired = Math.max(1, Number(desiredMbps) || 1);
  return candidates.find((profile) => profile.speed === desired)?.name
    || candidates.find((profile) => profile.speed >= desired)?.name
    || candidates[candidates.length - 1]?.name
    || null;
}

function evaluateAgentAutoAuthorization({ pending, job, inventory, client, previousOnu = null, now = Date.now(), minObservationMs = 30_000 }) {
  const reasons = [];
  const pendingSerial = normalizeGponSerial(pending?.serial);
  const jobSerial = normalizeGponSerial(job?.serial);
  const inventorySerial = normalizeGponSerial(inventory?.identity?.serial);
  const observedMs = pending?.firstSeenAt ? now - new Date(pending.firstSeenAt).getTime() : 0;
  const wan = Array.isArray(inventory?.wan)
    ? inventory.wan.find((item) => String(item?.service || '').toUpperCase().includes('INTERNET')) || inventory.wan[0]
    : null;

  if (!pending?.active) reasons.push('ONU no esta activa en descubrimiento');
  if (observedMs < minObservationMs) reasons.push('ONU aun no completa la ventana de observacion');
  if (job?.source !== 'onu_studio') reasons.push('expediente no fue creado por ONU Studio');
  if (!['new_client', 'replace_onu', 'migrate_pon'].includes(job?.mode)) reasons.push('expediente no corresponde a un alta, reemplazo o migracion autorizada');
  if (!['in_progress', 'waiting_optical'].includes(job?.status)) reasons.push('expediente no esta activo');
  if (job?.agentInventoryPhase !== 'post_provision' || !job?.agentVersion || !inventory) {
    reasons.push('falta inventario final firmado por el agente');
  }
  if (!pendingSerial || pendingSerial !== jobSerial || pendingSerial !== inventorySerial) {
    reasons.push('serial no coincide entre agente, expediente y OLT');
  }
  if (!Number.isInteger(job?.clientIdServicio) || job.clientIdServicio !== client?.idServicio) {
    reasons.push('cliente no coincide con el expediente');
  }
  const serviceMode = String(job?.serviceMode || 'router').toLowerCase();
  if (serviceMode === 'router' && (!job?.ip || job.ip !== client?.ip || job.ip !== wan?.ip_address)) {
    reasons.push('IP no coincide entre agente, cliente y expediente');
  }
  if (serviceMode === 'bridge' && job?.ip) {
    reasons.push('un perfil Bridge no debe reservar IP de cliente');
  }
  if (!Number.isInteger(job?.vlan) || Number(wan?.vlan_id) !== job.vlan) {
    reasons.push('VLAN no coincide con el inventario del agente');
  }
  if (!inventory?.device?.model) reasons.push('modelo ONU no identificado por el agente');
  if (Object.keys(inventory?.errors || {}).length) reasons.push('inventario del agente contiene errores');

  if (job?.mode === 'migrate_pon') {
    const previousSerial = normalizeGponSerial(previousOnu?.serial);
    const previousPon = String(previousOnu?.onuIndex || '').split(':')[0];
    if (!job?.previousOnuIndex || previousOnu?.onuIndex !== job.previousOnuIndex) {
      reasons.push('falta la autorizacion anterior registrada en el expediente');
    }
    if (!previousSerial || previousSerial !== pendingSerial || previousSerial !== normalizeGponSerial(job?.previousSerial)) {
      reasons.push('el serial anterior no coincide con la ONU detectada');
    }
    if (previousOnu?.online) reasons.push('la ONU anterior todavia figura en linea');
    if (previousOnu?.clientIdServicio !== job?.clientIdServicio) reasons.push('la autorizacion anterior pertenece a otro cliente');
    if (!job?.targetPonIndex || pending?.ponIndex !== job.targetPonIndex) reasons.push('la ONU no fue detectada en el PON de destino aprobado');
    if (previousPon && pending?.ponIndex === previousPon) reasons.push('la ONU sigue en el PON anterior');
  }

  return { eligible: reasons.length === 0, reasons, wan, observedMs };
}

module.exports = { evaluateAgentAutoAuthorization, profileSpeed, selectSpeedProfile };
