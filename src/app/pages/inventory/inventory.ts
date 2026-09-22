import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../components/layout/navbar';
import { LocalDbService } from '../../services/local-db.service';
import { ToastService } from '../../services/toast.service';
import {
  LucideBoxes, LucidePackageOpen, LucidePencil, LucidePlus, LucideSearch, LucideShoppingCart,
  LucideTags, LucideTrash2, LucideUndo2, LucideUserPlus, LucideX,
} from '@lucide/angular';

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
  imports: [
    NavbarComponent, FormsModule, DecimalPipe, DatePipe, RouterLink,
    LucideBoxes, LucidePackageOpen, LucidePencil, LucidePlus, LucideSearch, LucideShoppingCart,
    LucideTags, LucideTrash2, LucideUndo2, LucideUserPlus, LucideX,
  ],
  template: `
    <app-navbar pageTitle="Inventario" />

    <div class="page">
      <!-- RESUMEN -->
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-label">Equipos totales</div>
          <div class="stat-value">{{ stats().total }}</div>
        </div>
        <div class="stat-card success">
          <div class="stat-label">En almacén</div>
          <div class="stat-value">{{ stats().byStatus['stock'] || 0 }}</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-label">Asignados a clientes</div>
          <div class="stat-value">{{ stats().byStatus['assigned'] || 0 }}</div>
        </div>
        <div class="stat-card danger">
          <div class="stat-label">En garantía / perdidos</div>
          <div class="stat-value">{{ (stats().byStatus['rma'] || 0) + (stats().byStatus['lost'] || 0) }}</div>
        </div>
        <div class="stat-card accent">
          <div class="stat-label">Costo del inventario</div>
          <div class="stat-value">RD$ {{ stats().totalCostInStock | number:'1.0-0' }}</div>
        </div>
      </div>

      <!-- PESTAÑAS -->
      <div class="tabs" role="tablist">
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'equipment'" [class.active]="tab() === 'equipment'" (click)="tab.set('equipment')">
          <svg lucideBoxes size="15"></svg> Equipos
        </button>
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'purchases'" [class.active]="tab() === 'purchases'" (click)="tab.set('purchases')">
          <svg lucideShoppingCart size="15"></svg> Compras <span class="tab-count">{{ purchases().length }}</span>
        </button>
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'types'" [class.active]="tab() === 'types'" (click)="tab.set('types')">
          <svg lucideTags size="15"></svg> Categorías <span class="tab-count">{{ types().length }}</span>
        </button>
      </div>

      @if (tab() === 'equipment') {
        <div class="toolbar">
          <div class="filters">
            <div class="search">
              <svg lucideSearch size="14"></svg>
              <input type="search" placeholder="Buscar serial, MAC o marca…" aria-label="Buscar equipo" [(ngModel)]="searchQ" (input)="searchEquipmentSoon()" />
            </div>
            <select [(ngModel)]="filterStatus" (change)="loadEquipment()" aria-label="Filtrar por estado">
              <option value="">Todos los estados</option>
              <option value="stock">En almacén</option>
              <option value="assigned">Asignados</option>
              <option value="rma">En garantía (RMA)</option>
              <option value="lost">Perdidos</option>
              <option value="retired">Retirados</option>
            </select>
            <select [(ngModel)]="filterTypeId" (change)="loadEquipment()" aria-label="Filtrar por categoría">
              <option [ngValue]="''">Todas las categorías</option>
              @for (t of types(); track t.id) {
                <option [ngValue]="t.id">{{ t.name }}</option>
              }
            </select>
          </div>
          <button type="button" class="btn btn-primary" (click)="openNewEquipment()" [disabled]="!types().length"
            [title]="!types().length ? 'Primero crea una categoría en la pestaña Categorías' : ''">
            <svg lucidePlus size="16"></svg> Agregar equipo
          </button>
        </div>

        @if (loading()) {
          <div class="loading-state"><div class="spinner"></div><span>Cargando equipos…</span></div>
        } @else if (equipment().length === 0) {
          <div class="empty-state">
            <svg lucidePackageOpen size="44"></svg>
            @if (searchQ || filterStatus || filterTypeId !== '') {
              <h3>Ningún equipo coincide con los filtros</h3>
              <p>Prueba con otra búsqueda o quita los filtros.</p>
              <button type="button" class="btn btn-outline btn-mini" (click)="clearFilters()">Quitar filtros</button>
            } @else {
              <h3>Todavía no hay equipos</h3>
              <p>Registra una compra en la pestaña <strong>Compras</strong> o toca <strong>Agregar equipo</strong>.</p>
            }
          </div>
        } @else {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th>Serial / MAC</th>
                  <th>Marca / Modelo</th>
                  <th class="num">Costo</th>
                  <th>Estado</th>
                  <th>Cliente</th>
                  <th class="num">Acciones</th>
                </tr>
              </thead>
              <tbody>
                @for (e of equipment(); track e.id) {
                  <tr>
                    <td><span class="cat-pill">{{ e.type?.name || '—' }}</span></td>
                    <td>
                      <div class="serial">{{ e.serialNumber || '—' }}</div>
                      @if (e.macAddress) { <div class="muted mono">{{ e.macAddress }}</div> }
                    </td>
                    <td>
                      <div>{{ e.brand || '—' }}</div>
                      @if (e.model) { <div class="muted">{{ e.model }}</div> }
                    </td>
                    <td class="num nowrap">RD$ {{ e.unitCost | number:'1.0-2' }}</td>
                    <td><span class="status-pill" [class]="'st-' + e.status">{{ statusLabel(e.status) }}</span></td>
                    <td>
                      @if (e.client) {
                        <a [routerLink]="['/clients', e.client.idServicio]" class="link">{{ e.client.nombre }}</a>
                      } @else { <span class="muted">—</span> }
                    </td>
                    <td class="num">
                      <div class="actions-cell">
                        @if (e.status === 'stock') {
                          <button type="button" class="btn btn-mini btn-primary" (click)="openAssign(e)"><svg lucideUserPlus size="13"></svg> Asignar</button>
                        } @else if (e.status === 'assigned') {
                          <button type="button" class="btn btn-mini btn-outline" (click)="unassign(e)" title="Devolver el equipo al almacén"><svg lucideUndo2 size="13"></svg> Devolver</button>
                        }
                        <button type="button" class="btn btn-mini btn-outline btn-icon" (click)="editEquipment(e)" title="Editar equipo" aria-label="Editar equipo"><svg lucidePencil size="13"></svg></button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="table-foot">{{ equipment().length }} {{ equipment().length === 1 ? 'equipo' : 'equipos' }} en la lista</p>
        }
      }

      @if (tab() === 'purchases') {
        <div class="toolbar">
          <h3>{{ purchases().length }} {{ purchases().length === 1 ? 'compra registrada' : 'compras registradas' }}</h3>
          <button type="button" class="btn btn-primary" (click)="openNewPurchase()" [disabled]="!types().length"
            [title]="!types().length ? 'Primero crea una categoría en la pestaña Categorías' : ''">
            <svg lucidePlus size="16"></svg> Registrar compra
          </button>
        </div>
        @if (purchases().length === 0) {
          <div class="empty-state">
            <svg lucideShoppingCart size="44"></svg>
            <h3>No hay compras registradas</h3>
            <p>Registra la primera compra de equipos. Cada compra se anota también como gasto.</p>
          </div>
        } @else {
          <div class="purchases-grid">
            @for (p of purchases(); track p.id) {
              <div class="purchase-card">
                <div class="purchase-head">
                  <div>
                    <div class="purchase-supplier">{{ p.supplier || 'Proveedor no indicado' }}</div>
                    <div class="muted">{{ p.purchasedAt | date:'dd/MM/yyyy' }}@if (p.invoiceRef) { · Factura {{ p.invoiceRef }} }</div>
                  </div>
                  <div class="purchase-total">RD$ {{ p.total | number:'1.0-2' }}</div>
                </div>
                <div class="purchase-items">
                  @for (it of p.items || []; track it.id) {
                    <div class="purchase-item">
                      <span>{{ it.type?.name || '—' }}</span>
                      <span class="muted">{{ it.quantity }} × RD$ {{ it.unitPrice | number:'1.0-2' }}</span>
                    </div>
                  } @empty {
                    <span class="muted">Sin detalle de artículos</span>
                  }
                </div>
                <div class="purchase-foot">
                  <span class="muted">{{ p._count?.equipment || 0 }} equipos registrados</span>
                  <button type="button" class="btn btn-mini btn-danger-outline" (click)="deletePurchase(p)"><svg lucideTrash2 size="13"></svg> Eliminar</button>
                </div>
              </div>
            }
          </div>
        }
      }

      @if (tab() === 'types') {
        <div class="toolbar">
          <h3>{{ types().length }} {{ types().length === 1 ? 'categoría' : 'categorías' }}</h3>
          <button type="button" class="btn btn-primary" (click)="openNewType()"><svg lucidePlus size="16"></svg> Nueva categoría</button>
        </div>
        @if (types().length === 0) {
          <div class="empty-state">
            <svg lucideTags size="44"></svg>
            <h3>No hay categorías</h3>
            <p>Crea categorías como “Router WiFi” u “ONU” para poder registrar equipos y compras.</p>
          </div>
        } @else {
          <div class="types-grid">
            @for (t of types(); track t.id) {
              <div class="type-card">
                <div class="type-name">{{ t.name }}</div>
                <div class="muted">{{ categoryLabel(t.category) }} · se mide en {{ unitLabel(t.unit) }}</div>
                <div class="type-count">{{ t._count?.equipment || 0 }} <span>{{ (t._count?.equipment || 0) === 1 ? 'unidad' : 'unidades' }}</span></div>
                <button type="button" class="btn btn-mini btn-danger-outline" (click)="deleteType(t)" [disabled]="(t._count?.equipment || 0) > 0"
                  [title]="(t._count?.equipment || 0) > 0 ? 'No se puede eliminar: tiene equipos registrados' : 'Eliminar categoría'">
                  <svg lucideTrash2 size="13"></svg> Eliminar
                </button>
              </div>
            }
          </div>
        }
      }
    </div>

    <!-- MODAL: NUEVA COMPRA -->
    @if (showPurchaseModal()) {
      <div class="modal-backdrop" (click)="showPurchaseModal.set(false)"></div>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Registrar compra">
        <div class="modal-head">
          <h3>Registrar compra</h3>
          <button type="button" aria-label="Cerrar" (click)="showPurchaseModal.set(false)"><svg lucideX size="18"></svg></button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <label>Proveedor</label>
            <input [(ngModel)]="np.supplier" placeholder="Ej.: Tech Mayoreo SRL" />
          </div>
          <div class="form-row two-col">
            <div>
              <label>Fecha</label>
              <input type="date" [(ngModel)]="np.purchasedAt" />
            </div>
            <div>
              <label>N.º de factura</label>
              <input [(ngModel)]="np.invoiceRef" placeholder="Ej.: A12345" />
            </div>
          </div>
          <div class="form-row">
            <label>Artículos comprados</label>
            <div class="item-head">
              <span>Categoría</span><span>Cantidad</span><span>Precio c/u (RD$)</span><span>Marca</span><span>Modelo</span><span></span>
            </div>
            @for (it of np.items; track $index; let i = $index) {
              <div class="item-row" [class.invalid-row]="triedPurchase() && !it.typeId">
                <select [(ngModel)]="it.typeId" aria-label="Categoría">
                  <option [ngValue]="null">Elegir categoría…</option>
                  @for (t of types(); track t.id) {
                    <option [ngValue]="t.id">{{ t.name }} ({{ unitLabel(t.unit) }})</option>
                  }
                </select>
                <input type="number" min="1" placeholder="Cant." aria-label="Cantidad" [(ngModel)]="it.quantity" />
                <input type="number" min="0" step="0.01" placeholder="Precio" aria-label="Precio por unidad" [(ngModel)]="it.unitPrice" />
                <input placeholder="Marca" aria-label="Marca" [(ngModel)]="it.brand" />
                <input placeholder="Modelo" aria-label="Modelo" [(ngModel)]="it.model" />
                <button type="button" (click)="np.items.splice(i, 1)" class="btn btn-mini btn-outline btn-icon" title="Quitar artículo" aria-label="Quitar artículo"><svg lucideX size="13"></svg></button>
              </div>
            }
            <button type="button" class="btn btn-mini btn-outline add-item" (click)="np.items.push({ typeId: null, quantity: 1, unitPrice: 0, brand: '', model: '' })"><svg lucidePlus size="13"></svg> Agregar artículo</button>
          </div>
          <div class="modal-total">
            <strong>Total: RD$ {{ newPurchaseTotal() | number:'1.0-2' }}</strong>
            <span class="muted">Se registra automáticamente como gasto en la categoría “inventario”.</span>
          </div>
          <div class="form-row">
            <label>Notas</label>
            <textarea [(ngModel)]="np.notes" rows="2" placeholder="Opcional"></textarea>
          </div>
          @if (triedPurchase() && purchaseError()) {
            <p class="form-error">{{ purchaseError() }}</p>
          }
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-outline" (click)="showPurchaseModal.set(false)">Cancelar</button>
          <button type="button" class="btn btn-primary" (click)="savePurchase()" [disabled]="saving()">{{ saving() ? 'Guardando…' : 'Guardar compra' }}</button>
        </div>
      </div>
    }

    <!-- MODAL: NUEVA CATEGORÍA -->
    @if (showTypeModal()) {
      <div class="modal-backdrop" (click)="showTypeModal.set(false)"></div>
      <div class="modal small" role="dialog" aria-modal="true" aria-label="Nueva categoría">
        <div class="modal-head"><h3>Nueva categoría</h3><button type="button" aria-label="Cerrar" (click)="showTypeModal.set(false)"><svg lucideX size="18"></svg></button></div>
        <div class="modal-body">
          <div class="form-row">
            <label>Nombre *</label>
            <input [(ngModel)]="nt.name" placeholder="Ej.: Router WiFi 4 puertos" [class.invalid]="triedType() && !nt.name" />
            @if (triedType() && !nt.name) { <small class="field-error">Escribe el nombre de la categoría.</small> }
          </div>
          <div class="form-row two-col">
            <div>
              <label>Tipo</label>
              <select [(ngModel)]="nt.category">
                <option value="wifi">WiFi</option>
                <option value="cable">Cable</option>
                <option value="onu">ONU</option>
                <option value="antena">Antena</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div>
              <label>Se mide en</label>
              <select [(ngModel)]="nt.unit">
                <option value="u">Unidades</option>
                <option value="m">Metros</option>
                <option value="kg">Kilos</option>
              </select>
            </div>
          </div>
          <div class="form-row"><label>Descripción</label><textarea [(ngModel)]="nt.description" rows="2" placeholder="Opcional"></textarea></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-outline" (click)="showTypeModal.set(false)">Cancelar</button>
          <button type="button" class="btn btn-primary" (click)="saveType()">Crear categoría</button>
        </div>
      </div>
    }

    <!-- MODAL: ASIGNAR -->
    @if (showAssignModal()) {
      <div class="modal-backdrop" (click)="showAssignModal.set(false)"></div>
      <div class="modal small" role="dialog" aria-modal="true" aria-label="Asignar equipo">
        <div class="modal-head"><h3>Asignar equipo a un cliente</h3><button type="button" aria-label="Cerrar" (click)="showAssignModal.set(false)"><svg lucideX size="18"></svg></button></div>
        <div class="modal-body">
          <p class="assign-target"><strong>{{ assignTarget()?.type?.name }}</strong> · Serial {{ assignTarget()?.serialNumber || '—' }}</p>
          <div class="form-row">
            <label>Cliente</label>
            <input type="search" [(ngModel)]="assignSearch" (input)="assignClientId = null; searchClients()" placeholder="Buscar por nombre, teléfono o número de servicio…" />
            @if (clientResults().length > 0) {
              <div class="search-list">
                @for (c of clientResults(); track c.id_servicio) {
                  <button type="button" class="search-item" [class.selected]="assignClientId === c.id_servicio" (click)="assignClientId = c.id_servicio; assignSearch = c.nombre">
                    {{ c.nombre }} <span class="muted">(#{{ c.id_servicio }} · {{ c.telefono || 'sin teléfono' }})</span>
                  </button>
                }
              </div>
            } @else if (assignSearch.length >= 2 && !assignClientId) {
              <small class="muted">No se encontró ningún cliente con “{{ assignSearch }}”.</small>
            } @else if (!assignClientId) {
              <small class="muted">Escribe al menos 2 letras y elige el cliente de la lista.</small>
            }
          </div>
          <div class="form-row"><label>Notas de instalación</label><textarea [(ngModel)]="assignNotes" rows="2" placeholder="Opcional"></textarea></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-outline" (click)="showAssignModal.set(false)">Cancelar</button>
          <button type="button" class="btn btn-primary" (click)="confirmAssign()" [disabled]="!assignClientId" [title]="!assignClientId ? 'Elige un cliente de la lista' : ''">Asignar</button>
        </div>
      </div>
    }

    <!-- MODAL: NUEVO / EDITAR EQUIPO -->
    @if (showEquipModal()) {
      <div class="modal-backdrop" (click)="showEquipModal.set(false)"></div>
      <div class="modal small" role="dialog" aria-modal="true" [attr.aria-label]="ne.id ? 'Editar equipo' : 'Nuevo equipo'">
        <div class="modal-head"><h3>{{ ne.id ? 'Editar' : 'Nuevo' }} equipo</h3><button type="button" aria-label="Cerrar" (click)="showEquipModal.set(false)"><svg lucideX size="18"></svg></button></div>
        <div class="modal-body">
          <div class="form-row">
            <label>Categoría *</label>
            <select [(ngModel)]="ne.typeId" [class.invalid]="triedEquip() && !ne.typeId">
              <option [ngValue]="null">Elegir categoría…</option>
              @for (t of types(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
            </select>
            @if (triedEquip() && !ne.typeId) { <small class="field-error">Elige una categoría.</small> }
          </div>
          <div class="form-row two-col">
            <div><label>Serial</label><input [(ngModel)]="ne.serialNumber" /></div>
            <div><label>MAC</label><input [(ngModel)]="ne.macAddress" placeholder="AA:BB:CC:DD:EE:FF" /></div>
          </div>
          <div class="form-row two-col">
            <div><label>Marca</label><input [(ngModel)]="ne.brand" /></div>
            <div><label>Modelo</label><input [(ngModel)]="ne.model" /></div>
          </div>
          <div class="form-row two-col">
            <div><label>Costo por unidad (RD$)</label><input type="number" step="0.01" [(ngModel)]="ne.unitCost" /></div>
            <div>
              <label>Estado</label>
              <select [(ngModel)]="ne.status">
                <option value="stock">En almacén</option>
                <option value="assigned">Asignado</option>
                <option value="rma">En garantía (RMA)</option>
                <option value="lost">Perdido</option>
                <option value="retired">Retirado</option>
              </select>
            </div>
          </div>
          <div class="form-row"><label>Notas</label><textarea [(ngModel)]="ne.notes" rows="2" placeholder="Opcional"></textarea></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-outline" (click)="showEquipModal.set(false)">Cancelar</button>
          <button type="button" class="btn btn-primary" (click)="saveEquipment()">{{ ne.id ? 'Guardar cambios' : 'Crear equipo' }}</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .page { padding: 24px 32px; }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .stat-card { background: white; border: 1px solid #e0e6e1; border-radius: 12px; padding: 14px 18px; }
    .stat-card.success { border-left: 4px solid #0f7a53; }
    .stat-card.warning { border-left: 4px solid #b36b12; }
    .stat-card.danger { border-left: 4px solid #b42318; }
    .stat-card.accent { border-left: 4px solid #0b6b52; }
    .stat-label { font-size: 12px; color: #56665e; font-weight: 600; }
    .stat-value { font-size: 22px; font-weight: 700; color: #15211c; margin-top: 4px; }

    .tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid #e0e6e1; overflow-x: auto; }
    .tabs button { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; padding: 10px 14px; cursor: pointer; color: #56665e; font-weight: 600; font-size: 13px; border-bottom: 2px solid transparent; white-space: nowrap; }
    .tabs button:hover { color: #15211c; }
    .tabs button.active { color: #0b6b52; border-bottom-color: #0b6b52; }
    .tab-count { font-size: 11px; background: #f1f4f7; color: #56665e; padding: 1px 7px; border-radius: 999px; }
    .tabs button.active .tab-count { background: #e6f2ec; color: #0b6b52; }

    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .toolbar h3 { margin: 0; color: #15211c; font-size: 15px; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .filters select { padding: 8px 10px; border: 1px solid #cfd8d2; border-radius: 9px; font-size: 13px; min-width: 150px; background: white; color: #2d3b34; }
    .search { display: flex; align-items: center; gap: 6px; background: white; border: 1px solid #cfd8d2; border-radius: 9px; padding: 0 10px; color: #56665e; }
    .search:focus-within { border-color: #0b6b52; }
    .search input { border: none; outline: none; padding: 8px 0; font-size: 13px; width: 200px; color: #2d3b34; background: none; }

    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 14px; border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: background 0.15s, border-color 0.15s; }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-primary { background: #0b6b52; color: white; }
    .btn-primary:hover:not(:disabled) { background: #08523f; }
    .btn-outline { background: white; border-color: #cfd8d2; color: #2d3b34; }
    .btn-outline:hover:not(:disabled) { border-color: #0b6b52; color: #0b6b52; }
    .btn-danger-outline { background: white; border-color: #f0c4bf; color: #b42318; }
    .btn-danger-outline:hover:not(:disabled) { background: #fff0ef; }
    .btn-mini { padding: 5px 9px; font-size: 12px; }
    .btn-icon { padding: 5px 7px; }

    .table-wrap { background: white; border: 1px solid #e0e6e1; border-radius: 12px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 11px 12px; border-bottom: 1px solid #eff2ee; font-size: 13px; color: #2d3b34; }
    th { background: #f4f6f2; color: #56665e; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
    th.num, td.num { text-align: right; }
    .nowrap { white-space: nowrap; }
    tr:hover td { background: #f4f6f2; }
    .actions-cell { display: flex; gap: 6px; justify-content: flex-end; }
    .serial, .mono { font-family: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 12px; }
    .serial { color: #15211c; }
    .muted { color: #56665e; font-size: 12px; }
    .link { color: #0b6b52; text-decoration: none; font-weight: 600; }
    .link:hover { text-decoration: underline; }
    .table-foot { margin: 8px 2px 0; font-size: 12px; color: #56665e; }

    .cat-pill { background: #eef6f1; color: #0b6b52; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .status-pill { padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .st-stock { background: #e9f8f1; color: #0f7a53; }
    .st-assigned { background: #e6f2ec; color: #0b6b52; }
    .st-rma { background: #fff6e8; color: #b36b12; }
    .st-lost { background: #fff0ef; color: #b42318; }
    .st-retired { background: #f1f4f7; color: #56665e; }

    .purchases-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
    .purchase-card { background: white; border: 1px solid #e0e6e1; border-radius: 12px; padding: 16px; }
    .purchase-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
    .purchase-supplier { font-weight: 600; color: #15211c; }
    .purchase-total { font-size: 17px; font-weight: 700; color: #15211c; white-space: nowrap; }
    .purchase-items { display: flex; flex-direction: column; gap: 4px; padding: 10px 0; border-top: 1px dashed #e0e6e1; border-bottom: 1px dashed #e0e6e1; }
    .purchase-item { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: #2d3b34; }
    .purchase-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }

    .types-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
    .type-card { background: white; border: 1px solid #e0e6e1; border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
    .type-name { font-weight: 600; color: #15211c; }
    .type-count { font-size: 20px; font-weight: 700; color: #15211c; margin: 4px 0; }
    .type-count span { font-size: 12px; font-weight: 500; color: #56665e; }

    .loading-state, .empty-state { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 56px 20px; gap: 10px; color: #56665e; background: white; border: 1px dashed #e0e6e1; border-radius: 12px; font-size: 13px; }
    .empty-state svg { color: #b6c2cc; }
    .empty-state h3 { color: #15211c; margin: 4px 0 0; font-size: 16px; }
    .empty-state p { margin: 0; max-width: 420px; }
    .spinner { width: 28px; height: 28px; border: 3px solid #e0e6e1; border-top-color: #0b6b52; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .modal-backdrop { position: fixed; inset: 0; background: rgba(14, 29, 23, 0.55); z-index: 200; }
    .modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 12px; width: 760px; max-width: calc(100vw - 32px); max-height: 90vh; display: flex; flex-direction: column; z-index: 201; box-shadow: 0 20px 60px rgba(14, 29, 23, 0.25); }
    .modal.small { width: 480px; }
    .modal-head { padding: 16px 20px; border-bottom: 1px solid #eff2ee; display: flex; justify-content: space-between; align-items: center; }
    .modal-head h3 { margin: 0; color: #15211c; font-size: 16px; }
    .modal-head button { display: grid; place-items: center; background: none; border: none; cursor: pointer; color: #56665e; padding: 4px; border-radius: 9px; }
    .modal-head button:hover { background: #eef6f1; color: #15211c; }
    .modal-body { padding: 18px 20px; overflow: auto; flex: 1; }
    .modal-foot { padding: 14px 20px; border-top: 1px solid #eff2ee; display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
    .modal-total { padding: 12px; background: #eef6f1; border-radius: 9px; margin: 12px 0; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; color: #15211c; }
    .assign-target { margin: 0 0 14px; font-size: 13px; color: #2d3b34; background: #f4f6f2; padding: 8px 12px; border-radius: 9px; }

    .form-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .form-row label { font-size: 12px; color: #2d3b34; font-weight: 600; }
    .form-row input, .form-row select, .form-row textarea { padding: 9px 11px; border: 1px solid #cfd8d2; border-radius: 9px; font-size: 13px; font-family: inherit; color: #2d3b34; background: white; outline: none; }
    .form-row input:focus, .form-row select:focus, .form-row textarea:focus { border-color: #0b6b52; box-shadow: 0 0 0 3px rgba(11, 107, 82, 0.12); }
    .form-row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form-row.two-col > div { display: flex; flex-direction: column; gap: 6px; }
    .invalid { border-color: #b42318 !important; }
    .field-error { color: #b42318; font-size: 12px; }
    .form-error { margin: 0; padding: 9px 12px; background: #fff0ef; color: #b42318; border-radius: 9px; font-size: 13px; }

    .item-head, .item-row { display: grid; grid-template-columns: 1.5fr 0.6fr 0.9fr 1fr 1fr auto; gap: 6px; align-items: center; }
    .item-head { font-size: 11px; color: #56665e; font-weight: 600; }
    .item-row { margin-bottom: 6px; }
    .item-row input, .item-row select { padding: 8px 9px; border: 1px solid #cfd8d2; border-radius: 9px; font-size: 13px; min-width: 0; }
    .item-row.invalid-row select { border-color: #b42318; }
    .add-item { align-self: flex-start; }

    .search-list { background: white; border: 1px solid #e0e6e1; border-radius: 9px; max-height: 220px; overflow: auto; margin-top: 4px; }
    .search-item { display: block; width: 100%; text-align: left; background: white; border: none; padding: 9px 12px; cursor: pointer; border-bottom: 1px solid #eff2ee; font-size: 13px; color: #15211c; font-family: inherit; }
    .search-item:hover, .search-item.selected { background: #eef6f1; }

    @media (max-width: 768px) {
      .page { padding: 16px; }
      .search { flex: 1 1 100%; }
      .search input { width: 100%; }
      .filters { width: 100%; }
      .filters select { flex: 1; min-width: 0; }
      .item-head { display: none; }
      .item-row { grid-template-columns: 1fr 1fr; padding: 8px; border: 1px solid #eff2ee; border-radius: 9px; }
      .item-row select { grid-column: 1 / -1; }
      .form-row.two-col { grid-template-columns: 1fr; }
    }
  `]
})
export class InventoryComponent implements OnInit {
  private http = inject(HttpClient);
  private db = inject(LocalDbService);
  private toast = inject(ToastService);

