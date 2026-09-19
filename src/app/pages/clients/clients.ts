import { Component, ElementRef, HostListener, OnInit, OnDestroy, ViewChild, computed, effect, inject, signal } from '@angular/core';
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
import { initialsOf } from '../../pipes/initials';
import { formatDrPhone, telLink, whatsappLink } from '../../pipes/phone';
import { ClientListStateService, ClientListViewState } from '../../services/client-list-state.service';
import {
  LucideArrowUpDown, LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideCircleDollarSign,
  LucideCircleDot, LucideCopy, LucideDownload, LucideEye, LucideGauge, LucideLayoutGrid, LucideMessageCircle,
  LucideMoreHorizontal, LucidePhone, LucidePlus, LucideRefreshCw, LucideSearch, LucideSearchX,
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
    LucideArrowUpDown, LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideCircleDollarSign,
    LucideCircleDot, LucideCopy, LucideDownload, LucideEye, LucideGauge, LucideLayoutGrid, LucideMessageCircle,
    LucideMoreHorizontal, LucidePhone, LucidePlus, LucideRefreshCw, LucideSearch, LucideSearchX,
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
          <span class="kpi-icon"><svg lucideUserX size="19"></svg></span><span><small>Datos incompletos</small><strong>{{ countMissingData() }}</strong><em>sin teléfono, IP, zona o plan</em></span>
        </button>
        <button class="summary-card revenue" type="button" (click)="setQuickFilter('high_value')" [class.active]="quickFilter === 'high_value'" [title]="'Facturación mensual estimada: RD$ ' + (totalMonthlyRevenue() | number:'1.0-0')">
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
          <label class="search-input"><svg lucideSearch size="18"></svg><input #searchBox type="search" placeholder="Buscar por nombre, #servicio, teléfono, IP, cédula o dirección" aria-label="Buscar clientes (atajo: tecla /)" [(ngModel)]="searchTerm" (input)="filterClients()" (keydown.escape)="searchTerm = ''; filterClients()" />@if (searchTerm) { <button type="button" class="search-clear" aria-label="Borrar búsqueda" (click)="searchTerm = ''; filterClients(); searchBox.focus()"><svg lucideX size="15"></svg></button> } @else { <kbd class="search-kbd" title="Pulse / para buscar desde cualquier parte">/</kbd> }</label>
          <button class="filter-toggle" type="button" [class.active]="filtersExpanded || activeFilterCount() > 0" (click)="filtersExpanded = !filtersExpanded; persistView()"><svg lucideSlidersHorizontal size="17"></svg>Filtros @if (activeFilterCount()) { <span>{{ activeFilterCount() }}</span> }</button>
          <label class="mobile-sort"><svg lucideArrowUpDown size="16"></svg><span class="sr-only">Ordenar por</span>
            <select [ngModel]="sortCol + ':' + sortDir" (ngModelChange)="setSortOption($event)" aria-label="Ordenar clientes">
              <option value="nombre:asc">Nombre (A-Z)</option>
              <option value="nombre:desc">Nombre (Z-A)</option>
              <option value="precio_plan:desc">Mayor mensualidad</option>
              <option value="precio_plan:asc">Menor mensualidad</option>
              <option value="estado:asc">Estado</option>
              <option value="zona.nombre:asc">Zona</option>
              <option value="creditScore:asc">Peor puntuación de pago</option>
              <option value="creditScore:desc">Mejor puntuación de pago</option>
            </select>
          </label>
          <div class="toolbar-actions">
            <a routerLink="/clients/new" class="btn btn-green"><svg lucidePlus size="16"></svg>Nuevo cliente</a>
            <button class="btn btn-outline" type="button" (click)="exportCSV()" [disabled]="!filteredClients().length" [title]="filteredClients().length ? 'Descargar los ' + filteredClients().length + ' clientes visibles en Excel (CSV)' : 'No hay clientes para exportar'"><svg lucideDownload size="16"></svg>Exportar</button>
            <button class="btn btn-primary" type="button" [disabled]="syncing()" (click)="syncClients()" title="Traer los datos más recientes desde WispHub"><svg lucideRefreshCw size="16" [class.spinning]="syncing()"></svg>{{ syncing() ? 'Sincronizando…' : 'Sincronizar' }}</button>
          </div>
        </div>
        @if (filtersExpanded) {
          <div class="advanced-filters">
            <label><span>Estado</span><select [(ngModel)]="statusFilter" (change)="filterClients()"><option value="">Todos</option><option value="activo">Activo</option><option value="suspendido">Suspendido</option><option value="cortado">Cortado</option><option value="gratis">Gratis</option><option value="retirado">Retirado</option><option value="crm_moroso">Con aviso de pago (moroso)</option><option value="crm_block">Cortado desde el sistema</option></select></label>
            <label><span>Facturación</span><select [(ngModel)]="invoiceFilter" (change)="filterClients()"><option value="">Todas</option><option value="pending">Pendientes</option><option value="paid">Pagadas</option></select></label>
            <label><span>Zona</span><select [(ngModel)]="zoneFilter" (change)="filterClients()"><option value="">Todas</option>@for (zone of allZones(); track zone) { <option [value]="zone">{{ zone }}</option> }</select></label>
            <label><span>Plan</span><select [(ngModel)]="planFilter" (change)="filterClients()"><option value="">Todos</option>@for (plan of allPlans(); track plan) { <option [value]="plan">{{ planOptionLabel(plan) }}</option> }</select></label>
            <label><span>Riesgo</span><select [(ngModel)]="tierFilter" (change)="filterClients()"><option value="">Todos</option><option value="EXCELENTE">Excelente</option><option value="BUENO">Bueno</option><option value="REGULAR">Regular</option><option value="RIESGO">Riesgo</option><option value="CRITICO">Crítico</option></select></label>
            <label><span>Consumo</span><select [(ngModel)]="consumptionFilter" (change)="filterClients()"><option value="">Todos</option><option value="INTENSIVO">Intensivo</option><option value="NORMAL">Normal</option><option value="BAJO">Bajo</option><option value="INACTIVO">Inactivo</option></select></label>
            <label><span>Calidad de datos</span><select [(ngModel)]="dataFilter" (change)="filterClients()"><option value="">Todos</option><option value="complete">Expediente completo</option><option value="missing_ip">Sin IP</option><option value="missing_phone">Sin teléfono</option><option value="missing_onu">Sin ONU o MAC</option><option value="missing_zone">Sin zona</option></select></label>
            <button class="clear-filter" type="button" (click)="clearFilters()"><svg lucideX size="15"></svg>Limpiar filtros</button>
          </div>
        }
        <footer class="result-bar"><span><b>{{ filteredClients().length }}</b> {{ filteredClients().length === 1 ? 'resultado' : 'resultados' }} de {{ allClients().length }}</span>@if (activeFilterCount()) { <button type="button" (click)="clearFilters()">Restablecer vista</button> }</footer>
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
          <p>Cargando clientes…</p>
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
          <svg lucideUsers size="48"></svg>
          <h3>Todavía no hay clientes guardados</h3>
          <p>Pulse «Sincronizar» para traer la cartera desde WispHub.</p>
          <button class="btn btn-primary" type="button" [disabled]="syncing()" (click)="syncClients()"><svg lucideRefreshCw size="16"></svg>{{ syncing() ? 'Sincronizando…' : 'Sincronizar ahora' }}</button>
        </div>
      } @else if (filteredClients().length === 0) {
        <div class="empty-state">
          <svg lucideSearchX size="44"></svg>
          <h3>Ningún cliente coincide con la búsqueda</h3>
          <p>@if (searchTerm.trim()) { No hay resultados para «{{ searchTerm.trim() }}». } Revise lo escrito o quite algunos filtros.</p>
          <button class="btn btn-outline" type="button" (click)="clearFilters()"><svg lucideX size="16"></svg>Limpiar búsqueda y filtros</button>
        </div>
      } @else {
        @if (viewMode === 'table') {
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th class="col-check"><input type="checkbox" [checked]="isPageSelected()" [indeterminate]="isPagePartiallySelected()" (change)="togglePageSelection()" aria-label="Seleccionar los clientes de esta página" title="Seleccionar esta página" /></th>
                <th class="sortable col-client" (click)="sort('nombre')" [attr.aria-sort]="ariaSort('nombre')" title="Ordenar por nombre">Cliente {{ sortIcon('nombre') }}</th>
                <th class="sortable col-service" (click)="sort('plan_internet.nombre')" [attr.aria-sort]="ariaSort('plan_internet.nombre')" title="Ordenar por plan">Plan y red {{ sortIcon('plan_internet.nombre') }}</th>
                <th class="sortable col-status" (click)="sort('estado')" [attr.aria-sort]="ariaSort('estado')" title="Ordenar por estado">Estado {{ sortIcon('estado') }}</th>
                <th class="sortable col-billing" (click)="sort('precio_plan')" [attr.aria-sort]="ariaSort('precio_plan')" title="Ordenar por mensualidad">Facturación {{ sortIcon('precio_plan') }}</th>
                <th class="sortable col-location" (click)="sort('zona.nombre')" [attr.aria-sort]="ariaSort('zona.nombre')" title="Ordenar por zona">Ubicación {{ sortIcon('zona.nombre') }}</th>
                <th class="sortable col-score" (click)="sort('creditScore')" [attr.aria-sort]="ariaSort('creditScore')" title="Ordenar por puntuación de pago">Salud {{ sortIcon('creditScore') }}</th>
                <th class="col-actions"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (c of pagedClients(); track c.id_servicio) {
                <tr (click)="openClient(c.id_servicio, $event)" class="clickable-row" [class.selected-row]="isSelected(c.id_servicio)">
                  <td class="col-check" data-label="Seleccionar" (click)="$event.stopPropagation()"><input type="checkbox" [checked]="isSelected(c.id_servicio)" (change)="toggleSelect(c.id_servicio)" [attr.aria-label]="'Seleccionar a ' + c.nombre" /></td>
                  <td data-label="Cliente">
                    <div class="cell-client">
                      <div class="avatar-sm" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</div>
                      <div class="client-identity">
                        <span class="name">{{ c.nombre }}</span>
                        <span class="sub">#{{ c.id_servicio }}@if (c.usuario) { · {{ c.usuario }} }</span>
                        @if (c.telefono) { <span class="contact-line">{{ phoneLabel(c) }}@if (c.email) { · {{ c.email }} }</span> }
                        @else if (c.email) { <span class="contact-line">{{ c.email }}</span> }
                        @else { <span class="contact-line missing" title="Sin teléfono registrado">—</span> }
                      </div>
                    </div>
                  </td>
                  <td data-label="Plan y red">
                    <div class="service-cell">
                      <span class="plan-name" [title]="c.plan_internet?.nombre || ''">{{ planLabel(c) }}</span>
                      <span class="network-line"><b class="mono" [class.missing]="!c.ip" [title]="c.ip ? '' : 'Sin IP asignada'">{{ c.ip || 'Sin IP' }}</b>@if (c.mac_cpe || c.sn_onu) { <small class="mono">{{ c.mac_cpe || c.sn_onu }}</small> }</span>
                    </div>
                  </td>
                  <td data-label="Estado">
                    <span class="badge" [class]="'badge-' + getStatusClass(c.estado)">{{ statusLabel(c.estado) }}</span>
                    @if (crmActionLabel(c.id_servicio); as lbl) { <span class="crm-state badge-{{ lbl.color }}">{{ lbl.text }}</span> }
                  </td>
                  <td data-label="Facturación">
                    <div class="billing-cell"><strong>RD$ {{ monthlyAmount(c) | number:'1.0-0' }}</strong><span class="badge" [class]="'badge-' + getFacturaClass(c.estado_facturas)">{{ invoiceShort(c) }}</span><small>{{ billingCycleLabel(c) }}</small></div>
                  </td>
                  <td data-label="Ubicación">
                    <div class="location-cell">
                      <span [class.missing]="!c.zona?.nombre">{{ c.zona?.nombre || '—' }}</span>
                      @if (c.direccion || c.localidad) { <small [title]="c.direccion || c.localidad">{{ c.direccion || c.localidad }}</small> }
                    </div>
                  </td>
                  <td data-label="Salud" (click)="$event.stopPropagation()">
                    @if (getMetric(c.id_servicio); as m) {
                      <div class="score-cell">
                        @if (m.creditTier && tierStyle(m.creditTier); as ts) {
                          <span class="tier-pill" [style.background]="ts.bg" [style.color]="ts.color"
                                [title]="'Puntuación de pago: ' + (m.creditScore ?? '—') + ' de 100 · ' + tierLabel(ts.label)">
                            <b>{{ m.creditScore ?? '—' }}</b> {{ tierLabel(ts.label) }}
                          </span>
                        }
                        @if (m.consumptionTier && consStyle(m.consumptionTier); as cs) {
                          <span class="cons-pill" [style.background]="cs.bg" [style.color]="cs.color"
                                [title]="'Consumo ' + tierLabel(cs.label).toLowerCase() + ': ' + ((m.consumptionMb30d || 0) / 1024 | number:'1.1-1') + ' GB en 30 días'">
                            {{ tierLabel(cs.label) }}
                          </span>
                        }
                      </div>
                    } @else {
                      <span class="empty-tier" title="Aún no hay suficiente historial de pagos y consumo">Sin datos</span>
                    }
                  </td>
                  <td data-label="Acciones" (click)="$event.stopPropagation()">
                    <details class="row-actions">
                      <summary title="Acciones del cliente" aria-label="Acciones para {{ c.nombre }}"><svg lucideMoreHorizontal size="18"></svg></summary>
                      <div class="row-menu">
                        <button type="button" (click)="openClient(c.id_servicio, $event)"><svg lucideEye size="15"></svg><span><b>Ver expediente</b><small>Datos, facturas y equipos</small></span></button>
                        @if (whatsappFor(c); as wa) {
                          <a class="menu-link" [href]="wa" target="_blank" rel="noopener"><svg lucideMessageCircle size="15"></svg><span><b>Escribir por WhatsApp</b><small>{{ phoneLabel(c) }}</small></span></a>
                        }
                        @if (callFor(c); as tel) {
                          <a class="menu-link" [href]="tel"><svg lucidePhone size="15"></svg><span><b>Llamar</b><small>{{ phoneLabel(c) }}</small></span></a>
                        }
                        <button type="button" [disabled]="!c.ip" (click)="copyValue(c.ip, 'IP')"><svg lucideCopy size="15"></svg><span><b>Copiar IP</b><small>{{ c.ip || 'Sin IP asignada' }}</small></span></button>
                        <button type="button" [disabled]="!c.telefono" (click)="copyValue(c.telefono, 'Teléfono')"><svg lucideCopy size="15"></svg><span><b>Copiar teléfono</b><small>{{ c.telefono ? phoneLabel(c) : 'Sin teléfono registrado' }}</small></span></button>
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
              <article class="client-card" (click)="openClient(c.id_servicio, $event)">
                <div class="client-card-head">
                  <div class="avatar-card" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</div>
                  <div class="client-card-title">
                    <strong>{{ c.nombre }}</strong>
                    <span>{{ c.usuario || ('#' + c.id_servicio) }}</span>
                  </div>
                  <span class="badge" [class]="'badge-' + getStatusClass(c.estado)">{{ statusLabel(c.estado) }}</span>
                </div>
                <div class="client-card-service">
                  <span>{{ planLabel(c) }}</span>
                  <strong>RD$ {{ monthlyAmount(c) | number:'1.0-0' }}</strong>
                </div>
                <div class="client-card-grid">
                  <div><span>IP</span><strong class="mono" [class.missing]="!c.ip">{{ c.ip || '—' }}</strong></div>
                  <div><span>Zona</span><strong [class.missing]="!c.zona?.nombre">{{ c.zona?.nombre || '—' }}</strong></div>
                  <div><span>Factura</span><strong [class.pending-text]="invoiceShort(c) === 'Pendiente'">{{ invoiceShort(c) }}</strong></div>
                  <div><span>Corte</span><strong>{{ billingCycleLabel(c) }}</strong></div>
                  <div><span>Teléfono</span><strong [class.missing]="!c.telefono">{{ c.telefono || '—' }}</strong></div>
                  <div><span>ONU</span><strong class="mono" [class.missing]="!c.sn_onu">{{ c.sn_onu || '—' }}</strong></div>
                </div>
                <p [class.missing]="!c.direccion">{{ c.direccion || 'Sin dirección registrada' }}</p>
                <footer>
                  @if (whatsappFor(c); as wa) { <a class="card-contact wa" [href]="wa" target="_blank" rel="noopener" (click)="$event.stopPropagation()" [attr.aria-label]="'WhatsApp a ' + c.nombre"><svg lucideMessageCircle size="15"></svg>WhatsApp</a> }
                  @if (callFor(c); as tel) { <a class="card-contact" [href]="tel" (click)="$event.stopPropagation()" [attr.aria-label]="'Llamar a ' + c.nombre"><svg lucidePhone size="15"></svg>Llamar</a> }
                  <span class="card-open">Ver expediente <svg lucideEye size="14"></svg></span>
                </footer>
              </article>
            }
          </div>
        } @else if (viewMode === 'circles') {
          <div class="circle-grid">
            @for (c of pagedClients(); track c.id_servicio) {
              <button class="circle-client" type="button" (click)="openClient(c.id_servicio, $event)">
                <span class="circle-avatar" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</span>
                <strong>{{ c.nombre }}</strong>
                <span>{{ planLabel(c) }}</span>
                <small>{{ c.zona?.nombre || 'Sin zona' }} · {{ billingCycleLabel(c) }}</small>
                <em class="circle-status" [class]="'badge-' + getStatusClass(c.estado)">{{ statusLabel(c.estado) }}</em>
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
                  @for (c of previewClients(group); track c.id_servicio) {
                    <button type="button" class="group-row" (click)="openClient(c.id_servicio, $event)">
                      <span class="mini-avatar" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</span>
                      <span class="group-client-name">{{ c.nombre }}</span>
                      <small>{{ c.plan_internet?.nombre ? planLabel(c) : (c.servicio || '—') }}</small>
                    </button>
                  }
                  @if (group.clients.length > 8) {
                    <button type="button" class="more-row" (click)="toggleGroup(group)">{{ isGroupExpanded(group) ? 'Mostrar menos' : 'Ver los ' + (group.clients.length - 8) + ' clientes restantes' }}</button>
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
                  @for (c of previewClients(group); track c.id_servicio) {
                    <button type="button" class="group-row" (click)="openClient(c.id_servicio, $event)">
                      <span class="mini-avatar" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</span>
                      <span class="group-client-name">{{ c.nombre }}</span>
                      <small>{{ cutDateLabel(c.fecha_corte) }}</small>
                    </button>
                  }
                  @if (group.clients.length > 8) {
                    <button type="button" class="more-row" (click)="toggleGroup(group)">{{ isGroupExpanded(group) ? 'Mostrar menos' : 'Ver los ' + (group.clients.length - 8) + ' clientes restantes' }}</button>
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
                  @for (c of previewClients(group); track c.id_servicio) {
                    <button type="button" class="amount-row" (click)="openClient(c.id_servicio, $event)">
                      <span>
                        <strong>{{ c.nombre }}</strong>
                        <small>{{ planLabel(c) }} · {{ c.zona?.nombre || 'Sin zona' }}</small>
                      </span>
                      <em>RD$ {{ monthlyAmount(c) | number:'1.0-0' }}</em>
                    </button>
                  }
                  @if (group.clients.length > 8) {
                    <button type="button" class="more-row" (click)="toggleGroup(group)">{{ isGroupExpanded(group) ? 'Mostrar menos' : 'Ver los ' + (group.clients.length - 8) + ' clientes restantes' }}</button>
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
          <div><label>Por página <select [ngModel]="pageSize" (ngModelChange)="setPageSize(+$event)"><option [ngValue]="25">25</option><option [ngValue]="50">50</option><option [ngValue]="100">100</option></select></label><button type="button" [disabled]="page === 1" (click)="changePage(page - 1)" aria-label="Página anterior"><svg lucideChevronLeft size="17"></svg></button><strong>Página {{ page }} de {{ pageCount() }}</strong><button type="button" [disabled]="page === pageCount()" (click)="changePage(page + 1)" aria-label="Página siguiente"><svg lucideChevronRight size="17"></svg></button></div>
        </nav>
      }

      <div class="sync-bar" [class.visible]="syncing()">
        <div class="spinner small"></div>
        <span>{{ syncMessage() }}</span>
      </div>

      @if (selectedCount() > 0) {
        <div class="selection-bar" role="region" aria-label="Acciones para los clientes seleccionados">
          <span class="selection-count"><b>{{ selectedCount() }}</b> {{ selectedCount() === 1 ? 'cliente seleccionado' : 'clientes seleccionados' }}</span>
          @if (selectedCount() < filteredClients().length) {
            <button type="button" class="link-btn" (click)="selectAllFiltered()">Seleccionar los {{ filteredClients().length }}</button>
          }
          <div class="selection-actions">
            <button type="button" class="btn btn-outline" (click)="copySelectedPhones()" [disabled]="!selectedWithPhone()" [title]="selectedWithPhone() ? 'Copiar ' + selectedWithPhone() + ' teléfonos, uno por línea' : 'Ninguno tiene teléfono'"><svg lucidePhone size="15"></svg>Copiar teléfonos</button>
            <button type="button" class="btn btn-outline" (click)="exportSelected()"><svg lucideDownload size="15"></svg>Exportar</button>
            <button type="button" class="btn btn-ghost" (click)="clearSelection()" aria-label="Quitar selección"><svg lucideX size="15"></svg><span>Quitar</span></button>
          </div>
        </div>
      }
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
    .summary-card.success .kpi-icon { background: #e9f8f1; color: #13875a; }.summary-card.warning .kpi-icon { background: #fff6e8; color: #b36b12; }.summary-card.danger .kpi-icon { background: #fff0ef; color: #b42318; }.summary-card.info .kpi-icon { background: #eef3f7; color: #526b80; }.summary-card.revenue .kpi-icon { background: #edf4ff; color: #1267dd; }
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
    .btn:disabled { opacity: .55; cursor: not-allowed; }.btn-outline { border-color: #ccd6de; background: #fff; color: #4e5e6c; }.btn-outline:hover { background: #f4f7f9; }.btn-primary { background: #1267dd; color: #fff; }.btn-primary:hover { background: #0d58c0; }.btn-green { background: #13875a; color: #fff; text-decoration: none; }.btn-green:hover { background: #0f704b; }
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
    .badge-active { background: #e9f8f1; color: #13875a; }
    .badge-suspended { background: #fff0ef; color: #b42318; }
    .badge-free { background: #edf4ff; color: #1267dd; }
    .badge-default { background: #eef1f4; color: #526170; }
    .badge-paid { background: #e9f8f1; color: #13875a; }
    .badge-pending { background: #fff6e8; color: #b36b12; }
    .pending-text { color: #b36b12 !important; }
    .crm-state { display: block; width: max-content; margin-top: 5px; padding: 3px 6px; border-radius: 3px; font-size: 11px; font-weight: 800; }.crm-state.badge-warn { border: 0; }.crm-state.badge-danger { border: 0; }

    .loading-state, .empty-state {
      display: flex; flex-direction: column;
      align-items: center; padding: 64px 24px; gap: 12px; color: #667582; font-size: 13px;
    }
    .empty-state { border: 1px dashed #ccd6de; border-radius: 8px; background: #fff; }
    .empty-state > svg { color: #8a9aa8; }
    .empty-state h3 { color: #172535; margin: 4px 0 0; font-size: 17px; text-align: center; }
    .empty-state p { margin: 0; max-width: 460px; text-align: center; line-height: 1.5; }.error-state svg { color: #b42318; }

    .spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #1267dd; border-radius: 50%; animation: spin 0.8s linear infinite; }
    .spinner.small { width: 18px; height: 18px; border-width: 2px; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .sync-bar {
      position: fixed; bottom: -60px; left: 260px; right: 0;
      height: 48px; background: #172535; color: white;
      display: flex; align-items: center; justify-content: center;
      gap: 12px; font-size: 14px; transition: bottom 0.3s; z-index: 50;
    }
    .sync-bar.visible { bottom: 0; }

    .badge-warn { background: #fff6e8; color: #b36b12; border: 1px solid #f3d19e; padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; margin-bottom: 4px; display: inline-block; }
    .badge-danger { background: #fff0ef; color: #b42318; border: 1px solid #f0b4ae; padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; margin-bottom: 4px; display: inline-block; }

    .score-cell { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }.tier-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border-radius: 10px; font-size: 11px; font-weight: 700; white-space: nowrap; cursor: help; }.tier-pill b { font-weight: 800; }.cons-pill { display: inline-flex; align-items: center; padding: 3px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; cursor: help; }.empty-tier { color: #8a98a5; font-size: 11px; font-style: italic; }

    .row-actions { position: relative; }.row-actions > summary { width: 32px; height: 32px; margin-left: auto; border: 1px solid #d8e0e6; border-radius: 4px; display: grid; place-items: center; color: #586775; background: #fff; cursor: pointer; list-style: none; }.row-actions > summary::-webkit-details-marker { display: none; }.row-actions[open] > summary { border-color: #1267dd; color: #1267dd; background: #f2f7ff; }
    .row-menu { width: 230px; margin: 7px 0 2px -180px; padding: 5px; display: grid; gap: 2px; border: 1px solid #d5dde4; border-radius: 5px; background: #fff; box-shadow: 0 8px 20px rgba(20, 33, 45, .08); }
    .row-menu > button { min-height: 42px; padding: 6px 8px; border: 0; border-radius: 4px; display: grid; grid-template-columns: 22px 1fr; align-items: center; gap: 7px; text-align: left; background: transparent; color: #455461; }.row-menu > button:hover:not(:disabled) { background: #f2f7fd; color: #1267dd; }.row-menu > button:disabled { opacity: .45; }.row-menu b, .row-menu small { display: block; }.row-menu b { font-size: 11px; }.row-menu small { margin-top: 3px; color: #84919c; font-size: 11px; }
    .service-actions { padding: 8px; border-top: 1px solid #e5e9ed; }.service-actions > span { display: block; margin-bottom: 7px; color: #7b8894; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }

    .pagination { min-height: 52px; margin-top: 10px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; border: 1px solid #dce3e8; border-radius: 6px; background: #fff; color: #75838f; font-size: 11px; }.pagination > span b { color: #344250; }.pagination > div { display: flex; align-items: center; gap: 8px; }.pagination label { display: flex; align-items: center; gap: 6px; }.pagination select { height: 32px; border: 1px solid #d5dde4; border-radius: 4px; background: #fff; color: #43515e; font-size: 11px; }.pagination button { width: 32px; height: 32px; border: 1px solid #d5dde4; border-radius: 4px; display: grid; place-items: center; background: #fff; color: #475664; }.pagination button:disabled { opacity: .35; }.pagination strong { min-width: 92px; text-align: center; color: #43515e; font-size: 11px; }

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
      display: block; color: #172535; font-size: 14px; line-height: 1.25;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .client-card-title span { display: block; margin-top: 2px; color: #667582; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .client-card-service {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      margin: 14px 0 12px; padding: 10px 12px; border-radius: 5px; background: #f8fafb;
    }
    .client-card-service span { color: #334250; font-weight: 700; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .client-card-service strong { color: #172535; font-size: 14px; white-space: nowrap; }
    .client-card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .client-card-grid div { min-width: 0; border: 1px solid #e7ecef; border-radius: 5px; padding: 8px; }
    .client-card-grid span { display: block; color: #667582; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .client-card-grid strong { display: block; margin-top: 3px; color: #334250; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .client-card p { margin: 12px 0 0; color: #667582; font-size: 12px; line-height: 1.4; min-height: 34px; }
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
      width: 100%; color: #172535; font-size: 13px; line-height: 1.25;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .circle-client span:not(.circle-avatar) { margin-top: 5px; color: #334250; font-size: 12px; font-weight: 700; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .circle-client small { margin-top: 4px; color: #667582; font-size: 12px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .circle-status { margin-top: 7px; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; font-style: normal; }

    .group-layout {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 12px; align-items: start;
    }
    .group-panel {
      background: white; border: 1px solid #dfe5ea; border-radius: 6px; padding: 14px;
      box-shadow: 0 10px 26px rgba(15, 23, 42, 0.04);
    }
    .group-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .group-head h3 { margin: 0; color: #172535; font-size: 16px; line-height: 1.2; }
    .group-head p { margin: 4px 0 0; color: #667582; font-size: 12px; line-height: 1.35; }
    .group-head strong { color: #1267dd; font-size: 24px; line-height: 1; }
    .group-metrics { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
    .group-metrics span {
      display: inline-flex; padding: 4px 9px; border-radius: 999px; background: #f8fafc;
      color: #334250; border: 1px solid #dfe5ea; font-size: 12px; font-weight: 700;
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
    .group-row:hover, .amount-row:hover { background: #f4f8fd; border-color: #a7c5e5; }
    .mini-avatar { width: 30px; height: 30px; border-radius: 4px; color: white; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 900; }
    .group-client-name { color: #172535; font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .group-row small { color: #667582; font-size: 12px; white-space: nowrap; }
    .more-row { width: 100%; min-height: 34px; border: 1px dashed #ccd6de; border-radius: 5px; background: #fff; color: #1267dd; font-size: 12px; font-weight: 700; text-align: center; padding: 7px; cursor: pointer; }
    .more-row:hover { background: #f2f7ff; border-color: #1267dd; }
    .billing-bars { height: 8px; background: #edf4ff; border-radius: 999px; overflow: hidden; margin-top: 12px; }
    .billing-bars span { display: block; height: 100%; min-width: 8%; border-radius: inherit; background: #1267dd; }
    .amount-row {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 9px 10px; text-align: left;
    }
    .amount-row span { min-width: 0; }
    .amount-row strong { display: block; color: #172535; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .amount-row small { display: block; margin-top: 2px; color: #667582; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .amount-row em { color: #172535; font-size: 13px; font-weight: 800; font-style: normal; white-space: nowrap; }

    button:focus-visible, a:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #1267dd; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; } }

    @media (max-width: 1500px) {
      .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }

    /* Búsqueda: botón borrar y atajo "/" */
    .search-clear { width: 26px; height: 26px; flex: 0 0 auto; border: 0; border-radius: 4px; display: grid; place-items: center; background: transparent; color: #667582; cursor: pointer; }
    .search-clear:hover { background: #f2f7ff; color: #1267dd; }
    .search-kbd { flex: 0 0 auto; min-width: 20px; height: 20px; padding: 0 5px; display: grid; place-items: center; border: 1px solid #d5dde4; border-bottom-width: 2px; border-radius: 4px; background: #f8fafc; color: #667582; font: 600 11px ui-monospace, 'Cascadia Mono', Consolas, monospace; }
    .mobile-sort { display: none; }

    /* Selección múltiple */
    .col-check { width: 44px; text-align: center !important; padding-left: 10px !important; padding-right: 4px !important; }
    .col-check input { width: 16px; height: 16px; accent-color: #1267dd; cursor: pointer; vertical-align: middle; }
    .clickable-row.selected-row td { background: #f2f7ff; }
    .selection-bar { position: fixed; left: calc(260px + 20px); right: 20px; bottom: 16px; z-index: 60; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 12px 10px 16px; border: 1px solid #b9cdea; border-radius: 8px; background: #fff; box-shadow: 0 12px 30px rgba(20, 33, 45, .18); animation: rise .18s ease-out; }
    .selection-count { color: #334250; font-size: 13px; }.selection-count b { color: #1267dd; font-size: 15px; }
    .link-btn { border: 0; background: transparent; color: #1267dd; font-size: 13px; font-weight: 700; cursor: pointer; padding: 4px; }
    .link-btn:hover { text-decoration: underline; }
    .selection-actions { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
    .selection-actions .btn { height: 36px; font-size: 12px; }
    .btn-ghost { border: 0; background: transparent; color: #667582; }.btn-ghost:hover { background: #f4f7f9; color: #172535; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

    /* Contacto directo */
    .row-menu > a.menu-link { min-height: 42px; padding: 6px 8px; border-radius: 4px; display: grid; grid-template-columns: 22px 1fr; align-items: center; gap: 7px; color: #455461; text-decoration: none; }
    .row-menu > a.menu-link:hover { background: #f2f7fd; color: #1267dd; }
    .client-card footer { justify-content: space-between; flex-wrap: wrap; }
    .card-contact { height: 30px; padding: 0 10px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid #ccd6de; border-radius: 6px; color: #334250; background: #fff; font-size: 12px; font-weight: 700; text-decoration: none; }
    .card-contact:hover { border-color: #1267dd; color: #1267dd; }
    .card-contact.wa { border-color: #b6e3cb; color: #13875a; background: #f1faf5; }
    .card-contact.wa:hover { border-color: #13875a; }
    .card-open { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }

    @media (max-width: 1024px) {
      .selection-bar { left: 16px; right: 16px; }
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

      /* Resumen compacto: las 6 tarjetas ocupaban casi dos pantallas antes de la lista. */
      .summary-grid { gap: 6px; }
      .summary-card { min-height: 0; padding: 9px 10px; grid-template-columns: minmax(0, 1fr); }
      .summary-card .kpi-icon { display: none; }
      .summary-card strong { margin-top: 4px; font-size: 18px; }
      .summary-card em { margin-top: 4px; }
      .portfolio-head p { display: none; }
      .search-kbd { display: none; }
      .mobile-sort { height: 40px; padding: 0 10px; display: flex; align-items: center; gap: 8px; border: 1px solid #ccd6de; border-radius: 5px; background: #fff; color: #667582; }
      .mobile-sort select { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: #334250; font-size: 13px; font-weight: 600; }
      .selection-bar { left: 8px; right: 8px; bottom: 8px; padding: 10px; gap: 8px; }
      .selection-actions { width: 100%; margin-left: 0; display: grid; grid-template-columns: 1fr 1fr auto; }
      .selection-actions .btn-ghost span { display: none; }
      .client-card footer { gap: 8px; }
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
  private listState = inject(ClientListStateService);
  metrics = inject(MetricsService);

  @ViewChild('searchBox') private searchBox?: ElementRef<HTMLInputElement>;
  // Página y desplazamiento a recuperar tras la primera carga (al volver de un expediente).
  private pendingRestore: { page: number; scrollY: number } | null = null;

  // Selección múltiple (por número de servicio) para exportar o copiar teléfonos.
  selected = signal<Set<number>>(new Set());
  selectedCount = computed(() => this.selected().size);

  surveyLoading = signal<number | null>(null);
  expandedGroups = signal<Set<string>>(new Set());
  private host = inject(ElementRef<HTMLElement>);
  // Cierra el menú de acciones de la fila al hacer clic fuera o al elegir una opción.
  // Se escucha en fase de captura porque las celdas detienen la propagación del clic.
  private closeMenusOnClick = (event: Event) => {
    const target = event.target as HTMLElement | null;
    const menus = (this.host.nativeElement as HTMLElement).querySelectorAll<HTMLDetailsElement>('details.row-actions[open]');
    menus.forEach((menu) => {
      const inside = !!target && menu.contains(target);
      const choseOption = !!target?.closest('.row-menu > button, .row-menu > a');
      if (!inside || choseOption) menu.open = false;
    });
  };

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
  // Las métricas se recargan cada 30 s: se vuelve a filtrar sin regresar a la página 1.
  private metricsFilterEffect = effect(() => {
    this.metrics.metricsByClient();
    if (!this.loading()) queueMicrotask(() => this.filterClients(false));
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

  @HostListener('document:keydown.escape')
  closeRowMenus() {
    (this.host.nativeElement as HTMLElement).querySelectorAll<HTMLDetailsElement>('details.row-actions[open]')
      .forEach((menu) => menu.open = false);
  }

  // "/" enfoca el buscador desde cualquier parte de la lista (como en Gmail o GitHub).
  @HostListener('document:keydown', ['$event'])
  focusSearchShortcut(event: KeyboardEvent) {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    event.preventDefault();
    this.searchBox?.nativeElement.focus();
    this.searchBox?.nativeElement.select();
  }

  async ngOnInit() {
    document.addEventListener('click', this.closeMenusOnClick, true);
    this.restoreView();
    await this.loadLocal();
    this.applyPendingRestore();
    this.loadCrmStates();
    this.metrics.startAutoRefresh(30000);
  }

  private restoreView() {
    const s = this.listState.loadView();
    if (!s) return;
    const views: ClientViewMode[] = ['table', 'cards', 'circles', 'speed', 'billing', 'amount'];
    this.searchTerm = s.searchTerm ?? '';
    this.quickFilter = (s.quickFilter as ClientQuickFilter) || 'all';
    this.statusFilter = s.statusFilter ?? '';
    this.invoiceFilter = s.invoiceFilter ?? '';
    this.zoneFilter = s.zoneFilter ?? '';
    this.planFilter = s.planFilter ?? '';
    this.tierFilter = s.tierFilter ?? '';
    this.dataFilter = s.dataFilter ?? '';
    this.consumptionFilter = s.consumptionFilter ?? '';
    this.sortCol = s.sortCol || 'nombre';
    this.sortDir = s.sortDir === 'desc' ? 'desc' : 'asc';
    if (s.viewMode && views.includes(s.viewMode as ClientViewMode)) this.viewMode = s.viewMode as ClientViewMode;
    if ([25, 50, 100].includes(Number(s.pageSize))) this.pageSize = Number(s.pageSize);
    this.filtersExpanded = !!s.filtersExpanded;
    this.pendingRestore = { page: Number(s.page) || 1, scrollY: Number(s.scrollY) || 0 };
  }

  private applyPendingRestore() {
    const restore = this.pendingRestore;
    this.pendingRestore = null;
    if (!restore) return;
    this.page = Math.min(this.pageCount(), Math.max(1, restore.page));
    this.persistView();
    if (restore.scrollY > 0) setTimeout(() => window.scrollTo({ top: restore.scrollY }), 0);
  }

  persistView(scrollY = 0) {
    const state: ClientListViewState = {
      searchTerm: this.searchTerm, quickFilter: this.quickFilter, statusFilter: this.statusFilter,
      invoiceFilter: this.invoiceFilter, zoneFilter: this.zoneFilter, planFilter: this.planFilter,
      tierFilter: this.tierFilter, dataFilter: this.dataFilter, consumptionFilter: this.consumptionFilter,
      sortCol: this.sortCol, sortDir: this.sortDir, page: this.page, pageSize: this.pageSize,
      viewMode: this.viewMode, filtersExpanded: this.filtersExpanded, scrollY,
    };
    this.listState.saveView(state);
  }

  ngOnDestroy() {
    document.removeEventListener('click', this.closeMenusOnClick, true);
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
        this.filterClients(false);
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
    if (a === 'block') return { text: 'Cortado', color: 'danger' };
    if (a === 'moroso') return { text: 'Aviso de pago', color: 'warn' };
    return null;
  }

  onActionChanged(ev: { action: string; result: any }, id: number) {
    const map = new Map(this.crmActions());
    if (ev.action === 'clear') map.delete(id);
    else map.set(id, ev.action);
    this.crmActions.set(map);
    this.filterClients(false);
  }

  enviarEncuesta(c: WispHubClient) {
    const ip = c.ip;
    if (!ip) {
      this.toast.error('Cliente sin IP asignada');
      return;
    }
    const confirmMsg = `¿Crear encuesta para ${c.nombre} (${ip})?\n\nSe creará un enlace seguro en la nube y recordatorios. No se tocará el MikroTik ni se afectará el internet del cliente.`;
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
    this.persistView();
  }

  setPageSize(size: number) {
    this.pageSize = size;
    this.page = 1;
    this.persistView();
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
    ].filter(Boolean).length, 0);
    return Math.round((present / (clients.length * 4)) * 100);
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
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return top ? formatPlanName(top) : 'Sin plan dominante';
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
  changePage(next: number) {
    this.page = Math.min(this.pageCount(), Math.max(1, next));
    this.persistView();
    // Al cambiar de página se vuelve al inicio de la lista, no al pie.
    this.host.nativeElement.querySelector('.view-strip, .table-container')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // ─── Contacto ───
  whatsappFor(c: WispHubClient): string | null { return whatsappLink(c.telefono); }
  callFor(c: WispHubClient): string | null { return telLink(c.telefono); }
  phoneLabel(c: WispHubClient): string { return formatDrPhone(c.telefono); }

  // ─── Selección múltiple ───
  isSelected(id: number): boolean { return this.selected().has(id); }

  toggleSelect(id: number) {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selected.set(next);
  }

  isPageSelected(): boolean {
    const page = this.pagedClients();
    return page.length > 0 && page.every((c) => this.selected().has(c.id_servicio));
  }

  isPagePartiallySelected(): boolean {
    const page = this.pagedClients();
    const count = page.filter((c) => this.selected().has(c.id_servicio)).length;
    return count > 0 && count < page.length;
  }

  togglePageSelection() {
    const next = new Set(this.selected());
    const page = this.pagedClients();
    if (this.isPageSelected()) page.forEach((c) => next.delete(c.id_servicio));
    else page.forEach((c) => next.add(c.id_servicio));
    this.selected.set(next);
  }

  selectAllFiltered() {
    this.selected.set(new Set(this.filteredClients().map((c) => c.id_servicio)));
  }

  clearSelection() { this.selected.set(new Set()); }

  private selectedClients(): WispHubClient[] {
    const ids = this.selected();
    return this.filteredClients().filter((c) => ids.has(c.id_servicio));
  }

  selectedWithPhone(): number {
    return this.selectedClients().filter((c) => !!c.telefono).length;
  }

  copySelectedPhones() {
    const phones = [...new Set(this.selectedClients().map((c) => c.telefono).filter(Boolean))];
    if (!phones.length) return this.toast.info('Ninguno de los clientes seleccionados tiene teléfono');
    this.copyValue(phones.join('\n'), `${phones.length} ${phones.length === 1 ? 'teléfono' : 'teléfonos'}`);
  }

  exportSelected() {
    this.exportRows(this.selectedClients(), 'clientes-seleccionados');
  }

  copyValue(value: string | null | undefined, label: string) {
    if (!value) return this.toast.info(`${label} no disponible`);
    if (!navigator.clipboard) return this.toast.info('El navegador no permite copiar automáticamente');
    navigator.clipboard.writeText(value)
      .then(() => this.toast.success(`${label} copiado`))
      .catch(() => this.toast.info('No se pudo copiar automáticamente'));
  }

  speedGroups(): ClientGroup[] {
    const definitions = [
      { key: 'lte-5', title: 'Hasta 5 Mbps', subtitle: 'Planes básicos y servicios livianos' },
      { key: '6-10', title: '6 a 10 Mbps', subtitle: 'Residencial pequeño' },
      { key: '11-20', title: '11 a 20 Mbps', subtitle: 'Residencial medio' },
      { key: '21-50', title: '21 a 50 Mbps', subtitle: 'Planes altos' },
      { key: 'gt-50', title: 'Más de 50 Mbps', subtitle: 'Clientes premium o especiales' },
      { key: 'unknown', title: 'Sin velocidad clara', subtitle: 'Plan sin dato de Mbps detectado' },
    ];
    return this.buildGroups(definitions, (c) => this.speedGroupKey(c));
  }

  billingGroups(): ClientGroup[] {
    const definitions = [
      { key: 'day-15', title: 'Corte día 15', subtitle: 'Clientes que facturan a mitad de mes' },
      { key: 'day-30', title: 'Corte día 30/31', subtitle: 'Clientes que facturan a fin de mes' },
      { key: 'day-1-14', title: 'Corte del día 1 al 14', subtitle: 'Ciclos tempranos del mes' },
      { key: 'day-16-29', title: 'Corte del día 16 al 29', subtitle: 'Ciclos después del día 15' },
      { key: 'no-cut', title: 'Sin corte', subtitle: 'Sin fecha de corte registrada' },
    ];
    return this.buildGroups(definitions, (c) => this.billingGroupKey(c));
  }

  amountGroups(): ClientGroup[] {
    const definitions = [
      { key: 'lte-700', title: 'RD$ 700 o menos', subtitle: 'Facturas pequeñas' },
      { key: '701-1000', title: 'RD$ 701 a 1,000', subtitle: 'Rango residencial común' },
      { key: '1001-1500', title: 'RD$ 1,001 a 1,500', subtitle: 'Planes intermedios' },
      { key: 'gt-1500', title: 'Más de RD$ 1,500', subtitle: 'Planes altos o especiales' },
      { key: 'unknown', title: 'Sin monto', subtitle: 'Sin precio de plan registrado' },
    ];
    return this.buildGroups(definitions, (c) => this.amountGroupKey(c));
  }

  previewClients(group: ClientGroup): WispHubClient[] {
    return this.isGroupExpanded(group) ? group.clients : group.clients.slice(0, 8);
  }

  isGroupExpanded(group: ClientGroup): boolean {
    return this.expandedGroups().has(`${this.viewMode}:${group.key}`);
  }

  toggleGroup(group: ClientGroup) {
    const key = `${this.viewMode}:${group.key}`;
    const next = new Set(this.expandedGroups());
    if (next.has(key)) next.delete(key); else next.add(key);
    this.expandedGroups.set(next);
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
    if (day === 15) return 'Día 15';
    if (day >= 30) return 'Día 30/31';
    return `Día ${day}`;
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

  // Datos imprescindibles para cobrar y dar soporte. ONU/MAC no cuenta: los clientes
  // inalámbricos no tienen ONU y marcaban casi toda la cartera como "incompleta".
  private hasMissingData(c: WispHubClient): boolean {
    return !c.ip || !c.telefono || !c.zona?.nombre || !c.plan_internet?.nombre;
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
    if (!confirm(`¿Pausar la encuesta para ${c.nombre}?\n\nEl cliente navega normal. Si no la llena, el sistema volverá a recordarle en unas horas.`)) return;

    this.surveyLoading.set(c.id_servicio);
    this.survey.clear(c.ip, c.id_servicio).subscribe({
      next: (r) => {
        this.surveyLoading.set(null);
        if (r.ok) {
          const mtCleaned = r.mikrotik?.removed?.some((x: any) => x.wasInList);
          const detail = r.snoozed > 0
            ? `${r.snoozed} encuesta(s) pausada(s) por ${r.reminderIntervalHours || 4}h`
            : 'sin encuestas pendientes';
          this.toast.success(`Encuesta pausada: ${detail}${mtCleaned ? '; aviso retirado del MikroTik' : ''}`);
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

  /** Texto sin tildes y en minúsculas: "José Núñez" y "jose nunez" coinciden. */
  private normalize(value: unknown): string {
    return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  /**
   * Búsqueda por palabras: todas deben aparecer en algún dato del cliente.
   * "#130" o "130" encuentran el número de servicio; los teléfonos se comparan solo por dígitos
   * ("809-772" encuentra "18097723061"); MAC sin separadores también coincide.
   */
  private matchesSearch(c: WispHubClient, words: string[]): boolean {
    const text = this.normalize([
      c.nombre, c.usuario, c.ip, c.telefono, c.cedula, c.email, c.direccion, c.localidad,
      c.zona?.nombre, c.plan_internet?.nombre, formatPlanName(c.plan_internet?.nombre), c.mac_cpe, c.sn_onu,
      c.modelo_router_wifi, c.ssid_router_wifi,
    ].filter(Boolean).join(' '));
    const digits = [c.telefono, c.cedula].filter(Boolean).join(' ').replace(/[^\d ]/g, '');
    const compactMac = this.normalize(c.mac_cpe).replace(/[^a-z0-9]/g, '');
    return words.every((word) => {
      const id = word.replace(/^#/, '');
      if (/^\d+$/.test(id) && String(c.id_servicio) === id) return true;
      if (text.includes(word)) return true;
      const wordDigits = word.replace(/\D/g, '');
      if (wordDigits.length >= 4 && wordDigits.length === word.replace(/[\s().+-]/g, '').length && digits.replace(/ /g, '').includes(wordDigits)) return true;
      const compactWord = word.replace(/[^a-z0-9]/g, '');
      return compactWord.length >= 4 && compactMac.includes(compactWord);
    });
  }

  filterClients(resetPage = true) {
    let result = this.allClients();
    const words = this.normalize(this.searchTerm).trim().split(/\s+/).filter(Boolean);

    if (words.length) {
      result = result.filter(c => this.matchesSearch(c, words));
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

    if (this.statusFilter === 'crm_moroso' || this.statusFilter === 'crm_block') {
      // Marcas aplicadas desde este sistema (aviso de pago o corte), no el estado de WispHub.
      const wanted = this.statusFilter === 'crm_moroso' ? 'moroso' : 'block';
      result = result.filter(c => this.crmActionFor(c.id_servicio) === wanted);
    } else if (this.statusFilter) {
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
    this.page = resetPage ? 1 : Math.min(this.page, this.pageCount());
    // La selección solo conserva clientes que siguen visibles.
    if (this.selected().size) {
      const visible = new Set(result.map((c) => c.id_servicio));
      const kept = [...this.selected()].filter((id) => visible.has(id));
      if (kept.length !== this.selected().size) this.selected.set(new Set(kept));
    }
    this.persistView();
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

  openClient(idServicio: number | string, event?: MouseEvent) {
    // Ctrl/Cmd + clic abre el expediente en otra pestaña, como un enlace normal.
    if (event && (event.ctrlKey || event.metaKey)) {
      window.open(`/clients/${idServicio}`, '_blank', 'noopener');
      return;
    }
    // Guarda la vista (incluida la posición) y el orden actual para Anterior/Siguiente en el expediente.
    this.persistView(window.scrollY);
    this.listState.saveNavigation(this.filteredClients().map((c) => c.id_servicio), this.navigationLabel());
    this.router.navigate(['/clients', idServicio]);
  }

  private navigationLabel(): string {
    const quick: Record<ClientQuickFilter, string> = {
      all: 'Todos los clientes', active: 'Servicio activo', debt: 'Facturas pendientes',
      attention: 'Requieren atención', missing: 'Datos incompletos', high_value: 'Planes de RD$ 1,500+',
    };
    const parts = [quick[this.quickFilter]];
    if (this.searchTerm.trim()) parts.push(`«${this.searchTerm.trim()}»`);
    if (this.activeFilterCount() > (this.quickFilter !== 'all' ? 1 : 0) + (this.searchTerm.trim() ? 1 : 0)) parts.push('con filtros');
    return parts.join(' · ');
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
    this.syncMessage.set('Actualizando la cartera desde WispHub sin borrar datos locales…');
    try {
      await this.syncService.syncAll();
      await this.loadLocal(true);
      this.syncMessage.set(`${this.allClients().length} clientes cargados`);
      this.toast.success(`Cartera actualizada: ${this.allClients().length} clientes`);
    } catch (error: any) {
      this.syncMessage.set('Error: ' + (error?.error?.detail || error?.message || 'Sin conexión'));
      this.toast.error('No se pudo sincronizar: ' + (error?.error?.detail || error?.message || 'sin conexión con el servidor'));
    } finally {
      this.syncing.set(false);
    }
  }

  getInitials(nombre: string): string {
    return initialsOf(nombre);
  }

  /** Orden desde el selector móvil (en tarjetas no hay encabezados para tocar). */
  setSortOption(value: string) {
    const [col, dir] = value.split(':');
    this.sortCol = col;
    this.sortDir = dir === 'desc' ? 'desc' : 'asc';
    this.filterClients();
  }

  planLabel(c: WispHubClient): string {
    return formatPlanName(c.plan_internet?.nombre);
  }

  planOptionLabel(plan: string): string {
    const pretty = formatPlanName(plan);
    return pretty === plan ? plan : `${pretty} (${plan})`;
  }

  statusLabel(estado: string | null | undefined): string {
    const s = String(estado || '').trim();
    if (!s) return 'Sin estado';
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  tierLabel(label: string): string {
    return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
  }

  cutDateLabel(value: string | null | undefined): string {
    if (!value) return 'Sin corte';
    const iso = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!iso) return String(value);
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('es-DO', { day: 'numeric', month: 'short' });
  }

  ariaSort(col: string): 'ascending' | 'descending' | null {
    if (this.sortCol !== col) return null;
    return this.sortDir === 'asc' ? 'ascending' : 'descending';
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
    this.exportRows(this.filteredClients(), 'clientes');
  }

  private exportRows(rows: WispHubClient[], fileName: string) {
    this.exportSvc.exportCSV(rows, fileName, [
      { key: 'id_servicio', label: 'ID' },
      { key: 'nombre', label: 'Nombre' },
      { key: 'telefono', label: 'Teléfono' },
      { key: 'email', label: 'Correo' },
      { key: 'cedula', label: 'Cédula' },
      { key: 'direccion', label: 'Dirección' },
      { key: 'plan_internet.nombre', label: 'Plan de internet' },
      { key: 'precio_plan', label: 'Precio' },
      { key: 'ip', label: 'IP' },
      { key: 'mac_cpe', label: 'MAC' },
      { key: 'estado', label: 'Estado' },
      { key: 'estado_facturas', label: 'Estado de facturas' },
      { key: 'zona.nombre', label: 'Zona' },
      { key: 'fecha_instalacion', label: 'Fecha de instalación' },
      { key: 'fecha_corte', label: 'Fecha de corte' },
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
