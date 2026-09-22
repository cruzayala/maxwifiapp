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
const {
  inspectPaymentPortalConfiguration,
  isOriginAllowed,
  mapWisphubClient,
  parseAllowedOrigins,
  resolveSqliteDatabasePath,
  sanitizePaymentPilotToggle,
  wisphubTaskState,
} = require('./lib/core-safety');
const {
  buildIpamReport,
  buildSecurityAudit,
  buildUnknownDevices,
  cidrHostRange,
  ipInCidr,
  isValidMac,
  isValidIpv4,
  isRouterId,
  parseClientCidrs,
  queueTargetIp,
  sanitizeNetwatchMutation,
  sanitizeQueueMutation,
  sanitizeRouterFileName,
  sanitizeSpeedTemplate,
} = require('./lib/mikrotik-ops');
const { ZteC320Client, assertOnuIndex, assertOnuName, findInternetSpeedProfile, normalizeGponSerial, normalizeMacAddress, resolveClientMapping, summarizePons } = require('./lib/zte-c320');
const { buildPonHealth, evaluateOpticalSignal } = require('./lib/olt-ops');
const { evaluateAgentAutoAuthorization, selectSpeedProfile } = require('./lib/olt-auto-authorize');
const { buildOltPlanSyncPreview } = require('./lib/olt-plan-sync');
const {
  matchesExistingWisphubClient,
  sanitizeClientProvisioning,
  taskResultError,
} = require('./lib/client-provisioning');
const { externalSnapshot } = require('./lib/mobile-client-external');
const { buildIncidentCandidates, nextRecoveryState, parseAffectedClientIds } = require('./lib/noc-incidents');
const {
  buildClientAuditSample,
  dailyIncrement,
  floorDate,
  parsePingSummary,
  utcDay,
} = require('./lib/network-audit');
const { buildOltAssociationPlan } = require('./lib/olt-association');
const { buildOnuRelocationPlan, buildPendingPonRelocation, selectCanonicalOnuIndexes } = require('./lib/olt-relocation');
const { publicBaseUrlFromEnv, publicHostFromEnv } = require('./lib/deployment-config');
const { buildProvisioningCancellationPreview } = require('./lib/provisioning-cancellation');
const { agentStateUpdate } = require('./lib/provisioning-agent-state');
const { SERVICE_OPERATION_MODES, prepareExistingServiceOperation } = require('./lib/onu-service-operation');
const { MikrotikCommandQueue, isMikrotikMutationCommand } = require('./lib/mikrotik-command-queue');
const { normalizeOnuAgentInventory, summarizeOnuAgentInventory } = require('./lib/onu-agent-inventory');
const {
  decryptSecret,
  encryptSecret,
  normalizeSerial: normalizeTr069Serial,
  safeJson: safeTr069Json,
  selectBestTr069Onu,
  snapshotDto: sanitizeTr069Snapshot,
  taskDto: tr069TaskDto,
  tr069SerialCandidates,
  validateTaskInput: validateTr069TaskInput,
} = require('./lib/tr069-control');
const { actionDefinition: tr069ActionDefinition, profileForDevice: tr069ProfileForDevice } = require('./lib/tr069-catalog');
const {
  matchOnuModelProfile,
  normalizePrefixesJson,
  profileSnapshot,
  sanitizeOnuModelProfile,
  seedOnuModelProfiles,
} = require('./lib/onu-model-profiles');
const {
  DEFAULT_INVOICE_START_DATE,
  buildInvoiceDateWindows,
  fetchWisphubInvoices,
  formatDateOnly,
  mapWisphubInvoice,
  mapWisphubInvoiceArticle,
  mergeInvoicesById,
} = require('./lib/wisphub-invoices');

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
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'local-network=(self), loopback-network=(self), local-network-access=(self)',
  );
  next();
});

const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS, [
  'http://localhost:4200',
  'http://127.0.0.1:4200',
  'http://localhost:7400',
  'http://127.0.0.1:7400',
  publicBaseUrlFromEnv(process.env),
]);

app.use(cors({
  origin: (origin, callback) => callback(null, isOriginAllowed(origin, allowedOrigins)),
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// Algunas paginas de Angular comparten ruta con la API (/users, /expenses...).
// Si el navegador recarga una de ellas debe recibir la app, no el JSON 401 de la API.
const SPA_PAGE_PATHS = /^\/(clients(\/new|\/\d+)?|users|inventory|expenses|payroll|mikrotik)\/?$/;
const SPA_INDEX_HTML = path.join(__dirname, 'dist/wishub-admin/browser/index.html');
app.use((req, res, next) => {
  if (req.method !== 'GET' || !SPA_PAGE_PATHS.test(req.path)) return next();
  if (!String(req.headers.accept || '').includes('text/html')) return next();
  if (!fs.existsSync(SPA_INDEX_HTML)) return next();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(SPA_INDEX_HTML);
});

// Muchas rutas responden { error: e.message }. Si el error viene de Prisma, el mensaje trae
// rutas del servidor y consultas internas: se registra completo y al cliente se le da uno legible.
const PRISMA_ERROR_TEXT = /Invalid `prisma\.|prisma\.\w+\.\w+\(\)` invocation|PrismaClient\w*Error/;
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body.error === 'string' && PRISMA_ERROR_TEXT.test(body.error)) {
      console.error('[db-error]', req.method, req.originalUrl, body.error);
      body = { ...body, error: 'Error interno al consultar la base de datos. Intente de nuevo o contacte al administrador.' };
      delete body.stack;
    }
    return json(body);
  };
  next();
});

// Rate limiting solo en endpoints sensibles
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10, // 10 intentos por 15 min
  message: { error: 'Demasiados intentos, intenta más tarde' },
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
// The native app has independent credentials and explicit role checks.
const { createBillingService, createWisphubBillingAdapter } = require('./lib/billing-service');
const billingService = createBillingService({ prisma, adapter: createWisphubBillingAdapter(API_KEY) });

// Sesiones en DB (sobreviven a redeploys) + cache en memoria para performance
// El cache se invalida solo si expira; renovaciones se hacen en background.
const SESSION_CACHE = new Map(); // token -> { expiresAt, userId, role, username, cachedAt }
const SESSION_CACHE_TTL_MS = 30 * 1000; // re-leer de DB cada 30s para coger cambios

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashDeviceToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function publicUserDto(user) {
  return { id: user.id, username: user.username, fullName: user.fullName || null, role: user.role };
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
    req.path === '/auth/device-sessions/refresh' ||
    req.path === '/auth/device-sessions/revoke' ||
    req.path === '/health' ||
    req.path.startsWith('/captive')
  ) return next();

  const token = req.headers['x-auth-token'];
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
  if (password.length < 6) return res.status(400).json({ error: 'Clave mínimo 6 caracteres' });

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
    if (!validRoles.includes(req.body.role)) return res.status(400).json({ error: 'Rol inválido' });
    data.role = req.body.role;
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, username: true, fullName: true, email: true, role: true, isActive: true },
  }).catch(() => null);
  if (!updated) return res.status(404).json({ error: 'No encontrado' });
  if (data.isActive === false) {
    await prisma.trustedDeviceSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  } else if (data.role) {
    await prisma.trustedDeviceSession.updateMany({ where: { userId: id, revokedAt: null }, data: { role: data.role } });
  }
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
  const { lat, lng, accuracy, client: clientSnapshot = {} } = req.body || {};
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    return res.status(400).json({ error: 'lat/lng invalidos' });
  }
  if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    return res.status(400).json({ error: 'lat/lng fuera de rango' });
  }
  const gpsData = {
    gpsLat: latNum,
    gpsLng: lngNum,
    gpsAccuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
    gpsCapturedAt: new Date(),
    gpsCapturedBy: req.session?.username || 'admin',
  };
  const updated = await prisma.client.upsert({
    where: { idServicio },
    update: gpsData,
    create: {
      idServicio,
      nombre: clientSnapshot.nombre || `Cliente #${idServicio}`,
      telefono: clientSnapshot.telefono || null,
      ip: clientSnapshot.ip || null,
      planInternetName: clientSnapshot.planInternetName || null,
      estado: clientSnapshot.estado || null,
      estadoFacturas: clientSnapshot.estadoFacturas || null,
      zonaNombre: clientSnapshot.zonaNombre || null,
      direccion: clientSnapshot.direccion || null,
      coordenadas: clientSnapshot.coordenadas || null,
      ...gpsData,
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
  const { validatePromise, changePromise } = require('./lib/client-record-service');
  const input = Object.fromEntries(['idServicio', 'amount', 'promisedDate', 'notes'].filter(k => req.body?.[k] !== undefined).map(k => [k, k === 'promisedDate' ? String(req.body[k]).slice(0, 10) : req.body[k]]));
  const p = await prisma.$transaction(tx => changePromise(tx, { data: validatePromise(input), actor: req.session.username }));
  res.json(p);
}));

dbRouter.put('/promises/:id', asyncHandler(async (req, res) => {
  if (!hasAnyRole(req.session, ['cobranza'])) return res.status(403).json({ error: 'Permisos insuficientes' });
  const { validatePromise, changePromise } = require('./lib/client-record-service');
  const input = Object.fromEntries(['amount', 'promisedDate', 'notes', 'status'].filter(k => req.body?.[k] !== undefined).map(k => [k, k === 'promisedDate' ? String(req.body[k]).slice(0, 10) : req.body[k]]));
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Promesa inválida' });
  const p = await prisma.$transaction(tx => changePromise(tx, { id, data: validatePromise(input, true), actor: req.session.username }));
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

// Estado durable del programador de avisos. SQLite evita reenvios aunque cambie
// el navegador o se reinicie la aplicacion.
dbRouter.get('/notification-state', asyncHandler(async (req, res) => {
  const [lastRun, sent] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: 'notifications.lastRunAt' } }),
    prisma.notificationSentLog.findMany({
      where: { sentAt: { gte: new Date(Date.now() - 120 * 86400000) } },
      orderBy: { sentAt: 'desc' },
      take: 20_000,
    }),
  ]);
  res.json({ lastRunAt: lastRun?.value || null, sent });
}));

dbRouter.post('/notification-state/run', asyncHandler(async (req, res) => {
  const value = new Date().toISOString();
  await prisma.appSetting.upsert({
    where: { key: 'notifications.lastRunAt' },
    update: { value },
    create: { key: 'notifications.lastRunAt', value },
  });
  res.json({ lastRunAt: value });
}));

dbRouter.post('/notification-sent', asyncHandler(async (req, res) => {
  const phone = String(req.body?.phone || '').replace(/\D/g, '');
  const type = String(req.body?.type || '').trim().toLowerCase();
  const idServicio = Number(req.body?.idServicio);
  if (phone.length < 7 || !['reminder', 'overdue'].includes(type)) {
    return res.status(400).json({ error: 'phone y type validos son requeridos' });
  }
  const row = await prisma.notificationSentLog.create({
    data: {
      phone,
      type,
      idServicio: Number.isInteger(idServicio) && idServicio > 0 ? idServicio : null,
    },
  });
  res.json(row);
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
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100_000) : 1000;
  const clients = await prisma.client.findMany({
    orderBy: { idServicio: 'desc' },
    take: limit,
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
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100_000) : 1000;
  const invoices = await prisma.invoice.findMany({
    orderBy: { idFactura: 'desc' },
    include: { articles: true },
    take: limit,
  });
  res.json(invoices);
}));

// TICKETS (espejo SQLite, sin reemplazar ni borrar registros anteriores)
dbRouter.get('/tickets', asyncHandler(async (req, res) => {
  const tickets = await prisma.cachedTicket.findMany({ orderBy: { idTicket: 'desc' }, take: 10_000 });
  res.json(tickets.map((ticket) => ({
    id: ticket.remoteId || ticket.idTicket,
    id_ticket: ticket.idTicket,
    asunto: ticket.asunto || '',
    cliente: ticket.cliente || '',
    id_servicio: ticket.idServicio,
    estado: ticket.estado || '',
    prioridad: ticket.prioridad || '',
    fecha_creacion: ticket.fechaCreacion || '',
    fecha_actualizacion: ticket.fechaActualizacion || '',
    asignado: ticket.asignado || '',
    descripcion: ticket.descripcion || '',
  })));
}));

dbRouter.post('/tickets/sync', asyncHandler(async (req, res) => {
  if (!hasAnyRole(req.session, ['tecnico'])) return res.status(403).json({ error: 'Permisos insuficientes' });
  const tickets = req.body?.tickets;
  if (!Array.isArray(tickets) || tickets.length > 10_000) return res.status(400).json({ error: 'tickets debe ser un arreglo válido' });
  const normalized = tickets.map((ticket) => {
    const idTicket = Number(ticket.id_ticket ?? ticket.id);
    if (!Number.isInteger(idTicket) || idTicket <= 0) return null;
    const data = {
      remoteId: Number.isInteger(Number(ticket.id)) ? Number(ticket.id) : null,
      asunto: String(ticket.asunto || '').slice(0, 500) || null,
      cliente: String(ticket.cliente || '').slice(0, 300) || null,
      idServicio: Number.isInteger(Number(ticket.id_servicio)) ? Number(ticket.id_servicio) : null,
      estado: String(ticket.estado || '').slice(0, 100) || null,
      prioridad: String(ticket.prioridad || '').slice(0, 100) || null,
      fechaCreacion: String(ticket.fecha_creacion || '').slice(0, 100) || null,
      fechaActualizacion: String(ticket.fecha_actualizacion || '').slice(0, 100) || null,
      asignado: String(ticket.asignado || '').slice(0, 300) || null,
      descripcion: String(ticket.descripcion || '').slice(0, 10_000) || null,
    };
    return { idTicket, data, stateHash: ipamHash(data) };
  }).filter(Boolean);
  const existing = await prisma.cachedTicket.findMany({
    select: { idTicket: true, stateHash: true },
  });
  const byId = new Map(existing.map((ticket) => [ticket.idTicket, ticket]));
  const now = new Date();
  const creates = normalized.filter((ticket) => !byId.has(ticket.idTicket));
  const changes = normalized.filter((ticket) => byId.get(ticket.idTicket)?.stateHash !== ticket.stateHash);
  if (creates.length) {
    await prisma.cachedTicket.createMany({
      data: creates.map((ticket) => ({ idTicket: ticket.idTicket, ...ticket.data, stateHash: ticket.stateHash, firstSeenAt: now, lastChangedAt: now })),
    });
  }
  await runPrismaOperationsInBatches(changes.map((ticket) => prisma.cachedTicket.update({
    where: { idTicket: ticket.idTicket }, data: { ...ticket.data, stateHash: ticket.stateHash, lastChangedAt: now },
  })));
  res.json({ ok: true, received: normalized.length, created: creates.length, changed: changes.length });
}));

dbRouter.get('/invoices/sync-status', (req, res) => {
  res.json(invoiceHistorySyncStatus);
});

app.post('/auth/device-sessions', authMiddleware, requireRole(['admin']), asyncHandler(async (req, res) => {
  const deviceId = String(req.body?.deviceId || '').trim();
  const deviceName = String(req.body?.deviceName || 'ONU Studio').trim().slice(0, 120);
  if (!/^[A-Za-z0-9_.:-]{8,120}$/.test(deviceId)) {
    return res.status(400).json({ error: 'Identificador de dispositivo inválido' });
  }
  const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!user?.isActive) return res.status(401).json({ error: 'Usuario inactivo' });
  const deviceToken = crypto.randomBytes(48).toString('base64url');
  const data = {
    tokenHash: hashDeviceToken(deviceToken), username: user.username, role: user.role,
    deviceName, passwordChangedAt: user.passwordChangedAt, revokedAt: null, lastSeenAt: new Date(),
  };
  await prisma.trustedDeviceSession.upsert({
    where: { userId_deviceId: { userId: user.id, deviceId } },
    update: data,
    create: { ...data, userId: user.id, deviceId },
  });
  res.status(201).json({ deviceToken, deviceId, user: publicUserDto(user) });
}));

app.post('/auth/device-sessions/refresh', authLimiter, asyncHandler(async (req, res) => {
  const deviceToken = String(req.body?.deviceToken || '');
  const deviceId = String(req.body?.deviceId || '').trim();
  if (deviceToken.length < 40 || !deviceId) return res.status(401).json({ error: 'Sesión recordada inválida' });
  const trusted = await prisma.trustedDeviceSession.findUnique({ where: { tokenHash: hashDeviceToken(deviceToken) } });
  if (!trusted || trusted.deviceId !== deviceId || trusted.revokedAt) {
    return res.status(401).json({ error: 'Sesión recordada revocada' });
  }
  const user = await prisma.user.findUnique({ where: { id: trusted.userId } });
  const passwordChanged = Boolean(user?.passwordChangedAt && (
    !trusted.passwordChangedAt || user.passwordChangedAt.getTime() !== trusted.passwordChangedAt.getTime()
  ));
  if (!user?.isActive || passwordChanged) {
    await prisma.trustedDeviceSession.update({ where: { id: trusted.id }, data: { revokedAt: new Date() } });
    return res.status(401).json({ error: 'Sesión recordada revocada' });
  }
  if (!userHasRole({ role: user.role }, ['admin'])) {
    await prisma.trustedDeviceSession.update({ where: { id: trusted.id }, data: { revokedAt: new Date() } });
    return res.status(401).json({ error: 'La instalación requiere una cuenta administradora' });
  }
  const token = generateToken();
  await Promise.all([
    createSession(token, user.id, user.username, user.role),
    prisma.trustedDeviceSession.update({ where: { id: trusted.id }, data: { lastSeenAt: new Date(), role: user.role } }),
  ]);
  res.json({ token, user: publicUserDto(user) });
}));

app.post('/auth/device-sessions/revoke', asyncHandler(async (req, res) => {
  const deviceToken = String(req.body?.deviceToken || '');
  if (deviceToken.length >= 40) {
    await prisma.trustedDeviceSession.updateMany({
      where: { tokenHash: hashDeviceToken(deviceToken), revokedAt: null }, data: { revokedAt: new Date() },
    });
  }
  res.json({ success: true });
}));

dbRouter.post('/invoices/sync-history', requireRole(['admin']), asyncHandler(async (req, res) => {
  if (invoiceHistorySyncStatus.running) {
    return res.status(202).json({ started: false, ...invoiceHistorySyncStatus });
  }
  void runInvoiceHistorySync({ trigger: 'manual', force: true }).catch((error) => {
    console.error('[invoice-sync] manual history sync failed:', error.message);
  });
  res.status(202).json({ started: true, ...invoiceHistorySyncStatus });
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
  let created = 0;
  let changed = 0;
  let unchanged = 0;
  try {
    const existing = await prisma.client.findMany({ select: { idServicio: true, sourceHash: true } });
    const hashes = new Map(existing.map((client) => [client.idServicio, client.sourceHash]));
    for (const c of clients) {
      const idServicio = Number(c.id_servicio);
      if (!Number.isInteger(idServicio) || idServicio <= 0) continue;
      const createData = mapWisphubClient(c, {}, { forCreate: true });
      const updateData = mapWisphubClient(c);
      const sourceHash = sourceStateHash(createData);
      if (hashes.get(idServicio) === sourceHash) {
        unchanged++;
        continue;
      }
      if (hashes.has(idServicio)) {
        await prisma.client.update({ where: { idServicio }, data: { ...updateData, sourceHash } });
        changed++;
      } else {
        await prisma.client.create({ data: { ...createData, sourceHash } });
        created++;
      }
      hashes.set(idServicio, sourceHash);
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
      details: { count, created, changed, unchanged },
    });
    res.json({ success: true, received: clients.length, count, created, changed, unchanged });
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

  try {
    const { saved: count } = await upsertWisphubInvoices(invoices);

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
  const [paymentCount, totalPayments, wappCount, notesCount, speedCount, promiseCount, clientCount, invoiceCount, ipamCount, ipamAvailable, ticketCount] = await Promise.all([
    prisma.paymentLog.count(),
    prisma.paymentLog.aggregate({ _sum: { amount: true } }),
    prisma.whatsappLog.count(),
    prisma.clientNote.count(),
    prisma.speedTest.count(),
    prisma.paymentPromise.count({ where: { status: 'pending' } }),
    prisma.client.count(),
    prisma.invoice.count(),
    prisma.ipamAddress.count({ where: { active: true } }),
    prisma.ipamAddress.count({ where: { active: true, available: true } }),
    prisma.cachedTicket.count(),
  ]);

  res.json({
    payments: { count: paymentCount, total: totalPayments._sum.amount || 0 },
    whatsapp: { count: wappCount },
    notes: { count: notesCount },
    speedtests: { count: speedCount },
    promises: { pending: promiseCount },
    clients: { count: clientCount },
    invoices: { count: invoiceCount },
    ipam: { count: ipamCount, available: ipamAvailable },
    tickets: { count: ticketCount },
  });
}));

// BACKUP - genera una copia consistente de la base SQLite activa.
dbRouter.get('/backup', requireRole(['admin']), asyncHandler(async (req, res, next) => {
  const dbPath = resolveSqliteDatabasePath(process.env.DATABASE_URL || 'file:./data.db', __dirname);
  if (!dbPath) {
    return res.status(501).json({ error: 'El respaldo integrado solo esta disponible para SQLite' });
  }
  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: 'DB no encontrada', path: dbPath });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(path.dirname(dbPath), `.wishub-backup-${timestamp}.db`);
  const escapedBackupPath = backupPath.replace(/'/g, "''");
  await prisma.$executeRawUnsafe(`VACUUM INTO '${escapedBackupPath}'`);
  const fileName = `wishub-backup-${timestamp}.db`;
  const stat = await fs.promises.stat(backupPath);
  res.setHeader('Content-Type', 'application/vnd.sqlite3');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', String(stat.size));

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    fs.unlink(backupPath, () => {});
  };
  const stream = fs.createReadStream(backupPath);
  stream.on('error', (error) => {
    cleanup();
    if (!res.headersSent) next(error);
    else res.destroy(error);
  });
  res.on('finish', cleanup);
  res.on('close', cleanup);
  stream.pipe(res);
}));

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
  if (pathName.includes('/registrar-pago/') || pathName.includes('/reportar-pago/')) {
    return res.status(409).json({ error: 'Registra el pago desde Facturas para conservar su solicitud y verificación.', code: 'USE_DURABLE_BILLING' });
  }
  const requiredRole =
    pathName.includes('/ping/')
      ? 'tecnico'
      : pathName.includes('/registrar-pago/') || pathName.includes('/reportar-pago/') || pathName.includes('/clientes/activar/')
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

// Billing writes are completed server-side so a WispHub task is never treated
// as paid until its asynchronous result is confirmed.
const billingRouter = express.Router();
billingRouter.use(authMiddleware);
billingRouter.use(requireAnyRole(['cobranza']));

async function readWisphubResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { detail: text }; }
}

async function waitForWisphubTask(taskId, attempts = 30, intervalMs = 1000, subject = 'la operacion') {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(`https://api.wisphub.io/api/tasks/${encodeURIComponent(taskId)}/`, {
      headers: { Authorization: `Api-Key ${API_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await readWisphubResponse(response);
    if (!response.ok) throw new Error(payload.detail || `WispHub task HTTP ${response.status}`);

    const state = wisphubTaskState(payload);
    if (state.state === 'success') return state.result;
    if (state.state === 'failure') throw new Error(String(state.error));
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const error = new Error(`WispHub no confirmo ${subject} dentro del tiempo esperado`);
  error.code = 'WISPHUB_TASK_TIMEOUT';
  throw error;
}

require('./lib/web-billing').registerWebBilling(billingRouter, { billing: billingService, wrap: asyncHandler });

app.use('/billing', billingRouter);

// ─── MIKROTIK INTEGRATION ───
const { RouterOSAPI } = require('node-routeros');

const MT_HOST = process.env.MIKROTIK_HOST;
const MT_USER = process.env.MIKROTIK_USER;
const MT_PASS = process.env.MIKROTIK_PASS;
const MT_PORT = parseInt(process.env.MIKROTIK_PORT || '8728');
const MIKROTIK_ENABLED = process.env.MIKROTIK_ENABLED !== 'false';

let mtConn = null;
let mtConnecting = false;
let mtLastError = null;

async function closeMtConnection(connection, timeoutMs = 1500) {
  if (!connection) return;
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => connection.close()).catch(() => {}),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const MT_DEFAULT_TIMEOUT_MS = parseInt(process.env.MIKROTIK_TIMEOUT_MS || '6000');
const MT_CONNECT_RETRIES = 3;
const MT_CONNECT_BACKOFF_MS = [500, 2000, 5000];
const mtCommands = new MikrotikCommandQueue({
  maxPending: Math.max(10, parseInt(process.env.MIKROTIK_MAX_PENDING_READS || '40')),
});

// Wrapper que envuelve c.write con timeout. Si el MikroTik cuelga, devuelve error
// en vez de quedarse esperando indefinido. Uso: await mtWrite(c, 5000, '/ip/arp/print')
// Si timeoutMs es null/undefined usa MT_DEFAULT_TIMEOUT_MS.
async function mtWrite(c, timeoutMs, ...args) {
  const t = timeoutMs == null ? MT_DEFAULT_TIMEOUT_MS : timeoutMs;
  const command = String(args[0] || 'unknown');
  let activeConnection = c;
  return mtCommands.enqueue(async () => {
    if (activeConnection !== mtConn || !activeConnection?.connected) {
      activeConnection = await getMtConnection();
    }
    return activeConnection.write(...args);
  }, {
    timeoutMs: t,
    label: command,
    priority: isMikrotikMutationCommand(command) ? 10 : 0,
    onTimeout: async (error) => {
      mtLastError = error.message;
      const timedOutConnection = activeConnection;
      if (mtConn === timedOutConnection) mtConn = null;
      await closeMtConnection(timedOutConnection);
    },
  });
}

// Ejecuta fn() y si lanza error lo loguea con contexto y devuelve fallback.
// Reemplaza los .catch(() => []) silenciosos para que los errores queden en logs.
async function mtSafe(label, fallback, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[mikrotik] ${label} failed:`, e.message);
    return fallback;
  }
}

// Cache en memoria con TTL corto para resultados de lectura que se polean alto.
// Uso: const data = await mtCached('arp', 10000, async () => { ... })
const mtCache = new Map(); // key -> { data, expiresAt }
const mtInFlight = new Map();
const mtCacheMetrics = { hits: 0, misses: 0, coalesced: 0, staleServed: 0 };
async function mtCached(key, ttlMs, fn) {
  const cached = mtCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    mtCacheMetrics.hits += 1;
    return cached.data;
  }
  if (mtInFlight.has(key)) {
    mtCacheMetrics.coalesced += 1;
    return mtInFlight.get(key);
  }
  mtCacheMetrics.misses += 1;
  const refresh = (async () => {
    try {
      const data = await fn();
      mtCache.set(key, { data, expiresAt: Date.now() + ttlMs });
      return data;
    } catch (error) {
      if (cached) {
        mtCacheMetrics.staleServed += 1;
        console.warn(`[mikrotik] ${key} refresh failed; serving stale cache:`, error.message);
        return cached.data;
      }
      throw error;
    } finally {
      mtInFlight.delete(key);
    }
  })();
  mtInFlight.set(key, refresh);
  return refresh;
}
function mtInvalidate(prefix) {
  for (const k of mtCache.keys()) {
    if (!prefix || k.startsWith(prefix)) mtCache.delete(k);
  }
}

// Serializa escrituras a firewall (address-list, nat, filter) para evitar race
// conditions cuando varios admins bloquean/desbloquean clientes al mismo tiempo.
// Las lecturas NO pasan por aca.
let mtMutationChain = Promise.resolve();
async function mtSerialize(fn) {
  const next = mtMutationChain.then(fn, fn);
  // No queremos que un rechazo rompa la cadena para futuras llamadas.
  mtMutationChain = next.catch(() => {});
  return next;
}

function requireMikrotikConfirmation(req, expected) {
  if (String(req.body?.confirmation || '').trim().toUpperCase() !== expected) {
    const error = new Error(`Escriba ${expected} para confirmar esta operacion`);
    error.statusCode = 400;
    throw error;
  }
}

function routerFileDto(file) {
  const name = String(file.name || '');
  return {
    id: file['.id'],
    name,
    type: name.toLowerCase().endsWith('.backup') ? 'backup' : 'export',
    size: Number.parseInt(file.size || '0', 10) || 0,
    creationTime: file['creation-time'] || null,
  };
}

function safetyBackupName(label = 'change') {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const suffix = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16) || 'change';
  return sanitizeRouterFileName(`ispmax-auto-${timestamp}-${suffix}`);
}

async function createMikrotikSafetyBackup(connection, label) {
  const name = safetyBackupName(label);
  await mtWrite(connection, 20000, '/system/backup/save', `=name=${name}`);
  return `${name}.backup`;
}

const FIREWALL_TABLES = {
  filter: '/ip/firewall/filter',
  nat: '/ip/firewall/nat',
  mangle: '/ip/firewall/mangle',
  'address-list': '/ip/firewall/address-list',
};

function firewallRuleDto(rule, table) {
  return {
    id: rule['.id'], table, chain: rule.chain || null, action: rule.action || null,
    srcAddress: rule['src-address'] || null, dstAddress: rule['dst-address'] || null,
    protocol: rule.protocol || null, dstPort: rule['dst-port'] || null,
    inInterface: rule['in-interface'] || null, outInterface: rule['out-interface'] || null,
    list: rule.list || null, address: rule.address || null, timeout: rule.timeout || null,
    comment: rule.comment || null, bytes: Number.parseInt(rule.bytes || '0', 10) || 0,
    packets: Number.parseInt(rule.packets || '0', 10) || 0,
    disabled: rule.disabled === 'true' || rule.disabled === true,
    dynamic: rule.dynamic === 'true' || rule.dynamic === true,
    invalid: rule.invalid === 'true' || rule.invalid === true,
  };
}

const DEFAULT_SPEED_TEMPLATES = [
  { id: 'emergency-1', name: 'Emergencia 1M', uploadMbps: 1, downloadMbps: 1 },
  { id: 'basic-5', name: 'Basico 5M', uploadMbps: 5, downloadMbps: 5 },
  { id: 'standard-10', name: 'Estandar 10M', uploadMbps: 10, downloadMbps: 10 },
  { id: 'plus-20', name: 'Plus 20M', uploadMbps: 20, downloadMbps: 20 },
  { id: 'premium-100', name: 'Premium 100M', uploadMbps: 100, downloadMbps: 100 },
];

async function getSpeedTemplates() {
  const row = await prisma.appSetting.findUnique({ where: { key: 'mikrotik_speed_templates' } }).catch(() => null);
  if (!row?.value) return DEFAULT_SPEED_TEMPLATES;
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.map(sanitizeSpeedTemplate).filter((item) => item.id) : DEFAULT_SPEED_TEMPLATES;
  } catch {
    return DEFAULT_SPEED_TEMPLATES;
  }
}

async function saveSpeedTemplates(templates) {
  await prisma.appSetting.upsert({
    where: { key: 'mikrotik_speed_templates' },
    update: { value: JSON.stringify(templates), category: 'mikrotik' },
    create: {
      key: 'mikrotik_speed_templates', value: JSON.stringify(templates), category: 'mikrotik',
      description: 'Plantillas reutilizables de velocidad para colas simples',
    },
  });
}

async function getMtConnection() {
  if (!MIKROTIK_ENABLED) {
    throw new Error('La conexión con el MikroTik está desactivada en la configuración del servidor');
  }
  if (!MT_HOST || !MT_USER || !MT_PASS) {
    throw new Error('El MikroTik no está configurado en el servidor');
  }

  // Validar que la conexion existente sigue viva.
  if (mtConn?.connected) return mtConn;

  if (mtConnecting) {
    // Esperar conexion en curso (hasta ~7s total: ~suma de backoffs).
    let waited = 0;
    while (mtConnecting && waited < 8000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
    if (mtConn?.connected) return mtConn;
  }

  mtConnecting = true;
  let lastErr = null;
  try {
    for (let attempt = 0; attempt < MT_CONNECT_RETRIES; attempt++) {
      try {
        if (mtConn) await closeMtConnection(mtConn);
        const connection = new RouterOSAPI({
          host: MT_HOST, user: MT_USER, password: MT_PASS, port: MT_PORT,
          timeout: 10, keepalive: true,
        });
        connection.on('error', (error) => {
          mtLastError = error?.message || 'Conexion MikroTik interrumpida';
          if (mtConn === connection) mtConn = null;
          console.error('[mikrotik] connection error:', mtLastError);
        });
        mtConn = connection;
        await connection.connect();
        mtLastError = null;
        if (attempt > 0) console.log(`[mikrotik] reconnected on attempt ${attempt + 1}`);
        return mtConn;
      } catch (e) {
        lastErr = e;
        mtConn = null;
        const backoff = MT_CONNECT_BACKOFF_MS[attempt] || 5000;
        console.warn(`[mikrotik] connect attempt ${attempt + 1}/${MT_CONNECT_RETRIES} failed: ${e.message}; retry in ${backoff}ms`);
        if (attempt < MT_CONNECT_RETRIES - 1) {
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }
    mtLastError = lastErr?.message || 'unknown error';
    throw lastErr || new Error('MikroTik connect failed');
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
    telemetry: { commandQueue: mtCommands.snapshot(), cache: { ...mtCacheMetrics, entries: mtCache.size, inFlight: mtInFlight.size } },
  });
}));

// System info — cache 5s (cambia poco en escalas humanas)
mtRouter.get('/system', asyncHandler(async (req, res) => {
  let data;
  try {
    data = await mtCached('system', 5000, async () => {
      const c = await getMtConnection();
      const [resource, identity, health] = await Promise.all([
        mtWrite(c, null, '/system/resource/print'),
        mtWrite(c, null, '/system/identity/print'),
        mtSafe('system/health', [], () => mtWrite(c, null, '/system/health/print')),
      ]);
      return { resource: resource[0], identity: identity[0]?.name, health };
    });
  } catch (error) {
    data = { resource: {}, identity: null, health: [], degraded: true, error: error.message };
  }
  res.json(data);
}));

// Interfaces — cache 10s
mtRouter.get('/interfaces', asyncHandler(async (req, res) => {
  const ifaces = await mtCached('interfaces', 10000, async () => {
    const c = await getMtConnection();
    return await mtWrite(c, null, '/interface/print');
  });
  res.json(ifaces);
}));

// Traffic - bytes en tiempo real — cache 3s (counters acumulados, lectura barata)
mtRouter.get('/traffic', asyncHandler(async (req, res) => {
  const data = await mtCached('traffic', 3000, async () => {
    const c = await getMtConnection();
    const ifaces = await mtWrite(c, null, '/interface/print');
    return ifaces.map(i => ({
      name: i.name,
      type: i.type,
      running: i.running === 'true',
      macAddress: i['mac-address'],
      rxBytes: parseInt(i['rx-byte'] || '0'),
      txBytes: parseInt(i['tx-byte'] || '0'),
      rxPackets: parseInt(i['rx-packet'] || '0'),
      txPackets: parseInt(i['tx-packet'] || '0'),
    }));
  });
  res.json(data);
}));

// Monitor traffic en vivo de una interface (sin cache — debe ser real-time)
mtRouter.get('/monitor/:iface', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const result = await mtWrite(c, null, '/interface/monitor-traffic', '=interface=' + req.params.iface, '=once=');
  res.json(result[0] || {});
}));

// Simple Queues - clientes con limite de banda — cache 5s
mtRouter.get('/queues', asyncHandler(async (req, res) => {
  const data = await mtCached('queues', 5000, async () => {
    const c = await getMtConnection();
    const queues = await mtWrite(c, null, '/queue/simple/print');
    return queues.map(q => ({
      id: q['.id'],
      name: q.name,
      target: q.target,
      maxLimit: q['max-limit'],
      burstLimit: q['burst-limit'],
      burstThreshold: q['burst-threshold'],
      burstTime: q['burst-time'],
      bytes: q.bytes,
      packets: q.packets,
      rate: q.rate,
      disabled: q.disabled === 'true',
    }));
  });
  res.json(data);
}));

// Stats de queue con bandwidth actual (sin cache — es el real-time)
mtRouter.get('/queue-stats', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const queues = await mtWrite(c, null, '/queue/simple/print', '=stats=');
  res.json(queues);
}));

function queueDto(queue) {
  return {
    id: queue['.id'],
    name: queue.name,
    target: queue.target,
    maxLimit: queue['max-limit'],
    rate: queue.rate || '0/0',
    bytes: queue.bytes || '0/0',
    disabled: queue.disabled === 'true' || queue.disabled === true,
    comment: queue.comment || null,
  };
}

function queueWriteArguments(data) {
  const args = [];
  if (data.name != null) args.push(`=name=${data.name}`);
  if (data.targetIp != null) args.push(`=target=${data.targetIp}/32`);
  if (data.uploadBps != null || data.downloadBps != null) {
    if (data.uploadBps == null || data.downloadBps == null) {
      const error = new Error('uploadMbps y downloadMbps deben enviarse juntos');
      error.statusCode = 400;
      throw error;
    }
    args.push(`=max-limit=${data.uploadBps}/${data.downloadBps}`);
  }
  if (data.comment != null) args.push(`=comment=${data.comment}`);
  if (data.disabled != null) args.push(`=disabled=${data.disabled ? 'yes' : 'no'}`);
  return args;
}

mtRouter.post('/queues', requireRole(['admin']), asyncHandler(async (req, res) => {
  let data;
  try {
    data = sanitizeQueueMutation(req.body);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }

  const created = await mtSerialize(async () => {
    const c = await getMtConnection();
    const queues = await mtWrite(c, 8000, '/queue/simple/print');
    const target = `${data.targetIp}/32`;
    if (queues.some((queue) => queue.target === target)) {
      const error = new Error(`Ya existe una cola para ${data.targetIp}`);
      error.statusCode = 409;
      throw error;
    }
    const result = await mtWrite(c, 8000, '/queue/simple/add', ...queueWriteArguments(data));
    const id = result[0]?.ret;
    mtInvalidate('queues');
    mtInvalidate('clients-live');
    mtInvalidate('unknown-devices');
    return { id, ...data };
  }).catch((error) => {
    if (error.statusCode) return { error };
    throw error;
  });
  if (created.error) return res.status(created.error.statusCode).json({ error: created.error.message });

  await logActivity(req, {
    action: 'mikrotik_queue_created', entityType: 'mikrotik_queue', entityId: created.id,
    entityName: data.name, details: { targetIp: data.targetIp, uploadBps: data.uploadBps, downloadBps: data.downloadBps },
  });
  res.status(201).json({ ok: true, queue: created });
}));

mtRouter.patch('/queues/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^\*[0-9a-f]+$/i.test(id)) return res.status(400).json({ error: 'ID de cola inválido' });

  let data;
  try {
    data = sanitizeQueueMutation(req.body, { partial: true });
    if ((data.uploadBps == null) !== (data.downloadBps == null)) {
      return res.status(400).json({ error: 'uploadMbps y downloadMbps deben enviarse juntos' });
    }
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }

  const result = await mtSerialize(async () => {
    const c = await getMtConnection();
    const queues = await mtWrite(c, 8000, '/queue/simple/print', '=stats=');
    const before = queues.find((queue) => queue['.id'] === id);
    if (!before) return null;
    await mtWrite(c, 8000, '/queue/simple/set', `=.id=${id}`, ...queueWriteArguments(data));
    mtInvalidate('queues');
    mtInvalidate('clients-live');
    mtInvalidate('unknown-devices');
    return { before: queueDto(before), after: { ...queueDto(before), ...data } };
  });
  if (!result) return res.status(404).json({ error: 'Cola no encontrada' });

  await logActivity(req, {
    action: 'mikrotik_queue_updated', entityType: 'mikrotik_queue', entityId: id,
    entityName: data.name || result.before.name, details: { before: result.before, changes: data },
  });
  res.json({ ok: true, queue: result.after });
}));

mtRouter.get('/unknown-devices', asyncHandler(async (req, res) => {
  const data = await mtCached('unknown-devices', 300000, async () => {
    const c = await getMtConnection();
    const clientsPromise = prisma.client.findMany({
      select: { idServicio: true, nombre: true, usuario: true, ip: true, macCpe: true },
    });
    const queues = await mtWrite(c, 9000, '/queue/simple/print', '=stats=');
    const arp = await mtWrite(c, 7000, '/ip/arp/print');
    const neighbors = await mtSafe('unknown devices neighbors', [], () => mtWrite(c, 7000, '/ip/neighbor/print'));
    const bridgeHosts = await mtSafe('unknown devices bridge', [], () => mtWrite(c, 7000, '/interface/bridge/host/print'));
    const connections = await mtSafe('unknown devices connections', [], () => mtWrite(
      c,
      15000,
      '/ip/firewall/connection/print',
      '=.proplist=src-address,orig-bytes,repl-bytes',
    ));
    const clients = await clientsPromise;
    const devices = buildUnknownDevices({
      arp, queues, clients, neighbors, bridgeHosts, connections,
      cidrs: parseClientCidrs(process.env.MIKROTIK_CLIENT_NETWORKS || process.env.MIKROTIK_CLIENT_CIDRS),
    });
    return {
      timestamp: new Date().toISOString(),
      stats: {
        total: devices.length,
        highRisk: devices.filter((device) => device.risk === 'high').length,
        unmanaged: devices.filter((device) => device.classification === 'unmanaged_device').length,
        unregisteredQueues: devices.filter((device) => device.classification === 'unregistered_queue').length,
        infrastructureCandidates: devices.filter((device) => device.classification === 'infrastructure_candidate').length,
      },
      devices,
    };
  });
  res.json(data);
}));

mtRouter.get('/security-audit', asyncHandler(async (req, res) => {
  const data = await mtCached('security-audit', 60000, async () => {
    const c = await getMtConnection();
    const resource = (await mtWrite(c, 7000, '/system/resource/print'))[0] || {};
    const services = await mtWrite(c, 7000, '/ip/service/print');
    const users = await mtWrite(c, 7000, '/user/print');
    const activeUsers = await mtSafe('security active users', [], () => mtWrite(c, 7000, '/user/active/print'));
    const ipSettings = (await mtWrite(c, 7000, '/ip/settings/print'))[0] || {};
    const dns = (await mtWrite(c, 7000, '/ip/dns/print'))[0] || {};
    const filters = await mtWrite(c, 9000, '/ip/firewall/filter/print');
    return {
      timestamp: new Date().toISOString(),
      ...buildSecurityAudit({
        resource, services, users, activeUsers, ipSettings, dns, filters,
        minimumVersion: process.env.MIKROTIK_MIN_VERSION || '7.20.8',
      }),
    };
  });
  res.json(data);
}));

// IP Addresses — cache 30s (cambia poco)
mtRouter.get('/addresses', asyncHandler(async (req, res) => {
  const addrs = await mtCached('addresses', 30000, async () => {
    const c = await getMtConnection();
    return await mtWrite(c, null, '/ip/address/print');
  });
  res.json(addrs);
}));

// Active sessions PPPoE / Hotspot — cache 5s
mtRouter.get('/active-sessions', asyncHandler(async (req, res) => {
  const data = await mtCached('active-sessions', 5000, async () => {
    const c = await getMtConnection();
    const [pppoe, hotspot] = await Promise.all([
      mtSafe('ppp/active', [], () => mtWrite(c, null, '/ppp/active/print')),
      mtSafe('hotspot/active', [], () => mtWrite(c, null, '/ip/hotspot/active/print')),
    ]);
    return { pppoe, hotspot };
  });
  res.json(data);
}));

// DHCP Leases — cache 15s
mtRouter.get('/dhcp-leases', asyncHandler(async (req, res) => {
  const leases = await mtCached('dhcp-leases', 15000, async () => {
    const c = await getMtConnection();
    return await mtWrite(c, null, '/ip/dhcp-server/lease/print');
  });
  res.json(leases);
}));

// ARP Table — cache 10s
mtRouter.get('/arp', asyncHandler(async (req, res) => {
  const arp = await mtCached('arp', 10000, async () => {
    const c = await getMtConnection();
    return await mtWrite(c, null, '/ip/arp/print');
  });
  res.json(arp);
}));

// RouterOS backup and export inventory.
mtRouter.get('/backups', asyncHandler(async (req, res) => {
  const files = await mtCached('backups', 15000, async () => {
    const c = await getMtConnection();
    return mtWrite(c, 10000, '/file/print');
  });
  res.json(files
    .filter((file) => /\.(backup|rsc)$/i.test(String(file.name || '')))
    .map(routerFileDto)
    .sort((a, b) => String(b.creationTime || '').localeCompare(String(a.creationTime || ''))));
}));

mtRouter.post('/backups', requireRole(['admin']), asyncHandler(async (req, res) => {
  requireMikrotikConfirmation(req, 'CREAR');
  const type = String(req.body?.type || 'backup');
  if (!['backup', 'export'].includes(type)) return res.status(400).json({ error: 'Tipo de respaldo inválido' });
  const name = sanitizeRouterFileName(req.body?.name);
  const file = await mtSerialize(async () => {
    const c = await getMtConnection();
    if (type === 'backup') await mtWrite(c, 20000, '/system/backup/save', `=name=${name}`);
    else await mtWrite(c, 20000, '/export', `=file=${name}`, '=show-sensitive=no');
    mtInvalidate('backups');
    return `${name}.${type === 'backup' ? 'backup' : 'rsc'}`;
  });
  await logActivity(req, {
    action: 'mikrotik_backup_created', entityType: 'mikrotik_backup', entityName: file, details: { type },
  });
  res.status(201).json({ ok: true, file });
}));

mtRouter.delete('/backups/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  requireMikrotikConfirmation(req, 'ELIMINAR');
  const id = String(req.params.id || '');
  if (!isRouterId(id)) return res.status(400).json({ error: 'ID de archivo inválido' });
  const removed = await mtSerialize(async () => {
    const c = await getMtConnection();
    const files = await mtWrite(c, 10000, '/file/print');
    const before = files.find((file) => file['.id'] === id);
    if (!before || !/\.(backup|rsc)$/i.test(String(before.name || ''))) return null;
    await mtWrite(c, 10000, '/file/remove', `=.id=${id}`);
    mtInvalidate('backups');
    return routerFileDto(before);
  });
  if (!removed) return res.status(404).json({ error: 'Respaldo no encontrado' });
  await logActivity(req, {
    action: 'mikrotik_backup_deleted', entityType: 'mikrotik_backup', entityId: id,
    entityName: removed.name, details: removed,
  });
  await prisma.trustedDeviceSession.updateMany({
    where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() },
  });
  res.json({ ok: true });
}));

// Firewall explorer and guarded state changes.
mtRouter.get('/firewall', asyncHandler(async (req, res) => {
  const data = await mtCached('firewall', 10000, async () => {
    const c = await getMtConnection();
    const result = {};
    for (const [table, pathName] of Object.entries(FIREWALL_TABLES)) {
      const rules = await mtWrite(c, 12000, `${pathName}/print`);
      result[table] = rules.map((rule) => firewallRuleDto(rule, table));
    }
    return { timestamp: new Date().toISOString(), tables: result };
  });
  res.json(data);
}));

mtRouter.patch('/firewall/:table/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  requireMikrotikConfirmation(req, 'APLICAR');
  const table = String(req.params.table || '');
  const id = String(req.params.id || '');
  const pathName = FIREWALL_TABLES[table];
  if (!pathName || !isRouterId(id) || typeof req.body?.disabled !== 'boolean') {
    return res.status(400).json({ error: 'Tabla, ID o estado de firewall inválido' });
  }
  const result = await mtSerialize(async () => {
    const c = await getMtConnection();
    const rules = await mtWrite(c, 10000, `${pathName}/print`);
    const before = rules.find((rule) => rule['.id'] === id);
    if (!before) return null;
    if (before.dynamic === 'true' || before.dynamic === true) {
      const error = new Error('Las reglas dinamicas no se pueden modificar');
      error.statusCode = 409;
      throw error;
    }
    const safetyBackup = await createMikrotikSafetyBackup(c, `firewall-${table}`);
    await mtWrite(c, 10000, `${pathName}/set`, `=.id=${id}`, `=disabled=${req.body.disabled ? 'yes' : 'no'}`);
    mtInvalidate('firewall');
    mtInvalidate('security-audit');
    return { before: firewallRuleDto(before, table), safetyBackup };
  });
  if (!result) return res.status(404).json({ error: 'Regla no encontrada' });
  await logActivity(req, {
    action: 'mikrotik_firewall_toggled', entityType: 'mikrotik_firewall', entityId: id,
    entityName: result.before.comment || `${table} ${id}`,
    details: { before: result.before, disabled: req.body.disabled, safetyBackup: result.safetyBackup },
  });
  res.json({ ok: true, safetyBackup: result.safetyBackup });
}));

mtRouter.delete('/firewall/:table/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  requireMikrotikConfirmation(req, 'ELIMINAR');
  const table = String(req.params.table || '');
  const id = String(req.params.id || '');
  const pathName = FIREWALL_TABLES[table];
  if (!pathName || !isRouterId(id)) return res.status(400).json({ error: 'Tabla o ID de firewall inválido' });
  const result = await mtSerialize(async () => {
    const c = await getMtConnection();
    const rules = await mtWrite(c, 10000, `${pathName}/print`);
    const before = rules.find((rule) => rule['.id'] === id);
    if (!before) return null;
    if (before.dynamic === 'true' || before.dynamic === true) {
      const error = new Error('Las reglas dinamicas no se pueden eliminar');
      error.statusCode = 409;
      throw error;
    }
    const safetyBackup = await createMikrotikSafetyBackup(c, `firewall-${table}`);
    await mtWrite(c, 10000, `${pathName}/remove`, `=.id=${id}`);
    mtInvalidate('firewall');
    mtInvalidate('security-audit');
    return { before: firewallRuleDto(before, table), safetyBackup };
  });
  if (!result) return res.status(404).json({ error: 'Regla no encontrada' });
  await logActivity(req, {
    action: 'mikrotik_firewall_deleted', entityType: 'mikrotik_firewall', entityId: id,
    entityName: result.before.comment || `${table} ${id}`, details: result,
  });
  res.json({ ok: true, safetyBackup: result.safetyBackup });
}));

function ipamHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sourceStateHash(data, extra = null) {
  const comparable = { ...data };
  delete comparable.syncedAt;
  delete comparable.mtSyncedAt;
  return ipamHash(extra == null ? comparable : { data: comparable, extra });
}

function ipamAddressData(row) {
  const data = {
    cidr: row.cidr || null,
    classification: row.classification,
    available: row.available === true,
    recommended: row.recommended === true,
    macAddress: row.macAddress || null,
    macAddresses: JSON.stringify(row.macAddresses || []),
    interfaceName: row.interface || null,
    leaseId: row.leaseId || null,
    hostName: row.hostName || null,
    serverName: row.server || null,
    queueId: row.queueId || null,
    queueName: row.queueName || null,
    poolName: row.poolName || null,
    status: row.status || null,
    dynamic: row.dynamic === true,
    disabled: row.disabled === true,
    clientIdServicio: row.client?.id || null,
    clientName: row.client?.name || null,
    clientUsername: row.client?.username || null,
    sources: JSON.stringify(row.sources || []),
    conflict: row.conflict === true,
    availabilityConfidence: row.availabilityConfidence || 'verified',
    observed: row.observed === true,
    active: true,
  };
  return { ...data, stateHash: ipamHash(data) };
}

async function runPrismaOperationsInBatches(operations, size = 100) {
  for (let index = 0; index < operations.length; index += size) {
    await prisma.$transaction(operations.slice(index, index + size));
  }
}

async function persistIpamReport(report) {
  const now = new Date();
  const [existingAddresses, existingNetworks] = await Promise.all([
    prisma.ipamAddress.findMany({ select: { ip: true, stateHash: true, active: true } }),
    prisma.ipamNetwork.findMany({ select: { cidr: true, stateHash: true } }),
  ]);
  const addressByIp = new Map(existingAddresses.map((row) => [row.ip, row]));
  const networkByCidr = new Map(existingNetworks.map((row) => [row.cidr, row]));
  const currentIps = new Set(report.rows.map((row) => row.ip));
  const currentCidrs = new Set(report.networks.map((network) => network.cidr));
  const creates = [];
  const changes = [];

  for (const row of report.rows) {
    const data = ipamAddressData(row);
    const existing = addressByIp.get(row.ip);
    if (!existing) creates.push({ ip: row.ip, ...data, firstSeenAt: now, lastChangedAt: now });
    else if (existing.stateHash !== data.stateHash || !existing.active) {
      changes.push(prisma.ipamAddress.update({ where: { ip: row.ip }, data: { ...data, lastChangedAt: now } }));
    }
  }
  if (creates.length) await prisma.ipamAddress.createMany({ data: creates });
  for (const existing of existingAddresses) {
    if (existing.active && !currentIps.has(existing.ip)) {
      changes.push(prisma.ipamAddress.update({
        where: { ip: existing.ip }, data: { active: false, available: false, recommended: false, lastChangedAt: now },
      }));
    }
  }
  await runPrismaOperationsInBatches(changes);

  const networkOps = [];
  for (const network of report.networks) {
    const data = {
      network: network.network,
      prefix: network.prefix,
      capacity: network.capacity,
      used: network.used,
      available: network.available,
      utilization: network.utilization,
      recommended: JSON.stringify(network.recommended || []),
    };
    const stateHash = ipamHash(data);
    const existing = networkByCidr.get(network.cidr);
    if (!existing) {
      networkOps.push(prisma.ipamNetwork.create({
        data: { cidr: network.cidr, ...data, stateHash, firstSeenAt: now, lastChangedAt: now },
      }));
    } else if (existing.stateHash !== stateHash) {
      networkOps.push(prisma.ipamNetwork.update({
        where: { cidr: network.cidr }, data: { ...data, stateHash, lastChangedAt: now },
      }));
    }
  }
  for (const existing of existingNetworks) {
    if (!currentCidrs.has(existing.cidr)) {
      networkOps.push(prisma.ipamNetwork.delete({ where: { cidr: existing.cidr } }));
    }
  }
  await runPrismaOperationsInBatches(networkOps);
  await prisma.appSetting.upsert({
    where: { key: 'ipam.lastScanAt' }, update: { value: report.timestamp }, create: { key: 'ipam.lastScanAt', value: report.timestamp },
  });
  return { created: creates.length, changed: changes.length, networksChanged: networkOps.length };
}

function storedIpamRow(row) {
  return {
    ip: row.ip,
    cidr: row.cidr,
    macAddress: row.macAddress,
    macAddresses: JSON.parse(row.macAddresses || '[]'),
    interface: row.interfaceName,
    leaseId: row.leaseId,
    hostName: row.hostName,
    server: row.serverName,
    queueId: row.queueId,
    queueName: row.queueName,
    poolName: row.poolName,
    status: row.status,
    dynamic: row.dynamic,
    disabled: row.disabled,
    client: row.clientIdServicio ? { id: row.clientIdServicio, name: row.clientName, username: row.clientUsername } : null,
    classification: row.classification,
    available: row.available,
    recommended: row.recommended,
    sources: JSON.parse(row.sources || '[]'),
    conflict: row.conflict,
    availabilityConfidence: row.availabilityConfidence,
    observed: row.observed,
  };
}

async function readStoredIpamReport(errorMessage = null) {
  const [addresses, networks, lastScan] = await Promise.all([
    prisma.ipamAddress.findMany({ where: { active: true }, orderBy: { ip: 'asc' } }),
    prisma.ipamNetwork.findMany({ orderBy: { cidr: 'asc' } }),
    prisma.appSetting.findUnique({ where: { key: 'ipam.lastScanAt' } }),
  ]);
  const rows = addresses.map(storedIpamRow).sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  return {
    timestamp: lastScan?.value || null,
    source: 'sqlite',
    stale: true,
    error: errorMessage,
    truncated: false,
    stats: {
      total: rows.length,
      matchedClients: rows.filter((row) => row.classification === 'client').length,
      unknownLeases: rows.filter((row) => row.classification === 'unknown_lease').length,
      arpOnly: rows.filter((row) => row.classification === 'arp_only').length,
      arpProbes: rows.filter((row) => row.availabilityConfidence === 'probe_required').length,
      queueOnly: rows.filter((row) => row.classification === 'queue_only').length,
      poolReserved: rows.filter((row) => row.classification === 'pool_reserved').length,
      routerAddresses: rows.filter((row) => row.classification === 'router').length,
      occupiedWithoutClient: rows.filter((row) => !row.available && !['client', 'router'].includes(row.classification)).length,
      available: networks.reduce((sum, network) => sum + network.available, 0),
      ipConflicts: rows.filter((row) => row.conflict).length,
      macMoves: 0,
    },
    networks: networks.map((network) => ({ ...network, recommended: JSON.parse(network.recommended || '[]') })),
    conflicts: { ip: rows.filter((row) => row.conflict).map((row) => ({ ip: row.ip, macAddresses: row.macAddresses })), mac: [] },
    rows,
  };
}

async function fetchLiveIpamReport(preloaded = {}) {
  const c = await getMtConnection();
  const [leases, arp, queues, routerAddresses, pools, clients] = await Promise.all([
    preloaded.leases || mtWrite(c, 10000, '/ip/dhcp-server/lease/print'),
    preloaded.arp || mtWrite(c, 10000, '/ip/arp/print'),
    preloaded.queues || mtWrite(c, 10000, '/queue/simple/print'),
    mtWrite(c, 10000, '/ip/address/print'),
    mtWrite(c, 10000, '/ip/pool/print'),
    prisma.client.findMany({ select: { idServicio: true, nombre: true, usuario: true, ip: true, macCpe: true } }),
  ]);
  const report = buildIpamReport({
    leases, arp, queues, routerAddresses, pools, clients,
    cidrs: preloaded.cidrs || parseClientCidrs(process.env.MIKROTIK_CLIENT_NETWORKS || process.env.MIKROTIK_CLIENT_CIDRS),
  });
  report.persistence = await persistIpamReport(report);
  return report;
}

// DHCP/IPAM joins RouterOS, WispHub and the durable SQLite inventory.
mtRouter.get('/ipam', asyncHandler(async (req, res) => {
  try {
    const data = await mtCached('ipam', 15000, fetchLiveIpamReport);
    res.json(data);
  } catch (error) {
    const stored = await readStoredIpamReport(error.message);
    if (!stored.rows.length) throw error;
    res.json(stored);
  }
}));

mtRouter.post('/ipam/leases/:id/make-static', requireRole(['admin']), asyncHandler(async (req, res) => {
  requireMikrotikConfirmation(req, 'FIJAR');
  const id = String(req.params.id || '');
  if (!isRouterId(id)) return res.status(400).json({ error: 'ID de concesion inválido' });
  const result = await mtSerialize(async () => {
    const c = await getMtConnection();
    const leases = await mtWrite(c, 10000, '/ip/dhcp-server/lease/print');
    const before = leases.find((lease) => lease['.id'] === id);
    if (!before) return null;
    if (!(before.dynamic === 'true' || before.dynamic === true)) {
      const error = new Error('La concesion ya es estatica');
      error.statusCode = 409;
      throw error;
    }
    const safetyBackup = await createMikrotikSafetyBackup(c, 'dhcp-static');
    await mtWrite(c, 10000, '/ip/dhcp-server/lease/make-static', `=.id=${id}`);
    mtInvalidate('dhcp-leases');
    mtInvalidate('ipam');
    return { before, safetyBackup };
  });
  if (!result) return res.status(404).json({ error: 'Concesion DHCP no encontrada' });
  await logActivity(req, {
    action: 'mikrotik_lease_made_static', entityType: 'mikrotik_dhcp_lease', entityId: id,
    entityName: result.before['host-name'] || result.before.address,
    details: { address: result.before.address, macAddress: result.before['mac-address'], safetyBackup: result.safetyBackup },
  });
  res.json({ ok: true, safetyBackup: result.safetyBackup });
}));

// Persistent speed templates and guarded bulk queue application.
mtRouter.get('/speed-templates', asyncHandler(async (req, res) => {
  res.json(await getSpeedTemplates());
}));

mtRouter.post('/speed-templates', requireRole(['admin']), asyncHandler(async (req, res) => {
  const template = sanitizeSpeedTemplate(req.body);
  const templates = await getSpeedTemplates();
  template.id = template.id && /^[a-z0-9_-]{3,60}$/i.test(template.id)
    ? template.id
    : `speed-${Date.now().toString(36)}`;
  const index = templates.findIndex((item) => item.id === template.id);
  if (index >= 0) templates[index] = template;
  else templates.push(template);
  await saveSpeedTemplates(templates);
  await logActivity(req, {
    action: index >= 0 ? 'mikrotik_speed_template_updated' : 'mikrotik_speed_template_created',
    entityType: 'mikrotik_speed_template', entityId: template.id, entityName: template.name, details: template,
  });
  res.status(index >= 0 ? 200 : 201).json({ ok: true, template });
}));

mtRouter.delete('/speed-templates/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  requireMikrotikConfirmation(req, 'ELIMINAR');
  const id = String(req.params.id || '');
  if (!/^[a-z0-9_-]{3,60}$/i.test(id)) return res.status(400).json({ error: 'ID de plantilla inválido' });
  const templates = await getSpeedTemplates();
  const before = templates.find((item) => item.id === id);
  if (!before) return res.status(404).json({ error: 'Plantilla no encontrada' });
  await saveSpeedTemplates(templates.filter((item) => item.id !== id));
  await logActivity(req, {
    action: 'mikrotik_speed_template_deleted', entityType: 'mikrotik_speed_template', entityId: id,
    entityName: before.name, details: before,
  });
  res.json({ ok: true });
}));

mtRouter.post('/speed-templates/apply', requireRole(['admin']), asyncHandler(async (req, res) => {
  requireMikrotikConfirmation(req, 'APLICAR');
  const templateId = String(req.body?.templateId || '');
  const queueIds = [...new Set(Array.isArray(req.body?.queueIds) ? req.body.queueIds.map(String) : [])];
  if (!templateId || queueIds.length < 1 || queueIds.length > 50 || queueIds.some((id) => !isRouterId(id))) {
    return res.status(400).json({ error: 'Seleccione entre 1 y 50 colas validas' });
  }
  const templates = await getSpeedTemplates();
  const template = templates.find((item) => item.id === templateId);
  if (!template) return res.status(404).json({ error: 'Plantilla no encontrada' });
  const result = await mtSerialize(async () => {
    const c = await getMtConnection();
    const queues = await mtWrite(c, 12000, '/queue/simple/print', '=stats=');
    const selected = queues.filter((queue) => queueIds.includes(queue['.id']));
    if (selected.length !== queueIds.length) {
      const error = new Error('Una o mas colas ya no existen');
      error.statusCode = 409;
      throw error;
    }
    const safetyBackup = await createMikrotikSafetyBackup(c, 'bulk-speed');
    const maxLimit = `${Math.round(template.uploadMbps * 1_000_000)}/${Math.round(template.downloadMbps * 1_000_000)}`;
    for (const queue of selected) {
      await mtWrite(c, 10000, '/queue/simple/set', `=.id=${queue['.id']}`, `=max-limit=${maxLimit}`);
    }
    mtInvalidate('queues');
    mtInvalidate('clients-live');
    mtInvalidate('unknown-devices');
    return { selected: selected.map(queueDto), safetyBackup };
  });
  await logActivity(req, {
    action: 'mikrotik_speed_template_applied', entityType: 'mikrotik_queue', entityId: template.id,
    entityName: template.name, details: { queueIds, before: result.selected, template, safetyBackup: result.safetyBackup },
  });
  res.json({ ok: true, updated: queueIds.length, safetyBackup: result.safetyBackup });
}));

function netwatchDto(item) {
  return {
    id: item['.id'], host: item.host, type: item.type || 'simple', interval: item.interval || null,
    timeout: item.timeout || null, port: item.port ? Number(item.port) : null,
    status: item.status || 'unknown', since: item.since || null, comment: item.comment || null,
    disabled: item.disabled === 'true' || item.disabled === true,
  };
}

function netwatchArguments(data) {
  const args = [];
  for (const field of ['host', 'type', 'interval', 'comment']) {
    if (data[field] != null) args.push(`=${field}=${data[field]}`);
  }
  if (data.port != null) args.push(`=port=${data.port}`);
  if (data.disabled != null) args.push(`=disabled=${data.disabled ? 'yes' : 'no'}`);
  return args;
}

mtRouter.get('/netwatch', asyncHandler(async (req, res) => {
  const data = await mtCached('netwatch', 10000, async () => {
    const c = await getMtConnection();
    return (await mtWrite(c, 10000, '/tool/netwatch/print')).map(netwatchDto);
  });
  res.json(data);
}));

mtRouter.post('/netwatch', requireRole(['admin']), asyncHandler(async (req, res) => {
  requireMikrotikConfirmation(req, 'CREAR');
  const data = sanitizeNetwatchMutation(req.body);
  const result = await mtSerialize(async () => {
    const c = await getMtConnection();
    const safetyBackup = await createMikrotikSafetyBackup(c, 'netwatch-add');
    const created = await mtWrite(c, 10000, '/tool/netwatch/add', ...netwatchArguments(data));
    mtInvalidate('netwatch');
    return { id: created[0]?.ret, safetyBackup };
  });
  await logActivity(req, {
    action: 'mikrotik_netwatch_created', entityType: 'mikrotik_netwatch', entityId: result.id,
    entityName: data.host, details: { ...data, safetyBackup: result.safetyBackup },
  });
  res.status(201).json({ ok: true, id: result.id, safetyBackup: result.safetyBackup });
}));

mtRouter.patch('/netwatch/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  requireMikrotikConfirmation(req, 'APLICAR');
  const id = String(req.params.id || '');
  if (!isRouterId(id)) return res.status(400).json({ error: 'ID de sonda inválido' });
  const data = sanitizeNetwatchMutation(req.body, { partial: true });
  const result = await mtSerialize(async () => {
    const c = await getMtConnection();
    const entries = await mtWrite(c, 10000, '/tool/netwatch/print');
    const before = entries.find((item) => item['.id'] === id);
    if (!before) return null;
    const safetyBackup = await createMikrotikSafetyBackup(c, 'netwatch-set');
    await mtWrite(c, 10000, '/tool/netwatch/set', `=.id=${id}`, ...netwatchArguments(data));
    mtInvalidate('netwatch');
    return { before: netwatchDto(before), safetyBackup };
  });
  if (!result) return res.status(404).json({ error: 'Sonda no encontrada' });
  await logActivity(req, {
    action: 'mikrotik_netwatch_updated', entityType: 'mikrotik_netwatch', entityId: id,
    entityName: result.before.host, details: { before: result.before, changes: data, safetyBackup: result.safetyBackup },
  });
  res.json({ ok: true, safetyBackup: result.safetyBackup });
}));

mtRouter.delete('/netwatch/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  requireMikrotikConfirmation(req, 'ELIMINAR');
  const id = String(req.params.id || '');
  if (!isRouterId(id)) return res.status(400).json({ error: 'ID de sonda inválido' });
  const result = await mtSerialize(async () => {
    const c = await getMtConnection();
    const entries = await mtWrite(c, 10000, '/tool/netwatch/print');
    const before = entries.find((item) => item['.id'] === id);
    if (!before) return null;
    const safetyBackup = await createMikrotikSafetyBackup(c, 'netwatch-delete');
    await mtWrite(c, 10000, '/tool/netwatch/remove', `=.id=${id}`);
    mtInvalidate('netwatch');
    return { before: netwatchDto(before), safetyBackup };
  });
  if (!result) return res.status(404).json({ error: 'Sonda no encontrada' });
  await logActivity(req, {
    action: 'mikrotik_netwatch_deleted', entityType: 'mikrotik_netwatch', entityId: id,
    entityName: result.before.host, details: result,
  });
  res.json({ ok: true, safetyBackup: result.safetyBackup });
}));

// Cache para calcular bandwidth en tiempo real (delta entre samples)
const bandwidthCache = new Map(); // ip → { upload, download, timestamp }

// Cliente live: queue + WispHub client + bandwidth real-time
async function collectLiveClients() {
  const c = await getMtConnection();

  // 1. Get queues with stats (incluye rate actual calculado por MikroTik)
  const queues = await mtCached('clients-live:queues', 5000, async () => (
    mtWrite(c, 15000, '/queue/simple/print', '=stats=')
  ));

  // Trafico distinto de cero no significa necesariamente que un cliente este
  // conectado. ARP y las sesiones activas permiten separar presencia de uso.
  const arp = await mtCached('clients-live:arp', 5000, async () => (
    mtSafe('clients-live arp', [], () => mtWrite(c, 6000, '/ip/arp/print'))
  ));
  const sessions = await mtCached('clients-live:sessions', 5000, async () => {
    const [pppoe, hotspot] = await Promise.all([
      mtSafe('clients-live ppp active', [], () => mtWrite(c, 6000, '/ppp/active/print')),
      mtSafe('clients-live hotspot active', [], () => mtWrite(c, 6000, '/ip/hotspot/active/print')),
    ]);
    return [...pppoe, ...hotspot];
  });

  // 2. Get clients from local DB cache (mas rapido que pegarle a WispHub)
  const clients = await prisma.client.findMany({
    select: {
      idServicio: true, usuario: true, nombre: true, aliasNombre: true,
      ip: true, telefono: true, aliasTelefono: true, direccion: true,
      planInternetName: true, precioPlan: true, saldo: true, estado: true,
      estadoFacturas: true, zonaNombre: true, routerNombre: true,
      interfazLan: true, macCpe: true, snOnu: true, crmAction: true,
      crmActionReason: true, paymentPilotEnabled: true,
      paymentPilotEnabledAt: true, syncedAt: true, mtSyncedAt: true,
      mtMacAddress: true, mtQueueName: true, mtInterface: true,
      _count: { select: { equipment: true } },
    }
  });
  const clientsByIp = new Map();
  clients.forEach(cl => { if (cl.ip) clientsByIp.set(cl.ip, cl); });

  const arpByIp = new Map();
  for (const entry of arp) {
    if (entry.address) arpByIp.set(entry.address, entry);
  }
  const sessionByIp = new Map();
  for (const session of sessions) {
    const ip = session.address || session['address'];
    if (ip) sessionByIp.set(ip, session);
  }

  const now = Date.now();
  const result = [];
  const queueIps = new Set();

  for (const q of queues) {
    const targetIp = (q.target || '').split('/')[0];
    if (!targetIp) continue;
    queueIps.add(targetIp);

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
    const arpEntry = arpByIp.get(targetIp);
    const activeSession = sessionByIp.get(targetIp);
    const transmitting = uploadBps + downloadBps > 0;
    const arpPresent = !!arpEntry && arpEntry.invalid !== 'true' && arpEntry.complete !== 'false';
    const isOnline = !!activeSession || arpPresent;
    const queueDisabled = q.disabled === 'true' || q.disabled === true;

    let syncState = 'synced';
    if (!client) syncState = 'missing_wisphub';
    else if (client.mtQueueName && client.mtQueueName !== q.name) syncState = 'queue_mismatch';
    else if (queueDisabled && String(client.estado || '').toLowerCase() === 'activo') syncState = 'state_mismatch';

    // Parse max-limit "4300000/4300000"
    const limits = (q['max-limit'] || '0/0').split('/');
    const maxUp = parseInt(limits[0] || '0');
    const maxDown = parseInt(limits[1] || '0');

    result.push({
      queueId: q['.id'],
      queueName: q.name,
      ip: targetIp,
      // Cliente WispHub
      client: client ? {
        id: client.idServicio,
        username: client.usuario,
        name: client.aliasNombre || client.nombre,
        wisphubName: client.nombre,
        phone: client.aliasTelefono || client.telefono,
        address: client.direccion,
        plan: client.planInternetName,
        price: client.precioPlan,
        balance: client.saldo,
        zone: client.zonaNombre,
        router: client.routerNombre,
        interface: client.interfazLan,
        macAddress: client.macCpe,
        snOnu: client.snOnu,
        status: client.estado,
        invoiceStatus: client.estadoFacturas,
        crmAction: client.crmAction,
        crmActionReason: client.crmActionReason,
        paymentPilotEnabled: client.paymentPilotEnabled,
        paymentPilotEnabledAt: client.paymentPilotEnabledAt,
        syncedAt: client.syncedAt,
        mtSyncedAt: client.mtSyncedAt,
        equipmentCount: client._count.equipment,
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
      isActive: isOnline,
      isOnline,
      isTransmitting: transmitting,
      isDisabled: queueDisabled,
      interface: arpEntry?.interface || client?.mtInterface || client?.interfazLan || null,
      macAddress: arpEntry?.['mac-address'] || client?.mtMacAddress || client?.macCpe || null,
      sessionUptime: activeSession?.uptime || null,
      sessionUser: activeSession?.name || activeSession?.user || null,
      syncState,
    });
  }

  // Mostrar tambien clientes de WispHub que no tienen una cola correspondiente.
  // Son precisamente los casos que el operador necesita detectar y corregir.
  for (const client of clients) {
    if (client.ip && queueIps.has(client.ip)) continue;
    const clientIp = client.ip || '';
    const arpEntry = clientIp ? arpByIp.get(clientIp) : null;
    const activeSession = clientIp ? sessionByIp.get(clientIp) : null;
    const arpPresent = !!arpEntry && arpEntry.invalid !== 'true' && arpEntry.complete !== 'false';
    result.push({
      queueId: null,
      queueName: client.usuario || `wisphub-${client.idServicio}`,
      ip: clientIp,
      client: {
        id: client.idServicio,
        username: client.usuario,
        name: client.aliasNombre || client.nombre,
        wisphubName: client.nombre,
        phone: client.aliasTelefono || client.telefono,
        address: client.direccion,
        plan: client.planInternetName,
        price: client.precioPlan,
        balance: client.saldo,
        zone: client.zonaNombre,
        router: client.routerNombre,
        interface: client.interfazLan,
        macAddress: client.macCpe,
        snOnu: client.snOnu,
        status: client.estado,
        invoiceStatus: client.estadoFacturas,
        crmAction: client.crmAction,
        crmActionReason: client.crmActionReason,
        paymentPilotEnabled: client.paymentPilotEnabled,
        paymentPilotEnabledAt: client.paymentPilotEnabledAt,
        syncedAt: client.syncedAt,
        mtSyncedAt: client.mtSyncedAt,
        equipmentCount: client._count.equipment,
      },
      maxUploadBps: 0,
      maxDownloadBps: 0,
      totalUploadBytes: 0,
      totalDownloadBytes: 0,
      totalBytes: 0,
      uploadBps: 0,
      downloadBps: 0,
      uploadPct: 0,
      downloadPct: 0,
      isActive: !!activeSession || arpPresent,
      isOnline: !!activeSession || arpPresent,
      isTransmitting: false,
      isDisabled: false,
      interface: arpEntry?.interface || client.mtInterface || client.interfazLan || null,
      macAddress: arpEntry?.['mac-address'] || client.mtMacAddress || client.macCpe || null,
      sessionUptime: activeSession?.uptime || null,
      sessionUser: activeSession?.name || activeSession?.user || null,
      syncState: clientIp ? 'missing_mikrotik' : 'missing_ip',
    });
  }

  // Stats globales
  const totalUp = result.reduce((s, r) => s + r.uploadBps, 0);
  const totalDown = result.reduce((s, r) => s + r.downloadBps, 0);
  const activeCount = result.filter(r => r.isOnline).length;
  const transmittingCount = result.filter(r => r.isTransmitting).length;
  const differences = result.filter(r => r.syncState !== 'synced').length;
  const overdueClients = result.filter(r => {
    const action = String(r.client?.crmAction || '').toLowerCase();
    const invoice = String(r.client?.invoiceStatus || '').toLowerCase();
    return action === 'moroso' || invoice.includes('vencid') || invoice.includes('pendiente');
  }).length;

  return {
    timestamp: new Date().toISOString(),
    stats: {
      totalQueues: result.length,
      mikrotikQueues: queues.length,
      totalClients: result.length,
      activeClients: activeCount,
      onlineClients: activeCount,
      offlineClients: result.length - activeCount,
      transmittingClients: transmittingCount,
      differences,
      overdueClients,
      disabledQueues: result.filter(r => r.isDisabled).length,
      missingWisphub: result.filter(r => r.syncState === 'missing_wisphub').length,
      missingMikrotik: result.filter(r => r.syncState === 'missing_mikrotik').length,
      clientsWithoutIp: result.filter(r => r.syncState === 'missing_ip').length,
      totalUploadBps: totalUp,
      totalDownloadBps: totalDown,
      totalBpsCombined: totalUp + totalDown,
    },
    clients: result,
  };
}

mtRouter.get('/clients-live', asyncHandler(async (req, res) => {
  const snapshot = await mtCached('clients-live:snapshot', 2500, collectLiveClients);
  scheduleNocEvaluation(snapshot);
  res.json(snapshot);
}));

// Top consumers (queue ordenadas por bytes)
mtRouter.get('/top-consumers', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const queues = await mtWrite(c, null, '/queue/simple/print');
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

// Ping desde el MikroTik (timeout proporcional: count * 1500ms + 2s margen)
mtRouter.post('/ping', asyncHandler(async (req, res) => {
  const c = await getMtConnection();
  const { address, count = 4 } = req.body;
  const safeCount = Math.min(Math.max(parseInt(count) || 4, 1), 20);
  const timeout = safeCount * 1500 + 2000;
  const result = await mtWrite(c, timeout, '/ping', '=address=' + address, '=count=' + safeCount);
  res.json(result);
}));

// Prueba del enlace MikroTik -> equipo del cliente.
// Mide lo que el router entrega a ese cliente: limite configurado en su cola,
// trafico real durante una ventana, respuesta del equipo (ping) y si esta presente en la red.
// Es de solo lectura: no cambia colas ni genera trafico artificial.
// La usan la web (/mikrotik/link-test) y la app movil, para que ambas midan igual.
async function runClientLinkTest(options = {}) {
  const seconds = Math.min(Math.max(parseInt(options.seconds) || 8, 3), 20);
  const idServicio = parseInt(options.idServicio);
  let client = null;
  if (Number.isFinite(idServicio)) {
    client = await prisma.client.findUnique({ where: { idServicio } });
    if (!client) throw Object.assign(new Error('Cliente no encontrado'), { status: 404 });
  }
  const ip = String(client?.ip || options.ip || '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    throw Object.assign(new Error('El cliente no tiene una IP válida para probar'), { status: 400 });
  }

  const connection = await getMtConnection();
  const readQueue = async () => {
    const queues = await mtWrite(connection, 10_000, '/queue/simple/print', '=stats=');
    const queue = queues.find((q) => String(q.target || '').split('/')[0] === ip) || null;
    const bytes = String(queue?.bytes || '0/0').split('/');
    const rate = String(queue?.rate || '0/0').split('/');
    return {
      queue,
      at: Date.now(),
      uploadBytes: parseInt(bytes[0] || '0') || 0,
      downloadBytes: parseInt(bytes[1] || '0') || 0,
      uploadBps: parseInt(rate[0] || '0') || 0,
      downloadBps: parseInt(rate[1] || '0') || 0,
    };
  };

  const first = await readQueue();
  if (!first.queue) {
    throw Object.assign(new Error(`No hay una cola en el MikroTik para la IP ${ip}. Revise que el cliente tenga su cola creada.`), { status: 404 });
  }
  // El ping ocupa la cola de comandos ~5 s; se hace mientras transcurre la ventana de medicion.
  const pingRows = await mtWrite(connection, 9_000, '/ping', `=address=${ip}`, '=count=5');
  const remaining = seconds * 1000 - (Date.now() - first.at);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  const second = await readQueue();

  const arp = await mtWrite(connection, 8_000, '/ip/arp/print').catch(() => []);
  const arpEntry = arp.find((row) => row.address === ip) || null;

  const elapsedSeconds = Math.max(1, (second.at - first.at) / 1000);
  const delta = (a, b) => (b >= a ? ((b - a) * 8) / elapsedSeconds : 0);
  const limits = String(second.queue?.['max-limit'] || '0/0').split('/');

  return {
    ip,
    client: client ? { idServicio: client.idServicio, nombre: client.nombre, plan: client.planInternetName, estado: client.estado } : null,
    queue: {
      name: second.queue?.name || null,
      target: second.queue?.target || null,
      disabled: second.queue?.disabled === 'true' || second.queue?.disabled === true,
      maxUploadBps: parseInt(limits[0] || '0') || 0,
      maxDownloadBps: parseInt(limits[1] || '0') || 0,
      comment: second.queue?.comment || null,
    },
    traffic: {
      seconds: Math.round(elapsedSeconds),
      avgUploadBps: Math.round(delta(first.uploadBytes, second.uploadBytes)),
      avgDownloadBps: Math.round(delta(first.downloadBytes, second.downloadBytes)),
      instantUploadBps: second.uploadBps,
      instantDownloadBps: second.downloadBps,
      uploadBytes: Math.max(0, second.uploadBytes - first.uploadBytes),
      downloadBytes: Math.max(0, second.downloadBytes - first.downloadBytes),
    },
    ping: { address: ip, count: 5, ...parsePingSummary(pingRows) },
    presence: {
      inArp: Boolean(arpEntry) && arpEntry.invalid !== 'true',
      macAddress: arpEntry?.['mac-address'] || null,
      interface: arpEntry?.interface || null,
    },
    readAt: new Date().toISOString(),
  };
}

mtRouter.post('/link-test', asyncHandler(async (req, res) => {
  try {
    res.json(await runClientLinkTest({ seconds: req.body?.seconds, idServicio: req.body?.idServicio, ip: req.body?.ip }));
  } catch (error) {
    if (!error.status) throw error;
    res.status(error.status).json({ error: error.message });
  }
}));

// Trafico WAN (interfaz upstream) en tiempo real para detectar saturacion del backhaul
mtRouter.get('/wan-traffic', asyncHandler(async (req, res) => {
  const wanIface = process.env.MIKROTIK_WAN_IFACE || 'sfp2';
  const maxMbps = parseInt(process.env.MIKROTIK_WAN_MAX_MBPS || '1000');
  try {
    const data = await mtCached('wan-traffic', 3000, async () => {
      const c = await getMtConnection();
      const result = await mtWrite(c, 8000, '/interface/monitor-traffic', '=interface=' + wanIface, '=once=');
      const r = result[0] || {};
      return {
        ifaceName: wanIface,
        rxBps: parseInt(r['rx-bits-per-second'] || 0),
        txBps: parseInt(r['tx-bits-per-second'] || 0),
        rxPps: parseInt(r['rx-packets-per-second'] || 0),
        txPps: parseInt(r['tx-packets-per-second'] || 0),
        maxBps: maxMbps * 1e6,
        timestamp: Date.now(),
      };
    });
    res.json(data);
  } catch (error) {
    console.warn('[mikrotik] WAN traffic unavailable:', error.message);
    res.json({
      ifaceName: wanIface, rxBps: 0, txBps: 0, rxPps: 0, txPps: 0,
      maxBps: maxMbps * 1e6, timestamp: Date.now(), degraded: true,
    });
  }
}));

app.use('/mikrotik', mtRouter);

// Flujo durable de instalaciones. La reserva vive en SQLite y se comparte
// entre la interfaz web, ONU Studio y cualquier instancia de Railway.
const provisioningRouter = express.Router();
provisioningRouter.use(authMiddleware);
provisioningRouter.use(requireRole(['tecnico']));

function provisioningJobDto(job) {
  let steps = [];
  try { steps = JSON.parse(job.steps || '[]'); } catch {}
  const { agentInventoryJson, configurationManifestJson, ...safeJob } = job;
  let configurationManifest = null;
  try { configurationManifest = configurationManifestJson ? JSON.parse(configurationManifestJson) : null; } catch {}
  return { ...safeJob, agentInventoryAvailable: Boolean(agentInventoryJson), configurationManifest, steps };
}

function cleanProvisioningSerial(value) {
  if (value == null || String(value).trim() === '') return null;
  const serial = normalizeSerial(value);
  if (!/^[A-Z0-9]{8,32}$/.test(serial)) {
    throw Object.assign(new Error('Serial ONU invalido'), { statusCode: 400 });
  }
  return serial;
}

function parseStoredAgentInventory(job) {
  if (!job?.agentInventoryJson) return null;
  try { return JSON.parse(job.agentInventoryJson); } catch { return null; }
}

function sanitizeConfigurationManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const serviceMode = String(value.serviceMode || 'router').toLowerCase();
  if (!['router', 'bridge'].includes(serviceMode)) throw Object.assign(new Error('Modo del manifiesto invalido'), { statusCode: 400 });
  const serial = value.serial ? cleanProvisioningSerial(value.serial) : null;
  const vlan = Number(value.vlan);
  if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) throw Object.assign(new Error('VLAN del manifiesto invalida'), { statusCode: 400 });
  const lanPorts = [...new Set((Array.isArray(value.lanPorts) ? value.lanPorts : [1]).map(Number))].sort();
  if (!lanPorts.length || lanPorts.some((port) => !Number.isInteger(port) || port < 1 || port > 4)) {
    throw Object.assign(new Error('Puertos LAN del manifiesto invalidos'), { statusCode: 400 });
  }
  const wan = value.wan && typeof value.wan === 'object' ? value.wan : {};
  const wanIp = serviceMode === 'router' ? String(wan.ip || '').trim() : null;
  if (serviceMode === 'router' && !isValidIpv4(wanIp)) throw Object.assign(new Error('IP Router del manifiesto invalida'), { statusCode: 400 });
  return {
    schemaVersion: 1, serviceMode, serial,
    model: String(value.model || '').trim().slice(0, 80) || null,
    firmware: String(value.firmware || '').trim().slice(0, 120) || null,
    vlan, wan: { mode: serviceMode === 'bridge' ? 'bridge' : 'static', ip: wanIp,
      gateway: serviceMode === 'router' && isValidIpv4(String(wan.gateway || '')) ? String(wan.gateway) : null,
      nat: serviceMode === 'router' && wan.nat === true },
    lanPorts, ssidBinding: serviceMode === 'router' && value.ssidBinding === true,
    wifi: serviceMode === 'router' && value.wifi && typeof value.wifi === 'object'
      ? { enabled: value.wifi.enabled !== false, ssid: String(value.wifi.ssid || '').slice(0, 32) } : null,
    channels: { tr069: serviceMode === 'router' && value.channels?.tr069 === true, omci: value.channels?.omci !== false, webLocal: value.channels?.webLocal !== false },
    verified: value.verified === true, verifiedAt: value.verified === true ? new Date(value.verifiedAt || Date.now()).toISOString() : null,
  };
}

function parseConfigurationManifest(job) {
  try { return job?.configurationManifestJson ? JSON.parse(job.configurationManifestJson) : null; } catch { return null; }
}

function oltProvisioningProfileDto(profile) {
  let lanPorts = [1];
  let compatibleModels = [];
  try { lanPorts = JSON.parse(profile.lanPortsJson || '[1]'); } catch {}
  try { compatibleModels = JSON.parse(profile.compatibleModelsJson || '[]'); } catch {}
  const { lanPortsJson, compatibleModelsJson, ...safe } = profile;
  return { ...safe, lanPorts, compatibleModels };
}

function agentInventoryDto(job) {
  const inventory = parseStoredAgentInventory(job);
  if (!inventory) return null;
  return {
    jobId: job.id,
    clientIdServicio: job.clientIdServicio,
    onuIndex: job.onuIndex,
    phase: job.agentInventoryPhase,
    agentVersion: job.agentVersion,
    capturedAt: job.agentInventoryAt,
    summary: summarizeOnuAgentInventory(inventory),
    inventory,
  };
}

async function latestAgentInventoryForSerial(serialValue) {
  const serial = normalizeSerial(serialValue);
  if (!serial) return null;
  const job = await prisma.provisioningJob.findFirst({
    where: { serial, agentInventoryJson: { not: null } },
    orderBy: [{ agentInventoryAt: 'desc' }, { updatedAt: 'desc' }],
  });
  return agentInventoryDto(job);
}

async function releaseExpiredIpReservations() {
  return prisma.ipReservation.updateMany({
    where: { status: 'active', expiresAt: { lte: new Date() } },
    data: { status: 'expired', releasedAt: new Date() },
  });
}

provisioningRouter.get('/ip-catalog', asyncHandler(async (req, res) => {
  const result = await buildProvisioningIpCatalog({
    cidrs: null, cidr: String(req.query.cidr || '').trim(), search: String(req.query.q || '').trim().toLowerCase(),
    userId: req.session.userId,
  });
  res.json(result);
}));

function validateRequestedIpamCidrs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    throw Object.assign(new Error('Envia entre 1 y 16 rangos IP'), { statusCode: 400 });
  }
  const cidrs = [...new Set(value.map((item) => String(item || '').trim()))];
  const ranges = cidrs.map((cidr) => cidrHostRange(cidr));
  if (ranges.some((range) => !range || range.prefix < 16 || range.prefix > 30)) {
    throw Object.assign(new Error('Cada rango debe ser un CIDR IPv4 entre /16 y /30'), { statusCode: 400 });
  }
  if (ranges.reduce((sum, range) => sum + range.capacity, 0) > 65_536) {
    throw Object.assign(new Error('Los rangos superan 65,536 direcciones'), { statusCode: 400 });
  }
  return cidrs;
}

async function buildProvisioningIpCatalog({ cidrs = null, cidr = '', search = '', userId }) {
  await releaseExpiredIpReservations();
  let report;
  try {
    report = await fetchLiveIpamReport(cidrs ? { cidrs } : {});
  } catch (error) {
    report = await readStoredIpamReport(error.message);
  }
  const reservations = await prisma.ipReservation.findMany({
    where: { status: 'active', expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: 'asc' },
  });
  const reservationByIp = new Map(reservations.map((item) => [item.ip, item]));
  const rows = report.rows
    .filter((row) => row.available && row.cidr)
    .filter((row) => !cidr || row.cidr === cidr)
    .filter((row) => !search || row.ip.includes(search))
    .map((row) => ({ ...row, reservation: reservationByIp.get(row.ip) || null }))
    .filter((row) => !row.reservation || row.reservation.createdById === userId)
    .slice(0, 1000);
  return {
    timestamp: report.timestamp,
    source: report.source,
    stale: report.stale === true,
    networks: report.networks,
    reservations,
    rows,
  };
}

provisioningRouter.post('/ip-catalog/query', asyncHandler(async (req, res) => {
  const cidrs = validateRequestedIpamCidrs(req.body?.cidrs);
  const result = await buildProvisioningIpCatalog({ cidrs, userId: req.session.userId });
  res.json(result);
}));

provisioningRouter.get('/commercial-catalog', asyncHandler(async (_req, res) => {
  const [zonesPage, plansPage] = await Promise.all([
    wisphubApiRequest('zonas/?limit=500'),
    wisphubApiRequest('plan-internet/?limit=500'),
  ]);
  res.json({
    zones: Array.isArray(zonesPage.results) ? zonesPage.results : Array.isArray(zonesPage) ? zonesPage : [],
    plans: Array.isArray(plansPage.results) ? plansPage.results : Array.isArray(plansPage) ? plansPage : [],
  });
}));

provisioningRouter.get('/clients', asyncHandler(async (req, res) => {
  const search = String(req.query.q || '').trim();
  if (search.length < 2) return res.json([]);
  const numericId = Number(search);
  const clients = await prisma.client.findMany({
    where: {
      OR: [
        ...(Number.isInteger(numericId) && numericId > 0 ? [{ idServicio: numericId }] : []),
        { nombre: { contains: search } },
        { usuario: { contains: search } },
        { telefono: { contains: search } },
        { ip: { contains: search } },
      ],
    },
    orderBy: { nombre: 'asc' },
    take: 30,
    select: {
      idServicio: true, nombre: true, usuario: true, telefono: true, ip: true, snOnu: true,
      estado: true, planInternetId: true, planInternetName: true, zonaId: true, zonaNombre: true,
      ssidRouterWifi: true, modeloRouterWifi: true,
    },
  });
  const mappings = clients.length ? await prisma.oltOnu.findMany({
    where: { clientIdServicio: { in: clients.map((client) => client.idServicio) } },
    orderBy: [{ online: 'desc' }, { lastSeenAt: 'desc' }],
    select: { clientIdServicio: true, onuIndex: true, serial: true, pon: true, online: true, phaseState: true, rxPowerDbm: true, model: true },
  }) : [];
  const mappingByClient = new Map();
  for (const mapping of mappings) if (!mappingByClient.has(mapping.clientIdServicio)) mappingByClient.set(mapping.clientIdServicio, mapping);
  res.json(clients.map((client) => {
    const speed = inferredPlanSpeed(client.planInternetName);
    return { ...client, uploadMbps: speed, downloadMbps: speed, oltOnu: mappingByClient.get(client.idServicio) || null };
  }));
}));

async function handleIpReservation(req, res) {
  const ip = String(req.body?.ip || '').trim();
  const clientName = String(req.body?.clientName || '').trim().slice(0, 160) || null;
  const serial = cleanProvisioningSerial(req.body?.serial);
  const durationMinutes = Math.min(120, Math.max(5, Number(req.body?.durationMinutes) || 30));
  if (!isValidIpv4(ip)) return res.status(400).json({ error: 'IP inválida' });

  const requestedCidrs = req.body?.cidrs ? validateRequestedIpamCidrs(req.body.cidrs) : null;
  const report = await fetchLiveIpamReport(requestedCidrs ? { cidrs: requestedCidrs } : {});
  const address = report.rows.find((row) => row.ip === ip);
  if (!address?.available || !address.cidr) {
    return res.status(409).json({ error: `${ip} no esta disponible`, address: address || null });
  }
  if (address.availabilityConfidence === 'probe_required') {
    const occupied = await mtSerialize(async () => {
      const connection = await getMtConnection();
      const pingRows = await mtWrite(
        connection, 8_000, '/ping', `=address=${ip}`, '=count=3',
        ...(address.interface ? [`=interface=${address.interface}`] : []), '=arp-ping=yes',
      );
      const summary = pingRows.find((item) => item['packet-loss'] != null);
      return pingRows.some((item) => item.time && !item.status) || Number(summary?.received || 0) > 0;
    });
    if (occupied) return res.status(409).json({ error: `${ip} respondio al sondeo y no puede reservarse` });
    address.availabilityConfidence = 'arp_probe_clear';
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMinutes * 60_000);
  const token = crypto.randomUUID();
  const reservation = await prisma.$transaction(async (tx) => {
    const current = await tx.ipReservation.findUnique({ where: { ip } });
    if (current?.status === 'active' && current.expiresAt > now && current.createdById !== req.session.userId) {
      throw Object.assign(new Error(`${ip} ya esta reservada por otro tecnico`), { statusCode: 409 });
    }
    return tx.ipReservation.upsert({
      where: { ip },
      create: {
        ip, token, cidr: address.cidr, clientName, serial,
        createdById: req.session.userId, createdBy: req.session.username, expiresAt,
      },
      update: {
        token, cidr: address.cidr, status: 'active', clientName, serial,
        createdById: req.session.userId, createdBy: req.session.username,
        expiresAt, committedAt: null, releasedAt: null,
      },
    });
  });
  await logActivity(req, {
    action: 'ip_reserved', entityType: 'ip_reservation', entityId: ip, entityName: clientName || ip,
    details: { cidr: address.cidr, serial, expiresAt, availabilityConfidence: address.availabilityConfidence },
  });
  res.status(201).json({ ...reservation, requiresProbe: address.availabilityConfidence === 'probe_required' });
}
provisioningRouter.post('/reservations', asyncHandler(handleIpReservation));

async function handleIpReservationRelease(req, res) {
  const reservation = await prisma.ipReservation.findUnique({ where: { token: String(req.params.token) } });
  if (!reservation) return res.status(404).json({ error: 'Reserva no encontrada' });
  if (reservation.createdById !== req.session.userId && !userHasRole(req.session, ['admin'])) {
    return res.status(403).json({ error: 'La reserva pertenece a otro técnico' });
  }
  const updated = await prisma.ipReservation.update({
    where: { token: reservation.token }, data: { status: 'released', releasedAt: new Date() },
  });
  res.json(updated);
}
provisioningRouter.delete('/reservations/:token', asyncHandler(handleIpReservationRelease));

provisioningRouter.post('/clients/:id/assign-ip', asyncHandler(async (req, res) => {
  await releaseExpiredIpReservations();
  const clientIdServicio = Number(req.params.id);
  const token = String(req.body?.reservationToken || '').trim();
  const serial = cleanProvisioningSerial(req.body?.serial);
  if (!Number.isInteger(clientIdServicio) || clientIdServicio <= 0) {
    return res.status(400).json({ error: 'Cliente inválido' });
  }
  if (!token || !serial) return res.status(400).json({ error: 'La reserva y el serial ONU son obligatorios' });

  const [reservation, client] = await Promise.all([
    prisma.ipReservation.findUnique({ where: { token } }),
    prisma.client.findUnique({
      where: { idServicio: clientIdServicio },
      select: { idServicio: true, nombre: true, usuario: true, ip: true, snOnu: true, planInternetName: true },
    }),
  ]);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
  if (!reservation || reservation.status !== 'active' || reservation.expiresAt <= new Date()) {
    return res.status(409).json({ error: 'La reserva de IP vencio o no es válida' });
  }
  if (reservation.createdById !== req.session.userId && !userHasRole(req.session, ['admin'])) {
    return res.status(403).json({ error: 'La reserva pertenece a otro técnico' });
  }
  if (reservation.serial && normalizeSerial(reservation.serial) !== serial) {
    return res.status(409).json({ error: 'La reserva pertenece a otra ONU' });
  }

  const ip = reservation.ip;
  const report = await fetchLiveIpamReport(reservation.cidr ? { cidrs: [reservation.cidr] } : {});
  const address = report.rows.find((row) => row.ip === ip);
  const ownedByClient = address?.clientIdServicio === clientIdServicio || client.ip === ip;
  if (!address?.cidr || (!address.available && !ownedByClient)) {
    return res.status(409).json({ error: `${ip} dejo de estar disponible`, address: address || null });
  }

  let availabilityCheck = address.availabilityConfidence || 'verified';
  if (!ownedByClient && address.availabilityConfidence === 'probe_required') {
    const occupied = await mtSerialize(async () => {
      const connection = await getMtConnection();
      const pingRows = await mtWrite(
        connection, 8_000, '/ping', `=address=${ip}`, '=count=3',
        ...(address.interface ? [`=interface=${address.interface}`] : []),
        '=arp-ping=yes',
      );
      const summary = pingRows.find((item) => item['packet-loss'] != null);
      return pingRows.some((item) => item.time && !item.status) || Number(summary?.received || 0) > 0;
    });
    if (occupied) return res.status(409).json({ error: `${ip} respondio al sondeo y no puede asignarse` });
    availabilityCheck = 'arp_probe_clear';
  }

  let wisphubChanged = false;
  if (client.ip !== ip || normalizeSerial(client.snOnu) !== serial) {
    const update = await wisphubApiRequest(`clientes/${clientIdServicio}/`, {
      method: 'PUT',
      body: JSON.stringify({ ip, sn_onu: serial }),
    });
    const taskId = update.task_id || update.task?.id || null;
    if (taskId) {
      const task = await waitForWisphubTask(taskId, 40, 1000, 'la asignacion de IP');
      const taskError = taskResultError(task);
      if (taskError) throw Object.assign(new Error(taskError), { statusCode: 502 });
    }
    const remote = await wisphubApiRequest(`clientes/${clientIdServicio}/`);
    if (String(remote.ip || '').trim() !== ip) {
      throw Object.assign(new Error('WispHub no confirmo la nueva IP del cliente'), { statusCode: 502 });
    }
    wisphubChanged = true;
  }

  let mikrotikAction = 'verified';
  await mtSerialize(async () => {
    const connection = await getMtConnection();
    const queues = await mtWrite(connection, 10_000, '/queue/simple/print');
    const newTarget = `${ip}/32`;
    const newQueue = queues.find((queue) => queueTargetIp(queue.target) === ip);
    if (newQueue) return;
    const oldQueue = client.ip ? queues.find((queue) => queueTargetIp(queue.target) === client.ip) : null;
    if (oldQueue) {
      await mtWrite(connection, 10_000, '/queue/simple/set', `=.id=${oldQueue['.id']}`, `=target=${newTarget}`);
      mikrotikAction = 'target_updated';
    } else {
      mikrotikAction = 'not_found';
    }
    mtInvalidate('queues');
    mtInvalidate('clients-live');
  });

  const now = new Date();
  const existingJob = await prisma.provisioningJob.findFirst({
    where: { serial, status: { in: ['in_progress', 'waiting_optical', 'partial'] } },
    orderBy: { updatedAt: 'desc' },
  });
  const step = { stage: 'client_ready', status: 'complete', message: `IP ${ip} reservada y sincronizada`, at: now.toISOString(), source: 'olt' };
  let job;
  if (existingJob) {
    let steps = [];
    try { steps = JSON.parse(existingJob.steps || '[]'); } catch {}
    job = await prisma.provisioningJob.update({
      where: { id: existingJob.id },
      data: {
        status: 'waiting_optical', stage: 'client_ready', clientIdServicio, clientName: client.nombre,
        ip, serial, reservationToken: token, steps: JSON.stringify([...steps, step].slice(-100)), errorMessage: null,
      },
    });
  } else {
    job = await prisma.provisioningJob.create({
      data: {
        idempotencyKey: `olt-${serial}-${crypto.randomUUID()}`, mode: 'existing_client', status: 'waiting_optical',
        stage: 'client_ready', clientIdServicio, clientName: client.nombre, ip, serial,
        reservationToken: token, steps: JSON.stringify([step]), createdById: req.session.userId, createdBy: req.session.username,
      },
    });
  }
  const updatedClient = await prisma.client.update({
    where: { idServicio: clientIdServicio }, data: { ip, snOnu: serial },
    select: { idServicio: true, nombre: true, usuario: true, telefono: true, ip: true, snOnu: true, planInternetName: true },
  });
  await prisma.ipReservation.update({
    where: { token }, data: { clientName: client.nombre, serial },
  });
  await logActivity(req, {
    action: 'provisioning_ip_assigned', entityType: 'client', entityId: clientIdServicio, entityName: client.nombre,
    details: { ip, serial, wisphubChanged, mikrotikAction, availabilityCheck, jobId: job.id },
  });
  res.json({ ok: true, client: updatedClient, reservation, job: provisioningJobDto(job), wisphubChanged, mikrotikAction, availabilityCheck });
}));

provisioningRouter.get('/jobs', asyncHandler(async (req, res) => {
  const status = String(req.query.status || '').trim();
  const rows = await prisma.provisioningJob.findMany({
    where: status ? { status } : {}, orderBy: { updatedAt: 'desc' }, take: 200,
  });
  res.json(rows.map(provisioningJobDto));
}));

provisioningRouter.get('/jobs/:id', asyncHandler(async (req, res) => {
  const job = await prisma.provisioningJob.findUnique({ where: { id: String(req.params.id) } });
  if (!job) return res.status(404).json({ error: 'Instalación no encontrada' });
  res.json(provisioningJobDto(job));
}));

provisioningRouter.get('/jobs/:id/onu-inventory', asyncHandler(async (req, res) => {
  const job = await prisma.provisioningJob.findUnique({ where: { id: String(req.params.id) } });
  if (!job) return res.status(404).json({ error: 'Instalación no encontrada' });
  const result = agentInventoryDto(job);
  if (!result) return res.status(404).json({ error: 'El expediente aun no tiene inventario del agente' });
  res.json(result);
}));

provisioningRouter.post('/jobs/:id/onu-inventory', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const job = await prisma.provisioningJob.findUnique({ where: { id } });
  if (!job) return res.status(404).json({ error: 'Instalación no encontrada' });
  if (!job.serial) return res.status(409).json({ error: 'El expediente no tiene serial ONU' });
  const phase = String(req.body?.phase || 'inspection').trim().toLowerCase();
  if (!['inspection', 'pre_provision', 'post_provision'].includes(phase)) {
    return res.status(400).json({ error: 'Fase de inventario inválida' });
  }
  const inventory = normalizeOnuAgentInventory(req.body?.inventory, job.serial, {
    phase,
    agentVersion: req.body?.agentVersion,
    host: req.body?.host,
  });
  const capturedAt = new Date(inventory.collected_at);
  const updated = await prisma.provisioningJob.update({
    where: { id },
    data: {
      agentInventoryJson: JSON.stringify(inventory), agentInventoryAt: capturedAt,
      agentVersion: inventory.agent_version, agentInventoryPhase: phase,
      model: job.model || inventory.device.model,
      macAddress: job.macAddress || inventory.device.mac || inventory.ethernet.mac,
    },
  });
  await logActivity(req, {
    action: 'onu_agent_inventory_saved', entityType: 'provisioning_job', entityId: id,
    entityName: job.clientName || job.serial,
    details: { serial: job.serial, phase, agentVersion: inventory.agent_version, partial: Object.keys(inventory.errors).length > 0 },
  });
  res.json(agentInventoryDto(updated));
}));

async function provisioningCancellationContext(id) {
  const job = await prisma.provisioningJob.findUnique({ where: { id } });
  if (!job) return null;
  const [reservation, configuredOnu] = await Promise.all([
    job.reservationToken
      ? prisma.ipReservation.findUnique({ where: { token: job.reservationToken } })
      : null,
    job.serial
      ? prisma.oltOnu.findFirst({ where: { serial: normalizeSerial(job.serial) } })
      : null,
  ]);
  return { job, reservation, configuredOnu, preview: buildProvisioningCancellationPreview(job, reservation, configuredOnu) };
}

provisioningRouter.get('/jobs/:id/cancellation-preview', requireRole(['admin']), asyncHandler(async (req, res) => {
  const context = await provisioningCancellationContext(String(req.params.id));
  if (!context) return res.status(404).json({ error: 'Instalación no encontrada' });
  res.json({ job: provisioningJobDto(context.job), ...context.preview });
}));

provisioningRouter.post('/jobs/:id/cancel', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const context = await provisioningCancellationContext(id);
  if (!context) return res.status(404).json({ error: 'Instalación no encontrada' });
  if (!context.preview.allowed) {
    return res.status(409).json({
      error: context.preview.alreadyCancelled
        ? 'La instalacion ya esta cancelada'
        : 'La ONU ya tiene cambios en la OLT; requiere una baja controlada',
      preview: context.preview,
    });
  }
  if (String(req.body?.confirmation || '').trim().toUpperCase() !== context.preview.requiredConfirmation) {
    return res.status(400).json({ error: `Escriba ${context.preview.requiredConfirmation} para confirmar` });
  }

  let steps = [];
  try { steps = JSON.parse(context.job.steps || '[]'); } catch {}
  const now = new Date();
  steps.push({
    stage: 'cancelled', status: 'complete',
    message: context.preview.operation === 'close' ? 'Expediente cerrado por el operador' : 'Instalacion cancelada por el operador',
    at: now.toISOString(), source: 'web',
  });
  const operations = [
    prisma.provisioningJob.update({
      where: { id },
      data: {
        status: 'cancelled', stage: 'cancelled', steps: JSON.stringify(steps.slice(-100)),
        errorMessage: null, completedAt: now,
      },
    }),
  ];
  if (context.preview.reservationAction === 'release' && context.reservation) {
    operations.push(prisma.ipReservation.update({
      where: { token: context.reservation.token },
      data: { status: 'released', releasedAt: now },
    }));
  }
  const [updated] = await prisma.$transaction(operations);
  await logActivity(req, {
    action: context.preview.operation === 'close' ? 'provisioning_job_closed' : 'provisioning_job_cancelled',
    entityType: 'provisioning_job', entityId: id,
    entityName: context.job.clientName || context.job.serial || context.job.ip || id,
    details: {
      previousStatus: context.job.status, previousStage: context.job.stage,
      clientIdServicio: context.job.clientIdServicio, serial: context.job.serial,
      reservationAction: context.preview.reservationAction,
      servicePreserved: context.preview.servicePreserved,
    },
  });
  res.json({
    ok: true,
    job: provisioningJobDto(updated),
    reservationReleased: context.preview.reservationAction === 'release',
    servicePreserved: context.preview.servicePreserved,
    warnings: context.preview.warnings,
  });
}));

async function replacementRetirementContext(id) {
  const job = await prisma.provisioningJob.findUnique({ where: { id } });
  if (!job) return null;
  const [previousOnu, newOnu] = await Promise.all([
    job.previousOnuIndex ? prisma.oltOnu.findUnique({ where: { onuIndex: job.previousOnuIndex } }) : null,
    job.onuIndex ? prisma.oltOnu.findUnique({ where: { onuIndex: job.onuIndex } }) : null,
  ]);
  const serialMatches = !job.previousSerial || normalizeSerial(previousOnu?.serial) === normalizeSerial(job.previousSerial);
  const reasons = [];
  if (job.mode !== 'replace_onu') reasons.push('El expediente no corresponde a un reemplazo de ONU');
  if (job.status !== 'complete' || !newOnu?.online) reasons.push('La ONU nueva aun no esta verificada en linea');
  if (!previousOnu) reasons.push('La ONU anterior ya no existe en el inventario OLT');
  if (previousOnu?.online) reasons.push('La ONU anterior sigue en linea; desconectela antes de retirarla');
  if (!serialMatches) reasons.push('El serial de la ONU anterior no coincide con el respaldo del expediente');
  return {
    job, previousOnu, newOnu,
    preview: {
      allowed: reasons.length === 0,
      reasons,
      previousOnu: previousOnu ? { onuIndex: previousOnu.onuIndex, serial: previousOnu.serial, online: previousOnu.online } : null,
      newOnu: newOnu ? { onuIndex: newOnu.onuIndex, serial: newOnu.serial, online: newOnu.online } : null,
      preserved: ['Cliente WispHub', 'Facturas', 'IP del servicio', 'Cola y velocidad MikroTik'],
      requiredConfirmation: job.previousOnuIndex ? `RETIRAR ${job.previousOnuIndex}` : '',
    },
  };
}

provisioningRouter.get('/jobs/:id/retire-preview', requireRole(['admin']), asyncHandler(async (req, res) => {
  const context = await replacementRetirementContext(String(req.params.id));
  if (!context) return res.status(404).json({ error: 'Expediente no encontrado' });
  res.json({ job: provisioningJobDto(context.job), ...context.preview });
}));

provisioningRouter.post('/jobs/:id/retire-previous-onu', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const context = await replacementRetirementContext(id);
  if (!context) return res.status(404).json({ error: 'Expediente no encontrado' });
  if (!context.preview.allowed) return res.status(409).json({ error: context.preview.reasons.join('. '), preview: context.preview });
  if (String(req.body?.confirmation || '').trim().toUpperCase() !== context.preview.requiredConfirmation) {
    return res.status(400).json({ error: `Escriba ${context.preview.requiredConfirmation} para confirmar` });
  }
  if (oltMutationInProgress) return res.status(409).json({ error: 'Ya existe una operación OLT en curso' });
  if (oltSyncInProgress) await oltSyncInProgress.catch(() => {});
  const [ponIndex, onuIdText] = context.previousOnu.onuIndex.split(':');
  const client = createOltClient();
  oltMutationInProgress = true;
  try {
    await client.rollbackProvisioning(ponIndex, Number(onuIdText));
    const now = new Date();
    let steps = [];
    try { steps = JSON.parse(context.job.steps || '[]'); } catch {}
    steps.push({ stage: 'old_onu_retired', status: 'complete', message: `ONU anterior ${context.previousOnu.onuIndex} retirada; servicio comercial preservado`, at: now.toISOString(), source: 'olt' });
    await prisma.$transaction([
      prisma.provisioningJob.update({ where: { id }, data: { cutoverStatus: 'old_onu_retired', steps: JSON.stringify(steps.slice(-100)) } }),
      prisma.clientCpeHistory.updateMany({ where: { jobId: id }, data: { status: 'complete', completedAt: now, newOnuIndex: context.newOnu.onuIndex } }),
    ]);
    await logActivity(req, {
      action: 'olt_previous_onu_retired', entityType: 'olt', entityId: context.previousOnu.onuIndex,
      entityName: context.job.clientName || context.previousOnu.serial,
      details: { jobId: id, clientIdServicio: context.job.clientIdServicio, previousSerial: context.previousOnu.serial, newSerial: context.newOnu.serial, preserved: context.preview.preserved },
    });
    setTimeout(() => runOltSync({ forceInventory: true }).catch((error) => console.warn('[olt] post-retirement sync warning:', error.message)), 500);
    res.json({ ok: true, message: 'ONU anterior retirada. WispHub, facturas, IP y MikroTik permanecen sin cambios.', preserved: context.preview.preserved });
  } finally {
    client.close();
    oltMutationInProgress = false;
  }
}));

provisioningRouter.post('/jobs', asyncHandler(async (req, res) => {
  const input = req.body || {};
  const mode = String(input.mode || 'new_client');
  const serviceMode = String(input.serviceMode || 'router').toLowerCase();
  let ip = input.ip == null ? null : String(input.ip).trim();
  let serial = cleanProvisioningSerial(input.serial);
  let idempotencyKey = String(input.idempotencyKey || crypto.randomUUID()).trim().slice(0, 120);
  if (ip && !isValidIpv4(ip)) return res.status(400).json({ error: 'IP inválida' });
  if (!SERVICE_OPERATION_MODES.has(mode)) {
    return res.status(400).json({ error: 'Modo de instalación inválido' });
  }
  if (!['router', 'bridge'].includes(serviceMode)) return res.status(400).json({ error: 'Perfil de servicio inválido' });
  if (serviceMode === 'bridge') ip = null;
  if (mode === 'new_client' && serviceMode === 'router' && !ip) return res.status(400).json({ error: 'El perfil Router requiere una IP reservada' });
  const existing = await prisma.provisioningJob.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (mode !== 'migrate_pon' || ['draft', 'in_progress', 'waiting_optical', 'partial', 'failed'].includes(existing.status)) {
      return res.json(provisioningJobDto(existing));
    }
    idempotencyKey = `${idempotencyKey.slice(0, 106)}:${crypto.randomUUID().slice(0, 8)}`;
  }

  let operationContext = null;
  let existingClient = null;
  if (mode !== 'new_client') {
    const clientIdServicio = Number(input.clientIdServicio);
    if (!Number.isInteger(clientIdServicio) || clientIdServicio <= 0) return res.status(400).json({ error: 'Seleccione un cliente existente' });
    existingClient = await prisma.client.findUnique({ where: { idServicio: clientIdServicio } });
    if (!existingClient) return res.status(404).json({ error: 'Cliente existente no encontrado' });
    const currentOnu = await prisma.oltOnu.findFirst({
      where: { OR: [{ clientIdServicio }, ...(existingClient.snOnu ? [{ serial: normalizeSerial(existingClient.snOnu) }] : [])] },
      orderBy: [{ online: 'desc' }, { lastSeenAt: 'desc' }],
    });
    try {
      operationContext = prepareExistingServiceOperation({
        mode, client: existingClient, currentOnu, detectedSerial: serial,
        targetPonIndex: input.targetPonIndex, reason: input.operationReason,
      });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message });
    }
    const assignedToAnotherClient = await prisma.oltOnu.findFirst({
      where: { serial: operationContext.serial, clientIdServicio: { not: null, notIn: [clientIdServicio] } },
    });
    if (assignedToAnotherClient) return res.status(409).json({ error: `El serial ${operationContext.serial} pertenece a otro cliente en la OLT` });
    ip = operationContext.ip;
    serial = operationContext.serial;
  }
  if (serviceMode === 'bridge') ip = null;

  let reservation = null;
  if (mode === 'new_client' && serviceMode === 'router' && ip) {
    reservation = await prisma.ipReservation.findUnique({ where: { token: String(input.reservationToken || '') } });
    if (!reservation || reservation.ip !== ip || reservation.status !== 'active' || reservation.expiresAt <= new Date()) {
      return res.status(409).json({ error: 'La IP requiere una reserva activa válida' });
    }
  }
  if (reservation?.token) {
    const resumable = await prisma.provisioningJob.findFirst({
      where: {
        reservationToken: reservation.token,
        source: 'onu_studio',
        status: { in: ['in_progress', 'waiting_optical', 'partial', 'failed'] },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (resumable) return res.json(provisioningJobDto(resumable));
  }
  const speed = existingClient ? inferredPlanSpeed(existingClient.planInternetName) : null;
  const jobData = {
      idempotencyKey, mode, serviceMode,
      source: input.source === 'onu_studio' ? 'onu_studio' : 'manual',
      status: 'in_progress', stage: operationContext ? 'client_selected' : serial ? 'onu_detected' : 'draft',
      clientIdServicio: operationContext?.clientIdServicio ?? (input.clientIdServicio != null && Number.isInteger(Number(input.clientIdServicio)) ? Number(input.clientIdServicio) : null),
      clientName: operationContext?.clientName || String(input.clientName || '').trim().slice(0, 160) || null,
      ip, zoneId: operationContext?.zoneId ?? (input.zoneId != null && Number.isInteger(Number(input.zoneId)) ? Number(input.zoneId) : null),
      planId: operationContext?.planId ?? (input.planId != null && Number.isInteger(Number(input.planId)) ? Number(input.planId) : null),
      uploadMbps: operationContext ? speed : input.uploadMbps != null && Number.isFinite(Number(input.uploadMbps)) ? Number(input.uploadMbps) : null,
      downloadMbps: operationContext ? speed : input.downloadMbps != null && Number.isFinite(Number(input.downloadMbps)) ? Number(input.downloadMbps) : null,
      serial, model: String(input.model || '').trim().slice(0, 80) || null,
      previousSerial: operationContext?.previousSerial || null,
      previousOnuIndex: operationContext?.previousOnuIndex || null,
      targetPonIndex: operationContext?.targetPonIndex || null,
      operationReason: operationContext?.operationReason || null,
      cutoverStatus: operationContext?.cutoverStatus || null,
      macAddress: String(input.macAddress || '').trim().toUpperCase().slice(0, 32) || null,
      vlan: Math.min(4094, Math.max(1, Number(input.vlan) || 101)),
      reservationToken: reservation?.token || null,
      configurationManifestJson: input.configurationManifest ? JSON.stringify(sanitizeConfigurationManifest(input.configurationManifest)) : null,
      steps: JSON.stringify([{ stage: operationContext ? 'client_selected' : serial ? 'onu_detected' : 'draft', status: 'complete', message: operationContext ? 'Cliente existente seleccionado; WispHub, facturas, IP y MikroTik protegidos' : null, at: new Date().toISOString(), source: input.source || 'web' }]),
      createdById: req.session.userId, createdBy: req.session.username,
  };
  const created = await prisma.$transaction(async (tx) => {
    const job = await tx.provisioningJob.create({ data: jobData });
    if (operationContext) {
      await tx.clientCpeHistory.create({ data: {
        clientIdServicio: operationContext.clientIdServicio, jobId: job.id, operation: mode,
        reason: operationContext.operationReason, ip: operationContext.ip,
        previousSerial: operationContext.previousSerial, previousOnuIndex: operationContext.previousOnuIndex,
        newSerial: operationContext.serial, targetPonIndex: operationContext.targetPonIndex,
        detailsJson: JSON.stringify({ preserved: operationContext.preserved }), startedBy: req.session.username,
      } });
    }
    return job;
  });
  await logActivity(req, {
    action: 'provisioning_job_created', entityType: 'provisioning_job', entityId: created.id,
    entityName: created.clientName || created.serial || created.ip || created.id,
    details: { mode: created.mode, ip: created.ip, serial: created.serial, previousSerial: created.previousSerial, previousOnuIndex: created.previousOnuIndex, stage: created.stage },
  });
  res.status(201).json({ ...provisioningJobDto(created), preserved: operationContext?.preserved || null });
}));

provisioningRouter.patch('/jobs/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const current = await prisma.provisioningJob.findUnique({ where: { id } });
  if (!current) return res.status(404).json({ error: 'Instalación no encontrada' });
  const allowedStatuses = ['in_progress', 'waiting_optical', 'partial', 'failed', 'complete', 'cancelled'];
  const status = req.body?.status == null ? current.status : String(req.body.status);
  if (!allowedStatuses.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  const stage = String(req.body?.stage || current.stage).trim().slice(0, 80);
  const cutoverStatus = req.body?.cutoverStatus == null ? current.cutoverStatus : String(req.body.cutoverStatus).trim().slice(0, 80);
  let steps = [];
  try { steps = JSON.parse(current.steps || '[]'); } catch {}
  if (req.body?.step) {
    steps.push({ stage, status: String(req.body.step.status || 'complete'), message: String(req.body.step.message || '').slice(0, 500), at: new Date().toISOString(), source: String(req.body.step.source || 'web') });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const job = await tx.provisioningJob.update({
      where: { id },
      data: {
      status, stage, steps: JSON.stringify(steps.slice(-100)),
      cutoverStatus,
      errorMessage: req.body?.errorMessage == null ? current.errorMessage : undefined,
      ponIndex: req.body?.ponIndex == null ? current.ponIndex : String(req.body.ponIndex).slice(0, 40),
      onuIndex: req.body?.onuIndex == null ? current.onuIndex : String(req.body.onuIndex).slice(0, 50),
      completedAt: status === 'complete' ? new Date() : null,
      ...(req.body?.configurationManifest ? { configurationManifestJson: JSON.stringify(sanitizeConfigurationManifest(req.body.configurationManifest)) } : {}),
      ...agentStateUpdate(current, req.body),
      },
    });
    if (current.mode !== 'new_client') {
      await tx.clientCpeHistory.updateMany({
        where: { jobId: id },
        data: {
          status: status === 'complete' ? 'complete' : status === 'cancelled' ? 'cancelled' : status === 'partial' || status === 'failed' ? 'attention' : 'in_progress',
          newOnuIndex: job.onuIndex,
          completedAt: status === 'complete' ? new Date() : null,
        },
      });
    }
    return job;
  });
  if (status === 'complete' && updated.reservationToken) {
    await prisma.ipReservation.updateMany({
      where: { token: updated.reservationToken, status: 'active' },
      data: { status: 'committed', committedAt: new Date() },
    });
  }
  res.json(provisioningJobDto(updated));
}));

app.use('/provisioning', provisioningRouter);

// Alta verificada de clientes. WispHub es el sistema comercial principal y
// MikroTik se valida inmediatamente para no reportar un alta incompleta.
const clientProvisioningRouter = express.Router();
const clientProvisioningInProgress = new Set();
clientProvisioningRouter.use(authMiddleware);
clientProvisioningRouter.use(requireRole(['admin']));

async function wisphubApiRequest(pathName, options = {}) {
  if (!API_KEY) throw Object.assign(new Error('WISPHUB_API_KEY no esta configurada'), { statusCode: 503 });
  const { timeoutMs = 15_000, ...fetchOptions } = options;
  const response = await fetch(`https://api.wisphub.io/api/${pathName.replace(/^\/+/, '')}`, {
    ...fetchOptions,
    headers: {
      Authorization: `Api-Key ${API_KEY}`,
      Accept: 'application/json',
      ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await readWisphubResponse(response);
  if (!response.ok) {
    const detail = payload.detail || payload.error || payload.errors || JSON.stringify(payload);
    throw Object.assign(new Error(String(detail || `WispHub HTTP ${response.status}`).slice(0, 600)), {
      statusCode: response.status >= 500 ? 502 : response.status,
    });
  }
  return payload;
}

async function findWisphubClientByIp(ip) {
  const page = await wisphubApiRequest(`clientes/?ip=${encodeURIComponent(ip)}&limit=10`);
  const rows = Array.isArray(page.results) ? page.results.filter((row) => String(row.ip || '').trim() === ip) : [];
  if (!rows.length) return null;
  const detail = await wisphubApiRequest(`clientes/${Number(rows[0].id_servicio)}/`);
  return { list: rows[0], detail };
}

async function waitForWisphubClient(ip, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const client = await findWisphubClientByIp(ip);
    if (client) return client;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return null;
}

async function ensureProvisionedQueue(input, idServicio) {
  return mtSerialize(async () => {
    const connection = await getMtConnection();
    const target = `${input.ip}/32`;
    const queues = await mtWrite(connection, 10_000, '/queue/simple/print');
    const existing = queues.find((queue) => queue.target === target);
    const desiredComment = `ISP max | WispHub #${idServicio}`;
    const desiredLimit = `${input.queue.uploadBps}/${input.queue.downloadBps}`;
    if (existing) {
      const needsUpdate = existing.name !== input.serviceName
        || existing['max-limit'] !== desiredLimit
        || existing.disabled === 'true';
      if (needsUpdate) {
        await mtWrite(connection, 10_000, '/queue/simple/set', `=.id=${existing['.id']}`,
          ...queueWriteArguments({ ...input.queue, comment: desiredComment, disabled: false }));
      }
      mtInvalidate('queues');
      mtInvalidate('clients-live');
      mtInvalidate('unknown-devices');
      return { action: needsUpdate ? 'updated' : 'verified', id: existing['.id'], target, maxLimit: desiredLimit };
    }

    const result = await mtWrite(connection, 10_000, '/queue/simple/add',
      ...queueWriteArguments({ ...input.queue, comment: desiredComment, disabled: false }));
    mtInvalidate('queues');
    mtInvalidate('clients-live');
    mtInvalidate('unknown-devices');
    return { action: 'created', id: result[0]?.ret || null, target, maxLimit: desiredLimit };
  });
}

async function saveProvisionedClientLocally(wisphubClient, input, queueResult) {
  const remote = { ...wisphubClient.list };
  if (!remote.nombre && !remote.servicio) remote.servicio = input.serviceName;
  const queue = {
    name: input.serviceName,
    target: `${input.ip}/32`,
    'max-limit': queueResult.maxLimit,
  };
  const network = { queue, arpEntry: null, mikrotikAvailable: true };
  const createData = mapWisphubClient(remote, network, { forCreate: true });
  const updateData = mapWisphubClient(remote, network);
  if (!createData.nombre) createData.nombre = input.serviceName;
  const sourceHash = sourceStateHash(createData);
  await prisma.client.upsert({
    where: { idServicio: Number(remote.id_servicio) },
    create: { ...createData, sourceHash },
    update: { ...updateData, sourceHash },
  });
  return prisma.client.findUnique({ where: { idServicio: Number(remote.id_servicio) } });
}

async function updateProvisionedClientProfile(idServicio, input) {
  const profile = input.profile;
  if (!Object.values(profile).some(Boolean)) return { attempted: false, ok: true };
  const parts = input.serviceName.trim().split(/\s+/);
  try {
    await wisphubApiRequest(`clientes/${idServicio}/perfil/`, {
      method: 'PUT',
      body: JSON.stringify({
        nombre: parts[0] || input.serviceName,
        apellidos: parts.slice(1).join(' ') || '-',
        telefono: profile.phone || '0000000000',
        cedula: profile.nationalId || '-',
        email: profile.email || 'na@na.com',
        direccion: profile.address || '-',
        localidad: profile.city || '-',
        ciudad: profile.city || '-',
      }),
    });
    return { attempted: true, ok: true };
  } catch (error) {
    return { attempted: true, ok: false, warning: error.message };
  }
}

async function readExternalWisphubClient(idServicio) {
  const [detail, profile] = await Promise.all([
    wisphubApiRequest(`clientes/${idServicio}/`),
    wisphubApiRequest(`clientes/${idServicio}/perfil/`),
  ]);
  return { detail, profile };
}

async function awaitWisphubWrite(pathName, method, body, subject) {
  const response = await wisphubApiRequest(pathName, { method, body: JSON.stringify(body) });
  const taskId = response.task_id || response.task?.id || null;
  if (taskId) {
    const result = await waitForWisphubTask(taskId, 40, 750, subject);
    const resultError = taskResultError(result);
    if (resultError) throw new Error(resultError);
  }
  return response;
}

function externalProfilePayload(snapshot) {
  const parts = snapshot.profile.displayName.trim().split(/\s+/);
  return {
    nombre: parts[0],
    apellidos: parts.slice(1).join(' '),
    telefono: snapshot.profile.phone,
    cedula: snapshot.profile.nationalId,
    email: snapshot.profile.email,
    direccion: snapshot.profile.address,
    localidad: snapshot.profile.city,
    ciudad: snapshot.profile.city,
  };
}

async function writeAndConfirmWisphub(pathName, method, body, subject, read, confirmed) {
  let writeError = null;
  try {
    await awaitWisphubWrite(pathName, method, body, subject);
  } catch (error) {
    writeError = error;
  }
  const current = await read();
  if (confirmed(current)) return current;
  if (writeError) throw writeError;
  throw Object.assign(new Error(`WispHub no confirmo ${subject}`), { statusCode: 502 });
}

async function updateExternalWisphubClient({ idServicio, section, changes, before }) {
  const read = () => readExternalWisphubClient(idServicio);
  const beforeSnapshot = externalSnapshot(before, idServicio);
  if (section === 'profile') {
    const desired = JSON.parse(JSON.stringify(beforeSnapshot));
    Object.assign(desired.profile, changes);
    const desiredProfile = externalProfilePayload(desired);
    await writeAndConfirmWisphub(
      `clientes/${idServicio}/perfil/`, 'PUT', desiredProfile, 'la edicion del perfil', read,
      (raw) => Object.entries(changes).every(([field, value]) => externalSnapshot(raw, idServicio).profile[field] === value),
    );
    if (Object.hasOwn(changes, 'displayName')) {
      try {
        await writeAndConfirmWisphub(
          `clientes/${idServicio}/`, 'PATCH', { usuario_rb: changes.displayName }, 'el nombre del servicio', read,
          (raw) => String(raw.detail?.nombre || raw.detail?.servicio || '').trim() === changes.displayName,
        );
      } catch (error) {
        let rolledBack = false;
        try {
          await writeAndConfirmWisphub(
            `clientes/${idServicio}/perfil/`, 'PUT', externalProfilePayload(beforeSnapshot), 'la restauracion del perfil', read,
            (raw) => externalSnapshot(raw, idServicio).profile.displayName === beforeSnapshot.profile.displayName,
          );
          rolledBack = true;
        } catch {}
        throw Object.assign(new Error(rolledBack
          ? 'No se cambio el nombre del servicio; el perfil fue restaurado'
          : 'WispHub aplico el perfil parcialmente y requiere revision'), {
          statusCode: 502,
          code: rolledBack ? 'WISPHUB_ROLLED_BACK' : 'WISPHUB_PARTIAL_UPDATE',
          cause: error,
        });
      }
    }
    return read();
  }

  const remoteFields = {
    ip: 'ip', macCpe: 'mac_cpe', lanInterface: 'interfaz_lan', onuSerial: 'sn_onu',
    wifiSsid: 'ssid_router_wifi', wifiPassword: 'password_ssid_router_wifi', comments: 'comentarios',
  };
  const payload = Object.fromEntries(Object.entries(changes).map(([field, value]) => [remoteFields[field], value]));
  const result = await writeAndConfirmWisphub(
    `clientes/${idServicio}/`, 'PATCH', payload, 'la edicion del servicio', read,
    (raw) => Object.entries(payload).every(([field, value]) => String(raw.detail?.[field] ?? '').trim() === value),
  );
  return { ...result, secretVerified: !Object.hasOwn(changes, 'wifiPassword') || String(result.detail?.password_ssid_router_wifi || '').trim() === changes.wifiPassword };
}

function wisphubTicketForm(input, creating) {
  const form = new FormData();
  form.set('servicio', String(input.clientId));
  form.set('asunto', input.subject);
  form.set(creating ? 'asuntos_default' : 'asunto_default', input.subject);
  form.set('tecnico', String(input.technicianId));
  form.set('descripcion', input.description);
  form.set('estado', String(input.state));
  form.set('prioridad', String(input.priority));
  return form;
}

async function readWisphubTicket(idTicket) {
  return wisphubApiRequest(`tickets/${Number(idTicket)}/`, { timeoutMs: 20_000 });
}

async function writeWisphubTicket(idTicket, input) {
  const creating = idTicket == null;
  const response = await wisphubApiRequest(creating ? 'tickets/' : `tickets/${Number(idTicket)}/`, {
    method: creating ? 'POST' : 'PUT',
    body: wisphubTicketForm(input, creating),
    timeoutMs: 30_000,
  });
  let result = response;
  const taskId = response?.task_id || response?.task?.id;
  if (taskId) result = await waitForWisphubTask(taskId, 30, 1000, creating ? 'la creacion del ticket' : 'la edicion del ticket');
  const confirmedId = Number(idTicket || result?.id_ticket || result?.id || response?.id_ticket || response?.id);
  if (!Number.isSafeInteger(confirmedId) || confirmedId < 1) {
    throw Object.assign(new Error('WispHub no devolvio el ID del ticket creado'), { status: 502, code: 'WISPHUB_TICKET_ID_MISSING' });
  }
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await readWisphubTicket(confirmedId); }
    catch (error) { lastError = error; if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 700)); }
  }
  throw lastError;
}

async function handleClientProvisioning(req, res) {
  let input;
  try {
    input = sanitizeClientProvisioning(req.body, process.env.MIKROTIK_CLIENT_NETWORKS || process.env.MIKROTIK_CLIENT_CIDRS);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }
  if (clientProvisioningInProgress.has(input.ip)) {
    return res.status(409).json({ error: `Ya hay un alta en curso para ${input.ip}` });
  }

  const jobId = req.body?.jobId ? String(req.body.jobId) : null;
  let provisioningJob = null;
  let reservation = null;
  if (jobId) {
    provisioningJob = await prisma.provisioningJob.findUnique({ where: { id: jobId } });
    if (!provisioningJob) return res.status(404).json({ error: 'Instalación no encontrada' });
    if (provisioningJob.ip !== input.ip) return res.status(409).json({ error: 'La IP no coincide con la instalación' });
    reservation = provisioningJob.reservationToken
      ? await prisma.ipReservation.findUnique({ where: { token: provisioningJob.reservationToken } })
      : null;
    if (!reservation || reservation.ip !== input.ip || reservation.status !== 'active' || reservation.expiresAt <= new Date()) {
      return res.status(409).json({ error: 'La reserva de IP de la instalación vencio o no es válida' });
    }
  } else if (req.body?.reservationToken) {
    reservation = await prisma.ipReservation.findUnique({ where: { token: String(req.body.reservationToken) } });
    if (!reservation || reservation.ip !== input.ip || reservation.status !== 'active' || reservation.expiresAt <= new Date()) {
      return res.status(409).json({ error: 'La reserva de IP vencio o no es válida' });
    }
    if (reservation.createdById !== req.session.userId && !userHasRole(req.session, ['admin'])) {
      return res.status(403).json({ error: 'La reserva pertenece a otro técnico' });
    }
  }

  let wisphubClient = null;
  let wisphubCreated = false;
  let wisphubTaskWarning = null;
  let taskId = null;
  let queueResult = null;
  clientProvisioningInProgress.add(input.ip);
  try {
    if (jobId) {
      await prisma.provisioningJob.update({ where: { id: jobId }, data: { status: 'in_progress', stage: 'client_validating', errorMessage: null } });
    }
    // Fail before creating in WispHub if the router cannot be reached.
    const connection = await getMtConnection();
    const initialQueues = await mtWrite(connection, 10_000, '/queue/simple/print');
    const initialQueue = initialQueues.find((queue) => queue.target === `${input.ip}/32`);
    wisphubClient = await findWisphubClientByIp(input.ip);

    if (wisphubClient) {
      if (!matchesExistingWisphubClient(wisphubClient.detail, input)) {
        return res.status(409).json({
          error: `La IP ${input.ip} ya pertenece a otro cliente o tiene un plan/zona diferente en WispHub`,
          existingIdServicio: wisphubClient.detail.id_servicio,
        });
      }
    } else {
      if (jobId) {
        const report = await fetchLiveIpamReport(reservation?.cidr ? { cidrs: [reservation.cidr] } : {});
        const address = report.rows.find((row) => row.ip === input.ip);
        if (!address?.available || !address.cidr) {
          throw Object.assign(new Error(`${input.ip} dejo de estar disponible`), { statusCode: 409 });
        }
        if (address.availabilityConfidence === 'probe_required') {
          const pingRows = await mtWrite(
            connection, 8_000, '/ping', `=address=${input.ip}`, '=count=3',
            ...(address.interface ? [`=interface=${address.interface}`] : []),
            '=arp-ping=yes',
          );
          const summary = pingRows.find((item) => item['packet-loss'] != null);
          const occupied = pingRows.some((item) => item.time && !item.status) || Number(summary?.received || 0) > 0;
          if (occupied) {
            throw Object.assign(new Error(`${input.ip} respondio al sondeo y no puede asignarse`), { statusCode: 409 });
          }
        }
      }
      if (initialQueue) {
        return res.status(409).json({ error: `La IP ${input.ip} ya tiene la cola ${initialQueue.name} en MikroTik` });
      }
      const creation = await wisphubApiRequest(`clientes/agregar-cliente/${input.zoneId}/`, {
        method: 'POST',
        body: JSON.stringify({ ip: input.ip, usuario_rb: input.serviceName, plan_internet: input.planId }),
      });
      taskId = creation.task_id || creation.task?.id || null;
      if (!taskId) throw new Error('WispHub no devolvio task_id para el alta');
      try {
        const taskResult = await waitForWisphubTask(taskId, 40, 1000, 'el alta del cliente');
        const resultError = taskResultError(taskResult);
        if (resultError) throw new Error(resultError);
      } catch (taskError) {
        // WispHub can persist the client and still report a router-side failure.
        // In that case we continue and repair MikroTik ourselves.
        wisphubTaskWarning = taskError.message;
      }
      wisphubClient = await waitForWisphubClient(input.ip);
      if (!wisphubClient) {
        throw new Error(wisphubTaskWarning || 'WispHub termino la tarea, pero el cliente no aparece en el listado');
      }
      wisphubCreated = true;
    }

    const idServicio = Number(wisphubClient.detail.id_servicio || wisphubClient.list.id_servicio);
    if (jobId) {
      await prisma.provisioningJob.update({ where: { id: jobId }, data: { stage: 'wisphub_ready', clientIdServicio: idServicio } });
    }
    const profile = await updateProvisionedClientProfile(idServicio, input);
    queueResult = await ensureProvisionedQueue(input, idServicio);
    const refreshedWisphub = await findWisphubClientByIp(input.ip) || wisphubClient;
    const localClient = await saveProvisionedClientLocally(refreshedWisphub, input, queueResult);
    if (jobId) {
      const job = await prisma.provisioningJob.findUnique({ where: { id: jobId } });
      let steps = [];
      try { steps = JSON.parse(job?.steps || '[]'); } catch {}
      steps.push({ stage: 'client_ready', status: 'complete', message: `WispHub #${idServicio} y cola MikroTik verificados`, at: new Date().toISOString(), source: 'server' });
      await prisma.$transaction([
        prisma.provisioningJob.update({
          where: { id: jobId },
          data: { status: job?.serial ? 'waiting_optical' : 'complete', stage: job?.serial ? 'waiting_optical' : 'client_ready', clientIdServicio: idServicio, steps: JSON.stringify(steps), completedAt: job?.serial ? null : new Date() },
        }),
        prisma.ipReservation.updateMany({
          where: { token: provisioningJob.reservationToken, status: 'active' },
          data: { status: 'committed', committedAt: new Date() },
        }),
      ]);
    } else if (reservation?.token) {
      await prisma.ipReservation.updateMany({ where: { token: reservation.token, status: 'active' }, data: { status: 'committed', committedAt: new Date() } });
    }

    await logActivity(req, {
      action: 'client_provisioned', entityType: 'client', entityId: idServicio, entityName: input.serviceName,
      details: {
        ip: input.ip, zoneId: input.zoneId, planId: input.planId, taskId,
        wisphubCreated, queueAction: queueResult.action, queueId: queueResult.id,
        uploadMbps: input.uploadMbps, downloadMbps: input.downloadMbps, profile, wisphubTaskWarning,
      },
    });
    return res.status(wisphubCreated ? 201 : 200).json({
      ok: true,
      status: 'complete',
      resumed: !wisphubCreated,
      wisphub: { ok: true, created: wisphubCreated, idServicio, taskId, warning: wisphubTaskWarning },
      mikrotik: { ok: true, ...queueResult },
      sqlite: { ok: true, idServicio: localClient.idServicio },
      profile,
      client: localClient,
    });
  } catch (error) {
    const partial = Boolean(wisphubClient || wisphubCreated);
    if (jobId) {
      await prisma.provisioningJob.update({
        where: { id: jobId }, data: { status: partial ? 'partial' : 'failed', stage: partial ? 'client_partial' : 'client_failed', errorMessage: String(error.message || error).slice(0, 1000) },
      }).catch(() => {});
    }
    await logActivity(req, {
      action: partial ? 'client_provision_partial' : 'client_provision_failed',
      entityType: 'client', entityId: wisphubClient?.detail?.id_servicio || input.ip, entityName: input.serviceName,
      details: { ip: input.ip, zoneId: input.zoneId, planId: input.planId, taskId, wisphubCreated, wisphubTaskWarning, queueResult, error: error.message },
    });
    return res.status(error.statusCode || 502).json({
      error: error.message || 'No se pudo completar el alta',
      status: partial ? 'partial' : 'failed',
      canRetry: partial,
      wisphub: { ok: partial, created: wisphubCreated, idServicio: wisphubClient?.detail?.id_servicio || null, taskId },
      mikrotik: { ok: false },
    });
  } finally {
    clientProvisioningInProgress.delete(input.ip);
  }
}
clientProvisioningRouter.post('/', asyncHandler(handleClientProvisioning));

// Limpieza de un alta nueva que fallo antes de tocar la OLT. Conserva el
// expediente como auditoria y nunca usa el serial para decidir que ONU borrar.
clientProvisioningRouter.post('/cleanup/:jobId', asyncHandler(async (req, res) => {
  const jobId = String(req.params.jobId || '');
  const job = await prisma.provisioningJob.findUnique({ where: { id: jobId } });
  if (!job) return res.status(404).json({ error: 'Instalación no encontrada' });

  const requiredConfirmation = `LIMPIAR ${jobId.slice(0, 8).toUpperCase()}`;
  if (String(req.body?.confirmation || '').trim().toUpperCase() !== requiredConfirmation) {
    return res.status(400).json({ error: `Escriba ${requiredConfirmation} para confirmar` });
  }
  if (job.mode !== 'new_client' || !['failed', 'partial'].includes(job.status)) {
    return res.status(409).json({ error: 'Solo se pueden limpiar altas nuevas fallidas o parciales' });
  }
  if (!job.clientIdServicio || !job.ip || job.ponIndex || job.onuIndex) {
    return res.status(409).json({ error: 'El expediente ya tiene cambios OLT o no identifica el servicio creado' });
  }

  const oltMapping = await prisma.oltOnu.findFirst({ where: { clientIdServicio: job.clientIdServicio } });
  if (oltMapping) {
    return res.status(409).json({ error: 'El cliente ya esta asociado a una ONU; requiere una baja controlada' });
  }

  let wisphubRemoved = false;
  let remoteClient = null;
  try {
    remoteClient = await wisphubApiRequest(`clientes/${job.clientIdServicio}/`);
  } catch (error) {
    if (error.statusCode !== 404) throw error;
    wisphubRemoved = true;
  }
  if (remoteClient) {
    if (Number(remoteClient.id_servicio) !== job.clientIdServicio || String(remoteClient.ip || '') !== job.ip) {
      return res.status(409).json({ error: 'WispHub ya no coincide con el expediente; limpieza detenida' });
    }
    const deletion = await wisphubApiRequest('clientes/eliminar-clientes/', {
      method: 'POST', timeoutMs: 240_000,
      body: JSON.stringify({ clientes: [job.clientIdServicio] }),
    });
    wisphubRemoved = true;
    if (!deletion) throw new Error('WispHub no confirmo la eliminacion');
  }

  const queueResult = await mtSerialize(async () => {
    const connection = await getMtConnection();
    const queues = await mtWrite(connection, 10_000, '/queue/simple/print', '=stats=');
    const target = `${job.ip}/32`;
    const matches = queues.filter((queue) => queue.target === target);
    if (matches.some((queue) => String(queue.bytes || '0/0') !== '0/0' || String(queue.packets || '0/0') !== '0/0')) {
      const error = new Error('La cola tiene trafico registrado; limpieza detenida');
      error.statusCode = 409;
      throw error;
    }
    for (const queue of matches) {
      await mtWrite(connection, 10_000, '/queue/simple/remove', `=.id=${queue['.id']}`);
    }
    mtInvalidate('queues');
    mtInvalidate('clients-live');
    mtInvalidate('unknown-devices');
    return { removed: matches.length, ids: matches.map((queue) => queue['.id']) };
  });

  const now = new Date();
  let steps = [];
  try { steps = JSON.parse(job.steps || '[]'); } catch {}
  steps.push({
    stage: 'cleaned', status: 'complete',
    message: `Alta fallida retirada: WispHub #${job.clientIdServicio}, MikroTik ${job.ip} e IP liberada`,
    at: now.toISOString(), source: 'web',
  });

  const operations = [
    prisma.client.deleteMany({ where: { idServicio: job.clientIdServicio } }),
    prisma.ipamAddress.updateMany({
      where: { ip: job.ip },
      data: {
        classification: 'available', available: true, recommended: true,
        clientIdServicio: null, clientName: null, clientUsername: null,
        queueId: null, queueName: null, active: true, lastChangedAt: now,
      },
    }),
    prisma.ipReservation.updateMany({
      where: { token: job.reservationToken || '', status: { in: ['active', 'committed'] } },
      data: { status: 'released', releasedAt: now },
    }),
    prisma.provisioningJob.update({
      where: { id: jobId },
      data: {
        status: 'cancelled', stage: 'cleaned', localStatus: 'cleaned', retryable: false,
        errorCode: null, errorMessage: null, steps: JSON.stringify(steps.slice(-100)), completedAt: now,
      },
    }),
  ];
  const results = await prisma.$transaction(operations);

  await logActivity(req, {
    action: 'failed_client_provision_cleaned', entityType: 'provisioning_job', entityId: jobId,
    entityName: job.clientName || String(job.clientIdServicio),
    details: {
      clientIdServicio: job.clientIdServicio, ip: job.ip, wisphubRemoved,
      mikrotikQueuesRemoved: queueResult.removed, reservationReleased: results[2].count,
    },
  });
  res.json({
    ok: true, jobId, clientIdServicio: job.clientIdServicio, ip: job.ip,
    wisphub: { removed: wisphubRemoved }, mikrotik: queueResult,
    sqlite: { clientRemoved: results[0].count, reservationReleased: results[2].count },
  });
}));

app.use('/client-provisioning', clientProvisioningRouter);

// Alta y edicion de tickets desde la web. Reusa la misma implementacion que la
// app movil (misma validacion, misma idempotencia y el mismo control de version
// contra WispHub) para que un ticket creado aqui y uno creado en el telefono
// terminen identicos. Lo unico propio es el usuario: el movil trae su sesion de
// dispositivo y aqui se toma la sesion del navegador.
const webTicketsRouter = express.Router();
webTicketsRouter.use(authMiddleware);
webTicketsRouter.use((req, res, next) => {
  req.mobileUser = { id: req.session.userId, username: req.session.username, role: req.session.role };
  next();
});
require('./lib/mobile-tickets').registerMobileTickets(webTicketsRouter, {
  prisma,
  wrap: asyncHandler,
  permission: (roles) => requireAnyRole(roles),
  positiveId: require('./lib/mobile-api').positiveId,
  provider: {
    read: readWisphubTicket,
    create: (input) => writeWisphubTicket(null, input),
    update: writeWisphubTicket,
  },
});
app.use('/tickets-api', webTicketsRouter);

// Mobile shares the same provisioning implementation so WispHub, MikroTik and
// SQLite cannot diverge between the web and Android clients.
app.use('/mobile/v1', require('./lib/mobile-api').createMobileRouter({
  prisma, billing: billingService, loginLimiter: authLimiter, provisionClient: handleClientProvisioning,
  queryIpam: ({ cidrs, userId }) => buildProvisioningIpCatalog({ cidrs: validateRequestedIpamCidrs(cidrs), userId }),
  reserveIp: handleIpReservation, releaseIp: handleIpReservationRelease,
  whatsappStatus: () => ({ status: waStatus }),
  sendWhatsapp: ({ idServicio, phone, message, messageType, clientName }) => sendWhatsappNotification(idServicio, phone, message, messageType, clientName),
  clientAction: ({ idServicio, action, reason, actor }) => applyClientAction(idServicio, action, reason, actor),
  externalClient: { read: readExternalWisphubClient, update: updateExternalWisphubClient },
  ticketProvider: { read: readWisphubTicket, create: (input) => writeWisphubTicket(null, input), update: writeWisphubTicket },
  liveNetwork: () => mtCached('clients-live:snapshot', 2500, collectLiveClients),
  mikrotikOverview: async () => {
    const configured = Boolean(MT_HOST && MT_USER && MT_PASS);
    if (!configured) return { configured: false, connected: false, error: 'MikroTik no configurado', system: null, interfaces: [], telemetry: mtCommands.snapshot() };
    try {
      const c = await getMtConnection();
      const [system, interfaces] = await Promise.all([
        mtCached('system', 5000, async () => {
          const [resource, identity, health] = await Promise.all([
            mtWrite(c, null, '/system/resource/print'), mtWrite(c, null, '/system/identity/print'),
            mtSafe('mobile system health', [], () => mtWrite(c, null, '/system/health/print')),
          ]);
          return { resource: resource[0] || {}, identity: identity[0]?.name || null, health };
        }),
        mtCached('interfaces', 10000, () => mtWrite(c, null, '/interface/print')),
      ]);
      return {
        configured: true, connected: true, error: null,
        system: {
          identity: system.identity,
          version: system.resource?.version || null, boardName: system.resource?.['board-name'] || null,
          uptime: system.resource?.uptime || null, cpuLoadPercent: Number(system.resource?.['cpu-load']) || 0,
          totalMemoryBytes: Number(system.resource?.['total-memory']) || 0, freeMemoryBytes: Number(system.resource?.['free-memory']) || 0,
          health: (system.health || []).map((row) => ({ name: row.name || null, value: row.value || null, type: row.type || null })),
        },
        interfaces: interfaces.map((row) => ({
          name: row.name || null, type: row.type || null, running: row.running === 'true', disabled: row.disabled === 'true',
          macAddress: row['mac-address'] || null, mtu: Number(row['actual-mtu'] || row.mtu) || null,
          rxBytes: Number(row['rx-byte']) || 0, txBytes: Number(row['tx-byte']) || 0,
        })),
        telemetry: mtCommands.snapshot(),
      };
    } catch (error) {
      return { configured: true, connected: false, error: String(error.message || 'MikroTik no disponible').slice(0, 300), system: null, interfaces: [], telemetry: mtCommands.snapshot() };
    }
  },
  linkTest: (options) => runClientLinkTest(options),
  surveyConfig: () => getSurveyConfig(),
  invalidateSurveyConfig: () => invalidateSurveyConfig(),
  mikrotikPing: async ({ address, count }) => {
    const c = await getMtConnection();
    const rows = await mtWrite(c, count * 1500 + 2000, '/ping', `=address=${address}`, `=count=${count}`);
    return { address, count, ...parsePingSummary(rows) };
  },
}));

// NOC: correlacion de caidas colectivas. Solo observa y registra; no modifica la red.
const NOC_ENABLED = process.env.NOC_ENABLED !== 'false';
const NOC_INTERVAL_MS = Math.max(30_000, Number(process.env.NOC_INTERVAL_MS || 60_000));
const NOC_MIN_AFFECTED = Math.max(2, Number(process.env.NOC_MIN_AFFECTED || 3));
const NOC_MIN_RATIO = Math.min(1, Math.max(0.1, Number(process.env.NOC_MIN_RATIO || 0.3)));
let nocTimer = null;
let nocEvaluationInProgress = false;
let lastNocEvaluationAt = null;
let lastNocEvaluationResult = null;

function incidentDto(incident) {
  return {
    ...incident,
    affectedClientIds: parseAffectedClientIds(incident.affectedClientIds),
  };
}

async function evaluateNocSnapshot(snapshot) {
  const startedAt = Date.now();
  const candidates = buildIncidentCandidates(snapshot.clients, {
    minAffected: NOC_MIN_AFFECTED,
    minRatio: NOC_MIN_RATIO,
  });
  const active = await prisma.networkIncident.findMany({
    where: { category: 'collective_outage', status: { in: ['open', 'acknowledged'] } },
  });
  const activeByFingerprint = new Map(active.map(item => [item.fingerprint, item]));
  const detected = new Set();
  let created = 0;
  let updated = 0;
  let resolved = 0;

  for (const candidate of candidates) {
    detected.add(candidate.fingerprint);
    const existing = activeByFingerprint.get(candidate.fingerprint);
    const data = {
      source: candidate.source,
      category: candidate.category,
      title: candidate.title,
      description: candidate.description,
      severity: candidate.severity,
      scopeType: candidate.scopeType,
      scopeKey: candidate.scopeKey,
      scopeLabel: candidate.scopeLabel,
      affectedClients: candidate.affectedClients,
      affectedClientIds: JSON.stringify(candidate.affectedClientIds),
      lastSeenAt: new Date(),
      recoveryStreak: 0,
    };
    if (existing) {
      await prisma.networkIncident.update({
        where: { id: existing.id },
        data: { ...data, detectionCount: { increment: 1 } },
      });
      updated++;
      continue;
    }
    await prisma.networkIncident.create({
      data: {
        fingerprint: candidate.fingerprint,
        ...data,
        events: {
          create: {
            type: 'detected',
            message: `${candidate.affectedClients} clientes afectados; deteccion automatica en modo observacion`,
            createdBy: 'system',
            metadata: JSON.stringify({ totalClients: candidate.totalClients, affectedRatio: candidate.affectedRatio }),
          },
        },
      },
    });
    created++;
  }

  for (const incident of active) {
    if (detected.has(incident.fingerprint)) continue;
    const recovery = nextRecoveryState(incident.recoveryStreak);
    if (!recovery.recovered) {
      await prisma.networkIncident.update({ where: { id: incident.id }, data: { recoveryStreak: recovery.streak } });
      continue;
    }
    await prisma.networkIncident.update({
      where: { id: incident.id },
      data: {
        status: 'resolved', recoveryStreak: recovery.streak, resolvedAt: new Date(), resolvedBy: 'system',
        resolutionNote: 'La presencia se recupero durante dos evaluaciones consecutivas',
        events: { create: { type: 'auto_resolved', message: 'Recuperacion confirmada en dos lecturas consecutivas', createdBy: 'system' } },
      },
    });
    resolved++;
  }

  lastNocEvaluationAt = new Date();
  lastNocEvaluationResult = {
    created, updated, resolved, candidates: candidates.length,
    durationMs: Date.now() - startedAt,
  };
  return lastNocEvaluationResult;
}

async function runNocEvaluation(snapshot = null) {
  if (!NOC_ENABLED || nocEvaluationInProgress) return { skipped: true };
  nocEvaluationInProgress = true;
  try {
    return await evaluateNocSnapshot(snapshot || await collectLiveClients());
  } finally {
    nocEvaluationInProgress = false;
  }
}

function scheduleNocEvaluation(snapshot) {
  if (!NOC_ENABLED || nocEvaluationInProgress) return;
  if (lastNocEvaluationAt && Date.now() - lastNocEvaluationAt.getTime() < NOC_INTERVAL_MS) return;
  runNocEvaluation(snapshot).catch(error => console.error('[noc] evaluation failed:', error.message));
}

function startNocLoop() {
  if (!NOC_ENABLED || !MIKROTIK_ENABLED || !MT_HOST) {
    console.log(`[noc] disabled or MikroTik unavailable (enabled=${NOC_ENABLED})`);
    return;
  }
  if (nocTimer) return;
  console.log(`[noc] collective outage detection every ${NOC_INTERVAL_MS}ms`);
  setTimeout(() => runNocEvaluation().catch(error => console.error('[noc] initial evaluation failed:', error.message)), 15_000);
  nocTimer = setInterval(() => runNocEvaluation().catch(error => console.error('[noc] evaluation failed:', error.message)), NOC_INTERVAL_MS);
}

const nocRouter = express.Router();
nocRouter.use(authMiddleware);
nocRouter.use(requireAnyRole(['tecnico']));

nocRouter.get('/summary', asyncHandler(async (req, res) => {
  const [active, open, acknowledged, critical, last24h] = await Promise.all([
    prisma.networkIncident.findMany({ where: { status: { in: ['open', 'acknowledged'] } }, select: { affectedClients: true } }),
    prisma.networkIncident.count({ where: { status: 'open' } }),
    prisma.networkIncident.count({ where: { status: 'acknowledged' } }),
    prisma.networkIncident.count({ where: { status: { in: ['open', 'acknowledged'] }, severity: 'critical' } }),
    prisma.networkIncident.count({ where: { detectedAt: { gte: new Date(Date.now() - 86_400_000) } } }),
  ]);
  res.json({
    open, acknowledged, critical, last24h,
    active: active.length,
    affectedClients: active.reduce((sum, item) => sum + item.affectedClients, 0),
    evaluator: { enabled: NOC_ENABLED, running: nocEvaluationInProgress, intervalMs: NOC_INTERVAL_MS, lastRunAt: lastNocEvaluationAt, lastResult: lastNocEvaluationResult },
  });
}));

nocRouter.get('/incidents', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize || 25)));
  const status = String(req.query.status || 'active');
  const severity = String(req.query.severity || '');
  const q = String(req.query.q || '').trim().slice(0, 100);
  const where = {
    ...(status === 'active' ? { status: { in: ['open', 'acknowledged'] } } : status !== 'all' ? { status } : {}),
    ...(severity ? { severity } : {}),
    ...(q ? { OR: [{ title: { contains: q } }, { scopeLabel: { contains: q } }, { assignedTo: { contains: q } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.networkIncident.findMany({ where, orderBy: [{ detectedAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.networkIncident.count({ where }),
  ]);
  res.json({ items: rows.map(incidentDto), total, page, pageSize });
}));

nocRouter.get('/incidents/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID de incidente inválido' });
  const incident = await prisma.networkIncident.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: 'desc' } } } });
  if (!incident) return res.status(404).json({ error: 'Incidente no encontrado' });
  const clientIds = parseAffectedClientIds(incident.affectedClientIds);
  const clients = clientIds.length ? await prisma.client.findMany({
    where: { idServicio: { in: clientIds } },
    select: { idServicio: true, nombre: true, aliasNombre: true, usuario: true, ip: true, telefono: true, zonaNombre: true },
    orderBy: { nombre: 'asc' },
  }) : [];
  res.json({ ...incidentDto(incident), clients });
}));

nocRouter.post('/evaluate', asyncHandler(async (req, res) => {
  const result = await runNocEvaluation();
  if (result.skipped) return res.status(409).json({ error: 'La evaluacion NOC ya esta en curso o esta desactivada' });
  await logActivity(req, { action: 'noc_manual_evaluation', entityType: 'network_incident', details: result });
  res.json(result);
}));

nocRouter.patch('/incidents/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID de incidente inválido' });
  const action = String(req.body?.action || '');
  const note = String(req.body?.note || '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, 500);
  const assignedTo = String(req.body?.assignedTo || '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, 80);
  const existing = await prisma.networkIncident.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Incidente no encontrado' });
  const actor = req.session.username;
  const actions = {
    acknowledge: { data: { status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: actor }, type: 'acknowledged', message: note || `Reconocido por ${actor}` },
    resolve: { data: { status: 'resolved', resolvedAt: new Date(), resolvedBy: actor, resolutionNote: note || null }, type: 'resolved', message: note || `Cerrado manualmente por ${actor}` },
    reopen: { data: { status: 'open', resolvedAt: null, resolvedBy: null, resolutionNote: null, recoveryStreak: 0 }, type: 'reopened', message: note || `Reabierto por ${actor}` },
    assign: { data: { assignedTo: assignedTo || null }, type: 'assigned', message: assignedTo ? `Asignado a ${assignedTo}` : 'Asignacion eliminada' },
    note: { data: {}, type: 'note', message: note },
  };
  const mutation = actions[action];
  if (!mutation || (action === 'note' && !note)) return res.status(400).json({ error: 'Acción o nota inválida' });
  const invalidTransition =
    (action === 'acknowledge' && existing.status !== 'open') ||
    (action === 'resolve' && existing.status === 'resolved') ||
    (action === 'reopen' && existing.status !== 'resolved');
  if (invalidTransition) return res.status(409).json({ error: `No se puede ${action} un incidente en estado ${existing.status}` });
  const updated = await prisma.networkIncident.update({
    where: { id },
    data: { ...mutation.data, events: { create: { type: mutation.type, message: mutation.message, createdBy: actor } } },
    include: { events: { orderBy: { createdAt: 'desc' } } },
  });
  await logActivity(req, { action: `noc_incident_${action}`, entityType: 'network_incident', entityId: id, entityName: existing.title, details: { note, assignedTo } });
  res.json(incidentDto(updated));
}));

app.use('/noc', nocRouter);

// Auditoria historica no invasiva: uso de colas MikroTik, salud optica OLT y WAN.
const NETWORK_AUDIT_ENABLED = process.env.NETWORK_AUDIT_ENABLED !== 'false';
const NETWORK_AUDIT_INTERVAL_MS = Math.max(300_000, Number(process.env.NETWORK_AUDIT_INTERVAL_MS || 600_000));
const NETWORK_AUDIT_RAW_DAYS = Math.max(2, Number(process.env.NETWORK_AUDIT_RAW_DAYS || 14));
const NETWORK_AUDIT_WAN_DAYS = Math.max(30, Number(process.env.NETWORK_AUDIT_WAN_DAYS || 365));
let networkAuditTimer = null;
let networkAuditRunning = false;
let networkAuditState = {
  enabled: NETWORK_AUDIT_ENABLED,
  running: false,
  intervalMs: NETWORK_AUDIT_INTERVAL_MS,
  rawRetentionDays: NETWORK_AUDIT_RAW_DAYS,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  clientsStored: 0,
  durationMs: null,
};

function mergeDailyAudit(existing, sample) {
  const increment = dailyIncrement(sample);
  const minRx = increment.minRxPowerDbm == null
    ? existing?.minRxPowerDbm ?? null
    : existing?.minRxPowerDbm == null ? increment.minRxPowerDbm : Math.min(existing.minRxPowerDbm, increment.minRxPowerDbm);
  const maxRx = increment.maxRxPowerDbm == null
    ? existing?.maxRxPowerDbm ?? null
    : existing?.maxRxPowerDbm == null ? increment.maxRxPowerDbm : Math.max(existing.maxRxPowerDbm, increment.maxRxPowerDbm);
  return {
    sampleCount: (existing?.sampleCount || 0) + increment.sampleCount,
    onlineSamples: (existing?.onlineSamples || 0) + increment.onlineSamples,
    stableSamples: (existing?.stableSamples || 0) + increment.stableSamples,
    degradedSamples: (existing?.degradedSamples || 0) + increment.degradedSamples,
    offlineSamples: (existing?.offlineSamples || 0) + increment.offlineSamples,
    uploadBpsSum: (existing?.uploadBpsSum || 0) + increment.uploadBpsSum,
    downloadBpsSum: (existing?.downloadBpsSum || 0) + increment.downloadBpsSum,
    peakUploadBps: Math.max(existing?.peakUploadBps || 0, increment.peakUploadBps),
    peakDownloadBps: Math.max(existing?.peakDownloadBps || 0, increment.peakDownloadBps),
    rxPowerSum: (existing?.rxPowerSum || 0) + increment.rxPowerSum,
    rxPowerSamples: (existing?.rxPowerSamples || 0) + increment.rxPowerSamples,
    minRxPowerDbm: minRx,
    maxRxPowerDbm: maxRx,
    lastHealthState: sample.healthState,
    lastServiceOnline: sample.serviceOnline,
    lastUploadBps: sample.uploadBps,
    lastDownloadBps: sample.downloadBps,
    lastRxPowerDbm: sample.rxPowerDbm,
    lastOpticalState: sample.opticalState,
    lastOnuIndex: sample.onuIndex,
    lastCapturedAt: sample.capturedAt,
  };
}

function wanHealthState({ connected, ping, utilizationPercent, oltConnected }) {
  if (!connected || ping.lossPercent >= 100) return 'offline';
  if (ping.lossPercent == null || ping.lossPercent > 0 || ping.avgMs >= 80 || utilizationPercent >= 85 || !oltConnected) return 'degraded';
  return 'stable';
}

async function collectNetworkAudit() {
  if (!NETWORK_AUDIT_ENABLED || networkAuditRunning) return { skipped: true };
  networkAuditRunning = true;
  networkAuditState = { ...networkAuditState, running: true, lastRunAt: new Date(), lastError: null };
  const startedAt = Date.now();
  const now = new Date();
  const capturedAt = floorDate(now, NETWORK_AUDIT_INTERVAL_MS);
  try {
    const live = await collectLiveClients();
    const connection = await getMtConnection();
    const wanIface = process.env.MIKROTIK_WAN_IFACE || 'sfp2';
    const maxBps = Math.max(1, Number(process.env.MIKROTIK_WAN_MAX_MBPS || 1000)) * 1e6;
    const [wanRows, pingRows, oltSnapshot, onuRows] = await Promise.all([
      mtWrite(connection, 8_000, '/interface/monitor-traffic', `=interface=${wanIface}`, '=once='),
      mtWrite(connection, 8_000, '/ping', '=address=8.8.8.8', '=count=3'),
      prisma.oltSnapshot.findFirst({ orderBy: { capturedAt: 'desc' } }),
      prisma.oltOnu.findMany({
        where: { clientIdServicio: { not: null } },
        select: { onuIndex: true, rack: true, shelf: true, pon: true, online: true, phaseState: true, rxPowerDbm: true, txPowerDbm: true, clientIdServicio: true, updatedAt: true },
        orderBy: [{ online: 'desc' }, { updatedAt: 'desc' }],
      }),
    ]);

    const onuByClient = new Map();
    for (const onu of onuRows) if (!onuByClient.has(onu.clientIdServicio)) onuByClient.set(onu.clientIdServicio, onu);
    const samplesByClient = new Map();
    for (const item of live.clients.filter((candidate) => Number.isInteger(candidate.client?.id))) {
      const sample = { ...buildClientAuditSample(item, onuByClient.get(item.client.id) || null), capturedAt };
      const previous = samplesByClient.get(sample.idServicio);
      if (!previous || (previous.syncState !== 'synced' && sample.syncState === 'synced')) samplesByClient.set(sample.idServicio, sample);
    }
    const samples = [...samplesByClient.values()];

    const ids = samples.map((sample) => sample.idServicio);
    const existingSamples = ids.length ? await prisma.clientNetworkSample.findMany({
      where: { capturedAt, idServicio: { in: ids } }, select: { idServicio: true },
    }) : [];
    const existingIds = new Set(existingSamples.map((sample) => sample.idServicio));
    const newSamples = samples.filter((sample) => !existingIds.has(sample.idServicio));
    const day = utcDay(capturedAt);
    const existingDaily = newSamples.length ? await prisma.clientNetworkDaily.findMany({
      where: { day, idServicio: { in: newSamples.map((sample) => sample.idServicio) } },
    }) : [];
    const dailyByClient = new Map(existingDaily.map((row) => [row.idServicio, row]));

    const wan = wanRows[0] || {};
    const rxBps = Number(wan['rx-bits-per-second'] || 0);
    const txBps = Number(wan['tx-bits-per-second'] || 0);
    const utilizationPercent = Number(((Math.max(rxBps, txBps) / maxBps) * 100).toFixed(2));
    const ping = parsePingSummary(pingRows);
    const oltFresh = Boolean(oltSnapshot && now.getTime() - new Date(oltSnapshot.capturedAt).getTime() <= Math.max(180_000, NETWORK_AUDIT_INTERVAL_MS * 2));
    const wanSample = {
      capturedAt,
      ifaceName: wanIface,
      rxBps,
      txBps,
      maxBps,
      utilizationPercent,
      pingTarget: '8.8.8.8',
      pingSent: ping.sent,
      pingReceived: ping.received,
      pingLossPercent: ping.lossPercent,
      pingAvgMs: ping.avgMs,
      pingMaxMs: ping.maxMs,
      mikrotikConnected: Boolean(connection?.connected),
      clientsOnline: Number(live.stats?.onlineClients || 0),
      clientsOffline: Number(live.stats?.offlineClients || 0),
      oltConnected: oltFresh && oltSnapshot?.status === 'online',
      oltOnlineOnus: Number(oltSnapshot?.onlineOnus || 0),
      oltOfflineOnus: Number(oltSnapshot?.offlineOnus || 0),
      oltActiveAlarms: Number(oltSnapshot?.activeAlarms || 0),
      oltCriticalAlarms: Number(oltSnapshot?.criticalAlarms || 0),
      healthState: wanHealthState({ connected: Boolean(connection?.connected), ping, utilizationPercent, oltConnected: oltFresh && oltSnapshot?.status === 'online' }),
      durationMs: Date.now() - startedAt,
      errorMessage: null,
    };

    await prisma.$transaction(async (tx) => {
      if (newSamples.length) await tx.clientNetworkSample.createMany({ data: newSamples });
      for (const sample of newSamples) {
        const data = mergeDailyAudit(dailyByClient.get(sample.idServicio), sample);
        await tx.clientNetworkDaily.upsert({
          where: { idServicio_day: { idServicio: sample.idServicio, day } },
          create: { idServicio: sample.idServicio, day, ...data },
          update: data,
        });
      }
      await tx.wanNetworkSample.upsert({ where: { capturedAt }, create: wanSample, update: wanSample });
    });

    await Promise.all([
      prisma.clientNetworkSample.deleteMany({ where: { capturedAt: { lt: new Date(now.getTime() - NETWORK_AUDIT_RAW_DAYS * 86_400_000) } } }),
      prisma.wanNetworkSample.deleteMany({ where: { capturedAt: { lt: new Date(now.getTime() - NETWORK_AUDIT_WAN_DAYS * 86_400_000) } } }),
    ]);

    networkAuditState = {
      ...networkAuditState, running: false, lastSuccessAt: new Date(), lastError: null,
      clientsStored: newSamples.length, durationMs: Date.now() - startedAt,
    };
    console.log(`[network-audit] ${newSamples.length} client samples stored for ${capturedAt.toISOString()} in ${networkAuditState.durationMs}ms`);
    return { ok: true, capturedAt, clientsStored: newSamples.length, wan: wanSample };
  } catch (error) {
    networkAuditState = { ...networkAuditState, running: false, lastError: error.message, durationMs: Date.now() - startedAt };
    console.error('[network-audit] collection failed:', error.message);
    throw error;
  } finally {
    networkAuditRunning = false;
  }
}

function startNetworkAuditLoop() {
  if (!NETWORK_AUDIT_ENABLED || !MIKROTIK_ENABLED || !MT_HOST || networkAuditTimer) return;
  console.log(`[network-audit] enabled every ${NETWORK_AUDIT_INTERVAL_MS}ms, raw retention ${NETWORK_AUDIT_RAW_DAYS} days`);
  setTimeout(() => collectNetworkAudit().catch(() => {}), 25_000);
  networkAuditTimer = setInterval(() => collectNetworkAudit().catch(() => {}), NETWORK_AUDIT_INTERVAL_MS);
}

function aggregateClientDaily(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.idServicio) || {
      idServicio: row.idServicio, sampleCount: 0, onlineSamples: 0, stableSamples: 0,
      degradedSamples: 0, offlineSamples: 0, uploadBpsSum: 0, downloadBpsSum: 0,
      peakUploadBps: 0, peakDownloadBps: 0, rxPowerSum: 0, rxPowerSamples: 0,
      minRxPowerDbm: null, maxRxPowerDbm: null, latest: null,
    };
    current.sampleCount += row.sampleCount;
    current.onlineSamples += row.onlineSamples;
    current.stableSamples += row.stableSamples;
    current.degradedSamples += row.degradedSamples;
    current.offlineSamples += row.offlineSamples;
    current.uploadBpsSum += row.uploadBpsSum;
    current.downloadBpsSum += row.downloadBpsSum;
    current.peakUploadBps = Math.max(current.peakUploadBps, row.peakUploadBps);
    current.peakDownloadBps = Math.max(current.peakDownloadBps, row.peakDownloadBps);
    current.rxPowerSum += row.rxPowerSum;
    current.rxPowerSamples += row.rxPowerSamples;
    if (row.minRxPowerDbm != null) current.minRxPowerDbm = current.minRxPowerDbm == null ? row.minRxPowerDbm : Math.min(current.minRxPowerDbm, row.minRxPowerDbm);
    if (row.maxRxPowerDbm != null) current.maxRxPowerDbm = current.maxRxPowerDbm == null ? row.maxRxPowerDbm : Math.max(current.maxRxPowerDbm, row.maxRxPowerDbm);
    if (!current.latest || new Date(row.lastCapturedAt) > new Date(current.latest.lastCapturedAt)) current.latest = row;
    grouped.set(row.idServicio, current);
  }
  return grouped;
}

const networkAuditRouter = express.Router();
networkAuditRouter.use(authMiddleware);
networkAuditRouter.use(requireAnyRole(['tecnico']));

networkAuditRouter.get('/status', asyncHandler(async (_req, res) => {
  const [clientSamples, dailyRows, wanSamples, latestWan] = await Promise.all([
    prisma.clientNetworkSample.count(), prisma.clientNetworkDaily.count(), prisma.wanNetworkSample.count(),
    prisma.wanNetworkSample.findFirst({ orderBy: { capturedAt: 'desc' } }),
  ]);
  res.json({ ...networkAuditState, clientSamples, dailyRows, wanSamples, latestWan });
}));

networkAuditRouter.get('/clients', asyncHandler(async (req, res) => {
  const days = Math.min(3650, Math.max(1, Number(req.query.days || 30)));
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(200, Math.max(10, Number(req.query.pageSize || 50)));
  const search = String(req.query.q || '').trim();
  const status = String(req.query.status || 'all');
  const cutoff = utcDay(new Date(Date.now() - (days - 1) * 86_400_000));
  const clients = await prisma.client.findMany({
    where: search ? { OR: [
      { nombre: { contains: search } }, { aliasNombre: { contains: search } },
      { usuario: { contains: search } }, { ip: { contains: search } }, { zonaNombre: { contains: search } },
    ] } : {},
    select: { idServicio: true, nombre: true, aliasNombre: true, usuario: true, ip: true, planInternetName: true, zonaNombre: true, estado: true },
  });
  const clientById = new Map(clients.map((client) => [client.idServicio, client]));
  const dailyRows = clients.length ? await prisma.clientNetworkDaily.findMany({
    where: { day: { gte: cutoff }, idServicio: { in: clients.map((client) => client.idServicio) } },
    orderBy: { day: 'asc' },
  }) : [];
  const aggregates = aggregateClientDaily(dailyRows);
  let rows = [...aggregates.values()].map((row) => {
    const client = clientById.get(row.idServicio);
    const samples = Math.max(1, row.sampleCount);
    return {
      idServicio: row.idServicio,
      name: client?.aliasNombre || client?.nombre || `Cliente ${row.idServicio}`,
      username: client?.usuario || null,
      ip: client?.ip || null,
      plan: client?.planInternetName || null,
      zone: client?.zonaNombre || null,
      clientStatus: client?.estado || null,
      sampleCount: row.sampleCount,
      availabilityPercent: Number(((row.onlineSamples / samples) * 100).toFixed(2)),
      stabilityPercent: Number(((row.stableSamples / samples) * 100).toFixed(2)),
      degradedSamples: row.degradedSamples,
      offlineSamples: row.offlineSamples,
      avgUploadMbps: Number((row.uploadBpsSum / samples / 1e6).toFixed(3)),
      avgDownloadMbps: Number((row.downloadBpsSum / samples / 1e6).toFixed(3)),
      peakUploadMbps: Number((row.peakUploadBps / 1e6).toFixed(3)),
      peakDownloadMbps: Number((row.peakDownloadBps / 1e6).toFixed(3)),
      avgRxPowerDbm: row.rxPowerSamples ? Number((row.rxPowerSum / row.rxPowerSamples).toFixed(2)) : null,
      minRxPowerDbm: row.minRxPowerDbm,
      maxRxPowerDbm: row.maxRxPowerDbm,
      latestState: row.latest?.lastHealthState || 'unknown',
      latestOnline: row.latest?.lastServiceOnline || false,
      latestUploadMbps: Number(((row.latest?.lastUploadBps || 0) / 1e6).toFixed(3)),
      latestDownloadMbps: Number(((row.latest?.lastDownloadBps || 0) / 1e6).toFixed(3)),
      latestRxPowerDbm: row.latest?.lastRxPowerDbm ?? null,
      opticalState: row.latest?.lastOpticalState || 'unknown',
      onuIndex: row.latest?.lastOnuIndex || null,
      lastCapturedAt: row.latest?.lastCapturedAt || null,
    };
  });
  if (status !== 'all') rows = rows.filter((row) => row.latestState === status);
  const stateOrder = { offline: 0, degraded: 1, stable: 2, unknown: 3 };
  rows.sort((a, b) => (stateOrder[a.latestState] ?? 4) - (stateOrder[b.latestState] ?? 4) || a.stabilityPercent - b.stabilityPercent || a.name.localeCompare(b.name));
  const totals = rows.reduce((summary, row) => {
    summary.samples += row.sampleCount;
    summary.online += Math.round(row.sampleCount * row.availabilityPercent / 100);
    summary.stable += Math.round(row.sampleCount * row.stabilityPercent / 100);
    if (row.latestState !== 'stable') summary.attention += 1;
    return summary;
  }, { samples: 0, online: 0, stable: 0, attention: 0 });
  const total = rows.length;
  res.json({
    days, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      monitoredClients: total,
      attentionClients: totals.attention,
      availabilityPercent: totals.samples ? Number((totals.online / totals.samples * 100).toFixed(2)) : 0,
      stabilityPercent: totals.samples ? Number((totals.stable / totals.samples * 100).toFixed(2)) : 0,
      totalSamples: totals.samples,
      expectedSamplesPerDay: Math.round(86_400_000 / NETWORK_AUDIT_INTERVAL_MS),
    },
    items: rows.slice((page - 1) * pageSize, page * pageSize),
  });
}));

networkAuditRouter.get('/clients/:id', asyncHandler(async (req, res) => {
  const idServicio = Number(req.params.id);
  if (!Number.isInteger(idServicio)) return res.status(400).json({ error: 'Cliente inválido' });
  const days = Math.min(NETWORK_AUDIT_RAW_DAYS, Math.max(1, Number(req.query.days || 7)));
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const [client, samples, daily] = await Promise.all([
    prisma.client.findUnique({ where: { idServicio }, select: { idServicio: true, nombre: true, aliasNombre: true, usuario: true, ip: true, planInternetName: true, zonaNombre: true } }),
    prisma.clientNetworkSample.findMany({ where: { idServicio, capturedAt: { gte: cutoff } }, orderBy: { capturedAt: 'desc' }, take: 2500 }),
    prisma.clientNetworkDaily.findMany({ where: { idServicio }, orderBy: { day: 'desc' }, take: 365 }),
  ]);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json({ client, samples, daily });
}));

networkAuditRouter.get('/wan', asyncHandler(async (req, res) => {
  const hours = Math.min(8760, Math.max(1, Number(req.query.hours || 24)));
  const limit = Math.min(5000, Math.max(10, Number(req.query.limit || 500)));
  const items = await prisma.wanNetworkSample.findMany({
    where: { capturedAt: { gte: new Date(Date.now() - hours * 3_600_000) } },
    orderBy: { capturedAt: 'desc' }, take: limit,
  });
  const totals = items.reduce((result, row) => {
    result.maxRxBps = Math.max(result.maxRxBps, row.rxBps);
    result.maxTxBps = Math.max(result.maxTxBps, row.txBps);
    result.rxBps += row.rxBps;
    result.txBps += row.txBps;
    if (row.pingAvgMs != null) { result.pingMs += row.pingAvgMs; result.pingSamples += 1; }
    if (row.healthState !== 'stable') result.unstableSamples += 1;
    return result;
  }, { rxBps: 0, txBps: 0, maxRxBps: 0, maxTxBps: 0, pingMs: 0, pingSamples: 0, unstableSamples: 0 });
  const count = Math.max(1, items.length);
  res.json({
    hours,
    summary: {
      samples: items.length,
      avgRxMbps: Number((totals.rxBps / count / 1e6).toFixed(2)),
      avgTxMbps: Number((totals.txBps / count / 1e6).toFixed(2)),
      peakRxMbps: Number((totals.maxRxBps / 1e6).toFixed(2)),
      peakTxMbps: Number((totals.maxTxBps / 1e6).toFixed(2)),
      avgPingMs: totals.pingSamples ? Number((totals.pingMs / totals.pingSamples).toFixed(2)) : null,
      stabilityPercent: Number((((items.length - totals.unstableSamples) / count) * 100).toFixed(2)),
    },
    items,
  });
}));

networkAuditRouter.post('/collect', requireRole(['admin']), asyncHandler(async (req, res) => {
  const result = await collectNetworkAudit();
  await logActivity(req, { action: 'network_audit_manual_collection', entityType: 'network_audit', details: result });
  res.json(result);
}));

app.use('/network-audit', networkAuditRouter);

// ZTE C320 OLT: operational read-only integration.
const OLT_ENABLED = process.env.OLT_ENABLED === 'true';
const OLT_AUTO_AUTHORIZE_AGENT = process.env.OLT_AUTO_AUTHORIZE_AGENT === 'true';
const OLT_SYNC_INTERVAL_MS = Math.max(30_000, Number(process.env.OLT_SYNC_INTERVAL_MS || 60_000));
const OLT_INVENTORY_INTERVAL_MS = Math.max(60_000, Number(process.env.OLT_INVENTORY_INTERVAL_MS || 600_000));
let oltSyncTimer = null;
let oltAutoAuthorizeTimer = null;
let oltSyncInProgress = null;
let lastOltInventoryAt = 0;
let oltMutationInProgress = false;
let oltAutoAuthorizeInProgress = false;

const OLT_PROVISIONING_DEFAULTS = Object.freeze({
  vlan: 101,
  mask: '255.255.255.0',
  gateway: '192.168.16.1',
  primaryDns: '8.8.8.8',
  secondaryDns: '8.8.4.4',
  managementCidr: '192.168.16.0/24',
});
const OLT_PON_CAPACITY = Math.max(1, Number(process.env.OLT_PON_CAPACITY || 128));
const OLT_WEAK_RX_DBM = Number(process.env.OLT_WEAK_RX_DBM || -27);
const OLT_CRITICAL_RX_DBM = Number(process.env.OLT_CRITICAL_RX_DBM || -30);
const OLT_POWER_DROP_DB = Number(process.env.OLT_POWER_DROP_DB || 3);

function oltProvisioningError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function safeOltToken(value, label, { maxLength = 64, pattern = /^[A-Za-z0-9_.-]+$/ } = {}) {
  const text = String(value || '').trim();
  if (!text || text.length > maxLength || !pattern.test(text)) {
    throw oltProvisioningError(`${label} invalido`);
  }
  return text;
}

function safeOltSerial(value) {
  return safeOltToken(String(value || '').toUpperCase(), 'Serial', { maxLength: 24, pattern: /^[A-Z0-9]{8,24}$/ });
}

function safeOltName(value) {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 32);
  if (!normalized) throw oltProvisioningError('Nombre ONU invalido');
  return normalized;
}

function safeOltLabel(value, label, maxLength = 100) {
  const text = String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (!text || text.length > maxLength) throw oltProvisioningError(`${label} invalido`);
  return text;
}

function onuModelProfileDto(profile) {
  if (!profile) return null;
  return {
    ...profile,
    serialPrefixes: normalizePrefixesJson(profile.serialPrefixes),
    defaults: safeTr069Json(profile.defaultsJson, {}),
    capabilities: (profile.capabilities || []).map((item) => ({
      id: item.id, action: item.action, channel: item.channel, status: item.status,
      rollbackSupported: item.rollbackSupported, destructive: item.destructive,
      notes: item.notes, verifiedAt: item.verifiedAt, lastError: item.lastError,
    })),
    deviceCount: profile._count?.devices ?? profile.deviceCount ?? 0,
    defaultsJson: undefined,
    _count: undefined,
  };
}

function onuModelProfileData(profile) {
  return {
    profileKey: profile.profileKey, manufacturer: profile.manufacturer, model: profile.model,
    firmwarePattern: profile.firmwarePattern, serialPrefixes: JSON.stringify(profile.serialPrefixes),
    ponType: profile.ponType, oltVendor: profile.oltVendor, oltModel: profile.oltModel,
    oltOnuType: profile.oltOnuType, omciMode: profile.omciMode, extendedOmci: profile.extendedOmci,
    tr069ProfileKey: profile.tr069ProfileKey, certificationStatus: profile.certificationStatus,
    defaultsJson: JSON.stringify(profile.defaults), active: profile.active, builtIn: profile.builtIn,
    notes: profile.notes,
  };
}

async function ensureOnuModelProfilesSeeded() {
  return seedOnuModelProfiles(prisma);
}

async function listOnuModelProfiles({ activeOnly = true } = {}) {
  await ensureOnuModelProfilesSeeded();
  return prisma.onuModelProfile.findMany({
    where: activeOnly ? { active: true } : {},
    include: { capabilities: { orderBy: [{ action: 'asc' }, { channel: 'asc' }] }, _count: { select: { devices: true } } },
    orderBy: [{ active: 'desc' }, { manufacturer: 'asc' }, { model: 'asc' }, { version: 'desc' }],
  });
}

async function resolveOnuModelProfile(identity) {
  const profiles = await listOnuModelProfiles();
  const match = matchOnuModelProfile(profiles.map(onuModelProfileDto), identity);
  return match ? { ...match, profile: profiles.find((item) => item.id === match.profile.id) } : null;
}

async function persistOnuDeviceProfile(identity, match, source = 'automatic') {
  const serial = normalizeSerial(identity?.serial);
  if (!serial || !match?.profile?.id) return null;
  const existing = await prisma.onuDeviceProfile.findUnique({ where: { serial } });
  if (existing?.source === 'manual' && source !== 'manual') return existing;
  return prisma.onuDeviceProfile.upsert({
    where: { serial },
    update: {
      profileId: match.profile.id, source, confidence: match.confidence,
      detectedModel: identity.model || null, detectedFirmware: identity.softwareVersion || identity.firmware || null,
      matchedAt: new Date(), ...(match.confidence === 'verified' ? { lastVerifiedAt: new Date() } : {}),
    },
    create: {
      serial, profileId: match.profile.id, source, confidence: match.confidence,
      detectedModel: identity.model || null, detectedFirmware: identity.softwareVersion || identity.firmware || null,
      ...(match.confidence === 'verified' ? { lastVerifiedAt: new Date() } : {}),
    },
  });
}

async function persistOpticalAlerts(onuIndex, rxPowerDbm, previousValues, capturedAt = new Date()) {
  const detected = evaluateOpticalSignal(onuIndex, rxPowerDbm, previousValues, {
    weakThreshold: OLT_WEAK_RX_DBM,
    criticalThreshold: OLT_CRITICAL_RX_DBM,
    dropThreshold: OLT_POWER_DROP_DB,
  });
  const activeTypes = detected.map((alert) => alert.type);
  await prisma.$transaction([
    ...detected.map((alert) => prisma.oltSignalAlert.upsert({
      where: { fingerprint: alert.fingerprint },
      update: {
        severity: alert.severity, message: alert.message, currentValue: alert.currentValue,
        baselineValue: alert.baselineValue ?? null, active: true, lastSeenAt: capturedAt,
        clearedAt: null, occurrenceCount: { increment: 1 },
      },
      create: { ...alert, active: true, firstSeenAt: capturedAt, lastSeenAt: capturedAt },
    })),
    prisma.oltSignalAlert.updateMany({
      where: { onuIndex, active: true, ...(activeTypes.length ? { type: { notIn: activeTypes } } : {}) },
      data: { active: false, clearedAt: capturedAt },
    }),
  ]);
  return detected;
}

function recommendedProfile(profiles, speed, fallbackPattern) {
  const exact = profiles.find((profile) => profile.name.includes(`-${speed}-`));
  return exact?.name || profiles.find((profile) => fallbackPattern.test(profile.name))?.name || profiles[0]?.name || null;
}

function inferredPlanSpeed(planName) {
  const values = [...String(planName || '').matchAll(/\b(\d{1,4})\s*(?:m|mb|mega)/gi)]
    .map((match) => Number(match[1]));
  return values[0] || 100;
}

async function fetchOltPlanSyncPreview() {
  const client = createOltClient();
  if (!client.isConfigured()) throw oltProvisioningError('OLT no configurada', 503);
  try {
    const [plansPage, queues, catalog] = await Promise.all([
      wisphubApiRequest('plan-internet/?limit=500'),
      mtCached('queues', 5000, async () => {
        const connection = await getMtConnection();
        return mtWrite(connection, null, '/queue/simple/print');
      }),
      client.fetchProfileCatalog(),
    ]);
    const wisphubPlans = Array.isArray(plansPage?.results) ? plansPage.results : Array.isArray(plansPage) ? plansPage : [];
    return buildOltPlanSyncPreview({ wisphubPlans, queues, catalog });
  } finally {
    client.close();
  }
}

async function prepareOltProvisioning(serialValue, body = {}, { migrationJob = null, previousOnu = null } = {}) {
  const serial = safeOltSerial(serialValue);
  const pending = await prisma.oltUnconfiguredOnu.findUnique({ where: { serial } });
  if (!pending?.active) throw oltProvisioningError('La ONU ya no aparece sin autorizar', 409);

  const clientIdServicio = Number(body.clientIdServicio);
  if (!Number.isInteger(clientIdServicio) || clientIdServicio <= 0) {
    throw oltProvisioningError('Seleccione un cliente de WispHub');
  }
  const clientRecord = await prisma.client.findUnique({
    where: { idServicio: clientIdServicio },
    select: { idServicio: true, nombre: true, usuario: true, ip: true, snOnu: true, planInternetName: true },
  });
  if (!clientRecord) throw oltProvisioningError('Cliente no encontrado', 404);
  const existingAssignment = await prisma.oltOnu.findFirst({
    where: { clientIdServicio },
    select: { onuIndex: true, serial: true, online: true, clientIdServicio: true },
  });
  const migrationAllowed = migrationJob?.mode === 'migrate_pon'
    && previousOnu?.onuIndex === migrationJob.previousOnuIndex
    && existingAssignment?.onuIndex === migrationJob.previousOnuIndex
    && normalizeSerial(existingAssignment?.serial) === serial
    && normalizeSerial(migrationJob.previousSerial) === serial
    && migrationJob.targetPonIndex === pending.ponIndex
    && previousOnu.online === false;
  if (existingAssignment && !migrationAllowed) {
    throw oltProvisioningError(`El cliente ya esta asociado a la ONU ${existingAssignment.onuIndex}`, 409);
  }

  const oltClient = createOltClient();
  try {
    const options = await oltClient.fetchProvisioningOptions(pending.ponIndex);
    const requestedModelProfileId = body.modelProfileId == null || body.modelProfileId === '' ? null : Number(body.modelProfileId);
    let modelProfileMatch = null;
    if (requestedModelProfileId != null) {
      const selected = Number.isInteger(requestedModelProfileId) ? await prisma.onuModelProfile.findFirst({
        where: { id: requestedModelProfileId, active: true }, include: { capabilities: true },
      }) : null;
      if (!selected) throw oltProvisioningError('Perfil de modelo ONU invalido');
      const prefixes = normalizePrefixesJson(selected.serialPrefixes);
      if (prefixes.length && !prefixes.some((prefix) => serial.startsWith(prefix))) {
        throw oltProvisioningError(`El serial ${serial} no coincide con el perfil ${selected.profileKey}`, 409);
      }
      modelProfileMatch = { profile: selected, confidence: prefixes.length ? 'high' : 'detected', score: prefixes.length ? 45 : 1 };
    } else {
      modelProfileMatch = await resolveOnuModelProfile({ serial });
    }
    const profileId = body.profileId == null || body.profileId === '' ? null : Number(body.profileId);
    const profile = profileId == null ? null : await prisma.oltProvisioningProfile.findFirst({ where: { id: profileId, active: true } });
    if (profileId != null && (!Number.isInteger(profileId) || !profile)) throw oltProvisioningError('Perfil de aprovisionamiento invalido');
    const onuType = safeOltToken(modelProfileMatch?.profile?.oltOnuType || body.onuType || profile?.onuType, 'Modelo ONU');
    const tcontProfile = safeOltToken(body.tcontProfile || profile?.tcontProfile, 'Perfil de subida');
    const trafficProfile = safeOltToken(body.trafficProfile || profile?.trafficProfile, 'Perfil de bajada');
    const serviceMode = String(body.serviceMode || profile?.serviceMode || 'router').toLowerCase();
    if (!['router', 'bridge'].includes(serviceMode)) throw oltProvisioningError('Modo de servicio invalido');
    const oltProvisionCapability = modelProfileMatch?.profile?.capabilities?.find(
      (capability) => capability.action === 'olt_provision' && capability.channel === 'OLT_CLI',
    );
    if (!modelProfileMatch?.profile || oltProvisionCapability?.status !== 'verified') {
      throw oltProvisioningError('El modelo ONU no tiene un perfil OLT certificado', 409);
    }
    let compatibleModels = [];
    try { compatibleModels = JSON.parse(profile?.compatibleModelsJson || '[]'); } catch {}
    const normalizedCompatibleModels = compatibleModels.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
    if (normalizedCompatibleModels.length) {
      const detectedModels = [modelProfileMatch.profile.model, modelProfileMatch.profile.oltOnuType]
        .map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
      if (!detectedModels.some((item) => normalizedCompatibleModels.includes(item))) {
        throw oltProvisioningError(`El perfil ${profile.name} no es compatible con este modelo ONU`, 409);
      }
    }
    let profileLanPorts = [1];
    try { profileLanPorts = JSON.parse(profile?.lanPortsJson || '[1]'); } catch {}
    const lanPorts = [...new Set((Array.isArray(body.lanPorts) ? body.lanPorts : profileLanPorts).map(Number))].sort();
    if (!lanPorts.length || lanPorts.some((port) => !Number.isInteger(port) || port < 1 || port > 4)) throw oltProvisioningError('Puertos LAN invalidos');
    if (!options.onuTypes.some((item) => item.name === onuType)) throw oltProvisioningError('El modelo ONU no existe en esta OLT');
    if (!options.tcontProfiles.some((item) => item.name === tcontProfile)) throw oltProvisioningError('El perfil de subida no existe en esta OLT');
    if (!options.trafficProfiles.some((item) => item.name === trafficProfile)) throw oltProvisioningError('El perfil de bajada no existe en esta OLT');
    if (!options.recommendedOnuId) throw oltProvisioningError('El puerto PON no tiene IDs ONU disponibles', 409);

    const vlan = Number(body.vlan ?? profile?.vlan);
    if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) throw oltProvisioningError('VLAN invalida');
    const managementIp = serviceMode === 'router' ? String(body.managementIp || clientRecord.ip || '').trim() : null;
    if (serviceMode === 'router' && (!isValidIpv4(managementIp) || !ipInCidr(managementIp, OLT_PROVISIONING_DEFAULTS.managementCidr))) {
      throw oltProvisioningError(`La IP debe pertenecer a ${OLT_PROVISIONING_DEFAULTS.managementCidr}`);
    }
    if (serviceMode === 'router' && clientRecord.ip && clientRecord.ip !== managementIp) {
      throw oltProvisioningError(`La IP debe coincidir con WispHub (${clientRecord.ip})`, 409);
    }
    const ipam = managementIp ? await prisma.ipamAddress.findUnique({ where: { ip: managementIp } }) : null;
    const ownedByClient = ipam?.clientIdServicio === clientIdServicio || clientRecord.ip === managementIp;
    if (managementIp && ipam && !ipam.available && !ownedByClient) throw oltProvisioningError(`La IP ${managementIp} esta ocupada por otro equipo`, 409);

    const name = safeOltName(body.name || clientRecord.nombre || clientRecord.usuario);
    return {
      serial,
      pending,
      client: clientRecord,
      options,
      profile,
      modelProfile: modelProfileMatch?.profile || null,
      modelProfileConfidence: modelProfileMatch?.confidence || null,
      config: {
        serial,
        ponIndex: pending.ponIndex,
        onuId: options.recommendedOnuId,
        onuType,
        modelProfileId: modelProfileMatch?.profile?.id || null,
        serviceMode,
        lanPorts,
        name,
        vlan,
        tcontProfile,
        trafficProfile,
        managementIp,
        mask: OLT_PROVISIONING_DEFAULTS.mask,
        gateway: OLT_PROVISIONING_DEFAULTS.gateway,
        primaryDns: OLT_PROVISIONING_DEFAULTS.primaryDns,
        secondaryDns: OLT_PROVISIONING_DEFAULTS.secondaryDns,
      },
    };
  } finally {
    oltClient.close();
  }
}

async function syncAuthorizedOnuSerial(client, serialValue) {
  const serial = normalizeSerial(serialValue);
  const idServicio = Number(client?.idServicio);
  if (!Number.isInteger(idServicio) || !serial) {
    throw oltProvisioningError('No se puede sincronizar el serial sin cliente y serial validos', 500);
  }

  const current = await wisphubApiRequest(`clientes/${idServicio}/`);
  let changed = normalizeSerial(current.sn_onu) !== serial;
  if (changed) {
    const update = await wisphubApiRequest(`clientes/${idServicio}/`, {
      method: 'PUT',
      body: JSON.stringify({ ip: client.ip, sn_onu: serial }),
    });
    const taskId = update.task_id || update.task?.id || null;
    if (taskId) {
      const task = await waitForWisphubTask(taskId, 40, 1000, 'la sincronizacion del serial ONU');
      const taskError = taskResultError(task);
      if (taskError) throw new Error(taskError);
    }
  }

  const confirmed = await wisphubApiRequest(`clientes/${idServicio}/`);
  if (normalizeSerial(confirmed.sn_onu) !== serial) {
    throw new Error('WispHub no confirmo el serial ONU autorizado');
  }
  await prisma.client.update({ where: { idServicio }, data: { snOnu: serial } });
  return { ok: true, changed, idServicio, serial };
}

async function applyPreparedOltProvisioning(prepared) {
  let authorized = false;
  const completedSteps = [];
  const rollback = { attempted: false, ok: false, error: null };
  const client = createOltClient();
  try {
    const result = await client.provisionOnu(prepared.config, (step) => {
      completedSteps.push(step);
      if (step === 'authorize') authorized = true;
    });
    const verification = await client.verifyProvisionedOnu(
      prepared.config.ponIndex,
      prepared.config.onuId,
      prepared.config.serial,
      prepared.config.serviceMode,
      prepared.config.vlan,
      prepared.config.lanPorts,
    );
    if (!verification.serialMatches || !verification.serviceConfigured || !verification.managementConfigured) {
      throw oltProvisioningError('La OLT no confirmo toda la configuracion aplicada', 502);
    }
    return { result, verification, completedSteps, rollback };
  } catch (error) {
    if (authorized) {
      rollback.attempted = true;
      try {
        await client.rollbackProvisioning(prepared.config.ponIndex, prepared.config.onuId);
        rollback.ok = true;
      } catch (rollbackError) {
        rollback.error = rollbackError.message;
      }
    }
    error.completedSteps = completedSteps;
    error.rollback = rollback;
    throw error;
  } finally {
    client.close();
  }
}

async function applyPreparedPonMigration(prepared, job, previousOnu) {
  if (job.mode !== 'migrate_pon' || !previousOnu || previousOnu.online) {
    throw oltProvisioningError('La migracion de PON no cumple las condiciones de transferencia', 409);
  }
  const [previousPonIndex, previousOnuIdText] = previousOnu.onuIndex.split(':');
  const previousOnuId = Number(previousOnuIdText);
  const restoreConfig = { ...prepared.config, ponIndex: previousPonIndex, onuId: previousOnuId };
  const retirementClient = createOltClient();
  try {
    await retirementClient.rollbackProvisioning(previousPonIndex, previousOnuId);
  } finally {
    retirementClient.close();
  }

  try {
    const applied = await applyPreparedOltProvisioning(prepared);
    return { ...applied, migration: { previousOnuIndex: previousOnu.onuIndex, restored: false } };
  } catch (error) {
    const restoration = { attempted: true, ok: false, error: null };
    const restorationClient = createOltClient();
    try {
      await restorationClient.provisionOnu(restoreConfig);
      const verification = await restorationClient.verifyProvisionedOnu(previousPonIndex, previousOnuId, prepared.serial);
      if (!verification.serialMatches || !verification.serviceConfigured || !verification.managementConfigured) {
        throw new Error('La OLT no confirmo la restauracion en el PON anterior');
      }
      restoration.ok = true;
    } catch (restoreError) {
      restoration.error = String(restoreError.message || restoreError).slice(0, 500);
    } finally {
      restorationClient.close();
    }
    error.migrationRestoration = restoration;
    throw error;
  }
}

async function recordOltProvisioningFailure(req, serial, prepared, error, actor = null) {
  const completedSteps = error.completedSteps || [];
  const rollback = error.rollback || { attempted: false, ok: false, error: null };
  await logActivity(req, {
    action: 'olt_onu_provision_failed', entityType: 'olt',
    entityId: prepared ? `${prepared.config.ponIndex}:${prepared.config.onuId}` : serial,
    entityName: serial, actor,
    details: { serial, clientIdServicio: prepared?.client.idServicio || null, completedSteps, rollback, migrationRestoration: error.migrationRestoration || null, error: error.message },
  });
  await prisma.provisioningJob.updateMany({
    where: { serial, status: { in: ['in_progress', 'waiting_optical', 'partial'] } },
    data: { status: 'partial', stage: rollback.ok ? 'olt_rolled_back' : 'olt_failed', errorMessage: String(error.message).slice(0, 1000) },
  }).catch(() => {});
  return { completedSteps, rollback };
}

async function finalizeOltProvisioning(prepared, applied, { req = null, actor = 'system', mappingSource = 'manual' } = {}) {
  const serial = prepared.serial;
  let commercialSync = { ok: false, changed: false, error: null };
  try {
    await runOltSync({ forceInventory: true });
    const syncedOnu = await prisma.oltOnu.findUnique({ where: { onuIndex: applied.result.onuIndex } });
    if (syncedOnu) {
      await prisma.oltOnu.update({
        where: { onuIndex: syncedOnu.onuIndex },
        data: { clientIdServicio: prepared.client.idServicio, mappingSource, mappedAt: new Date(), mappedBy: actor },
      });
    }
    await prisma.oltUnconfiguredOnu.updateMany({ where: { serial }, data: { active: false, clearedAt: new Date(), authorizationStatus: 'authorized', authorizationReason: null } });
    if (prepared.modelProfile) {
      await persistOnuDeviceProfile(
        { serial, model: prepared.modelProfile.model },
        { profile: prepared.modelProfile, confidence: prepared.modelProfileConfidence || 'detected' },
        mappingSource === 'agent_auto' ? 'agent' : 'provisioning',
      );
    }
  } catch (syncError) {
    console.warn('[olt] post-provision sync warning:', syncError.message);
  }

  try {
    commercialSync = await syncAuthorizedOnuSerial(prepared.client, serial);
  } catch (syncError) {
    commercialSync = { ok: false, changed: false, error: String(syncError.message || syncError).slice(0, 600) };
    console.warn('[olt] WispHub serial sync warning:', commercialSync.error);
  }

  await logActivity(req, {
    action: mappingSource === 'agent_auto' ? 'olt_onu_auto_provisioned' : 'olt_onu_provisioned',
    entityType: 'olt', entityId: applied.result.onuIndex, entityName: prepared.config.name, actor,
    details: {
      serial, onuIndex: applied.result.onuIndex, clientIdServicio: prepared.client.idServicio, clientName: prepared.client.nombre,
      vlan: prepared.config.vlan, managementIp: prepared.config.managementIp,
      onuType: prepared.config.onuType, tcontProfile: prepared.config.tcontProfile, trafficProfile: prepared.config.trafficProfile,
      modelProfileId: prepared.modelProfile?.id || null, modelProfileKey: prepared.modelProfile?.profileKey || null,
      verified: true, commercialSync, automatic: mappingSource === 'agent_auto',
    },
  });
  const activeJob = await prisma.provisioningJob.findFirst({
    where: { serial, status: { in: ['in_progress', 'waiting_optical', 'partial'] } }, orderBy: { updatedAt: 'desc' },
  });
  if (activeJob) {
    let steps = [];
    try { steps = JSON.parse(activeJob.steps || '[]'); } catch {}
    steps.push({
      stage: 'service_ready', status: 'complete',
      message: `ONU ${applied.result.onuIndex} autorizada y verificada${mappingSource === 'agent_auto' ? ' automaticamente' : ''}`,
      at: new Date().toISOString(), source: mappingSource === 'agent_auto' ? 'olt_auto' : 'olt',
    });
    steps.push(commercialSync.ok
      ? { stage: 'commercial_synced', status: 'complete', message: `Serial ${serial} confirmado en WispHub`, at: new Date().toISOString(), source: 'olt' }
      : { stage: 'commercial_sync', status: 'warning', message: commercialSync.error || 'Serial pendiente de confirmar en WispHub', at: new Date().toISOString(), source: 'olt' });
    const replacementPendingCleanup = activeJob.mode === 'replace_onu' && activeJob.previousOnuIndex && activeJob.previousOnuIndex !== applied.result.onuIndex;
    await prisma.$transaction(async (tx) => {
      await tx.provisioningJob.update({
        where: { id: activeJob.id },
        data: {
        status: 'complete', stage: 'service_ready', onuIndex: applied.result.onuIndex,
        ponIndex: prepared.config.ponIndex, clientIdServicio: prepared.client.idServicio,
        cutoverStatus: replacementPendingCleanup ? 'cleanup_pending' : 'service_ready',
        steps: JSON.stringify(steps.slice(-100)), errorMessage: commercialSync.ok ? null : commercialSync.error,
        completedAt: new Date(),
        },
      });
      if (activeJob.mode !== 'new_client') {
        await tx.clientCpeHistory.updateMany({
          where: { jobId: activeJob.id },
          data: {
            status: replacementPendingCleanup ? 'cleanup_pending' : 'complete',
            newSerial: serial, newOnuIndex: applied.result.onuIndex,
            completedAt: replacementPendingCleanup ? null : new Date(),
          },
        });
      }
    });
    if (activeJob.reservationToken) {
      await prisma.ipReservation.updateMany({
        where: { token: activeJob.reservationToken, status: 'active' },
        data: { status: 'committed', committedAt: new Date() },
      });
    }
  }

  return {
    ok: true, onuIndex: applied.result.onuIndex, client: prepared.client, config: prepared.config,
    modelProfile: prepared.modelProfile ? onuModelProfileDto(prepared.modelProfile) : null,
    verification: applied.verification, completedSteps: applied.completedSteps, commercialSync,
    online: Boolean(applied.verification.state?.online),
    phaseState: applied.verification.state?.phaseState || applied.verification.inventory?.phaseState || 'authorized',
    localProvisioning: {
      vlan: prepared.config.vlan, wanIp: prepared.config.managementIp, mask: prepared.config.mask,
      gateway: prepared.config.gateway, primaryDns: prepared.config.primaryDns,
      secondaryDns: prepared.config.secondaryDns, ssid: prepared.client.nombre,
    },
  };
}

async function buildAgentAutoAuthorizationBody(pending, job, inventory, clientRecord) {
  const oltClient = createOltClient();
  try {
    const options = await oltClient.fetchProvisioningOptions(pending.ponIndex);
    await oltClient.checkWriteAccess();
    const detectedModel = String(inventory.device.model || job.model || '').trim();
    const modelProfileMatch = await resolveOnuModelProfile({
      serial: pending.serial, manufacturer: inventory.device.manufacturer,
      model: detectedModel, softwareVersion: inventory.device.softwareVersion || inventory.device.software_version,
    });
    const oltProvisionCapability = modelProfileMatch?.profile?.capabilities?.find(
      (capability) => capability.action === 'olt_provision' && capability.channel === 'OLT_CLI',
    );
    if (!modelProfileMatch?.profile || oltProvisionCapability?.status !== 'verified') {
      throw oltProvisioningError('La ONU no tiene un perfil OLT certificado para autorizacion automatica', 409);
    }
    const onuType = String(modelProfileMatch?.profile?.oltOnuType || detectedModel).trim();
    if (!options.onuTypes.some((item) => item.name === onuType)) {
      throw oltProvisioningError(`El modelo ${onuType || 'desconocido'} no existe en esta OLT`);
    }
    const speed = Math.max(1, Number(job.uploadMbps) || 0, Number(job.downloadMbps) || 0);
    const tcontProfile = selectSpeedProfile(options.tcontProfiles, speed, 'up');
    const trafficProfile = selectSpeedProfile(options.trafficProfiles, speed, 'down');
    if (!tcontProfile || !trafficProfile) {
      throw oltProvisioningError(`No existe un perfil OLT compatible con ${speed} Mbps`);
    }
    const manifest = parseConfigurationManifest(job);
    return {
      clientIdServicio: clientRecord.idServicio,
      modelProfileId: modelProfileMatch?.profile?.id || null,
      onuType,
      tcontProfile,
      trafficProfile,
      vlan: job.vlan,
      serviceMode: manifest?.serviceMode || job.serviceMode || 'router',
      lanPorts: manifest?.lanPorts || [1],
      managementIp: (manifest?.serviceMode || job.serviceMode) === 'bridge' ? null : job.ip,
      name: clientRecord.nombre || job.clientName,
    };
  } finally {
    oltClient.close();
  }
}

async function runOltAgentAutoAuthorization() {
  if (!OLT_AUTO_AUTHORIZE_AGENT || oltAutoAuthorizeInProgress || oltMutationInProgress || oltSyncInProgress) return null;
  oltAutoAuthorizeInProgress = true;
  let serial = null;
  let prepared = null;
  try {
    const pendingItems = await prisma.oltUnconfiguredOnu.findMany({
      where: { active: true }, orderBy: { firstSeenAt: 'asc' }, take: 50,
    });
    for (const pending of pendingItems) {
      serial = normalizeSerial(pending.serial);
      const job = await prisma.provisioningJob.findFirst({
        where: {
          serial, source: 'onu_studio', mode: { in: ['new_client', 'replace_onu', 'migrate_pon'] },
          status: { in: ['in_progress', 'waiting_optical'] },
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (!job?.clientIdServicio) continue;
      const manifest = parseConfigurationManifest(job);
      const manifestReasons = [];
      if (!manifest?.verified) manifestReasons.push('ONU Studio no ha verificado la configuracion local');
      if (normalizeSerial(manifest?.serial) !== serial) manifestReasons.push('El serial del manifiesto no coincide');
      if (Number(manifest?.vlan) !== Number(job.vlan)) manifestReasons.push('La VLAN del manifiesto no coincide');
      if ((manifest?.serviceMode || 'router') !== (job.serviceMode || 'router')) manifestReasons.push('El modo Router/Bridge no coincide');
      if ((job.serviceMode || 'router') === 'router' && manifest?.wan?.ip !== job.ip) manifestReasons.push('La IP verificada no coincide');
      if (manifestReasons.length) {
        await prisma.oltUnconfiguredOnu.update({
          where: { serial }, data: { authorizationStatus: 'review', authorizationReason: manifestReasons.join('. ').slice(0, 500) },
        });
        continue;
      }
      const inventory = parseStoredAgentInventory(job);
      const previousOnu = job.mode === 'migrate_pon' && job.previousOnuIndex
        ? await prisma.oltOnu.findUnique({ where: { onuIndex: job.previousOnuIndex } })
        : null;
      const clientRecord = await prisma.client.findUnique({
        where: { idServicio: job.clientIdServicio },
        select: { idServicio: true, nombre: true, usuario: true, ip: true, snOnu: true, planInternetName: true },
      });
      const eligibility = evaluateAgentAutoAuthorization({ pending, job, inventory, client: clientRecord, previousOnu });
      if (!eligibility.eligible) {
        await prisma.oltUnconfiguredOnu.update({
          where: { serial }, data: { authorizationStatus: 'review', authorizationReason: eligibility.reasons.join('. ').slice(0, 500) },
        });
        continue;
      }

      const body = await buildAgentAutoAuthorizationBody(pending, job, inventory, clientRecord);
      if (oltMutationInProgress || oltSyncInProgress) return null;
      oltMutationInProgress = true;
      try {
        prepared = await prepareOltProvisioning(serial, body, { migrationJob: job, previousOnu });
        const applied = job.mode === 'migrate_pon'
          ? await applyPreparedPonMigration(prepared, job, previousOnu)
          : await applyPreparedOltProvisioning(prepared);
        oltMutationInProgress = false;
        const result = await finalizeOltProvisioning(prepared, applied, {
          actor: 'onu_studio_auto', mappingSource: 'agent_auto',
        });
        if (job.mode === 'migrate_pon' && previousOnu?.onuIndex !== result.onuIndex) {
          await prisma.oltOnu.deleteMany({ where: { onuIndex: previousOnu.onuIndex, online: false } });
          await logActivity(null, {
            action: 'olt_onu_pon_migrated', entityType: 'olt', entityId: result.onuIndex,
            entityName: clientRecord.nombre || serial, actor: 'onu_studio_auto',
            details: {
              jobId: job.id, serial, clientIdServicio: clientRecord.idServicio,
              previousOnuIndex: previousOnu.onuIndex, newOnuIndex: result.onuIndex,
              preserved: ['WispHub', 'facturas', 'IP', 'MikroTik'],
            },
          });
        }
        console.log(`[olt-auto] ${serial} authorized as ${result.onuIndex} for WispHub #${clientRecord.idServicio}`);
        return result;
      } catch (error) {
        oltMutationInProgress = false;
        await recordOltProvisioningFailure(null, serial, prepared, error, 'onu_studio_auto');
        console.error(`[olt-auto] ${serial} failed:`, error.message);
        return null;
      }
    }
    return null;
  } finally {
    oltMutationInProgress = false;
    oltAutoAuthorizeInProgress = false;
  }
}

function createOltClient() {
  return new ZteC320Client({
    host: process.env.OLT_HOST,
    port: process.env.OLT_PORT || 23,
    username: process.env.OLT_USER,
    password: process.env.OLT_PASS,
    connectTimeoutMs: process.env.OLT_CONNECT_TIMEOUT_MS || 8000,
    commandTimeoutMs: process.env.OLT_COMMAND_TIMEOUT_MS || 15000,
  });
}

function normalizeSerial(value) {
  return normalizeGponSerial(value);
}

async function pendingPonRelocation(pending) {
  if (!pending?.serial || !pending?.ponIndex) return null;
  const dbOnus = await prisma.oltOnu.findMany({
    where: { serial: { not: null } },
    select: {
      onuIndex: true, serial: true, name: true, model: true, online: true,
      clientIdServicio: true, lastSeenAt: true,
    },
  });
  return buildPendingPonRelocation({ pending, dbOnus });
}

async function manualPonRelocationContext(serial, body = {}) {
  const requestedPreviousOnuIndex = String(body.previousOnuIndex || '').trim();
  if (!requestedPreviousOnuIndex) return null;
  try { assertOnuIndex(requestedPreviousOnuIndex); } catch { throw oltProvisioningError('La ubicacion anterior de la ONU no es valida'); }
  const pending = await prisma.oltUnconfiguredOnu.findUnique({ where: { serial } });
  if (!pending?.active) throw oltProvisioningError('La ONU ya no aparece sin autorizar', 409);
  const relocation = await pendingPonRelocation(pending);
  if (!relocation || relocation.previousLocation?.onuIndex !== requestedPreviousOnuIndex) {
    throw oltProvisioningError('La ubicacion anterior ya no coincide con el inventario actual. Sincronice la OLT.', 409);
  }
  if (!relocation.allowed) throw oltProvisioningError(relocation.reasons.join('. '), 409);
  const clientIdServicio = Number(body.clientIdServicio);
  if (relocation.clientIdServicio && relocation.clientIdServicio !== clientIdServicio) {
    throw oltProvisioningError('La ONU anterior pertenece a otro cliente', 409);
  }
  const previousOnu = await prisma.oltOnu.findUnique({ where: { onuIndex: requestedPreviousOnuIndex } });
  if (!previousOnu || previousOnu.online || normalizeSerial(previousOnu.serial) !== serial) {
    throw oltProvisioningError('La ubicacion anterior cambio de estado. Sincronice la OLT antes de continuar.', 409);
  }
  return {
    relocation,
    previousOnu,
    migrationJob: {
      mode: 'migrate_pon', previousOnuIndex: previousOnu.onuIndex,
      previousSerial: serial, targetPonIndex: pending.ponIndex,
    },
  };
}

async function finalizeManualPonRelocation(req, context, result) {
  if (!context) return;
  const previousOnuIndex = context.previousOnu.onuIndex;
  await prisma.$transaction([
    prisma.oltOnu.deleteMany({
      where: { onuIndex: previousOnuIndex, online: false, serial: context.previousOnu.serial },
    }),
    prisma.oltNapPort.updateMany({
      where: { onuIndex: previousOnuIndex },
      data: {
        onuIndex: result.onuIndex, serial: context.relocation.serial,
        clientIdServicio: result.client.idServicio, assignedAt: new Date(),
      },
    }),
  ]);
  await logActivity(req, {
    action: 'olt_onu_pon_reauthorized', entityType: 'olt', entityId: result.onuIndex,
    entityName: result.client.nombre || context.relocation.serial,
    details: {
      serial: context.relocation.serial, clientIdServicio: result.client.idServicio,
      previousOnuIndex, newOnuIndex: result.onuIndex,
      previousPonIndex: context.relocation.previousLocation.ponIndex,
      newPonIndex: context.relocation.targetPonIndex,
      preserved: ['WispHub', 'facturas', 'IP', 'MikroTik', 'cliente', 'historial'],
      verified: true,
    },
  });
}

async function runOltSync({ forceInventory = false } = {}) {
  if (oltMutationInProgress) throw oltProvisioningError('Hay una autorizacion ONU en curso', 409);
  if (oltSyncInProgress) return oltSyncInProgress;
  const client = createOltClient();
  if (!client.isConfigured()) throw new Error('Faltan OLT_HOST, OLT_USER u OLT_PASS');

  oltSyncInProgress = (async () => {
    const startedAt = Date.now();
    const includeInventory = forceInventory || !lastOltInventoryAt || Date.now() - lastOltInventoryAt >= OLT_INVENTORY_INTERVAL_MS;
    try {
      const overview = await client.fetchOverview({ includeInventory });
      const now = new Date();
      const baseByIndex = new Map(overview.baseInfo.map((onu) => [onu.onuIndex, onu]));
      const canonicalOnuBySerial = selectCanonicalOnuIndexes(overview.onus, overview.baseInfo);
      const clientsWithSerial = await prisma.client.findMany({
        where: { snOnu: { not: null } },
        select: { idServicio: true, snOnu: true },
      });
      const clientBySerial = new Map(clientsWithSerial.map((row) => [normalizeSerial(row.snOnu), row.idServicio]));
      const existingMappings = await prisma.oltOnu.findMany({
        select: { onuIndex: true, clientIdServicio: true, mappingSource: true },
      });
      const mappingByOnu = new Map(existingMappings.map((row) => [row.onuIndex, row]));

      if (overview.cards.length) {
        await prisma.$transaction(overview.cards.map((card) => prisma.oltCard.upsert({
          where: { location: card.location },
          update: { ...card, lastSeenAt: now },
          create: { ...card, lastSeenAt: now },
        })));
      }

      if (overview.onus.length) {
        await prisma.$transaction(overview.onus.map((state) => {
          const inventory = baseByIndex.get(state.onuIndex);
          const serial = inventory?.serial || undefined;
          const normalizedSerial = normalizeSerial(serial);
          const isCanonicalLocation = normalizedSerial && canonicalOnuBySerial.get(normalizedSerial) === state.onuIndex;
          const matchedClientId = isCanonicalLocation ? clientBySerial.get(normalizedSerial) : null;
          const existingMapping = mappingByOnu.get(state.onuIndex);
          const shared = {
            interfaceName: state.interfaceName,
            rack: state.rack,
            shelf: state.shelf,
            pon: state.pon,
            onuId: state.onuId,
            adminState: state.adminState,
            omccState: state.omccState,
            phaseState: state.phaseState,
            channel: state.channel,
            online: state.online,
            lastSeenAt: now,
            ...(inventory ? {
              model: inventory.model,
              serial: inventory.serial,
              authMode: inventory.authMode,
            } : {}),
          };
          const automaticMapping = resolveClientMapping(existingMapping, matchedClientId, Boolean(inventory), now);
          return prisma.oltOnu.upsert({
            where: { onuIndex: state.onuIndex },
            update: { ...shared, ...automaticMapping },
            create: { onuIndex: state.onuIndex, ...shared, ...automaticMapping },
          });
        }));
        await prisma.oltOnu.updateMany({
          where: { onuIndex: { notIn: overview.onus.map((onu) => onu.onuIndex) } },
          data: { online: false, phaseState: 'not-seen' },
        });
      }

      const unconfiguredSerials = overview.unconfigured.map((onu) => normalizeSerial(onu.serial)).filter(Boolean);
      if (overview.unconfigured.length) {
        await prisma.$transaction(overview.unconfigured.map((onu) => {
          const [rack, shelf, pon] = onu.ponIndex.split('/').map(Number);
          return prisma.oltUnconfiguredOnu.upsert({
            where: { serial: normalizeSerial(onu.serial) },
            update: { ponIndex: onu.ponIndex, rack, shelf, pon, active: true, lastSeenAt: now, clearedAt: null },
            create: { serial: normalizeSerial(onu.serial), ponIndex: onu.ponIndex, rack, shelf, pon, active: true, lastSeenAt: now },
          });
        }));
        const waitingJobs = await prisma.provisioningJob.findMany({
          where: { serial: { in: unconfiguredSerials }, status: { in: ['in_progress', 'waiting_optical', 'partial'] } },
          select: { id: true, serial: true, steps: true },
        });
        const pendingBySerial = new Map(overview.unconfigured.map((onu) => [normalizeSerial(onu.serial), onu]));
        if (waitingJobs.length) {
          await prisma.$transaction(waitingJobs.map((job) => {
            const detected = pendingBySerial.get(normalizeSerial(job.serial));
            let steps = [];
            try { steps = JSON.parse(job.steps || '[]'); } catch {}
            if (!steps.some((step) => step.stage === 'olt_discovered' && step.ponIndex === detected?.ponIndex)) {
              steps.push({ stage: 'olt_discovered', status: 'complete', ponIndex: detected?.ponIndex, at: now.toISOString(), source: 'olt_sync' });
            }
            return prisma.provisioningJob.update({
              where: { id: job.id },
              data: { stage: 'olt_discovered', status: 'in_progress', ponIndex: detected?.ponIndex || null, steps: JSON.stringify(steps.slice(-100)), errorMessage: null },
            });
          }));
        }
      }
      await prisma.oltUnconfiguredOnu.updateMany({
        where: { active: true, ...(unconfiguredSerials.length ? { serial: { notIn: unconfiguredSerials } } : {}) },
        data: { active: false, clearedAt: now },
      });

      const activeAlarmIds = overview.alarms.map((alarm) => alarm.alarmId);
      if (overview.alarms.length) {
        await prisma.$transaction(overview.alarms.map((alarm) => prisma.oltAlarm.upsert({
          where: { alarmId: alarm.alarmId },
          update: { ...alarm, active: true, lastSeenAt: now, clearedAt: null },
          create: { ...alarm, active: true, lastSeenAt: now },
        })));
      }
      await prisma.oltAlarm.updateMany({
        where: { active: true, ...(activeAlarmIds.length ? { alarmId: { notIn: activeAlarmIds } } : {}) },
        data: { active: false, clearedAt: now },
      });

      const onlineOnus = overview.onus.filter((onu) => onu.online).length;
      const temperatures = overview.cards.map((card) => card.temperatureC).filter(Number.isFinite);
      const snapshot = await prisma.oltSnapshot.create({
        data: {
          status: 'online',
          systemName: overview.system.systemName,
          model: overview.system.model,
          version: overview.system.version,
          uptimeText: overview.system.uptimeText,
          totalOnus: overview.onus.length,
          onlineOnus,
          offlineOnus: overview.onus.length - onlineOnus,
          unconfiguredOnus: overview.unconfigured.length,
          activeAlarms: overview.alarms.length,
          criticalAlarms: overview.alarms.filter((alarm) => alarm.level === 'critical').length,
          maxTemperatureC: temperatures.length ? Math.max(...temperatures) : null,
          durationMs: Date.now() - startedAt,
        },
      });
      if (includeInventory) lastOltInventoryAt = Date.now();
      console.log(`[olt] sync ok: ${onlineOnus}/${overview.onus.length} online, ${overview.unconfigured.length} unconfigured, ${overview.alarms.length} alarms, inventory=${includeInventory}`);
      return { ok: true, includeInventory, snapshot, pons: overview.pons };
    } catch (error) {
      console.error('[olt] sync error:', error.message);
      await prisma.oltSnapshot.create({
        data: { status: 'offline', durationMs: Date.now() - startedAt, errorMessage: String(error.message).slice(0, 500) },
      }).catch(() => {});
      throw error;
    } finally {
      client.close();
    }
  })();

  try {
    return await oltSyncInProgress;
  } finally {
    oltSyncInProgress = null;
  }
}

function startOltSyncLoop() {
  const configured = createOltClient().isConfigured();
  if (!OLT_ENABLED || !configured) {
    console.log(`[olt] disabled or incomplete configuration (enabled=${OLT_ENABLED}, configured=${configured})`);
    return;
  }
  if (oltSyncTimer) return;
  console.log(`[olt] sync enabled every ${OLT_SYNC_INTERVAL_MS}ms`);
  setTimeout(() => runOltSync({ forceInventory: true }).catch(() => {}), 1000);
  oltSyncTimer = setInterval(() => runOltSync().catch(() => {}), OLT_SYNC_INTERVAL_MS);
  if (OLT_AUTO_AUTHORIZE_AGENT) {
    console.log('[olt-auto] enabled for validated ONU Studio jobs');
    setTimeout(() => runOltAgentAutoAuthorization().catch((error) => console.error('[olt-auto]', error.message)), 5000);
    oltAutoAuthorizeTimer = setInterval(
      () => runOltAgentAutoAuthorization().catch((error) => console.error('[olt-auto]', error.message)),
      15_000,
    );
  }
}

const oltRouter = express.Router();
oltRouter.use(authMiddleware);
oltRouter.use(requireAnyRole(['tecnico']));

oltRouter.get('/status', asyncHandler(async (req, res) => {
  const [latest, cards, totalOnus, onlineOnus, linkedOnus, activeAlarms, activeSignalAlerts, unconfiguredOnus] = await Promise.all([
    prisma.oltSnapshot.findFirst({ orderBy: { capturedAt: 'desc' } }),
    prisma.oltCard.findMany({ orderBy: [{ rack: 'asc' }, { shelf: 'asc' }, { slot: 'asc' }] }),
    prisma.oltOnu.count(),
    prisma.oltOnu.count({ where: { online: true } }),
    prisma.oltOnu.count({ where: { clientIdServicio: { not: null } } }),
    prisma.oltAlarm.count({ where: { active: true } }),
    prisma.oltSignalAlert.count({ where: { active: true } }),
    prisma.oltUnconfiguredOnu.count({ where: { active: true } }),
  ]);
  const configured = createOltClient().isConfigured();
  res.json({
    enabled: OLT_ENABLED,
    configured,
    syncing: Boolean(oltSyncInProgress),
    autoAuthorizeAgent: { enabled: OLT_AUTO_AUTHORIZE_AGENT, running: oltAutoAuthorizeInProgress },
    connected: latest?.status === 'online' && Date.now() - latest.capturedAt.getTime() < OLT_SYNC_INTERVAL_MS * 3,
    syncIntervalMs: OLT_SYNC_INTERVAL_MS,
    inventoryIntervalMs: OLT_INVENTORY_INTERVAL_MS,
    latest,
    totals: { totalOnus, onlineOnus, offlineOnus: totalOnus - onlineOnus, linkedOnus, unlinkedOnus: totalOnus - linkedOnus, activeAlarms, activeSignalAlerts, unconfiguredOnus },
    cards,
  });
}));

oltRouter.get('/pons', asyncHandler(async (req, res) => {
  const onus = await prisma.oltOnu.findMany({
    select: { rack: true, shelf: true, pon: true, online: true, clientIdServicio: true, rxPowerDbm: true },
    orderBy: [{ rack: 'asc' }, { shelf: 'asc' }, { pon: 'asc' }, { onuId: 'asc' }],
  });
  res.json(buildPonHealth(onus, OLT_PON_CAPACITY));
}));

oltRouter.get('/onus', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
  const search = String(req.query.search || '').trim();
  const pon = Number(req.query.pon);
  const status = String(req.query.status || 'all');
  const mapping = String(req.query.mapping || 'all');
  const matchingClients = search ? await prisma.client.findMany({
    where: { OR: [
      { nombre: { contains: search } },
      { usuario: { contains: search } },
      { telefono: { contains: search } },
    ] },
    select: { idServicio: true },
    take: 100,
  }) : [];
  const where = {
    ...(Number.isInteger(pon) && pon > 0 ? { pon } : {}),
    ...(status === 'online' ? { online: true } : status === 'offline' ? { online: false } : {}),
    ...(mapping === 'linked' ? { clientIdServicio: { not: null } } : mapping === 'unlinked' ? { clientIdServicio: null } : {}),
    ...(search ? { OR: [
      { onuIndex: { contains: search } },
      { name: { contains: search } },
      { model: { contains: search } },
      { serial: { contains: search } },
      ...(matchingClients.length ? [{ clientIdServicio: { in: matchingClients.map((client) => client.idServicio) } }] : []),
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.oltOnu.findMany({ where, orderBy: [{ rack: 'asc' }, { shelf: 'asc' }, { pon: 'asc' }, { onuId: 'asc' }], skip: (page - 1) * limit, take: limit }),
    prisma.oltOnu.count({ where }),
  ]);
  const clientIds = [...new Set(items.map((item) => item.clientIdServicio).filter(Number.isInteger))];
  const clients = clientIds.length ? await prisma.client.findMany({
    where: { idServicio: { in: clientIds } },
    select: { idServicio: true, nombre: true, usuario: true, telefono: true, ip: true, snOnu: true, planInternetName: true },
  }) : [];
  const clientsById = new Map(clients.map((client) => [client.idServicio, client]));
  res.json({
    items: items.map((item) => ({ ...item, client: item.clientIdServicio ? clientsById.get(item.clientIdServicio) || null : null })),
    total, page, limit, pages: Math.max(1, Math.ceil(total / limit)),
  });
}));

oltRouter.get('/onus/:rack/:shelf/:pon/:onu/detail', asyncHandler(async (req, res) => {
  const numbers = ['rack', 'shelf', 'pon', 'onu'].map((key) => Number(req.params[key]));
  if (numbers.some((number) => !Number.isInteger(number) || number < 0 || number > 255)) {
    return res.status(400).json({ error: 'ONU inválida' });
  }
  const onuIndex = `${numbers[0]}/${numbers[1]}/${numbers[2]}:${numbers[3]}`;
  const client = createOltClient();
  try {
    const detail = await client.fetchOnuDetail(onuIndex);
    const { traffic, ...persistedDetail } = detail;
    const capturedAt = new Date();
    const previousReadings = await prisma.oltOpticalReading.findMany({
      where: { onuIndex, rxPowerDbm: { not: null } }, orderBy: { capturedAt: 'desc' }, take: 10, select: { rxPowerDbm: true },
    });
    const row = await prisma.oltOnu.update({ where: { onuIndex }, data: { ...persistedDetail, lastDetailAt: capturedAt } });
    await prisma.oltOpticalReading.create({
      data: {
        onuIndex,
        online: row.online,
        phaseState: row.phaseState,
        distanceM: detail.distanceM,
        rxPowerDbm: detail.rxPowerDbm,
        txPowerDbm: detail.txPowerDbm,
        attenuationUpDb: detail.attenuationUpDb,
        attenuationDownDb: detail.attenuationDownDb,
        capturedAt,
      },
    });
    const staleReadings = await prisma.oltOpticalReading.findMany({
      where: { onuIndex }, orderBy: { capturedAt: 'desc' }, skip: 500, select: { id: true },
    });
    if (staleReadings.length) {
      await prisma.oltOpticalReading.deleteMany({ where: { id: { in: staleReadings.map((reading) => reading.id) } } });
    }
    await persistOpticalAlerts(onuIndex, detail.rxPowerDbm, previousReadings.map((reading) => reading.rxPowerDbm), capturedAt);
    const [agentInventory, linkedClient] = await Promise.all([
      row.serial ? latestAgentInventoryForSerial(row.serial) : null,
      row.clientIdServicio == null ? null : prisma.client.findUnique({
        where: { idServicio: row.clientIdServicio },
        select: {
          idServicio: true, nombre: true, usuario: true, telefono: true,
          ip: true, snOnu: true, planInternetName: true,
        },
      }),
    ]);
    res.json({ ...row, client: linkedClient, agentInventory, traffic });
  } finally {
    client.close();
  }
}));

oltRouter.get('/onus/:rack/:shelf/:pon/:onu/service-diagnostics', asyncHandler(async (req, res) => {
  const onuIndex = `${Number(req.params.rack)}/${Number(req.params.shelf)}/${Number(req.params.pon)}:${Number(req.params.onu)}`;
  try { assertOnuIndex(onuIndex); } catch { return res.status(400).json({ error: 'ONU inválida' }); }
  const onu = await prisma.oltOnu.findUnique({ where: { onuIndex } });
  if (!onu) return res.status(404).json({ error: 'ONU no encontrada' });
  const linkedClient = onu.clientIdServicio == null ? null : await prisma.client.findUnique({
    where: { idServicio: onu.clientIdServicio },
    select: {
      idServicio: true, nombre: true, usuario: true, estado: true, estadoFacturas: true,
      ip: true, snOnu: true, planInternetName: true, mtQueueLimit: true,
      mtMacAddress: true, macCpe: true, mtQueueName: true,
    },
  });
  const agentInventory = onu.serial ? await latestAgentInventoryForSerial(onu.serial) : null;

  let access = {
    mode: 'unknown', confidence: 'low', evidence: [], limitation: null,
    macTable: [], capturedAt: new Date().toISOString(), error: null,
  };
  const oltAccessClient = createOltClient();
  try {
    access = { ...await oltAccessClient.fetchOnuAccessTopology(onuIndex, onu.model), error: null };
  } catch (error) {
    access.error = error.message;
    access.evidence = ['No se pudo leer la configuracion de servicio de la ONU'];
    access.limitation = 'Reintente el diagnostico cuando la OLT responda.';
  } finally {
    oltAccessClient.close();
  }

  let mikrotik = { connected: false, queue: null, arp: null, ping: null, error: null };
  let downstream = {
    source: 'none', totalMacs: access.macTable.length, identifiedClients: 0, unknownDevices: 0,
    clients: [], limitation: access.limitation || null,
  };
  if ((linkedClient?.ip && isValidIpv4(linkedClient.ip)) || access.macTable.length) {
    try {
      const connection = await getMtConnection();
      const [queues, arp, pingRows, networkClients] = await Promise.all([
        mtWrite(connection, 10_000, '/queue/simple/print'),
        mtWrite(connection, 10_000, '/ip/arp/print'),
        linkedClient?.ip && isValidIpv4(linkedClient.ip)
          ? mtWrite(connection, 7_000, '/ping', `=address=${linkedClient.ip}`, '=count=3')
          : Promise.resolve([]),
        prisma.client.findMany({
          select: {
            idServicio: true, nombre: true, usuario: true, estado: true, estadoFacturas: true,
            ip: true, planInternetName: true, mtMacAddress: true, macCpe: true, mtQueueName: true,
          },
        }),
      ]);
      const queue = linkedClient?.ip ? queues.find((item) => queueTargetIp(item.target) === linkedClient.ip) || null : null;
      const arpEntry = linkedClient?.ip ? arp.find((item) => item.address === linkedClient.ip && isValidMac(item['mac-address'])) || null : null;
      const summary = pingRows.find((item) => item['packet-loss'] != null) || null;
      const replies = pingRows.filter((item) => item.time && !item.status).length;
      mikrotik = {
        connected: true,
        queue: queue ? { id: queue['.id'], name: queue.name, target: queue.target, maxLimit: queue['max-limit'], disabled: queue.disabled === 'true' || queue.disabled === true, bytes: queue.bytes || null, rate: queue.rate || null } : null,
        arp: arpEntry ? { macAddress: arpEntry['mac-address'], interface: arpEntry.interface, complete: arpEntry.complete !== 'false' } : null,
        ping: { reachable: replies > 0 || Number(summary?.received || 0) > 0, replies, packetLoss: summary?.['packet-loss'] || null, rows: pingRows.slice(-4) },
        error: null,
      };

      const clientByIp = new Map(networkClients.filter((client) => isValidIpv4(client.ip)).map((client) => [client.ip, client]));
      const clientByMac = new Map();
      for (const client of networkClients) {
        for (const value of [client.mtMacAddress, client.macCpe]) {
          const macAddress = normalizeMacAddress(value);
          if (macAddress && !clientByMac.has(macAddress)) clientByMac.set(macAddress, client);
        }
      }
      const arpByMac = new Map();
      for (const entry of arp) {
        const macAddress = normalizeMacAddress(entry['mac-address']);
        if (macAddress && !arpByMac.has(macAddress)) arpByMac.set(macAddress, entry);
      }
      const queueByIp = new Map(queues.map((item) => [queueTargetIp(item.target), item]).filter(([ip]) => isValidIpv4(ip)));
      const downstreamRows = access.macTable.map((entry) => {
        const arpRow = arpByMac.get(entry.macAddress) || null;
        const ip = arpRow?.address && isValidIpv4(arpRow.address) ? arpRow.address : null;
        const client = (ip ? clientByIp.get(ip) : null) || clientByMac.get(entry.macAddress) || null;
        const serviceIp = client?.ip || ip;
        const clientQueue = serviceIp ? queueByIp.get(serviceIp) || null : null;
        return {
          macAddress: entry.macAddress,
          vlan: entry.vlan,
          ip,
          arpComplete: Boolean(arpRow && arpRow.complete !== 'false'),
          client: client ? {
            idServicio: client.idServicio, nombre: client.nombre, usuario: client.usuario,
            ip: client.ip, estado: client.estado, estadoFacturas: client.estadoFacturas,
            planInternetName: client.planInternetName,
          } : null,
          queue: clientQueue ? {
            name: clientQueue.name, target: clientQueue.target, maxLimit: clientQueue['max-limit'],
            disabled: clientQueue.disabled === 'true' || clientQueue.disabled === true,
            rate: clientQueue.rate || null,
          } : null,
        };
      });
      if (access.mode === 'router' && !downstreamRows.some((row) => row.client) && linkedClient) {
        downstreamRows.push({
          macAddress: mikrotik.arp?.macAddress || null, vlan: null, ip: linkedClient.ip || null,
          arpComplete: Boolean(mikrotik.arp), client: linkedClient, queue: mikrotik.queue,
        });
      }
      const identifiedIds = new Set(downstreamRows.map((row) => row.client?.idServicio).filter(Number.isInteger));
      downstream = {
        source: access.mode === 'bridge' ? 'olt-fdb-mikrotik' : (access.mode === 'router' ? 'subscriber-wan' : 'best-effort'),
        totalMacs: access.macTable.length,
        identifiedClients: identifiedIds.size,
        unknownDevices: downstreamRows.filter((row) => !row.client).length,
        clients: downstreamRows,
        limitation: access.mode === 'router'
          ? 'La ONU trabaja como router/NAT. La OLT identifica el abonado; los celulares y equipos LAN requieren TR-069 o el agente local.'
          : access.limitation || null,
      };
    } catch (error) {
      mikrotik.error = error.message;
      downstream.limitation = `No se pudo cruzar la tabla MAC con MikroTik: ${error.message}`;
    }
  }

  const powerKnown = Number.isFinite(onu.rxPowerDbm);
  const powerHealthy = powerKnown && onu.rxPowerDbm >= -27 && onu.rxPowerDbm <= -8;
  const serialMatches = Boolean(linkedClient?.snOnu) && normalizeSerial(linkedClient.snOnu) === normalizeSerial(onu.serial);
  const checks = [
    { key: 'olt_online', label: 'ONU registrada y online', ok: onu.online, required: true, detail: onu.phaseState || (onu.online ? 'working' : 'offline') },
    { key: 'optical_power', label: 'Potencia optica saludable', ok: powerHealthy, required: true, detail: powerKnown ? `${onu.rxPowerDbm} dBm` : 'Sin lectura' },
    { key: 'onu_access_mode', label: 'Modo de servicio identificado', ok: access.mode !== 'unknown', required: false, detail: `${access.mode} (${access.confidence})` },
    { key: 'downstream_inventory', label: 'Equipos detras de la ONU', ok: downstream.identifiedClients > 0, required: false, detail: `${downstream.identifiedClients} clientes / ${downstream.totalMacs} MAC` },
    { key: 'client_link', label: 'Cliente asociado', ok: Boolean(linkedClient), required: true, detail: linkedClient?.nombre || 'Sin cliente' },
    { key: 'serial_match', label: 'Serial coincide con WispHub', ok: serialMatches, required: false, detail: linkedClient?.snOnu || 'Serial no guardado en WispHub' },
    { key: 'service_ip', label: 'IP de servicio valida', ok: Boolean(linkedClient?.ip && isValidIpv4(linkedClient.ip)), required: true, detail: linkedClient?.ip || 'Sin IP' },
    { key: 'mikrotik_queue', label: 'Cola MikroTik activa', ok: Boolean(mikrotik.queue && !mikrotik.queue.disabled), required: true, detail: mikrotik.queue?.maxLimit || mikrotik.error || 'Sin cola' },
    { key: 'arp_presence', label: 'MAC aprendida por MikroTik', ok: Boolean(mikrotik.arp), required: false, detail: mikrotik.arp?.macAddress || 'Sin ARP valido' },
    { key: 'router_ping', label: 'Respuesta desde MikroTik', ok: Boolean(mikrotik.ping?.reachable), required: true, detail: mikrotik.ping?.packetLoss || mikrotik.error || 'Sin respuesta' },
  ];
  if (agentInventory) {
    const agentSerialMatches = normalizeSerial(agentInventory.summary.serial) === normalizeSerial(onu.serial);
    const agentWanMatches = !linkedClient?.ip || agentInventory.summary.wanIp === linkedClient.ip;
    checks.push(
      { key: 'agent_inventory', label: 'Inventario ONU Studio disponible', ok: true, required: false, detail: `${agentInventory.summary.model || 'ONU'} - ${agentInventory.phase}` },
      { key: 'agent_serial', label: 'Serial local coincide con la OLT', ok: agentSerialMatches, required: false, detail: agentInventory.summary.serial },
      { key: 'agent_wan', label: 'WAN local coincide con el cliente', ok: agentWanMatches, required: false, detail: agentInventory.summary.wanIp || 'Sin WAN leida' },
    );
  }
  const requiredChecks = checks.filter((check) => check.required);
  const passed = checks.filter((check) => check.ok).length;
  const ready = requiredChecks.every((check) => check.ok);
  res.json({
    onuIndex, capturedAt: new Date().toISOString(), ready,
    score: Math.round((passed / checks.length) * 100), checks, client: linkedClient, mikrotik, agentInventory, access, downstream,
    recommendation: ready ? 'Servicio listo para entrega' : checks.filter((check) => check.required && !check.ok).map((check) => check.label),
  });
}));

oltRouter.get('/onus/:rack/:shelf/:pon/:onu/optical-history', asyncHandler(async (req, res) => {
  const onuIndex = `${Number(req.params.rack)}/${Number(req.params.shelf)}/${Number(req.params.pon)}:${Number(req.params.onu)}`;
  try { assertOnuIndex(onuIndex); } catch { return res.status(400).json({ error: 'ONU inválida' }); }
  const limit = Math.min(200, Math.max(5, Number(req.query.limit) || 30));
  const readings = await prisma.oltOpticalReading.findMany({ where: { onuIndex }, orderBy: { capturedAt: 'desc' }, take: limit });
  res.json(readings.reverse());
}));

oltRouter.get('/clients/search', asyncHandler(async (req, res) => {
  const search = String(req.query.q || '').trim();
  if (search.length < 2) return res.json([]);
  const numericId = Number(search);
  const clients = await prisma.client.findMany({
    where: { OR: [
      ...(Number.isInteger(numericId) ? [{ idServicio: numericId }] : []),
      { nombre: { contains: search } },
      { usuario: { contains: search } },
      { telefono: { contains: search } },
      { snOnu: { contains: search } },
    ] },
    select: { idServicio: true, nombre: true, usuario: true, telefono: true, ip: true, snOnu: true, planInternetName: true },
    orderBy: { nombre: 'asc' },
    take: 20,
  });
  res.json(clients);
}));

oltRouter.patch('/onus/:rack/:shelf/:pon/:onu/client', requireRole(['admin']), asyncHandler(async (req, res) => {
  const onuIndex = `${Number(req.params.rack)}/${Number(req.params.shelf)}/${Number(req.params.pon)}:${Number(req.params.onu)}`;
  try { assertOnuIndex(onuIndex); } catch { return res.status(400).json({ error: 'ONU inválida' }); }
  const idServicio = req.body?.idServicio == null ? null : Number(req.body.idServicio);
  if (idServicio != null && !Number.isInteger(idServicio)) return res.status(400).json({ error: 'Cliente inválido' });
  const [onu, client] = await Promise.all([
    prisma.oltOnu.findUnique({ where: { onuIndex } }),
    idServicio == null ? null : prisma.client.findUnique({ where: { idServicio }, select: { idServicio: true, nombre: true, usuario: true, telefono: true, ip: true, snOnu: true } }),
  ]);
  if (!onu) return res.status(404).json({ error: 'ONU no encontrada' });
  if (idServicio != null && !client) return res.status(404).json({ error: 'Cliente no encontrado' });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (idServicio != null) {
      await tx.oltOnu.updateMany({
        where: { clientIdServicio: idServicio, onuIndex: { not: onuIndex } },
        data: { clientIdServicio: null, mappingSource: null, mappedAt: null, mappedBy: null },
      });
    }
    await tx.oltOnu.update({
      where: { onuIndex },
      data: idServicio == null
        ? { clientIdServicio: null, mappingSource: null, mappedAt: null, mappedBy: null }
        : { clientIdServicio: idServicio, mappingSource: 'manual', mappedAt: now, mappedBy: req.session.username },
    });
  });
  await logActivity(req, {
    action: idServicio == null ? 'olt_onu_client_unlinked' : 'olt_onu_client_linked',
    entityType: 'olt', entityId: onuIndex, entityName: onu.name || onu.serial,
    details: { onuIndex, serial: onu.serial, idServicio, clientName: client?.nombre || null },
  });
  res.json({ ok: true, onuIndex, client });
}));

oltRouter.get('/unconfigured/:serial/provisioning-options', requireRole(['admin']), asyncHandler(async (req, res) => {
  const serial = safeOltSerial(req.params.serial);
  const pending = await prisma.oltUnconfiguredOnu.findUnique({ where: { serial } });
  if (!pending?.active) return res.status(404).json({ error: 'ONU sin autorizar no encontrada' });
  const relocation = await pendingPonRelocation(pending);
  const client = createOltClient();
  try {
    const options = await client.fetchProvisioningOptions(pending.ponIndex);
    await client.checkWriteAccess();
    const vendorPrefix = serial.slice(0, 4);
    const peers = await prisma.oltOnu.findMany({
      where: { pon: pending.pon, serial: { not: null }, model: { not: null } },
      select: { serial: true, model: true },
    });
    const profiles = await prisma.oltProvisioningProfile.findMany({
      where: { active: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    const agentInventory = await latestAgentInventoryForSerial(serial);
    const usage = new Map();
    for (const peer of peers) {
      if (String(peer.serial || '').toUpperCase().startsWith(vendorPrefix)) {
        usage.set(peer.model, (usage.get(peer.model) || 0) + 1);
      }
    }
    const agentDevice = agentInventory?.inventory?.device || {};
    const agentModel = String(agentDevice.model || agentInventory?.model || '').trim();
    const modelProfileMatch = await resolveOnuModelProfile({
      serial, manufacturer: agentDevice.manufacturer, model: agentModel,
      softwareVersion: agentDevice.softwareVersion || agentInventory?.softwareVersion,
    });
    if (modelProfileMatch) {
      await persistOnuDeviceProfile({
        serial, manufacturer: agentDevice.manufacturer, model: agentModel,
        softwareVersion: agentDevice.softwareVersion || agentInventory?.softwareVersion,
      }, modelProfileMatch, 'discovery');
    }
    const expectedOnuType = modelProfileMatch?.profile?.oltOnuType || null;
    const recommendedOnuType = options.onuTypes.find((item) => expectedOnuType && item.name.toUpperCase() === expectedOnuType.toUpperCase())?.name
      || options.onuTypes.find((item) => item.name.toUpperCase() === agentModel.toUpperCase())?.name
      || [...usage.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      || options.onuTypes.find((item) => item.name === 'HG8546M')?.name
      || options.onuTypes[0]?.name
      || null;
    const speed = 100;
    res.json({
      serial,
      ponIndex: pending.ponIndex,
      relocation,
      recommendedOnuId: options.recommendedOnuId,
      recommendedOnuType,
      modelProfile: modelProfileMatch ? {
        ...onuModelProfileDto(modelProfileMatch.profile), confidence: modelProfileMatch.confidence,
      } : null,
      onuTypes: options.onuTypes,
      tcontProfiles: options.tcontProfiles,
      trafficProfiles: options.trafficProfiles,
      profiles: profiles.filter((profile) => !profile.vendorPrefix || serial.startsWith(profile.vendorPrefix.toUpperCase())).map(oltProvisioningProfileDto),
      agentInventory,
      defaults: {
        ...OLT_PROVISIONING_DEFAULTS,
        tcontProfile: recommendedProfile(options.tcontProfiles, speed, /100.*UP/i),
        trafficProfile: recommendedProfile(options.trafficProfiles, speed, /100.*DOWN/i),
      },
      writeAccess: true,
      compatibility: {
        detectedModel: agentModel || null,
        exactOnuTypeAvailable: Boolean(agentModel && options.onuTypes.some((item) => item.name.toUpperCase() === agentModel.toUpperCase())),
        expectedOnuType,
        profileMatched: Boolean(expectedOnuType && recommendedOnuType && expectedOnuType.toUpperCase() === recommendedOnuType.toUpperCase()),
      },
    });
  } finally {
    client.close();
  }
}));

oltRouter.post('/unconfigured/:serial/provision/preview', requireRole(['admin']), asyncHandler(async (req, res) => {
  if (oltMutationInProgress) return res.status(409).json({ error: 'Ya hay una autorización ONU en curso' });
  const serial = safeOltSerial(req.params.serial);
  const relocationContext = await manualPonRelocationContext(serial, req.body);
  const prepared = await prepareOltProvisioning(serial, req.body, relocationContext || {});
  const speed = inferredPlanSpeed(prepared.client.planInternetName);
  res.json({
    serial: prepared.serial,
    onuIndex: `${prepared.config.ponIndex}:${prepared.config.onuId}`,
    client: prepared.client,
    config: prepared.config,
    modelProfile: prepared.modelProfile ? onuModelProfileDto(prepared.modelProfile) : null,
    relocation: relocationContext?.relocation || null,
    inferredPlanSpeedMbps: speed,
    warnings: [
      ...(!prepared.client.snOnu ? ['El cliente no tiene serial ONU guardado en WispHub.'] : []),
      ...(speed !== 100 && !prepared.config.tcontProfile.includes(String(speed)) ? [`El plan parece ser de ${speed} Mbps; revise los perfiles seleccionados.`] : []),
    ],
    steps: [
      ...(relocationContext ? [`Respaldar y retirar la autorizacion anterior ${relocationContext.previousOnu.onuIndex}`] : []),
      relocationContext ? 'Registrar el mismo serial en el primer ID libre del nuevo PON' : 'Registrar el serial en el primer ID libre del PON',
      'Crear T-CONT, GEM port y service-port',
      `Aplicar VLAN ${prepared.config.vlan} y perfiles de velocidad`,
      prepared.config.serviceMode === 'bridge'
        ? `Entregar VLAN por ${prepared.config.lanPorts.map((port) => `LAN${port}`).join(', ')} sin crear ip-host`
        : `Asignar IP de gestion ${prepared.config.managementIp}`,
      'Guardar, releer la OLT y validar serial y servicio',
    ],
    requiredConfirmation: `AUTORIZAR ${prepared.serial}`,
  });
}));

oltRouter.post('/unconfigured/:serial/provision', requireRole(['admin']), asyncHandler(async (req, res) => {
  const serial = safeOltSerial(req.params.serial);
  if (String(req.body?.confirmation || '').trim().toUpperCase() !== `AUTORIZAR ${serial}`) {
    return res.status(400).json({ error: `Escriba AUTORIZAR ${serial} para confirmar` });
  }
  if (oltMutationInProgress) return res.status(409).json({ error: 'Ya hay una autorización ONU en curso' });
  if (oltSyncInProgress) await oltSyncInProgress.catch(() => {});
  oltMutationInProgress = true;

  let prepared;
  let applied;
  let relocationContext = null;
  try {
    relocationContext = await manualPonRelocationContext(serial, req.body);
    prepared = await prepareOltProvisioning(serial, req.body, relocationContext || {});
    applied = relocationContext
      ? await applyPreparedPonMigration(prepared, relocationContext.migrationJob, relocationContext.previousOnu)
      : await applyPreparedOltProvisioning(prepared);
  } catch (error) {
    const { completedSteps, rollback } = await recordOltProvisioningFailure(req, serial, prepared, error);
    return res.status(error.statusCode || 502).json({ error: error.message, completedSteps, rollback });
  } finally {
    oltMutationInProgress = false;
  }
  const result = await finalizeOltProvisioning(prepared, applied, {
    req, actor: req.session.username, mappingSource: 'manual',
  });
  await finalizeManualPonRelocation(req, relocationContext, result);
  res.json(result);
}));

oltRouter.get('/unconfigured', asyncHandler(async (req, res) => {
  const activeOnly = req.query.active !== 'false';
  const items = await prisma.oltUnconfiguredOnu.findMany({
    where: activeOnly ? { active: true } : {}, orderBy: [{ active: 'desc' }, { lastSeenAt: 'desc' }], take: 500,
  });
  const serials = items.map((item) => normalizeSerial(item.serial));
  const storedOnus = serials.length ? await prisma.oltOnu.findMany({
    where: { serial: { not: null } },
    select: {
      onuIndex: true, serial: true, name: true, model: true, online: true,
      clientIdServicio: true, lastSeenAt: true,
    },
  }) : [];
  const relocationBySerial = new Map(items.map((item) => [
    normalizeSerial(item.serial), buildPendingPonRelocation({ pending: item, dbOnus: storedOnus }),
  ]));
  const jobs = serials.length ? await prisma.provisioningJob.findMany({
    where: { serial: { in: serials }, status: { in: ['in_progress', 'waiting_optical', 'partial'] } },
    orderBy: { updatedAt: 'desc' },
  }) : [];
  const jobBySerial = new Map();
  for (const job of jobs) if (!jobBySerial.has(normalizeSerial(job.serial))) jobBySerial.set(normalizeSerial(job.serial), job);
  const relocationClientIds = [...relocationBySerial.values()].map((plan) => plan?.clientIdServicio).filter(Number.isInteger);
  const jobClientIds = [...jobs.map((job) => job.clientIdServicio), ...relocationClientIds].filter(Number.isInteger);
  const clients = serials.length ? await prisma.client.findMany({
    where: { OR: [{ snOnu: { not: null } }, ...(jobClientIds.length ? [{ idServicio: { in: jobClientIds } }] : [])] },
    select: { idServicio: true, nombre: true, usuario: true, telefono: true, snOnu: true },
  }) : [];
  const clientBySerial = new Map(clients.map((client) => [normalizeSerial(client.snOnu), client]));
  const clientById = new Map(clients.map((client) => [client.idServicio, client]));
  res.json(items.map((item) => {
    const serial = normalizeSerial(item.serial);
    const installation = jobBySerial.get(serial) || null;
    const relocation = relocationBySerial.get(serial) || null;
    return {
      ...item,
      discoveryType: relocation ? 'pon_relocation' : 'new',
      relocation,
      installation: installation ? provisioningJobDto(installation) : null,
      suggestedClient: clientBySerial.get(serial)
        || clientById.get(installation?.clientIdServicio)
        || clientById.get(relocation?.clientIdServicio)
        || null,
      authorizationStatus: relocation && !relocation.allowed ? 'review' : item.authorizationStatus,
      authorizationReason: relocation && !relocation.allowed
        ? relocation.reasons.join('. ')
        : item.authorizationReason,
    };
  }));
}));

async function createOltAssociationPreview() {
  const [onus, clients] = await Promise.all([
    prisma.oltOnu.findMany({
      select: { onuIndex: true, name: true, serial: true, clientIdServicio: true, mappingSource: true, online: true },
      orderBy: [{ rack: 'asc' }, { shelf: 'asc' }, { pon: 'asc' }, { onuId: 'asc' }],
    }),
    prisma.client.findMany({
      select: { idServicio: true, nombre: true, aliasNombre: true, usuario: true, ip: true, snOnu: true },
    }),
  ]);
  return buildOltAssociationPlan(onus, clients);
}

oltRouter.get('/reconciliation/associations/preview', asyncHandler(async (_req, res) => {
  res.json(await createOltAssociationPreview());
}));

oltRouter.post('/reconciliation/associations/apply', requireRole(['admin']), asyncHandler(async (req, res) => {
  const plan = await createOltAssociationPreview();
  const confirmation = String(req.body?.confirmation || '').trim().toUpperCase();
  if (!plan.matches.length) return res.status(409).json({ error: 'No hay coincidencias seguras nuevas para asociar', preview: plan });
  if (confirmation !== plan.requiredConfirmation) {
    return res.status(400).json({ error: `Escriba ${plan.requiredConfirmation} para confirmar`, preview: plan });
  }

  const mappedAt = new Date();
  const applied = [];
  const skipped = [];
  await prisma.$transaction(async (tx) => {
    const currentAssignments = await tx.oltOnu.findMany({
      where: { clientIdServicio: { not: null } }, select: { onuIndex: true, clientIdServicio: true },
    });
    const assignedClients = new Set(currentAssignments.map((item) => item.clientIdServicio));
    for (const match of plan.matches) {
      if (assignedClients.has(match.client.idServicio)) {
        skipped.push({ ...match, reason: 'client_already_linked' });
        continue;
      }
      const result = await tx.oltOnu.updateMany({
        where: { onuIndex: match.onuIndex, clientIdServicio: null },
        data: {
          clientIdServicio: match.client.idServicio,
          mappingSource: match.method === 'serial' ? 'serial' : 'manual',
          mappedAt,
          mappedBy: `bulk:${req.session.username}`,
        },
      });
      if (result.count === 1) {
        assignedClients.add(match.client.idServicio);
        applied.push(match);
      } else {
        skipped.push({ ...match, reason: 'onu_already_linked' });
      }
    }
  });

  await logActivity(req, {
    action: 'olt_onu_bulk_linked', entityType: 'olt', entityName: 'Conciliacion masiva de ONU',
    details: {
      applied: applied.length,
      skipped: skipped.length,
      exactSerial: applied.filter((item) => item.method === 'serial').length,
      exactName: applied.filter((item) => item.method === 'name').length,
      matches: applied.slice(0, 100).map((item) => ({ onuIndex: item.onuIndex, idServicio: item.client.idServicio, method: item.method })),
    },
  });
  res.json({ ok: true, applied: applied.length, skipped, preview: await createOltAssociationPreview() });
}));

oltRouter.get('/reconciliation', asyncHandler(async (req, res) => {
  const [onus, clients] = await Promise.all([
    prisma.oltOnu.findMany({ select: { onuIndex: true, serial: true, clientIdServicio: true, mappingSource: true } }),
    prisma.client.findMany({ where: { snOnu: { not: null } }, select: { idServicio: true, nombre: true, usuario: true, snOnu: true } }),
  ]);
  const registeredSerials = new Set(onus.map((onu) => normalizeSerial(onu.serial)).filter(Boolean));
  const assignmentCounts = new Map();
  for (const onu of onus) if (onu.clientIdServicio) assignmentCounts.set(onu.clientIdServicio, (assignmentCounts.get(onu.clientIdServicio) || 0) + 1);
  const linked = onus.filter((onu) => onu.clientIdServicio != null);
  res.json({
    totalOnus: onus.length,
    linkedOnus: linked.length,
    unlinkedOnus: onus.length - linked.length,
    manualLinks: linked.filter((onu) => onu.mappingSource === 'manual').length,
    serialLinks: linked.filter((onu) => onu.mappingSource === 'serial').length,
    duplicateAssignments: [...assignmentCounts.values()].filter((count) => count > 1).length,
    clientsWithSerial: clients.length,
    clientsWithSerialNotFound: clients.filter((client) => !registeredSerials.has(normalizeSerial(client.snOnu))).slice(0, 100),
  });
}));

oltRouter.get('/signal-alerts', asyncHandler(async (req, res) => {
  const activeOnly = req.query.active !== 'false';
  const items = await prisma.oltSignalAlert.findMany({
    where: activeOnly ? { active: true } : {},
    orderBy: [{ active: 'desc' }, { severity: 'asc' }, { lastSeenAt: 'desc' }],
    take: Math.min(500, Math.max(10, Number(req.query.limit) || 100)),
  });
  res.json(items);
}));

oltRouter.get('/profiles', asyncHandler(async (req, res) => {
  const items = await prisma.oltProvisioningProfile.findMany({
    where: req.query.active === 'false' ? {} : { active: true },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
  res.json(items.map(oltProvisioningProfileDto));
}));

oltRouter.get('/model-profiles', asyncHandler(async (req, res) => {
  const items = await listOnuModelProfiles({ activeOnly: req.query.active !== 'false' });
  res.json(items.map(onuModelProfileDto));
}));

oltRouter.post('/model-profiles', requireRole(['admin']), asyncHandler(async (req, res) => {
  let input;
  try { input = sanitizeOnuModelProfile({ ...req.body, builtIn: false }); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const duplicate = await prisma.onuModelProfile.findUnique({ where: { profileKey: input.profileKey } });
  if (duplicate) return res.status(409).json({ error: `Ya existe el perfil ${input.profileKey}` });
  const created = await prisma.onuModelProfile.create({
    data: {
      ...onuModelProfileData(input), builtIn: false, version: 1, createdBy: req.session.username,
      capabilities: { create: input.capabilities },
      versions: {
        create: {
          version: 1, snapshotJson: JSON.stringify(profileSnapshot(input, input.capabilities)),
          changedBy: req.session.username, changeReason: 'Creacion del perfil',
        },
      },
    },
    include: { capabilities: true, _count: { select: { devices: true } } },
  });
  await logActivity(req, {
    action: 'olt_onu_model_profile_created', entityType: 'olt_model_profile',
    entityId: created.id, entityName: created.profileKey,
    details: { manufacturer: created.manufacturer, model: created.model, oltOnuType: created.oltOnuType },
  });
  res.status(201).json(onuModelProfileDto(created));
}));

oltRouter.patch('/model-profiles/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = Number.isInteger(id) ? await prisma.onuModelProfile.findUnique({
    where: { id }, include: { capabilities: true, _count: { select: { devices: true } } },
  }) : null;
  if (!existing) return res.status(404).json({ error: 'Perfil de modelo no encontrado' });
  let input;
  try {
    input = sanitizeOnuModelProfile({ ...req.body, profileKey: existing.profileKey, builtIn: existing.builtIn }, onuModelProfileDto(existing));
  } catch (error) { return res.status(400).json({ error: error.message }); }
  const nextVersion = existing.version + 1;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.onuModelProfile.update({
      where: { id }, data: { ...onuModelProfileData(input), profileKey: existing.profileKey, builtIn: existing.builtIn, version: nextVersion },
    });
    if (Array.isArray(req.body?.capabilities)) {
      await tx.onuModelCapability.deleteMany({ where: { profileId: id } });
      if (input.capabilities.length) await tx.onuModelCapability.createMany({
        data: input.capabilities.map((item) => ({ ...item, profileId: id })),
      });
    }
    await tx.onuModelProfileVersion.create({
      data: {
        profileId: id, version: nextVersion,
        snapshotJson: JSON.stringify(profileSnapshot(input, input.capabilities)),
        changedBy: req.session.username,
        changeReason: req.body?.changeReason ? safeOltLabel(req.body.changeReason, 'Motivo', 300) : 'Actualizacion del perfil',
      },
    });
    return tx.onuModelProfile.findUnique({
      where: { id }, include: { capabilities: true, _count: { select: { devices: true } } },
    });
  });
  await logActivity(req, {
    action: 'olt_onu_model_profile_updated', entityType: 'olt_model_profile',
    entityId: id, entityName: updated.profileKey,
    details: { version: nextVersion, active: updated.active, certificationStatus: updated.certificationStatus },
  });
  res.json(onuModelProfileDto(updated));
}));

oltRouter.post('/model-profiles/reconcile', requireRole(['admin']), asyncHandler(async (req, res) => {
  const profiles = (await listOnuModelProfiles()).map(onuModelProfileDto);
  const [tr069Devices, oltOnus] = await Promise.all([
    prisma.tr069Device.findMany({ select: { serial: true, manufacturer: true, model: true, softwareVersion: true } }),
    prisma.oltOnu.findMany({ where: { serial: { not: null } }, select: { serial: true, model: true, online: true }, orderBy: { online: 'desc' } }),
  ]);
  const identityBySerial = new Map();
  for (const onu of oltOnus) {
    const serial = normalizeSerial(onu.serial);
    if (serial && !identityBySerial.has(serial)) identityBySerial.set(serial, { serial, model: onu.model });
  }
  for (const device of tr069Devices) {
    const serial = normalizeSerial(device.serial);
    if (serial) identityBySerial.set(serial, { ...(identityBySerial.get(serial) || {}), ...device, serial });
  }
  let matched = 0;
  const unmatched = [];
  for (const identity of identityBySerial.values()) {
    const match = matchOnuModelProfile(profiles, identity);
    if (!match) { unmatched.push(identity.serial); continue; }
    await persistOnuDeviceProfile(identity, match, 'automatic');
    matched += 1;
  }
  await logActivity(req, {
    action: 'olt_onu_model_profiles_reconciled', entityType: 'olt_model_profile',
    entityId: 'catalog', entityName: 'Catalogo ONU', details: { matched, unmatched: unmatched.length },
  });
  res.json({ ok: true, scanned: identityBySerial.size, matched, unmatched });
}));

oltRouter.get('/onu-types', requireRole(['admin']), asyncHandler(async (_req, res) => {
  const client = createOltClient();
  try {
    const items = await client.fetchOnuTypeCatalog();
    const f670l = items.find((item) => item.name.toUpperCase() === 'F670L') || null;
    res.json({
      items,
      compatibility: {
        model: 'F670L',
        profileInstalled: Boolean(f670l),
        profile: f670l,
        requiredConfirmation: f670l ? null : 'CREAR PERFIL F670L',
      },
    });
  } finally {
    client.close();
  }
}));

oltRouter.post('/onu-types/f670l/ensure', requireRole(['admin']), asyncHandler(async (req, res) => {
  if (String(req.body?.confirmation || '').trim().toUpperCase() !== 'CREAR PERFIL F670L') {
    return res.status(400).json({ error: 'Escriba CREAR PERFIL F670L para confirmar' });
  }
  if (oltMutationInProgress || oltSyncInProgress || oltAutoAuthorizeInProgress) {
    return res.status(409).json({ error: 'Ya existe una operación OLT en curso' });
  }
  oltMutationInProgress = true;
  const client = createOltClient();
  try {
    const result = await client.ensureOnuTypeProfile('F670L');
    await logActivity(req, {
      action: 'olt_onu_type_profile_ensured',
      entityType: 'olt', entityId: 'F670L', entityName: 'F670L',
      details: { changed: result.changed, profile: result.profile },
    });
    res.json({ ok: true, ...result });
  } finally {
    oltMutationInProgress = false;
    client.close();
  }
}));

oltRouter.get('/profiles/plan-sync', requireRole(['admin']), asyncHandler(async (_req, res) => {
  res.json(await fetchOltPlanSyncPreview());
}));

oltRouter.post('/profiles/plan-sync', requireRole(['admin']), asyncHandler(async (req, res) => {
  if (String(req.body?.confirmation || '').trim().toUpperCase() !== 'SINCRONIZAR PLANES') {
    return res.status(400).json({ error: 'Confirmación incorrecta' });
  }
  if (oltMutationInProgress || oltSyncInProgress || oltAutoAuthorizeInProgress) {
    return res.status(409).json({ error: 'Ya existe una operación OLT en curso' });
  }
  const preview = await fetchOltPlanSyncPreview();
  if (!preview.plans.length) return res.status(409).json({ error: 'No hay velocidades comunes validas entre WispHub y MikroTik' });
  oltMutationInProgress = true;
  const client = createOltClient();
  try {
    const result = await client.createInternetSpeedProfiles(preview.plans.map((plan) => plan.speedMbps));
    const storedProfiles = [];
    for (const plan of result.profiles) {
      const name = `Internet ${plan.speedMbps} Mbps`;
      storedProfiles.push(await prisma.oltProvisioningProfile.upsert({
        where: { name },
        update: {
          vlan: OLT_PROVISIONING_DEFAULTS.vlan,
          tcontProfile: plan.tcontProfile,
          trafficProfile: plan.trafficProfile,
          active: true,
          notes: 'Sincronizado desde velocidades comunes de WispHub y MikroTik',
        },
        create: {
          name,
          vlan: OLT_PROVISIONING_DEFAULTS.vlan,
          tcontProfile: plan.tcontProfile,
          trafficProfile: plan.trafficProfile,
          active: true,
          notes: 'Sincronizado desde velocidades comunes de WispHub y MikroTik',
          createdBy: req.session.username,
        },
      }));
    }
    const catalog = await client.fetchProfileCatalog();
    const completedPlans = preview.plans.map((plan) => {
      const tcont = findInternetSpeedProfile(catalog.tcontProfiles, plan.speedMbps, 'up');
      const traffic = findInternetSpeedProfile(catalog.trafficProfiles, plan.speedMbps, 'down');
      return {
        ...plan,
        tcontProfile: tcont?.name || plan.tcontProfile,
        trafficProfile: traffic?.name || plan.trafficProfile,
        tcontExists: Boolean(tcont),
        trafficExists: Boolean(traffic),
        status: tcont && traffic ? 'ready' : 'missing',
      };
    });
    const completed = {
      ...preview,
      plans: completedPlans,
      summary: {
        ...preview.summary,
        ready: completedPlans.filter((plan) => plan.status === 'ready').length,
        missing: completedPlans.filter((plan) => plan.status === 'missing').length,
      },
    };
    await logActivity(req, {
      action: 'olt_plan_profiles_synced', entityType: 'olt', entityId: 'internet-profiles',
      entityName: 'Perfiles Internet', details: { changed: result.changed, speeds: result.profiles.map((item) => item.speedMbps) },
    });
    res.json({ ok: true, changed: result.changed, preview: completed, storedProfiles });
  } finally {
    client.close();
    oltMutationInProgress = false;
  }
}));

oltRouter.post('/profiles', requireRole(['admin']), asyncHandler(async (req, res) => {
  const name = safeOltLabel(req.body?.name, 'Nombre del perfil', 80);
  const vlan = Number(req.body?.vlan);
  if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) return res.status(400).json({ error: 'VLAN inválida' });
  const onuType = req.body?.onuType ? safeOltToken(req.body.onuType, 'Modelo ONU') : null;
  const vendorPrefix = req.body?.vendorPrefix ? safeOltToken(String(req.body.vendorPrefix).toUpperCase(), 'Prefijo de fabricante', { maxLength: 8, pattern: /^[A-Z0-9]{4,8}$/ }) : null;
  const tcontProfile = safeOltToken(req.body?.tcontProfile, 'Perfil de subida');
  const trafficProfile = safeOltToken(req.body?.trafficProfile, 'Perfil de bajada');
  const isDefault = req.body?.isDefault === true;
  const serviceMode = String(req.body?.serviceMode || 'router').toLowerCase();
  if (!['router', 'bridge'].includes(serviceMode)) return res.status(400).json({ error: 'Modo Router/Bridge inválido' });
  const lanPorts = [...new Set((Array.isArray(req.body?.lanPorts) ? req.body.lanPorts : [1]).map(Number))].sort();
  if (!lanPorts.length || lanPorts.some((port) => !Number.isInteger(port) || port < 1 || port > 4)) return res.status(400).json({ error: 'Puertos LAN invalidos' });
  const created = await prisma.$transaction(async (tx) => {
    if (isDefault) await tx.oltProvisioningProfile.updateMany({ data: { isDefault: false } });
    return tx.oltProvisioningProfile.create({
      data: { name, vlan, onuType, vendorPrefix, tcontProfile, trafficProfile, serviceMode,
        lanPortsJson: JSON.stringify(lanPorts), managementMode: serviceMode === 'bridge' ? 'none' : 'iphost',
        tr069Policy: serviceMode === 'bridge' ? 'disabled' : 'optional', omciPolicy: 'baseline',
        compatibleModelsJson: JSON.stringify(Array.isArray(req.body?.compatibleModels) ? req.body.compatibleModels.map(String).slice(0, 20) : []),
        isDefault, notes: req.body?.notes ? safeOltLabel(req.body.notes, 'Notas', 500) : null, createdBy: req.session.username },
    });
  });
  await logActivity(req, { action: 'olt_profile_created', entityType: 'olt', entityId: created.id, entityName: created.name, details: { vlan, onuType, tcontProfile, trafficProfile } });
  res.status(201).json(created);
}));

oltRouter.patch('/profiles/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = Number.isInteger(id) ? await prisma.oltProvisioningProfile.findUnique({ where: { id } }) : null;
  if (!existing) return res.status(404).json({ error: 'Perfil no encontrado' });
  const data = {};
  if (req.body?.name != null) data.name = safeOltLabel(req.body.name, 'Nombre del perfil', 80);
  if (req.body?.vlan != null) {
    const vlan = Number(req.body.vlan);
    if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) return res.status(400).json({ error: 'VLAN inválida' });
    data.vlan = vlan;
  }
  if (req.body?.onuType !== undefined) data.onuType = req.body.onuType ? safeOltToken(req.body.onuType, 'Modelo ONU') : null;
  if (req.body?.tcontProfile != null) data.tcontProfile = safeOltToken(req.body.tcontProfile, 'Perfil de subida');
  if (req.body?.trafficProfile != null) data.trafficProfile = safeOltToken(req.body.trafficProfile, 'Perfil de bajada');
  if (req.body?.serviceMode != null) {
    const serviceMode = String(req.body.serviceMode).toLowerCase();
    if (!['router', 'bridge'].includes(serviceMode)) return res.status(400).json({ error: 'Modo Router/Bridge inválido' });
    data.serviceMode = serviceMode;
    data.managementMode = serviceMode === 'bridge' ? 'none' : 'iphost';
    data.tr069Policy = serviceMode === 'bridge' ? 'disabled' : 'optional';
  }
  if (req.body?.lanPorts != null) {
    const lanPorts = [...new Set((Array.isArray(req.body.lanPorts) ? req.body.lanPorts : []).map(Number))].sort();
    if (!lanPorts.length || lanPorts.some((port) => !Number.isInteger(port) || port < 1 || port > 4)) return res.status(400).json({ error: 'Puertos LAN invalidos' });
    data.lanPortsJson = JSON.stringify(lanPorts);
  }
  if (req.body?.active != null) data.active = req.body.active === true;
  if (req.body?.isDefault != null) data.isDefault = req.body.isDefault === true;
  const updated = await prisma.$transaction(async (tx) => {
    if (data.isDefault) await tx.oltProvisioningProfile.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    return tx.oltProvisioningProfile.update({ where: { id }, data });
  });
  await logActivity(req, { action: 'olt_profile_updated', entityType: 'olt', entityId: id, entityName: updated.name, details: data });
  res.json(updated);
}));

oltRouter.get('/topology', asyncHandler(async (_req, res) => {
  const splitters = await prisma.oltSplitter.findMany({
    where: { active: true },
    include: { naps: { where: { active: true }, include: { ports: { orderBy: { portNumber: 'asc' } } }, orderBy: { code: 'asc' } } },
    orderBy: [{ ponIndex: 'asc' }, { name: 'asc' }],
  });
  const clientIds = [...new Set(splitters.flatMap((splitter) => splitter.naps.flatMap((nap) => nap.ports.map((port) => port.clientIdServicio))).filter(Number.isInteger))];
  const clients = clientIds.length ? await prisma.client.findMany({
    where: { idServicio: { in: clientIds } }, select: { idServicio: true, nombre: true, usuario: true, ip: true },
  }) : [];
  const clientsById = new Map(clients.map((client) => [client.idServicio, client]));
  res.json(splitters.map((splitter) => ({
    ...splitter,
    naps: splitter.naps.map((nap) => {
      const ports = nap.ports.map((port) => ({ ...port, client: port.clientIdServicio ? clientsById.get(port.clientIdServicio) || null : null }));
      return { ...nap, ports, usedPorts: ports.filter((port) => port.status === 'assigned').length, availablePorts: ports.filter((port) => port.status === 'available').length };
    }),
  })));
}));

oltRouter.post('/topology/splitters', requireRole(['admin']), asyncHandler(async (req, res) => {
  const name = safeOltLabel(req.body?.name, 'Nombre del splitter', 80);
  const ponIndex = String(req.body?.ponIndex || '');
  try { assertOnuIndex(`${ponIndex}:1`); } catch { return res.status(400).json({ error: 'Puerto PON inválido' }); }
  const ratio = Number(req.body?.ratio || 16);
  if (![2, 4, 8, 16, 32, 64, 128].includes(ratio)) return res.status(400).json({ error: 'Relación de splitter inválida' });
  const splitterType = ['balanced', 'unbalanced'].includes(req.body?.splitterType) ? req.body.splitterType : 'balanced';
  const insertionLossDb = req.body?.insertionLossDb == null || req.body.insertionLossDb === '' ? null : Number(req.body.insertionLossDb);
  if (insertionLossDb != null && (!Number.isFinite(insertionLossDb) || insertionLossDb < 0 || insertionLossDb > 40)) return res.status(400).json({ error: 'Perdida de insercion inválida' });
  const created = await prisma.oltSplitter.create({ data: { name, ponIndex, ratio, splitterType, insertionLossDb, zone: req.body?.zone ? safeOltLabel(req.body.zone, 'Zona', 80) : null, notes: req.body?.notes ? safeOltLabel(req.body.notes, 'Notas', 500) : null } });
  await logActivity(req, { action: 'olt_splitter_created', entityType: 'olt', entityId: created.id, entityName: created.name, details: { ponIndex, ratio } });
  res.status(201).json(created);
}));

oltRouter.post('/topology/naps', requireRole(['admin']), asyncHandler(async (req, res) => {
  const code = safeOltToken(String(req.body?.code || '').toUpperCase(), 'Codigo NAP', { maxLength: 32, pattern: /^[A-Z0-9_.-]+$/ });
  const name = safeOltLabel(req.body?.name, 'Nombre de NAP', 80);
  const capacity = Number(req.body?.capacity || 16);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 128) return res.status(400).json({ error: 'Capacidad NAP inválida' });
  const splitterId = req.body?.splitterId == null || req.body.splitterId === '' ? null : Number(req.body.splitterId);
  if (splitterId != null && (!Number.isInteger(splitterId) || !(await prisma.oltSplitter.findUnique({ where: { id: splitterId } })))) return res.status(400).json({ error: 'Splitter no encontrado' });
  const latitude = req.body?.latitude == null || req.body.latitude === '' ? null : Number(req.body.latitude);
  const longitude = req.body?.longitude == null || req.body.longitude === '' ? null : Number(req.body.longitude);
  if (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) return res.status(400).json({ error: 'Latitud inválida' });
  if (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) return res.status(400).json({ error: 'Longitud inválida' });
  const created = await prisma.$transaction(async (tx) => {
    const nap = await tx.oltNap.create({ data: { code, name, capacity, splitterId, latitude, longitude, zone: req.body?.zone ? safeOltLabel(req.body.zone, 'Zona', 80) : null, address: req.body?.address ? safeOltLabel(req.body.address, 'Direccion', 200) : null } });
    await tx.oltNapPort.createMany({ data: Array.from({ length: capacity }, (_, index) => ({ napId: nap.id, portNumber: index + 1 })) });
    return nap;
  });
  await logActivity(req, { action: 'olt_nap_created', entityType: 'olt', entityId: created.id, entityName: created.code, details: { splitterId, capacity } });
  res.status(201).json(created);
}));

oltRouter.patch('/topology/ports/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const port = Number.isInteger(id) ? await prisma.oltNapPort.findUnique({ where: { id }, include: { nap: true } }) : null;
  if (!port) return res.status(404).json({ error: 'Puerto NAP no encontrado' });
  const status = String(req.body?.status || 'assigned');
  if (!['available', 'reserved', 'assigned', 'damaged'].includes(status)) return res.status(400).json({ error: 'Estado de puerto inválido' });
  let data = { status, notes: req.body?.notes ? safeOltLabel(req.body.notes, 'Notas', 500) : port.notes };
  if (status === 'available') {
    data = { ...data, onuIndex: null, serial: null, clientIdServicio: null, assignedAt: null };
  } else if (status === 'assigned') {
    const onuIndex = String(req.body?.onuIndex || '');
    try { assertOnuIndex(onuIndex); } catch { return res.status(400).json({ error: 'ONU inválida' }); }
    const onu = await prisma.oltOnu.findUnique({ where: { onuIndex } });
    if (!onu) return res.status(404).json({ error: 'ONU no encontrada en el inventario' });
    const clientIdServicio = req.body?.clientIdServicio == null ? onu.clientIdServicio : Number(req.body.clientIdServicio);
    if (clientIdServicio != null && !Number.isInteger(clientIdServicio)) return res.status(400).json({ error: 'Cliente inválido' });
    data = { ...data, onuIndex, serial: onu.serial, clientIdServicio, assignedAt: new Date() };
  }
  const updated = await prisma.oltNapPort.update({ where: { id }, data });
  await logActivity(req, { action: 'olt_nap_port_updated', entityType: 'olt', entityId: updated.id, entityName: `${port.nap.code}:${port.portNumber}`, details: { status, onuIndex: updated.onuIndex, clientIdServicio: updated.clientIdServicio } });
  res.json(updated);
}));

async function inspectOnuRelocation(onuIndex, client) {
  const selected = await prisma.oltOnu.findUnique({ where: { onuIndex } });
  if (!selected) throw oltProvisioningError('ONU no encontrada', 404);
  const serial = normalizeSerial(selected.serial);
  if (!serial) throw oltProvisioningError('La ONU no tiene un serial valido', 409);
  const overview = await client.fetchOverview({ includeInventory: true });
  const matchingIndexes = overview.baseInfo.filter((row) => normalizeSerial(row.serial) === serial).map((row) => row.onuIndex);
  const dbOnus = await prisma.oltOnu.findMany({
    where: { onuIndex: { in: matchingIndexes } },
    select: { onuIndex: true, name: true, model: true, serial: true, online: true, phaseState: true, omccState: true, clientIdServicio: true },
  });
  return {
    selected,
    overview,
    plan: buildOnuRelocationPlan({ selectedOnuIndex: onuIndex, serial, states: overview.onus, baseInfo: overview.baseInfo, dbOnus, unconfigured: overview.unconfigured }),
  };
}

function relocationPreviewDto(plan) {
  const locations = plan.staleLocations.map((row) => row.onuIndex).join(', ');
  return {
    action: 'retire-stale',
    onuIndex: plan.selectedOnuIndex,
    title: 'Limpiar ubicacion anterior',
    impact: plan.allowed
      ? `Se conservara ${plan.activeLocation.onuIndex} en linea y se retirara ${locations}.${plan.renameRequired ? ` El nombre ${plan.preservedName} se transferira desde ${plan.identitySource.onuIndex}.` : ''} WispHub, facturas, IP y MikroTik no se modificaran.`
      : 'La OLT no cumple todavía todas las condiciones para una limpieza segura.',
    requiredConfirmation: plan.requiredConfirmation,
    allowed: plan.allowed,
    reason: plan.reasons.join('. ') || null,
    serial: plan.serial,
    activeLocation: plan.activeLocation,
    staleLocations: plan.staleLocations,
    identitySource: plan.identitySource,
    preservedName: plan.preservedName,
    renameRequired: plan.renameRequired,
  };
}

async function retireStaleOnuLocations(req, res, onuIndex) {
  if (oltMutationInProgress) return res.status(409).json({ error: 'Ya existe una operación OLT en curso' });
  if (oltSyncInProgress) await oltSyncInProgress.catch(() => {});
  const client = createOltClient();
  oltMutationInProgress = true;
  const removed = [];
  const backups = [];
  let transferredName = null;
  let relocationPlan = null;
  try {
    const { plan } = await inspectOnuRelocation(onuIndex, client);
    relocationPlan = plan;
    const preview = relocationPreviewDto(plan);
    if (!plan.allowed) return res.status(409).json({ error: plan.reasons.join('. '), preview });
    if (String(req.body?.confirmation || '').trim().toUpperCase() !== plan.requiredConfirmation) {
      return res.status(400).json({ error: `Escriba ${plan.requiredConfirmation} para confirmar`, preview });
    }

    const runningConfig = await client.command('show running-config');
    for (const stale of plan.staleLocations) backups.push(await client.fetchOnuConfigSnapshot(stale.onuIndex, runningConfig));

    if (plan.renameRequired) {
      const activeBeforeRename = await client.fetchOnuLocation(plan.activeLocation.onuIndex);
      if (!activeBeforeRename.online || normalizeSerial(activeBeforeRename.inventory?.serial) !== plan.serial) {
        throw new Error(`La ubicacion activa ${plan.activeLocation.onuIndex} dejo de estar verificada antes de transferir el nombre`);
      }
      const renameResult = await client.renameOnu(plan.activeLocation.onuIndex, plan.preservedName);
      transferredName = {
        from: renameResult.oldName || plan.activeLocation.name || null,
        to: plan.preservedName,
        sourceOnuIndex: plan.identitySource.onuIndex,
        verified: renameResult.verified === true,
      };
      if (!transferredName.verified) throw new Error(`La OLT no confirmo el nombre ${plan.preservedName} en ${plan.activeLocation.onuIndex}`);
    }

    for (const stale of plan.staleLocations) {
      const activeBefore = await client.fetchOnuLocation(plan.activeLocation.onuIndex);
      const staleBefore = await client.fetchOnuLocation(stale.onuIndex);
      if (!activeBefore.online || normalizeSerial(activeBefore.inventory?.serial) !== plan.serial) {
        throw new Error(`La ubicacion activa ${plan.activeLocation.onuIndex} dejo de estar verificada; no se retiro ninguna ubicacion adicional`);
      }
      if (!staleBefore.exists || staleBefore.online || normalizeSerial(staleBefore.inventory?.serial) !== plan.serial) {
        throw new Error(`La ubicacion anterior ${stale.onuIndex} cambio de estado; ejecute nuevamente el analisis`);
      }
      const [ponIndex, onuIdText] = stale.onuIndex.split(':');
      await client.rollbackProvisioning(ponIndex, Number(onuIdText));
      const staleAfter = await client.fetchOnuLocation(stale.onuIndex);
      const activeAfter = await client.fetchOnuLocation(plan.activeLocation.onuIndex);
      if (staleAfter.exists) throw new Error(`La OLT no confirmo el retiro de ${stale.onuIndex}`);
      if (!activeAfter.online || normalizeSerial(activeAfter.inventory?.serial) !== plan.serial) {
        throw new Error(`La ubicacion activa ${plan.activeLocation.onuIndex} no quedo verificada despues del retiro`);
      }
      removed.push(stale.onuIndex);
    }

    const mappedAt = new Date();
    const databaseChanges = [
      prisma.oltOnu.deleteMany({ where: { onuIndex: { in: removed } } }),
      prisma.oltNapPort.updateMany({
        where: { onuIndex: { in: removed } },
        data: { onuIndex: plan.activeLocation.onuIndex, serial: plan.serial, clientIdServicio: plan.clientIdServicio, assignedAt: mappedAt },
      }),
    ];
    const activeData = {};
    if (plan.preservedName) activeData.name = plan.preservedName;
    if (plan.clientIdServicio) {
      Object.assign(activeData, { clientIdServicio: plan.clientIdServicio, mappingSource: 'serial', mappedAt, mappedBy: `relocation:${req.session.username}` });
    }
    if (Object.keys(activeData).length) {
      databaseChanges.unshift(prisma.oltOnu.update({ where: { onuIndex: plan.activeLocation.onuIndex }, data: activeData }));
    }
    await prisma.$transaction(databaseChanges);
    await logActivity(req, {
      action: 'olt_stale_locations_retired', entityType: 'olt', entityId: plan.activeLocation.onuIndex,
      entityName: plan.serial,
      details: {
        serial: plan.serial, activeLocation: plan.activeLocation.onuIndex, removed,
        clientIdServicio: plan.clientIdServicio, verified: true, backups, transferredName,
        identitySource: plan.identitySource?.onuIndex || null,
        preserved: ['nombre OLT', 'WispHub', 'facturas', 'IP', 'MikroTik', 'historial optico'],
      },
    });
    setTimeout(() => runOltSync({ forceInventory: true }).catch((error) => console.warn('[olt] post-relocation sync warning:', error.message)), 500);
    return res.json({ ok: true, message: `${removed.length} ubicacion(es) anterior(es) retirada(s); ${plan.activeLocation.onuIndex} sigue en linea`, removed, activeLocation: { ...plan.activeLocation, name: plan.preservedName || plan.activeLocation.name }, transferredName });
  } catch (error) {
    let renameRollback = null;
    if (transferredName?.verified && removed.length === 0 && transferredName.from && transferredName.from !== transferredName.to) {
      try {
        const rollbackResult = await client.renameOnu(relocationPlan?.activeLocation?.onuIndex || onuIndex, transferredName.from);
        renameRollback = { restored: rollbackResult.verified === true, name: transferredName.from };
      } catch (rollbackError) {
        renameRollback = { restored: false, name: transferredName.from, error: rollbackError.message };
      }
    }
    await logActivity(req, {
      action: 'olt_stale_location_cleanup_failed', entityType: 'olt', entityId: onuIndex,
      entityName: onuIndex, details: { removed, error: error.message, transferredName, renameRollback },
    }).catch(() => {});
    return res.status(error.statusCode || 502).json({ error: error.message, removed, renameRollback });
  } finally {
    client.close();
    oltMutationInProgress = false;
  }
}

async function retireOnuCompletely(req, res, onuIndex) {
  const onu = await prisma.oltOnu.findUnique({ where: { onuIndex } });
  if (!onu) return res.status(404).json({ error: 'ONU no encontrada' });
  const expectedSerial = normalizeSerial(onu.serial);
  if (!expectedSerial) return res.status(409).json({ error: 'La ONU no tiene un serial válido para verificar la baja' });
  if (oltMutationInProgress) return res.status(409).json({ error: 'Ya existe una operación OLT en curso' });
  if (oltSyncInProgress) await oltSyncInProgress.catch(() => {});
  oltMutationInProgress = true;
  const client = createOltClient();
  try {
    const before = await client.fetchOnuLocation(onuIndex);
    if (!before.exists) return res.status(409).json({ error: 'La ONU ya no existe en ese puerto; sincronice antes de continuar' });
    if (normalizeSerial(before.inventory?.serial) !== expectedSerial) {
      return res.status(409).json({ error: `El serial actual de ${onuIndex} no coincide con el inventario. Baja detenida.` });
    }
    const [ponIndex, onuIdText] = onuIndex.split(':');
    const backup = await client.fetchOnuConfigSnapshot(onuIndex);
    let access = null;
    try { access = await client.fetchOnuAccessTopology(onuIndex, onu.model); } catch {}
    await client.rollbackProvisioning(ponIndex, Number(onuIdText));
    const after = await client.fetchOnuLocation(onuIndex);
    if (after.exists) throw new Error(`La OLT no confirmo la eliminacion de ${onuIndex}`);

    const preserved = ['WispHub', 'facturas', 'cliente', 'IP', 'cola MikroTik', 'historial optico'];
    const macAddresses = (access?.macTable || []).map((item) => item.macAddress);
    const now = new Date();
    await prisma.$transaction([
      prisma.oltNapPort.updateMany({
        where: { OR: [{ onuIndex }, { serial: expectedSerial }] },
        data: { status: 'available', onuIndex: null, serial: null, clientIdServicio: null, assignedAt: null },
      }),
      prisma.tr069Device.updateMany({
        where: { OR: [{ onuIndex }, { serial: expectedSerial }] },
        data: { onuIndex: null, status: 'pending' },
      }),
      prisma.oltOnu.delete({ where: { onuIndex } }),
      prisma.activity.create({ data: {
        action: 'olt_onu_retired_for_reassociation', entityType: 'olt', entityId: onuIndex,
        entityName: onu.name || expectedSerial,
        details: JSON.stringify({
          actor: req.session.username, role: req.session.role, serial: expectedSerial,
          wasOnline: before.online, serviceMode: access?.mode || 'unknown', macAddresses,
          backup, verifiedRemoved: true, preserved, retiredAt: now.toISOString(),
        }),
      } }),
    ]);
    setTimeout(() => runOltSync({ forceInventory: true }).catch((error) => console.warn('[olt] post-retirement sync warning:', error.message)), 500);
    return res.json({
      ok: true, removed: [onuIndex], serial: expectedSerial, verified: true, preserved,
      serviceMode: access?.mode || 'unknown', macCount: macAddresses.length,
      message: `ONU ${onuIndex} eliminada y verificada. Podra asociarse nuevamente cuando aparezca en descubrimiento.`,
    });
  } catch (error) {
    await logActivity(req, {
      action: 'olt_onu_full_retirement_failed', entityType: 'olt', entityId: onuIndex,
      entityName: onu.name || expectedSerial, details: { serial: expectedSerial, error: error.message },
    }).catch(() => {});
    return res.status(error.statusCode || 502).json({ error: error.message });
  } finally {
    client.close();
    oltMutationInProgress = false;
  }
}

oltRouter.get('/onus/:rack/:shelf/:pon/:onu/operations/preview', requireRole(['admin']), asyncHandler(async (req, res) => {
  const onuIndex = `${Number(req.params.rack)}/${Number(req.params.shelf)}/${Number(req.params.pon)}:${Number(req.params.onu)}`;
  try { assertOnuIndex(onuIndex); } catch { return res.status(400).json({ error: 'ONU inválida' }); }
  const action = String(req.query.action || 'reboot');
  if (!['reboot', 'rename', 'retire-stale', 'retire-full'].includes(action)) return res.status(400).json({ error: 'Operación no soportada por el conector validado' });
  const onu = await prisma.oltOnu.findUnique({ where: { onuIndex } });
  if (!onu) return res.status(404).json({ error: 'ONU no encontrada' });
  if (action === 'retire-stale') {
    if (oltSyncInProgress) await oltSyncInProgress.catch(() => {});
    const client = createOltClient();
    try {
      const { plan } = await inspectOnuRelocation(onuIndex, client);
      return res.json(relocationPreviewDto(plan));
    } finally {
      client.close();
    }
  }
  if (action === 'retire-full') {
    let access = null;
    const client = createOltClient();
    try { access = await client.fetchOnuAccessTopology(onuIndex, onu.model); } catch {}
    finally { client.close(); }
    const macCount = access?.macTable?.length || 0;
    const mode = access?.mode || 'unknown';
    return res.json({
      action, onuIndex, title: 'Eliminar ONU de la OLT', serial: onu.serial,
      serviceMode: mode, macCount,
      impact: `${onu.online ? 'La conexion se interrumpira inmediatamente. ' : ''}Se retirara ${onu.name || onu.serial || onuIndex} de la OLT (${mode}, ${macCount} MAC aprendidas). WispHub, facturas, cliente, IP y MikroTik se conservaran para volver a asociarla.`,
      requiredConfirmation: `RETIRAR ${onuIndex}`,
      allowed: Boolean(normalizeSerial(onu.serial)),
      reason: normalizeSerial(onu.serial) ? null : 'La ONU no tiene serial verificable',
    });
  }
  if (action === 'rename') {
    let newName;
    try { newName = assertOnuName(req.query.name); } catch { return res.status(400).json({ error: 'Use hasta 32 letras, números, punto, guion o guion bajo' }); }
    return res.json({
      action, onuIndex, title: 'Cambiar nombre ONU', oldName: onu.name, newName,
      impact: `Se cambiara el nombre en la OLT de ${onu.name || 'sin_nombre'} a ${newName}. El servicio no se interrumpira.`,
      requiredConfirmation: `RENOMBRAR ${onuIndex}`, allowed: onu.name !== newName,
      reason: onu.name === newName ? 'La ONU ya tiene ese nombre' : null,
    });
  }
  res.json({ action, onuIndex, title: 'Reiniciar ONU', impact: 'La conexion del cliente se interrumpira temporalmente mientras la ONU reinicia.', requiredConfirmation: `REINICIAR ${onuIndex}`, allowed: onu.online, reason: onu.online ? null : 'La ONU no esta en linea' });
}));

oltRouter.post('/onus/:rack/:shelf/:pon/:onu/operations', requireRole(['admin']), asyncHandler(async (req, res) => {
  const onuIndex = `${Number(req.params.rack)}/${Number(req.params.shelf)}/${Number(req.params.pon)}:${Number(req.params.onu)}`;
  try { assertOnuIndex(onuIndex); } catch { return res.status(400).json({ error: 'ONU inválida' }); }
  const action = String(req.body?.action || '');
  if (!['reboot', 'rename', 'retire-stale', 'retire-full'].includes(action)) return res.status(400).json({ error: 'Operación no soportada por el conector validado' });
  if (action === 'retire-stale') return retireStaleOnuLocations(req, res, onuIndex);
  if (action === 'retire-full') {
    const requiredConfirmation = `RETIRAR ${onuIndex}`;
    if (String(req.body?.confirmation || '').trim().toUpperCase() !== requiredConfirmation) return res.status(400).json({ error: 'La confirmación de baja no coincide' });
    return retireOnuCompletely(req, res, onuIndex);
  }
  const requiredConfirmation = `${action === 'rename' ? 'RENOMBRAR' : 'REINICIAR'} ${onuIndex}`;
  if (String(req.body?.confirmation || '').trim().toUpperCase() !== requiredConfirmation) return res.status(400).json({ error: `Escriba ${requiredConfirmation} para confirmar` });
  const onu = await prisma.oltOnu.findUnique({ where: { onuIndex } });
  if (!onu) return res.status(404).json({ error: 'ONU no encontrada' });
  if (action === 'reboot' && !onu.online) return res.status(409).json({ error: 'La ONU no esta en línea' });
  let newName = null;
  if (action === 'rename') {
    try { newName = assertOnuName(req.body?.name); } catch { return res.status(400).json({ error: 'Use hasta 32 letras, números, punto, guion o guion bajo' }); }
    if (newName === onu.name) return res.status(409).json({ error: 'La ONU ya tiene ese nombre' });
  }
  if (action === 'reboot') {
    const cooldownSince = new Date(Date.now() - 5 * 60_000);
    const recent = await prisma.activity.findFirst({ where: { action: 'olt_onu_rebooted', entityType: 'olt', entityId: onuIndex, createdAt: { gte: cooldownSince } } });
    if (recent) return res.status(429).json({ error: 'Espere 5 minutos antes de reiniciar esta ONU nuevamente' });
  }
  if (oltMutationInProgress) return res.status(409).json({ error: 'Ya existe una operación OLT en curso' });
  if (oltSyncInProgress) await oltSyncInProgress.catch(() => {});
  oltMutationInProgress = true;
  const client = createOltClient();
  try {
    if (action === 'rename') {
      try {
        const result = await client.renameOnu(onuIndex, newName);
        await prisma.oltOnu.update({ where: { onuIndex }, data: { name: newName } });
        await logActivity(req, {
          action: 'olt_onu_renamed', entityType: 'olt', entityId: onuIndex, entityName: newName,
          details: { action, serial: onu.serial, clientIdServicio: onu.clientIdServicio, oldName: result.oldName || onu.name, newName, verified: result.verified },
        });
        return res.json({ ok: true, ...result, message: `ONU renombrada a ${newName} y verificada en la OLT` });
      } catch (error) {
        return res.status(502).json({ error: error.message, rollback: error.rollback || null });
      }
    }
    const result = await client.executeOnuOperation(onuIndex, action);
    await logActivity(req, { action: 'olt_onu_rebooted', entityType: 'olt', entityId: onuIndex, entityName: onu.name || onu.serial, details: { action, serial: onu.serial, clientIdServicio: onu.clientIdServicio } });
    res.json({ ok: true, ...result, message: 'Orden de reinicio enviada a la ONU' });
  } finally {
    client.close();
    oltMutationInProgress = false;
    if (action === 'rename') setTimeout(() => runOltSync({ forceInventory: true }).catch((error) => console.warn('[olt] post-rename sync warning:', error.message)), 500);
  }
}));

oltRouter.post('/onus/by-serial/:serial/retire-unlinked', requireRole(['admin']), asyncHandler(async (req, res) => {
  const serial = normalizeSerial(req.params.serial);
  if (!serial) return res.status(400).json({ error: 'Serial ONU inválido' });
  const requiredConfirmation = `RETIRAR ${serial}`;
  if (String(req.body?.confirmation || '').trim().toUpperCase() !== requiredConfirmation) {
    return res.status(400).json({ error: `Escriba ${requiredConfirmation} para confirmar` });
  }
  const onus = await prisma.oltOnu.findMany({
    where: { serial }, orderBy: [{ rack: 'asc' }, { shelf: 'asc' }, { pon: 'asc' }, { onuId: 'asc' }],
  });
  if (!onus.length) return res.status(404).json({ error: 'El serial no esta autorizado en la OLT' });
  const unsafe = onus.filter((onu) => onu.online || onu.clientIdServicio != null);
  if (unsafe.length) {
    return res.status(409).json({
      error: 'Solo se pueden retirar registros offline y sin cliente asociado',
      blocked: unsafe.map((onu) => ({ onuIndex: onu.onuIndex, online: onu.online, clientIdServicio: onu.clientIdServicio })),
    });
  }
  if (oltMutationInProgress) return res.status(409).json({ error: 'Ya existe una operación OLT en curso' });
  if (oltSyncInProgress) await oltSyncInProgress.catch(() => {});
  oltMutationInProgress = true;
  const client = createOltClient();
  const removed = [];
  try {
    for (const onu of onus) {
      const [ponIndex, onuIdText] = onu.onuIndex.split(':');
      await client.rollbackProvisioning(ponIndex, Number(onuIdText));
      removed.push(onu.onuIndex);
    }
    await prisma.oltOnu.deleteMany({ where: { serial, onuIndex: { in: removed } } });
    await logActivity(req, {
      action: 'olt_unlinked_serial_retired', entityType: 'olt', entityId: serial, entityName: serial,
      details: { removed, reason: String(req.body?.reason || 'Limpieza de alta fallida').slice(0, 240) },
    });
    res.json({ ok: true, serial, removed, message: `${removed.length} registro(s) ONU retirado(s) de la OLT` });
  } finally {
    client.close();
    oltMutationInProgress = false;
    setTimeout(() => runOltSync({ forceInventory: true }).catch((error) => console.warn('[olt] post-retirement sync warning:', error.message)), 500);
  }
}));

oltRouter.get('/activity', asyncHandler(async (req, res) => {
  const rows = await prisma.activity.findMany({ where: { entityType: 'olt' }, orderBy: { createdAt: 'desc' }, take: Math.min(200, Math.max(10, Number(req.query.limit) || 50)) });
  res.json(rows.map((row) => {
    let details = {};
    try { details = JSON.parse(row.details || '{}'); } catch {}
    return { ...row, details };
  }));
}));

oltRouter.get('/alarms', asyncHandler(async (req, res) => {
  const activeOnly = req.query.active !== 'false';
  const items = await prisma.oltAlarm.findMany({
    where: activeOnly ? { active: true } : {},
    orderBy: [{ active: 'desc' }, { lastSeenAt: 'desc' }],
    take: Math.min(500, Math.max(10, Number(req.query.limit) || 100)),
  });
  res.json(items);
}));

oltRouter.get('/history', asyncHandler(async (req, res) => {
  const items = await prisma.oltSnapshot.findMany({
    orderBy: { capturedAt: 'desc' },
    take: Math.min(500, Math.max(10, Number(req.query.limit) || 120)),
  });
  res.json(items.reverse());
}));

oltRouter.post('/sync', requireRole(['admin']), asyncHandler(async (req, res) => {
  const result = await runOltSync({ forceInventory: req.body?.full === true });
  await logActivity(req, {
    action: 'olt_sync', entityType: 'olt', entityName: result.snapshot.systemName,
    details: { full: result.includeInventory, totalOnus: result.snapshot.totalOnus },
  });
  res.json(result);
}));

app.use('/olt-api', oltRouter);

// AGENTES ONU: Railway coordina trabajos, pero cada agente ejecuta solamente
// operaciones asignadas a su propia PC y LAN local.
const agentRouter = express.Router();
const ONU_AGENT_TASK_LEASE_MS = Math.max(60_000, Number(process.env.ONU_AGENT_TASK_LEASE_MS) || 180_000);
const ONU_AGENT_ONLINE_MS = Math.max(15_000, Number(process.env.ONU_AGENT_ONLINE_MS) || 30_000);
const ONU_AGENT_ACTIONS = new Set(['discover', 'check', 'provision']);

async function onuAgentAccessMiddleware(req, res, next) {
  if (!req.path.startsWith('/agent/')) {
    return authMiddleware(req, res, () => requireRole(['tecnico'])(req, res, next));
  }
  const token = String(req.headers['x-agent-token'] || '');
  if (token.length < 32) return res.status(401).json({ error: 'Agente ONU no autorizado' });
  const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const agent = await prisma.tr069Agent.findUnique({ where: { tokenHash } }).catch(() => null);
  if (!agent) return res.status(401).json({ error: 'Credencial del agente inválida', code: 'AGENT_TOKEN_INVALID' });
  if (!agent.active) return res.status(401).json({ error: 'Credencial del agente revocada', code: 'AGENT_REVOKED' });
  req.onuAgent = agent;
  req.session = { userId: null, username: `agent:${agent.name}`, role: 'admin' };
  next();
}

agentRouter.use((req, res, next) => {
  onuAgentAccessMiddleware(req, res, next).catch(next);
});

function safeAgentJson(value, fallback = {}) {
  if (value == null) return fallback;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function boundedAgentJson(value, maxLength = 60_000) {
  const text = JSON.stringify(value && typeof value === 'object' ? value : {});
  return text.length <= maxLength ? text : JSON.stringify({ truncated: true });
}

function sanitizeAgentObject(value, depth = 0) {
  if (depth > 8 || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 1000).map((item) => sanitizeAgentObject(item, depth + 1));
  if (typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 2000) : value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|passwd|secret|credential|token/i.test(key)) {
      output[key] = item == null ? null : '***';
      continue;
    }
    output[key] = sanitizeAgentObject(item, depth + 1);
  }
  return output;
}

function takeAgentTaskSecrets(payload) {
  const safePayload = JSON.parse(JSON.stringify(payload && typeof payload === 'object' ? payload : {}));
  const secrets = {};
  const paths = [
    ['device', 'password'], ['wifi', 'password'], ['tr069', 'password'],
    ['tr069', 'connection_request_password'],
  ];
  for (const [section, field] of paths) {
    const value = safePayload?.[section]?.[field];
    if (typeof value === 'string' && value.length) {
      secrets[`${section}.${field}`] = value;
      delete safePayload[section][field];
    }
  }
  return { safePayload, secrets };
}

function restoreAgentTaskSecrets(payload, secrets) {
  const restored = JSON.parse(JSON.stringify(payload && typeof payload === 'object' ? payload : {}));
  for (const [pathKey, value] of Object.entries(secrets || {})) {
    const [section, field] = pathKey.split('.');
    if (!section || !field) continue;
    restored[section] ||= {};
    restored[section][field] = value;
  }
  return restored;
}

function onuAgentTaskDto(task) {
  return {
    id: task.id,
    idempotencyKey: task.idempotencyKey,
    agentId: task.agentId,
    agentName: task.agent?.displayName || task.agent?.hostname || task.agent?.name || null,
    action: task.action,
    status: task.status,
    payload: sanitizeAgentObject(safeAgentJson(task.payloadJson, {})),
    hasProtectedData: Boolean(task.secretCiphertext),
    result: sanitizeAgentObject(safeAgentJson(task.resultJson, null)),
    errorMessage: task.errorMessage,
    errorCode: task.errorCode,
    stage: task.stage,
    stageLabel: task.stageLabel,
    progress: task.progress,
    localJobId: task.localJobId,
    cloudJobId: task.cloudJobId,
    attempts: task.attempts,
    createdBy: task.createdBy,
    claimedAt: task.claimedAt,
    heartbeatAt: task.heartbeatAt,
    cancelledAt: task.cancelledAt,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function onuAgentDto(agent) {
  const lastSeenMs = agent.lastSeenAt ? Date.now() - agent.lastSeenAt.getTime() : Infinity;
  const activeTask = Array.isArray(agent.onuTasks) ? agent.onuTasks[0] : null;
  return {
    id: agent.id,
    agentId: agent.name,
    displayName: agent.displayName || agent.hostname || agent.name,
    active: agent.active,
    online: agent.active && lastSeenMs <= ONU_AGENT_ONLINE_MS,
    version: agent.version,
    hostname: agent.hostname,
    windowsUser: agent.windowsUser,
    osName: agent.osName,
    architecture: agent.architecture,
    isAdmin: agent.isAdmin,
    lastIp: agent.lastIp,
    lastSeenAt: agent.lastSeenAt,
    createdBy: agent.createdBy,
    tokenFingerprint: agent.tokenFingerprint,
    pairedAt: agent.pairedAt,
    revokedAt: agent.revokedAt,
    revokedBy: agent.revokedBy,
    capabilities: safeAgentJson(agent.capabilitiesJson, {}),
    discovery: safeAgentJson(agent.discoveryJson, null),
    currentTask: activeTask ? onuAgentTaskDto(activeTask) : null,
  };
}

agentRouter.post('/agents/pair', requireRole(['admin']), asyncHandler(async (req, res) => {
  const name = String(req.body?.agentId || '').trim();
  if (!/^[A-Za-z0-9_.:-]{4,100}$/.test(name)) return res.status(400).json({ error: 'Identificador de agente inválido' });
  const token = crypto.randomBytes(48).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const tokenFingerprint = tokenHash.slice(0, 12).toUpperCase();
  const version = String(req.body?.agentVersion || '').trim().slice(0, 40) || null;
  const displayName = String(req.body?.displayName || '').trim().slice(0, 120) || null;
  const agent = await prisma.tr069Agent.upsert({
    where: { name },
    update: {
      tokenHash, tokenFingerprint, active: true, version, displayName,
      createdBy: req.session.username, pairedAt: new Date(), revokedAt: null, revokedBy: null,
      lastSeenAt: new Date(),
    },
    create: {
      name, tokenHash, tokenFingerprint, active: true, version, displayName,
      createdBy: req.session.username, pairedAt: new Date(), lastSeenAt: new Date(),
    },
  });
  await logActivity(req, {
    action: 'onu_agent_paired', entityType: 'onu_agent', entityId: agent.id,
    entityName: agent.displayName || agent.name, details: { version, tokenFingerprint },
  });
  res.status(201).json({ agentId: agent.name, token, tokenFingerprint, pairedAt: agent.pairedAt });
}));

agentRouter.get('/agents', asyncHandler(async (_req, res) => {
  const rows = await prisma.tr069Agent.findMany({
    orderBy: [{ active: 'desc' }, { lastSeenAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      onuTasks: {
        where: { status: 'processing' }, orderBy: { updatedAt: 'desc' }, take: 1,
      },
    },
  });
  res.json(rows.map(onuAgentDto));
}));

agentRouter.patch('/agents/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const displayName = String(req.body?.displayName || '').trim().slice(0, 120);
  if (!displayName) return res.status(400).json({ error: 'El nombre del agente es obligatorio' });
  const updated = await prisma.tr069Agent.update({ where: { id: String(req.params.id) }, data: { displayName } }).catch(() => null);
  if (!updated) return res.status(404).json({ error: 'Agente no encontrado' });
  res.json(onuAgentDto(updated));
}));

agentRouter.post('/agents/:id/revoke', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const agent = await prisma.tr069Agent.findUnique({ where: { id } });
  if (!agent) return res.status(404).json({ error: 'Agente no encontrado' });
  const revokedAt = new Date();
  await prisma.$transaction([
    prisma.onuAgentTask.updateMany({
      where: { agentId: id, status: { in: ['pending', 'processing'] } },
      data: { status: 'cancelled', stage: 'cancelled', stageLabel: 'Agente revocado', completedAt: new Date(), leaseExpiresAt: null },
    }),
    prisma.tr069Agent.update({
      where: { id },
      data: { active: false, currentTaskId: null, revokedAt, revokedBy: req.session.username },
    }),
    prisma.trustedDeviceSession.updateMany({
      where: { deviceId: agent.name, revokedAt: null }, data: { revokedAt },
    }),
  ]);
  await logActivity(req, {
    action: 'onu_agent_revoked', entityType: 'onu_agent', entityId: agent.id,
    entityName: agent.displayName || agent.name,
    details: { deviceId: agent.name, cancelledRemoteTasks: true, trustedSessionRevoked: true },
  });
  res.json({ ok: true, revokedAt, agentId: agent.name });
}));

agentRouter.get('/tasks', asyncHandler(async (req, res) => {
  const take = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
  const where = {};
  if (req.query.agentId) where.agentId = String(req.query.agentId);
  if (req.query.status) where.status = String(req.query.status);
  const rows = await prisma.onuAgentTask.findMany({
    where, orderBy: { createdAt: 'desc' }, take, include: { agent: true },
  });
  res.json(rows.map(onuAgentTaskDto));
}));

agentRouter.get('/tasks/:id', asyncHandler(async (req, res) => {
  const task = await prisma.onuAgentTask.findUnique({ where: { id: String(req.params.id) }, include: { agent: true } });
  if (!task) return res.status(404).json({ error: 'Trabajo no encontrado' });
  res.json(onuAgentTaskDto(task));
}));

agentRouter.post('/tasks', asyncHandler(async (req, res) => {
  const action = String(req.body?.action || '').trim().toLowerCase();
  if (!ONU_AGENT_ACTIONS.has(action)) return res.status(400).json({ error: 'Acción de agente no válida' });
  const agent = await prisma.tr069Agent.findUnique({ where: { id: String(req.body?.agentId || '') } });
  if (!agent?.active) return res.status(404).json({ error: 'El agente seleccionado no existe o fue revocado' });
  const rawPayload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
  const { safePayload, secrets } = takeAgentTaskSecrets(rawPayload);
  const payloadText = JSON.stringify(safePayload);
  if (payloadText.length > 80_000) return res.status(413).json({ error: 'El trabajo excede el tamano permitido' });
  if (action === 'provision' && (!safePayload.device || !safePayload.local_network || !safePayload.wan || !safePayload.wifi)) {
    return res.status(400).json({ error: 'El aprovisionamiento requiere dispositivo, red local, WAN y WiFi' });
  }
  let secretCiphertext = null;
  try { secretCiphertext = Object.keys(secrets).length ? encryptSecret(secrets, TR069_TASK_ENCRYPTION_KEY) : null; }
  catch (error) { return res.status(503).json({ error: error.message }); }
  const idempotencyKey = String(req.body?.idempotencyKey || `onu-agent:${agent.name}:${action}:${crypto.randomUUID()}`).slice(0, 180);
  const existing = await prisma.onuAgentTask.findUnique({ where: { idempotencyKey }, include: { agent: true } }).catch(() => null);
  if (existing) return res.json(onuAgentTaskDto(existing));
  const cloudJobId = String(safePayload.cloud_job_id || '').trim() || null;
  const task = await prisma.onuAgentTask.create({
    data: {
      idempotencyKey, agentId: agent.id, action, payloadJson: payloadText, secretCiphertext,
      cloudJobId, createdById: req.session.userId, createdBy: req.session.username,
      stageLabel: action === 'discover' ? 'Esperando deteccion' : 'Esperando al agente',
    },
    include: { agent: true },
  });
  await logActivity(req, {
    action: 'onu_agent_task_created', entityType: 'onu_agent_task', entityId: task.id,
    entityName: agent.displayName || agent.name, details: { action, cloudJobId },
  });
  res.status(201).json(onuAgentTaskDto(task));
}));

agentRouter.post('/tasks/:id/cancel', asyncHandler(async (req, res) => {
  const task = await prisma.onuAgentTask.findUnique({ where: { id: String(req.params.id) }, include: { agent: true } });
  if (!task) return res.status(404).json({ error: 'Trabajo no encontrado' });
  if (task.status !== 'pending') return res.status(409).json({ error: 'Solo se puede cancelar un trabajo pendiente' });
  const updated = await prisma.onuAgentTask.update({
    where: { id: task.id },
    data: { status: 'cancelled', stage: 'cancelled', stageLabel: 'Cancelado', progress: 100, cancelledAt: new Date(), completedAt: new Date() },
    include: { agent: true },
  });
  res.json(onuAgentTaskDto(updated));
}));

agentRouter.post('/tasks/:id/retry', asyncHandler(async (req, res) => {
  const source = await prisma.onuAgentTask.findUnique({ where: { id: String(req.params.id) } });
  if (!source) return res.status(404).json({ error: 'Trabajo no encontrado' });
  if (!['failed', 'cancelled'].includes(source.status)) return res.status(409).json({ error: 'Este trabajo no requiere reintento' });
  const task = await prisma.onuAgentTask.create({
    data: {
      idempotencyKey: `retry:${source.id}:${crypto.randomUUID()}`, agentId: source.agentId,
      action: source.action, payloadJson: source.payloadJson, secretCiphertext: source.secretCiphertext,
      cloudJobId: source.cloudJobId, createdById: req.session.userId, createdBy: req.session.username,
      stageLabel: 'Reintento en cola',
    },
    include: { agent: true },
  });
  res.status(201).json(onuAgentTaskDto(task));
}));

agentRouter.post('/agent/poll', asyncHandler(async (req, res) => {
  const agent = req.onuAgent;
  const now = new Date();
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
  const capabilities = req.body?.capabilities && typeof req.body.capabilities === 'object' ? sanitizeAgentObject(req.body.capabilities) : {};
  const discovery = req.body?.discovery && typeof req.body.discovery === 'object' ? sanitizeAgentObject(req.body.discovery) : null;
  await prisma.tr069Agent.update({
    where: { id: agent.id },
    data: {
      version: String(req.body?.agentVersion || agent.version || '').slice(0, 40) || null,
      displayName: String(metadata.displayName || agent.displayName || '').slice(0, 120) || null,
      hostname: String(metadata.hostname || '').slice(0, 120) || null,
      windowsUser: String(metadata.windowsUser || '').slice(0, 120) || null,
      osName: String(metadata.osName || '').slice(0, 160) || null,
      architecture: String(metadata.architecture || '').slice(0, 40) || null,
      isAdmin: metadata.isAdmin === true,
      capabilitiesJson: boundedAgentJson(capabilities),
      ...(discovery ? { discoveryJson: boundedAgentJson(discovery, 30_000) } : {}),
      lastIp: String(req.ip || '').replace(/^::ffff:/, '').slice(0, 80) || null,
      lastSeenAt: now,
    },
  });
  let claimed = null;
  for (let attempt = 0; attempt < 3 && !claimed; attempt += 1) {
    const candidate = await prisma.onuAgentTask.findFirst({
      where: {
        agentId: agent.id,
        OR: [{ status: 'pending' }, { status: 'processing', leaseExpiresAt: { lt: now } }],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) break;
    const updated = await prisma.onuAgentTask.updateMany({
      where: { id: candidate.id, updatedAt: candidate.updatedAt },
      data: {
        status: 'processing', stage: 'preflight', stageLabel: 'Agente preparando trabajo', progress: 3,
        claimedAt: now, heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + ONU_AGENT_TASK_LEASE_MS),
        attempts: { increment: 1 },
      },
    });
    if (updated.count) claimed = await prisma.onuAgentTask.findUnique({ where: { id: candidate.id } });
  }
  if (!claimed) {
    await prisma.tr069Agent.update({ where: { id: agent.id }, data: { currentTaskId: null } });
    return res.json({ task: null, pollAfterSeconds: 3 });
  }
  await prisma.tr069Agent.update({ where: { id: agent.id }, data: { currentTaskId: claimed.id } });
  let secrets = null;
  try { secrets = decryptSecret(claimed.secretCiphertext, TR069_TASK_ENCRYPTION_KEY); }
  catch (error) {
    await prisma.onuAgentTask.update({
      where: { id: claimed.id },
      data: { status: 'failed', stage: 'failed', stageLabel: 'No se pudieron abrir los datos protegidos', errorMessage: error.message, errorCode: 'AGENT_SECRET_DECRYPT_FAILED', progress: 100, completedAt: new Date(), leaseExpiresAt: null },
    });
    return res.json({ task: null, pollAfterSeconds: 1 });
  }
  res.json({
    task: {
      id: claimed.id, action: claimed.action,
      payload: restoreAgentTaskSecrets(safeAgentJson(claimed.payloadJson, {}), secrets),
      attempts: claimed.attempts,
    },
    pollAfterSeconds: 1,
  });
}));

agentRouter.post('/agent/tasks/:id/progress', asyncHandler(async (req, res) => {
  const task = await prisma.onuAgentTask.findUnique({ where: { id: String(req.params.id) } });
  if (!task) return res.status(404).json({ error: 'Trabajo no encontrado' });
  if (task.agentId !== req.onuAgent.id || task.status !== 'processing') return res.status(409).json({ error: 'Lease de trabajo inválido' });
  const progress = Math.max(task.progress, Math.min(98, Math.max(1, Number(req.body?.progress) || task.progress)));
  const stage = String(req.body?.stage || task.stage).replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || task.stage;
  const stageLabel = String(req.body?.stageLabel || task.stageLabel).replace(/\s+/g, ' ').trim().slice(0, 240) || task.stageLabel;
  const localJobId = String(req.body?.localJobId || task.localJobId || '').slice(0, 80) || null;
  const updated = await prisma.onuAgentTask.update({
    where: { id: task.id },
    data: { progress, stage, stageLabel, localJobId, heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + ONU_AGENT_TASK_LEASE_MS) },
  });
  res.json(onuAgentTaskDto(updated));
}));

agentRouter.post('/agent/tasks/:id/report', asyncHandler(async (req, res) => {
  const task = await prisma.onuAgentTask.findUnique({ where: { id: String(req.params.id) } });
  if (!task) return res.status(404).json({ error: 'Trabajo no encontrado' });
  if (task.agentId !== req.onuAgent.id) return res.status(409).json({ error: 'El trabajo pertenece a otro agente' });
  const success = req.body?.status === 'success';
  const result = sanitizeAgentObject(req.body?.result && typeof req.body.result === 'object' ? req.body.result : {});
  const successLabel = task.action === 'discover'
    ? (result.detected ? 'ONU detectada' : 'Escaneo completo: sin ONU')
    : task.action === 'check'
      ? 'Acceso e inventario verificados'
      : 'ONU configurada y verificada';
  const errorMessage = success ? null : String(req.body?.errorMessage || 'El agente no completo el trabajo').replace(/\s+/g, ' ').slice(0, 1000);
  const errorCode = success ? null : String(req.body?.errorCode || 'ONU_AGENT_ERROR').replace(/[^A-Z0-9_-]/gi, '').slice(0, 80);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.onuAgentTask.update({
      where: { id: task.id },
      data: {
        status: success ? 'success' : 'failed', stage: success ? 'verified' : 'failed',
        stageLabel: success ? successLabel : 'Trabajo con error', progress: 100,
        resultJson: boundedAgentJson(result, 100_000), errorMessage, errorCode,
        localJobId: String(req.body?.localJobId || task.localJobId || '').slice(0, 80) || null,
        heartbeatAt: new Date(), leaseExpiresAt: null, completedAt: new Date(),
      },
    });
    await tx.tr069Agent.update({
      where: { id: task.agentId },
      data: {
        currentTaskId: null, lastSeenAt: new Date(),
        ...(success && task.action === 'discover' ? { discoveryJson: boundedAgentJson(result, 30_000) } : {}),
      },
    });
    return row;
  });
  res.json(onuAgentTaskDto(updated));
}));

async function readOnuAgentDownloadManifest() {
  const manifestPath = path.join(__dirname, 'agent-downloads', 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const source = (await fs.promises.readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, '');
  const manifest = JSON.parse(source);
  const fileName = String(manifest?.fileName || '');
  if (!fileName.endsWith('.exe') || path.basename(fileName) !== fileName) {
    throw new Error('El manifiesto del agente contiene un nombre de archivo invalido');
  }
  return { ...manifest, fileName };
}

agentRouter.get('/downloads/windows/manifest', asyncHandler(async (_req, res) => {
  const manifest = await readOnuAgentDownloadManifest();
  if (!manifest) return res.status(404).json({ error: 'El instalador aun no esta publicado' });
  const executablePath = path.join(__dirname, 'agent-downloads', manifest.fileName);
  if (!fs.existsSync(executablePath)) return res.status(404).json({ error: 'El instalador publicado no esta disponible' });
  const stat = await fs.promises.stat(executablePath);
  res.json({ ...manifest, sizeBytes: stat.size, downloadUrl: '/agent-api/downloads/windows' });
}));

agentRouter.get('/downloads/windows', asyncHandler(async (_req, res) => {
  const manifest = await readOnuAgentDownloadManifest();
  if (!manifest) return res.status(404).json({ error: 'El instalador aun no esta publicado' });
  const executablePath = path.join(__dirname, 'agent-downloads', manifest.fileName);
  if (!fs.existsSync(executablePath)) return res.status(404).json({ error: 'El instalador publicado no esta disponible' });
  res.setHeader('Cache-Control', 'private, no-cache');
  res.download(executablePath, `ONU-Studio-ISP-Max-v${manifest.version}.exe`);
}));

app.use('/agent-api', agentRouter);

app.get('/android-api/download', authMiddleware, asyncHandler(async (_req, res) => {
  const manifestPath = path.join(__dirname, 'agent-downloads', 'android-manifest.json');
  if (!fs.existsSync(manifestPath)) return res.status(404).json({ error: 'La APK aun no esta publicada' });
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
  const fileName = String(manifest.fileName || '');
  if (!/^ISP-Max-Android-[a-zA-Z0-9.-]+\.apk$/.test(fileName) || path.basename(fileName) !== fileName) return res.status(500).json({ error: 'Manifiesto Android inválido' });
  const apkPath = path.join(__dirname, 'agent-downloads', fileName);
  if (!fs.existsSync(apkPath)) return res.status(404).json({ error: 'La APK publicada no esta disponible' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-APK-SHA256', String(manifest.sha256 || ''));
  res.download(apkPath, fileName);
}));

// TR-069: Railway stores state and work; the local agent is the only GenieACS caller.
const tr069Router = express.Router();

async function tr069AccessMiddleware(req, res, next) {
  if (!req.path.startsWith('/agent/')) {
    return authMiddleware(req, res, () => requireRole(['admin'])(req, res, next));
  }
  const token = String(req.headers['x-agent-token'] || '');
  if (token.length < 32) return res.status(401).json({ error: 'Agente TR-069 no autorizado' });
  const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const agent = await prisma.tr069Agent.findUnique({ where: { tokenHash } }).catch(() => null);
  if (!agent?.active) return res.status(401).json({ error: 'Agente TR-069 no autorizado' });
  req.tr069Agent = agent;
  req.session = { userId: null, username: `agent:${agent.name}`, role: 'admin' };
  next();
}

tr069Router.use((req, res, next) => {
  tr069AccessMiddleware(req, res, next).catch(next);
});

const TR069_TASK_LEASE_MS = Math.max(30_000, Number(process.env.TR069_TASK_LEASE_MS) || 120_000);
const TR069_TASK_ENCRYPTION_KEY = process.env.TR069_TASK_ENCRYPTION_KEY || '';

function tr069DeviceDto(device, tasks = [], onuOverride = null) {
  const snapshot = sanitizeTr069Snapshot(safeTr069Json(device?.snapshotJson, {}));
  const onu = onuOverride || device?.onu || null;
  if (onu) {
    snapshot.fiber = {
      ...snapshot.fiber,
      status: onu.online ? 'Up' : 'Down',
      rxPower: onu.rxPowerDbm ?? snapshot.fiber?.rxPower ?? null,
      txPower: onu.txPowerDbm ?? snapshot.fiber?.txPower ?? null,
    };
  }
  const capabilities = tr069ProfileForDevice(
    device?.manufacturer || snapshot.manufacturer,
    device?.model || snapshot.model,
    device?.softwareVersion || snapshot.softwareVersion,
    safeTr069Json(device?.capabilitiesJson, {}),
  );
  return {
    enrolled: Boolean(device),
    id: device?.id || null,
    serial: device?.serial || onu?.serial || null,
    onuIndex: onu?.onuIndex || device?.onuIndex || null,
    clientIdServicio: onu?.clientIdServicio ?? device?.clientIdServicio ?? null,
    enabled: device?.enabled === true,
    status: device?.status || 'not_enrolled',
    acsDeviceId: device?.acsDeviceId || null,
    manufacturer: device?.manufacturer || snapshot.manufacturer,
    model: device?.model || snapshot.model,
    softwareVersion: device?.softwareVersion || snapshot.softwareVersion,
    lastInformAt: device?.lastInformAt || snapshot.lastInformAt,
    lastAgentAt: device?.lastAgentAt || null,
    managementChannels: {
      tr069: {
        available: Boolean(device?.acsDeviceId),
        online: snapshot.online === true,
        deviceId: device?.acsDeviceId || null,
      },
      omci: {
        available: onu?.omccState === 'enable',
        state: onu?.omccState || null,
        phaseState: onu?.phaseState || null,
        oltProfile: onu?.model || null,
        detectedModel: device?.model || snapshot.model || null,
        profileMatched: Boolean(onu?.model && (device?.model || snapshot.model)
          && String(onu.model).toUpperCase().includes(String(device?.model || snapshot.model).toUpperCase())),
        capabilities: ['optical_read', 'equipment_read', 'ethernet_read', 'wifi_radio_read', 'ip_host_read', 'service_read', 'reboot'],
      },
      routing: {
        overview: onu?.omccState === 'enable' ? 'omci' : (snapshot.online ? 'remote' : null),
        fiber: onu?.omccState === 'enable' ? 'omci' : null,
        wifiRead: onu?.omccState === 'enable' ? 'omci' : (snapshot.online ? 'remote' : null),
        wifiWrite: snapshot.online ? 'remote' : null,
        lanRead: onu?.omccState === 'enable' ? 'omci' : (snapshot.online ? 'remote' : null),
        lanWrite: snapshot.online ? 'remote' : null,
        wanRead: onu?.omccState === 'enable' ? 'omci' : (snapshot.online ? 'remote' : null),
        diagnostics: snapshot.online ? 'remote' : null,
        reboot: onu?.omccState === 'enable' ? 'omci' : (snapshot.online ? 'remote' : null),
      },
    },
    snapshot,
    capabilities,
    tasks: tasks.map(tr069TaskDto),
  };
}

async function tr069IdentityHints(device) {
  if (!device) return {};
  const snapshot = sanitizeTr069Snapshot(safeTr069Json(device.snapshotJson, {}));
  const [client, job] = await Promise.all([
    device.clientIdServicio
      ? prisma.client.findUnique({ where: { idServicio: device.clientIdServicio }, select: { ip: true, macCpe: true, macRouterWifi: true, modeloRouterWifi: true } })
      : null,
    prisma.provisioningJob.findFirst({
      where: { serial: device.serial }, orderBy: { updatedAt: 'desc' },
      select: { ip: true, macAddress: true, model: true },
    }),
  ]);
  return {
    acsDeviceId: device.acsDeviceId || undefined,
    ip: snapshot.wan?.ip || client?.ip || job?.ip || undefined,
    mac: job?.macAddress || client?.macCpe || client?.macRouterWifi || undefined,
    model: device.model || snapshot.model || job?.model || client?.modeloRouterWifi || undefined,
  };
}

tr069Router.post('/agents/pair', asyncHandler(async (req, res) => {
  const name = String(req.body?.agentId || '').trim();
  if (!/^[A-Za-z0-9_.:-]{4,100}$/.test(name)) return res.status(400).json({ error: 'Identificador de agente inválido' });
  const version = String(req.body?.agentVersion || '').trim().slice(0, 40) || null;
  const token = crypto.randomBytes(48).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const agent = await prisma.tr069Agent.upsert({
    where: { name },
    update: { tokenHash, active: true, version, createdBy: req.session.username, lastSeenAt: new Date() },
    create: { name, tokenHash, active: true, version, createdBy: req.session.username, lastSeenAt: new Date() },
  });
  await logActivity(req, {
    action: 'tr069_agent_paired', entityType: 'olt', entityId: agent.id,
    entityName: agent.name, details: { version },
  });
  res.status(201).json({ agentId: agent.name, token });
}));

tr069Router.get('/devices/:serial/capabilities', asyncHandler(async (req, res) => {
  const candidates = tr069SerialCandidates(req.params.serial);
  const device = await prisma.tr069Device.findFirst({ where: { serial: { in: candidates } } });
  if (!device) return res.status(404).json({ error: 'ONU no inscrita para TR-069' });
  const snapshot = safeTr069Json(device.snapshotJson, {});
  res.json(tr069ProfileForDevice(
    device.manufacturer || snapshot.manufacturer,
    device.model || snapshot.model,
    device.softwareVersion || snapshot.softwareVersion,
    safeTr069Json(device.capabilitiesJson, {}),
  ));
}));

tr069Router.get('/devices/:serial/parameters', asyncHandler(async (req, res) => {
  const candidates = tr069SerialCandidates(req.params.serial);
  const device = await prisma.tr069Device.findFirst({ where: { serial: { in: candidates } } });
  if (!device) return res.status(404).json({ error: 'ONU no inscrita para TR-069' });
  const query = String(req.query.q || '').trim().toLowerCase().slice(0, 120);
  const parameters = sanitizeTr069Snapshot(safeTr069Json(device.snapshotJson, {})).parameters || [];
  const filtered = query
    ? parameters.filter((item) => String(item.path || '').toLowerCase().includes(query))
    : parameters;
  res.json(filtered.slice(0, 2000));
}));

tr069Router.get('/devices/:serial/telemetry', asyncHandler(async (req, res) => {
  const candidates = tr069SerialCandidates(req.params.serial);
  const device = await prisma.tr069Device.findFirst({ where: { serial: { in: candidates } } });
  if (!device) return res.json([]);
  const rows = await prisma.tr069Telemetry.findMany({
    where: { deviceId: device.id }, orderBy: { collectedAt: 'desc' },
    take: Math.min(500, Math.max(10, Number(req.query.limit) || 96)),
  });
  res.json(rows.map((row) => ({ ...row, metrics: safeTr069Json(row.metricsJson, {}) })).map(({ metricsJson, ...row }) => row));
}));

async function findTr069Onu(serial) {
  const candidates = tr069SerialCandidates(serial);
  if (!candidates.length) return null;
  const onus = await prisma.oltOnu.findMany({ where: { serial: { not: null } } });
  const matches = onus.filter((onu) => tr069SerialCandidates(onu.serial).some((candidate) => candidates.includes(candidate)));
  return selectBestTr069Onu(matches);
}

tr069Router.get('/devices/:serial', asyncHandler(async (req, res) => {
  const serial = normalizeTr069Serial(req.params.serial);
  if (!serial) return res.status(400).json({ error: 'Serial inválido' });
  const candidates = tr069SerialCandidates(serial);
  const device = await prisma.tr069Device.findFirst({
    where: { serial: { in: candidates } },
    include: { onu: true, tasks: { orderBy: { createdAt: 'desc' }, take: 20 } },
  });
  const onu = await findTr069Onu(serial) || device?.onu || null;
  res.json(tr069DeviceDto(device, device?.tasks || [], onu));
}));

tr069Router.patch('/devices/:serial', asyncHandler(async (req, res) => {
  const serial = normalizeTr069Serial(req.params.serial);
  if (!serial) return res.status(400).json({ error: 'Serial inválido' });
  const onu = await findTr069Onu(serial);
  if (!onu) return res.status(404).json({ error: 'La ONU no existe en el inventario OLT' });
  const enabled = req.body?.enabled === true;
  const canonicalSerial = normalizeTr069Serial(onu.serial || serial);
  const device = await prisma.tr069Device.upsert({
    where: { serial: canonicalSerial },
    update: {
      enabled,
      status: enabled ? 'waiting_agent' : 'disabled',
      onuIndex: onu.onuIndex,
      clientIdServicio: onu.clientIdServicio,
      enabledBy: enabled ? req.session.username : null,
      enabledAt: enabled ? new Date() : null,
    },
    create: {
      serial: canonicalSerial,
      enabled,
      status: enabled ? 'waiting_agent' : 'disabled',
      onuIndex: onu.onuIndex,
      clientIdServicio: onu.clientIdServicio,
      enabledBy: enabled ? req.session.username : null,
      enabledAt: enabled ? new Date() : null,
    },
  });
  if (!enabled) {
    await prisma.tr069Task.updateMany({
      where: { deviceId: device.id, status: { in: ['pending', 'processing'] } },
      data: { status: 'cancelled', errorMessage: 'Administracion TR-069 desactivada', completedAt: new Date() },
    });
  }
  await logActivity(req, {
    action: enabled ? 'tr069_device_enabled' : 'tr069_device_disabled',
    entityType: 'olt', entityId: onu.onuIndex, entityName: onu.name || canonicalSerial,
    details: { serial: canonicalSerial, clientIdServicio: onu.clientIdServicio },
  });
  res.json(tr069DeviceDto(device));
}));

tr069Router.get('/devices/:serial/tasks', asyncHandler(async (req, res) => {
  const candidates = tr069SerialCandidates(req.params.serial);
  const device = await prisma.tr069Device.findFirst({ where: { serial: { in: candidates } } });
  if (!device) return res.json([]);
  const tasks = await prisma.tr069Task.findMany({
    where: { deviceId: device.id }, orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(10, Number(req.query.limit) || 30)),
  });
  res.json(tasks.map(tr069TaskDto));
}));

tr069Router.post('/devices/:serial/tasks', asyncHandler(async (req, res) => {
  const candidates = tr069SerialCandidates(req.params.serial);
  const device = await prisma.tr069Device.findFirst({ where: { serial: { in: candidates } } });
  if (!device) return res.status(404).json({ error: 'Active primero la administración TR-069 de esta ONU' });
  if (!device.enabled) return res.status(409).json({ error: 'La administración TR-069 esta desactivada para esta ONU' });
  let input;
  try { input = validateTr069TaskInput(req.body?.action, req.body?.payload, device.serial); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  let secretCiphertext = null;
  try { secretCiphertext = encryptSecret(input.secret, TR069_TASK_ENCRYPTION_KEY); }
  catch (error) { return res.status(503).json({ error: error.message }); }
  const capabilities = tr069ProfileForDevice(device.manufacturer, device.model, device.softwareVersion, safeTr069Json(device.capabilitiesJson, {}));
  const capability = capabilities.actions.find((item) => item.name === input.action);
  if (!capability?.executable) {
    return res.status(423).json({ error: 'Esta acción esta visible pero bloqueada hasta certificar el modelo y firmware', capability });
  }
  const activeDuplicate = await prisma.tr069Task.findFirst({
    where: { deviceId: device.id, action: input.action, status: { in: ['pending', 'processing'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (activeDuplicate && JSON.stringify(safeTr069Json(activeDuplicate.payloadJson)) === JSON.stringify(input.payload)) {
    return res.json(tr069TaskDto(activeDuplicate));
  }
  const scheduledAt = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'Fecha programada inválida' });
  const idempotencyKey = String(req.body?.idempotencyKey || `ui:${device.serial}:${input.action}:${crypto.randomUUID()}`).slice(0, 180);
  const task = await prisma.tr069Task.create({
    data: {
      idempotencyKey, deviceId: device.id, serial: device.serial, action: input.action,
      payloadJson: JSON.stringify(input.payload), secretCiphertext,
      riskLevel: input.definition.risk, stage: 'queued', progress: 0, scheduledAt,
      createdById: req.session.userId, createdBy: req.session.username,
    },
  });
  await logActivity(req, {
    action: 'tr069_task_created', entityType: 'olt', entityId: device.onuIndex || device.serial,
    entityName: device.serial, details: { taskId: task.id, operation: task.action },
  });
  res.status(201).json(tr069TaskDto(task));
}));

tr069Router.post('/tasks/:id/cancel', asyncHandler(async (req, res) => {
  const task = await prisma.tr069Task.findUnique({ where: { id: String(req.params.id) } });
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (task.status !== 'pending') return res.status(409).json({ error: 'Solo se puede cancelar una tarea pendiente' });
  const updated = await prisma.tr069Task.update({
    where: { id: task.id },
    data: { status: 'cancelled', stage: 'cancelled', errorMessage: 'Cancelada por el administrador', cancelledAt: new Date(), completedAt: new Date() },
  });
  res.json(tr069TaskDto(updated));
}));

tr069Router.post('/tasks/:id/retry', asyncHandler(async (req, res) => {
  const source = await prisma.tr069Task.findUnique({ where: { id: String(req.params.id) } });
  if (!source) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (!['failed', 'cancelled'].includes(source.status)) return res.status(409).json({ error: 'La tarea no requiere reintento' });
  const task = await prisma.tr069Task.create({
    data: {
      idempotencyKey: `retry:${source.id}:${crypto.randomUUID()}`, deviceId: source.deviceId, serial: source.serial,
      action: source.action, status: 'pending', payloadJson: source.payloadJson, secretCiphertext: source.secretCiphertext,
      riskLevel: source.riskLevel, stage: 'queued', progress: 0, createdById: req.session.userId, createdBy: req.session.username,
    },
  });
  res.status(201).json(tr069TaskDto(task));
}));

tr069Router.post('/agent/poll', asyncHandler(async (req, res) => {
  const agentId = req.tr069Agent.name;
  const agentVersion = String(req.body?.agentVersion || '').trim().slice(0, 40) || null;
  await prisma.tr069Agent.update({ where: { id: req.tr069Agent.id }, data: { lastSeenAt: new Date(), version: agentVersion } });
  const now = new Date();
  let claimed = null;
  for (let attempt = 0; attempt < 3 && !claimed; attempt += 1) {
    const candidate = await prisma.tr069Task.findFirst({
      where: {
        device: { enabled: true },
        AND: [{ OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] }],
        OR: [{ status: 'pending' }, { status: 'processing', leaseExpiresAt: { lt: now } }],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) break;
    const activeForDevice = await prisma.tr069Task.count({
      where: { deviceId: candidate.deviceId, status: 'processing', leaseExpiresAt: { gte: now }, id: { not: candidate.id } },
    });
    if (activeForDevice) break;
    const updated = await prisma.tr069Task.updateMany({
      where: { id: candidate.id, updatedAt: candidate.updatedAt },
      data: {
        status: 'processing', stage: 'preflight', progress: 5, claimedBy: agentId, claimedAt: now, heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + TR069_TASK_LEASE_MS), attempts: { increment: 1 },
      },
    });
    if (updated.count) claimed = await prisma.tr069Task.findUnique({ where: { id: candidate.id } });
  }
  if (!claimed) {
    const normalCutoff = new Date(now.getTime() - 5 * 60 * 1000);
    const diagnosticCutoff = new Date(now.getTime() - 60 * 1000);
    const telemetryDevice = await prisma.tr069Device.findFirst({
      where: {
        enabled: true,
        OR: [
          { lastAgentAt: null },
          { status: { in: ['error', 'stale'] }, lastAgentAt: { lt: diagnosticCutoff } },
          { status: { notIn: ['error', 'stale'] }, lastAgentAt: { lt: normalCutoff } },
        ],
      },
      orderBy: { lastAgentAt: 'asc' },
    });
    if (telemetryDevice) {
      const identityHints = await tr069IdentityHints(telemetryDevice);
      await prisma.tr069Device.update({ where: { id: telemetryDevice.id }, data: { lastAgentAt: now } });
      return res.json({
        task: null,
        telemetry: { serial: telemetryDevice.serial, diagnosticMode: ['error', 'stale'].includes(telemetryDevice.status), identityHints },
        pollAfterSeconds: 1,
      });
    }
    return res.json({ task: null, telemetry: null, pollAfterSeconds: 5 });
  }
  let protectedPayload = null;
  try { protectedPayload = decryptSecret(claimed.secretCiphertext, TR069_TASK_ENCRYPTION_KEY); }
  catch (error) {
    await prisma.tr069Task.update({
      where: { id: claimed.id },
      data: { status: 'failed', errorMessage: error.message, completedAt: new Date(), leaseExpiresAt: null },
    });
    return res.json({ task: null, pollAfterSeconds: 1 });
  }
  res.json({
    task: {
      id: claimed.id, serial: claimed.serial, action: claimed.action,
      payload: { ...safeTr069Json(claimed.payloadJson), ...(protectedPayload || {}) },
      attempts: claimed.attempts,
      identityHints: await tr069IdentityHints(await prisma.tr069Device.findUnique({ where: { id: claimed.deviceId } })),
    },
    pollAfterSeconds: 1,
  });
}));

tr069Router.post('/agent/tasks/:id/progress', asyncHandler(async (req, res) => {
  const task = await prisma.tr069Task.findUnique({ where: { id: String(req.params.id) } });
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (task.claimedBy !== req.tr069Agent.name || task.status !== 'processing') return res.status(409).json({ error: 'Lease de tarea inválido' });
  const stage = String(req.body?.stage || task.stage).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || task.stage;
  const progress = Math.max(task.progress, Math.min(95, Math.max(1, Number(req.body?.progress) || task.progress)));
  const updated = await prisma.tr069Task.update({
    where: { id: task.id },
    data: { stage, progress, heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + TR069_TASK_LEASE_MS) },
  });
  res.json(tr069TaskDto(updated));
}));

tr069Router.post('/agent/tasks/:id/report', asyncHandler(async (req, res) => {
  const agentId = req.tr069Agent.name;
  const task = await prisma.tr069Task.findUnique({ where: { id: String(req.params.id) }, include: { device: true } });
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (!agentId || task.claimedBy !== agentId) return res.status(409).json({ error: 'La tarea pertenece a otro agente' });
  const success = req.body?.status === 'success';
  const errorMessage = success ? null : String(req.body?.errorMessage || 'El agente no pudo completar la tarea').replace(/\s+/g, ' ').slice(0, 800);
  const result = req.body?.result && typeof req.body.result === 'object'
    ? {
      message: String(req.body.result.message || '').slice(0, 300),
      snapshot: sanitizeTr069Snapshot(req.body.result.snapshot || {}),
      diagnostic: req.body.result.diagnostic && typeof req.body.result.diagnostic === 'object' ? req.body.result.diagnostic : null,
    }
    : null;
  const errorCode = success ? null : String(req.body?.errorCode || 'TR069_AGENT_ERROR').replace(/[^A-Z0-9_-]/gi, '').slice(0, 60);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.tr069Task.update({
      where: { id: task.id },
      data: {
        status: success ? 'success' : 'failed', stage: success ? 'verified' : 'failed', progress: 100,
        resultJson: result ? JSON.stringify(result) : null, errorMessage, errorCode,
        rollbackJson: req.body?.rollback ? JSON.stringify(req.body.rollback) : null,
        verificationJson: req.body?.verification ? JSON.stringify(req.body.verification) : null,
        completedAt: new Date(), heartbeatAt: new Date(), leaseExpiresAt: null,
      },
    });
    const snapshot = result?.snapshot;
    await tx.tr069Device.update({
      where: { id: task.deviceId },
      data: {
        status: success ? 'online' : 'error', lastAgentAt: new Date(),
        ...(snapshot ? {
          acsDeviceId: snapshot.deviceId, manufacturer: snapshot.manufacturer, model: snapshot.model,
          softwareVersion: snapshot.softwareVersion, lastInformAt: snapshot.lastInformAt ? new Date(snapshot.lastInformAt) : null,
          snapshotJson: JSON.stringify(snapshot),
        } : {}),
      },
    });
    return row;
  });
  res.json(tr069TaskDto(updated));
}));

tr069Router.post('/agent/devices/:serial/snapshot', asyncHandler(async (req, res) => {
  const candidates = tr069SerialCandidates(req.params.serial);
  const device = await prisma.tr069Device.findFirst({ where: { serial: { in: candidates }, enabled: true } });
  if (!device) return res.status(404).json({ error: 'ONU no inscrita para TR-069' });
  const snapshot = sanitizeTr069Snapshot(req.body?.snapshot || {});
  const capabilities = req.body?.capabilities && typeof req.body.capabilities === 'object' ? req.body.capabilities : {};
  const profile = tr069ProfileForDevice(snapshot.manufacturer, snapshot.model, snapshot.softwareVersion, capabilities);
  const updated = await prisma.tr069Device.update({
    where: { id: device.id },
    data: {
      status: snapshot.online ? 'online' : 'stale', acsDeviceId: snapshot.deviceId,
      manufacturer: snapshot.manufacturer, model: snapshot.model, softwareVersion: snapshot.softwareVersion,
      lastInformAt: snapshot.lastInformAt ? new Date(snapshot.lastInformAt) : null,
      lastAgentAt: new Date(), snapshotJson: JSON.stringify(snapshot), capabilitiesJson: JSON.stringify(capabilities),
    },
  });
  const modelProfileMatch = await resolveOnuModelProfile({
    serial: device.serial, manufacturer: snapshot.manufacturer,
    model: snapshot.model, softwareVersion: snapshot.softwareVersion,
  });
  if (modelProfileMatch) {
    await persistOnuDeviceProfile({
      serial: device.serial, manufacturer: snapshot.manufacturer,
      model: snapshot.model, softwareVersion: snapshot.softwareVersion,
    }, modelProfileMatch, 'tr069');
  }
  await prisma.tr069CapabilityProfile.upsert({
    where: { profileKey: profile.profileKey },
    update: { manufacturer: profile.manufacturer || 'Desconocido', model: profile.model || 'Desconocido', softwarePattern: profile.softwareVersion || '*', dataModel: profile.dataModel, actionsJson: JSON.stringify(capabilities.actions || {}) },
    create: { profileKey: profile.profileKey, manufacturer: profile.manufacturer || 'Desconocido', model: profile.model || 'Desconocido', softwarePattern: profile.softwareVersion || '*', dataModel: profile.dataModel, actionsJson: JSON.stringify(capabilities.actions || {}) },
  });
  const collectedAt = snapshot.collectedAt ? new Date(snapshot.collectedAt) : new Date();
  const lastSample = await prisma.tr069Telemetry.findFirst({ where: { deviceId: device.id }, orderBy: { collectedAt: 'desc' } });
  const important = req.body?.eventCode || !snapshot.online || !lastSample || collectedAt.getTime() - lastSample.collectedAt.getTime() >= 15 * 60 * 1000;
  if (important) {
    await prisma.tr069Telemetry.upsert({
      where: { deviceId_collectedAt: { deviceId: device.id, collectedAt } },
      update: { metricsJson: JSON.stringify({ overview: snapshot.overview, fiber: snapshot.fiber, wan: snapshot.wan, wifi: snapshot.wifi }), eventCode: String(req.body?.eventCode || '').slice(0, 60) || null },
      create: { deviceId: device.id, serial: device.serial, collectedAt, interval: req.body?.diagnosticMode ? 'diagnostic' : 'normal', metricsJson: JSON.stringify({ overview: snapshot.overview, fiber: snapshot.fiber, wan: snapshot.wan, wifi: snapshot.wifi }), eventCode: String(req.body?.eventCode || '').slice(0, 60) || null },
    });
  }
  res.json(tr069DeviceDto(updated));
}));

app.use('/tr069-api', tr069Router);

// ═══════════════════════════════════════════════════════════════
// MIKROTIK ADDRESS-LIST + BLOQUEOS / MOROSOS / CAPTIVE
// ═══════════════════════════════════════════════════════════════

const LIST_MOROSOS = 'morosos-crm';
const LIST_BLOQUEADOS = 'bloqueados-crm';

async function findAddressListEntry(c, list, ip) {
  const entries = await mtWrite(c, null,
    '/ip/firewall/address-list/print',
    `?list=${list}`,
    `?address=${ip}`,
  );
  return entries[0] || null;
}

async function addToAddressList(c, list, ip, comment) {
  return mtSerialize(async () => {
    const existing = await findAddressListEntry(c, list, ip);
    if (existing) return { alreadyIn: true, id: existing['.id'] };
    const res = await mtWrite(c, null,
      '/ip/firewall/address-list/add',
      `=list=${list}`,
      `=address=${ip}`,
      `=comment=${comment}`,
    );
    mtInvalidate('blocklist:');
    return { alreadyIn: false, id: res[0]?.ret || null };
  });
}

async function removeFromAddressList(c, list, ip) {
  return mtSerialize(async () => {
    const existing = await findAddressListEntry(c, list, ip);
    if (!existing) return { wasIn: false };
    await mtWrite(c, null,
      '/ip/firewall/address-list/remove',
      `=.id=${existing['.id']}`,
    );
    mtInvalidate('blocklist:');
    return { wasIn: true };
  });
}

async function findRuleByComment(c, path, comment) {
  const rules = await mtWrite(c, null, `${path}/print`, `?comment=${comment}`);
  return rules[0] || null;
}

async function ensureNatRedirect(c, list, comment, captive) {
  return mtSerialize(async () => {
    const existing = await findRuleByComment(c, '/ip/firewall/nat', comment);
    if (existing) return { action: 'exists', id: existing['.id'] };
    const res = await mtWrite(c, null,
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
  });
}

async function ensureSurveySoftPortalNat(c) {
  const dns = require('dns').promises;
  const host = publicHostFromEnv(process.env);
  if (!host) throw new Error('Configura PUBLIC_APP_URL o CAPTIVE_HOST para el portal');
  const resolved = await dns.lookup(host);
  const serverIp = resolved.address;
  const port = 80;
  const comment = 'WISP RD - Encuesta forzada (HTTP)';
  return mtSerialize(async () => {
    const existing = await findRuleByComment(c, '/ip/firewall/nat', comment);
    if (existing) {
      if (existing['to-addresses'] !== serverIp || existing['to-ports'] !== String(port) || existing.disabled === 'true') {
        await mtWrite(c, null,
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
    const res = await mtWrite(c, null,
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
  });
}

// Version sin serializar: solo debe llamarse desde dentro de mtSerialize.
// (Llamar a ensureFilterRule desde otro mtSerialize encadena la tarea detras de si misma y nunca termina.)
async function ensureFilterRuleUnserialized(c, comment, params, options) {
  const existing = await findRuleByComment(c, '/ip/firewall/filter', comment);
  if (existing) return { action: 'exists', id: existing['.id'] };
  const args = ['/ip/firewall/filter/add', `=comment=${comment}`];
  for (const [k, v] of Object.entries(params)) args.push(`=${k}=${v}`);
  if (options?.placeAtTop) {
    const all = await mtWrite(c, null, '/ip/firewall/filter/print');
    const firstId = all[0]?.['.id'];
    if (firstId) args.push(`=place-before=${firstId}`);
  }
  const res = await mtWrite(c, null, ...args);
  return { action: 'created', id: res[0]?.ret || null };
}

async function ensureFilterRule(c, comment, params, options) {
  return mtSerialize(() => ensureFilterRuleUnserialized(c, comment, params, options));
}

async function resolveCaptiveTarget() {
  const dns = require('dns').promises;
  const customHost = process.env.CAPTIVE_HOST;
  const host = customHost || publicHostFromEnv(process.env);
  if (!host) throw new Error('Configura PUBLIC_APP_URL o CAPTIVE_HOST para el portal cautivo');
  const port = parseInt(customHost ? (process.env.CAPTIVE_PORT || PORT) : '80');
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const address = isIp ? host : (await dns.lookup(host)).address;
  return { host, address, port };
}

async function ensureCaptiveNatRule(c, list, comment, target) {
  return mtSerialize(async () => {
    const existing = await findRuleByComment(c, '/ip/firewall/nat', comment);
    if (existing) {
      if (
        existing['to-addresses'] !== target.address ||
        existing['to-ports'] !== String(target.port) ||
        existing.disabled === 'true'
      ) {
        await mtWrite(c, null,
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
    const res = await mtWrite(c, null,
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
  });
}

async function ensureCaptiveFilterRule(c, comment, params, options) {
  return mtSerialize(async () => {
    const existing = await findRuleByComment(c, '/ip/firewall/filter', comment);
    if (existing) {
      const changes = [];
      for (const [k, v] of Object.entries(params)) {
        if (existing[k] !== String(v)) changes.push(`=${k}=${v}`);
      }
      if (existing.disabled === 'true') changes.push('=disabled=no');
      if (changes.length) {
        await mtWrite(c, null, '/ip/firewall/filter/set', `=.id=${existing['.id']}`, ...changes);
        return { action: 'updated', id: existing['.id'] };
      }
      return { action: 'exists', id: existing['.id'] };
    }
    return ensureFilterRuleUnserialized(c, comment, params, options);
  });
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
  const allowDnsTcp = await ensureCaptiveFilterRule(c, 'bloqueados-crm-allow-dns-tcp', {
    chain: 'forward',
    'src-address-list': LIST_BLOQUEADOS,
    protocol: 'tcp',
    'dst-port': '53',
    action: 'accept',
  }, { placeAtTop: true });
  return { target, moroso, bloqueado, allowDns, allowDnsTcp, allowCaptive, dropAll };
}

async function inspectClientBlockCaptiveRules(c) {
  const target = await resolveCaptiveTarget();
  const [moroso, bloqueado, allowDns, allowDnsTcp, allowCaptive, dropAll, lists] = await Promise.all([
    findRuleByComment(c, '/ip/firewall/nat', 'morosos-crm-redirect'),
    findRuleByComment(c, '/ip/firewall/nat', 'bloqueados-crm-redirect'),
    findRuleByComment(c, '/ip/firewall/filter', 'bloqueados-crm-allow-dns'),
    findRuleByComment(c, '/ip/firewall/filter', 'bloqueados-crm-allow-dns-tcp'),
    findRuleByComment(c, '/ip/firewall/filter', 'bloqueados-crm-allow-captive'),
    findRuleByComment(c, '/ip/firewall/filter', 'bloqueados-crm-drop-rest'),
    mtSafe('address-list/print', [], () => mtWrite(c, null, '/ip/firewall/address-list/print')),
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
      allowDnsTcp: ruleState(allowDnsTcp),
      allowCaptive: ruleState(allowCaptive, { 'dst-address': target.address }),
      dropRest: ruleState(dropAll),
    },
  };
}

// Cierra conexiones activas con src=ip (necesario para que el drop tome efecto inmediato)
async function killConnectionsFrom(c, ip) {
  return mtSerialize(async () => {
    try {
      const conns = await mtWrite(c, null, '/ip/firewall/connection/print');
      let removed = 0;
      for (const conn of conns) {
        const src = (conn['src-address'] || '').split(':')[0];
        const replSrc = (conn['reply-src-address'] || '').split(':')[0];
        if (src === ip || replSrc === ip) {
          await mtSafe(`connection/remove ${ip}`, null, () =>
            mtWrite(c, null, '/ip/firewall/connection/remove', `=.id=${conn['.id']}`));
          removed += 1;
        }
      }
      return removed;
    } catch (e) {
      console.error('[mikrotik] killConnectionsFrom failed:', e.message);
      return 0;
    }
  });
}

const blockRouter = express.Router();
blockRouter.use(authMiddleware);
blockRouter.use(requireRole(['admin']));

// Listar IPs en cada lista — cache 5s (admin polling es frecuente)
blockRouter.get('/list', asyncHandler(async (req, res) => {
  const data = await mtCached('blocklist:list', 5000, async () => {
    const c = await getMtConnection();
    const all = await mtWrite(c, null, '/ip/firewall/address-list/print');
    const morosos = all.filter((e) => e.list === LIST_MOROSOS);
    const bloqueados = all.filter((e) => e.list === LIST_BLOQUEADOS);
    return {
      morosos: morosos.map((e) => ({ id: e['.id'], address: e.address, comment: e.comment || '' })),
      bloqueados: bloqueados.map((e) => ({ id: e['.id'], address: e.address, comment: e.comment || '' })),
    };
  });
  res.json(data);
}));

async function removeRuleByComment(c, path, comment) {
  return mtSerialize(async () => {
    const r = await findRuleByComment(c, path, comment);
    if (!r) return false;
    await mtWrite(c, null, `${path}/remove`, `=.id=${r['.id']}`);
    return true;
  });
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
    await removeRuleByComment(c, '/ip/firewall/filter', 'bloqueados-crm-allow-dns-tcp');
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
    return { ok: false, error: 'Acción inválida' };
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
    captiveUrl: publicBaseUrlFromEnv(process.env)
      ? `${publicBaseUrlFromEnv(process.env)}/captive?ip=${encodeURIComponent(client.ip)}`
      : null,
  };
}

const clientActionsRouter = express.Router();
clientActionsRouter.use(authMiddleware);

// IMPORTANTE: rutas literales ANTES que rutas con :param
// PATCH alias (nombre real, cédula, teléfono, notas) - NUNCA tocados por sync
clientActionsRouter.patch('/:id/alias', asyncHandler(async (req, res) => {
  if (!hasAnyRole(req.session, ['tecnico', 'cobranza'])) return res.status(403).json({ error: 'Permisos insuficientes' });
  const { validateAlias, changeAlias } = require('./lib/client-record-service');
  const idServicio = parseInt(req.params.id);
  if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(idServicio) || idServicio <= 0) return res.status(400).json({ error: 'Cliente inválido' });
  const data = validateAlias(req.body);
  const updated = await prisma.$transaction(tx => changeAlias(tx, { id: idServicio, data, actor: req.session.username }));
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
    where: {
      OR: [
        { crmAction: { not: null } },
        { paymentPilotEnabled: true },
      ],
    },
    select: {
      idServicio: true, crmAction: true, crmActionReason: true, crmActionAt: true,
      paymentPilotEnabled: true, paymentPilotEnabledAt: true,
    },
  });
  res.json(rows);
}));

// Inscripcion manual por cliente. No altera MikroTik ni el estado del servicio.
clientActionsRouter.patch('/:id/payment-pilot', requireRole(['admin']), asyncHandler(async (req, res) => {
  const idServicio = parseInt(req.params.id, 10);
  if (!Number.isInteger(idServicio)) return res.status(400).json({ error: 'Cliente inválido' });
  const { enabled } = sanitizePaymentPilotToggle(req.body);
  const portalConfig = getPaymentPortalConfig();
  if (enabled && !portalConfig.ready) {
    return res.status(409).json({
      error: `Configura primero ${portalConfig.issues.join(', ')} sin datos de ejemplo`,
      issues: portalConfig.issues,
    });
  }
  const client = await prisma.client.findUnique({
    where: { idServicio },
    select: {
      idServicio: true, nombre: true, ip: true, macCpe: true, mtMacAddress: true,
      crmAction: true, paymentPilotEnabled: true, paymentPilotEnabledAt: true,
    },
  });
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
  if (!enabled && client.crmAction === 'block') {
    return res.status(409).json({ error: 'Reactiva el servicio antes de sacar al cliente del piloto' });
  }

  const now = new Date();
  const updated = await prisma.client.update({
    where: { idServicio },
    data: enabled ? {
      paymentPilotEnabled: true,
      paymentPilotEnabledAt: client.paymentPilotEnabledAt || now,
      paymentPilotEnabledBy: req.session?.username || 'admin',
    } : {
      paymentPilotEnabled: false,
      paymentPilotEnabledAt: null,
      paymentPilotEnabledBy: null,
    },
    select: {
      idServicio: true, paymentPilotEnabled: true, paymentPilotEnabledAt: true,
      paymentPilotEnabledBy: true,
    },
  });
  await logActivity(req, {
    action: enabled ? 'payment_portal_pilot_enabled' : 'payment_portal_pilot_disabled',
    entityType: 'client',
    entityId: idServicio,
    entityName: client.nombre,
    details: { ip: client.ip, mac: client.mtMacAddress || client.macCpe || null },
  });
  res.json({
    ok: true,
    ...updated,
    captiveUrl: client.ip ? `${getPublicBaseUrl(req)}/captive?ip=${encodeURIComponent(client.ip)}` : null,
  });
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
  const idServicio = parseInt(req.params.id, 10);
  if (!Number.isInteger(idServicio)) return res.status(400).json({ error: 'Cliente inválido' });
  const client = await prisma.client.findUnique({
    where: { idServicio },
    select: { paymentPilotEnabled: true },
  });
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
  if (!client.paymentPilotEnabled) {
    return res.status(409).json({ error: 'Habilita primero el piloto del portal para este cliente' });
  }
  if (req.body?.pilotConfirmed !== true) {
    return res.status(400).json({ error: 'Confirma explicitamente la desactivacion con portal de pago' });
  }
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

function getPaymentPortalConfig() {
  return inspectPaymentPortalConfiguration({
    businessName: process.env.INVOICE_BUSINESS_NAME || 'MaxWifi',
    bankInfo: process.env.INVOICE_BANK_INFO || '',
    supportPhone: process.env.SUPPORT_PHONE || process.env.INVOICE_SUPPORT_PHONE || '',
  });
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
  businessName,
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
  paymentMethods,
  paymentConfigurationReady,
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
    : mode === 'moroso'
    ? 'Tu internet esta pausado. Esta pagina queda disponible para ayudarte a resolver el estado de tu servicio.'
    : 'Esta es una vista informativa de tu servicio y de los canales de pago disponibles.';
  const paymentRows = Array.isArray(paymentMethods)
    ? paymentMethods.map((method) => String(method || '').trim()).filter(Boolean)
    : [];
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/>
<title>${htmlEscape(banner.title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f7f9;color:#0f172a;display:flex;align-items:center;justify-content:center;padding:18px}
.shell{width:100%;max-width:760px;background:white;border:1px solid #dbe3e8;border-radius:8px;box-shadow:0 20px 60px rgba(15,23,42,.14);overflow:hidden}
.top{background:#17212b;color:white;padding:28px;border-bottom:5px solid ${banner.accent}}
.brand{display:block;color:#cbd5e1;font-size:13px;font-weight:700;margin-bottom:12px}
.badge{display:inline-flex;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.22);border-radius:4px;padding:7px 10px;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
h1{font-size:clamp(28px,5vw,44px);line-height:1.04;margin:18px 0 10px;letter-spacing:0}
.lead{max-width:620px;color:#e2e8f0;font-size:16px;line-height:1.55;margin:0}
.body{padding:26px}
.notice{border-left:5px solid ${banner.accent};background:${banner.soft};border-radius:4px;padding:16px 18px;margin-bottom:18px}
.notice strong{display:block;margin-bottom:4px}.notice p{margin:0;line-height:1.5;color:#334155}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:18px 0}
.item{border-bottom:1px solid #e2e8f0;padding:12px 4px;background:#fff}
.lbl{display:block;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.val{display:block;font-size:16px;font-weight:800;color:#0f172a;overflow-wrap:anywhere}
.payment{margin-top:22px;border:1px solid #cbd5e1;border-left:5px solid #0f766e;border-radius:4px;padding:18px;background:#f8fafc}
.payment h2{font-size:18px;margin:0 0 5px}.payment p{color:#64748b;font-size:13px;line-height:1.45;margin:0 0 13px}
.payment-list{display:grid;gap:8px}.payment-line{background:white;border:1px solid #dbe3e8;padding:11px 12px;font-weight:700;overflow-wrap:anywhere}
.cta-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px}
.cta{display:inline-flex;align-items:center;justify-content:center;background:${banner.accent};color:white;font-weight:800;min-height:48px;padding:0 20px;border-radius:4px;text-decoration:none}
.ghost{color:#475569;font-size:13px;line-height:1.45;max-width:420px}
.foot{border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;padding:16px 26px;background:#f8fafc}
@media (max-width:640px){.grid{grid-template-columns:1fr}.top,.body{padding:22px}}
</style></head><body>
<main class="shell">
  <section class="top">
    <span class="brand">${htmlEscape(businessName || 'Proveedor de internet')}</span>
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
    ${paymentConfigurationReady && paymentRows.length ? `<section class="payment">
      <h2>Informacion para realizar el pago</h2>
      <p>Realiza el pago a nombre de ${htmlEscape(businessName || 'la empresa')} y conserva tu comprobante.</p>
      <div class="payment-list">${paymentRows.map((method) => `<div class="payment-line">${htmlEscape(method)}</div>`).join('')}</div>
    </section>` : `<section class="payment"><h2>Informacion de pago pendiente</h2><p>Los datos de pago de la empresa todavia no estan disponibles. Comunicate con administracion antes de realizar una transferencia.</p></section>`}
    <div class="cta-row">
      ${cleanPhone ? `<a class="cta" href="${htmlEscape(contactHref)}">Llamar a administracion</a>` : ''}
      <span class="ghost">Para reconectar el servicio debes comunicarte con el administrador. Esta pagina no libera el bloqueo automaticamente.</span>
    </div>
  </section>
  <footer class="foot">
    ${contact ? `Soporte: ${htmlEscape(contact)}. ` : ''}IP registrada: ${htmlEscape(ip)}${actionAt ? ` - Estado aplicado: ${htmlEscape(actionAt)}` : ''}
  </footer>
</main></body></html>`;
}

// IP del visitante segun el proxy de confianza (app.set('trust proxy', 1)).
// No se usa el primer valor de X-Forwarded-For: lo escribe el propio visitante y permitia
// hacerse pasar por la IP de otro cliente para ver sus datos o responder su encuesta.
function detectClientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
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
  // ?ip= solo lo puede usar el personal con sesion (vista previa desde el panel).
  // Sin sesion se ignora: antes cualquiera podia ver nombre, plan y deuda de un cliente por su IP.
  const staffSession = req.query?.ip ? await getSession(req.headers['x-auth-token']) : null;
  const ip = (staffSession && req.query.ip ? req.query.ip : detectClientIp(req)).toString();
  const client = await prisma.client.findFirst({ where: { ip } });
  let mode = 'info';
  if (client?.crmAction === 'block') mode = 'bloqueado';
  else if (client?.crmAction === 'moroso') mode = 'moroso';
  else if ((client?.estado || '').toLowerCase().includes('suspend')) mode = 'moroso';
  if (req.query?.preview === 'blocked') mode = 'bloqueado';
  const invoice = client?.idServicio ? await findLatestPendingInvoiceForClient(client.idServicio) : null;
  const dueDate = parseFechaCorte(invoice?.fechaVencimiento || client?.fechaCorte || '');
  const displayName = client?.aliasNombre || client?.nombre || 'Cliente';
  const portalConfig = getPaymentPortalConfig();
  const html = buildServiceStatusCaptive({
    mode,
    name: displayName,
    businessName: portalConfig.businessName,
    ip,
    plan: client?.planInternetName || 'Servicio de internet',
    priceDop: client?.precioPlan ? Number(client.precioPlan) : null,
    reason: client?.crmActionReason || '',
    contact: portalConfig.supportPhone,
    status: mode === 'bloqueado' ? (client?.crmAction === 'block' ? 'Desactivado manualmente' : 'Vista previa de desactivacion') : (client?.estado || ''),
    speed: client?.mtQueueLimit || '',
    zone: client?.zonaNombre || client?.localidad || '',
    router: client?.routerNombre || client?.sectorialNombre || '',
    actionAt: client?.crmActionAt ? client.crmActionAt.toLocaleString('es-DO') : '',
    invoiceNumber: invoice?.folio || invoice?.idFactura || '',
    invoiceStatus: invoice?.estado || client?.estadoFacturas || '',
    invoiceDue: invoice?.fechaVencimiento || client?.fechaCorte || '',
    invoiceMonth: formatInvoiceMonth(dueDate),
    invoiceBalance: formatDop(invoice?.saldo || client?.saldo || client?.precioPlan),
    paymentMethods: portalConfig.paymentMethods,
    paymentConfigurationReady: portalConfig.ready,
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
// Defaults antispam: 7 dias entre reminders, max 3 envios por survey, poll cada 30 min.
// Estos son los MINIMOS permitidos. Admin puede subirlos via AppSetting, NO bajarlos.
const SURVEY_REMINDER_MIN_INTERVAL_HOURS = 24 * 7; // 7 dias
const SURVEY_REMINDER_DEFAULT_INTERVAL_HOURS = Math.max(
  SURVEY_REMINDER_MIN_INTERVAL_HOURS,
  parseInt(process.env.SURVEY_REMINDER_INTERVAL_HOURS || '168') // 168h = 7 dias
);
const SURVEY_REMINDER_DEFAULT_MAX = Math.max(1, parseInt(process.env.SURVEY_REMINDER_MAX || '3'));
const SURVEY_REMINDER_POLL_MS = Math.max(60_000, parseInt(process.env.SURVEY_REMINDER_POLL_MS || '1800000')); // 30 min
const SURVEY_REMINDERS_ENABLED = process.env.SURVEY_REMINDERS_ENABLED === 'true';
let surveyReminderTimer = null;
let lastSurveyReminderRun = null;

// Config dinamica leida de AppSetting (cacheada in-mem 60s). Las claves son:
//   survey_reminder_interval_hours -> intervalo entre envios por survey
//   survey_reminder_max             -> tope de envios por survey
//   survey_reminder_paused          -> "true" para pausar TODOS los envios
let surveyConfigCache = null;
let surveyConfigCachedAt = 0;
async function getSurveyConfig() {
  if (surveyConfigCache && Date.now() - surveyConfigCachedAt < 60_000) return surveyConfigCache;
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ['survey_reminder_interval_hours', 'survey_reminder_max', 'survey_reminder_paused'] } },
  }).catch(() => []);
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const intervalRaw = parseInt(map.survey_reminder_interval_hours);
  const maxRaw = parseInt(map.survey_reminder_max);
  surveyConfigCache = {
    intervalHours: Math.max(
      SURVEY_REMINDER_MIN_INTERVAL_HOURS,
      Number.isFinite(intervalRaw) ? intervalRaw : SURVEY_REMINDER_DEFAULT_INTERVAL_HOURS
    ),
    maxReminders: Math.max(1, Number.isFinite(maxRaw) ? maxRaw : SURVEY_REMINDER_DEFAULT_MAX),
    pausedGlobally: map.survey_reminder_paused === 'true',
  };
  surveyConfigCachedAt = Date.now();
  return surveyConfigCache;
}
function invalidateSurveyConfig() {
  surveyConfigCache = null;
  surveyConfigCachedAt = 0;
}

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
  const configured = publicBaseUrlFromEnv(process.env);
  if (configured) return configured;
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

async function sendSurveyReminderById(id, req = null, { force = false } = {}) {
  const survey = await prisma.surveyResponse.findUnique({
    where: { id },
    include: { client: { select: { idServicio: true, nombre: true, telefono: true, ip: true } } },
  });
  if (!survey || survey.status !== 'pending') return { ok: false, skipped: true, reason: 'not_pending' };

  // === ANTI-SPAM ===
  // Solo se saltan estas reglas si el admin manda "force" (boton manual desde la UI).
  if (!force) {
    const cfg = await getSurveyConfig();
    if (cfg.pausedGlobally) {
      return { ok: false, skipped: true, reason: 'paused_globally' };
    }
    if (survey.paused) {
      return { ok: false, skipped: true, reason: 'paused' };
    }
    if (survey.reminderCount >= cfg.maxReminders) {
      // Marcar como agotado para que ni siquiera siga matcheando el query del loop.
      // Mantenemos status='pending' (que sigue captura input del cliente), pero
      // limpiamos nextReminderAt y marcamos lastReminderStatus.
      await prisma.surveyResponse.update({
        where: { id: survey.id },
        data: { nextReminderAt: null, lastReminderStatus: `max_reminders_${survey.reminderCount}` },
      });
      return { ok: false, skipped: true, reason: 'max_reminders_reached', count: survey.reminderCount };
    }
    // Anti-doble-tick: no permitir reenvio si el ultimo se mando hace menos
    // del intervalo configurado. Cubre el caso de que dos workers coincidan.
    if (survey.lastReminderAt) {
      const minSince = addHours(survey.lastReminderAt, cfg.intervalHours);
      if (minSince > new Date()) {
        await prisma.surveyResponse.update({
          where: { id: survey.id },
          data: { nextReminderAt: minSince },
        });
        return { ok: false, skipped: true, reason: 'too_soon', nextReminderAt: minSince };
      }
    }
  }

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
  const cfgForRetry = await getSurveyConfig();
  const retryAt = addHours(now, cfgForRetry.intervalHours);
  const baseUrl = publicBaseUrlFromEnv(process.env);
  if (!req && !baseUrl) throw new Error('Configura PUBLIC_APP_URL para generar enlaces externos');
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
// Formulario publico: limitar envios por IP para evitar abuso.
const surveySubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { ok: false, error: 'Demasiados intentos. Espere unos minutos e intente de nuevo.' },
});

app.post('/survey/submit', surveySubmitLimiter, asyncHandler(async (req, res) => {
  const ip = detectClientIp(req);
  const token = (req.body?.token || '').toString().trim();
  const fullName = (req.body?.fullName || '').toString().trim();
  const phone = (req.body?.phone || '').toString().trim();
  if (fullName.length < 3 || phone.length < 7) {
    return res.status(400).json({ ok: false, error: 'Nombre y teléfono son obligatorios' });
  }

  // Si se envia token, REQUIERE coincidencia exacta (no fallback a IP)
  // Solo permite IP-only en el flujo captive (sin token) y con exactamente 1 pending para esa IP
  let pending = null;
  if (token) {
    pending = await prisma.surveyResponse.findFirst({
      where: { publicToken: token, status: 'pending' },
    });
    if (!pending) {
      return res.status(401).json({ ok: false, error: 'Token inválido o encuesta no encontrada' });
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
    return res.status(400).json({ ok: false, error: 'IP inválida' });
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
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'id inválido' });
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
    return res.status(400).json({ ok: false, error: 'IP inválida' });
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
        nextReminderAt: addHours(new Date(), SURVEY_REMINDER_DEFAULT_INTERVAL_HOURS),
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
    nextReminderAt: snoozed ? addHours(new Date(), SURVEY_REMINDER_DEFAULT_INTERVAL_HOURS) : null,
    reminderIntervalHours: SURVEY_REMINDER_DEFAULT_INTERVAL_HOURS,
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
  const host = req.body?.host || publicHostFromEnv(process.env);
  if (!host) return res.status(400).json({ error: 'Configura PUBLIC_APP_URL o indique el host del portal' });
  const port = parseInt(req.body?.port || '80');
  const NAT_COMMENT = 'WISP RD - Encuesta forzada (HTTP)';

  // Resolver el dominio a IP
  const resolved = await dns.lookup(host);
  const serverIp = resolved.address;

  const c = await getMtConnection();

  // Buscar regla existente
  const natRules = await mtWrite(c, 9000, '/ip/firewall/nat/print', `?comment=${NAT_COMMENT}`);
  let action;
  if (natRules.length > 0) {
    const rule = natRules[0];
    if (rule['to-addresses'] !== serverIp || rule['to-ports'] !== String(port)) {
      await mtWrite(c, 9000,
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
    const r = await mtWrite(c, 9000,
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

const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS || '60000');
const WISPHUB_SYNC_ENABLED = process.env.WISPHUB_SYNC_ENABLED !== 'false';
const WISPHUB_INVOICE_SYNC_START_DATE = process.env.WISPHUB_INVOICE_SYNC_START_DATE || DEFAULT_INVOICE_START_DATE;
let syncTimer = null;
let lastSyncAt = null;
let lastSyncResult = null;
let syncInProgress = false;

let invoiceHistorySyncStatus = {
  running: false,
  status: 'idle',
  trigger: null,
  startedAt: null,
  endedAt: null,
  from: WISPHUB_INVOICE_SYNC_START_DATE,
  through: null,
  windowsCompleted: 0,
  windowsTotal: 0,
  fetched: 0,
  saved: 0,
  error: null,
};

async function upsertWisphubInvoices(invoices) {
  const list = Array.isArray(invoices) ? invoices : [];
  const referencedClientIds = [...new Set(list
    .map((invoice) => Number(invoice?.articulos?.[0]?.servicio?.id_servicio))
    .filter((id) => Number.isInteger(id) && id > 0))];
  const existingClients = referencedClientIds.length
    ? await prisma.client.findMany({
      where: { idServicio: { in: referencedClientIds } },
      select: { idServicio: true },
    })
    : [];
  const existingClientIds = new Set(existingClients.map((client) => client.idServicio));
  const existingInvoices = await prisma.invoice.findMany({
    select: { idFactura: true, sourceHash: true },
  });
  const existingInvoiceHashes = new Map(existingInvoices.map((invoice) => [invoice.idFactura, invoice.sourceHash]));

  let saved = 0;
  let invalid = 0;
  let created = 0;
  let changed = 0;
  let unchanged = 0;
  for (let start = 0; start < list.length; start += 25) {
    const operations = [];
    for (const invoice of list.slice(start, start + 25)) {
      const data = mapWisphubInvoice(invoice, existingClientIds);
      if (!data) {
        invalid++;
        continue;
      }
      const articles = Array.isArray(invoice.articulos)
        ? invoice.articulos.map((article) => mapWisphubInvoiceArticle(article, data.idFactura))
        : [];
      const sourceHash = sourceStateHash(data, articles);
      if (existingInvoiceHashes.get(data.idFactura) === sourceHash) {
        unchanged++;
        continue;
      }
      if (existingInvoiceHashes.has(data.idFactura)) changed++;
      else created++;
      operations.push(prisma.invoice.upsert({
        where: { idFactura: data.idFactura },
        update: { ...data, sourceHash },
        create: { ...data, sourceHash },
      }));
      if (Array.isArray(invoice.articulos)) {
        operations.push(prisma.invoiceArticle.deleteMany({ where: { idFactura: data.idFactura } }));
        if (articles.length) {
          operations.push(prisma.invoiceArticle.createMany({
            data: articles,
          }));
        }
      }
      existingInvoiceHashes.set(data.idFactura, sourceHash);
      saved++;
    }
    if (operations.length) await prisma.$transaction(operations);
  }
  return { saved, created, changed, unchanged, invalid };
}

async function syncInvoiceDateWindow(from, to, dateField = 'fecha_emision') {
  const invoices = await fetchWisphubInvoices({ apiKey: API_KEY, from, to, dateField });
  const result = await upsertWisphubInvoices(invoices);
  return { fetched: invoices.length, ...result };
}

async function syncRecentInvoices() {
  const today = formatDateOnly(new Date());
  const [issued, paid] = await Promise.all([
    fetchWisphubInvoices({ apiKey: API_KEY, from: today, to: today, dateField: 'fecha_emision' }),
    fetchWisphubInvoices({ apiKey: API_KEY, from: today, to: today, dateField: 'fecha_pago' }),
  ]);
  const invoices = mergeInvoicesById(issued, paid);
  const result = await upsertWisphubInvoices(invoices);
  const syncedAt = new Date().toISOString();
  await prisma.appSetting.upsert({
    where: { key: 'invoices:lastIncrementalSync' },
    update: { value: syncedAt, category: 'sync' },
    create: { key: 'invoices:lastIncrementalSync', value: syncedAt, category: 'sync' },
  });
  return { fetched: issued.length + paid.length, unique: invoices.length, ...result };
}

async function runInvoiceHistorySync({ trigger = 'startup', force = false } = {}) {
  if (invoiceHistorySyncStatus.running) return { busy: true, ...invoiceHistorySyncStatus };

  const today = formatDateOnly(new Date());
  let startDate = WISPHUB_INVOICE_SYNC_START_DATE;
  if (!force) {
    const checkpoint = await prisma.appSetting.findUnique({
      where: { key: 'invoices:historyCompletedThrough' },
    });
    if (checkpoint?.value) {
      const nextDate = new Date(`${checkpoint.value}T00:00:00Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      startDate = formatDateOnly(nextDate);
    }
  }

  const windows = buildInvoiceDateWindows(startDate, today);
  invoiceHistorySyncStatus = {
    running: true,
    status: 'running',
    trigger,
    startedAt: new Date().toISOString(),
    endedAt: null,
    from: startDate,
    through: null,
    windowsCompleted: 0,
    windowsTotal: windows.length,
    fetched: 0,
    saved: 0,
    error: null,
  };

  const log = await prisma.syncLog.create({
    data: { entity: 'invoice-history', status: 'running', startedAt: new Date() },
  }).catch(() => null);

  try {
    for (const window of windows) {
      const result = await syncInvoiceDateWindow(window.from, window.to, 'fecha_emision');
      invoiceHistorySyncStatus.fetched += result.fetched;
      invoiceHistorySyncStatus.saved += result.saved;
      invoiceHistorySyncStatus.windowsCompleted++;
      invoiceHistorySyncStatus.through = window.to;
      await prisma.appSetting.upsert({
        where: { key: 'invoices:historyCompletedThrough' },
        update: { value: window.to, category: 'sync' },
        create: { key: 'invoices:historyCompletedThrough', value: window.to, category: 'sync' },
      });
    }

    invoiceHistorySyncStatus.running = false;
    invoiceHistorySyncStatus.status = 'success';
    invoiceHistorySyncStatus.endedAt = new Date().toISOString();
    if (log) {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: 'success',
          endedAt: new Date(),
          recordCount: invoiceHistorySyncStatus.saved,
          durationMs: Date.now() - new Date(invoiceHistorySyncStatus.startedAt).getTime(),
        },
      }).catch(() => {});
    }
    console.log('[invoice-sync] history complete', JSON.stringify(invoiceHistorySyncStatus));
    return invoiceHistorySyncStatus;
  } catch (error) {
    invoiceHistorySyncStatus.running = false;
    invoiceHistorySyncStatus.status = 'error';
    invoiceHistorySyncStatus.error = error.message;
    invoiceHistorySyncStatus.endedAt = new Date().toISOString();
    if (log) {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: { status: 'error', endedAt: new Date(), errorMessage: error.message },
      }).catch(() => {});
    }
    throw error;
  }
}

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
    if (!page || !Array.isArray(page.results)) throw new Error('WispHub devolvio una pagina de clientes invalida');
    all = all.concat(page.results);
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

  let wpCount = 0, mtCount = 0, updated = 0, created = 0, unchanged = 0, errors = 0, missingFromWisphub = 0;
  let invoiceCount = 0;
  let invoiceStatus = 'pending';
  let wisphubStatus = 'pending';
  let mikrotikStatus = MT_HOST ? 'pending' : 'not_configured';
  let ipamChanges = null;
  const sourceErrors = [];
  try {
    if (!API_KEY) throw new Error('WISPHUB_API_KEY no esta configurada');
    const wpClients = await fetchWisphubAllClients();
    wisphubStatus = 'ok';
    wpCount = wpClients.length;
    const existingClientCount = await prisma.client.count();
    if (existingClientCount > 0 && wpCount === 0) {
      throw new Error('WispHub devolvio cero clientes; sincronizacion cancelada para proteger los datos locales');
    }

    let queues = [];
    let arp = [];
    let mikrotikAvailable = false;
    if (MT_HOST) {
      try {
        const c = await getMtConnection();
        [queues, arp] = await Promise.all([
          mtCached('clients-live:queues', 5000, () => mtWrite(c, 15000, '/queue/simple/print', '=stats=')),
          mtCached('clients-live:arp', 5000, () => mtWrite(c, 10000, '/ip/arp/print')),
        ]);
        queues = queues.filter((q) => q.disabled !== 'true' && q.disabled !== true);
        mtCount = queues.length;
        mikrotikAvailable = true;
        mikrotikStatus = 'ok';
      } catch (e) {
        mikrotikStatus = 'error';
        sourceErrors.push(`MikroTik: ${e.message}`);
        console.error('[sync] mikrotik error:', e.message);
      }
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

    const existingClients = await prisma.client.findMany({
      select: { idServicio: true, sourceHash: true },
    });
    const clientHashes = new Map(existingClients.map((client) => [client.idServicio, client.sourceHash]));

    for (const cl of wpClients) {
      try {
        const idServicio = Number(cl.id_servicio);
        if (!Number.isInteger(idServicio) || idServicio <= 0) throw new Error('id_servicio invalido');
        const ip = cl.ip || cl.ip_local || null;
        const queue = ip ? queueByIp.get(ip) : null;
        const arpEntry = ip ? arpByIp.get(ip) : null;
        const network = { queue, arpEntry, mikrotikAvailable };
        const createData = mapWisphubClient(cl, network, { forCreate: true });
        const updateData = mapWisphubClient(cl, network);
        const sourceHash = sourceStateHash(createData);
        if (clientHashes.get(idServicio) === sourceHash) {
          unchanged++;
          continue;
        }
        if (clientHashes.has(idServicio)) {
          await prisma.client.update({ where: { idServicio }, data: { ...updateData, sourceHash } });
          updated++;
        } else {
          await prisma.client.create({ data: { ...createData, sourceHash } });
          created++;
        }
        clientHashes.set(idServicio, sourceHash);
      } catch (e) {
        errors++;
        console.error(`[sync] client ${cl.id_servicio || 'unknown'}:`, e.message);
      }
    }

    const wisphubIds = new Set(wpClients.map((client) => client.id_servicio));
    const localIds = await prisma.client.findMany({ select: { idServicio: true } });
    missingFromWisphub = localIds.filter((client) => !wisphubIds.has(client.idServicio)).length;

    if (mikrotikAvailable) {
      try {
        const ipamReport = await fetchLiveIpamReport({ arp });
        ipamChanges = ipamReport.persistence;
        mtInvalidate('ipam');
      } catch (error) {
        console.error('[sync] IPAM persistence error:', error.message);
      }
    }

    try {
      const invoiceResult = await syncRecentInvoices();
      invoiceCount = invoiceResult.saved;
      invoiceStatus = 'ok';
    } catch (error) {
      invoiceStatus = 'error';
      sourceErrors.push(`Facturas WispHub: ${error.message}`);
      console.error('[sync] invoice error:', error.message);
    }

    if (log) {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: errors || sourceErrors.length ? 'partial' : 'success',
          endedAt: new Date(),
          recordCount: updated + created,
          durationMs: Date.now() - startedAt.getTime(),
          errorMessage: sourceErrors.length ? sourceErrors.join(' | ') : null,
        },
      }).catch(() => {});
    }
  } catch (e) {
    wisphubStatus = 'error';
    sourceErrors.push(`WispHub: ${e.message}`);
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
    invoices: invoiceCount,
    mikrotik: mtCount,
    updated,
    created,
    unchanged,
    errors,
    missingFromWisphub,
    ipamChanges,
    status: wisphubStatus === 'error' ? 'error' : errors || sourceErrors.length ? 'partial' : 'success',
    sources: { wisphub: wisphubStatus, invoices: invoiceStatus, mikrotik: mikrotikStatus },
    sourceErrors,
  };
  console.log('[sync]', JSON.stringify(lastSyncResult));
  return lastSyncResult;
}

async function runSyncSafely(trigger) {
  if (syncInProgress) return { busy: true, trigger, lastSyncResult };
  syncInProgress = true;
  try {
    return await syncOnce();
  } finally {
    syncInProgress = false;
  }
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
  const result = await runSyncSafely('manual');
  if (result.busy) return res.status(409).json({ error: 'Ya hay una sincronización en curso', ...result });
  res.json(result);
}));
app.use('/sync', syncRouter);

function startSyncLoop() {
  if (syncTimer) return;
  console.log(`[sync] starting loop. interval=${SYNC_INTERVAL_MS}ms`);
  const safeSync = async () => {
    try {
      const result = await runSyncSafely('scheduled');
      if (result.busy) console.warn('[sync] tick skipped: previous run still in progress');
    } catch (e) {
      console.error('[sync] tick error:', e.message);
    }
  };
  safeSync().finally(() => {
    void runInvoiceHistorySync({ trigger: 'startup', force: false }).catch((error) => {
      console.error('[invoice-sync] startup history sync failed:', error.message);
    });
  });
  syncTimer = setInterval(safeSync, SYNC_INTERVAL_MS);
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
  if (!jid) return { ok: false, error: 'Teléfono inválido', code: 'BAD_PHONE' };
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

// El QR vincula la cuenta de WhatsApp del negocio: se dibuja aqui como SVG en vez de
// enviarlo a un generador externo (antes se usaba api.qrserver.com desde el navegador).
function renderQrSvgDataUrl(text) {
  const QRCode = require('qrcode-terminal/vendor/QRCode');
  const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const margin = 4;
  const size = count + margin * 2;
  let path = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) path += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`
    + `<rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${path}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

waRouter.get('/status', (req, res) => {
  let qrImage = null;
  if (waQR) {
    try { qrImage = renderQrSvgDataUrl(waQR); } catch (e) { console.error('[wa] no se pudo dibujar el QR:', e.message); }
  }
  res.json({ status: waStatus, qr: waQR, qrImage });
});

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
  if (!client.telefono) return res.status(400).json({ error: 'Cliente sin teléfono' });

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
waRouter.post('/disconnect', requireRole(['admin']), async (req, res) => {
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

waRouter.post('/connect', requireRole(['admin']), async (req, res) => {
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

waRouter.post('/bot/toggle', requireRole(['admin']), asyncHandler(async (req, res) => {
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
  const configuredHost = publicHostFromEnv(process.env).toLowerCase();
  if (configuredHost) defaults.push(configuredHost);
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
templatesRouter.patch('/:name', requireRole(['admin']), asyncHandler(async (req, res) => {
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
templatesRouter.post('/:name/reset', requireRole(['admin']), asyncHandler(async (req, res) => {
  const def = DEFAULT_TEMPLATES[req.params.name];
  if (!def) return res.status(404).json({ error: 'No hay default para este template' });
  const updated = await prisma.whatsappTemplate.update({
    where: { name: req.params.name },
    data: { content: def.content, category: def.category, variables: def.variables },
  });
  res.json(updated);
}));

// Crear template custom (no-default)
templatesRouter.post('/', requireRole(['admin']), asyncHandler(async (req, res) => {
  const { name, content, category, variables } = req.body || {};
  if (!name || !content) return res.status(400).json({ error: 'name y content requeridos' });
  const created = await prisma.whatsappTemplate.create({
    data: { name, content, category: category || 'custom', variables: variables || '', isDefault: false },
  }).catch((e) => ({ error: e.message }));
  if (created.error) return res.status(400).json({ error: created.error });
  res.status(201).json(created);
}));

// Eliminar template (no-default solamente)
templatesRouter.delete('/:name', requireRole(['admin']), asyncHandler(async (req, res) => {
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

// ═══════════════════════════════════════════════════════════════
// INVENTARIO + GASTOS + NOMINA (CRUD)
// ═══════════════════════════════════════════════════════════════

// Helper para sumar items de compra
function sumPurchaseItems(items) {
  return (items || []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
}

// Validar que un valor numerico sea finito (no NaN, no Infinity, no negativo donde no aplica)
function ensureNumber(v, { min = -Infinity, max = Infinity, label = 'value' } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    const err = new Error(`${label} debe ser un numero entre ${min} y ${max}`);
    err.status = 400;
    throw err;
  }
  return n;
}

const ALLOWED_UNITS = ['u', 'm', 'kg', 'caja', 'rollo'];
const ALLOWED_EQUIP_CATEGORIES = ['wifi', 'cable', 'onu', 'antena', 'otro'];
const ALLOWED_EXPENSE_CATEGORIES = ['inventario', 'nomina', 'servicios', 'transporte', 'otros'];
const ALLOWED_PAYROLL_STATUS = ['pending', 'paid', 'cancelled'];
const ALLOWED_EQUIP_STATUS = ['stock', 'assigned', 'rma', 'lost', 'retired'];

// ─── EquipmentType ───
const equipTypeRouter = express.Router();
equipTypeRouter.use(authMiddleware);

equipTypeRouter.get('/', asyncHandler(async (req, res) => {
  const types = await prisma.equipmentType.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { equipment: true } } },
  });
  res.json(types);
}));

equipTypeRouter.post('/', requireRole(['admin']), asyncHandler(async (req, res) => {
  const { name, category, unit, description } = req.body || {};
  if (!name || !category) return res.status(400).json({ error: 'name y category son requeridos' });
  if (!ALLOWED_EQUIP_CATEGORIES.includes(category)) return res.status(400).json({ error: `category invalida (permitidas: ${ALLOWED_EQUIP_CATEGORIES.join(', ')})` });
  if (unit && !ALLOWED_UNITS.includes(unit)) return res.status(400).json({ error: `unit invalida (permitidas: ${ALLOWED_UNITS.join(', ')})` });
  const created = await prisma.equipmentType.create({
    data: { name: String(name).trim(), category: String(category).trim(), unit: unit || 'u', description: description || null },
  });
  await logActivity(req, { action: 'create_equipment_type', entityType: 'equipmentType', entityId: String(created.id), entityName: created.name });
  res.json(created);
}));

equipTypeRouter.put('/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, category, unit, description } = req.body || {};
  if (category !== undefined && !ALLOWED_EQUIP_CATEGORIES.includes(category)) return res.status(400).json({ error: 'category inválida' });
  if (unit !== undefined && !ALLOWED_UNITS.includes(unit)) return res.status(400).json({ error: 'unit inválida' });
  const updated = await prisma.equipmentType.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: String(name).trim() }),
      ...(category !== undefined && { category: String(category).trim() }),
      ...(unit !== undefined && { unit }),
      ...(description !== undefined && { description }),
    },
  });
  res.json(updated);
}));

equipTypeRouter.delete('/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  await prisma.equipmentType.delete({ where: { id } });
  res.json({ ok: true });
}));

app.use('/inventory/types', equipTypeRouter);

// ─── Purchase + auto-generated Expense + auto-generated Equipment rows ───
const purchaseRouter = express.Router();
purchaseRouter.use(authMiddleware);

purchaseRouter.get('/', asyncHandler(async (req, res) => {
  const purchases = await prisma.purchase.findMany({
    orderBy: { purchasedAt: 'desc' },
    include: {
      items: { include: { type: true } },
      _count: { select: { equipment: true } },
    },
    take: Math.min(parseInt(req.query.limit) || 100, 500),
  });
  res.json(purchases);
}));

purchaseRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      items: { include: { type: true } },
      equipment: { include: { type: true, client: { select: { idServicio: true, nombre: true } } } },
    },
  });
  if (!purchase) return res.status(404).json({ error: 'not found' });
  res.json(purchase);
}));

purchaseRouter.post('/', requireRole(['admin']), asyncHandler(async (req, res) => {
  const { supplier, invoiceRef, purchasedAt, notes, items = [], createEquipment = true } = req.body || {};
  if (!purchasedAt) return res.status(400).json({ error: 'purchasedAt es requerido' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items es requerido' });

  const total = sumPurchaseItems(items);
  const username = req.session?.username || null;

  const result = await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        supplier: supplier || null,
        invoiceRef: invoiceRef || null,
        purchasedAt: new Date(purchasedAt),
        notes: notes || null,
        total,
        createdBy: username,
        items: {
          create: items.map((it) => ({
            typeId: parseInt(it.typeId),
            quantity: Number(it.quantity) || 1,
            unitPrice: Number(it.unitPrice) || 0,
            subtotal: (Number(it.quantity) || 1) * (Number(it.unitPrice) || 0),
            notes: it.notes || null,
          })),
        },
      },
      include: { items: { include: { type: true } } },
    });

    // Auto-crear Equipment por unidad (solo para items unitarios, no metros/kg)
    if (createEquipment) {
      for (const item of items) {
        const type = await tx.equipmentType.findUnique({ where: { id: parseInt(item.typeId) } });
        if (!type) continue;
        // Solo crear unidades rastreables para tipos unitarios (unit='u'). Cables (m) NO se traquean por unidad.
        if (type.unit !== 'u') continue;
        const qty = Math.floor(Number(item.quantity) || 0);
        const serials = Array.isArray(item.serials) ? item.serials : [];
        for (let i = 0; i < qty; i++) {
          await tx.equipment.create({
            data: {
              typeId: type.id,
              serialNumber: serials[i] || null,
              brand: item.brand || null,
              model: item.model || null,
              unitCost: Number(item.unitPrice) || 0,
              purchaseId: purchase.id,
              status: 'stock',
            },
          });
        }
      }
    }

    // Auto-crear Expense ligado
    await tx.expense.create({
      data: {
        category: 'inventario',
        description: `Compra ${invoiceRef || ''} ${supplier ? `- ${supplier}` : ''}`.trim() || 'Compra de inventario',
        amount: total,
        expenseDate: new Date(purchasedAt),
        purchaseId: purchase.id,
        createdBy: username,
      },
    });

    return purchase;
  });

  await logActivity(req, { action: 'create_purchase', entityType: 'purchase', entityId: String(result.id), entityName: supplier || invoiceRef || `#${result.id}`, details: { total, items: items.length } });
  res.json(result);
}));

purchaseRouter.delete('/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  await prisma.$transaction(async (tx) => {
    await tx.expense.deleteMany({ where: { purchaseId: id } });
    await tx.equipment.updateMany({ where: { purchaseId: id }, data: { purchaseId: null } });
    await tx.purchase.delete({ where: { id } });
  });
  res.json({ ok: true });
}));

app.use('/inventory/purchases', purchaseRouter);

// ─── Equipment (CRUD individual + asignación a cliente) ───
const equipmentRouter = express.Router();
equipmentRouter.use(authMiddleware);
const equipmentService = require('./lib/equipment-service');
function equipmentWebData(body, partial = false) {
  const keys = partial ? ['serialNumber', 'macAddress', 'brand', 'model', 'unitCost', 'notes', 'status'] : ['typeId', 'serialNumber', 'macAddress', 'brand', 'model', 'unitCost', 'notes'];
  const input = Object.fromEntries(keys.filter(k => body?.[k] !== undefined).map(k => [k, k === 'typeId' ? Number(body[k]) : body[k]]));
  return equipmentService.validateEquipment(input, partial);
}

equipmentRouter.get('/', asyncHandler(async (req, res) => {
  const { status, typeId, clientId, q } = req.query;
  const where = {};
  if (status) where.status = status;
  if (typeId) where.typeId = parseInt(typeId);
  if (clientId) where.assignedToClientId = parseInt(clientId);
  if (q) {
    where.OR = [
      { serialNumber: { contains: q } },
      { macAddress: { contains: q } },
      { brand: { contains: q } },
      { model: { contains: q } },
    ];
  }
  const equipment = await prisma.equipment.findMany({
    where,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      type: true,
      client: { select: { idServicio: true, nombre: true, telefono: true } },
    },
    take: Math.min(parseInt(req.query.limit) || 200, 1000),
  });
  res.json(equipment);
}));

equipmentRouter.get('/stats', asyncHandler(async (req, res) => {
  const [total, byStatus, byType, totalCost] = await Promise.all([
    prisma.equipment.count(),
    prisma.equipment.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.equipment.groupBy({ by: ['typeId'], _count: { _all: true } }),
    prisma.equipment.aggregate({ _sum: { unitCost: true } }),
  ]);
  res.json({
    total,
    byStatus: byStatus.reduce((a, b) => ({ ...a, [b.status]: b._count._all }), {}),
    byType,
    totalCostInStock: totalCost._sum.unitCost || 0,
  });
}));

equipmentRouter.post('/', requireRole(['admin']), asyncHandler(async (req, res) => {
  const created = await prisma.$transaction(tx => equipmentService.changeEquipment(tx, { operation: 'create', data: equipmentWebData(req.body), actor: req.session?.username }));
  res.json(created);
}));

equipmentRouter.put('/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = require('./lib/mobile-api').positiveId(req.params.id);
  const updated = await prisma.$transaction(tx => equipmentService.changeEquipment(tx, { id, operation: 'update', data: equipmentWebData(req.body, true), actor: req.session?.username }));
  res.json(updated);
}));

equipmentRouter.post('/:id/assign', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = require('./lib/mobile-api').positiveId(req.params.id);
  const data = equipmentService.validateAssignment({ clientId: Number(req.body?.clientId), notes: req.body?.notes ?? null });
  const updated = await prisma.$transaction(tx => equipmentService.changeEquipment(tx, { id, operation: 'assign', data, actor: req.session?.username }));
  res.json(updated);
}));

equipmentRouter.post('/:id/unassign', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = require('./lib/mobile-api').positiveId(req.params.id);
  const updated = await prisma.$transaction(tx => equipmentService.changeEquipment(tx, { id, operation: 'return', actor: req.session?.username }));
  res.json(updated);
}));

equipmentRouter.delete('/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = require('./lib/mobile-api').positiveId(req.params.id);
  await prisma.$transaction(tx => equipmentService.changeEquipment(tx, { id, operation: 'delete', actor: req.session?.username }));
  res.json({ ok: true });
}));

app.use('/inventory/equipment', equipmentRouter);

// Equipos de un cliente especifico (atajo)
app.get('/clients/:idServicio/equipment', authMiddleware, asyncHandler(async (req, res) => {
  const idServicio = parseInt(req.params.idServicio);
  const items = await prisma.equipment.findMany({
    where: { assignedToClientId: idServicio },
    include: { type: true },
    orderBy: { assignedAt: 'desc' },
  });
  res.json(items);
}));

// ─── Expenses ───
const expensesRouter = express.Router();
expensesRouter.use(authMiddleware);
const expenseService = require('./lib/expense-service');

expensesRouter.get('/', asyncHandler(async (req, res) => {
  const { category, from, to, clientId } = req.query;
  const where = {};
  if (category) where.category = category;
  if (clientId) where.clientIdServicio = parseInt(clientId);
  if (from || to) {
    where.expenseDate = {};
    if (from) where.expenseDate.gte = new Date(from);
    if (to) where.expenseDate.lte = new Date(to);
  }
  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { expenseDate: 'desc' },
    include: {
      purchase: { select: { id: true, supplier: true, invoiceRef: true } },
      payroll: { select: { id: true, period: true, employee: { select: { fullName: true } } } },
      client: { select: { idServicio: true, nombre: true } },
    },
    take: Math.min(parseInt(req.query.limit) || 200, 1000),
  });
  res.json(expenses);
}));

expensesRouter.get('/stats', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const where = {};
  if (from || to) {
    where.expenseDate = {};
    if (from) where.expenseDate.gte = new Date(from);
    if (to) where.expenseDate.lte = new Date(to);
  }
  const [total, byCategory] = await Promise.all([
    prisma.expense.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
    prisma.expense.groupBy({ where, by: ['category'], _sum: { amount: true }, _count: { _all: true } }),
  ]);
  // byMonth: agregamos en memoria para evitar SQL raw acoplado al dialecto
  const recent = await prisma.expense.findMany({
    where,
    select: { amount: true, expenseDate: true },
    orderBy: { expenseDate: 'desc' },
    take: 5000,
  });
  const monthMap = new Map();
  for (const e of recent) {
    const k = e.expenseDate.toISOString().slice(0, 7);
    const cur = monthMap.get(k) || { month: k, total: 0, count: 0 };
    cur.total += e.amount;
    cur.count += 1;
    monthMap.set(k, cur);
  }
  const byMonth = Array.from(monthMap.values()).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12);
  res.json({
    total: total._sum.amount || 0,
    count: total._count._all,
    byCategory,
    byMonth,
  });
}));

expensesRouter.post('/', requireRole(['admin']), asyncHandler(async (req, res) => {
  const data = expenseService.validateExpense(req.body);
  const created = await prisma.$transaction(tx => expenseService.changeExpense(tx, { data, actor: req.session?.username || null }));
  res.json(created);
}));

expensesRouter.put('/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = require('./lib/mobile-api').positiveId(req.params.id);
  const data = expenseService.validateExpense(req.body, true);
  const updated = await prisma.$transaction(tx => expenseService.changeExpense(tx, { id, data, actor: req.session?.username || null }));
  res.json(updated);
}));

expensesRouter.delete('/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = require('./lib/mobile-api').positiveId(req.params.id);
  await prisma.$transaction(tx => expenseService.changeExpense(tx, { id, remove: true, actor: req.session?.username || null }));
  res.json({ ok: true });
}));

app.use('/expenses', expensesRouter);

// ─── Employees + Payroll ───
const employeesRouter = express.Router();
employeesRouter.use(authMiddleware);

employeesRouter.get('/', asyncHandler(async (req, res) => {
  const employees = await prisma.employee.findMany({
    orderBy: [{ active: 'desc' }, { fullName: 'asc' }],
    include: { _count: { select: { payroll: true } } },
  });
  res.json(employees);
}));

employeesRouter.post('/', requireRole(['admin']), asyncHandler(async (req, res) => {
  const { fullName, documentId, position, email, phone, baseSalary, hiredAt, notes } = req.body || {};
  if (!fullName) return res.status(400).json({ error: 'fullName es requerido' });
  const created = await prisma.employee.create({
    data: {
      fullName: String(fullName).trim(),
      documentId: documentId || null,
      position: position || null,
      email: email || null,
      phone: phone || null,
      baseSalary: Number(baseSalary) || 0,
      hiredAt: hiredAt ? new Date(hiredAt) : null,
      notes: notes || null,
    },
  });
  await logActivity(req, { action: 'create_employee', entityType: 'employee', entityId: String(created.id), entityName: fullName });
  res.json(created);
}));

employeesRouter.put('/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const body = req.body || {};
  const data = {};
  for (const k of ['fullName', 'documentId', 'position', 'email', 'phone', 'notes']) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  if (body.baseSalary !== undefined) data.baseSalary = Number(body.baseSalary);
  if (body.hiredAt !== undefined) data.hiredAt = body.hiredAt ? new Date(body.hiredAt) : null;
  if (body.terminatedAt !== undefined) data.terminatedAt = body.terminatedAt ? new Date(body.terminatedAt) : null;
  if (body.active !== undefined) data.active = !!body.active;
  const updated = await prisma.employee.update({ where: { id }, data });
  res.json(updated);
}));

employeesRouter.delete('/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  // No borrar empleado con nomina historica -- desactivar
  const count = await prisma.payrollEntry.count({ where: { employeeId: id } });
  if (count > 0) {
    await prisma.employee.update({ where: { id }, data: { active: false, terminatedAt: new Date() } });
    return res.json({ ok: true, deactivated: true });
  }
  await prisma.employee.delete({ where: { id } });
  res.json({ ok: true });
}));

app.use('/employees', employeesRouter);

const payrollRouter = express.Router();
payrollRouter.use(authMiddleware);

payrollRouter.get('/', asyncHandler(async (req, res) => {
  const { employeeId, period, status } = req.query;
  const where = {};
  if (employeeId) where.employeeId = parseInt(employeeId);
  if (period) where.period = period;
  if (status) where.status = status;
  const entries = await prisma.payrollEntry.findMany({
    where,
    orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
    include: { employee: { select: { id: true, fullName: true, position: true } } },
    take: Math.min(parseInt(req.query.limit) || 200, 1000),
  });
  res.json(entries);
}));

payrollRouter.get('/stats', asyncHandler(async (req, res) => {
  const [total, byStatus, lastMonths] = await Promise.all([
    prisma.payrollEntry.aggregate({ _sum: { netAmount: true }, _count: { _all: true } }),
    prisma.payrollEntry.groupBy({ by: ['status'], _sum: { netAmount: true }, _count: { _all: true } }),
    prisma.payrollEntry.groupBy({ by: ['period'], _sum: { netAmount: true }, orderBy: { period: 'desc' }, take: 12 }),
  ]);
  res.json({ totalPaid: total._sum.netAmount || 0, totalCount: total._count._all, byStatus, lastMonths });
}));

payrollRouter.post('/', requireRole(['admin']), asyncHandler(async (req, res) => {
  const { employeeId, period, periodStart, periodEnd, baseAmount, bonus = 0, deductions = 0, paidAt, paymentMethod, status = 'pending', notes } = req.body || {};
  if (!employeeId || !period || !periodStart || !periodEnd) {
    return res.status(400).json({ error: 'employeeId, period, periodStart, periodEnd son requeridos' });
  }
  if (!ALLOWED_PAYROLL_STATUS.includes(status)) {
    return res.status(400).json({ error: `status invalido (permitidos: ${ALLOWED_PAYROLL_STATUS.join(', ')})` });
  }
  const safeBase = ensureNumber(baseAmount, { min: 0, max: 1e9, label: 'baseAmount' });
  const safeBonus = ensureNumber(bonus, { min: 0, max: 1e9, label: 'bonus' });
  const safeDeductions = ensureNumber(deductions, { min: 0, max: 1e9, label: 'deductions' });
  const net = safeBase + safeBonus - safeDeductions;
  const username = req.session?.username || null;

  const result = await prisma.$transaction(async (tx) => {
    const entry = await tx.payrollEntry.create({
      data: {
        employeeId: parseInt(employeeId),
        period,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        baseAmount: safeBase,
        bonus: safeBonus,
        deductions: safeDeductions,
        netAmount: net,
        paidAt: paidAt ? new Date(paidAt) : null,
        paymentMethod: paymentMethod || null,
        status,
        notes: notes || null,
        createdBy: username,
      },
      include: { employee: true },
    });

    // Si ya esta pagado, generar Expense
    if (status === 'paid' && paidAt) {
      await tx.expense.create({
        data: {
          category: 'nomina',
          description: `Nomina ${entry.employee.fullName} - ${period}`,
          amount: net,
          expenseDate: new Date(paidAt),
          payrollId: entry.id,
          paymentMethod: paymentMethod || null,
          createdBy: username,
        },
      });
    }
    return entry;
  });

  await logActivity(req, { action: 'create_payroll', entityType: 'payroll', entityId: String(result.id), entityName: `${result.employee.fullName} ${period}`, details: { net } });
  res.json(result);
}));

payrollRouter.post('/:id/pay', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const { paymentMethod, paidAt } = req.body || {};
  const username = req.session?.username || null;
  const result = await prisma.$transaction(async (tx) => {
    const entry = await tx.payrollEntry.update({
      where: { id },
      data: { status: 'paid', paidAt: paidAt ? new Date(paidAt) : new Date(), paymentMethod: paymentMethod || null },
      include: { employee: true },
    });
    // crear expense si no existe ya
    const existing = await tx.expense.findFirst({ where: { payrollId: id } });
    if (!existing) {
      await tx.expense.create({
        data: {
          category: 'nomina',
          description: `Nomina ${entry.employee.fullName} - ${entry.period}`,
          amount: entry.netAmount,
          expenseDate: entry.paidAt || new Date(),
          payrollId: entry.id,
          paymentMethod: paymentMethod || null,
          createdBy: username,
        },
      });
    }
    return entry;
  });
  res.json(result);
}));

payrollRouter.delete('/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  await prisma.$transaction(async (tx) => {
    await tx.expense.deleteMany({ where: { payrollId: id } });
    await tx.payrollEntry.delete({ where: { id } });
  });
  res.json({ ok: true });
}));

app.use('/payroll', payrollRouter);

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
  // Los errores de Prisma incluyen rutas y consultas internas: no se muestran al operador.
  const isDatabaseError = /^Prisma/.test(err?.name || '') || /prisma\.\w+\.\w+\(/.test(err?.message || '');
  res.status(err.status || err.statusCode || 500).json({
    error: isDatabaseError
      ? 'Error interno al consultar la base de datos. Intente de nuevo o contacte al administrador.'
      : (err.message || 'Internal server error'),
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
    const rules = await mtWrite(c, 9000, '/system/logging/print');
    const dnsMemRule = rules.find((r) => r.topics === 'dns' && r.action === 'memory');
    if (dnsMemRule && dnsMemRule.disabled === 'true') {
      await mtWrite(c, 9000, '/system/logging/set', `=.id=${dnsMemRule['.id']}`, '=disabled=no');
      console.log('[web-activity] DNS logging enabled on MikroTik');
    } else if (!dnsMemRule) {
      await mtWrite(c, 9000, '/system/logging/add', '=topics=dns', '=action=memory');
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
    const entries = await mtWrite(c, 15000, '/log/print', '?topics~dns');

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
      const queues = await mtWrite(c, 15000, '/queue/simple/print');
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
notifRouter.post('/run', requireRole(['admin']), asyncHandler(async (req, res) => {
  const result = await runNotifCheck();
  res.json(result);
}));

// ─── AUTO-DETECT IP PUBLICA + UPDATE NAT/FILTER EN MIKROTIK ───
// Cuando corre en Railway, la IP de salida puede cambiar. Al boot detecta su IP
// publica y reescribe las reglas NAT del MikroTik para que el captive funcione.
async function runSurveyReminderCheck() {
  if (!SURVEY_REMINDERS_ENABLED) {
    lastSurveyReminderRun = {
      ran: false,
      disabled: true,
      reason: 'SURVEY_REMINDERS_ENABLED=false',
      startedAt: new Date().toISOString(),
    };
    return lastSurveyReminderRun;
  }
  const startedAt = new Date();
  const cfg = await getSurveyConfig();

  // Pausa global: no procesar nada (igual loguea)
  if (cfg.pausedGlobally) {
    lastSurveyReminderRun = {
      ran: true, startedAt: startedAt.toISOString(), durationMs: 0,
      total: 0, sent: 0, skipped: 0, errors: 0, paused: true,
    };
    return lastSurveyReminderRun;
  }

  // Filtros en SQL: nextReminderAt vencida, no pausada, y por debajo del max.
  const due = await prisma.surveyResponse.findMany({
    where: {
      status: 'pending',
      paused: false,
      nextReminderAt: { lte: startedAt },
      reminderCount: { lt: cfg.maxReminders },
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
    config: { intervalHours: cfg.intervalHours, maxReminders: cfg.maxReminders },
    ...stats,
  };
  if (stats.total > 0) {
    console.log(`[survey-reminder] tick: sent=${stats.sent} skipped=${stats.skipped} errors=${stats.errors} (cfg interval=${cfg.intervalHours}h max=${cfg.maxReminders})`);
  }
  return lastSurveyReminderRun;
}

function startSurveyReminderLoop() {
  if (!SURVEY_REMINDERS_ENABLED) {
    console.log('[survey-reminder] disabled by SURVEY_REMINDERS_ENABLED=false');
    return;
  }
  if (surveyReminderTimer) return;
  console.log(`[survey-reminder] enabled. interval=${SURVEY_REMINDER_DEFAULT_INTERVAL_HOURS}h poll=${SURVEY_REMINDER_POLL_MS}ms`);
  surveyReminderTimer = setInterval(() => {
    runSurveyReminderCheck().catch((e) => console.error('[survey-reminder] error:', e.message));
  }, SURVEY_REMINDER_POLL_MS);
}

surveyRouter.get('/reminders/status', asyncHandler(async (req, res) => {
  const cfg = await getSurveyConfig();
  res.json({
    ok: true,
    enabled: SURVEY_REMINDERS_ENABLED,
    intervalHours: cfg.intervalHours,
    maxReminders: cfg.maxReminders,
    pausedGlobally: cfg.pausedGlobally,
    minIntervalHours: SURVEY_REMINDER_MIN_INTERVAL_HOURS,
    pollMs: SURVEY_REMINDER_POLL_MS,
    whatsapp: waStatus,
    lastRun: lastSurveyReminderRun,
  });
}));

// PUT config (intervalo en horas, max envios)
surveyRouter.put('/reminders/config', requireRole(['admin']), asyncHandler(async (req, res) => {
  const { intervalHours, maxReminders } = req.body || {};
  const updates = [];
  if (intervalHours !== undefined) {
    const h = parseInt(intervalHours);
    if (!Number.isFinite(h) || h < SURVEY_REMINDER_MIN_INTERVAL_HOURS) {
      return res.status(400).json({ error: `intervalHours minimo es ${SURVEY_REMINDER_MIN_INTERVAL_HOURS} (1 semana)` });
    }
    updates.push(prisma.appSetting.upsert({
      where: { key: 'survey_reminder_interval_hours' },
      update: { value: String(h), category: 'survey' },
      create: { key: 'survey_reminder_interval_hours', value: String(h), category: 'survey' },
    }));
  }
  if (maxReminders !== undefined) {
    const m = parseInt(maxReminders);
    if (!Number.isFinite(m) || m < 1 || m > 10) {
      return res.status(400).json({ error: 'maxReminders entre 1 y 10' });
    }
    updates.push(prisma.appSetting.upsert({
      where: { key: 'survey_reminder_max' },
      update: { value: String(m), category: 'survey' },
      create: { key: 'survey_reminder_max', value: String(m), category: 'survey' },
    }));
  }
  await Promise.all(updates);
  invalidateSurveyConfig();
  const cfg = await getSurveyConfig();
  await logActivity(req, { action: 'update_survey_config', entityType: 'setting', entityName: 'survey_reminder', details: cfg });
  res.json({ ok: true, ...cfg });
}));

// Pausa / reanudar GLOBAL
surveyRouter.post('/reminders/pause-all', requireRole(['admin']), asyncHandler(async (req, res) => {
  await prisma.appSetting.upsert({
    where: { key: 'survey_reminder_paused' },
    update: { value: 'true', category: 'survey' },
    create: { key: 'survey_reminder_paused', value: 'true', category: 'survey' },
  });
  invalidateSurveyConfig();
  await logActivity(req, { action: 'pause_survey_reminders_global', entityType: 'setting' });
  res.json({ ok: true, pausedGlobally: true });
}));

surveyRouter.post('/reminders/resume-all', requireRole(['admin']), asyncHandler(async (req, res) => {
  await prisma.appSetting.upsert({
    where: { key: 'survey_reminder_paused' },
    update: { value: 'false', category: 'survey' },
    create: { key: 'survey_reminder_paused', value: 'false', category: 'survey' },
  });
  invalidateSurveyConfig();
  await logActivity(req, { action: 'resume_survey_reminders_global', entityType: 'setting' });
  res.json({ ok: true, pausedGlobally: false });
}));

// Pausa / reanudar por survey individual
surveyRouter.post('/:id/pause', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const updated = await prisma.surveyResponse.update({
    where: { id },
    data: { paused: true, pausedAt: new Date(), pausedBy: req.session?.username || null, nextReminderAt: null },
  });
  await logActivity(req, { action: 'pause_survey', entityType: 'survey', entityId: String(id) });
  res.json({ ok: true, id: updated.id, paused: true });
}));

surveyRouter.post('/:id/resume', requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const cfg = await getSurveyConfig();
  // Re-schedular el proximo reminder respetando el intervalo desde el ultimo envio (o ahora si nunca se mando).
  const survey = await prisma.surveyResponse.findUnique({ where: { id } });
  if (!survey) return res.status(404).json({ error: 'not found' });
  const base = survey.lastReminderAt || new Date();
  const nextAt = addHours(base, cfg.intervalHours);
  const updated = await prisma.surveyResponse.update({
    where: { id },
    data: { paused: false, pausedAt: null, pausedBy: null, nextReminderAt: nextAt > new Date() ? nextAt : new Date() },
  });
  await logActivity(req, { action: 'resume_survey', entityType: 'survey', entityId: String(id) });
  res.json({ ok: true, id: updated.id, paused: false, nextReminderAt: updated.nextReminderAt });
}));

surveyRouter.post('/reminders/run', requireRole(['admin']), asyncHandler(async (req, res) => {
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
  if (WISPHUB_SYNC_ENABLED && API_KEY) startSyncLoop();
  else if (!WISPHUB_SYNC_ENABLED) console.log('[sync] disabled by WISPHUB_SYNC_ENABLED=false');
  if (MT_HOST && process.env.WEB_ACTIVITY_ENABLED !== 'false') startWebActivityLoop();
  if (MT_HOST && API_KEY) startAutoBlockLoop();
  startNotifLoop();
  startPaymentWarningLoop();
  startSurveyReminderLoop();
  startMetricsLoop();
  startOltSyncLoop();
  startNocLoop();
  startNetworkAuditLoop();
  ensureTemplatesSeeded().catch((e) => console.error('[templates] seed error:', e.message));
  ensureSuperAdmin().catch((e) => console.error('[auth] seed error:', e.message));
  ensureOnuModelProfilesSeeded().catch((e) => console.error('[onu-models] seed error:', e.message));
  autoConfigureCaptive().catch(() => {});
});

// Android keeps a small HTTP connection pool. Keep sockets alive longer than
// Node's 5 s default so a deliberate non-retryable POST is not sent on a stale
// connection after the technician reviews a form.
server.keepAliveTimeout = 75_000;
server.headersTimeout = 80_000;

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
  if (oltSyncTimer) clearInterval(oltSyncTimer);
  if (oltAutoAuthorizeTimer) clearInterval(oltAutoAuthorizeTimer);
  if (nocTimer) clearInterval(nocTimer);
  if (networkAuditTimer) clearInterval(networkAuditTimer);
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
