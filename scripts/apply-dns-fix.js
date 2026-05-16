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

  console.log('=== ANTES ===');
  let dns = (await conn.write('/ip/dns/print'))[0];
  console.log('  cache-size:', dns['cache-size']);
  console.log('  cache-used:', dns['cache-used']);

  console.log('\n=== APLICANDO cache-size=20000 ===');
  await conn.write('/ip/dns/set', '=cache-size=20000');
  console.log('  Aumentado a 20000');

  console.log('\n=== Limpiando cache actual (flush) ===');
  await conn.write('/ip/dns/cache/flush');
  console.log('  Cache limpiado');

  // Esperar un segundo
  await new Promise(r => setTimeout(r, 1500));

  console.log('\n=== DESPUES ===');
  dns = (await conn.write('/ip/dns/print'))[0];
  console.log('  cache-size:', dns['cache-size']);
  console.log('  cache-used:', dns['cache-used'], '/', dns['cache-size']);
  console.log('  servers:', dns.servers);

  await conn.close();
  console.log('\nLISTO - Tu red deberia notar mejora en velocidad de carga de paginas');
})();
