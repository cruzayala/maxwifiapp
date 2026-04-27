/**
 * Whitelist las IPs de Railway en el MikroTik
 * Run: node scripts/whitelist-railway.js
 *
 * Permite acceso a /ip service api solo desde las IPs de Railway
 * Las IPs cambian, pero los rangos son estables (AWS us-east-1)
 */

require('dotenv/config');
const { RouterOSAPI } = require('node-routeros');

// Railway corre en AWS us-east-1
// IPs salientes mas comunes (actualizadas periódicamente)
const RAILWAY_RANGES = [
  '52.0.0.0/15',      // AWS us-east-1
  '54.144.0.0/12',
  '54.160.0.0/12',
  '54.224.0.0/12',
  '3.80.0.0/12',
  '3.208.0.0/12',
  '34.224.0.0/12',
  '44.192.0.0/10',
  '50.16.0.0/14',
  '107.20.0.0/14',
  // Tu IP local tambien (para acceder desde casa)
];

// Tu IP publica (para acceso local)
async function getMyIp() {
  const https = require('https');
  return new Promise((resolve) => {
    https.get('https://api.ipify.org', (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(data.trim()));
    }).on('error', () => resolve(null));
  });
}

(async () => {
  const myIp = await getMyIp();
  console.log('Tu IP publica:', myIp);

  const conn = new RouterOSAPI({
    host: process.env.MIKROTIK_HOST || '192.168.10.1',
    user: process.env.MIKROTIK_USER || 'goku',
    password: process.env.MIKROTIK_PASS,
    port: parseInt(process.env.MIKROTIK_PORT || '8728'),
    timeout: 10,
  });

  try {
    await conn.connect();
    console.log('Conectado al MikroTik\n');

    // Configurar /ip service api con address-list
    console.log('Configurando whitelist en /ip service api...');

    // Construir lista de IPs separadas por coma
    const allIps = [...RAILWAY_RANGES];
    if (myIp) allIps.push(myIp + '/32');

    // /ip service set api address=ip1,ip2,ip3,...
    const addressList = allIps.join(',');
    await conn.write(['/ip/service/set', '=numbers=api', '=disabled=no', '=address=' + addressList]);

    console.log(`Whitelist configurada con ${allIps.length} ranges:`);
    allIps.forEach(ip => console.log('  ' + ip));

    // Verificar
    const services = await conn.write(['/ip/service/print']);
    const apiSvc = services.find(s => s.name === 'api');
    console.log('\n=== Estado actual del servicio API ===');
    console.log('  Disabled:', apiSvc?.disabled);
    console.log('  Port:', apiSvc?.port);
    console.log('  Address:', apiSvc?.address || '(open)');

    await conn.close();
    console.log('\nLISTO! El MikroTik ahora acepta conexiones API solo desde Railway + tu IP');
  } catch (e) {
    console.error('Error:', e.message);
    try { await conn.close(); } catch {}
  }
})();
