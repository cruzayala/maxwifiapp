'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mobileBridgeSession } = require('../lib/mobile-bridge');

const hash = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const token = 'a'.repeat(64);
const now = new Date('2026-09-22T12:00:00Z');
function fixture({ session = {}, user = {} } = {}) {
  const u = { id: 7, username: 'tec', role: 'tecnico', isActive: true, passwordHash: 'h1', ...user };
  const s = { id: 's1', userId: 7, accessHash: hash(token), revokedAt: null, passwordStamp: hash('h1'),
    expiresAt: new Date('2026-10-01T00:00:00Z'), accessExpiresAt: new Date('2026-09-22T12:10:00Z'), ...session };
  return {
    mobileSession: { findUnique: async ({ where }) => (where.accessHash === s.accessHash ? s : null) },
    user: { findUnique: async ({ where }) => (where.id === u.id ? u : null) },
  };
}

test('bridge accepts a valid mobile access token with the user role', async () => {
  const result = await mobileBridgeSession(fixture(), token, now);
  assert.deepEqual(result.session, { userId: 7, username: 'tec', role: 'tecnico', mobileSessionId: 's1', expiresAt: Date.parse('2026-09-22T12:10:00Z') });
});

test('bridge rejects revoked, expired, inactive and password-changed sessions', async () => {
  for (const variant of [
    { session: { revokedAt: now } },
    { session: { expiresAt: new Date('2026-09-01T00:00:00Z') } },
    { user: { isActive: false } },
    { user: { passwordHash: 'h2' } },
    { user: { role: 'root' } },
  ]) {
    const result = await mobileBridgeSession(fixture(variant), token, now);
    assert.equal(result.error.code, 'SESSION_REVOKED');
  }
  assert.equal((await mobileBridgeSession(fixture(), 'b'.repeat(64), now)).error.code, 'SESSION_REVOKED');
});

test('bridge asks to refresh an expired access token and rejects malformed ones', async () => {
  const expired = await mobileBridgeSession(fixture({ session: { accessExpiresAt: new Date('2026-09-22T11:00:00Z') } }), token, now);
  assert.equal(expired.error.code, 'ACCESS_EXPIRED');
  assert.equal((await mobileBridgeSession(fixture(), 'short', now)).error.code, 'ACCESS_EXPIRED');
});
