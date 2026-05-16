// Analiza tasa de crecimiento del DNS cache
require('dotenv/config');
const { RouterOSAPI } = require('node-routeros');

const conn = new RouterOSAPI({
  host: process.env.MIKROTIK_HOST,
  user: process.env.MIKROTIK_USER,
  password: process.env.MIKROTIK_PASS,
  port: 8728,
  timeout: 10,
});

(async () => {
  await conn.connect();

  // Estado inicial
  let dns = (await conn.write('/ip/dns/print'))[0];
  const startUsed = parseInt(dns['cache-used']);
  const startTime = Date.now();
  console.log(`Inicio: ${startUsed} entradas en cache`);
  console.log(`Capacidad: ${dns['cache-size']}`);
  console.log();

  // Sampling cada 30 segundos por 2 minutos
  const samples = [{ t: 0, used: startUsed }];

  for (let i = 1; i <= 4; i++) {
    await new Promise(r => setTimeout(r, 30000));
    dns = (await conn.write('/ip/dns/print'))[0];
    const used = parseInt(dns['cache-used']);
    const elapsed = (Date.now() - startTime) / 1000;
    samples.push({ t: elapsed, used });
    console.log(`+${Math.round(elapsed)}s: ${used} entradas (delta: +${used - startUsed})`);
  }

  // Calcular tasa
  const last = samples[samples.length - 1];
  const totalDelta = last.used - startUsed;
  const totalSeconds = last.t;
  const ratePerMinute = (totalDelta / totalSeconds) * 60;
  const ratePerHour = ratePerMinute * 60;
  const ratePerDay = ratePerHour * 24;

  console.log();
  console.log('=== TASA DE CRECIMIENTO REAL ===');
  console.log(`  Por minuto: ${ratePerMinute.toFixed(1)} entradas nuevas`);
  console.log(`  Por hora:   ${ratePerHour.toFixed(0)} entradas`);
  console.log(`  Por dia:    ${ratePerDay.toFixed(0)} entradas`);
  console.log();

  // Proyeccion de llenado
  const maxCapacity = parseInt(dns['cache-size']);
  const remaining = maxCapacity - last.used;
  const hoursToFull = ratePerHour > 0 ? remaining / ratePerHour : 999999;
  const daysToFull = hoursToFull / 24;

  console.log('=== PROYECCION HASTA LLENAR cache=' + maxCapacity + ' ===');
  console.log(`  Espacio libre actual: ${remaining} entradas`);
  console.log(`  Tiempo hasta llenar:`);
  if (daysToFull > 365) {
    console.log(`    ~${(daysToFull / 365).toFixed(1)} anos (no se llenara)`);
  } else if (daysToFull > 30) {
    console.log(`    ~${(daysToFull / 30).toFixed(1)} meses`);
  } else if (daysToFull > 1) {
    console.log(`    ~${daysToFull.toFixed(1)} dias`);
  } else {
    console.log(`    ~${hoursToFull.toFixed(1)} horas`);
  }

  console.log();
  console.log('=== Comparacion con cache antiguo de 2048 ===');
  const hoursTo2048 = ratePerHour > 0 ? 2048 / ratePerHour : 0;
  console.log(`  Tu cache de 2048 se llenaba en: ${hoursTo2048.toFixed(1)} horas (${(hoursTo2048/24).toFixed(1)} dias)`);

  await conn.close();
})();
