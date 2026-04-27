/**
 * Configura el MikroTik para aceptar conexiones API desde IPs especificas.
 * Funciona para cualquier proveedor: Railway, Render, Vercel, Tu IP, etc.
 *
 * Uso:
 *   1. Define ALLOWED_IPS en .env (separados por coma)
 *   2. node scripts/setup-mikrotik-access.js [--apply]
 *
 * Sin --apply hace DRY RUN (solo muestra cambios)
 * Con --apply ejecuta los cambios
 */

require('dotenv/config');
const { RouterOSAPI } = require('node-routeros');
const https = require('https');

if (!process.env.MIKROTIK_HOST || !process.env.MIKROTIK_USER || !process.env.MIKROTIK_PASS) {
  console.error('Faltan variables: MIKROTIK_HOST, MIKROTIK_USER, MIKROTIK_PASS');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const ADDRESS_LIST_NAME = 'app-api-allowed';
const RULE_COMMENT = 'WispHubApp_Allow_API';

// IPs permitidas desde env var (separadas por coma)
const allowedIps = (process.env.ALLOWED_IPS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!allowedIps.length) {
  console.error('Define ALLOWED_IPS en .env con las IPs separadas por coma');
  console.error('Ejemplo: ALLOWED_IPS="35.160.120.126,44.233.151.27,154.88.128.163/32"');
  process.exit(1);
}

function getMyIp() {
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
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   Setup MikroTik Access - ${APPLY ? 'APPLY MODE' : 'DRY RUN'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const ipsToAllow = [...new Set([...allowedIps, ...(myIp ? [myIp + '/32'] : [])])];
  console.log('IPs a permitir:');
  ipsToAllow.forEach(ip => console.log(`  - ${ip}`));

  const conn = new RouterOSAPI({
    host: process.env.MIKROTIK_HOST,
    user: process.env.MIKROTIK_USER,
    password: process.env.MIKROTIK_PASS,
    port: parseInt(process.env.MIKROTIK_PORT || '8728'),
    timeout: 10,
  });

  try {
    await conn.connect();
    console.log('\nConectado al MikroTik\n');

    // 1. Verificar address-list actual
    const existingList = await conn.write('/ip/firewall/address-list/print', `?list=${ADDRESS_LIST_NAME}`);
    const existingIps = new Set(existingList.map(e => e.address));
    const toAdd = ipsToAllow.filter(ip => !existingIps.has(ip));

    console.log(`Address-list "${ADDRESS_LIST_NAME}":`);
    console.log(`  Existente: ${existingList.length} entradas`);
    console.log(`  A agregar: ${toAdd.length} entradas`);

    // 2. Verificar regla del firewall
    const allRules = await conn.write('/ip/firewall/filter/print');
    const existingRule = allRules.find(r =>
      r['src-address-list'] === ADDRESS_LIST_NAME && r.action === 'accept'
    );
    console.log(`\nRegla firewall: ${existingRule ? 'YA EXISTE' : 'A CREAR'}`);

    // 3. Verificar servicio API
    const services = await conn.write('/ip/service/print');
    const apiSvc = services.find(s => s.name === 'api');
    const currentApiAddrs = (apiSvc?.address || '').split(',').filter(Boolean);
    const newApiAddrs = [...new Set([...currentApiAddrs, ...ipsToAllow])];
    console.log(`\nServicio API:`);
    console.log(`  Address actual: ${currentApiAddrs.length} entradas`);
    console.log(`  Nuevo: ${newApiAddrs.length} entradas`);

    if (!APPLY) {
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('   DRY RUN - No se aplicaron cambios');
      console.log('   Para aplicar: node scripts/setup-mikrotik-access.js --apply');
      console.log('═══════════════════════════════════════════════════════════');
      await conn.close();
      return;
    }

    // APLICAR CAMBIOS
    console.log('\n=== APLICANDO CAMBIOS ===\n');

    // Add IPs to address-list
    for (const ip of toAdd) {
      await conn.write('/ip/firewall/address-list/add',
        `=list=${ADDRESS_LIST_NAME}`,
        `=address=${ip}`,
        `=comment=Auto-managed by app`
      );
      console.log(`  + ${ip} agregada al address-list`);
    }

    // Crear regla de firewall si no existe (en posicion 0)
    if (!existingRule) {
      await conn.write('/ip/firewall/filter/add',
        '=chain=input',
        '=action=accept',
        '=protocol=tcp',
        `=dst-port=${process.env.MIKROTIK_PORT || '8728'}`,
        `=src-address-list=${ADDRESS_LIST_NAME}`,
        `=comment=${RULE_COMMENT}`,
        '=place-before=0'
      );
      console.log('  + Regla ACCEPT creada en posicion 0');
    }

    // Update servicio API
    if (newApiAddrs.length > currentApiAddrs.length) {
      await conn.write('/ip/service/set',
        '=numbers=api',
        `=address=${newApiAddrs.join(',')}`
      );
      console.log(`  + Servicio API actualizado con ${newApiAddrs.length} address`);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('   LISTO - MikroTik configurado para aceptar API');
    console.log('═══════════════════════════════════════════════════════════');

    await conn.close();
  } catch (e) {
    console.error('Error:', e.message);
    try { await conn.close(); } catch {}
    process.exit(1);
  }
})();
