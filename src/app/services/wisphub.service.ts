import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { TicketResponse } from '../models/ticket.model';
import { PlanResponse, ZoneResponse } from '../models/plan.model';

export interface ClientEditResult {
  ok: boolean;
  changedFields: string[];
  client: {
    profile: { displayName: string; phone: string; nationalId: string; email: string; address: string; city: string };
    service: { ip: string; macCpe: string; lanInterface: string; onuSerial: string; wifiSsid: string; wifiPasswordConfigured: boolean; comments: string };
  };
}

export interface ClientRenameResult {
  ok: boolean;
  idServicio: number;
  before: string;
  name: string;
  wisphub: 'renamed' | 'unchanged';
  mikrotik: 'renamed' | 'unchanged' | 'no_queue';
  queueName: string | null;
}

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
  /** Cambia el nombre del cliente en WispHub, en su cola del MikroTik y en ISP Max, y lo verifica. */
  renameClient(idServicio: number, name: string): Observable<ClientRenameResult> {
    return this.http.patch<ClientRenameResult>(`/clients-actions/${idServicio}/name`, { name });
  }

  /** Datos personales confirmados en WispHub antes de guardarse en ISP Max. Solo los campos que cambiaron. */
  editClientProfile(idServicio: number, changes: Partial<Record<'phone' | 'nationalId' | 'email' | 'address' | 'city', string>>): Observable<ClientEditResult> {
    return this.http.patch<ClientEditResult>(`/clients-actions/${idServicio}/profile`, changes);
  }

  /** Datos tecnicos confirmados en WispHub; una IP nueva tambien mueve la cola del MikroTik. */
  editClientService(idServicio: number, changes: Partial<Record<'ip' | 'macCpe' | 'lanInterface' | 'onuSerial' | 'wifiSsid' | 'wifiPassword' | 'comments', string>>): Observable<ClientEditResult> {
    return this.http.patch<ClientEditResult>(`/clients-actions/${idServicio}/service`, changes);
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
