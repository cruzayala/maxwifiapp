// Descubrimiento de la API de WispHub: para cada recurso conocido
// hace OPTIONS (lista metodos permitidos) y GET 1 fila (forma de payload).
// Uso: node scripts/discover-wisphub-api.js
// Lee WISPHUB_API_KEY de .env.

require('dotenv/config');

const KEY = process.env.WISPHUB_API_KEY;
if (!KEY) { console.error('Falta WISPHUB_API_KEY en .env'); process.exit(1); }

const BASE = 'https://api.wisphub.io/api';

// Recursos a explorar. La lista incluye los confirmados + los sospechados
// + variantes comunes en Django REST.
const RESOURCES = [
  // Confirmados
  'clientes', 'facturas', 'tickets', 'plan-internet', 'zonas', 'router',
  'formas-de-pago', 'tasks',
  // Sospechados (probables en una plataforma WISP comercial)
  'antenas', 'modelo-antena', 'sectoriales', 'sectorial', 'staff', 'tecnicos',
  'mensajes', 'notificaciones', 'comisiones', 'vendedores',
  'inventario', 'equipos', 'productos', 'stock', 'almacen',
  'gastos', 'cajas', 'arqueo', 'movimientos',
  'reportes', 'mikrotik', 'monitoreo', 'empresa', 'sucursales',
  'configuracion', 'auditoria', 'log', 'historial',
  'contratos', 'documentos', 'adjuntos',
  'paquetes', 'servicios', 'velocidad',
];

const headers = {
  'Authorization': `Api-Key ${KEY}`,
  'Accept': 'application/json',
};

async function probe(resource) {
  const url = `${BASE}/${resource}/`;
  const out = { resource, exists: false };

  // OPTIONS → metodos permitidos
  try {
    const opt = await fetch(url, { method: 'OPTIONS', headers, signal: AbortSignal.timeout(10000) });
    const allow = opt.headers.get('allow') || opt.headers.get('Allow') || '';
    out.optionsStatus = opt.status;
    out.allow = allow;
    // Algunos servidores no devuelven Allow en 401. Tratamos 401 como "existe pero requiere mas perms".
    if (opt.status === 200) out.exists = true;
    if (opt.status === 401 || opt.status === 403) { out.exists = true; out.note = 'auth/perm'; }
  } catch (e) {
    out.optionsErr = e.message;
  }

  // GET → confirmar y traer 1 fila de muestra
  try {
    const get = await fetch(`${url}?limit=1`, { method: 'GET', headers, signal: AbortSignal.timeout(15000) });
    out.getStatus = get.status;
    if (get.status === 200) {
      out.exists = true;
      const ct = get.headers.get('content-type') || '';
      if (ct.includes('json')) {
        const body = await get.json();
        // Para colecciones {count, results}
        if (body && typeof body.count === 'number') {
          out.count = body.count;
          out.sampleKeys = body.results?.[0] ? Object.keys(body.results[0]) : [];
        } else if (Array.isArray(body)) {
          out.count = body.length;
          out.sampleKeys = body[0] ? Object.keys(body[0]) : [];
        } else if (body && typeof body === 'object') {
          out.sampleKeys = Object.keys(body);
        }
      }
    } else if (get.status === 404) {
      out.exists = false;
    } else {
      out.exists = true;
      out.note = `get_${get.status}`;
    }
  } catch (e) {
    out.getErr = e.message;
  }

  return out;
}

(async () => {
  console.log(`[discover] WispHub API @ ${BASE}\n`);
  const results = [];
  for (const r of RESOURCES) {
    const row = await probe(r);
    results.push(row);
    const line = row.exists
      ? `✓ ${r.padEnd(20)} OPTIONS=${row.optionsStatus || '-'} GET=${row.getStatus || '-'} allow=${row.allow || '-'} count=${row.count ?? '-'} fields=${(row.sampleKeys || []).slice(0, 8).join(',')}`
      : `✗ ${r.padEnd(20)} OPTIONS=${row.optionsStatus || '-'} GET=${row.getStatus || '-'} ${row.note || ''}`;
    console.log(line);
  }
  console.log('\n=== JSON RESULT ===');
  console.log(JSON.stringify(results, null, 2));
})();
