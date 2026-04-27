// ═══════════════════════════════════════════════════════════════
// WispHub Admin Server - Production Ready
// ═══════════════════════════════════════════════════════════════

require('dotenv/config');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();

const PORT = process.env.PORT || (process.env.NODE_ENV === 'development' ? 7401 : 7400);
const API_KEY = process.env.WISPHUB_API_KEY || '';
const ACCESS_PIN = process.env.ACCESS_PIN || '';
const IS_PROD = process.env.NODE_ENV === 'production';

// ─── SECURITY MIDDLEWARE ───
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

// ─── HEALTH CHECK ───
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const stats = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
      whatsapp: waStatus,
      uptime: process.uptime(),
      version: '1.0.0',
    };
    res.json(stats);
  } catch (e) {
    res.status(500).json({ status: 'error', database: 'disconnected', error: e.message });
  }
});

// ─── PIN AUTH ───
const SESSIONS = new Map(); // token -> expiresAt

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isValidToken(token) {
  if (!token) return false;
  const session = SESSIONS.get(token);
  if (!session) return false;
  if (Date.now() > session) {
    SESSIONS.delete(token);
    return false;
  }
  return true;
}

function authMiddleware(req, res, next) {
  if (!ACCESS_PIN) return next(); // Sin PIN configurado, sin auth

  // Permitir endpoints publicos
  if (req.path === '/auth/login' || req.path === '/auth/check' || req.path === '/health') {
    return next();
  }

  const token = req.headers['x-auth-token'] || req.query.token;
  if (!isValidToken(token)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  // Renovar sesion
  SESSIONS.set(token, Date.now() + 8 * 60 * 60 * 1000); // 8 horas
  next();
}

app.get('/auth/check', (req, res) => {
  res.json({ pinRequired: !!ACCESS_PIN });
});

app.post('/auth/login', authLimiter, (req, res) => {
  if (!ACCESS_PIN) return res.json({ token: 'no-pin-configured' });

  const { pin } = req.body;
  if (!pin || pin !== ACCESS_PIN) {
    return res.status(401).json({ error: 'PIN incorrecto' });
  }

  const token = generateToken();
  SESSIONS.set(token, Date.now() + 8 * 60 * 60 * 1000);
  res.json({ token });
});

app.post('/auth/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) SESSIONS.delete(token);
  res.json({ success: true });
});

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
  const p = await prisma.paymentLog.create({
    data: { ...req.body, paidAt: new Date(req.body.paidAt) }
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
  const n = await prisma.clientNote.create({ data: req.body });
  res.json(n);
}));

dbRouter.put('/notes/:id', asyncHandler(async (req, res) => {
  const n = await prisma.clientNote.update({
    where: { id: parseInt(req.params.id) },
    data: req.body,
  });
  res.json(n);
}));

dbRouter.delete('/notes/:id', asyncHandler(async (req, res) => {
  await prisma.clientNote.delete({ where: { id: parseInt(req.params.id) } });
  res.json({ success: true });
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
  const p = await prisma.paymentPromise.create({
    data: { ...req.body, promisedDate: new Date(req.body.promisedDate) },
  });
  res.json(p);
}));

dbRouter.put('/promises/:id', asyncHandler(async (req, res) => {
  const data = { ...req.body };
  if (data.promisedDate) data.promisedDate = new Date(data.promisedDate);
  if (data.completedAt) data.completedAt = new Date(data.completedAt);
  const p = await prisma.paymentPromise.update({
    where: { id: parseInt(req.params.id) }, data,
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
  const updates = Object.entries(req.body).map(([key, value]) =>
    prisma.appSetting.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) },
    })
  );
  await Promise.all(updates);
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

    res.json({ success: true, count });
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
dbRouter.get('/backup', (req, res) => {
  const dbPath = path.join(__dirname, 'prisma', 'data.db');
  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: 'DB no encontrada' });
  }
  const date = new Date().toISOString().slice(0, 10);
  res.download(dbPath, `wishub-backup-${date}.db`);
});

app.use('/db', dbRouter);

// ─── WISPHUB API PROXY (autenticado tambien) ───
const apiRouter = express.Router();
apiRouter.use(authMiddleware);

if (API_KEY) {
  apiRouter.use('/', createProxyMiddleware({
    target: 'https://api.wisphub.io',
    changeOrigin: true,
    pathRewrite: { '^/': '/api/' },
    headers: { 'Authorization': `Api-Key ${API_KEY}` },
  }));
}

