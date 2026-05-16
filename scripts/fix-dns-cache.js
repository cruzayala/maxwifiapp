// Aumentar DNS cache del MikroTik para reducir latencia
require('dotenv/config');
const { RouterOSAPI } = require('node-routeros');

const APPLY = process.argv.includes('--apply');

const conn = new RouterOSAPI({
  host: process.env.MIKROTIK_HOST,
  user: process.env.MIKROTIK_USER,
  password: process.env.MIKROTIK_PASS,
  port: parseInt(process.env.MIKROTIK_PORT || '8728'),
  timeout: 10,
});

(async () => {
  try {
    await conn.connect();
    const dns = (await conn.write('/ip/dns/print'))[0];
    console.log('Estado actual DNS:');
    console.log('  cache-size:', dns['cache-size']);
    console.log('  cache-used:', dns['cache-used']);
    console.log('  cache-max-ttl:', dns['cache-max-ttl'] || '7d (default)');
    console.log('  servers:', dns.servers);

    console.log('\n=== CAMBIO PROPUESTO ===');
    console.log('  cache-size: 2048 → 10240 (5x mas grande)');

    if (!APPLY) {
      console.log('\nDRY RUN - para aplicar: node scripts/fix-dns-cache.js --apply');
      await conn.close();
      return;
    }

    await conn.write('/ip/dns/set', '=cache-size=10240');
    console.log('\nCambio aplicado!');
    console.log('Limpiando cache actual para empezar fresco...');
    await conn.write('/ip/dns/cache/flush');
    console.log('Cache limpiado!');

    await conn.close();
  } catch (e) {
    console.error('Error:', e.message);
    try { await conn.close(); } catch {}
  }
})();
