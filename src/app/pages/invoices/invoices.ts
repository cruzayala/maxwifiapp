import { Component, OnInit, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { WisphubService } from '../../services/wisphub.service';
import { LocalDbService } from '../../services/local-db.service';
import { Invoice } from '../../models/invoice.model';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExportService } from '../../services/export.service';
import { ReceiptService } from '../../services/receipt.service';
import { ToastService } from '../../services/toast.service';
import { PaymentModalComponent } from '../../components/payment-modal/payment-modal';

type InvoiceQuickFilter = 'all' | 'collected' | 'open' | 'paid' | 'pending';

@Component({
  selector: 'app-invoices',
  standalone: true,
  imports: [NavbarComponent, DecimalPipe, FormsModule, PaymentModalComponent],
  template: `
    <app-navbar pageTitle="Facturas" />

    <div class="page">
      <div class="summary-grid">
        <button class="summary-card total" type="button" (click)="setQuickFilter('all')" [class.active]="quickFilter === 'all'">
          <span>Total facturado</span>
          <strong>RD$ {{ totalFacturado() | number:'1.2-2' }}</strong>
          <small>{{ filtered().length }} visibles</small>
        </button>
        <button class="summary-card success" type="button" (click)="setQuickFilter('collected')" [class.active]="quickFilter === 'collected'">
          <span>Cobrado</span>
          <strong>RD$ {{ totalCobrado() | number:'1.2-2' }}</strong>
          <small>{{ countCollected() }} con cobro</small>
        </button>
        <button class="summary-card danger" type="button" (click)="setQuickFilter('open')" [class.active]="quickFilter === 'open'">
          <span>Pendiente</span>
          <strong>RD$ {{ totalPendiente() | number:'1.2-2' }}</strong>
          <small>{{ countPendientes() }} requieren revision</small>
        </button>
        <button class="summary-card paid" type="button" (click)="setQuickFilter('paid')" [class.active]="quickFilter === 'paid'">
          <span>Pagadas</span>
          <strong>{{ countPagadas() }}</strong>
          <small>cerradas</small>
        </button>
        <button class="summary-card warning" type="button" (click)="setQuickFilter('pending')" [class.active]="quickFilter === 'pending'">
          <span>Pendientes</span>
          <strong>{{ countPendientes() }}</strong>
          <small>{{ countOverdue() }} vencidas</small>
        </button>
      </div>

      <div class="toolbar">
        <div class="search-filter">
          <div class="search-input">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Buscar cliente, telefono, cedula, referencia, # factura..." [(ngModel)]="searchTerm" (input)="filterInvoices()" />
          </div>
          <select [(ngModel)]="statusFilter" (change)="filterInvoices()" class="filter-select">
            <option value="">Todos los estados</option>
            <option value="pagada">Pagadas</option>
            <option value="pendiente">Pendientes</option>
            <option value="vencida">Vencidas</option>
          </select>
          <select [(ngModel)]="dateFilter" (change)="filterInvoices()" class="filter-select">
            <option value="">Todas las fechas</option>
            <option value="overdue">Vencidas</option>
            <option value="due7">Vencen en 7 dias</option>
            <option value="issued-month">Emitidas este mes</option>
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
          <button class="btn btn-ghost" type="button" (click)="clearFilters()">Limpiar</button>
        </div>
        <div class="toolbar-actions">
          <button class="btn btn-outline" (click)="exportCSV()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            CSV
          </button>
          <button class="btn btn-primary" (click)="syncInvoices()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
            {{ syncing() ? 'Sincronizando...' : 'Sincronizar' }}
          </button>
          <span class="inv-count">{{ filtered().length }} de {{ allInvoices().length }}</span>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-state"><div class="spinner"></div><p>Cargando facturas...</p></div>
      } @else if (filtered().length === 0 && allInvoices().length === 0) {
        <div class="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <h3>Sin facturas</h3>
          <p>Presiona "Sincronizar" para cargar facturas desde WispHub</p>
        </div>
      } @else {
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
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
              @for (inv of filtered(); track inv.id_factura) {
                <tr [class.row-overdue]="isOverdue(inv)" [class.row-pending]="isPending(inv)">
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
                      <span>Emision {{ inv.fecha_emision || '-' }}</span>
                      <small [class.overdue-text]="isOverdue(inv)">Vence {{ inv.fecha_vencimiento || '-' }}</small>
                      @if (inv.fecha_pago) {
                        <small>Pago {{ inv.fecha_pago }}</small>
                      }
                    </div>
                  </td>
                  <td data-label="Pago">
                    <div class="payment-cell">
                      <span>{{ inv.forma_pago?.nombre || 'Sin forma' }}</span>
                      <small>{{ inv.cajero?.nombre || inv.zona?.nombre || '-' }}</small>
                    </div>
                  </td>
                  <td data-label="Total">
                    <div class="amount-cell">
                      <span>RD$ {{ inv.total | number:'1.2-2' }}</span>
                      <small>Sub RD$ {{ inv.sub_total | number:'1.2-2' }}</small>
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
                      <span class="badge" [class]="'badge-' + getStatusClass(inv.estado)">{{ statusLabel(inv) }}</span>
                      @if (isOverdue(inv)) {
                        <small class="late-pill">Vencida</small>
                      }
                    </div>
                  </td>
                  <td data-label="Acciones">
                    <div class="action-btns">
                      @if (isPending(inv)) {
                        <button class="btn-pay" (click)="openPayment(inv)" title="Registrar pago">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                          Pagar
                        </button>
                      }
                      <button class="btn-print btn-invoice" (click)="printInvoice(inv)" title="Imprimir factura Carta/A4">
                        Factura
                      </button>
                      <button class="btn-print btn-receipt" (click)="printReceipt(inv)" title="Imprimir recibo pequeno">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                        Recibo
                      </button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
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
    .page { padding: 20px 24px 28px; }

    .summary-grid {
      display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr));
      gap: 12px; margin-bottom: 14px;
    }
    .summary-card {
      text-align: left; border: 1px solid #e2e8f0; background: white; border-radius: 12px;
      padding: 12px 14px; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
      min-height: 92px;
    }
    .summary-card:hover, .summary-card.active { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08); }
    .summary-card.active { border-color: #6366f1; }
    .summary-card span { display: block; font-size: 11px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    .summary-card strong { display: block; margin-top: 8px; font-size: 22px; line-height: 1.1; color: #0f172a; }
    .summary-card small { display: block; margin-top: 8px; font-size: 12px; color: #64748b; white-space: nowrap; }
    .summary-card.success.active { border-color: #22c55e; }
    .summary-card.warning.active { border-color: #f59e0b; }
    .summary-card.danger.active { border-color: #ef4444; }
    .summary-card.paid.active { border-color: #16a34a; }

    .toolbar {
      display: grid; grid-template-columns: 1fr;
      align-items: start; gap: 12px; margin-bottom: 14px;
      background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px;
    }
    .search-filter {
      display: grid; grid-template-columns: minmax(320px, 1.5fr) repeat(3, minmax(132px, 1fr));
      align-items: center; gap: 8px;
    }
    .search-input {
      display: flex; align-items: center; gap: 8px;
      background: #f8fafc; border: 1px solid #e2e8f0;
      border-radius: 10px; padding: 10px 14px; color: #94a3b8; min-width: 0;
    }
    .search-input input { border: none; background: none; outline: none; font-size: 14px; color: #334155; width: 100%; }
    .filter-select {
      padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 10px;
      font-size: 13px; color: #334155; background: white; cursor: pointer; outline: none; min-width: 0;
    }
    .toolbar-actions { display: flex; align-items: center; justify-content: flex-start; gap: 8px; flex-wrap: wrap; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      padding: 10px 18px; border-radius: 10px;
      font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s;
    }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; }
    .btn-outline:hover { border-color: #6366f1; color: #6366f1; background: #eef2ff; }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-ghost { background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; padding: 10px 14px; }
    .btn-ghost:hover { background: #f1f5f9; color: #0f172a; }
    .inv-count { font-size: 13px; color: #64748b; font-weight: 500; white-space: nowrap; padding-left: 2px; }

    .table-container {
      background: white; border-radius: 14px;
      border: 1px solid #e2e8f0; overflow-x: auto; box-shadow: 0 10px 28px rgba(15, 23, 42, 0.04);
    }
    .data-table { width: 100%; border-collapse: collapse; min-width: 1220px; table-layout: fixed; }
    .data-table th {
      text-align: left; font-size: 11px; font-weight: 700; color: #64748b;
      text-transform: uppercase; letter-spacing: 0.04em;
      padding: 12px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
      position: sticky; top: 0; z-index: 1;
    }
    .col-invoice { width: 130px; }
    .col-client { width: 230px; }
    .col-dates { width: 190px; }
    .col-payment { width: 160px; }
    .col-total { width: 155px; }
    .col-balance { width: 145px; }
    .col-status { width: 120px; }
    .col-actions { width: 210px; }
    .sortable { cursor: pointer; user-select: none; }
    .sortable:hover { color: #6366f1; }

    .data-table td { padding: 12px 14px; font-size: 13px; color: #334155; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    .data-table tr:hover td { background: #fafbfc; }
    .row-pending td { background: #fffdf7; }
    .row-overdue td { background: #fff7f7; }
    .row-pending:hover td, .row-overdue:hover td { background: #fff8ee; }

    .invoice-cell, .client-cell, .date-cell, .payment-cell, .amount-cell, .balance-cell, .status-cell {
      min-width: 0;
    }
    .invoice-id { display: block; color: #4f46e5; font-weight: 800; line-height: 1.25; }
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
    .badge-default { background: #f1f5f9; color: #64748b; }
    .late-pill {
      display: inline-flex; margin-top: 5px; padding: 2px 7px; border-radius: 999px;
      background: #fee2e2; color: #dc2626; font-size: 10px; font-weight: 700;
    }

    .action-btns { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .btn-icon {
      background: white; border: 1px solid #e2e8f0; border-radius: 8px;
      padding: 6px 8px; cursor: pointer; color: #64748b; transition: all 0.2s;
    }
    .btn-icon:hover { background: #6366f1; color: white; border-color: #6366f1; }
    .btn-print {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 6px 9px; border-radius: 8px; font-size: 11px; font-weight: 700;
      cursor: pointer; transition: all 0.2s; border: 1px solid #e2e8f0; background: white; color: #475569;
    }
    .btn-print:hover { border-color: #6366f1; color: #4f46e5; background: #eef2ff; }
    .btn-invoice { color: #4f46e5; border-color: #c7d2fe; }
    .btn-receipt { color: #475569; }
    .btn-pay {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 6px 10px; border: none; border-radius: 8px;
      background: #22c55e; color: white; font-size: 11px; font-weight: 700;
      cursor: pointer; transition: all 0.2s;
    }
    .btn-pay:hover { background: #16a34a; }

    .loading-state, .empty-state {
      display: flex; flex-direction: column;
      align-items: center; padding: 80px; gap: 12px; color: #94a3b8;
    }
    .empty-state h3 { color: #475569; margin: 8px 0 0; }
    .spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; }
    .spinner.small { width: 18px; height: 18px; border-width: 2px; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .sync-bar {
      position: fixed; bottom: -60px; left: 260px; right: 0;
      height: 48px; background: #0f172a; color: white;
      display: flex; align-items: center; justify-content: center;
      gap: 12px; font-size: 14px; transition: bottom 0.3s; z-index: 50;
    }
    .sync-bar.visible { bottom: 0; }

    @media (max-width: 1200px) {
      .summary-grid { grid-template-columns: repeat(3, 1fr); }
      .search-filter { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .search-input { grid-column: 1 / -1; }
    }
    @media (max-width: 760px) {
      .page { padding: 14px; }
      .summary-grid { grid-template-columns: repeat(2, 1fr); }
      .toolbar, .search-filter, .toolbar-actions { width: 100%; grid-template-columns: 1fr; }
      .search-input, .filter-select, .btn-ghost { width: 100%; }
      .toolbar-actions { justify-content: space-between; gap: 8px; flex-wrap: wrap; }
      .btn { flex: 1; justify-content: center; padding-inline: 12px; }
      .data-table { min-width: 1120px; }
      .sync-bar { left: 0; }
    }
  `]
})
export class InvoicesComponent implements OnInit {
  private api = inject(WisphubService);
  private db = inject(LocalDbService);
  private exportSvc = inject(ExportService);
  private receiptSvc = inject(ReceiptService);
  private toast = inject(ToastService);

