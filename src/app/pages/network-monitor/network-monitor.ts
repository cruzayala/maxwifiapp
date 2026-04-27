import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { LocalDbService } from '../../services/local-db.service';
import { WisphubService } from '../../services/wisphub.service';
import { WispHubClient } from '../../models/client.model';
import { ToastService } from '../../services/toast.service';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

interface ClientPing {
  client: WispHubClient;
  status: 'idle' | 'pinging' | 'online' | 'offline' | 'error';
  taskId?: string;
  result?: string;
  latency?: string;
}

@Component({
  selector: 'app-network-monitor',
  standalone: true,
  imports: [NavbarComponent, FormsModule, RouterLink],
  template: `
    <app-navbar pageTitle="Monitor de Red" />

    <div class="page">
      <div class="toolbar">
        <div class="stats-bar">
          <div class="stat-pill green">
            <span class="pill-dot online"></span>
            <span>{{ onlineCount() }} Online</span>
          </div>
          <div class="stat-pill red">
            <span class="pill-dot offline"></span>
            <span>{{ offlineCount() }} Offline</span>
          </div>
          <div class="stat-pill gray">
            <span>{{ totalCount() }} Total</span>
          </div>
          @if (scanning()) {
            <div class="stat-pill blue">
              <div class="mini-spinner"></div>
              <span>Escaneando {{ scanProgress() }}/{{ totalCount() }}</span>
            </div>
          }
        </div>
        <div class="toolbar-right">
          <input type="text" placeholder="Filtrar..." [(ngModel)]="filterTerm" (input)="applyFilter()" class="filter-input" />
          <select [(ngModel)]="statusFilter" (change)="applyFilter()" class="filter-select">
            <option value="">Todos</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="idle">Sin escanear</option>
          </select>
          <button class="btn btn-primary" (click)="scanAll()" [disabled]="scanning()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            {{ scanning() ? 'Escaneando...' : 'Escanear Todo' }}
          </button>
        </div>
      </div>

      <div class="grid">
        @for (cp of filteredClients(); track cp.client.id_servicio) {
          <div class="client-tile" [class]="'tile-' + cp.status">
            <div class="tile-header">
              <span class="tile-dot" [class]="'dot-' + cp.status"></span>
              <a [routerLink]="['/clients', cp.client.id_servicio]" class="tile-name">{{ cp.client.nombre }}</a>
            </div>
            <div class="tile-ip">{{ cp.client.ip }}</div>
            <div class="tile-plan">{{ cp.client.plan_internet?.nombre || '-' }}</div>
            <div class="tile-footer">
              <span class="tile-status">{{ getStatusLabel(cp.status) }}</span>
              @if (cp.status === 'idle') {
                <button class="ping-btn" (click)="pingOne(cp)">Ping</button>
              }
              @if (cp.status === 'pinging') {
                <div class="mini-spinner"></div>
              }
            </div>
          </div>
        }
      </div>

      @if (filteredClients().length === 0 && allPings().length === 0) {
        <div class="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          <h3>Monitor de Red</h3>
          <p>Sincroniza clientes primero, luego presiona "Escanear Todo" para ver el estado de la red</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px 32px; }

    .toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; gap: 12px; flex-wrap: wrap; }
    .stats-bar { display: flex; gap: 8px; flex-wrap: wrap; }
    .stat-pill { display: flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; }
    .stat-pill.green { background: #f0fdf4; color: #16a34a; }
    .stat-pill.red { background: #fef2f2; color: #ef4444; }
    .stat-pill.gray { background: #f1f5f9; color: #64748b; }
    .stat-pill.blue { background: #eff6ff; color: #3b82f6; }

    .pill-dot { width: 8px; height: 8px; border-radius: 50%; }
    .pill-dot.online { background: #22c55e; animation: pulse 1.5s infinite; }
    .pill-dot.offline { background: #ef4444; }

    .toolbar-right { display: flex; gap: 8px; align-items: center; }
    .filter-input { padding: 8px 14px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; outline: none; width: 160px; }
    .filter-input:focus { border-color: #6366f1; }
    .filter-select { padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; background: white; }
    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 8px 18px; border-radius: 10px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: all 0.2s; }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }

    .client-tile {
      background: white; border: 1px solid #e2e8f0; border-radius: 12px;
      padding: 14px; transition: all 0.2s; border-left: 4px solid #e2e8f0;
    }
    .tile-online { border-left-color: #22c55e; }
    .tile-offline { border-left-color: #ef4444; }
    .tile-pinging { border-left-color: #3b82f6; }
    .tile-error { border-left-color: #f59e0b; }

    .tile-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .tile-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .dot-idle { background: #cbd5e1; }
    .dot-pinging { background: #3b82f6; animation: pulse 0.8s infinite; }
    .dot-online { background: #22c55e; }
    .dot-offline { background: #ef4444; }
    .dot-error { background: #f59e0b; }

    .tile-name { font-size: 14px; font-weight: 600; color: #0f172a; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tile-name:hover { color: #6366f1; }
    .tile-ip { font-size: 12px; font-family: 'Courier New', monospace; color: #6366f1; font-weight: 500; }
    .tile-plan { font-size: 11px; color: #94a3b8; margin-bottom: 6px; }
    .tile-footer { display: flex; align-items: center; justify-content: space-between; }
    .tile-status { font-size: 11px; font-weight: 600; color: #64748b; }

    .ping-btn { padding: 3px 10px; border: 1px solid #e2e8f0; border-radius: 6px; background: white; font-size: 11px; color: #6366f1; cursor: pointer; font-weight: 500; }
    .ping-btn:hover { background: #6366f1; color: white; }

    .mini-spinner { width: 14px; height: 14px; border: 2px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; }

    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    @keyframes spin { to { transform: rotate(360deg); } }

    .empty-state { display: flex; flex-direction: column; align-items: center; padding: 80px; gap: 12px; color: #94a3b8; }
    .empty-state h3 { color: #475569; margin: 8px 0 0; }
  `]
})
export class NetworkMonitorComponent implements OnInit, OnDestroy {
  private db = inject(LocalDbService);
  private api = inject(WisphubService);
  private toast = inject(ToastService);

