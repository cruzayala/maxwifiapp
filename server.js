// ═══════════════════════════════════════════════════════════════
// WISP RD - ISP Management Server
// ═══════════════════════════════════════════════════════════════

console.log('[boot] starting at', new Date().toISOString());
process.on('uncaughtException', (e) => { console.error('[uncaught]', e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('[unhandled]', e); });

require('dotenv/config');
console.log('[boot] dotenv loaded; NODE_ENV=', process.env.NODE_ENV, 'PORT=', process.env.PORT);

// Database schema is applied by the production start command, not at app boot.
console.log('[boot] database schema is managed before server startup');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

console.log('[boot] modules loaded');

const prisma = new PrismaClient();
const app = express();
console.log('[boot] express + prisma instantiated');

const PORT = process.env.PORT || (process.env.NODE_ENV === 'development' ? 7401 : 7400);
const API_KEY = process.env.WISPHUB_API_KEY || '';
const IS_PROD = process.env.NODE_ENV === 'production';

// ─── SECURITY MIDDLEWARE ───
// Trust proxy: Railway/Render mete X-Forwarded-For. Sin esto rate-limiter falla
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // Angular requiere relaxed CSP
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: IS_PROD ? true : ['http://localhost:7400', 'http://127.0.0.1:7400'],
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// Rate limiting solo en endpoints sensibles
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10, // 10 intentos por 15 min
  message: { error: 'Demasiados intentos, intenta mas tarde' },
});

// ─── SYS INFO (egress IP del contenedor para whitelist MikroTik) ───
app.get('/sys/info', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    const { ip } = await r.json();
    res.json({
      egressIp: ip,
      platform: process.env.RAILWAY_ENVIRONMENT_NAME || 'unknown',
      service: process.env.RAILWAY_SERVICE_NAME || 'unknown',
      replica: process.env.RAILWAY_REPLICA_ID || 'unknown',
      uptime: process.uptime(),
      mikrotikHost: process.env.MIKROTIK_HOST,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── HEALTH CHECK ───
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const stats = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
      whatsapp: waStatus,
      mikrotik: mtConn?.connected ? 'connected' : 'disconnected',
      uptime: process.uptime(),
      version: '1.0.0',
    };
    res.json(stats);
  } catch (e) {
    res.status(500).json({ status: 'error', database: 'disconnected', error: e.message });
  }
});

// ─── AUTH (PIN legacy + Users) ───
const bcrypt = require('bcryptjs');

// Sesiones en DB (sobreviven a redeploys) + cache en memoria para performance
// El cache se invalida solo si expira; renovaciones se hacen en background.
const SESSION_CACHE = new Map(); // token -> { expiresAt, userId, role, username, cachedAt }
const SESSION_CACHE_TTL_MS = 30 * 1000; // re-leer de DB cada 30s para coger cambios

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function getSession(token) {
  if (!token) return null;

  // 1. Verificar cache
  const cached = SESSION_CACHE.get(token);
  if (cached) {
    if (Date.now() > cached.expiresAt) {
      SESSION_CACHE.delete(token);
      // Tambien borrar de DB (best-effort)
      prisma.session.delete({ where: { token } }).catch(() => {});
      return null;
    }
    if (Date.now() - cached.cachedAt < SESSION_CACHE_TTL_MS) {
      return cached;
    }
  }

  // 2. Cargar de DB
  const s = await prisma.session.findUnique({ where: { token } }).catch(() => null);
  if (!s) {
    SESSION_CACHE.delete(token);
    return null;
  }
  if (s.expiresAt.getTime() < Date.now()) {
    SESSION_CACHE.delete(token);
    prisma.session.delete({ where: { token } }).catch(() => {});
    return null;
  }
  const sess = {
    expiresAt: s.expiresAt.getTime(),
    userId: s.userId,
    username: s.username,
    role: s.role,
    cachedAt: Date.now(),
  };
  SESSION_CACHE.set(token, sess);
  return sess;
}

async function createSession(token, userId, username, role) {
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8h
  await prisma.session.create({
    data: { token, userId, username, role, expiresAt },
  });
  SESSION_CACHE.set(token, {
    expiresAt: expiresAt.getTime(),
    userId, username, role,
    cachedAt: Date.now(),
  });
}

async function touchSession(token) {
  // Renovar TTL +8h en DB (en background, no bloquea)
  const newExpiry = new Date(Date.now() + 8 * 60 * 60 * 1000);
  prisma.session.update({
    where: { token },
    data: { expiresAt: newExpiry, lastSeen: new Date() },
  }).catch(() => {});
  // Tambien en cache
  const cached = SESSION_CACHE.get(token);
  if (cached) {
    cached.expiresAt = newExpiry.getTime();
    cached.cachedAt = Date.now();
  }
}

async function deleteSession(token) {
  SESSION_CACHE.delete(token);
  await prisma.session.delete({ where: { token } }).catch(() => {});
}

// Cleanup sesiones expiradas cada 1h
setInterval(async () => {
  try {
    const r = await prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (r.count > 0) console.log('[sessions] cleanup:', r.count, 'expired removed');
  } catch (e) { console.error('[sessions] cleanup error:', e.message); }
}, 60 * 60 * 1000);

async function isValidToken(token) {
  return !!(await getSession(token));
}

// Roles - jerarquia (super_admin > admin > tecnico/cobranza > viewer)
const ROLE_HIERARCHY = {
  super_admin: 4,
  admin: 3,
  tecnico: 2,
  cobranza: 2,
  viewer: 1,
};

function userHasRole(session, allowedRoles) {
  if (!session) return false;
  if (!allowedRoles || allowedRoles.length === 0) return true;
  const userLevel = ROLE_HIERARCHY[session.role] || 0;
  // Si requirimos admin, super_admin tambien pasa (mayor nivel)
  return allowedRoles.some((r) => userLevel >= (ROLE_HIERARCHY[r] || 99));
}

async function authMiddleware(req, res, next) {
  // Endpoints publicos (no requieren login)
  if (
    req.path === '/auth/login' ||
    req.path === '/auth/check' ||
    req.path === '/health' ||
    req.path.startsWith('/captive')
  ) return next();

  const token = req.headers['x-auth-token'] || req.query.token;
  const session = await getSession(token);
  if (!session) return res.status(401).json({ error: 'No autorizado' });

  // Renovar sesion (background, no bloquea)
  touchSession(token);
  req.session = session;
  req.user = session;
  next();
}

// Middleware para requerir role minimo: requireRole('admin') o requireRole(['admin','super_admin'])
function requireRole(roles) {
  const list = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!userHasRole(req.session, list)) {
      return res.status(403).json({ error: 'Permisos insuficientes', required: list, your: req.session?.role });
    }
    next();
  };
}

function requireAnyRole(roles) {
  const list = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    const role = req.session?.role;
    const allowed = hasAnyRole(req.session, list);
    if (!allowed) {
      return res.status(403).json({ error: 'Permisos insuficientes', required: list, your: role });
    }
    next();
  };
}

function hasAnyRole(session, roles) {
  const list = Array.isArray(roles) ? roles : [roles];
  const role = session?.role;
  return role === 'super_admin' || role === 'admin' || list.includes(role);
}

function requestIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

async function logActivity(req, data) {
  try {
    const actor = req?.session?.username || data.actor || 'system';
    await prisma.activity.create({
      data: {
        action: data.action,
        entityType: data.entityType || null,
        entityId: data.entityId != null ? String(data.entityId) : null,
        entityName: data.entityName || null,
        details: JSON.stringify({
          actor,
          role: req?.session?.role || data.role || null,
          ...(data.details || {}),
        }),
        ipAddress: req ? requestIp(req) : null,
        userAgent: req?.headers?.['user-agent'] || null,
      },
    });
  } catch (e) {
    console.error('[activity] log error:', e.message);
  }
}

async function ensureSuperAdmin() {
  const userCount = await prisma.user.count();
  if (userCount > 0) return;
  const username = process.env.ADMIN_USERNAME || (IS_PROD ? '' : 'admin');
  const password = process.env.ADMIN_PASSWORD || (IS_PROD ? '' : 'admin12345');
  if (!username || !password) {
    throw new Error('No users exist. Set ADMIN_USERNAME and ADMIN_PASSWORD for the first boot.');
  }
  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters long.');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      username,
      passwordHash,
      fullName: process.env.ADMIN_FULL_NAME || 'Super Administrador',
      role: 'super_admin',
      isActive: true,
      passwordChangedAt: new Date(),
    },
  });
  console.log(`[auth] Super admin seeded: username=${username}`);
}

app.get('/auth/check', (req, res) => {
  res.json({ authMode: 'users', loginEndpoint: '/auth/login' });
});

app.post('/auth/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username y password requeridos' });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'Usuario o clave incorrectos' });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Usuario o clave incorrectos' });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastLoginIp: req.ip || null },
  }).catch(() => {});

  const token = generateToken();
  await createSession(token, user.id, user.username, user.role);
  res.json({
    token,
    user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role },
  });
});

app.get('/auth/me', authMiddleware, (req, res) => {
  res.json({
    userId: req.session?.userId,
    username: req.session?.username,
    role: req.session?.role,
  });
});

app.post('/auth/logout', async (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) await deleteSession(token);
  res.json({ success: true });
});

// ─── USERS CRUD (gestionar admins) ───
const usersRouter = express.Router();
usersRouter.use(authMiddleware);

// Listar usuarios (admin+)
usersRouter.get('/', requireRole(['admin']), asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true, username: true, fullName: true, email: true,
      role: true, isActive: true, lastLoginAt: true, lastLoginIp: true,
      createdAt: true, passwordChangedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(users);
}));

// Crear usuario (super_admin)
usersRouter.post('/', requireRole(['super_admin']), asyncHandler(async (req, res) => {
  const { username, password, fullName, email, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username y password requeridos' });
  if (password.length < 6) return res.status(400).json({ error: 'Clave minimo 6 caracteres' });

  const validRoles = ['super_admin', 'admin', 'tecnico', 'cobranza', 'viewer'];
  if (role && !validRoles.includes(role)) return res.status(400).json({ error: `Rol invalido. Validos: ${validRoles.join(', ')}` });

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const created = await prisma.user.create({
      data: {
        username, passwordHash,
        fullName: fullName || null,
        email: email || null,
        role: role || 'admin',
        createdById: req.session?.userId || null,
        passwordChangedAt: new Date(),
      },
      select: { id: true, username: true, fullName: true, email: true, role: true, isActive: true, createdAt: true },
    });
    res.status(201).json(created);
  } catch (e) {
    if (String(e.message).includes('Unique')) return res.status(409).json({ error: 'Username ya existe' });
    res.status(500).json({ error: e.message });
  }
}));

// Ver uno (admin+ o el mismo usuario)
usersRouter.get('/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: parseInt(req.params.id) },
    select: { id: true, username: true, fullName: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
  });
  if (!user) return res.status(404).json({ error: 'No encontrado' });
  res.json(user);
}));

// Editar datos (super_admin para cambiar rol; admin para datos basicos)
usersRouter.patch('/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const data = {};
  if (typeof req.body?.fullName === 'string') data.fullName = req.body.fullName.trim() || null;
  if (typeof req.body?.email === 'string') data.email = req.body.email.trim() || null;
  if (typeof req.body?.isActive === 'boolean') data.isActive = req.body.isActive;
  if (typeof req.body?.role === 'string') {
    if (!userHasRole(req.session, ['super_admin'])) {
      return res.status(403).json({ error: 'Solo super_admin puede cambiar el rol' });
    }
    const validRoles = ['super_admin', 'admin', 'tecnico', 'cobranza', 'viewer'];
    if (!validRoles.includes(req.body.role)) return res.status(400).json({ error: 'Rol invalido' });
    data.role = req.body.role;
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, username: true, fullName: true, email: true, role: true, isActive: true },
  }).catch(() => null);
  if (!updated) return res.status(404).json({ error: 'No encontrado' });
  res.json(updated);
}));

// Cambiar password (super_admin para cualquier user; user mismo para su clave)
usersRouter.post('/:id/password', authMiddleware, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const { newPassword, currentPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'newPassword min 6 chars' });

  const isSuperAdmin = userHasRole(req.session, ['super_admin']);
  const isSelf = req.session?.userId === id;
  if (!isSuperAdmin && !isSelf) return res.status(403).json({ error: 'Solo puedes cambiar tu propia clave' });

  // Self change requiere current password
  if (isSelf && !isSuperAdmin) {
    if (!currentPassword) return res.status(400).json({ error: 'currentPassword requerido' });
    const user = await prisma.user.findUnique({ where: { id } });
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Clave actual incorrecta' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id },
    data: { passwordHash, passwordChangedAt: new Date() },
  });
  res.json({ ok: true });
}));

// Eliminar (super_admin) - no permite borrarse a si mismo ni dejar 0 super_admin
usersRouter.delete('/:id', requireRole(['super_admin']), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.session?.userId) return res.status(400).json({ error: 'No puedes borrar tu propio usuario' });

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ error: 'No encontrado' });

  if (target.role === 'super_admin') {
    const superAdminCount = await prisma.user.count({ where: { role: 'super_admin', isActive: true } });
    if (superAdminCount <= 1) return res.status(400).json({ error: 'Debe quedar al menos un super_admin activo' });
  }

  await prisma.user.delete({ where: { id } });
  res.json({ ok: true });
}));

app.use('/users', usersRouter);

// ─── DB ENDPOINTS (todos protegidos) ───
const dbRouter = express.Router();
dbRouter.use(authMiddleware);

// Helper
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// PAYMENTS
dbRouter.get('/payments', asyncHandler(async (req, res) => {
  const payments = await prisma.paymentLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: parseInt(req.query.limit) || 200,
  });
  res.json(payments);
}));

dbRouter.post('/payments', asyncHandler(async (req, res) => {
  if (!hasAnyRole(req.session, ['cobranza'])) return res.status(403).json({ error: 'Permisos insuficientes' });
  const p = await prisma.paymentLog.create({
    data: { ...req.body, paidAt: new Date(req.body.paidAt) }
  });
  await logActivity(req, {
    action: 'payment_log_created',
    entityType: 'payment',
    entityId: p.id,
    entityName: p.clientName,
    details: { idFactura: p.idFactura, idServicio: p.idServicio, amount: p.amount },
  });
  res.json(p);
}));

// WHATSAPP LOG
dbRouter.get('/whatsapp', asyncHandler(async (req, res) => {
  const msgs = await prisma.whatsappLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: parseInt(req.query.limit) || 200,
  });
  res.json(msgs);
}));

// NOTES
dbRouter.get('/notes/:idServicio', asyncHandler(async (req, res) => {
  const notes = await prisma.clientNote.findMany({
    where: { idServicio: parseInt(req.params.idServicio) },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
  });
  res.json(notes);
}));

dbRouter.get('/notes', asyncHandler(async (req, res) => {
  const notes = await prisma.clientNote.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(notes);
}));

dbRouter.post('/notes', asyncHandler(async (req, res) => {
  if (!hasAnyRole(req.session, ['cobranza'])) return res.status(403).json({ error: 'Permisos insuficientes' });
  const n = await prisma.clientNote.create({ data: req.body });
  await logActivity(req, {
    action: 'client_note_created',
    entityType: 'client',
    entityId: n.idServicio,
    entityName: n.clientName,
    details: { noteId: n.id, priority: n.priority },
  });
  res.json(n);
}));

dbRouter.put('/notes/:id', asyncHandler(async (req, res) => {
  if (!hasAnyRole(req.session, ['cobranza'])) return res.status(403).json({ error: 'Permisos insuficientes' });
  const n = await prisma.clientNote.update({
    where: { id: parseInt(req.params.id) },
    data: req.body,
  });
  await logActivity(req, {
    action: 'client_note_updated',
    entityType: 'client',
    entityId: n.idServicio,
    entityName: n.clientName,
    details: { noteId: n.id, priority: n.priority },
  });
  res.json(n);
}));

dbRouter.delete('/notes/:id', asyncHandler(async (req, res) => {
  if (!hasAnyRole(req.session, ['cobranza'])) return res.status(403).json({ error: 'Permisos insuficientes' });
  const deleted = await prisma.clientNote.delete({ where: { id: parseInt(req.params.id) } });
  await logActivity(req, {
    action: 'client_note_deleted',
    entityType: 'client',
    entityId: deleted.idServicio,
    entityName: deleted.clientName,
    details: { noteId: deleted.id },
  });
  res.json({ success: true });
}));

// GPS capturado por el tecnico en sitio. Idempotente.
dbRouter.post('/clients/:idServicio/gps', asyncHandler(async (req, res) => {
  const idServicio = parseInt(req.params.idServicio);
  const { lat, lng, accuracy } = req.body || {};
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    return res.status(400).json({ error: 'lat/lng invalidos' });
  }
  if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    return res.status(400).json({ error: 'lat/lng fuera de rango' });
  }
  const updated = await prisma.client.update({
    where: { idServicio },
    data: {
      gpsLat: latNum,
      gpsLng: lngNum,
      gpsAccuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
      gpsCapturedAt: new Date(),
      gpsCapturedBy: req.session?.username || 'admin',
    },
    select: { idServicio: true, nombre: true, gpsLat: true, gpsLng: true, gpsAccuracy: true, gpsCapturedAt: true, gpsCapturedBy: true },
  });
  res.json({ ok: true, client: updated });
}));

// Listado para mapa: solo clientes con GPS valido (capturado por tecnico o desde WispHub)
// Devuelve solo los campos que necesita el mapa para minimizar payload
dbRouter.get('/clients/map', asyncHandler(async (req, res) => {
  // 1) Stats de debug: cuantos clientes hay y cuantos tienen GPS de cada origen
  const [totalClients, withGpsTecnico, withCoordsWispHub] = await Promise.all([
    prisma.client.count(),
    prisma.client.count({ where: { AND: [ { gpsLat: { not: null } }, { gpsLng: { not: null } } ] } }),
    prisma.client.count({ where: { coordenadas: { not: null } } }),
  ]);

  // 2) Traer clientes con cualquier tipo de coords
  const all = await prisma.client.findMany({
    where: {
      OR: [
        { AND: [ { gpsLat: { not: null } }, { gpsLng: { not: null } } ] },
        { coordenadas: { not: null } },
      ],
    },
    select: {
      idServicio: true, nombre: true, telefono: true, ip: true,
      planInternetName: true, estado: true, estadoFacturas: true,
      zonaNombre: true, direccion: true,
      gpsLat: true, gpsLng: true, gpsAccuracy: true, gpsCapturedAt: true,
      coordenadas: true,
    },
  });
  const out = [];
  const skippedBadCoords = [];
  for (const c of all) {
    let lat = c.gpsLat, lng = c.gpsLng;
    let source = c.gpsLat != null ? 'tecnico' : null;
    if ((lat == null || lng == null) && c.coordenadas) {
      const parts = c.coordenadas.split(/[,\s]+/).filter(Boolean);
      if (parts.length >= 2) {
        const a = Number(parts[0]), b = Number(parts[1]);
        if (Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180) {
          lat = a; lng = b; source = 'wisphub';
        }
      }
    }
    if (lat == null || lng == null) {
      skippedBadCoords.push({ id: c.idServicio, nombre: c.nombre, coordenadas: c.coordenadas });
      continue;
    }
    out.push({
      id: c.idServicio, nombre: c.nombre, telefono: c.telefono, ip: c.ip,
      plan: c.planInternetName, estado: c.estado, estadoFacturas: c.estadoFacturas,
      zona: c.zonaNombre, direccion: c.direccion,
      lat, lng, accuracy: c.gpsAccuracy, capturedAt: c.gpsCapturedAt, source,
    });
  }
  res.json({
    ok: true,
    count: out.length,
    stats: {
      totalClients,
      withGpsTecnico,
      withCoordsWispHub,
      shownInMap: out.length,
      skippedBadCoords: skippedBadCoords.length,
    },
    clients: out,
    skipped: skippedBadCoords.slice(0, 10), // primeros 10 con coords invalidas (debug)
  });
}));

// SPEED TESTS
dbRouter.get('/speedtests', asyncHandler(async (req, res) => {
  const where = req.query.idServicio ? { idServicio: parseInt(req.query.idServicio) } : {};
  const tests = await prisma.speedTest.findMany({
    where, orderBy: { createdAt: 'desc' }, take: parseInt(req.query.limit) || 100,
  });
  res.json(tests);
}));

dbRouter.post('/speedtests', asyncHandler(async (req, res) => {
  if (!hasAnyRole(req.session, ['tecnico'])) return res.status(403).json({ error: 'Permisos insuficientes' });
  const t = await prisma.speedTest.create({ data: req.body });
  res.json(t);
}));

// PROMISES
dbRouter.get('/promises', asyncHandler(async (req, res) => {
  const where = req.query.idServicio ? { idServicio: parseInt(req.query.idServicio) } : {};
  const promises = await prisma.paymentPromise.findMany({ where, orderBy: { promisedDate: 'asc' } });
  res.json(promises);
}));

dbRouter.post('/promises', asyncHandler(async (req, res) => {
  if (!hasAnyRole(req.session, ['cobranza'])) return res.status(403).json({ error: 'Permisos insuficientes' });
  const p = await prisma.paymentPromise.create({
    data: { ...req.body, promisedDate: new Date(req.body.promisedDate) },
  });
  await logActivity(req, {
    action: 'payment_promise_created',
    entityType: 'client',
    entityId: p.idServicio,
    entityName: p.clientName,
    details: { promiseId: p.id, amount: p.amount, promisedDate: p.promisedDate },
  });
  res.json(p);
}));

dbRouter.put('/promises/:id', asyncHandler(async (req, res) => {
  if (!hasAnyRole(req.session, ['cobranza'])) return res.status(403).json({ error: 'Permisos insuficientes' });
  const data = { ...req.body };
  if (data.promisedDate) data.promisedDate = new Date(data.promisedDate);
  if (data.completedAt) data.completedAt = new Date(data.completedAt);
  const p = await prisma.paymentPromise.update({
    where: { id: parseInt(req.params.id) }, data,
  });
  await logActivity(req, {
    action: 'payment_promise_updated',
    entityType: 'client',
    entityId: p.idServicio,
    entityName: p.clientName,
    details: { promiseId: p.id, status: p.status },
  });
  res.json(p);
}));

// SETTINGS
dbRouter.get('/settings', asyncHandler(async (req, res) => {
  const settings = await prisma.appSetting.findMany();
  const obj = {};
  settings.forEach(s => { obj[s.key] = s.value; });
  res.json(obj);
}));

dbRouter.put('/settings', asyncHandler(async (req, res) => {
  if (!userHasRole(req.session, ['admin'])) return res.status(403).json({ error: 'Permisos insuficientes' });
  const updates = Object.entries(req.body).map(([key, value]) =>
    prisma.appSetting.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) },
    })
  );
  await Promise.all(updates);
  await logActivity(req, {
    action: 'settings_updated',
    entityType: 'setting',
    details: { keys: Object.keys(req.body || {}) },
  });
  res.json({ success: true });
}));

// ACTIVITY
dbRouter.get('/activity', asyncHandler(async (req, res) => {
  const activity = await prisma.activity.findMany({
    orderBy: { createdAt: 'desc' },
    take: parseInt(req.query.limit) || 100,
  });
  res.json(activity);
}));

dbRouter.post('/activity', asyncHandler(async (req, res) => {
  if (!userHasRole(req.session, ['admin'])) return res.status(403).json({ error: 'Permisos insuficientes' });
  const a = await prisma.activity.create({ data: req.body });
  res.json(a);
}));

// CLIENTS (cached)
dbRouter.get('/clients', asyncHandler(async (req, res) => {
  const clients = await prisma.client.findMany({
    orderBy: { idServicio: 'desc' },
    take: parseInt(req.query.limit) || 1000,
  });
  res.json(clients);
}));

dbRouter.get('/clients/:id', asyncHandler(async (req, res) => {
  const c = await prisma.client.findUnique({
    where: { idServicio: parseInt(req.params.id) },
    include: { notes: true, tags: { include: { tag: true } }, promises: true }
  });
  res.json(c);
}));

