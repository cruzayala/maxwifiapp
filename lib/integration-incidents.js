'use strict';

// Una caida larga de WispHub queda registrada como incidente del NOC: con hora de
// inicio, cuantos intentos fallaron y cuando volvio. Asi el equipo sabe por que los
// clientes y las facturas no se actualizan, y hay constancia para reclamar a WispHub.

const WISPHUB_FINGERPRINT = 'integration:wisphub';
const OPEN_AFTER_MS = 10 * 60_000;
const CRITICAL_AFTER_MS = 60 * 60_000;
const ACTIVE = ['open', 'acknowledged'];

function clockTime(value, timeZone = 'America/Santo_Domingo') {
  return new Intl.DateTimeFormat('es-DO', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value));
}

function minutes(ms) {
  return Math.max(1, Math.round(ms / 60_000));
}

function describe(snapshot) {
  return `${snapshot.lastError || 'WispHub no responde'}. Sin respuesta desde las ${clockTime(snapshot.since)} `
    + `(${snapshot.consecutiveFailures} intentos). Clientes y facturas de ISP Max pueden estar desactualizados; `
    + 'MikroTik y OLT siguen funcionando.';
}

/** Abre o actualiza el incidente cuando WispHub lleva caido mas de 10 minutos. */
async function recordWisphubOutage(prisma, snapshot, { openAfterMs = OPEN_AFTER_MS, now = new Date() } = {}) {
  if (snapshot?.state !== 'down' || !snapshot.since || snapshot.downForMs < openAfterMs) return null;
  const severity = snapshot.downForMs >= CRITICAL_AFTER_MS ? 'critical' : 'high';
  const description = describe(snapshot);
  const active = await prisma.networkIncident.findFirst({ where: { fingerprint: WISPHUB_FINGERPRINT, status: { in: ACTIVE } } });
  if (active) {
    await prisma.networkIncident.update({
      where: { id: active.id },
      data: { description, severity, lastSeenAt: now, detectionCount: { increment: 1 } },
    });
    return 'updated';
  }
  await prisma.networkIncident.create({
    data: {
      fingerprint: WISPHUB_FINGERPRINT,
      source: 'wisphub',
      category: 'integration_outage',
      title: 'WispHub no responde',
      description,
      severity,
      scopeType: 'integration',
      scopeKey: 'wisphub',
      scopeLabel: 'WispHub',
      detectedAt: new Date(snapshot.since),
      lastSeenAt: now,
      events: {
        create: {
          type: 'detected',
          message: `WispHub no responde desde las ${clockTime(snapshot.since)}: ${snapshot.lastError || 'sin detalle'}`,
          createdBy: 'system',
          metadata: JSON.stringify({ code: snapshot.lastCode, failures: snapshot.consecutiveFailures }),
        },
      },
    },
  });
  return 'created';
}

/** Cierra el incidente abierto cuando WispHub vuelve a responder. */
async function resolveWisphubOutage(prisma, outage, { now = new Date() } = {}) {
  const active = await prisma.networkIncident.findMany({ where: { fingerprint: WISPHUB_FINGERPRINT, status: { in: ACTIVE } }, select: { id: true } });
  if (!active.length) return 0;
  const span = outage?.since != null && outage?.until != null ? minutes(outage.until - outage.since) : null;
  const note = span
    ? `WispHub volvio a responder a las ${clockTime(outage.until)} tras ${span} min sin servicio (${outage.failures} intentos fallidos)`
    : 'WispHub volvio a responder';
  for (const { id } of active) {
    await prisma.networkIncident.update({
      where: { id },
      data: {
        status: 'resolved', resolvedAt: now, resolvedBy: 'system', resolutionNote: note, lastSeenAt: now,
        events: { create: { type: 'auto_resolved', message: note, createdBy: 'system' } },
      },
    });
  }
  return active.length;
}

module.exports = { recordWisphubOutage, resolveWisphubOutage, WISPHUB_FINGERPRINT, OPEN_AFTER_MS };