  tab = signal<'equipment' | 'purchases' | 'types'>('equipment');
  loading = signal(false);
  saving = signal(false);

  stats = signal<Stats>({ total: 0, byStatus: {}, totalCostInStock: 0 });
  equipment = signal<Equipment[]>([]);
  purchases = signal<Purchase[]>([]);
  types = signal<EquipmentType[]>([]);

  searchQ = '';
  // Espera a que el usuario deje de escribir para no consultar el servidor en cada tecla.
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  searchEquipmentSoon() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadEquipment(), 300);
  }
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

  // Validación visible en formularios (se activa al intentar guardar)
  triedPurchase = signal(false);
  triedType = signal(false);
  triedEquip = signal(false);

  // Antes era computed() sobre un objeto que no es signal, así que el total no se actualizaba en pantalla.
  newPurchaseTotal(): number {
    return (this.np.items || []).reduce((s: number, it: any) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
  }

  purchaseError(): string {
    if (!this.np.items?.length) return 'Agrega al menos un artículo a la compra.';
    if (!this.np.items.some((it: any) => it.typeId)) return 'Elige la categoría de al menos un artículo.';
    if (this.np.items.some((it: any) => !it.typeId)) return 'Hay artículos sin categoría: no se guardarán. Elige su categoría o quítalos.';
    return '';
  }

  clearFilters() {
    this.searchQ = '';
    this.filterStatus = '';
    this.filterTypeId = '';
    this.loadEquipment();
  }

  categoryLabel(c: string): string {
    return ({ wifi: 'WiFi', cable: 'Cable', onu: 'ONU', antena: 'Antena', otro: 'Otro' } as Record<string, string>)[c] || c || '—';
  }

  unitLabel(u: string): string {
    return ({ u: 'unidades', m: 'metros', kg: 'kilos' } as Record<string, string>)[u] || u || '—';
  }

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
      error: (err) => { this.loading.set(false); this.showError(err, 'cargar los equipos'); },
    });
  }

  loadPurchases() {
    return new Promise<void>(r => this.http.get<Purchase[]>('/inventory/purchases').subscribe({
      next: p => { this.purchases.set(p); r(); },
      error: () => r(),
    }));
  }

  statusLabel(s: string) {
    return ({ stock: 'En almacén', assigned: 'Asignado', rma: 'En garantía (RMA)', lost: 'Perdido', retired: 'Retirado' } as Record<string, string>)[s] || s;
  }

  showError(err: any, context: string) {
    const msg = err?.status === 0
      ? 'no hay conexión con el servidor'
      : (err?.error?.error || 'intenta de nuevo');
    console.error(`[inventory] ${context}:`, err);
    this.toast.error(`No se pudo ${context}: ${msg}`);
  }

  openNewPurchase() {
    this.np = { supplier: '', invoiceRef: '', purchasedAt: new Date().toISOString().slice(0, 10), notes: '', items: [{ typeId: null, quantity: 1, unitPrice: 0, brand: '', model: '' }] };
    this.triedPurchase.set(false);
    this.showPurchaseModal.set(true);
  }

  savePurchase() {
    this.triedPurchase.set(true);
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
        this.toast.success('Compra registrada');
        await Promise.all([this.loadPurchases(), this.loadEquipment(), this.loadStats()]);
      },
      error: (err) => { this.saving.set(false); this.showError(err, 'guardar la compra'); },
    });
  }

  deletePurchase(p: Purchase) {
    if (!confirm(`¿Eliminar la compra de ${p.supplier || p.invoiceRef || 'este proveedor'}?\n\nLos equipos se quedan en el inventario; solo se borra el registro de la compra.`)) return;
    this.http.delete(`/inventory/purchases/${p.id}`).subscribe({
      next: async () => {
        this.toast.success('Compra eliminada');
        await Promise.all([this.loadPurchases(), this.loadEquipment(), this.loadStats()]);
      },
      error: (err) => this.showError(err, 'eliminar la compra'),
    });
  }

  openNewType() {
    this.nt = { name: '', category: 'wifi', unit: 'u', description: '' };
    this.triedType.set(false);
    this.showTypeModal.set(true);
  }

  saveType() {
    this.triedType.set(true);
    if (!this.nt.name) return;
    this.http.post<EquipmentType>('/inventory/types', this.nt).subscribe({
      next: async () => {
        this.showTypeModal.set(false);
        this.toast.success('Categoría creada');
        await this.loadTypes();
      },
      error: (err) => this.showError(err, 'crear la categoría'),
    });
  }

  deleteType(t: EquipmentType) {
    if ((t._count?.equipment || 0) > 0) { this.toast.error('No se puede eliminar: la categoría tiene equipos registrados.'); return; }
    if (!confirm(`¿Eliminar la categoría "${t.name}"?`)) return;
    this.http.delete(`/inventory/types/${t.id}`).subscribe({
      next: () => { this.toast.success('Categoría eliminada'); this.loadTypes(); },
      error: (err) => this.showError(err, 'eliminar la categoría'),
    });
  }

  openNewEquipment() {
    this.ne = { id: null, typeId: this.types()[0]?.id || null, serialNumber: '', macAddress: '', brand: '', model: '', unitCost: 0, notes: '', status: 'stock' };
    this.triedEquip.set(false);
    this.showEquipModal.set(true);
  }

  editEquipment(e: Equipment) {
    this.ne = { ...e };
    this.triedEquip.set(false);
    this.showEquipModal.set(true);
  }

  saveEquipment() {
    this.triedEquip.set(true);
    if (!this.ne.typeId) return;
    const isEdit = !!this.ne.id;
    const req = this.ne.id
      ? this.http.put(`/inventory/equipment/${this.ne.id}`, this.ne)
      : this.http.post('/inventory/equipment', this.ne);
    req.subscribe({
      next: async () => {
        this.showEquipModal.set(false);
        this.toast.success(isEdit ? 'Equipo actualizado' : 'Equipo agregado');
        await Promise.all([this.loadEquipment(), this.loadStats()]);
      },
      error: (err) => this.showError(err, 'guardar el equipo'),
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
    this.http.post(`/inventory/equipment/${eq.id}/assign`, { clientId: this.assignClientId, notes: this.assignNotes }).subscribe({
      next: async () => {
        this.showAssignModal.set(false);
        this.toast.success('Equipo asignado al cliente');
        await Promise.all([this.loadEquipment(), this.loadStats()]);
      },
      error: (err) => this.showError(err, 'asignar el equipo'),
    });
  }

  unassign(e: Equipment) {
    if (!confirm(`¿Quitar el equipo ${e.serialNumber || e.model || '#' + e.id}${e.client ? ' a ' + e.client.nombre : ''} y devolverlo al almacén?`)) return;
    this.http.post(`/inventory/equipment/${e.id}/unassign`, {}).subscribe({
      next: async () => {
        this.toast.success('Equipo devuelto al almacén');
        await Promise.all([this.loadEquipment(), this.loadStats()]);
      },
      error: (err) => this.showError(err, 'devolver el equipo'),
    });
  }
}
