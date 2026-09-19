// Lista clientes cuya fecha_corte cae el dia 30 (o cualquier dia que pidas).
// Tambien hace un histograma por dia del mes para entender el patron.

require('dotenv/config');
const KEY = process.env.WISPHUB_API_KEY;
const BASE = 'https://api.wisphub.io/api';
const headers = { 'Authorization': `Api-Key ${KEY}`, 'Accept': 'application/json' };

const DIA_OBJETIVO = parseInt(process.argv[2] || '30');

async function getAll() {
  const all = [];
  let offset = 0;
  while (true) {
    const r = await fetch(`${BASE}/clientes/?limit=300&offset=${offset}`, { headers, signal: AbortSignal.timeout(30000) });
    if (!r.ok) break;
    const b = await r.json();
    all.push(...(b.results || []));
    if (!b.next) break;
    offset += 300;
    if (offset > 5000) break;
  }
  return all;
}

function parseDia(fecha_corte) {
  if (!fecha_corte) return null;
  // Formato visto: "6/06/2026" o "30/06/2026"
  const m = String(fecha_corte).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (!m) return null;
  return { dia: parseInt(m[1]), mes: parseInt(m[2]), anio: parseInt(m[3]) };
}

function daysUntil(fecha_corte) {
  const p = parseDia(fecha_corte);
  if (!p) return null;
  const target = new Date(p.anio, p.mes - 1, p.dia);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

(async () => {
  console.log(`[probe] Cargando clientes...`);
  const clientes = await getAll();
  console.log(`[probe] ${clientes.length} clientes cargados\n`);

  // === Histograma por dia del mes ===
  const hist = new Map();
  let sinCorte = 0, cortados = 0, retirados = 0;
  for (const c of clientes) {
    if (!c.fecha_corte) { sinCorte++; continue; }
    if (c.estado === 'Retirado') retirados++;
    if (c.estado === 'Cortado') cortados++;
    const p = parseDia(c.fecha_corte);
    if (!p) continue;
    hist.set(p.dia, (hist.get(p.dia) || 0) + 1);
  }

  console.log('=== Distribucion por dia del mes (fecha_corte) ===');
  const sorted = Array.from(hist.entries()).sort((a, b) => a[0] - b[0]);
  for (const [dia, n] of sorted) {
    const bar = '█'.repeat(Math.min(60, n));
    console.log(`  Dia ${String(dia).padStart(2)}: ${String(n).padStart(3)} ${bar}`);
  }
  console.log(`\n  Sin fecha_corte: ${sinCorte}`);
  console.log(`  En estado Cortado: ${cortados}`);
  console.log(`  En estado Retirado: ${retirados}`);

  // === Clientes con corte el dia objetivo ===
  console.log(`\n=== Clientes con fecha_corte el dia ${DIA_OBJETIVO} ===`);
  const objetivo = clientes
    .filter(c => {
      const p = parseDia(c.fecha_corte);
      return p && p.dia === DIA_OBJETIVO;
    })
    .map(c => ({
      ...c,
      _parsed: parseDia(c.fecha_corte),
      _diasRestantes: daysUntil(c.fecha_corte),
    }))
    .sort((a, b) => (a._diasRestantes ?? 999) - (b._diasRestantes ?? 999));

  if (objetivo.length === 0) {
    console.log('Ningun cliente con esa fecha.');
    return;
  }

  console.log(`Total: ${objetivo.length} clientes\n`);
  console.log('id_servicio | nombre                              | telefono       | plan                      | precio  | estado          | corte         | dias');
  console.log('-'.repeat(170));
  objetivo.forEach(c => {
    const id = String(c.id_servicio).padStart(6);
    const nombre = (c.nombre || '').slice(0, 36).padEnd(36);
    const tel = (c.telefono || '').padEnd(14);
    const plan = ((c.plan_internet?.nombre) || '').slice(0, 25).padEnd(25);
    const precio = String(c.precio_plan || '0').padStart(6);
    const estado = (c.estado || '').padEnd(15);
    const corte = String(c.fecha_corte || '').padEnd(13);
    const dias = c._diasRestantes != null
      ? (c._diasRestantes >= 0 ? `en ${c._diasRestantes}d` : `vencido hace ${-c._diasRestantes}d`)
      : '?';
    console.log(`${id} | ${nombre} | ${tel} | ${plan} | ${precio} | ${estado} | ${corte} | ${dias}`);
  });

  // === Agrupar por mes/anio ===
  console.log('\n=== Cuando cortan exactamente (agrupado por fecha completa) ===');
  const porFecha = new Map();
  objetivo.forEach(c => {
    const k = c.fecha_corte;
    if (!porFecha.has(k)) porFecha.set(k, []);
    porFecha.get(k).push(c);
  });
  const fechasOrdenadas = Array.from(porFecha.entries()).sort((a, b) => {
    const da = parseDia(a[0]); const db = parseDia(b[0]);
    return new Date(da.anio, da.mes - 1, da.dia) - new Date(db.anio, db.mes - 1, db.dia);
  });
  fechasOrdenadas.forEach(([fecha, list]) => {
    const dias = daysUntil(fecha);
    const label = dias >= 0 ? `en ${dias} dias` : `vencido hace ${-dias} dias`;
    console.log(`  ${fecha} (${label}): ${list.length} clientes`);
  });

  // === Suma de ingreso mensual ===
  const ingreso = objetivo.reduce((s, c) => s + (parseFloat(c.precio_plan) || 0), 0);
  console.log(`\n💰 Ingreso mensual de estos clientes: RD$ ${ingreso.toLocaleString('es-DO')}`);

  // === Breakdown por estado ===
  console.log('\n=== Breakdown por estado de servicio ===');
  const porEstado = new Map();
  objetivo.forEach(c => porEstado.set(c.estado || 'sin estado', (porEstado.get(c.estado || 'sin estado') || 0) + 1));
  Array.from(porEstado.entries()).sort((a, b) => b[1] - a[1]).forEach(([e, n]) => {
    console.log(`  ${e}: ${n}`);
  });
})();
