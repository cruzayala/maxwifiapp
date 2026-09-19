import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { LocalDbService } from '../../services/local-db.service';
import { DbService } from '../../services/db.service';
import { Invoice } from '../../models/invoice.model';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExportColumn, ExportService } from '../../services/export.service';
import { ReceiptService } from '../../services/receipt.service';
import { ToastService } from '../../services/toast.service';
import { PaymentModalComponent } from '../../components/payment-modal/payment-modal';
import { firstValueFrom } from 'rxjs';
import {
  LucideBanknote, LucideCalendarClock, LucideChartColumn, LucideChevronDown,
  LucideCircleDollarSign, LucideFileCheck2, LucideFileQuestion, LucideGauge,
  LucideFileText, LucideLandmark, LucideReceiptText, LucideTrendingUp, LucideWalletCards,
} from '@lucide/angular';

type InvoiceQuickFilter = 'all' | 'collected' | 'open' | 'paid' | 'pending' | 'overdue' | 'missing_evidence';
type InvoiceDateField = 'fecha_emision' | 'fecha_vencimiento' | 'fecha_pago';
type InvoiceExportFormat = 'excel' | 'csv';

interface InvoiceMetrics {
  count: number;
  invoiced: number;
  collected: number;
  balance: number;
}

interface InvoiceTrendPoint {
  key: string;
  label: string;
  count: number;
  invoiced: number;
  collected: number;
}

interface InvoiceBreakdown {
  label: string;
  count: number;
  amount: number;
  share: number;
  color?: string;
}

