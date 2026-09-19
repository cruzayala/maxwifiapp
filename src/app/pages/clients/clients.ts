import { Component, OnInit, OnDestroy, effect, inject, signal } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { NavbarComponent } from '../../components/layout/navbar';
import { LocalDbService } from '../../services/local-db.service';
import { SyncService } from '../../services/sync.service';
import { WispHubClient } from '../../models/client.model';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ExportService } from '../../services/export.service';
import { ClientBlockActionsComponent } from '../../components/client-block-actions/client-block-actions';
import { ClientActionsService } from '../../services/client-actions.service';
import { MetricsService } from '../../services/metrics.service';
import { SurveyService } from '../../services/survey.service';
import { ToastService } from '../../services/toast.service';
import { ClientMetric, tierStyle, consStyle, CreditTier } from '../../models/metrics.model';
import { DecimalPipe } from '@angular/common';
import { formatPlanName } from '../../pipes/plan-label.pipe';
import {
  LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideCircleDollarSign,
  LucideCircleDot, LucideCopy, LucideDownload, LucideEye, LucideGauge, LucideLayoutGrid,
  LucideMoreHorizontal, LucidePhone, LucidePlus, LucideRefreshCw, LucideSearch,
  LucideSlidersHorizontal, LucideTable2, LucideTriangleAlert, LucideUserCheck,
  LucideUserX, LucideUsers, LucideWalletCards, LucideWifi, LucideX,
} from '@lucide/angular';

type ClientViewMode = 'table' | 'cards' | 'circles' | 'speed' | 'billing' | 'amount';
type ClientQuickFilter = 'all' | 'active' | 'debt' | 'attention' | 'missing' | 'high_value';

interface ClientGroup {
  key: string;
  title: string;
  subtitle: string;
  clients: WispHubClient[];
  totalMonthly: number;
  activeCount: number;
  pendingCount: number;
}

