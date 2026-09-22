import { Component, input, inject, signal, OnChanges, SimpleChanges, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DecimalPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideArrowRight, LucidePackage, LucideTriangleAlert } from '@lucide/angular';

interface ClientEquipment {
  id: number; typeId: number; serialNumber?: string; macAddress?: string;
  brand?: string; model?: string; status: string;
  unitCost: number; assignedAt?: string; installNotes?: string;
  type?: { id: number; name: string; category: string };
}
interface ExpenseLite {
  id: number; category: string; description: string; amount: number; expenseDate: string;
}

@Component({
  selector: 'app-client-equipment',
  standalone: true,
  imports: [DecimalPipe, DatePipe, RouterLink, LucideArrowRight, LucidePackage, LucideTriangleAlert],
  template: `
    <div class="card">
      <div class="card-head">
        <h3><svg lucidePackage size="17"></svg> Equipos asignados</h3>
        <a routerLink="/inventory" class="link-mini">Ir a inventario <svg lucideArrowRight size="14"></svg></a>
      </div>

      @if (loading()) {
        <div class="ce-loading"><span class="spinner"></span>Cargando equipos del cliente…</div>
      } @else if (loadError() && equipment().length === 0 && expenses().length === 0) {
        <div class="ce-empty error">
          <svg lucideTriangleAlert size="26"></svg>
          <p><strong>No se pudieron cargar los equipos.</strong></p>
          <p class="muted">Revise la conexión con el servidor e intente de nuevo.</p>
          <button type="button" class="btn-retry" (click)="load()">Reintentar</button>
        </div>
      } @else if (equipment().length === 0 && expenses().length === 0) {
        <div class="ce-empty">
          <svg lucidePackage size="28"></svg>
          <p><strong>Este cliente no tiene equipos asignados.</strong></p>
          <p class="muted">Desde la página de Inventario puede asignarle una ONU, router u otro equipo.</p>
        </div>
      } @else {
        @if (equipment().length > 0) {
          <div class="table-scroll">
            <table class="ce-table">
              <thead>
                <tr><th>Categoría</th><th>Serial</th><th>Marca / modelo</th><th class="t-right">Costo</th><th>Asignado</th></tr>
              </thead>
              <tbody>
                @for (e of equipment(); track e.id) {
                  <tr>
                    <td><span class="pill">{{ e.type?.name || 'Equipo' }}</span></td>
                    <td>
                      <div class="mono">{{ e.serialNumber || '—' }}</div>
                      @if (e.macAddress) { <div class="muted mono">{{ e.macAddress }}</div> }
                    </td>
                    <td>
                      <div>{{ e.brand || '—' }}</div>
                      @if (e.model) { <div class="muted">{{ e.model }}</div> }
                    </td>
                    <td class="t-right">RD$ {{ e.unitCost | number:'1.0-2' }}</td>
                    <td>{{ e.assignedAt ? (e.assignedAt | date:'dd/MM/yyyy') : '—' }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="3" class="t-right"><strong>Total invertido en equipos</strong></td>
                  <td class="t-right total">RD$ {{ totalEquipCost() | number:'1.0-2' }}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        }

        @if (expenses().length > 0) {
          <div class="ce-divider"></div>
          <div class="ce-sub">
            <h4>Otros gastos dirigidos a este cliente</h4>
            <div class="table-scroll">
              <table class="ce-table">
                <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th class="t-right">Monto</th></tr></thead>
                <tbody>
                  @for (x of expenses(); track x.id) {
                    <tr>
                      <td>{{ x.expenseDate | date:'dd/MM/yyyy' }}</td>
                      <td><span class="pill">{{ x.category }}</span></td>
                      <td>{{ x.description }}</td>
                      <td class="t-right">RD$ {{ x.amount | number:'1.0-2' }}</td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="3" class="t-right"><strong>Total otros gastos</strong></td>
                    <td class="t-right total">RD$ {{ totalExpenses() | number:'1.0-2' }}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        }

        <div class="ce-grand-total">
          <span>Costo total acumulado del cliente</span>
          <strong>RD$ {{ totalEquipCost() + totalExpenses() | number:'1.0-2' }}</strong>
        </div>
      }
    </div>
  `,
  styles: [`
    .card { background: white; border: 1px solid #e0e6e1; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .card-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .card-head h3 { display: flex; align-items: center; gap: 7px; margin: 0; color: #15211c; font-size: 15px; }
    .card-head h3 svg { color: #0b6b52; }
    .link-mini { display: inline-flex; align-items: center; gap: 4px; color: #0b6b52; text-decoration: none; font-size: 13px; font-weight: 600; }
    .link-mini:hover { text-decoration: underline; }

    .ce-loading { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 28px; color: #56665e; font-size: 13px; }
    .spinner { width: 18px; height: 18px; border: 2px solid #e0e6e1; border-top-color: #0b6b52; border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .ce-empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 28px 16px; text-align: center; color: #2d3b34; font-size: 13px; }
    .ce-empty > svg { color: #8a9aa8; margin-bottom: 6px; }
    .ce-empty.error > svg { color: #b42318; }
    .ce-empty p { margin: 0; }
    .btn-retry { margin-top: 10px; min-height: 34px; padding: 0 14px; border: 1px solid #0b6b52; border-radius: 9px; background: #fff; color: #0b6b52; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn-retry:hover { background: #eef6f1; }
    .muted { color: #56665e; font-size: 12px; }

    .table-scroll { overflow-x: auto; }
    .ce-table { width: 100%; min-width: 520px; border-collapse: collapse; }
    .ce-table th, .ce-table td { padding: 10px 12px; border-bottom: 1px solid #ecf0ec; font-size: 13px; text-align: left; color: #2d3b34; }
    .ce-table th { background: #f4f6f2; color: #56665e; font-weight: 700; font-size: 11px; text-transform: uppercase; }
    .ce-table tfoot td { background: #f4f6f2; border-top: 2px solid #e0e6e1; }
    .ce-table .t-right { text-align: right; }
    .total { color: #15211c; font-weight: 700; }
    .mono { font-family: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 12px; }
    .pill { display: inline-block; background: #e6f2ec; color: #0b6b52; padding: 3px 9px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }

    .ce-divider { height: 1px; background: #e0e6e1; margin: 20px 0; }
    .ce-sub h4 { margin: 0 0 12px; color: #2d3b34; font-size: 14px; }

    .ce-grand-total {
      margin-top: 16px; padding: 14px 18px; gap: 12px;
      background: #eef6f1; border: 1px solid #cfe0f8; border-radius: 12px;
      display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;
    }
    .ce-grand-total span { color: #2d3b34; font-size: 13px; font-weight: 600; }
    .ce-grand-total strong { color: #15211c; font-size: 20px; }
    @media (max-width: 640px) { .card { padding: 16px; } }
  `]
})
export class ClientEquipmentComponent implements OnChanges {
  private http = inject(HttpClient);