// INVOICES (cached)
dbRouter.get('/invoices', asyncHandler(async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    orderBy: { idFactura: 'desc' },
    include: { articles: true },
    take: parseInt(req.query.limit) || 1000,
  });
  res.json(invoices);
}));

// SYNC FROM WISPHUB - guarda clientes/facturas en la DB
dbRouter.post('/sync/clients', asyncHandler(async (req, res) => {
  if (!userHasRole(req.session, ['admin'])) return res.status(403).json({ error: 'Permisos insuficientes' });
  const { clients } = req.body;
  if (!Array.isArray(clients)) return res.status(400).json({ error: 'clients array required' });

  const log = await prisma.syncLog.create({
    data: { entity: 'clients', status: 'pending', recordCount: clients.length }
  });

  let count = 0;
  try {
    for (const c of clients) {
      const data = {
        idServicio: c.id_servicio,
        usuario: c.usuario || null,
        nombre: c.nombre || '',
        email: c.email || null,
        cedula: c.cedula || null,
        telefono: c.telefono || null,
        direccion: c.direccion || null,
        localidad: c.localidad || null,
        ciudad: c.ciudad || null,
        coordenadas: c.coordenadas || null,
        planInternetId: c.plan_internet?.id || null,
        planInternetName: c.plan_internet?.nombre || null,
        precioPlan: c.precio_plan || null,
        descuento: c.descuento || null,
        saldo: c.saldo || null,
        estadoFacturas: c.estado_facturas || null,
        estado: c.estado || null,
        ip: c.ip || null,
        ipLocal: c.ip_local || null,
        macCpe: c.mac_cpe || null,
        interfazLan: c.interfaz_lan || null,
        snOnu: c.sn_onu || null,
        modeloRouterWifi: c.modelo_router_wifi || null,
        ipRouterWifi: c.ip_router_wifi || null,
        macRouterWifi: c.mac_router_wifi || null,
        ssidRouterWifi: c.ssid_router_wifi || null,
        passwordSsidWifi: c.password_ssid_router_wifi || null,
        zonaId: c.zona?.id || null,
        zonaNombre: c.zona?.nombre || null,
        routerId: c.router?.id || null,
        routerNombre: c.router?.nombre || null,
        sectorialId: c.sectorial?.id || null,
        sectorialNombre: c.sectorial?.nombre || null,
        modeloAntenaId: c.modelo_antena?.id || null,
        modeloAntenaName: c.modelo_antena?.nombre || null,
        tecnicoId: c.tecnico?.id || null,
        tecnicoNombre: c.tecnico?.nombre || null,
        firewall: c.firewall ?? true,
        autoActivar: c.auto_activar_servicio ?? false,
        formaContratacion: c.forma_contratacion || null,
        comentarios: c.comentarios || null,
        fechaInstalacion: c.fecha_instalacion || null,
        fechaCancelacion: c.fecha_cancelacion || null,
        fechaCorte: c.fecha_corte || null,
        ultimoCambio: c.ultimo_cambio || null,
        syncedAt: new Date(),
      };

      await prisma.client.upsert({
        where: { idServicio: data.idServicio },
        update: data,
        create: data,
      });
      count++;
    }

    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: 'success', recordCount: count, endedAt: new Date(), durationMs: Date.now() - log.startedAt.getTime() },
    });

    await logActivity(req, {
      action: 'sync_clients',
      entityType: 'sync',
      entityName: 'clients',
      details: { count },
    });
    res.json({ success: true, count });
  } catch (e) {
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: 'error', errorMessage: e.message, endedAt: new Date() },
    });
    throw e;
  }
}));

dbRouter.post('/sync/invoices', asyncHandler(async (req, res) => {
  if (!userHasRole(req.session, ['admin'])) return res.status(403).json({ error: 'Permisos insuficientes' });
  const { invoices } = req.body;
  if (!Array.isArray(invoices)) return res.status(400).json({ error: 'invoices array required' });

  const log = await prisma.syncLog.create({
    data: { entity: 'invoices', status: 'pending', recordCount: invoices.length }
  });

  let count = 0;
  try {
    for (const inv of invoices) {
      // Find client by name (since invoices may not have client id)
      const idServicio = inv.articulos?.[0]?.servicio?.id_servicio || null;

      const data = {
        idFactura: inv.id_factura,
        folio: inv.folio || null,
        fechaEmision: inv.fecha_emision || null,
        fechaVencimiento: inv.fecha_vencimiento || null,
        fechaPago: inv.fecha_pago || null,
        estado: inv.estado || null,
        tipo: inv.tipo || null,
        subTotal: inv.sub_total || 0,
        descuento: inv.descuento || 0,
        impuestosTotal: inv.impuestos_total || 0,
        total: inv.total || 0,
        totalCobrado: inv.total_cobrado || 0,
        saldo: inv.saldo || 0,
        saldoNuevo: inv.saldo_nuevo || 0,
        comprobantePago: inv.comprobante_pago || null,
        referencia: inv.referencia || null,
        referenciaOxxo: inv.referencia_oxxo || null,
        totalPasarela: inv.total_pasarela || 0,
        totalOpenpay: inv.total_openpay || 0,
        totalOxxo: inv.total_oxxo || 0,
        idMercadopago: inv.id_mercadopago || null,
        idPayu: inv.id_payu || null,
        urlPayu: inv.url_payu || null,
        retencionPorcentaje: inv.retencion_porcentaje || 0,
        retencionesTotal: inv.retenciones_total || 0,
        zonaId: inv.zona?.id || null,
        zonaNombre: inv.zona?.nombre || null,
        formaPagoId: inv.forma_pago?.id || null,
        formaPagoNombre: inv.forma_pago?.nombre || null,
        cajeroId: inv.cajero?.id || null,
        cajeroNombre: inv.cajero?.nombre || null,
        clienteIdServicio: idServicio,
        clienteNombre: inv.cliente?.nombre || '',
        clienteUsuario: inv.cliente?.usuario || null,
        clienteCedula: inv.cliente?.cedula || null,
        clienteTelefono: inv.cliente?.telefono || null,
        clienteDireccion: inv.cliente?.direccion || null,
        clienteEmail: inv.cliente?.email || null,
        clienteRfc: inv.cliente?.rfc || null,
        syncedAt: new Date(),
      };

      // Skip FK if client doesn't exist in cache
      if (idServicio) {
        const exists = await prisma.client.findUnique({ where: { idServicio } });
        if (!exists) data.clienteIdServicio = null;
      }

      await prisma.invoice.upsert({
        where: { idFactura: data.idFactura },
        update: data,
        create: data,
      });

      // Save articles
      if (inv.articulos?.length) {
        await prisma.invoiceArticle.deleteMany({ where: { idFactura: inv.id_factura } });
        for (const art of inv.articulos) {
          await prisma.invoiceArticle.create({
            data: {
              idFactura: inv.id_factura,
              remoteId: art.id || null,
              uuidEquipo: art.uuid_equipo || null,
              categoriaStock: art.categoria_stock || null,
              cantidad: art.cantidad || 1,
              descripcion: art.descripcion || '',
              precio: String(art.precio || 0),
              idServicio: art.servicio?.id_servicio || null,
            }
          });
        }
      }
      count++;
    }

    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: 'success', recordCount: count, endedAt: new Date(), durationMs: Date.now() - log.startedAt.getTime() },
    });

    let autoPaymentWarningCleared = [];
    try {
      autoPaymentWarningCleared = await reconcileResolvedPaymentWarnings();
    } catch (e) {
      console.error('[payment-warning] reconcile after invoice sync failed:', e.message);
    }
    await logActivity(req, {
      action: 'sync_invoices',
      entityType: 'sync',
      entityName: 'invoices',
      details: { count, autoPaymentWarningCleared: autoPaymentWarningCleared.length },
    });
    res.json({ success: true, count, autoPaymentWarningCleared: autoPaymentWarningCleared.length });
  } catch (e) {
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: 'error', errorMessage: e.message, endedAt: new Date() },
    });
    throw e;
  }
}));

// STATS
dbRouter.get('/stats', asyncHandler(async (req, res) => {
  const [paymentCount, totalPayments, wappCount, notesCount, speedCount, promiseCount, clientCount, invoiceCount] = await Promise.all([
    prisma.paymentLog.count(),
    prisma.paymentLog.aggregate({ _sum: { amount: true } }),
    prisma.whatsappLog.count(),
    prisma.clientNote.count(),
    prisma.speedTest.count(),
    prisma.paymentPromise.count({ where: { status: 'pending' } }),
    prisma.client.count(),
    prisma.invoice.count(),
  ]);

  res.json({
    payments: { count: paymentCount, total: totalPayments._sum.amount || 0 },
    whatsapp: { count: wappCount },
    notes: { count: notesCount },
    speedtests: { count: speedCount },
    promises: { pending: promiseCount },
    clients: { count: clientCount },
    invoices: { count: invoiceCount },
  });
}));

// BACKUP - descargar data.db
dbRouter.get('/backup', requireRole(['admin']), (req, res) => {
  const dbPath = path.join(__dirname, 'prisma', 'data.db');
  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: 'DB no encontrada' });
  }
  const date = new Date().toISOString().slice(0, 10);
  res.download(dbPath, `wishub-backup-${date}.db`);
});

app.use('/db', dbRouter);

// Survey router (declarado/montado AQUI antes del proxy /api -> WispHub
// para que /api/survey/* matchee local en vez de irse al proxy)
const surveyRouter = express.Router();
app.use('/api/survey', surveyRouter);

// ─── WISPHUB API PROXY (autenticado tambien) ───
const apiRouter = express.Router();
apiRouter.use(authMiddleware);
apiRouter.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const pathName = req.path.toLowerCase();
  const requiredRole =
    pathName.includes('/ping/')
      ? 'tecnico'
      : pathName.includes('/registrar-pago/') || pathName.includes('/clientes/activar/')
      ? 'cobranza'
      : pathName.includes('/clientes/desactivar/') || pathName.includes('/eliminar-clientes/')
      ? 'admin'
      : 'admin';
  const allowed = requiredRole === 'tecnico'
    ? ['tecnico', 'admin', 'super_admin'].includes(req.session?.role)
    : requiredRole === 'cobranza'
    ? ['cobranza', 'admin', 'super_admin'].includes(req.session?.role)
    : userHasRole(req.session, [requiredRole]);
  if (!allowed) {
    return res.status(403).json({ error: 'Permisos insuficientes', required: requiredRole, your: req.session?.role });
  }
  next();
});

if (API_KEY) {
  apiRouter.use('/', createProxyMiddleware({
    target: 'https://api.wisphub.io',
    changeOrigin: true,
    pathRewrite: { '^/': '/api/' },
    headers: { 'Authorization': `Api-Key ${API_KEY}` },
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('Authorization', `Api-Key ${API_KEY}`);
        proxyReq.setHeader('Accept', 'application/json');
      },
    },
  }));
} else {
  apiRouter.use((req, res) => {
    res.status(503).json({ error: 'WISPHUB_API_KEY is not configured on the server' });
  });
}

app.use('/api', apiRouter);

// ─── MIKROTIK INTEGRATION ───
const { RouterOSAPI } = require('node-routeros');

const MT_HOST = process.env.MIKROTIK_HOST;
const MT_USER = process.env.MIKROTIK_USER;
const MT_PASS = process.env.MIKROTIK_PASS;
const MT_PORT = parseInt(process.env.MIKROTIK_PORT || '8728');

let mtConn = null;
let mtConnecting = false;
let mtLastError = null;

// Wrapper que envuelve c.write con timeout. Si el MikroTik cuelga, devuelve error
// en vez de quedarse esperando indefinido. Uso: await mtWrite(c, 5000, '/ip/arp/print')
async function mtWrite(c, timeoutMs, ...args) {
  return await Promise.race([
    c.write(...args),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`MikroTik timeout ${timeoutMs}ms`)), timeoutMs)),
  ]);
}

async function getMtConnection() {
  if (!MT_HOST || !MT_USER || !MT_PASS) {
    throw new Error('MikroTik no configurado en .env');
  }

  if (mtConn?.connected) return mtConn;

  if (mtConnecting) {
    // Esperar conexion en curso
    let waited = 0;
    while (mtConnecting && waited < 5000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
    if (mtConn?.connected) return mtConn;
  }

  mtConnecting = true;
  try {
    if (mtConn) try { await mtConn.close(); } catch {}
    mtConn = new RouterOSAPI({
      host: MT_HOST, user: MT_USER, password: MT_PASS, port: MT_PORT,
      timeout: 10, keepalive: true,
    });
    await mtConn.connect();
    mtLastError = null;
    return mtConn;
  } catch (e) {
    mtLastError = e.message;
    mtConn = null;
    throw e;
  } finally {
    mtConnecting = false;
  }
}

const mtRouter = express.Router();
mtRouter.use(authMiddleware);
mtRouter.use(requireAnyRole(['tecnico']));

// Status
mtRouter.get('/status', asyncHandler(async (req, res) => {
  res.json({
    configured: !!(MT_HOST && MT_USER && MT_PASS),
    connected: !!mtConn?.connected,
    host: MT_HOST,
    error: mtLastError,
  });
}));

// System info
mtRouter.get('/system', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const [resource, identity, health] = await Promise.all([
    c.write('/system/resource/print'),
    c.write('/system/identity/print'),
    c.write('/system/health/print').catch(() => []),
  ]);
  res.json({ resource: resource[0], identity: identity[0]?.name, health });
}));

// Interfaces
mtRouter.get('/interfaces', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const ifaces = await c.write('/interface/print');
  res.json(ifaces);
}));

// Traffic - bytes en tiempo real
mtRouter.get('/traffic', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const ifaces = await c.write('/interface/print');
  res.json(ifaces.map(i => ({
    name: i.name,
    type: i.type,
    running: i.running === 'true',
    macAddress: i['mac-address'],
    rxBytes: parseInt(i['rx-byte'] || '0'),
    txBytes: parseInt(i['tx-byte'] || '0'),
    rxPackets: parseInt(i['rx-packet'] || '0'),
    txPackets: parseInt(i['tx-packet'] || '0'),
  })));
}));

// Monitor traffic en vivo de una interface
mtRouter.get('/monitor/:iface', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const result = await c.write('/interface/monitor-traffic', '=interface=' + req.params.iface, '=once=');
  res.json(result[0] || {});
}));

// Simple Queues - clientes con limite de banda
mtRouter.get('/queues', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const queues = await c.write('/queue/simple/print');
  res.json(queues.map(q => ({
    id: q['.id'],
    name: q.name,
    target: q.target,
    maxLimit: q['max-limit'],
    burstLimit: q['burst-limit'],
    burstThreshold: q['burst-threshold'],
    burstTime: q['burst-time'],
    bytes: q.bytes,  // upload/download
    packets: q.packets,
    rate: q.rate,
    disabled: q.disabled === 'true',
  })));
}));

// Stats de queue especifica con bandwidth actual
mtRouter.get('/queue-stats', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const queues = await c.write('/queue/simple/print', '=stats=');
  res.json(queues);
}));

// IP Addresses
mtRouter.get('/addresses', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const addrs = await c.write('/ip/address/print');
  res.json(addrs);
}));

// Active sessions PPPoE / Hotspot
mtRouter.get('/active-sessions', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const [pppoe, hotspot] = await Promise.all([
    c.write('/ppp/active/print').catch(() => []),
    c.write('/ip/hotspot/active/print').catch(() => []),
  ]);
  res.json({ pppoe, hotspot });
}));

// DHCP Leases
mtRouter.get('/dhcp-leases', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const leases = await c.write('/ip/dhcp-server/lease/print');
  res.json(leases);
}));

// ARP Table
mtRouter.get('/arp', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const arp = await c.write('/ip/arp/print');
  res.json(arp);
}));

// Cache para calcular bandwidth en tiempo real (delta entre samples)
const bandwidthCache = new Map(); // ip → { upload, download, timestamp }

// Cliente live: queue + WispHub client + bandwidth real-time
mtRouter.get('/clients-live', asyncHandler(async (req, res) => {
  const c = await getMtConnection();

  // 1. Get queues with stats (incluye rate actual calculado por MikroTik) - timeout 8s
  const queues = await mtWrite(c, 8000, '/queue/simple/print', '=stats=');

  // 2. Get clients from local DB cache (mas rapido que pegarle a WispHub)
  const clients = await prisma.client.findMany({
    where: { ip: { not: null } },
    select: {
      idServicio: true, nombre: true, ip: true, telefono: true,
      planInternetName: true, precioPlan: true, estado: true,
      estadoFacturas: true, zonaNombre: true,
    }
  });
  const clientsByIp = new Map();
  clients.forEach(cl => { if (cl.ip) clientsByIp.set(cl.ip, cl); });

  const now = Date.now();
  const result = [];

  for (const q of queues) {
    const targetIp = (q.target || '').split('/')[0];
    if (!targetIp) continue;

    const bytes = (q.bytes || '0/0').split('/');
    const uploadBytes = parseInt(bytes[0] || '0');
    const downloadBytes = parseInt(bytes[1] || '0');
    const totalBytes = uploadBytes + downloadBytes;

    // El campo 'rate' del MikroTik viene como "uploadBps/downloadBps" en bps
    // Si MikroTik no lo provee (sin stats=), usamos cache delta como fallback
    let uploadBps = 0, downloadBps = 0;

    if (q.rate) {
      const rateParts = q.rate.split('/');
      uploadBps = parseInt(rateParts[0] || '0');
      downloadBps = parseInt(rateParts[1] || '0');
    } else {
      // Fallback: calcular delta
      const prev = bandwidthCache.get(targetIp);
      if (prev) {
        const dt = (now - prev.timestamp) / 1000;
        if (dt >= 1 && dt <= 15) {
          const upDelta = uploadBytes - prev.upload;
          const downDelta = downloadBytes - prev.download;
          if (upDelta >= 0 && upDelta < 1e10) uploadBps = (upDelta * 8) / dt;
          if (downDelta >= 0 && downDelta < 1e10) downloadBps = (downDelta * 8) / dt;
        }
      }
      bandwidthCache.set(targetIp, { upload: uploadBytes, download: downloadBytes, timestamp: now });
    }

    // Sanity check: ignorar valores que excedan 10x el max-limit (algun bug de counter)
    const maxReasonableUp = (parseInt((q['max-limit'] || '0/0').split('/')[0] || '0') || 1e9) * 10;
    const maxReasonableDown = (parseInt((q['max-limit'] || '0/0').split('/')[1] || '0') || 1e9) * 10;
    if (uploadBps > maxReasonableUp) uploadBps = 0;
    if (downloadBps > maxReasonableDown) downloadBps = 0;

    const client = clientsByIp.get(targetIp);

    // Parse max-limit "4300000/4300000"
    const limits = (q['max-limit'] || '0/0').split('/');
    const maxUp = parseInt(limits[0] || '0');
    const maxDown = parseInt(limits[1] || '0');

    result.push({
      queueName: q.name,
      ip: targetIp,
      // Cliente WispHub
      client: client ? {
        id: client.idServicio,
        name: client.nombre,
        phone: client.telefono,
        plan: client.planInternetName,
        price: client.precioPlan,
        zone: client.zonaNombre,
        status: client.estado,
        invoiceStatus: client.estadoFacturas,
      } : null,
      // Queue
      maxUploadBps: maxUp,
      maxDownloadBps: maxDown,
      // Acumulado historico
      totalUploadBytes: uploadBytes,
      totalDownloadBytes: downloadBytes,
      totalBytes,
      // En vivo (bps actual)
      uploadBps,
      downloadBps,
      // Utilizacion %
      uploadPct: maxUp > 0 ? Math.min(100, (uploadBps / maxUp) * 100) : 0,
      downloadPct: maxDown > 0 ? Math.min(100, (downloadBps / maxDown) * 100) : 0,
      isActive: uploadBps + downloadBps > 0,
      isDisabled: q.disabled === 'true',
    });
  }

  // Stats globales
  const totalUp = result.reduce((s, r) => s + r.uploadBps, 0);
  const totalDown = result.reduce((s, r) => s + r.downloadBps, 0);
  const activeCount = result.filter(r => r.isActive).length;

  res.json({
    timestamp: new Date().toISOString(),
    stats: {
      totalQueues: result.length,
      activeClients: activeCount,
      totalUploadBps: totalUp,
      totalDownloadBps: totalDown,
      totalBpsCombined: totalUp + totalDown,
    },
    clients: result,
  });
}));

// Top consumers (queue ordenadas por bytes)
mtRouter.get('/top-consumers', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const queues = await c.write('/queue/simple/print');
  const consumers = queues.map(q => {
    const bytes = (q.bytes || '0/0').split('/');
    return {
      name: q.name,
      target: q.target,
      maxLimit: q['max-limit'],
      uploadBytes: parseInt(bytes[0] || '0'),
      downloadBytes: parseInt(bytes[1] || '0'),
      totalBytes: parseInt(bytes[0] || '0') + parseInt(bytes[1] || '0'),
    };
  });
  consumers.sort((a, b) => b.totalBytes - a.totalBytes);
  res.json(consumers.slice(0, parseInt(req.query.limit) || 20));
}));

// Ping desde el MikroTik
mtRouter.post('/ping', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const { address, count = 4 } = req.body;
  const result = await c.write('/ping', '=address=' + address, '=count=' + count);
  res.json(result);
}));

// Trafico WAN (interfaz upstream) en tiempo real para detectar saturacion del backhaul
mtRouter.get('/wan-traffic', asyncHandler(async (req, res) => {
  const wanIface = process.env.MIKROTIK_WAN_IFACE || 'sfp2';
  const maxMbps = parseInt(process.env.MIKROTIK_WAN_MAX_MBPS || '1000');
  const c = await getMtConnection();
  const result = await mtWrite(c, 5000, '/interface/monitor-traffic', '=interface=' + wanIface, '=once=');
  const r = result[0] || {};
  res.json({
    ifaceName: wanIface,
    rxBps: parseInt(r['rx-bits-per-second'] || 0),
    txBps: parseInt(r['tx-bits-per-second'] || 0),
    rxPps: parseInt(r['rx-packets-per-second'] || 0),
    txPps: parseInt(r['tx-packets-per-second'] || 0),
    maxBps: maxMbps * 1e6,
    timestamp: Date.now(),
  });
}));

app.use('/mikrotik', mtRouter);

// ═══════════════════════════════════════════════════════════════
// MIKROTIK ADDRESS-LIST + BLOQUEOS / MOROSOS / CAPTIVE
// ═══════════════════════════════════════════════════════════════

const LIST_MOROSOS = 'morosos-crm';
const LIST_BLOQUEADOS = 'bloqueados-crm';

async function findAddressListEntry(c, list, ip) {
  const entries = await c.write(
    '/ip/firewall/address-list/print',
    `?list=${list}`,
    `?address=${ip}`,
  );
  return entries[0] || null;
}

async function addToAddressList(c, list, ip, comment) {
  const existing = await findAddressListEntry(c, list, ip);
  if (existing) return { alreadyIn: true, id: existing['.id'] };
  const res = await c.write(
    '/ip/firewall/address-list/add',
    `=list=${list}`,
    `=address=${ip}`,
    `=comment=${comment}`,
  );
  return { alreadyIn: false, id: res[0]?.ret || null };
}

async function removeFromAddressList(c, list, ip) {
  const existing = await findAddressListEntry(c, list, ip);
  if (!existing) return { wasIn: false };
  await c.write(
    '/ip/firewall/address-list/remove',
    `=.id=${existing['.id']}`,
  );
  return { wasIn: true };
}

async function findRuleByComment(c, path, comment) {
  const rules = await c.write(`${path}/print`, `?comment=${comment}`);
  return rules[0] || null;
}

