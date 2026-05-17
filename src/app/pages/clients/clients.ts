import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { NavbarComponent } from '../../components/layout/navbar';
import { WisphubService } from '../../services/wisphub.service';
import { LocalDbService } from '../../services/local-db.service';
import { WispHubClient } from '../../models/client.model';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ExportService } from '../../services/export.service';
import { ClientBlockActionsComponent } from '../../components/client-block-actions/client-block-actions';
import { ClientActionsService } from '../../services/client-actions.service';
import { MetricsService } from '../../services/metrics.service';
import { SurveyService } from '../../services/survey.service';
import { ToastService } from '../../services/toast.service';
import { ClientMetric, tierStyle, consStyle, CreditTier } from '../../models/metrics.model';
import { DecimalPipe } from '@angular/common';

@Component({
  selector: 'app-clients',
  standalone: true,
  imports: [NavbarComponent, RouterLink, FormsModule, ClientBlockActionsComponent, DecimalPipe],
  template: `
    <app-navbar pageTitle="Clientes" />

    <div class="page">
      <div class="toolbar">
        <div class="search-filter">
          <div class="search-input">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Buscar nombre, IP, telefono, plan..." [(ngModel)]="searchTerm" (input)="filterClients()" />
          </div>
          <select [(ngModel)]="statusFilter" (change)="filterClients()" class="filter-select">
            <option value="">Todos</option>
            <option value="activo">Activo</option>
            <option value="suspendido">Suspendido</option>
            <option value="cortado">Cortado</option>
            <option value="gratis">Gratis</option>
            <option value="retirado">Retirado</option>
          </select>
          <select [(ngModel)]="planFilter" (change)="filterClients()" class="filter-select">
            <option value="">Todos los planes</option>
            @for (plan of allPlans(); track plan) {
              <option [value]="plan">{{ plan }}</option>
            }
          </select>
          <select [(ngModel)]="tierFilter" (change)="filterClients()" class="filter-select">
            <option value="">Todos los tiers</option>
            <option value="EXCELENTE">🌟 Excelente</option>
            <option value="BUENO">✅ Bueno</option>
            <option value="REGULAR">⚠️ Regular</option>
            <option value="RIESGO">🟠 Riesgo</option>
            <option value="CRITICO">🔴 Crítico</option>
          </select>
        </div>
        <div class="toolbar-actions">
          <a routerLink="/clients/new" class="btn btn-green">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nuevo
          </a>
          <button class="btn btn-outline" (click)="exportCSV()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            CSV
          </button>
          <button class="btn btn-primary" (click)="syncClients()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
            {{ syncing() ? 'Sincronizando...' : 'Sincronizar' }}
          </button>
          <span class="client-count">{{ filteredClients().length }} de {{ allClients().length }}</span>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Cargando clientes...</p>
        </div>
      } @else if (filteredClients().length === 0 && allClients().length === 0) {
        <div class="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          <h3>Sin clientes</h3>
          <p>Presiona "Sincronizar" para cargar los 369 clientes desde WispHub</p>
        </div>
      } @else {
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th class="sortable" (click)="sort('nombre')">Cliente {{ sortIcon('nombre') }}</th>
                <th class="sortable" (click)="sort('telefono')">Telefono {{ sortIcon('telefono') }}</th>
                <th class="sortable" (click)="sort('plan_internet.nombre')">Plan {{ sortIcon('plan_internet.nombre') }}</th>
                <th class="sortable" (click)="sort('precio_plan')">Precio {{ sortIcon('precio_plan') }}</th>
                <th class="sortable" (click)="sort('ip')">IP {{ sortIcon('ip') }}</th>
                <th class="sortable" (click)="sort('estado')">Estado {{ sortIcon('estado') }}</th>
                <th class="sortable" (click)="sort('creditScore')">Score {{ sortIcon('creditScore') }}</th>
                <th>Facturas</th>
                <th class="sortable" (click)="sort('fecha_corte')">Corte {{ sortIcon('fecha_corte') }}</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (c of filteredClients(); track c.id_servicio) {
                <tr [routerLink]="['/clients', c.id_servicio]" class="clickable-row">
                  <td data-label="Cliente">
                    <div class="cell-client">
                      <div class="avatar-sm" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</div>
                      <div>
                        <span class="name">{{ c.nombre }}</span>
                        <span class="sub">{{ c.direccion || c.usuario }}</span>
                      </div>
                    </div>
                  </td>
                  <td data-label="Telefono" class="mono">{{ c.telefono || '-' }}</td>
                  <td data-label="Plan">
                    <span class="plan-name">{{ c.plan_internet?.nombre || '-' }}</span>
                  </td>
                  <td data-label="Precio" class="price">RD$ {{ c.precio_plan }}</td>
                  <td data-label="IP" class="mono ip">{{ c.ip || '-' }}</td>
                  <td data-label="Estado">
                    <span class="badge" [class]="'badge-' + getStatusClass(c.estado)">{{ c.estado }}</span>
                  </td>
                  <td data-label="Facturas">
                    <span class="badge" [class]="'badge-' + getFacturaClass(c.estado_facturas)">{{ c.estado_facturas || '-' }}</span>
                  </td>
                  <td data-label="Score" (click)="$event.stopPropagation()">
                    @if (getMetric(c.id_servicio); as m) {
                      <div class="score-cell">
                        @if (m.creditTier && tierStyle(m.creditTier); as ts) {
                          <span class="tier-pill" [style.background]="ts.bg" [style.color]="ts.color"
                                [title]="'Score: ' + (m.creditScore || '?') + '/100 — ' + ts.label">
                            {{ ts.emoji }} {{ m.creditScore }}
                          </span>
                        }
                        @if (m.consumptionTier && consStyle(m.consumptionTier); as cs) {
                          <span class="cons-pill" [style.background]="cs.bg" [style.color]="cs.color"
                                [title]="cs.label + ' — ' + ((m.consumptionMb30d || 0) / 1024 | number:'1.1-1') + ' GB en 30d'">
                            {{ cs.emoji }}
                          </span>
                        }
                      </div>
                    } @else {
                      <span class="empty-tier">—</span>
                    }
                  </td>
                  <td data-label="Corte" class="date">{{ c.fecha_corte || '-' }}</td>
                  <td data-label="Acciones" (click)="$event.stopPropagation()">
                    @if (crmActionLabel(c.id_servicio); as lbl) {
                      <span class="badge badge-{{ lbl.color }}">{{ lbl.text }}</span>
                    }
                    <app-client-block-actions
                      [idServicio]="c.id_servicio"
                      [clientName]="c.nombre"
                      [crmAction]="crmActionFor(c.id_servicio)"
                      (changed)="onActionChanged($event, c.id_servicio)"
                    />
                    @if (c.ip) {
                      <button
                        class="btn-survey"
                        [disabled]="surveyLoading() === c.id_servicio"
                        (click)="enviarEncuesta(c)"
                        title="Mostrar encuesta al cliente al abrir cualquier sitio HTTP">
                        @if (surveyLoading() === c.id_servicio) {
                          ...
                        } @else {
                          &#x1F4DD; Encuesta
                        }
                      </button>
                    }
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
    </div>
  `,
  styles: [`
    .page { padding: 24px 32px; }

    .toolbar {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 20px; gap: 16px; flex-wrap: wrap;
    }

    .search-filter { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

    .search-input {
      display: flex; align-items: center; gap: 8px;
      background: white; border: 1px solid #e2e8f0;
      border-radius: 10px; padding: 10px 16px; color: #94a3b8; min-width: 320px;
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
    .btn-green { background: #22c55e; color: white; text-decoration: none; }
    .btn-green:hover { background: #16a34a; }

    .client-count { font-size: 13px; color: #64748b; font-weight: 500; white-space: nowrap; }

    .table-container {
      background: white; border-radius: 16px;
      border: 1px solid #e2e8f0; overflow-x: auto;
    }

    .data-table { width: 100%; border-collapse: collapse; min-width: 900px; }

    .data-table th {
      text-align: left; font-size: 11px; font-weight: 600; color: #64748b;
      text-transform: uppercase; letter-spacing: 0.5px;
      padding: 12px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
      position: sticky; top: 0; z-index: 1;
    }
    .sortable { cursor: pointer; user-select: none; }
    .sortable:hover { color: #6366f1; }

    .data-table td {
      padding: 10px 14px; font-size: 13px; color: #334155;
      border-bottom: 1px solid #f1f5f9;
    }

    .clickable-row { cursor: pointer; transition: background 0.15s; }
    .clickable-row:hover td { background: #f0f4ff; }

    .cell-client { display: flex; align-items: center; gap: 10px; }

    .avatar-sm {
      width: 36px; height: 36px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 13px; color: white; flex-shrink: 0;
    }
    .avatar-sm.active { background: linear-gradient(135deg, #22c55e, #16a34a); }
    .avatar-sm.suspended { background: linear-gradient(135deg, #ef4444, #dc2626); }
    .avatar-sm.free { background: linear-gradient(135deg, #3b82f6, #2563eb); }
    .avatar-sm.default { background: linear-gradient(135deg, #94a3b8, #64748b); }

    .name { display: block; font-weight: 600; color: #0f172a; font-size: 14px; }
    .sub { display: block; font-size: 11px; color: #94a3b8; margin-top: 1px; }

    .mono { font-family: 'Courier New', monospace; font-size: 12px; }
    .ip { color: #6366f1; font-weight: 500; }
    .price { font-weight: 700; color: #0f172a; }
    .date { font-size: 12px; color: #64748b; }

    .plan-name { font-size: 13px; font-weight: 500; }

    .badge {
      display: inline-block; padding: 3px 8px;
      border-radius: 20px; font-size: 11px; font-weight: 600; white-space: nowrap;
    }
    .badge-active { background: #dcfce7; color: #16a34a; }
    .badge-suspended { background: #fee2e2; color: #dc2626; }
    .badge-free { background: #dbeafe; color: #2563eb; }
    .badge-default { background: #f1f5f9; color: #64748b; }
    .badge-paid { background: #dcfce7; color: #16a34a; }
    .badge-pending { background: #fef3c7; color: #d97706; }

    .loading-state, .empty-state {
      display: flex; flex-direction: column;
      align-items: center; padding: 80px 40px; gap: 12px; color: #94a3b8;
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

    .badge-warn { background: #fff7ed; color: #c2410c; border: 1px solid #fdba74; padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 4px; display: inline-block; }
    .badge-danger { background: #fef2f2; color: #b91c1c; border: 1px solid #fca5a5; padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 4px; display: inline-block; }

    .score-cell { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .tier-pill { display: inline-flex; align-items: center; gap: 3px; padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; cursor: help; }
    .cons-pill { display: inline-flex; align-items: center; padding: 3px 6px; border-radius: 999px; font-size: 12px; cursor: help; }
    .empty-tier { color: #cbd5e1; font-size: 13px; }

    .btn-survey {
      display: inline-flex; align-items: center; gap: 4px;
      background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe;
      border-radius: 8px; padding: 5px 10px; font-size: 11px; font-weight: 600;
      cursor: pointer; margin-top: 4px; transition: all 0.15s;
    }
    .btn-survey:hover:not(:disabled) { background: #dbeafe; border-color: #3b82f6; }
    .btn-survey:disabled { opacity: 0.5; cursor: wait; }
  `]
})
export class ClientsComponent implements OnInit, OnDestroy {
  private api = inject(WisphubService);
  private db = inject(LocalDbService);
  private exportSvc = inject(ExportService);
  private actions = inject(ClientActionsService);
  private survey = inject(SurveyService);
  private toast = inject(ToastService);
  metrics = inject(MetricsService);

