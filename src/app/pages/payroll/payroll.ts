import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, DatePipe } from '@angular/common';
import { NavbarComponent } from '../../components/layout/navbar';

interface Employee {
  id: number; fullName: string; documentId?: string; position?: string;
  email?: string; phone?: string; baseSalary: number;
  hiredAt?: string; terminatedAt?: string; active: boolean; notes?: string;
  _count?: { payroll: number };
}
interface PayrollEntry {
  id: number; employeeId: number; period: string;
  periodStart: string; periodEnd: string;
  baseAmount: number; bonus: number; deductions: number; netAmount: number;
  paidAt?: string; paymentMethod?: string; status: string; notes?: string;
  employee?: { id: number; fullName: string; position?: string };
}

@Component({
  selector: 'app-payroll',
  standalone: true,
  imports: [NavbarComponent, FormsModule, DecimalPipe, DatePipe],
  template: `
    <app-navbar pageTitle="Nómina" />

    <div class="page">
      <div class="stats-row">
        <div class="stat-card accent">
          <div class="stat-label">Empleados activos</div>
          <div class="stat-value">{{ activeEmployees() }}</div>
        </div>
        <div class="stat-card success">
          <div class="stat-label">Pagado total</div>
          <div class="stat-value">RD$ {{ totalPaid() | number:'1.0-0' }}</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-label">Pendiente de pago</div>
          <div class="stat-value">RD$ {{ totalPending() | number:'1.0-0' }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Pagos registrados</div>
          <div class="stat-value">{{ entries().length }}</div>
        </div>
      </div>

      <div class="tabs">
        <button [class.active]="tab() === 'payroll'" (click)="tab.set('payroll')">Pagos</button>
        <button [class.active]="tab() === 'employees'" (click)="tab.set('employees')">Empleados</button>
      </div>

      @if (tab() === 'payroll') {
        <div class="toolbar">
          <div class="filters">
            <select [(ngModel)]="filterEmployee" (change)="loadEntries()">
              <option value="">Todos los empleados</option>
              @for (e of employees(); track e.id) { <option [value]="e.id">{{ e.fullName }}</option> }
            </select>
            <select [(ngModel)]="filterStatus" (change)="loadEntries()">
              <option value="">Todos los estados</option>
              <option value="pending">Pendiente</option>
              <option value="paid">Pagado</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>
          <button class="btn btn-primary" (click)="openNewEntry()" [disabled]="employees().length === 0">+ Nuevo pago</button>
        </div>

        @if (entries().length === 0) {
          <div class="empty-state"><h3>Sin pagos registrados</h3></div>
        } @else {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Período</th>
                  <th>Empleado</th>
                  <th>Cargo</th>
                  <th class="t-right">Base</th>
                  <th class="t-right">Bono</th>
                  <th class="t-right">Deduc.</th>
                  <th class="t-right">Neto</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (e of entries(); track e.id) {
                  <tr>
                    <td>
                      <div>{{ e.period }}</div>
                      <div class="muted">{{ e.periodStart | date:'shortDate' }} → {{ e.periodEnd | date:'shortDate' }}</div>
                    </td>
                    <td><strong>{{ e.employee?.fullName }}</strong></td>
                    <td><span class="muted">{{ e.employee?.position || '—' }}</span></td>
                    <td class="t-right">{{ e.baseAmount | number:'1.0-2' }}</td>
                    <td class="t-right positive">+{{ e.bonus | number:'1.0-2' }}</td>
                    <td class="t-right negative">−{{ e.deductions | number:'1.0-2' }}</td>
                    <td class="t-right net">RD$ {{ e.netAmount | number:'1.0-2' }}</td>
                    <td><span class="status-pill" [class]="'st-' + e.status">{{ statusLabel(e.status) }}</span></td>
                    <td class="t-right">
                      @if (e.status === 'pending') {
                        <button class="btn btn-mini btn-primary" (click)="markPaid(e)">Marcar pagado</button>
                      } @else if (e.status === 'paid') {
                        <span class="muted">{{ e.paidAt | date:'shortDate' }}</span>
                      }
                      <button class="btn btn-mini btn-outline" (click)="deleteEntry(e)">✕</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }

      @if (tab() === 'employees') {
        <div class="toolbar">
          <h3>{{ employees().length }} empleados ({{ activeEmployees() }} activos)</h3>
          <button class="btn btn-primary" (click)="openNewEmployee()">+ Nuevo empleado</button>
        </div>

        @if (employees().length === 0) {
          <div class="empty-state"><h3>Sin empleados</h3><p>Agregá tu primer empleado para empezar a registrar nómina.</p></div>
        } @else {
          <div class="emp-grid">
            @for (e of employees(); track e.id) {
              <div class="emp-card" [class.inactive]="!e.active">
                <div class="emp-avatar">{{ initials(e.fullName) }}</div>
                <div class="emp-info">
                  <div class="emp-name">{{ e.fullName }}</div>
                  <div class="muted">{{ e.position || 'Sin cargo' }}</div>
                  <div class="emp-salary">RD$ {{ e.baseSalary | number:'1.0-0' }}/mes</div>
                  <div class="emp-meta">
                    @if (e.documentId) { <span>📇 {{ e.documentId }}</span> }
                    @if (e.phone) { <span>📞 {{ e.phone }}</span> }
                    <span class="muted">{{ e._count?.payroll || 0 }} pagos</span>
                  </div>
                </div>
                <div class="emp-actions">
                  <button class="btn btn-mini btn-outline" (click)="editEmployee(e)">Editar</button>
                  @if (e.active) {
                    <button class="btn btn-mini btn-outline" (click)="deactivate(e)">Desactivar</button>
                  } @else {
                    <button class="btn btn-mini btn-primary" (click)="reactivate(e)">Activar</button>
                  }
                </div>
              </div>
            }
          </div>
        }
      }
    </div>

    <!-- MODAL EMPLEADO -->
    @if (showEmpModal()) {
      <div class="modal-backdrop" (click)="showEmpModal.set(false)"></div>
      <div class="modal small">
        <div class="modal-head"><h3>{{ empForm.id ? 'Editar' : 'Nuevo' }} empleado</h3><button (click)="showEmpModal.set(false)">✕</button></div>
        <div class="modal-body">
          <div class="form-row"><label>Nombre completo</label><input [(ngModel)]="empForm.fullName" /></div>
          <div class="form-row two-col">
            <div><label>Cédula / ID</label><input [(ngModel)]="empForm.documentId" /></div>
            <div><label>Cargo</label><input [(ngModel)]="empForm.position" placeholder="Técnico, Cajero, ..." /></div>
          </div>
          <div class="form-row two-col">
            <div><label>Email</label><input [(ngModel)]="empForm.email" /></div>
            <div><label>Teléfono</label><input [(ngModel)]="empForm.phone" /></div>
          </div>
          <div class="form-row two-col">
            <div><label>Salario base (RD$)</label><input type="number" [(ngModel)]="empForm.baseSalary" /></div>
            <div><label>Fecha de ingreso</label><input type="date" [(ngModel)]="empForm.hiredAt" /></div>
          </div>
          <div class="form-row"><label>Notas</label><textarea [(ngModel)]="empForm.notes" rows="2"></textarea></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline" (click)="showEmpModal.set(false)">Cancelar</button>
          <button class="btn btn-primary" (click)="saveEmployee()" [disabled]="!empForm.fullName">Guardar</button>
        </div>
      </div>
    }

    <!-- MODAL PAGO -->
    @if (showEntryModal()) {
      <div class="modal-backdrop" (click)="showEntryModal.set(false)"></div>
      <div class="modal">
        <div class="modal-head"><h3>Nuevo pago de nómina</h3><button (click)="showEntryModal.set(false)">✕</button></div>
        <div class="modal-body">
          <div class="form-row">
            <label>Empleado</label>
            <select [(ngModel)]="entryForm.employeeId" (change)="onEmployeeChange()">
              <option [ngValue]="null">— Seleccionar —</option>
              @for (e of activeEmpList(); track e.id) {
                <option [ngValue]="e.id">{{ e.fullName }} ({{ e.position || 'sin cargo' }})</option>
              }
            </select>
          </div>
          <div class="form-row"><label>Período (etiqueta)</label><input [(ngModel)]="entryForm.period" placeholder="2026-06 o Q-jun 2026" /></div>
          <div class="form-row two-col">
            <div><label>Desde</label><input type="date" [(ngModel)]="entryForm.periodStart" /></div>
            <div><label>Hasta</label><input type="date" [(ngModel)]="entryForm.periodEnd" /></div>
          </div>
          <div class="form-row two-col">
            <div><label>Base (RD$)</label><input type="number" step="0.01" [(ngModel)]="entryForm.baseAmount" /></div>
            <div><label>Bono</label><input type="number" step="0.01" [(ngModel)]="entryForm.bonus" /></div>
          </div>
          <div class="form-row two-col">
            <div><label>Deducciones</label><input type="number" step="0.01" [(ngModel)]="entryForm.deductions" /></div>
            <div>
              <label>Estado</label>
              <select [(ngModel)]="entryForm.status">
                <option value="pending">Pendiente</option>
                <option value="paid">Pagado</option>
              </select>
            </div>
          </div>
          @if (entryForm.status === 'paid') {
            <div class="form-row two-col">
              <div><label>Fecha de pago</label><input type="date" [(ngModel)]="entryForm.paidAt" /></div>
              <div>
                <label>Método</label>
                <select [(ngModel)]="entryForm.paymentMethod">
                  <option value="">—</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
            </div>
          }
          <div class="form-row"><label>Notas</label><textarea [(ngModel)]="entryForm.notes" rows="2"></textarea></div>
          <div class="net-preview">
            <strong>Neto a pagar: RD$ {{ netPreview() | number:'1.0-2' }}</strong>
            @if (entryForm.status === 'paid') { <span class="muted">Se generará un gasto automático en categoría "nómina"</span> }
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline" (click)="showEntryModal.set(false)">Cancelar</button>
          <button class="btn btn-primary" (click)="saveEntry()" [disabled]="!entryForm.employeeId || !entryForm.period">Guardar</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .page { padding: 24px 32px; }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .stat-card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px; }
    .stat-card.accent { border-left: 4px solid #6366f1; }
    .stat-card.success { border-left: 4px solid #22c55e; }
    .stat-card.warning { border-left: 4px solid #f59e0b; }
    .stat-label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
    .stat-value { font-size: 24px; font-weight: 700; color: #0f172a; margin-top: 4px; }

    .tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; }
    .tabs button { background: none; border: none; padding: 10px 18px; cursor: pointer; color: #64748b; font-weight: 500; border-bottom: 2px solid transparent; }
    .tabs button.active { color: #6366f1; border-bottom-color: #6366f1; }

    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .filters select { padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; }

    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; border-radius: 10px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-primary:disabled { background: #94a3b8; cursor: not-allowed; }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; }
    .btn-outline:hover { border-color: #6366f1; color: #6366f1; }
    .btn-mini { padding: 6px 10px; font-size: 12px; }

    .table-wrap { background: white; border: 1px solid #e2e8f0; border-radius: 14px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid #f1f5f9; font-size: 14px; vertical-align: top; }
    th { background: #f8fafc; color: #64748b; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    tr:hover td { background: #fafbff; }
    .t-right { text-align: right; }
    .net { font-weight: 700; color: #0f172a; }
    .positive { color: #16a34a; }
    .negative { color: #ef4444; }
    .muted { color: #94a3b8; font-size: 12px; }

    .status-pill { padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .st-pending { background: #fef3c7; color: #b45309; }
    .st-paid { background: #dcfce7; color: #16a34a; }
    .st-cancelled { background: #f1f5f9; color: #64748b; }

    .emp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .emp-card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px; display: flex; gap: 14px; }
    .emp-card.inactive { opacity: 0.55; }
    .emp-avatar { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #818cf8); color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 20px; flex-shrink: 0; }
    .emp-info { flex: 1; }
    .emp-name { font-weight: 600; color: #0f172a; }
    .emp-salary { font-size: 18px; font-weight: 700; color: #6366f1; margin: 6px 0; }
    .emp-meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: #64748b; }
    .emp-actions { display: flex; flex-direction: column; gap: 6px; justify-content: center; }

    .empty-state { display: flex; flex-direction: column; align-items: center; padding: 80px; gap: 12px; color: #94a3b8; }
    .empty-state h3 { color: #475569; margin: 8px 0 0; }

    .modal-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.55); z-index: 200; }
    .modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 16px; width: 640px; max-width: 95vw; max-height: 90vh; display: flex; flex-direction: column; z-index: 201; box-shadow: 0 20px 60px rgba(15,23,42,0.25); }
    .modal.small { width: 480px; }
    .modal-head { padding: 18px 22px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
    .modal-head h3 { margin: 0; color: #0f172a; }
    .modal-head button { background: none; border: none; font-size: 20px; cursor: pointer; color: #94a3b8; }
    .modal-body { padding: 22px; overflow: auto; }
    .modal-foot { padding: 16px 22px; border-top: 1px solid #f1f5f9; display: flex; justify-content: flex-end; gap: 10px; }
    .net-preview { padding: 12px; background: #eef2ff; border-radius: 10px; margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
    .form-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .form-row label { font-size: 12px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .form-row input, .form-row select, .form-row textarea { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; font-family: inherit; }
    .form-row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form-row.two-col > div { display: flex; flex-direction: column; gap: 6px; }
  `]
})
export class PayrollComponent implements OnInit {
  private http = inject(HttpClient);

