'use strict';

const PROFILE_CHANNELS = Object.freeze(['OLT_CLI', 'OMCI', 'TR069', 'WEB_LOCAL']);
const PROFILE_STATUSES = Object.freeze(['detected', 'verified', 'failed', 'blocked']);
const PROFILE_ACTIONS = Object.freeze([
  'olt_provision', 'optical_read', 'equipment_read', 'service_read', 'ethernet_read',
  'wifi_read', 'wifi_write', 'lan_read', 'lan_write', 'wan_read', 'wan_write',
  'diagnostics', 'reboot', 'factory_reset', 'firmware_upgrade', 'acs_config', 'security_config',
]);

const BUILTIN_ONU_MODEL_PROFILES = Object.freeze([
  {
    profileKey: 'huawei-eg8141a5-v5r019', manufacturer: 'Huawei', model: 'EG8141A5',
    firmwarePattern: 'V5R019*', serialPrefixes: ['HWTC'], ponType: 'GPON',
    oltVendor: 'ZTE', oltModel: 'C320', oltOnuType: 'HG8546M', omciMode: 'baseline',
    extendedOmci: false, tr069ProfileKey: 'huawei-eg8141a5-v5r019',
    certificationStatus: 'verified', builtIn: true,
    defaults: { vlan: 101, wanMode: 'static', dataModel: 'InternetGatewayDevice' },
    notes: 'Perfil inicial certificado para la Huawei EG8141A5 administrada por ISP Max.',
    capabilities: [
      capability('olt_provision', 'OLT_CLI', 'verified'), capability('optical_read', 'OMCI', 'verified'),
      capability('equipment_read', 'OMCI', 'verified'), capability('service_read', 'OMCI', 'verified'),
      capability('ethernet_read', 'OMCI', 'detected'), capability('wifi_read', 'TR069', 'verified'),
      capability('wifi_write', 'TR069', 'verified'), capability('lan_read', 'TR069', 'detected'),
      capability('lan_write', 'TR069', 'detected'), capability('wan_read', 'TR069', 'detected'),
      capability('wan_write', 'TR069', 'blocked'), capability('diagnostics', 'TR069', 'detected'),
      capability('reboot', 'OMCI', 'verified'), capability('factory_reset', 'TR069', 'blocked'),
      capability('firmware_upgrade', 'TR069', 'blocked'), capability('acs_config', 'TR069', 'blocked'),
      capability('security_config', 'TR069', 'blocked'),
    ],
  },
  {
    profileKey: 'zte-f670l-v7.1', manufacturer: 'ZTE', model: 'F670L',
    firmwarePattern: 'V7.1*', serialPrefixes: ['ZXIC'], ponType: 'GPON',
    oltVendor: 'ZTE', oltModel: 'C320', oltOnuType: 'F670L', omciMode: 'baseline',
    extendedOmci: false, tr069ProfileKey: 'zte-f670l-v7.1',
    certificationStatus: 'detected', builtIn: true,
    defaults: { vlan: 101, wanMode: 'static', dataModel: 'InternetGatewayDevice' },
    notes: 'Perfil ZTE F670L. Las escrituras avanzadas permanecen bloqueadas hasta certificarlas en laboratorio.',
    capabilities: [
      capability('olt_provision', 'OLT_CLI', 'verified'), capability('optical_read', 'OMCI', 'verified'),
      capability('equipment_read', 'OMCI', 'verified'), capability('service_read', 'OMCI', 'verified'),
      capability('ethernet_read', 'OMCI', 'detected'), capability('wifi_read', 'TR069', 'verified'),
      capability('wifi_write', 'TR069', 'detected'), capability('lan_read', 'TR069', 'detected'),
      capability('lan_write', 'TR069', 'detected'), capability('wan_read', 'TR069', 'detected'),
      capability('wan_write', 'TR069', 'blocked'), capability('diagnostics', 'TR069', 'detected'),
      capability('reboot', 'OMCI', 'verified'), capability('factory_reset', 'TR069', 'blocked'),
      capability('firmware_upgrade', 'TR069', 'blocked'), capability('acs_config', 'TR069', 'blocked'),
      capability('security_config', 'TR069', 'blocked'),
    ],
  },
]);

function capability(action, channel, status) {
  return { action, channel, status, rollbackSupported: false, destructive: ['factory_reset', 'firmware_upgrade'].includes(action) };
}

function cleanLabel(value, label, maxLength = 100) {
  const text = String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (!text || text.length > maxLength) throw new Error(`${label} invalido`);
  return text;
}

function cleanToken(value, label, maxLength = 80) {
  const text = String(value || '').trim();
  if (!text || text.length > maxLength || !/^[A-Za-z0-9_.-]+$/.test(text)) throw new Error(`${label} invalido`);
  return text;
}

