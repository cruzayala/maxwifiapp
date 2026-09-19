require('dotenv/config');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.WISPHUB_API_KEY;

function csv(value) {
  const text = value == null ? '' : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

async function main() {
  if (!API_KEY) throw new Error('Falta WISPHUB_API_KEY');

  const clients = [];
  let offset = 0;
  for (let page = 0; page < 50; page++) {
    const url = `https://api.wisphub.io/api/clientes/?limit=100${offset ? `&offset=${offset}` : ''}`;
    const response = await fetch(url, {
      headers: { Authorization: `Api-Key ${API_KEY}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`WispHub HTTP ${response.status}`);
    const body = await response.json();
    clients.push(...(body.results || []));
    if (!body.next) break;
    offset += 100;
  }

  clients.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }));

  const headers = [
    'ID servicio', 'Nombre WispHub', 'Usuario WispHub', 'Numero actual',
    'Nombre nuevo', 'Numero nuevo', 'IP', 'Estado', 'Plan',
  ];
  const rows = [headers.map(csv).join(',')];
  for (const client of clients) {
    rows.push([
      client.id_servicio,
      client.nombre,
      client.usuario_rb,
      client.telefono || client.phone || client.celular || client.whatsapp || '',
      '',
      '',
      client.ip,
      client.estado,
      client.plan_internet?.nombre || '',
    ].map(csv).join(','));
  }

  const outputDir = path.join(process.cwd(), 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'clientes_wisphub_plantilla.csv');
  fs.writeFileSync(outputPath, `\ufeff${rows.join('\r\n')}\r\n`, 'utf8');

  console.log(JSON.stringify({
    outputPath,
    clients: clients.length,
    withPhone: clients.filter((c) => c.telefono || c.phone || c.celular || c.whatsapp).length,
    columns: headers,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
