import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Alta y edicion de tickets contra WispHub.
 * El servidor reusa la misma implementacion que la app movil, asi que un ticket
 * creado aqui queda igual que uno creado desde el telefono.
 */

export interface TicketOptions {
  subjects: string[];
  technicians: { id: number; name: string }[];
  states: { id: number; name: string }[];
  priorities: { id: number; name: string }[];
}

export interface TicketSnapshot {
  idTicket: number;
  subject: string;
  description: string;
  state: number | null;
  stateLabel: string;
  priority: number | null;
  priorityLabel: string;
  client: { id: number | null; name: string };
  technician: { id: number | null; name: string };
  createdAt: string;
  updatedAt: string;
  /** Huella del ticket en WispHub; se envia al guardar para no pisar cambios ajenos. */
  version: string;
}

export interface TicketInput {
  clientId: number;
  subject: string;
  technicianId: number;
  description: string;
  state: number;
  priority: number;
}

export interface TicketWriteResult {
  ok: boolean;
  verified: boolean;
  operation: 'created' | 'updated';
  ticket: TicketSnapshot;
}

@Injectable({ providedIn: 'root' })
export class TicketsApiService {
  private http = inject(HttpClient);
  private readonly base = '/tickets-api/tickets';

  /** Clave unica por intento: si la red falla y se reintenta, no se crean dos tickets. */
  private operationKey(): string {
    const random = crypto.getRandomValues(new Uint8Array(16));
    return `web-${Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  options(): Observable<TicketOptions> {
    return this.http.get<TicketOptions>(`${this.base}/options`);
  }

  /** Lee el ticket en vivo de WispHub (trae la version para poder guardarlo). */
  manage(idTicket: number): Observable<TicketSnapshot> {
    return this.http.get<TicketSnapshot>(`${this.base}/${idTicket}/manage`);
  }

  create(input: TicketInput): Observable<TicketWriteResult> {
    return this.http.post<TicketWriteResult>(this.base, input, {
      headers: new HttpHeaders({ 'Idempotency-Key': this.operationKey() }),
    });
  }

  update(idTicket: number, input: TicketInput, version: string): Observable<TicketWriteResult> {
    return this.http.patch<TicketWriteResult>(`${this.base}/${idTicket}`, input, {
      headers: new HttpHeaders({ 'Idempotency-Key': this.operationKey(), 'If-Match': version }),
    });
  }
}
