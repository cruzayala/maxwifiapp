import { Component, DestroyRef, HostListener, OnInit, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { formatDrPhone, internationalDrPhone, telLink, whatsappLink } from '../../pipes/phone';
import { isInvoicePaid, isInvoicePending } from '../../utils/invoice-status';
import { ClientListStateService } from '../../services/client-list-state.service';
import { ConfigService } from '../../services/config.service';
import { AuthService } from '../../services/auth.service';
import { PaymentModalComponent } from '../../components/payment-modal/payment-modal';
import { ClientBlockActionsComponent } from '../../components/client-block-actions/client-block-actions';
import { ClientActionsService } from '../../services/client-actions.service';
import { NavbarComponent } from '../../components/layout/navbar';
import { PlanLabelPipe } from '../../pipes/plan-label.pipe';
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
  LucideActivity, LucideCalendarClock, LucideChevronLeft, LucideChevronRight, LucideCircleDollarSign, LucideCopy,
  LucideExternalLink, LucideGauge, LucideHistory, LucideMapPin, LucideMessageCircle, LucidePackageSearch, LucidePencil,
  LucidePhone, LucidePrinter, LucideReceiptText, LucideSearchX, LucideUserRound, LucideWalletCards, LucideWifi, LucideX,
} from '@lucide/angular';

type ClientDetailTab = 'overview' | 'service' | 'monitoring' | 'equipment' | 'activity';

