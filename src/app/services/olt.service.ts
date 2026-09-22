import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

export interface OltSnapshot {
  id: number;
  status: string;
  systemName?: string | null;
  model?: string | null;
  version?: string | null;
  uptimeText?: string | null;
  totalOnus: number;
  onlineOnus: number;
  offlineOnus: number;
  unconfiguredOnus: number;
  activeAlarms: number;
  criticalAlarms: number;
  maxTemperatureC?: number | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  capturedAt: string;
}

export interface OltCard {
  id: number;
  location: string;
  configuredType?: string | null;
  realType?: string | null;
  ports?: number | null;
  status?: string | null;
  temperatureC?: number | null;
}

export interface OltStatus {
  enabled: boolean;
  configured: boolean;
  syncing: boolean;
  connected: boolean;
  autoAuthorizeAgent: { enabled: boolean; running: boolean };
  syncIntervalMs: number;
  inventoryIntervalMs: number;
  latest?: OltSnapshot | null;
  totals: { totalOnus: number; onlineOnus: number; offlineOnus: number; linkedOnus: number; unlinkedOnus: number; activeAlarms: number; activeSignalAlerts?: number; unconfiguredOnus: number };
  cards: OltCard[];
}

export interface OltPon {
  ponIndex: string;
  rack: number;
  shelf: number;
  pon: number;
  total: number;
  online: number;
  offline: number;
  linked: number;
  weak: number;
  critical: number;
  noReading: number;
  capacity: number;
  utilizationPercent: number;
  offlinePercent: number;
  avgRxPowerDbm?: number | null;
  health: 'healthy' | 'warning' | 'critical';
}

export interface OltSignalAlert {
  id: number; onuIndex: string; type: string; severity: string; message: string;
  currentValue?: number | null; baselineValue?: number | null; active: boolean;
  occurrenceCount: number; firstSeenAt: string; lastSeenAt: string;
}

export interface OltProvisioningProfile {
  id: number; name: string; onuType?: string | null; vendorPrefix?: string | null; vlan: number;
  tcontProfile: string; trafficProfile: string; isDefault: boolean; active: boolean; notes?: string | null;
  serviceMode: 'router' | 'bridge'; lanPorts: number[]; managementMode: string; tr069Policy: string; omciPolicy: string;
  compatibleModels: string[];
}

export type OnuManagementChannel = 'OLT_CLI' | 'OMCI' | 'TR069' | 'WEB_LOCAL';
export type OnuCapabilityStatus = 'detected' | 'verified' | 'failed' | 'blocked';

export interface OnuModelCapability {
  id?: number;
  action: string;
  channel: OnuManagementChannel;
  status: OnuCapabilityStatus;
  rollbackSupported: boolean;
  destructive: boolean;
  notes?: string | null;
  verifiedAt?: string | null;
  lastError?: string | null;
}

export interface OnuModelProfile {
  id: number;
  profileKey: string;
  manufacturer: string;
  model: string;
  firmwarePattern: string;
  serialPrefixes: string[];
  ponType: 'GPON' | 'EPON' | 'XGPON' | 'XGSPON';
  oltVendor: string;
  oltModel: string;
  oltOnuType: string;
  omciMode: 'baseline' | 'extended' | 'vendor';
  extendedOmci: boolean;
  tr069ProfileKey?: string | null;
  certificationStatus: OnuCapabilityStatus;
  defaults: { vlan?: number; wanMode?: string; dataModel?: string };
  active: boolean;
  builtIn: boolean;
  version: number;
  notes?: string | null;
  capabilities: OnuModelCapability[];
  deviceCount: number;
  confidence?: 'verified' | 'high' | 'detected';
}

export interface OltPlanSyncPreview {
  plans: Array<{
    speedMbps: number;
    wisphubPlans: Array<{ id: number; name: string }>;
    mikrotikQueues: number;
    tcontProfile: string;
    trafficProfile: string;
    tcontExists: boolean;
    trafficExists: boolean;
    status: 'ready' | 'missing';
  }>;
  summary: { wisphubCatalog: number; mikrotikQueues: number; commonSpeeds: number; ready: number; missing: number };
  excluded: { wisphubOnlySpeeds: number[]; mikrotikOnlySpeeds: number[] };
  requiredConfirmation: string;
}

