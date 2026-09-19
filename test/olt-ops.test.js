'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPonHealth, evaluateOpticalSignal, median } = require('../lib/olt-ops');

test('optical evaluator distinguishes weak, critical and sudden drops', () => {
  assert.equal(median([-20, -22, -21]), -21);
  const weak = evaluateOpticalSignal('1/1/1:1', -28, [-24, -24.2, -23.8]);
  assert.deepEqual(weak.map((alert) => alert.type).sort(), ['power_drop', 'weak_power']);
  const critical = evaluateOpticalSignal('1/1/1:1', -31, [-30.5, -30.8]);
  assert.deepEqual(critical.map((alert) => alert.type), ['critical_power']);
  assert.deepEqual(evaluateOpticalSignal('1/1/1:1', -23, [-23.1, -22.8]), []);
  assert.deepEqual(evaluateOpticalSignal('1/1/1:1', null, [-23.1, -22.8]), []);
});

test('PON health reports capacity, signal and offline pressure', () => {
  const pons = buildPonHealth([
    { rack: 1, shelf: 1, pon: 2, online: true, clientIdServicio: 10, rxPowerDbm: -22 },
    { rack: 1, shelf: 1, pon: 2, online: false, clientIdServicio: null, rxPowerDbm: -31 },
  ], 4);
  assert.equal(pons[0].utilizationPercent, 50);
  assert.equal(pons[0].critical, 1);
  assert.equal(pons[0].health, 'critical');
  assert.equal(pons[0].avgRxPowerDbm, -26.5);
});

test('PON health excludes missing optical readings from its average', () => {
  const [pon] = buildPonHealth([
    { rack: 1, shelf: 1, pon: 1, online: true, clientIdServicio: 1, rxPowerDbm: -20 },
    { rack: 1, shelf: 1, pon: 1, online: true, clientIdServicio: 2, rxPowerDbm: null },
  ]);
  assert.equal(pon.avgRxPowerDbm, -20);
  assert.equal(pon.noReading, 1);
});
