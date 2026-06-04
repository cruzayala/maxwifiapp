import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../components/layout/navbar';
import { LocalDbService } from '../../services/local-db.service';

interface EquipmentType {
  id: number; name: string; category: string; unit: string; description?: string;
  _count?: { equipment: number };
}
interface Equipment {
  id: number; typeId: number; serialNumber?: string; macAddress?: string;
  brand?: string; model?: string; status: string; unitCost: number;
  assignedToClientId?: number; assignedAt?: string;
  type?: EquipmentType;
  client?: { idServicio: number; nombre: string; telefono?: string };
}
interface Purchase {
  id: number; supplier?: string; invoiceRef?: string; purchasedAt: string;
  total: number; notes?: string; createdBy?: string;
  items?: Array<{ id: number; quantity: number; unitPrice: number; subtotal: number; type?: EquipmentType; notes?: string }>;
  _count?: { equipment: number };
}
interface Stats {
  total: number;
  byStatus: Record<string, number>;
  totalCostInStock: number;
}

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [NavbarComponent, FormsModule, DecimalPipe, DatePipe, RouterLink],
  template: `
    <app-navbar pageTitle="Inventario" />

    <div class="page">
      <!-- STATS -->
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-label">Equipos totales</div>
          <div class="stat-value">{{ stats().total }}</div>
        </div>
        <div class="stat-card success">
          <div class="stat-label">En stock</div>
          <div class="stat-value">{{ stats().byStatus['stock'] || 0 }}</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-label">Asignados</div>
          <div class="stat-value">{{ stats().byStatus['assigned'] || 0 }}</div>
        </div>
        <div class="stat-card danger">
          <div class="stat-label">RMA / Perdidos</div>
          <div class="stat-value">{{ (stats().byStatus['rma'] || 0) + (stats().byStatus['lost'] || 0) }}</div>
        </div>
        <div class="stat-card accent">
          <div class="stat-label">Costo de inventario</div>
          <div class="stat-value">RD$ {{ stats().totalCostInStock | number:'1.0-0' }}</div>
        </div>
      </div>

      <!-- TABS -->
      <div class="tabs">
        <button [class.active]="tab() === 'equipment'" (click)="tab.set('equipment')">Equipos</button>
        <button [class.active]="tab() === 'purchases'" (click)="tab.set('purchases')">Compras</button>
        <button [class.active]="tab() === 'types'" (click)="tab.set('types')">Categorías</button>
      </div>

      @if (tab() === 'equipment') {
        <div class="toolbar">
          <div class="filters">
            <input type="text" placeholder="Buscar serial / MAC / marca..." [(ngModel)]="searchQ" (input)="loadEquipment()" />
            <select [(ngModel)]="filterStatus" (change)="loadEquipment()">
              <option value="">Todos los estados</option>
              <option value="stock">En stock</option>
              <option value="assigned">Asignados</option>
              <option value="rma">RMA</option>
              <option value="lost">Perdidos</option>
              <option value="retired">Retirados</option>
            </select>
            <select [(ngModel)]="filterTypeId" (change)="loadEquipment()">
              <option [ngValue]="''">Todas las categorías</option>
              @for (t of types(); track t.id) {
                <option [ngValue]="t.id">{{ t.name }}</option>
              }
            </select>
          </div>
          <button class="btn btn-primary" (click)="openNewEquipment()">+ Agregar equipo</button>
        </div>

        @if (loading()) {
          <div class="loading-state"><div class="spinner"></div></div>
        } @else if (equipment().length === 0) {
          <div class="empty-state">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
            <h3>Sin equipos</h3>
            <p>Agregá una compra para popular el inventario.</p>
          </div>
        } @else {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th>Serial / MAC</th>
                  <th>Marca / Modelo</th>
                  <th>Costo</th>
                  <th>Estado</th>
                  <th>Cliente</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (e of equipment(); track e.id) {
                  <tr>
                    <td><span class="cat-pill">{{ e.type?.name }}</span></td>
                    <td>
                      <div class="serial">{{ e.serialNumber || '—' }}</div>
                      @if (e.macAddress) { <div class="muted">{{ e.macAddress }}</div> }
                    </td>
                    <td>
                      <div>{{ e.brand || '—' }}</div>
                      @if (e.model) { <div class="muted">{{ e.model }}</div> }
                    </td>
                    <td>RD$ {{ e.unitCost | number:'1.0-2' }}</td>
                    <td><span class="status-pill" [class]="'st-' + e.status">{{ statusLabel(e.status) }}</span></td>
                    <td>
                      @if (e.client) {
                        <a [routerLink]="['/clients', e.client.idServicio]" class="link">{{ e.client.nombre }}</a>
                      } @else { <span class="muted">—</span> }
                    </td>
                    <td class="actions-cell">
                      @if (e.status === 'stock') {
                        <button class="btn btn-mini btn-primary" (click)="openAssign(e)">Asignar</button>
                      } @else if (e.status === 'assigned') {
                        <button class="btn btn-mini btn-outline" (click)="unassign(e)">Devolver</button>
                      }
                      <button class="btn btn-mini btn-outline" (click)="editEquipment(e)">✎</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }

      @if (tab() === 'purchases') {
        <div class="toolbar">
          <h3>{{ purchases().length }} compras registradas</h3>
          <button class="btn btn-primary" (click)="openNewPurchase()">+ Registrar compra</button>
        </div>
        @if (purchases().length === 0) {
          <div class="empty-state">
            <h3>Sin compras</h3>
            <p>Registrá la primera compra de equipos.</p>
          </div>
        } @else {
          <div class="purchases-grid">
            @for (p of purchases(); track p.id) {
              <div class="purchase-card">
                <div class="purchase-head">
                  <div>
                    <div class="purchase-supplier">{{ p.supplier || 'Sin proveedor' }}</div>
                    <div class="muted">{{ p.purchasedAt | date:'shortDate' }} · {{ p.invoiceRef || '—' }}</div>
                  </div>
                  <div class="purchase-total">RD$ {{ p.total | number:'1.0-2' }}</div>
                </div>
                <div class="purchase-items">
                  @for (it of p.items || []; track it.id) {
                    <div class="purchase-item">
                      <span>{{ it.type?.name }}</span>
                      <span class="muted">{{ it.quantity }} × {{ it.unitPrice | number:'1.0-2' }}</span>
                    </div>
                  }
                </div>
                <div class="purchase-foot">
                  <span class="muted">{{ p._count?.equipment || 0 }} equipos rastreados</span>
                  <button class="btn btn-mini btn-outline" (click)="deletePurchase(p)">Eliminar</button>
                </div>
              </div>
            }
          </div>
        }
      }

      @if (tab() === 'types') {
        <div class="toolbar">
          <h3>{{ types().length }} categorías</h3>
          <button class="btn btn-primary" (click)="openNewType()">+ Nueva categoría</button>
        </div>
        <div class="types-grid">
          @for (t of types(); track t.id) {
            <div class="type-card">
              <div class="type-name">{{ t.name }}</div>
              <div class="muted">{{ t.category }} · unidad: {{ t.unit }}</div>
              <div class="type-count">{{ t._count?.equipment || 0 }} unidades</div>
              <button class="btn btn-mini btn-outline" (click)="deleteType(t)">Eliminar</button>
            </div>
          }
        </div>
      }
    </div>

    <!-- MODAL: NUEVA COMPRA -->
    @if (showPurchaseModal()) {
      <div class="modal-backdrop" (click)="showPurchaseModal.set(false)"></div>
      <div class="modal">
        <div class="modal-head">
          <h3>Registrar compra</h3>
          <button (click)="showPurchaseModal.set(false)">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <label>Proveedor</label>
            <input [(ngModel)]="np.supplier" placeholder="Ej: Tech Mayoreo SRL" />
          </div>
          <div class="form-row two-col">
            <div>
              <label>Fecha</label>
              <input type="date" [(ngModel)]="np.purchasedAt" />
            </div>
            <div>
              <label># Factura</label>
              <input [(ngModel)]="np.invoiceRef" placeholder="A12345" />
            </div>
          </div>
          <div class="form-row">
            <label>Items</label>
            @for (it of np.items; track $index; let i = $index) {
              <div class="item-row">
                <select [(ngModel)]="it.typeId">
                  <option [ngValue]="null">— Tipo —</option>
                  @for (t of types(); track t.id) {
                    <option [ngValue]="t.id">{{ t.name }} ({{ t.unit }})</option>
                  }
                </select>
                <input type="number" min="1" placeholder="Cant." [(ngModel)]="it.quantity" />
                <input type="number" min="0" step="0.01" placeholder="Precio" [(ngModel)]="it.unitPrice" />
                <input placeholder="Marca" [(ngModel)]="it.brand" />
                <input placeholder="Modelo" [(ngModel)]="it.model" />
                <button (click)="np.items.splice(i, 1)" class="btn btn-mini btn-outline">✕</button>
              </div>
            }
            <button class="btn btn-mini btn-outline" (click)="np.items.push({ typeId: null, quantity: 1, unitPrice: 0, brand: '', model: '' })">+ Item</button>
          </div>
          <div class="modal-total">
            <strong>Total: RD$ {{ newPurchaseTotal() | number:'1.0-2' }}</strong>
            <span class="muted">Se genera gasto automático en categoría "inventario"</span>
          </div>
          <div class="form-row">
            <label>Notas</label>
            <textarea [(ngModel)]="np.notes" rows="2"></textarea>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline" (click)="showPurchaseModal.set(false)">Cancelar</button>
          <button class="btn btn-primary" (click)="savePurchase()" [disabled]="saving()">{{ saving() ? 'Guardando...' : 'Guardar compra' }}</button>
        </div>
      </div>
    }

    <!-- MODAL: NUEVO TIPO -->
    @if (showTypeModal()) {
      <div class="modal-backdrop" (click)="showTypeModal.set(false)"></div>
      <div class="modal small">
        <div class="modal-head"><h3>Nueva categoría</h3><button (click)="showTypeModal.set(false)">✕</button></div>
        <div class="modal-body">
          <div class="form-row"><label>Nombre</label><input [(ngModel)]="nt.name" placeholder="Ej: Router WiFi 4 puertos" /></div>
          <div class="form-row two-col">
            <div>
              <label>Categoría</label>
              <select [(ngModel)]="nt.category">
                <option value="wifi">WiFi</option>
                <option value="cable">Cable</option>
                <option value="onu">ONU</option>
                <option value="antena">Antena</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div>
              <label>Unidad</label>
              <select [(ngModel)]="nt.unit">
                <option value="u">Unidad (u)</option>
                <option value="m">Metros (m)</option>
                <option value="kg">Kilos (kg)</option>
              </select>
            </div>
          </div>
          <div class="form-row"><label>Descripción</label><textarea [(ngModel)]="nt.description" rows="2"></textarea></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline" (click)="showTypeModal.set(false)">Cancelar</button>
          <button class="btn btn-primary" (click)="saveType()">Crear</button>
        </div>
      </div>
    }

    <!-- MODAL: ASIGNAR -->
    @if (showAssignModal()) {
      <div class="modal-backdrop" (click)="showAssignModal.set(false)"></div>
      <div class="modal small">
        <div class="modal-head"><h3>Asignar equipo</h3><button (click)="showAssignModal.set(false)">✕</button></div>
        <div class="modal-body">
          <p><strong>{{ assignTarget()?.type?.name }}</strong> · SN {{ assignTarget()?.serialNumber || '—' }}</p>
          <div class="form-row">
            <label>Cliente</label>
            <input type="text" [(ngModel)]="assignSearch" (input)="searchClients()" placeholder="Buscar por nombre, teléfono o id..." />
            @if (clientResults().length > 0) {
              <div class="search-list">
                @for (c of clientResults(); track c.id_servicio) {
                  <div class="search-item" [class.selected]="assignClientId === c.id_servicio" (click)="assignClientId = c.id_servicio; assignSearch = c.nombre">
                    {{ c.nombre }} <span class="muted">({{ c.id_servicio }} · {{ c.telefono || 's/t' }})</span>
                  </div>
                }
              </div>
            }
          </div>
          <div class="form-row"><label>Notas de instalación</label><textarea [(ngModel)]="assignNotes" rows="2"></textarea></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline" (click)="showAssignModal.set(false)">Cancelar</button>
          <button class="btn btn-primary" (click)="confirmAssign()" [disabled]="!assignClientId">Asignar</button>
        </div>
      </div>
    }

    <!-- MODAL: NUEVO EQUIPO (sin compra) -->
    @if (showEquipModal()) {
      <div class="modal-backdrop" (click)="showEquipModal.set(false)"></div>
      <div class="modal small">
        <div class="modal-head"><h3>{{ ne.id ? 'Editar' : 'Nuevo' }} equipo</h3><button (click)="showEquipModal.set(false)">✕</button></div>
        <div class="modal-body">
          <div class="form-row">
            <label>Categoría</label>
            <select [(ngModel)]="ne.typeId">
              <option [ngValue]="null">—</option>
              @for (t of types(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
            </select>
          </div>
          <div class="form-row two-col">
            <div><label>Serial</label><input [(ngModel)]="ne.serialNumber" /></div>
            <div><label>MAC</label><input [(ngModel)]="ne.macAddress" /></div>
          </div>
          <div class="form-row two-col">
            <div><label>Marca</label><input [(ngModel)]="ne.brand" /></div>
            <div><label>Modelo</label><input [(ngModel)]="ne.model" /></div>
          </div>
          <div class="form-row two-col">
            <div><label>Costo unitario</label><input type="number" step="0.01" [(ngModel)]="ne.unitCost" /></div>
            <div>
              <label>Estado</label>
              <select [(ngModel)]="ne.status">
                <option value="stock">stock</option>
                <option value="assigned">assigned</option>
                <option value="rma">rma</option>
                <option value="lost">lost</option>
                <option value="retired">retired</option>
              </select>
            </div>
          </div>
          <div class="form-row"><label>Notas</label><textarea [(ngModel)]="ne.notes" rows="2"></textarea></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline" (click)="showEquipModal.set(false)">Cancelar</button>
          <button class="btn btn-primary" (click)="saveEquipment()">{{ ne.id ? 'Guardar' : 'Crear' }}</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .page { padding: 24px 32px; }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px 20px; }
    .stat-card.success { border-left: 4px solid #22c55e; }
    .stat-card.warning { border-left: 4px solid #f59e0b; }
    .stat-card.danger { border-left: 4px solid #ef4444; }
    .stat-card.accent { border-left: 4px solid #6366f1; }
    .stat-label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
    .stat-value { font-size: 26px; font-weight: 700; color: #0f172a; margin-top: 4px; }

    .tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; }
    .tabs button { background: none; border: none; padding: 10px 18px; cursor: pointer; color: #64748b; font-weight: 500; border-bottom: 2px solid transparent; }
    .tabs button.active { color: #6366f1; border-bottom-color: #6366f1; }

    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .toolbar h3 { margin: 0; color: #0f172a; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .filters input, .filters select { padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; min-width: 140px; }

    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; border-radius: 10px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; transition: all 0.2s; }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-primary:disabled { background: #94a3b8; cursor: not-allowed; }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; }
    .btn-outline:hover { border-color: #6366f1; color: #6366f1; }
    .btn-mini { padding: 6px 10px; font-size: 12px; }

    .table-wrap { background: white; border: 1px solid #e2e8f0; border-radius: 14px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    th { background: #f8fafc; color: #64748b; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    tr:hover td { background: #fafbff; }
    .actions-cell { display: flex; gap: 6px; justify-content: flex-end; }
    .serial { font-family: 'JetBrains Mono', monospace; font-size: 13px; }
    .muted { color: #94a3b8; font-size: 12px; }
    .link { color: #6366f1; text-decoration: none; font-weight: 500; }

    .cat-pill { background: #eef2ff; color: #4f46e5; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
    .status-pill { padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .st-stock { background: #dcfce7; color: #16a34a; }
    .st-assigned { background: #fef3c7; color: #b45309; }
    .st-rma { background: #fee2e2; color: #b91c1c; }
    .st-lost { background: #fecaca; color: #991b1b; }
    .st-retired { background: #f1f5f9; color: #64748b; }

    .purchases-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .purchase-card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px; }
    .purchase-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
    .purchase-supplier { font-weight: 600; color: #0f172a; }
    .purchase-total { font-size: 18px; font-weight: 700; color: #6366f1; }
    .purchase-items { display: flex; flex-direction: column; gap: 4px; padding: 12px 0; border-top: 1px dashed #e2e8f0; border-bottom: 1px dashed #e2e8f0; }
    .purchase-item { display: flex; justify-content: space-between; font-size: 13px; }
    .purchase-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }

    .types-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
    .type-card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 6px; }
    .type-name { font-weight: 600; color: #0f172a; }
    .type-count { font-size: 18px; font-weight: 700; color: #6366f1; margin: 6px 0; }

    .loading-state, .empty-state { display: flex; flex-direction: column; align-items: center; padding: 80px; gap: 12px; color: #94a3b8; }
    .empty-state h3 { color: #475569; margin: 8px 0 0; }
    .spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .modal-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.55); z-index: 200; }
    .modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 16px; width: 720px; max-width: 95vw; max-height: 90vh; display: flex; flex-direction: column; z-index: 201; box-shadow: 0 20px 60px rgba(15,23,42,0.25); }
    .modal.small { width: 480px; }
    .modal-head { padding: 18px 22px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
    .modal-head h3 { margin: 0; color: #0f172a; }
    .modal-head button { background: none; border: none; font-size: 20px; cursor: pointer; color: #94a3b8; }
    .modal-body { padding: 22px; overflow: auto; flex: 1; }
    .modal-foot { padding: 16px 22px; border-top: 1px solid #f1f5f9; display: flex; justify-content: flex-end; gap: 10px; }
    .modal-total { padding: 12px; background: #eef2ff; border-radius: 10px; margin: 12px 0; display: flex; justify-content: space-between; align-items: center; }

    .form-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .form-row label { font-size: 12px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .form-row input, .form-row select, .form-row textarea { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; font-family: inherit; }
    .form-row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form-row.two-col > div { display: flex; flex-direction: column; gap: 6px; }

    .item-row { display: grid; grid-template-columns: 1.5fr 0.6fr 0.8fr 1fr 1fr auto; gap: 6px; align-items: center; margin-bottom: 6px; }
    .item-row input, .item-row select { padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; }

    .search-list { background: white; border: 1px solid #e2e8f0; border-radius: 8px; max-height: 200px; overflow: auto; margin-top: 4px; }
    .search-item { padding: 10px 12px; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    .search-item:hover, .search-item.selected { background: #eef2ff; }
  `]
})
export class InventoryComponent implements OnInit {
  private http = inject(HttpClient);
  private db = inject(LocalDbService);