  allInvoices = signal<Invoice[]>([]);
  filtered = signal<Invoice[]>([]);
  allPaymentMethods = signal<string[]>([]);
  allZones = signal<string[]>([]);
  loading = signal(true);
  syncing = signal(false);
  syncMessage = signal('');
  searchTerm = '';
  statusFilter = '';
  dateFilter = '';
  paymentFilter = '';
  zoneFilter = '';
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

  showPayment = signal(false);
  selectedInvoice = signal<Invoice | null>(null);

  openPayment(inv: Invoice) {
    this.selectedInvoice.set(inv);
    this.showPayment.set(true);
  }

  onPaymentSuccess() {
    this.syncInvoices();
  }

  async ngOnInit() {
    const invoices = await this.db.getInvoices();
    this.setInvoices(invoices);
    this.loading.set(false);
  }

  private setInvoices(invoices: Invoice[]) {
    this.allInvoices.set(invoices);
    this.computeStats(invoices);
    this.computeFilterLists(invoices);
    this.filterInvoices();
  }

  computeStats(invoices: Invoice[]) {
    this.totalFacturado.set(invoices.reduce((s, i) => s + (i.total || 0), 0));
    this.totalCobrado.set(invoices.reduce((s, i) => s + (i.total_cobrado || 0), 0));
    this.totalPendiente.set(invoices.reduce((s, i) => s + this.balanceAmount(i), 0));
    this.countPagadas.set(invoices.filter(i => this.isPaid(i)).length);
    this.countPendientes.set(invoices.filter(i => this.isPending(i)).length);
    this.countCollected.set(invoices.filter(i => this.isPaid(i) || (i.total_cobrado || 0) > 0).length);
    this.countOverdue.set(invoices.filter(i => this.isOverdue(i)).length);
  }