@Component({
  selector: 'app-clients',
  standalone: true,
  imports: [
    NavbarComponent, RouterLink, FormsModule, ClientBlockActionsComponent, DecimalPipe,
    LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideCircleDollarSign,
    LucideCircleDot, LucideCopy, LucideDownload, LucideEye, LucideGauge, LucideLayoutGrid,
    LucideMoreHorizontal, LucidePhone, LucidePlus, LucideRefreshCw, LucideSearch,
    LucideSlidersHorizontal, LucideTable2, LucideTriangleAlert, LucideUserCheck,
    LucideUserX, LucideUsers, LucideWalletCards, LucideWifi, LucideX,
  ],
  template: `
    <app-navbar pageTitle="Clientes" />

    <div class="page">
      <section class="portfolio-head">
        <div><span>Cartera operativa</span><h2>Clientes y servicio</h2><p>Consulta comercial, red y cobros desde un solo lugar.</p></div>
        <div class="portfolio-status" [class.error]="loadError()"><i></i><span><b>{{ loadError() ? 'Datos no disponibles' : 'Cartera cargada' }}</b><small>{{ loadError() ? 'Revise la conexión con el servidor' : (loadedAt() ? 'Actualizada a las ' + (loadedAt()!.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })) : 'Cargando…') }}</small></span></div>
      </section>

      <section class="summary-grid" aria-label="Indicadores de clientes">
        <button class="summary-card total" type="button" (click)="setQuickFilter('all')" [class.active]="quickFilter === 'all'">
          <span class="kpi-icon"><svg lucideUsers size="19"></svg></span><span><small>Total clientes</small><strong>{{ allClients().length }}</strong><em>{{ filteredClients().length }} visibles</em></span>
        </button>
        <button class="summary-card success" type="button" (click)="setQuickFilter('active')" [class.active]="quickFilter === 'active'">
          <span class="kpi-icon"><svg lucideUserCheck size="19"></svg></span><span><small>Servicio activo</small><strong>{{ countStatus('activo') }}</strong><em>{{ activeRate() }}% de la cartera</em></span>
        </button>
        <button class="summary-card warning" type="button" (click)="setQuickFilter('debt')" [class.active]="quickFilter === 'debt'">
          <span class="kpi-icon"><svg lucideCircleDollarSign size="19"></svg></span><span><small>Facturas pendientes</small><strong>{{ countPendingInvoices() }}</strong><em>RD$ {{ pendingAmount() | number:'1.0-0' }} expuestos</em></span>
        </button>
        <button class="summary-card danger" type="button" (click)="setQuickFilter('attention')" [class.active]="quickFilter === 'attention'">
          <span class="kpi-icon"><svg lucideTriangleAlert size="19"></svg></span><span><small>Requieren atención</small><strong>{{ countAttentionClients() }}</strong><em>cobro, riesgo o suspensión</em></span>
        </button>
        <button class="summary-card info" type="button" (click)="setQuickFilter('missing')" [class.active]="quickFilter === 'missing'">
          <span class="kpi-icon"><svg lucideUserX size="19"></svg></span><span><small>Datos incompletos</small><strong>{{ countMissingData() }}</strong><em>{{ dataCompleteness() }}% completitud</em></span>
        </button>
        <button class="summary-card revenue" type="button" (click)="setQuickFilter('high_value')" [class.active]="quickFilter === 'high_value'" [title]="'Facturación estimada: RD$ ' + totalMonthlyRevenue()">
          <span class="kpi-icon"><svg lucideWalletCards size="19"></svg></span><span><small>Facturación mensual</small><strong>RD$ {{ totalMonthlyRevenue() / 1000 | number:'1.0-1' }} mil</strong><em>ver planes de RD$ 1,500+</em></span>
        </button>
      </section>

      <section class="insight-strip" aria-label="Calidad de datos">
        <div><svg lucideWifi size="16"></svg><span><b>{{ countWithOnu() }}</b> con ONU registrada</span></div>
        <div><svg lucidePhone size="16"></svg><span><b>{{ countWithoutPhone() }}</b> sin teléfono</span></div>
        <div><svg lucideUserX size="16"></svg><span><b>{{ countWithoutIp() }}</b> sin IP</span></div>
        <div><svg lucideGauge size="16"></svg><span>Plan principal: <b>{{ dominantPlan() }}</b></span></div>
      </section>

      <section class="toolbar">
        <div class="toolbar-primary">
          <label class="search-input"><svg lucideSearch size="18"></svg><input type="search" placeholder="Nombre, usuario, IP, teléfono, cédula, MAC o dirección" [(ngModel)]="searchTerm" (input)="filterClients()" /></label>
          <button class="filter-toggle" type="button" [class.active]="filtersExpanded || activeFilterCount() > 0" (click)="filtersExpanded = !filtersExpanded"><svg lucideSlidersHorizontal size="17"></svg>Filtros @if (activeFilterCount()) { <span>{{ activeFilterCount() }}</span> }</button>
          <div class="toolbar-actions">
            <a routerLink="/clients/new" class="btn btn-green"><svg lucidePlus size="16"></svg>Nuevo cliente</a>
            <button class="btn btn-outline" type="button" (click)="exportCSV()" title="Exportar resultados"><svg lucideDownload size="16"></svg>CSV</button>
            <button class="btn btn-primary" type="button" [disabled]="syncing()" (click)="syncClients()"><svg lucideRefreshCw size="16" [class.spinning]="syncing()"></svg>{{ syncing() ? 'Sincronizando' : 'Sincronizar' }}</button>
          </div>
        </div>
        @if (filtersExpanded) {
          <div class="advanced-filters">
            <label><span>Estado</span><select [(ngModel)]="statusFilter" (change)="filterClients()"><option value="">Todos</option><option value="activo">Activo</option><option value="suspendido">Suspendido</option><option value="cortado">Cortado</option><option value="gratis">Gratis</option><option value="retirado">Retirado</option></select></label>
            <label><span>Facturación</span><select [(ngModel)]="invoiceFilter" (change)="filterClients()"><option value="">Todas</option><option value="pending">Pendientes</option><option value="paid">Pagadas</option></select></label>
            <label><span>Zona</span><select [(ngModel)]="zoneFilter" (change)="filterClients()"><option value="">Todas</option>@for (zone of allZones(); track zone) { <option [value]="zone">{{ zone }}</option> }</select></label>
            <label><span>Plan</span><select [(ngModel)]="planFilter" (change)="filterClients()"><option value="">Todos</option>@for (plan of allPlans(); track plan) { <option [value]="plan">{{ plan }}</option> }</select></label>
            <label><span>Riesgo</span><select [(ngModel)]="tierFilter" (change)="filterClients()"><option value="">Todos</option><option value="EXCELENTE">Excelente</option><option value="BUENO">Bueno</option><option value="REGULAR">Regular</option><option value="RIESGO">Riesgo</option><option value="CRITICO">Crítico</option></select></label>
            <label><span>Consumo</span><select [(ngModel)]="consumptionFilter" (change)="filterClients()"><option value="">Todos</option><option value="INTENSIVO">Intensivo</option><option value="NORMAL">Normal</option><option value="BAJO">Bajo</option><option value="INACTIVO">Inactivo</option></select></label>
            <label><span>Calidad de datos</span><select [(ngModel)]="dataFilter" (change)="filterClients()"><option value="">Todos</option><option value="complete">Expediente completo</option><option value="missing_ip">Sin IP</option><option value="missing_phone">Sin teléfono</option><option value="missing_onu">Sin ONU o MAC</option><option value="missing_zone">Sin zona</option></select></label>
            <button class="clear-filter" type="button" (click)="clearFilters()"><svg lucideX size="15"></svg>Limpiar filtros</button>
          </div>
        }
        <footer class="result-bar"><span><b>{{ filteredClients().length }}</b> resultados de {{ allClients().length }}</span>@if (activeFilterCount()) { <button type="button" (click)="clearFilters()">Restablecer vista</button> }</footer>
      </section>

      @if (!loading() && allClients().length > 0) {
        <nav class="view-strip" aria-label="Vistas de clientes">
          <button type="button" (click)="setViewMode('table')" [class.active]="viewMode === 'table'"><svg lucideTable2 size="16"></svg><span>Lista</span></button>
          <button type="button" (click)="setViewMode('cards')" [class.active]="viewMode === 'cards'"><svg lucideLayoutGrid size="16"></svg><span>Tarjetas</span></button>
          <button type="button" (click)="setViewMode('circles')" [class.active]="viewMode === 'circles'"><svg lucideCircleDot size="16"></svg><span>Compacta</span></button>
          <button type="button" (click)="setViewMode('speed')" [class.active]="viewMode === 'speed'"><svg lucideGauge size="16"></svg><span>Por velocidad</span></button>
          <button type="button" (click)="setViewMode('billing')" [class.active]="viewMode === 'billing'"><svg lucideCalendarDays size="16"></svg><span>Por corte</span></button>
          <button type="button" (click)="setViewMode('amount')" [class.active]="viewMode === 'amount'"><svg lucideWalletCards size="16"></svg><span>Por ingreso</span></button>
        </nav>
      }

      @if (loading()) {
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Cargando clientes...</p>
        </div>
      } @else if (loadError()) {
        <div class="empty-state error-state">
          <svg lucideTriangleAlert size="42"></svg>
          <h3>No se pudo cargar la cartera</h3>
          <p>{{ loadError() }}</p>
          <button class="btn btn-primary" type="button" (click)="loadLocal(true)"><svg lucideRefreshCw size="16"></svg>Reintentar</button>
        </div>
      } @else if (filteredClients().length === 0 && allClients().length === 0) {
        <div class="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          <h3>Sin clientes</h3>
          <p>Presiona "Sincronizar" para traer la cartera desde WispHub.</p>
        </div>
      } @else {
        @if (viewMode === 'table') {
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th class="sortable col-client" (click)="sort('nombre')">Cliente {{ sortIcon('nombre') }}</th>
                <th class="sortable col-service" (click)="sort('plan_internet.nombre')">Plan y red {{ sortIcon('plan_internet.nombre') }}</th>
                <th class="sortable col-status" (click)="sort('estado')">Estado {{ sortIcon('estado') }}</th>
                <th class="sortable col-billing" (click)="sort('precio_plan')">Facturación {{ sortIcon('precio_plan') }}</th>
                <th class="sortable col-location" (click)="sort('zona.nombre')">Ubicación {{ sortIcon('zona.nombre') }}</th>
                <th class="sortable col-score" (click)="sort('creditScore')">Salud {{ sortIcon('creditScore') }}</th>
                <th class="col-actions"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (c of pagedClients(); track c.id_servicio) {
                <tr (click)="openClient(c.id_servicio)" class="clickable-row">
                  <td data-label="Cliente">
                    <div class="cell-client">
                      <div class="avatar-sm" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</div>
                      <div class="client-identity">
                        <span class="name">{{ c.nombre }}</span>
                        <span class="sub">#{{ c.id_servicio }} · {{ c.usuario || 'Sin usuario' }}</span>
                        @if (contactLine(c); as contact) { <span class="contact-line">{{ contact }}</span> }
                        @else { <span class="contact-line missing">Sin teléfono</span> }
                      </div>
                    </div>
                  </td>
                  <td data-label="Plan y red">
                    <div class="service-cell">
                      <span class="plan-name" [title]="c.plan_internet?.nombre || ''">{{ planLabel(c) }}</span>
                      <span class="network-line"><b class="mono" [class.missing]="!c.ip">{{ c.ip || 'Sin IP' }}</b>@if (c.mac_cpe || c.sn_onu) { <small class="mono">{{ c.mac_cpe || c.sn_onu }}</small> }</span>
                    </div>
                  </td>
                  <td data-label="Estado">
                    <span class="badge" [class]="'badge-' + getStatusClass(c.estado)">{{ c.estado || '-' }}</span>
                    @if (crmActionLabel(c.id_servicio); as lbl) { <span class="crm-state badge-{{ lbl.color }}">{{ lbl.text }}</span> }
                  </td>
                  <td data-label="Facturación">
                    <div class="billing-cell"><strong>RD$ {{ monthlyAmount(c) | number:'1.0-0' }}</strong><span class="badge" [class]="'badge-' + getFacturaClass(c.estado_facturas)">{{ invoiceShort(c) }}</span><small>{{ billingCycleLabel(c) }}</small></div>
                  </td>
                  <td data-label="Ubicación">
                    <div class="location-cell">
                      <span [class.missing]="!c.zona?.nombre">{{ c.zona?.nombre || 'Sin zona' }}</span>
                      @if (c.direccion || c.localidad) { <small [title]="c.direccion || c.localidad">{{ c.direccion || c.localidad }}</small> }
                    </div>
                  </td>
                  <td data-label="Salud" (click)="$event.stopPropagation()">
                    @if (getMetric(c.id_servicio); as m) {
                      <div class="score-cell">
                        @if (m.creditTier && tierStyle(m.creditTier); as ts) {
                          <span class="tier-pill" [style.background]="ts.bg" [style.color]="ts.color"
                                [title]="'Score: ' + (m.creditScore || '?') + '/100 — ' + ts.label">
                            {{ ts.emoji }} {{ m.creditScore }}
                          </span>
                        }
                        @if (m.consumptionTier && consStyle(m.consumptionTier); as cs) {
                          <span class="cons-pill" [style.background]="cs.bg" [style.color]="cs.color"
                                [title]="cs.label + ' — ' + ((m.consumptionMb30d || 0) / 1024 | number:'1.1-1') + ' GB en 30d'">
                            {{ cs.emoji }}
                          </span>
                        }
                      </div>
                    } @else {
                      <span class="empty-tier" title="Aún no hay suficiente historial de pagos y consumo">—</span>
                    }
                  </td>
                  <td data-label="Acciones" (click)="$event.stopPropagation()">
                    <details class="row-actions">
                      <summary title="Acciones del cliente" aria-label="Acciones para {{ c.nombre }}"><svg lucideMoreHorizontal size="18"></svg></summary>
                      <div class="row-menu">
                        <button type="button" (click)="openClient(c.id_servicio)"><svg lucideEye size="15"></svg><span><b>Ver expediente</b><small>Datos, facturas y equipos</small></span></button>
                        <button type="button" [disabled]="!c.ip" (click)="copyValue(c.ip, 'IP')"><svg lucideCopy size="15"></svg><span><b>Copiar IP</b><small>{{ c.ip || 'No disponible' }}</small></span></button>
                        <button type="button" [disabled]="!c.telefono" (click)="copyValue(c.telefono, 'Teléfono')"><svg lucidePhone size="15"></svg><span><b>Copiar teléfono</b><small>{{ c.telefono || 'No disponible' }}</small></span></button>
                        <div class="service-actions"><span>Control de servicio</span><app-client-block-actions [idServicio]="c.id_servicio" [clientName]="c.nombre" [crmAction]="crmActionFor(c.id_servicio)" [paymentPilotEnabled]="paymentPilotFor(c.id_servicio)" (changed)="onActionChanged($event, c.id_servicio)" /></div>
                      </div>
                    </details>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        } @else if (viewMode === 'cards') {
          <div class="cards-grid">
            @for (c of pagedClients(); track c.id_servicio) {
              <article class="client-card" (click)="openClient(c.id_servicio)">
                <div class="client-card-head">
                  <div class="avatar-card" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</div>
                  <div class="client-card-title">
                    <strong>{{ c.nombre }}</strong>
                    <span>{{ c.usuario || ('#' + c.id_servicio) }}</span>
                  </div>
                  <span class="badge" [class]="'badge-' + getStatusClass(c.estado)">{{ c.estado || '-' }}</span>
                </div>
                <div class="client-card-service">
                  <span>{{ planLabel(c) }}</span>
                  <strong>RD$ {{ monthlyAmount(c) | number:'1.0-0' }}</strong>
                </div>
                <div class="client-card-grid">
                  <div><span>IP</span><strong class="mono">{{ c.ip || '-' }}</strong></div>
                  <div><span>Zona</span><strong>{{ c.zona?.nombre || '-' }}</strong></div>
                  <div><span>Factura</span><strong>{{ invoiceShort(c) }}</strong></div>
                  <div><span>Corte</span><strong>{{ billingCycleLabel(c) }}</strong></div>
                  <div><span>Teléfono</span><strong>{{ c.telefono || '-' }}</strong></div>
                  <div><span>ONU</span><strong class="mono">{{ c.sn_onu || '-' }}</strong></div>
                </div>
                <p>{{ c.direccion || 'Sin dirección registrada' }}</p>
                <footer>Ver expediente <svg lucideEye size="14"></svg></footer>
              </article>
            }
          </div>
        } @else if (viewMode === 'circles') {
          <div class="circle-grid">
            @for (c of pagedClients(); track c.id_servicio) {
              <button class="circle-client" type="button" (click)="openClient(c.id_servicio)">
                <span class="circle-avatar" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</span>
                <strong>{{ c.nombre }}</strong>
                <span>{{ planLabel(c) }}</span>
                <small>{{ c.zona?.nombre || 'Sin zona' }} · {{ billingCycleLabel(c) }}</small>
              </button>
            }
          </div>
        } @else if (viewMode === 'speed') {
          <div class="group-layout">
            @for (group of speedGroups(); track group.key) {
              <section class="group-panel">
                <div class="group-head">
                  <div>
                    <h3>{{ group.title }}</h3>
                    <p>{{ group.subtitle }}</p>
                  </div>
                  <strong>{{ group.clients.length }}</strong>
                </div>
                <div class="group-metrics">
                  <span>{{ group.activeCount }} activos</span>
                  <span>{{ group.pendingCount }} pendientes</span>
                  <span>RD$ {{ group.totalMonthly | number:'1.0-0' }}</span>
                </div>
                <div class="group-list">
                  @for (c of previewClients(group.clients); track c.id_servicio) {
                    <button type="button" class="group-row" (click)="openClient(c.id_servicio)">
                      <span class="mini-avatar" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</span>
                      <span class="group-client-name">{{ c.nombre }}</span>
                      <small>{{ c.plan_internet?.nombre || c.servicio || '-' }}</small>
                    </button>
                  }
                  @if (group.clients.length > 8) {
                    <div class="more-row">+{{ group.clients.length - 8 }} clientes más</div>
                  }
                </div>
              </section>
            }
          </div>
        } @else if (viewMode === 'billing') {
          <div class="group-layout billing-layout">
            @for (group of billingGroups(); track group.key) {
              <section class="group-panel">
                <div class="group-head">
                  <div>
                    <h3>{{ group.title }}</h3>
                    <p>{{ group.subtitle }}</p>
                  </div>
                  <strong>{{ group.clients.length }}</strong>
                </div>
                <div class="billing-bars">
                  <span [style.width.%]="groupShare(group.clients.length)"></span>
                </div>
                <div class="group-metrics">
                  <span>{{ group.activeCount }} activos</span>
                  <span>{{ group.pendingCount }} pendientes</span>
                  <span>RD$ {{ group.totalMonthly | number:'1.0-0' }}</span>
                </div>
                <div class="group-list">
                  @for (c of previewClients(group.clients); track c.id_servicio) {
                    <button type="button" class="group-row" (click)="openClient(c.id_servicio)">
                      <span class="mini-avatar" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</span>
                      <span class="group-client-name">{{ c.nombre }}</span>
                      <small>{{ c.fecha_corte || 'Sin corte' }}</small>
                    </button>
                  }
                  @if (group.clients.length > 8) {
                    <div class="more-row">+{{ group.clients.length - 8 }} clientes más</div>
                  }
                </div>
              </section>
            }
          </div>
        } @else {
          <div class="group-layout amount-layout">
            @for (group of amountGroups(); track group.key) {
              <section class="group-panel">
                <div class="group-head">
                  <div>
                    <h3>{{ group.title }}</h3>
                    <p>{{ group.subtitle }}</p>
                  </div>
                  <strong>{{ group.clients.length }}</strong>
                </div>
                <div class="group-metrics">
                  <span>{{ group.activeCount }} activos</span>
                  <span>{{ group.pendingCount }} pendientes</span>
                  <span>RD$ {{ group.totalMonthly | number:'1.0-0' }}</span>
                </div>
                <div class="amount-stack">
                  @for (c of previewClients(group.clients); track c.id_servicio) {
                    <button type="button" class="amount-row" (click)="openClient(c.id_servicio)">
                      <span>
                        <strong>{{ c.nombre }}</strong>
                        <small>{{ planLabel(c) }} · {{ c.zona?.nombre || 'Sin zona' }}</small>
                      </span>
                      <em>RD$ {{ monthlyAmount(c) | number:'1.0-0' }}</em>
                    </button>
                  }
                  @if (group.clients.length > 8) {
                    <div class="more-row">+{{ group.clients.length - 8 }} clientes más</div>
                  }
                </div>
              </section>
            }
          </div>
        }
      }

      @if (!loading() && isPagedView() && filteredClients().length > pageSize) {
        <nav class="pagination" aria-label="Paginación de clientes">
          <span>Mostrando <b>{{ firstVisible() }}–{{ lastVisible() }}</b> de {{ filteredClients().length }}</span>
          <div><label>Filas <select [(ngModel)]="pageSize" (change)="page = 1"><option [ngValue]="25">25</option><option [ngValue]="50">50</option><option [ngValue]="100">100</option></select></label><button type="button" [disabled]="page === 1" (click)="changePage(page - 1)" aria-label="Página anterior"><svg lucideChevronLeft size="17"></svg></button><strong>Página {{ page }} de {{ pageCount() }}</strong><button type="button" [disabled]="page === pageCount()" (click)="changePage(page + 1)" aria-label="Página siguiente"><svg lucideChevronRight size="17"></svg></button></div>
        </nav>
      }

      <div class="sync-bar" [class.visible]="syncing()">
        <div class="spinner small"></div>
        <span>{{ syncMessage() }}</span>
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 18px 20px 28px; color: #263442; }
    .portfolio-head { min-height: 64px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 18px; }
    .portfolio-head > div:first-child > span { color: #1267dd; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .portfolio-head h2 { margin: 4px 0 0; color: #172535; font-size: 20px; }
    .portfolio-head p { margin: 4px 0 0; color: #73808d; font-size: 13px; }
    .portfolio-status { display: flex; align-items: center; gap: 9px; padding-left: 16px; border-left: 1px solid #dfe5ea; }
    .portfolio-status > i { width: 9px; height: 9px; border-radius: 50%; background: #17a66a; box-shadow: 0 0 0 4px #e4f6ee; }
    .portfolio-status b, .portfolio-status small { display: block; }.portfolio-status b { font-size: 13px; }.portfolio-status small { margin-top: 3px; color: #7c8995; font-size: 11px; }.portfolio-status.error > i { background: #b42318; box-shadow: 0 0 0 4px #fff0ef; }

    .summary-grid { display: grid; grid-template-columns: repeat(6, minmax(145px, 1fr)); gap: 9px; margin-bottom: 10px; }
    .summary-card { min-width: 0; min-height: 94px; padding: 12px; border: 1px solid #dfe5ea; border-radius: 6px; display: grid; grid-template-columns: 36px minmax(0, 1fr); align-items: start; gap: 10px; text-align: left; background: #fff; cursor: pointer; transition: border-color .15s, box-shadow .15s, transform .15s; }
    .summary-card:hover { border-color: #aebdca; transform: translateY(-1px); box-shadow: 0 7px 18px rgba(21, 34, 47, .07); }
    .summary-card.active { border-color: #1267dd; box-shadow: inset 0 -2px #1267dd, 0 6px 16px rgba(18, 103, 221, .08); }
    .kpi-icon { width: 36px; height: 36px; border-radius: 5px; display: grid; place-items: center; background: #edf4ff; color: #1267dd; }
    .summary-card.success .kpi-icon { background: #e9f8f1; color: #13875a; }.summary-card.warning .kpi-icon { background: #fff6e8; color: #b36b12; }.summary-card.danger .kpi-icon { background: #fff0ef; color: #b42318; }.summary-card.info .kpi-icon { background: #eef3f7; color: #526b80; }.summary-card.revenue .kpi-icon { background: #f1f0ff; color: #6659c7; }
    .summary-card small, .summary-card strong, .summary-card em { display: block; min-width: 0; }
    .summary-card small { color: #667582; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .summary-card strong { margin-top: 6px; color: #172535; font-size: 21px; line-height: 1; overflow-wrap: anywhere; }
    .summary-card em { margin-top: 7px; color: #81909c; font-size: 11px; line-height: 1.3; font-style: normal; white-space: normal; }

    .insight-strip { min-height: 43px; margin-bottom: 10px; padding: 0 13px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: center; border: 1px solid #dfe5ea; border-radius: 6px; background: #f8fafb; }
    .insight-strip > div { min-height: 24px; padding: 0 13px; display: flex; align-items: center; gap: 7px; border-right: 1px solid #dfe5ea; color: #697784; font-size: 12px; }
    .insight-strip > div:first-child { padding-left: 0; }.insight-strip > div:last-child { padding-right: 0; border-right: 0; }.insight-strip svg { color: #1267dd; flex: 0 0 auto; }.insight-strip b { color: #344250; }

    .toolbar { margin-bottom: 10px; border: 1px solid #dce3e8; border-radius: 6px; background: #fff; }
    .toolbar-primary { min-height: 62px; padding: 10px; display: grid; grid-template-columns: minmax(300px, 1fr) auto auto; align-items: center; gap: 8px; }
    .search-input { height: 40px; min-width: 0; padding: 0 12px; display: flex; align-items: center; gap: 8px; border: 1px solid #ccd6de; border-radius: 5px; color: #81909c; background: #fff; }
    .search-input:focus-within { border-color: #1267dd; box-shadow: 0 0 0 3px rgba(18, 103, 221, .08); }
    .search-input input { width: 100%; border: 0; outline: 0; background: transparent; color: #263442; font-size: 13px; }
    .filter-toggle { height: 40px; padding: 0 12px; border: 1px solid #ccd6de; border-radius: 5px; display: inline-flex; align-items: center; gap: 7px; background: #fff; color: #4f5e6c; font-size: 12px; font-weight: 750; }
    .filter-toggle.active { border-color: #a7c5e5; background: #f1f7ff; color: #1267dd; }.filter-toggle span { min-width: 18px; height: 18px; display: grid; place-items: center; border-radius: 9px; background: #1267dd; color: #fff; font-size: 11px; }
    .toolbar-actions { display: flex; align-items: center; gap: 6px; }
    .btn { height: 40px; padding: 0 12px; border: 1px solid transparent; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; font-weight: 750; cursor: pointer; transition: background .15s, border-color .15s; white-space: nowrap; }
    .btn:disabled { opacity: .55; cursor: wait; }.btn-outline { border-color: #ccd6de; background: #fff; color: #4e5e6c; }.btn-outline:hover { background: #f4f7f9; }.btn-primary { background: #1267dd; color: #fff; }.btn-primary:hover { background: #0d58c0; }.btn-green { background: #13875a; color: #fff; text-decoration: none; }.btn-green:hover { background: #0f704b; }
    .advanced-filters { padding: 12px 10px; display: grid; grid-template-columns: repeat(7, minmax(120px, 1fr)) auto; align-items: end; gap: 8px; border-top: 1px solid #e2e7eb; background: #f8fafb; }
    .advanced-filters label > span { display: block; margin-bottom: 5px; color: #687784; font-size: 11px; font-weight: 750; }
    .advanced-filters select { width: 100%; height: 36px; padding: 0 8px; border: 1px solid #ccd6de; border-radius: 4px; outline: 0; background: #fff; color: #354351; font-size: 12px; }
    .clear-filter { height: 36px; padding: 0 10px; border: 1px solid #d3dbe2; border-radius: 4px; display: inline-flex; align-items: center; gap: 5px; background: #fff; color: #596875; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .result-bar { min-height: 34px; padding: 0 11px; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #edf0f2; color: #778591; font-size: 12px; }.result-bar b { color: #344250; }.result-bar button { border: 0; background: transparent; color: #1267dd; font-size: 12px; font-weight: 750; }

    .view-strip { min-height: 47px; margin: 0 0 10px; padding: 5px; display: grid; grid-template-columns: repeat(6, minmax(105px, 1fr)); gap: 3px; border: 1px solid #dfe5ea; border-radius: 6px; background: #f5f7f9; }
    .view-strip button { min-width: 0; border: 1px solid transparent; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: transparent; color: #5c6a77; font-size: 12px; font-weight: 750; }
    .view-strip button:hover { background: #fff; }.view-strip button.active { border-color: #ccd7e0; background: #fff; color: #1267dd; box-shadow: 0 1px 4px rgba(20, 33, 45, .07); }

    .table-container {
      background: white; border-radius: 6px;
      border: 1px solid #dce3e8; overflow-x: auto; box-shadow: 0 8px 22px rgba(20, 33, 45, .04);
    }

    .data-table { width: 100%; border-collapse: collapse; min-width: 960px; table-layout: fixed; }

    .data-table th {
      text-align: left; font-size: 11px; font-weight: 800; color: #687784;
      text-transform: uppercase;
      padding: 11px 12px; background: #f7f9fa; border-bottom: 1px solid #dce3e8;
      position: sticky; top: 0; z-index: 1;
    }
    .col-client { width: 235px; }.col-service { width: 170px; }.col-status { width: 105px; }.col-billing { width: 130px; }.col-location { width: 160px; }.col-score { width: 110px; }.col-actions { width: 50px; }
    .sortable { cursor: pointer; user-select: none; }
    .sortable:hover { color: #1267dd; }

    .data-table td {
      padding: 11px 12px; font-size: 13px; color: #334250; vertical-align: middle;
      border-bottom: 1px solid #edf0f2;
    }

    .clickable-row { cursor: pointer; transition: background 0.15s; }
    .clickable-row:hover td { background: #f4f8fd; }

    .cell-client { display: flex; align-items: center; gap: 10px; }

    .avatar-sm {
      width: 36px; height: 36px; border-radius: 5px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 13px; color: white; flex-shrink: 0;
    }
    .avatar-sm.active { background: #13875a; }.avatar-sm.suspended { background: #b42318; }.avatar-sm.free { background: #1267dd; }.avatar-sm.default { background: #72808d; }

    .client-identity { min-width: 0; }.name { display: block; font-weight: 750; color: #172535; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { display: block; font-size: 11px; color: #85929d; margin-top: 3px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .contact-line { display: block; margin-top: 3px; color: #657482; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 12px; letter-spacing: -.01em; }
    .missing { color: #a0aab4 !important; font-weight: 500 !important; font-style: italic; }
    .ip { color: #6366f1; font-weight: 500; }
    .price { font-weight: 700; color: #0f172a; }
    .date { font-size: 12px; color: #64748b; }

    .plan-name { display: block; font-size: 12px; font-weight: 750; color: #263442; line-height: 1.25; }
    .service-cell, .location-cell { min-width: 0; }
    .network-line { margin-top: 4px; display: block; }.network-line b, .network-line small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.network-line b { color: #1267dd; font-size: 11px; }.network-line small { margin-top: 3px; color: #87939e; font-size: 11px; }
    .location-cell span { display: block; font-weight: 700; color: #334250; }
    .location-cell small {
      display: block; margin-top: 3px; color: #87939e; font-size: 11px; line-height: 1.35;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    .billing-cell strong, .billing-cell small { display: block; }.billing-cell strong { margin-bottom: 5px; color: #263442; font-size: 12px; }.billing-cell small { margin-top: 5px; color: #7f8c97; font-size: 11px; }

    .badge {
      display: inline-block; padding: 3px 7px;
      border-radius: 10px; font-size: 11px; font-weight: 750; white-space: nowrap;
    }
    .badge-active { background: #dcfce7; color: #16a34a; }
    .badge-suspended { background: #fee2e2; color: #dc2626; }
    .badge-free { background: #dbeafe; color: #2563eb; }
    .badge-default { background: #f1f5f9; color: #64748b; }
    .badge-paid { background: #dcfce7; color: #16a34a; }
    .badge-pending { background: #fef3c7; color: #d97706; }
    .crm-state { display: block; width: max-content; margin-top: 5px; padding: 3px 6px; border-radius: 3px; font-size: 11px; font-weight: 800; }.crm-state.badge-warn { border: 0; }.crm-state.badge-danger { border: 0; }

    .loading-state, .empty-state {
      display: flex; flex-direction: column;
      align-items: center; padding: 80px 40px; gap: 12px; color: #94a3b8;
    }
    .empty-state h3 { color: #475569; margin: 8px 0 0; }
    .empty-state p { margin: 0; text-align: center; }.error-state svg { color: #b42318; }

    .spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #1267dd; border-radius: 50%; animation: spin 0.8s linear infinite; }
    .spinner.small { width: 18px; height: 18px; border-width: 2px; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .sync-bar {
      position: fixed; bottom: -60px; left: 260px; right: 0;
      height: 48px; background: #0f172a; color: white;
      display: flex; align-items: center; justify-content: center;
      gap: 12px; font-size: 14px; transition: bottom 0.3s; z-index: 50;
    }
    .sync-bar.visible { bottom: 0; }

    .badge-warn { background: #fff7ed; color: #c2410c; border: 1px solid #fdba74; padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 4px; display: inline-block; }
    .badge-danger { background: #fef2f2; color: #b91c1c; border: 1px solid #fca5a5; padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 4px; display: inline-block; }

    .score-cell { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }.tier-pill { display: inline-flex; align-items: center; gap: 3px; padding: 3px 7px; border-radius: 10px; font-size: 11px; font-weight: 750; white-space: nowrap; cursor: help; }.cons-pill { display: inline-flex; align-items: center; padding: 3px 5px; border-radius: 10px; font-size: 11px; cursor: help; }.empty-tier { color: #9aa6b0; font-size: 11px; }

    .row-actions { position: relative; }.row-actions > summary { width: 32px; height: 32px; margin-left: auto; border: 1px solid #d8e0e6; border-radius: 4px; display: grid; place-items: center; color: #586775; background: #fff; cursor: pointer; list-style: none; }.row-actions > summary::-webkit-details-marker { display: none; }.row-actions[open] > summary { border-color: #1267dd; color: #1267dd; background: #f2f7ff; }
    .row-menu { width: 230px; margin: 7px 0 2px -180px; padding: 5px; display: grid; gap: 2px; border: 1px solid #d5dde4; border-radius: 5px; background: #fff; box-shadow: 0 8px 20px rgba(20, 33, 45, .08); }
    .row-menu > button { min-height: 42px; padding: 6px 8px; border: 0; border-radius: 4px; display: grid; grid-template-columns: 22px 1fr; align-items: center; gap: 7px; text-align: left; background: transparent; color: #455461; }.row-menu > button:hover:not(:disabled) { background: #f2f7fd; color: #1267dd; }.row-menu > button:disabled { opacity: .45; }.row-menu b, .row-menu small { display: block; }.row-menu b { font-size: 11px; }.row-menu small { margin-top: 3px; color: #84919c; font-size: 11px; }
    .service-actions { padding: 8px; border-top: 1px solid #e5e9ed; }.service-actions > span { display: block; margin-bottom: 7px; color: #7b8894; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }

    .pagination { min-height: 52px; margin-top: 10px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; border: 1px solid #dce3e8; border-radius: 6px; background: #fff; color: #75838f; font-size: 11px; }.pagination > span b { color: #344250; }.pagination > div { display: flex; align-items: center; gap: 8px; }.pagination label { display: flex; align-items: center; gap: 6px; }.pagination select { height: 32px; border: 1px solid #d5dde4; border-radius: 4px; background: #fff; color: #43515e; font-size: 11px; }.pagination button { width: 32px; height: 32px; border: 1px solid #d5dde4; border-radius: 4px; display: grid; place-items: center; background: #fff; color: #475664; }.pagination button:disabled { opacity: .35; }.pagination strong { min-width: 92px; text-align: center; color: #43515e; font-size: 11px; }

    .btn-survey {
      display: inline-flex; align-items: center; gap: 4px;
      background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe;
      border-radius: 8px; padding: 5px 10px; font-size: 13px; font-weight: 600;
      cursor: pointer; margin-top: 4px; transition: all 0.15s;
    }
    .btn-survey:hover:not(:disabled) { background: #dbeafe; border-color: #3b82f6; }
    .btn-survey:disabled { opacity: 0.5; cursor: wait; }
    .btn-clear-survey {
      display: inline-flex; align-items: center; gap: 4px;
      background: #f8fafc; color: #475569; border: 1px solid #cbd5e1;
      border-radius: 8px; padding: 5px 10px; font-size: 13px; font-weight: 600;
      cursor: pointer; margin-top: 4px; margin-left: 4px; transition: all 0.15s;
    }
    .btn-clear-survey:hover:not(:disabled) { background: #f1f5f9; border-color: #94a3b8; color: #0f172a; }
    .btn-clear-survey:disabled { opacity: 0.5; cursor: wait; }

    .cards-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }
    .client-card {
      background: white; border: 1px solid #dfe5ea; border-radius: 6px; padding: 14px;
      cursor: pointer; box-shadow: 0 10px 26px rgba(15, 23, 42, 0.04);
      transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
    }
    .client-card:hover { transform: translateY(-1px); border-color: #a7c5e5; box-shadow: 0 12px 26px rgba(20, 33, 45, 0.07); }
    .client-card-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .avatar-card {
      width: 44px; height: 44px; border-radius: 5px; display: flex; align-items: center; justify-content: center;
      color: white; font-size: 14px; font-weight: 800; flex: 0 0 auto;
    }
    .avatar-card.active, .circle-avatar.active, .mini-avatar.active { background: #13875a; }
    .avatar-card.suspended, .circle-avatar.suspended, .mini-avatar.suspended { background: #b42318; }
    .avatar-card.free, .circle-avatar.free, .mini-avatar.free { background: #1267dd; }
    .avatar-card.default, .circle-avatar.default, .mini-avatar.default { background: #72808d; }
    .client-card-title { min-width: 0; flex: 1; }
    .client-card-title strong {
      display: block; color: #0f172a; font-size: 14px; line-height: 1.25;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .client-card-title span { display: block; margin-top: 2px; color: #94a3b8; font-size: 12px; }
    .client-card-service {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      margin: 14px 0 12px; padding: 10px 12px; border-radius: 5px; background: #f8fafb;
    }
    .client-card-service span { color: #334155; font-weight: 700; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .client-card-service strong { color: #0f172a; font-size: 14px; white-space: nowrap; }
    .client-card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .client-card-grid div { min-width: 0; border: 1px solid #e7ecef; border-radius: 5px; padding: 8px; }
    .client-card-grid span { display: block; color: #94a3b8; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
    .client-card-grid strong { display: block; margin-top: 3px; color: #334155; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .client-card p { margin: 12px 0 0; color: #64748b; font-size: 12px; line-height: 1.4; min-height: 34px; }
    .client-card footer { min-height: 34px; margin-top: 10px; padding-top: 9px; border-top: 1px solid #e7ecef; display: flex; align-items: center; justify-content: flex-end; gap: 6px; color: #1267dd; font-size: 12px; font-weight: 750; }

    .circle-grid {
      display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px; align-items: stretch;
    }
    .circle-client {
      min-width: 0; min-height: 186px; border: 1px solid #dfe5ea; border-radius: 6px;
      background: white; cursor: pointer; padding: 14px 10px;
      display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
      transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
    }
    .circle-client:hover { transform: translateY(-1px); border-color: #a7c5e5; box-shadow: 0 12px 26px rgba(20, 33, 45, 0.07); }
    .circle-avatar {
      width: 76px; height: 76px; border-radius: 999px; display: flex; align-items: center; justify-content: center;
      color: white; font-size: 22px; font-weight: 900; margin-bottom: 10px; box-shadow: inset 0 -8px 16px rgba(15, 23, 42, 0.12);
    }
    .circle-client strong {
      width: 100%; color: #0f172a; font-size: 13px; line-height: 1.25;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .circle-client span:not(.circle-avatar) { margin-top: 5px; color: #475569; font-size: 12px; font-weight: 700; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .circle-client small { margin-top: 4px; color: #94a3b8; font-size: 13px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .group-layout {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 12px; align-items: start;
    }
    .group-panel {
      background: white; border: 1px solid #dfe5ea; border-radius: 6px; padding: 14px;
      box-shadow: 0 10px 26px rgba(15, 23, 42, 0.04);
    }
    .group-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .group-head h3 { margin: 0; color: #0f172a; font-size: 16px; line-height: 1.2; }
    .group-head p { margin: 4px 0 0; color: #64748b; font-size: 12px; line-height: 1.35; }
    .group-head strong { color: #4338ca; font-size: 28px; line-height: 1; }
    .group-metrics { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
    .group-metrics span {
      display: inline-flex; padding: 5px 8px; border-radius: 999px; background: #f8fafc;
      color: #475569; border: 1px solid #e2e8f0; font-size: 13px; font-weight: 800;
    }
    .group-list, .amount-stack { display: grid; gap: 6px; }
    .group-row, .amount-row {
      width: 100%; min-width: 0; border: 1px solid #e7ecef; border-radius: 5px; background: #fff;
      color: inherit; cursor: pointer; transition: background 0.15s, border-color 0.15s;
    }
    .group-row {
      display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 8px; align-items: center;
      padding: 8px; text-align: left;
    }
    .group-row:hover, .amount-row:hover { background: #f8fafc; border-color: #c7d2fe; }
    .mini-avatar { width: 30px; height: 30px; border-radius: 4px; color: white; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 900; }
    .group-client-name { color: #0f172a; font-size: 12px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .group-row small { color: #64748b; font-size: 13px; white-space: nowrap; }
    .more-row { color: #64748b; font-size: 12px; font-weight: 700; text-align: center; padding: 7px; }
    .billing-bars { height: 8px; background: #eef2ff; border-radius: 999px; overflow: hidden; margin-top: 12px; }
    .billing-bars span { display: block; height: 100%; min-width: 8%; border-radius: inherit; background: linear-gradient(90deg, #6366f1, #22c55e); }
    .amount-row {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 9px 10px; text-align: left;
    }
    .amount-row span { min-width: 0; }
    .amount-row strong { display: block; color: #0f172a; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .amount-row small { display: block; margin-top: 2px; color: #64748b; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .amount-row em { color: #0f172a; font-size: 12px; font-weight: 900; font-style: normal; white-space: nowrap; }

    button:focus-visible, a:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #1267dd; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; } }

    @media (max-width: 1500px) {
      .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }

    @media (max-width: 1200px) {
      .toolbar-primary { grid-template-columns: minmax(280px, 1fr) auto; }
      .toolbar-actions { grid-column: 1 / -1; justify-content: flex-start; }
      .advanced-filters { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .clear-filter { width: 100%; justify-content: center; }
      .view-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .circle-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }

    @media (max-width: 760px) {
      .page { padding: 12px; }
      .portfolio-head { align-items: flex-start; flex-direction: column; gap: 10px; }
      .portfolio-status { padding-left: 0; border-left: 0; }
      .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .summary-card { min-height: 98px; padding: 10px; grid-template-columns: 32px minmax(0, 1fr); gap: 8px; }
      .kpi-icon { width: 32px; height: 32px; }
      .insight-strip { padding: 7px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .insight-strip > div { padding: 7px; border-right: 0; border-bottom: 1px solid #dfe5ea; }
      .insight-strip > div:nth-last-child(-n+2) { border-bottom: 0; }
      .toolbar-primary { grid-template-columns: 1fr; }
      .search-input, .filter-toggle, .toolbar-actions { width: 100%; }
      .toolbar-actions { grid-column: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .toolbar-actions .btn-green { grid-column: 1 / -1; }
      .advanced-filters { grid-template-columns: 1fr; }
      .btn { width: 100%; justify-content: center; padding-inline: 10px; }
      .data-table { min-width: 980px; }
      .view-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .view-strip button { justify-content: flex-start; padding: 0 10px; }
      .cards-grid, .group-layout { grid-template-columns: 1fr; }
      .circle-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .circle-client { min-height: 168px; }
      .group-row { grid-template-columns: 30px minmax(0, 1fr); }
      .group-row small { grid-column: 2; }
      .pagination { align-items: flex-start; flex-direction: column; gap: 8px; }
      .pagination > div { width: 100%; justify-content: space-between; }
      .sync-bar { left: 0; }
    }
  `]
})
export class ClientsComponent implements OnInit, OnDestroy {
  private db = inject(LocalDbService);
  private syncService = inject(SyncService);
  private exportSvc = inject(ExportService);
  private actions = inject(ClientActionsService);
  private survey = inject(SurveyService);
  private toast = inject(ToastService);
  private router = inject(Router);
  metrics = inject(MetricsService);