  tab = signal<'payroll' | 'employees'>('payroll');
  employees = signal<Employee[]>([]);
  entries = signal<PayrollEntry[]>([]);

  filterEmployee = '';
  filterStatus = '';

  showEmpModal = signal(false);
  showEntryModal = signal(false);

  empForm: any = { id: null, fullName: '', documentId: '', position: '', email: '', phone: '', baseSalary: 0, hiredAt: '', notes: '' };
  entryForm: any = { employeeId: null, period: '', periodStart: '', periodEnd: '', baseAmount: 0, bonus: 0, deductions: 0, paidAt: '', paymentMethod: '', status: 'pending', notes: '' };

  activeEmployees = computed(() => this.employees().filter(e => e.active).length);
  activeEmpList = computed(() => this.employees().filter(e => e.active));
  totalPaid = computed(() => this.entries().filter(e => e.status === 'paid').reduce((s, e) => s + e.netAmount, 0));
  totalPending = computed(() => this.entries().filter(e => e.status === 'pending').reduce((s, e) => s + e.netAmount, 0));
  netPreview = computed(() => (Number(this.entryForm.baseAmount) || 0) + (Number(this.entryForm.bonus) || 0) - (Number(this.entryForm.deductions) || 0));

  async ngOnInit() {
    await Promise.all([this.loadEmployees(), this.loadEntries()]);
  }