  surveyLoading = signal<number | null>(null);

  private destroy$ = new Subject<void>();

  // Re-export para usar en el template
  tierStyle = tierStyle;
  consStyle = consStyle;

  allClients = signal<WispHubClient[]>([]);
  filteredClients = signal<WispHubClient[]>([]);
  allPlans = signal<string[]>([]);
  loading = signal(true);
  syncing = signal(false);
  syncMessage = signal('');
  crmActions = signal<Map<number, string>>(new Map());
  searchTerm = '';
  statusFilter = '';
  planFilter = '';
  tierFilter = '';
  sortCol = '';
  sortDir: 'asc' | 'desc' = 'asc';

  async ngOnInit() {
    await this.loadLocal();
    this.loadCrmStates();
    this.metrics.startAutoRefresh(30000);
  }

  ngOnDestroy() {
    this.metrics.stopAutoRefresh();
    this.destroy$.next();
    this.destroy$.complete();
  }

  getMetric(idServicio: number): ClientMetric | null {
    return this.metrics.get(idServicio);
  }

  loadCrmStates() {
    this.actions.states().pipe(takeUntil(this.destroy$)).subscribe({
      next: (rows) => {
        const map = new Map<number, string>();
        for (const r of rows) if (r.crmAction) map.set(r.idServicio, r.crmAction);
        this.crmActions.set(map);
      },
      error: () => {},
    });
  }

