'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { metricsNeedWrite } = require('../lib/client-metrics');

const stored = { creditScore: 80, creditTier: 'BUENO', creditFactors: '[]', consumptionTier: 'NORMAL', consumptionMb30d: 120_000 };

test('unchanged metrics are not written again', () => {
  assert.equal(metricsNeedWrite(stored, { ...stored }), false);
  // El consumo subio 300 MB sobre 120 GB: no vale una escritura.
  assert.equal(metricsNeedWrite(stored, { ...stored, consumptionMb30d: 120_300 }), false);
});

test('a change in score, tier or factors is always written', () => {
  assert.equal(metricsNeedWrite(stored, { ...stored, creditScore: 75 }), true);
  assert.equal(metricsNeedWrite(stored, { ...stored, creditTier: 'REGULAR' }), true);
  assert.equal(metricsNeedWrite(stored, { ...stored, creditFactors: '[{"key":"factura_pendiente"}]' }), true);
  assert.equal(metricsNeedWrite(stored, { ...stored, consumptionTier: 'INTENSIVO' }), true);
});

test('consumption is written when it moves at least 1 GB or 5 %, or when the counter resets', () => {
  assert.equal(metricsNeedWrite(stored, { ...stored, consumptionMb30d: 121_100 }), true, '1.1 GB more');
  const small = { ...stored, consumptionMb30d: 2_000 };
  assert.equal(metricsNeedWrite(small, { ...small, consumptionMb30d: 2_050 }), false, '2.5 % of a small user');
  assert.equal(metricsNeedWrite(small, { ...small, consumptionMb30d: 2_120 }), true, '6 % of a small user');
  assert.equal(metricsNeedWrite(stored, { ...stored, consumptionMb30d: 50 }), true, 'queue counters reset');
  assert.equal(metricsNeedWrite(stored, { ...stored, consumptionMb30d: null }), true, 'queue disappeared');
  assert.equal(metricsNeedWrite({ ...stored, consumptionMb30d: null }, { ...stored, consumptionMb30d: null }), false);
  assert.equal(metricsNeedWrite(null, stored), true, 'never computed before');
});
