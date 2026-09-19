// Fuzz masivo de la API WispHub.
// Pega POST/PATCH/PUT/DELETE con payloads vacios y/o IDs garbage para descubrir
// QUE SE PUEDE hacer sin modificar datos reales.
//
// IMPORTANTE: no eliminamos ni creamos nada real.
//  - POST con {} -> normalmente 400 con detalle de campos esperados.
//  - PATCH con {} -> normalmente 200 (no toca nada) o 400.
//  - PUT con {} -> normalmente 400 (faltan campos requeridos).
//  - DELETE sobre ID inexistente (999999999) -> 404.
//
// Uso: node scripts/probe-wisphub-massive.js > scripts/probe-wisphub-massive.out

require('dotenv/config');

const KEY = process.env.WISPHUB_API_KEY;
if (!KEY) { console.error('Falta WISPHUB_API_KEY'); process.exit(1); }
const BASE = 'https://api.wisphub.io/api';
const headers = { 'Authorization': `Api-Key ${KEY}`, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const GARBAGE_ID = 999999999;
const STOP_ON_FAIL = false;

async function call(method, path, body) {
  const opts = { method, headers, signal: AbortSignal.timeout(15000) };
  if (body !== undefined) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(`${BASE}${path}`, opts);
    const text = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return { status: r.status, allow: r.headers.get('allow') || '', body: parsed ?? text.slice(0, 500) };
  } catch (e) {
    return { err: e.message };
  }
}

async function getSampleIds() {
  const ids = {};
  for (const res of ['clientes', 'facturas', 'plan-internet', 'zonas', 'router', 'formas-de-pago', 'modelo-antena', 'staff', 'gastos', 'tickets', 'sectorial']) {
    try {
      const r = await fetch(`${BASE}/${res}/?limit=1`, { headers, signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const b = await r.json();
      const row = b.results?.[0] || b[0];
      if (row) ids[res] = row.id_servicio ?? row.id_factura ?? row.id ?? row.pk;
    } catch {}
  }
  return ids;
}

function pretty(result) {
  if (result.err) return `ERR ${result.err}`;
  const bodyStr = typeof result.body === 'object'
    ? JSON.stringify(result.body).slice(0, 250)
    : String(result.body).slice(0, 250);
  return `[${result.status}] ${bodyStr}`;
}

(async () => {
  console.log('=== Fuzz masivo WispHub API ===');
  console.log('Estrategia: payloads vacios + IDs garbage. NO MODIFICA DATOS REALES.\n');

  const ids = await getSampleIds();
  console.log('IDs de muestra:', JSON.stringify(ids), '\n');

  // === COLECCIONES (lista raiz) ===
  const collections = ['clientes', 'facturas', 'plan-internet', 'zonas', 'router', 'formas-de-pago', 'modelo-antena', 'staff', 'gastos', 'tickets', 'sectorial'];
  console.log('### COLECCIONES (lista raiz) — POST con body vacio ###');
  for (const res of collections) {
    const r = await call('POST', `/${res}/`, {});
    console.log(`POST /${res}/  ${pretty(r)}`);
  }
  console.log();

  // === DETALLES POR ID (con ID garbage para no tocar nada real) ===
  console.log('### DETALLES (ID garbage 999999999) — PATCH/PUT/DELETE para ver Allow + validacion ###');
  for (const res of collections) {
    const path = `/${res}/${GARBAGE_ID}/`;
    const pa = await call('PATCH', path, {});
    console.log(`PATCH  ${path.padEnd(30)} ${pretty(pa)}`);
    const pu = await call('PUT', path, {});
    console.log(`PUT    ${path.padEnd(30)} ${pretty(pu)}`);
    const de = await call('DELETE', path);
    console.log(`DELETE ${path.padEnd(30)} ${pretty(de)}`);
  }
  console.log();

  // === DETALLES POR ID REAL (PATCH vacio -> deberia ser 200 sin cambios) ===
  console.log('### DETALLES (ID REAL) — PATCH con body vacio (no cambia nada, valida acceso) ###');
  for (const [res, id] of Object.entries(ids)) {
    const r = await call('PATCH', `/${res}/${id}/`, {});
    console.log(`PATCH /${res}/${id}/  ${pretty(r)}`);
  }
  console.log();

  // === ENDPOINTS CUSTOM CONFIRMADOS ===
  console.log('### ENDPOINTS CUSTOM — POST con body vacio (esperamos 400 con campos requeridos) ###');
  const customPosts = [
    `/clientes/activar/`,
    `/clientes/desactivar/`,
    `/clientes/eliminar-clientes/`,
    `/clientes/${ids.clientes}/ping/`,
    `/clientes/agregar-cliente/${ids.zonas}/`,
    `/facturas/${ids.facturas}/registrar-pago/`,
  ];
  for (const path of customPosts) {
    const r = await call('POST', path, {});
    console.log(`POST ${path.padEnd(45)} ${pretty(r)}`);
  }
  console.log();

  // === SCHEMA via OPTIONS body (DRF metadata) ===
  console.log('### SCHEMA (OPTIONS body) por recurso ###');
  for (const res of collections) {
    try {
      const r = await fetch(`${BASE}/${res}/`, { method: 'OPTIONS', headers });
      const txt = await r.text();
      let body = null;
      try { body = JSON.parse(txt); } catch {}
      if (body?.actions) {
        for (const [verb, fields] of Object.entries(body.actions)) {
          const fieldList = Object.entries(fields || {}).map(([k, v]) => {
            const req = v.required ? '!' : '';
            const ro = v.read_only ? '(ro)' : '';
            return `${k}${req}${ro}:${v.type}`;
          }).join(', ');
          console.log(`OPTIONS /${res}/ — ${verb}: ${fieldList}`);
        }
      } else {
        console.log(`OPTIONS /${res}/  (no actions schema)`);
      }
    } catch (e) {
      console.log(`OPTIONS /${res}/  ERR ${e.message}`);
    }
  }
  console.log();

  // === RECURSOS POSIBLES ADICIONALES ===
  console.log('### OTROS RECURSOS POSIBLES (probar GET) ###');
  const extras = [
    'sucursales', 'pagos', 'cobranzas', 'mora', 'morosos', 'cortes',
    'tareas', 'recordatorios', 'mensajeria', 'historial-cambios',
    'logs', 'auditoria', 'permisos', 'roles', 'usuarios',
    'cliente-saldo', 'reportes-financieros', 'reportes-clientes',
    'kpi', 'metrics', 'ingresos', 'egresos',
    'proveedores', 'productos', 'inventario-equipos',
    'speedtest', 'velocidad-clientes', 'capacidad-router',
    'cfdi', 'sat', 'comprobantes', 'pdf-factura',
    'paquetes', 'planes-internet', 'velocidades',
  ];
  for (const res of extras) {
    const r = await call('GET', `/${res}/?limit=1`);
    if (r.status && r.status !== 404) {
      console.log(`✓ GET /${res}/  ${pretty(r)}`);
    }
  }
})();