  private computeFilterLists(invoices: Invoice[]) {
    const methods = [...new Set(invoices.map(i => i.forma_pago?.nombre).filter(Boolean) as string[])].sort();
    const zones = [...new Set(invoices.map(i => i.zona?.nombre).filter(Boolean) as string[])].sort();
    this.allPaymentMethods.set(methods);
    this.allZones.set(zones);
  }

  filterInvoices() {
    let result = this.allInvoices();
    const term = this.normalize(this.searchTerm);

    if (term) {
      result = result.filter(i => this.searchText(i).includes(term));
    }

    if (this.quickFilter === 'paid') {
      result = result.filter(i => this.isPaid(i));
    } else if (this.quickFilter === 'pending' || this.quickFilter === 'open') {
      result = result.filter(i => this.isPending(i));
    } else if (this.quickFilter === 'collected') {
      result = result.filter(i => this.isPaid(i) || (i.total_cobrado || 0) > 0);
    }

    if (this.statusFilter === 'pagada') {
      result = result.filter(i => this.isPaid(i));
    } else if (this.statusFilter === 'pendiente') {
      result = result.filter(i => this.isPending(i));
    } else if (this.statusFilter === 'vencida') {
      result = result.filter(i => this.isOverdue(i));
    }

    if (this.dateFilter === 'overdue') {
      result = result.filter(i => this.isOverdue(i));
    } else if (this.dateFilter === 'due7') {
      result = result.filter(i => this.isDueWithinDays(i, 7));
    } else if (this.dateFilter === 'issued-month') {
      result = result.filter(i => this.isSameMonth(i.fecha_emision));
    } else if (this.dateFilter === 'paid-month') {
      result = result.filter(i => this.isSameMonth(i.fecha_pago));
    }

    if (this.paymentFilter) {
      result = result.filter(i => i.forma_pago?.nombre === this.paymentFilter);
    }

    if (this.zoneFilter) {
      result = result.filter(i => i.zona?.nombre === this.zoneFilter);
    }

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
    this.quickFilter = 'all';
    this.filterInvoices();
  }

