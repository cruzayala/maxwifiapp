require('dotenv/config');
const { RouterOSAPI } = require('node-routeros');

(async () => {
  const conn = new RouterOSAPI({
    host: process.env.MIKROTIK_HOST,
    user: process.env.MIKROTIK_USER,
    password: process.env.MIKROTIK_PASS,
    port: 8728,
    timeout: 15,
  });
  await conn.connect();
  console.log('=== ANALISIS DE CPU ===\n');

  // 1. Resource general
  const r = (await conn.write('/system/resource/print'))[0];
  console.log('Modelo:', r['board-name']);
  console.log('Version:', r.version);
  console.log('CPU:', r.cpu);
  console.log('Cores:', r['cpu-count']);
  console.log('CPU frequency:', r['cpu-frequency'] + ' MHz');
  console.log('CPU load total:', r['cpu-load'] + '%');
  console.log('Architecture:', r['architecture-name']);
  console.log();

  // 2. Carga por core
  console.log('=== CARGA POR CORE ===');
  try {
    const cores = await conn.write('/system/resource/cpu/print');
    cores.forEach(c => {
      const load = parseInt(c.load || 0);
      const bar = '#'.repeat(Math.floor(load/5));
      console.log(`  CPU${c.cpu}: ${load}% ${bar}`);
    });
  } catch (e) {
    console.log('  Error:', e.message);
  }
  console.log();

  // 3. Health (temperatura)
  console.log('=== HEALTH SENSORS ===');
  const health = await conn.write('/system/health/print');
  health.forEach(h => {
    let alert = '';
    if (h.name === 'cpu-temperature') {
      const t = parseInt(h.value);
      if (t > 80) alert = ' CRITICO';
      else if (t > 75) alert = ' ALTO';
      else if (t > 65) alert = ' tibio';
      else alert = ' OK';
    }
    if (h.name === 'temperature') {
      const t = parseInt(h.value);
      if (t > 65) alert = ' ALTO';
      else alert = ' OK';
    }
    console.log(`  ${h.name}: ${h.value} ${h.type || ''}${alert}`);
  });
  console.log();

  // 4. Top procesos consumidores (script/funcion)
  console.log('=== PROCESOS ACTIVOS DEL ROUTER ===');
  try {
    const procs = await conn.write('/system/script/job/print');
    if (procs.length === 0) console.log('  No hay scripts corriendo');
    else procs.forEach(p => console.log(`  ${p['script-name']} - ${p.owner} - ${p.started}`));
  } catch {}
  console.log();

  // 5. Conteo de reglas firewall (cada paquete pasa por todas)
  const firewallStats = {};
  for (const chain of ['filter', 'nat', 'mangle']) {
    try {
      const rules = await conn.write(`/ip/firewall/${chain}/print`);
      firewallStats[chain] = rules.length;
    } catch {}
  }
  console.log('=== FIREWALL RULES (impacto en CPU) ===');
  Object.entries(firewallStats).forEach(([chain, count]) => {
    let alert = '';
    if (count > 200) alert = ' MUCHAS - puede causar CPU alto';
    else if (count > 100) alert = ' bastantes';
    console.log(`  ${chain}: ${count} reglas${alert}`);
  });
  console.log();

  // 6. Address-lists (cada match suma CPU)
  console.log('=== ADDRESS LISTS (impacto en CPU) ===');
  const lists = await conn.write('/ip/firewall/address-list/print');
  const grouped = {};
  lists.forEach(l => {
    grouped[l.list] = (grouped[l.list] || 0) + 1;
  });
  Object.entries(grouped).sort((a,b)=>b[1]-a[1]).forEach(([name, count]) => {
    console.log(`  ${name.padEnd(28)} ${count} entradas`);
  });
  const totalEntries = Object.values(grouped).reduce((a,b)=>a+b, 0);
  console.log(`  TOTAL: ${totalEntries} entradas en listas`);
  console.log();

  // 7. Conexiones activas (factor CPU)
  console.log('=== CONNECTION TRACKING ===');
  try {
    const ct = (await conn.write('/ip/firewall/connection/print', '=count-only='))[0];
    console.log('  Conexiones activas:', ct.ret || ct);
    const tracking = (await conn.write('/ip/firewall/connection/tracking/print'))[0];
    console.log('  Tracking enabled:', tracking.enabled);
    console.log('  TCP timeout established:', tracking['tcp-established-timeout']);
  } catch {}
  console.log();

  // 8. Queues (cada queue suma CPU al procesar paquetes)
  console.log('=== QUEUES ===');
  const queues = await conn.write('/queue/simple/print');
  const treeQueues = await conn.write('/queue/tree/print').catch(() => []);
  console.log(`  Simple queues: ${queues.length}`);
  console.log(`  Queue tree: ${treeQueues.length}`);
  console.log();

  // 9. Logs recientes con warnings
  console.log('=== LOGS RECIENTES (warnings/errors) ===');
  try {
    const logs = await conn.write('/log/print');
    const recent = logs.slice(-100).filter(l =>
      (l.topics || '').match(/error|warning|critical/i)
    ).slice(-10);
    if (recent.length === 0) console.log('  Sin warnings/errors recientes');
    else recent.forEach(l => console.log(`  [${l.time}] ${l.topics}: ${l.message?.substring(0, 100)}`));
  } catch {}
  console.log();

  // 10. NAT mangle stats
  console.log('=== ALERTAS Y RECOMENDACIONES ===');
  const cpuTemp = parseInt(health.find(h => h.name === 'cpu-temperature')?.value || 0);
  const cpuLoad = parseInt(r['cpu-load'] || 0);
  const fanSpeed = parseInt(health.find(h => h.name === 'fan1-speed')?.value || 0);

  if (cpuTemp > 75) {
    console.log('  CPU CALIENTE:', cpuTemp + 'C');
    console.log('    - Limpiar polvo de ventiladores con aire comprimido');
    console.log('    - Verificar ventilacion del rack/gabinete');
    console.log('    - Considerar reiniciar en horario sin trafico');
  }
  if (fanSpeed > 12000) {
    console.log('  Fan1 a maxima velocidad:', fanSpeed, 'RPM (esta luchando contra el calor)');
  }
  if (cpuLoad < 20) {
    console.log('  CPU load bajo (' + cpuLoad + '%) - calor NO es por carga');
    console.log('    - Probablemente problema fisico de enfriamiento');
  }
  if (totalEntries > 1000) {
    console.log('  Many address-list entries (' + totalEntries + ') - revisar si todas son necesarias');
  }

  await conn.close();
})();
