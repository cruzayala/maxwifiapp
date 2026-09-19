require('dotenv/config');
const KEY = process.env.WISPHUB_API_KEY;
const BASE = 'https://api.wisphub.io/api';
const headers = { 'Authorization': `Api-Key ${KEY}`, 'Accept': 'application/json' };

(async () => {
  // Traer una pagina grande de clientes
  const r = await fetch(`${BASE}/clientes/?limit=300`, { headers, signal: AbortSignal.timeout(20000) });
  const b = await r.json();
  const all = b.results;

  // 1. Cualquiera con dia 30?
  const dia30 = all.filter(c => c.fecha_corte && /^30[\/\-]/.test(c.fecha_corte));
  console.log(`Clientes con fecha_corte dia 30: ${dia30.length}`);
  dia30.slice(0, 5).forEach(c => console.log(`  ${c.id_servicio} ${c.nombre} -> ${c.fecha_corte}`));

  // 2. Formato exacto: hora? timezone?
  console.log('\n=== Muestras de fecha_corte (10 random) ===');
  const samples = all.filter(c => c.fecha_corte).slice(0, 10);
  samples.forEach(c => {
    console.log(`  ${c.id_servicio} | corte="${c.fecha_corte}" | instalacion="${c.fecha_instalacion}" | ultimo_cambio="${c.ultimo_cambio}"`);
  });

  // 3. Hay alguna fecha_corte CON hora?
  const conHora = all.filter(c => c.fecha_corte && /\d{1,2}:\d{2}/.test(c.fecha_corte));
  console.log(`\nCon hora en fecha_corte: ${conHora.length} / ${all.length}`);
  conHora.slice(0, 5).forEach(c => console.log(`  ${c.id_servicio} -> ${c.fecha_corte}`));

  // 4. Distribucion de fechas completas (no solo dia)
  console.log('\n=== Top 10 fechas de corte distintas ===');
  const counts = new Map();
  all.forEach(c => {
    if (c.fecha_corte) counts.set(c.fecha_corte, (counts.get(c.fecha_corte) || 0) + 1);
  });
  Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([f, n]) => {
    console.log(`  ${f}: ${n} clientes`);
  });

  // 5. Detalle de UN cliente para ver TODOS los campos posibles con fecha
  console.log('\n=== Cliente detallado: TODOS los campos crudos ===');
  const detalle = await fetch(`${BASE}/clientes/${samples[0].id_servicio}/`, { headers });
  const d = await detalle.json();
  Object.entries(d).forEach(([k, v]) => {
    if (k.toLowerCase().includes('fecha') || k.toLowerCase().includes('corte') || k.toLowerCase().includes('pago') || k.toLowerCase().includes('hora')) {
      console.log(`  ${k} = ${JSON.stringify(v)}`);
    }
  });
})();