  surveyLoading = signal<number | null>(null);

  private destroy$ = new Subject<void>();

  // Re-export para usar en el template
  tierStyle = tierStyle;
  consStyle = consStyle;

  allClients = signal<WispHubClient[]>([]);
  filteredClients = signal<WispHubClient[]>([]);
  allPlans = signal<string[]>([]);
  allZones = signal<string[]>([]);
  loading = signal(true);
  loadError = signal('');
  loadedAt = signal<Date | null>(null);
  syncing = signal(false);
  syncMessage = signal('');
  private metricsFilterEffect = effect(() => {
    this.metrics.metricsByClient();
    if (!this.loading()) queueMicrotask(() => this.filterClients());
  });
  crmActions = signal<Map<number, string>>(new Map());
  paymentPilots = signal<Set<number>>(new Set());
  searchTerm = '';
  quickFilter: ClientQuickFilter = 'all';
  viewMode: ClientViewMode = 'table';
  filtersExpanded = false;
  statusFilter = '';
  invoiceFilter = '';
  zoneFilter = '';
  planFilter = '';
  tierFilter = '';
  dataFilter = '';
  consumptionFilter = '';
  page = 1;
  pageSize = 50;
  sortCol = 'nombre';
  sortDir: 'asc' | 'desc' = 'asc';

