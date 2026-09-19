import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export type NetworkHealthState = 'stable' | 'degraded' | 'offline' | 'unknown';

export interface NetworkAuditStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  rawRetentionDays: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  clientsStored: number;
  durationMs: number | null;
  clientSamples: number;
  dailyRows: number;
  wanSamples: number;
  latestWan: WanNetworkSample | null;
}

export interface ClientAuditRow {
  idServicio: number;
  name: string;
  username: string | null;
  ip: string | null;
  plan: string | null;
  zone: string | null;
  clientStatus: string | null;
  sampleCount: number;
  availabilityPercent: number;
  stabilityPercent: number;
  degradedSamples: number;
  offlineSamples: number;
  avgUploadMbps: number;
  avgDownloadMbps: number;
  peakUploadMbps: number;
  peakDownloadMbps: number;
  avgRxPowerDbm: number | null;
  minRxPowerDbm: number | null;
  maxRxPowerDbm: number | null;
  latestState: NetworkHealthState;
  latestOnline: boolean;
  latestUploadMbps: number;
  latestDownloadMbps: number;
  latestRxPowerDbm: number | null;
  opticalState: string;
  onuIndex: string | null;
  lastCapturedAt: string | null;
}

export interface ClientAuditPage {
  days: number;
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  summary: {
    monitoredClients: number;
    attentionClients: number;
    availabilityPercent: number;
    stabilityPercent: number;
    totalSamples: number;
    expectedSamplesPerDay: number;
  };
  items: ClientAuditRow[];
}

export interface ClientNetworkSample {
  id: number;
  capturedAt: string;
  uploadBps: number;
  downloadBps: number;
  maxUploadBps: number;
  maxDownloadBps: number;
  mikrotikOnline: boolean;
  onuOnline: boolean | null;
  serviceOnline: boolean;
  healthState: NetworkHealthState;
  stabilityScore: number;
  rxPowerDbm: number | null;
  opticalState: string;
  issues: string | null;
}

export interface WanNetworkSample {
  id: number;
  capturedAt: string;
  ifaceName: string | null;
  rxBps: number;
  txBps: number;
  maxBps: number;
  utilizationPercent: number;
  pingLossPercent: number | null;
  pingAvgMs: number | null;
  pingMaxMs: number | null;
  clientsOnline: number;
  clientsOffline: number;
  oltConnected: boolean;
  oltOnlineOnus: number;
  oltOfflineOnus: number;
  oltActiveAlarms: number;
  oltCriticalAlarms: number;
  healthState: NetworkHealthState;
  errorMessage: string | null;
}

export interface WanAuditResponse {
  hours: number;
  summary: {
    samples: number;
    avgRxMbps: number;
    avgTxMbps: number;
    peakRxMbps: number;
    peakTxMbps: number;
    avgPingMs: number | null;
    stabilityPercent: number;
  };
  items: WanNetworkSample[];
}

@Injectable({ providedIn: 'root' })
export class NetworkAuditService {
  private readonly http = inject(HttpClient);

  status(): Observable<NetworkAuditStatus> {
    return this.http.get<NetworkAuditStatus>('/network-audit/status');
  }

  clients(filters: { days: number; q?: string; status?: string; page?: number; pageSize?: number }): Observable<ClientAuditPage> {
    let params = new HttpParams().set('days', filters.days).set('page', filters.page || 1).set('pageSize', filters.pageSize || 50);
    if (filters.q) params = params.set('q', filters.q);
    if (filters.status && filters.status !== 'all') params = params.set('status', filters.status);
    return this.http.get<ClientAuditPage>('/network-audit/clients', { params });
  }

  clientDetail(idServicio: number, days = 7): Observable<{ client: any; samples: ClientNetworkSample[]; daily: any[] }> {
    return this.http.get<{ client: any; samples: ClientNetworkSample[]; daily: any[] }>(`/network-audit/clients/${idServicio}`, { params: { days } });
  }

  wan(hours = 24, limit = 500): Observable<WanAuditResponse> {
    return this.http.get<WanAuditResponse>('/network-audit/wan', { params: { hours, limit } });
  }

  collect(): Observable<any> {
    return this.http.post('/network-audit/collect', {});
  }
}

