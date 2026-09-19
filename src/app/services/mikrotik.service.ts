import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface MtStatus {
  configured: boolean;
  connected: boolean;
  host: string;
  error?: string;
  telemetry?: {
    commandQueue: { depth: number; pending: number; running: boolean; timeouts: number; lastDurationMs?: number | null; lastQueueWaitMs?: number | null };
    cache: { hits: number; misses: number; coalesced: number; staleServed: number; entries: number; inFlight: number };
  };
}

export interface MtSystem {
  resource: any;
  identity: string;
  health: any[];
}

export interface MtTraffic {
  name: string;
  type: string;
  running: boolean;
  macAddress: string;
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
}

export interface MtQueue {
  id: string;
  name: string;
  target: string;
  maxLimit: string;
  burstLimit?: string;
  bytes?: string;
  packets?: string;
  rate?: string;
  disabled: boolean;
  comment?: string | null;
}

export interface MtConsumer {
  name: string;
  target: string;
  maxLimit: string;
  uploadBytes: number;
  downloadBytes: number;
  totalBytes: number;
}

export type MtSyncState = 'synced' | 'missing_wisphub' | 'missing_mikrotik' | 'missing_ip' | 'queue_mismatch' | 'state_mismatch';

export interface MtLiveClient {
  queueId: string | null;
  queueName: string;
  ip: string;
  client: {
    id: number;
    username?: string | null;
    name: string;
    wisphubName?: string | null;
    phone?: string | null;
    address?: string | null;
    plan?: string | null;
    price?: string | null;
    balance?: string | null;
    status?: string | null;
    invoiceStatus?: string | null;
    zone?: string | null;
    router?: string | null;
    interface?: string | null;
    macAddress?: string | null;
    snOnu?: string | null;
    crmAction?: string | null;
    crmActionReason?: string | null;
    paymentPilotEnabled?: boolean;
    paymentPilotEnabledAt?: string | null;
    syncedAt?: string | null;
    mtSyncedAt?: string | null;
    equipmentCount?: number;
  } | null;
  maxUploadBps: number;
  maxDownloadBps: number;
  uploadBps: number;
  downloadBps: number;
  totalUploadBytes: number;
  totalDownloadBytes: number;
  totalBytes: number;
  uploadPct: number;
  downloadPct: number;
  isOnline: boolean;
  isActive: boolean;
  isTransmitting: boolean;
  isDisabled: boolean;
  interface?: string | null;
  macAddress?: string | null;
  sessionUptime?: string | null;
  sessionUser?: string | null;
  syncState: MtSyncState;
}

export interface MtLiveResponse {
  timestamp: string;
  stats: {
    totalQueues: number;
    totalClients: number;
    mikrotikQueues: number;
    activeClients: number;
    onlineClients: number;
    offlineClients: number;
    transmittingClients: number;
    differences: number;
    overdueClients: number;
    missingWisphub: number;
    missingMikrotik: number;
    clientsWithoutIp: number;
    disabledQueues: number;
    totalUploadBps: number;
    totalDownloadBps: number;
    totalBpsCombined: number;
  };
  clients: MtLiveClient[];
}

export interface MtUnknownDevice {
  ip: string;
  macAddress: string | null;
  interface: string | null;
  bridgePort: string | null;
  identity: string | null;
  platform: string | null;
  version: string | null;
  queueId: string | null;
  queueName: string | null;
  maxLimit: string | null;
  disabled: boolean;
  uploadBps: number;
  downloadBps: number;
  totalUploadBytes: number;
  totalDownloadBytes: number;
  connectionCount: number;
  likelyInfrastructure: boolean;
  classification: 'unregistered_queue' | 'infrastructure_candidate' | 'unmanaged_device';
  risk: 'high' | 'medium' | 'low';
}

export interface MtUnknownResponse {
  timestamp: string;
  stats: { total: number; highRisk: number; unmanaged: number; unregisteredQueues: number; infrastructureCandidates: number };
  devices: MtUnknownDevice[];
}

export interface MtSecurityFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  code: string;
  title: string;
  detail: string;
}

export interface MtSecurityAudit {
  timestamp: string;
  score: number;
  version: string;
  minimumVersion: string;
  counts: { critical: number; high: number; medium: number; low: number };
  findings: MtSecurityFinding[];
  activeAdministrators: Array<{ name: string; address: string; via: string; when: string }>;
}