  allPings = signal<ClientPing[]>([]);
  filteredClients = signal<ClientPing[]>([]);
  onlineCount = signal(0);
  offlineCount = signal(0);
  totalCount = signal(0);
  scanning = signal(false);
  scanProgress = signal(0);
  filterTerm = '';
  statusFilter = '';
  private pollInterval: any;

  async ngOnInit() {
    const clients = await this.db.getClients();
    const activeClients = clients.filter(c => c.estado?.toLowerCase() === 'activo' && c.ip);
    const pings: ClientPing[] = activeClients.map(c => ({ client: c, status: 'idle' as const }));
    this.allPings.set(pings);
    this.totalCount.set(pings.length);
    this.applyFilter();
  }

  ngOnDestroy() {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  applyFilter() {
    let result = this.allPings();
    const term = this.filterTerm.toLowerCase();
    if (term) {
      result = result.filter(p =>
        p.client.nombre?.toLowerCase().includes(term) ||
        p.client.ip?.includes(term)
      );
    }
    if (this.statusFilter) {
      result = result.filter(p => p.status === this.statusFilter);
    }
    this.filteredClients.set(result);
  }

  pingOne(cp: ClientPing) {
    cp.status = 'pinging';
    this.applyFilter();

    this.api.pingClient(cp.client.id_servicio).subscribe({
      next: (res) => {
        if (res.task_id) {
          cp.taskId = res.task_id;
          this.pollTask(cp);
        }
      },
      error: () => {
        cp.status = 'error';
        this.updateCounts();
      }
    });
  }

  private pollTask(cp: ClientPing) {
    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      if (attempts > 12) { // 12 * 2.5s = 30s max
        clearInterval(check);
        cp.status = 'error';
        this.updateCounts();
        return;
      }

      fetch(`/api/tasks/${cp.taskId}/`, {
        headers: { 'Authorization': `Api-Key ${(window as any).__env__?.apiKey || ''}` }
      }).catch(() => null);

      // Use the Angular HTTP client instead
      this.api.getTaskStatus(cp.taskId!).subscribe({
        next: (res: any) => {
          if (res.task?.status === 'SUCCESS') {
            clearInterval(check);
            const result = res.task.result;
            const exitoso = result?.find?.((r: any) => r['ping-exitoso']);
            if (exitoso) {
              const [ok, total] = exitoso['ping-exitoso'].split(' de ');
              cp.status = parseInt(ok) > 0 ? 'online' : 'offline';
              cp.result = exitoso['ping-exitoso'];
            } else {
              cp.status = 'online'; // Si no hay ping-exitoso, asumir OK
            }
            this.updateCounts();
          } else if (res.task?.status === 'FAILURE') {
            clearInterval(check);
            cp.status = 'error';
            this.updateCounts();
          }
        },
        error: () => {} // Keep polling
      });
    }, 2500);
  }

  scanAll() {
    this.scanning.set(true);
    this.scanProgress.set(0);
    this.toast.info('Escaneando red...');

    const pings = this.allPings();
    let idx = 0;

    const next = () => {
      if (idx >= pings.length) {
        this.scanning.set(false);
        this.toast.success(`Escaneo completo: ${this.onlineCount()} online, ${this.offlineCount()} offline`);
        return;
      }

      const cp = pings[idx];
      cp.status = 'pinging';
      this.scanProgress.set(idx + 1);
      this.applyFilter();

      this.api.pingClient(cp.client.id_servicio).subscribe({
        next: (res) => {
          if (res.task_id) {
            cp.taskId = res.task_id;
            this.pollTask(cp);
          }
          idx++;
          // Delay between pings to not overwhelm the router
          setTimeout(next, 1500);
        },
        error: () => {
          cp.status = 'error';
          idx++;
          setTimeout(next, 500);
        }
      });
    };

    next();
  }

  private updateCounts() {
    const all = this.allPings();
    this.onlineCount.set(all.filter(p => p.status === 'online').length);
    this.offlineCount.set(all.filter(p => p.status === 'offline' || p.status === 'error').length);
    this.applyFilter();
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'online': return 'Online';
      case 'offline': return 'Offline';
      case 'pinging': return 'Ping...';
      case 'error': return 'Error';
      default: return 'Sin escanear';
    }
  }
}
