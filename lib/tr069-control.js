const crypto = require('crypto');
const net = require('net');
const { ACTION_CATALOG, actionDefinition } = require('./tr069-catalog');

const ACTIONS = ACTION_CATALOG;

function normalizeSerial(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
}

function tr069SerialCandidates(value) {
  const serial = normalizeSerial(value);
  if (!serial) return [];
  const candidates = new Set([serial]);
  if (/^[A-Z]{4}[A-F0-9]+$/.test(serial)) {
    const vendorHex = Buffer.from(serial.slice(0, 4), 'ascii').toString('hex').toUpperCase();
    candidates.add(`${vendorHex}${serial.slice(4)}`);
  }
  if (/^[A-F0-9]{8}[A-F0-9]+$/.test(serial)) {
    try {
      const vendor = Buffer.from(serial.slice(0, 8), 'hex').toString('ascii');
      if (/^[A-Z0-9]{4}$/.test(vendor)) candidates.add(`${vendor}${serial.slice(8)}`);
    } catch {}
  }
  return [...candidates];
}

function selectBestTr069Onu(onus = []) {
  const rank = (onu) => {
    let score = 0;
    if (onu?.online === true) score += 100;
    if (String(onu?.phaseState || '').toLowerCase() === 'working') score += 50;
    if (String(onu?.omccState || '').toLowerCase() === 'enable') score += 25;
    if (onu?.clientIdServicio != null) score += 5;
    return score;
  };
  return [...onus].sort((left, right) => {
    const scoreDifference = rank(right) - rank(left);
    if (scoreDifference) return scoreDifference;
    const rightSeen = new Date(right?.lastSeenAt || right?.updatedAt || 0).getTime() || 0;
    const leftSeen = new Date(left?.lastSeenAt || left?.updatedAt || 0).getTime() || 0;
    return rightSeen - leftSeen;
  })[0] || null;
}

function sanitizeText(value, label, maxLength) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(`${label} invalido`);
  }
  return text;
}

function booleanValue(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} invalido`);
  return value;
}

function integerValue(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} invalido`);
  return number;
}

function ipValue(value, label, allowEmpty = false) {
  const text = String(value ?? '').trim();
  if (allowEmpty && !text) return '';
  if (net.isIP(text) !== 4) throw new Error(`${label} invalida`);
  return text;
}

function optional(clean, payload, key, parser) {
  if (payload[key] != null && payload[key] !== '') clean[key] = parser(payload[key]);
}

function requireConfirmation(action, payload, serial) {
  const verbs = {
    reboot: 'REINICIAR', factory_reset: 'RESTAURAR', firmware_download: 'ACTUALIZAR',
    set_wan: 'CAMBIAR WAN', set_acs: 'CAMBIAR ACS', set_security: 'CAMBIAR SEGURIDAD',
    upsert_port_mapping: 'CAMBIAR PUERTOS', delete_port_mapping: 'CAMBIAR PUERTOS',
    delete_dhcp_reservation: 'ELIMINAR RESERVA',
  };
  const expected = `${verbs[action] || 'CONFIRMAR'} ${normalizeSerial(serial)}`;
  if (String(payload.confirmation || '').trim().toUpperCase() !== expected) {
    throw new Error(`Escriba ${expected} para confirmar`);
  }
}

