import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { TicketResponse } from '../models/ticket.model';
import { PlanResponse, ZoneResponse } from '../models/plan.model';

export interface ClientProvisioningRequest {
  jobId?: string;
  zoneId: number;
  planId: number;
  serviceName: string;
  ip: string;
  uploadMbps: number;
  downloadMbps: number;
  phone?: string;
  nationalId?: string;
  email?: string;
  city?: string;
  address?: string;
}

export interface ClientProvisioningResult {
  ok: boolean;
  status: 'complete' | 'partial' | 'failed';
  resumed?: boolean;
  canRetry?: boolean;
  error?: string;
  wisphub: { ok: boolean; created?: boolean; idServicio?: number | null; taskId?: string | null; warning?: string | null };
  mikrotik: { ok: boolean; action?: 'created' | 'updated' | 'verified'; id?: string | null; target?: string; maxLimit?: string };
  sqlite?: { ok: boolean; idServicio: number };
  profile?: { attempted: boolean; ok: boolean; warning?: string };
  client?: { idServicio: number; nombre: string; ip?: string | null };
}

@Injectable({ providedIn: 'root' })
export class WisphubService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  // ─── CLIENTES ───
  getClientProfile(idServicio: number): Observable<any> {
    return this.http.get(`${this.api}/clientes/${idServicio}/perfil/`);
  }

  /** Editar nombre del servicio (tambien actualiza nombre en perfil) */
  updateServiceName(idServicio: number, nombre: string): Observable<any> {
    return this.http.patch(`${this.api}/clientes/${idServicio}/`, { usuario_rb: nombre });
  }

  /** Editar datos del servicio: IP, plan, zona, MAC, WiFi, etc */
  updateService(idServicio: number, data: any): Observable<any> {
    return this.http.patch(`${this.api}/clientes/${idServicio}/`, data);
  }

  /** Editar datos personales: telefono, cedula, email, direccion */
  updateProfile(idServicio: number, data: any): Observable<any> {
    return this.http.put(`${this.api}/clientes/${idServicio}/perfil/`, data);
  }

  provisionClient(data: ClientProvisioningRequest): Observable<ClientProvisioningResult> {
    return this.http.post<ClientProvisioningResult>('/client-provisioning', data);
  }

  activateClient(idServicio: number): Observable<any> {
    return this.http.post(`${this.api}/clientes/activar/`, { servicios: [idServicio] });
  }

  deactivateClient(idServicio: number): Observable<any> {
    return this.http.post(`${this.api}/clientes/desactivar/`, { servicios: [idServicio] });
  }

  pingClient(idServicio: number): Observable<any> {
    return this.http.post(`${this.api}/clientes/${idServicio}/ping/`, {});
  }

  paymentOptions(id: number): Observable<any> { return this.http.get(`/billing/invoices/${id}/payment-options`); }
  submitPayment(id: number, body: { amount: number; paymentMethodId: number; paidAt: string; invoiceVersion: string }, key: string): Observable<any> {
    return this.http.post(`/billing/payments/${id}`, body, { headers: { 'Idempotency-Key': key } });
  }
  verifyPayment(id: string): Observable<any> { return this.http.post(`/billing/operations/${encodeURIComponent(id)}/verify`, {}); }

  // ─── TICKETS ───
  getTickets(): Observable<TicketResponse> {
    return this.http.get<TicketResponse>(`${this.api}/tickets/`);
  }

  // ─── PLANES ───
  getPlans(): Observable<PlanResponse> {
    return this.http.get<PlanResponse>(`${this.api}/plan-internet/`);
  }

  // ─── ZONAS ───
  getZones(): Observable<ZoneResponse> {
    return this.http.get<ZoneResponse>(`${this.api}/zonas/`);
  }

  // ─── TASKS ASYNC ───
  getTaskStatus(taskId: string): Observable<any> {
    return this.http.get(`${this.api}/tasks/${taskId}/`);
  }

}
