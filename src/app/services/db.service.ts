import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface PaymentLog {
  id?: number;
  idFactura: number;
  idServicio?: number;
  clientName: string;
  amount: number;
  paymentMethodId?: number;
  paymentMethodName?: string;
  paidAt: string;
  notes?: string;
  success?: boolean;
  errorMessage?: string;
  createdAt?: string;
}

export interface ClientNote {
  id?: number;
  idServicio: number;
  clientName: string;
  note: string;
  priority?: 'low' | 'normal' | 'high' | 'alert';
  createdAt?: string;
  updatedAt?: string;
}

export interface PaymentPromise {
  id?: number;
  idServicio: number;
  clientName: string;
  amount: number;
  promisedDate: string;
  status?: 'pending' | 'paid' | 'broken';
  notes?: string;
  createdAt?: string;
  completedAt?: string;
}

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

export interface Activity {
  id?: number;
  action: string;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  details?: string;
  createdAt?: string;
}

@Injectable({ providedIn: 'root' })
export class DbService {
  private http = inject(HttpClient);

  // ─── PAYMENTS ───
  getPayments(limit = 200): Observable<PaymentLog[]> {
    return this.http.get<PaymentLog[]>(`/db/payments?limit=${limit}`);
  }

  logPayment(data: PaymentLog): Observable<PaymentLog> {
    return this.http.post<PaymentLog>('/db/payments', data);
  }

  // ─── NOTES ───
  getClientNotes(idServicio: number): Observable<ClientNote[]> {
    return this.http.get<ClientNote[]>(`/db/notes/${idServicio}`);
  }

  getAllNotes(): Observable<ClientNote[]> {
    return this.http.get<ClientNote[]>('/db/notes');
  }

  createNote(data: ClientNote): Observable<ClientNote> {
    return this.http.post<ClientNote>('/db/notes', data);
  }

  updateNote(id: number, data: Partial<ClientNote>): Observable<ClientNote> {
    return this.http.put<ClientNote>(`/db/notes/${id}`, data);
  }

  deleteNote(id: number): Observable<any> {
    return this.http.delete(`/db/notes/${id}`);
  }

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

  // ─── PROMISES ───
  getPromises(idServicio?: number): Observable<PaymentPromise[]> {
    const q = idServicio ? `?idServicio=${idServicio}` : '';
    return this.http.get<PaymentPromise[]>(`/db/promises${q}`);
  }

  createPromise(data: PaymentPromise): Observable<PaymentPromise> {
    return this.http.post<PaymentPromise>('/db/promises', data);
  }

  updatePromise(id: number, data: Partial<PaymentPromise>): Observable<PaymentPromise> {
    return this.http.put<PaymentPromise>(`/db/promises/${id}`, data);
  }

  // ─── SETTINGS ───
  getSettings(): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>('/db/settings');
  }

  updateSettings(settings: Record<string, any>): Observable<any> {
    return this.http.put('/db/settings', settings);
  }

  // ─── ACTIVITY ───
  getActivity(limit = 100): Observable<Activity[]> {
    return this.http.get<Activity[]>(`/db/activity?limit=${limit}`);
  }

  logActivity(data: Activity): Observable<Activity> {
    return this.http.post<Activity>('/db/activity', data);
  }

  // ─── STATS ───
  getStats(): Observable<any> {
    return this.http.get('/db/stats');
  }

  // ─── HEALTH CHECK ───
  isConnected(): Observable<boolean> {
    return new Observable(observer => {
      this.http.get('/db/stats').subscribe({
        next: () => { observer.next(true); observer.complete(); },
        error: () => { observer.next(false); observer.complete(); }
      });
    });
  }
}