@Component({
  selector: 'app-invoices',
  standalone: true,
  imports: [
    NavbarComponent, DecimalPipe, FormsModule, PaymentModalComponent,
    LucideBanknote, LucideCalendarClock, LucideChartColumn, LucideChevronDown,
    LucideCircleDollarSign, LucideFileCheck2, LucideFileQuestion, LucideGauge,
    LucideFileText, LucideLandmark, LucideReceiptText, LucideTrendingUp, LucideWalletCards,
  ],
  template: `
    <app-navbar pageTitle="Facturas" />

    <div class="page">
      <section class="finance-head">
        <div><span>Control financiero</span><h2>Facturación y cobranza</h2><p>Historial completo, pagos, saldos y soportes en una sola vista.</p></div>
        <div class="history-state" [class.error]="loadError()"><i></i><span><b>{{ loadError() ? 'Historial no disponible' : 'Historial completo' }}</b><small>{{ allInvoices().length }} facturas guardadas</small></span></div>
      </section>

      <section class="summary-grid" aria-label="Indicadores de facturación">
        <button class="summary-card total" type="button" (click)="setQuickFilter('all')" [class.active]="quickFilter === 'all'">
          <span class="kpi-icon"><svg lucideReceiptText size="19"></svg></span><span><small>Total facturado</small><strong>RD$ {{ totalFacturado() / 1000000 | number:'1.1-2' }} M</strong><em>{{ allInvoices().length }} facturas históricas</em></span>
        </button>
        <button class="summary-card success" type="button" (click)="setQuickFilter('collected')" [class.active]="quickFilter === 'collected'">
          <span class="kpi-icon"><svg lucideBanknote size="19"></svg></span><span><small>Total cobrado</small><strong>RD$ {{ totalCobrado() / 1000000 | number:'1.1-2' }} M</strong><em>{{ collectionRate() | number:'1.1-1' }}% de recuperación</em></span>
        </button>
        <button class="summary-card danger" type="button" (click)="setQuickFilter('open')" [class.active]="quickFilter === 'open'">
          <span class="kpi-icon"><svg lucideCircleDollarSign size="19"></svg></span><span><small>Saldo abierto</small><strong>RD$ {{ totalPendiente() | number:'1.0-0' }}</strong><em>{{ countPendientes() }} requieren revisión</em></span>
        </button>
        <button class="summary-card warning" type="button" (click)="setQuickFilter('overdue')" [class.active]="quickFilter === 'overdue'">
          <span class="kpi-icon"><svg lucideCalendarClock size="19"></svg></span><span><small>Cartera vencida</small><strong>{{ countOverdue() }}</strong><em>RD$ {{ overdueBalance() | number:'1.0-0' }} en atraso</em></span>
        </button>
        <button class="summary-card paid" type="button" (click)="setQuickFilter('paid')" [class.active]="quickFilter === 'paid'">
          <span class="kpi-icon"><svg lucideFileCheck2 size="19"></svg></span><span><small>Facturas pagadas</small><strong>{{ countPagadas() }}</strong><em>{{ paidRate() | number:'1.1-1' }}% cerradas</em></span>
        </button>
        <button class="summary-card evidence" type="button" (click)="setQuickFilter('missing_evidence')" [class.active]="quickFilter === 'missing_evidence'">
          <span class="kpi-icon"><svg lucideFileQuestion size="19"></svg></span><span><small>Sin soporte</small><strong>{{ countWithoutEvidence() }}</strong><em>sin referencia ni comprobante</em></span>
        </button>
      </section>

      <section class="finance-insights" aria-label="Resumen financiero complementario">
        <div><svg lucideGauge size="16"></svg><span>Promedio por factura <b>RD$ {{ averageTicket() | number:'1.0-0' }}</b></span></div>
        <div><svg lucideTrendingUp size="16"></svg><span>Este mes <b>RD$ {{ currentMonthMetrics().invoiced | number:'1.0-0' }}</b> · {{ currentMonthMetrics().count }} facturas</span></div>
        <div><svg lucideWalletCards size="16"></svg><span>Descuentos <b>RD$ {{ totalDiscounts() | number:'1.0-0' }}</b></span></div>
        <div><svg lucideLandmark size="16"></svg><span>Cobros parciales <b>{{ countPartialPayments() }}</b></span></div>
      </section>

      @if (!loading() && allInvoices().length > 0) {
        <section class="analytics-grid" aria-label="Gráficas financieras">
          <article class="analytics-panel trend-panel">
            <header><div><span>Tendencia de facturación</span><h3>Últimos 6 meses</h3></div><div class="chart-legend"><i class="invoiced"></i>Facturado <i class="collected"></i>Cobrado</div></header>
            <div class="column-chart">
              @for (point of monthlyTrend(); track point.key) {
                <div class="chart-month" [title]="trendTitle(point)">
                  <div class="bar-stage"><i class="bar invoiced" [style.height.%]="trendHeight(point.invoiced)"></i><i class="bar collected" [style.height.%]="trendHeight(point.collected)"></i></div>
                  <strong>{{ point.label }}</strong><small>{{ point.count }} fact.</small>
                </div>
              }
            </div>
          </article>

          <article class="analytics-panel method-panel">
            <header><div><span>Canales de cobro</span><h3>Formas de pago</h3></div><svg lucideBanknote size="19"></svg></header>
            <div class="horizontal-bars">
              @for (item of paymentBreakdown(); track item.label) {
                <div class="bar-row"><div><strong>{{ item.label }}</strong><span>{{ item.count }} facturas · RD$ {{ item.amount | number:'1.0-0' }}</span></div><em>{{ item.share | number:'1.0-1' }}%</em><i><b [style.width.%]="item.share"></b></i></div>
              } @empty { <p class="chart-empty">No hay formas de pago en la vista actual.</p> }
            </div>
          </article>

          <article class="analytics-panel status-panel">
            <header><div><span>Composición</span><h3>Estado de cartera</h3></div><svg lucideChartColumn size="19"></svg></header>
            <div class="status-chart">
              <div class="donut" [style.background]="statusConic()"><span><b>{{ filtered().length }}</b><small>facturas</small></span></div>
              <div class="status-legend">
                @for (item of statusBreakdown(); track item.label) { <div><i [style.background]="item.color"></i><span>{{ item.label }}</span><b>{{ item.count }}</b></div> }
              </div>
            </div>
          </article>
        </section>
      }

      <div class="toolbar">
        <div class="search-filter">
          <div class="search-input">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search" placeholder="Cliente, usuario, teléfono, cédula, dirección, referencia o factura" [(ngModel)]="searchTerm" (input)="filterInvoices()" />
          </div>
          <select [(ngModel)]="statusFilter" (change)="filterInvoices()" class="filter-select">
            <option value="">Todos los estados</option>
            <option value="pagada">Pagadas</option>
            <option value="pendiente">Pendientes</option>
            <option value="vencida">Vencidas</option>
            <option value="partial">Cobro parcial</option>
            <option value="closed">Canceladas o transferidas</option>
          </select>
          <select [(ngModel)]="dateFilter" (change)="filterInvoices()" class="filter-select">
            <option value="">Todas las fechas</option>
            <option value="overdue">Vencidas</option>
            <option value="due7">Vencen en 7 días</option>
            <option value="issued-today">Emitidas hoy</option>
            <option value="issued-30">Emitidas últimos 30 días</option>
            <option value="issued-month">Emitidas este mes</option>
            <option value="issued-year">Emitidas este año</option>
            <option value="paid-month">Pagadas este mes</option>
          </select>
          <select [(ngModel)]="paymentFilter" (change)="filterInvoices()" class="filter-select">
            <option value="">Todas las formas</option>
            @for (method of allPaymentMethods(); track method) {
              <option [value]="method">{{ method }}</option>
            }
          </select>
          <select [(ngModel)]="zoneFilter" (change)="filterInvoices()" class="filter-select">
            <option value="">Todas las zonas</option>
            @for (zone of allZones(); track zone) {
              <option [value]="zone">{{ zone }}</option>
            }
          </select>
          <button class="btn btn-ghost" type="button" (click)="showAdvanced = !showAdvanced" [class.active]="showAdvanced" [attr.aria-expanded]="showAdvanced">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16M7 12h10M10 19h4"/></svg>
            Más filtros
            @if (activeAdvancedFilterCount() > 0) { <span class="filter-count">{{ activeAdvancedFilterCount() }}</span> }
          </button>
        </div>

        @if (showAdvanced) {
          <div class="advanced-filters">
            <label><span>Fecha a evaluar</span>
              <select [(ngModel)]="dateField" (change)="filterInvoices()">
                <option value="fecha_emision">Emisión</option>
                <option value="fecha_vencimiento">Vencimiento</option>
                <option value="fecha_pago">Pago</option>
              </select>
            </label>
            <label><span>Desde</span><input type="date" [(ngModel)]="dateFrom" (change)="filterInvoices()" /></label>
            <label><span>Hasta</span><input type="date" [(ngModel)]="dateTo" (change)="filterInvoices()" /></label>
            <label><span>Total mínimo</span><input type="number" min="0" step="100" placeholder="RD$ 0" [(ngModel)]="minTotal" (input)="filterInvoices()" /></label>
            <label><span>Total máximo</span><input type="number" min="0" step="100" placeholder="Sin límite" [(ngModel)]="maxTotal" (input)="filterInvoices()" /></label>
            <label><span>Saldo mínimo</span><input type="number" min="0" step="100" placeholder="RD$ 0" [(ngModel)]="minBalance" (input)="filterInvoices()" /></label>
            <label><span>Saldo máximo</span><input type="number" min="0" step="100" placeholder="Sin límite" [(ngModel)]="maxBalance" (input)="filterInvoices()" /></label>
            <label><span>Cajero</span>
              <select [(ngModel)]="cashierFilter" (change)="filterInvoices()">
                <option value="">Todos</option>
                @for (cashier of allCashiers(); track cashier) { <option [value]="cashier">{{ cashier }}</option> }
              </select>
            </label>
            <label><span>Tipo</span>
              <select [(ngModel)]="typeFilter" (change)="filterInvoices()">
                <option value="">Todos</option>
                @for (type of allTypes(); track type) { <option [value]="type">Tipo {{ type }}</option> }
              </select>
            </label>
            <label><span>Soporte de pago</span>
              <select [(ngModel)]="evidenceFilter" (change)="filterInvoices()">
                <option value="">Todos</option>
                <option value="reference">Con referencia</option>
                <option value="proof">Con comprobante</option>
                <option value="missing">Sin referencia ni comprobante</option>
              </select>
            </label>
            <label><span>Descuento</span>
              <select [(ngModel)]="discountFilter" (change)="filterInvoices()">
                <option value="">Todos</option>
                <option value="with">Con descuento</option>
                <option value="without">Sin descuento</option>
              </select>
            </label>
            <button class="btn btn-ghost clear-advanced" type="button" (click)="clearFilters()">Limpiar filtros</button>
            @if (rangeWarning()) { <p class="range-warning" role="alert">{{ rangeWarning() }}</p> }
          </div>
        }

        <div class="toolbar-actions">
          <div class="export-control">
            <select [(ngModel)]="exportFormat" aria-label="Formato de exportación">
              <option value="excel">Excel</option>
              <option value="csv">CSV</option>
            </select>
            <button class="btn btn-outline" type="button" (click)="exportInvoices()" [disabled]="filtered().length === 0" [title]="filtered().length ? 'Descargar las facturas visibles' : 'No hay facturas para exportar'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Exportar
            </button>
          </div>
          <button class="btn btn-outline" type="button" (click)="showComparison = !showComparison" [class.active]="showComparison">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/></svg>
            Comparar
          </button>
          <button class="btn btn-outline" type="button" (click)="printFilteredReport()" [disabled]="filtered().length === 0" [title]="filtered().length ? 'Imprimir el listado de facturas visibles' : 'No hay facturas para imprimir'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Imprimir listado
          </button>
          <button class="btn btn-primary" type="button" (click)="syncInvoices()" [disabled]="syncing()" [title]="syncing() ? 'Sincronización en curso' : 'Traer el historial de facturas desde WispHub'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
            {{ syncing() ? 'Sincronizando…' : 'Sincronizar' }}
          </button>
          <span class="inv-count">{{ filtered().length }} de {{ allInvoices().length }} facturas</span>
        </div>
      </div>

      @if (showComparison) {
        <section class="comparison-panel">
          <div class="comparison-head">
            <div><strong>Comparación de períodos</strong><span>Basada en la fecha de emisión</span></div>
            <button class="btn btn-ghost" type="button" (click)="setDefaultComparison()">Este mes vs anterior</button>
          </div>
          <div class="period-grid">
            <div class="period-block current">
              <div class="period-title"><strong>Período A</strong><div><input type="date" aria-label="Período A desde" [(ngModel)]="compareFromA" (change)="updateComparison()" /><input type="date" aria-label="Período A hasta" [(ngModel)]="compareToA" (change)="updateComparison()" /></div></div>
              <div class="period-metrics"><span><small>Facturas</small><strong>{{ comparisonA().count }}</strong></span><span><small>Facturado</small><strong>RD$ {{ comparisonA().invoiced | number:'1.2-2' }}</strong></span><span><small>Cobrado</small><strong>RD$ {{ comparisonA().collected | number:'1.2-2' }}</strong></span><span><small>Saldo</small><strong>RD$ {{ comparisonA().balance | number:'1.2-2' }}</strong></span></div>
            </div>
            <div class="period-block previous">
              <div class="period-title"><strong>Período B</strong><div><input type="date" aria-label="Período B desde" [(ngModel)]="compareFromB" (change)="updateComparison()" /><input type="date" aria-label="Período B hasta" [(ngModel)]="compareToB" (change)="updateComparison()" /></div></div>
              <div class="period-metrics"><span><small>Facturas</small><strong>{{ comparisonB().count }}</strong></span><span><small>Facturado</small><strong>RD$ {{ comparisonB().invoiced | number:'1.2-2' }}</strong></span><span><small>Cobrado</small><strong>RD$ {{ comparisonB().collected | number:'1.2-2' }}</strong></span><span><small>Saldo</small><strong>RD$ {{ comparisonB().balance | number:'1.2-2' }}</strong></span></div>
            </div>
          </div>
          <div class="delta-row">
            <span>Facturación A vs B <strong [class.positive]="comparisonDelta('invoiced') >= 0" [class.negative]="comparisonDelta('invoiced') < 0">{{ comparisonDeltaLabel('invoiced') }}</strong></span>
            <span>Cobranza A vs B <strong [class.positive]="comparisonDelta('collected') >= 0" [class.negative]="comparisonDelta('collected') < 0">{{ comparisonDeltaLabel('collected') }}</strong></span>
            <span>Cantidad A vs B <strong [class.positive]="comparisonDelta('count') >= 0" [class.negative]="comparisonDelta('count') < 0">{{ comparisonDeltaLabel('count') }}</strong></span>
          </div>
        </section>
      }

      <div class="results-strip">
        <span><small>Resultados</small><strong>{{ visibleStats().count }}</strong></span>
        <span><small>Facturado visible</small><strong>RD$ {{ visibleStats().invoiced | number:'1.2-2' }}</strong></span>
        <span><small>Cobrado visible</small><strong>RD$ {{ visibleStats().collected | number:'1.2-2' }}</strong></span>
        <span><small>Saldo visible</small><strong class="balance-value">RD$ {{ visibleStats().balance | number:'1.2-2' }}</strong></span>
        @if (activeFilterCount() > 0) { <button type="button" class="active-filter-label" (click)="clearFilters()" title="Quitar todos los filtros">{{ activeFilterCount() }} {{ activeFilterCount() === 1 ? 'filtro activo' : 'filtros activos' }} · Limpiar</button> }
      </div>

      @if (selectedInvoices().length > 0) {
        <div class="selection-bar">
          <div><strong>{{ selectedInvoices().length }} seleccionadas</strong><span>RD$ {{ selectedTotal() | number:'1.2-2' }} · saldo RD$ {{ selectedBalance() | number:'1.2-2' }}</span></div>
          <div class="selection-actions">
            @if (selectedInvoices().length < filtered().length) { <button type="button" (click)="selectAllFiltered()">Seleccionar resultados</button> }
            <button type="button" (click)="exportInvoices(true)">Exportar selección</button>
            <button type="button" (click)="printSelected('invoice')">Reimprimir facturas</button>
            <button type="button" (click)="printSelected('receipt')">Reimprimir recibos</button>
            <button type="button" class="clear-selection" (click)="clearSelection()">Quitar selección</button>
          </div>
        </div>
      }

      @if (loading()) {
        <div class="loading-state"><div class="spinner"></div><p>Cargando facturas...</p></div>
      } @else if (loadError()) {
        <div class="empty-state error-state">
          <svg lucideFileQuestion size="42"></svg>
          <h3>No se pudo cargar el historial</h3>
          <p>{{ loadError() }}</p>
          <button class="btn btn-primary" type="button" (click)="loadInvoices(true)">Reintentar</button>
        </div>
      } @else if (filtered().length === 0 && allInvoices().length === 0) {
        <div class="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <h3>Aún no hay facturas guardadas</h3>
          <p>Sincroniza para traer el historial de facturas desde WispHub. Puede tardar unos minutos.</p>
          <button class="btn btn-primary" type="button" (click)="syncInvoices()" [disabled]="syncing()">{{ syncing() ? 'Sincronizando…' : 'Sincronizar ahora' }}</button>
        </div>
      } @else if (filtered().length === 0) {
        <div class="empty-state filtered-empty">
          <h3>No hay coincidencias</h3>
          <p>Prueba otra búsqueda o limpia los filtros activos.</p>
          <button class="btn btn-outline" type="button" (click)="clearFilters()">Limpiar filtros</button>
        </div>
      } @else {
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th class="col-check">
                  <input type="checkbox" aria-label="Seleccionar página" [checked]="isPageSelected()" [indeterminate]="isPagePartiallySelected()" (change)="togglePageSelection()" />
                </th>
                <th class="sortable col-invoice" (click)="sort('id_factura')">Factura {{ sortIcon('id_factura') }}</th>
                <th class="sortable col-client" (click)="sort('cliente.nombre')">Cliente {{ sortIcon('cliente.nombre') }}</th>
                <th class="sortable col-dates" (click)="sort('fecha_vencimiento')">Fechas {{ sortIcon('fecha_vencimiento') }}</th>
                <th class="sortable col-payment" (click)="sort('forma_pago.nombre')">Pago {{ sortIcon('forma_pago.nombre') }}</th>
                <th class="sortable col-total" (click)="sort('total')">Total {{ sortIcon('total') }}</th>
                <th class="sortable col-balance" (click)="sort('saldo')">Saldo {{ sortIcon('saldo') }}</th>
                <th class="sortable col-status" (click)="sort('estado')">Estado {{ sortIcon('estado') }}</th>
                <th class="col-actions">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (inv of pagedInvoices(); track inv.id_factura) {
                <tr [class.row-overdue]="isOverdue(inv)" [class.row-pending]="isPending(inv)" [class.row-selected]="isSelected(inv)">
                  <td data-label="Seleccionar" class="col-check">
                    <input type="checkbox" [attr.aria-label]="'Seleccionar factura ' + inv.id_factura" [checked]="isSelected(inv)" (change)="toggleInvoice(inv)" />
                  </td>
                  <td data-label="Factura">
                    <div class="invoice-cell">
                      <span class="invoice-id">#{{ inv.id_factura }}</span>
                      <small>{{ invoiceSubline(inv) }}</small>
                    </div>
                  </td>
                  <td data-label="Cliente">
                    <div class="client-cell">
                      <span>{{ inv.cliente?.nombre || '-' }}</span>
                      <small>{{ clientSubline(inv) }}</small>
                    </div>
                  </td>
                  <td data-label="Fechas">
                    <div class="date-cell">
                      <span>Emisión {{ inv.fecha_emision || '—' }}</span>
                      <small [class.overdue-text]="isOverdue(inv)">Vence {{ inv.fecha_vencimiento || '—' }}</small>
                      @if (inv.fecha_pago) {
                        <small>Pago {{ inv.fecha_pago }}</small>
                      }
                    </div>
                  </td>
                  <td data-label="Pago">
                    <div class="payment-cell">
                      <span [class.muted]="!inv.forma_pago?.nombre">{{ inv.forma_pago?.nombre || '—' }}</span>
                      <small>{{ inv.cajero?.nombre || inv.zona?.nombre || '—' }}</small>
                    </div>
                  </td>
                  <td data-label="Total">
                    <div class="amount-cell">
                      <span>RD$ {{ inv.total | number:'1.2-2' }}</span>
                      <small>Subtotal RD$ {{ inv.sub_total | number:'1.2-2' }}</small>
                      @if (inv.descuento > 0) {
                        <small class="discount">Desc. -RD$ {{ inv.descuento | number:'1.2-2' }}</small>
                      }
                    </div>
                  </td>
                  <td data-label="Saldo">
                    <div class="balance-cell" [class.balance-open]="isPending(inv)">
                      <span>RD$ {{ balanceAmount(inv) | number:'1.2-2' }}</span>
                      <small>Cobrado RD$ {{ inv.total_cobrado | number:'1.2-2' }}</small>
                    </div>
                  </td>
                  <td data-label="Estado">
                    <div class="status-cell">
                      <span class="badge" [class]="'badge-' + getStatusClass(inv)">{{ statusLabel(inv) }}</span>
                      @if (isOverdue(inv)) {
                        <small class="late-pill">Vencida</small>
                      }
                    </div>
                  </td>
                  <td data-label="Acciones">
                    <div class="action-btns">
                      @if (isPending(inv)) {
                        <button class="btn-pay" type="button" (click)="openPayment(inv)" title="Registrar pago de esta factura">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                          Pagar
                        </button>
                      }
                      <button class="btn-print btn-invoice" type="button" (click)="printInvoice(inv)" title="Ver e imprimir la factura en tamaño carta / A4">
                        <svg lucideFileText size="14"></svg>
                        Factura
                      </button>
                      <button class="btn-print btn-receipt" type="button" (click)="printReceipt(inv)" title="Ver e imprimir el recibo para impresora térmica">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                        Recibo
                      </button>
                      <button class="btn-print btn-details" type="button" (click)="toggleDetails(inv.id_factura)" [class.active]="expandedInvoiceId() === inv.id_factura" [attr.aria-expanded]="expandedInvoiceId() === inv.id_factura" title="Ver todos los datos de la factura">
                        Detalle <svg lucideChevronDown size="14" [class.rotated]="expandedInvoiceId() === inv.id_factura"></svg>
                      </button>
                    </div>
                  </td>
                </tr>
                @if (expandedInvoiceId() === inv.id_factura) {
                  <tr class="invoice-detail-row">
                    <td colspan="9">
                      <div class="invoice-detail">
                        <header><div><span>Expediente de factura</span><strong>#{{ inv.id_factura }} · {{ inv.cliente?.nombre || 'Sin cliente' }}</strong></div><span class="badge" [class]="'badge-' + getStatusClass(inv)">{{ statusLabel(inv) }}</span></header>
                        <div class="detail-grid">
                          <section><h4>Identificación</h4><dl><div><dt>Folio</dt><dd>{{ inv.folio || '-' }}</dd></div><div><dt>Referencia</dt><dd>{{ inv.referencia || '-' }}</dd></div><div><dt>Comprobante</dt><dd>{{ inv.comprobante_pago || '-' }}</dd></div><div><dt>Tipo</dt><dd>{{ inv.tipo || '-' }}</dd></div></dl></section>
                          <section><h4>Cliente</h4><dl><div><dt>Usuario</dt><dd>{{ inv.cliente?.usuario || '-' }}</dd></div><div><dt>Teléfono</dt><dd>{{ inv.cliente?.telefono || '-' }}</dd></div><div><dt>Correo</dt><dd>{{ inv.cliente?.email || '-' }}</dd></div><div><dt>Dirección</dt><dd>{{ inv.cliente?.direccion || inv.cliente?.localidad || '-' }}</dd></div></dl></section>
                          <section><h4>Cobro</h4><dl><div><dt>Forma</dt><dd>{{ inv.forma_pago?.nombre || '-' }}</dd></div><div><dt>Cajero</dt><dd>{{ inv.cajero?.nombre || '-' }}</dd></div><div><dt>Zona</dt><dd>{{ inv.zona?.nombre || '-' }}</dd></div><div><dt>Fecha de pago</dt><dd>{{ inv.fecha_pago || '-' }}</dd></div></dl></section>
                          <section><h4>Desglose</h4><dl><div><dt>Subtotal</dt><dd>RD$ {{ inv.sub_total | number:'1.2-2' }}</dd></div><div><dt>Descuento</dt><dd>RD$ {{ inv.descuento | number:'1.2-2' }}</dd></div><div><dt>Impuestos / retención</dt><dd>RD$ {{ (inv.impuestos_total || 0) + (inv.retenciones_total || 0) | number:'1.2-2' }}</dd></div><div><dt>Total / cobrado / saldo</dt><dd>RD$ {{ inv.total | number:'1.2-2' }} · RD$ {{ inv.total_cobrado | number:'1.2-2' }} · RD$ {{ balanceAmount(inv) | number:'1.2-2' }}</dd></div></dl></section>
                        </div>
                        <section class="article-detail"><h4>Conceptos facturados</h4><div>@for (article of inv.articulos || []; track article.id) { <span><b>{{ article.cantidad || 1 }}×</b> {{ article.descripcion || 'Servicio' }} <em>{{ articlePrice(article.precio) }}</em></span> } @empty { <p>Sin artículos detallados.</p> }</div></section>
                      </div>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
        @if (totalPages() > 1) {
          <nav class="pagination" aria-label="Páginas de facturas">
            <button type="button" (click)="previousPage()" [disabled]="page() === 1">Anterior</button>
            <span>Página {{ page() }} de {{ totalPages() }} · {{ filtered().length }} facturas</span>
            <label>Mostrar
              <select [ngModel]="pageSize()" (ngModelChange)="setPageSize($event)">
                <option [ngValue]="25">25</option>
                <option [ngValue]="50">50</option>
                <option [ngValue]="100">100</option>
                <option [ngValue]="250">250</option>
              </select>
            </label>
            <button type="button" (click)="nextPage()" [disabled]="page() === totalPages()">Siguiente</button>
          </nav>
        }
      }

      <div class="sync-bar" [class.visible]="syncing()">
        <div class="spinner small"></div>
        <span>{{ syncMessage() }}</span>
      </div>

      <app-payment-modal
        [visible]="showPayment()"
        [invoice]="selectedInvoice()"
        (onClose)="showPayment.set(false)"
        (onSuccess)="onPaymentSuccess()" />
    </div>
  `,
  styles: [`
    .page { padding: 18px 20px 28px; color: #25364a; }
    button, input, select { font: inherit; }
    button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid rgba(18, 103, 221, 0.2); outline-offset: 1px; }

    .finance-head {
      display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 14px;
    }
    .finance-head > div:first-child { display: grid; gap: 3px; }
    .finance-head > div:first-child > span { color: #1267dd; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .finance-head h2 { margin: 0; color: #132238; font-size: 20px; line-height: 1.2; }
    .finance-head p { margin: 0; color: #718096; font-size: 13px; }
    .history-state {
      display: flex; align-items: center; gap: 9px; min-width: 230px; padding: 8px 10px;
      border: 1px solid #dce5eb; border-radius: 6px; background: #f8fbfa;
    }
    .history-state > i { width: 8px; height: 8px; flex: 0 0 8px; border-radius: 50%; background: #16a34a; box-shadow: 0 0 0 4px #dcfce7; }
    .history-state.error > i { background: #dc2626; box-shadow: 0 0 0 4px #fee2e2; }
    .history-state > span { display: grid; gap: 1px; }
    .history-state b { color: #25364a; font-size: 12px; }
    .history-state small { margin: 0; color: #718096; font-size: 12px; }

    .summary-grid {
      display: grid; grid-template-columns: repeat(6, minmax(135px, 1fr));
      gap: 9px; margin-bottom: 9px;
    }
    .summary-card {
      display: grid; grid-template-columns: 34px minmax(0, 1fr); align-items: start; gap: 10px;
      min-height: 96px; padding: 12px; text-align: left; cursor: pointer;
      border: 1px solid #dce5eb; border-radius: 6px; background: #fff;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    .summary-card:hover { border-color: #a9b9c8; box-shadow: 0 4px 14px rgba(26, 47, 71, 0.08); }
    .summary-card.active { border-color: #1267dd; background: #f6f9ff; box-shadow: inset 0 -2px #1267dd; }
    .summary-card > span:not(.kpi-icon) { display: block; min-width: 0; }
    .summary-card .kpi-icon {
      display: grid; place-items: center; width: 34px; height: 34px; border-radius: 6px;
      background: #eaf2ff; color: #1267dd;
    }
    .summary-card small, .summary-card strong, .summary-card em { display: block; }
    .summary-card small { margin: 0; color: #66788b; font-size: 12px; font-style: normal; font-weight: 800; text-transform: uppercase; white-space: normal; }
    .summary-card strong { margin-top: 5px; color: #12233a; font-size: 20px; line-height: 1.1; overflow-wrap: anywhere; }
    .summary-card em { margin-top: 5px; color: #7b8a99; font-size: 12px; font-style: normal; line-height: 1.25; }
    .summary-card.success .kpi-icon, .summary-card.paid .kpi-icon { color: #0f8a50; background: #e6f6ee; }
    .summary-card.warning .kpi-icon { color: #b45309; background: #fff3dd; }
    .summary-card.danger .kpi-icon { color: #c2413a; background: #fdeceb; }
    .summary-card.evidence .kpi-icon { color: #5b6470; background: #edf1f4; }
    .summary-card.success.active, .summary-card.paid.active { border-color: #16a34a; box-shadow: inset 0 -2px #16a34a; }
    .summary-card.warning.active { border-color: #d97706; box-shadow: inset 0 -2px #d97706; }
    .summary-card.danger.active { border-color: #dc2626; box-shadow: inset 0 -2px #dc2626; }
    .summary-card.evidence.active { border-color: #66788b; box-shadow: inset 0 -2px #66788b; }

    .finance-insights {
      display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 14px;
      border: 1px solid #dce5eb; border-radius: 6px; overflow: hidden; background: #fff;
    }
    .finance-insights > div { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 9px 11px; border-right: 1px solid #e8edf1; color: #66788b; }
    .finance-insights > div:last-child { border-right: 0; }
    .finance-insights svg { flex: 0 0 auto; color: #597087; }
    .finance-insights span { min-width: 0; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .finance-insights b { color: #25364a; }

    .analytics-grid {
      display: grid; grid-template-columns: minmax(360px, 1.7fr) minmax(235px, 0.9fr) minmax(235px, 0.85fr);
      gap: 10px; margin-bottom: 14px;
    }
    .analytics-panel { min-width: 0; min-height: 230px; padding: 13px; border: 1px solid #dce5eb; border-radius: 6px; background: #fff; }
    .analytics-panel > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .analytics-panel > header > div:first-child { display: grid; gap: 2px; }
    .analytics-panel header span { color: #778899; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .analytics-panel h3 { margin: 0; color: #25364a; font-size: 14px; }
    .analytics-panel header > svg { color: #6b7f92; }
    .chart-legend { display: flex !important; align-items: center; gap: 6px !important; color: #718096; font-size: 12px; white-space: nowrap; }
    .chart-legend i { width: 8px; height: 8px; border-radius: 2px; }
    .chart-legend .invoiced, .bar.invoiced { background: #1267dd; }
    .chart-legend .collected, .bar.collected { background: #15a065; }
    .column-chart { display: grid; grid-template-columns: repeat(6, minmax(42px, 1fr)); gap: 9px; height: 175px; padding-top: 4px; border-bottom: 1px solid #dfe7ed; }
    .chart-month { display: grid; grid-template-rows: 128px 18px 15px; min-width: 0; text-align: center; }
    .bar-stage { display: flex; align-items: flex-end; justify-content: center; gap: 3px; height: 128px; border-bottom: 1px dashed #dfe7ed; }
    .bar { width: min(16px, 37%); min-height: 0; border-radius: 3px 3px 0 0; transition: height 0.25s ease; }
    .chart-month > strong { align-self: end; color: #485c70; font-size: 12px; text-transform: capitalize; }
    .chart-month > small { margin: 0; color: #93a1ae; font-size: 11px; }

    .horizontal-bars { display: grid; gap: 13px; }
    .bar-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 10px; }
    .bar-row > div { display: grid; min-width: 0; }
    .bar-row strong { color: #31465b; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-row span { color: #8594a3; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-row > em { align-self: center; color: #4e6275; font-size: 12px; font-style: normal; font-weight: 700; }
    .bar-row > i { grid-column: 1 / -1; display: block; height: 5px; overflow: hidden; border-radius: 3px; background: #edf1f4; }
    .bar-row > i > b { display: block; height: 100%; border-radius: inherit; background: #1267dd; }
    .chart-empty { color: #8594a3; font-size: 11px; }

    .status-chart { display: grid; grid-template-columns: 104px minmax(0, 1fr); align-items: center; gap: 14px; min-height: 160px; }
    .donut { display: grid; place-items: center; width: 104px; height: 104px; border-radius: 50%; }
    .donut::before { content: ''; grid-area: 1 / 1; width: 70px; height: 70px; border-radius: 50%; background: #fff; }
    .donut > span { z-index: 1; grid-area: 1 / 1; display: grid; text-align: center; }
    .donut b { color: #25364a; font-size: 18px; }
    .donut small { margin: 0; color: #8594a3; font-size: 11px; }
    .status-legend { display: grid; gap: 7px; }
    .status-legend > div { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 7px; }
    .status-legend i { width: 8px; height: 8px; border-radius: 2px; }
    .status-legend span { color: #607386; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status-legend b { color: #31465b; font-size: 12px; }

    .toolbar {
      display: grid; grid-template-columns: 1fr;
      align-items: start; gap: 12px; margin-bottom: 14px;
      background: white; border: 1px solid #dce5eb; border-radius: 6px; padding: 12px;
    }
    .search-filter {
      display: grid; grid-template-columns: minmax(280px, 1.65fr) repeat(4, minmax(115px, 0.75fr)) auto;
      align-items: center; gap: 8px;
    }
    .search-input {
      display: flex; align-items: center; gap: 8px;
      background: #f8fafc; border: 1px solid #e2e8f0;
      border-radius: 6px; padding: 10px 12px; color: #94a3b8; min-width: 0;
    }
    .search-input input { border: none; background: none; outline: none; font-size: 14px; color: #334155; width: 100%; }
    .filter-select {
      height: 40px; padding: 8px 10px; border: 1px solid #dce5eb; border-radius: 6px;
      font-size: 13px; color: #334155; background: white; cursor: pointer; outline: none; min-width: 0;
    }
    .advanced-filters {
      display: grid; grid-template-columns: repeat(6, minmax(120px, 1fr)); gap: 10px;
      padding: 12px; border: 1px solid #dce5eb; background: #f7f9fb; border-radius: 6px;
    }
    .advanced-filters label { display: grid; gap: 5px; min-width: 0; }
    .advanced-filters label span { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; }
    .advanced-filters input, .advanced-filters select {
      width: 100%; min-width: 0; height: 38px; padding: 8px 10px; border: 1px solid #cbd5e1;
      border-radius: 8px; background: white; color: #334155; font-size: 13px;
    }
    .clear-advanced { align-self: end; height: 38px; }
    .range-warning { grid-column: 1 / -1; margin: 0; padding: 8px 10px; border: 1px solid #f1d19a; border-radius: 6px; background: #fff6e8; color: #b36b12; font-size: 12px; font-weight: 600; }
    .muted { color: #8a98a5 !important; font-weight: 500 !important; }
    .filter-count {
      display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px;
      border-radius: 999px; background: #1267dd; color: white; font-size: 11px;
    }
    .toolbar-actions { display: flex; align-items: center; justify-content: flex-start; gap: 8px; flex-wrap: wrap; }
    .export-control { display: flex; align-items: stretch; }
    .export-control select {
      border: 1px solid #e2e8f0; border-right: 0; border-radius: 8px 0 0 8px;
      padding: 0 9px; background: #f8fafc; color: #475569; font-weight: 700;
    }
    .export-control .btn { border-radius: 0 8px 8px 0; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      min-height: 40px; padding: 9px 14px; border-radius: 6px;
      font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s;
    }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; }
    .btn-outline:hover { border-color: #1267dd; color: #1267dd; background: #edf4ff; }
    .btn-primary { background: #1267dd; color: white; }
    .btn-primary:hover { background: #0d58c0; }
    .btn:disabled { opacity: 0.5; cursor: default; pointer-events: none; }
    .btn.active { border-color: #1267dd; color: #1267dd; background: #edf4ff; }
    .btn-ghost { background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; padding: 10px 14px; }
    .btn-ghost:hover { background: #f1f5f9; color: #0f172a; }
    .inv-count { font-size: 13px; color: #64748b; font-weight: 500; white-space: nowrap; padding-left: 2px; }

    .comparison-panel {
      margin-bottom: 14px; padding: 14px; background: white; border: 1px solid #cbd5e1;
      border-radius: 6px; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
    }
    .comparison-head, .period-title, .delta-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .comparison-head > div { display: grid; gap: 3px; }
    .comparison-head strong { color: #0f172a; font-size: 15px; }
    .comparison-head span { color: #64748b; font-size: 12px; }
    .period-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
    .period-block { border: 1px solid #e2e8f0; border-left: 4px solid #1267dd; border-radius: 8px; padding: 12px; }
    .period-block.previous { border-left-color: #0f766e; }
    .period-title > div { display: flex; gap: 6px; }
    .period-title input { border: 1px solid #cbd5e1; border-radius: 7px; padding: 7px 8px; color: #334155; }
    .period-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
    .period-metrics span { display: grid; gap: 4px; }
    .period-metrics small { margin: 0; color: #64748b; font-size: 12px; text-transform: uppercase; }
    .period-metrics strong { color: #0f172a; font-size: 14px; overflow-wrap: anywhere; }
    .delta-row { justify-content: flex-start; flex-wrap: wrap; margin-top: 12px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
    .delta-row span { color: #64748b; font-size: 12px; }
    .delta-row strong { margin-left: 5px; }
    .positive { color: #15803d; }
    .negative { color: #dc2626; }

    .results-strip {
      display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)) auto; align-items: center;
      gap: 1px; margin-bottom: 12px; border: 1px solid #dce5eb; border-radius: 6px;
      overflow: hidden; background: #e2e8f0;
    }
    .results-strip > span { display: grid; gap: 3px; min-height: 60px; padding: 10px 13px; background: white; }
    .results-strip small { margin: 0; color: #64748b; font-size: 12px; text-transform: uppercase; }
    .results-strip strong { color: #0f172a; font-size: 15px; }
    .results-strip .balance-value { color: #b91c1c; }
    .results-strip .active-filter-label { display: flex; min-height: 60px; align-items: center; padding: 0 14px; border: 0; background: white; color: #1267dd; font-size: 12px; font-weight: 700; white-space: nowrap; cursor: pointer; }
    .results-strip .active-filter-label:hover { background: #f2f7ff; text-decoration: underline; }

    .selection-bar {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px;
      padding: 10px 12px; border: 1px solid #9ec2ff; border-radius: 6px; background: #eef5ff;
    }
    .selection-bar > div:first-child { display: grid; gap: 2px; }
    .selection-bar strong { color: #172535; font-size: 13px; }
    .selection-bar span { color: #1267dd; font-size: 11px; }
    .selection-actions { display: flex; gap: 7px; flex-wrap: wrap; }
    .selection-actions button {
      border: 1px solid #b9d2f5; border-radius: 7px; background: white; color: #0d58c0;
      padding: 7px 10px; font-size: 11px; font-weight: 700; cursor: pointer;
    }
    .selection-actions .clear-selection { color: #64748b; border-color: #cbd5e1; }

    .table-container {
      background: white; border-radius: 6px;
      border: 1px solid #dce5eb; overflow-x: auto; box-shadow: 0 6px 20px rgba(15, 23, 42, 0.04);
    }
    .pagination {
      display: flex; align-items: center; justify-content: center; gap: 14px;
      padding: 14px; color: #475569; font-size: 13px;
    }
    .pagination button, .pagination select {
      border: 1px solid #cbd5e1; background: white; color: #334155; border-radius: 8px;
      padding: 8px 14px; font-weight: 700; cursor: pointer;
    }
    .pagination label { display: flex; align-items: center; gap: 6px; }
    .pagination select { padding: 7px 9px; }
    .pagination button:disabled { opacity: 0.45; cursor: default; }
    .data-table { width: 100%; border-collapse: collapse; min-width: 1220px; table-layout: fixed; }
    .data-table th {
      text-align: left; font-size: 11px; font-weight: 700; color: #64748b;
      text-transform: uppercase; letter-spacing: 0.04em;
      padding: 12px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
      position: sticky; top: 0; z-index: 1;
    }
    .col-invoice { width: 130px; }
    .col-check { width: 48px; text-align: center !important; }
    .col-check input { width: 16px; height: 16px; accent-color: #1267dd; cursor: pointer; }
    .col-client { width: 230px; }
    .col-dates { width: 190px; }
    .col-payment { width: 160px; }
    .col-total { width: 155px; }
    .col-balance { width: 145px; }
    .col-status { width: 120px; }
    .col-actions { width: 270px; }
    .sortable { cursor: pointer; user-select: none; }
    .sortable:hover, .sortable:focus-visible { color: #1267dd; }

    .data-table td { padding: 12px 14px; font-size: 13px; color: #334155; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    .data-table tr:hover td { background: #fafbfc; }
    .data-table .row-selected td { box-shadow: inset 0 1px #b9d2f5, inset 0 -1px #b9d2f5; background: #edf4ff; }
    .row-pending td { background: #fffdf7; }
    .row-overdue td { background: #fff7f7; }
    .row-pending:hover td, .row-overdue:hover td { background: #fff8ee; }

    .invoice-cell, .client-cell, .date-cell, .payment-cell, .amount-cell, .balance-cell, .status-cell {
      min-width: 0;
    }
    .invoice-id { display: block; color: #1267dd; font-weight: 800; line-height: 1.25; }
    .client-cell span, .payment-cell span, .amount-cell span, .balance-cell span {
      display: block; color: #0f172a; font-weight: 700; line-height: 1.25;
    }
    .date-cell span { display: block; color: #334155; font-weight: 600; line-height: 1.25; }
    small {
      display: block; margin-top: 2px; color: #94a3b8; font-size: 11px; line-height: 1.35;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .discount, .overdue-text { color: #ef4444; }
    .balance-open span { color: #dc2626; }

    .badge {
      display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px;
      font-size: 11px; font-weight: 700; white-space: nowrap;
    }
    .badge-paid { background: #dcfce7; color: #16a34a; }
    .badge-pending { background: #fef3c7; color: #d97706; }
    .badge-overdue { background: #fee2e2; color: #dc2626; }
    .badge-closed { background: #e2e8f0; color: #475569; }
    .badge-default { background: #f1f5f9; color: #64748b; }
    .late-pill {
      display: inline-flex; margin-top: 5px; padding: 2px 7px; border-radius: 999px;
      background: #fee2e2; color: #dc2626; font-size: 12px; font-weight: 700;
    }

    .action-btns { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .btn-icon {
      background: white; border: 1px solid #e2e8f0; border-radius: 8px;
      padding: 6px 8px; cursor: pointer; color: #64748b; transition: all 0.2s;
    }
    .btn-icon:hover { background: #1267dd; color: white; border-color: #1267dd; }
    .btn-print {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 6px 9px; border-radius: 8px; font-size: 11px; font-weight: 700;
      cursor: pointer; transition: all 0.2s; border: 1px solid #e2e8f0; background: white; color: #475569;
    }
    .btn-print:hover { border-color: #1267dd; color: #1267dd; background: #edf4ff; }
    .btn-invoice { color: #1267dd; border-color: #b9d2f5; }
    .btn-receipt { color: #475569; }
    .btn-pay {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 6px 10px; border: none; border-radius: 8px;
      background: #13875a; color: white; font-size: 11px; font-weight: 700;
      cursor: pointer; transition: all 0.2s;
    }
    .btn-pay:hover { background: #0f6f4a; }
    .btn-details svg { transition: transform 0.16s ease; }
    .btn-details svg.rotated { transform: rotate(180deg); }
    .btn-details.active { border-color: #1267dd; color: #0d58c0; background: #f2f7ff; }

    .invoice-detail-row td { padding: 0 !important; border-bottom-color: #ccd8e2 !important; background: #f7fafc !important; }
    .invoice-detail { padding: 16px 18px 18px; border-top: 1px solid #dce5eb; }
    .invoice-detail > header { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
    .invoice-detail > header > div { display: grid; gap: 2px; }
    .invoice-detail > header > div > span { color: #718096; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .invoice-detail > header strong { color: #20354b; font-size: 14px; }
    .detail-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .detail-grid > section { min-width: 0; padding-right: 12px; border-right: 1px solid #dce5eb; }
    .detail-grid > section:last-child { padding-right: 0; border-right: 0; }
    .invoice-detail h4 { margin: 0 0 8px; color: #52677b; font-size: 12px; text-transform: uppercase; }
    .invoice-detail dl { display: grid; gap: 6px; margin: 0; }
    .invoice-detail dl > div { display: grid; grid-template-columns: minmax(72px, 0.8fr) minmax(0, 1.2fr); gap: 8px; }
    .invoice-detail dt { color: #8291a0; font-size: 12px; }
    .invoice-detail dd { min-width: 0; margin: 0; color: #31465b; font-size: 12px; font-weight: 700; overflow-wrap: anywhere; }
    .article-detail { margin-top: 14px; padding-top: 12px; border-top: 1px solid #dce5eb; }
    .article-detail > div { display: flex; gap: 7px; flex-wrap: wrap; }
    .article-detail > div > span { display: inline-flex; align-items: center; gap: 5px; padding: 6px 8px; border: 1px solid #dce5eb; border-radius: 5px; background: #fff; color: #53687c; font-size: 12px; }
    .article-detail em { color: #25364a; font-style: normal; font-weight: 800; }
    .article-detail p { margin: 0; color: #8291a0; font-size: 11px; }

    .loading-state, .empty-state {
      display: flex; flex-direction: column;
      align-items: center; padding: 80px; gap: 12px; color: #94a3b8;
    }
    .empty-state h3 { color: #475569; margin: 8px 0 0; }
    .filtered-empty, .error-state { padding: 52px 24px; background: white; border: 1px solid #dce5eb; border-radius: 6px; }
    .error-state svg { color: #dc2626; }
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

    @media (max-width: 1420px) {
      .summary-grid { grid-template-columns: repeat(3, 1fr); }
      .analytics-grid { grid-template-columns: minmax(360px, 1.5fr) minmax(250px, 1fr); }
      .status-panel { grid-column: 1 / -1; min-height: 0; }
      .status-chart { grid-template-columns: 104px minmax(220px, 1fr); min-height: 112px; }
      .status-legend { grid-template-columns: repeat(3, minmax(120px, 1fr)); }
    }
    @media (max-width: 1200px) {
      .search-filter { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .search-input { grid-column: 1 / -1; }
      .advanced-filters { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .period-metrics { grid-template-columns: repeat(2, 1fr); }
      .detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .detail-grid > section:nth-child(2) { border-right: 0; }
    }
    @media (max-width: 900px) {
      .finance-head { align-items: stretch; flex-direction: column; }
      .history-state { min-width: 0; }
      .finance-insights { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .finance-insights > div:nth-child(2) { border-right: 0; }
      .finance-insights > div:nth-child(-n+2) { border-bottom: 1px solid #e8edf1; }
      .analytics-grid { grid-template-columns: 1fr; }
      .status-panel { grid-column: auto; }
      .status-legend { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      .page { padding: 14px; }
      .summary-grid { grid-template-columns: repeat(2, 1fr); }
      .summary-card { min-width: 0; padding: 10px 11px; }
      .summary-card strong { font-size: 18px; overflow-wrap: anywhere; }
      .analytics-panel { min-height: 0; }
      .column-chart { gap: 5px; }
      .chart-month { grid-template-rows: 112px 18px 15px; }
      .bar-stage { height: 112px; }
      .toolbar, .search-filter, .toolbar-actions { width: 100%; grid-template-columns: 1fr; }
      .search-input, .filter-select, .btn-ghost { width: 100%; }
      .search-filter > .btn-ghost { grid-column: 1 / -1; }
      .toolbar-actions { display: grid; grid-template-columns: 1fr 1fr !important; gap: 8px; }
      .toolbar-actions .btn, .export-control { width: 100%; min-width: 0; }
      .export-control select { min-width: 78px; width: 78px; flex: 0 0 78px; }
      .toolbar-actions .inv-count { grid-column: 1 / -1; }
      .btn { justify-content: center; padding-inline: 12px; }
      .advanced-filters, .period-grid, .results-strip { grid-template-columns: 1fr; }
      .period-title, .comparison-head, .selection-bar { align-items: stretch; flex-direction: column; }
      .period-title > div { display: grid; grid-template-columns: 1fr 1fr; }
      .period-title input { width: 100%; min-width: 0; }
      .results-strip .active-filter-label { min-height: 42px; }
      .selection-actions { display: grid; grid-template-columns: 1fr 1fr; }
      .data-table { min-width: 1120px; }
      .detail-grid { grid-template-columns: 1fr; }
      .detail-grid > section { padding-right: 0; padding-bottom: 10px; border-right: 0; border-bottom: 1px solid #dce5eb; }
      .detail-grid > section:last-child { padding-bottom: 0; border-bottom: 0; }
      .sync-bar { left: 0; }
    }
    @media (max-width: 480px) {
      .finance-head h2 { font-size: 18px; }
      .summary-grid, .finance-insights { grid-template-columns: 1fr; }
      .finance-insights > div { border-right: 0; border-bottom: 1px solid #e8edf1; }
      .finance-insights > div:last-child { border-bottom: 0; }
      .summary-card { min-height: 82px; }
      .status-chart { grid-template-columns: 1fr; justify-items: center; }
      .status-legend { width: 100%; grid-template-columns: 1fr 1fr; }
      .toolbar-actions { grid-template-columns: 1fr !important; }
      .toolbar-actions .inv-count { grid-column: auto; }
      .results-strip > span { min-height: 52px; }
      .pagination { flex-wrap: wrap; gap: 8px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .summary-card, .bar, .btn-details svg, .sync-bar { transition: none; }
      .spinner { animation-duration: 1.8s; }
    }
  `]
})
export class InvoicesComponent implements OnInit {
  private localDb = inject(LocalDbService);
  private serverDb = inject(DbService);
  private exportSvc = inject(ExportService);
  private receiptSvc = inject(ReceiptService);
  private toast = inject(ToastService);