  tab = signal<'equipment' | 'purchases' | 'types'>('equipment');
  loading = signal(false);
  saving = signal(false);

  stats = signal<Stats>({ total: 0, byStatus: {}, totalCostInStock: 0 });
  equipment = signal<Equipment[]>([]);
  purchases = signal<Purchase[]>([]);
  types = signal<EquipmentType[]>([]);

  searchQ = '';
  filterStatus = '';
  filterTypeId: number | '' = '';

  // Modals
  showPurchaseModal = signal(false);
  showTypeModal = signal(false);
  showAssignModal = signal(false);
  showEquipModal = signal(false);

  np: any = { supplier: '', invoiceRef: '', purchasedAt: new Date().toISOString().slice(0, 10), notes: '', items: [] };
  nt: any = { name: '', category: 'wifi', unit: 'u', description: '' };
  ne: any = { id: null, typeId: null, serialNumber: '', macAddress: '', brand: '', model: '', unitCost: 0, notes: '', status: 'stock' };

  assignTarget = signal<Equipment | null>(null);
  assignSearch = '';
  assignClientId: number | null = null;
  assignNotes = '';
  clientResults = signal<any[]>([]);

  newPurchaseTotal = computed(() => (this.np.items || []).reduce((s: number, it: any) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0));

  async ngOnInit() {
    await Promise.all([this.loadStats(), this.loadTypes(), this.loadEquipment(), this.loadPurchases()]);
  }

