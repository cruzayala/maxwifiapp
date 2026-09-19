import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideActivity, LucideSearch, LucideWifiOff } from '@lucide/angular';
import { WispHubClient } from '../../models/client.model';
import { PlanLabelPipe } from '../../pipes/plan-label.pipe';
import { LocalDbService } from '../../services/local-db.service';
import { ToastService } from '../../services/toast.service';
import { WisphubService } from '../../services/wisphub.service';

interface ClientPing {
  client: WispHubClient;
  status: 'idle' | 'pinging' | 'online' | 'offline' | 'error';
  taskId?: string;
  result?: string;
}

/**
 * Prueba de ping manual vía WispHub (antes era toda la página "Estado de red").
 * Misma lógica que antes; ahora se detiene al salir de la pantalla.
 */
@Component({
  selector: 'app-ping-tool',
  standalone: true,
  imports: [FormsModule, RouterLink, PlanLabelPipe, LucideActivity, LucideSearch, LucideWifiOff],
  template: `
    <p class="intro">
      Hace ping desde WispHub a los clientes activos que tienen IP. El escaneo completo va de uno en uno para no
      cargar el router (unos {{ scanMinutes() }} min). Para saber quién está en línea al instante use el resumen de arriba,
      que se basa en el tráfico real del MikroTik.
    </p>

    <div class="toolbar">
      <div class="stats-bar" aria-live="polite">
        <div class="stat-pill green" title="Clientes que respondieron al ping"><span class="pill-dot online"></span><span><strong>{{ onlineCount() }}</strong> responden</span></div>
        <div class="stat-pill red" title="Clientes que no respondieron o no se pudieron verificar"><span class="pill-dot offline"></span><span><strong>{{ offlineCount() }}</strong> sin respuesta</span></div>
        <div class="stat-pill gray"><span><strong>{{ totalCount() }}</strong> clientes con IP</span></div>
        @if (scanning()) {
          <div class="stat-pill blue"><div class="mini-spinner"></div><span>Escaneando {{ scanProgress() }} de {{ totalCount() }}</span></div>
        }
      </div>
      <div class="toolbar-right">
        <label class="search-box">
          <svg lucideSearch size="16" aria-hidden="true"></svg>
          <input type="search" placeholder="Buscar nombre o IP" [(ngModel)]="filterTerm" (input)="applyFilter()" aria-label="Buscar cliente por nombre o IP" />
        </label>
        <select [(ngModel)]="statusFilter" (change)="applyFilter()" class="filter-select" aria-label="Filtrar por resultado">
          <option value="">Todos</option>
          <option value="online">Responden</option>
          <option value="offline">Sin respuesta</option>
          <option value="idle">Sin escanear</option>
        </select>
        <button class="btn btn-primary" (click)="scanAll()" [disabled]="scanning() || totalCount() === 0"
          [title]="totalCount() === 0 ? 'No hay clientes con IP para escanear' : 'Hace ping a todos los clientes, uno por uno'">
          <svg lucideActivity size="16" aria-hidden="true"></svg>
          {{ scanning() ? 'Escaneando…' : 'Escanear todos' }}
        </button>
      </div>
    </div>

    @if (scanning()) {
      <div class="scan-progress" role="progressbar" [attr.aria-valuenow]="scanProgress()" aria-valuemin="0" [attr.aria-valuemax]="totalCount()">
        <i [style.width.%]="totalCount() ? (scanProgress() / totalCount()) * 100 : 0"></i>
      </div>
    }

    @if (loading()) {
      <div class="grid" aria-busy="true" aria-label="Cargando clientes">
        @for (n of [1,2,3,4]; track n) { <div class="client-tile skeleton"></div> }
      </div>
    } @else if (allPings().length === 0) {
      <div class="empty-state">
        <svg lucideWifiOff size="40" aria-hidden="true"></svg>
        <h3>No hay clientes activos con IP</h3>
        <p>Sincronice los clientes desde la pantalla principal («Sincronizar ahora») y vuelva aquí.</p>
      </div>
    } @else if (filteredClients().length === 0) {
      <div class="empty-state">
        <svg lucideSearch size="36" aria-hidden="true"></svg>
        <h3>Ningún cliente coincide</h3>
        <p>Cambie la búsqueda o el filtro de resultado.</p>
        <button class="btn btn-outline" type="button" (click)="clearFilter()">Ver todos</button>
      </div>
    } @else {
      <div class="grid">
        @for (cp of filteredClients(); track cp.client.id_servicio) {
          <div class="client-tile" [class]="'client-tile tile-' + cp.status">
            <div class="tile-header">
              <span class="tile-dot" [class]="'tile-dot dot-' + cp.status" aria-hidden="true"></span>
              <a [routerLink]="['/clients', cp.client.id_servicio]" class="tile-name" [title]="cp.client.nombre">{{ cp.client.nombre }}</a>
            </div>
            <div class="tile-ip">{{ cp.client.ip }}</div>
            <div class="tile-plan">{{ cp.client.plan_internet?.nombre | planLabel }}</div>
            <div class="tile-footer">
              <span class="tile-status" [class]="'tile-status st-' + cp.status">
                {{ getStatusLabel(cp.status) }}@if (cp.result && (cp.status === 'online' || cp.status === 'offline')) { <small> · {{ cp.result }}</small> }
              </span>
              @if (cp.status === 'pinging') {
                <div class="mini-spinner" aria-label="Haciendo ping"></div>
              } @else if (!scanning()) {
                <button class="ping-btn" type="button" (click)="pingOne(cp)" [attr.aria-label]="'Hacer ping a ' + cp.client.nombre">{{ cp.status === 'idle' ? 'Ping' : 'Repetir' }}</button>
              }
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .intro { margin: 0 0 14px; max-width: 820px; color: #667582; font-size: 13px; line-height: 1.5; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; gap: 12px; flex-wrap: wrap; }
    .stats-bar { display: flex; gap: 8px; flex-wrap: wrap; }
    .stat-pill { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; border: 1px solid transparent; }
    .stat-pill strong { font-weight: 800; }
    .stat-pill.green { background: #e9f8f1; color: #13875a; border-color: #c7ebd9; }
    .stat-pill.red { background: #fff0ef; color: #b42318; border-color: #f6cfcb; }
    .stat-pill.gray { background: #fff; color: #667582; border-color: #dfe5ea; }
    .stat-pill.blue { background: #edf4ff; color: #1267dd; border-color: #cfe0f8; }
    .pill-dot { width: 8px; height: 8px; border-radius: 50%; }
    .pill-dot.online { background: #13875a; }
    .pill-dot.offline { background: #b42318; }
    .toolbar-right { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .search-box { display: flex; align-items: center; gap: 7px; height: 38px; padding: 0 11px; border: 1px solid #ccd6de; border-radius: 6px; background: #fff; color: #667582; }
    .search-box:focus-within { border-color: #1267dd; box-shadow: 0 0 0 2px #edf4ff; }
    .search-box input { width: 170px; border: 0; outline: 0; font-size: 13px; color: #172535; background: transparent; }
    .filter-select { height: 38px; padding: 0 10px; border: 1px solid #ccd6de; border-radius: 6px; font-size: 13px; background: white; color: #334250; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 38px; padding: 0 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
    .btn-primary { background: #1267dd; color: white; }
    .btn-primary:hover:not(:disabled) { background: #0d58c0; }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-outline { background: #fff; color: #1267dd; border-color: #b9cdea; }
    .scan-progress { height: 4px; margin-bottom: 14px; background: #e6ebf0; border-radius: 2px; overflow: hidden; }
    .scan-progress i { display: block; height: 100%; background: #1267dd; transition: width .3s; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
    .client-tile { min-width: 0; background: white; border: 1px solid #dfe5ea; border-radius: 8px; padding: 12px 14px; border-left: 4px solid #ccd6de; }
    .client-tile.skeleton { height: 96px; background: linear-gradient(90deg, #eef1f4 25%, #f7f9fa 50%, #eef1f4 75%); background-size: 220% 100%; animation: shimmer 1.3s infinite; }
    .tile-online { border-left-color: #13875a; } .tile-offline { border-left-color: #b42318; } .tile-pinging { border-left-color: #1267dd; } .tile-error { border-left-color: #b36b12; }
    .tile-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; min-width: 0; }
    .tile-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .dot-idle { background: #ccd6de; } .dot-pinging { background: #1267dd; animation: pulse 0.8s infinite; } .dot-online { background: #13875a; } .dot-offline { background: #b42318; } .dot-error { background: #b36b12; }
    .tile-name { min-width: 0; font-size: 13px; font-weight: 650; color: #172535; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tile-name:hover { color: #1267dd; text-decoration: underline; }
    .tile-ip { font-size: 12px; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; color: #334250; }
    .tile-plan { font-size: 11px; color: #667582; margin-bottom: 8px; }
    .tile-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 26px; }
    .tile-status { font-size: 12px; font-weight: 650; color: #667582; }
    .tile-status small { font-size: 11px; font-weight: 500; color: #667582; }
    .tile-status.st-online { color: #13875a; } .tile-status.st-offline { color: #b42318; } .tile-status.st-error { color: #b36b12; } .tile-status.st-pinging { color: #1267dd; }
    .ping-btn { padding: 4px 10px; border: 1px solid #ccd6de; border-radius: 6px; background: white; font-size: 12px; color: #1267dd; cursor: pointer; font-weight: 600; }
    .ping-btn:hover { background: #1267dd; border-color: #1267dd; color: white; }
    .mini-spinner { width: 14px; height: 14px; border: 2px solid #dfe5ea; border-top-color: #1267dd; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes shimmer { to { background-position: -220% 0; } }
    .empty-state { display: flex; flex-direction: column; align-items: center; padding: 40px 20px; gap: 8px; color: #8792a0; text-align: center; background: #fff; border: 1px dashed #ccd6de; border-radius: 8px; }
    .empty-state h3 { color: #172535; margin: 6px 0 0; font-size: 16px; }
    .empty-state p { margin: 0; max-width: 420px; color: #667582; font-size: 13px; }
    button:focus-visible, a:focus-visible, select:focus-visible { outline: 2px solid #1267dd; outline-offset: 2px; }
    @media (max-width: 640px) {
      .toolbar-right { width: 100%; }
      .search-box { flex: 1 1 100%; }
      .search-box input { width: 100%; }
      .filter-select, .toolbar-right .btn { flex: 1; }
      .grid { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 400px) { .grid { grid-template-columns: 1fr; } }
    @media (prefers-reduced-motion: reduce) { .dot-pinging, .client-tile.skeleton, .mini-spinner { animation: none; } }
  `],
})
export class PingToolComponent implements OnInit, OnDestroy {
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
  loading = signal(true);
  /** Estimado visible: ~1.5 s entre pings del escaneo completo. */
  scanMinutes = computed(() => Math.max(1, Math.ceil((this.totalCount() * 1.5) / 60)));
  filterTerm = '';
  statusFilter = '';

