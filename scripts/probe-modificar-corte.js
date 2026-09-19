// Prueba si se puede modificar fecha_corte (con y sin hora) via PATCH.
// Lee el valor original, prueba varios formatos, restaura al final.

require('dotenv/config');
const KEY = process.env.WISPHUB_API_KEY;
const BASE = 'https://api.wisphub.io/api';
const headers = { 'Authorization': `Api-Key ${KEY}`, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const TEST_ID = 972;

async function call(method, path, body) {
  const opts = { method, headers, signal: AbortSignal.timeout(15000) };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  const text = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  return { status: r.status, body: parsed ?? text.slice(0, 400) };
}

(async () => {
  // 1. Leer estado actual del cliente
  console.log(`=== 1. Estado actual del cliente ${TEST_ID} ===`);
  const before = await call('GET', `/clientes/${TEST_ID}/`);
  if (before.status !== 200) {
    console.error('No se pudo leer cliente:', before);
    return;
  }
  const original = before.body.fecha_corte;
  const originalInstall = before.body.fecha_instalacion;
  console.log(`  fecha_corte original = "${original}"`);
  console.log(`  fecha_instalacion = "${originalInstall}"`);
  console.log(`  estado = "${before.body.estado}"`);

  // 2. Probar PATCH con formato CON hora
  console.log('\n=== 2. PATCH fecha_corte CON hora (ISO) ===');
  const r1 = await call('PATCH', `/clientes/${TEST_ID}/`, { fecha_corte: '2026-06-06T14:30:00' });
  console.log(`  status=${r1.status}`);
  if (r1.body?.fecha_corte !== undefined) console.log(`  servidor devolvio: fecha_corte="${r1.body.fecha_corte}"`);
  else console.log(`  body: ${JSON.stringify(r1.body).slice(0, 300)}`);

  // Re-leer para verificar persistencia
  const check1 = await call('GET', `/clientes/${TEST_ID}/`);
  console.log(`  releido: fecha_corte="${check1.body?.fecha_corte}"`);

  // 3. Probar formato DD/MM/YYYY HH:MM
  console.log('\n=== 3. PATCH fecha_corte formato "DD/MM/YYYY HH:MM:SS" ===');
  const r2 = await call('PATCH', `/clientes/${TEST_ID}/`, { fecha_corte: '06/06/2026 14:30:00' });
  console.log(`  status=${r2.status}`);
  if (r2.body?.fecha_corte !== undefined) console.log(`  servidor devolvio: fecha_corte="${r2.body.fecha_corte}"`);
  else console.log(`  body: ${JSON.stringify(r2.body).slice(0, 300)}`);
  const check2 = await call('GET', `/clientes/${TEST_ID}/`);
  console.log(`  releido: fecha_corte="${check2.body?.fecha_corte}"`);

  // 4. Probar formato solo dia DD/MM/YYYY
  console.log('\n=== 4. PATCH fecha_corte solo dia "DD/MM/YYYY" ===');
  const r3 = await call('PATCH', `/clientes/${TEST_ID}/`, { fecha_corte: '07/06/2026' });
  console.log(`  status=${r3.status}`);
  if (r3.body?.fecha_corte !== undefined) console.log(`  servidor devolvio: fecha_corte="${r3.body.fecha_corte}"`);
  else console.log(`  body: ${JSON.stringify(r3.body).slice(0, 300)}`);
  const check3 = await call('GET', `/clientes/${TEST_ID}/`);
  console.log(`  releido: fecha_corte="${check3.body?.fecha_corte}"`);

  // 5. RESTAURAR al valor original
  console.log('\n=== 5. RESTAURAR fecha_corte original ===');
  const restore = await call('PATCH', `/clientes/${TEST_ID}/`, { fecha_corte: original });
  console.log(`  status=${restore.status}`);
  const check4 = await call('GET', `/clientes/${TEST_ID}/`);
  console.log(`  releido (restaurado): fecha_corte="${check4.body?.fecha_corte}"`);
  console.log(`  RESTAURADO OK: ${check4.body?.fecha_corte === original}`);

  // 6. Buscar configuracion global de hora de corte en /staff/, /empresa/ u otros
  console.log('\n=== 6. Hay endpoint de configuracion global de cortes? ===');
  const guesses = [
    '/configuracion/', '/empresa/', '/sistema/', '/cortes-config/',
    '/cortes/', '/horario-cortes/', '/horario-corte/', '/settings/',
    '/automatizaciones/', '/jobs/', '/cron/',
  ];
  for (const g of guesses) {
    const r = await call('GET', g);
    if (r.status && r.status !== 404) {
      console.log(`  ✓ ${g} status=${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    }
  }
})();