function validateTaskInput(action, rawPayload = {}, serial = '') {
  const normalizedAction = String(action || '').trim().toLowerCase();
  const definition = actionDefinition(normalizedAction);
  if (!definition) throw new Error('Operacion TR-069 no soportada');
  const payload = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload) ? rawPayload : {};

  if (definition.confirmation) requireConfirmation(normalizedAction, payload, serial);
  if (['refresh', 'reboot', 'factory_reset'].includes(normalizedAction)) {
    return { action: normalizedAction, payload: {}, secret: null, definition };
  }

  const clean = {};
  let secret = null;
  if (normalizedAction === 'set_wifi') {
    if (payload.ssid != null) clean.ssid = sanitizeText(payload.ssid, 'Nombre WiFi', 32);
    if (payload.enabled != null) clean.enabled = booleanValue(payload.enabled, 'Estado WiFi');
    if (payload.broadcast != null) clean.broadcast = booleanValue(payload.broadcast, 'Visibilidad WiFi');
    optional(clean, payload, 'channel', (v) => integerValue(v, 'Canal WiFi', 0, 165));
    optional(clean, payload, 'transmitPower', (v) => integerValue(v, 'Potencia WiFi', 1, 100));
    optional(clean, payload, 'maxClients', (v) => integerValue(v, 'Maximo de clientes', 1, 128));
    optional(clean, payload, 'standard', (v) => sanitizeText(v, 'Estandar WiFi', 16));
    if (payload.wmm != null) clean.wmm = booleanValue(payload.wmm, 'WMM');
    if (payload.wps != null) clean.wps = booleanValue(payload.wps, 'WPS');
    if (payload.password != null && String(payload.password).length) {
      const password = String(payload.password);
      const isHex64 = /^[A-Fa-f0-9]{64}$/.test(password);
      if (!isHex64 && (password.length < 8 || password.length > 63)) throw new Error('La clave WiFi debe tener entre 8 y 63 caracteres');
      secret = { password };
      clean.passwordChanged = true;
    }
  } else if (normalizedAction === 'set_lan_port') {
    clean.port = integerValue(payload.port, 'Puerto LAN', 1, 16);
    if (payload.enabled != null) clean.enabled = booleanValue(payload.enabled, 'Estado LAN');
    optional(clean, payload, 'speed', (v) => sanitizeText(v, 'Velocidad LAN', 16));
    optional(clean, payload, 'duplex', (v) => sanitizeText(v, 'Duplex LAN', 16));
    if (payload.flowControl != null) clean.flowControl = booleanValue(payload.flowControl, 'Control de flujo');
    if (payload.l3Enabled != null) clean.l3Enabled = booleanValue(payload.l3Enabled, 'Modo L3');
  } else if (normalizedAction === 'set_dhcp') {
    if (payload.enabled != null) clean.enabled = booleanValue(payload.enabled, 'DHCP');
    optional(clean, payload, 'minAddress', (v) => ipValue(v, 'IP inicial'));
    optional(clean, payload, 'maxAddress', (v) => ipValue(v, 'IP final'));
    optional(clean, payload, 'subnetMask', (v) => ipValue(v, 'Mascara'));
    optional(clean, payload, 'router', (v) => ipValue(v, 'Gateway'));
    optional(clean, payload, 'dnsServers', (v) => String(v).split(',').map((ip) => ipValue(ip, 'DNS')).join(','));
    optional(clean, payload, 'leaseTime', (v) => integerValue(v, 'Tiempo DHCP', 60, 31536000));
  } else if (normalizedAction === 'set_time') {
    clean.enabled = payload.enabled == null ? true : booleanValue(payload.enabled, 'NTP');
    optional(clean, payload, 'ntpServer1', (v) => sanitizeText(v, 'Servidor NTP', 128));
    optional(clean, payload, 'ntpServer2', (v) => sanitizeText(v, 'Servidor NTP alterno', 128));
    optional(clean, payload, 'timeZone', (v) => sanitizeText(v, 'Zona horaria', 16));
    optional(clean, payload, 'timeZoneName', (v) => sanitizeText(v, 'Nombre de zona horaria', 128));
    optional(clean, payload, 'informInterval', (v) => integerValue(v, 'Intervalo TR-069', 60, 86400));
  } else if (['run_ping', 'run_traceroute'].includes(normalizedAction)) {
    clean.host = sanitizeText(payload.host, 'Destino', 253);
    optional(clean, payload, 'interface', (v) => sanitizeText(v, 'Interfaz', 256));
    optional(clean, payload, 'timeout', (v) => integerValue(v, 'Tiempo limite', 1000, 60000));
    if (normalizedAction === 'run_ping') {
      optional(clean, payload, 'repetitions', (v) => integerValue(v, 'Repeticiones', 1, 20));
      optional(clean, payload, 'blockSize', (v) => integerValue(v, 'Tamano de paquete', 1, 65500));
    } else optional(clean, payload, 'maxHops', (v) => integerValue(v, 'Saltos', 1, 64));
  } else if (['run_download_diagnostic', 'run_upload_diagnostic'].includes(normalizedAction)) {
    clean.url = sanitizeText(payload.url, 'URL de prueba', 512);
    if (!/^https?:\/\//i.test(clean.url)) throw new Error('URL de prueba invalida');
    optional(clean, payload, 'interface', (v) => sanitizeText(v, 'Interfaz', 256));
    if (normalizedAction === 'run_upload_diagnostic') optional(clean, payload, 'testFileLength', (v) => integerValue(v, 'Tamano de prueba', 1024, 100000000));
  } else if (normalizedAction === 'set_wan') {
    clean.connection = integerValue(payload.connection || 1, 'Conexion WAN', 1, 32);
    if (payload.enabled != null) clean.enabled = booleanValue(payload.enabled, 'Estado WAN');
    optional(clean, payload, 'addressingType', (v) => sanitizeText(v, 'Tipo de direccion', 16));
    optional(clean, payload, 'ipAddress', (v) => ipValue(v, 'IP WAN'));
    optional(clean, payload, 'subnetMask', (v) => ipValue(v, 'Mascara WAN'));
    optional(clean, payload, 'gateway', (v) => ipValue(v, 'Gateway WAN'));
    optional(clean, payload, 'dnsServers', (v) => String(v).split(',').map((ip) => ipValue(ip, 'DNS WAN')).join(','));
    optional(clean, payload, 'vlan', (v) => integerValue(v, 'VLAN', 1, 4094));
    optional(clean, payload, 'mtu', (v) => integerValue(v, 'MTU', 576, 1500));
    if (payload.natEnabled != null) clean.natEnabled = booleanValue(payload.natEnabled, 'NAT');
    optional(clean, payload, 'serviceList', (v) => sanitizeText(v, 'Lista de servicios', 64));
  } else if (normalizedAction === 'set_security') {
    clean.connection = integerValue(payload.connection || 1, 'Conexion WAN', 1, 32);
    if (payload.dmzEnabled != null) clean.dmzEnabled = booleanValue(payload.dmzEnabled, 'DMZ');
    optional(clean, payload, 'dmzHost', (v) => ipValue(v, 'IP DMZ'));
  } else if (normalizedAction === 'set_acs') {
    clean.enabled = payload.enabled == null ? true : booleanValue(payload.enabled, 'CWMP');
    clean.acsUrl = sanitizeText(payload.acsUrl, 'URL ACS', 512);
    if (!/^https?:\/\//i.test(clean.acsUrl)) throw new Error('URL ACS invalida');
    optional(clean, payload, 'informInterval', (v) => integerValue(v, 'Intervalo TR-069', 60, 86400));
    secret = {};
    for (const key of ['username', 'password', 'connectionRequestUsername', 'connectionRequestPassword']) {
      if (payload[key] != null && String(payload[key])) secret[key] = String(payload[key]);
    }
  } else if (normalizedAction === 'firmware_download') {
    clean.fileName = sanitizeText(payload.fileName, 'Archivo', 180);
    clean.sha256 = sanitizeText(payload.sha256, 'SHA-256', 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(clean.sha256)) throw new Error('SHA-256 invalido');
    optional(clean, payload, 'version', (v) => sanitizeText(v, 'Version', 80));
  } else if (['upsert_dhcp_reservation', 'delete_dhcp_reservation'].includes(normalizedAction)) {
    optional(clean, payload, 'instance', (v) => integerValue(v, 'Reserva', 1, 1024));
    if (normalizedAction === 'upsert_dhcp_reservation') {
      clean.macAddress = sanitizeText(payload.macAddress, 'MAC', 17).toUpperCase();
      if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(clean.macAddress)) throw new Error('MAC invalida');
      clean.ipAddress = ipValue(payload.ipAddress, 'IP reservada');
      clean.enabled = payload.enabled == null ? true : booleanValue(payload.enabled, 'Reserva DHCP');
    }
  } else if (['upsert_port_mapping', 'delete_port_mapping'].includes(normalizedAction)) {
    clean.connection = integerValue(payload.connection || 1, 'Conexion WAN', 1, 32);
    optional(clean, payload, 'instance', (v) => integerValue(v, 'Redireccion', 1, 1024));
    if (normalizedAction === 'upsert_port_mapping') {
      clean.protocol = sanitizeText(payload.protocol || 'TCP', 'Protocolo', 8).toUpperCase();
      if (!['TCP', 'UDP', 'TCP/UDP'].includes(clean.protocol)) throw new Error('Protocolo invalido');
      clean.externalPort = integerValue(payload.externalPort, 'Puerto externo', 1, 65535);
      clean.internalPort = integerValue(payload.internalPort || payload.externalPort, 'Puerto interno', 1, 65535);
      clean.internalClient = ipValue(payload.internalClient, 'Cliente interno');
      optional(clean, payload, 'description', (v) => sanitizeText(v, 'Descripcion', 64));
    }
  }

  if (definition.confirmation) clean.confirmed = true;
  if (!Object.keys(clean).length) throw new Error('Indique al menos un cambio');
  return { action: normalizedAction, payload: clean, secret, definition };
}

