require('dotenv/config');
const { RouterOSAPI } = require('node-routeros');

const conn = new RouterOSAPI({
  host: process.env.MIKROTIK_HOST,
  user: process.env.MIKROTIK_USER,
  password: process.env.MIKROTIK_PASS,
  port: parseInt(process.env.MIKROTIK_PORT || '8728'),
  timeout: 15,
});

const FLOW_IP = '192.168.16.23/32';
const MILDRED_IP = '192.168.16.57/32';
const ESCUELA_IP = '192.168.10.61/32';

function normalized(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function setQueue(id, ...fields) {
  return conn.write('/queue/simple/set', `=.id=${id}`, ...fields);
}

async function main() {
  await conn.connect();
  const queues = await conn.write('/queue/simple/print');
  const changes = [];

  const flowQueues = queues.filter((q) => q.target === FLOW_IP);
  const flowCorrect = flowQueues.find((q) => normalized(q.name) === 'flow tonny');
  if (!flowCorrect) throw new Error('No se encontro la cola correcta Flow Tonny');

  if (flowCorrect['max-limit'] !== '10000000/10000000' || flowCorrect.disabled === 'true') {
    await setQueue(flowCorrect['.id'], '=max-limit=10000000/10000000', '=disabled=no');
    changes.push(`Flow Tonny: limite 10M/10M y habilitada (${flowCorrect['.id']})`);
  }
  for (const q of flowQueues.filter((item) => item['.id'] !== flowCorrect['.id'] && item.disabled !== 'true')) {
    await setQueue(q['.id'], '=disabled=yes', '=comment=Duplicada; reemplazada por Flow Tonny');
    changes.push(`Flow Tonny: duplicada deshabilitada ${q.name} (${q['.id']})`);
  }

  const mildredQueues = queues.filter((q) => q.target === MILDRED_IP && q.disabled !== 'true');
  for (const q of mildredQueues) {
    await setQueue(q['.id'], '=disabled=yes', '=comment=Huerfana; sin cliente WispHub confirmado');
    changes.push(`Mildred: cola huerfana deshabilitada (${q['.id']})`);
  }

  const escuelaQueues = queues.filter((q) => q.target === ESCUELA_IP && q.disabled !== 'true');
  if (escuelaQueues.length === 0) {
    const result = await conn.write(
      '/queue/simple/add',
      '=name=escuela primaria',
      `=target=${ESCUELA_IP}`,
      '=max-limit=12000000/12000000',
      '=comment=WispHub #78 - plan 12M/12M',
    );
    changes.push(`Escuela primaria: cola creada 12M/12M (${result[0]?.ret || 'sin id'})`);
  }

  const after = await conn.write('/queue/simple/print');
  console.log(JSON.stringify({ ok: true, changes, queues: after.map((q) => ({ id: q['.id'], name: q.name, target: q.target, maxLimit: q['max-limit'], disabled: q.disabled === 'true' })) }, null, 2));
  await conn.close();
}

main().catch(async (error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  try { await conn.close(); } catch {}
  process.exitCode = 1;
});
