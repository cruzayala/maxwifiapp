const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSsid,
  deriveNetworkProfile,
  generateWifiPassword,
  isRecoverableCloudJobStatus,
  shouldResetForAbsence,
} = require('../static/wizard-utils.js');

test('derives the WAN mask and gateway from a reserved CIDR', () => {
  assert.deepEqual(deriveNetworkProfile('192.168.16.0/24'), {
    cidr: '192.168.16.0/24',
    subnetMask: '255.255.255.0',
    gateway: '192.168.16.1',
    prefix: 24,
  });
});

test('builds editable WiFi defaults without accents', () => {
  assert.equal(buildSsid('Míldred Peña', '192.168.16.22'), 'ISPMax Mildred Pena');
  const password = generateWifiPassword(Uint8Array.from({ length: 12 }, (_, index) => index));
  assert.equal(password.length, 12);
  assert.match(password, /^[A-Za-z0-9]+$/);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /[0-9]/);
});

test('never recovers a cancelled or completed cloud job', () => {
  assert.equal(isRecoverableCloudJobStatus('waiting_optical'), true);
  assert.equal(isRecoverableCloudJobStatus('in_progress'), true);
  assert.equal(isRecoverableCloudJobStatus('cancelled'), false);
  assert.equal(isRecoverableCloudJobStatus('complete'), false);
  assert.equal(isRecoverableCloudJobStatus(undefined), false);
});

test('clears a device session only after two confirmed absence scans', () => {
  assert.equal(shouldResetForAbsence('cable_disconnected', 1, false), false);
  assert.equal(shouldResetForAbsence('not_detected', 2, false), true);
  assert.equal(shouldResetForAbsence('cable_disconnected', 3, true), false);
  assert.equal(shouldResetForAbsence('network_setup_required', 3, false), false);
});