async function ensureNatRedirect(c, list, comment, captive) {
  const existing = await findRuleByComment(c, '/ip/firewall/nat', comment);
  if (existing) return { action: 'exists', id: existing['.id'] };
  const res = await c.write(
    '/ip/firewall/nat/add',
    '=chain=dstnat',
    `=src-address-list=${list}`,
    '=protocol=tcp',
    '=dst-port=80',
    '=action=dst-nat',
    `=to-addresses=${captive.host}`,
    `=to-ports=${captive.port}`,
    `=comment=${comment}`,
  );
  return { action: 'created', id: res[0]?.ret || null };
}

async function ensureSurveySoftPortalNat(c) {
  const dns = require('dns').promises;
  const host = process.env.RAILWAY_PUBLIC_DOMAIN || 'wishub-admin-production.up.railway.app';
  const resolved = await dns.lookup(host);
  const serverIp = resolved.address;
  const port = 80;
  const comment = 'WISP RD - Encuesta forzada (HTTP)';
  const existing = await findRuleByComment(c, '/ip/firewall/nat', comment);
  if (existing) {
    if (existing['to-addresses'] !== serverIp || existing['to-ports'] !== String(port) || existing.disabled === 'true') {
      await c.write(
        '/ip/firewall/nat/set',
        `=.id=${existing['.id']}`,
        `=to-addresses=${serverIp}`,
        `=to-ports=${port}`,
        '=disabled=no',
      );
      return { action: 'updated', id: existing['.id'], serverIp, port };
    }
    return { action: 'exists', id: existing['.id'], serverIp, port };
  }
  const res = await c.write(
    '/ip/firewall/nat/add',
    '=chain=dstnat',
    '=protocol=tcp',
    '=dst-port=80',
    `=src-address-list=${LIST_SURVEY}`,
    '=action=dst-nat',
    `=to-addresses=${serverIp}`,
    `=to-ports=${port}`,
    `=comment=${comment}`,
  );
  return { action: 'created', id: res[0]?.ret || null, serverIp, port };
}

async function ensureFilterRule(c, comment, params, options) {
  const existing = await findRuleByComment(c, '/ip/firewall/filter', comment);
  if (existing) return { action: 'exists', id: existing['.id'] };
  const args = ['/ip/firewall/filter/add', `=comment=${comment}`];
  for (const [k, v] of Object.entries(params)) args.push(`=${k}=${v}`);
  if (options?.placeAtTop) {
    const all = await c.write('/ip/firewall/filter/print');
    const firstId = all[0]?.['.id'];
    if (firstId) args.push(`=place-before=${firstId}`);
  }
  const res = await c.write(...args);
  return { action: 'created', id: res[0]?.ret || null };
}

async function resolveCaptiveTarget() {
  const dns = require('dns').promises;
  const customHost = process.env.CAPTIVE_HOST;
  const host = customHost || process.env.RAILWAY_PUBLIC_DOMAIN || 'wishub-admin-production.up.railway.app';
  const port = parseInt(customHost ? (process.env.CAPTIVE_PORT || PORT) : '80');
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const address = isIp ? host : (await dns.lookup(host)).address;
  return { host, address, port };
}

async function ensureCaptiveNatRule(c, list, comment, target) {
  const existing = await findRuleByComment(c, '/ip/firewall/nat', comment);
  if (existing) {
    if (
      existing['to-addresses'] !== target.address ||
      existing['to-ports'] !== String(target.port) ||
      existing.disabled === 'true'
    ) {
      await c.write(
        '/ip/firewall/nat/set',
        `=.id=${existing['.id']}`,
        `=to-addresses=${target.address}`,
        `=to-ports=${target.port}`,
        '=disabled=no',
      );
      return { action: 'updated', id: existing['.id'] };
    }
    return { action: 'exists', id: existing['.id'] };
  }
  const res = await c.write(
    '/ip/firewall/nat/add',
    '=chain=dstnat',
    `=src-address-list=${list}`,
    '=protocol=tcp',
    '=dst-port=80',
    '=action=dst-nat',
    `=to-addresses=${target.address}`,
    `=to-ports=${target.port}`,
    `=comment=${comment}`,
  );
  return { action: 'created', id: res[0]?.ret || null };
}

async function ensureCaptiveFilterRule(c, comment, params, options) {
  const existing = await findRuleByComment(c, '/ip/firewall/filter', comment);
  if (existing) {
    const changes = [];
    for (const [k, v] of Object.entries(params)) {
      if (existing[k] !== String(v)) changes.push(`=${k}=${v}`);
    }
    if (existing.disabled === 'true') changes.push('=disabled=no');
    if (changes.length) {
      await c.write('/ip/firewall/filter/set', `=.id=${existing['.id']}`, ...changes);
      return { action: 'updated', id: existing['.id'] };
    }
    return { action: 'exists', id: existing['.id'] };
  }
  return ensureFilterRule(c, comment, params, options);
}

async function ensureClientBlockCaptiveRules(c) {
  const target = await resolveCaptiveTarget();
  const moroso = await ensureCaptiveNatRule(c, LIST_MOROSOS, 'morosos-crm-redirect', target);
  const bloqueado = await ensureCaptiveNatRule(c, LIST_BLOQUEADOS, 'bloqueados-crm-redirect', target);
  const dropAll = await ensureCaptiveFilterRule(c, 'bloqueados-crm-drop-rest', {
    chain: 'forward',
    'src-address-list': LIST_BLOQUEADOS,
    action: 'drop',
  }, { placeAtTop: true });
  const allowCaptive = await ensureCaptiveFilterRule(c, 'bloqueados-crm-allow-captive', {
    chain: 'forward',
    'src-address-list': LIST_BLOQUEADOS,
    'dst-address': target.address,
    action: 'accept',
  }, { placeAtTop: true });
  const allowDns = await ensureCaptiveFilterRule(c, 'bloqueados-crm-allow-dns', {
    chain: 'forward',
    'src-address-list': LIST_BLOQUEADOS,
    protocol: 'udp',
    'dst-port': '53',
    action: 'accept',
  }, { placeAtTop: true });
  return { target, moroso, bloqueado, allowDns, allowCaptive, dropAll };
}

async function inspectClientBlockCaptiveRules(c) {
  const target = await resolveCaptiveTarget();
  const [moroso, bloqueado, allowDns, allowCaptive, dropAll, lists] = await Promise.all([
    findRuleByComment(c, '/ip/firewall/nat', 'morosos-crm-redirect'),
    findRuleByComment(c, '/ip/firewall/nat', 'bloqueados-crm-redirect'),
    findRuleByComment(c, '/ip/firewall/filter', 'bloqueados-crm-allow-dns'),
    findRuleByComment(c, '/ip/firewall/filter', 'bloqueados-crm-allow-captive'),
    findRuleByComment(c, '/ip/firewall/filter', 'bloqueados-crm-drop-rest'),
    c.write('/ip/firewall/address-list/print').catch(() => []),
  ]);
  const ruleState = (rule, expected = {}) => {
    if (!rule) return { exists: false, ok: false };
    const mismatches = Object.entries(expected)
      .filter(([key, value]) => value !== undefined && rule[key] !== String(value))
      .map(([key, value]) => ({ key, expected: String(value), actual: rule[key] || null }));
    return {
      exists: true,
      ok: rule.disabled !== 'true' && mismatches.length === 0,
      disabled: rule.disabled === 'true',
      id: rule['.id'],
      mismatches,
    };
  };
  const morososCount = lists.filter((e) => e.list === LIST_MOROSOS).length;
  const bloqueadosCount = lists.filter((e) => e.list === LIST_BLOQUEADOS).length;
  return {
    target,
    addressLists: { morosos: morososCount, bloqueados: bloqueadosCount },
    rules: {
      morosoRedirect: ruleState(moroso, { 'to-addresses': target.address, 'to-ports': target.port }),
      bloqueadoRedirect: ruleState(bloqueado, { 'to-addresses': target.address, 'to-ports': target.port }),
      allowDns: ruleState(allowDns),
      allowCaptive: ruleState(allowCaptive, { 'dst-address': target.address }),
      dropRest: ruleState(dropAll),
    },
  };
}