  async ngOnInit() {
    await this.loadLocal();
    this.loadCrmStates();
    this.metrics.startAutoRefresh(30000);
  }

  ngOnDestroy() {
    this.metrics.stopAutoRefresh();
    this.destroy$.next();
    this.destroy$.complete();
  }

  getMetric(idServicio: number): ClientMetric | null {
    return this.metrics.get(idServicio);
  }

  loadCrmStates() {
    this.actions.states().pipe(takeUntil(this.destroy$)).subscribe({
      next: (rows) => {
        const map = new Map<number, string>();
        const pilots = new Set<number>();
        for (const r of rows) if (r.crmAction) map.set(r.idServicio, r.crmAction);
        for (const r of rows) if (r.paymentPilotEnabled) pilots.add(r.idServicio);
        this.crmActions.set(map);
        this.paymentPilots.set(pilots);
        this.filterClients();
      },
      error: () => {},
    });
  }

  crmActionFor(id: number): string | null {
    return this.crmActions().get(id) ?? null;
  }

  paymentPilotFor(id: number): boolean {
    return this.paymentPilots().has(id);
  }

  crmActionLabel(id: number): { text: string; color: string } | null {
    const a = this.crmActionFor(id);
    if (a === 'block') return { text: 'BLOQUEADO', color: 'danger' };
    if (a === 'moroso') return { text: 'MOROSO', color: 'warn' };
    return null;
  }