  // Antes los temporizadores seguían enviando pings aunque se saliera de la pantalla.
  private destroyed = false;
  private timers = new Set<ReturnType<typeof setInterval>>();

  async ngOnInit() {
    const clients = await this.db.getClients().catch(() => [] as WispHubClient[]);
    this.loading.set(false);
    const activeClients = clients.filter(c => c.estado?.toLowerCase() === 'activo' && c.ip);
    this.allPings.set(activeClients.map(c => ({ client: c, status: 'idle' as const })));
    this.totalCount.set(activeClients.length);
    this.applyFilter();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers.clear();
  }

  applyFilter() {
    let result = this.allPings();
    const term = this.filterTerm.toLowerCase();
    if (term) result = result.filter(p => p.client.nombre?.toLowerCase().includes(term) || p.client.ip?.includes(term));
    if (this.statusFilter) result = result.filter(p => p.status === this.statusFilter);
    this.filteredClients.set(result);
  }

  clearFilter() {
    this.filterTerm = '';
    this.statusFilter = '';
    this.applyFilter();
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
      },
    });
  }

  private pollTask(cp: ClientPing) {
    if (this.destroyed) return;
    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      const stop = () => { clearInterval(check); this.timers.delete(check); };
      if (this.destroyed) return stop();
      if (attempts > 12) { // 12 * 2.5s = 30s max
        stop();
        cp.status = 'error';
        this.updateCounts();
        return;
      }
      this.api.getTaskStatus(cp.taskId!).subscribe({
        next: (res: any) => {
          if (res.task?.status === 'SUCCESS') {
            stop();
            const exitoso = res.task.result?.find?.((r: any) => r['ping-exitoso']);
            if (exitoso) {
              const [ok] = exitoso['ping-exitoso'].split(' de ');
              cp.status = parseInt(ok) > 0 ? 'online' : 'offline';
              cp.result = exitoso['ping-exitoso'];
            } else {
              cp.status = 'online'; // Si no hay ping-exitoso, asumir OK
            }
            this.updateCounts();
          } else if (res.task?.status === 'FAILURE') {
            stop();
            cp.status = 'error';
            this.updateCounts();
          }
        },
        error: () => {}, // Keep polling
      });
    }, 2500);
    this.timers.add(check);
  }

  scanAll() {
    this.scanning.set(true);
    this.scanProgress.set(0);
    this.toast.info('Escaneando la red…');
    const pings = this.allPings();
    let idx = 0;
    const next = () => {
      if (this.destroyed) return;
      if (idx >= pings.length) {
        this.scanning.set(false);
        this.toast.success(`Escaneo terminado: ${this.onlineCount()} responden, ${this.offlineCount()} sin respuesta`);
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
          setTimeout(next, 1500); // Pausa entre pings para no cargar el router
        },
        error: () => {
          cp.status = 'error';
          idx++;
          setTimeout(next, 500);
        },
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
      case 'online': return 'Responde';
      case 'offline': return 'Sin respuesta';
      case 'pinging': return 'Haciendo ping…';
      case 'error': return 'No se pudo verificar';
      default: return 'Sin escanear';
    }
  }
}
