// Diagnostico de red del MikroTik
require('dotenv/config');
const { RouterOSAPI } = require('node-routeros');

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
    console.log('=== DIAGNOSTICO MIKROTIK ===\n');

    // 1. CPU y RAM
    const r = (await conn.write('/system/resource/print'))[0];
    console.log('CPU:', r['cpu-load'] + '%', r['cpu-load'] > 70 ? 'ALTO' : 'OK');
    console.log('Free RAM:', Math.round(parseInt(r['free-memory'])/1024/1024) + 'MB de', Math.round(parseInt(r['total-memory'])/1024/1024) + 'MB');
    console.log('Uptime:', r.uptime);
    console.log();

    // 2. Health (temperatura, voltaje)
    try {
      const health = await conn.write('/system/health/print');
      health.forEach(h => console.log('  ' + h.name + ':', h.value, h.type || ''));
      console.log();
    } catch {}

    // 3. Interfaces WAN status
    console.log('=== INTERFACES ===');
    const ifaces = await conn.write('/interface/print');
    const wanCandidates = ifaces.filter(i =>
      i.running === 'true' && (i.type === 'ether' || i.type === 'sfp' || i.type === 'vlan')
    );
    wanCandidates.slice(0, 10).forEach(i => {
      const rxMb = (parseInt(i['rx-byte'] || 0) / 1024 / 1024).toFixed(0);
      const txMb = (parseInt(i['tx-byte'] || 0) / 1024 / 1024).toFixed(0);
      console.log(`  ${i.name}: UP - RX:${rxMb}MB TX:${txMb}MB MTU:${i.mtu || '-'}`);
    });
    console.log();

    // 4. Trafico actual en cada interface (con monitor)
    console.log('=== TRAFICO ACTUAL (Mbps) ===');
    for (const iface of ['ether1', 'sfp2.1007', 'ether10'].filter(n => ifaces.find(i => i.name === n && i.running === 'true'))) {
      try {
        const t = (await conn.write('/interface/monitor-traffic', '=interface=' + iface, '=once='))[0] || {};
        const rxMbps = (parseInt(t['rx-bits-per-second'] || 0) / 1000000).toFixed(2);
        const txMbps = (parseInt(t['tx-bits-per-second'] || 0) / 1000000).toFixed(2);
        const errors = (t['rx-error']||0) + (t['tx-error']||0);
        console.log(`  ${iface}: RX ${rxMbps} Mbps | TX ${txMbps} Mbps | errors:${errors}`);
      } catch {}
    }
    console.log();

    // 5. Errores y drops en interfaces
    console.log('=== INTERFACES CON ERRORES ===');
    let hasErrors = false;
    for (const i of ifaces) {
      const rxErr = parseInt(i['rx-error'] || 0);
      const txErr = parseInt(i['tx-error'] || 0);
      const rxDrop = parseInt(i['rx-drop'] || 0);
      if (rxErr > 100 || txErr > 100 || rxDrop > 1000) {
        console.log(`  ${i.name}: rx-errors:${rxErr} tx-errors:${txErr} rx-drops:${rxDrop}`);
        hasErrors = true;
      }
    }
    if (!hasErrors) console.log('  Sin errores significativos');
    console.log();

    // 6. DNS cache stats
    try {
      const dns = (await conn.write('/ip/dns/print'))[0];
      console.log('=== DNS ===');
      console.log('  Servers:', dns.servers);
      console.log('  Cache size:', dns['cache-size']);
      console.log('  Cache used:', dns['cache-used']);
      console.log();
    } catch {}

    // 7. Conexiones activas
    try {
      const conns = await conn.write('/ip/firewall/connection/print', '=count-only=');
      console.log('=== CONEXIONES ACTIVAS ===');
      console.log('  Total:', conns);
      console.log();
    } catch {}

    // 8. Top 10 clientes consumiendo AHORA
    console.log('=== TOP 10 CLIENTES CONSUMIENDO AHORA ===');
    const queues = await conn.write('/queue/simple/print', '=stats=');
    const active = queues
      .map(q => {
        const rate = (q.rate || '0/0').split('/');
        return {
          name: q.name,
          target: q.target,
          upBps: parseInt(rate[0] || 0),
          downBps: parseInt(rate[1] || 0),
          total: parseInt(rate[0] || 0) + parseInt(rate[1] || 0),
        };
      })
      .filter(q => q.total > 0)
      .sort((a, b) => b.total - a.total);

    active.slice(0, 10).forEach(q => {
      console.log(`  ${q.name.padEnd(28)} ${q.target.padEnd(20)} DOWN:${(q.downBps/1000000).toFixed(2).padStart(7)} Mbps UP:${(q.upBps/1000000).toFixed(2).padStart(6)} Mbps`);
    });

    const totalDown = active.reduce((s, q) => s + q.downBps, 0);
    const totalUp = active.reduce((s, q) => s + q.upBps, 0);
    console.log();
    console.log(`TOTAL CLIENTES ACTIVOS: ${active.length}`);
    console.log(`BANDA TOTAL CONSUMIDA: DOWN ${(totalDown/1000000).toFixed(1)} Mbps | UP ${(totalUp/1000000).toFixed(1)} Mbps`);
    console.log();

    // 9. Ping a Google (8.8.8.8) y CloudFlare desde el MikroTik
    console.log('=== PING DESDE MIKROTIK ===');
    for (const target of ['8.8.8.8', '1.1.1.1']) {
      try {
        const ping = await conn.write('/ping', '=address=' + target, '=count=3');
        const success = ping.filter(p => p.time !== undefined).length;
        const avg = ping.filter(p => p.time).map(p => parseInt(p.time)).reduce((a,b)=>a+b,0) / Math.max(1, success);
        console.log(`  ${target}: ${success}/3 OK | promedio: ${avg.toFixed(0)}ms`);
      } catch (e) {
        console.log(`  ${target}: ERROR`);
      }
    }
    console.log();

    // 10. Routing table - default gateway status
    console.log('=== DEFAULT ROUTES ===');
    const routes = await conn.write('/ip/route/print', '?dst-address=0.0.0.0/0');
    routes.forEach(r => {
      console.log(`  via ${r.gateway} - ${r.active === 'true' ? 'ACTIVE' : 'inactive'} - distance ${r.distance}`);
    });

    await conn.close();
  } catch (e) {
    console.error('Error:', e.message);
    try { await conn.close(); } catch {}
  }
})();
