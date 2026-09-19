const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BUILTIN_ONU_MODEL_PROFILES,
  matchOnuModelProfile,
  seedOnuModelProfiles,
  sanitizeOnuModelProfile,
  wildcardMatches,
} = require('../lib/onu-model-profiles');

test('ships independent Huawei and ZTE hardware profiles', () => {
  assert.equal(BUILTIN_ONU_MODEL_PROFILES.length, 2);
  const huawei = BUILTIN_ONU_MODEL_PROFILES.find((item) => item.model === 'EG8141A5');
  const zte = BUILTIN_ONU_MODEL_PROFILES.find((item) => item.model === 'F670L');
  assert.equal(huawei.oltOnuType, 'HG8546M');
  assert.equal(zte.oltOnuType, 'F670L');
  assert.equal(zte.capabilities.find((item) => item.action === 'wifi_write').status, 'detected');
});

test('matches the F670L by serial before the local agent reports its model', () => {
  const profiles = BUILTIN_ONU_MODEL_PROFILES.map((item, index) => ({ ...item, id: index + 1, active: true }));
  const result = matchOnuModelProfile(profiles, { serial: 'ZXICCD4E795C' });
  assert.equal(result.profile.model, 'F670L');
  assert.equal(result.confidence, 'detected');
});

test('model and firmware produce a verified match', () => {
  const profiles = BUILTIN_ONU_MODEL_PROFILES.map((item, index) => ({ ...item, id: index + 1, active: true }));
  const result = matchOnuModelProfile(profiles, {
    serial: 'ZXICCD4E795C', manufacturer: 'ZTE', model: 'F670L', softwareVersion: 'V7.1.10P1T1',
  });
  assert.equal(result.profile.profileKey, 'zte-f670l-v7.1');
  assert.equal(result.confidence, 'verified');
});

test('sanitizer accepts typed capabilities and rejects arbitrary channels', () => {
  const valid = sanitizeOnuModelProfile({
    manufacturer: 'Example', model: 'ONU-1', firmwarePattern: '1.*', serialPrefixes: ['EXAM'],
    oltOnuType: 'ONU-1', capabilities: [{ action: 'reboot', channel: 'OMCI', status: 'detected' }],
  });
  assert.equal(valid.defaults.vlan, 101);
  assert.equal(valid.capabilities[0].channel, 'OMCI');
  assert.throws(() => sanitizeOnuModelProfile({
    manufacturer: 'Example', model: 'ONU-1', serialPrefixes: ['EXAM'], oltOnuType: 'ONU-1',
    capabilities: [{ action: 'reboot', channel: 'TELNET_COMMAND', status: 'verified' }],
  }), /Canal ONU no admitido/);
});

test('firmware wildcards remain anchored', () => {
  assert.equal(wildcardMatches('V7.1*', 'V7.1.10P1T1'), true);
  assert.equal(wildcardMatches('V7.1*', 'X-V7.1.10'), false);
});

test('built-in profile seed is idempotent', async () => {
  const rows = new Map();
  const prisma = {
    onuModelProfile: {
      findUnique: async ({ where }) => rows.get(where.profileKey) || null,
      create: async ({ data }) => { rows.set(data.profileKey, data); return data; },
    },
  };
  assert.deepEqual(await seedOnuModelProfiles(prisma), { created: 2, existing: 0 });
  assert.deepEqual(await seedOnuModelProfiles(prisma), { created: 0, existing: 2 });
  assert.equal(rows.size, 2);
});
