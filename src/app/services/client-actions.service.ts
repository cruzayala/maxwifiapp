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
  ): Observable<ClientActionResult> {
    return this.http.post<ClientActionResult>(
      `/clients-actions/${idServicio}/${action}`,
      { reason },
    );
  }

  events(idServicio: number): Observable<unknown[]> {
    return this.http.get<unknown[]>(`/clients-actions/${idServicio}/events`);
  }

  states(): Observable<
    { idServicio: number; crmAction: string | null; crmActionReason: string | null; crmActionAt: string | null }[]
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
