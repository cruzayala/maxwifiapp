'use strict';

// Mantenimiento de la base SQLite en el volumen de Railway.
//
// Por que existe: la base funcionaba en journal_mode=DELETE, que crea y borra un
// archivo de diario en cada escritura. El volumen de Railway no recibe TRIM desde
// el contenedor, asi que cuenta como ocupado todo bloque que alguna vez se escribio:
// con miles de escrituras al dia paso de 12 GB a 17,8 GB aunque los datos pesan
// ~200 MB. En WAL el diario es un solo archivo que se reutiliza, y la poda periodica
// mantiene la base chica.

const DAY = 86_400_000;
const LAST_RUN_KEY = 'maintenance.lastRunAt';
const LAST_RESULT_KEY = 'maintenance.lastResult';

function readConfig(env = process.env) {
  // Vacio, invalido, cero o negativo -> valor por defecto; por debajo del minimo -> minimo.
  const days = (name, fallback, min = 1) => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? Math.max(min, value) : fallback;
  };
  return {
    intervalDays: days('DB_MAINTENANCE_INTERVAL_DAYS', 15),
    runHour: Math.min(23, Math.max(0, Number(env.DB_MAINTENANCE_RUN_HOUR ?? 3))),
    // Railway corre en UTC: la hora se cuenta en la zona del negocio.
    timeZone: env.DB_MAINTENANCE_TZ || 'America/Santo_Domingo',
    syncLogDays: days('DB_KEEP_SYNC_LOG_DAYS', 30, 7),
    oltSnapshotDays: days('DB_KEEP_OLT_SNAPSHOT_DAYS', 30, 7),
    oltAlarmDays: days('DB_KEEP_CLEARED_OLT_ALARM_DAYS', 90, 7),
    tr069TelemetryDays: days('DB_KEEP_TR069_TELEMETRY_DAYS', 90, 7),
    vacuumFreeRatio: 0.1,
  };
}

const number = (value) => Number(typeof value === 'bigint' ? Number(value) : value) || 0;
const firstValue = (rows) => (Array.isArray(rows) && rows[0] ? Object.values(rows[0])[0] : null);

