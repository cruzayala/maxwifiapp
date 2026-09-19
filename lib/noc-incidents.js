'use strict';

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function isServiceEligible(row) {
  if (!row?.client || row.isDisabled) return false;
  const status = String(row.client.status || '').toLowerCase();
  return !['suspendido', 'cortado', 'retirado', 'cancelado'].some(value => status.includes(value));
}

function clientGroup(row) {
  const candidates = [
    ['zone', row.client?.zone],
    ['interface', row.interface || row.client?.interface],
    ['router', row.client?.router],
  ];
  const match = candidates.find(([, value]) => String(value || '').trim());
  if (!match) return { type: 'network', key: 'sin-clasificar', label: 'Red sin clasificar' };
  const [type, value] = match;
  return { type, key: normalizeKey(value), label: String(value).trim() };
}

function severityFor(affected, ratio) {
  if (affected >= 25 || ratio >= 0.75) return 'critical';
  if (affected >= 10 || ratio >= 0.5) return 'high';
  return 'medium';
}

function buildCandidate(group, rows) {
  const offline = rows.filter(row => !row.isOnline);
  const ratio = rows.length ? offline.length / rows.length : 0;
  const ids = [...new Set(offline.map(row => Number(row.client?.id)).filter(Number.isInteger))];
  return {
    fingerprint: `presence:${group.type}:${group.key}`,
    source: 'mikrotik',
    category: 'collective_outage',
    title: `Caida colectiva en ${group.label}`,
    description: `${offline.length} de ${rows.length} clientes activos sin presencia en MikroTik`,
    severity: severityFor(offline.length, ratio),
    scopeType: group.type,
    scopeKey: group.key,
    scopeLabel: group.label,
    affectedClients: offline.length,
    affectedClientIds: ids,
    totalClients: rows.length,
    affectedRatio: ratio,
  };
}

function buildIncidentCandidates(clients, options = {}) {
  const eligible = (clients || []).filter(isServiceEligible);
  const minAffected = Math.max(2, Number(options.minAffected || 3));
  const minRatio = Math.min(1, Math.max(0.1, Number(options.minRatio || 0.3)));
  const offline = eligible.filter(row => !row.isOnline);
  const globalMin = Math.max(10, Math.ceil(eligible.length * 0.45));

  if (eligible.length && offline.length >= globalMin) {
    return [buildCandidate({ type: 'network', key: 'global', label: 'Toda la red' }, eligible)];
  }

  const groups = new Map();
  for (const row of eligible) {
    const group = clientGroup(row);
    const mapKey = `${group.type}:${group.key}`;
    if (!groups.has(mapKey)) groups.set(mapKey, { group, rows: [] });
    groups.get(mapKey).rows.push(row);
  }

  return [...groups.values()]
    .map(({ group, rows }) => buildCandidate(group, rows))
    .filter(candidate => candidate.affectedClients >= minAffected && candidate.affectedRatio >= minRatio)
    .sort((a, b) => b.affectedClients - a.affectedClients);
}

function parseAffectedClientIds(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(Number).filter(value => Number.isInteger(value) && value > 0) : [];
  } catch {
    return [];
  }
}

function nextRecoveryState(currentStreak, threshold = 2) {
  const streak = Math.max(0, Number(currentStreak) || 0) + 1;
  return { streak, recovered: streak >= Math.max(1, Number(threshold) || 2) };
}

module.exports = { buildIncidentCandidates, nextRecoveryState, normalizeKey, parseAffectedClientIds, severityFor };
