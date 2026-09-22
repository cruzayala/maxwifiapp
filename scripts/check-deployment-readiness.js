'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimeFiles = [
  'server.js',
  'lib/deployment-config.js',
];
const forbidden = [
  /isp-max-production-d0b9/i,
  /wishub-admin-production/i,
  /WISPHUB_API_KEY\s*=\s*(?!<|""|'')[A-Za-z0-9._-]{16,}/i,
  /MIKROTIK_PASS\s*=\s*(?!<|""|'')\S{8,}/i,
];

const errors = [];
for (const relative of runtimeFiles) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    errors.push(`Falta ${relative}`);
    continue;
  }
  const content = fs.readFileSync(file, 'utf8');
  for (const pattern of forbidden) if (pattern.test(content)) errors.push(`${relative} contiene ${pattern}`);
}

const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
for (const key of ['DATABASE_URL', 'PUBLIC_APP_URL', 'WISPHUB_API_KEY', 'MIKROTIK_HOST', 'OLT_HOST']) {
  if (!new RegExp(`^${key}=`, 'm').test(envExample)) errors.push(`.env.example no documenta ${key}`);
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log('Portable: sin dominios del entorno actual y con variables documentadas.');
