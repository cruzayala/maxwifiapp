import { Component, OnInit, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { WisphubService } from '../../services/wisphub.service';
import { LocalDbService } from '../../services/local-db.service';
import { WispHubClient } from '../../models/client.model';
import { Invoice } from '../../models/invoice.model';
import { RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { SyncService } from '../../services/sync.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [NavbarComponent, RouterLink, DecimalPipe],
  template: `
    <app-navbar pageTitle="Dashboard" />

    <div class="dashboard">
      <!-- STATS -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon blue"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
          <div class="stat-info"><span class="stat-value">{{ totalClients() }}</span><span class="stat-label">Clientes</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
          <div class="stat-info"><span class="stat-value">{{ activeClients() }}</span><span class="stat-label">Activos</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon red"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
          <div class="stat-info"><span class="stat-value">{{ suspendedClients() }}</span><span class="stat-label">Suspendidos</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon purple"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></div>
          <div class="stat-info"><span class="stat-value">RD$ {{ monthlyRevenue() | number:'1.0-0' }}</span><span class="stat-label">Ingreso Mensual Est.</span></div>
        </div>
      </div>

      <div class="content-grid">
        <!-- GRAFICA CLIENTES POR PLAN -->
        <div class="card">
          <div class="card-header"><h3>Clientes por Plan</h3></div>
          <div class="card-body">
            @for (plan of topPlans(); track plan.name) {
              <div class="bar-row">
                <span class="bar-label">{{ plan.name }}</span>
                <div class="bar-track">
                  <div class="bar-fill" [style.width.%]="plan.pct" [style.background]="plan.color"></div>
                </div>
                <span class="bar-count">{{ plan.count }}</span>
              </div>
            }
          </div>
        </div>

        <!-- RESUMEN FINANCIERO -->
        <div class="card">
          <div class="card-header"><h3>Resumen Financiero</h3></div>
          <div class="card-body">
            <div class="finance-row">
              <span>Total Facturado</span>
              <span class="finance-val">RD$ {{ totalFacturado() | number:'1.2-2' }}</span>
            </div>
            <div class="finance-row">
              <span>Total Cobrado</span>
              <span class="finance-val green">RD$ {{ totalCobrado() | number:'1.2-2' }}</span>
            </div>
            <div class="finance-row">
              <span>Pendiente por Cobrar</span>
              <span class="finance-val red">RD$ {{ totalPendiente() | number:'1.2-2' }}</span>
            </div>
            <div class="finance-row">
              <span>Facturas Pagadas</span>
              <span class="finance-val">{{ countPagadas() }}</span>
            </div>
            <div class="finance-row">
              <span>Facturas Pendientes</span>
              <span class="finance-val red">{{ countPendientes() }}</span>
            </div>
            <div class="divider"></div>
            <div class="finance-row big">
              <span>Tasa de Cobro</span>
              <span class="finance-val" [class.green]="cobroRate() >= 70" [class.red]="cobroRate() < 50">{{ cobroRate() | number:'1.1-1' }}%</span>
            </div>
          </div>
        </div>

        <!-- MOROSOS / PROXIMO CORTE -->
        <div class="card">
          <div class="card-header">
            <h3>Pendientes de Pago</h3>
            <span class="badge badge-warning">{{ pendientesList().length }}</span>
          </div>
          <div class="card-body list-body">
            @if (pendientesList().length === 0) {
              <div class="empty-mini">Todos los clientes estan al dia</div>
            } @else {
              @for (c of pendientesList().slice(0, 15); track c.id_servicio) {
                <a [routerLink]="['/clients', c.id_servicio]" class="list-item">
                  <div class="list-left">
                    <span class="list-name">{{ c.nombre }}</span>
                    <span class="list-sub">{{ c.plan_internet?.nombre }} - {{ c.telefono || 'Sin tel.' }}</span>
                  </div>
                  <div class="list-right">
                    <span class="list-price">RD$ {{ c.precio_plan }}</span>
                    <span class="list-date">Corte: {{ c.fecha_corte }}</span>
                  </div>
                </a>
              }
            }
          </div>
        </div>

        <!-- ACCIONES RAPIDAS -->
        <div class="card">
          <div class="card-header"><h3>Acciones</h3></div>
          <div class="card-body actions-grid">
            <button class="action-btn sync-btn" (click)="syncAll()">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
              <span>Sincronizar Todo</span>
            </button>
            <a routerLink="/clients" class="action-btn"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><span>Clientes</span></a>
            <a routerLink="/invoices" class="action-btn"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>Facturas</span></a>
            <a routerLink="/reports" class="action-btn"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><span>Reportes</span></a>
          </div>
        </div>
      </div>

      @if (lastSync()) {
        <div class="last-sync">Ultima sincronizacion: {{ lastSync() }}</div>
      }

      <div class="sync-bar" [class.visible]="syncing()">
        <div class="spinner small"></div>
        <span>{{ syncMessage() }}</span>
      </div>
    </div>
  `,
  styles: [`
    .dashboard { padding: 24px 32px; }

    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }

    .stat-card {
      background: white; border-radius: 14px; padding: 20px;
      display: flex; align-items: center; gap: 14px;
      border: 1px solid #e2e8f0; transition: transform 0.2s;
    }
    .stat-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.06); }

    .stat-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
    .stat-icon.blue { background: #eff6ff; color: #3b82f6; }
    .stat-icon.green { background: #f0fdf4; color: #22c55e; }
    .stat-icon.red { background: #fef2f2; color: #ef4444; }
    .stat-icon.purple { background: #faf5ff; color: #8b5cf6; }

    .stat-value { font-size: 24px; font-weight: 800; color: #0f172a; line-height: 1; }
    .stat-label { font-size: 12px; color: #64748b; margin-top: 2px; }
    .stat-info { display: flex; flex-direction: column; }

    .content-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

    .card { background: white; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; }
    .card-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px; border-bottom: 1px solid #f1f5f9;
    }
    .card-header h3 { font-size: 15px; font-weight: 600; color: #0f172a; margin: 0; }
    .card-body { padding: 16px 20px; }

    /* BARS CHART */
    .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .bar-label { font-size: 12px; color: #475569; width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bar-track { flex: 1; height: 22px; background: #f1f5f9; border-radius: 6px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 6px; transition: width 0.5s ease; min-width: 2px; }
    .bar-count { font-size: 13px; font-weight: 700; color: #0f172a; width: 30px; text-align: right; }

    /* FINANCE */
    .finance-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f8fafc; }
    .finance-row span:first-child { font-size: 13px; color: #64748b; }
    .finance-val { font-size: 14px; font-weight: 700; color: #0f172a; }
    .finance-val.green { color: #16a34a; }
    .finance-val.red { color: #ef4444; }
    .finance-row.big { padding-top: 12px; }
    .finance-row.big .finance-val { font-size: 20px; }
    .divider { height: 1px; background: #e2e8f0; margin: 8px 0; }

    /* LIST */
    .list-body { padding: 8px 20px; max-height: 350px; overflow-y: auto; }
    .list-item {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 0; border-bottom: 1px solid #f8fafc;
      text-decoration: none; color: inherit; transition: background 0.15s;
    }
    .list-item:hover { background: #f0f4ff; margin: 0 -20px; padding: 10px 20px; border-radius: 8px; }
    .list-name { display: block; font-size: 14px; font-weight: 500; color: #0f172a; }
    .list-sub { display: block; font-size: 11px; color: #94a3b8; margin-top: 2px; }
    .list-right { text-align: right; }
    .list-price { display: block; font-size: 14px; font-weight: 700; color: #ef4444; }
    .list-date { display: block; font-size: 11px; color: #94a3b8; }
    .empty-mini { padding: 20px; text-align: center; color: #94a3b8; font-size: 13px; }

    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .badge-warning { background: #fef3c7; color: #d97706; }

    /* ACTIONS */
    .actions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .action-btn {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 18px 10px; border: 1px solid #e2e8f0; border-radius: 12px;
      background: #f8fafc; cursor: pointer; text-decoration: none;
      color: #475569; font-size: 12px; font-weight: 500; transition: all 0.2s;
    }
    .action-btn:hover { background: #6366f1; color: white; border-color: #6366f1; transform: translateY(-2px); }
    .sync-btn { grid-column: 1 / -1; flex-direction: row; justify-content: center; gap: 10px; padding: 14px; }

    .last-sync { text-align: center; padding: 16px; font-size: 12px; color: #94a3b8; }

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

    @media (max-width: 1024px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .content-grid { grid-template-columns: 1fr; }
    }

    @media (max-width: 640px) {
      .dashboard { padding: 16px; }
      .stat-card { padding: 14px; }
      .stat-value { font-size: 20px; }
      .stat-icon { width: 36px; height: 36px; }
      .actions-grid { grid-template-columns: 1fr 1fr; }
      .bar-label { width: 80px; font-size: 11px; }
    }
  `]
})
export class DashboardComponent implements OnInit {
  private api = inject(WisphubService);
  private db = inject(LocalDbService);
  private syncSvc = inject(SyncService);