  crmActionFor(id: number): string | null {
    return this.crmActions().get(id) ?? null;
  }

  crmActionLabel(id: number): { text: string; color: string } | null {
    const a = this.crmActionFor(id);
    if (a === 'block') return { text: 'BLOQUEADO', color: 'danger' };
    if (a === 'moroso') return { text: 'MOROSO', color: 'warn' };
    return null;
  }

  onActionChanged(ev: { action: string; result: any }, id: number) {
    const map = new Map(this.crmActions());
    if (ev.action === 'clear') map.delete(id);
    else map.set(id, ev.action);
    this.crmActions.set(map);
  }

  enviarEncuesta(c: WispHubClient) {
    const ip = c.ip;
    if (!ip) {
      this.toast.error('Cliente sin IP asignada');
      return;
    }
    const confirmMsg = `Activar encuesta para ${c.nombre} (${ip})?\n\nCuando el cliente abra cualquier sitio HTTP, se le mostrara el formulario para que llene nombre y telefono.`;
    if (!confirm(confirmMsg)) return;
    this.surveyLoading.set(c.id_servicio);
    this.survey.start(ip, c.id_servicio).subscribe({
      next: (r) => {
        this.surveyLoading.set(null);
        if (r.alreadyPending) {
          this.toast.info('Ya hay una encuesta pendiente para este cliente');
        } else if (r.ok) {
          this.toast.success(`Encuesta activada para ${c.nombre}. Espera a que abra un sitio web.`);
        } else {
          this.toast.error(r.error || 'No se pudo activar la encuesta');
        }
      },
      error: (e) => {
        this.surveyLoading.set(null);
        this.toast.error(e.error?.error || e.message || 'Error al activar encuesta');
      },
    });
  }

