'use strict';

const { createHash } = require('node:crypto');

const ticketSubjects = [
  'Internet Lento', 'No Tiene Internet', 'Antena Desalineada', 'Antena Dañada', 'No Responde la Antena',
  'No Responde el Router Wifi', 'Router Wifi Reseteado(Valores de Fabrica)', 'Cambio de Router Wifi',
  'Cambio de Antena', 'Cambio de Antena + Router Wifi', 'Cambio de Contraseña en Router Wifi', 'Cable UTP Dañado',
  'Internet Intermitente', 'Cambio de Domicilio', 'PoE Dañado', 'Reconexión', 'Recolección De Equipos',
  'Conector Dañado', 'Cambio A Fibra Óptica', 'Cable Fibra Dañado', 'Jumper Dañado',
  'Antena valores De Fabrica', 'Cableado Para Modem Extra', 'Eliminador Dañado', 'Cables Mal Colocados',
  'RJ45 Dañado', 'Alambres Rotos', 'Cancelación', 'Desconexión', 'Troncal Dañado', 'Caja Nap Dañada',
];
const states = { 1: 'Nuevo', 2: 'En Progreso', 3: 'Resuelto', 4: 'Cerrado' };
const priorities = { 1: 'Baja', 2: 'Normal', 3: 'Alta', 4: 'Muy Alta' };

function text(value) { return value == null ? '' : String(value).trim(); }
function plainText(value) {
  return text(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}
function compact(value) { return plainText(value).replace(/\s+/g, ' ').trim().toLocaleLowerCase('es'); }
function relation(value, fallbackId, fallbackName) {
  if (value && typeof value === 'object') return { id: Number(value.id ?? value.id_servicio) || null, name: text(value.nombre || value.name) };
  return { id: Number(fallbackId) || null, name: text(value || fallbackName) };
}
function numericLabel(value, labels) {
  const number = Number(value);
  if (Number.isInteger(number) && labels[number]) return number;
  const normalized = compact(value);
  return Number(Object.keys(labels).find((key) => compact(labels[key]) === normalized)) || null;
}
function ticketSnapshot(raw, fallbackId) {
  const client = relation(raw?.servicio, raw?.id_servicio, raw?.cliente);
  const technician = relation(raw?.tecnico, raw?.tecnico_id, raw?.asignado || raw?.email_tecnico);
  const idTicket = Number(raw?.id_ticket ?? raw?.id ?? fallbackId);
  if (!Number.isSafeInteger(idTicket) || idTicket < 1) throw Object.assign(new Error('WispHub no devolvio el identificador del ticket'), { status: 502, code: 'WISPHUB_TICKET_ID_MISSING' });
  const snapshot = {
    idTicket,
    subject: text(raw?.asunto),
    description: plainText(raw?.descripcion),
    state: numericLabel(raw?.estado, states),
    stateLabel: text(raw?.estado) || states[numericLabel(raw?.estado, states)] || '',
    priority: numericLabel(raw?.prioridad, priorities),
    priorityLabel: text(raw?.prioridad) || priorities[numericLabel(raw?.prioridad, priorities)] || '',
    client,
    technician,
    createdAt: text(raw?.fecha_creacion),
    updatedAt: text(raw?.fecha_actualizacion || raw?.fecha_fin),
    source: 'wisphub_live',
  };
  snapshot.version = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  snapshot.fetchedAt = new Date().toISOString();
  return snapshot;
}

function invalid(message, code = 'INVALID_TICKET', status = 400) { throw Object.assign(new Error(message), { status, code }); }
function positive(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) invalid(`${label} invalido`);
  return number;
}
function validateTicket(body, creating) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Solicitud invalida');
  const allowed = new Set(['clientId', 'subject', 'technicianId', 'description', 'state', 'priority']);
  const extras = Object.keys(body).filter((key) => !allowed.has(key));
  if (extras.length) invalid(`Campos no permitidos: ${extras.join(', ')}`);
  const subject = text(body.subject);
  const description = text(body.description);
  if (subject.length < 2 || subject.length > 200) invalid('El asunto debe tener entre 2 y 200 caracteres');
  if (description.length < 3 || description.length > 5000) invalid('La descripcion debe tener entre 3 y 5000 caracteres');
  const input = {
    clientId: positive(body.clientId, 'Cliente'),
    subject,
    technicianId: positive(body.technicianId, 'Tecnico'),
    description,
    state: positive(body.state, 'Estado'),
    priority: positive(body.priority, 'Prioridad'),
  };
  if (!states[input.state]) invalid('Estado invalido');
  if (!priorities[input.priority]) invalid('Prioridad invalida');
  if (!creating && body.clientId == null) invalid('Cliente requerido');
  return input;
}