  sort(col: string) {
    if (this.sortCol === col) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
    else { this.sortCol = col; this.sortDir = 'asc'; }
    this.filterInvoices();
  }

  sortIcon(col: string): string {
    if (this.sortCol !== col) return '';
    return this.sortDir === 'asc' ? '\u25B2' : '\u25BC';
  }

  syncInvoices() {
    this.syncing.set(true);
    this.syncMessage.set('Cargando todas las facturas desde WispHub...');
    this.api.getAllInvoices().subscribe({
      next: async (invoices) => {
        await this.db.saveInvoices(invoices);
        await this.db.updateSyncLog('invoices');
        this.setInvoices(invoices);
        this.syncing.set(false);
        this.toast.success(`${invoices.length} facturas sincronizadas`);
      },
      error: (e) => {
        this.syncing.set(false);
        this.toast.error('Error: ' + (e.error?.detail || 'Sin conexion'));
      }
    });
  }

  printReceipt(inv: Invoice) {
    this.receiptSvc.openReceiptPreview(inv);
  }

  printInvoice(inv: Invoice) {
    this.receiptSvc.openInvoicePreview(inv);
  }

  exportCSV() {
    this.exportSvc.exportCSV(this.filtered(), 'facturas', [
      { key: 'id_factura', label: '# Factura' },
      { key: 'cliente.nombre', label: 'Cliente' },
      { key: 'cliente.telefono', label: 'Telefono' },
      { key: 'cliente.cedula', label: 'Cedula' },
      { key: 'referencia', label: 'Referencia' },
      { key: 'folio', label: 'Folio' },
      { key: 'fecha_emision', label: 'Emision' },
      { key: 'fecha_vencimiento', label: 'Vencimiento' },
      { key: 'fecha_pago', label: 'Pago' },
      { key: 'forma_pago.nombre', label: 'Forma Pago' },
      { key: 'zona.nombre', label: 'Zona' },
      { key: 'sub_total', label: 'Subtotal' },
      { key: 'descuento', label: 'Descuento' },
      { key: 'total', label: 'Total' },
      { key: 'total_cobrado', label: 'Cobrado' },
      { key: 'saldo', label: 'Saldo' },
      { key: 'estado', label: 'Estado' },
    ]);
  }

