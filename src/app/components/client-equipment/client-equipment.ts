import { Component, input, inject, signal, OnChanges, SimpleChanges, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

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
  imports: [FormsModule, DecimalPipe, DatePipe, RouterLink],
  template: `
    <div class="card">
      <div class="card-head">
        <h3>Equipos asignados</h3>
        <a routerLink="/inventory" class="link-mini">Ir a inventario →</a>
      </div>

      @if (loading()) {
        <div class="ce-loading">Cargando...</div>
      } @else if (equipment().length === 0 && expenses().length === 0) {
        <div class="ce-empty">
          <p>Sin equipos asignados a este cliente.</p>
          <p class="muted">Desde la página de Inventario podés asignar uno.</p>
        </div>
      } @else {
        @if (equipment().length > 0) {
          <table class="ce-table">
            <thead>
              <tr><th>Categoría</th><th>Serial</th><th>Marca / Modelo</th><th>Costo</th><th>Asignado</th></tr>
            </thead>
            <tbody>
              @for (e of equipment(); track e.id) {
                <tr>
                  <td><span class="pill">{{ e.type?.name }}</span></td>
                  <td>
                    <div class="mono">{{ e.serialNumber || '—' }}</div>
                    @if (e.macAddress) { <div class="muted">{{ e.macAddress }}</div> }
                  </td>
                  <td>
                    <div>{{ e.brand || '—' }}</div>
                    @if (e.model) { <div class="muted">{{ e.model }}</div> }
                  </td>
                  <td class="t-right">RD$ {{ e.unitCost | number:'1.0-2' }}</td>
                  <td>{{ e.assignedAt | date:'shortDate' }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" class="t-right"><strong>Total equipos invertidos:</strong></td>
                <td class="t-right total">RD$ {{ totalEquipCost() | number:'1.0-2' }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        }

        @if (expenses().length > 0) {
          <div class="ce-divider"></div>
          <div class="ce-sub">
            <h4>Otros gastos dirigidos a este cliente</h4>
            <table class="ce-table">
              <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th class="t-right">Monto</th></tr></thead>
              <tbody>
                @for (x of expenses(); track x.id) {
                  <tr>
                    <td>{{ x.expenseDate | date:'shortDate' }}</td>
                    <td><span class="pill">{{ x.category }}</span></td>
                    <td>{{ x.description }}</td>
                    <td class="t-right">RD$ {{ x.amount | number:'1.0-2' }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="3" class="t-right"><strong>Total otros gastos:</strong></td>
                  <td class="t-right total">RD$ {{ totalExpenses() | number:'1.0-2' }}</td>
                </tr>
              </tfoot>
            </table>
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
    .card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; margin-bottom: 20px; }
    .card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    .card-head h3 { margin: 0; color: #0f172a; font-size: 16px; }
    .link-mini { color: #6366f1; text-decoration: none; font-size: 13px; font-weight: 500; }

    .ce-loading, .ce-empty { padding: 24px; text-align: center; color: #94a3b8; }
    .ce-empty p { margin: 4px 0; }
    .muted { color: #94a3b8; font-size: 12px; }

    .ce-table { width: 100%; border-collapse: collapse; }
    .ce-table th, .ce-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; text-align: left; }
    .ce-table th { background: #f8fafc; color: #64748b; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
    .ce-table tfoot td { background: #fafbff; border-top: 2px solid #e2e8f0; }
    .t-right { text-align: right; }
    .total { color: #6366f1; font-weight: 700; }
    .mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; }
    .pill { background: #eef2ff; color: #4f46e5; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 500; }

    .ce-divider { height: 1px; background: #e2e8f0; margin: 20px 0; }
    .ce-sub h4 { margin: 0 0 12px; color: #475569; font-size: 14px; }

    .ce-grand-total {
      margin-top: 16px; padding: 14px 18px;
      background: linear-gradient(135deg, #eef2ff, #e0e7ff);
      border-radius: 12px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .ce-grand-total strong { color: #4f46e5; font-size: 20px; }
  `]
})
export class ClientEquipmentComponent implements OnChanges {
  private http = inject(HttpClient);

  idServicio = input.required<number>();

  loading = signal(false);
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
    let pending = 2;
    const done = () => { if (--pending === 0) this.loading.set(false); };
    this.http.get<ClientEquipment[]>(`/clients/${id}/equipment`).subscribe({
      next: e => { this.equipment.set(e); done(); },
      error: () => done(),
    });
    this.http.get<ExpenseLite[]>('/expenses', { params: { clientId: id, limit: '50' } }).subscribe({
      next: x => { this.expenses.set(x); done(); },
      error: () => done(),
    });
  }
}
