const path = require('path');

function parseAllowedOrigins(value, defaults = []) {
  return [...new Set([
    ...defaults,
    ...String(value || '').split(','),
  ].map((origin) => String(origin || '').trim().replace(/\/$/, '')).filter(Boolean))];
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  return allowedOrigins.includes(String(origin).replace(/\/$/, ''));
}

function resolveSqliteDatabasePath(databaseUrl, rootDir) {
  if (!databaseUrl || !databaseUrl.startsWith('file:')) return null;

  const rawPath = decodeURIComponent(databaseUrl.slice(5).split('?')[0].split('#')[0]);
  const windowsAbsolute = /^\/[A-Za-z]:[\\/]/.test(rawPath) ? rawPath.slice(1) : rawPath;
  if (path.isAbsolute(windowsAbsolute)) return path.normalize(windowsAbsolute);

  // Prisma resolves relative SQLite URLs from the directory containing schema.prisma.
  return path.resolve(rootDir, 'prisma', windowsAbsolute || 'data.db');
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function setRemoteField(target, targetKey, source, sourceKey, transform = (value) => value ?? null) {
  if (hasOwn(source, sourceKey)) target[targetKey] = transform(source[sourceKey]);
}

function setRemoteRelation(target, source, sourceKey, idKey, nameKey) {
  if (!hasOwn(source, sourceKey)) return;
  const relation = source[sourceKey];
  if (!relation) {
    target[idKey] = null;
    target[nameKey] = null;
    return;
  }
  if (typeof relation !== 'object') {
    target[idKey] = null;
    target[nameKey] = String(relation);
    return;
  }
  target[idKey] = relation.id == null ? null : Number(relation.id);
  target[nameKey] = relation.nombre || null;
}

function mapWisphubClient(cl, network = {}, options = {}) {
  const { queue, arpEntry, mikrotikAvailable = false } = network;
  const { forCreate = false } = options;
  const data = {
    idServicio: cl.id_servicio,
    syncedAt: new Date(),
  };

  const remoteName = cl.nombre || cl.servicio;
  if (remoteName) data.nombre = remoteName;
  else if (forCreate) data.nombre = 'Sin nombre';

  const plainFields = [
    ['usuario', 'usuario'], ['email', 'email'], ['emailCc', 'email_cc'],
    ['razonSocial', 'razon_social'], ['tipoPersona', 'tipo_persona'],
    ['cedula', 'cedula'], ['rfc', 'rfc'], ['telefono', 'telefono'],
    ['direccion', 'direccion'], ['localidad', 'localidad'], ['ciudad', 'ciudad'],
    ['coordenadas', 'coordenadas'], ['estadoFacturas', 'estado_facturas'],
    ['estado', 'estado'], ['ip', 'ip'], ['ipLocal', 'ip_local'],
    ['macCpe', 'mac_cpe'], ['interfazLan', 'interfaz_lan'], ['snOnu', 'sn_onu'],
    ['modeloRouterWifi', 'modelo_router_wifi'], ['ipRouterWifi', 'ip_router_wifi'],
    ['macRouterWifi', 'mac_router_wifi'], ['ssidRouterWifi', 'ssid_router_wifi'],
    ['passwordSsidWifi', 'password_ssid_router_wifi'],
    ['formaContratacion', 'forma_contratacion'], ['comentarios', 'comentarios'],
    ['fechaInstalacion', 'fecha_instalacion'], ['fechaCancelacion', 'fecha_cancelacion'],
    ['fechaCorte', 'fecha_corte'], ['ultimoCambio', 'ultimo_cambio'],
  ];
  for (const [targetKey, sourceKey] of plainFields) {
    setRemoteField(data, targetKey, cl, sourceKey);
  }

  for (const [targetKey, sourceKey] of [
    ['precioPlan', 'precio_plan'], ['descuento', 'descuento'], ['saldo', 'saldo'],
  ]) {
    setRemoteField(data, targetKey, cl, sourceKey, (value) => value == null ? null : String(value));
  }

  setRemoteField(data, 'firewall', cl, 'firewall', (value) => value == null ? true : Boolean(value));
  setRemoteField(data, 'autoActivar', cl, 'auto_activar_servicio', Boolean);
  setRemoteRelation(data, cl, 'plan_internet', 'planInternetId', 'planInternetName');
  setRemoteRelation(data, cl, 'zona', 'zonaId', 'zonaNombre');
  setRemoteRelation(data, cl, 'router', 'routerId', 'routerNombre');
  setRemoteRelation(data, cl, 'sectorial', 'sectorialId', 'sectorialNombre');
  setRemoteRelation(data, cl, 'tecnico', 'tecnicoId', 'tecnicoNombre');
  setRemoteRelation(data, cl, 'modelo_antena', 'modeloAntenaId', 'modeloAntenaName');

  if (mikrotikAvailable) {
    data.mtSyncedAt = new Date();
    data.mtMacAddress = arpEntry?.['mac-address'] || null;
    data.mtQueueName = queue?.name || null;
    data.mtQueueLimit = queue?.['max-limit'] || null;
    data.mtInterface = arpEntry?.interface || null;
  }

  return data;
}

function wisphubTaskState(payload) {
  const task = payload?.task || payload || {};
  const status = String(task.status || '').toUpperCase();
  const result = task.result ?? payload?.result ?? null;
  const rawResultError = result && typeof result === 'object'
    ? result.error || result.errors || result.errores || result.detail
    : null;
  const resultError = Array.isArray(rawResultError)
    ? (rawResultError.length ? rawResultError.join(', ') : null)
    : (rawResultError && typeof rawResultError === 'object'
      ? (Object.keys(rawResultError).length ? JSON.stringify(rawResultError) : null)
      : rawResultError);

  if (status === 'FAILURE' || status === 'FAILED' || status === 'ERROR' || resultError) {
    return { state: 'failure', result, error: resultError || task.error || 'La tarea fallo en WispHub' };
  }
  if (status === 'SUCCESS' || status === 'SUCCEEDED' || status === 'COMPLETED') {
    return { state: 'success', result, error: null };
  }
  return { state: 'pending', result, error: null };
}

function sanitizePaymentPilotToggle(payload) {
  if (typeof payload?.enabled !== 'boolean') {
    const error = new Error('enabled debe ser true o false');
    error.statusCode = 400;
    throw error;
  }
  const expected = payload.enabled ? 'HABILITAR PORTAL' : 'DESHABILITAR PORTAL';
  const confirmation = String(payload.confirmation || '').trim().toUpperCase();
  if (confirmation !== expected) {
    const error = new Error(`Confirmacion requerida: ${expected}`);
    error.statusCode = 400;
    throw error;
  }
  return { enabled: payload.enabled };
}

function inspectPaymentPortalConfiguration({ businessName, bankInfo, supportPhone }) {
  const name = String(businessName || '').trim();
  const methods = (Array.isArray(bankInfo) ? bankInfo : String(bankInfo || '').split('|'))
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  const placeholder = /(x{3,}|pendiente|configurar|ejemplo|example)/i;
  const validMethods = methods.filter((line) => !placeholder.test(line));
  const phone = String(supportPhone || '').trim();
  const phoneDigits = phone.replace(/\D/g, '');
  const issues = [];
  if (!name || placeholder.test(name)) issues.push('nombre de empresa');
  if (!validMethods.length) issues.push('metodos de pago reales');
  if (phoneDigits.length < 10 || phoneDigits.length > 15 || placeholder.test(phone)) issues.push('telefono de soporte real');
  return {
    ready: issues.length === 0,
    issues,
    businessName: name || 'Proveedor de internet',
    paymentMethods: validMethods,
    supportPhone: issues.includes('telefono de soporte real') ? '' : phone,
  };
}

module.exports = {
  inspectPaymentPortalConfiguration,
  isOriginAllowed,
  mapWisphubClient,
  parseAllowedOrigins,
  resolveSqliteDatabasePath,
  sanitizePaymentPilotToggle,
  wisphubTaskState,
};
