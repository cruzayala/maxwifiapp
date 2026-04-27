// Verifica firewall sin modificar
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
  timeout: 15,
});

(async () => {
  try {
    await conn.connect();

    console.log('=== Address Lists ===');
    const lists = await conn.write('/ip/firewall/address-list/print');
    const grouped = {};
    lists.forEach(l => {
      grouped[l.list] = grouped[l.list] || [];
      grouped[l.list].push(l.address);
    });
    Object.entries(grouped).forEach(([name, ips]) => {
      console.log(`  [${name}] (${ips.length})`);
    });

    console.log('\n=== Firewall Input Rules ===');
    const rules = await conn.write('/ip/firewall/filter/print', '?chain=input');
    rules.forEach((r, i) => {
      const parts = [];
      if (r.protocol) parts.push(`proto=${r.protocol}`);
      if (r['dst-port']) parts.push(`dst-port=${r['dst-port']}`);
      if (r['src-address']) parts.push(`src=${r['src-address']}`);
      if (r['src-address-list']) parts.push(`src-list=${r['src-address-list']}`);
      console.log(`  [${i}] ${r.action.toUpperCase().padEnd(8)} ${parts.join(' ')}`);
    });

    await conn.close();
  } catch (e) {
    console.error('Error:', e.message);
    try { await conn.close(); } catch {}
    process.exit(1);
  }
})();
