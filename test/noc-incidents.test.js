const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIncidentCandidates, nextRecoveryState, parseAffectedClientIds, severityFor } = require('../lib/noc-incidents');

function client(id, zone, online, extra = {}) {
  return {
    isOnline: online,
    isDisabled: false,
    interface: 'bridge1',
    client: { id, zone, status: 'Activo', ...extra },
  };
}

test('correlates collective outages by zone without creating one incident per client', () => {
  const rows = [
    client(1, 'Centro', false), client(2, 'Centro', false), client(3, 'Centro', false),
    client(4, 'Centro', true), client(5, 'Norte', true), client(6, 'Norte', true),
  ];
  const result = buildIncidentCandidates(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].fingerprint, 'presence:zone:centro');
  assert.equal(result[0].affectedClients, 3);
  assert.deepEqual(result[0].affectedClientIds, [1, 2, 3]);
});

test('detects a global outage instead of overlapping zone incidents', () => {
  const rows = Array.from({ length: 20 }, (_, index) => client(index + 1, index < 10 ? 'Norte' : 'Sur', index >= 10));
  const result = buildIncidentCandidates(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].fingerprint, 'presence:network:global');
  assert.equal(result[0].severity, 'high');
});

test('ignores disabled or suspended services when calculating outages', () => {
  const rows = [
    client(1, 'Centro', false),
    { ...client(2, 'Centro', false), isDisabled: true },
    client(3, 'Centro', false, { status: 'Suspendido' }),
    client(4, 'Centro', true),
  ];
  assert.deepEqual(buildIncidentCandidates(rows), []);
});

test('parses stored impacted client ids defensively', () => {
  assert.deepEqual(parseAffectedClientIds('[1,"2",null,"x"]'), [1, 2]);
  assert.deepEqual(parseAffectedClientIds('invalid'), []);
  assert.equal(severityFor(25, 0.2), 'critical');
});

test('requires two healthy readings before confirming automatic recovery', () => {
  assert.deepEqual(nextRecoveryState(0), { streak: 1, recovered: false });
  assert.deepEqual(nextRecoveryState(1), { streak: 2, recovered: true });
});