// Cierra conexiones activas con src=ip (necesario para que el drop tome efecto inmediato)
async function killConnectionsFrom(c, ip) {
  try {
    const conns = await c.write('/ip/firewall/connection/print');
    let removed = 0;
    for (const conn of conns) {
      const src = (conn['src-address'] || '').split(':')[0];
      const replSrc = (conn['reply-src-address'] || '').split(':')[0];
      if (src === ip || replSrc === ip) {
        await c.write('/ip/firewall/connection/remove', `=.id=${conn['.id']}`).catch(() => {});
        removed += 1;
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

const blockRouter = express.Router();
blockRouter.use(authMiddleware);
blockRouter.use(requireRole(['admin']));

// Listar IPs en cada lista
blockRouter.get('/list', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const all = await c.write('/ip/firewall/address-list/print');
  const morosos = all.filter((e) => e.list === LIST_MOROSOS);
  const bloqueados = all.filter((e) => e.list === LIST_BLOQUEADOS);
  res.json({
    morosos: morosos.map((e) => ({ id: e['.id'], address: e.address, comment: e.comment || '' })),
    bloqueados: bloqueados.map((e) => ({ id: e['.id'], address: e.address, comment: e.comment || '' })),
  });
}));

async function removeRuleByComment(c, path, comment) {
  const r = await findRuleByComment(c, path, comment);
  if (!r) return false;
  await c.write(`${path}/remove`, `=.id=${r['.id']}`);
  return true;
}

// Crear las 5 reglas (NAT x2 + filter x3 para bloqueo total)
// Body opcional: {host, port, force} - force=true elimina existentes y recrea
blockRouter.post('/setup', asyncHandler(async (req, res) => {
  const force = req.body?.force === true;
  const c = await getMtConnection();

  if (force) {
    await removeRuleByComment(c, '/ip/firewall/nat', 'morosos-crm-redirect');
    await removeRuleByComment(c, '/ip/firewall/nat', 'bloqueados-crm-redirect');
    await removeRuleByComment(c, '/ip/firewall/filter', 'bloqueados-crm-allow-dns');
    await removeRuleByComment(c, '/ip/firewall/filter', 'bloqueados-crm-allow-captive');
    await removeRuleByComment(c, '/ip/firewall/filter', 'bloqueados-crm-drop-rest');
  }

  const rules = await ensureClientBlockCaptiveRules(c);
  await logActivity(req, {
    action: 'mikrotik_captive_rules_setup',
    entityType: 'mikrotik',
    entityName: 'captive-rules',
    details: { force, target: rules.target },
  });
  res.json({ force, ...rules });
}));

app.use('/mikrotik/blocklist', blockRouter);

// ─── ACCIONES SOBRE CLIENTES (moroso / block / clear) ───

async function applyClientAction(idServicio, action, reason, actor = null) {
  const client = await prisma.client.findUnique({
    where: { idServicio: parseInt(idServicio) },
  });
  if (!client) return { ok: false, error: 'Cliente no encontrado' };
  if (!client.ip) return { ok: false, error: 'Cliente sin IP asignada' };

  const c = await getMtConnection();
  const rules = ['moroso', 'block'].includes(action)
    ? await ensureClientBlockCaptiveRules(c)
    : null;

  let mt;
  let connectionsKilled = 0;
  if (action === 'moroso') {
    mt = await addToAddressList(c, LIST_MOROSOS, client.ip, `MOROSO ${client.nombre}: ${reason}`);
    connectionsKilled = await killConnectionsFrom(c, client.ip);
  } else if (action === 'block') {
    mt = await addToAddressList(c, LIST_BLOQUEADOS, client.ip, `BLOQ ${client.nombre}: ${reason}`);
    connectionsKilled = await killConnectionsFrom(c, client.ip);
  } else if (action === 'clear') {
    const m = await removeFromAddressList(c, LIST_MOROSOS, client.ip);
    const b = await removeFromAddressList(c, LIST_BLOQUEADOS, client.ip);
    mt = { wasIn: m.wasIn || b.wasIn };
  } else {
    return { ok: false, error: 'Accion invalida' };
  }

  const newAction = action === 'clear' ? null : action;
  await prisma.client.update({
    where: { idServicio: client.idServicio },
    data: {
      crmAction: newAction,
      crmActionReason: action === 'clear' ? null : reason,
      crmActionAt: action === 'clear' ? null : new Date(),
    },
  });

  await prisma.blockEvent.create({
    data: {
      idServicio: client.idServicio,
      ipAddress: client.ip,
      action: action === 'clear' ? 'unblock' : action,
      reason,
      createdBy: actor?.username || actor?.actor || null,
    },
  });

  return {
    ok: true,
    ip: client.ip,
    mt,
    rules,
    connectionsKilled,
    captiveUrl: `${process.env.PUBLIC_APP_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN || 'wishub-admin-production.up.railway.app'}`}/captive?ip=${encodeURIComponent(client.ip)}`,
  };
}

const clientActionsRouter = express.Router();
clientActionsRouter.use(authMiddleware);

// IMPORTANTE: rutas literales ANTES que rutas con :param
// PATCH alias (nombre real, cédula, teléfono, notas) - NUNCA tocados por sync
clientActionsRouter.patch('/:id/alias', asyncHandler(async (req, res) => {
  const idServicio = parseInt(req.params.id);
  const data = {};
  if (typeof req.body?.aliasNombre === 'string') data.aliasNombre = req.body.aliasNombre.trim() || null;
  if (typeof req.body?.aliasCedula === 'string') data.aliasCedula = req.body.aliasCedula.trim() || null;
  if (typeof req.body?.aliasTelefono === 'string') data.aliasTelefono = req.body.aliasTelefono.trim() || null;
  if (typeof req.body?.aliasNotas === 'string') data.aliasNotas = req.body.aliasNotas.trim() || null;
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

  const updated = await prisma.client.update({
    where: { idServicio },
    data,
    select: {
      idServicio: true, nombre: true, aliasNombre: true,
      aliasCedula: true, aliasTelefono: true, aliasNotas: true,
    },
  }).catch(() => null);
  if (!updated) return res.status(404).json({ error: 'Cliente no encontrado' });
  await logActivity(req, {
    action: 'client_alias_updated',
    entityType: 'client',
    entityId: updated.idServicio,
    entityName: updated.nombre,
    details: { fields: Object.keys(data) },
  });
  res.json(updated);
}));

// GET aliases (todos los clientes con alias custom)
clientActionsRouter.get('/aliases', asyncHandler(async (req, res) => {
  const rows = await prisma.client.findMany({
    where: {
      OR: [
        { aliasNombre: { not: null } },
        { aliasCedula: { not: null } },
        { aliasTelefono: { not: null } },
      ],
    },
    select: {
      idServicio: true, nombre: true,
      aliasNombre: true, aliasCedula: true, aliasTelefono: true, aliasNotas: true,
    },
    orderBy: { aliasNombre: 'asc' },
  });
  res.json(rows);
}));

clientActionsRouter.get('/states', asyncHandler(async (req, res) => {
  const rows = await prisma.client.findMany({
    where: { crmAction: { not: null } },
    select: { idServicio: true, crmAction: true, crmActionReason: true, crmActionAt: true },
  });
  res.json(rows);
}));

// Marcar moroso: cobranza+ (cobranza puede marcar pero no bloquear total)
clientActionsRouter.post('/:id/moroso', requireAnyRole(['cobranza']), asyncHandler(async (req, res) => {
  const reason = String(req.body?.reason || 'Falta de pago').trim();
  const r = await applyClientAction(req.params.id, 'moroso', reason, req.session);
  if (r.ok) {
    await logActivity(req, {
      action: 'client_marked_moroso',
      entityType: 'client',
      entityId: req.params.id,
      details: { reason, ip: r.ip, connectionsKilled: r.connectionsKilled },
    });
  }
  res.status(r.ok ? 200 : 400).json(r);
}));

// Bloqueo total: solo admin+
clientActionsRouter.post('/:id/block', requireRole(['admin']), asyncHandler(async (req, res) => {
  const reason = String(req.body?.reason || 'Bloqueo manual').trim();
  const r = await applyClientAction(req.params.id, 'block', reason, req.session);
  if (r.ok) {
    await logActivity(req, {
      action: 'client_blocked',
      entityType: 'client',
      entityId: req.params.id,
      details: { reason, ip: r.ip, connectionsKilled: r.connectionsKilled },
    });
  }
  res.status(r.ok ? 200 : 400).json(r);
}));

// Reactivar: cobranza+
clientActionsRouter.post('/:id/clear', requireAnyRole(['cobranza']), asyncHandler(async (req, res) => {
  const reason = String(req.body?.reason || 'Reactivado').trim();
  const r = await applyClientAction(req.params.id, 'clear', reason, req.session);
  if (r.ok) {
    await logActivity(req, {
      action: 'client_reactivated',
      entityType: 'client',
      entityId: req.params.id,
      details: { reason, ip: r.ip },
    });
  }
  res.status(r.ok ? 200 : 400).json(r);
}));

clientActionsRouter.get('/:id/events', asyncHandler(async (req, res) => {
  const events = await prisma.blockEvent.findMany({
    where: { idServicio: parseInt(req.params.id) },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(events);
}));

app.use('/clients-actions', clientActionsRouter);


// ─── CAPTIVE PORTAL (HTML server-rendered) ───
function htmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildCaptive({ mode, name, ip, plan, priceDop, reason, contact }) {
  const banner = mode === 'bloqueado'
    ? { title: 'Servicio bloqueado', color: '#ef4444', badge: 'BLOQUEADO',
        defaultMsg: 'Tu servicio fue bloqueado por el administrador. Contacta a soporte para reactivarlo.' }
    : mode === 'moroso'
    ? { title: 'Falta de pago', color: '#f97316', badge: 'PAGO PENDIENTE',
        defaultMsg: 'Hemos detectado un saldo pendiente. Realiza el pago para reactivar tu internet.' }
    : { title: 'Informacion', color: '#0ea5e9', badge: 'INFO',
        defaultMsg: 'Tu servicio esta activo.' };
  const cta = mode === 'bloqueado' ? 'Contactar al administrador' : 'Pagar ahora';
  const price = priceDop ? `RD$ ${Number(priceDop).toLocaleString('es-DO')}` : '—';
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/>
<title>${htmlEscape(banner.title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,${banner.color} 100%);
  color:#f8fafc;display:flex;align-items:center;justify-content:center;padding:24px}
.card{width:100%;max-width:560px;background:rgba(15,23,42,.85);border:1px solid ${banner.color}80;
  border-radius:18px;padding:40px;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.badge{display:inline-flex;background:${banner.color}33;color:#f1f5f9;border:1px solid ${banner.color}80;
  border-radius:999px;padding:6px 14px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
h1{font-size:32px;margin:18px 0 8px;line-height:1.15}
p.lead{color:#cbd5e1;margin:0 0 24px;line-height:1.55}
.grid{display:grid;grid-template-columns:max-content 1fr;gap:10px 18px;background:rgba(15,23,42,.6);
  border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:18px;margin-bottom:24px}
.grid dt{color:#94a3b8;font-size:13px}.grid dd{margin:0;font-weight:600;color:#f1f5f9}
.cta{display:inline-block;background:${banner.color};color:#0f172a;font-weight:700;padding:14px 24px;
  border-radius:12px;text-decoration:none}
.foot{color:#94a3b8;font-size:12px;margin-top:18px}
</style></head><body>
<div class="card">
<span class="badge">${htmlEscape(banner.badge)}</span>
<h1>Hola ${htmlEscape(name)}, ${mode === 'bloqueado' ? 'tu servicio esta bloqueado' : 'tu internet esta pausado'}</h1>
<p class="lead">${htmlEscape(reason || banner.defaultMsg)}</p>
<dl class="grid">
<dt>Cliente</dt><dd>${htmlEscape(name)}</dd>
<dt>IP</dt><dd>${htmlEscape(ip)}</dd>
<dt>Plan</dt><dd>${htmlEscape(plan)}</dd>
<dt>Cuota mensual</dt><dd>${htmlEscape(price)}</dd>
</dl>
<a class="cta" href="#">${htmlEscape(cta)}</a>
${contact ? `<p class="foot">Soporte: ${htmlEscape(contact)}</p>` : ''}
</div></body></html>`;
}

function buildServiceStatusCaptive({
  mode,
  name,
  ip,
  plan,
  priceDop,
  reason,
  contact,
  status,
  speed,
  zone,
  router,
  actionAt,
  invoiceNumber,
  invoiceStatus,
  invoiceDue,
  invoiceMonth,
  invoiceBalance,
}) {
  const isBlocked = mode === 'bloqueado';
  const banner = isBlocked
    ? {
        title: 'Servicio desactivado',
        accent: '#ef4444',
        soft: '#fee2e2',
        badge: 'DESACTIVADO',
        defaultMsg: 'Tu servicio fue desactivado manualmente por el administrador.',
      }
    : mode === 'moroso'
    ? {
        title: 'Pago pendiente',
        accent: '#f97316',
        soft: '#ffedd5',
        badge: 'PAGO PENDIENTE',
        defaultMsg: 'Tu servicio esta pausado por estado de cuenta.',
      }
    : {
        title: 'Informacion del servicio',
        accent: '#0ea5e9',
        soft: '#e0f2fe',
        badge: 'INFO',
        defaultMsg: 'Tu servicio esta activo.',
      };
  const cleanPhone = contact ? String(contact).replace(/[^\d+]/g, '') : '';
  const contactHref = cleanPhone ? `tel:${cleanPhone}` : '#';
  const price = priceDop ? `RD$ ${Number(priceDop).toLocaleString('es-DO')}` : '-';
  const copy = isBlocked
    ? 'Tu acceso a internet esta desactivado. Esta pagina queda disponible para que veas el estado de tu servicio y contactes administracion.'
    : 'Tu internet esta pausado. Esta pagina queda disponible para ayudarte a resolver el estado de tu servicio.';
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/>
<title>${htmlEscape(banner.title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;padding:18px}
.shell{width:100%;max-width:760px;background:white;border:1px solid #e2e8f0;border-radius:24px;box-shadow:0 24px 80px rgba(15,23,42,.18);overflow:hidden}
.top{background:linear-gradient(135deg,#111827 0%,#1f2937 58%,${banner.accent} 100%);color:white;padding:28px}
.badge{display:inline-flex;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.24);border-radius:999px;padding:7px 12px;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
h1{font-size:clamp(28px,5vw,44px);line-height:1.04;margin:18px 0 10px;letter-spacing:0}
.lead{max-width:620px;color:#e2e8f0;font-size:16px;line-height:1.55;margin:0}
.body{padding:26px}
.notice{border-left:5px solid ${banner.accent};background:${banner.soft};border-radius:14px;padding:16px 18px;margin-bottom:18px}
.notice strong{display:block;margin-bottom:4px}.notice p{margin:0;line-height:1.5;color:#334155}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:18px 0}
.item{border:1px solid #e2e8f0;border-radius:14px;padding:14px;background:#fff}
.lbl{display:block;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.val{display:block;font-size:16px;font-weight:800;color:#0f172a;overflow-wrap:anywhere}
.cta-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px}
.cta{display:inline-flex;align-items:center;justify-content:center;background:${banner.accent};color:white;font-weight:800;min-height:48px;padding:0 20px;border-radius:12px;text-decoration:none}
.ghost{color:#475569;font-size:13px;line-height:1.45;max-width:420px}
.foot{border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;padding:16px 26px;background:#f8fafc}
@media (max-width:640px){.grid{grid-template-columns:1fr}.top,.body{padding:22px}.shell{border-radius:18px}}
</style></head><body>
<main class="shell">
  <section class="top">
    <span class="badge">${htmlEscape(banner.badge)}</span>
    <h1>${htmlEscape(banner.title)}</h1>
    <p class="lead">Hola ${htmlEscape(name)}, ${htmlEscape(copy)}</p>
  </section>
  <section class="body">
    <div class="notice"><strong>Motivo</strong><p>${htmlEscape(reason || banner.defaultMsg)}</p></div>
    <div class="grid">
      <div class="item"><span class="lbl">Cliente</span><span class="val">${htmlEscape(name)}</span></div>
      <div class="item"><span class="lbl">Estado</span><span class="val">${htmlEscape(status || banner.badge)}</span></div>
      <div class="item"><span class="lbl">IP asignada</span><span class="val">${htmlEscape(ip)}</span></div>
      <div class="item"><span class="lbl">Velocidad</span><span class="val">${htmlEscape(speed || 'No disponible')}</span></div>
      <div class="item"><span class="lbl">Plan</span><span class="val">${htmlEscape(plan)}</span></div>
      <div class="item"><span class="lbl">Cuota mensual</span><span class="val">${htmlEscape(price)}</span></div>
      ${invoiceNumber ? `<div class="item"><span class="lbl">Factura</span><span class="val">#${htmlEscape(invoiceNumber)}</span></div>` : ''}
      ${invoiceStatus ? `<div class="item"><span class="lbl">Estado factura</span><span class="val">${htmlEscape(invoiceStatus)}</span></div>` : ''}
      ${invoiceDue ? `<div class="item"><span class="lbl">Vencimiento</span><span class="val">${htmlEscape(invoiceDue)}</span></div>` : ''}
      ${invoiceMonth ? `<div class="item"><span class="lbl">Mes de pago</span><span class="val">${htmlEscape(invoiceMonth)}</span></div>` : ''}
      ${invoiceBalance ? `<div class="item"><span class="lbl">Saldo pendiente</span><span class="val">${htmlEscape(invoiceBalance)}</span></div>` : ''}
      ${zone ? `<div class="item"><span class="lbl">Zona</span><span class="val">${htmlEscape(zone)}</span></div>` : ''}
      ${router ? `<div class="item"><span class="lbl">Router/Sector</span><span class="val">${htmlEscape(router)}</span></div>` : ''}
    </div>
    <div class="cta-row">
      <a class="cta" href="${htmlEscape(contactHref)}">Contactar administracion</a>
      <span class="ghost">Para reconectar el servicio debes comunicarte con el administrador. Esta pagina no libera el bloqueo automaticamente.</span>
    </div>
  </section>
  <footer class="foot">
    ${contact ? `Soporte: ${htmlEscape(contact)}. ` : ''}IP registrada: ${htmlEscape(ip)}${actionAt ? ` - Estado aplicado: ${htmlEscape(actionAt)}` : ''}
  </footer>
</main></body></html>`;
}

function detectClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']).trim();
  return (req.ip || '').replace(/^::ffff:/, '');
}

function isPendingInvoiceStatus(status) {
  const s = (status || '').toLowerCase();
  return s.includes('pendiente') || s.includes('vencid') || s.includes('atras') || (s && !s.includes('pagad'));
}

function formatDop(value) {
  const n = parseFloat(String(value ?? '0').replace(/[^\d.-]/g, '')) || 0;
  if (!n) return '';
  return `RD$ ${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatInvoiceMonth(date) {
  if (!date) return '';
  return date.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });
}

async function findLatestPendingInvoiceForClient(idServicio) {
  if (!idServicio) return null;
  const invoices = await prisma.invoice.findMany({
    where: { clienteIdServicio: idServicio },
    orderBy: { idFactura: 'desc' },
    take: 20,
  });
  const pending = invoices.filter((inv) => isPendingInvoiceStatus(inv.estado));
  if (!pending.length) return null;
  pending.sort((a, b) => {
    const da = parseFechaCorte(a.fechaVencimiento || a.fechaEmision)?.getTime() || 0;
    const db = parseFechaCorte(b.fechaVencimiento || b.fechaEmision)?.getTime() || 0;
    return db - da || b.idFactura - a.idFactura;
  });
  return pending[0];
}

async function renderCaptive(req, res) {
  const ip = (req.query?.ip || detectClientIp(req)).toString();
  const client = await prisma.client.findFirst({ where: { ip } });
  let mode = 'info';
  if (client?.crmAction === 'block') mode = 'bloqueado';
  else if (client?.crmAction === 'moroso') mode = 'moroso';
  else if ((client?.estado || '').toLowerCase().includes('suspend')) mode = 'moroso';
  const invoice = client?.idServicio ? await findLatestPendingInvoiceForClient(client.idServicio) : null;
  const dueDate = parseFechaCorte(invoice?.fechaVencimiento || client?.fechaCorte || '');
  const displayName = client?.aliasNombre || client?.nombre || 'Cliente';
  const html = buildServiceStatusCaptive({
    mode,
    name: displayName,
    ip,
    plan: client?.planInternetName || 'Servicio de internet',
    priceDop: client?.precioPlan ? Number(client.precioPlan) : null,
    reason: client?.crmActionReason || '',
    contact: process.env.SUPPORT_PHONE || '',
    status: client?.crmAction === 'block' ? 'Desactivado manualmente' : (client?.estado || ''),
    speed: client?.mtQueueLimit || '',
    zone: client?.zonaNombre || client?.localidad || '',
    router: client?.routerNombre || client?.sectorialNombre || '',
    actionAt: client?.crmActionAt ? client.crmActionAt.toLocaleString('es-DO') : '',
    invoiceNumber: invoice?.folio || invoice?.idFactura || '',
    invoiceStatus: invoice?.estado || client?.estadoFacturas || '',
    invoiceDue: invoice?.fechaVencimiento || client?.fechaCorte || '',
    invoiceMonth: formatInvoiceMonth(dueDate),
    invoiceBalance: formatDop(invoice?.saldo || client?.saldo || client?.precioPlan),
  });
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(html);
}

app.get('/captive', asyncHandler(renderCaptive));

// ═══════════════════════════════════════════════════════════════
// SURVEY (encuesta forzada via captive HTTP redirect)
// admin activa por IP -> mikrotik intercepta http puerto 80 ->
// cliente ve form -> envia nombre+telefono -> queda guardado
// ═══════════════════════════════════════════════════════════════

const LIST_SURVEY = 'survey-pending';
const SURVEY_REMINDER_INTERVAL_HOURS = Math.max(1, parseInt(process.env.SURVEY_REMINDER_INTERVAL_HOURS || '4'));
const SURVEY_REMINDER_POLL_MS = Math.max(60_000, parseInt(process.env.SURVEY_REMINDER_POLL_MS || '300000'));
let surveyReminderTimer = null;
let lastSurveyReminderRun = null;

function generateSurveyToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// Codigo corto 6 chars base36 (a-z0-9), 2.1 mil millones combinaciones. Unique en DB.
// Generamos hasta 5 intentos por si hay colision (extremadamente improbable).
async function generateUniqueShortCode() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let attempt = 0; attempt < 5; attempt++) {
    let code = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];
    const exists = await prisma.surveyResponse.findUnique({ where: { shortCode: code } }).catch(() => null);
    if (!exists) return code;
  }
  // Fallback: usar randomBytes mas largo si todos colisionaron (no deberia pasar)
  return crypto.randomBytes(5).toString('hex');
}

function buildSurveyShortUrl(req, shortCode) {
  if (!shortCode) return null;
  return `${getPublicBaseUrl(req)}/s/${shortCode}`;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${proto}://${req.get('host')}`;
}

function buildSurveyUrl(req, token) {
  return `${getPublicBaseUrl(req)}/survey/landing/${encodeURIComponent(token)}`;
}

function buildSurveyPortalUrl(req, ip) {
  const qs = ip ? `?ip=${encodeURIComponent(ip)}` : '';
  return `${getPublicBaseUrl(req)}/survey/portal${qs}`;
}

function withSurveyPublicUrl(req, row) {
  if (!row) return row;
  return {
    ...row,
    publicUrl: row.publicToken ? buildSurveyUrl(req, row.publicToken) : null,
    shortUrl: row.shortCode ? buildSurveyShortUrl(req, row.shortCode) : null,
    portalUrl: buildSurveyPortalUrl(req, row.clientIp),
  };
}

const SURVEY_MESSAGE_DEFAULT = `Hola {nombre}, somos {negocio}.

Necesitamos que confirmes tus datos de contacto para mantener tu cuenta actualizada.

Llena este formulario seguro:
{url}

Tu internet no sera bloqueado por esta encuesta. Si ya lo llenaste, puedes ignorar este mensaje.`;

async function getSurveyMessageTemplate() {
  const row = await prisma.appSetting.findUnique({ where: { key: 'survey_message_template' } }).catch(() => null);
  return (row && row.value) || SURVEY_MESSAGE_DEFAULT;
}

function applySurveyMessageTemplate(template, vars) {
  return String(template || SURVEY_MESSAGE_DEFAULT)
    .replace(/\{nombre\}/g, vars.nombre || 'Cliente')
    .replace(/\{negocio\}/g, vars.negocio || 'MaxWiFi')
    .replace(/\{url\}/g, vars.url || '')
    .replace(/\{telefono\}/g, vars.telefono || '')
    .replace(/\{ip\}/g, vars.ip || '')
    .replace(/\{plan\}/g, vars.plan || '');
}

async function buildSurveyReminderMessage(client, urlForMessage) {
  const template = await getSurveyMessageTemplate();
  return applySurveyMessageTemplate(template, {
    nombre: client?.nombre,
    negocio: process.env.INVOICE_BUSINESS_NAME || 'MaxWiFi',
    url: urlForMessage,
    telefono: client?.telefono,
    ip: client?.ip,
  });
}

async function sendSurveyReminderById(id, req = null) {
  const survey = await prisma.surveyResponse.findUnique({
    where: { id },
    include: { client: { select: { idServicio: true, nombre: true, telefono: true, ip: true } } },
  });
  if (!survey || survey.status !== 'pending') return { ok: false, skipped: true, reason: 'not_pending' };

  let publicToken = survey.publicToken;
  let shortCode = survey.shortCode;
  let current = survey;

  // Asignar publicToken y shortCode si faltan. Reintentar hasta 3 veces en caso de
  // colision de shortCode unique (P2002) cuando 2 threads concurrentes generen el mismo.
  if (!publicToken || !shortCode) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const dataToUpdate = {};
      if (!publicToken) {
        publicToken = generateSurveyToken();
        dataToUpdate.publicToken = publicToken;
      }
      if (!shortCode) {
        shortCode = await generateUniqueShortCode();
        dataToUpdate.shortCode = shortCode;
      }
      try {
        current = await prisma.surveyResponse.update({
          where: { id: survey.id },
          data: dataToUpdate,
          include: { client: { select: { idServicio: true, nombre: true, telefono: true, ip: true } } },
        });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        // P2002 = unique constraint violation. Resetear shortCode y reintentar.
        if (e?.code === 'P2002') {
          shortCode = null;
          continue;
        }
        throw e;
      }
    }
    if (lastErr) {
      console.error('[survey] No se pudo asignar shortCode tras 3 intentos:', lastErr.message);
      // Si falla 3 veces consecutivas, dejarlo solo con publicToken (sin shortCode)
      current = await prisma.surveyResponse.update({
        where: { id: survey.id },
        data: { publicToken },
        include: { client: { select: { idServicio: true, nombre: true, telefono: true, ip: true } } },
      }).catch(() => survey);
    }
  }

  const phone = current.client?.telefono;
  const now = new Date();
  const retryAt = addHours(now, SURVEY_REMINDER_INTERVAL_HOURS);
  const baseUrl = (process.env.PUBLIC_APP_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN || 'wishub-admin-production.up.railway.app'}`).replace(/\/$/, '');
  const publicUrl = req ? buildSurveyUrl(req, publicToken) : `${baseUrl}/survey/landing/${encodeURIComponent(publicToken)}`;
  const shortUrl = req ? buildSurveyShortUrl(req, shortCode) : `${baseUrl}/s/${shortCode}`;

  if (!phone || phone.length < 7) {
    await prisma.surveyResponse.update({
      where: { id: current.id },
      data: { nextReminderAt: retryAt, lastReminderStatus: 'no_phone' },
    });
    return { ok: false, reason: 'no_phone', publicUrl };
  }
  if (waStatus !== 'connected' || !waSocket) {
    await prisma.surveyResponse.update({
      where: { id: current.id },
      data: { nextReminderAt: addHours(now, 1), lastReminderStatus: `whatsapp_${waStatus}` },
    });
    return { ok: false, reason: `whatsapp_${waStatus}`, publicUrl };
  }

  // Usar URL corto/camuflado si shortCode existe, sino el largo
  const urlForMessage = shortCode ? shortUrl : publicUrl;
  const message = await buildSurveyReminderMessage(current.client, urlForMessage);
  const sent = await sendWhatsappNotification(current.idServicio, phone, message, 'survey_reminder', current.client?.nombre || null);
  await prisma.surveyResponse.update({
    where: { id: current.id },
    data: {
      lastReminderAt: now,
      nextReminderAt: retryAt,
      reminderCount: { increment: sent.ok ? 1 : 0 },
      lastReminderStatus: sent.ok ? 'sent' : `failed: ${sent.error || 'unknown'}`.slice(0, 180),
    },
  });
  return { ...sent, publicUrl, shortUrl };
}

function buildSurveyForm({ ip, name, alreadySubmitted, token }) {
  if (alreadySubmitted) {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<title>Gracias</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>*,*::before,*::after{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#10b981 100%);color:#f8fafc;
display:flex;align-items:center;justify-content:center;padding:24px}
.card{width:100%;max-width:480px;background:rgba(15,23,42,.85);border:1px solid #10b98180;
border-radius:18px;padding:40px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.check{width:80px;height:80px;background:#10b98133;border:2px solid #10b981;border-radius:50%;
display:inline-flex;align-items:center;justify-content:center;font-size:48px;margin-bottom:18px}
h1{font-size:28px;margin:0 0 12px}p{color:#cbd5e1;line-height:1.6}
</style></head><body><div class="card"><div class="check">&#10003;</div>
<h1>Gracias por confirmar</h1>
<p>Tu informacion ha sido recibida. Ya puedes seguir navegando.</p>
<p style="font-size:13px;color:#94a3b8;margin-top:18px">Si esta pagina no se cierra sola, abre cualquier sitio y deberias ver internet normal.</p>
</div></body></html>`;
  }
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<title>Verifica tu informacion - MaxWiFi</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#3b82f6 100%);
  color:#f8fafc;display:flex;align-items:center;justify-content:center;padding:16px}
.card{width:100%;max-width:480px;background:rgba(15,23,42,.92);border:1px solid #3b82f680;
  border-radius:18px;padding:32px 28px;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.logo{display:inline-flex;align-items:center;gap:10px;background:#3b82f633;color:#dbeafe;
  border:1px solid #3b82f680;border-radius:999px;padding:6px 14px;font-size:11px;
  font-weight:700;letter-spacing:.15em;text-transform:uppercase;margin-bottom:18px}
h1{font-size:24px;margin:0 0 8px;line-height:1.2}
p.lead{color:#cbd5e1;margin:0 0 22px;line-height:1.55;font-size:14px}
label{display:block;font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;
  letter-spacing:.05em;margin:14px 0 6px}
input{width:100%;background:rgba(15,23,42,.6);border:1px solid rgba(148,163,184,.3);
  border-radius:10px;padding:13px 14px;color:#f1f5f9;font-size:16px;font-family:inherit;
  outline:none;transition:border-color .15s,background .15s}
input:focus{border-color:#3b82f6;background:rgba(15,23,42,.9)}
.btn{width:100%;background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%);color:#fff;
  font-weight:700;font-size:16px;padding:14px;border:0;border-radius:10px;
  cursor:pointer;margin-top:22px;transition:transform .1s,box-shadow .15s}
.btn:hover{box-shadow:0 8px 20px rgba(59,130,246,.4)}
.btn:active{transform:scale(.98)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.info{margin-top:14px;font-size:11px;color:#64748b;text-align:center;line-height:1.5}
.error{background:#ef444433;border:1px solid #ef4444;color:#fecaca;padding:10px 14px;
  border-radius:10px;margin-top:14px;font-size:13px;display:none}
.error.show{display:block}
.ip-tag{display:inline-block;background:rgba(15,23,42,.7);border:1px solid rgba(148,163,184,.25);
  border-radius:6px;padding:3px 8px;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#94a3b8;margin-top:4px}
</style></head><body>
<div class="card">
<span class="logo">&#x1F4F6; MaxWiFi RD</span>
<h1>Verifica tu informacion</h1>
<p class="lead">Necesitamos confirmar tus datos para mejorar el servicio que te ofrecemos. Solo te tomara 30 segundos.</p>
<form id="f">
<label for="fullName">Nombre completo</label>
<input id="fullName" name="fullName" type="text" required minlength="3" maxlength="80" placeholder="Ej: Juan Antonio Perez" autocomplete="name" />
<label for="phone">Telefono / WhatsApp</label>
<input id="phone" name="phone" type="tel" required minlength="7" maxlength="20" placeholder="Ej: 809-555-1234" autocomplete="tel" inputmode="tel" />
<div class="error" id="err"></div>
<button class="btn" type="submit" id="btn">Enviar y seguir navegando</button>
<p class="info">Tu IP: <span class="ip-tag">${htmlEscape(ip)}</span><br>
Esta informacion es confidencial y solo la usamos para verificar tu cuenta.</p>
</form>
</div>
<script>
const f=document.getElementById('f'),b=document.getElementById('btn'),er=document.getElementById('err');
f.addEventListener('submit',async(e)=>{
  e.preventDefault();er.classList.remove('show');b.disabled=true;b.textContent='Enviando...';
  try{
    const r=await fetch('/survey/submit',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:${JSON.stringify(token || '')},fullName:f.fullName.value.trim(),phone:f.phone.value.trim()})});
    const d=await r.json();
    if(!r.ok||!d.ok){throw new Error(d.error||'Error al enviar')}
    document.body.innerHTML=d.html||'<h1>Gracias</h1>';
  }catch(x){er.textContent=x.message||'Error de conexion. Intenta de nuevo.';er.classList.add('show');
    b.disabled=false;b.textContent='Enviar y seguir navegando';
  }
});
</script>
</body></html>`;
}

// Pagina publica que ve el cliente cuando lo redirigen
async function renderSurveyLanding(req, res) {
  const token = (req.params?.token || req.query?.token || req.query?.t || '').toString().trim();
  const ip = detectClientIp(req);
  // Buscar pending por enlace publico; fallback legacy por IP para captive antiguo.
  const pending = await prisma.surveyResponse.findFirst({
    where: token
      ? { publicToken: token, status: 'pending' }
      : { clientIp: ip, status: 'pending' },
    orderBy: { sentAt: 'desc' },
  });
  if (!pending) {
    // No hay encuesta pendiente para este IP, mostrar mensaje generico
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(`<!doctype html><html><head><meta charset="utf-8"/><title>OK</title>
<style>body{font-family:system-ui;background:#0f172a;color:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
.box{max-width:400px}</style></head><body><div class="box"><h2>Sin encuesta pendiente</h2>
<p style="color:#94a3b8">Tu IP <code>${htmlEscape(ip)}</code> no tiene encuestas pendientes.</p>
</div></body></html>`);
    return;
  }
  const client = pending.idServicio
    ? await prisma.client.findUnique({ where: { idServicio: pending.idServicio } })
    : null;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(buildSurveyForm({
    ip: pending.clientIp || ip,
    name: client?.nombre || '',
    alreadySubmitted: false,
    token: pending.publicToken || token,
  }));
}

app.get('/survey/landing/:token', asyncHandler(renderSurveyLanding));
app.get('/survey/landing', asyncHandler(renderSurveyLanding));

// Short URL "camuflado" /s/:code -> redirige al landing seguro
// Sirve para mandar links cortos por WhatsApp sin exponer el token completo.
app.get('/s/:code', asyncHandler(async (req, res) => {
  const code = (req.params.code || '').toLowerCase().trim();
  if (!code || code.length > 16) return res.status(400).send('Codigo invalido');
  const row = await prisma.surveyResponse.findUnique({
    where: { shortCode: code },
    select: { publicToken: true, status: true },
  });
  if (!row || !row.publicToken) return res.status(404).send('Enlace no encontrado o expirado');
  return res.redirect(302, `/survey/landing/${encodeURIComponent(row.publicToken)}`);
}));
app.get('/survey', asyncHandler(renderSurveyLanding));

// Portal suave para MikroTik/Hotspot. El router debe abrir esta URL incluyendo
// la IP del cliente: /survey/portal?ip=$(ip). Asi Railway recibe el host correcto
// y el formulario puede seguir siendo seguro por token.
async function renderSurveyPortal(req, res) {
  const token = (req.query?.token || req.query?.t || '').toString().trim();
  const rawIp = (req.query?.ip || req.query?.address || detectClientIp(req)).toString().trim();
  const ip = rawIp.replace(/^::ffff:/, '');
  const where = [];
  if (token) where.push({ publicToken: token, status: 'pending' });
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) where.push({ clientIp: ip, status: 'pending' });

  const pending = where.length
    ? await prisma.surveyResponse.findFirst({ where: { OR: where }, orderBy: { sentAt: 'desc' } })
    : null;

  if (!pending) {
    const submittedWhere = [];
    if (token) submittedWhere.push({ publicToken: token, status: 'submitted' });
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) submittedWhere.push({ clientIp: ip, status: 'submitted' });
    const submitted = submittedWhere.length
      ? await prisma.surveyResponse.findFirst({ where: { OR: submittedWhere }, orderBy: { submittedAt: 'desc' } })
      : null;
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    if (submitted) {
      return res.send(buildSurveyForm({ ip, name: submitted.fullName || 'Cliente', alreadySubmitted: true }));
    }
    return res.send(`<!doctype html><html><head><meta charset="utf-8"/><title>Sin encuesta</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>body{font-family:system-ui;background:#0f172a;color:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}.box{max-width:420px}.muted{color:#94a3b8}</style>
</head><body><div class="box"><h2>No tienes encuesta pendiente</h2>
<p class="muted">Puedes seguir navegando normalmente.</p></div></body></html>`);
  }

  let current = pending;
  if (!current.publicToken) {
    current = await prisma.surveyResponse.update({
      where: { id: current.id },
      data: { publicToken: generateSurveyToken() },
    });
  }
  const client = current.idServicio
    ? await prisma.client.findUnique({ where: { idServicio: current.idServicio } })
    : null;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(buildSurveyForm({
    ip: current.clientIp || ip,
    name: client?.nombre || '',
    alreadySubmitted: false,
    token: current.publicToken,
  }));
}

app.get('/survey/portal', asyncHandler(renderSurveyPortal));

// Cliente envia el form
app.post('/survey/submit', asyncHandler(async (req, res) => {
  const ip = detectClientIp(req);
  const token = (req.body?.token || '').toString().trim();
  const fullName = (req.body?.fullName || '').toString().trim();
  const phone = (req.body?.phone || '').toString().trim();
  if (fullName.length < 3 || phone.length < 7) {
    return res.status(400).json({ ok: false, error: 'Nombre y telefono son obligatorios' });
  }

  // Si se envia token, REQUIERE coincidencia exacta (no fallback a IP)
  // Solo permite IP-only en el flujo captive (sin token) y con exactamente 1 pending para esa IP
  let pending = null;
  if (token) {
    pending = await prisma.surveyResponse.findFirst({
      where: { publicToken: token, status: 'pending' },
    });
    if (!pending) {
      return res.status(401).json({ ok: false, error: 'Token invalido o encuesta no encontrada' });
    }
  } else {
    const pendingsForIp = await prisma.surveyResponse.findMany({
      where: { clientIp: ip, status: 'pending' },
      orderBy: { sentAt: 'desc' },
      take: 2,
    });
    if (pendingsForIp.length === 0) {
      return res.status(404).json({ ok: false, error: 'No hay encuesta pendiente para tu IP' });
    }
    if (pendingsForIp.length > 1) {
      // Ambiguo: hay multiples encuestas para la misma IP -> obligar a usar token del link
      return res.status(400).json({ ok: false, error: 'Multiples encuestas pendientes. Usa el link de WhatsApp para identificarte.' });
    }
    pending = pendingsForIp[0];
  }
  // Guardar
  await prisma.surveyResponse.update({
    where: { id: pending.id },
    data: {
      fullName,
      phone,
      status: 'submitted',
      submittedAt: new Date(),
      nextReminderAt: null,
      lastReminderStatus: 'submitted',
      userAgent: (req.headers['user-agent'] || '').toString().substring(0, 200),
    },
  });
  // Sacar al cliente del address-list para que pueda navegar
  try {
    const c = await getMtConnection();
    await removeFromAddressList(c, LIST_SURVEY, pending.clientIp || ip);
  } catch (e) {
    console.error('[survey] error removing from MT list:', e.message);
  }
  res.json({
    ok: true,
    html: buildSurveyForm({ ip: pending.clientIp || ip, name: fullName, alreadySubmitted: true }),
  });
}));

// API admin para crear/listar encuestas
// (surveyRouter ya declarado y montado mas arriba en /api/survey)
surveyRouter.use(authMiddleware);
surveyRouter.use(requireAnyRole(['cobranza']));

// Activar encuesta para un cliente (por IP)
surveyRouter.post('/start', asyncHandler(async (req, res) => {
  const ip = (req.body?.ip || '').toString().trim();
  const idServicio = req.body?.idServicio ? parseInt(req.body.idServicio) : null;
  const legacyNat = req.body?.legacyNat === true || req.body?.forceRedirect === true;
  if (legacyNat && !userHasRole(req.session, ['admin'])) {
    return res.status(403).json({ ok: false, error: 'Solo admin puede activar NAT legacy de encuesta' });
  }
  if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    return res.status(400).json({ ok: false, error: 'IP invalida' });
  }
  const submittedWhere = [{ clientIp: ip, status: 'submitted' }];
  if (idServicio) submittedWhere.push({ idServicio, status: 'submitted' });
  const submitted = await prisma.surveyResponse.findFirst({
    where: { OR: submittedWhere },
    orderBy: { submittedAt: 'desc' },
  });
  if (submitted) {
    return res.json({
      ok: true,
      alreadySubmitted: true,
      survey: withSurveyPublicUrl(req, submitted),
    });
  }

  // Si ya hay una pending para esta IP, devolverla
  let existing = await prisma.surveyResponse.findFirst({
    where: { clientIp: ip, status: 'pending' },
  });
  if (existing) {
    if (!existing.publicToken) {
      existing = await prisma.surveyResponse.update({
        where: { id: existing.id },
        data: { publicToken: generateSurveyToken(), nextReminderAt: existing.nextReminderAt || new Date() },
      });
    }
    const reminder = await sendSurveyReminderById(existing.id, req).catch((e) => ({ ok: false, error: e.message }));
    let mtResult = null;
    if (legacyNat) {
      try {
        const c = await getMtConnection();
        const nat = await ensureSurveySoftPortalNat(c);
        const list = await addToAddressList(c, LIST_SURVEY, ip, `survey ${existing.id}`);
        mtResult = { mode: 'legacy-nat-http', nat, list };
      } catch (e) {
        mtResult = { mode: 'legacy-nat-http', ok: false, error: e.message };
      }
    } else {
      mtResult = { mode: 'cloud-link', ok: true, skippedMikrotik: true };
    }
    return res.json({
      ok: true,
      alreadyPending: true,
      delivery: 'cloud-link',
      networkImpact: false,
      publicUrl: buildSurveyUrl(req, existing.publicToken),
      portalUrl: buildSurveyPortalUrl(req, existing.clientIp),
      reminder,
      survey: withSurveyPublicUrl(req, existing),
      mikrotik: mtResult,
    });
  }
  // Buscar cliente por IP si no se dio idServicio
  let resolvedIdServicio = idServicio;
  if (!resolvedIdServicio) {
    const cl = await prisma.client.findFirst({ where: { ip } });
    if (cl) resolvedIdServicio = cl.idServicio;
  }
  const survey = await prisma.surveyResponse.create({
    data: {
      clientIp: ip,
      idServicio: resolvedIdServicio,
      publicToken: generateSurveyToken(),
      sentBy: req.user?.username || 'admin',
      status: 'pending',
      nextReminderAt: new Date(),
    },
  });
  // Modo seguro por defecto: enlace en la nube + recordatorios, sin tocar
  // navegacion del cliente. El NAT legacy queda solo para admins y no se usa
  // desde la UI porque Railway no puede servir captive con Host arbitrario.
  let mtResult = null;
  if (legacyNat) {
    try {
      const c = await getMtConnection();
      const nat = await ensureSurveySoftPortalNat(c);
      const list = await addToAddressList(c, LIST_SURVEY, ip, `survey ${survey.id}`);
      mtResult = { mode: 'legacy-nat-http', nat, list };
    } catch (e) {
      console.error('[survey] error adding to MT list:', e.message);
      return res.status(500).json({ ok: false, error: 'Encuesta guardada pero error al activar en MikroTik: ' + e.message, survey: withSurveyPublicUrl(req, survey) });
    }
  } else {
    mtResult = { mode: 'cloud-link', ok: true, skippedMikrotik: true };
  }
  const reminder = await sendSurveyReminderById(survey.id, req).catch((e) => ({ ok: false, error: e.message }));
  await logActivity(req, {
    action: 'survey_started',
    entityType: 'survey',
    entityId: survey.id,
    entityName: ip,
    details: { idServicio: resolvedIdServicio, delivery: 'cloud-link', networkImpact: false, mikrotik: mtResult?.mode || null },
  });
  res.json({
    ok: true,
    delivery: 'cloud-link',
    networkImpact: false,
    publicUrl: buildSurveyUrl(req, survey.publicToken),
    portalUrl: buildSurveyPortalUrl(req, survey.clientIp),
    reminder,
    survey: withSurveyPublicUrl(req, survey),
    mikrotik: mtResult,
  });
}));

// Reenviar manualmente el recordatorio de WhatsApp para una encuesta pending
surveyRouter.post('/resend/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'id invalido' });
  const survey = await prisma.surveyResponse.findUnique({ where: { id } });
  if (!survey) return res.status(404).json({ ok: false, error: 'No existe' });
  if (survey.status !== 'pending') return res.status(400).json({ ok: false, error: `Encuesta esta en estado ${survey.status}, no se puede reenviar` });
  const result = await sendSurveyReminderById(id, req).catch((e) => ({ ok: false, error: e.message }));
  if (result?.ok) {
    return res.json({ ok: true, message: 'WhatsApp enviado', publicUrl: result.publicUrl });
  }
  res.status(400).json({
    ok: false,
    error: result?.reason || result?.error || 'No se pudo enviar',
    publicUrl: result?.publicUrl,
  });
}));

// Cancelar una encuesta pending (saca al cliente del list sin guardar respuesta)
surveyRouter.post('/cancel/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const survey = await prisma.surveyResponse.findUnique({ where: { id } });
  if (!survey) return res.status(404).json({ ok: false, error: 'No existe' });
  await prisma.surveyResponse.update({
    where: { id },
    data: { status: 'cancelled' },
  });
  try {
    const c = await getMtConnection();
    await removeFromAddressList(c, LIST_SURVEY, survey.clientIp);
  } catch (e) {
    console.error('[survey] cancel mt error:', e.message);
  }
  await logActivity(req, {
    action: 'survey_cancelled',
    entityType: 'survey',
    entityId: survey.id,
    entityName: survey.clientIp,
    details: { idServicio: survey.idServicio },
  });
  res.json({ ok: true });
}));

// Quitar encuesta inteligente: cancela pendientes y limpia restos legacy en MikroTik.
surveyRouter.post('/clear', asyncHandler(async (req, res) => {
  const ip = (req.body?.ip || '').toString().trim();
  const idServicio = req.body?.idServicio ? parseInt(req.body.idServicio) : null;

  if (!ip && !idServicio) {
    return res.status(400).json({ ok: false, error: 'IP o idServicio requerido' });
  }
  if (ip && !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    return res.status(400).json({ ok: false, error: 'IP invalida' });
  }

  const pendingWhere = [];
  if (ip) pendingWhere.push({ clientIp: ip, status: 'pending' });
  if (idServicio) pendingWhere.push({ idServicio, status: 'pending' });

  const pending = pendingWhere.length
    ? await prisma.surveyResponse.findMany({ where: { OR: pendingWhere } })
    : [];
  const ids = pending.map((row) => row.id);

  let snoozed = 0;
  if (ids.length) {
    const result = await prisma.surveyResponse.updateMany({
      where: { id: { in: ids } },
      data: {
        snoozedAt: new Date(),
        nextReminderAt: addHours(new Date(), SURVEY_REMINDER_INTERVAL_HOURS),
        snoozeCount: { increment: 1 },
        lastReminderStatus: 'snoozed_by_admin',
      },
    });
    snoozed = result.count;
  }

  const ipsToClean = [...new Set([ip, ...pending.map((row) => row.clientIp)].filter(Boolean))];
  const mikrotik = { removed: [], errors: [] };
  if (ipsToClean.length) {
    try {
      const c = await getMtConnection();
      for (const targetIp of ipsToClean) {
        const removed = await removeFromAddressList(c, LIST_SURVEY, targetIp);
        mikrotik.removed.push({ ip: targetIp, wasInList: removed.wasIn });
      }
    } catch (e) {
      console.error('[survey] smart clear mt error:', e.message);
      mikrotik.errors.push(e.message);
    }
  }

  await logActivity(req, {
    action: 'survey_snoozed',
    entityType: 'survey',
    entityName: ip || String(idServicio),
    details: { idServicio, ip, snoozed, mikrotik },
  });
  res.json({
    ok: true,
    snoozed,
    cancelled: 0,
    nextReminderAt: snoozed ? addHours(new Date(), SURVEY_REMINDER_INTERVAL_HOURS) : null,
    reminderIntervalHours: SURVEY_REMINDER_INTERVAL_HOURS,
    mikrotik,
  });
}));

// Plantilla del mensaje WhatsApp para encuestas (editable)
surveyRouter.get('/template', asyncHandler(async (req, res) => {
  const template = await getSurveyMessageTemplate();
  res.json({
    ok: true,
    template,
    default: SURVEY_MESSAGE_DEFAULT,
    placeholders: ['{nombre}', '{negocio}', '{url}', '{telefono}', '{ip}', '{plan}'],
  });
}));

surveyRouter.put('/template', asyncHandler(async (req, res) => {
  const tpl = (req.body?.template || '').toString();
  if (tpl.length > 2000) return res.status(400).json({ ok: false, error: 'Demasiado largo (max 2000 chars)' });
  if (!tpl.includes('{url}')) return res.status(400).json({ ok: false, error: 'El template debe contener {url} para incluir el enlace' });
  await prisma.appSetting.upsert({
    where: { key: 'survey_message_template' },
    create: { key: 'survey_message_template', value: tpl },
    update: { value: tpl },
  });
  res.json({ ok: true, template: tpl });
}));

// Listar respuestas
surveyRouter.get('/responses', asyncHandler(async (req, res) => {
  const status = req.query?.status;
  const where = status ? { status: status.toString() } : {};
  const rows = await prisma.surveyResponse.findMany({
    where,
    orderBy: { sentAt: 'desc' },
    take: 500,
    include: { client: { select: { idServicio: true, nombre: true, telefono: true, ip: true, planInternetName: true } } },
  });
  const rowsWithTokens = await Promise.all(rows.map((row) => {
    if (row.status === 'pending' && !row.publicToken) {
      return prisma.surveyResponse.update({
        where: { id: row.id },
        data: { publicToken: generateSurveyToken(), nextReminderAt: row.nextReminderAt || new Date() },
        include: { client: { select: { idServicio: true, nombre: true, telefono: true, ip: true, planInternetName: true } } },
      });
    }
    return row;
  }));
  res.json({ ok: true, rows: rowsWithTokens.map((row) => withSurveyPublicUrl(req, row)) });
}));

// Eliminar respuesta
surveyRouter.delete('/responses/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const survey = await prisma.surveyResponse.findUnique({ where: { id } });
  if (!survey) return res.status(404).json({ ok: false, error: 'No existe' });
  // Si esta pending, primero sacar del MT list
  if (survey.status === 'pending') {
    try {
      const c = await getMtConnection();
      await removeFromAddressList(c, LIST_SURVEY, survey.clientIp);
    } catch {}
  }
  await prisma.surveyResponse.delete({ where: { id } });
  await logActivity(req, {
    action: 'survey_deleted',
    entityType: 'survey',
    entityId: survey.id,
    entityName: survey.clientIp,
    details: { status: survey.status, idServicio: survey.idServicio },
  });
  res.json({ ok: true });
}));

function buildSurveyHotspotSnippet(req) {
  const base = `${getPublicBaseUrl(req)}/survey/portal`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="0; url=${base}?ip=$(ip)&mac=$(mac)">
  <title>Encuesta</title>
</head>
<body>
  <script>location.replace('${base}?ip=$(ip)&mac=$(mac)');</script>
  <a href="${base}?ip=$(ip)&mac=$(mac)">Continuar</a>
</body>
</html>`;
}

// Setup seguro: por defecto NO crea NAT ciego hacia Railway. Railway enruta por
// Host y fuerza HTTPS, por eso la encuesta segura debe abrir una URL real con
// el dominio correcto. Un portal local/Hotspot puede enlazar a /survey/portal.
// El modo legacy queda disponible solo si se pide explicitamente.
surveyRouter.post('/setup', asyncHandler(async (req, res) => {
  if (req.body?.mode !== 'legacy-nat' && req.body?.forceLegacy !== true) {
    return res.json({
      ok: true,
      mode: 'cloud-link',
      portalUrl: buildSurveyPortalUrl(req, ''),
      hotspotLoginHtml: buildSurveyHotspotSnippet(req),
      note: 'No se creo NAT legacy. Usa el enlace seguro o instala este HTML solo en un Hotspot/portal local que abra el dominio real de Railway.',
    });
  }

  const dns = require('dns').promises;
  const host = req.body?.host || process.env.RAILWAY_PUBLIC_DOMAIN || 'wishub-admin-production.up.railway.app';
  const port = parseInt(req.body?.port || '80');
  const NAT_COMMENT = 'WISP RD - Encuesta forzada (HTTP)';

  // Resolver el dominio a IP
  const resolved = await dns.lookup(host);
  const serverIp = resolved.address;

  const c = await getMtConnection();

  // Buscar regla existente
  const natRules = await c.write('/ip/firewall/nat/print', `?comment=${NAT_COMMENT}`);
  let action;
  if (natRules.length > 0) {
    const rule = natRules[0];
    if (rule['to-addresses'] !== serverIp || rule['to-ports'] !== String(port)) {
      await c.write(
        '/ip/firewall/nat/set',
        '=.id=' + rule['.id'],
        '=to-addresses=' + serverIp,
        '=to-ports=' + port,
      );
      action = 'updated';
    } else {
      action = 'unchanged';
    }
    res.json({ ok: true, action, ruleId: rule['.id'], serverIp, port, host });
  } else {
    const r = await c.write(
      '/ip/firewall/nat/add',
      '=chain=dstnat',
      '=protocol=tcp',
      '=dst-port=80',
      '=src-address-list=' + LIST_SURVEY,
      '=action=dst-nat',
      '=to-addresses=' + serverIp,
      '=to-ports=' + port,
      '=comment=' + NAT_COMMENT,
    );
    action = 'created';
    res.json({ ok: true, action, ruleId: r[0]?.ret, serverIp, port, host });
  }
}));

// Stats rapidos para dashboard
surveyRouter.get('/stats', asyncHandler(async (req, res) => {
  const [pending, submitted, total] = await Promise.all([
    prisma.surveyResponse.count({ where: { status: 'pending' } }),
    prisma.surveyResponse.count({ where: { status: 'submitted' } }),
    prisma.surveyResponse.count(),
  ]);
  res.json({ ok: true, pending, submitted, total });
}));

// (surveyRouter ya montado en /api/survey arriba antes del apiRouter)

// ═══════════════════════════════════════════════════════════════
// AUTO-SYNC LOOP (cada 2 min: WispHub + MikroTik -> SQLite)
// ═══════════════════════════════════════════════════════════════

const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS || '120000');
let syncTimer = null;
let lastSyncAt = null;
let lastSyncResult = null;

async function fetchWisphubAllClients() {
  const fetchPage = async (offset = 0) => {
    const url = `https://api.wisphub.io/api/clientes/?limit=100${offset ? `&offset=${offset}` : ''}`;
    const r = await fetch(url, {
      headers: { Authorization: `Api-Key ${API_KEY}`, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`WispHub ${r.status}`);
    return r.json();
  };
  let all = [];
  let offset = 0;
  let pages = 0;
  while (pages < 50) {
    const page = await fetchPage(offset);
    all = all.concat(page.results || []);
    if (!page.next) break;
    offset += 100;
    pages++;
  }
  return all;
}

async function syncOnce() {
  const startedAt = new Date();
  const log = await prisma.syncLog.create({
    data: { entity: 'unified', status: 'running', startedAt },
  }).catch(() => null);

  let wpCount = 0, mtCount = 0, updated = 0, errors = 0;
  try {
    const wpClients = API_KEY ? await fetchWisphubAllClients().catch(() => []) : [];
    wpCount = wpClients.length;

    let queues = [];
    let arp = [];
    try {
      const c = await getMtConnection();
      queues = await c.write('/queue/simple/print');
      arp = await c.write('/ip/arp/print').catch(() => []);
      mtCount = queues.length;
    } catch (e) {
      console.error('[sync] mikrotik error:', e.message);
    }

    const arpByIp = new Map();
    for (const a of arp) {
      const addr = a.address;
      if (addr) arpByIp.set(addr, a);
    }
    const queueByIp = new Map();
    for (const q of queues) {
      const ip = (q.target || '').split('/')[0];
      if (ip) queueByIp.set(ip, q);
    }

    for (const cl of wpClients) {
      try {
        const ip = cl.ip || cl.ip_local || null;
        const queue = ip ? queueByIp.get(ip) : null;
        const arpEntry = ip ? arpByIp.get(ip) : null;

        await prisma.client.upsert({
          where: { idServicio: cl.id_servicio },
          create: mapWisphubToClient(cl, queue, arpEntry),
          update: mapWisphubToClient(cl, queue, arpEntry),
        });
        updated++;
      } catch (e) {
        errors++;
      }
    }

    if (log) {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: errors ? 'partial' : 'success',
          endedAt: new Date(),
          recordCount: updated,
          durationMs: Date.now() - startedAt.getTime(),
        },
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[sync] fatal:', e.message);
    if (log) {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: { status: 'error', endedAt: new Date(), errorMessage: e.message },
      }).catch(() => {});
    }
  }

  lastSyncAt = new Date();
  lastSyncResult = {
    at: lastSyncAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    wisphub: wpCount,
    mikrotik: mtCount,
    updated,
    errors,
  };
  console.log('[sync]', JSON.stringify(lastSyncResult));
}

function mapWisphubToClient(cl, queue, arpEntry) {
  return {
    idServicio: cl.id_servicio,
    usuario: cl.usuario || null,
    nombre: cl.nombre || cl.servicio || 'Sin nombre',
    email: cl.email || null,
    telefono: cl.telefono || null,
    direccion: cl.direccion || null,
    cedula: cl.cedula || null,
    ip: cl.ip || null,
    ipLocal: cl.ip_local || null,
    macCpe: cl.mac_cpe || null,
    interfazLan: cl.interfaz_lan || null,
    estado: cl.estado || null,
    planInternetId: cl.plan_internet?.id || null,
    planInternetName: cl.plan_internet?.nombre || null,
    precioPlan: cl.precio_plan?.toString() || null,
    saldo: cl.saldo?.toString() || null,
    estadoFacturas: cl.estado_facturas || null,
    zonaId: cl.zona?.id || null,
    zonaNombre: cl.zona?.nombre || null,
    routerId: cl.router?.id || null,
    routerNombre: cl.router?.nombre || null,
    tecnicoId: cl.tecnico?.id || null,
    tecnicoNombre: cl.tecnico?.nombre || null,
    firewall: cl.firewall ?? true,
    fechaInstalacion: cl.fecha_instalacion || null,
    fechaCorte: cl.fecha_corte || null,
    ultimoCambio: cl.ultimo_cambio || null,
    syncedAt: new Date(),
    mtSyncedAt: queue || arpEntry ? new Date() : undefined,
    mtMacAddress: arpEntry?.['mac-address'] || null,
    mtQueueName: queue?.name || null,
    mtQueueLimit: queue?.['max-limit'] || null,
    mtInterface: arpEntry?.interface || null,
  };
}

const syncRouter = express.Router();
syncRouter.use(authMiddleware);
syncRouter.use(requireRole(['admin']));
syncRouter.get('/status', (req, res) => {
  res.json({
    running: !!syncTimer,
    intervalMs: SYNC_INTERVAL_MS,
    lastSyncAt,
    lastSyncResult,
  });
});
syncRouter.post('/run', asyncHandler(async (req, res) => {
  await syncOnce();
  res.json(lastSyncResult);
}));
app.use('/sync', syncRouter);

function startSyncLoop() {
  if (syncTimer) return;
  console.log(`[sync] starting loop. interval=${SYNC_INTERVAL_MS}ms`);
  syncOnce().catch((e) => console.error('[sync] first run error:', e.message));
  syncTimer = setInterval(() => {
    syncOnce().catch((e) => console.error('[sync] tick error:', e.message));
  }, SYNC_INTERVAL_MS);
}

// ─── WHATSAPP BAILEYS ───
let waSocket = null;
let waQR = null;
let waStatus = 'disconnected';
let waRetryCount = 0;
let waRetryTimer = null;
let waManuallyDisconnected = false;
const WA_MAX_RETRY = 5;
const WA_BASE_RETRY_MS = 10_000;
const WA_MAX_RETRY_MS = 5 * 60_000;

const { handleIncomingMessage } = require('./lib/whatsapp-bot');

// ─── Baileys AuthenticationState persistido en Postgres ───
// Sobrevive a redeploys (antes useMultiFileAuthState guardaba en ./wa-auth/ volatil)
async function usePostgresAuthState() {
  const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');

  const writeData = async (key, data) => {
    const value = JSON.stringify(data, BufferJSON.replacer);
    await prisma.baileysAuth.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  };
  const readData = async (key) => {
    const row = await prisma.baileysAuth.findUnique({ where: { key } }).catch(() => null);
    if (!row) return null;
    try {
      return JSON.parse(row.value, BufferJSON.reviver);
    } catch {
      return null;
    }
  };
  const removeData = async (key) => {
    await prisma.baileysAuth.delete({ where: { key } }).catch(() => {});
  };

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const type in data) {
            for (const id in data[type]) {
              const value = data[type][id];
              const k = `${type}-${id}`;
              tasks.push(value ? writeData(k, value) : removeData(k));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData('creds', creds),
    // Util para reset (logout limpio) — borra TODO desde DB
    clearAll: async () => {
      await prisma.baileysAuth.deleteMany({}).catch(() => {});
    },
  };
}

// Normaliza un telefono a JID Baileys. Idempotente: si ya viene con @s.whatsapp.net no lo dobla.
// Acepta formatos: '8095551234', '(809) 555-1234', '+1 809 555 1234', '18095551234', '18095551234@s.whatsapp.net'
function normalizeJid(rawPhone) {
  if (!rawPhone) return null;
  let s = String(rawPhone).trim();
  // Quitar sufijo si ya lo trae
  s = s.replace(/@s\.whatsapp\.net$/i, '').replace(/@c\.us$/i, '');
  // Limpiar caracteres no numericos
  s = s.replace(/[^\d]/g, '');
  if (s.length < 7) return null;
  // DR: si son 10 digitos, prefijar 1
  if (s.length === 10) s = '1' + s;
  return s + '@s.whatsapp.net';
}

// Wrapper que valida conexion antes de enviar y loguea estructurado
async function sendWhatsappRaw(rawPhone, text) {
  if (waStatus !== 'connected' || !waSocket) {
    return { ok: false, error: 'WhatsApp no conectado', code: 'NOT_CONNECTED' };
  }
  const jid = normalizeJid(rawPhone);
  if (!jid) return { ok: false, error: 'Telefono invalido', code: 'BAD_PHONE' };
  try {
    await waSocket.sendMessage(jid, { text });
    return { ok: true, jid };
  } catch (err) {
    // Detectar perdida de conexion mid-envio
    const msg = (err && err.message) || 'sendMessage failed';
    if (/closed|disconnect|stream|connection|timed out/i.test(msg)) {
      waStatus = 'disconnected';
    }
    return { ok: false, error: msg, code: 'SEND_FAILED' };
  }
}

function scheduleWaRetry() {
  if (waManuallyDisconnected) return;
  if (waRetryTimer) clearTimeout(waRetryTimer);
  if (waRetryCount >= WA_MAX_RETRY) {
    console.error(`[WA] max retries (${WA_MAX_RETRY}) alcanzado. No reintentar automaticamente.`);
    return;
  }
  const delay = Math.min(WA_BASE_RETRY_MS * Math.pow(2, waRetryCount), WA_MAX_RETRY_MS);
  waRetryCount++;
  console.log(`[WA] reintento #${waRetryCount} en ${(delay / 1000).toFixed(0)}s`);
  waRetryTimer = setTimeout(() => { waRetryTimer = null; initWhatsApp(); }, delay);
}

let waAuthHandle = null; // referencia al state actual (para clearAll en logout)

async function initWhatsApp() {
  // Evitar arrancar dos veces simultaneo
  if (waSocket && waStatus === 'connected') return;
  waManuallyDisconnected = false;
  try {
    const { default: makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
    waAuthHandle = await usePostgresAuthState();
    const { state, saveCreds } = waAuthHandle;

    waSocket = makeWASocket({ auth: state, printQRInTerminal: false });
    waSocket.ev.on('creds.update', saveCreds);

    waSocket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) { waQR = qr; waStatus = 'qr'; console.log('[WA] QR generado'); }
      if (connection === 'open') {
        waStatus = 'connected';
        waQR = null;
        waRetryCount = 0;
        console.log('[WA] Connected (auth: Postgres)');
      }
      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = reason === DisconnectReason.loggedOut;
        // Reason 440 = "conflict/replaced" -> hay otra sesion activa usando la misma cuenta.
        // Reintentar empeora el problema (cada reconexion genera otro replace).
        const isConflict = reason === DisconnectReason.connectionReplaced || reason === 440;
        waSocket = null;
        if (isConflict) {
          waStatus = 'conflict';
          console.log(`[WA] CONFLICT (reason=${reason}): otra sesion WhatsApp Web/Desktop reemplazo la nuestra. NO reintentando automaticamente.`);
        } else {
          waStatus = isLoggedOut ? 'logged_out' : 'disconnected';
          console.log(`[WA] connection close (reason=${reason}, loggedOut=${isLoggedOut})`);
        }
        // Si fue logout real (sesion invalidada en el telefono), limpiar DB para forzar QR nuevo
        if (isLoggedOut && waAuthHandle) {
          waAuthHandle.clearAll().catch(() => {});
          waAuthHandle = null;
        }
        if (!isLoggedOut && !isConflict && !waManuallyDisconnected) scheduleWaRetry();
      }
    });

    // ─── BOT: escuchar mensajes entrantes ───
    waSocket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        handleIncomingMessage(prisma, waSocket, msg).catch(e => console.error('[Bot]', e.message));
      }
    });
  } catch (err) {
    console.error('[WA] init error:', err.message);
    waStatus = 'error';
    scheduleWaRetry();
  }
}

const waRouter = express.Router();
waRouter.use(authMiddleware);
waRouter.use(requireAnyRole(['cobranza']));

waRouter.get('/status', (req, res) => res.json({ status: waStatus, qr: waQR }));

// ─── TEMPLATES EDITABLES (WhatsappTemplate en BD) ───
// Templates con placeholders {{var}} editables por el admin
// Defaults se siembran al boot si no existen

const DEFAULT_TEMPLATES = {
  invoice: {
    category: 'factura',
    content: `🧾 *FACTURA - {{negocio}}*
━━━━━━━━━━━━━━━━━━━━

👤 *Cliente:* {{nombre}}
{{#cedula}}🪪 Cédula: {{cedula}}
{{/cedula}}{{#direccion}}📍 {{direccion}}
{{/direccion}}{{#telefono}}📞 {{telefono}}
{{/telefono}}
━━━━━━━━━━━━━━━━━━━━
📡 *Plan de Internet*

• Plan: *{{plan}}*
{{#zona}}• Zona: {{zona}}
{{/zona}}{{#ip}}• IP: \`{{ip}}\`
{{/ip}}
━━━━━━━━━━━━━━━━━━━━
💰 *Detalle de cobro*

• Período: {{periodo}}
• Cuota mensual: {{precio}}
{{#saldoPositivo}}• Saldo anterior: {{saldo}}
{{/saldoPositivo}}
💵 *TOTAL A PAGAR: {{total}}*

━━━━━━━━━━━━━━━━━━━━
📅 *Fechas*

• Emitida: {{hoy}}
{{#fechaCorte}}• ⚠️ Vence: *{{fechaCorte}}*
{{/fechaCorte}}{{#estado}}• Estado: {{estado}}
{{/estado}}
━━━━━━━━━━━━━━━━━━━━
💳 *Métodos de pago*

{{bancos}}

━━━━━━━━━━━━━━━━━━━━
📞 Soporte: {{soporte}}
¡Gracias por tu preferencia! 🙌`,
    variables: 'negocio,nombre,cedula,direccion,telefono,plan,zona,ip,periodo,precio,saldo,total,hoy,fechaCorte,estado,bancos,soporte',
  },
  'reminder_t-3': {
    category: 'recordatorio',
    content: `👋 Hola *{{nombre}}*!

Te recordamos que tu factura de internet vence en *3 días*.

🧾 *Detalle:*
• Plan: {{plan}}
• Monto: *{{precio}}*
• Vence: {{fechaCorte}}

Para ver tu factura completa con métodos de pago, escríbenos *FACTURA*.

¡Gracias por tu confianza! 🙌`,
    variables: 'nombre,plan,precio,fechaCorte',
  },
  'reminder_t-1': {
    category: 'recordatorio',
    content: `⏰ Hola *{{nombre}}*

Tu factura de internet vence *MAÑANA*.

💰 Monto: *{{precio}}*
📡 Plan: {{plan}}

Para evitar interrupciones, te invitamos a regularizar tu pago.

¿Necesitas ver los métodos de pago? Responde *FACTURA*.`,
    variables: 'nombre,plan,precio',
  },
  due_today: {
    category: 'recordatorio',
    content: `🚨 Hola *{{nombre}}*

Tu factura de internet vence *HOY*.

💰 Monto: *{{precio}}*
📡 Plan: {{plan}}

Realiza tu pago hoy para evitar interrupciones del servicio.

Responde *FACTURA* para ver los métodos de pago.`,
    variables: 'nombre,plan,precio',
  },
  'overdue_t3': {
    category: 'cobro',
    content: `⚠️ *Aviso a {{nombre}}*

Tu factura está *vencida hace 3 días*.

💰 Monto adeudado: *{{precio}}*
📡 Servicio: {{plan}}
📅 Fecha de corte: {{fechaCorte}}

🚫 Para evitar la *suspensión total del servicio*, regulariza tu pago hoy.

Métodos de pago: responde *FACTURA*.`,
    variables: 'nombre,plan,precio,fechaCorte',
  },
  'overdue_t7': {
    category: 'cobro',
    content: `🛑 *Último aviso - {{nombre}}*

Tu factura tiene *7 días vencida*.

💰 Monto adeudado: *{{precio}}*
📅 Fecha de corte: {{fechaCorte}}

⚠️ Tu servicio será *suspendido en breve* si no se regulariza el pago.

Contacta soporte: {{soporte}}`,
    variables: 'nombre,precio,fechaCorte,soporte',
  },
  blocked_notice: {
    category: 'cobro',
    content: `🛑 *{{nombre}}* - Servicio suspendido

Tu servicio de internet ha sido *suspendido* por falta de pago.

💰 Pendiente: *{{precio}}*
📡 Plan: {{plan}}

Para reactivar inmediatamente, comunícate con soporte:
📞 {{soporte}}

Métodos de pago disponibles: responde *FACTURA*.`,
    variables: 'nombre,plan,precio,soporte',
  },
};

async function ensureTemplatesSeeded() {
  for (const [name, def] of Object.entries(DEFAULT_TEMPLATES)) {
    await prisma.whatsappTemplate.upsert({
      where: { name },
      create: {
        name,
        category: def.category,
        content: def.content,
        variables: def.variables,
        isDefault: true,
      },
      update: {}, // si ya existe (editado por usuario), NO sobrescribir
    });
  }
}

// Render con bloques condicionales {{#var}}...{{/var}} y placeholders {{var}}
function renderTemplate(content, vars) {
  let out = content;
  // Bloques condicionales: {{#var}}contenido{{/var}} (incluido si var es truthy)
  out = out.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, body) => {
    return vars[key] ? body : '';
  });
  // Placeholders simples: {{var}}
  out = out.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v === null || v === undefined ? '' : String(v);
  });
  return out;
}