  loadStats() {
    return new Promise<void>(r => this.http.get<Stats>('/inventory/equipment/stats').subscribe({
      next: s => { this.stats.set(s); r(); },
      error: () => r(),
    }));
  }

  loadTypes() {
    return new Promise<void>(r => this.http.get<EquipmentType[]>('/inventory/types').subscribe({
      next: ts => { this.types.set(ts); r(); },
      error: () => r(),
    }));
  }

  loadEquipment() {
    this.loading.set(true);
    const params: any = {};
    if (this.searchQ) params.q = this.searchQ;
    if (this.filterStatus) params.status = this.filterStatus;
    if (this.filterTypeId !== '' && this.filterTypeId != null) params.typeId = String(this.filterTypeId);
    this.http.get<Equipment[]>('/inventory/equipment', { params }).subscribe({
      next: e => { this.equipment.set(e); this.loading.set(false); },
      error: (err) => { this.loading.set(false); this.showError(err, 'cargar equipos'); },
    });
  }

  loadPurchases() {
    return new Promise<void>(r => this.http.get<Purchase[]>('/inventory/purchases').subscribe({
      next: p => { this.purchases.set(p); r(); },
      error: () => r(),
    }));
  }

  statusLabel(s: string) {
    return { stock: 'En stock', assigned: 'Asignado', rma: 'RMA', lost: 'Perdido', retired: 'Retirado' }[s] || s;
  }

