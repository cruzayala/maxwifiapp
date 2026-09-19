'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildClientAuditSample,
  dailyIncrement,
  floorDate,
  opticalState,
  parsePingSummary,
  utcDay,
} = require('../lib/network-audit');

const live = {
  ip: '192.168.16.20', queueName: 'cliente', uploadBps: 1000, downloadBps: 2000,
  maxUploadBps: 5_000_000, maxDownloadBps: 5_000_000, isOnline: true,
  isTransmitting: true, isDisabled: false, syncState: 'synced',
  client: { id: 10, plan: '5M/5M' },
};

test('redondea intervalos y dias en UTC', () => {
  assert.equal(floorDate('2026-08-11T04:17:59Z', 600_000).toISOString(), '2026-08-11T04:10:00.000Z');
  assert.equal(utcDay('2026-08-11T23:17:00Z').toISOString(), '2026-08-11T00:00:00.000Z');
});

test('clasifica potencia optica fuerte, saludable, debil y critica', () => {
  assert.equal(opticalState(-4.7), 'strong');
  assert.equal(opticalState(-18), 'healthy');
  assert.equal(opticalState(-28), 'weak');
  assert.equal(opticalState(-31), 'critical');
  assert.equal(opticalState(null), 'unknown');
});

test('combina trafico MikroTik y estado OLT sin ejecutar speedtest', () => {
  const sample = buildClientAuditSample(live, { onuIndex: '1/1/1:1', rack: 1, shelf: 1, pon: 1, online: true, phaseState: 'working', rxPowerDbm: -18, txPowerDbm: 2 });
  assert.equal(sample.healthState, 'stable');
  assert.equal(sample.serviceOnline, true);
  assert.equal(sample.downloadBps, 2000);
  assert.equal(sample.opticalState, 'healthy');
});

test('ONU fuera de linea domina la presencia del MikroTik', () => {
  const sample = buildClientAuditSample(live, { onuIndex: '1/1/1:2', rack: 1, shelf: 1, pon: 1, online: false, phaseState: 'LOS' });
  assert.equal(sample.healthState, 'offline');
  assert.equal(sample.stabilityScore, 0);
  assert.match(sample.issues, /onu_offline/);
});

test('genera incrementos diarios consistentes', () => {
  const sample = buildClientAuditSample(live, null);
  const increment = dailyIncrement(sample);
  assert.equal(increment.sampleCount, 1);
  assert.equal(increment.onlineSamples, 1);
  assert.equal(increment.stableSamples, 1);
  assert.equal(increment.downloadBpsSum, 2000);
});

test('lee resumen acumulado de ping RouterOS', () => {
  const summary = parsePingSummary([{ sent: '3', received: '3', 'packet-loss': '0', 'avg-rtt': '18ms650us', 'max-rtt': '19ms2us' }]);
  assert.deepEqual(summary, { sent: 3, received: 3, lossPercent: 0, avgMs: 18.65, maxMs: 19.002 });
});