  onActionChanged(ev: { action: string; result: any }, id: number) {
    const map = new Map(this.crmActions());
    if (ev.action === 'clear') map.delete(id);
    else map.set(id, ev.action);
    this.crmActions.set(map);
    this.filterClients();
  }

  enviarEncuesta(c: WispHubClient) {
    const ip = c.ip;
    if (!ip) {
      this.toast.error('Cliente sin IP asignada');
      return;
    }
    const confirmMsg = `Crear encuesta para ${c.nombre} (${ip})?\n\nSe creara un enlace seguro en la nube y recordatorios. No se tocara MikroTik ni se afectara el internet del cliente.`;
    if (!confirm(confirmMsg)) return;
    this.surveyLoading.set(c.id_servicio);
    this.survey.start(ip, c.id_servicio).subscribe({
      next: (r) => {
        this.surveyLoading.set(null);
        if (r.alreadySubmitted) {
          this.toast.info('Este cliente ya llenó la encuesta. No se enviará de nuevo.');
        } else if (r.alreadyPending) {
          this.copySurveyLink(r.publicUrl);
          this.toast.info('Ya hay encuesta pendiente. Enlace copiado y recordatorio reactivado.');
        } else if (r.ok) {
          this.copySurveyLink(r.publicUrl);
          this.toast.success(`Encuesta creada para ${c.nombre}. Enlace copiado y recordatorios activos, sin tocar internet.`);
        } else {
          this.toast.error(r.error || 'No se pudo activar la encuesta');
        }
      },
      error: (e) => {
        this.surveyLoading.set(null);
        this.toast.error(e.error?.error || e.message || 'Error al activar encuesta');
      },
    });
  }