function resolveEncryptionKey(secret) {
  const value = String(secret || '').trim();
  if (value.length < 32) throw new Error('TR069_TASK_ENCRYPTION_KEY no esta configurada');
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function encryptSecret(value, secret) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', resolveEncryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptSecret(value, secret) {
  if (!value) return null;
  const [version, ivRaw, tagRaw, bodyRaw] = String(value).split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !bodyRaw) throw new Error('Secreto TR-069 invalido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', resolveEncryptionKey(secret), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(bodyRaw, 'base64url')), decipher.final()]).toString('utf8'));
}

function safeJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function taskDto(task) {
  const payload = safeJson(task.payloadJson);
  return {
    id: task.id,
    serial: task.serial,
    action: task.action,
    status: task.status,
    payload,
    hasProtectedData: Boolean(task.secretCiphertext),
    result: safeJson(task.resultJson, null),
    errorMessage: task.errorMessage || null,
    errorCode: task.errorCode || null,
    riskLevel: task.riskLevel || actionDefinition(task.action)?.risk || 'read',
    stage: task.stage || 'queued',
    progress: Math.max(0, Math.min(100, Number(task.progress) || 0)),
    verification: safeJson(task.verificationJson, null),
    rollback: safeJson(task.rollbackJson, null),
    attempts: task.attempts,
    createdBy: task.createdBy,
    claimedBy: task.claimedBy || null,
    claimedAt: task.claimedAt || null,
    heartbeatAt: task.heartbeatAt || null,
    scheduledAt: task.scheduledAt || null,
    cancelledAt: task.cancelledAt || null,
    completedAt: task.completedAt || null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

const SECRET_PARAMETER_PATH = /pass(word|phrase)|presharedkey|preshared_key|secret|credential|wepkey|psk|\.psk/i;

function snapshotDto(value) {
  const snapshot = value && typeof value === 'object' ? value : {};
  const numberOrNull = (input) => input == null || input === '' ? null : (Number.isFinite(Number(input)) ? Number(input) : null);
  const textOrNull = (input, max = 160) => String(input ?? '').slice(0, max) || null;
  const safeRows = (rows, max = 64) => Array.isArray(rows)
    ? rows.slice(0, max).map((row) => {
      const output = {};
      for (const [key, item] of Object.entries(row && typeof row === 'object' ? row : {})) {
        if (/password|passphrase|secret|credential|key/i.test(key)) continue;
        if (typeof item === 'boolean' || typeof item === 'number') output[key] = item;
        else if (item != null) output[key] = String(item).slice(0, 256);
      }
      // Parametros TR-069 como ...KeyPassphrase: el nombre esta en la ruta, no en la clave del objeto.
      if (typeof output.path === 'string' && SECRET_PARAMETER_PATH.test(output.path)) {
        for (const field of ['value', 'raw', 'default']) if (field in output) output[field] = '***';
      }
      return output;
    })
    : [];
  return {
    deviceId: String(snapshot.deviceId || '').slice(0, 180) || null,
    manufacturer: String(snapshot.manufacturer || '').slice(0, 80) || null,
    model: String(snapshot.model || '').slice(0, 80) || null,
    softwareVersion: String(snapshot.softwareVersion || '').slice(0, 120) || null,
    lastInformAt: snapshot.lastInformAt || null,
    online: snapshot.online === true,
    wifi: {
      enabled: snapshot.wifi?.enabled === true,
      ssid: String(snapshot.wifi?.ssid || '').slice(0, 32) || null,
      channel: Number.isFinite(Number(snapshot.wifi?.channel)) ? Number(snapshot.wifi.channel) : null,
      broadcast: snapshot.wifi?.broadcast !== false,
      clients: Math.max(0, Number(snapshot.wifi?.clients) || 0),
      transmitPower: numberOrNull(snapshot.wifi?.transmitPower),
      standard: textOrNull(snapshot.wifi?.standard, 32),
      maxClients: numberOrNull(snapshot.wifi?.maxClients),
      wmm: snapshot.wifi?.wmm === true,
      wps: snapshot.wifi?.wps === true,
    },
    wan: {
      ip: String(snapshot.wan?.ip || '').slice(0, 64) || null,
      status: String(snapshot.wan?.status || '').slice(0, 40) || null,
      vlan: Number.isFinite(Number(snapshot.wan?.vlan)) ? Number(snapshot.wan.vlan) : null,
      addressingType: textOrNull(snapshot.wan?.addressingType, 32),
      gateway: textOrNull(snapshot.wan?.gateway, 64),
      dnsServers: textOrNull(snapshot.wan?.dnsServers, 160),
      natEnabled: snapshot.wan?.natEnabled === true,
      mtu: numberOrNull(snapshot.wan?.mtu),
      serviceList: textOrNull(snapshot.wan?.serviceList, 80),
    },
    overview: {
      uptime: numberOrNull(snapshot.overview?.uptime),
      cpuUsage: numberOrNull(snapshot.overview?.cpuUsage),
      memoryFree: numberOrNull(snapshot.overview?.memoryFree),
      memoryTotal: numberOrNull(snapshot.overview?.memoryTotal),
    },
    fiber: {
      status: textOrNull(snapshot.fiber?.status, 40),
      rxPower: numberOrNull(snapshot.fiber?.rxPower),
      txPower: numberOrNull(snapshot.fiber?.txPower),
      temperature: numberOrNull(snapshot.fiber?.temperature),
      voltage: numberOrNull(snapshot.fiber?.voltage),
      biasCurrent: numberOrNull(snapshot.fiber?.biasCurrent),
      fecErrors: numberOrNull(snapshot.fiber?.fecErrors),
      hecErrors: numberOrNull(snapshot.fiber?.hecErrors),
      dropPackets: numberOrNull(snapshot.fiber?.dropPackets),
      bytesReceived: numberOrNull(snapshot.fiber?.bytesReceived),
      bytesSent: numberOrNull(snapshot.fiber?.bytesSent),
    },
    dhcp: {
      enabled: snapshot.dhcp?.enabled === true,
      minAddress: textOrNull(snapshot.dhcp?.minAddress, 64),
      maxAddress: textOrNull(snapshot.dhcp?.maxAddress, 64),
      subnetMask: textOrNull(snapshot.dhcp?.subnetMask, 64),
      router: textOrNull(snapshot.dhcp?.router, 64),
      dnsServers: textOrNull(snapshot.dhcp?.dnsServers, 160),
      leaseTime: numberOrNull(snapshot.dhcp?.leaseTime),
    },
    system: {
      timeEnabled: snapshot.system?.timeEnabled === true,
      timeStatus: textOrNull(snapshot.system?.timeStatus, 40),
      timeZone: textOrNull(snapshot.system?.timeZone, 40),
      timeZoneName: textOrNull(snapshot.system?.timeZoneName, 160),
      periodicInformEnabled: snapshot.system?.periodicInformEnabled === true,
      periodicInformInterval: numberOrNull(snapshot.system?.periodicInformInterval),
    },
    lanPorts: safeRows(snapshot.lanPorts, 16),
    clients: safeRows(snapshot.clients, 128),
    portMappings: safeRows(snapshot.portMappings, 128),
    diagnostics: snapshot.diagnostics && typeof snapshot.diagnostics === 'object' ? snapshot.diagnostics : {},
    parameters: safeRows(snapshot.parameters, 2000),
    collectedAt: snapshot.collectedAt || new Date().toISOString(),
  };
}

module.exports = {
  ACTIONS,
  decryptSecret,
  encryptSecret,
  normalizeSerial,
  safeJson,
  snapshotDto,
  selectBestTr069Onu,
  taskDto,
  tr069SerialCandidates,
  validateTaskInput,
};
