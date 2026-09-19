import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../components/layout/navbar';
import { LocalDbService } from '../../services/local-db.service';
import { ToastService } from '../../services/toast.service';
import { LucidePlus, LucideReceipt, LucideTrash2, LucideX } from '@lucide/angular';

interface Expense {
  id: number; category: string; description: string; amount: number;
  expenseDate: string; paymentMethod?: string; reference?: string;
  clientIdServicio?: number;
  purchase?: { id: number; supplier?: string; invoiceRef?: string };
  payroll?: { id: number; period: string; employee: { fullName: string } };
  client?: { idServicio: number; nombre: string };
  notes?: string;
}
interface Stats {
  total: number; count: number;
  byCategory: Array<{ category: string; _sum: { amount: number }; _count: { _all: number } }>;
  byMonth: Array<{ month: string; total: number; count: number }>;
}

const CATEGORIES = [
  { id: 'inventario', label: 'Inventario', color: '#1267dd' },
  { id: 'nomina', label: 'Nómina', color: '#13875a' },
  { id: 'servicios', label: 'Servicios (luz, internet, etc.)', color: '#b36b12' },
  { id: 'transporte', label: 'Transporte', color: '#0e7490' },
  { id: 'otros', label: 'Otros', color: '#667582' },
];

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [NavbarComponent, FormsModule, DecimalPipe, DatePipe, RouterLink, LucidePlus, LucideReceipt, LucideTrash2, LucideX],
  template: `
    <app-navbar pageTitle="Gastos" />

    <div class="page">
      <!-- RESUMEN -->
      <div class="stats-row">
        <div class="stat-card accent">
          <div class="stat-label">{{ filterFrom || filterTo ? 'Total del período' : 'Total gastado' }}</div>
          <div class="stat-value">RD$ {{ stats().total | number:'1.0-0' }}</div>
          <div class="stat-sub">{{ stats().count }} {{ stats().count === 1 ? 'registro' : 'registros' }}</div>
        </div>
        @for (cat of stats().byCategory; track cat.category) {
          <div class="stat-card" [style.border-left-color]="catColor(cat.category)">
            <div class="stat-label">{{ catLabel(cat.category) }}</div>
            <div class="stat-value">RD$ {{ cat._sum.amount | number:'1.0-0' }}</div>
            <div class="stat-sub">{{ cat._count._all }} {{ cat._count._all === 1 ? 'registro' : 'registros' }}</div>
          </div>
        }
      </div>

      <!-- Histórico mensual -->
      @if (stats().byMonth.length > 0) {
        <div class="card">
          <h4>Gastos por mes (últimos 12 meses)</h4>
          <div class="months-scroll">
            <div class="months">
              @for (m of stats().byMonth.slice().reverse(); track m.month) {
                <div class="month-bar" [title]="monthLabel(m.month) + ': RD$ ' + (m.total | number:'1.0-0')">
                  <div class="month-value">{{ m.total | number:'1.0-0' }}</div>
                  <div class="month-bar-fill" [style.height.%]="(m.total / maxMonth()) * 100"></div>
                  <div class="month-label">{{ monthLabel(m.month) }}</div>
                </div>
              }
            </div>
          </div>
          <p class="chart-note">Montos en RD$.</p>
        </div>
      }

      <div class="toolbar">
        <div class="filters">
          <label class="filter">
            <span>Categoría</span>
            <select [(ngModel)]="filterCategory" (change)="loadExpenses()">
              <option value="">Todas</option>
              @for (c of CATEGORIES; track c.id) { <option [value]="c.id">{{ c.label }}</option> }
            </select>
          </label>
          <label class="filter">
            <span>Desde</span>
            <input type="date" [(ngModel)]="filterFrom" (change)="loadExpenses()" />
          </label>
          <label class="filter">
            <span>Hasta</span>
            <input type="date" [(ngModel)]="filterTo" (change)="loadExpenses()" />
          </label>
          @if (filterCategory || filterFrom || filterTo) {
            <button type="button" class="btn btn-mini btn-outline clear-btn" (click)="clearFilters()"><svg lucideX size="13"></svg> Quitar filtros</button>
          }
        </div>
        <button type="button" class="btn btn-primary" (click)="openNew()"><svg lucidePlus size="16"></svg> Registrar gasto</button>
      </div>

      @if (loading()) {
        <div class="loading-state"><div class="spinner"></div><span>Cargando gastos…</span></div>
      } @else if (expenses().length === 0) {
        <div class="empty-state">
          <svg lucideReceipt size="44"></svg>
          @if (filterCategory || filterFrom || filterTo) {
            <h3>No hay gastos con estos filtros</h3>
            <p>Cambia la categoría o las fechas, o quita los filtros.</p>
          } @else {
            <h3>Todavía no hay gastos</h3>
            <p>Toca <strong>Registrar gasto</strong> para anotar el primero. Las compras de inventario y los pagos de nómina se registran solos.</p>
          }
        </div>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Categoría</th>
                <th>Descripción</th>
                <th>Relacionado con</th>
                <th>Forma de pago</th>
                <th class="t-right">Monto</th>
                <th class="t-right"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (e of expenses(); track e.id) {
                <tr>
                  <td class="nowrap">{{ e.expenseDate | date:'dd/MM/yyyy' }}</td>
                  <td><span class="cat-pill" [style.background]="catColor(e.category) + '1a'" [style.color]="catColor(e.category)">{{ catLabel(e.category) }}</span></td>
                  <td>
                    <div class="desc">{{ e.description }}</div>
                    @if (e.reference) { <div class="muted">Ref. {{ e.reference }}</div> }
                  </td>
                  <td>
                    @if (e.purchase) { <span class="muted">Compra #{{ e.purchase.id }}{{ e.purchase.supplier ? ' · ' + e.purchase.supplier : '' }}</span> }
                    @else if (e.payroll) { <span class="muted">Nómina · {{ e.payroll.employee.fullName }} · {{ e.payroll.period }}</span> }
                    @else if (e.client) {
                      <a [routerLink]="['/clients', e.client.idServicio]" class="link">{{ e.client.nombre }}</a>
                    } @else { <span class="muted">—</span> }
                  </td>
                  <td>{{ methodLabel(e.paymentMethod) }}</td>
                  <td class="t-right amount nowrap">RD$ {{ e.amount | number:'1.0-2' }}</td>
                  <td class="t-right">
                    @if (e.purchase || e.payroll) {
                      <span class="auto-tag" [title]="e.purchase ? 'Se creó con una compra de inventario. Para quitarlo, elimina la compra.' : 'Se creó con un pago de nómina. Para quitarlo, elimina el pago.'">Automático</span>
                    } @else {
                      <button type="button" class="btn btn-mini btn-danger-outline" (click)="deleteExpense(e)" title="Eliminar gasto" aria-label="Eliminar gasto">
                        <svg lucideTrash2 size="13"></svg>
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td colspan="5">Total de la lista ({{ expenses().length }} {{ expenses().length === 1 ? 'gasto' : 'gastos' }})</td>
                <td class="t-right amount nowrap">RD$ {{ listTotal() | number:'1.0-2' }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      }
    </div>

    @if (showModal()) {
      <div class="modal-backdrop" (click)="showModal.set(false)"></div>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Registrar gasto">
        <div class="modal-head"><h3>Registrar gasto</h3><button type="button" aria-label="Cerrar" (click)="showModal.set(false)"><svg lucideX size="18"></svg></button></div>
        <div class="modal-body">
          <div class="form-row two-col">
            <div>
              <label>Categoría</label>
              <select [(ngModel)]="form.category">
                @for (c of CATEGORIES; track c.id) { <option [value]="c.id">{{ c.label }}</option> }
              </select>
            </div>
            <div>
              <label>Fecha</label>
              <input type="date" [(ngModel)]="form.expenseDate" />
            </div>
          </div>
          <div class="form-row">
            <label>Descripción *</label>
            <input [(ngModel)]="form.description" placeholder="¿En qué se gastó?" [class.invalid]="tried() && !form.description" />
            @if (tried() && !form.description) { <small class="field-error">Escribe una descripción.</small> }
          </div>
          <div class="form-row two-col">
            <div>
              <label>Monto (RD$) *</label>
              <input type="number" step="0.01" min="0" [(ngModel)]="form.amount" [class.invalid]="tried() && !form.amount" />
              @if (tried() && !form.amount) { <small class="field-error">Escribe el monto.</small> }
            </div>
            <div>
              <label>Forma de pago</label>
              <select [(ngModel)]="form.paymentMethod">
                <option value="">Sin indicar</option>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
          </div>
          <div class="form-row two-col">
            <div>
              <label>Referencia / N.º de comprobante</label>
              <input [(ngModel)]="form.reference" placeholder="Opcional" />
            </div>
            <div class="client-field">
              <label>Cliente relacionado (opcional)</label>
              @if (form.clientIdServicio) {
                <div class="selected-client">
                  <span>{{ clientSearch }} <span class="muted">(#{{ form.clientIdServicio }})</span></span>
                  <button type="button" aria-label="Quitar cliente" title="Quitar cliente" (click)="form.clientIdServicio = null; clientSearch = ''"><svg lucideX size="13"></svg></button>
                </div>
              } @else {
                <input type="search" [(ngModel)]="clientSearch" (input)="searchClients()" placeholder="Buscar cliente…" />
                @if (clientResults().length > 0) {
                  <div class="search-list">
                    @for (c of clientResults(); track c.id_servicio) {
                      <button type="button" class="search-item" (click)="form.clientIdServicio = c.id_servicio; clientSearch = c.nombre; clientResults.set([])">
                        {{ c.nombre }} <span class="muted">(#{{ c.id_servicio }})</span>
                      </button>
                    }
                  </div>
                }
              }
            </div>
          </div>
          <div class="form-row">
            <label>Notas</label>
            <textarea [(ngModel)]="form.notes" rows="2" placeholder="Opcional"></textarea>
          </div>
        </div>
        <div class="modal-foot">
          @if (!form.description || !form.amount) {
            <span class="foot-hint">{{ !form.description ? 'Falta la descripción.' : 'Falta el monto.' }}</span>
          }
          <button type="button" class="btn btn-outline" (click)="showModal.set(false)">Cancelar</button>
          <button type="button" class="btn btn-primary" (click)="tried.set(true); save()" [disabled]="saving() || !form.description || !form.amount">{{ saving() ? 'Guardando…' : 'Guardar gasto' }}</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .page { padding: 24px 32px; }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .stat-card { background: white; border: 1px solid #dfe5ea; border-left: 4px solid #ccd6de; border-radius: 8px; padding: 14px 16px; }
    .stat-card.accent { border-left-color: #1267dd; }
    .stat-label { font-size: 12px; color: #667582; font-weight: 600; }
    .stat-value { font-size: 20px; font-weight: 700; color: #172535; margin-top: 4px; white-space: nowrap; }
    .stat-sub { font-size: 11px; color: #667582; margin-top: 2px; }

    .card { background: white; border: 1px solid #dfe5ea; border-radius: 8px; padding: 18px; margin-bottom: 20px; }
    .card h4 { margin: 0 0 14px; color: #172535; font-size: 14px; }
    .months-scroll { overflow-x: auto; }
    .months { display: flex; gap: 10px; align-items: flex-end; height: 160px; min-width: 520px; }
    .month-bar { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%; min-width: 36px; }
    .month-bar-fill { width: 100%; max-width: 44px; background: #1267dd; border-radius: 4px 4px 0 0; min-height: 4px; }
    .month-bar:hover .month-bar-fill { background: #0d58c0; }
    .month-label { font-size: 11px; color: #334250; margin-top: 6px; white-space: nowrap; }
    .month-value { font-size: 11px; color: #667582; margin-bottom: 4px; white-space: nowrap; }
    .chart-note { margin: 8px 0 0; font-size: 11px; color: #667582; }

    .toolbar { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; }
    .filter { display: flex; flex-direction: column; gap: 3px; }
    .filter span { font-size: 11px; font-weight: 600; color: #667582; }
    .filters select, .filters input { padding: 7px 10px; border: 1px solid #ccd6de; border-radius: 6px; font-size: 13px; color: #334250; background: white; font-family: inherit; }
    .clear-btn { height: 34px; }

    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-primary { background: #1267dd; color: white; }
    .btn-primary:hover:not(:disabled) { background: #0d58c0; }
    .btn-outline { background: white; border-color: #ccd6de; color: #334250; }
    .btn-outline:hover:not(:disabled) { border-color: #1267dd; color: #1267dd; }
    .btn-danger-outline { background: white; border-color: #f0c4bf; color: #b42318; padding: 5px 7px; }
    .btn-danger-outline:hover { background: #fff0ef; }
    .btn-mini { padding: 5px 9px; font-size: 12px; }

    .table-wrap { background: white; border: 1px solid #dfe5ea; border-radius: 8px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 11px 12px; border-bottom: 1px solid #f0f3f6; font-size: 13px; color: #334250; }
    th { background: #f8fafc; color: #667582; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
    tbody tr:hover td { background: #f8fafc; }
    tfoot td { background: #f8fafc; font-weight: 600; color: #172535; border-bottom: none; }
    .t-right { text-align: right; }
    .nowrap { white-space: nowrap; }
    .desc { color: #172535; }
    .amount { font-weight: 600; color: #172535; }
    .muted { color: #667582; font-size: 12px; }
    .link { color: #1267dd; text-decoration: none; font-weight: 600; }
    .link:hover { text-decoration: underline; }
    .cat-pill { padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .auto-tag { font-size: 11px; color: #667582; background: #f1f4f7; padding: 2px 8px; border-radius: 999px; cursor: help; white-space: nowrap; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

    .loading-state, .empty-state { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 56px 20px; gap: 10px; color: #667582; background: white; border: 1px dashed #dfe5ea; border-radius: 8px; font-size: 13px; }
    .empty-state svg { color: #b6c2cc; }
    .empty-state h3 { color: #172535; margin: 4px 0 0; font-size: 16px; }
    .empty-state p { margin: 0; max-width: 440px; }
    .spinner { width: 28px; height: 28px; border: 3px solid #dfe5ea; border-top-color: #1267dd; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .modal-backdrop { position: fixed; inset: 0; background: rgba(17, 26, 36, 0.55); z-index: 200; }
    .modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 8px; width: 600px; max-width: calc(100vw - 32px); max-height: 90vh; display: flex; flex-direction: column; z-index: 201; box-shadow: 0 20px 60px rgba(17, 26, 36, 0.25); }
    .modal-head { padding: 16px 20px; border-bottom: 1px solid #f0f3f6; display: flex; justify-content: space-between; align-items: center; }
    .modal-head h3 { margin: 0; color: #172535; font-size: 16px; }
    .modal-head button { display: grid; place-items: center; background: none; border: none; cursor: pointer; color: #667582; padding: 4px; border-radius: 6px; }
    .modal-head button:hover { background: #f2f7ff; color: #172535; }
    .modal-body { padding: 18px 20px; overflow: auto; }
    .modal-foot { padding: 14px 20px; border-top: 1px solid #f0f3f6; display: flex; justify-content: flex-end; align-items: center; gap: 10px; flex-wrap: wrap; }
    .foot-hint { margin-right: auto; font-size: 12px; color: #667582; }
    .form-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .form-row label { font-size: 12px; color: #334250; font-weight: 600; }
    .form-row input, .form-row select, .form-row textarea { padding: 9px 11px; border: 1px solid #ccd6de; border-radius: 6px; font-size: 13px; font-family: inherit; color: #334250; background: white; outline: none; }
    .form-row input:focus, .form-row select:focus, .form-row textarea:focus { border-color: #1267dd; box-shadow: 0 0 0 3px rgba(18, 103, 221, 0.12); }
    .form-row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form-row.two-col > div { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .invalid { border-color: #b42318 !important; }
    .field-error { color: #b42318; font-size: 12px; }
    .client-field { position: relative; }
    .selected-client { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; border: 1px solid #cfe0fa; background: #f2f7ff; border-radius: 6px; font-size: 13px; color: #172535; }
    .selected-client button { display: grid; place-items: center; background: none; border: none; cursor: pointer; color: #667582; padding: 2px; border-radius: 4px; }
    .search-list { background: white; border: 1px solid #dfe5ea; border-radius: 6px; max-height: 200px; overflow: auto; position: absolute; top: 100%; left: 0; right: 0; z-index: 5; box-shadow: 0 8px 20px rgba(17, 26, 36, 0.12); }
    .search-item { display: block; width: 100%; text-align: left; background: white; border: none; padding: 9px 12px; cursor: pointer; border-bottom: 1px solid #f0f3f6; font-size: 13px; color: #172535; font-family: inherit; }
    .search-item:hover { background: #f2f7ff; }

    @media (max-width: 768px) {
      .page { padding: 16px; }
      .filters { width: 100%; }
      .filter { flex: 1 1 140px; }
      .form-row.two-col { grid-template-columns: 1fr; }
    }
  `]
})
export class ExpensesComponent implements OnInit {
  private http = inject(HttpClient);
  private db = inject(LocalDbService);
  private toast = inject(ToastService);