  totalClients = signal(0);
  activeClients = signal(0);
  suspendedClients = signal(0);
  monthlyRevenue = signal(0);
  totalFacturado = signal(0);
  totalCobrado = signal(0);
  totalPendiente = signal(0);
  countPagadas = signal(0);
  countPendientes = signal(0);
  cobroRate = signal(0);
  topPlans = signal<{ name: string; count: number; pct: number; color: string }[]>([]);
  pendientesList = signal<WispHubClient[]>([]);
  lastSync = signal('');
  loading = signal(true);
  syncing = signal(false);
  syncMessage = signal('');

  private colors = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b'];

  async ngOnInit() {
    await this.loadData();
  }

  async loadData() {
    this.loading.set(true);
    const clients = await this.db.getClients();
    const invoices = await this.db.getInvoices();

    // Stats
    this.totalClients.set(clients.length);
    this.activeClients.set(clients.filter(c => c.estado?.toLowerCase() === 'activo').length);
    this.suspendedClients.set(clients.filter(c => ['suspendido', 'cortado', 'retirado'].includes(c.estado?.toLowerCase())).length);
    this.monthlyRevenue.set(clients.reduce((s, c) => s + parseFloat(c.precio_plan || '0'), 0));

    // Finance
    this.totalFacturado.set(invoices.reduce((s, i) => s + (i.total || 0), 0));
    this.totalCobrado.set(invoices.reduce((s, i) => s + (i.total_cobrado || 0), 0));
    this.totalPendiente.set(invoices.reduce((s, i) => s + (i.saldo || 0), 0));
    this.countPagadas.set(invoices.filter(i => i.estado?.toLowerCase() === 'pagada').length);
    this.countPendientes.set(invoices.filter(i => i.estado?.toLowerCase() !== 'pagada').length);
    const total = this.totalFacturado();
    this.cobroRate.set(total > 0 ? (this.totalCobrado() / total) * 100 : 0);

    // Plans chart
    const planMap = new Map<string, number>();
    clients.forEach(c => {
      const name = c.plan_internet?.nombre || 'Sin plan';
      planMap.set(name, (planMap.get(name) || 0) + 1);
    });
    const sorted = [...planMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const max = sorted[0]?.[1] || 1;
    this.topPlans.set(sorted.map(([name, count], i) => ({
      name, count, pct: (count / max) * 100, color: this.colors[i % this.colors.length]
    })));

    // Morosos
    this.pendientesList.set(clients.filter(c => c.estado_facturas?.toLowerCase().includes('pendiente')));

    // Last sync
    const ls = await this.db.getLastSync('clients');
    if (ls) this.lastSync.set(new Date(ls).toLocaleString('es-DO'));

    this.loading.set(false);
  }

  syncAll() {
    this.syncSvc.syncAll();
    // Reload data when sync finishes
    const check = setInterval(async () => {
      if (!this.syncSvc.syncing()) {
        clearInterval(check);
        await this.loadData();
      }
    }, 500);
  }
}
