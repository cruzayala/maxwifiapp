const { RouterOSAPI } = require('node-routeros');

async function tryLogin(password) {
  const conn = new RouterOSAPI({
    host: '192.168.10.1',
    user: 'goku',
    password: password,
    port: 8728,
    timeout: 6,
    keepalive: false,
  });

  try {
    await conn.connect();
    console.log(`OK con password="${password}"`);
    const r = await conn.write('/system/identity/print');
    console.log('  Identidad:', r[0]?.name);
    await conn.close();
    return true;
  } catch (e) {
    console.log(`FAIL "${password}" → ${e.message}`);
    try { await conn.close(); } catch {}
    return false;
  }
}

async function main() {
  const variants = [
    'MAXCELY0568',
    'maxcely0568',
    'MAXCELYO568',
    'MAXCELY568',
    'MAXCELY 0568',
  ];

  for (const p of variants) {
    const ok = await tryLogin(p);
    if (ok) break;
    await new Promise(r => setTimeout(r, 500));
  }
}

main();
