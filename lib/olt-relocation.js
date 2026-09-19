const { normalizeGponSerial } = require('./zte-c320');

function selectCanonicalOnuIndexes(states = [], baseInfo = []) {
  const stateByIndex = new Map(states.map((state) => [state.onuIndex, state]));
  const grouped = new Map();
  for (const inventory of baseInfo) {
    const serial = normalizeGponSerial(inventory.serial);
    if (!serial) continue;
    const state = stateByIndex.get(inventory.onuIndex) || {};
    const candidate = {
      onuIndex: inventory.onuIndex,
      online: state.online === true,
      omccEnabled: String(state.omccState || '').toLowerCase() === 'enable',
      working: /working|online/i.test(String(state.phaseState || '')),
    };
    if (!grouped.has(serial)) grouped.set(serial, []);
    grouped.get(serial).push(candidate);
  }

  const selected = new Map();
  for (const [serial, candidates] of grouped) {
    candidates.sort((left, right) => {
      const score = (item) => Number(item.online) * 4 + Number(item.omccEnabled) * 2 + Number(item.working);
      return score(right) - score(left) || left.onuIndex.localeCompare(right.onuIndex, undefined, { numeric: true });
    });
    selected.set(serial, candidates[0].onuIndex);
  }
  return selected;
}

function buildPendingPonRelocation({ pending, dbOnus = [] }) {
  const serial = normalizeGponSerial(pending?.serial);
  const targetPonIndex = String(pending?.ponIndex || '').trim();
  const locations = dbOnus
    .filter((row) => normalizeGponSerial(row.serial) === serial)
    .map((row) => ({
      onuIndex: row.onuIndex,
      ponIndex: String(row.onuIndex || '').split(':')[0],
      name: row.name || null,
      model: row.model || null,
      online: row.online === true,
      clientIdServicio: Number.isInteger(row.clientIdServicio) ? row.clientIdServicio : null,
      lastSeenAt: row.lastSeenAt || null,
    }))
    .filter((row) => row.onuIndex && row.ponIndex !== targetPonIndex);

  if (!serial || !targetPonIndex || !locations.length) return null;

  const onlineLocations = locations.filter((row) => row.online);
  const clientIds = [...new Set(locations.map((row) => row.clientIdServicio).filter(Number.isInteger))];
  const authoritative = locations.filter((row) => Number.isInteger(row.clientIdServicio));
  const candidates = authoritative.length ? authoritative : locations;
  const reasons = [];
  if (onlineLocations.length) reasons.push(`El serial sigue en linea en ${onlineLocations.map((row) => row.onuIndex).join(', ')}`);
  if (clientIds.length > 1) reasons.push('Las ubicaciones anteriores pertenecen a clientes diferentes');
  if (candidates.length !== 1) reasons.push('Existe mas de una ubicacion anterior y no se puede elegir una con seguridad');

  const previousLocation = candidates.length === 1 ? candidates[0] : null;
  return {
    type: 'pon_relocation',
    serial,
    targetPonIndex,
    allowed: reasons.length === 0,
    reasons,
    previousLocation,
    previousLocations: locations,
    clientIdServicio: clientIds.length === 1 ? clientIds[0] : previousLocation?.clientIdServicio || null,
  };
}

function buildOnuRelocationPlan({ selectedOnuIndex, serial: serialValue, states = [], baseInfo = [], dbOnus = [], unconfigured = [] }) {
  const serial = normalizeGponSerial(serialValue);
  const stateByIndex = new Map(states.map((state) => [state.onuIndex, state]));
  const matches = baseInfo
    .filter((inventory) => normalizeGponSerial(inventory.serial) === serial)
    .map((inventory) => {
      const state = stateByIndex.get(inventory.onuIndex) || {};
      const stored = dbOnus.find((row) => row.onuIndex === inventory.onuIndex) || {};
      return {
        onuIndex: inventory.onuIndex,
        name: stored.name || null,
        model: inventory.model || stored.model || null,
        serial,
        online: state.online === true,
        phaseState: state.phaseState || stored.phaseState || 'unknown',
        omccState: state.omccState || stored.omccState || null,
        clientIdServicio: Number.isInteger(stored.clientIdServicio) ? stored.clientIdServicio : null,
      };
    });
  const active = matches.filter((row) => row.online);
  const stale = matches.filter((row) => !row.online);
  const pending = unconfigured.filter((row) => normalizeGponSerial(row.serial) === serial);
  const clientIds = [...new Set(matches.map((row) => row.clientIdServicio).filter(Number.isInteger))];
  const selectedStale = stale.find((row) => row.onuIndex === selectedOnuIndex) || null;
  const staleWithClient = stale.filter((row) => Number.isInteger(row.clientIdServicio));
  const namedStale = stale.filter((row) => String(row.name || '').trim());
  const distinctStaleNames = [...new Set(namedStale.map((row) => String(row.name).trim()))];
  let identitySource = selectedStale;
  if (!identitySource && staleWithClient.length === 1) identitySource = staleWithClient[0];
  if (!identitySource && stale.length === 1) identitySource = stale[0];
  if (!identitySource && distinctStaleNames.length === 1) identitySource = namedStale[0];
  const reasons = [];
  if (!serial) reasons.push('La ONU no tiene un serial valido');
  if (!matches.length) reasons.push('El serial no aparece autorizado en el inventario actual de la OLT');
  if (active.length !== 1) reasons.push(active.length ? 'Existe mas de una ubicacion en linea para el mismo serial' : 'No existe una ubicacion en linea que pueda conservarse');
  if (!stale.length) reasons.push('No existen ubicaciones anteriores fuera de linea para retirar');
  if (pending.length) reasons.push('El serial tambien aparece pendiente de autorizacion');
  if (clientIds.length > 1) reasons.push('Las ubicaciones estan asociadas a clientes diferentes');
  if (stale.length > 1 && distinctStaleNames.length > 1 && !identitySource) {
    reasons.push('Las ubicaciones anteriores tienen nombres diferentes; seleccione la ubicacion anterior correcta');
  }

  const preservedName = String(identitySource?.name || '').trim() || null;
  const activeName = String(active[0]?.name || '').trim() || null;
  if (preservedName && preservedName !== activeName && !/^[A-Za-z0-9_.-]{1,32}$/.test(preservedName)) {
    reasons.push('El nombre de la ubicacion anterior no es valido para transferirlo automaticamente');
  }

  return {
    serial,
    selectedOnuIndex,
    allowed: reasons.length === 0,
    reasons,
    activeLocation: active.length === 1 ? active[0] : null,
    staleLocations: stale,
    pendingLocations: pending,
    clientIdServicio: clientIds.length === 1 ? clientIds[0] : null,
    identitySource,
    preservedName,
    renameRequired: Boolean(preservedName && activeName !== preservedName),
    requiredConfirmation: serial ? `LIMPIAR ${serial}` : '',
  };
}

module.exports = { selectCanonicalOnuIndexes, buildOnuRelocationPlan, buildPendingPonRelocation };