app.use('/api', apiRouter);

// ─── WHATSAPP BAILEYS ───
let waSocket = null;
let waQR = null;
let waStatus = 'disconnected';

async function initWhatsApp() {
  try {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
    const { state, saveCreds } = await useMultiFileAuthState('./wa-auth');

    waSocket = makeWASocket({ auth: state });
    waSocket.ev.on('creds.update', saveCreds);

    waSocket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) { waQR = qr; waStatus = 'qr'; }
      if (connection === 'open') {
        waStatus = 'connected';
        waQR = null;
        console.log('[WA] Connected');
      }
      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        waStatus = 'disconnected';
        if (reason !== DisconnectReason.loggedOut) setTimeout(initWhatsApp, 10000);
      }
    });
  } catch (err) {
    console.error('[WA] init error:', err.message);
    waStatus = 'error';
  }
}

const waRouter = express.Router();
waRouter.use(authMiddleware);

waRouter.get('/status', (req, res) => res.json({ status: waStatus, qr: waQR }));

waRouter.post('/send', asyncHandler(async (req, res) => {
  if (waStatus !== 'connected' || !waSocket) {
    return res.status(400).json({ error: 'WhatsApp no conectado' });
  }
  const { phone, message, idServicio, clientName, messageType = 'manual' } = req.body;
  let jid = phone.replace(/[\s\-\+\(\)]/g, '');
  if (!jid.startsWith('1') && jid.length === 10) jid = '1' + jid;
  jid = jid + '@s.whatsapp.net';

  try {
    await waSocket.sendMessage(jid, { text: message });
    await prisma.whatsappLog.create({
      data: { phone, message, idServicio, clientName, messageType, status: 'sent' }
    });
    res.json({ success: true });
  } catch (err) {
    await prisma.whatsappLog.create({
      data: { phone, message, idServicio, clientName, messageType, status: 'failed', errorMessage: err.message }
    });
    res.status(500).json({ error: err.message });
  }
}));

waRouter.post('/send-bulk', asyncHandler(async (req, res) => {
  if (waStatus !== 'connected' || !waSocket) return res.status(400).json({ error: 'WhatsApp no conectado' });
  const { contacts, messageType = 'bulk' } = req.body;
  const results = [];

  for (const c of contacts) {
    try {
      let jid = c.phone.replace(/[\s\-\+\(\)]/g, '');
      if (!jid.startsWith('1') && jid.length === 10) jid = '1' + jid;
      jid = jid + '@s.whatsapp.net';
      await waSocket.sendMessage(jid, { text: c.message });
      await prisma.whatsappLog.create({
        data: { phone: c.phone, message: c.message, idServicio: c.idServicio, clientName: c.clientName, messageType, status: 'sent' }
      });
      results.push({ phone: c.phone, status: 'sent' });
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      await prisma.whatsappLog.create({
        data: { phone: c.phone, message: c.message, idServicio: c.idServicio, clientName: c.clientName, messageType, status: 'failed', errorMessage: err.message }
      });
      results.push({ phone: c.phone, status: 'error', error: err.message });
    }
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

waRouter.post('/disconnect', (req, res) => {
  if (waSocket) { waSocket.logout().catch(() => {}); waSocket = null; waStatus = 'disconnected'; waQR = null; }
  res.json({ status: 'disconnected' });
});

waRouter.post('/connect', (req, res) => {
  if (waStatus === 'connected') return res.json({ status: 'already connected' });
  initWhatsApp();
  res.json({ status: 'connecting' });
});

app.use('/wa', waRouter);

// ─── STATIC FILES (Angular build) ───
const distPath = path.join(__dirname, 'dist/wishub-admin/browser');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, { maxAge: IS_PROD ? '1d' : 0 }));
  app.get(/.*/, (req, res) => {
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

// ─── START SERVER ───
const server = app.listen(PORT, () => {
  console.log('═══════════════════════════════════════');
  console.log(`WispHub Admin running on port ${PORT}`);
  console.log(`Mode: ${IS_PROD ? 'PRODUCTION' : 'development'}`);
  console.log(`PIN auth: ${ACCESS_PIN ? 'enabled' : 'disabled'}`);
  console.log(`API key: ${API_KEY ? 'configured' : 'MISSING - set WISPHUB_API_KEY'}`);
  console.log('═══════════════════════════════════════');

  if (API_KEY) initWhatsApp();
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
