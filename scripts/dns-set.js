require('dotenv/config');
const { RouterOSAPI } = require('node-routeros');

const newSize = parseInt(process.argv[2] || '20000');

(async () => {
  const conn = new RouterOSAPI({
    host: process.env.MIKROTIK_HOST,
    user: process.env.MIKROTIK_USER,
    password: process.env.MIKROTIK_PASS,
    port: 8728,
    timeout: 8,
  });
  await conn.connect();

  let dns = (await conn.write('/ip/dns/print'))[0];
  console.log(`Antes: cache-size=${dns['cache-size']} used=${dns['cache-used']}`);

  await conn.write('/ip/dns/set', '=cache-size=' + newSize);

  dns = (await conn.write('/ip/dns/print'))[0];
  console.log(`Despues: cache-size=${dns['cache-size']} used=${dns['cache-used']}`);

  await conn.close();
})();