export interface MtQueueMutation {
  targetIp?: string;
  name?: string;
  uploadMbps?: number;
  downloadMbps?: number;
  disabled?: boolean;
  comment?: string;
}

export interface MtBackup { id: string; name: string; type: 'backup' | 'export'; size: number; creationTime: string | null }

export type MtFirewallTable = 'filter' | 'nat' | 'mangle' | 'address-list';
export interface MtFirewallRule {
  id: string; table: MtFirewallTable; chain: string | null; action: string | null;
  srcAddress: string | null; dstAddress: string | null; protocol: string | null; dstPort: string | null;
  inInterface: string | null; outInterface: string | null; list: string | null; address: string | null;
  timeout: string | null; comment: string | null; bytes: number; packets: number;
  disabled: boolean; dynamic: boolean; invalid: boolean;
}
export interface MtFirewallResponse { timestamp: string; tables: Record<MtFirewallTable, MtFirewallRule[]> }

export interface MtIpamRow {
  ip: string; cidr: string | null; macAddress: string | null; macAddresses: string[]; interface: string | null;
  leaseId: string | null; hostName: string | null; server: string | null; status: string;
  queueId: string | null; queueName: string | null; poolName: string | null;
  dynamic: boolean; disabled: boolean;
  classification: 'client' | 'unknown_lease' | 'arp_only' | 'queue_only' | 'pool_reserved' | 'router' | 'available';
  available: boolean; recommended: boolean; sources: string[]; conflict: boolean;
  client: { id: number; name: string; username: string } | null;
}
export interface MtIpamResponse {
  timestamp: string | null; source: 'live' | 'sqlite'; stale?: boolean; error?: string | null; truncated?: boolean;
  stats: { total: number; matchedClients: number; unknownLeases: number; arpOnly: number; queueOnly: number; poolReserved: number; routerAddresses: number; occupiedWithoutClient: number; available: number; ipConflicts: number; macMoves: number };
  networks: Array<{ cidr: string; network: string; prefix: number; capacity: number; used: number; available: number; utilization: number; recommended: string[] }>;
  conflicts: { ip: Array<{ ip: string; macAddresses: string[] }>; mac: Array<{ macAddress: string; ips: string[] }> };
  rows: MtIpamRow[];
}

export interface MtSpeedTemplate { id: string; name: string; uploadMbps: number; downloadMbps: number }

export interface MtNetwatch {
  id: string; host: string; type: string; interval: string | null; timeout: string | null;
  port: number | null; status: string; since: string | null; comment: string | null; disabled: boolean;
}

@Injectable({ providedIn: 'root' })
export class MikrotikService {
  private http = inject(HttpClient);

  getStatus(): Observable<MtStatus> {
    return this.http.get<MtStatus>('/mikrotik/status');
  }

  getSystem(): Observable<MtSystem> {
    return this.http.get<MtSystem>('/mikrotik/system');
  }

  getInterfaces(): Observable<any[]> {
    return this.http.get<any[]>('/mikrotik/interfaces');
  }

  getTraffic(): Observable<MtTraffic[]> {
    return this.http.get<MtTraffic[]>('/mikrotik/traffic');
  }

  monitorInterface(name: string): Observable<any> {
    return this.http.get(`/mikrotik/monitor/${encodeURIComponent(name)}`);
  }

  getQueues(): Observable<MtQueue[]> {
    return this.http.get<MtQueue[]>('/mikrotik/queues');
  }

  getQueueStats(): Observable<any[]> {
    return this.http.get<any[]>('/mikrotik/queue-stats');
  }

  createQueue(data: Required<Pick<MtQueueMutation, 'targetIp' | 'name' | 'uploadMbps' | 'downloadMbps'>> & MtQueueMutation): Observable<any> {
    return this.http.post('/mikrotik/queues', data);
  }

  updateQueue(id: string, data: MtQueueMutation): Observable<any> {
    return this.http.patch(`/mikrotik/queues/${encodeURIComponent(id)}`, data);
  }

  getUnknownDevices(): Observable<MtUnknownResponse> {
    return this.http.get<MtUnknownResponse>('/mikrotik/unknown-devices');
  }

  getSecurityAudit(): Observable<MtSecurityAudit> {
    return this.http.get<MtSecurityAudit>('/mikrotik/security-audit');
  }

  getTopConsumers(limit = 20): Observable<MtConsumer[]> {
    return this.http.get<MtConsumer[]>(`/mikrotik/top-consumers?limit=${limit}`);
  }