// Construye el set de variables disponibles para un cliente + invoice
function buildTemplateVars(client, invoice = null, extras = {}) {
  const business = process.env.INVOICE_BUSINESS_NAME || 'MaxWifi';
  const supportPhone = process.env.SUPPORT_PHONE || process.env.INVOICE_SUPPORT_PHONE || '';
  const bankLines = (process.env.INVOICE_BANK_INFO || '').split('|').filter(Boolean);
  const today = new Date().toLocaleDateString('es-DO');

  const precio = formatPriceDop(invoice?.amountDop ?? client.precioPlan) || 'RD$ 0.00';
  const saldoNum = parseFloat(String(client.saldo || '0').replace(/[^\d.-]/g, '')) || 0;
  const saldoFmt = formatPriceDop(saldoNum);
  const totalNum = (parseFloat(String(invoice?.amountDop ?? client.precioPlan ?? '0').replace(/[^\d.-]/g, '')) || 0) + saldoNum;
  const totalFmt = formatPriceDop(totalNum) || precio;
  const periodo = invoice?.periodLabel || new Date().toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });

  // Alias del admin sobreescribe los datos de Wisphub
  const nombreFinal = (client.aliasNombre && client.aliasNombre.trim()) || client.nombre || 'Cliente';
  const cedulaFinal = (client.aliasCedula && client.aliasCedula.trim()) || client.cedula || null;
  const telefonoFinal = (client.aliasTelefono && client.aliasTelefono.trim()) || client.telefono || null;

  return {
    negocio: business,
    soporte: supportPhone,
    bancos: bankLines.map((b) => `• ${b.trim()}`).join('\n') || '(configurar INVOICE_BANK_INFO)',
    hoy: today,
    nombre: nombreFinal,
    nombreWisphub: client.nombre || null, // disponible si quieren mostrar el original
    cedula: cedulaFinal,
    direccion: client.direccion || null,
    telefono: telefonoFinal,
    plan: client.planInternetName || 'Internet',
    zona: client.zonaNombre || null,
    ip: client.ip || null,
    macCpe: client.macCpe || null,
    estado: client.estado || null,
    estadoFacturas: client.estadoFacturas || null,
    fechaCorte: client.fechaCorte || null,
    precio,
    saldo: saldoFmt,
    saldoPositivo: saldoNum > 0 ? saldoFmt : null,
    total: totalFmt,
    periodo,
    ...extras,
  };
}

