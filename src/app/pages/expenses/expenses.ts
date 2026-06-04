import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../components/layout/navbar';
import { LocalDbService } from '../../services/local-db.service';

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
  { id: 'inventario', label: 'Inventario', color: '#6366f1' },
  { id: 'nomina', label: 'Nómina', color: '#22c55e' },
  { id: 'servicios', label: 'Servicios (luz, internet, etc.)', color: '#f59e0b' },
  { id: 'transporte', label: 'Transporte', color: '#06b6d4' },
  { id: 'otros', label: 'Otros', color: '#94a3b8' },
];

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [NavbarComponent, FormsModule, DecimalPipe, DatePipe, RouterLink],
  template: `
    <app-navbar pageTitle="Gastos" />

    <div class="page">
      <!-- STATS -->
      <div class="stats-row">
        <div class="stat-card accent">
          <div class="stat-label">Total gastado</div>
          <div class="stat-value">RD$ {{ stats().total | number:'1.0-0' }}</div>
          <div class="stat-sub">{{ stats().count }} registros</div>
        </div>
        @for (cat of stats().byCategory; track cat.category) {
          <div class="stat-card">
            <div class="stat-label">{{ catLabel(cat.category) }}</div>
            <div class="stat-value">RD$ {{ cat._sum.amount | number:'1.0-0' }}</div>
            <div class="stat-sub">{{ cat._count._all }} registros</div>
          </div>
        }
      </div>

      <!-- Histórico mensual -->
      @if (stats().byMonth.length > 0) {
        <div class="card">
          <h4>Últimos 12 meses</h4>
          <div class="months">
            @for (m of stats().byMonth.slice().reverse(); track m.month) {
              <div class="month-bar">
                <div class="month-bar-fill" [style.height.%]="(m.total / maxMonth()) * 100"></div>
                <div class="month-label">{{ m.month.slice(5) }}</div>
                <div class="month-value">RD$ {{ m.total | number:'1.0-0' }}</div>
              </div>
            }
          </div>
        </div>
      }

      <div class="toolbar">
        <div class="filters">
          <select [(ngModel)]="filterCategory" (change)="loadExpenses()">
            <option value="">Todas las categorías</option>
            @for (c of CATEGORIES; track c.id) { <option [value]="c.id">{{ c.label }}</option> }
          </select>
          <input type="date" [(ngModel)]="filterFrom" (change)="loadExpenses()" />
          <input type="date" [(ngModel)]="filterTo" (change)="loadExpenses()" />
        </div>
        <button class="btn btn-primary" (click)="openNew()">+ Registrar gasto</button>
      </div>

      @if (loading()) {
        <div class="loading-state"><div class="spinner"></div></div>
      } @else if (expenses().length === 0) {
        <div class="empty-state">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
          <h3>Sin gastos</h3>
          <p>Empezá registrando tu primer gasto.</p>
        </div>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Categoría</th>
                <th>Descripción</th>
                <th>Origen / Destino</th>
                <th>Método</th>
                <th class="t-right">Monto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (e of expenses(); track e.id) {
                <tr>
                  <td>{{ e.expenseDate | date:'shortDate' }}</td>
                  <td><span class="cat-pill" [style.background]="catColor(e.category) + '22'" [style.color]="catColor(e.category)">{{ catLabel(e.category) }}</span></td>
                  <td>
                    <div>{{ e.description }}</div>
                    @if (e.reference) { <div class="muted">#{{ e.reference }}</div> }
                  </td>
                  <td>
                    @if (e.purchase) { <span class="muted">Compra #{{ e.purchase.id }} · {{ e.purchase.supplier }}</span> }
                    @else if (e.payroll) { <span class="muted">Nómina · {{ e.payroll.employee.fullName }} · {{ e.payroll.period }}</span> }
                    @else if (e.client) {
                      <a [routerLink]="['/clients', e.client.idServicio]" class="link">{{ e.client.nombre }}</a>
                    } @else { <span class="muted">—</span> }
                  </td>
                  <td>{{ e.paymentMethod || '—' }}</td>
                  <td class="t-right amount">RD$ {{ e.amount | number:'1.0-2' }}</td>
                  <td class="t-right">
                    <button class="btn btn-mini btn-outline" (click)="deleteExpense(e)" [disabled]="!!e.purchase || !!e.payroll" [title]="!!e.purchase || !!e.payroll ? 'Generado automáticamente, eliminá la compra/nómina' : ''">✕</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    @if (showModal()) {
      <div class="modal-backdrop" (click)="showModal.set(false)"></div>
      <div class="modal">
        <div class="modal-head"><h3>Registrar gasto</h3><button (click)="showModal.set(false)">✕</button></div>
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
            <label>Descripción</label>
            <input [(ngModel)]="form.description" placeholder="¿En qué se gastó?" />
          </div>
          <div class="form-row two-col">
            <div>
              <label>Monto (RD$)</label>
              <input type="number" step="0.01" [(ngModel)]="form.amount" />
            </div>
            <div>
              <label>Método de pago</label>
              <select [(ngModel)]="form.paymentMethod">
                <option value="">—</option>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
          </div>
          <div class="form-row two-col">
            <div>
              <label>Referencia / # comprobante</label>
              <input [(ngModel)]="form.reference" />
            </div>
            <div>
              <label>Cliente vinculado (opcional)</label>
              <input type="text" [(ngModel)]="clientSearch" (input)="searchClients()" placeholder="Buscar cliente..." />
              @if (clientResults().length > 0) {
                <div class="search-list">
                  @for (c of clientResults(); track c.id_servicio) {
                    <div class="search-item" (click)="form.clientIdServicio = c.id_servicio; clientSearch = c.nombre; clientResults.set([])">
                      {{ c.nombre }} <span class="muted">({{ c.id_servicio }})</span>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
          <div class="form-row">
            <label>Notas</label>
            <textarea [(ngModel)]="form.notes" rows="2"></textarea>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline" (click)="showModal.set(false)">Cancelar</button>
          <button class="btn btn-primary" (click)="save()" [disabled]="!form.description || !form.amount">Guardar</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .page { padding: 24px 32px; }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .stat-card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px; }
    .stat-card.accent { border-left: 4px solid #6366f1; }
    .stat-label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
    .stat-value { font-size: 22px; font-weight: 700; color: #0f172a; margin-top: 4px; }
    .stat-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }

    .card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; margin-bottom: 24px; }
    .card h4 { margin: 0 0 16px; color: #0f172a; }
    .months { display: flex; gap: 12px; align-items: flex-end; height: 140px; }
    .month-bar { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; position: relative; height: 100%; }
    .month-bar-fill { width: 100%; background: linear-gradient(180deg, #6366f1, #818cf8); border-radius: 6px 6px 0 0; min-height: 6px; }
    .month-label { font-size: 11px; color: #64748b; margin-top: 6px; }
    .month-value { font-size: 10px; color: #94a3b8; }

    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .filters select, .filters input { padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; }

    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; border-radius: 10px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-primary:disabled { background: #94a3b8; cursor: not-allowed; }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; }
    .btn-outline:hover { border-color: #6366f1; color: #6366f1; }
    .btn-outline:disabled { color: #cbd5e1; border-color: #f1f5f9; cursor: not-allowed; }
    .btn-mini { padding: 6px 10px; font-size: 12px; }

    .table-wrap { background: white; border: 1px solid #e2e8f0; border-radius: 14px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    th { background: #f8fafc; color: #64748b; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    tr:hover td { background: #fafbff; }
    .t-right { text-align: right; }
    .amount { font-weight: 600; color: #0f172a; }
    .muted { color: #94a3b8; font-size: 12px; }
    .link { color: #6366f1; text-decoration: none; font-weight: 500; }
    .cat-pill { padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }

    .loading-state, .empty-state { display: flex; flex-direction: column; align-items: center; padding: 80px; gap: 12px; color: #94a3b8; }
    .empty-state h3 { color: #475569; margin: 8px 0 0; }
    .spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .modal-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.55); z-index: 200; }
    .modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 16px; width: 600px; max-width: 95vw; max-height: 90vh; display: flex; flex-direction: column; z-index: 201; box-shadow: 0 20px 60px rgba(15,23,42,0.25); }
    .modal-head { padding: 18px 22px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
    .modal-head h3 { margin: 0; color: #0f172a; }
    .modal-head button { background: none; border: none; font-size: 20px; cursor: pointer; color: #94a3b8; }
    .modal-body { padding: 22px; overflow: auto; }
    .modal-foot { padding: 16px 22px; border-top: 1px solid #f1f5f9; display: flex; justify-content: flex-end; gap: 10px; }
    .form-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .form-row label { font-size: 12px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .form-row input, .form-row select, .form-row textarea { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; font-family: inherit; }
    .form-row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form-row.two-col > div { display: flex; flex-direction: column; gap: 6px; }
    .search-list { background: white; border: 1px solid #e2e8f0; border-radius: 8px; max-height: 200px; overflow: auto; margin-top: 4px; position: absolute; z-index: 5; width: 90%; }
    .search-item { padding: 10px 12px; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    .search-item:hover { background: #eef2ff; }
  `]
})
export class ExpensesComponent implements OnInit {
  private http = inject(HttpClient);
  private db = inject(LocalDbService);

