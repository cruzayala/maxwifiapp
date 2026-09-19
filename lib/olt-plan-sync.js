'use strict';

const { findInternetSpeedProfile } = require('./zte-c320');

function parseSymmetricMbps(planName) {
  const name = String(planName || '').trim();
  if (!name) return null;
  const values = [...name.matchAll(/(\d+(?:\.\d+)?)\s*(M|MB|MBPS|MEGAS?)?/gi)]
    .map((match) => ({ value: Number(match[1]), unit: String(match[2] || '').toUpperCase() }))
    .filter((item) => item.value >= 1 && item.value <= 1000);
  if (values.length < 2 || values[0].value !== values[1].value) return null;
  const hasMbpsUnit = values.slice(0, 2).some((item) => item.unit.startsWith('M'));
  if (!hasMbpsUnit && !/fi(?:bra|nra)/i.test(name)) return null;
  return Number.isInteger(values[0].value) ? values[0].value : null;
}

function parseSymmetricQueueMbps(maxLimit) {
  const match = String(maxLimit || '').match(/^(\d+)\/(\d+)$/);
  if (!match || match[1] !== match[2]) return null;
  const bps = Number(match[1]);
  if (!Number.isInteger(bps) || bps < 1_000_000 || bps % 1_000_000 !== 0) return null;
  return bps / 1_000_000;
}

function buildOltPlanSyncPreview({ wisphubPlans = [], queues = [], catalog = {} }) {
  const wisphubBySpeed = new Map();
  for (const plan of wisphubPlans) {
    const speed = parseSymmetricMbps(plan?.nombre || plan?.name);
    if (!speed) continue;
    const items = wisphubBySpeed.get(speed) || [];
    items.push({ id: plan.id, name: plan.nombre || plan.name });
    wisphubBySpeed.set(speed, items);
  }
  const mikrotikBySpeed = new Map();
  for (const queue of queues) {
    const speed = parseSymmetricQueueMbps(queue?.maxLimit || queue?.['max-limit']);
    if (!speed) continue;
    mikrotikBySpeed.set(speed, (mikrotikBySpeed.get(speed) || 0) + 1);
  }
  const commonSpeeds = [...wisphubBySpeed.keys()]
    .filter((speed) => mikrotikBySpeed.has(speed))
    .sort((a, b) => a - b);
  const plans = commonSpeeds.map((speedMbps) => {
    const tcont = findInternetSpeedProfile(catalog.tcontProfiles, speedMbps, 'up');
    const traffic = findInternetSpeedProfile(catalog.trafficProfiles, speedMbps, 'down');
    return {
      speedMbps,
      wisphubPlans: wisphubBySpeed.get(speedMbps),
      mikrotikQueues: mikrotikBySpeed.get(speedMbps),
      tcontProfile: tcont?.name || `ISPMAX-${speedMbps}M-UP`,
      trafficProfile: traffic?.name || `ISPMAX-${speedMbps}M-DOWN`,
      tcontExists: Boolean(tcont),
      trafficExists: Boolean(traffic),
      status: tcont && traffic ? 'ready' : 'missing',
    };
  });
  return {
    plans,
    summary: {
      wisphubCatalog: wisphubPlans.length,
      mikrotikQueues: queues.length,
      commonSpeeds: plans.length,
      ready: plans.filter((plan) => plan.status === 'ready').length,
      missing: plans.filter((plan) => plan.status === 'missing').length,
    },
    excluded: {
      wisphubOnlySpeeds: [...wisphubBySpeed.keys()].filter((speed) => !mikrotikBySpeed.has(speed)).sort((a, b) => a - b),
      mikrotikOnlySpeeds: [...mikrotikBySpeed.keys()].filter((speed) => !wisphubBySpeed.has(speed)).sort((a, b) => a - b),
    },
    requiredConfirmation: 'SINCRONIZAR PLANES',
  };
}

module.exports = { buildOltPlanSyncPreview, parseSymmetricMbps, parseSymmetricQueueMbps };