export interface OltNapPort {
  id: number; portNumber: number; status: 'available' | 'reserved' | 'assigned' | 'damaged';
  onuIndex?: string | null; serial?: string | null; clientIdServicio?: number | null;
  client?: Pick<OltClientSummary, 'idServicio' | 'nombre' | 'usuario' | 'ip'> | null;
}

export interface OltNap {
  id: number; code: string; name: string; capacity: number; zone?: string | null; address?: string | null;
  latitude?: number | null; longitude?: number | null; usedPorts: number; availablePorts: number; ports: OltNapPort[];
}

export interface OltSplitter {
  id: number; name: string; ponIndex: string; splitterType: string; ratio: number;
  insertionLossDb?: number | null; zone?: string | null; naps: OltNap[];
}

export interface OltOnu {
  id: number;
  onuIndex: string;
  interfaceName: string;
  rack: number;
  shelf: number;
  pon: number;
  onuId: number;
  name?: string | null;
  model?: string | null;
  serial?: string | null;
  authMode?: string | null;
  adminState?: string | null;
  omccState?: string | null;
  phaseState?: string | null;
  channel?: string | null;
  online: boolean;
  distanceM?: number | null;
  rxPowerDbm?: number | null;
  txPowerDbm?: number | null;
  attenuationUpDb?: number | null;
  attenuationDownDb?: number | null;
  onlineDuration?: string | null;
  lastOfflineCause?: string | null;
  clientIdServicio?: number | null;
  mappingSource?: 'serial' | 'manual' | null;
  mappedAt?: string | null;
  mappedBy?: string | null;
  client?: OltClientSummary | null;
  lastSeenAt: string;
  authorizationStatus?: 'pending' | 'review' | 'authorized';
  authorizationReason?: string | null;
  lastDetailAt?: string | null;
  agentInventory?: OnuAgentInventoryEnvelope | null;
  traffic?: {
    upstreamBps: number; downstreamBps: number; upstreamPps: number; downstreamPps: number;
    peakUpstreamBps: number; peakDownstreamBps: number;
    totalUpstreamBytes: number; totalDownstreamBytes: number;
    totalUpstreamPackets: number; totalDownstreamPackets: number; capturedAt: string;
  } | null;
}

export type Tr069TaskAction =
  | 'refresh' | 'set_wifi' | 'set_lan_port' | 'set_dhcp' | 'upsert_dhcp_reservation' | 'delete_dhcp_reservation'
  | 'set_time' | 'run_ping' | 'run_traceroute' | 'run_download_diagnostic' | 'run_upload_diagnostic'
  | 'set_wan' | 'upsert_port_mapping' | 'delete_port_mapping' | 'set_security' | 'set_acs'
  | 'reboot' | 'factory_reset' | 'firmware_download';

export type Tr069CapabilityStatus = 'detected' | 'verified' | 'failed' | 'blocked';
export interface Tr069CapabilityAction {
  name: Tr069TaskAction; label: string; section: string; risk: 'read' | 'change' | 'diagnostic' | 'critical' | 'destructive';
  status: Tr069CapabilityStatus; executable: boolean; confirmation: boolean; verifiedAt?: string | null; lastError?: string | null;
}
export interface Tr069Capabilities {
  profileKey: string; manufacturer?: string | null; model?: string | null; softwareVersion?: string | null; dataModel: string;
  sections: { id: string; label: string }[];
  limits: { wifi: { channels?: number[]; transmitPowers?: number[]; standards?: string[]; maxClients?: number }; lanPorts: number };
  telemetryIntervalSeconds: number; diagnosticIntervalSeconds: number; actions: Tr069CapabilityAction[];
}

