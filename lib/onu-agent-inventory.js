'use strict';

const { normalizeGponSerial } = require('./zte-c320');

const MAX_INVENTORY_BYTES = 256 * 1024;

function cleanText(value, maxLength = 160) {
  if (value == null || value === '' || value === '--') return null;
  return String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength) || null;
}

function cleanNumber(value) {
  if (value == null || value === '') return null;
  const match = String(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  const number = match ? Number(match[0]) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function cleanBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  return null;
}

function pick(source, fields, maxLength = 160) {
  const result = {};
  for (const field of fields) result[field] = cleanText(source?.[field], maxLength);
  return result;
}

function normalizeOnuAgentInventory(payload, expectedSerial = null, metadata = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw Object.assign(new Error('Inventario ONU invalido'), { statusCode: 400 });
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_INVENTORY_BYTES) {
    throw Object.assign(new Error('El inventario ONU excede el tamano permitido'), { statusCode: 413 });
  }

  const serial = normalizeGponSerial(payload.identity?.serial || payload.serial);
  const expected = normalizeGponSerial(expectedSerial);
  if (!/^[A-Z0-9]{12}$/.test(serial)) {
    throw Object.assign(new Error('El agente no envio un serial GPON valido'), { statusCode: 400 });
  }
  if (expected && serial !== expected) {
    throw Object.assign(new Error(`El serial del agente (${serial}) no coincide con el expediente (${expected})`), { statusCode: 409 });
  }

  const wan = Array.isArray(payload.wan) ? payload.wan.slice(0, 16).map((item) => ({
    ...pick(item, ['name', 'status', 'mac', 'encapsulation', 'protocol', 'mode', 'service', 'address_mode', 'ip_address', 'subnet_mask', 'gateway', 'primary_dns', 'secondary_dns'], 120),
    enabled: cleanBoolean(item?.enabled), vlan_enabled: cleanBoolean(item?.vlan_enabled),
    vlan_id: cleanNumber(item?.vlan_id), priority: cleanNumber(item?.priority),
    nat_enabled: cleanBoolean(item?.nat_enabled), mtu: cleanNumber(item?.mtu),
    uptime_seconds: cleanNumber(item?.uptime_seconds),
    lan_bindings: Array.isArray(item?.lan_bindings) ? item.lan_bindings.slice(0, 16).map((value) => cleanText(value, 40)).filter(Boolean) : [],
    ssid_bindings: Array.isArray(item?.ssid_bindings) ? item.ssid_bindings.slice(0, 16).map((value) => cleanText(value, 40)).filter(Boolean) : [],
  })) : [];

  const ports = Array.isArray(payload.ethernet?.ports) ? payload.ethernet.ports.slice(0, 16).map((item) => ({
    port: cleanNumber(item?.port), duplex: cleanText(item?.duplex, 30), speed: cleanText(item?.speed, 30), link: cleanText(item?.link, 30),
    rx_bytes: cleanNumber(item?.rx_bytes), rx_packets: cleanNumber(item?.rx_packets),
    tx_bytes: cleanNumber(item?.tx_bytes), tx_packets: cleanNumber(item?.tx_packets),
  })) : [];

  const radios = Array.isArray(payload.wifi?.radios) ? payload.wifi.radios.slice(0, 16).map((item) => ({
    ...pick(item, ['ssid', 'channel', 'standard', 'authentication', 'encryption'], 120),
    index: cleanNumber(item?.index), enabled: cleanBoolean(item?.enabled), hidden: cleanBoolean(item?.hidden),
    wmm_enabled: cleanBoolean(item?.wmm_enabled), transmit_power_percent: cleanNumber(item?.transmit_power_percent),
    max_clients: cleanNumber(item?.max_clients),
  })) : [];

  const wifiClients = Array.isArray(payload.wifi?.clients) ? payload.wifi.clients.slice(0, 128).map((item) => ({
    ...pick(item, ['mac', 'ssid', 'quality'], 64), uptime_seconds: cleanNumber(item?.uptime_seconds),
    tx_mbps: cleanNumber(item?.tx_mbps), rx_mbps: cleanNumber(item?.rx_mbps),
    signal_dbm: cleanNumber(item?.signal_dbm), noise_dbm: cleanNumber(item?.noise_dbm), snr_db: cleanNumber(item?.snr_db),
  })) : [];

  const errors = {};
  if (payload.errors && typeof payload.errors === 'object' && !Array.isArray(payload.errors)) {
    for (const [key, value] of Object.entries(payload.errors).slice(0, 20)) {
      const safeKey = String(key).replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
      if (safeKey) errors[safeKey] = cleanText(value, 300);
    }
  }

  return {
    schema_version: 1,
    collected_at: Number.isFinite(Date.parse(payload.collected_at)) ? new Date(payload.collected_at).toISOString() : new Date().toISOString(),
    received_at: new Date().toISOString(),
    source: 'onu_studio',
    phase: cleanText(metadata.phase, 40) || 'inspection',
    agent_version: cleanText(metadata.agentVersion, 30),
    host: cleanText(metadata.host, 64),
    identity: {
      serial,
      serial_raw: cleanText(payload.identity?.serial_raw, 32),
      authentication_mode: cleanText(payload.identity?.authentication_mode, 40),
    },
    device: {
      ...pick(payload.device, ['model', 'description', 'hardware_version', 'software_version', 'firmware_release', 'manufacturer_info', 'vendor_id', 'mac', 'registration_status', 'ont_id', 'runtime', 'system_time'], 180),
      cpu_usage: cleanNumber(payload.device?.cpu_usage), memory_usage: cleanNumber(payload.device?.memory_usage),
    },
    optical: {
      tx_power_dbm: cleanNumber(payload.optical?.tx_power_dbm), rx_power_dbm: cleanNumber(payload.optical?.rx_power_dbm),
      voltage_mv: cleanNumber(payload.optical?.voltage_mv), bias_ma: cleanNumber(payload.optical?.bias_ma),
      temperature_c: cleanNumber(payload.optical?.temperature_c), los: cleanBoolean(payload.optical?.los),
      signal_available: cleanBoolean(payload.optical?.signal_available),
      ...pick(payload.optical, ['module_vendor', 'module_serial', 'module_date_code', 'tx_wavelength_nm', 'rx_wavelength_nm', 'max_distance_km'], 100),
    },
    wan,
    ethernet: { mac: cleanText(payload.ethernet?.mac, 32), ports },
    wifi: { radios, clients: wifiClients },
    remote_access: {
      rules: Array.isArray(payload.remote_access?.rules) ? payload.remote_access.rules.slice(0, 32).map((value) => cleanText(value, 300)).filter(Boolean) : [],
    },
    errors,
  };
}

