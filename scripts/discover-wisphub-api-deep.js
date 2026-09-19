// Descubrimiento PROFUNDO: para cada recurso confirmado, probar:
//  - OPTIONS /{recurso}/{id}/   -> ver si soporta PATCH/PUT/DELETE
//  - OPTIONS endpoints custom conocidos (activar, desactivar, etc.)
// Uso: node scripts/discover-wisphub-api-deep.js

require('dotenv/config');

const KEY = process.env.WISPHUB_API_KEY;
if (!KEY) { console.error('Falta WISPHUB_API_KEY'); process.exit(1); }

const BASE = 'https://api.wisphub.io/api';
const headers = { 'Authorization': `Api-Key ${KEY}`, 'Accept': 'application/json' };

async function probe(method, path) {
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers, signal: AbortSignal.timeout(10000) });
    return { method, path, status: r.status, allow: r.headers.get('allow') || r.headers.get('Allow') || '' };
  } catch (e) {
    return { method, path, err: e.message };
  }
}

(async () => {
  // 1. Tomar 1 ID de cada recurso con datos
  console.log('=== Paso 1: tomar IDs de muestra ===');
  const sampleIds = {};
  const resources = ['clientes', 'facturas', 'plan-internet', 'zonas', 'router', 'formas-de-pago', 'modelo-antena', 'staff'];
  for (const res of resources) {
    try {
      const r = await fetch(`${BASE}/${res}/?limit=1`, { headers, signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const body = await r.json();
        const row = body.results?.[0] || body[0];
        if (row) {
          const id = row.id_servicio ?? row.id_factura ?? row.id ?? row.pk;
          if (id != null) sampleIds[res] = id;
        }
      }
    } catch (e) { /* ignore */ }
  }
  console.log('IDs:', JSON.stringify(sampleIds));

  // 2. OPTIONS al detalle por ID (ahi suele estar PATCH/PUT/DELETE)
  console.log('\n=== Paso 2: OPTIONS al detalle por ID ===');
  for (const [res, id] of Object.entries(sampleIds)) {
    const r = await probe('OPTIONS', `/${res}/${id}/`);
    console.log(`  /${res}/${id}/  allow=${r.allow || '-'}  status=${r.status}`);
  }

  // 3. Endpoints custom CONOCIDOS y otros sospechados
  console.log('\n=== Paso 3: endpoints custom ===');
  const customEndpoints = [
    // Conocidos por el codigo
    { m: 'OPTIONS', p: '/clientes/activar/' },
    { m: 'OPTIONS', p: '/clientes/desactivar/' },
    { m: 'OPTIONS', p: '/clientes/eliminar-clientes/' },
    { m: 'OPTIONS', p: `/clientes/${sampleIds.clientes}/ping/` },
    { m: 'OPTIONS', p: `/clientes/${sampleIds.clientes}/perfil/` },
    { m: 'OPTIONS', p: `/clientes/agregar-cliente/${sampleIds.zonas}/` },
    { m: 'OPTIONS', p: `/facturas/${sampleIds.facturas}/registrar-pago/` },
    // Sospechados de batch / acciones masivas
    { m: 'OPTIONS', p: '/clientes/suspender/' },
    { m: 'OPTIONS', p: '/clientes/reactivar/' },
    { m: 'OPTIONS', p: '/clientes/cortar/' },
    { m: 'OPTIONS', p: '/clientes/cambiar-plan/' },
    { m: 'OPTIONS', p: '/clientes/cambiar-precio/' },
    { m: 'OPTIONS', p: '/clientes/cambiar-zona/' },
    // Sospechados acciones sobre facturas
    { m: 'OPTIONS', p: `/facturas/${sampleIds.facturas}/cancelar/` },
    { m: 'OPTIONS', p: '/facturas/generar/' },
    { m: 'OPTIONS', p: '/facturas/anular/' },
    { m: 'OPTIONS', p: '/facturas/recordatorio/' },
    { m: 'OPTIONS', p: '/facturas/marcar-pagada/' },
    // Reportes / estadisticas
    { m: 'GET', p: '/clientes/estadisticas/' },
    { m: 'GET', p: '/facturas/estadisticas/' },
    { m: 'GET', p: '/dashboard/' },
    { m: 'GET', p: '/resumen/' },
    // Mensajes/WhatsApp/notif si la cuenta tiene el modulo
    { m: 'OPTIONS', p: '/whatsapp/' },
    { m: 'OPTIONS', p: '/sms/' },
    { m: 'OPTIONS', p: '/correos/' },
    { m: 'OPTIONS', p: '/email/' },
    { m: 'OPTIONS', p: '/notificacion/' },
    // Deuda / saldos
    { m: 'GET', p: '/clientes/deuda/' },
    { m: 'GET', p: `/clientes/${sampleIds.clientes}/deuda/` },
    { m: 'GET', p: `/clientes/${sampleIds.clientes}/saldo/` },
    { m: 'GET', p: `/clientes/${sampleIds.clientes}/facturas/` },
  ];
  for (const e of customEndpoints) {
    const r = await probe(e.m, e.p);
    const exists = r.status && r.status !== 404;
    const flag = exists ? '✓' : '✗';
    console.log(`  ${flag} ${e.m.padEnd(7)} ${e.p.padEnd(50)} status=${r.status} allow=${r.allow || '-'}`);
  }

  // 4. Para gastos (tiene POST!): ver shape esperado con OPTIONS verbose
  console.log('\n=== Paso 4: gastos (acepta POST!) ===');
  try {
    const r = await fetch(`${BASE}/gastos/`, { method: 'OPTIONS', headers });
    console.log('status:', r.status, 'allow:', r.headers.get('allow'));
    // Algunos DRF devuelven schema en el body del OPTIONS
    const txt = await r.text();
    if (txt && txt.length < 5000) console.log('body:', txt);
  } catch (e) { console.log('err:', e.message); }
})();