  CATEGORIES = CATEGORIES;
  loading = signal(false);
  expenses = signal<Expense[]>([]);
  stats = signal<Stats>({ total: 0, count: 0, byCategory: [], byMonth: [] });
  showModal = signal(false);

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
  catColor(id: string) { return CATEGORIES.find(c => c.id === id)?.color || '#94a3b8'; }
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
      error: () => this.loading.set(false),
    });
  }

  openNew() {
    this.form = { category: 'otros', description: '', amount: 0, expenseDate: new Date().toISOString().slice(0, 10), paymentMethod: '', reference: '', clientIdServicio: null, notes: '' };
    this.clientSearch = '';
    this.clientResults.set([]);
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
    this.http.post('/expenses', this.form).subscribe({
      next: () => {
        this.showModal.set(false);
        this.loadExpenses();
      },
      error: (err) => {
        const msg = err?.error?.error || err?.message || 'Error desconocido';
        console.error('[expenses] save:', err);
        alert(`No se pudo guardar el gasto: ${msg}`);
      },
    });
  }

  deleteExpense(e: Expense) {
    if (e.purchase || e.payroll) return;
    if (!confirm(`¿Eliminar gasto "${e.description}"?`)) return;
    this.http.delete(`/expenses/${e.id}`).subscribe(() => this.loadExpenses());
  }
}