function profileKeyFor(manufacturer, model, firmwarePattern = '*') {
  const major = String(firmwarePattern || '*').replace(/\*/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${manufacturer}-${model}${major ? `-${major}` : ''}`.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
}

function normalizePrefixes(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
  const prefixes = [...new Set(values.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean))];
  if (prefixes.some((item) => !/^[A-Z0-9]{4,16}$/.test(item))) throw new Error('Prefijo serial invalido');
  return prefixes;
}

function normalizeCapabilities(value, fallback = []) {
  const rows = Array.isArray(value) ? value : fallback;
  const seen = new Set();
  return rows.map((row) => {
    const action = String(row?.action || '').trim().toLowerCase();
    const channel = String(row?.channel || '').trim().toUpperCase();
    const status = String(row?.status || '').trim().toLowerCase();
    if (!PROFILE_ACTIONS.includes(action)) throw new Error(`Accion ONU no admitida: ${action || 'vacia'}`);
    if (!PROFILE_CHANNELS.includes(channel)) throw new Error(`Canal ONU no admitido: ${channel || 'vacio'}`);
    if (!PROFILE_STATUSES.includes(status)) throw new Error(`Estado de capacidad no admitido: ${status || 'vacio'}`);
    const key = `${action}:${channel}`;
    if (seen.has(key)) throw new Error(`Capacidad duplicada: ${key}`);
    seen.add(key);
    return {
      action, channel, status,
      rollbackSupported: row?.rollbackSupported === true,
      destructive: row?.destructive === true || ['factory_reset', 'firmware_upgrade'].includes(action),
      notes: row?.notes ? cleanLabel(row.notes, 'Notas de capacidad', 300) : null,
    };
  });
}

function sanitizeOnuModelProfile(input, existing = null) {
  const source = { ...(existing || {}), ...(input || {}) };
  const manufacturer = cleanLabel(source.manufacturer, 'Fabricante', 60);
  const model = cleanToken(source.model, 'Modelo ONU', 64);
  const firmwarePattern = String(source.firmwarePattern || '*').trim().slice(0, 80) || '*';
  if (!/^[A-Za-z0-9*?_.+-]+$/.test(firmwarePattern)) throw new Error('Patron de firmware invalido');
  const ponType = String(source.ponType || 'GPON').trim().toUpperCase();
  if (!['GPON', 'EPON', 'XGPON', 'XGSPON'].includes(ponType)) throw new Error('Tipo PON no admitido');
  const omciMode = String(source.omciMode || 'baseline').trim().toLowerCase();
  if (!['baseline', 'extended', 'vendor'].includes(omciMode)) throw new Error('Modo OMCI no admitido');
  const certificationStatus = String(source.certificationStatus || 'detected').trim().toLowerCase();
  if (!PROFILE_STATUSES.includes(certificationStatus)) throw new Error('Estado de certificacion invalido');
  const defaults = source.defaults && typeof source.defaults === 'object' && !Array.isArray(source.defaults) ? source.defaults : {};
  const vlan = defaults.vlan == null ? 101 : Number(defaults.vlan);
  if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) throw new Error('VLAN predeterminada invalida');
  return {
    profileKey: source.profileKey ? cleanToken(source.profileKey.toLowerCase(), 'Clave del perfil', 100) : profileKeyFor(manufacturer, model, firmwarePattern),
    manufacturer, model, firmwarePattern, serialPrefixes: normalizePrefixes(source.serialPrefixes), ponType,
    oltVendor: cleanLabel(source.oltVendor || 'ZTE', 'Fabricante OLT', 60),
    oltModel: cleanToken(source.oltModel || 'C320', 'Modelo OLT', 64),
    oltOnuType: cleanToken(source.oltOnuType || model, 'Tipo ONU en OLT', 64),
    omciMode, extendedOmci: source.extendedOmci === true,
    tr069ProfileKey: source.tr069ProfileKey ? cleanToken(source.tr069ProfileKey, 'Perfil TR-069', 100) : null,
    certificationStatus, active: source.active !== false, builtIn: source.builtIn === true,
    defaults: { vlan, wanMode: ['static', 'dhcp', 'bridge'].includes(defaults.wanMode) ? defaults.wanMode : 'static', dataModel: String(defaults.dataModel || 'InternetGatewayDevice').slice(0, 80) },
    notes: source.notes ? cleanLabel(source.notes, 'Notas', 500) : null,
    capabilities: normalizeCapabilities(source.capabilities, existing?.capabilities || []),
  };
}

function wildcardMatches(pattern, value) {
  if (!value) return false;
  const source = String(pattern || '*').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${source}$`, 'i').test(String(value));
}

