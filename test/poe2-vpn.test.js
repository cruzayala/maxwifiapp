const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAddressSet, extractInstanceServers, extractLoginHosts, isPublicIpv4 } = require('../lib/poe2-vpn');

test('extracts and deduplicates valid PoE 2 instance servers', () => {
  const text = [
    'Connecting to instance server at 64.87.50.140:21360',
    'Connecting to instance server at 64.87.50.140:21360',
    'Connecting to instance server at 170.23.40.139:21360',
  ].join('\n');
  assert.deepEqual(extractInstanceServers(text), [
    { address: '64.87.50.140', port: 21360 },
    { address: '170.23.40.139', port: 21360 },
  ]);
});

test('rejects private and invalid addresses', () => {
  assert.equal(isPublicIpv4('192.168.120.1'), false);
  assert.equal(isPublicIpv4('10.2.0.1'), false);
  assert.equal(isPublicIpv4('999.1.1.1'), false);
  assert.equal(isPublicIpv4('64.87.50.140'), true);
});

test('builds /32 address entries from logs and login endpoints', () => {
  const addresses = buildAddressSet([
    'Connecting to instance server at 64.87.48.68:21360',
  ], ['172.65.204.172', '192.168.1.1']);
  assert.deepEqual([...addresses].sort(), ['172.65.204.172/32', '64.87.48.68/32']);
});

test('extracts current PoE login hosts without accepting unrelated domains', () => {
  const text = [
    'Async connecting to dal.login.pathofexile2.com:21262',
    'Connected to us.login.pathofexile.com in 15ms.',
    'Async connecting to example.com:443',
  ].join('\n');
  assert.deepEqual(extractLoginHosts(text), [
    'dal.login.pathofexile2.com',
    'us.login.pathofexile.com',
  ]);
});