  statusLabel(s: string) { return { pending: 'Pendiente', paid: 'Pagado', cancelled: 'Cancelado' }[s] || s; }
  initials(name: string) { return (name || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(); }

  loadEmployees() {
    return new Promise<void>(r => this.http.get<Employee[]>('/employees').subscribe({
      next: e => { this.employees.set(e); r(); },
      error: () => r(),
    }));
  }

  loadEntries() {
    const params: any = {};
    if (this.filterEmployee) params.employeeId = this.filterEmployee;
    if (this.filterStatus) params.status = this.filterStatus;
    return new Promise<void>(r => this.http.get<PayrollEntry[]>('/payroll', { params }).subscribe({
      next: e => { this.entries.set(e); r(); },
      error: () => r(),
    }));
  }

  openNewEmployee() {
    this.empForm = { id: null, fullName: '', documentId: '', position: '', email: '', phone: '', baseSalary: 0, hiredAt: '', notes: '' };
    this.showEmpModal.set(true);
  }
  editEmployee(e: Employee) {
    this.empForm = { ...e, hiredAt: e.hiredAt ? e.hiredAt.slice(0, 10) : '' };
    this.showEmpModal.set(true);
  }
  saveEmployee() {
    if (!this.empForm.fullName) return;
    const req = this.empForm.id
      ? this.http.put(`/employees/${this.empForm.id}`, this.empForm)
      : this.http.post('/employees', this.empForm);
    req.subscribe({
      next: () => { this.showEmpModal.set(false); this.loadEmployees(); },
      error: (err) => this.notifyError('guardar empleado', err),
    });
  }
  deactivate(e: Employee) {
    if (!confirm(`¿Desactivar a ${e.fullName}?`)) return;
    this.http.put(`/employees/${e.id}`, { active: false, terminatedAt: new Date().toISOString() }).subscribe(() => this.loadEmployees());
  }
  reactivate(e: Employee) {
    this.http.put(`/employees/${e.id}`, { active: true, terminatedAt: null }).subscribe(() => this.loadEmployees());
  }

  openNewEntry() {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
    const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    this.entryForm = { employeeId: null, period, periodStart: start, periodEnd: end, baseAmount: 0, bonus: 0, deductions: 0, paidAt: today.toISOString().slice(0, 10), paymentMethod: '', status: 'pending', notes: '' };
    this.showEntryModal.set(true);
  }

  onEmployeeChange() {
    const emp = this.employees().find(e => e.id === Number(this.entryForm.employeeId));
    if (emp) this.entryForm.baseAmount = emp.baseSalary;
  }

  private notifyError(action: string, err: any) {
    const msg = err?.error?.error || err?.message || 'Error desconocido';
    console.error(`[payroll] ${action}:`, err);
    alert(`Error al ${action}: ${msg}`);
  }

  saveEntry() {
    if (!this.entryForm.employeeId || !this.entryForm.period) return;
    this.http.post('/payroll', this.entryForm).subscribe({
      next: () => { this.showEntryModal.set(false); this.loadEntries(); },
      error: (err) => this.notifyError('guardar pago', err),
    });
  }

  markPaid(e: PayrollEntry) {
    this.http.post(`/payroll/${e.id}/pay`, { paidAt: new Date().toISOString() }).subscribe({
      next: () => this.loadEntries(),
      error: (err) => this.notifyError('marcar pagado', err),
    });
  }

  deleteEntry(e: PayrollEntry) {
    if (!confirm(`¿Eliminar pago de ${e.employee?.fullName} (${e.period})?`)) return;
    this.http.delete(`/payroll/${e.id}`).subscribe(() => this.loadEntries());
  }
}