  private copySurveyLink(url?: string | null) {
    if (!url) return;
    navigator.clipboard?.writeText(url).catch(() => {});
  }

  setQuickFilter(filter: ClientQuickFilter) {
    this.quickFilter = filter;
    this.filterClients();
  }

  clearFilters() {
    this.quickFilter = 'all';
    this.searchTerm = '';
    this.statusFilter = '';
    this.invoiceFilter = '';
    this.zoneFilter = '';
    this.planFilter = '';
    this.tierFilter = '';
    this.dataFilter = '';
    this.consumptionFilter = '';
    this.filterClients();
  }

  setViewMode(mode: ClientViewMode) {
    this.viewMode = mode;
    this.page = 1;
  }

  activeRate(): number {
    return this.allClients().length ? Math.round((this.countStatus('activo') / this.allClients().length) * 100) : 0;
  }

  totalMonthlyRevenue(): number {
    return this.allClients().reduce((sum, client) => sum + this.monthlyAmount(client), 0);
  }

  pendingAmount(): number {
    return this.allClients().filter(client => this.hasPendingInvoices(client))
      .reduce((sum, client) => sum + this.monthlyAmount(client), 0);
  }

  countAttentionClients(): number {
    return this.allClients().filter(client => this.requiresAttention(client)).length;
  }

  countMissingData(): number {
    return this.allClients().filter(client => this.hasMissingData(client)).length;
  }

  dataCompleteness(): number {
    const clients = this.allClients();
    if (!clients.length) return 0;
    const present = clients.reduce((sum, client) => sum + [
      client.ip, client.telefono, client.zona?.nombre, client.plan_internet?.nombre,
      client.sn_onu || client.mac_cpe,
    ].filter(Boolean).length, 0);
    return Math.round((present / (clients.length * 5)) * 100);
  }

  countWithOnu(): number { return this.allClients().filter(client => Boolean(client.sn_onu)).length; }
  countWithoutPhone(): number { return this.allClients().filter(client => !client.telefono).length; }
  countWithoutIp(): number { return this.allClients().filter(client => !client.ip).length; }

