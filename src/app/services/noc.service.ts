import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';

export interface NocIncidentEvent {
  id: number;
  type: string;
  message: string;
  createdBy?: string | null;
  createdAt: string;
}

export interface NocImpactedClient {
  idServicio: number;
  nombre: string;
  aliasNombre?: string | null;
  usuario?: string | null;
  ip?: string | null;
  telefono?: string | null;
  zonaNombre?: string | null;
}

export interface NocIncident {
  id: number;
  fingerprint: string;
  source: string;
  category: string;
  title: string;
  description?: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  scopeType: string;
  scopeKey: string;
  scopeLabel: string;
  affectedClients: number;
  affectedClientIds: number[];
  assignedTo?: string | null;
  detectionCount: number;
  recoveryStreak: number;
  detectedAt: string;
  lastSeenAt: string;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolutionNote?: string | null;
  events?: NocIncidentEvent[];
  clients?: NocImpactedClient[];
}

export interface NocSummary {
  active: number;
  open: number;
  acknowledged: number;
  critical: number;
  affectedClients: number;
  last24h: number;
  evaluator: {
    enabled: boolean;
    running: boolean;
    intervalMs: number;
    lastRunAt?: string | null;
    lastResult?: { created: number; updated: number; resolved: number; candidates: number; durationMs: number } | null;
  };
}

export interface NocIncidentPage {
  items: NocIncident[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable({ providedIn: 'root' })
export class NocService {
  private readonly http = inject(HttpClient);

  summary(): Observable<NocSummary> {
    return this.http.get<NocSummary>('/noc/summary');
  }

  incidents(filters: { status?: string; severity?: string; q?: string; page?: number; pageSize?: number }): Observable<NocIncidentPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && String(value) !== '') params = params.set(key, String(value));
    }
    return this.http.get<NocIncidentPage>('/noc/incidents', { params });
  }

  detail(id: number): Observable<NocIncident> {
    return this.http.get<NocIncident>(`/noc/incidents/${id}`);
  }

  evaluate(): Observable<{ created: number; updated: number; resolved: number; candidates: number }> {
    return this.http.post<{ created: number; updated: number; resolved: number; candidates: number }>('/noc/evaluate', {});
  }

  action(id: number, action: 'acknowledge' | 'resolve' | 'reopen' | 'assign' | 'note', data: { note?: string; assignedTo?: string } = {}): Observable<NocIncident> {
    return this.http.patch<NocIncident>(`/noc/incidents/${id}`, { action, ...data });
  }
}
