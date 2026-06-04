import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { MikrotikService, MtTraffic, MtConsumer, MtQueue } from '../../services/mikrotik.service';
import { ToastService } from '../../services/toast.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-mikrotik',
  standalone: true,
  imports: [NavbarComponent, FormsModule],
  template: `
    <app-navbar pageTitle="MikroTik" />

    <div class="page">
      <!-- STATUS BAR -->
      <div class="status-card" [class.connected]="status().connected">
        <div class="status-left">
          <div class="status-dot" [class.green]="status().connected" [class.red]="!status().connected"></div>
          <div>
            <strong>MikroTik {{ status().connected ? 'Conectado' : 'Desconectado' }}</strong>
            <div class="status-host">{{ status().host || 'No configurado' }}</div>
          </div>
        </div>
        @if (system()) {
          <div class="status-info">
            <span><strong>{{ system()!.resource['board-name'] }}</strong></span>
            <span>v{{ system()!.resource.version }}</span>
            <span>CPU {{ system()!.resource['cpu-load'] }}%</span>
            <span>Up {{ system()!.resource.uptime }}</span>
          </div>
        }
      </div>

      @if (status().error) {
        <div class="error-card">
          <strong>Error:</strong> {{ status().error }}
        </div>
      }

      @if (status().connected) {
        <!-- TABS -->
        <div class="tabs">
          <button [class.active]="activeTab() === 'top'" (click)="changeTab('top')">Top Consumers</button>
          <button [class.active]="activeTab() === 'traffic'" (click)="changeTab('traffic')">Interfaces</button>
          <button [class.active]="activeTab() === 'queues'" (click)="changeTab('queues')">Queues ({{ queues().length }})</button>
          <button [class.active]="activeTab() === 'sessions'" (click)="changeTab('sessions')">Sesiones</button>
          <button [class.active]="activeTab() === 'tools'" (click)="changeTab('tools')">Herramientas</button>
        </div>

        <!-- TOP CONSUMERS -->
        @if (activeTab() === 'top') {
          <div class="card">
            <div class="card-head">
              <h3>Top {{ consumers().length }} clientes que mas consumen</h3>
              <button class="btn-refresh" (click)="loadConsumers()">Refrescar</button>
            </div>
            <table class="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Cliente</th>
                  <th>IP</th>
                  <th>Plan</th>
                  <th>Subida</th>
                  <th>Descarga</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                @for (c of consumers(); track c.name; let idx = $index) {
                  <tr>
                    <td data-label="#" class="rank">{{ idx + 1 }}</td>
                    <td data-label="Cliente" class="bold">{{ c.name }}</td>
                    <td data-label="IP" class="mono">{{ c.target }}</td>
                    <td data-label="Plan">{{ formatLimit(c.maxLimit) }}</td>
                    <td data-label="Subida" class="mono">{{ formatBytes(c.uploadBytes) }}</td>
                    <td data-label="Descarga" class="mono">{{ formatBytes(c.downloadBytes) }}</td>
                    <td data-label="Total" class="mono total">{{ formatBytes(c.totalBytes) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <!-- TRAFFIC -->
        @if (activeTab() === 'traffic') {
          <div class="card">
            <div class="card-head">
              <h3>Trafico de Interfaces ({{ traffic().length }})</h3>
              <button class="btn-refresh" (click)="loadTraffic()">Refrescar</button>
            </div>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Interface</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>MAC</th>
                  <th>RX</th>
                  <th>TX</th>
                </tr>
              </thead>
              <tbody>
                @for (t of traffic(); track t.name) {
                  <tr>
                    <td data-label="Interface" class="bold">{{ t.name }}</td>
                    <td data-label="Tipo">{{ t.type }}</td>
                    <td data-label="Estado">
                      <span class="badge" [class]="t.running ? 'badge-up' : 'badge-down'">
                        {{ t.running ? 'UP' : 'DOWN' }}
                      </span>
                    </td>
                    <td data-label="MAC" class="mono small">{{ t.macAddress }}</td>
                    <td data-label="RX" class="mono">{{ formatBytes(t.rxBytes) }}</td>
                    <td data-label="TX" class="mono">{{ formatBytes(t.txBytes) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <!-- QUEUES -->
        @if (activeTab() === 'queues') {
          <div class="card">
            <div class="card-head">
              <h3>Simple Queues - Limites de banda por cliente</h3>
              <input type="text" placeholder="Buscar cliente..." [(ngModel)]="queueSearch" class="search-mini" />
            </div>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>IP Target</th>
                  <th>Limite</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                @for (q of filteredQueues(); track q.id) {
                  <tr>
                    <td data-label="Nombre" class="bold">{{ q.name }}</td>
                    <td data-label="IP" class="mono">{{ q.target }}</td>
                    <td data-label="Limite" class="bold">{{ formatLimit(q.maxLimit) }}</td>
                    <td data-label="Estado">
                      <span class="badge" [class]="q.disabled ? 'badge-disabled' : 'badge-active'">
                        {{ q.disabled ? 'Deshabilitada' : 'Activa' }}
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <!-- SESSIONS -->
        @if (activeTab() === 'sessions') {
          <div class="card">
            <h3>Sesiones Activas</h3>
            @if ((sessions()?.pppoe?.length ?? 0) === 0 && (sessions()?.hotspot?.length ?? 0) === 0) {
              <p class="empty">No hay sesiones PPPoE ni Hotspot activas</p>
            }
            @if (sessions()?.pppoe?.length) {
              <h4>PPPoE ({{ sessions()!.pppoe.length }})</h4>
              <table class="data-table">
                <thead><tr><th>Usuario</th><th>IP</th><th>Uptime</th></tr></thead>
                <tbody>
                  @for (p of sessions()!.pppoe; track p['.id']) {
                    <tr>
                      <td>{{ p.name }}</td>
                      <td class="mono">{{ p.address }}</td>
                      <td>{{ p.uptime }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        }

        <!-- TOOLS -->
        @if (activeTab() === 'tools') {
          <div class="card">
            <h3>Ping desde MikroTik</h3>
            <div class="ping-form">
              <input type="text" [(ngModel)]="pingTarget" placeholder="192.168.10.43 o google.com" class="form-input" />
              <button class="btn btn-primary" (click)="runPing()" [disabled]="pinging()">
                {{ pinging() ? 'Pingeando...' : 'Ping' }}
              </button>
            </div>
            @if (pingResult().length) {
              <div class="ping-result">
                @for (r of pingResult(); track $index) {
                  <div class="ping-line">
                    <span class="ping-host">{{ r.host || pingTarget }}</span>
                    @if (r['received'] !== undefined) {
                      <span>recv {{ r.received }} time {{ r.time }} TTL {{ r.ttl }}</span>
                    } @else {
                      <span>{{ r.status || 'timeout' }}</span>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      } @else {
        <div class="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
          <h3>MikroTik no conectado</h3>
          <p>Configura las credenciales en .env y reinicia el servidor</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px 32px; }

    .status-card {
      background: white; border: 1px solid #e2e8f0; border-radius: 14px;
      padding: 20px 24px; margin-bottom: 16px; display: flex;
      align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
    }
    .status-card.connected { border-left: 4px solid #22c55e; }
    .status-left { display: flex; align-items: center; gap: 14px; }
    .status-dot { width: 14px; height: 14px; border-radius: 50%; }
    .status-dot.green { background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,0.2); animation: pulse 2s infinite; }
    .status-dot.red { background: #ef4444; }
    @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.4); } 50% { box-shadow: 0 0 0 6px rgba(34,197,94,0); } }
    .status-host { font-size: 12px; color: #64748b; font-family: 'Courier New', monospace; }
    .status-info { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: #475569; }

    .error-card { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 12px 16px; border-radius: 10px; margin-bottom: 16px; }

    .tabs {
      display: flex; gap: 4px; margin-bottom: 16px;
      background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 4px; overflow-x: auto;
    }
    .tabs button {
      padding: 10px 16px; border: none; background: none;
      color: #64748b; font-size: 13px; font-weight: 500; cursor: pointer;
      border-radius: 8px; transition: all 0.2s; white-space: nowrap;
    }
    .tabs button:hover { background: #f1f5f9; }
    .tabs button.active { background: #6366f1; color: white; }

    .card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; }
    .card-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #f1f5f9; flex-wrap: wrap; gap: 12px; }
    .card h3 { margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; }
    .card h4 { margin: 16px 0 8px; padding: 0 20px; font-size: 14px; color: #475569; }

    .btn-refresh { padding: 6px 14px; border: 1px solid #e2e8f0; border-radius: 8px; background: white; font-size: 12px; color: #6366f1; cursor: pointer; font-weight: 500; }
    .btn-refresh:hover { background: #6366f1; color: white; border-color: #6366f1; }

    .search-mini { padding: 6px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; outline: none; width: 200px; }
    .search-mini:focus { border-color: #6366f1; }

    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th { text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; padding: 10px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .data-table td { padding: 10px 16px; font-size: 13px; color: #334155; border-bottom: 1px solid #f1f5f9; }
    .rank { font-weight: 800; color: #6366f1; }
    .bold { font-weight: 600; color: #0f172a; }
    .mono { font-family: 'Courier New', monospace; font-size: 12px; }
    .small { font-size: 11px; }
    .total { color: #6366f1; font-weight: 700; }

    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
    .badge-up { background: #dcfce7; color: #16a34a; }
    .badge-down { background: #fee2e2; color: #dc2626; }
    .badge-active { background: #dcfce7; color: #16a34a; }
    .badge-disabled { background: #f1f5f9; color: #64748b; }

    .ping-form { display: flex; gap: 8px; margin-bottom: 12px; padding: 16px 20px; }
    .form-input { flex: 1; padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; outline: none; }
    .form-input:focus { border-color: #6366f1; }
    .btn { padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-primary:disabled { opacity: 0.6; }

    .ping-result { padding: 0 20px 16px; font-family: 'Courier New', monospace; font-size: 12px; background: #0f172a; color: #4ade80; padding: 12px 20px; }
    .ping-line { padding: 2px 0; }
    .ping-host { color: #60a5fa; }

    .empty { text-align: center; color: #94a3b8; padding: 30px; }
    .empty-state { display: flex; flex-direction: column; align-items: center; padding: 60px; gap: 12px; }
    .empty-state h3 { color: #475569; margin: 0; }
    .empty-state p { color: #94a3b8; margin: 0; }
  `]
})
export class MikrotikComponent implements OnInit, OnDestroy {
  private mt = inject(MikrotikService);
  private toast = inject(ToastService);

