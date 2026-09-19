const test = require('node:test');
const assert = require('node:assert/strict');
const { actionDefinition, profileForDevice } = require('../lib/tr069-catalog');

test('Huawei profile exposes every module but blocks uncertified destructive commands', () => {
  const profile = profileForDevice('Huawei', 'EG8141A5', 'V5R019C00S050');
  assert.equal(profile.sections.length, 11);
  assert.equal(profile.actions.find((item) => item.name === 'set_wifi').executable, true);
  assert.equal(profile.actions.find((item) => item.name === 'factory_reset').status, 'blocked');
  assert.equal(profile.actions.find((item) => item.name === 'factory_reset').executable, false);
});

test('unknown firmware receives a read-safe generic profile', () => {
  const profile = profileForDevice('Other', 'Unknown', '1.0');
  assert.equal(profile.actions.find((item) => item.name === 'set_wifi').executable, false);
  assert.equal(profile.actions.find((item) => item.name === 'refresh').executable, true);
});

test('catalog records risk and confirmation requirements', () => {
  assert.equal(actionDefinition('run_ping').risk, 'diagnostic');
  assert.equal(actionDefinition('set_wan').confirmation, true);
  assert.equal(actionDefinition('factory_reset').risk, 'destructive');
});
