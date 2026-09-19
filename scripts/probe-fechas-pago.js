// Verifica que campos de fecha trae la API de WispHub por cliente.
require('dotenv/config');
const KEY = process.env.WISPHUB_API_KEY;
if (!KEY) { console.error('Falta WISPHUB_API_KEY'); process.exit(1); }

const BASE = 'https://api.wisphub.io/api';
const headers = { 'Authorization': `Api-Key ${KEY}`, 'Accept': 'application/json' };

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers, signal: AbortSignal.timeout(15000) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  console.log('=== 1. Fields de fecha en /clientes/ ===');
  const cs = await get('/clientes/?limit=3');
  if (cs.status === 200 && cs.body?.results?.length) {
    const sample = cs.body.results[0];
    const dateFields = Object.entries(sample).filter(([k, v]) =>
      k.toLowerCase().includes('fecha') ||
      k.toLowerCase().includes('date') ||
      k.toLowerCase().includes('vencim') ||
      k.toLowerCase().includes('corte') ||
      k.toLowerCase().includes('pago') ||
      (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v))
    );
    console.log('Campos de fecha en cliente sample:');
    dateFields.forEach(([k, v]) => console.log(`  ${k} = ${JSON.stringify(v)}`));
    console.log('\nTodos los campos disponibles en /clientes/ (lista de keys):');
    console.log(Object.keys(sample).join(', '));
  }

  console.log('\n=== 2. Cliente detallado (ID 972) — todos los campos ===');
  const cd = await get('/clientes/972/');
  if (cd.status === 200 && cd.body) {
    const dateFields = Object.entries(cd.body).filter(([k, v]) =>
      k.toLowerCase().includes('fecha') ||
      k.toLowerCase().includes('pago') ||
      k.toLowerCase().includes('vencim') ||
      k.toLowerCase().includes('corte')
    );
    console.log('Campos relacionados con fechas/pago en detail:');
    dateFields.forEach(([k, v]) => console.log(`  ${k} = ${JSON.stringify(v)}`));
  }

  console.log('\n=== 3. Facturas: campos de fecha y estado ===');
  const fs = await get('/facturas/?limit=10');
  if (fs.status === 200 && fs.body?.results?.length) {
    console.log('Schema de factura (primera):');
    const f = fs.body.results[0];
    console.log(`  id_factura=${f.id_factura}`);
    console.log(`  cliente=${JSON.stringify(f.cliente)}`);
    console.log(`  fecha_emision=${f.fecha_emision}`);
    console.log(`  fecha_vencimiento=${f.fecha_vencimiento}`);
    console.log(`  fecha_pago=${f.fecha_pago}`);
    console.log(`  estado=${f.estado}`);
    console.log(`  total=${f.total}  saldo=${f.saldo}  total_cobrado=${f.total_cobrado}`);

    console.log('\nMuestra de 10 facturas con sus fechas:');
    fs.body.results.forEach(f => {
      console.log(`  #${f.id_factura} cliente=${f.cliente?.id_servicio || '?'} (${(f.cliente?.nombre || '').slice(0, 25)}) emis=${f.fecha_emision} venc=${f.fecha_vencimiento} pago=${f.fecha_pago || 'NULL'} estado=${f.estado}`);
    });
  }

  console.log('\n=== 4. Filtrar facturas por cliente especifico (972) ===');
  const fc = await get('/facturas/?cliente=972&limit=20');
  if (fc.status === 200 && fc.body?.results?.length) {
    console.log(`Cliente 972 tiene ${fc.body.count} facturas. Ultimas:`);
    fc.body.results.slice(0, 10).forEach(f => {
      console.log(`  #${f.id_factura} emis=${f.fecha_emision} venc=${f.fecha_vencimiento} pago=${f.fecha_pago || '-'} estado=${f.estado} total=${f.total}`);
    });
  }

  console.log('\n=== 5. Resumen: cuantas facturas tienen fecha_pago vs no ===');
  let withDate = 0, withoutDate = 0, withDateSet = 0;
  let offset = 0;
  while (offset < 100) {
    const r = await get(`/facturas/?limit=50&offset=${offset}`);
    if (r.status !== 200 || !r.body?.results?.length) break;
    for (const f of r.body.results) {
      if (f.fecha_pago) withDate++; else withoutDate++;
      if (f.estado === 'Pagada' && f.fecha_pago) withDateSet++;
    }
    if (!r.body.next) break;
    offset += 50;
  }
  console.log(`Total muestreado: ${withDate + withoutDate}`);
  console.log(`Con fecha_pago: ${withDate}  |  Sin fecha_pago: ${withoutDate}`);
  console.log(`Pagadas con fecha valida: ${withDateSet}`);

  console.log('\n=== 6. Filtrar facturas por estado + rango de fechas ===');
  const today = new Date().toISOString().slice(0, 10);
  const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const r = await get(`/facturas/?estado=Pagada&fecha_pago__gte=${lastMonth}&fecha_pago__lte=${today}&limit=5`);
  console.log(`Status=${r.status} ${r.status === 200 ? '(filtro funciona)' : '(filtro no funciona)'}`);
  if (r.body?.results?.length) {
    console.log(`Pagadas en ultimos 30 dias (muestra ${r.body.results.length} de ${r.body.count}):`);
    r.body.results.forEach(f => {
      console.log(`  cliente=${f.cliente?.id_servicio} pago=${f.fecha_pago} total=${f.total}`);
    });
  } else {
    console.log('Sin resultados o filtro no soportado. Body:', JSON.stringify(r.body).slice(0, 200));
  }
})();
