function normalizeSerial(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeIdentity(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/@maxwifird.*$/, '')
    .replace(/[^a-z0-9]/g, '');
}

function addIndexValue(index, key, client) {
  if (!key) return;
  if (!index.has(key)) index.set(key, new Map());
  index.get(key).set(client.idServicio, client);
}

function indexValues(index, key) {
  return [...(index.get(key)?.values() || [])];
}

function conflictDto(onu, reason, candidates = []) {
  return {
    onuIndex: onu.onuIndex,
    onuName: onu.name || null,
    serial: onu.serial || null,
    reason,
    candidates: candidates.map((client) => ({
      idServicio: client.idServicio,
      nombre: client.nombre,
      usuario: client.usuario || null,
      ip: client.ip || null,
    })),
  };
}

function buildOltAssociationPlan(onus, clients) {
  const serialIndex = new Map();
  const identityIndex = new Map();
  const alreadyAssigned = new Set();

  for (const onu of onus) {
    if (Number.isInteger(onu.clientIdServicio)) alreadyAssigned.add(onu.clientIdServicio);
  }
  for (const client of clients) {
    addIndexValue(serialIndex, normalizeSerial(client.snOnu), client);
    for (const field of ['usuario', 'nombre', 'aliasNombre']) {
      const identity = normalizeIdentity(client[field]);
      if (identity.length >= 4) addIndexValue(identityIndex, identity, client);
    }
  }

  const provisional = [];
  const conflicts = [];
  const unmatched = [];

  for (const onu of onus) {
    if (Number.isInteger(onu.clientIdServicio)) continue;
    const serialCandidates = indexValues(serialIndex, normalizeSerial(onu.serial));
    const identity = normalizeIdentity(onu.name);
    const nameCandidates = identity.length >= 4 && !/^onu\d+$/.test(identity)
      ? indexValues(identityIndex, identity)
      : [];

    let method = null;
    let candidates = [];
    if (serialCandidates.length) {
      method = 'serial';
      candidates = serialCandidates;
    } else if (nameCandidates.length) {
      method = 'name';
      candidates = nameCandidates;
    }

    if (!method) {
      unmatched.push(conflictDto(onu, 'no_match'));
      continue;
    }
    if (candidates.length !== 1) {
      conflicts.push(conflictDto(onu, 'ambiguous_client', candidates));
      continue;
    }

    const client = candidates[0];
    if (alreadyAssigned.has(client.idServicio)) {
      conflicts.push(conflictDto(onu, 'client_already_linked', candidates));
      continue;
    }
    provisional.push({ onu, client, method });
  }

  const byClient = new Map();
  for (const candidate of provisional) {
    if (!byClient.has(candidate.client.idServicio)) byClient.set(candidate.client.idServicio, []);
    byClient.get(candidate.client.idServicio).push(candidate);
  }

  const matches = [];
  for (const candidates of byClient.values()) {
    if (candidates.length > 1) {
      for (const candidate of candidates) {
        conflicts.push(conflictDto(candidate.onu, 'multiple_onus_for_client', [candidate.client]));
      }
      continue;
    }
    const { onu, client, method } = candidates[0];
    matches.push({
      onuIndex: onu.onuIndex,
      onuName: onu.name || null,
      serial: onu.serial || null,
      method,
      client: {
        idServicio: client.idServicio,
        nombre: client.nombre,
        usuario: client.usuario || null,
        ip: client.ip || null,
      },
    });
  }

  matches.sort((a, b) => a.onuIndex.localeCompare(b.onuIndex, undefined, { numeric: true }));
  const exactSerial = matches.filter((match) => match.method === 'serial').length;
  const exactName = matches.length - exactSerial;
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalOnus: onus.length,
      alreadyLinked: onus.filter((onu) => Number.isInteger(onu.clientIdServicio)).length,
      unlinked: onus.filter((onu) => !Number.isInteger(onu.clientIdServicio)).length,
      safeMatches: matches.length,
      exactSerial,
      exactName,
      conflicts: conflicts.length,
      unmatched: unmatched.length,
    },
    matches,
    conflicts: conflicts.slice(0, 100),
    unmatched: unmatched.slice(0, 100),
    requiredConfirmation: `ASOCIAR ${matches.length} ONUS`,
  };
}

module.exports = { buildOltAssociationPlan, normalizeIdentity, normalizeSerial };
