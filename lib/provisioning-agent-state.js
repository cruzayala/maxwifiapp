'use strict';

const LOCAL_STATUSES = new Set(['idle', 'running', 'success', 'error']);

function sanitizeAgentMessage(value) {
  return String(value || '')
    .replace(/(password|passwd|contrasena|clave|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=***')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1***:***@')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function agentStateUpdate(current, input, now = new Date()) {
  const data = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  if (has('agentVersion')) data.agentVersion = input.agentVersion == null ? null : String(input.agentVersion).trim().slice(0, 40) || null;
  if (has('lastCompletedStep')) data.lastCompletedStep = input.lastCompletedStep == null ? null : String(input.lastCompletedStep).trim().slice(0, 80) || null;
  if (has('localStatus') && input.localStatus != null) {
    const localStatus = String(input.localStatus).trim().toLowerCase();
    if (!LOCAL_STATUSES.has(localStatus)) throw Object.assign(new Error('Estado local invalido'), { statusCode: 400 });
    data.localStatus = localStatus;
  }
  if (has('retryable')) data.retryable = input.retryable == null ? null : Boolean(input.retryable);
  if (has('errorCode')) data.errorCode = input.errorCode == null ? null : String(input.errorCode).trim().toUpperCase().replace(/[^A-Z0-9_:-]/g, '').slice(0, 80) || null;
  if (input.agentHeartbeat === true || Object.keys(data).length > 0) data.agentLastSeenAt = now;
  if (has('errorMessage')) data.errorMessage = input.errorMessage == null ? null : sanitizeAgentMessage(input.errorMessage) || null;
  if (has('progressPercent')) {
    const progress = Number(input.progressPercent);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      throw Object.assign(new Error('Progreso local invalido'), { statusCode: 400 });
    }
    data.progressPercent = Math.max(Number(current.progressPercent || 0), progress);
  }
  if (has('stageLabel')) data.stageLabel = sanitizeAgentMessage(input.stageLabel) || null;
  if (input.agentHeartbeat === true) data.heartbeatAt = now;
  return data;
}

module.exports = { LOCAL_STATUSES, sanitizeAgentMessage, agentStateUpdate };
