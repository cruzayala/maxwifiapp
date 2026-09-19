import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { WispHubClient } from '../models/client.model';
import { Invoice } from '../models/invoice.model';
import { Ticket } from '../models/ticket.model';

@Injectable({ providedIn: 'root' })
export class LocalDbService {
  private http = inject(HttpClient);
  private clientCache: WispHubClient[] | null = null;
  private invoiceCache: Invoice[] | null = null;

  init(): Promise<void> {
    return Promise.resolve();
  }

  // ─── CLIENTS ───
  async saveClients(clients: WispHubClient[]): Promise<void> {
    const existing = this.clientCache || [];
    const merged = new Map(existing.map((client) => [client.id_servicio, client]));
    for (const client of clients) {
      const definedFields = Object.fromEntries(
        Object.entries(client).filter(([, value]) => value !== undefined),
      );
      const next = { ...merged.get(client.id_servicio), ...definedFields } as WispHubClient;
      merged.set(client.id_servicio, next);
    }
    this.clientCache = [...merged.values()];
  }

  async getClients(forceRefresh = false): Promise<WispHubClient[]> {
    if (!forceRefresh && this.clientCache) return this.clientCache;
    const rows = await firstValueFrom(this.http.get<any[]>('/db/clients?limit=100000'));
    const clients = rows.map((row) => this.mapServerClient(row));
    this.clientCache = clients;
    return clients;
  }

  async getClient(idServicio: number): Promise<WispHubClient | undefined> {
    const cached = this.clientCache?.find((client) => client.id_servicio === idServicio);
    if (cached) return cached;
    const row = await firstValueFrom(this.http.get<any>(`/db/clients/${idServicio}`));
    if (!row) return undefined;
    const client = this.mapServerClient(row);
    await this.saveClients([client]);
    return client;
  }

  private mapServerClient(row: any): WispHubClient {
    const relation = (id: any, nombre: any) => id || nombre ? { id, nombre: nombre || '' } : null;
    return {
      id_servicio: row.idServicio,
      usuario: row.usuario || '',
      nombre: row.nombre || 'Sin nombre',
      email: row.email || '',
      email_cc: row.emailCc || '',
      razon_social: row.razonSocial || '',
      tipo_persona: row.tipoPersona || '',
      cedula: row.cedula || '',
      direccion: row.direccion || '',
      localidad: row.localidad || '',
      ciudad: row.ciudad || '',
      telefono: row.telefono || '',
      descuento: row.descuento || '',
      saldo: row.saldo || '',
      rfc: row.rfc || '',
      informacion_adicional: null,
      notificacion_sms: false,
      aviso_pantalla: false,
      notificaciones_push: false,
      auto_activar_servicio: Boolean(row.autoActivar),
      firewall: row.firewall !== false,
      servicio: row.nombre || '',
      password_servicio: '',
      server_hotspot: '',
      ip: row.ip || '',
      ip_local: row.ipLocal || null,
      estado: row.estado || '',
      modelo_antena: relation(row.modeloAntenaId, row.modeloAntenaName) as any,
      mac_cpe: row.macCpe || '',
      interfaz_lan: row.interfazLan || '',
      modelo_router_wifi: row.modeloRouterWifi || '',
      ip_router_wifi: row.ipRouterWifi || null,
      mac_router_wifi: row.macRouterWifi || '',
      ssid_router_wifi: row.ssidRouterWifi || '',
      password_ssid_router_wifi: row.passwordSsidWifi || '',
      comentarios: row.comentarios || '',
      coordenadas: row.coordenadas || '',
      gpsLat: row.gpsLat ?? null,
      gpsLng: row.gpsLng ?? null,
      gpsAccuracy: row.gpsAccuracy ?? null,
      gpsCapturedAt: row.gpsCapturedAt ?? null,
      gpsCapturedBy: row.gpsCapturedBy ?? null,
      costo_instalacion: '',
      precio_plan: row.precioPlan || '',
      forma_contratacion: row.formaContratacion || '',
      sn_onu: row.snOnu || '',
      estado_facturas: row.estadoFacturas || '',
      fecha_instalacion: row.fechaInstalacion || '',
      fecha_cancelacion: row.fechaCancelacion || null,
      fecha_corte: row.fechaCorte || '',
      ultimo_cambio: row.ultimoCambio || '',
      plan_internet: relation(row.planInternetId, row.planInternetName),
      zona: relation(row.zonaId, row.zonaNombre),
      router: row.routerId || row.routerNombre ? {
        id: row.routerId,
        nombre: row.routerNombre || '',
        falla_general: false,
        falla_general_descripcion: null,
      } : null,
      sectorial: relation(row.sectorialId, row.sectorialNombre),
      tecnico: relation(row.tecnicoId, row.tecnicoNombre),
    } as WispHubClient;
  }

