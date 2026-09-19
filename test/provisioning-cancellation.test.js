'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProvisioningCancellationPreview } = require('../lib/provisioning-cancellation');

test('pending installation releases only an active IP reservation', () => {
  const preview = buildProvisioningCancellationPreview(
    { id: 'f8698f7f-b514-48d7-8bed-052fdef8450f', status: 'waiting_optical', stage: 'waiting_optical', clientIdServicio: null },
    { status: 'active' },
  );
  assert.equal(preview.allowed, true);
  assert.equal(preview.reservationAction, 'release');
  assert.equal(preview.requiredConfirmation, 'CANCELAR F8698F7F');
});

test('cancellation preserves a committed client service and IP', () => {
  const preview = buildProvisioningCancellationPreview(
    { id: '12345678-abcd', status: 'in_progress', stage: 'onu_configured', clientIdServicio: 1020, serial: '12345678' },
    { status: 'committed' },
  );
  assert.equal(preview.allowed, true);
  assert.equal(preview.servicePreserved, true);
  assert.equal(preview.reservationAction, 'keep_committed');
  assert.match(preview.warnings.join(' '), /WispHub/);
});

test('cancellation is blocked after the ONU changed the OLT', () => {
  const preview = buildProvisioningCancellationPreview(
    { id: '12345678-abcd', status: 'complete', stage: 'service_ready', onuIndex: '1/1/1:20' },
    { status: 'committed' },
    { onuIndex: '1/1/1:20' },
  );
  assert.equal(preview.allowed, false);
  assert.equal(preview.hasOltChanges, true);
});
