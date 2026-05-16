// Setup MikroTik para la feature de encuestas forzadas (captive HTTP redirect)
// - Crea/verifica address-list "survey-pending" (vacia, las IPs se agregan via API)
// - Crea regla NAT: src-address-list=survey-pending dst-port=80 -> dst-nat al servidor de la app
//
// Uso:
//   node scripts/setup-survey-mikrotik.js [SERVER_HOST] [SERVER_PORT]
//
// Si no se da SERVER_HOST, intenta resolver el RAILWAY_PUBLIC_DOMAIN del .env
// o usa CAPTIVE_HOST como fallback.
//
// Idempotente: se puede correr varias veces sin duplicar reglas.
require('dotenv/config');
const { RouterOSAPI } = require('node-routeros');
const dns = require('dns').promises;

const LIST_SURVEY = 'survey-pending';
const NAT_COMMENT = 'WISP RD - Encuesta forzada (HTTP)';

async function resolveServerIp(input) {
  // Si es IP directa, usar tal cual
  if (/^\d+\.\d+\.\d+\.\d+$/.test(input)) return input;
  // Si es dominio, resolver
  const r = await dns.lookup(input);
  return r.address;
}

(async () => {
  const serverHostInput = process.argv[2]
    || process.env.SURVEY_SERVER_HOST
    || process.env.RAILWAY_PUBLIC_DOMAIN
    || process.env.CAPTIVE_HOST;

  const serverPort = parseInt(process.argv[3] || process.env.SURVEY_SERVER_PORT || process.env.PORT || '7400');

  if (!serverHostInput) {
    console.error('ERROR: dame el host del servidor');
    console.error('Uso: node scripts/setup-survey-mikrotik.js <HOST_O_IP> [PUERTO]');
    console.error('O define SURVEY_SERVER_HOST en .env');
    process.exit(1);
  }

  console.log('=== SETUP MIKROTIK SURVEY ===');
  console.log('Server input:', serverHostInput);
  console.log('Server port:', serverPort);

  const serverIp = await resolveServerIp(serverHostInput);
  console.log('Server IP resuelto:', serverIp);
  console.log();

  const conn = new RouterOSAPI({
    host: process.env.MIKROTIK_HOST,
    user: process.env.MIKROTIK_USER,
    password: process.env.MIKROTIK_PASS,
    port: parseInt(process.env.MIKROTIK_PORT || '8728'),
    timeout: 15,
  });
  await conn.connect();
  console.log('Conectado al MikroTik:', process.env.MIKROTIK_HOST);

  // 1. Verificar address-list existe (no se crea explicitamente, se hace al agregar IPs)
  console.log('\n[1/3] Address-list ' + LIST_SURVEY);
  const existing = await conn.write('/ip/firewall/address-list/print', `?list=${LIST_SURVEY}`);
  console.log('   Entradas actuales:', existing.length);

  // 2. Buscar/crear regla NAT
  console.log('\n[2/3] Regla NAT dst-port=80 -> ' + serverIp + ':' + serverPort);
  const natRules = await conn.write('/ip/firewall/nat/print', `?comment=${NAT_COMMENT}`);
  if (natRules.length > 0) {
    const rule = natRules[0];
    console.log('   Regla ya existe (id=' + rule['.id'] + ')');
    // Actualizar to-addresses por si cambio el IP de Railway
    if (rule['to-addresses'] !== serverIp || rule['to-ports'] !== String(serverPort)) {
      console.log('   IP/Puerto cambiaron, actualizando...');
      console.log('   ANTES: ' + rule['to-addresses'] + ':' + rule['to-ports']);
      console.log('   NUEVO: ' + serverIp + ':' + serverPort);
      await conn.write(
        '/ip/firewall/nat/set',
        '=.id=' + rule['.id'],
        '=to-addresses=' + serverIp,
        '=to-ports=' + serverPort,
      );
      console.log('   Actualizado OK');
    } else {
      console.log('   Apunta correctamente, sin cambios');
    }
  } else {
    console.log('   Creando regla nueva...');
    const res = await conn.write(
      '/ip/firewall/nat/add',
      '=chain=dstnat',
      '=protocol=tcp',
      '=dst-port=80',
      '=src-address-list=' + LIST_SURVEY,
      '=action=dst-nat',
      '=to-addresses=' + serverIp,
      '=to-ports=' + serverPort,
      '=comment=' + NAT_COMMENT,
    );
    console.log('   Creada id=' + (res[0] && res[0].ret));
  }

  // 3. Mover la regla NAT arriba de cualquier masquerade/srcnat de salida
  console.log('\n[3/3] Verificando orden de la regla NAT');
  const allNat = await conn.write('/ip/firewall/nat/print');
  const ourRule = allNat.find(r => r.comment === NAT_COMMENT);
  if (ourRule) {
    const idx = allNat.indexOf(ourRule);
    console.log('   Posicion actual:', idx, 'de', allNat.length);
    if (idx > 5) {
      console.log('   Considera moverla mas arriba si no funciona el redirect');
    }
  }

  console.log('\n=== LISTO ===');
  console.log('Configuracion aplicada:');
  console.log('  - Address-list "' + LIST_SURVEY + '" listo para recibir IPs');
  console.log('  - NAT dst-port=80 src-list=' + LIST_SURVEY + ' -> ' + serverIp + ':' + serverPort);
  console.log();
  console.log('Para probar manualmente desde Winbox/SSH:');
  console.log('  /ip firewall address-list add list=' + LIST_SURVEY + ' address=192.168.X.Y');
  console.log('  (la IP X.Y veria la encuesta al abrir un sitio HTTP)');
  console.log();
  console.log('Para usar desde la app:');
  console.log('  Ir a /clients -> clic boton "Encuesta" junto al cliente');

  await conn.close();
})().catch(e => {
  console.error('\nERROR:', e.message);
  process.exit(1);
});