  // ─── INVOICES ───
  saveInvoices(invoices: Invoice[]): Promise<void> {
    const merged = new Map((this.invoiceCache || []).map((invoice) => [invoice.id_factura, invoice]));
    for (const invoice of invoices) merged.set(invoice.id_factura, invoice);
    this.invoiceCache = [...merged.values()];
    return Promise.resolve();
  }

  async getInvoices(forceRefresh = false): Promise<Invoice[]> {
    if (!forceRefresh && this.invoiceCache) return this.invoiceCache;
    const rows = await firstValueFrom(this.http.get<any[]>('/db/invoices?limit=100000'));
    const invoices = rows.map((row) => this.mapServerInvoice(row));
    this.invoiceCache = invoices;
    return invoices;
  }

  private mapServerInvoice(row: any): Invoice {
    return {
      id_factura: row.idFactura,
      folio: row.folio,
      fecha_emision: row.fechaEmision,
      fecha_vencimiento: row.fechaVencimiento,
      fecha_pago: row.fechaPago,
      estado: row.estado,
      tipo: row.tipo,
      zona: row.zonaId || row.zonaNombre ? { id: row.zonaId, nombre: row.zonaNombre || '' } : null,
      sub_total: row.subTotal || 0,
      descuento: row.descuento || 0,
      saldo: row.saldo || 0,
      saldo_nuevo: row.saldoNuevo || 0,
      impuestos_total: row.impuestosTotal || 0,
      total_cobrado: row.totalCobrado || 0,
      total: row.total || 0,
      comprobante_pago: row.comprobantePago,
      referencia: row.referencia || '',
      total_pasarela: row.totalPasarela || 0,
      retencion_porcentaje: row.retencionPorcentaje || 0,
      retenciones_total: row.retencionesTotal || 0,
      forma_pago: row.formaPagoId || row.formaPagoNombre
        ? { id: row.formaPagoId, nombre: row.formaPagoNombre || '' }
        : null,
      cajero: row.cajeroId || row.cajeroNombre
        ? { id: row.cajeroId, nombre: row.cajeroNombre || '' }
        : null,
      cliente: row.clienteNombre || row.clienteUsuario ? {
        usuario: row.clienteUsuario || '',
        nombre: row.clienteNombre || '',
        email: row.clienteEmail || '',
        cedula: row.clienteCedula || '',
        direccion: row.clienteDireccion || '',
        localidad: '',
        telefono: row.clienteTelefono || '',
        rfc: row.clienteRfc || '',
      } : null,
      articulos: (row.articles || []).map((article: any) => ({
        id: article.remoteId || article.id,
        cantidad: article.cantidad || 1,
        descripcion: article.descripcion || '',
        precio: String(article.precio || 0),
        servicio: article.idServicio ? { id_servicio: article.idServicio } : null,
      })),
    } as Invoice;
  }

  // ─── TICKETS ───
  async saveTickets(tickets: Ticket[]): Promise<void> {
    await firstValueFrom(this.http.post('/db/tickets/sync', { tickets }));
  }

  getTickets(): Promise<Ticket[]> {
    return firstValueFrom(this.http.get<Ticket[]>('/db/tickets'));
  }

  // ─── SYNC LOG ───
  async updateSyncLog(entity: string): Promise<void> {
    void entity;
  }

  async getLastSync(entity: string): Promise<string | null> {
    void entity;
    try {
      const status = await firstValueFrom(this.http.get<{ lastSyncAt: string | null }>('/sync/status'));
      return status.lastSyncAt;
    } catch { return null; }
  }
}