function summarizeOnuAgentInventory(inventory) {
  if (!inventory) return null;
  const internet = inventory.wan.find((item) => String(item.service || '').toUpperCase().includes('INTERNET')) || inventory.wan[0] || null;
  return {
    serial: inventory.identity.serial,
    collectedAt: inventory.collected_at,
    receivedAt: inventory.received_at,
    phase: inventory.phase,
    agentVersion: inventory.agent_version,
    host: inventory.host,
    model: inventory.device.model,
    hardwareVersion: inventory.device.hardware_version,
    softwareVersion: inventory.device.software_version,
    registrationStatus: inventory.device.registration_status,
    mac: inventory.device.mac || inventory.ethernet.mac,
    rxPowerDbm: inventory.optical.rx_power_dbm,
    wanIp: internet?.ip_address || null,
    vlan: internet?.vlan_id || null,
    ssid: inventory.wifi.radios[0]?.ssid || null,
    lanPortsUp: inventory.ethernet.ports.filter((port) => String(port.link || '').toLowerCase() === 'up').length,
    wifiClients: inventory.wifi.clients.length,
    partial: Object.keys(inventory.errors || {}).length > 0,
  };
}

module.exports = { MAX_INVENTORY_BYTES, normalizeOnuAgentInventory, summarizeOnuAgentInventory };
