import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SpeedTestRecord {
  id?: number;
  idServicio?: number;
  clientName?: string;
  clientIp?: string;
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  jitterMs: number;
  location?: string;
  notes?: string;
  createdAt?: string;
}

export interface InvoiceHistorySyncStatus {
  running: boolean;
  status: 'idle' | 'running' | 'success' | 'error';
  windowsCompleted: number;
  windowsTotal: number;
  fetched: number;
  saved: number;
  through?: string | null;
  error?: string | null;
}

@Injectable({ providedIn: 'root' })
export class DbService {
  private http = inject(HttpClient);

  // ─── SPEED TESTS ───
  getSpeedTests(idServicio?: number, limit = 100): Observable<SpeedTestRecord[]> {
    const params = new URLSearchParams();
    if (idServicio) params.append('idServicio', String(idServicio));
    params.append('limit', String(limit));
    return this.http.get<SpeedTestRecord[]>(`/db/speedtests?${params}`);
  }

  logSpeedTest(data: SpeedTestRecord): Observable<SpeedTestRecord> {
    return this.http.post<SpeedTestRecord>('/db/speedtests', data);
  }

  // ─── HISTORIAL DE FACTURAS ───
  startInvoiceHistorySync(): Observable<InvoiceHistorySyncStatus & { started: boolean }> {
    return this.http.post<InvoiceHistorySyncStatus & { started: boolean }>('/db/invoices/sync-history', {});
  }

  getInvoiceHistorySyncStatus(): Observable<InvoiceHistorySyncStatus> {
    return this.http.get<InvoiceHistorySyncStatus>('/db/invoices/sync-status');
  }
}
