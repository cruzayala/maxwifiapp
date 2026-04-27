import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, expand, reduce, EMPTY, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { WispHubClientResponse } from '../models/client.model';
import { InvoiceResponse } from '../models/invoice.model';
import { TicketResponse } from '../models/ticket.model';
import { PlanResponse, ZoneResponse } from '../models/plan.model';

@Injectable({ providedIn: 'root' })
export class WisphubService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  // ─── CLIENTES ───
  getClientsPage(offset = 0): Observable<WispHubClientResponse> {
    let params = new HttpParams();
    if (offset > 0) params = params.set('offset', offset.toString());
    return this.http.get<WispHubClientResponse>(`${this.api}/clientes/`, { params });
  }

  /** Carga TODAS las paginas automaticamente */
  getAllClients(): Observable<any[]> {
    return this.getClientsPage(0).pipe(
      expand(res => res.next ? this.getClientsPage(this.extractOffset(res.next)) : EMPTY),
      reduce((all: any[], res) => [...all, ...res.results], [])
    );
  }

  getClientDetail(idServicio: number): Observable<any> {
    return this.http.get(`${this.api}/clientes/${idServicio}/`);
  }

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

  /** Agregar cliente nuevo a una zona */
  addClient(zonaId: number, data: any): Observable<any> {
    return this.http.post(`${this.api}/clientes/agregar-cliente/${zonaId}/`, data);
  }

  /** Eliminar clientes */
  deleteClients(ids: number[]): Observable<any> {
    return this.http.post(`${this.api}/clientes/eliminar-clientes/`, { clientes: ids });
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

  registerPayment(idFactura: number, formaPago: number, totalCobrado: number, fechaPago: string): Observable<any> {
    return this.http.post(`${this.api}/facturas/${idFactura}/registrar-pago/`, {
      forma_pago: formaPago,
      accion: '1',
      fecha_pago: fechaPago,
      total_cobrado: totalCobrado
    });
  }

  // ─── FACTURAS ───
  getInvoicesPage(offset = 0): Observable<InvoiceResponse> {
    let params = new HttpParams();
    if (offset > 0) params = params.set('offset', offset.toString());
    return this.http.get<InvoiceResponse>(`${this.api}/facturas/`, { params });
  }

  getAllInvoices(): Observable<any[]> {
    return this.getInvoicesPage(0).pipe(
      expand(res => res.next ? this.getInvoicesPage(this.extractOffset(res.next)) : EMPTY),
      reduce((all: any[], res) => [...all, ...res.results], [])
    );
  }

  getInvoice(idFactura: number): Observable<any> {
    return this.http.get(`${this.api}/facturas/${idFactura}/`);
  }

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

  // ─── ROUTERS ───
  getRouters(): Observable<any> {
    return this.http.get(`${this.api}/router/`);
  }

  // ─── FORMAS DE PAGO ───
  getPaymentMethods(): Observable<any> {
    return this.http.get(`${this.api}/formas-de-pago/`);
  }

  // ─── TASKS ASYNC ───
  getTaskStatus(taskId: string): Observable<any> {
    return this.http.get(`${this.api}/tasks/${taskId}/`);
  }

  private extractOffset(url: string): number {
    const match = url.match(/offset=(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }
}