/** Pasa la base a WAL (es persistente en el archivo) con un diario acotado. */
async function enableWal(prisma) {
  const mode = String(firstValue(await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL')) || '').toLowerCase();
  await prisma.$queryRawUnsafe('PRAGMA journal_size_limit=67108864');
  return mode;
}

/**
 * Cambiar el modo necesita un momento sin escrituras: al arrancar, los demas ciclos
 * de la app ya usan la base y SQLite responde "database is locked". Se reintenta.
 */
async function enableWalWithRetry(prisma, { attempts = 20, delayMs = 15_000, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const mode = await enableWal(prisma);
      if (mode === 'wal') return mode;
      lastError = new Error(`SQLite quedo en journal_mode=${mode}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await wait(delayMs);
  }
  throw lastError;
}

function hourIn(date, timeZone) {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(date);
  return Number(hour) % 24;
}

/** true cuando toca correr: nunca corrio, o ya pasaron los dias y es la hora configurada. */
function isDue(lastRunAt, now, config) {
  if (!lastRunAt) return true;
  const last = new Date(lastRunAt);
  if (Number.isNaN(last.getTime())) return true;
  return now.getTime() - last.getTime() >= config.intervalDays * DAY && hourIn(now, config.timeZone) === config.runHour;
}

async function pageStats(prisma) {
  const pageCount = number(firstValue(await prisma.$queryRawUnsafe('PRAGMA page_count')));
  const pageSize = number(firstValue(await prisma.$queryRawUnsafe('PRAGMA page_size')));
  const freePages = number(firstValue(await prisma.$queryRawUnsafe('PRAGMA freelist_count')));
  return { pageCount, pageSize, freePages, bytes: pageCount * pageSize };
}

/**
 * Poda las tablas de historial que solo se leen por lo mas reciente, compacta la
 * base si quedo espacio libre y vacia el WAL. No toca clientes, facturas, pagos,
 * inventario ni respaldos.
 */
async function runMaintenance(prisma, { now = new Date(), config = readConfig(), log = () => {} } = {}) {
  const before = await pageStats(prisma);
  const cutoff = (days) => new Date(now.getTime() - days * DAY);
  const pruned = {
    syncLog: (await prisma.syncLog.deleteMany({ where: { startedAt: { lt: cutoff(config.syncLogDays) } } })).count,
    oltSnapshot: (await prisma.oltSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff(config.oltSnapshotDays) } } })).count,
    oltAlarm: (await prisma.oltAlarm.deleteMany({ where: { active: false, lastSeenAt: { lt: cutoff(config.oltAlarmDays) } } })).count,
    tr069Telemetry: (await prisma.tr069Telemetry.deleteMany({ where: { collectedAt: { lt: cutoff(config.tr069TelemetryDays) } } })).count,
  };
  log(`[maintenance] podadas ${JSON.stringify(pruned)}`);

  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
  const middle = await pageStats(prisma);
  let vacuumed = false;
  if (middle.pageCount && middle.freePages / middle.pageCount >= config.vacuumFreeRatio) {
    await prisma.$executeRawUnsafe('VACUUM');
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    vacuumed = true;
  }
  const after = await pageStats(prisma);
  const result = {
    at: now.toISOString(), pruned, vacuumed,
    sizeBeforeBytes: before.bytes, sizeAfterBytes: after.bytes,
  };
  log(`[maintenance] base ${Math.round(before.bytes / 1e6)} MB -> ${Math.round(after.bytes / 1e6)} MB${vacuumed ? ' (compactada)' : ''}`);
  return result;
}

/** Ciclo: al arrancar pasa a WAL; cada hora revisa si toca mantenimiento (cada 15 dias, 3 a.m.). */
function startMaintenanceLoop(prisma, { config = readConfig(), log = console.log, warn = console.error } = {}) {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const [journal] = await prisma.$queryRawUnsafe('PRAGMA journal_mode');
      if (String(Object.values(journal || {})[0] || '').toLowerCase() !== 'wal') await enableWal(prisma).catch(() => {});
      const last = await prisma.appSetting.findUnique({ where: { key: LAST_RUN_KEY } });
      const now = new Date();
      if (!isDue(last?.value, now, config)) return;
      const result = await runMaintenance(prisma, { now, config, log });
      await saveResult(prisma, result);
    } catch (error) {
      warn('[maintenance] error:', error.message);
    } finally {
      running = false;
    }
  };

  enableWalWithRetry(prisma)
    .then((mode) => log(`[maintenance] journal_mode=${mode}; limpieza cada ${config.intervalDays} dias a las ${config.runHour}:00 (${config.timeZone})`))
    .catch((error) => warn('[maintenance] no se pudo activar WAL:', error.message));
  // Primera revision a los 5 minutos del arranque (si nunca corrio, corre ahi).
  const first = setTimeout(check, 5 * 60_000);
  const timer = setInterval(check, 60 * 60_000);
  first.unref?.();
  timer.unref?.();
  return { check, stop: () => { clearTimeout(first); clearInterval(timer); } };
}

async function saveResult(prisma, result) {
  for (const [key, value] of [[LAST_RUN_KEY, result.at], [LAST_RESULT_KEY, JSON.stringify(result)]]) {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value, category: 'maintenance', description: 'Mantenimiento automatico de la base' },
      update: { value },
    });
  }
}

async function maintenanceStatus(prisma, config = readConfig()) {
  const [mode, stats, lastResult] = await Promise.all([
    prisma.$queryRawUnsafe('PRAGMA journal_mode'),
    pageStats(prisma),
    prisma.appSetting.findUnique({ where: { key: LAST_RESULT_KEY } }),
  ]);
  let last = null;
  try { last = lastResult ? JSON.parse(lastResult.value) : null; } catch { last = null; }
  return {
    journalMode: String(firstValue(mode) || ''), databaseBytes: stats.bytes, freePages: stats.freePages,
    intervalDays: config.intervalDays, runHour: config.runHour, last,
    nextRunAfter: last ? new Date(new Date(last.at).getTime() + config.intervalDays * DAY).toISOString() : null,
  };
}

module.exports = {
  readConfig, enableWal, enableWalWithRetry, isDue, runMaintenance, startMaintenanceLoop, saveResult, maintenanceStatus,
};