function verifyTicket(snapshot, input, technicianName) {
  const mismatch = [];
  if (snapshot.client.id !== input.clientId) mismatch.push('cliente');
  if (compact(snapshot.subject) !== compact(input.subject)) mismatch.push('asunto');
  if (compact(snapshot.description) !== compact(input.description)) mismatch.push('descripcion');
  if (snapshot.state !== input.state) mismatch.push('estado');
  if (snapshot.priority !== input.priority) mismatch.push('prioridad');
  if (snapshot.technician.id != null) {
    if (snapshot.technician.id !== input.technicianId) mismatch.push('tecnico');
  } else if (!snapshot.technician.name || compact(snapshot.technician.name) !== compact(technicianName)) mismatch.push('tecnico');
  if (mismatch.length) invalid(`WispHub no confirmo: ${mismatch.join(', ')}`, 'WISPHUB_TICKET_NOT_CONFIRMED', 502);
}

function cachedData(snapshot) {
  return {
    remoteId: snapshot.idTicket,
    asunto: snapshot.subject || null,
    cliente: snapshot.client.name || null,
    idServicio: snapshot.client.id,
    estado: snapshot.stateLabel || states[snapshot.state] || null,
    prioridad: snapshot.priorityLabel || priorities[snapshot.priority] || null,
    fechaCreacion: snapshot.createdAt || null,
    fechaActualizacion: snapshot.updatedAt || null,
    asignado: snapshot.technician.name || null,
    descripcion: snapshot.description || null,
    stateHash: snapshot.version,
    lastChangedAt: new Date(),
  };
}

