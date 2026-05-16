// Toma una muestra rapida y se desconecta
require('dotenv/config');
const { RouterOSAPI } = require('node-routeros');

(async () => {
  const conn = new RouterOSAPI({
    host: process.env.MIKROTIK_HOST,
    user: process.env.MIKROTIK_USER,
    password: process.env.MIKROTIK_PASS,
    port: 8728,
    timeout: 8,
  });
  await conn.connect();
  const dns = (await conn.write('/ip/dns/print'))[0];
  const ts = new Date().toLocaleTimeString();
  console.log(`${ts} - used:${dns['cache-used']} / ${dns['cache-size']}`);
  await conn.close();
})();
