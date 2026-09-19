import { Component, HostListener, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NavbarComponent } from '../../components/layout/navbar';
import { WisphubService } from '../../services/wisphub.service';
import { LocalDbService } from '../../services/local-db.service';
import { WispHubClient } from '../../models/client.model';
import { Invoice } from '../../models/invoice.model';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ReceiptService } from '../../services/receipt.service';
import { ToastService } from '../../services/toast.service';
import { ClientExtrasComponent } from '../../components/client-extras/client-extras';
import { ClientMetricsComponent } from '../../components/client-metrics/client-metrics';
import { ClientEquipmentComponent } from '../../components/client-equipment/client-equipment';
import {
  LucideActivity, LucideChevronLeft, LucideCircleDollarSign, LucideHistory,
  LucideMapPin, LucidePackageSearch, LucidePrinter, LucideReceiptText,
  LucideUserRound, LucideWalletCards, LucideWifi, LucideX,
} from '@lucide/angular';

type ClientDetailTab = 'overview' | 'service' | 'monitoring' | 'equipment' | 'activity';

@Component({
  selector: 'app-client-detail',
  standalone: true,
  imports: [
    NavbarComponent, RouterLink, DecimalPipe, DatePipe, FormsModule,
    ClientExtrasComponent, ClientMetricsComponent, ClientEquipmentComponent,
    LucideActivity, LucideChevronLeft, LucideCircleDollarSign, LucideHistory,
    LucideMapPin, LucidePackageSearch, LucidePrinter, LucideReceiptText,
    LucideUserRound, LucideWalletCards, LucideWifi, LucideX,
  ],
  template: `
    <app-navbar [pageTitle]="clientName()" />

    <div class="page">
      <a routerLink="/clients" class="back-link">
        <svg lucideChevronLeft size="16"></svg>
        Volver a clientes
      </a>

      @if (loading()) {
        <div class="loading-state"><div class="spinner"></div></div>
      } @else if (client()) {
        <!-- PERFIL BAR -->
        <div class="profile-bar">
          <div class="profile-left">
            <div class="avatar-lg" [class]="getStatusClass(client()!.estado)">
              {{ getInitials(client()!.nombre) }}
            </div>
            <div>
              <h2>{{ client()!.nombre }}</h2>
              <div class="profile-badges">
                <span class="badge" [class]="'badge-' + getStatusClass(client()!.estado)">{{ client()!.estado }}</span>
                <span class="badge badge-plan">{{ client()!.plan_internet?.nombre || 'Sin plan' }}</span>
                <span class="id-tag">#{{ client()!.id_servicio }}</span>
              </div>
            </div>
          </div>
          <div class="profile-actions">
            <button class="btn btn-outline" (click)="pingClient()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              Ping
            </button>
            @if ((client()!.estado || '').toLowerCase() === 'activo') {
              <button class="btn btn-red" (click)="deactivateClient()">Suspender</button>
            } @else {
              <button class="btn btn-green" (click)="activateClient()">Activar</button>
            }
          </div>
        </div>

        @if (pingResult()) {
          <div class="ping-box" [class.success]="pingSuccess()"><pre>{{ pingResult() }}</pre></div>
        }

        <nav class="client-tabs" role="tablist" aria-label="Secciones del cliente">
          <button type="button" role="tab" [attr.aria-selected]="activeTab() === 'overview'" [class.active]="activeTab() === 'overview'" (click)="setActiveTab('overview')"><svg lucideUserRound size="16"></svg><span>Resumen</span></button>
          <button type="button" role="tab" [attr.aria-selected]="activeTab() === 'service'" [class.active]="activeTab() === 'service'" (click)="setActiveTab('service')"><svg lucideWifi size="16"></svg><span>Internet</span></button>
          <button type="button" role="tab" [attr.aria-selected]="activeTab() === 'monitoring'" [class.active]="activeTab() === 'monitoring'" (click)="setActiveTab('monitoring')"><svg lucideActivity size="16"></svg><span>Monitoreo</span></button>
          <button type="button" role="tab" [attr.aria-selected]="activeTab() === 'equipment'" [class.active]="activeTab() === 'equipment'" (click)="setActiveTab('equipment')"><svg lucidePackageSearch size="16"></svg><span>Equipos</span></button>
          <button type="button" role="tab" [attr.aria-selected]="activeTab() === 'activity'" [class.active]="activeTab() === 'activity'" (click)="setActiveTab('activity')"><svg lucideHistory size="16"></svg><span>Actividad</span></button>
          <button type="button" class="portfolio-tab" (click)="openInvoicePortfolio()"><svg lucideWalletCards size="16"></svg><span>Cartera</span><b>{{ clientInvoices().length }}</b></button>
        </nav>

        <div class="detail-grid" [class.tab-hidden]="activeTab() !== 'overview' && activeTab() !== 'service'">
          <!-- EDITAR DATOS PERSONALES -->
          <div class="card" [class.tab-hidden]="activeTab() !== 'overview'">
            <div class="card-head">
              <h3>Datos del Cliente</h3>
              @if (!editingProfile()) {
                <button class="btn-edit" (click)="startEditProfile()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Editar
                </button>
              }
            </div>
            @if (editingProfile()) {
              <div class="edit-form">
                <div class="form-row">
                  <div class="form-group">
                    <label>Nombre completo</label>
                    <input type="text" [(ngModel)]="editName" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label>Telefono</label>
                    <input type="text" [(ngModel)]="editPhone" class="form-input" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Cedula</label>
                    <input type="text" [(ngModel)]="editCedula" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label>Email</label>
                    <input type="email" [(ngModel)]="editEmail" class="form-input" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Direccion</label>
                    <input type="text" [(ngModel)]="editDireccion" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label>Ciudad</label>
                    <input type="text" [(ngModel)]="editCiudad" class="form-input" />
                  </div>
                </div>
                <div class="edit-actions">
                  <button class="btn btn-primary" (click)="saveProfile()" [disabled]="saving()">
                    {{ saving() ? 'Guardando...' : 'Guardar' }}
                  </button>
                  <button class="btn btn-outline" (click)="editingProfile.set(false)">Cancelar</button>
                </div>
              </div>
            } @else {
              <div class="info-grid">
                <div class="info-item"><span class="lbl">Usuario</span><span class="val mono">{{ client()!.usuario }}</span></div>
                <div class="info-item"><span class="lbl">Telefono</span><span class="val phone">{{ client()!.telefono || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Email</span><span class="val">{{ client()!.email || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Cedula</span><span class="val">{{ client()!.cedula || '-' }}</span></div>
                <div class="info-item full"><span class="lbl">Direccion</span><span class="val">{{ client()!.direccion || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Ciudad</span><span class="val">{{ client()!.ciudad || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Tecnico</span><span class="val">{{ client()!.tecnico?.nombre || '-' }}</span></div>
              </div>
            }
          </div>

          <!-- EDITAR SERVICIO -->
          <div class="card" [class.tab-hidden]="activeTab() !== 'service'">
            <div class="card-head">
              <h3>Servicio de Internet</h3>
              @if (!editingService()) {
                <button class="btn-edit" (click)="startEditService()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Editar
                </button>
              }
            </div>
            @if (editingService()) {
              <div class="edit-form">
                <div class="form-row">
                  <div class="form-group">
                    <label>IP</label>
                    <input type="text" [(ngModel)]="editIp" class="form-input mono-input" />
                  </div>
                  <div class="form-group">
                    <label>MAC CPE</label>
                    <input type="text" [(ngModel)]="editMac" class="form-input mono-input" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Interfaz LAN</label>
                    <input type="text" [(ngModel)]="editLan" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label>SN ONU</label>
                    <input type="text" [(ngModel)]="editOnu" class="form-input mono-input" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>SSID WiFi</label>
                    <input type="text" [(ngModel)]="editSsid" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label>Password WiFi</label>
                    <input type="text" [(ngModel)]="editWifiPass" class="form-input" />
                  </div>
                </div>
                <div class="form-group">
                  <label>Comentarios</label>
                  <textarea [(ngModel)]="editComentarios" class="form-input" rows="2"></textarea>
                </div>
                <div class="edit-actions">
                  <button class="btn btn-primary" (click)="saveService()" [disabled]="saving()">
                    {{ saving() ? 'Guardando...' : 'Guardar' }}
                  </button>
                  <button class="btn btn-outline" (click)="editingService.set(false)">Cancelar</button>
                </div>
              </div>
            } @else {
              <div class="info-grid">
                <div class="info-item"><span class="lbl">Plan</span><span class="val highlight">{{ client()!.plan_internet?.nombre || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Precio</span><span class="val highlight">RD$ {{ client()!.precio_plan }}</span></div>
                <div class="info-item"><span class="lbl">IP</span><span class="val mono">{{ client()!.ip || '-' }}</span></div>
                <div class="info-item"><span class="lbl">MAC CPE</span><span class="val mono">{{ client()!.mac_cpe || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Interfaz LAN</span><span class="val mono">{{ client()!.interfaz_lan || '-' }}</span></div>
                <div class="info-item"><span class="lbl">SN ONU</span><span class="val mono">{{ client()!.sn_onu || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Zona</span><span class="val">{{ client()!.zona?.nombre || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Router</span><span class="val">{{ client()!.router?.nombre || '-' }}</span></div>
                <div class="info-item"><span class="lbl">SSID WiFi</span><span class="val mono">{{ client()!.ssid_router_wifi || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Pass WiFi</span><span class="val mono">{{ client()!.password_ssid_router_wifi || '-' }}</span></div>
              </div>
            }
          </div>

          <!-- FACTURACION (solo lectura) -->
          <div class="card" [class.tab-hidden]="activeTab() !== 'overview'">
            <h3>Facturacion</h3>
            <div class="info-grid">
              <div class="info-item"><span class="lbl">Estado Facturas</span>
                <span class="val"><span class="badge" [class]="'badge-' + getFacturaClass(client()!.estado_facturas)">{{ client()!.estado_facturas || '-' }}</span></span>
              </div>
              <div class="info-item"><span class="lbl">Saldo</span><span class="val saldo" [class.red]="+(client()!.saldo || 0) > 0">RD$ {{ client()!.saldo || '0.00' }}</span></div>
              <div class="info-item"><span class="lbl">Fecha Instalacion</span><span class="val">{{ client()!.fecha_instalacion || '-' }}</span></div>
              <div class="info-item"><span class="lbl">Fecha Corte</span><span class="val">{{ client()!.fecha_corte || '-' }}</span></div>
              <div class="info-item"><span class="lbl">Firewall</span><span class="val">{{ client()!.firewall ? 'Si' : 'No' }}</span></div>
              <div class="info-item"><span class="lbl">Ultimo Cambio</span><span class="val">{{ client()!.ultimo_cambio || '-' }}</span></div>
            </div>
          </div>

          <!-- CONFIG WiFi (solo lectura) -->
          <div class="card" [class.tab-hidden]="activeTab() !== 'service'">
            <h3>Router / CPE</h3>
            <div class="info-grid">
              <div class="info-item"><span class="lbl">Modelo Router</span><span class="val">{{ client()!.modelo_router_wifi || '-' }}</span></div>
              <div class="info-item"><span class="lbl">IP Router</span><span class="val mono">{{ client()!.ip_router_wifi || '-' }}</span></div>
              <div class="info-item"><span class="lbl">MAC Router</span><span class="val mono">{{ client()!.mac_router_wifi || '-' }}</span></div>
              <div class="info-item"><span class="lbl">Antena</span><span class="val">{{ client()!.modelo_antena || '-' }}</span></div>
              <div class="info-item"><span class="lbl">Contratacion</span><span class="val">{{ client()!.forma_contratacion || '-' }}</span></div>
              <div class="info-item"><span class="lbl">Comentarios</span><span class="val">{{ client()!.comentarios || '-' }}</span></div>
            </div>
          </div>
        </div>

        <!-- GPS DEL CLIENTE -->
        <div class="card gps-section" [class.tab-hidden]="activeTab() !== 'overview'">
          <h3><svg lucideMapPin size="17"></svg> Ubicacion GPS</h3>
          @if (gpsLat() && gpsLng()) {
            <div class="gps-saved">
              <div class="gps-coords">
                <span class="gps-label">Latitud</span><span class="gps-val mono">{{ gpsLat() }}</span>
                <span class="gps-label">Longitud</span><span class="gps-val mono">{{ gpsLng() }}</span>
                @if (gpsAccuracy()) {
                  <span class="gps-label">Precision</span><span class="gps-val">±{{ gpsAccuracy() }}m</span>
                }
                @if (gpsCapturedAt()) {
                  <span class="gps-label">Capturado</span><span class="gps-val">{{ gpsCapturedAt() | date:'dd/MM/yyyy HH:mm' }}{{ gpsCapturedBy() ? ' por ' + gpsCapturedBy() : '' }}</span>
                }
              </div>
              <div class="gps-actions">
                <a [href]="googleMapsUrl()" target="_blank" rel="noopener" class="btn btn-outline">🗺 Ver en Google Maps</a>
                <button class="btn btn-primary" (click)="captureGps()" [disabled]="capturingGps()">
                  @if (capturingGps()) { Capturando... } @else { Actualizar ubicacion }
                </button>
              </div>
            </div>
          } @else {
            <p class="gps-empty">Este cliente no tiene ubicacion GPS guardada.</p>
            <button class="btn btn-primary" (click)="captureGps()" [disabled]="capturingGps()">
              @if (capturingGps()) { Capturando... } @else { 📍 Capturar mi ubicacion actual }
            </button>
            <p class="gps-hint">El navegador pedira permiso de ubicacion. Para mejor precision, captura desde el sitio del cliente con el celular.</p>
          }
        </div>

        <!-- MÉTRICAS (auto-refresh cada 30s) -->
        @if (activeTab() === 'monitoring') {
          <section class="tab-panel" role="tabpanel"><app-client-metrics [idServicio]="client()!.id_servicio" /></section>
        }

        <!-- ALIAS + WEB ACTIVITY -->
        @if (activeTab() === 'activity') {
          <section class="tab-panel" role="tabpanel"><app-client-extras [idServicio]="client()!.id_servicio" /></section>
        }

        <!-- EQUIPOS ASIGNADOS + GASTOS DIRIGIDOS -->
        @if (activeTab() === 'equipment') {
          <section class="tab-panel" role="tabpanel"><app-client-equipment [idServicio]="client()!.id_servicio" /></section>
        }
      }

      @if (invoiceModalOpen() && client()) {
        <div class="modal-backdrop" role="presentation" (click)="closeInvoicePortfolio()">
          <section class="portfolio-modal" role="dialog" aria-modal="true" aria-labelledby="portfolio-title" (click)="$event.stopPropagation()">
            <header class="portfolio-head">
              <div class="portfolio-title"><span class="portfolio-icon"><svg lucideWalletCards size="20"></svg></span><div><small>Cartera del cliente</small><h2 id="portfolio-title">{{ client()!.nombre }}</h2><p>{{ clientInvoices().length }} facturas históricas conservadas</p></div></div>
              <button type="button" class="modal-close" aria-label="Cerrar cartera" (click)="closeInvoicePortfolio()"><svg lucideX size="19"></svg></button>
            </header>

            <div class="portfolio-kpis">
              <div><span><svg lucideReceiptText size="16"></svg>Total histórico</span><strong>RD$ {{ clientInvoiceTotal() | number:'1.2-2' }}</strong></div>
              <div class="paid"><span><svg lucideCircleDollarSign size="16"></svg>Pagadas</span><strong>{{ clientInvoicePaidCount() }}</strong></div>
              <div class="pending"><span><svg lucideHistory size="16"></svg>Pendientes</span><strong>{{ clientInvoicePendingCount() }}</strong></div>
              <div><span>Saldo actual</span><strong [class.danger-text]="+(client()!.saldo || 0) > 0">RD$ {{ client()!.saldo || '0.00' }}</strong></div>
            </div>

            <div class="portfolio-toolbar">
              <div class="portfolio-filters" role="group" aria-label="Filtrar cartera">
                <button type="button" [class.active]="invoiceStatusFilter() === 'all'" (click)="invoiceStatusFilter.set('all')">Todas <b>{{ clientInvoices().length }}</b></button>
                <button type="button" [class.active]="invoiceStatusFilter() === 'paid'" (click)="invoiceStatusFilter.set('paid')">Pagadas <b>{{ clientInvoicePaidCount() }}</b></button>
                <button type="button" [class.active]="invoiceStatusFilter() === 'pending'" (click)="invoiceStatusFilter.set('pending')">Pendientes <b>{{ clientInvoicePendingCount() }}</b></button>
              </div>
            </div>

            <div class="portfolio-table-wrap">
              <table class="data-table portfolio-table">
                <thead><tr><th>Factura</th><th>Emisión</th><th>Vencimiento</th><th>Total</th><th>Estado</th><th>Pago</th><th aria-label="Acciones"></th></tr></thead>
                <tbody>
                  @for (inv of visibleClientInvoices(); track inv.id_factura) {
                    <tr>
                      <td data-label="Factura" class="id-col">#{{ inv.id_factura }}</td>
                      <td data-label="Emisión">{{ inv.fecha_emision || '-' }}</td>
                      <td data-label="Vencimiento">{{ inv.fecha_vencimiento || '-' }}</td>
                      <td data-label="Total" class="money">RD$ {{ inv.total | number:'1.2-2' }}</td>
                      <td data-label="Estado"><span class="badge" [class]="'badge-' + getInvStatusClass(inv.estado)">{{ inv.estado || '-' }}</span></td>
                      <td data-label="Pago">{{ inv.forma_pago?.nombre || '-' }}</td>
                      <td data-label="Recibo"><button class="btn-icon" type="button" (click)="printReceipt(inv)" [attr.aria-label]="'Imprimir recibo de factura ' + inv.id_factura"><svg lucidePrinter size="16"></svg></button></td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7" class="portfolio-empty">No hay facturas en este estado.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 20px 24px 32px; color: #26384b; }
    .back-link { display: inline-flex; align-items: center; gap: 5px; color: #2563eb; text-decoration: none; font-size: 13px; font-weight: 700; margin-bottom: 12px; }
    .back-link:hover { text-decoration: underline; }

    .profile-bar {
      display: flex; align-items: center; justify-content: space-between;
      background: white; border: 1px solid #dce5eb; border-radius: 8px;
      padding: 18px 20px; margin-bottom: 10px; flex-wrap: wrap; gap: 16px;
    }
    .profile-left { display: flex; align-items: center; gap: 16px; }
    .avatar-lg { width: 58px; height: 58px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 22px; color: white; }
    .avatar-lg.active { background: linear-gradient(135deg, #22c55e, #16a34a); }
    .avatar-lg.suspended { background: linear-gradient(135deg, #ef4444, #dc2626); }
    .avatar-lg.free { background: linear-gradient(135deg, #3b82f6, #2563eb); }
    .avatar-lg.default { background: linear-gradient(135deg, #94a3b8, #64748b); }
    .profile-left h2 { margin: 0 0 6px; font-size: 22px; font-weight: 700; color: #0f172a; }
    .profile-badges { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .id-tag { font-size: 13px; color: #94a3b8; }
    .profile-actions { display: flex; gap: 10px; }

    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 7px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s; }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; }
    .btn-outline:hover { border-color: #6366f1; color: #6366f1; }
    .btn-green { background: #22c55e; color: white; }
    .btn-green:hover { background: #16a34a; }
    .btn-red { background: #ef4444; color: white; }
    .btn-red:hover { background: #dc2626; }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

    .btn-edit {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 14px; border: 1px solid #e2e8f0; border-radius: 8px;
      background: white; font-size: 12px; color: #6366f1; font-weight: 500;
      cursor: pointer; transition: all 0.2s;
    }
    .btn-edit:hover { background: #6366f1; color: white; border-color: #6366f1; }

    .ping-box { margin-bottom: 20px; padding: 12px 16px; border-radius: 10px; background: #fef2f2; border: 1px solid #fecaca; }
    .ping-box.success { background: #f0fdf4; border-color: #bbf7d0; }
    .ping-box pre { margin: 0; font-size: 12px; white-space: pre-wrap; font-family: 'Courier New', monospace; }

    .client-tabs {
      position: sticky; top: 64px; z-index: 12; display: flex; align-items: flex-end; gap: 2px;
      min-width: 0; margin-bottom: 12px; padding: 8px 8px 0; overflow-x: auto; overflow-y: hidden;
      border: 1px solid #dce5eb; border-radius: 8px 8px 0 0; background: #edf2f6;
      scrollbar-width: thin;
    }
    .client-tabs button {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-width: max-content; height: 42px;
      padding: 0 14px; border: 1px solid transparent; border-bottom: 0; border-radius: 7px 7px 0 0;
      background: transparent; color: #627589; font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .client-tabs button:hover { color: #243a50; background: rgba(255,255,255,0.55); }
    .client-tabs button.active { position: relative; color: #1d4ed8; border-color: #dce5eb; background: #fff; box-shadow: 0 -2px 6px rgba(30, 51, 73, 0.05); }
    .client-tabs button.active::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: #fff; }
    .client-tabs .portfolio-tab { margin-left: auto; color: #0f7b4c; }
    .client-tabs .portfolio-tab b { display: grid; place-items: center; min-width: 21px; height: 21px; padding: 0 5px; border-radius: 11px; background: #dff5e9; color: #0f7b4c; font-size: 10px; }
    .tab-hidden { display: none !important; }
    .tab-panel { min-width: 0; animation: panelIn 0.16s ease; }
    @keyframes panelIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }

    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    .card { background: white; border-radius: 8px; border: 1px solid #dce5eb; padding: 20px; }

    .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 1px solid #f1f5f9; }
    .card-head h3 { margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; }
    .card h3 { font-size: 15px; font-weight: 600; color: #0f172a; margin: 0 0 16px; padding-bottom: 10px; border-bottom: 1px solid #f1f5f9; }

    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .info-item.full { grid-column: 1 / -1; }
    .lbl { display: block; font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600; letter-spacing: 0.3px; margin-bottom: 2px; }
    .val { font-size: 14px; color: #0f172a; font-weight: 500; word-break: break-all; }
    .val.mono { font-family: 'Courier New', monospace; font-size: 13px; }
    .val.highlight { color: #6366f1; font-weight: 700; }
    .val.phone { color: #0f172a; font-size: 16px; font-weight: 700; }
    .val.saldo { font-size: 18px; font-weight: 700; color: #22c55e; }
    .val.saldo.red { color: #ef4444; }

    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
    .badge-active { background: #dcfce7; color: #16a34a; }
    .badge-suspended { background: #fee2e2; color: #dc2626; }
    .badge-free { background: #dbeafe; color: #2563eb; }
    .badge-default { background: #f1f5f9; color: #64748b; }
    .badge-plan { background: #eef2ff; color: #6366f1; }
    .badge-paid { background: #dcfce7; color: #16a34a; }
    .badge-pending { background: #fef3c7; color: #d97706; }

    /* EDIT FORM */
    .edit-form { animation: fadeIn 0.2s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form-group { margin-bottom: 12px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px; }
    .form-input { width: 100%; padding: 9px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; color: #334155; outline: none; box-sizing: border-box; transition: border 0.2s; }
    .form-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
    .mono-input { font-family: 'Courier New', monospace; }
    textarea.form-input { resize: vertical; }
    .edit-actions { display: flex; gap: 8px; margin-top: 4px; }

    .gps-section { padding: 18px 20px; }
    .gps-section h3 { display: flex; align-items: center; gap: 7px; margin: 0 0 14px; font-size: 15px; color: #0f172a; }
    .gps-saved { display: flex; flex-direction: column; gap: 14px; }
    .gps-coords {
      display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px;
      background: #f8fafc; padding: 12px 16px; border-radius: 10px;
    }
    .gps-label { color: #64748b; font-size: 12px; font-weight: 600; }
    .gps-val { color: #0f172a; font-size: 13px; }
    .gps-val.mono { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
    .gps-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .gps-empty { color: #94a3b8; font-size: 13px; margin: 0 0 12px; }
    .gps-hint { color: #94a3b8; font-size: 12px; margin: 10px 0 0; }
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th { text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; }
    .data-table td { padding: 10px 12px; font-size: 13px; color: #334155; border-bottom: 1px solid #f1f5f9; }
    .id-col { font-weight: 600; color: #6366f1; }
    .money { font-family: 'Courier New', monospace; font-weight: 600; }
    .btn-icon { background: none; border: 1px solid #e2e8f0; border-radius: 8px; padding: 5px 7px; cursor: pointer; color: #64748b; transition: all 0.2s; }
    .btn-icon:hover { background: #6366f1; color: white; border-color: #6366f1; }

    .modal-backdrop {
      position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 20px;
      background: rgba(15, 30, 46, 0.54); backdrop-filter: blur(2px); animation: backdropIn 0.16s ease;
    }
    .portfolio-modal {
      display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); width: min(1040px, 96vw); max-height: min(820px, 92vh);
      overflow: hidden; border: 1px solid #cfdbe5; border-radius: 8px; background: #f7f9fb;
      box-shadow: 0 24px 70px rgba(10, 28, 45, 0.25); animation: modalIn 0.18s ease;
    }
    @keyframes backdropIn { from { opacity: 0; } }
    @keyframes modalIn { from { opacity: 0; transform: translateY(8px) scale(0.99); } }
    .portfolio-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 18px; border-bottom: 1px solid #dce5eb; background: #fff; }
    .portfolio-title { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .portfolio-icon { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 auto; border-radius: 7px; background: #e9f2ff; color: #2563eb; }
    .portfolio-title > div { min-width: 0; }
    .portfolio-title small { display: block; margin: 0; color: #718396; font-size: 10px; font-weight: 800; text-transform: uppercase; }
    .portfolio-title h2 { margin: 2px 0 0; color: #172b40; font-size: 18px; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .portfolio-title p { margin: 3px 0 0; color: #7d8d9c; font-size: 11px; }
    .modal-close { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 auto; border: 1px solid #dce5eb; border-radius: 6px; background: #fff; color: #607386; cursor: pointer; }
    .modal-close:hover { color: #b42318; border-color: #f0b4ae; background: #fff5f4; }
    .portfolio-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; margin: 12px 12px 0; overflow: hidden; border: 1px solid #dce5eb; border-radius: 6px; background: #dce5eb; }
    .portfolio-kpis > div { min-width: 0; padding: 11px 13px; background: #fff; }
    .portfolio-kpis span { display: flex; align-items: center; gap: 6px; color: #718396; font-size: 10px; font-weight: 800; text-transform: uppercase; }
    .portfolio-kpis strong { display: block; margin-top: 5px; color: #22384d; font-size: 17px; overflow-wrap: anywhere; }
    .portfolio-kpis .paid strong { color: #0f8a50; }
    .portfolio-kpis .pending strong, .danger-text { color: #c2413a !important; }
    .portfolio-toolbar { padding: 10px 12px; }
    .portfolio-filters { display: inline-flex; gap: 4px; padding: 3px; border: 1px solid #dce5eb; border-radius: 6px; background: #fff; }
    .portfolio-filters button { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 10px; border: 0; border-radius: 4px; background: transparent; color: #617487; font-size: 11px; font-weight: 700; cursor: pointer; }
    .portfolio-filters button.active { color: #1d4ed8; background: #eaf2ff; }
    .portfolio-filters b { display: inline-grid; place-items: center; min-width: 19px; height: 19px; padding: 0 4px; border-radius: 10px; background: #edf1f4; color: inherit; font-size: 9px; }
    .portfolio-table-wrap { min-height: 0; margin: 0 12px 12px; overflow: auto; border: 1px solid #dce5eb; border-radius: 6px; background: #fff; }
    .portfolio-table { min-width: 760px; }
    .portfolio-table thead { position: sticky; top: 0; z-index: 1; background: #f6f8fa; }
    .portfolio-table tbody tr:hover td { background: #f8fbfd; }
    .portfolio-empty { padding: 44px !important; text-align: center; color: #8292a0 !important; }

    .loading-state { display: flex; flex-direction: column; align-items: center; padding: 80px; }
    .spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 900px) {
      .detail-grid { grid-template-columns: 1fr; }
      .form-row { grid-template-columns: 1fr; }
      .portfolio-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      .page { padding: 12px; }
      .profile-bar { flex-direction: column; align-items: flex-start; }
      .profile-actions { width: 100%; flex-wrap: wrap; }
      .profile-actions .btn { flex: 1; justify-content: center; }
      .avatar-lg { width: 56px; height: 56px; font-size: 20px; }
      .profile-left h2 { font-size: 18px; }
      .card { padding: 16px; }
      .info-grid { grid-template-columns: 1fr; gap: 10px; }
      .client-tabs { top: 56px; margin-inline: -12px; border-radius: 0; }
      .client-tabs button { padding-inline: 12px; }
      .client-tabs .portfolio-tab { margin-left: 0; }
      .modal-backdrop { place-items: end center; padding: 0; }
      .portfolio-modal { width: 100%; max-height: 94vh; border-width: 1px 0 0; border-radius: 8px 8px 0 0; }
      .portfolio-head { padding: 14px; }
      .portfolio-title h2 { font-size: 16px; }
      .portfolio-kpis { grid-template-columns: 1fr 1fr; margin: 10px 10px 0; }
      .portfolio-kpis > div { padding: 9px 10px; }
      .portfolio-kpis strong { font-size: 14px; }
      .portfolio-toolbar { overflow-x: auto; padding: 8px 10px; }
      .portfolio-filters { min-width: max-content; }
      .portfolio-table-wrap { margin: 0 10px 10px; }
    }
    @media (prefers-reduced-motion: reduce) { .tab-panel, .modal-backdrop, .portfolio-modal { animation: none; } }
  `]
})
export class ClientDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(WisphubService);
  private db = inject(LocalDbService);
  private receiptSvc = inject(ReceiptService);
  private toast = inject(ToastService);
  private http = inject(HttpClient);

  client = signal<WispHubClient | null>(null);
  clientName = signal('Cliente');
  clientInvoices = signal<Invoice[]>([]);
  loading = signal(true);
  saving = signal(false);
  pingResult = signal('');
  pingSuccess = signal(false);
  activeTab = signal<ClientDetailTab>('overview');
  invoiceModalOpen = signal(false);
  invoiceStatusFilter = signal<'all' | 'paid' | 'pending'>('all');
  clientInvoiceTotal = computed(() => this.clientInvoices().reduce((sum, invoice) => sum + (invoice.total || 0), 0));
  clientInvoicePaidCount = computed(() => this.clientInvoices().filter((invoice) => this.isClientInvoicePaid(invoice)).length);
  clientInvoicePendingCount = computed(() => this.clientInvoices().length - this.clientInvoicePaidCount());
  visibleClientInvoices = computed(() => {
    const filter = this.invoiceStatusFilter();
    if (filter === 'all') return this.clientInvoices();
    return this.clientInvoices().filter((invoice) => filter === 'paid' ? this.isClientInvoicePaid(invoice) : !this.isClientInvoicePaid(invoice));
  });

  // GPS
  gpsLat = signal<number | null>(null);
  gpsLng = signal<number | null>(null);
  gpsAccuracy = signal<number | null>(null);
  gpsCapturedAt = signal<string | null>(null);
  gpsCapturedBy = signal<string | null>(null);
  capturingGps = signal(false);
  googleMapsUrl = computed(() => {
    const lat = this.gpsLat(), lng = this.gpsLng();
    if (lat == null || lng == null) return '';
    return `https://www.google.com/maps?q=${lat},${lng}`;
  });

  // Edit profile state
  editingProfile = signal(false);
  editName = '';
  editPhone = '';
  editCedula = '';
  editEmail = '';
  editDireccion = '';
  editCiudad = '';

  // Edit service state
  editingService = signal(false);
  editIp = '';
  editMac = '';
  editLan = '';
  editOnu = '';
  editSsid = '';
  editWifiPass = '';
  editComentarios = '';

  setActiveTab(tab: ClientDetailTab) {
    this.activeTab.set(tab);
  }

  openInvoicePortfolio() {
    this.invoiceStatusFilter.set('all');
    this.invoiceModalOpen.set(true);
  }

  closeInvoicePortfolio() {
    this.invoiceModalOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.invoiceModalOpen()) this.closeInvoicePortfolio();
  }

  private isClientInvoicePaid(invoice: Invoice): boolean {
    const status = (invoice.estado || '').toLowerCase();
    const total = invoice.total || 0;
    if (status.includes('pendiente') || status.includes('cancelad') || status.includes('anulad') || status.includes('transfer')) return false;
    if (status.includes('pagad') || status.includes('cobro completo')) return true;
    return Boolean(invoice.fecha_pago) && total > 0 && (invoice.total_cobrado || 0) >= total - 0.01;
  }

  async ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) {
      const c = await this.db.getClient(id);
      if (c) {
        this.client.set(c);
        this.clientName.set(c.nombre);
      }
      const allInv = await this.db.getInvoices();
      this.clientInvoices.set(allInv.filter(i =>
        i.articulos?.some(a => a.servicio?.id_servicio === id) ||
        i.cliente?.nombre?.toLowerCase() === c?.nombre?.toLowerCase()
      ));
      // Cargar GPS guardado (del server, no del cache local)
      this.loadGps(id);
    }
    this.loading.set(false);
  }

  private loadGps(idServicio: number) {
    // Usamos el endpoint generico /db/clients/:id que ya existe (devuelve el cliente completo
    // incluyendo gpsLat/gpsLng/gpsAccuracy/gpsCapturedAt/gpsCapturedBy)
    this.http.get<any>(`/db/clients/${idServicio}`).subscribe({
      next: (c) => { if (c) this.applyGps(c); },
      error: () => {},
    });
  }

  private applyGps(c: any) {
    this.gpsLat.set(c.gpsLat ?? null);
    this.gpsLng.set(c.gpsLng ?? null);
    this.gpsAccuracy.set(c.gpsAccuracy ?? null);
    this.gpsCapturedAt.set(c.gpsCapturedAt ?? null);
    this.gpsCapturedBy.set(c.gpsCapturedBy ?? null);
  }

  captureGps() {
    const c = this.client();
    if (!c) return;
    if (!('geolocation' in navigator)) {
      this.toast.error('Este navegador no soporta GPS');
      return;
    }
    this.capturingGps.set(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        this.http.post<any>(`/db/clients/${c.id_servicio}/gps`, {
          lat: latitude,
          lng: longitude,
          accuracy,
          client: {
            nombre: c.nombre,
            telefono: c.telefono,
            ip: c.ip,
            planInternetName: c.plan_internet?.nombre,
            estado: c.estado,
            estadoFacturas: c.estado_facturas,
            zonaNombre: c.zona?.nombre,
            direccion: c.direccion,
            coordenadas: c.coordenadas,
          },
        }).subscribe({
          next: (r) => {
            this.capturingGps.set(false);
            if (r?.client) {
              this.applyGps(r.client);
              const updated = {
                ...c,
                gpsLat: r.client.gpsLat ?? latitude,
                gpsLng: r.client.gpsLng ?? longitude,
                gpsAccuracy: r.client.gpsAccuracy ?? accuracy,
                gpsCapturedAt: r.client.gpsCapturedAt ?? new Date().toISOString(),
                gpsCapturedBy: r.client.gpsCapturedBy ?? null,
              };
              this.client.set(updated);
              this.db.saveClients([updated]).catch(() => {});
              this.toast.success(`Ubicacion guardada (precision ±${Math.round(accuracy)}m)`);
            } else {
              this.toast.error(r?.error || 'No se pudo guardar');
            }
          },
          error: (e) => {
            this.capturingGps.set(false);
            this.toast.error(e.error?.error || 'Error al guardar GPS');
          },
        });
      },
      (err) => {
        this.capturingGps.set(false);
        let msg = 'No se pudo obtener GPS';
        if (err.code === 1) msg = 'Permiso de ubicacion denegado. Habilitalo en el navegador.';
        else if (err.code === 2) msg = 'GPS no disponible. Verifica que esta activado.';
        else if (err.code === 3) msg = 'Timeout obteniendo ubicacion';
        this.toast.error(msg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  // ─── EDIT PROFILE ───
  startEditProfile() {
    const c = this.client();
    if (!c) return;
    this.editName = c.nombre || '';
    this.editPhone = c.telefono || '';
    this.editCedula = c.cedula || '';
    this.editEmail = c.email || '';
    this.editDireccion = c.direccion || '';
    this.editCiudad = c.ciudad || '';
    this.editingProfile.set(true);
  }

  saveProfile() {
    const c = this.client();
    if (!c) return;
    this.saving.set(true);

    // 1. Update nombre via PATCH servicio (siempre funciona)
    this.api.updateServiceName(c.id_servicio, this.editName).subscribe({
      next: () => {
        // 2. Update datos personales via PUT perfil
        const profileData: any = {
          nombre: this.editName.split(' ')[0] || this.editName,
          apellidos: this.editName.split(' ').slice(1).join(' ') || '-',
          telefono: this.editPhone || '0000000000',
          cedula: this.editCedula || '-',
          email: this.editEmail || 'na@na.com',
          direccion: this.editDireccion || '-',
          localidad: this.editCiudad || '-',
          ciudad: this.editCiudad || '-',
        };

        this.api.updateProfile(c.id_servicio, profileData).subscribe({
          next: () => this.onProfileSaved(),
          error: () => this.onProfileSaved() // PUT da 500 pero guarda los datos
        });
      },
      error: (e) => {
        this.saving.set(false);
        this.toast.error('Error: ' + (e.error?.detail || 'No se pudo guardar'));
      }
    });
  }

  private async onProfileSaved() {
    this.saving.set(false);
    this.editingProfile.set(false);
    this.toast.success('Datos del cliente actualizados');

    // Refresh from API
    const c = this.client()!;
    this.api.getClientProfile(c.id_servicio).subscribe({
      next: (profile) => {
        const updated = { ...c, nombre: profile.nombre + (profile.apellidos ? ' ' + profile.apellidos : ''), telefono: profile.telefono, cedula: profile.cedula, email: profile.email, direccion: profile.direccion, ciudad: profile.ciudad };
        this.client.set(updated);
        this.clientName.set(updated.nombre);
        this.db.saveClients([updated]); // update local cache
      }
    });
  }

  // ─── EDIT SERVICE ───
  startEditService() {
    const c = this.client();
    if (!c) return;
    this.editIp = c.ip || '';
    this.editMac = c.mac_cpe || '';
    this.editLan = c.interfaz_lan || '';
    this.editOnu = c.sn_onu || '';
    this.editSsid = c.ssid_router_wifi || '';
    this.editWifiPass = c.password_ssid_router_wifi || '';
    this.editComentarios = c.comentarios || '';
    this.editingService.set(true);
  }

  saveService() {
    const c = this.client();
    if (!c) return;
    this.saving.set(true);

    const data: any = {
      ip: this.editIp,
      mac_cpe: this.editMac,
      interfaz_lan: this.editLan,
      sn_onu: this.editOnu,
      ssid_router_wifi: this.editSsid,
      password_ssid_router_wifi: this.editWifiPass,
      comentarios: this.editComentarios,
    };

    this.api.updateService(c.id_servicio, data).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.editingService.set(false);
        this.toast.success('Servicio actualizado en WispHub');

        const updated = { ...c, ip: this.editIp, mac_cpe: this.editMac, interfaz_lan: this.editLan, sn_onu: this.editOnu, ssid_router_wifi: this.editSsid, password_ssid_router_wifi: this.editWifiPass, comentarios: this.editComentarios };
        this.client.set(updated);
        this.db.saveClients([updated]);
      },
      error: (e) => {
        this.saving.set(false);
        this.toast.error('Error: ' + (e.error?.detail || 'No se pudo guardar'));
      }
    });
  }

  // ─── ACTIONS ───
  activateClient() {
    const c = this.client();
    if (!c) return;
    this.api.activateClient(c.id_servicio).subscribe({
      next: () => this.toast.success('Cliente activado'),
      error: (e) => this.toast.error('Error: ' + (e.error?.detail || 'Sin permisos'))
    });
  }

  deactivateClient() {
    const c = this.client();
    if (!c) return;
    this.api.deactivateClient(c.id_servicio).subscribe({
      next: () => this.toast.success('Cliente suspendido'),
      error: (e) => this.toast.error('Error: ' + (e.error?.detail || 'Sin permisos'))
    });
  }

  pingClient() {
    const c = this.client();
    if (!c) return;
    this.pingResult.set('Realizando ping...');
    this.api.pingClient(c.id_servicio).subscribe({
      next: (res) => { this.pingResult.set(JSON.stringify(res, null, 2)); this.pingSuccess.set(true); },
      error: (e) => { this.pingResult.set('Error: ' + (e.error?.detail || 'Sin respuesta')); this.pingSuccess.set(false); }
    });
  }

  printReceipt(inv: Invoice) {
    this.receiptSvc.openPreview(inv);
  }

  getInitials(nombre: string): string {
    if (!nombre) return '?';
    const p = nombre.trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase();
  }

  getStatusClass(estado: string | null | undefined): string {
    const s = estado?.toLowerCase();
    if (s === 'activo') return 'active';
    if (s === 'suspendido' || s === 'cortado' || s === 'retirado') return 'suspended';
    if (s === 'gratis') return 'free';
    return 'default';
  }

  getFacturaClass(e: string | null | undefined): string {
    if (e?.toLowerCase() === 'pagadas') return 'paid';
    if (e?.toLowerCase().includes('pendiente')) return 'pending';
    return 'default';
  }

  getInvStatusClass(e: string | null | undefined): string {
    if (e?.toLowerCase() === 'pagada') return 'paid';
    if (e?.toLowerCase().includes('pendiente')) return 'pending';
    return 'default';
  }
}
