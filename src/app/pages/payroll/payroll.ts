import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, DatePipe } from '@angular/common';
import { NavbarComponent } from '../../components/layout/navbar';
import { ToastService } from '../../services/toast.service';
import { initialsOf } from '../../pipes/initials';
import {
  LucideCircleCheck, LucideIdCard, LucidePencil, LucidePhone, LucidePlus, LucideTrash2,
  LucideUserCheck, LucideUserX, LucideUsers, LucideWallet, LucideX,
} from '@lucide/angular';

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
  imports: [
    NavbarComponent, FormsModule, DecimalPipe, DatePipe,
    LucideCircleCheck, LucideIdCard, LucidePencil, LucidePhone, LucidePlus, LucideTrash2,
    LucideUserCheck, LucideUserX, LucideUsers, LucideWallet, LucideX,
  ],
  template: `
    <app-navbar pageTitle="Nómina" />

    <div class="page">
      <div class="stats-row">
        <div class="stat-card accent">
          <div class="stat-label">Empleados activos</div>
          <div class="stat-value">{{ activeEmployees() }}</div>
        </div>
        <div class="stat-card success">
          <div class="stat-label">Total pagado</div>
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
      @if (filterEmployee || filterStatus) {
        <p class="stats-note">Los totales corresponden a los pagos filtrados.</p>
      }

      <div class="tabs" role="tablist">
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'payroll'" [class.active]="tab() === 'payroll'" (click)="tab.set('payroll')">
          <svg lucideWallet size="15"></svg> Pagos
        </button>
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'employees'" [class.active]="tab() === 'employees'" (click)="tab.set('employees')">
          <svg lucideUsers size="15"></svg> Empleados <span class="tab-count">{{ employees().length }}</span>
        </button>
      </div>

      @if (tab() === 'payroll') {
        <div class="toolbar">
          <div class="filters">
            <select [(ngModel)]="filterEmployee" (change)="loadEntries()" aria-label="Filtrar por empleado">
              <option value="">Todos los empleados</option>
              @for (e of employees(); track e.id) { <option [value]="e.id">{{ e.fullName }}</option> }
            </select>
            <select [(ngModel)]="filterStatus" (change)="loadEntries()" aria-label="Filtrar por estado">
              <option value="">Todos los estados</option>
              <option value="pending">Pendiente</option>
              <option value="paid">Pagado</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>
          <button type="button" class="btn btn-primary" (click)="openNewEntry()" [disabled]="activeEmployees() === 0"
            [title]="activeEmployees() === 0 ? 'Primero agrega un empleado activo en la pestaña Empleados' : ''">
            <svg lucidePlus size="16"></svg> Nuevo pago
          </button>
        </div>

        @if (entries().length === 0) {
          <div class="empty-state">
            <svg lucideWallet size="44"></svg>
            @if (filterEmployee || filterStatus) {
              <h3>No hay pagos con estos filtros</h3>
              <p>Cambia el empleado o el estado para ver otros pagos.</p>
            } @else if (activeEmployees() === 0) {
              <h3>Todavía no hay pagos</h3>
              <p>Primero agrega tus empleados en la pestaña <strong>Empleados</strong>. Después podrás registrar sus pagos aquí.</p>
            } @else {
              <h3>Todavía no hay pagos</h3>
              <p>Toca <strong>Nuevo pago</strong> para registrar el primer pago de nómina.</p>
            }
          </div>
        } @else {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Período</th>
                  <th>Empleado</th>
                  <th class="t-right">Salario base</th>
                  <th class="t-right">Bono</th>
                  <th class="t-right">Descuentos</th>
                  <th class="t-right">Neto</th>
                  <th>Estado</th>
                  <th class="t-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                @for (e of entries(); track e.id) {
                  <tr>
                    <td>
                      <div class="strong">{{ e.period }}</div>
                      <div class="muted nowrap">{{ e.periodStart | date:'dd/MM/yyyy' }} al {{ e.periodEnd | date:'dd/MM/yyyy' }}</div>
                    </td>
                    <td>
                      <div class="strong">{{ e.employee?.fullName }}</div>
                      @if (e.employee?.position) { <div class="muted">{{ e.employee?.position }}</div> }
                    </td>
                    <td class="t-right nowrap">RD$ {{ e.baseAmount | number:'1.0-2' }}</td>
                    <td class="t-right nowrap" [class.positive]="e.bonus > 0" [class.muted]="!e.bonus">{{ e.bonus ? '+' + (e.bonus | number:'1.0-2') : '—' }}</td>
                    <td class="t-right nowrap" [class.negative]="e.deductions > 0" [class.muted]="!e.deductions">{{ e.deductions ? '−' + (e.deductions | number:'1.0-2') : '—' }}</td>
                    <td class="t-right net nowrap">RD$ {{ e.netAmount | number:'1.0-2' }}</td>
                    <td>
                      <span class="status-pill" [class]="'st-' + e.status">{{ statusLabel(e.status) }}</span>
                      @if (e.status === 'paid' && e.paidAt) {
                        <div class="muted nowrap">{{ e.paidAt | date:'dd/MM/yyyy' }}{{ e.paymentMethod ? ' · ' + methodLabel(e.paymentMethod) : '' }}</div>
                      }
                    </td>
                    <td class="t-right">
                      <div class="row-actions">
                        @if (e.status === 'pending') {
                          <button type="button" class="btn btn-mini btn-success" (click)="markPaid(e)"><svg lucideCircleCheck size="13"></svg> Marcar pagado</button>
                        }
                        <button type="button" class="btn btn-mini btn-danger-outline" (click)="deleteEntry(e)" title="Eliminar pago" aria-label="Eliminar pago"><svg lucideTrash2 size="13"></svg></button>
                      </div>
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
          <h3>{{ employees().length }} {{ employees().length === 1 ? 'empleado' : 'empleados' }} ({{ activeEmployees() }} {{ activeEmployees() === 1 ? 'activo' : 'activos' }})</h3>
          <button type="button" class="btn btn-primary" (click)="openNewEmployee()"><svg lucidePlus size="16"></svg> Nuevo empleado</button>
        </div>

        @if (employees().length === 0) {
          <div class="empty-state">
            <svg lucideUsers size="44"></svg>
            <h3>Todavía no hay empleados</h3>
            <p>Agrega tu primer empleado para empezar a registrar la nómina.</p>
          </div>
        } @else {
          <div class="emp-grid">
            @for (e of employees(); track e.id) {
              <div class="emp-card" [class.inactive]="!e.active">
                <div class="emp-avatar" aria-hidden="true">{{ initials(e.fullName) }}</div>
                <div class="emp-info">
                  <div class="emp-name">
                    {{ e.fullName }}
                    @if (!e.active) { <span class="inactive-tag">Inactivo</span> }
                  </div>
                  <div class="muted">{{ e.position || 'Sin cargo asignado' }}</div>
                  <div class="emp-salary">RD$ {{ e.baseSalary | number:'1.0-0' }} <span>al mes</span></div>
                  <div class="emp-meta">
                    @if (e.documentId) { <span><svg lucideIdCard size="13"></svg> {{ e.documentId }}</span> }
                    @if (e.phone) { <span><svg lucidePhone size="13"></svg> {{ e.phone }}</span> }
                    <span>{{ e._count?.payroll || 0 }} {{ (e._count?.payroll || 0) === 1 ? 'pago' : 'pagos' }}</span>
                  </div>
                </div>
                <div class="emp-actions">
                  <button type="button" class="btn btn-mini btn-outline" (click)="editEmployee(e)"><svg lucidePencil size="13"></svg> Editar</button>
                  @if (e.active) {
                    <button type="button" class="btn btn-mini btn-outline" (click)="deactivate(e)"><svg lucideUserX size="13"></svg> Desactivar</button>
                  } @else {
                    <button type="button" class="btn btn-mini btn-primary" (click)="reactivate(e)"><svg lucideUserCheck size="13"></svg> Activar</button>
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
      <div class="modal small" role="dialog" aria-modal="true" [attr.aria-label]="empForm.id ? 'Editar empleado' : 'Nuevo empleado'">
        <div class="modal-head"><h3>{{ empForm.id ? 'Editar' : 'Nuevo' }} empleado</h3><button type="button" aria-label="Cerrar" (click)="showEmpModal.set(false)"><svg lucideX size="18"></svg></button></div>
        <div class="modal-body">
          <div class="form-row"><label>Nombre completo *</label><input [(ngModel)]="empForm.fullName" placeholder="Ej.: Juan Pérez" /></div>
          <div class="form-row two-col">
            <div><label>Cédula</label><input [(ngModel)]="empForm.documentId" placeholder="000-0000000-0" /></div>
            <div><label>Cargo</label><input [(ngModel)]="empForm.position" placeholder="Técnico, cajero…" /></div>
          </div>
          <div class="form-row two-col">
            <div><label>Correo electrónico</label><input type="email" [(ngModel)]="empForm.email" placeholder="Opcional" /></div>
            <div><label>Teléfono</label><input type="tel" [(ngModel)]="empForm.phone" placeholder="809-000-0000" /></div>
          </div>
          <div class="form-row two-col">
            <div><label>Salario base mensual (RD$)</label><input type="number" min="0" [(ngModel)]="empForm.baseSalary" /></div>
            <div><label>Fecha de ingreso</label><input type="date" [(ngModel)]="empForm.hiredAt" /></div>
          </div>
          <div class="form-row"><label>Notas</label><textarea [(ngModel)]="empForm.notes" rows="2" placeholder="Opcional"></textarea></div>
        </div>
        <div class="modal-foot">
          @if (!empForm.fullName) { <span class="foot-hint">Falta el nombre completo.</span> }
          <button type="button" class="btn btn-outline" (click)="showEmpModal.set(false)">Cancelar</button>
          <button type="button" class="btn btn-primary" (click)="saveEmployee()" [disabled]="!empForm.fullName">{{ empForm.id ? 'Guardar cambios' : 'Crear empleado' }}</button>
        </div>
      </div>
    }

    <!-- MODAL PAGO -->
    @if (showEntryModal()) {
      <div class="modal-backdrop" (click)="showEntryModal.set(false)"></div>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Nuevo pago de nómina">
        <div class="modal-head"><h3>Nuevo pago de nómina</h3><button type="button" aria-label="Cerrar" (click)="showEntryModal.set(false)"><svg lucideX size="18"></svg></button></div>
        <div class="modal-body">
          <div class="form-row">
            <label>Empleado *</label>
            <select [(ngModel)]="entryForm.employeeId" (change)="onEmployeeChange()">
              <option [ngValue]="null">Elegir empleado…</option>
              @for (e of activeEmpList(); track e.id) {
                <option [ngValue]="e.id">{{ e.fullName }} ({{ e.position || 'sin cargo' }})</option>
              }
            </select>
            <small class="muted">Al elegirlo se completa su salario base.</small>
          </div>
          <div class="form-row"><label>Período *</label><input [(ngModel)]="entryForm.period" placeholder="Ej.: 2026-06 o 1ra quincena junio" /></div>
          <div class="form-row two-col">
            <div><label>Desde</label><input type="date" [(ngModel)]="entryForm.periodStart" /></div>
            <div><label>Hasta</label><input type="date" [(ngModel)]="entryForm.periodEnd" /></div>
          </div>
          <div class="form-row two-col">
            <div><label>Salario base (RD$)</label><input type="number" step="0.01" min="0" [(ngModel)]="entryForm.baseAmount" /></div>
            <div><label>Bono (RD$)</label><input type="number" step="0.01" min="0" [(ngModel)]="entryForm.bonus" /></div>
          </div>
          <div class="form-row two-col">
            <div><label>Descuentos (RD$)</label><input type="number" step="0.01" min="0" [(ngModel)]="entryForm.deductions" /></div>
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
                <label>Forma de pago</label>
                <select [(ngModel)]="entryForm.paymentMethod">
                  <option value="">Sin indicar</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
            </div>
          }
          <div class="form-row"><label>Notas</label><textarea [(ngModel)]="entryForm.notes" rows="2" placeholder="Opcional"></textarea></div>
          <div class="net-preview">
            <strong>Neto a pagar: RD$ {{ netPreview() | number:'1.0-2' }}</strong>
            <span class="muted">Salario base + bono − descuentos.</span>
            @if (entryForm.status === 'paid') { <span class="muted">Se registrará automáticamente un gasto en la categoría “nómina”.</span> }
          </div>
        </div>
        <div class="modal-foot">
          @if (!entryForm.employeeId || !entryForm.period) {
            <span class="foot-hint">{{ !entryForm.employeeId ? 'Falta elegir el empleado.' : 'Falta el período.' }}</span>
          }
          <button type="button" class="btn btn-outline" (click)="showEntryModal.set(false)">Cancelar</button>
          <button type="button" class="btn btn-primary" (click)="saveEntry()" [disabled]="!entryForm.employeeId || !entryForm.period">Guardar pago</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .page { padding: 24px 32px; }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .stat-card { background: white; border: 1px solid #dfe5ea; border-radius: 8px; padding: 14px 16px; }
    .stat-card.accent { border-left: 4px solid #1267dd; }
    .stat-card.success { border-left: 4px solid #13875a; }
    .stat-card.warning { border-left: 4px solid #b36b12; }
    .stat-label { font-size: 12px; color: #667582; font-weight: 600; }
    .stat-value { font-size: 22px; font-weight: 700; color: #172535; margin-top: 4px; }
    .stats-note { margin: -12px 0 16px; font-size: 12px; color: #667582; }

    .tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid #dfe5ea; }
    .tabs button { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; padding: 10px 14px; cursor: pointer; color: #667582; font-weight: 600; font-size: 13px; border-bottom: 2px solid transparent; }
    .tabs button:hover { color: #172535; }
    .tabs button.active { color: #1267dd; border-bottom-color: #1267dd; }
    .tab-count { font-size: 11px; background: #f1f4f7; color: #667582; padding: 1px 7px; border-radius: 999px; }
    .tabs button.active .tab-count { background: #edf4ff; color: #1267dd; }

    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .toolbar h3 { margin: 0; color: #172535; font-size: 15px; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .filters select { padding: 8px 10px; border: 1px solid #ccd6de; border-radius: 6px; font-size: 13px; color: #334250; background: white; }

    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; white-space: nowrap; }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-primary { background: #1267dd; color: white; }
    .btn-primary:hover:not(:disabled) { background: #0d58c0; }
    .btn-success { background: #e9f8f1; color: #13875a; border-color: #bfe6d3; }
    .btn-success:hover { background: #13875a; color: white; }
    .btn-outline { background: white; border-color: #ccd6de; color: #334250; }
    .btn-outline:hover:not(:disabled) { border-color: #1267dd; color: #1267dd; }
    .btn-danger-outline { background: white; border-color: #f0c4bf; color: #b42318; padding: 5px 7px; }
    .btn-danger-outline:hover { background: #fff0ef; }
    .btn-mini { padding: 5px 9px; font-size: 12px; }

    .table-wrap { background: white; border: 1px solid #dfe5ea; border-radius: 8px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 11px 12px; border-bottom: 1px solid #f0f3f6; font-size: 13px; vertical-align: top; color: #334250; }
    th { background: #f8fafc; color: #667582; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
    tr:hover td { background: #f8fafc; }
    .t-right { text-align: right; }
    .nowrap { white-space: nowrap; }
    .strong { font-weight: 600; color: #172535; }
    .net { font-weight: 700; color: #172535; }
    .positive { color: #13875a; }
    .negative { color: #b42318; }
    .muted { color: #667582; font-size: 12px; }
    .row-actions { display: flex; gap: 6px; justify-content: flex-end; }

    .status-pill { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; margin-bottom: 2px; }
    .st-pending { background: #fff6e8; color: #b36b12; }
    .st-paid { background: #e9f8f1; color: #13875a; }
    .st-cancelled { background: #f1f4f7; color: #667582; }

    .emp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 14px; }
    .emp-card { background: white; border: 1px solid #dfe5ea; border-radius: 8px; padding: 16px; display: flex; gap: 14px; flex-wrap: wrap; }
    .emp-card.inactive { background: #f8fafc; }
    .emp-card.inactive .emp-avatar { background: #b6c2cc; }
    .emp-avatar { width: 48px; height: 48px; border-radius: 50%; background: #1267dd; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 17px; flex-shrink: 0; }
    .emp-info { flex: 1; min-width: 160px; }
    .emp-name { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 600; color: #172535; }
    .inactive-tag { font-size: 11px; font-weight: 600; color: #667582; background: #e8edf1; padding: 1px 8px; border-radius: 999px; }
    .emp-salary { font-size: 17px; font-weight: 700; color: #172535; margin: 6px 0; }
    .emp-salary span { font-size: 12px; font-weight: 500; color: #667582; }
    .emp-meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: #667582; }
    .emp-meta span { display: inline-flex; align-items: center; gap: 4px; }
    .emp-actions { display: flex; flex-direction: column; gap: 6px; justify-content: center; }

    .empty-state { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 56px 20px; gap: 10px; color: #667582; background: white; border: 1px dashed #dfe5ea; border-radius: 8px; font-size: 13px; }
    .empty-state svg { color: #b6c2cc; }
    .empty-state h3 { color: #172535; margin: 4px 0 0; font-size: 16px; }
    .empty-state p { margin: 0; max-width: 440px; }

    .modal-backdrop { position: fixed; inset: 0; background: rgba(17, 26, 36, 0.55); z-index: 200; }
    .modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 8px; width: 640px; max-width: calc(100vw - 32px); max-height: 90vh; display: flex; flex-direction: column; z-index: 201; box-shadow: 0 20px 60px rgba(17, 26, 36, 0.25); }
    .modal.small { width: 480px; }
    .modal-head { padding: 16px 20px; border-bottom: 1px solid #f0f3f6; display: flex; justify-content: space-between; align-items: center; }
    .modal-head h3 { margin: 0; color: #172535; font-size: 16px; }
    .modal-head button { display: grid; place-items: center; background: none; border: none; cursor: pointer; color: #667582; padding: 4px; border-radius: 6px; }
    .modal-head button:hover { background: #f2f7ff; color: #172535; }
    .modal-body { padding: 18px 20px; overflow: auto; }
    .modal-foot { padding: 14px 20px; border-top: 1px solid #f0f3f6; display: flex; justify-content: flex-end; align-items: center; gap: 10px; flex-wrap: wrap; }
    .foot-hint { margin-right: auto; font-size: 12px; color: #667582; }
    .net-preview { padding: 12px; background: #f2f7ff; border-radius: 6px; margin-top: 6px; display: flex; flex-direction: column; gap: 4px; color: #172535; }
    .form-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .form-row label { font-size: 12px; color: #334250; font-weight: 600; }
    .form-row input, .form-row select, .form-row textarea { padding: 9px 11px; border: 1px solid #ccd6de; border-radius: 6px; font-size: 13px; font-family: inherit; color: #334250; background: white; outline: none; }
    .form-row input:focus, .form-row select:focus, .form-row textarea:focus { border-color: #1267dd; box-shadow: 0 0 0 3px rgba(18, 103, 221, 0.12); }
    .form-row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form-row.two-col > div { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

    @media (max-width: 768px) {
      .page { padding: 16px; }
      .filters { width: 100%; }
      .filters select { flex: 1; min-width: 0; }
      .form-row.two-col { grid-template-columns: 1fr; }
      .emp-actions { flex-direction: row; width: 100%; }
    }
  `]
})
export class PayrollComponent implements OnInit {
  private http = inject(HttpClient);
  private toast = inject(ToastService);

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
  // Método (no computed): entryForm no es un signal y el computed se quedaba con el primer valor.
  netPreview(): number {
    return (Number(this.entryForm.baseAmount) || 0) + (Number(this.entryForm.bonus) || 0) - (Number(this.entryForm.deductions) || 0);
  }

