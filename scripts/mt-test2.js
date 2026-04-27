const { RouterOSAPI } = require('node-routeros');

const conn = new RouterOSAPI({
  host: '192.168.10.1',
  user: 'goku',
  password: 'MAXCELY6805',
  port: 8728,
  timeout: 10,
  keepalive: false,
});

(async () => {
  try {
    await conn.connect();
    console.log('LOGIN OK');

    const r = await conn.write('/system/resource/print');
    const id = await conn.write('/system/identity/print');
    const ifaces = await conn.write('/interface/print');
    const queues = await conn.write('/queue/simple/print');
    const addrs = await conn.write('/ip/address/print');
    const routes = await conn.write('/ip/route/print');

    console.log('\n=== SISTEMA ===');
    console.log('Identidad:', id[0]?.name);
    console.log('Modelo:', r[0]?.['board-name']);
    console.log('Version:', r[0]?.version);
    console.log('CPU:', r[0]?.['cpu-load'] + '%');
    console.log('RAM libre:', r[0]?.['free-memory'], '/', r[0]?.['total-memory']);
    console.log('Uptime:', r[0]?.uptime);

    console.log('\n=== INTERFACES (' + ifaces.length + ') ===');
    ifaces.slice(0, 10).forEach(i => {
      const status = i.running === 'true' ? 'UP' : 'DOWN';
      console.log(`  ${i.name} (${i.type}) ${status} MAC:${i['mac-address'] || 'N/A'}`);
    });

    console.log('\n=== IP ADDRESSES ===');
    addrs.forEach(a => console.log(`  ${a.address} on ${a.interface}`));

    console.log('\n=== SIMPLE QUEUES (limites de banda - ' + queues.length + ' total) ===');
    queues.slice(0, 5).forEach(q => {
      console.log(`  ${q.name}: ${q['max-limit']} → ${q.target}`);
    });

    console.log('\n=== ROUTES ===');
    routes.slice(0, 5).forEach(r => console.log(`  ${r['dst-address']} via ${r.gateway || 'directo'}`));

    await conn.close();
  } catch (e) {
    console.error('Error:', e.message);
    try { await conn.close(); } catch {}
  }
})();