function matchOnuModelProfile(profiles, identity = {}) {
  const serial = String(identity.serial || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const manufacturer = String(identity.manufacturer || '').trim();
  const model = String(identity.model || '').trim();
  const firmware = String(identity.firmware || identity.softwareVersion || '').trim();
  const candidates = [];
  for (const profile of profiles || []) {
    if (profile.active === false) continue;
    const prefixes = Array.isArray(profile.serialPrefixes) ? profile.serialPrefixes : normalizePrefixesJson(profile.serialPrefixes);
    const prefixMatched = Boolean(serial && prefixes.some((prefix) => serial.startsWith(prefix)));
    const manufacturerMatched = Boolean(manufacturer && profile.manufacturer && manufacturer.localeCompare(profile.manufacturer, undefined, { sensitivity: 'base' }) === 0);
    const modelMatched = Boolean(model && profile.model && model.localeCompare(profile.model, undefined, { sensitivity: 'base' }) === 0);
    const firmwareMatched = Boolean(firmware && wildcardMatches(profile.firmwarePattern, firmware));
    if (prefixes.length && serial && !prefixMatched && !modelMatched) continue;
    if (model && !modelMatched && !prefixMatched) continue;
    let score = 0;
    if (prefixMatched) score += 45;
    if (manufacturerMatched) score += 25;
    if (modelMatched) score += 70;
    if (firmwareMatched) score += 25;
    if (!score) continue;
    candidates.push({ profile, score, confidence: modelMatched && firmwareMatched ? 'verified' : score >= 70 ? 'high' : 'detected' });
  }
  return candidates.sort((a, b) => b.score - a.score || Number(b.profile.version || 0) - Number(a.profile.version || 0))[0] || null;
}

function normalizePrefixesJson(value) {
  if (Array.isArray(value)) return value;
  try { return normalizePrefixes(JSON.parse(value || '[]')); } catch { return normalizePrefixes(value); }
}

function profileSnapshot(profile, capabilities = []) {
  return {
    profileKey: profile.profileKey, manufacturer: profile.manufacturer, model: profile.model,
    firmwarePattern: profile.firmwarePattern, serialPrefixes: normalizePrefixesJson(profile.serialPrefixes),
    ponType: profile.ponType, oltVendor: profile.oltVendor, oltModel: profile.oltModel,
    oltOnuType: profile.oltOnuType, omciMode: profile.omciMode, extendedOmci: profile.extendedOmci,
    tr069ProfileKey: profile.tr069ProfileKey, certificationStatus: profile.certificationStatus,
    defaults: typeof profile.defaultsJson === 'string' ? JSON.parse(profile.defaultsJson || '{}') : (profile.defaults || {}),
    capabilities: capabilities.map((item) => ({
      action: item.action, channel: item.channel, status: item.status,
      rollbackSupported: item.rollbackSupported === true, destructive: item.destructive === true, notes: item.notes || null,
    })),
  };
}

function modelProfileRecord(profile) {
  return {
    profileKey: profile.profileKey, manufacturer: profile.manufacturer, model: profile.model,
    firmwarePattern: profile.firmwarePattern, serialPrefixes: JSON.stringify(profile.serialPrefixes),
    ponType: profile.ponType, oltVendor: profile.oltVendor, oltModel: profile.oltModel,
    oltOnuType: profile.oltOnuType, omciMode: profile.omciMode, extendedOmci: profile.extendedOmci,
    tr069ProfileKey: profile.tr069ProfileKey, certificationStatus: profile.certificationStatus,
    defaultsJson: JSON.stringify(profile.defaults), active: profile.active, builtIn: profile.builtIn,
    notes: profile.notes,
  };
}

async function seedOnuModelProfiles(prisma) {
  let created = 0;
  for (const definition of BUILTIN_ONU_MODEL_PROFILES) {
    const existing = await prisma.onuModelProfile.findUnique({ where: { profileKey: definition.profileKey } });
    if (existing) continue;
    const profile = sanitizeOnuModelProfile(definition);
    await prisma.onuModelProfile.create({
      data: {
        ...modelProfileRecord(profile), active: true, builtIn: true, version: 1, createdBy: 'system',
        capabilities: { create: profile.capabilities },
        versions: {
          create: {
            version: 1, snapshotJson: JSON.stringify(profileSnapshot(profile, profile.capabilities)),
            changedBy: 'system', changeReason: 'Perfil inicial incluido con ISP Max',
          },
        },
      },
    });
    created += 1;
  }
  return { created, existing: BUILTIN_ONU_MODEL_PROFILES.length - created };
}

module.exports = {
  BUILTIN_ONU_MODEL_PROFILES, PROFILE_ACTIONS, PROFILE_CHANNELS, PROFILE_STATUSES,
  matchOnuModelProfile, normalizeCapabilities, normalizePrefixesJson, profileSnapshot,
  sanitizeOnuModelProfile, seedOnuModelProfiles, wildcardMatches,
};
