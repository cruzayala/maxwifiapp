const ACTION_CATALOG = Object.freeze({
  refresh: action('Inventario completo', 'overview', 'read', 'verified', false),
  set_wifi: action('Configurar WiFi', 'wifi', 'change', 'verified', false),
  set_lan_port: action('Configurar puerto LAN', 'lan', 'change', 'detected', false),
  set_dhcp: action('Configurar LAN y DHCP', 'lan', 'change', 'detected', false),
  upsert_dhcp_reservation: action('Crear reserva DHCP', 'lan', 'change', 'blocked', false),
  delete_dhcp_reservation: action('Eliminar reserva DHCP', 'lan', 'change', 'blocked', true),
  set_time: action('Configurar hora y NTP', 'system', 'change', 'detected', false),
  run_ping: action('Diagnostico ping', 'diagnostics', 'diagnostic', 'detected', false),
  run_traceroute: action('Diagnostico traceroute', 'diagnostics', 'diagnostic', 'detected', false),
  run_download_diagnostic: action('Prueba de descarga', 'diagnostics', 'diagnostic', 'detected', false),
  run_upload_diagnostic: action('Prueba de subida', 'diagnostics', 'diagnostic', 'detected', false),
  set_wan: action('Configurar WAN', 'wan', 'critical', 'blocked', true),
  upsert_port_mapping: action('Crear redireccion de puerto', 'security', 'critical', 'blocked', true),
  delete_port_mapping: action('Eliminar redireccion de puerto', 'security', 'critical', 'blocked', true),
  set_security: action('Configurar NAT y seguridad', 'security', 'critical', 'blocked', true),
  set_acs: action('Configurar servidor ACS', 'system', 'critical', 'blocked', true),
  reboot: action('Reiniciar ONU', 'system', 'critical', 'verified', true),
  factory_reset: action('Restaurar de fabrica', 'system', 'destructive', 'blocked', true),
  firmware_download: action('Actualizar firmware', 'system', 'destructive', 'blocked', true),
});

function action(label, section, risk, defaultStatus, confirmation) {
  return Object.freeze({ label, section, risk, defaultStatus, confirmation });
}

const SECTIONS = Object.freeze([
  { id: 'overview', label: 'Resumen' },
  { id: 'fiber', label: 'Fibra' },
  { id: 'wifi', label: 'WiFi' },
  { id: 'lan', label: 'LAN' },
  { id: 'wan', label: 'WAN' },
  { id: 'clients', label: 'Clientes' },
  { id: 'diagnostics', label: 'Diagnosticos' },
  { id: 'security', label: 'Seguridad' },
  { id: 'system', label: 'Sistema' },
  { id: 'history', label: 'Historial' },
  { id: 'parameters', label: 'Parametros' },
]);

const HUAWEI_EG8141A5 = Object.freeze({
  manufacturer: 'Huawei',
  model: 'EG8141A5',
  softwarePattern: '^V5R019',
  dataModel: 'InternetGatewayDevice',
  actions: Object.fromEntries(Object.entries(ACTION_CATALOG).map(([name, config]) => [name, config.defaultStatus])),
  wifi: {
    channels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    transmitPowers: [20, 40, 60, 80, 100],
    standards: ['11b', '11g', '11bg', '11n', '11bgn'],
    maxClients: 32,
  },
  lanPorts: 4,
  telemetryIntervalSeconds: 300,
  diagnosticIntervalSeconds: 60,
});

// Mismo firmware V5R019 que la EG8141A5, WiFi solo 2.4 GHz. Todavia sin certificar en campo:
// ninguna accion pasa de "detected".
const HUAWEI_HS8545M5 = Object.freeze({
  ...HUAWEI_EG8141A5,
  model: 'HS8545M5',
  actions: Object.fromEntries(Object.entries(HUAWEI_EG8141A5.actions)
    .map(([name, status]) => [name, status === 'verified' ? 'detected' : status])),
});

const ZTE_F670L = Object.freeze({
  manufacturer: 'ZTE',
  model: 'F670L',
  softwarePattern: '^V7\\.1',
  dataModel: 'InternetGatewayDevice',
  actions: {
    refresh: 'verified', set_wifi: 'detected', set_lan_port: 'detected', set_dhcp: 'detected',
    set_time: 'detected', run_ping: 'detected', run_traceroute: 'detected',
    run_download_diagnostic: 'detected', run_upload_diagnostic: 'detected', reboot: 'verified',
  },
  wifi: {
    channels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    transmitPowers: [20, 40, 60, 80, 100],
    standards: ['b,g,n'],
    maxClients: 32,
  },
  lanPorts: 4,
  telemetryIntervalSeconds: 300,
  diagnosticIntervalSeconds: 60,
});

function profileForDevice(manufacturer, model, softwareVersion, persisted = {}) {
  const isHuawei = /huawei/i.test(String(manufacturer || ''));
  const isModel = /eg8141a5/i.test(String(model || ''));
  const isHs8545m5 = /hs8545m5/i.test(String(model || ''));
  const isZteF670l = /zte/i.test(String(manufacturer || '')) && /f670l/i.test(String(model || ''));
  const profile = isHuawei && isModel ? HUAWEI_EG8141A5 : isHuawei && isHs8545m5 ? HUAWEI_HS8545M5 : isZteF670l ? ZTE_F670L : null;
  const persistedActions = persisted && typeof persisted.actions === 'object' ? persisted.actions : {};
  const genericActions = { refresh: 'verified' };
  return {
    profileKey: profile === HUAWEI_EG8141A5 ? 'huawei-eg8141a5-v5r019'
      : profile === HUAWEI_HS8545M5 ? 'huawei-hs8545m5-v5r019'
        : profile === ZTE_F670L ? 'zte-f670l-v7.1' : 'generic-tr098',
    manufacturer: manufacturer || null,
    model: model || null,
    softwareVersion: softwareVersion || null,
    dataModel: profile?.dataModel || 'InternetGatewayDevice',
    sections: SECTIONS,
    limits: profile ? { wifi: profile.wifi, lanPorts: profile.lanPorts } : { wifi: {}, lanPorts: 0 },
    telemetryIntervalSeconds: profile?.telemetryIntervalSeconds || 900,
    diagnosticIntervalSeconds: profile?.diagnosticIntervalSeconds || 60,
    actions: Object.entries(ACTION_CATALOG).map(([name, config]) => ({
      name,
      ...config,
      status: persistedActions[name]?.status || profile?.actions[name] || genericActions[name] || 'blocked',
      verifiedAt: persistedActions[name]?.verifiedAt || null,
      lastError: persistedActions[name]?.lastError || null,
      executable: (persistedActions[name]?.status || profile?.actions[name] || genericActions[name] || 'blocked') !== 'blocked',
    })),
  };
}

function actionDefinition(name) {
  return ACTION_CATALOG[String(name || '').trim().toLowerCase()] || null;
}

module.exports = { ACTION_CATALOG, SECTIONS, actionDefinition, profileForDevice };