async function renderClientTemplate(templateName, client, invoice = null, extras = {}) {
  const tpl = await prisma.whatsappTemplate.findUnique({ where: { name: templateName } });
  if (!tpl) {
    return `[Template "${templateName}" no encontrado]`;
  }
  // Incrementa contador de uso
  prisma.whatsappTemplate.update({
    where: { name: templateName },
    data: { useCount: { increment: 1 } },
  }).catch(() => {});

  const vars = buildTemplateVars(client, invoice, extras);
  return renderTemplate(tpl.content, vars);
}

// ─── INVOICE FORMATTING (WhatsApp markdown nice format) ───
function formatPriceDop(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseFloat(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return `RD$ ${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// formatInvoiceMessage es ahora un wrapper sobre renderClientTemplate
async function formatInvoiceMessage(client, invoice = null) {
  return renderClientTemplate('invoice', client, invoice);
}

waRouter.post('/preview-invoice/:idServicio', asyncHandler(async (req, res) => {
  const idServicio = parseInt(req.params.idServicio);
  const client = await prisma.client.findUnique({ where: { idServicio } });
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

  // Si hay invoice especifica solicitada, traerla
  let invoice = null;
  if (req.body?.invoiceId) {
    invoice = await prisma.invoice.findUnique({ where: { id: parseInt(req.body.invoiceId) } });
  } else {
    // ultima factura pendiente
    invoice = await prisma.invoice.findFirst({
      where: { idServicio, status: { in: ['pendiente', 'PENDING'] } },
      orderBy: { dueDate: 'desc' },
    }).catch(() => null);
  }

  const message = await formatInvoiceMessage(client, invoice);
  res.json({ idServicio, telefono: client.telefono, nombre: client.nombre, message, invoice });
}));

waRouter.post('/send-invoice/:idServicio', asyncHandler(async (req, res) => {
  if (waStatus !== 'connected' || !waSocket) {
    return res.status(400).json({ error: 'WhatsApp no conectado. Conecta primero en /whatsapp' });
  }
  const idServicio = parseInt(req.params.idServicio);
  const client = await prisma.client.findUnique({ where: { idServicio } });
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
  if (!client.telefono) return res.status(400).json({ error: 'Cliente sin telefono' });

  let invoice = null;
  if (req.body?.invoiceId) {
    invoice = await prisma.invoice.findUnique({ where: { id: parseInt(req.body.invoiceId) } });
  }

  const message = await formatInvoiceMessage(client, invoice);
  const r = await sendWhatsappNotification(client.idServicio, client.telefono, message, 'invoice', client.nombre);
  res.status(r.ok ? 200 : 500).json(r);
}));

waRouter.post('/send-invoices-bulk', asyncHandler(async (req, res) => {
  if (waStatus !== 'connected' || !waSocket) {
    return res.status(400).json({ error: 'WhatsApp no conectado' });
  }
  // Acepta { idsServicio: [...] } o { onlyPendientes: true }
  let candidates = [];
  if (Array.isArray(req.body?.idsServicio)) {
    candidates = await prisma.client.findMany({
      where: { idServicio: { in: req.body.idsServicio.map(Number) }, telefono: { not: null } },
    });
  } else if (req.body?.onlyPendientes) {
    candidates = await prisma.client.findMany({
      where: { telefono: { not: null }, estadoFacturas: { contains: 'endiente' } },
    });
  }

  const results = [];
  for (const cl of candidates) {
    const message = await formatInvoiceMessage(cl);
    const r = await sendWhatsappNotification(cl.idServicio, cl.telefono, message, 'invoice', cl.nombre);
    results.push({ idServicio: cl.idServicio, nombre: cl.nombre, ok: r.ok, error: r.error });
    await new Promise((r) => setTimeout(r, 2000));
  }
  res.json({ total: candidates.length, sent: results.filter((r) => r.ok).length, results });
}));

waRouter.post('/send', asyncHandler(async (req, res) => {
  const { phone, message, idServicio, clientName, messageType = 'manual' } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone y message requeridos' });
  const r = await sendWhatsappNotification(idServicio || null, phone, message, messageType, clientName || null);
  if (r.ok) res.json({ success: true, jid: r.jid });
  else res.status(400).json({ error: r.error, code: r.code });
}));

waRouter.post('/send-bulk', asyncHandler(async (req, res) => {
  if (waStatus !== 'connected' || !waSocket) return res.status(400).json({ error: 'WhatsApp no conectado' });
  const { contacts, messageType = 'bulk' } = req.body;
  const results = [];
  for (const c of contacts || []) {
    const r = await sendWhatsappNotification(c.idServicio || null, c.phone, c.message, messageType, c.clientName || null);
    results.push({ phone: c.phone, status: r.ok ? 'sent' : 'error', error: r.error });
    await new Promise(rs => setTimeout(rs, 2000));
  }
  res.json({ results });
}));

waRouter.get('/history', asyncHandler(async (req, res) => {
  const msgs = await prisma.whatsappLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(msgs);
}));

let waDisconnecting = false;
waRouter.post('/disconnect', async (req, res) => {
  // Guard contra doble click rapido
  if (waDisconnecting) {
    return res.json({ status: 'disconnecting', message: 'Ya en proceso' });
  }
  waDisconnecting = true;
  try {
    waManuallyDisconnected = true;
    if (waRetryTimer) { clearTimeout(waRetryTimer); waRetryTimer = null; }

    // Cerrar socket en cualquier estado (connected/qr/connecting/error)
    if (waSocket) {
      try { await waSocket.logout(); } catch (e) { console.log('[WA] logout error (continuando):', e.message); }
      try { waSocket.end?.(undefined); } catch {}
      try { waSocket.ws?.close?.(); } catch {}
      waSocket = null;
    }

    // Limpiar credenciales en DB para forzar QR nuevo la proxima vez
    if (waAuthHandle) {
      try { await waAuthHandle.clearAll(); } catch (e) { console.log('[WA] clearAll error:', e.message); }
      waAuthHandle = null;
    }

    waStatus = 'disconnected';
    waQR = null;
    waRetryCount = 0;
    console.log('[WA] desconectado manualmente');
    res.json({ status: 'disconnected' });
  } finally {
    waDisconnecting = false;
  }
});

waRouter.post('/connect', async (req, res) => {
  if (waStatus === 'connected') return res.json({ status: 'already connected' });
  // Si veniamos de conflict o logged_out, limpiar credenciales para forzar QR limpio
  if ((waStatus === 'conflict' || waStatus === 'logged_out') && waAuthHandle) {
    try { await waAuthHandle.clearAll(); } catch {}
    waAuthHandle = null;
  }
  waManuallyDisconnected = false;
  waRetryCount = 0;
  if (waRetryTimer) { clearTimeout(waRetryTimer); waRetryTimer = null; }
  initWhatsApp();
  res.json({ status: 'connecting' });
});

// ─── BOT CONFIGURATION ───
waRouter.get('/bot/status', asyncHandler(async (req, res) => {
  const enabled = await prisma.appSetting.findUnique({ where: { key: 'whatsapp_bot_enabled' } });
  const [incoming, outgoing] = await Promise.all([
    prisma.whatsappLog.count({ where: { messageType: 'incoming' } }),
    prisma.whatsappLog.count({ where: { messageType: { startsWith: 'bot_' } } }),
  ]);
  res.json({
    enabled: enabled?.value === 'true',
    waConnected: waStatus === 'connected',
    stats: { incoming, outgoing },
  });
}));

waRouter.post('/bot/toggle', asyncHandler(async (req, res) => {
  const { enabled } = req.body;
  await prisma.appSetting.upsert({
    where: { key: 'whatsapp_bot_enabled' },
    update: { value: String(!!enabled) },
    create: { key: 'whatsapp_bot_enabled', value: String(!!enabled), category: 'whatsapp' },
  });
  res.json({ enabled: !!enabled });
}));

waRouter.get('/bot/conversations', asyncHandler(async (req, res) => {
  // Agrupar logs por telefono para ver conversaciones
  const limit = parseInt(req.query.limit) || 50;
  const logs = await prisma.whatsappLog.findMany({
    where: {
      OR: [
        { messageType: 'incoming' },
        { messageType: { startsWith: 'bot_' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  // Group by phone
  const conversations = {};
  for (const log of logs) {
    if (!conversations[log.phone]) {
      conversations[log.phone] = {
        phone: log.phone,
        clientName: log.clientName,
        idServicio: log.idServicio,
        messageCount: 0,
        lastMessage: log.message,
        lastAt: log.createdAt,
        messages: [],
      };
    }
    conversations[log.phone].messageCount++;
    conversations[log.phone].messages.push({
      type: log.messageType,
      message: log.message,
      at: log.createdAt,
    });
  }

  res.json(Object.values(conversations).slice(0, 30));
}));

waRouter.get('/bot/conversation/:phone', asyncHandler(async (req, res) => {
  const logs = await prisma.whatsappLog.findMany({
    where: { phone: req.params.phone },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  res.json(logs);
}));

app.use('/wa', waRouter);

// ─── CAPTIVE INTERCEPTOR ───
// Si un cliente bloqueado llega aqui via DST-NAT del MikroTik, su Host header
// va a ser el dominio que intentaba abrir (google.com, etc) - NO el de la app.
// Detectamos eso y servimos el captive en vez del Angular admin.
function getKnownHosts() {
  const raw = process.env.CRM_KNOWN_HOSTS || '';
  const fromEnv = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  // Hosts publicos que el admin usa: Railway URL, IP publica MikroTik, localhost
  const defaults = ['localhost:7400', 'localhost:7402', '127.0.0.1:7400', '127.0.0.1:7402'];
  const railwayHost = (process.env.RAILWAY_PUBLIC_DOMAIN || '').toLowerCase();
  if (railwayHost) defaults.push(railwayHost);
  return [...defaults, ...fromEnv];
}

app.use(asyncHandler(async (req, res, next) => {
  // Endpoints internos siempre pasan
  if (
    req.path === '/captive' ||
    req.path === '/health' ||
    req.path.startsWith('/auth') ||
    req.path.startsWith('/api') ||
    req.path.startsWith('/db') ||
    req.path.startsWith('/wa') ||
    req.path.startsWith('/sync') ||
    req.path.startsWith('/mikrotik') ||
    req.path.startsWith('/clients-actions') ||
    req.path.startsWith('/web-activity') ||
    req.path.startsWith('/auto-block') ||
    req.path.startsWith('/notifications') ||
    req.path.startsWith('/templates') ||
    req.path.startsWith('/sys') ||
    req.path.startsWith('/users') ||
    req.path.startsWith('/metrics') ||
    req.path.startsWith('/ops') ||
    req.path === '/favicon.ico'
  ) return next();

  const host = (req.headers.host || '').toLowerCase();
  const known = getKnownHosts();
  if (known.includes(host)) return next();

  // Host desconocido → cliente bloqueado llego via DST-NAT
  if (req.method === 'GET') {
    const ip = detectClientIp(req);
    const pendingSurvey = await prisma.surveyResponse.findFirst({
      where: { clientIp: ip, status: 'pending' },
      select: { id: true },
    });
    if (pendingSurvey) return renderSurveyLanding(req, res);
  }
  return renderCaptive(req, res);
}));

// ─── WEB ACTIVITY API (registrar antes del captive interceptor + static) ───
const webActivityRouter = express.Router();
webActivityRouter.use(authMiddleware);
webActivityRouter.use(requireRole(['admin']));

webActivityRouter.get('/:id', asyncHandler(async (req, res) => {
  const idServicio = parseInt(req.params.id);
  const KEEP_DAYS = parseInt(process.env.WEB_ACTIVITY_KEEP_DAYS || '30');
  const days = Math.min(parseInt(req.query.days || '7'), KEEP_DAYS);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows = await prisma.webActivity.findMany({
    where: { idServicio, day: { gte: cutoff } },
    orderBy: [{ queryCount: 'desc' }],
    take: 100,
  });

  const byDay = {};
  let totalQueries = 0;
  for (const r of rows) {
    byDay[r.day] = (byDay[r.day] || 0) + r.queryCount;
    totalQueries += r.queryCount;
  }

  res.json({
    idServicio,
    days,
    totalDomains: rows.length,
    totalQueries,
    byDay,
    topDomains: rows.slice(0, 30),
  });
}));

webActivityRouter.get('/', asyncHandler(async (req, res) => {
  const KEEP_DAYS = parseInt(process.env.WEB_ACTIVITY_KEEP_DAYS || '30');
  const days = Math.min(parseInt(req.query.days || '1'), KEEP_DAYS);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows = await prisma.webActivity.groupBy({
    by: ['domain'],
    where: { day: { gte: cutoff } },
    _sum: { queryCount: true },
    orderBy: { _sum: { queryCount: 'desc' } },
    take: 50,
  });

  res.json(rows.map((r) => ({ domain: r.domain, queryCount: r._sum.queryCount })));
}));

app.use('/web-activity', webActivityRouter);

// ─── TEMPLATES (CRUD + preview render) ───
const templatesRouter = express.Router();
templatesRouter.use(authMiddleware);
templatesRouter.use(requireAnyRole(['cobranza']));

// Lista todos los templates
templatesRouter.get('/', asyncHandler(async (req, res) => {
  const all = await prisma.whatsappTemplate.findMany({ orderBy: { name: 'asc' } });
  res.json(all);
}));

// Vars disponibles (para autocomplete en UI)
templatesRouter.get('/variables', (req, res) => {
  res.json({
    placeholders: [
      'negocio', 'soporte', 'bancos', 'hoy',
      'nombre', 'cedula', 'direccion', 'telefono',
      'plan', 'zona', 'ip', 'macCpe',
      'estado', 'estadoFacturas', 'fechaCorte',
      'precio', 'saldo', 'total', 'periodo',
      'dias', // solo en recordatorios
    ],
    blocks: 'Usa {{#var}}...{{/var}} para condicionar bloques. Ej: {{#telefono}}📞 {{telefono}}{{/telefono}}',
  });
});

// Get individual
templatesRouter.get('/:name', asyncHandler(async (req, res) => {
  const t = await prisma.whatsappTemplate.findUnique({ where: { name: req.params.name } });
  if (!t) return res.status(404).json({ error: 'Template no encontrado' });
  res.json(t);
}));

// Editar (solo content + category)
templatesRouter.patch('/:name', asyncHandler(async (req, res) => {
  const data = {};
  if (typeof req.body?.content === 'string') data.content = req.body.content;
  if (typeof req.body?.category === 'string') data.category = req.body.category;
  if (typeof req.body?.variables === 'string') data.variables = req.body.variables;
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

  const updated = await prisma.whatsappTemplate.update({
    where: { name: req.params.name },
    data,
  }).catch(() => null);
  if (!updated) return res.status(404).json({ error: 'Template no encontrado' });
  res.json(updated);
}));

// Restaurar a default (descarta edits)
templatesRouter.post('/:name/reset', asyncHandler(async (req, res) => {
  const def = DEFAULT_TEMPLATES[req.params.name];
  if (!def) return res.status(404).json({ error: 'No hay default para este template' });
  const updated = await prisma.whatsappTemplate.update({
    where: { name: req.params.name },
    data: { content: def.content, category: def.category, variables: def.variables },
  });
  res.json(updated);
}));

// Crear template custom (no-default)
templatesRouter.post('/', asyncHandler(async (req, res) => {
  const { name, content, category, variables } = req.body || {};
  if (!name || !content) return res.status(400).json({ error: 'name y content requeridos' });
  const created = await prisma.whatsappTemplate.create({
    data: { name, content, category: category || 'custom', variables: variables || '', isDefault: false },
  }).catch((e) => ({ error: e.message }));
  if (created.error) return res.status(400).json({ error: created.error });
  res.status(201).json(created);
}));

// Eliminar template (no-default solamente)
templatesRouter.delete('/:name', asyncHandler(async (req, res) => {
  const t = await prisma.whatsappTemplate.findUnique({ where: { name: req.params.name } });
  if (!t) return res.status(404).json({ error: 'No encontrado' });
  if (t.isDefault) return res.status(400).json({ error: 'No se puede eliminar template default. Usa POST /reset para restaurar.' });
  await prisma.whatsappTemplate.delete({ where: { name: req.params.name } });
  res.json({ ok: true });
}));

// Preview con cliente real o vars custom
templatesRouter.post('/:name/preview', asyncHandler(async (req, res) => {
  const tpl = await prisma.whatsappTemplate.findUnique({ where: { name: req.params.name } });
  if (!tpl) return res.status(404).json({ error: 'Template no encontrado' });

  let vars;
  if (req.body?.idServicio) {
    const client = await prisma.client.findUnique({ where: { idServicio: parseInt(req.body.idServicio) } });
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    vars = buildTemplateVars(client, null, req.body?.extras || {});
  } else if (req.body?.vars) {
    vars = req.body.vars;
  } else {
    // Cliente sample
    vars = buildTemplateVars(
      { nombre: 'Juan Perez (sample)', telefono: '8090000000', planInternetName: '20M Fibra', precioPlan: '1500', fechaCorte: '15/06/2026', ip: '192.168.16.99', zonaNombre: 'Centro', estado: 'Activo' },
      null,
      req.body?.extras || {},
    );
  }

  res.json({ rendered: renderTemplate(tpl.content, vars), vars });
}));

app.use('/templates', templatesRouter);

// Forward declared routers para auto-block y notifications
// (los handlers se definen mas abajo, pero el mount tiene que ir antes del static catch-all)
const autoBlockRouter = express.Router();
autoBlockRouter.use(authMiddleware);
autoBlockRouter.use(requireRole(['admin']));
app.use('/auto-block', autoBlockRouter);

const paymentWarningRouter = express.Router();
paymentWarningRouter.use(authMiddleware);
app.use('/payment-warning', paymentWarningRouter);

const notifRouter = express.Router();
notifRouter.use(authMiddleware);
notifRouter.use(requireAnyRole(['cobranza']));
app.use('/notifications', notifRouter);

const metricsRouter = express.Router();
metricsRouter.use(authMiddleware);
metricsRouter.use(requireAnyRole(['tecnico']));
app.use('/metrics', metricsRouter);

const opsRouter = express.Router();
opsRouter.use(authMiddleware);
opsRouter.use(requireAnyRole(['tecnico']));
opsRouter.get('/status', asyncHandler(async (req, res) => {
  res.json(await collectOpsStatus());
}));
opsRouter.post('/repair-captive', requireRole(['admin']), asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const rules = await ensureClientBlockCaptiveRules(c);
  await logActivity(req, {
    action: 'mikrotik_captive_rules_repaired',
    entityType: 'mikrotik',
    entityName: 'captive-rules',
    details: { target: rules.target },
  });
  res.json({ ok: true, rules, status: await inspectClientBlockCaptiveRules(c) });
}));
app.use('/ops', opsRouter);

// ─── STATIC FILES (Angular build) ───
const distPath = path.join(__dirname, 'dist/wishub-admin/browser');
if (fs.existsSync(distPath)) {
  // Assets con hash (chunk-XXX.js, styles-YYY.css, etc) -> cache largo
  // index.html NO debe cachear, sino el navegador sigue cargando referencias viejas a JS borrado.
  app.use(express.static(distPath, {
    maxAge: IS_PROD ? '1y' : 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    },
  }));
  app.get(/.*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ─── ERROR HANDLER GLOBAL ───
app.use((err, req, res, next) => {
  console.error('[ERR]', err.message);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(IS_PROD ? {} : { stack: err.stack }),
  });
});

// ═══════════════════════════════════════════════════════════════
// WEB ACTIVITY TRACKING (DNS log -> aggregated por cliente+dominio+dia)
// ═══════════════════════════════════════════════════════════════

async function collectOpsStatus() {
  const startedAt = Date.now();
  const [dbOk, latestSync, counts, latestActivity] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    prisma.syncLog.findMany({ orderBy: { startedAt: 'desc' }, take: 5 }).catch(() => []),
    Promise.all([
      prisma.client.count().catch(() => 0),
      prisma.invoice.count().catch(() => 0),
      prisma.surveyResponse.count({ where: { status: 'pending' } }).catch(() => 0),
      prisma.paymentPromise.count({ where: { status: 'pending' } }).catch(() => 0),
      prisma.activity.count().catch(() => 0),
    ]),
    prisma.activity.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }).catch(() => []),
  ]);

  let mikrotik = {
    connected: !!mtConn?.connected,
    configured: !!(MT_HOST && MT_USER && MT_PASS),
    lastError: mtLastError,
    captiveRules: null,
    error: null,
  };
  if (MT_HOST && MT_USER && MT_PASS) {
    try {
      const c = await getMtConnection();
      mikrotik = {
        ...mikrotik,
        connected: !!c?.connected,
        captiveRules: await inspectClientBlockCaptiveRules(c),
        error: null,
      };
    } catch (e) {
      mikrotik = { ...mikrotik, connected: false, error: e.message, lastError: mtLastError || e.message };
    }
  }

  return {
    ok: dbOk,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    app: { env: process.env.NODE_ENV || 'development', uptime: process.uptime(), version: '1.0.0' },
    database: { connected: dbOk },
    wisphub: { configured: !!API_KEY },
    whatsapp: { status: waStatus },
    mikrotik,
    counts: {
      clients: counts[0],
      invoices: counts[1],
      pendingSurveys: counts[2],
      pendingPromises: counts[3],
      activityRows: counts[4],
    },
    automations: {
      autoBlock: { enabled: AUTO_BLOCK_ENABLED, lastRun: lastAutoBlockRun },
      paymentWarning: { config: await getPaymentWarningConfig().catch(() => null), lastRun: lastPaymentWarningRun },
      notifications: { enabled: NOTIF_ENABLED, lastRun: lastNotifRun },
      surveyReminder: { lastRun: lastSurveyReminderRun },
    },
    sync: latestSync,
    recentActivity: latestActivity,
  };
}

const WEB_ACTIVITY_POLL_MS = parseInt(process.env.WEB_ACTIVITY_POLL_MS || '60000');
const WEB_ACTIVITY_KEEP_DAYS = parseInt(process.env.WEB_ACTIVITY_KEEP_DAYS || '30');
let webActivityTimer = null;
let lastDnsLogTime = null;

// Enable DNS logging en MikroTik si no esta activo (idempotente)
async function ensureDnsLogging() {
  try {
    const c = await getMtConnection();
    const rules = await c.write('/system/logging/print');
    const dnsMemRule = rules.find((r) => r.topics === 'dns' && r.action === 'memory');
    if (dnsMemRule && dnsMemRule.disabled === 'true') {
      await c.write('/system/logging/set', `=.id=${dnsMemRule['.id']}`, '=disabled=no');
      console.log('[web-activity] DNS logging enabled on MikroTik');
    } else if (!dnsMemRule) {
      await c.write('/system/logging/add', '=topics=dns', '=action=memory');
      console.log('[web-activity] DNS logging rule created on MikroTik');
    }
  } catch (e) {
    console.error('[web-activity] could not enable DNS logging:', e.message);
  }
}

// Cache IP → idServicio (refrescado del clientes-cache cada poll)
let ipToClientCache = new Map();
async function refreshIpCache() {
  const clients = await prisma.client.findMany({
    where: { ip: { not: null } },
    select: { idServicio: true, ip: true },
  });
  const m = new Map();
  for (const c of clients) if (c.ip) m.set(c.ip, c.idServicio);
  ipToClientCache = m;
}

function todayYmd() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// Parse DNS log entry: extract source IP and queried domain
// Formato MikroTik DNS: "192.168.16.22:54321/UDP query from server: name=youtube.com (A)"
function parseDnsLogEntry(message) {
  if (!message) return null;
  // Buscar IP src (cualquier IP privada 192.168/10/172.16-31)
  const ipMatch = message.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  if (!ipMatch) return null;
  const ip = ipMatch[1];

  // Buscar dominio (varias variantes posibles)
  // "name=foo.bar.com" o "query: foo.bar.com" o "for foo.bar.com"
  const domainMatch = message.match(/(?:name|query|for)[\s=:]+([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/i);
  if (!domainMatch) return null;
  let domain = domainMatch[1].toLowerCase();
  // Quitar trailing punto si lo trae (FQDN)
  if (domain.endsWith('.')) domain = domain.slice(0, -1);
  return { ip, domain };
}

async function pollDnsLog() {
  try {
    const c = await getMtConnection();
    const entries = await c.write('/log/print', '?topics~dns');

    // Refrescar cache de IPs (rapido)
    await refreshIpCache();

    const day = todayYmd();
    const aggregates = new Map(); // key: idServicio:domain → count

    for (const e of entries) {
      const time = e.time || '';
      // Skip entries we've already processed (best-effort dedup por timestamp)
      if (lastDnsLogTime && time <= lastDnsLogTime) continue;

      const parsed = parseDnsLogEntry(e.message || '');
      if (!parsed) continue;

      const idServicio = ipToClientCache.get(parsed.ip);
      if (!idServicio) continue;

      const key = `${idServicio}|${parsed.domain}`;
      aggregates.set(key, (aggregates.get(key) || 0) + 1);
    }

    if (entries.length > 0) lastDnsLogTime = entries[entries.length - 1].time;

    // Bulk upsert
    let upserted = 0;
    for (const [key, count] of aggregates) {
      const [idStr, domain] = key.split('|');
      const idServicio = parseInt(idStr);
      try {
        await prisma.webActivity.upsert({
          where: { idServicio_domain_day: { idServicio, domain, day } },
          update: {
            queryCount: { increment: count },
            lastSeenAt: new Date(),
          },
          create: {
            idServicio,
            domain,
            day,
            queryCount: count,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
          },
        });
        upserted += 1;
      } catch (e) {
        // ignore unique violations on race
      }
    }

    if (upserted > 0) {
      console.log(`[web-activity] tick: ${aggregates.size} domain-aggs from ${entries.length} log entries`);
    }
  } catch (e) {
    console.error('[web-activity] poll error:', e.message);
  }
}

async function purgeOldWebActivity() {
  try {
    const cutoff = new Date(Date.now() - WEB_ACTIVITY_KEEP_DAYS * 24 * 60 * 60 * 1000);
    const cutoffYmd = cutoff.toISOString().slice(0, 10);
    const result = await prisma.webActivity.deleteMany({
      where: { day: { lt: cutoffYmd } },
    });
    if (result.count > 0) {
      console.log(`[web-activity] purged ${result.count} rows older than ${cutoffYmd}`);
    }
  } catch (e) {
    console.error('[web-activity] purge error:', e.message);
  }
}

function startWebActivityLoop() {
  if (webActivityTimer) return;
  console.log(`[web-activity] starting. poll=${WEB_ACTIVITY_POLL_MS}ms, keep=${WEB_ACTIVITY_KEEP_DAYS} days`);
  ensureDnsLogging().catch(() => {});
  pollDnsLog().catch(() => {});
  webActivityTimer = setInterval(() => {
    pollDnsLog().catch(() => {});
  }, WEB_ACTIVITY_POLL_MS);
  // Purge once per day
  setInterval(() => {
    purgeOldWebActivity().catch(() => {});
  }, 24 * 60 * 60 * 1000);
  purgeOldWebActivity().catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
// MÉTRICAS DE CLIENTE (Credit Score + Consumption Tier)
// Recompute automático cada METRICS_INTERVAL_MS (default 2 min)
// ═══════════════════════════════════════════════════════════════

const METRICS_INTERVAL_MS = parseInt(process.env.METRICS_INTERVAL_MS || '120000');
let metricsTimer = null;

function tierFromScore(score) {
  if (score >= 90) return 'EXCELENTE';
  if (score >= 75) return 'BUENO';
  if (score >= 60) return 'REGULAR';
  if (score >= 40) return 'RIESGO';
  return 'CRITICO';
}

// Tiers basados en GB consumidos en 30d (más realista que % vs teórico)
function consumptionTierFromGb(gb) {
  if (gb === null || gb === undefined || gb === 0) return 'INACTIVO';
  if (gb >= 200) return 'INTENSIVO';   // >200 GB/mes → streamer/familia grande
  if (gb >= 50) return 'NORMAL';        // 50-200 GB/mes → uso típico residencial
  return 'BAJO';                         // <50 GB/mes → solo redes/email
}

// Calcula score y consumption para un cliente
function computeClientMetrics(client, blockEventCount, queueBytes30d) {
  const factors = [];
  let score = 100;

  // Estado de facturas Wisphub
  const ef = (client.estadoFacturas || '').toLowerCase();
  if (ef.includes('endiente')) {
    score -= 30;
    factors.push({ key: 'factura_pendiente', impact: -30 });
  } else if (ef.includes('encida') || ef.includes('tras')) {
    score -= 35;
    factors.push({ key: 'factura_vencida', impact: -35 });
  } else if (ef.includes('agad')) {
    score += 5;
    factors.push({ key: 'al_dia', impact: +5 });
  }

  // CRM action
  if (client.crmAction === 'block') {
    score -= 25;
    factors.push({ key: 'bloqueado_admin', impact: -25 });
  } else if (client.crmAction === 'moroso') {
    score -= 12;
    factors.push({ key: 'marcado_moroso', impact: -12 });
  }

  // Estado servicio Wisphub
  const est = (client.estado || '').toLowerCase();
  if (est === 'suspendido' || est === 'cortado') {
    score -= 20;
    factors.push({ key: 'servicio_suspendido', impact: -20 });
  } else if (est === 'retirado') {
    score -= 50;
    factors.push({ key: 'cliente_retirado', impact: -50 });
  } else if (est === 'activo') {
    score += 5;
    factors.push({ key: 'servicio_activo', impact: +5 });
  }

  // Saldo deudor
  const saldo = parseFloat(String(client.saldo || '0').replace(/[^\d.-]/g, '')) || 0;
  if (saldo > 0) {
    const planPrice = parseFloat(String(client.precioPlan || '0').replace(/[^\d.-]/g, '')) || 0;
    if (planPrice > 0) {
      const monthsOwed = saldo / planPrice;
      const penalty = Math.min(20, Math.floor(monthsOwed * 8));
      score -= penalty;
      factors.push({ key: `saldo_${monthsOwed.toFixed(1)}_meses`, impact: -penalty });
    } else {
      score -= 5;
      factors.push({ key: 'saldo_pendiente', impact: -5 });
    }
  }

  // Historial de bloqueos
  if (blockEventCount > 0) {
    const penalty = Math.min(25, blockEventCount * 4);
    score -= penalty;
    factors.push({ key: `${blockEventCount}_bloqueos_historicos`, impact: -penalty });
  }

  // Cap 0-100
  score = Math.max(0, Math.min(100, score));

  // Consumption tier basado en GB acumulados últimos 30 días
  let consumptionMb30d = null;
  let consumptionPct = null;
  let consumptionGb = 0;
  if (queueBytes30d !== null && queueBytes30d !== undefined) {
    consumptionMb30d = Math.round(queueBytes30d / (1024 * 1024) * 10) / 10;
    consumptionGb = consumptionMb30d / 1024;
    // Para la barra: usamos un máximo razonable de 500 GB para escala visual
    consumptionPct = Math.round(Math.min(100, (consumptionGb / 500) * 100) * 10) / 10;
  }

  return {
    creditScore: score,
    creditTier: tierFromScore(score),
    creditFactors: JSON.stringify(factors),
    consumptionMb30d,
    consumptionPct,
    consumptionTier: consumptionTierFromGb(consumptionGb),
    metricsUpdatedAt: new Date(),
  };
}

async function recomputeAllMetrics() {
  const startedAt = Date.now();
  let updated = 0;
  try {
    const clients = await prisma.client.findMany({
      select: {
        idServicio: true, estadoFacturas: true, estado: true, saldo: true,
        precioPlan: true, crmAction: true, mtQueueName: true, mtQueueLimit: true, ip: true,
      },
    });

    // Bloqueos por cliente (eficiente)
    const blockGroups = await prisma.blockEvent.groupBy({
      by: ['idServicio'],
      where: { action: { in: ['moroso', 'block'] } },
      _count: { _all: true },
    });
    const blockMap = new Map();
    blockGroups.forEach((g) => blockMap.set(g.idServicio, g._count._all));

    // Bytes consumidos: leer de queues MikroTik si está disponible
    let queueBytesMap = new Map();
    try {
      const c = await getMtConnection();
      const queues = await c.write('/queue/simple/print');
      for (const q of queues) {
        const ip = (q.target || '').split('/')[0];
        const bytes = (q.bytes || '0/0').split('/');
        const totalBytes = (parseInt(bytes[0]) || 0) + (parseInt(bytes[1]) || 0);
        if (ip) queueBytesMap.set(ip, totalBytes);
      }
    } catch (e) {
      // Sin MikroTik: solo calcula score crediticio, no consumption
    }

    for (const cl of clients) {
      const blockCount = blockMap.get(cl.idServicio) || 0;
      const bytes30d = cl.ip ? queueBytesMap.get(cl.ip) ?? null : null;
      const metrics = computeClientMetrics(cl, blockCount, bytes30d);
      try {
        await prisma.client.update({
          where: { idServicio: cl.idServicio },
          data: metrics,
        });
        updated++;
      } catch {}
    }
    console.log(`[metrics] tick: ${updated}/${clients.length} clients updated in ${Date.now() - startedAt}ms`);
  } catch (e) {
    console.error('[metrics] error:', e.message);
  }
}

function startMetricsLoop() {
  if (metricsTimer) return;
  console.log(`[metrics] starting. interval=${METRICS_INTERVAL_MS}ms`);
  setTimeout(() => { recomputeAllMetrics().catch(() => {}); }, 5000);
  metricsTimer = setInterval(() => {
    recomputeAllMetrics().catch(() => {});
  }, METRICS_INTERVAL_MS);
}

// API: get metrics breakdown (metricsRouter ya esta declarado arriba)
metricsRouter.get('/:id', asyncHandler(async (req, res) => {
  const c = await prisma.client.findUnique({
    where: { idServicio: parseInt(req.params.id) },
    select: {
      idServicio: true, nombre: true,
      creditScore: true, creditTier: true, creditFactors: true,
      consumptionMb30d: true, consumptionPct: true, consumptionTier: true,
      metricsUpdatedAt: true,
    },
  });
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  let factors = [];
  try { factors = c.creditFactors ? JSON.parse(c.creditFactors) : []; } catch {}
  res.json({ ...c, creditFactors: factors });
}));

metricsRouter.get('/', asyncHandler(async (req, res) => {
  // Resumen global por tier
  const all = await prisma.client.findMany({
    where: { creditTier: { not: null } },
    select: { creditTier: true, consumptionTier: true },
  });
  const byCreditTier = {};
  const byConsumption = {};
  for (const c of all) {
    if (c.creditTier) byCreditTier[c.creditTier] = (byCreditTier[c.creditTier] || 0) + 1;
    if (c.consumptionTier) byConsumption[c.consumptionTier] = (byConsumption[c.consumptionTier] || 0) + 1;
  }
  res.json({ total: all.length, byCreditTier, byConsumption });
}));

metricsRouter.post('/recompute', requireRole(['admin']), asyncHandler(async (req, res) => {
  recomputeAllMetrics().catch(() => {});
  res.json({ status: 'recompute started' });
}));

// Listado masivo: para colorear todos los clientes en tabla con su tier
metricsRouter.get('/all/list', asyncHandler(async (req, res) => {
  const rows = await prisma.client.findMany({
    where: { creditTier: { not: null } },
    select: {
      idServicio: true,
      creditScore: true,
      creditTier: true,
      consumptionTier: true,
      consumptionMb30d: true,
      metricsUpdatedAt: true,
    },
  });
  res.json(rows);
}));

// ═══════════════════════════════════════════════════════════════
// AUTO-BLOQUEO POR MORA (basado en estado_facturas + fecha_corte de Wisphub)
// ═══════════════════════════════════════════════════════════════

const AUTO_BLOCK_ENABLED = process.env.AUTO_BLOCK_ENABLED === 'true';
const AUTO_BLOCK_MOROSO_DAYS = parseInt(process.env.AUTO_BLOCK_MOROSO_DAYS || '0'); // marca moroso si ya vencio
const AUTO_BLOCK_HARD_DAYS = parseInt(process.env.AUTO_BLOCK_HARD_DAYS || '7'); // bloquea totalmente si vencio +N dias
const AUTO_BLOCK_RUN_HOUR = parseInt(process.env.AUTO_BLOCK_RUN_HOUR || '9'); // hora local (24h) para correr el cron
let autoBlockTimer = null;
let lastAutoBlockRun = null;

function parseFechaCorte(fechaStr) {
  if (!fechaStr) return null;
  // Wisphub format: "06/06/2026" (DD/MM/YYYY) o "6/06/2026" o ISO
  const m = fechaStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [_, d, mo, y] = m;
    return new Date(parseInt(y), parseInt(mo) - 1, parseInt(d));
  }
  const dt = new Date(fechaStr);
  return isNaN(dt.getTime()) ? null : dt;
}

function daysOverdue(fechaCorte) {
  if (!fechaCorte) return null;
  const ms = Date.now() - fechaCorte.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

async function runAutoBlockCheck() {
  if (!AUTO_BLOCK_ENABLED) return { ran: false, reason: 'AUTO_BLOCK_ENABLED=false' };

  const startedAt = new Date();
  const candidates = await prisma.client.findMany({
    where: {
      ip: { not: null },
      // Solo clientes que Wisphub marca pendiente/vencido
      OR: [
        { estadoFacturas: { contains: 'endiente' } }, // "Pendiente"
        { estadoFacturas: { contains: 'encida' } },   // "Vencidas"
        { estadoFacturas: { contains: 'tras' } },     // "Atrasadas"
      ],
    },
    select: {
      idServicio: true, nombre: true, ip: true,
      estado: true, estadoFacturas: true, fechaCorte: true,
      crmAction: true,
    },
  });

  let toMoroso = 0;
  let toBlock = 0;
  let skipped = 0;
  const actions = [];

  for (const cl of candidates) {
    // Si el admin ya marco manualmente, no tocar
    if (cl.crmAction === 'block') { skipped++; continue; }

    const fechaCorte = parseFechaCorte(cl.fechaCorte);
    const overdueDays = daysOverdue(fechaCorte);
    if (overdueDays === null || overdueDays < 0) { skipped++; continue; }

    let action = null;
    if (overdueDays >= AUTO_BLOCK_HARD_DAYS && cl.crmAction !== 'block') {
      action = 'block';
      toBlock++;
    } else if (overdueDays >= AUTO_BLOCK_MOROSO_DAYS && !cl.crmAction) {
      action = 'moroso';
      toMoroso++;
    }

    if (!action) continue;

    try {
      const reason = `Auto: ${overdueDays} dias vencido (factura ${cl.estadoFacturas || 'pendiente'})`;
      const result = await applyClientAction(cl.idServicio, action, reason, { username: 'auto-block' });
      actions.push({ id: cl.idServicio, name: cl.nombre, ip: cl.ip, action, overdueDays, ok: result.ok });
    } catch (e) {
      actions.push({ id: cl.idServicio, name: cl.nombre, ip: cl.ip, action, overdueDays, error: e.message });
    }
  }

  const result = {
    ran: true,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    candidates: candidates.length,
    toMoroso,
    toBlock,
    skipped,
    actions,
  };
  lastAutoBlockRun = result;
  console.log(`[auto-block] tick: candidates=${candidates.length} →moroso=${toMoroso} →block=${toBlock} skipped=${skipped}`);
  return result;
}

// Tick cada hora; corre check si es la hora configurada y aun no corrio hoy
function startAutoBlockLoop() {
  if (autoBlockTimer) return;
  if (!AUTO_BLOCK_ENABLED) {
    console.log('[auto-block] disabled (set AUTO_BLOCK_ENABLED=true to enable)');
    return;
  }
  console.log(`[auto-block] enabled. moroso>=${AUTO_BLOCK_MOROSO_DAYS}d, block>=${AUTO_BLOCK_HARD_DAYS}d, runHour=${AUTO_BLOCK_RUN_HOUR}`);

  let lastCheckDay = null;
  autoBlockTimer = setInterval(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() === AUTO_BLOCK_RUN_HOUR && lastCheckDay !== today) {
      lastCheckDay = today;
      runAutoBlockCheck().catch((e) => console.error('[auto-block] error:', e.message));
    }
  }, 60 * 60 * 1000); // cada hora
}

// API endpoints (autoBlockRouter ya esta declarado arriba)
autoBlockRouter.get('/status', (req, res) => {
  res.json({
    enabled: AUTO_BLOCK_ENABLED,
    morosoDays: AUTO_BLOCK_MOROSO_DAYS,
    hardBlockDays: AUTO_BLOCK_HARD_DAYS,
    runHour: AUTO_BLOCK_RUN_HOUR,
    lastRun: lastAutoBlockRun,
  });
});

// Run on demand (admin trigger)
autoBlockRouter.post('/run', asyncHandler(async (req, res) => {
  const result = await runAutoBlockCheck();
  res.json(result);
}));

// Preview: dry-run, ver candidates sin aplicar nada
autoBlockRouter.get('/preview', asyncHandler(async (req, res) => {
  const candidates = await prisma.client.findMany({
    where: {
      ip: { not: null },
      OR: [
        { estadoFacturas: { contains: 'endiente' } },
        { estadoFacturas: { contains: 'encida' } },
        { estadoFacturas: { contains: 'tras' } },
      ],
    },
    select: { idServicio: true, nombre: true, ip: true, estadoFacturas: true, fechaCorte: true, crmAction: true },
  });
  const preview = candidates.map((cl) => {
    const fechaCorte = parseFechaCorte(cl.fechaCorte);
    const overdueDays = daysOverdue(fechaCorte);
    let wouldDo = null;
    if (overdueDays !== null && overdueDays >= 0) {
      if (overdueDays >= AUTO_BLOCK_HARD_DAYS && cl.crmAction !== 'block') wouldDo = 'block';
      else if (overdueDays >= AUTO_BLOCK_MOROSO_DAYS && !cl.crmAction) wouldDo = 'moroso';
    }
    return { ...cl, overdueDays, wouldDo };
  }).filter((c) => c.wouldDo);
  res.json({
    enabled: AUTO_BLOCK_ENABLED,
    morosoDays: AUTO_BLOCK_MOROSO_DAYS,
    hardBlockDays: AUTO_BLOCK_HARD_DAYS,
    candidates: preview,
  });
}));

// ═══════════════════════════════════════════════════════════════
// NOTIFICACIONES WHATSAPP AUTOMATICAS (recordatorios T-3, T-1, T+0, T+5)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// AVISO HTML AUTOMATICO DE PAGO (moroso suave por factura > N dias)
// ═══════════════════════════════════════════════════════════════════════════════

const PAYMENT_WARNING_PREFIX = 'Aviso pago automatico:';
const PAYMENT_WARNING_DEFAULTS = {
  paymentWarningEnabled: 'false',
  paymentWarningOverdueDays: '15',
  paymentWarningRunHour: '9',
  paymentWarningMode: 'moroso',
};
let paymentWarningTimer = null;
let lastPaymentWarningRun = null;

async function getSettingsMap(keys = []) {
  const rows = await prisma.appSetting.findMany(keys.length ? { where: { key: { in: keys } } } : {});
  const map = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

async function setSettingsMap(values, category = 'payment-warning') {
  const updates = Object.entries(values).map(([key, value]) => prisma.appSetting.upsert({
    where: { key },
    update: { value: String(value), category },
    create: { key, value: String(value), category },
  }));
  await Promise.all(updates);
}

async function getPaymentWarningConfig() {
  const keys = Object.keys(PAYMENT_WARNING_DEFAULTS);
  const raw = { ...PAYMENT_WARNING_DEFAULTS, ...(await getSettingsMap(keys)) };
  return {
    enabled: raw.paymentWarningEnabled === 'true',
    overdueDays: Math.max(1, parseInt(raw.paymentWarningOverdueDays || '15') || 15),
    runHour: Math.max(0, Math.min(23, parseInt(raw.paymentWarningRunHour || '9') || 9)),
    mode: 'moroso',
  };
}

async function buildPaymentWarningCandidates(config) {
  const clients = await prisma.client.findMany({
    where: {
      ip: { not: null },
      OR: [
        { estadoFacturas: { contains: 'endiente' } },
        { estadoFacturas: { contains: 'encida' } },
        { estadoFacturas: { contains: 'tras' } },
      ],
    },
    select: {
      idServicio: true,
      nombre: true,
      ip: true,
      estado: true,
      estadoFacturas: true,
      fechaCorte: true,
      precioPlan: true,
      saldo: true,
      crmAction: true,
      crmActionReason: true,
    },
  });

  const candidates = [];
  for (const cl of clients) {
    const invoice = await findLatestPendingInvoiceForClient(cl.idServicio);
    const dueDate = parseFechaCorte(invoice?.fechaVencimiento || cl.fechaCorte || '');
    const overdueDays = daysOverdue(dueDate);
    if (overdueDays === null || overdueDays < config.overdueDays) continue;
    candidates.push({
      idServicio: cl.idServicio,
      nombre: cl.nombre,
      ip: cl.ip,
      estado: cl.estado,
      estadoFacturas: cl.estadoFacturas,
      fechaCorte: cl.fechaCorte,
      overdueDays,
      crmAction: cl.crmAction,
      crmActionReason: cl.crmActionReason,
      invoice: invoice ? {
        idFactura: invoice.idFactura,
        folio: invoice.folio,
        estado: invoice.estado,
        fechaVencimiento: invoice.fechaVencimiento,
        total: invoice.total,
        saldo: invoice.saldo,
      } : null,
      amountDue: formatDop(invoice?.saldo || cl.saldo || cl.precioPlan),
      wouldDo: cl.crmAction === 'block' ? 'skip_blocked' : cl.crmAction === 'moroso' ? 'already_moroso' : 'moroso',
    });
  }
  return candidates;
}

async function cleanupResolvedPaymentWarnings(currentCandidateIds) {
  const autoMorosos = await prisma.client.findMany({
    where: {
      crmAction: 'moroso',
      crmActionReason: { startsWith: PAYMENT_WARNING_PREFIX },
      ip: { not: null },
    },
    select: { idServicio: true, nombre: true, ip: true },
  });
  const cleared = [];
  for (const cl of autoMorosos) {
    if (currentCandidateIds.has(cl.idServicio)) continue;
    const result = await applyClientAction(cl.idServicio, 'clear', 'Auto: factura regularizada o sin mora vigente', { username: 'system' });
    cleared.push({ idServicio: cl.idServicio, nombre: cl.nombre, ip: cl.ip, ok: result.ok });
  }
  return cleared;
}

async function reconcileResolvedPaymentWarnings() {
  const config = await getPaymentWarningConfig().catch(() => ({
    enabled: false,
    overdueDays: parseInt(PAYMENT_WARNING_DEFAULTS.paymentWarningOverdueDays, 10),
    runHour: parseInt(PAYMENT_WARNING_DEFAULTS.paymentWarningRunHour, 10),
    mode: 'moroso',
  }));
  const candidates = await buildPaymentWarningCandidates(config);
  return cleanupResolvedPaymentWarnings(new Set(candidates.map((c) => c.idServicio)));
}

async function runPaymentWarningCheck({ manual = false, ignoreEnabled = false } = {}) {
  const config = await getPaymentWarningConfig();
  if (!config.enabled && !ignoreEnabled) {
    return { ran: false, reason: 'paymentWarningEnabled=false', config };
  }

  const startedAt = new Date();
  const candidates = await buildPaymentWarningCandidates(config);
  const currentCandidateIds = new Set(candidates.map((c) => c.idServicio));
  const actions = [];
  let applied = 0;
  let alreadyMoroso = 0;
  let skippedBlocked = 0;

  for (const item of candidates) {
    if (item.wouldDo === 'skip_blocked') {
      skippedBlocked++;
      actions.push({ ...item, ok: false, skipped: true, reason: 'already_blocked' });
      continue;
    }
    if (item.wouldDo === 'already_moroso') {
      alreadyMoroso++;
      actions.push({ ...item, ok: true, skipped: true, reason: 'already_moroso' });
      continue;
    }
    const invoiceLabel = item.invoice?.folio || item.invoice?.idFactura || 'sin numero';
    const reason = `${PAYMENT_WARNING_PREFIX} ${item.overdueDays} dias vencido (factura ${invoiceLabel}, ${item.amountDue || 'saldo pendiente'})`;
    const result = await applyClientAction(item.idServicio, 'moroso', reason, { username: manual ? 'manual-run' : 'system' });
    if (result.ok) applied++;
    actions.push({ ...item, ok: result.ok, error: result.error || null });
  }

  const clearedRows = await cleanupResolvedPaymentWarnings(currentCandidateIds);
  const result = {
    ran: true,
    manual,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    config,
    candidates: candidates.length,
    applied,
    alreadyMoroso,
    skippedBlocked,
    cleared: clearedRows.length,
    clearedRows,
    actions,
  };
  lastPaymentWarningRun = result;
  console.log(`[payment-warning] tick: candidates=${candidates.length} applied=${applied} already=${alreadyMoroso} cleared=${clearedRows.length}`);
  return result;
}

paymentWarningRouter.get('/status', requireAnyRole(['cobranza']), asyncHandler(async (req, res) => {
  res.json({ ok: true, config: await getPaymentWarningConfig(), lastRun: lastPaymentWarningRun });
}));

paymentWarningRouter.put('/settings', requireRole(['admin']), asyncHandler(async (req, res) => {
  const data = {};
  if (req.body?.enabled !== undefined) data.paymentWarningEnabled = req.body.enabled === true ? 'true' : 'false';
  if (req.body?.overdueDays !== undefined) data.paymentWarningOverdueDays = Math.max(1, parseInt(req.body.overdueDays) || 15);
  if (req.body?.runHour !== undefined) data.paymentWarningRunHour = Math.max(0, Math.min(23, parseInt(req.body.runHour) || 9));
  data.paymentWarningMode = 'moroso';
  await setSettingsMap(data);
  const config = await getPaymentWarningConfig();
  await logActivity(req, {
    action: 'payment_warning_settings_updated',
    entityType: 'setting',
    entityName: 'payment-warning',
    details: { config },
  });
  res.json({ ok: true, config });
}));

paymentWarningRouter.get('/preview', requireAnyRole(['cobranza']), asyncHandler(async (req, res) => {
  const config = await getPaymentWarningConfig();
  const candidates = await buildPaymentWarningCandidates(config);
  res.json({ ok: true, config, count: candidates.length, candidates });
}));

paymentWarningRouter.post('/run', requireAnyRole(['cobranza']), asyncHandler(async (req, res) => {
  const result = await runPaymentWarningCheck({ manual: true });
  await logActivity(req, {
    action: 'payment_warning_run',
    entityType: 'automation',
    entityName: 'payment-warning',
    details: { ran: result.ran, candidates: result.candidates || 0, applied: result.applied || 0, cleared: result.cleared || 0 },
  });
  res.json(result);
}));

function startPaymentWarningLoop() {
  if (paymentWarningTimer) return;
  console.log('[payment-warning] scheduler ready');
  let lastCheckDay = null;
  paymentWarningTimer = setInterval(async () => {
    const config = await getPaymentWarningConfig().catch(() => null);
    if (!config?.enabled) return;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() === config.runHour && lastCheckDay !== today) {
      lastCheckDay = today;
      runPaymentWarningCheck().catch((e) => console.error('[payment-warning] error:', e.message));
    }
  }, 60 * 60 * 1000);
}

const NOTIF_ENABLED = process.env.NOTIF_ENABLED === 'true';
const NOTIF_RUN_HOUR = parseInt(process.env.NOTIF_RUN_HOUR || '10');
let notifTimer = null;
let lastNotifRun = null;

// NOTIF_TEMPLATES ahora se cargan de DB via WhatsappTemplate (editables)
// Templates usados: reminder_t-3, reminder_t-1, due_today, overdue_t3, overdue_t7

function isSameDay(a, b) {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

async function alreadyNotifiedToday(idServicio, type) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const sent = await prisma.whatsappLog.findFirst({
    where: {
      idServicio,
      messageType: type,
      status: 'sent',
      createdAt: { gte: todayStart },
    },
  });
  return !!sent;
}

async function sendWhatsappNotification(idServicio, phone, message, type, clientName) {
  const sent = await sendWhatsappRaw(phone, message);
  await prisma.whatsappLog.create({
    data: {
      phone, message, idServicio, clientName, messageType: type,
      status: sent.ok ? 'sent' : 'failed',
      errorMessage: sent.ok ? null : (sent.error || 'unknown'),
    },
  }).catch(() => {});
  return sent;
}

async function runNotifCheck() {
  if (!NOTIF_ENABLED) return { ran: false, reason: 'NOTIF_ENABLED=false' };
  if (waStatus !== 'connected') return { ran: false, reason: `WhatsApp ${waStatus}` };

  const startedAt = new Date();
  const all = await prisma.client.findMany({
    where: {
      telefono: { not: null },
      fechaCorte: { not: null },
      OR: [
        { estado: 'Activo' },
        { estado: 'Suspendido' },
      ],
    },
    select: {
      idServicio: true, nombre: true, telefono: true,
      precioPlan: true, planInternetName: true,
      estado: true, estadoFacturas: true, fechaCorte: true,
    },
  });

  const now = new Date();
  const stats = { sent: 0, skipped: 0, errors: 0, total: all.length };

  for (const cl of all) {
    if (!cl.telefono || cl.telefono.length < 7) { stats.skipped++; continue; }
    const fechaCorte = parseFechaCorte(cl.fechaCorte);
    if (!fechaCorte) { stats.skipped++; continue; }

    const overdue = daysOverdue(fechaCorte);
    let type = null, message = null;

    if (overdue === -3) {
      type = 'reminder_t-3';
    } else if (overdue === -1) {
      type = 'reminder_t-1';
    } else if (overdue === 0) {
      type = 'due_today';
    } else if (overdue === 3) {
      type = 'overdue_t3';
    } else if (overdue === 7) {
      type = 'overdue_t7';
    }

    if (type) {
      message = await renderClientTemplate(type, cl, null, { dias: Math.abs(overdue) });
    }

    if (!type || !message) { stats.skipped++; continue; }
    if (await alreadyNotifiedToday(cl.idServicio, type)) { stats.skipped++; continue; }

    const r = await sendWhatsappNotification(cl.idServicio, cl.telefono, message, type, cl.nombre);
    if (r.ok) stats.sent++;
    else stats.errors++;

    // Throttle 2s entre mensajes
    await new Promise((r) => setTimeout(r, 2000));
  }

  const result = { ran: true, startedAt: startedAt.toISOString(), durationMs: Date.now() - startedAt.getTime(), ...stats };
  lastNotifRun = result;
  console.log(`[notif] tick: sent=${stats.sent} skipped=${stats.skipped} errors=${stats.errors}`);
  return result;
}

function startNotifLoop() {
  if (notifTimer) return;
  if (!NOTIF_ENABLED) {
    console.log('[notif] disabled (set NOTIF_ENABLED=true to enable)');
    return;
  }
  console.log(`[notif] enabled. runHour=${NOTIF_RUN_HOUR}`);
  let lastDay = null;
  notifTimer = setInterval(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() === NOTIF_RUN_HOUR && lastDay !== today && waStatus === 'connected') {
      lastDay = today;
      runNotifCheck().catch((e) => console.error('[notif] error:', e.message));
    }
  }, 60 * 60 * 1000);
}

// notifRouter ya esta declarado arriba
notifRouter.get('/status', (req, res) => {
  res.json({
    enabled: NOTIF_ENABLED,
    runHour: NOTIF_RUN_HOUR,
    whatsapp: waStatus,
    lastRun: lastNotifRun,
  });
});
notifRouter.post('/run', asyncHandler(async (req, res) => {
  const result = await runNotifCheck();
  res.json(result);
}));

// ─── AUTO-DETECT IP PUBLICA + UPDATE NAT/FILTER EN MIKROTIK ───
// Cuando corre en Railway, la IP de salida puede cambiar. Al boot detecta su IP
// publica y reescribe las reglas NAT del MikroTik para que el captive funcione.
async function runSurveyReminderCheck() {
  const startedAt = new Date();
  const due = await prisma.surveyResponse.findMany({
    where: {
      status: 'pending',
      nextReminderAt: { lte: startedAt },
    },
    orderBy: { nextReminderAt: 'asc' },
    take: 50,
  });

  const stats = { total: due.length, sent: 0, skipped: 0, errors: 0 };
  for (const row of due) {
    const result = await sendSurveyReminderById(row.id).catch((e) => ({ ok: false, error: e.message }));
    if (result.ok) stats.sent++;
    else if (result.skipped) stats.skipped++;
    else stats.errors++;
    await new Promise((r) => setTimeout(r, 2000));
  }

  lastSurveyReminderRun = {
    ran: true,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    ...stats,
  };
  if (stats.total > 0) {
    console.log(`[survey-reminder] tick: sent=${stats.sent} skipped=${stats.skipped} errors=${stats.errors}`);
  }
  return lastSurveyReminderRun;
}

function startSurveyReminderLoop() {
  if (surveyReminderTimer) return;
  console.log(`[survey-reminder] enabled. interval=${SURVEY_REMINDER_INTERVAL_HOURS}h poll=${SURVEY_REMINDER_POLL_MS}ms`);
  surveyReminderTimer = setInterval(() => {
    runSurveyReminderCheck().catch((e) => console.error('[survey-reminder] error:', e.message));
  }, SURVEY_REMINDER_POLL_MS);
}

surveyRouter.get('/reminders/status', (req, res) => {
  res.json({
    ok: true,
    intervalHours: SURVEY_REMINDER_INTERVAL_HOURS,
    pollMs: SURVEY_REMINDER_POLL_MS,
    whatsapp: waStatus,
    lastRun: lastSurveyReminderRun,
  });
});

surveyRouter.post('/reminders/run', asyncHandler(async (req, res) => {
  const result = await runSurveyReminderCheck();
  res.json(result);
}));

async function autoConfigureCaptive() {
  if (process.env.CAPTIVE_AUTOCONFIG !== 'true') return;
  if (!MT_HOST) return;
  try {
    const c = await getMtConnection();
    const rules = await ensureClientBlockCaptiveRules(c);
    console.log(`[captive] rules ready: ${rules.target.host} -> ${rules.target.address}:${rules.target.port}`);
  } catch (e) {
    console.error('[captive] auto-config failed:', e.message);
  }
}

// ─── START SERVER ───
const server = app.listen(PORT, () => {
  console.log('═══════════════════════════════════════');
  console.log(`WISP RD running on port ${PORT}`);
  console.log(`Mode: ${IS_PROD ? 'PRODUCTION' : 'development'}`);
  console.log(`Auth mode: users (PIN auth removed)`);
  console.log(`API key: ${API_KEY ? 'configured' : 'MISSING - set WISPHUB_API_KEY'}`);
  console.log('═══════════════════════════════════════');

  if (API_KEY && process.env.WHATSAPP_AUTOSTART !== 'false') initWhatsApp();
  if (API_KEY && MT_HOST) startSyncLoop();
  if (MT_HOST && process.env.WEB_ACTIVITY_ENABLED !== 'false') startWebActivityLoop();
  if (MT_HOST && API_KEY) startAutoBlockLoop();
  startNotifLoop();
  startPaymentWarningLoop();
  startSurveyReminderLoop();
  startMetricsLoop();
  ensureTemplatesSeeded().catch((e) => console.error('[templates] seed error:', e.message));
  ensureSuperAdmin().catch((e) => console.error('[auth] seed error:', e.message));
  autoConfigureCaptive().catch(() => {});
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[FATAL] Port ${PORT} already in use. Set PORT env to use a different port.`);
    process.exit(1);
  }
  console.error('[server error]', err);
});

// ─── GRACEFUL SHUTDOWN ───
async function shutdown() {
  console.log('\nShutting down gracefully...');
  server.close(async () => {
    await prisma.$disconnect();
    if (waSocket) try { waSocket.end(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (err) => console.error('[CRASH]', err));
process.on('unhandledRejection', (err) => console.error('[REJECT]', err));