  dominantPlan(): string {
    const counts = new Map<string, number>();
    for (const client of this.allClients()) {
      const plan = client.plan_internet?.nombre;
      if (plan) counts.set(plan, (counts.get(plan) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Sin plan dominante';
  }

  activeFilterCount(): number {
    return [this.quickFilter !== 'all', this.searchTerm, this.statusFilter, this.invoiceFilter,
      this.zoneFilter, this.planFilter, this.tierFilter, this.dataFilter, this.consumptionFilter]
      .filter(Boolean).length;
  }

  pagedClients(): WispHubClient[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filteredClients().slice(start, start + this.pageSize);
  }

  pageCount(): number { return Math.max(1, Math.ceil(this.filteredClients().length / this.pageSize)); }
  firstVisible(): number { return this.filteredClients().length ? (this.page - 1) * this.pageSize + 1 : 0; }
  lastVisible(): number { return Math.min(this.page * this.pageSize, this.filteredClients().length); }
  isPagedView(): boolean { return ['table', 'cards', 'circles'].includes(this.viewMode); }
  changePage(next: number) { this.page = Math.min(this.pageCount(), Math.max(1, next)); }

  copyValue(value: string | null | undefined, label: string) {
    if (!value) return this.toast.info(`${label} no disponible`);
    if (!navigator.clipboard) return this.toast.info('El navegador no permite copiar automáticamente');
    navigator.clipboard.writeText(value)
      .then(() => this.toast.success(`${label} copiado`))
      .catch(() => this.toast.info('No se pudo copiar automáticamente'));
  }

  speedGroups(): ClientGroup[] {
    const definitions = [
      { key: 'lte-5', title: 'Hasta 5 Mbps', subtitle: 'Planes basicos y servicios livianos' },
      { key: '6-10', title: '6 a 10 Mbps', subtitle: 'Residencial pequeno' },
      { key: '11-20', title: '11 a 20 Mbps', subtitle: 'Residencial medio' },
      { key: '21-50', title: '21 a 50 Mbps', subtitle: 'Planes altos' },
      { key: 'gt-50', title: 'Mas de 50 Mbps', subtitle: 'Clientes premium o especiales' },
      { key: 'unknown', title: 'Sin velocidad clara', subtitle: 'Plan sin dato de Mbps detectado' },
    ];
    return this.buildGroups(definitions, (c) => this.speedGroupKey(c));
  }

  billingGroups(): ClientGroup[] {
    const definitions = [
      { key: 'day-15', title: 'Corte dia 15', subtitle: 'Clientes que facturan a mitad de mes' },
      { key: 'day-30', title: 'Corte dia 30/31', subtitle: 'Clientes que facturan a fin de mes' },
      { key: 'day-1-14', title: 'Corte dia 1-14', subtitle: 'Ciclos tempranos del mes' },
      { key: 'day-16-29', title: 'Corte dia 16-29', subtitle: 'Ciclos despues del dia 15' },
      { key: 'no-cut', title: 'Sin corte', subtitle: 'Sin fecha de corte registrada' },
    ];
    return this.buildGroups(definitions, (c) => this.billingGroupKey(c));
  }

  amountGroups(): ClientGroup[] {
    const definitions = [
      { key: 'lte-700', title: 'RD$ 700 o menos', subtitle: 'Facturas pequenas' },
      { key: '701-1000', title: 'RD$ 701 - 1,000', subtitle: 'Rango residencial comun' },
      { key: '1001-1500', title: 'RD$ 1,001 - 1,500', subtitle: 'Planes intermedios' },
      { key: 'gt-1500', title: 'Mas de RD$ 1,500', subtitle: 'Planes altos o especiales' },
      { key: 'unknown', title: 'Sin monto', subtitle: 'Sin precio de plan registrado' },
    ];
    return this.buildGroups(definitions, (c) => this.amountGroupKey(c));
  }

  previewClients(clients: WispHubClient[]): WispHubClient[] {
    return clients.slice(0, 8);
  }

  groupShare(count: number): number {
    const total = Math.max(this.filteredClients().length, 1);
    return Math.max(8, Math.round((count / total) * 100));
  }

  monthlyAmount(c: WispHubClient): number {
    return this.parseMoney(c.precio_plan);
  }

  invoiceShort(c: WispHubClient): string {
    if (this.hasPendingInvoices(c)) return 'Pendiente';
    if (this.isPaidClient(c)) return 'Pagada';
    return c.estado_facturas || '-';
  }

  billingCycleLabel(c: WispHubClient): string {
    const day = this.cutDay(c.fecha_corte);
    if (!day) return 'Sin corte';
    if (day === 15) return 'Dia 15';
    if (day >= 30) return 'Dia 30/31';
    return `Dia ${day}`;
  }

  countStatus(status: string): number {
    return this.allClients().filter(c => c.estado?.toLowerCase() === status).length;
  }

  countPendingInvoices(): number {
    return this.allClients().filter(c => this.hasPendingInvoices(c)).length;
  }

  countRiskClients(): number {
    return this.allClients().filter(c => this.isRiskClient(c)).length;
  }

  private hasPendingInvoices(c: WispHubClient): boolean {
    return c.estado_facturas?.toLowerCase().includes('pendiente') ?? false;
  }

  private isPaidClient(c: WispHubClient): boolean {
    const s = c.estado_facturas?.toLowerCase() || '';
    return s === 'pagada' || s === 'pagadas';
  }

  private isRiskClient(c: WispHubClient): boolean {
    const tier = this.getMetric(c.id_servicio)?.creditTier;
    return tier === 'RIESGO' || tier === 'CRITICO';
  }

  private requiresAttention(c: WispHubClient): boolean {
    const status = c.estado?.toLowerCase() || '';
    return this.hasPendingInvoices(c) || this.isRiskClient(c)
      || ['suspendido', 'cortado', 'retirado'].includes(status)
      || this.crmActionFor(c.id_servicio) === 'block';
  }

  private hasMissingData(c: WispHubClient): boolean {
    return !c.ip || !c.telefono || !c.zona?.nombre || !c.plan_internet?.nombre || !(c.sn_onu || c.mac_cpe);
  }

  private buildGroups(
    definitions: { key: string; title: string; subtitle: string }[],
    keyFor: (client: WispHubClient) => string,
  ): ClientGroup[] {
    return definitions
      .map((definition) => {
        const clients = this.filteredClients().filter((client) => keyFor(client) === definition.key);
        return {
          ...definition,
          clients,
          totalMonthly: clients.reduce((sum, client) => sum + this.monthlyAmount(client), 0),
          activeCount: clients.filter((client) => client.estado?.toLowerCase() === 'activo').length,
          pendingCount: clients.filter((client) => this.hasPendingInvoices(client)).length,
        };
      })
      .filter((group) => group.clients.length > 0);
  }

  private speedGroupKey(c: WispHubClient): string {
    const speed = this.detectSpeedMbps(c);
    if (!speed) return 'unknown';
    if (speed <= 5) return 'lte-5';
    if (speed <= 10) return '6-10';
    if (speed <= 20) return '11-20';
    if (speed <= 50) return '21-50';
    return 'gt-50';
  }

  private amountGroupKey(c: WispHubClient): string {
    const amount = this.monthlyAmount(c);
    if (!amount) return 'unknown';
    if (amount <= 700) return 'lte-700';
    if (amount <= 1000) return '701-1000';
    if (amount <= 1500) return '1001-1500';
    return 'gt-1500';
  }

  private billingGroupKey(c: WispHubClient): string {
    const day = this.cutDay(c.fecha_corte);
    if (!day) return 'no-cut';
    if (day === 15) return 'day-15';
    if (day >= 30) return 'day-30';
    if (day < 15) return 'day-1-14';
    return 'day-16-29';
  }

  private detectSpeedMbps(c: WispHubClient): number | null {
    const text = [c.plan_internet?.nombre, c.servicio].filter(Boolean).join(' ');
    const matches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(gb|g|mbps|mb|m|kbps|kb|k)\b/gi)];
    if (!matches.length) return null;
    const values = matches.map((match) => {
      const value = Number(String(match[1]).replace(',', '.'));
      const unit = match[2].toLowerCase();
      if (unit.startsWith('g')) return value * 1000;
      if (unit.startsWith('k')) return value / 1000;
      return value;
    });
    return Math.max(...values);
  }

  private cutDay(value: string | null | undefined): number | null {
    if (!value) return null;
    const iso = String(value).match(/\b\d{4}[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (iso) return this.validDay(Number(iso[2]));
    const local = String(value).match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
    if (local) return this.validDay(Number(local[1]));
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : this.validDay(date.getDate());
  }

  private validDay(day: number): number | null {
    return day >= 1 && day <= 31 ? day : null;
  }

  private parseMoney(value: string | number | null | undefined): number {
    if (typeof value === 'number') return value;
    const normalized = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  quitarEncuesta(c: WispHubClient) {
    if (!c.ip) {
      this.toast.error('Cliente sin IP asignada');
      return;
    }
    if (!confirm(`Pausar encuesta para ${c.nombre}?\n\nEl cliente navega normal. Si no la llena, el sistema volvera a recordarle en unas horas.`)) return;

    this.surveyLoading.set(c.id_servicio);
    this.survey.clear(c.ip, c.id_servicio).subscribe({
      next: (r) => {
        this.surveyLoading.set(null);
        if (r.ok) {
          const mtCleaned = r.mikrotik?.removed?.some((x: any) => x.wasInList);
          const detail = r.snoozed > 0
            ? `${r.snoozed} encuesta(s) pausada(s) por ${r.reminderIntervalHours || 4}h`
            : 'sin encuestas pendientes';
          this.toast.success(`Encuesta pausada: ${detail}${mtCleaned ? ', MikroTik limpio' : ''}`);
        } else {
          this.toast.error(r.error || 'No se pudo quitar la encuesta');
        }
      },
      error: (e) => {
        this.surveyLoading.set(null);
        this.toast.error(e.error?.error || e.message || 'Error al quitar encuesta');
      },
    });
  }

  async loadLocal(forceRefresh = false) {
    this.loading.set(true);
    this.loadError.set('');
    try {
      const clients = await this.db.getClients(forceRefresh);
      this.allClients.set(clients);
      const plans = [...new Set(clients.map(c => c.plan_internet?.nombre).filter(Boolean))].sort();
      const zones = [...new Set(clients.map(c => c.zona?.nombre).filter(Boolean))].sort();
      this.allPlans.set(plans as string[]);
      this.allZones.set(zones as string[]);
      this.loadedAt.set(new Date());
      this.filterClients();
    } catch (error: any) {
      this.loadError.set(error?.message || 'No fue posible consultar los clientes guardados.');
    } finally {
      this.loading.set(false);
    }
  }

  filterClients() {
    let result = this.allClients();
    const term = this.searchTerm.toLowerCase().trim();

    if (term) {
      result = result.filter(c =>
        c.nombre?.toLowerCase().includes(term) ||
        c.ip?.includes(term) ||
        c.telefono?.includes(term) ||
        c.usuario?.toLowerCase().includes(term) ||
        c.cedula?.toLowerCase().includes(term) ||
        c.email?.toLowerCase().includes(term) ||
        c.direccion?.toLowerCase().includes(term) ||
        c.zona?.nombre?.toLowerCase().includes(term) ||
        c.plan_internet?.nombre?.toLowerCase().includes(term) ||
        c.mac_cpe?.toLowerCase().includes(term) ||
        c.sn_onu?.toLowerCase().includes(term) ||
        c.modelo_router_wifi?.toLowerCase().includes(term) ||
        c.ssid_router_wifi?.toLowerCase().includes(term)
      );
    }

    if (this.quickFilter === 'active') {
      result = result.filter(c => c.estado?.toLowerCase() === 'activo');
    } else if (this.quickFilter === 'debt') {
      result = result.filter(c => this.hasPendingInvoices(c));
    } else if (this.quickFilter === 'attention') {
      result = result.filter(c => this.requiresAttention(c));
    } else if (this.quickFilter === 'missing') {
      result = result.filter(c => this.hasMissingData(c));
    } else if (this.quickFilter === 'high_value') {
      result = result.filter(c => this.monthlyAmount(c) >= 1500);
    }

    if (this.statusFilter) {
      result = result.filter(c => c.estado?.toLowerCase() === this.statusFilter);
    }

    if (this.invoiceFilter === 'pending') {
      result = result.filter(c => this.hasPendingInvoices(c));
    } else if (this.invoiceFilter === 'paid') {
      result = result.filter(c => this.isPaidClient(c));
    }

    if (this.zoneFilter) {
      result = result.filter(c => c.zona?.nombre === this.zoneFilter);
    }

    if (this.planFilter) {
      result = result.filter(c => c.plan_internet?.nombre === this.planFilter);
    }

    if (this.tierFilter) {
      result = result.filter(c => this.getMetric(c.id_servicio)?.creditTier === this.tierFilter);
    }

    if (this.consumptionFilter) {
      result = result.filter(c => this.getMetric(c.id_servicio)?.consumptionTier === this.consumptionFilter);
    }

    if (this.dataFilter === 'missing_ip') result = result.filter(c => !c.ip);
    else if (this.dataFilter === 'missing_phone') result = result.filter(c => !c.telefono);
    else if (this.dataFilter === 'missing_onu') result = result.filter(c => !(c.sn_onu || c.mac_cpe));
    else if (this.dataFilter === 'missing_zone') result = result.filter(c => !c.zona?.nombre);
    else if (this.dataFilter === 'complete') result = result.filter(c => !this.hasMissingData(c));

    if (this.sortCol) {
      result = [...result].sort((a, b) => {
        let valA: any, valB: any;
        if (this.sortCol === 'creditScore') {
          // Sort especial: usa el score del MetricsService
          valA = this.getMetric(a.id_servicio)?.creditScore ?? -1;
          valB = this.getMetric(b.id_servicio)?.creditScore ?? -1;
        } else {
          valA = this.getNestedVal(a, this.sortCol);
          valB = this.getNestedVal(b, this.sortCol);
        }
        const cmp = this.compareVals(valA, valB);
        return this.sortDir === 'asc' ? cmp : -cmp;
      });
    }

    this.filteredClients.set(result);
    this.page = 1;
  }

  sort(col: string) {
    if (this.sortCol === col) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortCol = col;
      this.sortDir = 'asc';
    }
    this.filterClients();
  }

  sortIcon(col: string): string {
    if (this.sortCol !== col) return '';
    return this.sortDir === 'asc' ? '\u25B2' : '\u25BC';
  }

  openClient(idServicio: number | string) {
    this.router.navigate(['/clients', idServicio]);
  }

  private getNestedVal(obj: any, path: string): any {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }

  private compareVals(a: any, b: any): number {
    if (a == null) return 1;
    if (b == null) return -1;
    const numA = parseFloat(a), numB = parseFloat(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a).localeCompare(String(b), 'es');
  }

  async syncClients() {
    this.syncing.set(true);
    this.syncMessage.set('Actualizando la cartera sin borrar datos locales...');
    try {
      await this.syncService.syncAll();
      await this.loadLocal(true);
      this.syncMessage.set(`${this.allClients().length} clientes cargados`);
    } catch (error: any) {
      this.syncMessage.set('Error: ' + (error?.error?.detail || error?.message || 'Sin conexion'));
    } finally {
      this.syncing.set(false);
    }
  }

  getInitials(nombre: string): string {
    // Solo letras: nombres como "`la de la banca 15" o "algeny 30" no deben producir "`L" o "A3".
    const words = String(nombre || '').match(/\p{L}+/gu) || [];
    const initials = ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase();
    return initials || '#';
  }

  planLabel(c: WispHubClient): string {
    return formatPlanName(c.plan_internet?.nombre);
  }

  contactLine(c: WispHubClient): string {
    return [c.telefono, c.email].filter(Boolean).join(' · ');
  }

  clientSubline(c: WispHubClient): string {
    const parts = [
      c.zona?.nombre,
      c.telefono,
      c.usuario,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : (c.direccion || '-');
  }

  serviceSubline(c: WispHubClient): string {
    const parts = [
      c.ip || 'Sin IP',
      `RD$ ${c.precio_plan || '0'}`,
    ];
    return parts.join(' | ');
  }

  exportCSV() {
    this.exportSvc.exportCSV(this.filteredClients(), 'clientes', [
      { key: 'id_servicio', label: 'ID' },
      { key: 'nombre', label: 'Nombre' },
      { key: 'telefono', label: 'Telefono' },
      { key: 'email', label: 'Email' },
      { key: 'cedula', label: 'Cedula' },
      { key: 'direccion', label: 'Direccion' },
      { key: 'plan_internet.nombre', label: 'Plan Internet' },
      { key: 'precio_plan', label: 'Precio' },
      { key: 'ip', label: 'IP' },
      { key: 'mac_cpe', label: 'MAC' },
      { key: 'estado', label: 'Estado' },
      { key: 'estado_facturas', label: 'Estado Facturas' },
      { key: 'zona.nombre', label: 'Zona' },
      { key: 'fecha_instalacion', label: 'Fecha Instalacion' },
      { key: 'fecha_corte', label: 'Fecha Corte' },
    ]);
  }

  getStatusClass(estado: string | null | undefined): string {
    const s = estado?.toLowerCase();
    if (s === 'activo') return 'active';
    if (s === 'suspendido' || s === 'cortado' || s === 'retirado') return 'suspended';
    if (s === 'gratis') return 'free';
    return 'default';
  }

  getFacturaClass(estado: string | null | undefined): string {
    const s = estado?.toLowerCase();
    if (s === 'pagadas' || s === 'pagada') return 'paid';
    if (s?.includes('pendiente')) return 'pending';
    return 'default';
  }
}
