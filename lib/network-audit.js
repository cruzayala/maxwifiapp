'use strict';

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function floorDate(date, intervalMs) {
  const value = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const safeInterval = Math.max(60_000, finiteNumber(intervalMs, 600_000));
  return new Date(Math.floor(value / safeInterval) * safeInterval);
}

function utcDay(date) {
  const value = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function opticalState(rxPowerDbm) {
  if (rxPowerDbm == null || !Number.isFinite(Number(rxPowerDbm))) return 'unknown';
  const rx = Number(rxPowerDbm);
  if (rx <= -30) return 'critical';
  if (rx <= -27) return 'weak';
  if (rx > -8) return 'strong';
  return 'healthy';
}

function buildClientAuditSample(live, onu = null) {
  if (!live?.client?.id) throw new Error('La muestra requiere un cliente vinculado');
  const linkedOnu = Boolean(onu);
  const serviceOnline = linkedOnu ? Boolean(onu.online) : Boolean(live.isOnline);
  const opticState = opticalState(onu?.rxPowerDbm);
  const issues = [];

  if (!serviceOnline) issues.push(linkedOnu ? 'onu_offline' : 'mikrotik_offline');
  if (live.isDisabled) issues.push('queue_disabled');
  if (live.syncState && live.syncState !== 'synced') issues.push(live.syncState);
  if (opticState !== 'healthy' && opticState !== 'unknown') issues.push(`optical_${opticState}`);

  let healthState = 'stable';
  let stabilityScore = 100;
  if (!serviceOnline) {
    healthState = 'offline';
    stabilityScore = 0;
  } else if (issues.length) {
    healthState = 'degraded';
    stabilityScore = opticState === 'critical' ? 30 : 65;
  }

  return {
    idServicio: Number(live.client.id),
    ip: live.ip || null,
    planName: live.client.plan || null,
    queueName: live.queueName || null,
    uploadBps: Math.max(0, finiteNumber(live.uploadBps)),
    downloadBps: Math.max(0, finiteNumber(live.downloadBps)),
    maxUploadBps: Math.max(0, finiteNumber(live.maxUploadBps)),
    maxDownloadBps: Math.max(0, finiteNumber(live.maxDownloadBps)),
    mikrotikOnline: Boolean(live.isOnline),
    transmitting: Boolean(live.isTransmitting),
    queueDisabled: Boolean(live.isDisabled),
    syncState: live.syncState || 'unknown',
    onuIndex: onu?.onuIndex || null,
    ponIndex: onu ? `${onu.rack}/${onu.shelf}/${onu.pon}` : null,
    onuOnline: linkedOnu ? Boolean(onu.online) : null,
    phaseState: onu?.phaseState || null,
    rxPowerDbm: onu?.rxPowerDbm == null ? null : finiteNumber(onu.rxPowerDbm, null),
    txPowerDbm: onu?.txPowerDbm == null ? null : finiteNumber(onu.txPowerDbm, null),
    opticalState: opticState,
    serviceOnline,
    healthState,
    stabilityScore,
    issues: issues.join(','),
  };
}

function parsePingSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const summary = [...list].reverse().find((row) => row && row['packet-loss'] != null) || null;
  const parseDurationMs = (value) => {
    const text = String(value || '');
    const match = text.match(/^(?:(\d+)ms)?(?:(\d+)us)?$/);
    if (!match) return null;
    return finiteNumber(match[1]) + finiteNumber(match[2]) / 1000;
  };
  return {
    sent: finiteNumber(summary?.sent),
    received: finiteNumber(summary?.received),
    lossPercent: finiteNumber(String(summary?.['packet-loss'] || '').replace('%', ''), null),
    avgMs: parseDurationMs(summary?.['avg-rtt']),
    maxMs: parseDurationMs(summary?.['max-rtt']),
  };
}

function dailyIncrement(sample) {
  const online = Boolean(sample.serviceOnline);
  return {
    sampleCount: 1,
    onlineSamples: online ? 1 : 0,
    stableSamples: sample.healthState === 'stable' ? 1 : 0,
    degradedSamples: sample.healthState === 'degraded' ? 1 : 0,
    offlineSamples: sample.healthState === 'offline' ? 1 : 0,
    uploadBpsSum: finiteNumber(sample.uploadBps),
    downloadBpsSum: finiteNumber(sample.downloadBps),
    peakUploadBps: finiteNumber(sample.uploadBps),
    peakDownloadBps: finiteNumber(sample.downloadBps),
    rxPowerSum: sample.rxPowerDbm == null ? 0 : finiteNumber(sample.rxPowerDbm),
    rxPowerSamples: sample.rxPowerDbm == null ? 0 : 1,
    minRxPowerDbm: sample.rxPowerDbm == null ? null : finiteNumber(sample.rxPowerDbm, null),
    maxRxPowerDbm: sample.rxPowerDbm == null ? null : finiteNumber(sample.rxPowerDbm, null),
  };
}

module.exports = {
  buildClientAuditSample,
  dailyIncrement,
  finiteNumber,
  floorDate,
  opticalState,
  parsePingSummary,
  utcDay,
};

