import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type ClientAction = 'moroso' | 'block' | 'clear';

export interface ClientActionResult {
  ok: boolean;
  ip?: string;
  error?: string;
  mt?: { alreadyIn?: boolean; wasIn?: boolean };
  captiveUrl?: string;
  connectionsKilled?: number;
  rules?: unknown;
}

export interface PaymentPilotResult {
  ok: boolean;
  idServicio: number;
  paymentPilotEnabled: boolean;
  paymentPilotEnabledAt?: string | null;
  paymentPilotEnabledBy?: string | null;
  captiveUrl?: string | null;
}

export interface BlockListSnapshot {
  morosos: { id: string; address: string; comment: string }[];
  bloqueados: { id: string; address: string; comment: string }[];
}

@Injectable({ providedIn: 'root' })
export class ClientActionsService {
  private http = inject(HttpClient);

  apply(
    idServicio: number,
    action: ClientAction,
    reason: string,
    pilotConfirmed = false,
  ): Observable<ClientActionResult> {
    return this.http.post<ClientActionResult>(
      `/clients-actions/${idServicio}/${action}`,
      { reason, pilotConfirmed },
    );
  }

  setPaymentPilot(idServicio: number, enabled: boolean): Observable<PaymentPilotResult> {
    return this.http.patch<PaymentPilotResult>(
      `/clients-actions/${idServicio}/payment-pilot`,
      { enabled, confirmation: enabled ? 'HABILITAR PORTAL' : 'DESHABILITAR PORTAL' },
    );
  }

  events(idServicio: number): Observable<unknown[]> {
    return this.http.get<unknown[]>(`/clients-actions/${idServicio}/events`);
  }

  states(): Observable<
    { idServicio: number; crmAction: string | null; crmActionReason: string | null; crmActionAt: string | null; paymentPilotEnabled: boolean; paymentPilotEnabledAt: string | null }[]
  > {
    return this.http.get<any[]>(`/clients-actions/states`);
  }

  blockListSnapshot(): Observable<BlockListSnapshot> {
    return this.http.get<BlockListSnapshot>('/mikrotik/blocklist/list');
  }

  setupRules(host?: string, port?: number): Observable<unknown> {
    return this.http.post('/mikrotik/blocklist/setup', { host, port });
  }
}
