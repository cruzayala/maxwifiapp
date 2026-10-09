'use strict';

// Copia diaria comprimida de la base SQLite en el volumen, con los ultimos 7 dias.
//
// Por que existe: solo habia el boton "Descargar respaldo" (manual). Lo que solo vive en
// ISP Max (notas, GPS, equipos, pagos registrados, incidentes, encuestas, alias) no se
// recupera de WispHub si una sincronizacion mala, un borrado o una migracion lo dana.
// Esta copia protege de eso; no protege de perder el volumen (para eso hay que bajar
// un respaldo a otro lugar o activar los respaldos del volumen en Railway).

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');

const PREFIX = 'ispmax-';
const SUFFIX = '.db.gz';
const NAME = /^ispmax-\d{4}-\d{2}-\d{2}\.db\.gz$/;

/** Crea la copia del dia (VACUUM INTO + gzip) y deja solo las `keep` mas recientes. */
async function createSnapshot(prisma, { dir, date, keep = 7 }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Fecha invalida: ${date}`);
  await fs.promises.mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, `${PREFIX}${date}${SUFFIX}`);
  const raw = path.join(dir, `.${PREFIX}${date}.db`);
  const partial = `${finalPath}.part`;
  await fs.promises.rm(raw, { force: true });
  try {
    // VACUUM INTO hace una copia consistente sin detener la app.
    await prisma.$executeRawUnsafe(`VACUUM INTO '${raw.replace(/'/g, "''")}'`);
    await pipeline(fs.createReadStream(raw), zlib.createGzip({ level: 6 }), fs.createWriteStream(partial));
    await fs.promises.rename(partial, finalPath);
  } finally {
    await fs.promises.rm(raw, { force: true });
    await fs.promises.rm(partial, { force: true });
  }
  const pruned = await pruneSnapshots(dir, keep);
  const { size } = await fs.promises.stat(finalPath);
  return { file: path.basename(finalPath), sizeBytes: size, pruned };
}

async function listSnapshots(dir) {
  let names;
  try {
    names = await fs.promises.readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const rows = [];
  for (const name of names.filter((item) => NAME.test(item))) {
    const stat = await fs.promises.stat(path.join(dir, name));
    rows.push({ file: name, date: name.slice(PREFIX.length, PREFIX.length + 10), sizeBytes: stat.size, createdAt: stat.mtime.toISOString() });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

async function pruneSnapshots(dir, keep) {
  const rows = await listSnapshots(dir);
  const old = rows.slice(Math.max(1, keep));
  for (const row of old) await fs.promises.rm(path.join(dir, row.file), { force: true });
  return old.map((row) => row.file);
}

/** Ruta segura de una copia por su nombre (solo nombres con el formato de las copias). */
function snapshotPath(dir, file) {
  return NAME.test(String(file || '')) ? path.join(dir, file) : null;
}

module.exports = { createSnapshot, listSnapshots, snapshotPath };
