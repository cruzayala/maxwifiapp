import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface MtStatus {
  configured: boolean;
  connected: boolean;
  host: string;
  error?: string;
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
}

export interface MtConsumer {
  name: string;
  target: string;
  maxLimit: string;
  uploadBytes: number;
  downloadBytes: number;
  totalBytes: number;
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

  ping(address: string, count = 4): Observable<any[]> {
    return this.http.post<any[]>('/mikrotik/ping', { address, count });
  }

  getLiveClients(): Observable<{
    timestamp: string;
    stats: {
      totalQueues: number;
      activeClients: number;
      totalUploadBps: number;
      totalDownloadBps: number;
      totalBpsCombined: number;
    };
    clients: any[];
  }> {
    return this.http.get<any>('/mikrotik/clients-live');
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