export interface Tr069Task {
  id: string;
  serial: string;
  action: Tr069TaskAction;
  status: 'pending' | 'processing' | 'success' | 'failed' | 'cancelled';
  payload: Record<string, unknown>;
  hasProtectedData: boolean;
  result?: { message?: string; snapshot?: Tr069Snapshot } | null;
  errorMessage?: string | null;
  errorCode?: string | null;
  riskLevel: string;
  stage: string;
  progress: number;
  verification?: Record<string, unknown> | null;
  rollback?: Record<string, unknown> | null;
  attempts: number;
  createdBy: string;
  claimedBy?: string | null;
  claimedAt?: string | null;
  heartbeatAt?: string | null;
  scheduledAt?: string | null;
  cancelledAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tr069Snapshot {
  deviceId?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  softwareVersion?: string | null;
  lastInformAt?: string | null;
  online: boolean;
  overview: { uptime?: number | null; cpuUsage?: number | null; memoryFree?: number | null; memoryTotal?: number | null };
  fiber: { status?: string | null; rxPower?: number | null; txPower?: number | null; temperature?: number | null; voltage?: number | null; biasCurrent?: number | null; fecErrors?: number | null; hecErrors?: number | null; dropPackets?: number | null; bytesReceived?: number | null; bytesSent?: number | null };
  wifi: { enabled: boolean; broadcast: boolean; ssid?: string | null; channel?: number | null; clients: number; transmitPower?: number | null; standard?: string | null; maxClients?: number | null; wmm: boolean; wps: boolean };
  wan: { ip?: string | null; status?: string | null; vlan?: number | null; addressingType?: string | null; gateway?: string | null; dnsServers?: string | null; natEnabled: boolean; mtu?: number | null; serviceList?: string | null };
  dhcp: { enabled: boolean; minAddress?: string | null; maxAddress?: string | null; subnetMask?: string | null; router?: string | null; dnsServers?: string | null; leaseTime?: number | null };
  system: { timeEnabled: boolean; timeStatus?: string | null; timeZone?: string | null; timeZoneName?: string | null; periodicInformEnabled: boolean; periodicInformInterval?: number | null };
  lanPorts: Record<string, string | number | boolean | null>[];
  clients: Record<string, string | number | boolean | null>[];
  portMappings: Record<string, string | number | boolean | null>[];
  diagnostics: Record<string, Record<string, unknown>>;
  parameters: Tr069Parameter[];
  collectedAt?: string | null;
}

export interface Tr069Parameter { path: string; value: string | number | boolean | null; type?: string | null; writable: boolean; }
export interface Tr069Telemetry { id: number; serial: string; collectedAt: string; interval: string; eventCode?: string | null; metrics: Record<string, unknown>; }

export interface Tr069Device {
  enrolled: boolean;
  id?: number | null;
  serial?: string | null;
  onuIndex?: string | null;
  clientIdServicio?: number | null;
  enabled: boolean;
  status: string;
  acsDeviceId?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  softwareVersion?: string | null;
  lastInformAt?: string | null;
  lastAgentAt?: string | null;
  managementChannels?: {
    tr069: { available: boolean; online: boolean; deviceId?: string | null };
    omci: {
      available: boolean; state?: string | null; phaseState?: string | null;
      oltProfile?: string | null; detectedModel?: string | null; profileMatched: boolean;
      capabilities: string[];
    };
    routing: {
      overview?: 'omci' | 'remote' | null; fiber?: 'omci' | null;
      wifiRead?: 'omci' | 'remote' | null; wifiWrite?: 'remote' | null;
      lanRead?: 'omci' | 'remote' | null; lanWrite?: 'remote' | null;
      wanRead?: 'omci' | 'remote' | null; diagnostics?: 'remote' | null;
      reboot?: 'omci' | 'remote' | null;
    };
  };
  snapshot: Tr069Snapshot;
  capabilities: Tr069Capabilities;
  tasks: Tr069Task[];
}

export interface OnuAgentInventorySummary {
  serial: string;
  collectedAt: string;
  receivedAt: string;
  phase: string;
  agentVersion?: string | null;
  host?: string | null;
  model?: string | null;
  hardwareVersion?: string | null;
  softwareVersion?: string | null;
  registrationStatus?: string | null;
  mac?: string | null;
  rxPowerDbm?: number | null;
  wanIp?: string | null;
  vlan?: number | null;
  ssid?: string | null;
  lanPortsUp: number;
  wifiClients: number;
  partial: boolean;
}

export interface OnuAgentInventoryEnvelope {
  jobId: string;
  clientIdServicio?: number | null;
  onuIndex?: string | null;
  phase?: string | null;
  agentVersion?: string | null;
  capturedAt?: string | null;
  summary: OnuAgentInventorySummary;
  inventory: {
    device: Record<string, string | number | boolean | null>;
    optical: Record<string, string | number | boolean | null>;
    wan: Array<Record<string, string | number | boolean | null | string[]>>;
    ethernet: { mac?: string | null; ports: Array<Record<string, string | number | boolean | null>> };
    wifi: { radios: Array<Record<string, string | number | boolean | null>>; clients: Array<Record<string, string | number | boolean | null>> };
    remote_access: { rules: string[] };
    errors: Record<string, string | null>;
  };
}

export interface OltClientSummary {
  idServicio: number;
  nombre: string;
  usuario?: string | null;
  telefono?: string | null;
  ip?: string | null;
  snOnu?: string | null;
  planInternetName?: string | null;
}

export interface OltOpticalReading {
  id: number;
  onuIndex: string;
  online: boolean;
  phaseState?: string | null;
  distanceM?: number | null;
  rxPowerDbm?: number | null;
  txPowerDbm?: number | null;
  capturedAt: string;
}

export interface OltServiceDiagnostic {
  onuIndex: string;
  capturedAt: string;
  ready: boolean;
  score: number;
  checks: Array<{ key: string; label: string; ok: boolean; required: boolean; detail: string }>;
  recommendation: string | string[];
  mikrotik: {
    connected: boolean;
    error?: string | null;
    queue?: { name: string; maxLimit?: string | null; disabled: boolean; rate?: string | null } | null;
    arp?: { macAddress: string; interface?: string | null } | null;
    ping?: { reachable: boolean; packetLoss?: string | null } | null;
  };
  agentInventory?: OnuAgentInventoryEnvelope | null;
  access: {
    mode: 'bridge' | 'router' | 'unknown';
    confidence: 'high' | 'medium' | 'low';
    evidence: string[];
    limitation?: string | null;
    macTable: Array<{ macAddress: string; vlan: number; type: string; interfaceName: string; vport: string }>;
    capturedAt: string;
    error?: string | null;
  };
  downstream: {
    source: 'olt-fdb-mikrotik' | 'subscriber-wan' | 'best-effort' | 'none';
    totalMacs: number;
    identifiedClients: number;
    unknownDevices: number;
    limitation?: string | null;
    clients: Array<{
      macAddress?: string | null;
      vlan?: number | null;
      ip?: string | null;
      arpComplete: boolean;
      client?: {
        idServicio: number; nombre: string; usuario?: string | null; ip?: string | null;
        estado?: string | null; estadoFacturas?: string | null; planInternetName?: string | null;
      } | null;
      queue?: { name: string; target?: string | null; maxLimit?: string | null; disabled: boolean; rate?: string | null } | null;
    }>;
  };
}

export interface OltUnconfiguredOnu {
  id: number;
  serial: string;
  ponIndex: string;
  active: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  suggestedClient?: OltClientSummary | null;
  installation?: ProvisioningJob | null;
  authorizationStatus?: 'pending' | 'review' | 'authorized';
  authorizationReason?: string | null;
  discoveryType?: 'new' | 'pon_relocation';
  relocation?: OltPonRelocation | null;
}

export interface OltPonRelocation {
  type: 'pon_relocation';
  serial: string;
  targetPonIndex: string;
  allowed: boolean;
  reasons: string[];
  clientIdServicio?: number | null;
  previousLocation?: {
    onuIndex: string; ponIndex: string; name?: string | null; model?: string | null;
    online: boolean; clientIdServicio?: number | null; lastSeenAt?: string | null;
  } | null;
  previousLocations: Array<{
    onuIndex: string; ponIndex: string; name?: string | null; model?: string | null;
    online: boolean; clientIdServicio?: number | null; lastSeenAt?: string | null;
  }>;
}

export interface ProvisioningJob {
  id: string;
  status: 'in_progress' | 'waiting_optical' | 'partial' | 'failed' | 'complete' | 'cancelled';
  stage: string;
  mode: 'new_client' | 'restore_same_onu' | 'replace_onu' | 'migrate_pon';
  serviceMode?: 'router' | 'bridge';
  progressPercent?: number;
  stageLabel?: string | null;
  source?: 'onu_studio' | 'manual';
  clientIdServicio?: number | null;
  clientName?: string | null;
  ip?: string | null;
  serial?: string | null;
  model?: string | null;
  ponIndex?: string | null;
  onuIndex?: string | null;
  steps: Array<{ stage: string; status: string; message?: string; at: string; source?: string }>;
  errorMessage?: string | null;
  updatedAt: string;
  createdAt: string;
  agentInventoryAvailable?: boolean;
  agentInventoryAt?: string | null;
  agentVersion?: string | null;
  agentInventoryPhase?: string | null;
  lastCompletedStep?: string | null;
  localStatus?: 'idle' | 'running' | 'success' | 'error' | null;
  retryable?: boolean | null;
  errorCode?: string | null;
  agentLastSeenAt?: string | null;
}

export interface ProvisioningCancellationPreview {
  job: ProvisioningJob;
  allowed: boolean;
  operation: 'cancel' | 'close';
  alreadyCancelled: boolean;
  hasOltChanges: boolean;
  servicePreserved: boolean;
  reservationAction: 'release' | 'keep_committed' | 'none';
  warnings: string[];
  requiredConfirmation: string;
}

export interface ProvisioningCancellationResult {
  ok: boolean;
  job: ProvisioningJob;
  reservationReleased: boolean;
  servicePreserved: boolean;
  warnings: string[];
}

export interface ProvisioningIpReservation {
  ip: string;
  token: string;
  cidr?: string | null;
  status: string;
  clientName?: string | null;
  serial?: string | null;
  expiresAt: string;
}

export interface ProvisioningIpAddress {
  ip: string;
  cidr?: string | null;
  recommended?: boolean;
  availabilityConfidence?: 'verified' | 'probe_required' | string;
  reservation?: ProvisioningIpReservation | null;
}

export interface ProvisioningIpCatalog {
  timestamp?: string | null;
  source: string;
  stale: boolean;
  networks: Array<{ cidr: string; available: number; used: number; capacity: number; utilization: number; recommended?: string[] }>;
  rows: ProvisioningIpAddress[];
}

export interface ProvisioningJobRequest {
  idempotencyKey: string;
  mode: 'new_client' | 'existing_client';
  clientName: string;
  ip: string;
  zoneId: number;
  planId: number;
  uploadMbps: number;
  downloadMbps: number;
  serial?: string | null;
  model?: string | null;
  vlan?: number;
  reservationToken: string;
  source?: string;
}

export interface OltProvisioningCatalog {
  serial: string;
  ponIndex: string;
  recommendedOnuId: number;
  recommendedOnuType: string | null;
  modelProfile?: OnuModelProfile | null;
  relocation?: OltPonRelocation | null;
  onuTypes: Array<{ name: string; usage: number }>;
  tcontProfiles: Array<{ name: string; definition: string }>;
  trafficProfiles: Array<{ name: string; definition: string }>;
  profiles: OltProvisioningProfile[];
  defaults: {
    vlan: number; mask: string; gateway: string; primaryDns: string; secondaryDns: string;
    managementCidr: string; tcontProfile: string | null; trafficProfile: string | null;
  };
  writeAccess: boolean;
  agentInventory?: OnuAgentInventoryEnvelope | null;
}

export interface OltProvisioningPayload {
  profileId?: number | null;
  modelProfileId?: number | null;
  clientIdServicio: number;
  onuType: string;
  name: string;
  vlan: number;
  tcontProfile: string;
  trafficProfile: string;
  managementIp: string | null;
  serviceMode: 'router' | 'bridge';
  lanPorts: number[];
  previousOnuIndex?: string | null;
}

export interface OltProvisioningPreview {
  serial: string;
  onuIndex: string;
  client: OltClientSummary & { planInternetName?: string | null };
  config: Omit<OltProvisioningPayload, 'clientIdServicio'> & {
    serial: string; ponIndex: string; onuId: number; mask: string; gateway: string; primaryDns: string; secondaryDns: string;
  };
  inferredPlanSpeedMbps: number;
  modelProfile?: OnuModelProfile | null;
  relocation?: OltPonRelocation | null;
  warnings: string[];
  steps: string[];
  requiredConfirmation: string;
}

export interface OltProvisioningResult {
  ok: boolean;
  onuIndex: string;
  client: OltClientSummary;
  config: OltProvisioningPreview['config'];
  modelProfile?: OnuModelProfile | null;
  completedSteps: string[];
  online: boolean;
  phaseState: string;
  localProvisioning: { vlan: number; wanIp: string | null; mask: string; gateway: string; primaryDns: string; secondaryDns: string; ssid: string };
}

export interface OltReconciliation {
  totalOnus: number;
  linkedOnus: number;
  unlinkedOnus: number;
  manualLinks: number;
  serialLinks: number;
  duplicateAssignments: number;
  clientsWithSerial: number;
  clientsWithSerialNotFound: OltClientSummary[];
}

export interface OltAssociationCandidate {
  onuIndex: string;
  onuName?: string | null;
  serial?: string | null;
  method: 'serial' | 'name';
  client: { idServicio: number; nombre: string; usuario?: string | null; ip?: string | null };
}

export interface OltAssociationConflict {
  onuIndex: string;
  onuName?: string | null;
  serial?: string | null;
  reason: 'no_match' | 'ambiguous_client' | 'client_already_linked' | 'multiple_onus_for_client';
  candidates: Array<{ idServicio: number; nombre: string; usuario?: string | null; ip?: string | null }>;
}

export interface OltAssociationPreview {
  generatedAt: string;
  summary: {
    totalOnus: number; alreadyLinked: number; unlinked: number; safeMatches: number;
    exactSerial: number; exactName: number; conflicts: number; unmatched: number;
  };
  matches: OltAssociationCandidate[];
  conflicts: OltAssociationConflict[];
  unmatched: OltAssociationConflict[];
  requiredConfirmation: string;
}

export interface OltActivity {
  id: number;
  action: string;
  entityId?: string | null;
  entityName?: string | null;
  details: {
    actor?: string; role?: string; clientName?: string; idServicio?: number; totalOnus?: number; full?: boolean;
    oldName?: string | null; newName?: string | null; serial?: string | null; clientIdServicio?: number | null; verified?: boolean;
    activeLocation?: string | null; removed?: string[]; preserved?: string[];
  };
  createdAt: string;
}

export interface OltOnuPage {
  items: OltOnu[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface OltAlarm {
  id: number;
  alarmId: string;
  code?: string | null;
  level: string;
  alarmTime?: string | null;
  description: string;
  active: boolean;
  lastSeenAt: string;
}

export interface OltOperationPreview {
  action: 'reboot' | 'rename' | 'retire-stale' | 'retire-full'; onuIndex: string; title: string; impact: string; requiredConfirmation: string;
  allowed: boolean; reason?: string | null; oldName?: string | null; newName?: string | null; serial?: string | null;
  activeLocation?: Partial<OltOnu> | null; staleLocations?: Partial<OltOnu>[];
  serviceMode?: 'bridge' | 'router' | 'unknown'; macCount?: number;
}

@Injectable({ providedIn: 'root' })
export class OltService {
  private readonly http = inject(HttpClient);

  getStatus() { return this.http.get<OltStatus>('/olt-api/status'); }
  getPons() { return this.http.get<OltPon[]>('/olt-api/pons'); }
  getAlarms(active = true) { return this.http.get<OltAlarm[]>('/olt-api/alarms', { params: { active } }); }
  getSignalAlerts(active = true) { return this.http.get<OltSignalAlert[]>('/olt-api/signal-alerts', { params: { active } }); }
  getTopology() { return this.http.get<OltSplitter[]>('/olt-api/topology'); }
  createSplitter(payload: { name: string; ponIndex: string; ratio: number; splitterType?: string; zone?: string }) { return this.http.post<OltSplitter>('/olt-api/topology/splitters', payload); }
  createNap(payload: { code: string; name: string; splitterId: number; capacity: number; zone?: string }) { return this.http.post<OltNap>('/olt-api/topology/naps', payload); }
  updateNapPort(id: number, payload: { status: string; onuIndex?: string | null; clientIdServicio?: number | null }) { return this.http.patch<OltNapPort>(`/olt-api/topology/ports/${id}`, payload); }
  getProfiles() { return this.http.get<OltProvisioningProfile[]>('/olt-api/profiles'); }
  getOnuModelProfiles(active = true) {
    return this.http.get<OnuModelProfile[]>('/olt-api/model-profiles', { params: { active } });
  }
  createOnuModelProfile(payload: Partial<OnuModelProfile>) {
    return this.http.post<OnuModelProfile>('/olt-api/model-profiles', payload);
  }
  updateOnuModelProfile(id: number, payload: Partial<OnuModelProfile> & { changeReason?: string }) {
    return this.http.patch<OnuModelProfile>(`/olt-api/model-profiles/${id}`, payload);
  }
  reconcileOnuModelProfiles() {
    return this.http.post<{ ok: boolean; scanned: number; matched: number; unmatched: string[] }>('/olt-api/model-profiles/reconcile', {});
  }
  getPlanSyncPreview() { return this.http.get<OltPlanSyncPreview>('/olt-api/profiles/plan-sync'); }
  applyPlanSync(confirmation: string) {
    return this.http.post<{ ok: boolean; changed: boolean; preview: OltPlanSyncPreview; storedProfiles: OltProvisioningProfile[] }>('/olt-api/profiles/plan-sync', { confirmation });
  }
  createProfile(payload: Partial<OltProvisioningProfile>) { return this.http.post<OltProvisioningProfile>('/olt-api/profiles', payload); }
  updateProfile(id: number, payload: Partial<OltProvisioningProfile>) { return this.http.patch<OltProvisioningProfile>(`/olt-api/profiles/${id}`, payload); }

  getOnus(filters: { page: number; limit: number; search?: string; pon?: number; status?: string; mapping?: string }) {
    let params = new HttpParams().set('page', filters.page).set('limit', filters.limit);
    if (filters.search) params = params.set('search', filters.search);
    if (filters.pon) params = params.set('pon', filters.pon);
    if (filters.status && filters.status !== 'all') params = params.set('status', filters.status);
    if (filters.mapping && filters.mapping !== 'all') params = params.set('mapping', filters.mapping);
    return this.http.get<OltOnuPage>('/olt-api/onus', { params });
  }

  getOnuDetail(onu: OltOnu) {
    return this.http.get<OltOnu>(`/olt-api/onus/${onu.rack}/${onu.shelf}/${onu.pon}/${onu.onuId}/detail`);
  }

  getServiceDiagnostics(onu: OltOnu) {
    return this.http.get<OltServiceDiagnostic>(`/olt-api/onus/${onu.rack}/${onu.shelf}/${onu.pon}/${onu.onuId}/service-diagnostics`);
  }

  getOpticalHistory(onu: OltOnu, limit = 30) {
    return this.http.get<OltOpticalReading[]>(`/olt-api/onus/${onu.rack}/${onu.shelf}/${onu.pon}/${onu.onuId}/optical-history`, { params: { limit } });
  }

  searchClients(query: string) {
    return this.http.get<OltClientSummary[]>('/olt-api/clients/search', { params: { q: query } });
  }

  assignClient(onu: OltOnu, idServicio: number | null) {
    return this.http.patch<{ ok: boolean; client: OltClientSummary | null }>(`/olt-api/onus/${onu.rack}/${onu.shelf}/${onu.pon}/${onu.onuId}/client`, { idServicio });
  }
  previewOperation(onu: OltOnu, action: 'reboot' | 'rename' | 'retire-stale' | 'retire-full', name?: string) {
    let params = new HttpParams().set('action', action);
    if (name) params = params.set('name', name);
    return this.http.get<OltOperationPreview>(`/olt-api/onus/${onu.rack}/${onu.shelf}/${onu.pon}/${onu.onuId}/operations/preview`, { params });
  }
  executeOperation(onu: OltOnu, action: 'reboot' | 'rename' | 'retire-stale' | 'retire-full', confirmation: string, name?: string) {
    return this.http.post<{ ok: boolean; message: string; oldName?: string; newName?: string; removed?: string[]; activeLocation?: Partial<OltOnu> }>(`/olt-api/onus/${onu.rack}/${onu.shelf}/${onu.pon}/${onu.onuId}/operations`, { action, confirmation, name });
  }

  getTr069Device(serial: string) {
    return this.http.get<Tr069Device>(`/tr069-api/devices/${encodeURIComponent(serial)}`);
  }
  setTr069Enabled(serial: string, enabled: boolean) {
    return this.http.patch<Tr069Device>(`/tr069-api/devices/${encodeURIComponent(serial)}`, { enabled });
  }
  createTr069Task(serial: string, action: Tr069TaskAction, payload: Record<string, unknown> = {}) {
    return this.http.post<Tr069Task>(`/tr069-api/devices/${encodeURIComponent(serial)}/tasks`, { action, payload });
  }
  getTr069Parameters(serial: string, query = '') {
    return this.http.get<Tr069Parameter[]>(`/tr069-api/devices/${encodeURIComponent(serial)}/parameters`, { params: query ? { q: query } : {} });
  }
  getTr069Telemetry(serial: string, limit = 96) {
    return this.http.get<Tr069Telemetry[]>(`/tr069-api/devices/${encodeURIComponent(serial)}/telemetry`, { params: { limit } });
  }
  cancelTr069Task(id: string) {
    return this.http.post<Tr069Task>(`/tr069-api/tasks/${encodeURIComponent(id)}/cancel`, {});
  }
  retryTr069Task(id: string) {
    return this.http.post<Tr069Task>(`/tr069-api/tasks/${encodeURIComponent(id)}/retry`, {});
  }

  getUnconfigured() { return this.http.get<OltUnconfiguredOnu[]>('/olt-api/unconfigured'); }
  getProvisioningJobs() { return this.http.get<ProvisioningJob[]>('/provisioning/jobs'); }
  getProvisioningCancellationPreview(id: string) {
    return this.http.get<ProvisioningCancellationPreview>(`/provisioning/jobs/${encodeURIComponent(id)}/cancellation-preview`);
  }
  cancelProvisioningJob(id: string, confirmation: string) {
    return this.http.post<ProvisioningCancellationResult>(`/provisioning/jobs/${encodeURIComponent(id)}/cancel`, { confirmation });
  }
  getAvailableIps(cidr = '', query = '') {
    let params = new HttpParams();
    if (cidr) params = params.set('cidr', cidr);
    if (query) params = params.set('q', query);
    return this.http.get<ProvisioningIpCatalog>('/provisioning/ip-catalog', { params });
  }
  reserveIp(ip: string, clientName: string, serial?: string | null) {
    return this.http.post<ProvisioningIpReservation>('/provisioning/reservations', { ip, clientName, serial, durationMinutes: 60 });
  }
  releaseIpReservation(token: string) {
    return this.http.delete<ProvisioningIpReservation>(`/provisioning/reservations/${encodeURIComponent(token)}`);
  }
  createProvisioningJob(payload: ProvisioningJobRequest) {
    return this.http.post<ProvisioningJob>('/provisioning/jobs', payload);
  }
  assignReservedIp(clientIdServicio: number, reservationToken: string, serial: string) {
    return this.http.post<{ ok: boolean; client: OltClientSummary; reservation: ProvisioningIpReservation; job: ProvisioningJob; wisphubChanged: boolean; mikrotikAction: string }>(
      `/provisioning/clients/${clientIdServicio}/assign-ip`, { reservationToken, serial },
    );
  }
  getProvisioningOptions(serial: string) {
    return this.http.get<OltProvisioningCatalog>(`/olt-api/unconfigured/${encodeURIComponent(serial)}/provisioning-options`);
  }
  previewProvisioning(serial: string, payload: OltProvisioningPayload) {
    return this.http.post<OltProvisioningPreview>(`/olt-api/unconfigured/${encodeURIComponent(serial)}/provision/preview`, payload);
  }
  provisionOnu(serial: string, payload: OltProvisioningPayload, confirmation: string) {
    return this.http.post<OltProvisioningResult>(`/olt-api/unconfigured/${encodeURIComponent(serial)}/provision`, { ...payload, confirmation });
  }
  getReconciliation() { return this.http.get<OltReconciliation>('/olt-api/reconciliation'); }
  getAssociationPreview() { return this.http.get<OltAssociationPreview>('/olt-api/reconciliation/associations/preview'); }
  applyAssociationPreview(confirmation: string) {
    return this.http.post<{ ok: boolean; applied: number; skipped: unknown[]; preview: OltAssociationPreview }>(
      '/olt-api/reconciliation/associations/apply', { confirmation },
    );
  }
  getActivity() { return this.http.get<OltActivity[]>('/olt-api/activity'); }

  sync(full = false) {
    return this.http.post<{ ok: boolean; includeInventory: boolean; snapshot: OltSnapshot }>('/olt-api/sync', { full });
  }
}
