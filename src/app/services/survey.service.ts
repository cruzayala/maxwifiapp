import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SurveyResponse {
  id: number;
  clientIp: string;
  idServicio: number | null;
  fullName: string | null;
  phone: string | null;
  status: 'pending' | 'submitted' | 'expired' | 'cancelled';
  sentBy: string;
  sentAt: string;
  submittedAt: string | null;
  lastReminderAt?: string | null;
  nextReminderAt?: string | null;
  reminderCount?: number;
  lastReminderStatus?: string | null;
  snoozedAt?: string | null;
  snoozeCount?: number;
  userAgent: string | null;
  notes: string | null;
  publicToken?: string | null;
  publicUrl?: string | null;
  shortCode?: string | null;
  shortUrl?: string | null;
  portalUrl?: string | null;
  client?: {
    idServicio: number;
    nombre: string;
    telefono: string | null;
    ip: string | null;
    planInternetName: string | null;
  } | null;
}

export interface SurveyStats {
  pending: number;
  submitted: number;
  total: number;
}

@Injectable({ providedIn: 'root' })
export class SurveyService {
  private http = inject(HttpClient);

  start(ip: string, idServicio?: number): Observable<{ ok: boolean; survey: SurveyResponse; alreadyPending?: boolean; alreadySubmitted?: boolean; publicUrl?: string; portalUrl?: string; delivery?: string; networkImpact?: boolean; reminder?: any; error?: string }> {
    return this.http.post<any>('/api/survey/start', { ip, idServicio });
  }

  cancel(id: number): Observable<{ ok: boolean }> {
    return this.http.post<any>(`/api/survey/cancel/${id}`, {});
  }

  resend(id: number): Observable<{ ok: boolean; message?: string; error?: string; publicUrl?: string }> {
    return this.http.post<any>(`/api/survey/resend/${id}`, {});
  }

  getTemplate(): Observable<{ ok: boolean; template: string; default: string; placeholders: string[] }> {
    return this.http.get<any>('/api/survey/template');
  }

  saveTemplate(template: string): Observable<{ ok: boolean; template?: string; error?: string }> {
    return this.http.put<any>('/api/survey/template', { template });
  }

  clear(ip?: string | null, idServicio?: number | null): Observable<{ ok: boolean; snoozed: number; cancelled: number; reminderIntervalHours?: number; nextReminderAt?: string | null; mikrotik?: any; error?: string }> {
    return this.http.post<any>('/api/survey/clear', { ip, idServicio });
  }

  list(status?: string): Observable<{ ok: boolean; rows: SurveyResponse[] }> {
    const qs = status ? `?status=${status}` : '';
    return this.http.get<any>(`/api/survey/responses${qs}`);
  }

  delete(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<any>(`/api/survey/responses/${id}`);
  }

  stats(): Observable<{ ok: boolean } & SurveyStats> {
    return this.http.get<any>('/api/survey/stats');
  }
}
