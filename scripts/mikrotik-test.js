// Test completo: ver qué info podemos extraer del MikroTik
require('dotenv/config');
const { RouterOSAPI } = require('node-routeros');

// Override desde env si existe, sino usar defaults
const conn = new RouterOSAPI({
  host: process.env.MIKROTIK_HOST || '192.168.10.1',
  user: process.env.MIKROTIK_USER || 'goku',
  password: process.env.MIKROTIK_PASS || 'MAXCELY0568',
  port: parseInt(process.env.MIKROTIK_PORT || '8728'),
  timeout: 15,
  keepalive: false,
});

async function main() {
  try {
    console.log('Conectando a', conn.host + ':' + conn.port, 'como', conn.user);
    await conn.connect();
    console.log('Conectado');

    const resource = await conn.write('/system/resource/print');
    console.log('\n=== SISTEMA ===');
    const r = resource[0] || {};
    console.log('  Modelo:', r['board-name'] || 'N/A');
    console.log('  Version:', r.version);
    console.log('  CPU:', r['cpu-load'] + '%');

    await conn.close();
  } catch (e) {
    console.error('Error:', e.message);
    try { await conn.close(); } catch {}
    process.exit(1);
  }
}

main();
