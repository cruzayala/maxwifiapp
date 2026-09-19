'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { agentStateUpdate, sanitizeAgentMessage } = require('../lib/provisioning-agent-state');

test('agent errors are sanitized before storing them in Railway', () => {
  assert.equal(
    sanitizeAgentMessage('password=secret123\nURL http://admin:private@192.168.1.1'),
    'password=*** URL http://***:***@192.168.1.1',
  );
});

test('agent state accepts durable retry metadata and heartbeat', () => {
  const now = new Date('2026-08-10T05:00:00.000Z');
  const data = agentStateUpdate({}, {
    agentVersion: '1.5.5', lastCompletedStep: 'wan', localStatus: 'error',
    retryable: true, errorCode: 'onu_timeout', agentHeartbeat: true,
  }, now);
  assert.deepEqual(data, {
    agentVersion: '1.5.5', lastCompletedStep: 'wan', localStatus: 'error',
    retryable: true, errorCode: 'ONU_TIMEOUT', agentLastSeenAt: now, heartbeatAt: now,
  });
});

test('agent progress is monotonic and validates bounds', () => {
  assert.equal(agentStateUpdate({ progressPercent: 60 }, { progressPercent: 40 }).progressPercent, 60);
  assert.equal(agentStateUpdate({ progressPercent: 60 }, { progressPercent: 75 }).progressPercent, 75);
  assert.throws(() => agentStateUpdate({}, { progressPercent: 101 }), /Progreso local invalido/);
});

test('agent state rejects unknown local states', () => {
  assert.throws(() => agentStateUpdate({}, { localStatus: 'maybe' }), /Estado local invalido/);
});