  showError(err: any, context: string) {
    const msg = err?.error?.error || err?.message || 'Error desconocido';
    console.error(`[inventory] ${context}:`, err);
    alert(`Error al ${context}: ${msg}`);
  }

  openNewPurchase() {
    this.np = { supplier: '', invoiceRef: '', purchasedAt: new Date().toISOString().slice(0, 10), notes: '', items: [{ typeId: null, quantity: 1, unitPrice: 0, brand: '', model: '' }] };
    this.showPurchaseModal.set(true);
  }

  savePurchase() {
    if (!this.np.items.length) return;
    const payload = {
      ...this.np,
      items: this.np.items.filter((it: any) => it.typeId).map((it: any) => ({
        typeId: Number(it.typeId), quantity: Number(it.quantity), unitPrice: Number(it.unitPrice),
        brand: it.brand, model: it.model,
      })),
    };
    if (!payload.items.length) return;
    this.saving.set(true);
    this.http.post('/inventory/purchases', payload).subscribe({
      next: async () => {
        this.saving.set(false);
        this.showPurchaseModal.set(false);
        await Promise.all([this.loadPurchases(), this.loadEquipment(), this.loadStats()]);
      },
      error: (err) => { this.saving.set(false); this.showError(err, 'guardar compra'); },
    });
  }

