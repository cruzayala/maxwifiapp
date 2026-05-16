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
  userAgent: string | null;
  notes: string | null;
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

  start(ip: string, idServicio?: number): Observable<{ ok: boolean; survey: SurveyResponse; alreadyPending?: boolean; error?: string }> {
    return this.http.post<any>('/api/survey/start', { ip, idServicio });
  }

  cancel(id: number): Observable<{ ok: boolean }> {
    return this.http.post<any>(`/api/survey/cancel/${id}`, {});
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
