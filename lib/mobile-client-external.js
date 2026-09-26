'use strict';

const { createHash } = require('node:crypto');
const { isIP } = require('node:net');
const { normalizeClientName } = require('./client-rename');

const profileFields = new Set(['displayName', 'phone', 'nationalId', 'email', 'address', 'city']);
const serviceFields = new Set(['ip', 'macCpe', 'lanInterface', 'onuSerial', 'wifiSsid', 'wifiPassword', 'comments']);

function text(value) {
  return value == null ? '' : String(value).trim();
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function externalSnapshot(raw, idServicio) {
  const detail = raw?.detail || {};
  const profile = raw?.profile || {};
  const profileName = [text(profile.nombre), text(profile.apellidos)].filter(Boolean).join(' ');
  const snapshot = {
    idServicio,
    source: 'wisphub_live',
    profile: {
      // El nombre que ISP Max y el MikroTik usan es el del servicio (usuario_rb); el
      // perfil de la persona casi siempre esta vacio en WispHub.
      displayName: text(detail.usuario_rb || detail.nombre || detail.servicio) || profileName,
      phone: text(hasOwn(profile, 'telefono') ? profile.telefono : detail.telefono),
      nationalId: text(hasOwn(profile, 'cedula') ? profile.cedula : detail.cedula),
      email: text(hasOwn(profile, 'email') ? profile.email : detail.email),
      address: text(hasOwn(profile, 'direccion') ? profile.direccion : detail.direccion),
      city: text(hasOwn(profile, 'ciudad') ? profile.ciudad : detail.ciudad || detail.localidad),
    },
    service: {
      username: text(detail.usuario),
      ip: text(detail.ip),
      macCpe: text(detail.mac_cpe),
      lanInterface: text(detail.interfaz_lan),
      onuSerial: text(detail.sn_onu),
      wifiSsid: text(detail.ssid_router_wifi),
      wifiPasswordConfigured: Boolean(text(detail.password_ssid_router_wifi)),
      comments: text(detail.comentarios),
    },
  };
  snapshot.version = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  snapshot.fetchedAt = new Date().toISOString();
  return snapshot;
}

function invalid(message, code = 'INVALID_CLIENT_CHANGE', status = 400) {
  throw Object.assign(new Error(message), { status, code });
}

function boundedString(value, label, max, { required = false } = {}) {
  if (typeof value !== 'string') invalid(`${label} debe ser texto`);
  const result = value.trim();
  if (required && !result) invalid(`${label} es requerido`);
  if (result.length > max) invalid(`${label} excede ${max} caracteres`);
  return result;
}

function validateChanges(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Solicitud invalida');
  const extras = Object.keys(body).filter((key) => !['section', 'changes'].includes(key));
  if (extras.length) invalid(`Campos no permitidos: ${extras.join(', ')}`);
  const section = body.section;
  if (!['profile', 'service'].includes(section)) invalid('Seccion invalida');
  const changes = body.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) invalid('Cambios requeridos');
  const allowed = section === 'profile' ? profileFields : serviceFields;
  const keys = Object.keys(changes);
  if (!keys.length) invalid('No hay cambios para guardar', 'NO_CHANGES');
  const unexpected = keys.filter((key) => !allowed.has(key));
  if (unexpected.length) invalid(`Campos no permitidos: ${unexpected.join(', ')}`);

  const clean = {};
  for (const key of keys) {
    const value = changes[key];
    if (key === 'displayName') {
      if (typeof value !== 'string') invalid('Nombre debe ser texto');
      try { clean[key] = normalizeClientName(value); } catch (error) { invalid(error.message); }
    }
    else if (key === 'phone') clean[key] = boundedString(value, 'Telefono', 40);
    else if (key === 'nationalId') clean[key] = boundedString(value, 'Documento', 80);
    else if (key === 'email') {
      clean[key] = boundedString(value, 'Correo', 254);
      if (clean[key] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean[key])) invalid('Correo invalido');
    } else if (key === 'address') clean[key] = boundedString(value, 'Direccion', 400);
    else if (key === 'city') clean[key] = boundedString(value, 'Ciudad', 160);
    else if (key === 'ip') {
      clean[key] = boundedString(value, 'IP', 45);
      if (clean[key] && isIP(clean[key]) !== 4) invalid('La IP debe ser IPv4 valida');
    } else if (key === 'macCpe') {
      clean[key] = boundedString(value, 'MAC CPE', 32).toUpperCase().replaceAll('-', ':');
      if (clean[key] && !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(clean[key])) invalid('MAC CPE invalida');
    } else if (key === 'lanInterface') clean[key] = boundedString(value, 'Interfaz LAN', 120);
    else if (key === 'onuSerial') {
      clean[key] = boundedString(value, 'Serial ONU', 80).toUpperCase();
      if (clean[key] && !/^[A-Z0-9:_-]+$/.test(clean[key])) invalid('Serial ONU invalido');
    } else if (key === 'wifiSsid') clean[key] = boundedString(value, 'SSID WiFi', 64, { required: true });
    else if (key === 'wifiPassword') {
      clean[key] = boundedString(value, 'Clave WiFi', 64, { required: true });
      if (!(clean[key].length >= 8 && clean[key].length <= 63) && !/^[0-9A-Fa-f]{64}$/.test(clean[key])) invalid('La clave WiFi debe tener entre 8 y 63 caracteres');
    } else if (key === 'comments') clean[key] = boundedString(value, 'Comentarios', 2000);
  }
  return { section, changes: clean };
}