  allInvoices = signal<Invoice[]>([]);
  filtered = signal<Invoice[]>([]);
  page = signal(1);
  pageSize = signal(50);
  totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));
  pagedInvoices = computed(() => {
    const start = (this.page() - 1) * this.pageSize();
    return this.filtered().slice(start, start + this.pageSize());
  });
  allPaymentMethods = signal<string[]>([]);
  allZones = signal<string[]>([]);
  allCashiers = signal<string[]>([]);
  allTypes = signal<number[]>([]);
  loading = signal(true);
  loadError = signal('');
  syncing = signal(false);
  syncMessage = signal('');
  searchTerm = '';
  statusFilter = '';
  dateFilter = '';
  paymentFilter = '';
  zoneFilter = '';
  cashierFilter = '';
  typeFilter = '';
  evidenceFilter = '';
  discountFilter = '';
  dateField: InvoiceDateField = 'fecha_emision';
  dateFrom = '';
  dateTo = '';
  minTotal: number | null = null;
  maxTotal: number | null = null;
  minBalance: number | null = null;
  maxBalance: number | null = null;
  showAdvanced = false;
  showComparison = false;
  exportFormat: InvoiceExportFormat = 'excel';
  quickFilter: InvoiceQuickFilter = 'all';
  sortCol = '';
  sortDir: 'asc' | 'desc' = 'asc';

  totalFacturado = signal(0);
  totalCobrado = signal(0);
  totalPendiente = signal(0);
  countPagadas = signal(0);
  countPendientes = signal(0);
  countCollected = signal(0);
  countOverdue = signal(0);
  overdueBalance = signal(0);
  averageTicket = signal(0);
  totalDiscounts = signal(0);
  countPartialPayments = signal(0);
  countWithoutEvidence = signal(0);
  visibleStats = signal<InvoiceMetrics>({ count: 0, invoiced: 0, collected: 0, balance: 0 });
  currentMonthMetrics = computed(() => this.metricsFor(this.allInvoices().filter((invoice) => this.isSameMonth(invoice.fecha_emision))));
  monthlyTrend = computed<InvoiceTrendPoint[]>(() => this.buildMonthlyTrend(this.filtered()));
  trendMax = computed(() => Math.max(1, ...this.monthlyTrend().flatMap((point) => [point.invoiced, point.collected])));
  paymentBreakdown = computed<InvoiceBreakdown[]>(() => this.buildPaymentBreakdown(this.filtered()));
  statusBreakdown = computed<InvoiceBreakdown[]>(() => this.buildStatusBreakdown(this.filtered()));
  statusConic = computed(() => {
    const items = this.statusBreakdown().filter((item) => item.share > 0);
    if (!items.length) return '#e7ecef';
    let start = 0;
    const stops = items.map((item) => {
      const end = start + item.share;
      const stop = `${item.color} ${start}% ${end}%`;
      start = end;
      return stop;
    });
    return `conic-gradient(${stops.join(', ')})`;
  });

  selectedIds = signal<Set<number>>(new Set());
  selectedInvoices = computed(() => {
    const ids = this.selectedIds();
    return this.allInvoices().filter((invoice) => ids.has(invoice.id_factura));
  });
  selectedTotal = computed(() => this.selectedInvoices().reduce((sum, invoice) => sum + (invoice.total || 0), 0));
  selectedBalance = computed(() => this.selectedInvoices().reduce((sum, invoice) => sum + this.balanceAmount(invoice), 0));

  compareFromA = '';
  compareToA = '';
  compareFromB = '';
  compareToB = '';
  comparisonA = signal<InvoiceMetrics>({ count: 0, invoiced: 0, collected: 0, balance: 0 });
  comparisonB = signal<InvoiceMetrics>({ count: 0, invoiced: 0, collected: 0, balance: 0 });

  showPayment = signal(false);
  selectedInvoice = signal<Invoice | null>(null);
  expandedInvoiceId = signal<number | null>(null);

  openPayment(inv: Invoice) {
    this.selectedInvoice.set(inv);
    this.showPayment.set(true);
  }

  onPaymentSuccess() {
    void this.refreshInvoices();
  }

  async ngOnInit() {
    this.setDefaultComparison();
    await this.loadInvoices(true);
  }

  async loadInvoices(forceRefresh = false) {
    this.loading.set(true);
    this.loadError.set('');
    try {
      const invoices = await this.localDb.getInvoices(forceRefresh);
      this.setInvoices(invoices);
    } catch {
      this.loadError.set('No fue posible consultar las facturas guardadas. Revisa la conexión con el servidor y vuelve a intentarlo.');
    } finally {
      this.loading.set(false);
    }
  }

  private setInvoices(invoices: Invoice[]) {
    this.page.set(1);
    this.allInvoices.set(invoices);
    const availableIds = new Set(invoices.map((invoice) => invoice.id_factura));
    this.selectedIds.update((ids) => new Set([...ids].filter((id) => availableIds.has(id))));
    this.computeStats(invoices);
    this.computeFilterLists(invoices);
    this.filterInvoices();
    this.updateComparison();
  }

  computeStats(invoices: Invoice[]) {
    const total = invoices.reduce((sum, invoice) => sum + (invoice.total || 0), 0);
    const invoicesWithTotal = invoices.filter((invoice) => (invoice.total || 0) > 0);
    const overdue = invoices.filter((invoice) => this.isOverdue(invoice));
    this.totalFacturado.set(total);
    this.totalCobrado.set(invoices.reduce((s, i) => s + (i.total_cobrado || 0), 0));
    this.totalPendiente.set(invoices.reduce((s, i) => s + this.balanceAmount(i), 0));
    this.countPagadas.set(invoices.filter(i => this.isPaid(i)).length);
    this.countPendientes.set(invoices.filter(i => this.isPending(i)).length);
    this.countCollected.set(invoices.filter(i => this.isPaid(i) || (i.total_cobrado || 0) > 0).length);
    this.countOverdue.set(overdue.length);
    this.overdueBalance.set(overdue.reduce((sum, invoice) => sum + this.balanceAmount(invoice), 0));
    this.averageTicket.set(invoicesWithTotal.length ? total / invoicesWithTotal.length : 0);
    this.totalDiscounts.set(invoices.reduce((sum, invoice) => sum + (invoice.descuento || 0), 0));
    this.countPartialPayments.set(invoices.filter((invoice) => this.isPartialPayment(invoice)).length);
    this.countWithoutEvidence.set(invoices.filter((invoice) => !this.hasPaymentEvidence(invoice)).length);
  }

  collectionRate(): number {
    return this.totalFacturado() > 0 ? (this.totalCobrado() / this.totalFacturado()) * 100 : 0;
  }

  paidRate(): number {
    return this.allInvoices().length ? (this.countPagadas() / this.allInvoices().length) * 100 : 0;
  }

  trendHeight(value: number): number {
    if (value <= 0) return 0;
    return Math.max(5, (value / this.trendMax()) * 100);
  }

  toggleDetails(idFactura: number) {
    this.expandedInvoiceId.update((current) => current === idFactura ? null : idFactura);
  }

  private computeFilterLists(invoices: Invoice[]) {
    const methods = [...new Set(invoices.map(i => i.forma_pago?.nombre).filter(Boolean) as string[])].sort();
    const zones = [...new Set(invoices.map(i => i.zona?.nombre).filter(Boolean) as string[])].sort();
    const cashiers = [...new Set(invoices.map(i => i.cajero?.nombre).filter(Boolean) as string[])].sort();
    const types = [...new Set(invoices.map(i => i.tipo).filter((type) => type != null))].sort((a, b) => a - b);
    this.allPaymentMethods.set(methods);
    this.allZones.set(zones);
    this.allCashiers.set(cashiers);
    this.allTypes.set(types);
  }

  filterInvoices() {
    let result = this.allInvoices();
    const terms = this.normalize(this.searchTerm).split(/\s+/).filter(Boolean);

    if (terms.length) {
      result = result.filter((invoice) => {
        const text = this.searchText(invoice);
        return terms.every((term) => text.includes(term));
      });
    }

    if (this.quickFilter === 'paid') {
      result = result.filter(i => this.isPaid(i));
    } else if (this.quickFilter === 'pending' || this.quickFilter === 'open') {
      result = result.filter(i => this.isPending(i));
    } else if (this.quickFilter === 'collected') {
      result = result.filter(i => this.isPaid(i) || (i.total_cobrado || 0) > 0);
    } else if (this.quickFilter === 'overdue') {
      result = result.filter(i => this.isOverdue(i));
    } else if (this.quickFilter === 'missing_evidence') {
      result = result.filter(i => !this.hasPaymentEvidence(i));
    }

    if (this.statusFilter === 'pagada') {
      result = result.filter(i => this.isPaid(i));
    } else if (this.statusFilter === 'pendiente') {
      result = result.filter(i => this.isPending(i));
    } else if (this.statusFilter === 'vencida') {
      result = result.filter(i => this.isOverdue(i));
    } else if (this.statusFilter === 'partial') {
      result = result.filter(i => this.isPending(i) && (i.total_cobrado || 0) > 0);
    } else if (this.statusFilter === 'closed') {
      result = result.filter(i => this.isClosedWithoutPayment(i));
    }

    if (this.dateFilter === 'overdue') {
      result = result.filter(i => this.isOverdue(i));
    } else if (this.dateFilter === 'due7') {
      result = result.filter(i => this.isDueWithinDays(i, 7));
    } else if (this.dateFilter === 'issued-today') {
      result = result.filter(i => this.isToday(i.fecha_emision));
    } else if (this.dateFilter === 'issued-30') {
      result = result.filter(i => this.isWithinPastDays(i.fecha_emision, 30));
    } else if (this.dateFilter === 'issued-month') {
      result = result.filter(i => this.isSameMonth(i.fecha_emision));
    } else if (this.dateFilter === 'issued-year') {
      result = result.filter(i => this.isSameYear(i.fecha_emision));
    } else if (this.dateFilter === 'paid-month') {
      result = result.filter(i => this.isSameMonth(i.fecha_pago));
    }

    if (this.paymentFilter) {
      result = result.filter(i => i.forma_pago?.nombre === this.paymentFilter);
    }

    if (this.zoneFilter) {
      result = result.filter(i => i.zona?.nombre === this.zoneFilter);
    }

    if (this.cashierFilter) {
      result = result.filter(i => i.cajero?.nombre === this.cashierFilter);
    }

    if (this.typeFilter !== '') {
      result = result.filter(i => String(i.tipo) === String(this.typeFilter));
    }

    if (this.evidenceFilter === 'reference') {
      result = result.filter(i => Boolean(String(i.referencia || '').trim()));
    } else if (this.evidenceFilter === 'proof') {
      result = result.filter(i => Boolean(String(i.comprobante_pago || '').trim()));
    } else if (this.evidenceFilter === 'missing') {
      result = result.filter(i => !this.hasPaymentEvidence(i));
    }

    if (this.discountFilter === 'with') {
      result = result.filter(i => (i.descuento || 0) > 0);
    } else if (this.discountFilter === 'without') {
      result = result.filter(i => (i.descuento || 0) <= 0);
    }

    if (this.dateFrom || this.dateTo) {
      result = result.filter((invoice) => this.isDateInRange(invoice[this.dateField], this.dateFrom, this.dateTo));
    }

    if (this.hasNumericFilter(this.minTotal)) result = result.filter(i => (i.total || 0) >= Number(this.minTotal));
    if (this.hasNumericFilter(this.maxTotal)) result = result.filter(i => (i.total || 0) <= Number(this.maxTotal));
    if (this.hasNumericFilter(this.minBalance)) result = result.filter(i => this.balanceAmount(i) >= Number(this.minBalance));
    if (this.hasNumericFilter(this.maxBalance)) result = result.filter(i => this.balanceAmount(i) <= Number(this.maxBalance));

    if (this.sortCol) {
      result = [...result].sort((a, b) => {
        const valA = this.getNestedVal(a, this.sortCol);
        const valB = this.getNestedVal(b, this.sortCol);
        if (valA == null) return 1;
        if (valB == null) return -1;
        const nA = parseFloat(valA), nB = parseFloat(valB);
        const cmp = (!isNaN(nA) && !isNaN(nB)) ? nA - nB : String(valA).localeCompare(String(valB), 'es');
        return this.sortDir === 'asc' ? cmp : -cmp;
      });
    }

    this.filtered.set(result);
    this.visibleStats.set(this.metricsFor(result));
    this.page.set(1);
    if (this.expandedInvoiceId() != null && !result.some((invoice) => invoice.id_factura === this.expandedInvoiceId())) {
      this.expandedInvoiceId.set(null);
    }
  }

  setQuickFilter(filter: InvoiceQuickFilter) {
    this.quickFilter = filter;
    this.filterInvoices();
  }

  clearFilters() {
    this.searchTerm = '';
    this.statusFilter = '';
    this.dateFilter = '';
    this.paymentFilter = '';
    this.zoneFilter = '';
    this.cashierFilter = '';
    this.typeFilter = '';
    this.evidenceFilter = '';
    this.discountFilter = '';
    this.dateField = 'fecha_emision';
    this.dateFrom = '';
    this.dateTo = '';
    this.minTotal = null;
    this.maxTotal = null;
    this.minBalance = null;
    this.maxBalance = null;
    this.quickFilter = 'all';
    this.filterInvoices();
  }

  sort(col: string) {
    if (this.sortCol === col) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
    else { this.sortCol = col; this.sortDir = 'asc'; }
    this.filterInvoices();
  }

  ariaSort(col: string): 'ascending' | 'descending' | null {
    if (this.sortCol !== col) return null;
    return this.sortDir === 'asc' ? 'ascending' : 'descending';
  }

  trendTitle(point: InvoiceTrendPoint): string {
    return `${point.label}: facturado ${this.money(point.invoiced)} · cobrado ${this.money(point.collected)} · ${point.count} facturas`;
  }

  /** Precio de un artículo (texto de WispHub) formateado para mostrar. */
  articlePrice(value: string | number | null | undefined): string {
    const text = String(value ?? '').trim();
    const amount = Number(text.replace(/[^0-9.-]/g, ''));
    return text && Number.isFinite(amount) ? this.money(amount) : (text || '—');
  }

  /** Avisos de rangos invertidos en los filtros avanzados (no bloquean el filtro). */
  rangeWarning(): string {
    const issues: string[] = [];
    if (this.dateFrom && this.dateTo && this.dateFrom > this.dateTo) issues.push('la fecha «Desde» es posterior a «Hasta»');
    if (this.hasNumericFilter(this.minTotal) && this.hasNumericFilter(this.maxTotal) && Number(this.minTotal) > Number(this.maxTotal)) issues.push('el total mínimo es mayor que el máximo');
    if (this.hasNumericFilter(this.minBalance) && this.hasNumericFilter(this.maxBalance) && Number(this.minBalance) > Number(this.maxBalance)) issues.push('el saldo mínimo es mayor que el máximo');
    return issues.length ? `Revisa los filtros: ${issues.join('; ')}. Así no aparecerá ninguna factura.` : '';
  }

  sortIcon(col: string): string {
    if (this.sortCol !== col) return '';
    return this.sortDir === 'asc' ? '\u25B2' : '\u25BC';
  }

  async syncInvoices() {
    this.syncing.set(true);
    this.syncMessage.set('Preparando el historial completo de WispHub...');
    try {
      await firstValueFrom(this.serverDb.startInvoiceHistorySync());
      const deadline = Date.now() + 15 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const status = await firstValueFrom(this.serverDb.getInvoiceHistorySyncStatus());
        this.syncMessage.set(
          status.running
            ? `Importando historial ${status.windowsCompleted}/${status.windowsTotal} · ${status.saved} facturas`
            : 'Actualizando la lista de facturas...',
        );
        if (!status.running) {
          if (status.status === 'error') throw new Error(status.error || 'No se pudo importar el historial');
          const invoices = await this.localDb.getInvoices(true);
          this.setInvoices(invoices);
          await this.localDb.updateSyncLog('invoices');
          this.toast.success(`${invoices.length} facturas cargadas`);
          return;
        }
      }
      throw new Error('La importación continúa en el servidor; vuelve a consultar en unos minutos.');
    } catch (error: any) {
      this.toast.error(error?.error?.error || error?.message || 'No se pudo sincronizar el historial');
    } finally {
      this.syncing.set(false);
    }
  }

  private async refreshInvoices() {
    const invoices = await this.localDb.getInvoices(true);
    this.setInvoices(invoices);
  }

  previousPage() {
    this.page.update((value) => Math.max(1, value - 1));
  }

  nextPage() {
    this.page.update((value) => Math.min(this.totalPages(), value + 1));
  }

  setPageSize(value: number) {
    this.pageSize.set(Number(value) || 100);
    this.page.set(1);
  }

  isSelected(invoice: Invoice): boolean {
    return this.selectedIds().has(invoice.id_factura);
  }

  toggleInvoice(invoice: Invoice) {
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      if (next.has(invoice.id_factura)) next.delete(invoice.id_factura);
      else next.add(invoice.id_factura);
      return next;
    });
  }

  isPageSelected(): boolean {
    const page = this.pagedInvoices();
    return page.length > 0 && page.every((invoice) => this.selectedIds().has(invoice.id_factura));
  }

  isPagePartiallySelected(): boolean {
    const selected = this.pagedInvoices().filter((invoice) => this.selectedIds().has(invoice.id_factura)).length;
    return selected > 0 && selected < this.pagedInvoices().length;
  }

  togglePageSelection() {
    const page = this.pagedInvoices();
    const remove = this.isPageSelected();
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      for (const invoice of page) {
        if (remove) next.delete(invoice.id_factura);
        else next.add(invoice.id_factura);
      }
      return next;
    });
  }

  selectAllFiltered() {
    this.selectedIds.set(new Set(this.filtered().map((invoice) => invoice.id_factura)));
  }

  clearSelection() {
    this.selectedIds.set(new Set());
  }

  printReceipt(inv: Invoice) {
    this.receiptSvc.openReceiptPreview(inv);
  }

  printInvoice(inv: Invoice) {
    this.receiptSvc.openInvoicePreview(inv);
  }

  printSelected(mode: 'invoice' | 'receipt') {
    const invoices = this.selectedInvoices();
    if (!invoices.length) return;
    const limit = 100;
    if (invoices.length > limit) {
      this.toast.error(`Selecciona hasta ${limit} documentos por lote para evitar bloquear el navegador`);
      return;
    }
    this.receiptSvc.printBatch(invoices, mode);
  }

  exportInvoices(selectionOnly = false) {
    const invoices = selectionOnly ? this.selectedInvoices() : this.filtered();
    if (!invoices.length) return;
    const filename = selectionOnly ? 'facturas_seleccionadas' : 'facturas_filtradas';
    const columns = this.exportColumns();
    if (this.exportFormat === 'csv') this.exportSvc.exportCSV(invoices, filename, columns);
    else this.exportSvc.exportExcel(invoices, filename, columns);
    this.toast.success(`${invoices.length} facturas exportadas`);
  }

  private exportColumns(): ExportColumn[] {
    return [
      { key: 'id_factura', label: '# Factura' },
      { key: 'tipo', label: 'Tipo' },
      { key: 'cliente.nombre', label: 'Cliente' },
      { key: 'cliente.usuario', label: 'Usuario' },
      { key: 'cliente.telefono', label: 'Teléfono' },
      { key: 'cliente.cedula', label: 'Cédula' },
      { key: 'cliente.email', label: 'Correo' },
      { key: 'cliente.direccion', label: 'Dirección' },
      { key: 'referencia', label: 'Referencia' },
      { key: 'comprobante_pago', label: 'Comprobante' },
      { key: 'folio', label: 'Folio' },
      { key: 'fecha_emision', label: 'Emisión' },
      { key: 'fecha_vencimiento', label: 'Vencimiento' },
      { key: 'fecha_pago', label: 'Pago' },
      { key: 'forma_pago.nombre', label: 'Forma de pago' },
      { key: 'zona.nombre', label: 'Zona' },
      { key: 'cajero.nombre', label: 'Cajero' },
      { key: 'sub_total', label: 'Subtotal' },
      { key: 'descuento', label: 'Descuento' },
      { key: 'impuestos_total', label: 'Impuestos' },
      { key: 'retenciones_total', label: 'Retenciones' },
      { key: 'total', label: 'Total' },
      { key: 'total_cobrado', label: 'Cobrado' },
      { key: 'saldo', label: 'Saldo', transform: (_value, row) => this.balanceAmount(row) },
      { key: 'estado', label: 'Estado' },
      { key: 'articulos', label: 'Artículos', transform: (_value, row) => this.articleSummary(row) },
    ];
  }

  printFilteredReport() {
    const invoices = this.filtered();
    if (!invoices.length) return;
    const printLimit = 1000;
    const printable = invoices.slice(0, printLimit);
    const stats = this.metricsFor(invoices);
    const rows = printable.map((invoice) => `<tr>
      <td>#${invoice.id_factura}</td>
      <td>${this.escapeHtml(invoice.cliente?.nombre || '-')}</td>
      <td>${this.escapeHtml(invoice.fecha_emision || '-')}</td>
      <td>${this.escapeHtml(invoice.fecha_vencimiento || '-')}</td>
      <td>${this.escapeHtml(invoice.estado || 'Pendiente')}</td>
      <td class="number">${this.money(invoice.total)}</td>
      <td class="number">${this.money(invoice.total_cobrado)}</td>
      <td class="number">${this.money(this.balanceAmount(invoice))}</td>
    </tr>`).join('');
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Listado de facturas</title><style>
      @page{size:landscape;margin:12mm}body{font-family:Arial,sans-serif;color:#0f172a;font-size:10px}h1{font-size:20px;margin:0 0 4px}.meta{color:#64748b;margin-bottom:14px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}.summary div{border:1px solid #cbd5e1;padding:8px}.summary small{display:block;color:#64748b;text-transform:uppercase}.summary strong{display:block;margin-top:4px;font-size:14px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #e2e8f0;padding:6px;text-align:left}th{background:#f1f5f9;text-transform:uppercase}.number{text-align:right;white-space:nowrap}.warning{color:#b45309;margin:8px 0}
    </style></head><body><h1>Listado de facturas</h1><div class="meta">Generado ${this.escapeHtml(new Date().toLocaleString('es-DO'))} | ${stats.count} resultados | ${this.escapeHtml(this.filterDescription())}</div>
    <div class="summary"><div><small>Facturas</small><strong>${stats.count}</strong></div><div><small>Facturado</small><strong>${this.money(stats.invoiced)}</strong></div><div><small>Cobrado</small><strong>${this.money(stats.collected)}</strong></div><div><small>Saldo</small><strong>${this.money(stats.balance)}</strong></div></div>
    ${invoices.length > printLimit ? `<p class="warning">El listado impreso contiene las primeras ${printLimit} facturas. La exportación conserva las ${invoices.length}.</p>` : ''}
    <table><thead><tr><th>Factura</th><th>Cliente</th><th>Emisión</th><th>Vencimiento</th><th>Estado</th><th class="number">Total</th><th class="number">Cobrado</th><th class="number">Saldo</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=function(){window.print();}</script></body></html>`;
    const win = window.open('', '_blank', 'width=1200,height=900');
    if (win) { win.document.write(html); win.document.close(); }
  }

  activeAdvancedFilterCount(): number {
    return [
      this.cashierFilter,
      this.typeFilter,
      this.evidenceFilter,
      this.discountFilter,
      this.dateFrom,
      this.dateTo,
      this.hasNumericFilter(this.minTotal),
      this.hasNumericFilter(this.maxTotal),
      this.hasNumericFilter(this.minBalance),
      this.hasNumericFilter(this.maxBalance),
    ].filter(Boolean).length;
  }

  activeFilterCount(): number {
    return this.activeAdvancedFilterCount() + [
      this.searchTerm,
      this.statusFilter,
      this.dateFilter,
      this.paymentFilter,
      this.zoneFilter,
      this.quickFilter !== 'all',
    ].filter(Boolean).length;
  }

  setDefaultComparison() {
    const now = new Date();
    const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    this.compareFromA = this.toInputDate(currentStart);
    this.compareToA = this.toInputDate(currentEnd);
    this.compareFromB = this.toInputDate(previousStart);
    this.compareToB = this.toInputDate(previousEnd);
    this.updateComparison();
  }

  updateComparison() {
    const invoices = this.allInvoices();
    this.comparisonA.set(this.metricsFor(invoices.filter((invoice) => this.isDateInRange(invoice.fecha_emision, this.compareFromA, this.compareToA))));
    this.comparisonB.set(this.metricsFor(invoices.filter((invoice) => this.isDateInRange(invoice.fecha_emision, this.compareFromB, this.compareToB))));
  }

  comparisonDelta(metric: keyof InvoiceMetrics): number {
    const current = this.comparisonA()[metric];
    const previous = this.comparisonB()[metric];
    if (previous === 0) return current === 0 ? 0 : 100;
    return ((current - previous) / Math.abs(previous)) * 100;
  }

  comparisonDeltaLabel(metric: keyof InvoiceMetrics): string {
    const value = this.comparisonDelta(metric);
    return `${value > 0 ? '+' : ''}${value.toLocaleString('es-DO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }

  private metricsFor(invoices: Invoice[]): InvoiceMetrics {
    return {
      count: invoices.length,
      invoiced: invoices.reduce((sum, invoice) => sum + (invoice.total || 0), 0),
      collected: invoices.reduce((sum, invoice) => sum + (invoice.total_cobrado || 0), 0),
      balance: invoices.reduce((sum, invoice) => sum + this.balanceAmount(invoice), 0),
    };
  }

  private buildMonthlyTrend(invoices: Invoice[]): InvoiceTrendPoint[] {
    const now = new Date();
    const months: InvoiceTrendPoint[] = [];
    const lookup = new Map<string, InvoiceTrendPoint>();
    for (let offset = 5; offset >= 0; offset--) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const point: InvoiceTrendPoint = {
        key,
        label: date.toLocaleDateString('es-DO', { month: 'short' }).replace('.', ''),
        count: 0,
        invoiced: 0,
        collected: 0,
      };
      months.push(point);
      lookup.set(key, point);
    }
    for (const invoice of invoices) {
      const date = this.parseDate(invoice.fecha_emision);
      if (!date) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const point = lookup.get(key);
      if (!point) continue;
      point.count += 1;
      point.invoiced += invoice.total || 0;
      point.collected += invoice.total_cobrado || 0;
    }
    return months;
  }

  private buildPaymentBreakdown(invoices: Invoice[]): InvoiceBreakdown[] {
    const groups = new Map<string, { count: number; amount: number }>();
    for (const invoice of invoices) {
      const label = invoice.forma_pago?.nombre?.trim() || 'Sin forma registrada';
      const current = groups.get(label) || { count: 0, amount: 0 };
      current.count += 1;
      current.amount += invoice.total_cobrado || 0;
      groups.set(label, current);
    }
    const sorted = [...groups.entries()]
      .map(([label, value]) => ({ label, ...value }))
      .sort((a, b) => b.amount - a.amount || b.count - a.count);
    const primary = sorted.slice(0, 4);
    if (sorted.length > 4) {
      primary.push(sorted.slice(4).reduce((other, item) => ({
        label: 'Otros', count: other.count + item.count, amount: other.amount + item.amount,
      }), { label: 'Otros', count: 0, amount: 0 }));
    }
    const totalAmount = primary.reduce((sum, item) => sum + item.amount, 0);
    const totalCount = primary.reduce((sum, item) => sum + item.count, 0);
    return primary.map((item) => ({
      ...item,
      share: totalAmount > 0 ? (item.amount / totalAmount) * 100 : totalCount > 0 ? (item.count / totalCount) * 100 : 0,
    }));
  }

  private buildStatusBreakdown(invoices: Invoice[]): InvoiceBreakdown[] {
    const definitions = [
      { label: 'Pagadas', color: '#13875a', test: (invoice: Invoice) => this.isPaid(invoice) },
      { label: 'Parciales', color: '#c27a18', test: (invoice: Invoice) => this.isPartialPayment(invoice) },
      { label: 'Pendientes', color: '#b42318', test: (invoice: Invoice) => this.isPending(invoice) && !this.isPartialPayment(invoice) },
      { label: 'Cerradas', color: '#6b7a86', test: (invoice: Invoice) => this.isClosedWithoutPayment(invoice) },
    ];
    const assigned = new Set<number>();
    const results = definitions.map((definition) => {
      const matches = invoices.filter((invoice) => {
        if (assigned.has(invoice.id_factura) || !definition.test(invoice)) return false;
        assigned.add(invoice.id_factura);
        return true;
      });
      return {
        label: definition.label,
        color: definition.color,
        count: matches.length,
        amount: matches.reduce((sum, invoice) => sum + (invoice.total || 0), 0),
        share: invoices.length ? (matches.length / invoices.length) * 100 : 0,
      };
    });
    const other = invoices.filter((invoice) => !assigned.has(invoice.id_factura));
    if (other.length) results.push({
      label: 'Otros', color: '#1267dd', count: other.length,
      amount: other.reduce((sum, invoice) => sum + (invoice.total || 0), 0),
      share: invoices.length ? (other.length / invoices.length) * 100 : 0,
    });
    return results.filter((item) => item.count > 0);
  }

  private isPartialPayment(invoice: Invoice): boolean {
    const collected = invoice.total_cobrado || 0;
    return !this.isClosedWithoutPayment(invoice) && collected > 0 && collected < (invoice.total || 0) - 0.01;
  }

  private hasPaymentEvidence(invoice: Invoice): boolean {
    return Boolean(String(invoice.referencia || '').trim() || String(invoice.comprobante_pago || '').trim());
  }

  private filterDescription(): string {
    const parts = [
      this.searchTerm ? `Búsqueda: ${this.searchTerm}` : '',
      this.statusFilter ? `Estado: ${this.optionLabel(InvoicesComponent.STATUS_LABELS, this.statusFilter)}` : '',
      this.dateFilter ? `Período: ${this.optionLabel(InvoicesComponent.DATE_FILTER_LABELS, this.dateFilter)}` : '',
      this.paymentFilter ? `Pago: ${this.paymentFilter}` : '',
      this.zoneFilter ? `Zona: ${this.zoneFilter}` : '',
      this.cashierFilter ? `Cajero: ${this.cashierFilter}` : '',
      this.dateFrom ? `Desde: ${this.dateFrom}` : '',
      this.dateTo ? `Hasta: ${this.dateTo}` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' | ') : 'Sin filtros';
  }

  private static readonly STATUS_LABELS: Record<string, string> = {
    pagada: 'Pagadas', pendiente: 'Pendientes', vencida: 'Vencidas', partial: 'Cobro parcial', closed: 'Canceladas o transferidas',
  };

  private static readonly DATE_FILTER_LABELS: Record<string, string> = {
    overdue: 'Vencidas', due7: 'Vencen en 7 días', 'issued-today': 'Emitidas hoy', 'issued-30': 'Emitidas últimos 30 días',
    'issued-month': 'Emitidas este mes', 'issued-year': 'Emitidas este año', 'paid-month': 'Pagadas este mes',
  };

  private optionLabel(labels: Record<string, string>, value: string): string {
    return labels[value] || value;
  }

  private articleSummary(invoice: Invoice): string {
    return (invoice.articulos || [])
      .map((article) => `${article.cantidad || 1} x ${article.descripcion || 'Servicio'}`)
      .join(' | ');
  }

  private money(value: number): string {
    return `RD$ ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  getStatusClass(invoice: Invoice): string {
    if (this.isClosedWithoutPayment(invoice)) return 'closed';
    if (this.isPaid(invoice)) return 'paid';
    if (this.isOverdue(invoice)) return 'overdue';
    if (this.isPending(invoice)) return 'pending';
    return 'default';
  }

  statusLabel(inv: Invoice): string {
    if (this.isClosedWithoutPayment(inv)) return inv.estado || 'Cerrada';
    if (this.isPaid(inv)) return this.normalize(inv.estado).includes('pagad') ? (inv.estado || 'Pagada') : 'Cobro completo';
    if (this.isOverdue(inv)) return 'Pendiente vencida';
    return inv.estado || 'Pendiente';
  }

  isPaid(inv: Invoice): boolean {
    if (this.isClosedWithoutPayment(inv)) return false;
    if (this.normalize(inv.estado).includes('pagad')) return true;
    return Boolean(inv.fecha_pago) && (inv.total || 0) > 0 && (inv.total_cobrado || 0) >= (inv.total || 0) - 0.01;
  }

  isPending(inv: Invoice): boolean {
    return !this.isPaid(inv) && !this.isClosedWithoutPayment(inv) && this.balanceAmount(inv) > 0;
  }

  private isClosedWithoutPayment(inv: Invoice): boolean {
    const status = this.normalize(inv.estado);
    return status.includes('cancelad') || status.includes('anulad') || status.includes('transfer');
  }

  isOverdue(inv: Invoice): boolean {
    const due = this.parseDate(inv.fecha_vencimiento);
    if (!due || !this.isPending(inv)) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due.getTime() < today.getTime();
  }

  isDueWithinDays(inv: Invoice, days: number): boolean {
    const due = this.parseDate(inv.fecha_vencimiento);
    if (!due || this.isPaid(inv)) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limit = new Date(today);
    limit.setDate(today.getDate() + days);
    return due.getTime() >= today.getTime() && due.getTime() <= limit.getTime();
  }

  isSameMonth(value: string | null | undefined): boolean {
    const date = this.parseDate(value);
    if (!date) return false;
    const now = new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }

  balanceAmount(inv: Invoice): number {
    if (this.isClosedWithoutPayment(inv)) return 0;
    if (this.isPaid(inv)) return 0;
    return Math.max(inv.saldo || (inv.total || 0) - (inv.total_cobrado || 0), 0);
  }

  invoiceSubline(inv: Invoice): string {
    const parts = [inv.folio, inv.referencia].filter(Boolean);
    return parts.length ? parts.join(' · ') : '—';
  }

  clientSubline(inv: Invoice): string {
    const parts = [inv.cliente?.telefono, inv.cliente?.cedula, inv.cliente?.email].filter(Boolean);
    return parts.length ? parts.join(' · ') : (inv.zona?.nombre || '—');
  }

  private searchText(inv: Invoice): string {
    return this.normalize([
      inv.id_factura,
      inv.folio,
      inv.referencia,
      inv.comprobante_pago,
      inv.cliente?.nombre,
      inv.cliente?.usuario,
      inv.cliente?.telefono,
      inv.cliente?.cedula,
      inv.cliente?.email,
      inv.cliente?.direccion,
      inv.zona?.nombre,
      inv.forma_pago?.nombre,
      inv.cajero?.nombre,
      ...(inv.articulos || []).map((article) => article.descripcion),
    ].filter(Boolean).join(' '));
  }

  private normalize(value: unknown): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const text = String(value).trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const latin = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    let date: Date;
    if (iso) date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    else if (latin) date = new Date(Number(latin[3]), Number(latin[2]) - 1, Number(latin[1]));
    else date = new Date(text);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private isToday(value: string | null | undefined): boolean {
    const date = this.parseDate(value);
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date.getTime() === today.getTime();
  }

  private isWithinPastDays(value: string | null | undefined, days: number): boolean {
    const date = this.parseDate(value);
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - Math.max(days - 1, 0));
    return date.getTime() >= start.getTime() && date.getTime() <= today.getTime();
  }

  private isSameYear(value: string | null | undefined): boolean {
    const date = this.parseDate(value);
    return Boolean(date && date.getFullYear() === new Date().getFullYear());
  }

  private isDateInRange(value: string | null | undefined, from: string, to: string): boolean {
    const date = this.parseDate(value);
    if (!date) return false;
    const start = from ? this.parseDate(from) : null;
    const end = to ? this.parseDate(to) : null;
    if (start && date.getTime() < start.getTime()) return false;
    if (end && date.getTime() > end.getTime()) return false;
    return true;
  }

  private hasNumericFilter(value: number | null): boolean {
    return value !== null && value !== undefined && Number.isFinite(Number(value));
  }

  private toInputDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getNestedVal(obj: any, path: string): any {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }
}