  async loadLocal() {
    this.loading.set(true);
    const clients = await this.db.getClients();
    this.allClients.set(clients);
    const plans = [...new Set(clients.map(c => c.plan_internet?.nombre).filter(Boolean))].sort();
    this.allPlans.set(plans as string[]);
    this.filterClients();
    this.loading.set(false);
  }

  filterClients() {
    let result = this.allClients();
    const term = this.searchTerm.toLowerCase().trim();

    if (term) {
      result = result.filter(c =>
        c.nombre?.toLowerCase().includes(term) ||
        c.ip?.includes(term) ||
        c.telefono?.includes(term) ||
        c.usuario?.toLowerCase().includes(term) ||
        c.cedula?.toLowerCase().includes(term) ||
        c.email?.toLowerCase().includes(term) ||
        c.direccion?.toLowerCase().includes(term) ||
        c.plan_internet?.nombre?.toLowerCase().includes(term) ||
        c.mac_cpe?.toLowerCase().includes(term)
      );
    }

    if (this.statusFilter) {
      result = result.filter(c => c.estado?.toLowerCase() === this.statusFilter);
    }

    if (this.planFilter) {
      result = result.filter(c => c.plan_internet?.nombre === this.planFilter);
    }

    if (this.tierFilter) {
      result = result.filter(c => this.getMetric(c.id_servicio)?.creditTier === this.tierFilter);
    }

    if (this.sortCol) {
      result = [...result].sort((a, b) => {
        let valA: any, valB: any;
        if (this.sortCol === 'creditScore') {
          // Sort especial: usa el score del MetricsService
          valA = this.getMetric(a.id_servicio)?.creditScore ?? -1;
          valB = this.getMetric(b.id_servicio)?.creditScore ?? -1;
        } else {
          valA = this.getNestedVal(a, this.sortCol);
          valB = this.getNestedVal(b, this.sortCol);
        }
        const cmp = this.compareVals(valA, valB);
        return this.sortDir === 'asc' ? cmp : -cmp;
      });
    }

    this.filteredClients.set(result);
  }

