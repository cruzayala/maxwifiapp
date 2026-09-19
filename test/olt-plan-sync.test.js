'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOltPlanSyncPreview, parseSymmetricMbps, parseSymmetricQueueMbps } = require('../lib/olt-plan-sync');

test('plan parser accepts Mbps and fiber notation but rejects legacy kilobit labels', () => {
  assert.equal(parseSymmetricMbps('20M | 20M Fibra'), 20);
  assert.equal(parseSymmetricMbps('15 |15 FInra'), 15);
  assert.equal(parseSymmetricMbps('15 |15 Fibra'), 15);
  assert.equal(parseSymmetricMbps('Plan 5M/5M'), 5);
  assert.equal(parseSymmetricMbps('3300k/3300k'), null);
  assert.equal(parseSymmetricQueueMbps('10000000/10000000'), 10);
  assert.equal(parseSymmetricQueueMbps('5000000/10000000'), null);
});

test('OLT plan preview keeps only exact speeds shared by WispHub and MikroTik', () => {
  const preview = buildOltPlanSyncPreview({
    wisphubPlans: [
      { id: 1, nombre: '5M | 5M Fibra' },
      { id: 2, nombre: '10M/10M' },
      { id: 3, nombre: 'Plan 6M/6M' },
    ],
    queues: [
      { maxLimit: '5000000/5000000' },
      { maxLimit: '5000000/5000000' },
      { maxLimit: '10000000/10000000' },
      { maxLimit: '12000000/12000000' },
    ],
    catalog: {
      tcontProfiles: [{ name: 'OLD-10M-UP', definition: 'type 5 maximum 10240' }],
      trafficProfiles: [{ name: 'OLD-10M-DOWN', definition: 'sir 10240 pir 10240' }],
    },
  });
  assert.deepEqual(preview.plans.map((plan) => plan.speedMbps), [5, 10]);
  assert.equal(preview.plans[0].status, 'missing');
  assert.equal(preview.plans[0].mikrotikQueues, 2);
  assert.equal(preview.plans[1].status, 'ready');
  assert.deepEqual(preview.excluded.wisphubOnlySpeeds, [6]);
  assert.deepEqual(preview.excluded.mikrotikOnlySpeeds, [12]);
});