  idServicio = input.required<number>();

  loading = signal(false);
  loadError = signal(false);
  equipment = signal<ClientEquipment[]>([]);
  expenses = signal<ExpenseLite[]>([]);

  totalEquipCost = computed(() => this.equipment().reduce((s, e) => s + e.unitCost, 0));
  totalExpenses = computed(() => this.expenses().reduce((s, e) => s + e.amount, 0));

  // ngOnChanges con input() signal-based corre al init Y cuando cambia,
  // pero solo si el valor realmente cambió. Evita double-load.
  ngOnChanges(changes: SimpleChanges) {
    if (changes['idServicio']) this.load();
  }

  load() {
    const id = this.idServicio();
    if (!id) return;
    this.loading.set(true);
    this.loadError.set(false);
    let pending = 2;
    const done = () => { if (--pending === 0) this.loading.set(false); };
    this.http.get<ClientEquipment[]>(`/clients/${id}/equipment`).subscribe({
      next: e => { this.equipment.set(e); done(); },
      error: () => { this.loadError.set(true); done(); },
    });
    this.http.get<ExpenseLite[]>('/expenses', { params: { clientId: id, limit: '50' } }).subscribe({
      next: x => { this.expenses.set(x); done(); },
      error: () => { this.loadError.set(true); done(); },
    });
  }
}
