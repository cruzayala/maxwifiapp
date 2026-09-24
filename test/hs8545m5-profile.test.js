'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BUILTIN_ONU_MODEL_PROFILES, matchOnuModelProfile } = require('../lib/onu-model-profiles');
const { profileForDevice } = require('../lib/tr069-catalog');

test('HS8545M5 has its own profile and wins over EG8141A5 when the model is known', () => {
  const identity = { serial: 'HWTC2E16379D', manufacturer: 'Huawei', model: 'HS8545M5', firmware: 'V5R019C20S100' };
  const match = matchOnuModelProfile(BUILTIN_ONU_MODEL_PROFILES, identity);
  assert.equal(match.profile.profileKey, 'huawei-hs8545m5-v5r019');
  assert.equal(matchOnuModelProfile(BUILTIN_ONU_MODEL_PROFILES, { ...identity, model: 'EG8141A5' }).profile.model, 'EG8141A5');
});

test('HS8545M5 is certified for installation, with OMCI/TR-069 capabilities still unproven', () => {
  const profile = BUILTIN_ONU_MODEL_PROFILES.find((item) => item.model === 'HS8545M5');
  assert.equal(profile.certificationStatus, 'verified');
  assert.equal(profile.capabilities.some((item) => item.status === 'verified'), false);
  const tr069 = profileForDevice('Huawei', 'HS8545M5', 'V5R019C20S100');
  assert.equal(tr069.profileKey, 'huawei-hs8545m5-v5r019');
  assert.equal(Object.values(tr069.capabilities?.actions || tr069.actions || {}).includes('verified'), false);
});