  getStatusClass(estado: string | null | undefined): string {
    if (this.normalize(estado).includes('pagad')) return 'paid';
    if (this.normalize(estado).includes('pendiente')) return 'pending';
    return 'default';
  }

  statusLabel(inv: Invoice): string {
    if (this.isPaid(inv)) return inv.estado || 'Pagada';
    if (this.isOverdue(inv)) return 'Pendiente';
    return inv.estado || 'Pendiente';
  }

  isPaid(inv: Invoice): boolean {
    return this.normalize(inv.estado).includes('pagad');
  }

  isPending(inv: Invoice): boolean {
    return !this.isPaid(inv);
  }

  isOverdue(inv: Invoice): boolean {
    const due = this.parseDate(inv.fecha_vencimiento);
    if (!due || this.isPaid(inv)) return false;
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
    if (this.isPaid(inv)) return inv.saldo || 0;
    return inv.saldo || Math.max((inv.total || 0) - (inv.total_cobrado || 0), 0);
  }

  invoiceSubline(inv: Invoice): string {
    const parts = [inv.folio, inv.referencia].filter(Boolean);
    return parts.length ? parts.join(' | ') : 'Sin referencia';
  }

  clientSubline(inv: Invoice): string {
    const parts = [inv.cliente?.telefono, inv.cliente?.cedula, inv.cliente?.email].filter(Boolean);
    return parts.length ? parts.join(' | ') : (inv.zona?.nombre || '-');
  }

  private searchText(inv: Invoice): string {
    return this.normalize([
      inv.id_factura,
      inv.folio,
      inv.referencia,
      inv.cliente?.nombre,
      inv.cliente?.telefono,
      inv.cliente?.cedula,
      inv.cliente?.email,
      inv.cliente?.direccion,
      inv.zona?.nombre,
      inv.forma_pago?.nombre,
      inv.cajero?.nombre,
    ].filter(Boolean).join(' '));
  }

  private normalize(value: unknown): string {
    return String(value || '').toLowerCase().trim();
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private getNestedVal(obj: any, path: string): any {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }
}