  status = signal<any>({ configured: false, connected: false, host: '' });
  system = signal<any>(null);
  traffic = signal<MtTraffic[]>([]);
  queues = signal<MtQueue[]>([]);
  consumers = signal<MtConsumer[]>([]);
  sessions = signal<{ pppoe: any[]; hotspot: any[] } | null>(null);
  pingResult = signal<any[]>([]);

  activeTab = signal<'top' | 'traffic' | 'queues' | 'sessions' | 'tools'>('top');

  changeTab(tab: 'top' | 'traffic' | 'queues' | 'sessions' | 'tools') {
    this.activeTab.set(tab);
    if (tab === 'traffic' && this.traffic().length === 0) this.loadTraffic();
    if (tab === 'queues' && this.queues().length === 0) this.loadQueues();
    if (tab === 'sessions' && !this.sessions()) this.loadSessions();
  }
  queueSearch = '';
  pingTarget = '';
  pinging = signal(false);

  private refreshInterval: any;

  async ngOnInit() {
    await this.refresh();
    // Auto-refresh every 30s
    this.refreshInterval = setInterval(() => this.refresh(), 30000);
  }

  ngOnDestroy() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  async refresh() {
    this.mt.getStatus().subscribe({
      next: (s) => {
        this.status.set(s);
        if (s.connected) {
          this.loadSystem();
          this.loadConsumers();
        }
      }
    });
  }