  CATEGORIES = CATEGORIES;
  loading = signal(false);
  expenses = signal<Expense[]>([]);
  stats = signal<Stats>({ total: 0, count: 0, byCategory: [], byMonth: [] });
  showModal = signal(false);
  saving = signal(false);
  /** Muestra la validación después del primer intento de guardar. */
  tried = signal(false);

  filterCategory = '';
  filterFrom = '';
  filterTo = '';

  form: any = { category: 'otros', description: '', amount: 0, expenseDate: new Date().toISOString().slice(0, 10), paymentMethod: '', reference: '', clientIdServicio: null, notes: '' };
  clientSearch = '';
  clientResults = signal<any[]>([]);

  async ngOnInit() {
    await Promise.all([this.loadStats(), this.loadExpenses()]);
  }

  catLabel(id: string) { return CATEGORIES.find(c => c.id === id)?.label || id; }
  catColor(id: string) { return CATEGORIES.find(c => c.id === id)?.color || '#667582'; }

  methodLabel(m?: string): string {
    if (!m) return '—';
    const labels: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', cheque: 'Cheque' };
    return labels[m] || m;
  }

  /** "2025-05" -> "may 25" (solo visual). */
  monthLabel(ym: string): string {
    const [y, mo] = String(ym || '').split('-');
    const names = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const idx = Number(mo) - 1;
    if (!y || idx < 0 || idx > 11) return ym;
    return `${names[idx]} ${y.slice(2)}`;
  }

