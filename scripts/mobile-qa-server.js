'use strict';

// Isolated fixtures. Never imports server.js or reads a production database URL.
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { createMobileRouter } = require('../lib/mobile-api');

async function startQa(port = 0, billingAdapter, provisioningAdapter, mobileIntegrations = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ispmax-mobile-qa-'));
  const url = 'file:' + path.join(dir, 'qa.db').replaceAll('\\', '/');
  fs.closeSync(fs.openSync(path.join(dir, 'qa.db'), 'wx'));
  const child = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 60000,
  });
  if (child.status !== 0) throw new Error(`No se pudo preparar SQLite QA: ${child.stderr}`);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const passwordHash = await bcrypt.hash('qa-only-12345', 4);
  for (const role of ['super_admin', 'admin', 'tecnico', 'cobranza', 'viewer']) {
    await prisma.user.create({ data: { username: `qa-${role}`, fullName: `QA ${role}`, role, passwordHash, isActive: true } });
  }
  const now = new Date();
  await prisma.equipmentType.create({ data: { id: 1, name: 'ONU de prueba', category: 'onu', unit: 'u' } });
  await prisma.client.createMany({ data: [
    { idServicio: 301, nombre: 'Ana Torres', estado: 'Activo', usuario: 'ana-qa', ip: '192.0.2.10', planInternetName: 'Fibra 50M', precioPlan: '1200', telefono: '0000000000', zonaNombre: 'Sector QA', tecnicoId: 501, tecnicoNombre: 'Tecnico QA', snOnu: 'TEST00000301', passwordSsidWifi: 'MUST-NOT-LEAK' },
    { idServicio: 302, nombre: 'Luis Rodriguez', estado: 'Suspendido', usuario: 'luis-qa', ip: '192.0.2.11', planInternetName: 'Fibra 30M', precioPlan: '900', zonaNombre: 'Sector QA' },
    { idServicio: 303, nombre: 'Farmacia del Parque', estado: 'Activo', ip: '192.0.2.12', planInternetName: 'Empresa 100M', precioPlan: '2100', zonaNombre: 'Centro QA' },
  ] });
  await prisma.invoice.createMany({ data: [
    { idFactura: 9001, clienteIdServicio: 301, clienteNombre: 'Ana Torres', estado: 'Pagada', subTotal: 1200, total: 1200, totalCobrado: 1200, saldo: 0, fechaEmision: '2026-09-01', fechaVencimiento: '2026-09-06' },
    { idFactura: 9002, clienteIdServicio: 302, clienteNombre: 'Luis Rodriguez', estado: 'Pendiente de Pago', subTotal: 900, total: 900, totalCobrado: 0, saldo: 900, fechaEmision: '2026-09-01', fechaVencimiento: '2026-09-06' },
  ] });
  await prisma.internetPlan.create({ data: { id: 1, nombre: 'Fibra 50M', tipo: 'Simple Queue' } });
  await prisma.cachedTicket.create({ data: { idTicket: 50, asunto: 'Revision de potencia', cliente: 'Ana Torres', idServicio: 301, estado: 'Abierto', prioridad: 'Media', stateHash: 'qa' } });
  await prisma.oltOnu.create({ data: { onuIndex: 'gpon-onu_1/1/1:1', interfaceName: 'gpon-onu_1/1/1:1', rack: 1, shelf: 1, pon: 1, onuId: 1, name: 'Ana Torres', serial: 'TEST00000301', model: 'EG8141A5', online: true, rxPowerDbm: -19.4, txPowerDbm: 2.1 } });
  await prisma.wanNetworkSample.create({ data: { capturedAt: now, ifaceName: 'ether1-QA', rxBps: 185000000, txBps: 46000000 } });
  const app = express();
  await prisma.paymentMethod.create({ data: { id: 1, nombre: 'Efectivo QA' } });
  const adapter = billingAdapter || {
    configured: true,
    invoice: async id => { const row = await prisma.invoice.findUniqueOrThrow({ where: { idFactura: id } }); return { id_factura: id, total: row.total, total_cobrado: row.totalCobrado, saldo: row.saldo, estado: row.estado }; },
    submit: async op => { await prisma.invoice.update({ where: { idFactura: op.invoiceId }, data: { totalCobrado: { increment: op.amount }, saldo: { decrement: op.amount } } }); return { status: 'SUCCESS' }; },
    task: async () => ({ status: 'SUCCESS' }),
  };
  const billing = require('../lib/billing-service').createBillingService({ prisma, adapter });
  const externalClients = new Map([
    [301, { detail: { id_servicio: 301, nombre: 'Ana Torres', usuario: 'ana-qa', telefono: '0000000000', ip: '192.0.2.10', mac_cpe: '', interfaz_lan: 'LAN1', sn_onu: 'TEST00000301', ssid_router_wifi: 'Ana QA', password_ssid_router_wifi: 'qa-secret-must-not-leak', comentarios: '' }, profile: { nombre: 'Ana', apellidos: 'Torres', telefono: '0000000000', cedula: '', email: '', direccion: '', localidad: 'Sector QA', ciudad: 'Sector QA' } }],
    [302, { detail: { id_servicio: 302, nombre: 'Luis Rodriguez', usuario: 'luis-qa', ip: '192.0.2.11' }, profile: { nombre: 'Luis', apellidos: 'Rodriguez' } }],
    [303, { detail: { id_servicio: 303, nombre: 'Farmacia del Parque', ip: '192.0.2.12' }, profile: { nombre: 'Farmacia', apellidos: 'del Parque' } }],
  ]);
  const qaExternalClient = {
    read: async (id) => JSON.parse(JSON.stringify(externalClients.get(id))),
    update: async ({ idServicio, section, changes }) => {
      const row = externalClients.get(idServicio);
      if (section === 'profile') {
        for (const [field, value] of Object.entries(changes)) {
          if (field === 'displayName') {
            const parts = value.split(/\s+/); row.profile.nombre = parts.shift(); row.profile.apellidos = parts.join(' '); row.detail.nombre = value;
          } else row.profile[{ phone: 'telefono', nationalId: 'cedula', email: 'email', address: 'direccion', city: 'ciudad' }[field]] = value;
        }
      } else {
        const fields = { ip: 'ip', macCpe: 'mac_cpe', lanInterface: 'interfaz_lan', onuSerial: 'sn_onu', wifiSsid: 'ssid_router_wifi', wifiPassword: 'password_ssid_router_wifi', comments: 'comentarios' };
        for (const [field, value] of Object.entries(changes)) row.detail[fields[field]] = value;
      }
      return { ...JSON.parse(JSON.stringify(row)), secretVerified: !Object.hasOwn(changes, 'wifiPassword') || row.detail.password_ssid_router_wifi === changes.wifiPassword };
    },
  };
  const qaTickets = new Map([[50, { id_ticket: 50, asunto: 'Revision de potencia', descripcion: '<p>Validar niveles opticos</p>', estado: 'Nuevo', prioridad: 'Normal', servicio: { id_servicio: 301, nombre: 'Ana Torres' }, tecnico: { id: 501, nombre: 'Tecnico QA' }, fecha_creacion: '2026-09-15 10:00:00', fecha_actualizacion: '2026-09-15 10:00:00' }]]);
  let nextTicket = 900001;
  const ticketLabels = { states: { 1: 'Nuevo', 2: 'En Progreso', 3: 'Resuelto', 4: 'Cerrado' }, priorities: { 1: 'Baja', 2: 'Normal', 3: 'Alta', 4: 'Muy Alta' } };
  const qaTicket = (id, input) => ({ id_ticket: id, asunto: input.subject, descripcion: `<p>${input.description}</p>`, estado: ticketLabels.states[input.state], prioridad: ticketLabels.priorities[input.priority], servicio: { id_servicio: input.clientId, nombre: input.clientId === 301 ? 'Ana Torres' : `Cliente #${input.clientId}` }, tecnico: { id: input.technicianId, nombre: 'Tecnico QA' }, fecha_creacion: '2026-09-15 10:00:00', fecha_actualizacion: new Date().toISOString() });
  const defaultMobileIntegrations = {
    externalClient: qaExternalClient,
    ticketProvider: {
      read: async (id) => JSON.parse(JSON.stringify(qaTickets.get(id))),
      create: async (input) => { const row = qaTicket(nextTicket++, input); qaTickets.set(row.id_ticket, row); return JSON.parse(JSON.stringify(row)); },
      update: async (id, input) => { const row = qaTicket(id, input); qaTickets.set(id, row); return JSON.parse(JSON.stringify(row)); },
    },
    liveNetwork: async () => ({
      timestamp: now.toISOString(),
      stats: { totalClients: 3, onlineClients: 2, offlineClients: 1, transmittingClients: 1, differences: 1, disabledQueues: 0, totalUploadBps: 1_500_000, totalDownloadBps: 12_000_000 },
      clients: [
        { queueName: 'ana-qa', ip: '192.0.2.10', uploadBps: 1_000_000, downloadBps: 10_000_000, maxUploadBps: 50_000_000, maxDownloadBps: 50_000_000, uploadPct: 2, downloadPct: 20, isOnline: true, isTransmitting: true, syncState: 'synced', interface: 'bridge-qa', client: { id: 301, name: 'Ana Torres', username: 'ana-qa', plan: 'Fibra 50M', zone: 'Sector QA', status: 'Activo' } },
        { queueName: 'luis-qa', ip: '192.0.2.11', uploadBps: 500_000, downloadBps: 2_000_000, maxUploadBps: 30_000_000, maxDownloadBps: 30_000_000, isOnline: true, isTransmitting: false, syncState: 'queue_mismatch', client: { id: 302, name: 'Luis Rodriguez', username: 'luis-qa', plan: 'Fibra 30M', zone: 'Sector QA', status: 'Suspendido' } },
        { queueName: 'farmacia', ip: '192.0.2.12', uploadBps: 0, downloadBps: 0, isOnline: false, isTransmitting: false, syncState: 'synced', client: { id: 303, name: 'Farmacia del Parque', zone: 'Centro QA', status: 'Activo' } },
      ],
    }),
    mikrotikOverview: async () => ({ configured: true, connected: true, error: null, system: { identity: 'MikroTik-QA', version: '7.qa', boardName: 'QA', uptime: '1d', cpuLoadPercent: 7, totalMemoryBytes: 1000, freeMemoryBytes: 600, health: [] }, interfaces: [{ name: 'ether1-QA', type: 'ether', running: true, disabled: false, mtu: 1500, rxBytes: 100, txBytes: 200 }], telemetry: { depth: 0 } }),
    mikrotikPing: async ({ address, count }) => ({ address, count, sent: count, received: count, lossPercent: 0, avgMs: 12.4, maxMs: 13.1 }),
  };
  app.use(express.json());
  app.use('/mobile/v1', createMobileRouter({ prisma, billing, provisionClient: provisioningAdapter, ...defaultMobileIntegrations, ...mobileIntegrations, loginLimiter: (_req, _res, next) => next() }));
  if (require.main === module && process.env.MOBILE_QA_WEB === 'true') {
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'qa-admin' } });
    app.get('/auth/check', (_req, res) => res.json({ authenticated: true, enabled: true }));
    app.post('/auth/login', (req, res) => req.body.username === 'qa-admin' && req.body.password === 'qa-only-12345'
      ? res.json({ token: 'isolated-web-qa', user: { id: user.id, username: user.username, role: user.role } }) : res.status(401).json({ error: 'Credenciales QA invalidas' }));
    app.use(['/auth/me', '/billing', '/db'], (req, res, next) => {
      if (req.headers['x-auth-token'] !== 'isolated-web-qa') return res.status(401).json({ error: 'Sesion QA requerida' });
      req.session = { userId: user.id, role: user.role }; next();
    });
    app.get('/auth/me', (_req, res) => res.json({ ok: true, userId: user.id, username: user.username, role: user.role }));
    app.get('/db/invoices', async (_req, res) => res.json(await prisma.invoice.findMany()));
    app.get('/db/clients', async (_req, res) => res.json(await prisma.client.findMany({ select: { idServicio: true, nombre: true } })));
    app.get('/db/settings', (_req, res) => res.json({ surveyEnabled: false }));
    const webBilling = express.Router();
    require('../lib/web-billing').registerWebBilling(webBilling, { billing, wrap: fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next) });
    app.use('/billing', webBilling);
    const dist = path.resolve(__dirname, '../dist/wishub-admin/browser');
    app.use(express.static(dist));
    app.get(/^\/(login|invoices)?$/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status ? error.message : 'Fallo QA' }));
  }
  const server = await new Promise((resolve) => { const server = app.listen(port, '127.0.0.1', () => resolve(server)); });
  server.keepAliveTimeout = 75_000;
  server.headersTimeout = 80_000;
  return { prisma, externalClients, externalClient: qaExternalClient, server, url: `http://127.0.0.1:${server.address().port}`, database: path.join(dir, 'qa.db'), close: async () => { await new Promise((resolve) => server.close(resolve)); await prisma.$disconnect(); } };
}
if (require.main === module) {
  startQa(Number(process.env.MOBILE_QA_PORT || 7415)).then((qa) => {
    console.log(`QA AISLADO: ${qa.url} | SQLite ${qa.database}`);
    console.log('Solo fixtures: usuario qa-admin / clave qa-only-12345');
    process.on('SIGINT', async () => { await qa.close(); process.exit(0); });
    process.on('SIGTERM', async () => { await qa.close(); process.exit(0); });
  }).catch((error) => { console.error(error.message); process.exit(1); });
}
module.exports = { startQa };