@Component({
  selector: 'app-client-detail',
  standalone: true,
  imports: [
    NavbarComponent, RouterLink, DecimalPipe, DatePipe, FormsModule, PlanLabelPipe, PaymentModalComponent, ClientBlockActionsComponent,
    ClientExtrasComponent, ClientMetricsComponent, ClientEquipmentComponent,
    LucideActivity, LucideCalendarClock, LucideChevronLeft, LucideChevronRight, LucideCircleDollarSign, LucideCopy,
    LucideExternalLink, LucideGauge, LucideHistory, LucideMapPin, LucideMessageCircle, LucidePackageSearch, LucidePencil,
    LucidePhone, LucidePrinter, LucideReceiptText, LucideSearchX, LucideUserRound, LucideWalletCards, LucideWifi, LucideX,
  ],
  template: `
    <app-navbar [pageTitle]="clientName()" />

    <div class="page">
      <div class="detail-nav">
        <a routerLink="/clients" class="back-link">
          <svg lucideChevronLeft size="16"></svg>
          Volver a clientes
        </a>
        @if (navigation(); as nav) {
          <div class="client-stepper" role="navigation" aria-label="Recorrer clientes de la lista">
            <span class="stepper-label" [title]="nav.label"><span><b>{{ nav.index + 1 }}</b> de {{ nav.total }}</span><small>{{ nav.label }}</small></span>
            <button type="button" class="step-btn" [disabled]="!nav.prev" (click)="goToClient(nav.prev)" aria-label="Cliente anterior" title="Cliente anterior"><svg lucideChevronLeft size="17"></svg><span>Anterior</span></button>
            <button type="button" class="step-btn" [disabled]="!nav.next" (click)="goToClient(nav.next)" aria-label="Cliente siguiente" title="Cliente siguiente"><span>Siguiente</span><svg lucideChevronRight size="17"></svg></button>
          </div>
        }
      </div>

      @if (loading()) {
        <div class="loading-state"><div class="spinner"></div><p>Cargando expediente del cliente…</p></div>
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
                <span class="badge" [class]="'badge-' + getStatusClass(client()!.estado)">{{ client()!.estado || 'Sin estado' }}</span>
                <span class="badge badge-plan" [title]="client()!.plan_internet?.nombre || ''">{{ client()!.plan_internet?.nombre | planLabel }}</span>
                <span class="id-tag">#{{ client()!.id_servicio }}</span>
              </div>
            </div>
          </div>
          <div class="profile-actions">
            @if (whatsappUrl(); as wa) {
              <a class="btn btn-wa" [href]="wa" target="_blank" rel="noopener" title="Abrir un chat de WhatsApp con el cliente"><svg lucideMessageCircle size="16"></svg>WhatsApp</a>
            }
            @if (callUrl(); as tel) {
              <a class="btn btn-outline" [href]="tel" [title]="'Llamar al ' + phoneDisplay()"><svg lucidePhone size="16"></svg>Llamar</a>
            }
            <button type="button" class="btn btn-outline" (click)="pingClient()" [disabled]="pinging()" title="Comprobar si el equipo del cliente responde">
              <svg lucideActivity size="16"></svg>
              {{ pinging() ? 'Haciendo ping…' : 'Ping' }}
            </button>
            @if ((client()!.estado || '').toLowerCase() === 'activo') {
              <button type="button" class="btn btn-red" (click)="deactivateClient()" [disabled]="changingStatus()">{{ changingStatus() ? 'Suspendiendo…' : 'Suspender servicio' }}</button>
            } @else {
              <button type="button" class="btn btn-green" (click)="activateClient()" [disabled]="changingStatus()">{{ changingStatus() ? 'Activando…' : 'Activar servicio' }}</button>
            }
          </div>
        </div>

        <!-- RESUMEN RÁPIDO: lo que se pregunta primero al atender a un cliente -->
        <section class="quick-summary" aria-label="Resumen del cliente">
          <div class="qs-item" [class.danger]="clientOpenBalance() > 0" [class.warn]="clientOpenBalance() === 0 && hasPendingStatus()" [class.ok]="clientOpenBalance() === 0 && !hasPendingStatus()">
            <span class="qs-label"><svg lucideCircleDollarSign size="15"></svg>Saldo pendiente</span>
            <strong>RD$ {{ clientOpenBalance() | number:'1.0-2' }}</strong>
            <small>@if (clientOpenBalance() > 0) { {{ clientInvoicePendingCount() }} {{ clientInvoicePendingCount() === 1 ? 'factura abierta' : 'facturas abiertas' }} } @else if (hasPendingStatus()) { WispHub la marca pendiente } @else { Al día }</small>
            <div class="qs-actions">
              @if (canCollect() && oldestPendingInvoice(); as inv) {
                <button type="button" class="qs-action pay" (click)="openPayment(inv)" [title]="'Registrar el pago de la factura #' + inv.id_factura"><svg lucideCircleDollarSign size="14"></svg>Cobrar</button>
              }
              @if (paymentReminderUrl(); as reminder) {
                @if (clientOpenBalance() > 0 || hasPendingStatus()) {
                  <a class="qs-action" [href]="reminder" target="_blank" rel="noopener" title="Abre WhatsApp con el recordatorio ya escrito; usted lo revisa y lo envía"><svg lucideMessageCircle size="14"></svg>Recordar pago</a>
                }
              }
            </div>
          </div>
          <div class="qs-item" [class.danger]="(cutInfo()?.days ?? 1) < 0 && hasPendingStatus()" [class.warn]="(cutInfo()?.days ?? 99) >= 0 && (cutInfo()?.days ?? 99) <= 5">
            <span class="qs-label"><svg lucideCalendarClock size="15"></svg>Fecha de corte</span>
            <strong>{{ cutInfo()?.label || 'Sin fecha' }}</strong>
            <small>{{ cutInfo()?.detail || 'No registrada en WispHub' }}</small>
          </div>
          <div class="qs-item">
            <span class="qs-label"><svg lucideGauge size="15"></svg>Plan</span>
            <strong [title]="client()!.plan_internet?.nombre || ''">{{ client()!.plan_internet?.nombre | planLabel }}</strong>
            <small>{{ planPrice() !== null ? 'RD$ ' + (planPrice() | number:'1.0-2') + ' al mes' : 'Sin precio registrado' }}</small>
          </div>
          <div class="qs-item">
            <span class="qs-label"><svg lucideWifi size="15"></svg>Conexión</span>
            <strong class="mono">{{ client()!.ip || 'Sin IP' }}@if (client()!.ip) { <button type="button" class="copy-btn" title="Copiar IP" aria-label="Copiar IP" (click)="copyValue(client()!.ip, 'IP')"><svg lucideCopy size="13"></svg></button> }</strong>
            <small>{{ client()!.zona?.nombre || 'Sin zona' }}@if (client()!.telefono) { · {{ phoneDisplay() }} }</small>
          </div>
        </section>

        @if (pinging()) {
          <div class="ping-box pending" role="status"><strong>Haciendo ping a {{ client()!.ip || 'el cliente' }}…</strong></div>
        } @else if (pingResult()) {
          <div class="ping-box" [class.success]="pingSuccess()" role="status">
            <div class="ping-head"><strong>{{ pingSuccess() ? 'Ping enviado: WispHub respondió a la solicitud' : 'El ping no obtuvo respuesta' }}</strong><button type="button" class="ping-close" aria-label="Cerrar resultado del ping" (click)="pingResult.set('')"><svg lucideX size="15"></svg></button></div>
            @if (pingSuccess()) {
              <details><summary>Ver detalle técnico</summary><pre>{{ pingResult() }}</pre></details>
            } @else {
              <p>{{ pingResult() }}</p>
            }
          </div>
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
              <h3>Datos del cliente</h3>
              @if (!editingProfile()) {
                <button type="button" class="btn-edit" (click)="startEditProfile()">
                  <svg lucidePencil size="14"></svg>
                  Editar
                </button>
              }
            </div>
            @if (editingProfile()) {
              <div class="edit-form">
                <div class="form-row">
                  <div class="form-group">
                    <label for="cd-nombre">Nombre completo <b class="req">*</b></label>
                    <input id="cd-nombre" type="text" [(ngModel)]="editName" class="form-input" [class.invalid]="!editName.trim()" />
                    @if (!editName.trim()) { <span class="field-error">Escriba el nombre del cliente.</span> }
                  </div>
                  <div class="form-group">
                    <label for="cd-tel">Teléfono</label>
                    <input id="cd-tel" type="tel" inputmode="tel" [(ngModel)]="editPhone" class="form-input" placeholder="809-000-0000" />
                    @if (editPhone.trim() && !validPhone(editPhone)) { <span class="field-warn">Revise el número: 10 dígitos que empiecen por 809, 829 u 849.</span> }
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label for="cd-cedula">Cédula</label>
                    <input id="cd-cedula" type="text" [(ngModel)]="editCedula" class="form-input" placeholder="000-0000000-0" />
                  </div>
                  <div class="form-group">
                    <label for="cd-email">Correo electrónico</label>
                    <input id="cd-email" type="email" [(ngModel)]="editEmail" class="form-input" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label for="cd-direccion">Dirección</label>
                    <input id="cd-direccion" type="text" [(ngModel)]="editDireccion" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label for="cd-ciudad">Ciudad</label>
                    <input id="cd-ciudad" type="text" [(ngModel)]="editCiudad" class="form-input" />
                  </div>
                </div>
                <div class="edit-actions">
                  <button type="button" class="btn btn-primary" (click)="saveProfile()" [disabled]="saving() || !editName.trim()">
                    {{ saving() ? 'Guardando…' : 'Guardar cambios' }}
                  </button>
                  <button type="button" class="btn btn-outline" (click)="editingProfile.set(false)" [disabled]="saving()">Cancelar</button>
                </div>
              </div>
            } @else {
              <div class="info-grid">
                <div class="info-item"><span class="lbl">Usuario</span><span class="val mono">{{ client()!.usuario || '—' }}</span></div>
                <div class="info-item"><span class="lbl">Teléfono</span><span class="val phone">@if (client()!.telefono) { <a [href]="'tel:' + client()!.telefono">{{ client()!.telefono }}</a><button type="button" class="copy-btn" title="Copiar teléfono" aria-label="Copiar teléfono" (click)="copyValue(client()!.telefono, 'Teléfono')"><svg lucideCopy size="13"></svg></button> } @else { — }</span></div>
                <div class="info-item"><span class="lbl">Correo</span><span class="val">{{ client()!.email || '—' }}</span></div>
                <div class="info-item"><span class="lbl">Cédula</span><span class="val">{{ client()!.cedula || '—' }}</span></div>
                <div class="info-item full"><span class="lbl">Dirección</span><span class="val">{{ client()!.direccion || '—' }}</span></div>
                <div class="info-item"><span class="lbl">Ciudad</span><span class="val">{{ client()!.ciudad || '—' }}</span></div>
                <div class="info-item"><span class="lbl">Técnico</span><span class="val">{{ client()!.tecnico?.nombre || '—' }}</span></div>
              </div>
            }
          </div>

          <!-- EDITAR SERVICIO -->
          <div class="card" [class.tab-hidden]="activeTab() !== 'service'">
            <div class="card-head">
              <h3>Servicio de internet</h3>
              @if (!editingService()) {
                <button type="button" class="btn-edit" (click)="startEditService()">
                  <svg lucidePencil size="14"></svg>
                  Editar
                </button>
              }
            </div>
            @if (editingService()) {
              <div class="edit-form">
                <p class="edit-warning">Estos datos se guardan en WispHub. Cambiar la IP o la MAC puede afectar la conexión del cliente.</p>
                <div class="form-row">
                  <div class="form-group">
                    <label for="cd-ip">IP</label>
                    <input id="cd-ip" type="text" [(ngModel)]="editIp" class="form-input mono-input" />
                  </div>
                  <div class="form-group">
                    <label for="cd-mac">MAC del CPE</label>
                    <input id="cd-mac" type="text" [(ngModel)]="editMac" class="form-input mono-input" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label for="cd-lan">Interfaz LAN</label>
                    <input id="cd-lan" type="text" [(ngModel)]="editLan" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label for="cd-onu">Serial de la ONU</label>
                    <input id="cd-onu" type="text" [(ngModel)]="editOnu" class="form-input mono-input" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label for="cd-ssid">Nombre de la red WiFi (SSID)</label>
                    <input id="cd-ssid" type="text" [(ngModel)]="editSsid" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label for="cd-wifipass">Clave WiFi</label>
                    <input id="cd-wifipass" type="text" [(ngModel)]="editWifiPass" class="form-input" autocomplete="off" />
                  </div>
                </div>
                <div class="form-group">
                  <label for="cd-coment">Comentarios</label>
                  <textarea id="cd-coment" [(ngModel)]="editComentarios" class="form-input" rows="2"></textarea>
                </div>
                <div class="edit-actions">
                  <button type="button" class="btn btn-primary" (click)="saveService()" [disabled]="saving()">
                    {{ saving() ? 'Guardando…' : 'Guardar cambios' }}
                  </button>
                  <button type="button" class="btn btn-outline" (click)="editingService.set(false)" [disabled]="saving()">Cancelar</button>
                </div>
              </div>
            } @else {
              <div class="info-grid">
                <div class="info-item"><span class="lbl">Plan</span><span class="val highlight" [title]="client()!.plan_internet?.nombre || ''">{{ client()!.plan_internet?.nombre | planLabel:'—' }}</span></div>
                <div class="info-item"><span class="lbl">Precio mensual</span><span class="val highlight">{{ planPrice() !== null ? 'RD$ ' + (planPrice() | number:'1.0-2') : '—' }}</span></div>
                <div class="info-item"><span class="lbl">IP</span><span class="val mono">@if (client()!.ip) { {{ client()!.ip }}<button type="button" class="copy-btn" title="Copiar IP" aria-label="Copiar IP" (click)="copyValue(client()!.ip, 'IP')"><svg lucideCopy size="13"></svg></button> } @else { — }</span></div>
                <div class="info-item"><span class="lbl">MAC del CPE</span><span class="val mono">{{ client()!.mac_cpe || '—' }}</span></div>
                <div class="info-item"><span class="lbl">Interfaz LAN</span><span class="val mono">{{ client()!.interfaz_lan || '—' }}</span></div>
                <div class="info-item"><span class="lbl">Serial de la ONU</span><span class="val mono">{{ client()!.sn_onu || '—' }}</span></div>
                <div class="info-item"><span class="lbl">Zona</span><span class="val">{{ client()!.zona?.nombre || '—' }}</span></div>
                <div class="info-item"><span class="lbl">Router</span><span class="val">{{ client()!.router?.nombre || '—' }}</span></div>
                <div class="info-item"><span class="lbl">Red WiFi (SSID)</span><span class="val mono">{{ client()!.ssid_router_wifi || '—' }}</span></div>
                <div class="info-item"><span class="lbl">Clave WiFi</span><span class="val mono secret-val">@if (!client()!.password_ssid_router_wifi) { — } @else { {{ showWifiPassword() ? client()!.password_ssid_router_wifi : '••••••••' }} <button type="button" class="reveal-btn" (click)="showWifiPassword.set(!showWifiPassword())">{{ showWifiPassword() ? 'Ocultar' : 'Mostrar' }}</button> }</span></div>
              </div>
            }
          </div>

          <!-- FACTURACION (solo lectura) -->
          <div class="card" [class.tab-hidden]="activeTab() !== 'overview'">
            <h3>Facturación</h3>
            <div class="info-grid">
              <div class="info-item"><span class="lbl">Estado de facturas</span>
                <span class="val"><span class="badge" [class]="'badge-' + getFacturaClass(client()!.estado_facturas)">{{ client()!.estado_facturas || 'Sin datos' }}</span></span>
              </div>
              <div class="info-item"><span class="lbl">Saldo</span><span class="val saldo" [class.red]="clientOpenBalance() > 0" [class.unconfirmed]="clientOpenBalance() === 0 && (client()!.estado_facturas || '').toLowerCase().includes('pendiente')" [title]="clientOpenBalance() === 0 && (client()!.estado_facturas || '').toLowerCase().includes('pendiente') ? 'WispHub marca la factura como pendiente, pero el monto aún no está sincronizado' : ''">RD$ {{ clientOpenBalance() | number:'1.2-2' }}</span></div>
              <div class="info-item"><span class="lbl">Fecha de instalación</span><span class="val">{{ readableDate(client()!.fecha_instalacion) }}</span></div>
              <div class="info-item"><span class="lbl">Fecha de corte</span><span class="val">{{ readableDate(client()!.fecha_corte) }}</span></div>
              <div class="info-item"><span class="lbl">Firewall</span><span class="val">{{ client()!.firewall ? 'Sí' : 'No' }}</span></div>
              <div class="info-item"><span class="lbl">Último cambio</span><span class="val">{{ readableDate(client()!.ultimo_cambio) }}</span></div>
            </div>
          </div>

          <!-- ESTADO DE COBRO: aviso de pago / corte aplicados desde este sistema -->
          <div class="card crm-card" [class.tab-hidden]="activeTab() !== 'overview'">
            <h3>Estado de cobro</h3>
            @if (crmState(); as state) {
              <div class="crm-current" [class.warn]="state.crmAction === 'moroso'" [class.danger]="state.crmAction === 'block'">
                <strong>{{ state.crmAction === 'block' ? 'Internet cortado' : state.crmAction === 'moroso' ? 'Con aviso de pago' : 'Sin restricciones' }}</strong>
                <small>
                  @if (state.crmAction) { {{ state.crmActionReason || 'Sin motivo' }}@if (state.crmActionAt) { · desde {{ state.crmActionAt | date:'d MMM y, h:mm a' }} } }
                  @else { El cliente navega normalmente. }
                </small>
              </div>
              <app-client-block-actions [idServicio]="client()!.id_servicio" [clientName]="client()!.nombre" [crmAction]="state.crmAction" [paymentPilotEnabled]="state.paymentPilotEnabled" (changed)="onCrmChanged()" />
              @if (!state.paymentPilotEnabled && state.crmAction !== 'block') {
                <p class="crm-note">El corte con portal de pago no está habilitado para este cliente.</p>
              }
            } @else {
              <p class="crm-note">Consultando el estado de cobro…</p>
            }
            <div class="crm-history">
              <span class="lbl">Historial</span>
              @for (ev of crmEvents(); track ev.id) {
                <div class="crm-event"><b>{{ crmEventLabel(ev.action) }}</b><span>{{ ev.createdAt | date:'d MMM y, h:mm a' }}{{ ev.createdBy ? ' · ' + ev.createdBy : '' }}</span>@if (ev.reason) { <small>{{ ev.reason }}</small> }</div>
              } @empty {
                <p class="crm-note">{{ crmEventsError() ? 'No se pudo cargar el historial.' : 'Sin avisos ni cortes registrados.' }}</p>
              }
            </div>
          </div>

          <!-- CONFIG WiFi (solo lectura) -->
          <div class="card" [class.tab-hidden]="activeTab() !== 'service'">
            <h3>Router y equipo del cliente</h3>
            <div class="info-grid">
              <div class="info-item"><span class="lbl">Modelo del router</span><span class="val">{{ client()!.modelo_router_wifi || '—' }}</span></div>
              <div class="info-item"><span class="lbl">IP del router</span><span class="val mono">{{ client()!.ip_router_wifi || '—' }}</span></div>
              <div class="info-item"><span class="lbl">MAC del router</span><span class="val mono">{{ client()!.mac_router_wifi || '—' }}</span></div>
              <div class="info-item"><span class="lbl">Antena</span><span class="val">{{ client()!.modelo_antena || '—' }}</span></div>
              <div class="info-item"><span class="lbl">Contratación</span><span class="val">{{ client()!.forma_contratacion || '—' }}</span></div>
              <div class="info-item full"><span class="lbl">Comentarios</span><span class="val">{{ client()!.comentarios || '—' }}</span></div>
            </div>
          </div>
        </div>

        <!-- GPS DEL CLIENTE -->
        <div class="card gps-section" [class.tab-hidden]="activeTab() !== 'overview'">
          <h3><svg lucideMapPin size="17"></svg> Ubicación GPS</h3>
          @if (gpsLat() && gpsLng()) {
            <div class="gps-saved">
              <div class="gps-coords">
                <span class="gps-label">Latitud</span><span class="gps-val mono">{{ gpsLat() }}</span>
                <span class="gps-label">Longitud</span><span class="gps-val mono">{{ gpsLng() }}</span>
                @if (gpsAccuracy()) {
                  <span class="gps-label">Precisión</span><span class="gps-val">±{{ gpsAccuracy() }}m</span>
                }
                @if (gpsCapturedAt()) {
                  <span class="gps-label">Capturada</span><span class="gps-val">{{ gpsCapturedAt() | date:'dd/MM/yyyy h:mm a' }}{{ gpsCapturedBy() ? ' por ' + gpsCapturedBy() : '' }}</span>
                }
              </div>
              <div class="gps-actions">
                <a [href]="googleMapsUrl()" target="_blank" rel="noopener" class="btn btn-outline"><svg lucideExternalLink size="15"></svg> Ver en Google Maps</a>
                <button type="button" class="btn btn-outline" (click)="copyValue(gpsText(), 'Coordenadas')"><svg lucideCopy size="15"></svg> Copiar coordenadas</button>
                <button type="button" class="btn btn-primary" (click)="confirmUpdateGps()" [disabled]="capturingGps()">
                  @if (capturingGps()) { Capturando… } @else { Actualizar ubicación }
                </button>
              </div>
            </div>
          } @else {
            <p class="gps-empty">Este cliente no tiene ubicación GPS guardada.</p>
            <button type="button" class="btn btn-primary" (click)="captureGps()" [disabled]="capturingGps()">
              <svg lucideMapPin size="15"></svg>
              @if (capturingGps()) { Capturando… } @else { Capturar mi ubicación actual }
            </button>
            <p class="gps-hint">El navegador pedirá permiso de ubicación. Para mayor precisión, captura desde el sitio del cliente con el celular.</p>
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
      } @else {
        <div class="not-found">
          <svg lucideSearchX size="40"></svg>
          <h3>No encontramos este cliente</h3>
          <p>Puede que el enlace sea incorrecto o que la cartera no esté sincronizada. Vuelva a la lista y pulse «Sincronizar».</p>
          <a routerLink="/clients" class="btn btn-primary">Ir a la lista de clientes</a>
        </div>
      }

      @if (invoiceModalOpen() && client()) {
        <div class="modal-backdrop" role="presentation" (click)="closeInvoicePortfolio()">
          <section class="portfolio-modal" role="dialog" aria-modal="true" aria-labelledby="portfolio-title" (click)="$event.stopPropagation()">
            <header class="portfolio-head">
              <div class="portfolio-title"><span class="portfolio-icon"><svg lucideWalletCards size="20"></svg></span><div><small>Cartera del cliente</small><h2 id="portfolio-title">{{ client()!.nombre }}</h2><p>{{ clientInvoices().length }} facturas en el historial</p></div></div>
              <button type="button" class="modal-close" aria-label="Cerrar cartera" (click)="closeInvoicePortfolio()"><svg lucideX size="19"></svg></button>
            </header>

            <div class="portfolio-kpis">
              <div><span><svg lucideReceiptText size="16"></svg>Total histórico</span><strong>RD$ {{ clientInvoiceTotal() | number:'1.2-2' }}</strong></div>
              <div class="paid"><span><svg lucideCircleDollarSign size="16"></svg>Pagadas</span><strong>{{ clientInvoicePaidCount() }}</strong></div>
              <div class="pending"><span><svg lucideHistory size="16"></svg>Pendientes</span><strong>{{ clientInvoicePendingCount() }}</strong></div>
              <div><span>Saldo actual</span><strong [class.danger-text]="clientOpenBalance() > 0">RD$ {{ clientOpenBalance() | number:'1.2-2' }}</strong></div>
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
                <thead><tr><th>Factura</th><th>Emisión</th><th>Vencimiento</th><th>Total</th><th>Estado</th><th>Forma de pago</th><th>Acciones</th></tr></thead>
                <tbody>
                  @for (inv of visibleClientInvoices(); track inv.id_factura) {
                    <tr>
                      <td data-label="Factura" class="id-col">#{{ inv.id_factura }}</td>
                      <td data-label="Emisión">{{ readableDate(inv.fecha_emision) }}</td>
                      <td data-label="Vencimiento">{{ readableDate(inv.fecha_vencimiento) }}</td>
                      <td data-label="Total" class="money">RD$ {{ inv.total | number:'1.2-2' }}</td>
                      <td data-label="Estado"><span class="badge" [class]="'badge-' + getInvStatusClass(inv.estado)">{{ inv.estado || '-' }}</span></td>
                      <td data-label="Pago">{{ inv.forma_pago?.nombre || '—' }}</td>
                      <td data-label="Acciones" class="inv-actions">@if (canCollect() && isInvoicePending(inv)) { <button class="btn-pay" type="button" (click)="openPayment(inv)" [attr.aria-label]="'Registrar pago de la factura ' + inv.id_factura" title="Registrar pago de esta factura"><svg lucideCircleDollarSign size="15"></svg>Pagar</button> }<button class="btn-icon" type="button" (click)="printReceipt(inv)" [attr.aria-label]="'Imprimir recibo de factura ' + inv.id_factura" title="Imprimir recibo"><svg lucidePrinter size="16"></svg></button></td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7" class="portfolio-empty">{{ clientInvoices().length ? 'No hay facturas en este estado.' : 'Este cliente no tiene facturas guardadas. Sincronice las facturas desde el módulo de Facturación.' }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>
      }

      <app-payment-modal
        [visible]="showPayment()"
        [invoice]="payingInvoice()"
        (onClose)="showPayment.set(false)"
        (onSuccess)="onPaymentSuccess()" />
    </div>
  `,
  styles: [`
    .page { padding: 20px 24px 32px; color: #334250; }
    .back-link { display: inline-flex; align-items: center; gap: 5px; color: #1267dd; text-decoration: none; font-size: 13px; font-weight: 700; margin-bottom: 12px; }
    .back-link:hover { text-decoration: underline; }

    .profile-bar {
      display: flex; align-items: center; justify-content: space-between;
      background: white; border: 1px solid #dce5eb; border-radius: 8px;
      padding: 18px 20px; margin-bottom: 10px; flex-wrap: wrap; gap: 16px;
    }
    .profile-left { display: flex; align-items: center; gap: 16px; }
    .avatar-lg { width: 58px; height: 58px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 22px; color: white; }
    .avatar-lg.active { background: #13875a; }
    .avatar-lg.suspended { background: #b42318; }
    .avatar-lg.free { background: #1267dd; }
    .avatar-lg.default { background: #72808d; }
    .profile-left { min-width: 0; }
    .profile-left h2 { margin: 0 0 6px; font-size: 22px; font-weight: 700; color: #172535; overflow-wrap: anywhere; }
    .profile-badges { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .id-tag { font-size: 13px; color: #667582; }
    .profile-actions { display: flex; gap: 10px; flex-wrap: wrap; }

    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 18px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: background .15s, border-color .15s, color .15s; text-decoration: none; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-outline { background: white; border-color: #ccd6de; color: #334250; }
    .btn-outline:hover:not(:disabled) { border-color: #1267dd; color: #1267dd; }
    .btn-green { background: #13875a; color: white; }
    .btn-green:hover:not(:disabled) { background: #0f704b; }
    .btn-red { background: #fff; border-color: #f0b4ae; color: #b42318; }
    .btn-red:hover:not(:disabled) { background: #fff0ef; border-color: #b42318; }
    .btn-primary { background: #1267dd; color: white; }
    .btn-primary:hover:not(:disabled) { background: #0d58c0; }
    .btn:focus-visible, .btn-edit:focus-visible, .client-tabs button:focus-visible, .copy-btn:focus-visible, .reveal-btn:focus-visible { outline: 2px solid #1267dd; outline-offset: 2px; }

    .btn-edit {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 14px; border: 1px solid #ccd6de; border-radius: 6px;
      background: white; font-size: 12px; color: #1267dd; font-weight: 600;
      cursor: pointer; transition: all 0.2s;
    }
    .btn-edit:hover { background: #1267dd; color: white; border-color: #1267dd; }

    .ping-box { margin-bottom: 12px; padding: 12px 16px; border-radius: 8px; background: #fff0ef; border: 1px solid #f0b4ae; color: #b42318; font-size: 13px; }
    .ping-box.success { background: #e9f8f1; border-color: #a8dcc3; color: #13875a; }
    .ping-box.pending { background: #f2f7ff; border-color: #cfe0f8; color: #1267dd; }
    .ping-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .ping-close { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
    .ping-close:hover { background: rgba(255,255,255,.7); }
    .ping-box p { margin: 6px 0 0; color: #334250; }
    .ping-box details { margin-top: 6px; color: #334250; }
    .ping-box summary { cursor: pointer; font-size: 12px; font-weight: 600; }
    .ping-box pre { margin: 6px 0 0; max-height: 220px; overflow: auto; font-size: 12px; white-space: pre-wrap; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; }

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
    .client-tabs button.active { position: relative; color: #1267dd; border-color: #dce5eb; background: #fff; box-shadow: 0 -2px 6px rgba(30, 51, 73, 0.05); }
    .client-tabs button.active::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: #fff; }
    .client-tabs .portfolio-tab { margin-left: auto; color: #13875a; }
    .client-tabs .portfolio-tab b { display: grid; place-items: center; min-width: 21px; height: 21px; padding: 0 5px; border-radius: 11px; background: #e9f8f1; color: #13875a; font-size: 12px; }
    .tab-hidden { display: none !important; }
    .tab-panel { min-width: 0; animation: panelIn 0.16s ease; }
    @keyframes panelIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }

    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    .card { background: white; border-radius: 8px; border: 1px solid #dce5eb; padding: 20px; }

    .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 1px solid #edf0f2; }
    .card-head h3 { margin: 0; font-size: 15px; font-weight: 600; color: #172535; }
    .card h3 { font-size: 15px; font-weight: 600; color: #172535; margin: 0 0 16px; padding-bottom: 10px; border-bottom: 1px solid #edf0f2; }

    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .info-item.full { grid-column: 1 / -1; }
    .lbl { display: block; font-size: 11px; color: #667582; text-transform: uppercase; font-weight: 700; margin-bottom: 3px; }
    .val { font-size: 14px; color: #172535; font-weight: 500; overflow-wrap: anywhere; }
    .val a { color: inherit; text-decoration: none; }
    .val a:hover { color: #1267dd; text-decoration: underline; }
    .copy-btn { display: inline-grid; place-items: center; width: 24px; height: 24px; margin-left: 6px; padding: 0; border: 1px solid #dfe5ea; border-radius: 5px; background: #fff; color: #667582; cursor: pointer; vertical-align: middle; }
    .copy-btn:hover { color: #1267dd; border-color: #1267dd; background: #f2f7ff; }
    .val.mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 13px; }
    .secret-val { display: inline-flex; align-items: center; gap: 8px; }
    .reveal-btn { padding: 2px 8px; border: 1px solid #ccd6de; border-radius: 4px; background: #fff; color: #1267dd; font: 600 11px Inter, sans-serif; cursor: pointer; }
    .reveal-btn:hover { background: #f2f7ff; }
    .val.highlight { color: #1267dd; font-weight: 700; }
    .val.phone { color: #172535; font-size: 16px; font-weight: 700; }
    .val.saldo { font-size: 18px; font-weight: 700; color: #13875a; }
    .val.saldo.red { color: #b42318; }
    .val.saldo.unconfirmed { color: #b36b12; }

    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .badge-active { background: #e9f8f1; color: #13875a; }
    .badge-suspended { background: #fff0ef; color: #b42318; }
    .badge-free { background: #edf4ff; color: #1267dd; }
    .badge-default { background: #eef1f4; color: #526170; }
    .badge-plan { background: #edf4ff; color: #1267dd; }
    .badge-paid { background: #e9f8f1; color: #13875a; }
    .badge-pending { background: #fff6e8; color: #b36b12; }

    /* EDIT FORM */
    .edit-form { animation: fadeIn 0.2s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form-group { margin-bottom: 12px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; color: #334250; margin-bottom: 4px; }
    .req { color: #b42318; }
    .field-error { display: block; margin-top: 4px; color: #b42318; font-size: 12px; }
    .form-input.invalid { border-color: #b42318; }
    .edit-warning { margin: 0 0 12px; padding: 8px 10px; border: 1px solid #f3d19e; border-radius: 6px; background: #fff6e8; color: #7a4a0c; font-size: 12px; }
    .form-input { width: 100%; padding: 9px 12px; border: 1px solid #ccd6de; border-radius: 6px; font-size: 14px; color: #172535; outline: none; box-sizing: border-box; transition: border 0.2s; }
    .form-input:focus { border-color: #1267dd; box-shadow: 0 0 0 3px rgba(18, 103, 221,0.1); }
    .mono-input { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; }
    textarea.form-input { resize: vertical; }
    .edit-actions { display: flex; gap: 8px; margin-top: 4px; }

    .gps-section { padding: 18px 20px; }
    .gps-section h3 { display: flex; align-items: center; gap: 7px; margin: 0 0 14px; font-size: 15px; color: #172535; }
    .gps-saved { display: flex; flex-direction: column; gap: 14px; }
    .gps-coords {
      display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px;
      background: #f8fafc; padding: 12px 16px; border-radius: 8px;
    }
    .gps-label { color: #667582; font-size: 12px; font-weight: 600; }
    .gps-val { color: #172535; font-size: 13px; overflow-wrap: anywhere; }
    .gps-val.mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 12px; }
    .gps-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .gps-empty { color: #334250; font-size: 13px; margin: 0 0 12px; }
    .gps-hint { color: #667582; font-size: 12px; margin: 10px 0 0; }
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th { text-align: left; font-size: 11px; font-weight: 700; color: #667582; text-transform: uppercase; padding: 10px 12px; border-bottom: 1px solid #dfe5ea; }
    .data-table td { padding: 10px 12px; font-size: 13px; color: #334250; border-bottom: 1px solid #edf0f2; }
    .id-col { font-weight: 600; color: #1267dd; }
    .money { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
    .btn-icon { background: none; border: 1px solid #dfe5ea; border-radius: 6px; padding: 5px 7px; cursor: pointer; color: #64748b; transition: all 0.2s; }
    .btn-icon:hover { background: #1267dd; color: white; border-color: #1267dd; }

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
    .portfolio-icon { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 auto; border-radius: 6px; background: #edf4ff; color: #1267dd; }
    .portfolio-title > div { min-width: 0; }
    .portfolio-title small { display: block; margin: 0; color: #667582; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .portfolio-title h2 { margin: 2px 0 0; color: #172b40; font-size: 18px; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .portfolio-title p { margin: 3px 0 0; color: #667582; font-size: 12px; }
    .modal-close { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 auto; border: 1px solid #dce5eb; border-radius: 6px; background: #fff; color: #607386; cursor: pointer; }
    .modal-close:hover { color: #b42318; border-color: #f0b4ae; background: #fff5f4; }
    .portfolio-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; margin: 12px 12px 0; overflow: hidden; border: 1px solid #dce5eb; border-radius: 6px; background: #dce5eb; }
    .portfolio-kpis > div { min-width: 0; padding: 11px 13px; background: #fff; }
    .portfolio-kpis span { display: flex; align-items: center; gap: 6px; color: #667582; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .portfolio-kpis strong { display: block; margin-top: 5px; color: #22384d; font-size: 17px; overflow-wrap: anywhere; }
    .portfolio-kpis .paid strong { color: #13875a; }
    .portfolio-kpis .pending strong, .danger-text { color: #b42318 !important; }
    .portfolio-toolbar { padding: 10px 12px; }
    .portfolio-filters { display: inline-flex; gap: 4px; padding: 3px; border: 1px solid #dce5eb; border-radius: 6px; background: #fff; }
    .portfolio-filters button { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 10px; border: 0; border-radius: 4px; background: transparent; color: #617487; font-size: 11px; font-weight: 700; cursor: pointer; }
    .portfolio-filters button.active { color: #1267dd; background: #edf4ff; }
    .portfolio-filters b { display: inline-grid; place-items: center; min-width: 19px; height: 19px; padding: 0 4px; border-radius: 10px; background: #edf1f4; color: inherit; font-size: 11px; }
    .portfolio-table-wrap { min-height: 0; margin: 0 12px 12px; overflow: auto; border: 1px solid #dce5eb; border-radius: 6px; background: #fff; }
    .portfolio-table { min-width: 760px; }
    .portfolio-table thead { position: sticky; top: 0; z-index: 1; background: #f6f8fa; }
    .portfolio-table tbody tr:hover td { background: #f8fbfd; }
    .portfolio-empty { padding: 44px !important; text-align: center; color: #667582 !important; }

    .loading-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 80px 20px; color: #667582; font-size: 13px; }
    .loading-state p { margin: 0; }
    .not-found { display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: 460px; margin: 40px auto; padding: 32px 20px; text-align: center; border: 1px solid #dfe5ea; border-radius: 8px; background: #fff; }
    .not-found > svg { color: #8a9aa8; }
    .not-found h3 { margin: 0; color: #172535; font-size: 17px; }
    .not-found p { margin: 0 0 6px; color: #667582; font-size: 13px; line-height: 1.5; }
    .spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #1267dd; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Navegación entre clientes de la lista */
    .detail-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
    .detail-nav .back-link { margin-bottom: 0; }
    .client-stepper { display: flex; align-items: center; gap: 6px; }
    .stepper-label { display: grid; text-align: right; color: #667582; font-size: 12px; line-height: 1.25; margin-right: 4px; }
    .stepper-label b { color: #172535; }
    .stepper-label small { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
    .step-btn { height: 34px; padding: 0 10px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #ccd6de; border-radius: 6px; background: #fff; color: #334250; font-size: 13px; font-weight: 600; cursor: pointer; }
    .step-btn:hover:not(:disabled) { border-color: #1267dd; color: #1267dd; }
    .step-btn:disabled { opacity: .4; cursor: default; }

    .btn-wa { background: #13875a; color: #fff; }
    .btn-wa:hover { background: #0f704b; }

    /* Resumen rápido */
    .quick-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0 0 14px; }
    .qs-item { position: relative; min-width: 0; padding: 12px 14px; border: 1px solid #dfe5ea; border-left: 4px solid #ccd6de; border-radius: 8px; background: #fff; display: grid; gap: 3px; align-content: start; }
    .qs-item.ok { border-left-color: #13875a; }
    .qs-item.warn { border-left-color: #b36b12; background: #fffcf6; }
    .qs-item.danger { border-left-color: #b42318; background: #fffafa; }
    .qs-label { display: inline-flex; align-items: center; gap: 6px; color: #667582; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; }
    .qs-item strong { color: #172535; font-size: 18px; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qs-item strong.mono { font-size: 15px; }
    .qs-item.danger strong { color: #b42318; }
    .qs-item small { color: #667582; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qs-item.warn small, .qs-item.danger small { color: #7a4a10; }
    .qs-action { justify-self: start; margin-top: 6px; height: 28px; padding: 0 10px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid #b6e3cb; border-radius: 6px; background: #f1faf5; color: #13875a; font-size: 12px; font-weight: 700; text-decoration: none; }
    .qs-action:hover { border-color: #13875a; }
    .field-warn { display: block; margin-top: 4px; color: #9a5b0f; font-size: 12px; }
    .crm-current { margin-bottom: 12px; padding: 10px 12px; border: 1px solid #cfe8dc; border-left: 4px solid #13875a; border-radius: 6px; background: #f4fbf7; display: grid; gap: 3px; }
    .crm-current strong { color: #13875a; font-size: 14px; }
    .crm-current small { color: #526b80; font-size: 12px; }
    .crm-current.warn { border-color: #efcf97; border-left-color: #b36b12; background: #fff8ec; }
    .crm-current.warn strong { color: #9a5b0f; }
    .crm-current.danger { border-color: #f0b4ae; border-left-color: #b42318; background: #fff5f4; }
    .crm-current.danger strong { color: #b42318; }
    .crm-note { margin: 10px 0 0; color: #667582; font-size: 12px; }
    .crm-history { margin-top: 14px; padding-top: 12px; border-top: 1px solid #edf0f2; }
    .crm-history .lbl { display: block; margin-bottom: 6px; color: #667582; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .crm-event { padding: 6px 0; display: grid; gap: 1px; border-bottom: 1px dashed #edf0f2; font-size: 12px; }
    .crm-event:last-child { border-bottom: 0; }
    .crm-event b { color: #172535; font-size: 13px; }
    .crm-event span { color: #667582; }
    .crm-event small { color: #526b80; font-style: italic; }
    .qs-actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .qs-actions:empty { display: none; }
    button.qs-action { cursor: pointer; font-family: inherit; }
    .qs-action.pay { border-color: #1267dd; background: #1267dd; color: #fff; }
    .qs-action.pay:hover { background: #0d58c0; }
    .inv-actions { white-space: nowrap; }
    .btn-pay { height: 30px; margin-right: 6px; padding: 0 10px; display: inline-flex; align-items: center; gap: 5px; border: 0; border-radius: 6px; background: #13875a; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; vertical-align: middle; }
    .btn-pay:hover { background: #0f704b; }

    @media (max-width: 1100px) {
      .quick-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 640px) {
      .client-stepper { width: 100%; }
      .stepper-label { text-align: left; margin-right: auto; }
      .step-btn span { display: none; }
      .quick-summary { gap: 8px; }
      .qs-item { padding: 10px 11px; }
      .qs-item strong { font-size: 16px; }
    }

    @media (max-width: 900px) {
      .detail-grid { grid-template-columns: 1fr; }
      .form-row { grid-template-columns: 1fr; }
      .portfolio-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      .page { padding: 12px; }
      .profile-bar { flex-direction: column; align-items: flex-start; }
      .profile-actions { width: 100%; flex-wrap: wrap; }
      .profile-actions .btn { flex: 1 1 140px; justify-content: center; }
      .gps-actions .btn { flex: 1 1 100%; }
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
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private listState = inject(ClientListStateService);
  private config = inject(ConfigService);
  private auth = inject(AuthService);
  private clientActions = inject(ClientActionsService);

  // Marca de cobro aplicada desde este sistema (aviso de pago o corte) y su historial.
  crmState = signal<{ crmAction: string | null; crmActionReason: string | null; crmActionAt: string | null; paymentPilotEnabled: boolean } | null>(null);
  crmEvents = signal<{ id: number; action: string; reason: string | null; createdAt: string; createdBy: string | null }[]>([]);
  crmEventsError = signal(false);

  // Cobro desde el expediente (mismo formulario y reglas que en Facturas).
  canCollect = computed(() => this.auth.hasRole(['cobranza']));
  payingInvoice = signal<Invoice | null>(null);
  showPayment = signal(false);
  /** Factura abierta más antigua: la que se cobra primero. */
  oldestPendingInvoice = computed(() => {
    const pending = this.clientInvoices().filter((invoice) => this.isClientInvoicePending(invoice));
    return pending.sort((a, b) => String(a.fecha_emision || '').localeCompare(String(b.fecha_emision || '')))[0] ?? null;
  });

  /** Posición del cliente dentro de la última lista filtrada (Anterior/Siguiente). */
  navigation = signal<{ prev: number | null; next: number | null; index: number; total: number; label: string } | null>(null);

  client = signal<WispHubClient | null>(null);
  clientName = signal('Cliente');
  clientInvoices = signal<Invoice[]>([]);
  loading = signal(true);
  saving = signal(false);
  pingResult = signal('');
  pingSuccess = signal(false);
  pinging = signal(false);
  changingStatus = signal(false);
  planPrice = computed(() => {
    const raw = this.client()?.precio_plan as unknown;
    if (raw === null || raw === undefined || raw === '') return null;
    const value = typeof raw === 'number' ? raw : Number.parseFloat(String(raw).replace(/,/g, '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(value) ? value : null;
  });
  activeTab = signal<ClientDetailTab>('overview');
  invoiceModalOpen = signal(false);
  invoiceStatusFilter = signal<'all' | 'paid' | 'pending'>('all');
  clientInvoiceTotal = computed(() => this.clientInvoices().reduce((sum, invoice) => sum + (invoice.total || 0), 0));
  clientInvoicePaidCount = computed(() => this.clientInvoices().filter((invoice) => this.isClientInvoicePaid(invoice)).length);
  clientInvoicePendingCount = computed(() => this.clientInvoices().filter((invoice) => this.isClientInvoicePending(invoice)).length);
  // El saldo del perfil en WispHub puede quedar en 0 aunque haya facturas abiertas: se usa el mayor de ambos.
  clientOpenBalance = computed(() => {
    const fromInvoices = this.clientInvoices()
      .filter((invoice) => this.isClientInvoicePending(invoice))
      .reduce((sum, invoice) => sum + Math.max(0, invoice.saldo || ((invoice.total || 0) - (invoice.total_cobrado || 0))), 0);
    return Math.max(Number(this.client()?.saldo) || 0, fromInvoices);
  });
  visibleClientInvoices = computed(() => {
    const filter = this.invoiceStatusFilter();
    if (filter === 'all') return this.clientInvoices();
    return this.clientInvoices().filter((invoice) => filter === 'paid' ? this.isClientInvoicePaid(invoice) : this.isClientInvoicePending(invoice));
  });

  // GPS
  gpsLat = signal<number | null>(null);
  gpsLng = signal<number | null>(null);
  gpsAccuracy = signal<number | null>(null);
  gpsCapturedAt = signal<string | null>(null);
  gpsCapturedBy = signal<string | null>(null);
  capturingGps = signal(false);
  showWifiPassword = signal(false);
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
    // Si el formulario de pago está abierto, Esc solo cierra ese formulario (lo maneja él mismo).
    if (this.showPayment()) return;
    if (this.invoiceModalOpen()) this.closeInvoicePortfolio();
  }

  // Las reglas viven en utils/invoice-status para que Cobranza y el expediente
  // cuenten exactamente la misma deuda.
  private isClientInvoicePending(invoice: Invoice): boolean {
    return isInvoicePending(invoice);
  }

  private isClientInvoicePaid(invoice: Invoice): boolean {
    return isInvoicePaid(invoice);
  }

  ngOnInit() {
    // Se escucha el parámetro (no solo la primera lectura) para que Anterior/Siguiente
    // cambie de cliente sin salir de la pantalla.
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.loadClient(Number(params.get('id')));
    });
  }

  private async loadClient(id: number) {
    this.loading.set(true);
    this.client.set(null);
    this.clientInvoices.set([]);
    this.editingProfile.set(false);
    this.editingService.set(false);
    this.invoiceModalOpen.set(false);
    this.showWifiPassword.set(false);
    this.pingResult.set('');
    this.applyGps({});
    this.navigation.set(id ? this.listState.navigationFor(id) : null);
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
      this.loadCrm(id);
    }
    this.loading.set(false);
  }

  private loadCrm(id: number) {
    this.crmState.set(null);
    this.crmEvents.set([]);
    this.crmEventsError.set(false);
    this.clientActions.states().subscribe({
      next: (rows) => {
        const row = rows.find((r) => r.idServicio === id);
        this.crmState.set(row
          ? { crmAction: row.crmAction, crmActionReason: row.crmActionReason, crmActionAt: row.crmActionAt, paymentPilotEnabled: row.paymentPilotEnabled }
          : { crmAction: null, crmActionReason: null, crmActionAt: null, paymentPilotEnabled: false });
      },
      error: () => this.crmState.set({ crmAction: null, crmActionReason: null, crmActionAt: null, paymentPilotEnabled: false }),
    });
    this.clientActions.events(id).subscribe({
      next: (events) => this.crmEvents.set((events as any[]).slice(0, 8)),
      error: () => this.crmEventsError.set(true),
    });
  }

  onCrmChanged() {
    const id = this.client()?.id_servicio;
    if (id) this.loadCrm(id);
  }

  crmEventLabel(action: string): string {
    if (action === 'moroso') return 'Aviso de pago activado';
    if (action === 'block') return 'Servicio cortado';
    if (action === 'unblock' || action === 'clear') return 'Reactivado';
    return action;
  }

  openPayment(invoice: Invoice | null) {
    if (!invoice) return;
    this.payingInvoice.set(invoice);
    this.showPayment.set(true);
  }

  async onPaymentSuccess() {
    this.showPayment.set(false);
    // Recarga facturas y cliente para que saldo, estado y cartera reflejen el cobro.
    const id = this.client()?.id_servicio;
    if (!id) return;
    const [c, allInv] = await Promise.all([this.db.getClient(id), this.db.getInvoices(true)]);
    if (c) this.client.set(c);
    this.clientInvoices.set(allInv.filter(i =>
      i.articulos?.some(a => a.servicio?.id_servicio === id) ||
      i.cliente?.nombre?.toLowerCase() === (c || this.client())?.nombre?.toLowerCase()
    ));
  }

  validPhone(phone: string): boolean {
    return !!internationalDrPhone(phone);
  }

  isInvoicePending(invoice: Invoice): boolean {
    return this.isClientInvoicePending(invoice);
  }

  goToClient(id: number | null) {
    if (id) this.router.navigate(['/clients', id]);
  }

  // ─── Resumen rápido ───
  /** Días hasta el próximo corte (negativo = vencido). */
  cutInfo = computed(() => {
    const raw = this.client()?.fecha_corte;
    const match = String(raw || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/) || String(raw || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return null;
    const date = match[1].length === 4
      ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      : new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    if (Number.isNaN(date.getTime())) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
    const label = date.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });
    let detail: string;
    if (days === 0) detail = 'Vence hoy';
    else if (days === 1) detail = 'Vence mañana';
    else if (days > 1) detail = `Vence en ${days} días`;
    else if (days === -1) detail = 'Venció ayer';
    else detail = `Venció hace ${Math.abs(days)} días`;
    return { label, days, detail };
  });

  hasPendingStatus = computed(() => (this.client()?.estado_facturas || '').toLowerCase().includes('pendiente'));

  whatsappUrl = computed(() => whatsappLink(this.client()?.telefono));
  callUrl = computed(() => telLink(this.client()?.telefono));
  phoneDisplay = computed(() => formatDrPhone(this.client()?.telefono));

  /** Mensaje de cobro ya escrito: el operador lo revisa y lo envía desde su WhatsApp. */
  paymentReminderUrl = computed(() => {
    const c = this.client();
    if (!c) return null;
    // "MABEL MANUEL" -> "Mabel": el mensaje suena natural aunque el nombre esté en mayúsculas.
    const rawFirst = (c.nombre || '').trim().split(/\s+/)[0] || '';
    const firstName = /\p{L}/u.test(rawFirst) ? rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase() : '';
    const amount = this.clientOpenBalance() || this.planPrice() || 0;
    const amountText = amount ? `RD$ ${amount.toLocaleString('es-DO', { maximumFractionDigits: 2 })}` : 'su mensualidad';
    const cut = this.cutInfo();
    const when = cut ? (cut.days >= 0 ? `vence el ${cut.label}` : `venció el ${cut.label}`) : 'está pendiente';
    const company = this.config.companyName() || 'su proveedor de internet';
    const message = `Hola${firstName ? ' ' + firstName : ''}, le saludamos de ${company}. Le recordamos que su pago de ${amountText} ${when}. Si ya pagó, por favor ignore este mensaje. ¡Gracias!`;
    return whatsappLink(c.telefono, message);
  });

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
      this.toast.error('Este navegador no permite obtener la ubicación');
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
              this.toast.success(`Ubicación guardada (precisión ±${Math.round(accuracy)}m)`);
            } else {
              this.toast.error(r?.error || 'No se pudo guardar la ubicación');
            }
          },
          error: (e) => {
            this.capturingGps.set(false);
            this.toast.error(e.error?.error || 'No se pudo guardar la ubicación. Intente de nuevo.');
          },
        });
      },
      (err) => {
        this.capturingGps.set(false);
        let msg = 'No se pudo obtener la ubicación';
        if (err.code === 1) msg = 'Permiso de ubicación denegado. Habilítelo en el navegador.';
        else if (err.code === 2) msg = 'GPS no disponible. Verifique que la ubicación del equipo esté activada.';
        else if (err.code === 3) msg = 'Se agotó el tiempo para obtener la ubicación';
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
        this.toast.error('No se pudo guardar: ' + (e.error?.detail || 'WispHub no respondió. Intente de nuevo.'));
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
        this.toast.error('No se pudo guardar: ' + (e.error?.detail || 'WispHub no respondió. Intente de nuevo.'));
      }
    });
  }

  // ─── ACTIONS ───
  activateClient() {
    const c = this.client();
    if (!c) return;
    if (!confirm(`¿Activar el servicio de internet de ${c.nombre}?\n\nSe enviará la orden de activación a WispHub.`)) return;
    this.changingStatus.set(true);
    this.api.activateClient(c.id_servicio).subscribe({
      next: () => { this.changingStatus.set(false); this.toast.success(`Servicio de ${c.nombre} activado. Sincronice la cartera para ver el nuevo estado.`); },
      error: (e) => { this.changingStatus.set(false); this.toast.error('No se pudo activar: ' + (e.error?.detail || 'no tiene permisos o WispHub no respondió')); }
    });
  }

  deactivateClient() {
    const c = this.client();
    if (!c) return;
    if (!confirm(`¿Suspender el servicio de internet de ${c.nombre}?\n\nEl cliente se quedará sin internet hasta que se active de nuevo.`)) return;
    this.changingStatus.set(true);
    this.api.deactivateClient(c.id_servicio).subscribe({
      next: () => { this.changingStatus.set(false); this.toast.success(`Servicio de ${c.nombre} suspendido. Sincronice la cartera para ver el nuevo estado.`); },
      error: (e) => { this.changingStatus.set(false); this.toast.error('No se pudo suspender: ' + (e.error?.detail || 'no tiene permisos o WispHub no respondió')); }
    });
  }

  pingClient() {
    const c = this.client();
    if (!c) return;
    this.pingResult.set('');
    this.pinging.set(true);
    this.api.pingClient(c.id_servicio).subscribe({
      next: (res) => { this.pinging.set(false); this.pingResult.set(JSON.stringify(res, null, 2)); this.pingSuccess.set(true); },
      error: (e) => { this.pinging.set(false); this.pingResult.set(e.error?.detail || 'El equipo del cliente no respondió. Verifique que esté encendido y conectado.'); this.pingSuccess.set(false); }
    });
  }

  gpsText(): string {
    const lat = this.gpsLat(), lng = this.gpsLng();
    return lat == null || lng == null ? '' : `${lat},${lng}`;
  }

  confirmUpdateGps() {
    if (!confirm('¿Reemplazar la ubicación guardada por su ubicación actual?\n\nHágalo solo si está en el sitio del cliente.')) return;
    this.captureGps();
  }

  copyValue(value: string | null | undefined, label: string) {
    if (!value) return this.toast.info(`${label} no disponible`);
    if (!navigator.clipboard) return this.toast.info('El navegador no permite copiar automáticamente');
    navigator.clipboard.writeText(value)
      .then(() => this.toast.success(`${label} copiado`))
      .catch(() => this.toast.info('No se pudo copiar automáticamente'));
  }

  readableDate(value: string | null | undefined): string {
    if (!value) return '—';
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!match) return String(value);
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0));
    if (Number.isNaN(date.getTime())) return String(value);
    const day = date.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });
    return match[4] ? `${day}, ${date.toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' })}` : day;
  }

  printReceipt(inv: Invoice) {
    this.receiptSvc.openPreview(inv);
  }

  getInitials(nombre: string): string {
    // Solo letras, igual que en la lista de clientes: "algeny 30" no debe producir "A3".
    const words = String(nombre || '').match(/\p{L}+/gu) || [];
    return ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase() || '#';
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