  deletePurchase(p: Purchase) {
    if (!confirm(`¿Eliminar compra de ${p.supplier || p.invoiceRef}? Los equipos quedan, solo se desliga el origen.`)) return;
    this.http.delete(`/inventory/purchases/${p.id}`).subscribe(async () => {
      await Promise.all([this.loadPurchases(), this.loadEquipment(), this.loadStats()]);
    });
  }

  openNewType() {
    this.nt = { name: '', category: 'wifi', unit: 'u', description: '' };
    this.showTypeModal.set(true);
  }

  saveType() {
    if (!this.nt.name) return;
    this.http.post<EquipmentType>('/inventory/types', this.nt).subscribe(async () => {
      this.showTypeModal.set(false);
      await this.loadTypes();
    });
  }

  deleteType(t: EquipmentType) {
    if ((t._count?.equipment || 0) > 0) { alert('No se puede eliminar: hay equipos asociados.'); return; }
    if (!confirm(`¿Eliminar categoría ${t.name}?`)) return;
    this.http.delete(`/inventory/types/${t.id}`).subscribe(() => this.loadTypes());
  }

  openNewEquipment() {
    this.ne = { id: null, typeId: this.types()[0]?.id || null, serialNumber: '', macAddress: '', brand: '', model: '', unitCost: 0, notes: '', status: 'stock' };
    this.showEquipModal.set(true);
  }