  sort(col: string) {
    if (this.sortCol === col) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortCol = col;
      this.sortDir = 'asc';
    }
    this.filterClients();
  }

  sortIcon(col: string): string {
    if (this.sortCol !== col) return '';
    return this.sortDir === 'asc' ? '\u25B2' : '\u25BC';
  }

  private getNestedVal(obj: any, path: string): any {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }

  private compareVals(a: any, b: any): number {
    if (a == null) return 1;
    if (b == null) return -1;
    const numA = parseFloat(a), numB = parseFloat(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a).localeCompare(String(b), 'es');
  }

  syncClients() {
    this.syncing.set(true);
    this.syncMessage.set('Cargando todos los clientes desde WispHub...');

    this.api.getAllClients().subscribe({
      next: async (clients) => {
        await this.db.saveClients(clients);
        await this.db.updateSyncLog('clients');
        this.syncing.set(false);
        await this.loadLocal();
      },
      error: (err) => {
        this.syncMessage.set('Error: ' + (err.error?.detail || 'Sin conexion'));
        setTimeout(() => this.syncing.set(false), 3000);
      }
    });
  }

  getInitials(nombre: string): string {
    if (!nombre) return '?';
    const parts = nombre.trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
  }

  exportCSV() {
    this.exportSvc.exportCSV(this.filteredClients(), 'clientes', [
      { key: 'id_servicio', label: 'ID' },
      { key: 'nombre', label: 'Nombre' },
      { key: 'telefono', label: 'Telefono' },
      { key: 'email', label: 'Email' },
      { key: 'cedula', label: 'Cedula' },
      { key: 'direccion', label: 'Direccion' },
      { key: 'plan_internet.nombre', label: 'Plan Internet' },
      { key: 'precio_plan', label: 'Precio' },
      { key: 'ip', label: 'IP' },
      { key: 'mac_cpe', label: 'MAC' },
      { key: 'estado', label: 'Estado' },
      { key: 'estado_facturas', label: 'Estado Facturas' },
      { key: 'zona.nombre', label: 'Zona' },
      { key: 'fecha_instalacion', label: 'Fecha Instalacion' },
      { key: 'fecha_corte', label: 'Fecha Corte' },
    ]);
  }

  getStatusClass(estado: string): string {
    const s = estado?.toLowerCase();
    if (s === 'activo') return 'active';
    if (s === 'suspendido' || s === 'cortado' || s === 'retirado') return 'suspended';
    if (s === 'gratis') return 'free';
    return 'default';
  }

  getFacturaClass(estado: string): string {
    const s = estado?.toLowerCase();
    if (s === 'pagadas' || s === 'pagada') return 'paid';
    if (s?.includes('pendiente')) return 'pending';
    return 'default';
  }
}