  getAddresses(): Observable<any[]> {
    return this.http.get<any[]>('/mikrotik/addresses');
  }

  getActiveSessions(): Observable<{ pppoe: any[]; hotspot: any[] }> {
    return this.http.get<{ pppoe: any[]; hotspot: any[] }>('/mikrotik/active-sessions');
  }

  getDhcpLeases(): Observable<any[]> {
    return this.http.get<any[]>('/mikrotik/dhcp-leases');
  }

  getArp(): Observable<any[]> {
    return this.http.get<any[]>('/mikrotik/arp');
  }

  getBackups(): Observable<MtBackup[]> { return this.http.get<MtBackup[]>('/mikrotik/backups'); }
  createBackup(data: { name: string; type: 'backup' | 'export'; confirmation: 'CREAR' }): Observable<any> {
    return this.http.post('/mikrotik/backups', data);
  }
  deleteBackup(id: string): Observable<any> {
    return this.http.delete(`/mikrotik/backups/${encodeURIComponent(id)}`, { body: { confirmation: 'ELIMINAR' } });
  }

  getFirewall(): Observable<MtFirewallResponse> { return this.http.get<MtFirewallResponse>('/mikrotik/firewall'); }
  toggleFirewallRule(table: MtFirewallTable, id: string, disabled: boolean): Observable<any> {
    return this.http.patch(`/mikrotik/firewall/${table}/${encodeURIComponent(id)}`, { disabled, confirmation: 'APLICAR' });
  }
  deleteFirewallRule(table: MtFirewallTable, id: string): Observable<any> {
    return this.http.delete(`/mikrotik/firewall/${table}/${encodeURIComponent(id)}`, { body: { confirmation: 'ELIMINAR' } });
  }

  getIpam(): Observable<MtIpamResponse> { return this.http.get<MtIpamResponse>('/mikrotik/ipam'); }
  makeLeaseStatic(id: string): Observable<any> {
    return this.http.post(`/mikrotik/ipam/leases/${encodeURIComponent(id)}/make-static`, { confirmation: 'FIJAR' });
  }

  getSpeedTemplates(): Observable<MtSpeedTemplate[]> { return this.http.get<MtSpeedTemplate[]>('/mikrotik/speed-templates'); }
  saveSpeedTemplate(data: Omit<MtSpeedTemplate, 'id'> & { id?: string }): Observable<any> {
    return this.http.post('/mikrotik/speed-templates', data);
  }
  deleteSpeedTemplate(id: string): Observable<any> {
    return this.http.delete(`/mikrotik/speed-templates/${encodeURIComponent(id)}`, { body: { confirmation: 'ELIMINAR' } });
  }
  applySpeedTemplate(templateId: string, queueIds: string[]): Observable<any> {
    return this.http.post('/mikrotik/speed-templates/apply', { templateId, queueIds, confirmation: 'APLICAR' });
  }

  getNetwatch(): Observable<MtNetwatch[]> { return this.http.get<MtNetwatch[]>('/mikrotik/netwatch'); }
  createNetwatch(data: { host: string; type: string; interval: string; port?: number; comment?: string }): Observable<any> {
    return this.http.post('/mikrotik/netwatch', { ...data, confirmation: 'CREAR' });
  }
  updateNetwatch(id: string, data: Partial<Pick<MtNetwatch, 'host' | 'type' | 'interval' | 'port' | 'comment' | 'disabled'>>): Observable<any> {
    return this.http.patch(`/mikrotik/netwatch/${encodeURIComponent(id)}`, { ...data, confirmation: 'APLICAR' });
  }
  deleteNetwatch(id: string): Observable<any> {
    return this.http.delete(`/mikrotik/netwatch/${encodeURIComponent(id)}`, { body: { confirmation: 'ELIMINAR' } });
  }

  ping(address: string, count = 4): Observable<any[]> {
    return this.http.post<any[]>('/mikrotik/ping', { address, count });
  }

  getLiveClients(): Observable<MtLiveResponse> {
    return this.http.get<MtLiveResponse>('/mikrotik/clients-live');
  }

  getWanTraffic(): Observable<{
    ifaceName: string;
    rxBps: number;
    txBps: number;
    rxPps: number;
    txPps: number;
    maxBps: number;
    timestamp: number;
  }> {
    return this.http.get<any>('/mikrotik/wan-traffic');
  }
}