  /** Suma de los gastos que se ven en la tabla (solo informativo). */
  listTotal(): number {
    return this.expenses().reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }

  clearFilters() {
    this.filterCategory = '';
    this.filterFrom = '';
    this.filterTo = '';
    this.loadExpenses();
  }
  maxMonth() { return Math.max(1, ...this.stats().byMonth.map(m => m.total)); }

  loadStats() {
    const params: any = {};
    if (this.filterFrom) params.from = this.filterFrom;
    if (this.filterTo) params.to = this.filterTo;
    return new Promise<void>(r => this.http.get<Stats>('/expenses/stats', { params }).subscribe({
      next: s => { this.stats.set(s); r(); },
      error: () => r(),
    }));
  }

  loadExpenses() {
    this.loading.set(true);
    const params: any = {};
    if (this.filterCategory) params.category = this.filterCategory;
    if (this.filterFrom) params.from = this.filterFrom;
    if (this.filterTo) params.to = this.filterTo;
    this.http.get<Expense[]>('/expenses', { params }).subscribe({
      next: e => { this.expenses.set(e); this.loading.set(false); this.loadStats(); },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err?.status === 0 ? 'Sin conexión con el servidor. No se pudieron cargar los gastos.' : 'No se pudieron cargar los gastos.');
      },
    });
  }

  openNew() {
    this.form = { category: 'otros', description: '', amount: 0, expenseDate: new Date().toISOString().slice(0, 10), paymentMethod: '', reference: '', clientIdServicio: null, notes: '' };
    this.clientSearch = '';
    this.clientResults.set([]);
    this.tried.set(false);
    this.showModal.set(true);
  }

  async searchClients() {
    if (!this.clientSearch || this.clientSearch.length < 2) { this.clientResults.set([]); return; }
    const all = await this.db.getClients();
    const q = this.clientSearch.toLowerCase();
    const matches = all.filter((c: any) =>
      (c.nombre || '').toLowerCase().includes(q) ||
      String(c.id_servicio).includes(q)
    ).slice(0, 6);
    this.clientResults.set(matches);
  }

  save() {
    this.saving.set(true);
    this.http.post('/expenses', this.form).subscribe({
      next: () => {
        this.saving.set(false);
        this.showModal.set(false);
        this.toast.success('Gasto registrado');
        this.loadExpenses();
      },
      error: (err) => {
        this.saving.set(false);
        const msg = err?.status === 0 ? 'no hay conexión con el servidor' : (err?.error?.error || 'intenta de nuevo');
        console.error('[expenses] save:', err);
        this.toast.error(`No se pudo guardar el gasto: ${msg}`);
      },
    });
  }

  deleteExpense(e: Expense) {
    if (e.purchase || e.payroll) return;
    if (!confirm(`¿Eliminar el gasto "${e.description}" de RD$ ${Number(e.amount || 0).toLocaleString('es-DO')}?\n\nNo se puede deshacer.`)) return;
    this.http.delete(`/expenses/${e.id}`).subscribe({
      next: () => { this.toast.success('Gasto eliminado'); this.loadExpenses(); },
      error: (err) => this.toast.error('No se pudo eliminar el gasto: ' + (err?.error?.error || 'intenta de nuevo')),
    });
  }
}