function comparable(snapshot, section, key) {
  if (key === 'wifiPassword') return undefined;
  return snapshot[section][key];
}

function verifyChanges(snapshot, section, changes, secretVerified) {
  const mismatches = Object.entries(changes).filter(([key, value]) => {
    if (key === 'wifiPassword') return secretVerified !== true;
    return comparable(snapshot, section, key) !== value;
  }).map(([key]) => key);
  if (mismatches.length) invalid(`WispHub no confirmo: ${mismatches.join(', ')}`, 'WISPHUB_NOT_CONFIRMED', 502);
}

function sqliteChanges(snapshot, section) {
  return section === 'profile' ? {
    nombre: snapshot.profile.displayName,
    telefono: snapshot.profile.phone || null,
    cedula: snapshot.profile.nationalId || null,
    email: snapshot.profile.email || null,
    direccion: snapshot.profile.address || null,
    localidad: snapshot.profile.city || null,
    ciudad: snapshot.profile.city || null,
    syncedAt: new Date(),
  } : {
    ip: snapshot.service.ip || null,
    macCpe: snapshot.service.macCpe || null,
    interfazLan: snapshot.service.lanInterface || null,
    snOnu: snapshot.service.onuSerial || null,
    ssidRouterWifi: snapshot.service.wifiSsid || null,
    comentarios: snapshot.service.comments || null,
    syncedAt: new Date(),
  };
}

function registerMobileClientExternal(router, { prisma, wrap, permission, positiveId, provider }) {
  if (!provider?.read || !provider?.update) return;
  const inProgress = new Set();

  router.get('/clients/:id/external', permission([]), wrap(async (req, res) => {
    const id = positiveId(req.params.id);
    const local = await prisma.client.findUnique({ where: { idServicio: id }, select: { idServicio: true } });
    if (!local) return res.status(404).json({ error: 'Cliente no encontrado', code: 'CLIENT_NOT_FOUND' });
    res.json(externalSnapshot(await provider.read(id), id));
  }));

  router.patch('/clients/:id/external', permission([]), wrap(async (req, res) => {
    const id = positiveId(req.params.id);
    const requestKey = String(req.headers['idempotency-key'] || '');
    const expectedVersion = String(req.headers['if-match'] || '');
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey)) return res.status(400).json({ error: 'Falta la clave de operacion', code: 'INVALID_IDEMPOTENCY_KEY' });
    if (!/^[a-f0-9]{64}$/.test(expectedVersion)) return res.status(400).json({ error: 'Falta la version del cliente', code: 'INVALID_VERSION' });
    const input = validateChanges(req.body);
    const requestHash = createHash('sha256').update(JSON.stringify({ id, expectedVersion, ...input })).digest('hex');
    const key = { userId: req.mobileUser.id, requestKey };
    const old = await prisma.mobileMutation.findUnique({ where: { userId_requestKey: key } });
    if (old) {
      if (old.requestHash !== requestHash) return res.status(409).json({ error: 'La clave pertenece a otra operacion', code: 'IDEMPOTENCY_CONFLICT' });
      return res.json(JSON.parse(old.resultJson));
    }
    if (inProgress.has(id)) return res.status(409).json({ error: 'Ya hay un cambio en curso para este cliente', code: 'CLIENT_UPDATE_IN_PROGRESS' });
    inProgress.add(id);
    try {
      const local = await prisma.client.findUnique({ where: { idServicio: id }, select: { idServicio: true } });
      if (!local) return res.status(404).json({ error: 'Cliente no encontrado', code: 'CLIENT_NOT_FOUND' });
      const beforeRaw = await provider.read(id);
      const before = externalSnapshot(beforeRaw, id);
      if (before.version !== expectedVersion) return res.status(409).json({ error: 'WispHub cambio desde que abriste el formulario', code: 'STALE_EXTERNAL_CLIENT', current: before });
      const effective = Object.fromEntries(Object.entries(input.changes).filter(([field, value]) => field === 'wifiPassword' || comparable(before, input.section, field) !== value));
      if (!Object.keys(effective).length) return res.status(400).json({ error: 'No hay cambios para guardar', code: 'NO_CHANGES' });
      const updatedRaw = await provider.update({ idServicio: id, section: input.section, changes: effective, before: beforeRaw, actor: req.mobileUser.username });
      const after = externalSnapshot(updatedRaw, id);
      verifyChanges(after, input.section, effective, updatedRaw?.secretVerified);
      const result = { ok: true, verified: true, section: input.section, changedFields: Object.keys(effective), client: after };
      await prisma.$transaction(async (tx) => {
        await tx.client.update({ where: { idServicio: id }, data: sqliteChanges(after, input.section) });
        await tx.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(result) } });
        await tx.activity.create({ data: { action: 'mobile.client.external_updated', entityType: 'client', entityId: String(id), details: JSON.stringify({ actor: req.mobileUser.username, section: input.section, fields: Object.keys(effective).filter((field) => field !== 'wifiPassword'), wifiPasswordChanged: hasOwn(effective, 'wifiPassword') }) } });
      });
      res.json(result);
    } finally {
      inProgress.delete(id);
    }
  }));
}

module.exports = { registerMobileClientExternal, externalSnapshot, validateChanges, verifyChanges };
