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

  const tests = [10240, 20480, 50000, 65535, 100000];
  for (const size of tests) {
    try {
      await conn.write('/ip/dns/set', '=cache-size=' + size);
      const dns = (await conn.write('/ip/dns/print'))[0];
      console.log(`OK ${size} -> aplicado: ${dns['cache-size']}`);
    } catch (e) {
      console.log(`ERROR ${size}: ${e.message}`);
    }
  }

  // Restaurar a 2048
  await conn.write('/ip/dns/set', '=cache-size=2048');
  console.log('\nRestaurado a 2048 (sin aplicar definitivo)');
  await conn.close();
})();