function registerMobileTickets(router, { prisma, wrap, permission, positiveId, provider }) {
  if (!provider?.read || !provider?.create || !provider?.update) return;
  const inProgress = new Set();

  router.get('/tickets/options', permission(['tecnico']), wrap(async (_req, res) => {
    const [observedSubjects, clients] = await prisma.$transaction([
      prisma.cachedTicket.findMany({ where: { asunto: { not: null } }, select: { asunto: true }, distinct: ['asunto'], take: 300 }),
      prisma.client.findMany({ where: { tecnicoId: { not: null } }, select: { tecnicoId: true, tecnicoNombre: true }, take: 10_000 }),
    ]);
    const subjectIndex = new Map([...ticketSubjects, ...observedSubjects.map((row) => row.asunto)].filter(Boolean).map((value) => [compact(value), text(value)]));
    const technicianIndex = new Map(clients.filter((row) => row.tecnicoId).map((row) => [row.tecnicoId, { id: row.tecnicoId, name: text(row.tecnicoNombre) || `Tecnico #${row.tecnicoId}` }]));
    res.json({ subjects: [...subjectIndex.values()].sort((a, b) => a.localeCompare(b, 'es')), technicians: [...technicianIndex.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
      states: Object.entries(states).map(([id, name]) => ({ id: Number(id), name })), priorities: Object.entries(priorities).map(([id, name]) => ({ id: Number(id), name })), source: 'sqlite', fetchedAt: new Date() });
  }));

  router.get('/tickets/:id/manage', permission(['tecnico']), wrap(async (req, res) => {
    const id = positiveId(req.params.id);
    const local = await prisma.cachedTicket.findUnique({ where: { idTicket: id }, select: { idTicket: true } });
    if (!local) return res.status(404).json({ error: 'Ticket no encontrado', code: 'NOT_FOUND' });
    try { res.json(ticketSnapshot(await provider.read(id), id)); }
    catch (error) { throw Object.assign(new Error('No se pudo leer el ticket en vivo de WispHub'), { status: error.status || 502, code: error.code || 'WISPHUB_TICKET_UNAVAILABLE' }); }
  }));

  async function mutate(req, res, creating) {
    const id = creating ? null : positiveId(req.params.id);
    const keyValue = String(req.headers['idempotency-key'] || '');
    const expectedVersion = String(req.headers['if-match'] || '');
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(keyValue)) return res.status(400).json({ error: 'Falta la clave de operacion', code: 'INVALID_IDEMPOTENCY_KEY' });
    if (!creating && !/^[a-f0-9]{64}$/.test(expectedVersion)) return res.status(400).json({ error: 'Falta la version del ticket', code: 'INVALID_VERSION' });
    const input = validateTicket(req.body, creating);
    const technician = await prisma.client.findFirst({ where: { tecnicoId: input.technicianId }, select: { tecnicoId: true, tecnicoNombre: true } });
    if (!technician) return res.status(400).json({ error: 'El tecnico no aparece en el catalogo sincronizado', code: 'TECHNICIAN_NOT_FOUND' });
    const client = await prisma.client.findUnique({ where: { idServicio: input.clientId }, select: { idServicio: true } });
    if (!client) return res.status(400).json({ error: 'Cliente no encontrado', code: 'CLIENT_NOT_FOUND' });
    const requestHash = createHash('sha256').update(JSON.stringify({ id, expectedVersion, input })).digest('hex');
    const key = { userId: req.mobileUser.id, requestKey: keyValue };
    const old = await prisma.mobileMutation.findUnique({ where: { userId_requestKey: key } });
    if (old) {
      if (old.requestHash !== requestHash) return res.status(409).json({ error: 'La clave pertenece a otra operacion', code: 'IDEMPOTENCY_CONFLICT' });
      return res.status(creating ? 201 : 200).json(JSON.parse(old.resultJson));
    }
    const lock = creating ? `create:${keyValue}` : `ticket:${id}`;
    if (inProgress.has(lock)) return res.status(409).json({ error: 'La operacion ya esta en curso', code: 'TICKET_OPERATION_IN_PROGRESS' });
    inProgress.add(lock);
    try {
      if (!creating) {
        const before = ticketSnapshot(await provider.read(id), id);
        if (before.version !== expectedVersion) return res.status(409).json({ error: 'El ticket cambio en WispHub', code: 'STALE_TICKET', current: before });
      }
      let raw;
      try { raw = creating ? await provider.create(input) : await provider.update(id, input); }
      catch (error) { throw Object.assign(new Error('WispHub no confirmo la operacion del ticket'), { status: error.status || 502, code: error.code || 'WISPHUB_TICKET_WRITE_FAILED' }); }
      const snapshot = ticketSnapshot(raw, id);
      verifyTicket(snapshot, input, technician.tecnicoNombre);
      const result = { ok: true, verified: true, operation: creating ? 'created' : 'updated', ticket: snapshot };
      await prisma.$transaction(async (tx) => {
        await tx.cachedTicket.upsert({ where: { idTicket: snapshot.idTicket }, create: { idTicket: snapshot.idTicket, ...cachedData(snapshot), firstSeenAt: new Date() }, update: cachedData(snapshot) });
        await tx.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(result) } });
        await tx.activity.create({ data: { action: creating ? 'mobile.ticket.created' : 'mobile.ticket.updated', entityType: 'ticket', entityId: String(snapshot.idTicket), details: JSON.stringify({ actor: req.mobileUser.username, clientId: input.clientId, state: snapshot.stateLabel, priority: snapshot.priorityLabel }) } });
      });
      res.status(creating ? 201 : 200).json(result);
    } finally { inProgress.delete(lock); }
  }

  router.post('/tickets', permission(['tecnico']), wrap((req, res) => mutate(req, res, true)));
  router.patch('/tickets/:id', permission(['tecnico']), wrap((req, res) => mutate(req, res, false)));
}

module.exports = { registerMobileTickets, ticketSnapshot, validateTicket, verifyTicket, states, priorities, ticketSubjects };
