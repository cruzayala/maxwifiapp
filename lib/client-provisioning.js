'use strict';

const { ipInCidr, parseClientCidrs, sanitizeQueueMutation } = require('./mikrotik-ops');

function validationError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanOptional(value, maxLength) {
  const text = String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeIdentity(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

function sanitizeClientProvisioning(body, cidrValue) {
  const source = body || {};
  const zoneId = Number(source.zoneId);
  const planId = Number(source.planId);
  if (!Number.isInteger(zoneId) || zoneId <= 0) throw validationError('Seleccione una zona valida');
  if (!Number.isInteger(planId) || planId <= 0) throw validationError('Seleccione un plan valido');

  const queue = sanitizeQueueMutation({
    targetIp: source.ip,
    name: source.serviceName,
    uploadMbps: source.uploadMbps,
    downloadMbps: source.downloadMbps,
    comment: 'ISP max',
    disabled: false,
  });
  const cidrs = parseClientCidrs(cidrValue);
  if (!cidrs.some((cidr) => ipInCidr(queue.targetIp, cidr))) {
    throw validationError(`La IP debe pertenecer a los rangos de clientes: ${cidrs.join(', ')}`);
  }

  return {
    zoneId,
    planId,
    serviceName: queue.name,
    ip: queue.targetIp,
    uploadMbps: Number(source.uploadMbps),
    downloadMbps: Number(source.downloadMbps),
    queue,
    profile: {
      phone: cleanOptional(source.phone, 40),
      nationalId: cleanOptional(source.nationalId, 40),
      email: cleanOptional(source.email, 160),
      city: cleanOptional(source.city, 120),
      address: cleanOptional(source.address, 240),
    },
  };
}

function matchesExistingWisphubClient(client, input) {
  if (!client) return false;
  return String(client.ip || '').trim() === input.ip
    && normalizeIdentity(client.usuario_rb) === normalizeIdentity(input.serviceName)
    && Number(client.plan_internet?.id) === input.planId
    && Number(client.zona?.id) === input.zoneId;
}

function taskResultError(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.agregar === false) {
    const rawFailure = result.errores || result.error || result.errors || result.detail;
    if (Array.isArray(rawFailure)) {
      return rawFailure.length ? rawFailure.join(', ') : 'WispHub no agrego el cliente';
    }
    if (rawFailure && typeof rawFailure === 'object') {
      return Object.keys(rawFailure).length ? JSON.stringify(rawFailure) : 'WispHub no agrego el cliente';
    }
    return String(rawFailure || 'WispHub no agrego el cliente');
  }
  const raw = result.errores || result.error || result.errors || null;
  if (Array.isArray(raw)) return raw.length ? raw.join(', ') : null;
  if (raw && typeof raw === 'object') return Object.keys(raw).length ? JSON.stringify(raw) : null;
  return raw;
}

function inferPlanBandwidth(planName) {
  const source = String(planName || '').toLowerCase().replace(/,/g, '.');
  const matches = [...source.matchAll(/(\d+(?:\.\d+)?)\s*(g|gb|m|mb|k|kb)?/g)];
  const values = matches.slice(0, 2).map((match) => {
    const value = Number(match[1]);
    const unit = match[2] || 'm';
    if (unit.startsWith('g')) return value * 1000;
    if (unit.startsWith('k')) return value / 1000;
    return value;
  });
  if (!values.length || values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  return {
    uploadMbps: values[0],
    downloadMbps: values[1] || values[0],
  };
}

module.exports = {
  inferPlanBandwidth,
  matchesExistingWisphubClient,
  sanitizeClientProvisioning,
  taskResultError,
};