  async ngOnInit() {
    await Promise.all([this.loadEmployees(), this.loadEntries()]);
  }

  statusLabel(s: string) { return ({ pending: 'Pendiente', paid: 'Pagado', cancelled: 'Cancelado' } as Record<string, string>)[s] || s; }
  methodLabel(m?: string) { return m ? (({ transferencia: 'Transferencia', efectivo: 'Efectivo', cheque: 'Cheque', tarjeta: 'Tarjeta' } as Record<string, string>)[m] || m) : ''; }
  initials(name: string) { return initialsOf(name); }

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
      next: () => { this.showEmpModal.set(false); this.toast.success('Empleado guardado'); this.loadEmployees(); },
      error: (err) => this.notifyError('guardar el empleado', err),
    });
  }
  deactivate(e: Employee) {
    if (!confirm(`¿Desactivar a ${e.fullName}?\n\nNo aparecerá al registrar nuevos pagos. Sus pagos anteriores se conservan y puedes activarlo de nuevo cuando quieras.`)) return;
    this.http.put(`/employees/${e.id}`, { active: false, terminatedAt: new Date().toISOString() }).subscribe({
      next: () => { this.toast.success(`${e.fullName} quedó inactivo`); this.loadEmployees(); },
      error: (err) => this.notifyError('desactivar el empleado', err),
    });
  }
  reactivate(e: Employee) {
    this.http.put(`/employees/${e.id}`, { active: true, terminatedAt: null }).subscribe({
      next: () => { this.toast.success(`${e.fullName} está activo de nuevo`); this.loadEmployees(); },
      error: (err) => this.notifyError('activar el empleado', err),
    });
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
    const msg = err?.status === 0
      ? 'no hay conexión con el servidor'
      : err?.status === 403 ? 'tu usuario no tiene permiso para esta acción' : (err?.error?.error || 'intenta de nuevo');
    console.error(`[payroll] ${action}:`, err);
    this.toast.error(`No se pudo ${action}: ${msg}`);
  }

  saveEntry() {
    if (!this.entryForm.employeeId || !this.entryForm.period) return;
    this.http.post('/payroll', this.entryForm).subscribe({
      next: () => { this.showEntryModal.set(false); this.toast.success('Pago de nómina registrado'); this.loadEntries(); },
      error: (err) => this.notifyError('guardar el pago', err),
    });
  }

  markPaid(e: PayrollEntry) {
    const amount = Number(e.netAmount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!confirm(`¿Marcar como pagado el pago de ${e.employee?.fullName || 'este empleado'} (${e.period}) por RD$ ${amount}?\n\nSe registrará con la fecha de hoy y se anotará un gasto de nómina.`)) return;
    this.http.post(`/payroll/${e.id}/pay`, { paidAt: new Date().toISOString() }).subscribe({
      next: () => { this.toast.success('Pago marcado como pagado'); this.loadEntries(); },
      error: (err) => this.notifyError('marcar como pagado', err),
    });
  }

  deleteEntry(e: PayrollEntry) {
    const extra = e.status === 'paid' ? '\n\nTambién se borrará el gasto de nómina que se registró con este pago.' : '';
    if (!confirm(`¿Eliminar el pago de ${e.employee?.fullName} (${e.period})?${extra}\n\nNo se puede deshacer.`)) return;
    this.http.delete(`/payroll/${e.id}`).subscribe({
      next: () => { this.toast.success('Pago eliminado'); this.loadEntries(); },
      error: (err) => this.notifyError('eliminar el pago', err),
    });
  }
}
