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

@Component({
  selector: 'app-invoices',
  standalone: true,
  imports: [NavbarComponent, DecimalPipe, FormsModule, PaymentModalComponent],
  template: `
    <app-navbar pageTitle="Facturas" />

    <div class="page">
      <div class="toolbar">
        <div class="search-filter">
          <div class="search-input">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Buscar cliente, # factura..." [(ngModel)]="searchTerm" (input)="filterInvoices()" />
          </div>
          <select [(ngModel)]="statusFilter" (change)="filterInvoices()" class="filter-select">
            <option value="">Todas</option>
            <option value="pagada">Pagadas</option>
            <option value="pendiente">Pendientes</option>
          </select>
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
          <span class="inv-count">{{ filtered().length }} facturas</span>
        </div>
      </div>

      <!-- STATS -->
      <div class="stats-row">
        <div class="mini-stat">
          <span class="mini-label">Total Facturado</span>
          <span class="mini-value">RD$ {{ totalFacturado() | number:'1.2-2' }}</span>
        </div>
        <div class="mini-stat">
          <span class="mini-label">Cobrado</span>
          <span class="mini-value green">RD$ {{ totalCobrado() | number:'1.2-2' }}</span>
        </div>
        <div class="mini-stat">
          <span class="mini-label">Pendiente</span>
          <span class="mini-value red">RD$ {{ totalPendiente() | number:'1.2-2' }}</span>
        </div>
        <div class="mini-stat">
          <span class="mini-label">Pagadas</span>
          <span class="mini-value">{{ countPagadas() }}</span>
        </div>
        <div class="mini-stat">
          <span class="mini-label">Pendientes</span>
          <span class="mini-value">{{ countPendientes() }}</span>
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
                <th class="sortable" (click)="sort('id_factura')"># {{ sortIcon('id_factura') }}</th>
                <th class="sortable" (click)="sort('cliente.nombre')">Cliente {{ sortIcon('cliente.nombre') }}</th>
                <th>Telefono</th>
                <th class="sortable" (click)="sort('fecha_emision')">Emision {{ sortIcon('fecha_emision') }}</th>
                <th class="sortable" (click)="sort('fecha_vencimiento')">Vencimiento {{ sortIcon('fecha_vencimiento') }}</th>
                <th>Forma Pago</th>
                <th class="sortable" (click)="sort('sub_total')">Subtotal {{ sortIcon('sub_total') }}</th>
                <th>Desc.</th>
                <th class="sortable" (click)="sort('total')">Total {{ sortIcon('total') }}</th>
                <th class="sortable" (click)="sort('estado')">Estado {{ sortIcon('estado') }}</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (inv of filtered(); track inv.id_factura) {
                <tr>
                  <td data-label="#" class="id-col">{{ inv.id_factura }}</td>
                  <td data-label="Cliente" class="name-col">{{ inv.cliente?.nombre || '-' }}</td>
                  <td data-label="Telefono" class="mono">{{ inv.cliente?.telefono || '-' }}</td>
                  <td data-label="Emision">{{ inv.fecha_emision }}</td>
                  <td data-label="Vencimiento">{{ inv.fecha_vencimiento }}</td>
                  <td data-label="Forma Pago">{{ inv.forma_pago?.nombre || '-' }}</td>
                  <td data-label="Subtotal" class="money">RD$ {{ inv.sub_total | number:'1.2-2' }}</td>
                  <td data-label="Descuento" class="money disc">{{ inv.descuento > 0 ? '-RD$ ' + (inv.descuento | number:'1.2-2') : '-' }}</td>
                  <td data-label="Total" class="money total">RD$ {{ inv.total | number:'1.2-2' }}</td>
                  <td data-label="Estado">
                    <span class="badge" [class]="'badge-' + getStatusClass(inv.estado)">{{ inv.estado }}</span>
                  </td>
                  <td data-label="Acciones">
                    <div class="action-btns">
                      @if (inv.estado?.toLowerCase() !== 'pagada') {
                        <button class="btn-pay" (click)="openPayment(inv)" title="Registrar pago">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                          Pagar
                        </button>
                      }
                      <button class="btn-icon" (click)="printReceipt(inv)" title="Imprimir recibo">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
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
    .page { padding: 24px 32px; }

    .toolbar {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px; gap: 16px; flex-wrap: wrap;
    }

    .search-filter { display: flex; align-items: center; gap: 10px; }

    .search-input {
      display: flex; align-items: center; gap: 8px;
      background: white; border: 1px solid #e2e8f0;
      border-radius: 10px; padding: 10px 16px; color: #94a3b8; min-width: 280px;
    }
    .search-input input { border: none; background: none; outline: none; font-size: 14px; color: #334155; width: 100%; }

    .filter-select {
      padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 10px;
      font-size: 13px; color: #334155; background: white; cursor: pointer; outline: none;
    }

    .toolbar-actions { display: flex; align-items: center; gap: 16px; }

    .btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 20px; border-radius: 10px;
      font-size: 14px; font-weight: 500; cursor: pointer; border: none; transition: all 0.2s;
    }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; }
    .btn-outline:hover { border-color: #6366f1; color: #6366f1; background: #eef2ff; }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #4f46e5; }

    .inv-count { font-size: 13px; color: #64748b; font-weight: 500; }

    .stats-row {
      display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap;
    }

    .mini-stat {
      background: white; border: 1px solid #e2e8f0; border-radius: 12px;
      padding: 14px 20px; flex: 1; min-width: 140px;
    }
    .mini-label { display: block; font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }
    .mini-value { font-size: 20px; font-weight: 800; color: #0f172a; }
    .mini-value.green { color: #16a34a; }
    .mini-value.red { color: #ef4444; }

    .table-container {
      background: white; border-radius: 16px;
      border: 1px solid #e2e8f0; overflow-x: auto;
    }

    .data-table { width: 100%; border-collapse: collapse; min-width: 1000px; }

    .data-table th {
      text-align: left; font-size: 11px; font-weight: 600; color: #64748b;
      text-transform: uppercase; letter-spacing: 0.5px;
      padding: 12px 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
      position: sticky; top: 0; z-index: 1;
    }
    .sortable { cursor: pointer; user-select: none; }
    .sortable:hover { color: #6366f1; }

    .data-table td { padding: 10px 12px; font-size: 13px; color: #334155; border-bottom: 1px solid #f1f5f9; }
    .data-table tr:hover td { background: #fafbfc; }

    .id-col { font-weight: 600; color: #6366f1; }
    .name-col { font-weight: 500; color: #0f172a; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mono { font-family: 'Courier New', monospace; font-size: 12px; }
    .money { font-family: 'Courier New', monospace; font-weight: 600; font-size: 13px; }
    .disc { color: #ef4444; }
    .total { color: #0f172a; font-size: 14px; }

    .badge {
      display: inline-block; padding: 3px 8px; border-radius: 20px;
      font-size: 11px; font-weight: 600; white-space: nowrap;
    }
    .badge-paid { background: #dcfce7; color: #16a34a; }
    .badge-pending { background: #fef3c7; color: #d97706; }
    .badge-default { background: #f1f5f9; color: #64748b; }

    .btn-icon {
      background: none; border: 1px solid #e2e8f0; border-radius: 8px;
      padding: 6px 8px; cursor: pointer; color: #64748b; transition: all 0.2s;
    }
    .btn-icon:hover { background: #6366f1; color: white; border-color: #6366f1; }

    .action-btns { display: flex; gap: 6px; align-items: center; }
    .btn-pay {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 5px 10px; border: none; border-radius: 6px;
      background: #22c55e; color: white; font-size: 11px; font-weight: 600;
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
  loading = signal(true);
  syncing = signal(false);
  syncMessage = signal('');
  searchTerm = '';
  statusFilter = '';
  sortCol = '';
  sortDir: 'asc' | 'desc' = 'asc';

  totalFacturado = signal(0);
  totalCobrado = signal(0);
  totalPendiente = signal(0);
  countPagadas = signal(0);
  countPendientes = signal(0);

  // Payment modal state
  showPayment = signal(false);
  selectedInvoice = signal<Invoice | null>(null);

  openPayment(inv: Invoice) {
    this.selectedInvoice.set(inv);
    this.showPayment.set(true);
  }

  onPaymentSuccess() {
    // Refresh invoices from API
    this.syncInvoices();
  }

  async ngOnInit() {
    const invoices = await this.db.getInvoices();
    this.allInvoices.set(invoices);
    this.computeStats(invoices);
    this.filterInvoices();
    this.loading.set(false);
  }

  computeStats(invoices: Invoice[]) {
    this.totalFacturado.set(invoices.reduce((s, i) => s + (i.total || 0), 0));
    this.totalCobrado.set(invoices.reduce((s, i) => s + (i.total_cobrado || 0), 0));
    this.totalPendiente.set(invoices.reduce((s, i) => s + (i.saldo || 0), 0));
    this.countPagadas.set(invoices.filter(i => i.estado?.toLowerCase() === 'pagada').length);
    this.countPendientes.set(invoices.filter(i => i.estado?.toLowerCase() !== 'pagada').length);
  }

  filterInvoices() {
    let result = this.allInvoices();
    const term = this.searchTerm.toLowerCase().trim();

    if (term) {
      result = result.filter(i =>
        i.cliente?.nombre?.toLowerCase().includes(term) ||
        i.id_factura?.toString().includes(term) ||
        i.cliente?.telefono?.includes(term)
      );
    }

    if (this.statusFilter === 'pagada') {
      result = result.filter(i => i.estado?.toLowerCase() === 'pagada');
    } else if (this.statusFilter === 'pendiente') {
      result = result.filter(i => i.estado?.toLowerCase() !== 'pagada');
    }

    if (this.sortCol) {
      result = [...result].sort((a, b) => {
        const valA = this.sortCol.split('.').reduce((o: any, k) => o?.[k], a);
        const valB = this.sortCol.split('.').reduce((o: any, k) => o?.[k], b);
        if (valA == null) return 1;
        if (valB == null) return -1;
        const nA = parseFloat(valA), nB = parseFloat(valB);
        const cmp = (!isNaN(nA) && !isNaN(nB)) ? nA - nB : String(valA).localeCompare(String(valB), 'es');
        return this.sortDir === 'asc' ? cmp : -cmp;
      });
    }

    this.filtered.set(result);
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
        this.allInvoices.set(invoices);
        this.computeStats(invoices);
        this.filterInvoices();
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
    this.receiptSvc.openPreview(inv);
  }

  exportCSV() {
    this.exportSvc.exportCSV(this.filtered(), 'facturas', [
      { key: 'id_factura', label: '# Factura' },
      { key: 'cliente.nombre', label: 'Cliente' },
      { key: 'cliente.telefono', label: 'Telefono' },
      { key: 'fecha_emision', label: 'Emision' },
      { key: 'fecha_vencimiento', label: 'Vencimiento' },
      { key: 'forma_pago.nombre', label: 'Forma Pago' },
      { key: 'sub_total', label: 'Subtotal' },
      { key: 'descuento', label: 'Descuento' },
      { key: 'total', label: 'Total' },
      { key: 'total_cobrado', label: 'Cobrado' },
      { key: 'saldo', label: 'Saldo' },
      { key: 'estado', label: 'Estado' },
    ]);
  }

  getStatusClass(estado: string): string {
    const s = estado?.toLowerCase();
    if (s === 'pagada' || s === 'pagado') return 'paid';
    if (s?.includes('pendiente')) return 'pending';
    return 'default';
  }
}
