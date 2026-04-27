// Verifica estado de servicios IP en el MikroTik (sin cambiar nada)
require('dotenv/config');
const { RouterOSAPI } = require('node-routeros');

if (!process.env.MIKROTIK_HOST || !process.env.MIKROTIK_USER || !process.env.MIKROTIK_PASS) {
  console.error('Faltan variables de entorno: MIKROTIK_HOST, MIKROTIK_USER, MIKROTIK_PASS');
  process.exit(1);
}

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
    console.log('Conectado al MikroTik\n');

    const services = await conn.write('/ip/service/print');
    console.log('=== /ip service ===');
    services.forEach(s => {
      console.log(`  ${s.name.padEnd(10)} port:${s.port?.padEnd(5) || '-'} disabled:${s.disabled} address:${s.address || '(open)'}`);
    });

    console.log('\n=== Usuarios ===');
    const users = await conn.write('/user/print');
    users.forEach(u => {
      console.log(`  ${u.name} - group:${u.group} - disabled:${u.disabled}`);
    });

    await conn.close();
  } catch (e) {
    console.error('Error:', e.message);
    try { await conn.close(); } catch {}
    process.exit(1);
  }
})();