  loadSystem() {
    this.mt.getSystem().subscribe({ next: s => this.system.set(s) });
  }

  loadTraffic() {
    this.mt.getTraffic().subscribe({ next: t => this.traffic.set(t) });
  }

  loadQueues() {
    this.mt.getQueues().subscribe({ next: q => this.queues.set(q) });
  }

  loadConsumers() {
    this.mt.getTopConsumers(20).subscribe({ next: c => this.consumers.set(c) });
  }

  loadSessions() {
    this.mt.getActiveSessions().subscribe({ next: s => this.sessions.set(s) });
  }

  filteredQueues(): MtQueue[] {
    const term = this.queueSearch.toLowerCase();
    if (!term) return this.queues();
    return this.queues().filter(q =>
      q.name?.toLowerCase().includes(term) ||
      q.target?.includes(term)
    );
  }

  runPing() {
    if (!this.pingTarget) return;
    this.pinging.set(true);
    this.pingResult.set([]);
    this.mt.ping(this.pingTarget, 4).subscribe({
      next: (r) => { this.pingResult.set(r); this.pinging.set(false); },
      error: (e) => { this.toast.error('Error: ' + (e.error?.error || 'falló')); this.pinging.set(false); }
    });
  }

  formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  formatLimit(limit: string): string {
    if (!limit) return '-';
    // Format "4300000/4300000" → "4.3M / 4.3M"
    const parts = limit.split('/');
    return parts.map(p => {
      const n = parseInt(p);
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
      return p;
    }).join(' / ');
  }
}