  editEquipment(e: Equipment) {
    this.ne = { ...e };
    this.showEquipModal.set(true);
  }

  saveEquipment() {
    if (!this.ne.typeId) return;
    const req = this.ne.id
      ? this.http.put(`/inventory/equipment/${this.ne.id}`, this.ne)
      : this.http.post('/inventory/equipment', this.ne);
    req.subscribe(async () => {
      this.showEquipModal.set(false);
      await Promise.all([this.loadEquipment(), this.loadStats()]);
    });
  }

  openAssign(e: Equipment) {
    this.assignTarget.set(e);
    this.assignSearch = '';
    this.assignClientId = null;
    this.assignNotes = '';
    this.clientResults.set([]);
    this.showAssignModal.set(true);
  }

  async searchClients() {
    if (!this.assignSearch || this.assignSearch.length < 2) { this.clientResults.set([]); return; }
    const all = await this.db.getClients();
    const q = this.assignSearch.toLowerCase();
    const matches = all.filter((c: any) =>
      String(c.id_servicio).includes(q) ||
      (c.nombre || '').toLowerCase().includes(q) ||
      (c.telefono || '').toLowerCase().includes(q)
    ).slice(0, 8);
    this.clientResults.set(matches);
  }

  confirmAssign() {
    const eq = this.assignTarget();
    if (!eq || !this.assignClientId) return;
    this.http.post(`/inventory/equipment/${eq.id}/assign`, { clientId: this.assignClientId, notes: this.assignNotes }).subscribe(async () => {
      this.showAssignModal.set(false);
      await Promise.all([this.loadEquipment(), this.loadStats()]);
    });
  }

  unassign(e: Equipment) {
    if (!confirm(`¿Desasignar ${e.serialNumber || e.model || '#' + e.id} y devolver a stock?`)) return;
    this.http.post(`/inventory/equipment/${e.id}/unassign`, {}).subscribe(async () => {
      await Promise.all([this.loadEquipment(), this.loadStats()]);
    });
  }
}
