'use strict';

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function median(values) {
  const sorted = values.map(finiteNumber).filter((value) => value != null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function evaluateOpticalSignal(onuIndex, rxPowerDbm, previousValues = [], options = {}) {
  const rx = finiteNumber(rxPowerDbm);
  if (rx == null) return [];
  const weakThreshold = finiteNumber(options.weakThreshold) ?? -27;
  const criticalThreshold = finiteNumber(options.criticalThreshold) ?? -30;
  const dropThreshold = finiteNumber(options.dropThreshold) ?? 3;
  const alerts = [];
  if (rx <= criticalThreshold) {
    alerts.push({ type: 'critical_power', severity: 'critical', currentValue: rx, message: `Potencia RX critica: ${rx} dBm` });
  } else if (rx <= weakThreshold) {
    alerts.push({ type: 'weak_power', severity: 'warning', currentValue: rx, message: `Potencia RX baja: ${rx} dBm` });
  }
  const baseline = median(previousValues.slice(0, 10));
  if (baseline != null && baseline - rx >= dropThreshold) {
    const drop = Number((baseline - rx).toFixed(2));
    alerts.push({
      type: 'power_drop', severity: drop >= 5 ? 'critical' : 'warning', currentValue: rx,
      baselineValue: Number(baseline.toFixed(2)), message: `Caida optica de ${drop} dB respecto al historial`,
    });
  }
  return alerts.map((alert) => ({ ...alert, fingerprint: `${onuIndex}:${alert.type}`, onuIndex }));
}

function buildPonHealth(onus, capacity = 128) {
  const safeCapacity = Number.isInteger(Number(capacity)) && Number(capacity) > 0 ? Number(capacity) : 128;
  const grouped = new Map();
  for (const onu of onus) {
    const ponIndex = `${onu.rack}/${onu.shelf}/${onu.pon}`;
    const row = grouped.get(ponIndex) || {
      ponIndex, rack: onu.rack, shelf: onu.shelf, pon: onu.pon, total: 0, online: 0, offline: 0,
      linked: 0, weak: 0, critical: 0, noReading: 0, rxValues: [],
    };
    row.total += 1;
    if (onu.online) row.online += 1; else row.offline += 1;
    if (onu.clientIdServicio != null) row.linked += 1;
    const rx = finiteNumber(onu.rxPowerDbm);
    if (rx == null) row.noReading += 1;
    else {
      row.rxValues.push(rx);
      if (rx <= -30) row.critical += 1;
      else if (rx <= -27) row.weak += 1;
    }
    grouped.set(ponIndex, row);
  }
  return [...grouped.values()].sort((a, b) => a.pon - b.pon).map((row) => {
    const utilizationPercent = Math.round((row.total / safeCapacity) * 100);
    const offlinePercent = row.total ? Math.round((row.offline / row.total) * 100) : 0;
    const health = row.critical || utilizationPercent >= 90 || offlinePercent >= 25
      ? 'critical'
      : row.weak || utilizationPercent >= 70 || offlinePercent >= 10 ? 'warning' : 'healthy';
    const avgRxPowerDbm = row.rxValues.length
      ? Number((row.rxValues.reduce((sum, value) => sum + value, 0) / row.rxValues.length).toFixed(2))
      : null;
    const { rxValues, ...rest } = row;
    return { ...rest, capacity: safeCapacity, utilizationPercent, offlinePercent, avgRxPowerDbm, health };
  });
}

module.exports = { buildPonHealth, evaluateOpticalSignal, median };
