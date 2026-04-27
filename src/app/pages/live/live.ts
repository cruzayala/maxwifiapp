import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { MikrotikService } from '../../services/mikrotik.service';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

interface LiveClient {
  queueName: string;
  ip: string;
  client: any | null;
  maxUploadBps: number;
  maxDownloadBps: number;
  totalUploadBytes: number;
  totalDownloadBytes: number;
  totalBytes: number;
  uploadBps: number;
  downloadBps: number;
  uploadPct: number;
  downloadPct: number;
  isActive: boolean;
  isDisabled: boolean;
}

@Component({
  selector: 'app-live',
  standalone: true,
  imports: [NavbarComponent, FormsModule, RouterLink],
  template: `
    <app-navbar pageTitle="Consumo en Vivo" />

    <div class="page">
      <!-- LIVE STATS BAR -->
      <div class="live-bar">
        <div class="live-pulse">
          <span class="pulse-dot"></span>
          <span>EN VIVO</span>
        </div>
        <div class="live-time">{{ lastUpdate() }}</div>
      </div>

      <!-- BIG STATS -->
      <div class="big-stats">
        <div class="big-stat down">
          <div class="bs-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
          </div>
          <div class="bs-data">
            <span class="bs-value">{{ formatBps(stats().totalDownloadBps) }}</span>
            <span class="bs-label">Descarga total</span>
          </div>
        </div>
        <div class="big-stat up">
          <div class="bs-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          </div>
          <div class="bs-data">
            <span class="bs-value">{{ formatBps(stats().totalUploadBps) }}</span>
            <span class="bs-label">Subida total</span>
          </div>
        </div>
        <div class="big-stat active">
          <div class="bs-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          </div>
          <div class="bs-data">
            <span class="bs-value">{{ stats().activeClients }} / {{ stats().totalQueues }}</span>
            <span class="bs-label">Clientes activos</span>
          </div>
        </div>
        <div class="big-stat total">
          <div class="bs-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </div>
          <div class="bs-data">
            <span class="bs-value">{{ formatBps(stats().totalBpsCombined) }}</span>
            <span class="bs-label">Combinado</span>
          </div>
        </div>
      </div>

      <!-- CONTROLS -->
      <div class="controls">
        <input type="text" placeholder="Buscar cliente..." [(ngModel)]="search" (input)="applyFilter()" class="search" />
        <select [(ngModel)]="filterBy" (change)="applyFilter()" class="filter-sel">
          <option value="active">Solo activos</option>
          <option value="all">Todos</option>
          <option value="top">Top 20</option>
          <option value="overlimit">Cerca del limite</option>
        </select>
        <select [(ngModel)]="sortBy" (change)="applyFilter()" class="filter-sel">
          <option value="combined">Mas trafico</option>
          <option value="download">Mas descarga</option>
          <option value="upload">Mas subida</option>
          <option value="historical">Mas historico</option>
          <option value="name">Por nombre</option>
        </select>
        <span class="count">{{ filtered().length }} mostrando</span>
      </div>

      <!-- CLIENT CARDS -->
      <div class="grid">
        @for (c of filtered(); track c.queueName) {
          <div class="client-card" [class.high-usage]="c.downloadPct > 80 || c.uploadPct > 80">
            <div class="card-header">
              <div class="client-info">
                @if (c.client) {
                  <a [routerLink]="['/clients', c.client.id]" class="client-name">{{ c.client.name }}</a>
                  <span class="client-meta">
                    {{ c.client.plan || c.queueName }}
                    @if (c.client.phone) { · {{ c.client.phone }} }
                  </span>
                } @else {
                  <span class="client-name no-match">{{ c.queueName }}</span>
                  <span class="client-meta">Sin match en WispHub</span>
                }
              </div>
              <span class="ip-badge">{{ c.ip }}</span>
            </div>

            <!-- DOWNLOAD BAR -->
            <div class="bw-row">
              <div class="bw-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
                <span>{{ formatBps(c.downloadBps) }}</span>
                <span class="bw-max">/ {{ formatBps(c.maxDownloadBps) }}</span>
              </div>
              <div class="bw-track">
                <div class="bw-fill download" [style.width.%]="c.downloadPct"></div>
              </div>
            </div>

            <!-- UPLOAD BAR -->
            <div class="bw-row">
              <div class="bw-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                <span>{{ formatBps(c.uploadBps) }}</span>
                <span class="bw-max">/ {{ formatBps(c.maxUploadBps) }}</span>
              </div>
              <div class="bw-track">
                <div class="bw-fill upload" [style.width.%]="c.uploadPct"></div>
              </div>
            </div>

            <!-- HISTORICAL & STATUS -->
            <div class="card-footer">
              <span class="hist">
                Total: <strong>{{ formatBytes(c.totalBytes) }}</strong>
              </span>
              @if (c.client?.invoiceStatus) {
                <span class="status-badge" [class]="getInvoiceClass(c.client.invoiceStatus)">
                  {{ c.client.invoiceStatus }}
                </span>
              }
              @if (c.isActive) {
                <span class="live-badge">
                  <span class="dot-live"></span>ACTIVO
                </span>
              }
            </div>
          </div>
        }
      </div>

      @if (filtered().length === 0 && !loading()) {
        <div class="empty">
          @if (!status().connected) {
            <p>MikroTik no conectado. Verifica configuracion.</p>
          } @else {
            <p>No hay clientes que coincidan con tu busqueda</p>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 16px 24px 32px; }

    .live-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 16px; margin-bottom: 12px;
      background: #0f172a; color: white; border-radius: 10px;
    }
    .live-pulse {
      display: flex; align-items: center; gap: 8px;
      font-size: 11px; font-weight: 700; letter-spacing: 1px;
    }
    .pulse-dot {
      width: 8px; height: 8px; border-radius: 50%; background: #ef4444;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%,100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
      50% { opacity: 0.6; box-shadow: 0 0 0 8px rgba(239,68,68,0); }
    }
    .live-time { font-size: 12px; color: #94a3b8; font-family: 'Courier New', monospace; }

    .big-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
    .big-stat {
      background: white; border: 1px solid #e2e8f0; border-radius: 14px;
      padding: 16px 20px; display: flex; align-items: center; gap: 14px;
      transition: all 0.3s;
    }
    .big-stat.down { border-left: 4px solid #3b82f6; }
    .big-stat.up { border-left: 4px solid #22c55e; }
    .big-stat.active { border-left: 4px solid #f59e0b; }
    .big-stat.total { border-left: 4px solid #8b5cf6; }
    .bs-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
    .big-stat.down .bs-icon { background: #dbeafe; color: #2563eb; }
    .big-stat.up .bs-icon { background: #dcfce7; color: #16a34a; }
    .big-stat.active .bs-icon { background: #fef3c7; color: #d97706; }
    .big-stat.total .bs-icon { background: #faf5ff; color: #8b5cf6; }
    .bs-value {
      display: block; font-size: 22px; font-weight: 800; color: #0f172a;
      transition: all 0.3s;
    }
    .bs-label { font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }

    .controls {
      display: flex; gap: 10px; margin-bottom: 14px; align-items: center; flex-wrap: wrap;
    }
    .search {
      padding: 9px 14px; border: 1px solid #e2e8f0; border-radius: 10px;
      font-size: 13px; outline: none; min-width: 220px;
    }
    .search:focus { border-color: #6366f1; }
    .filter-sel {
      padding: 9px 12px; border: 1px solid #e2e8f0; border-radius: 10px;
      font-size: 13px; background: white; cursor: pointer; outline: none;
    }
    .count { font-size: 12px; color: #64748b; margin-left: auto; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }

    .client-card {
      background: white; border: 1px solid #e2e8f0; border-radius: 14px;
      padding: 14px 16px; transition: all 0.25s;
      animation: cardIn 0.3s ease;
    }
    @keyframes cardIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .client-card.high-usage {
      border-color: #ef4444;
      box-shadow: 0 0 0 4px rgba(239,68,68,0.1);
    }

    .card-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 10px; margin-bottom: 10px;
    }
    .client-info { flex: 1; min-width: 0; }
    .client-name {
      display: block; font-size: 14px; font-weight: 700; color: #0f172a;
      text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .client-name:hover { color: #6366f1; }
    .client-name.no-match { color: #94a3b8; font-style: italic; }
    .client-meta { display: block; font-size: 11px; color: #94a3b8; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ip-badge {
      font-family: 'Courier New', monospace; font-size: 11px; font-weight: 600;
      background: #eef2ff; color: #6366f1; padding: 3px 8px; border-radius: 6px;
      flex-shrink: 0;
    }

    .bw-row { margin-bottom: 8px; }
    .bw-label {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px;
    }
    .bw-label svg { flex-shrink: 0; }
    .bw-max { color: #94a3b8; font-weight: 400; font-size: 11px; }
    .bw-track {
      height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden;
      position: relative;
    }
    .bw-fill {
      height: 100%; border-radius: 4px;
      transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      min-width: 2px;
    }
    .bw-fill.download {
      background: linear-gradient(90deg, #3b82f6, #2563eb);
      box-shadow: 0 0 8px rgba(59,130,246,0.4);
    }
    .bw-fill.upload {
      background: linear-gradient(90deg, #22c55e, #16a34a);
      box-shadow: 0 0 8px rgba(34,197,94,0.4);
    }
    .bw-fill::after {
      content: '';
      position: absolute; inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
      animation: shimmer 1.5s infinite;
    }
    @keyframes shimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }

    .card-footer {
      display: flex; align-items: center; gap: 8px; margin-top: 10px;
      padding-top: 10px; border-top: 1px solid #f1f5f9;
      font-size: 11px; flex-wrap: wrap;
    }
    .hist { color: #64748b; }
    .hist strong { color: #0f172a; }
    .status-badge { padding: 2px 8px; border-radius: 12px; font-weight: 600; }
    .status-paid { background: #dcfce7; color: #16a34a; }
    .status-pending { background: #fef3c7; color: #d97706; }

    .live-badge {
      display: inline-flex; align-items: center; gap: 4px;
      background: #fee2e2; color: #dc2626; padding: 2px 8px; border-radius: 12px;
      font-weight: 700; letter-spacing: 0.5px;
    }
    .dot-live {
      width: 6px; height: 6px; border-radius: 50%; background: #ef4444;
      animation: pulse 1s infinite;
    }

    .empty { text-align: center; padding: 60px; color: #94a3b8; }

    @media (max-width: 768px) {
      .big-stats { grid-template-columns: repeat(2, 1fr); }
      .bs-value { font-size: 18px; }
    }
    @media (max-width: 480px) {
      .big-stats { grid-template-columns: 1fr; }
    }
  `]
})
export class LiveComponent implements OnInit, OnDestroy {
  private mt = inject(MikrotikService);

  status = signal<any>({ connected: false });
  stats = signal<any>({ totalQueues: 0, activeClients: 0, totalUploadBps: 0, totalDownloadBps: 0, totalBpsCombined: 0 });
  allClients = signal<LiveClient[]>([]);
  filtered = signal<LiveClient[]>([]);
  lastUpdate = signal('');
  loading = signal(true);

  search = '';
  filterBy: 'active' | 'all' | 'top' | 'overlimit' = 'active';
  sortBy: 'combined' | 'download' | 'upload' | 'historical' | 'name' = 'combined';

  private interval: any;
  private REFRESH_MS = 3000;

  ngOnInit() {
    this.mt.getStatus().subscribe({ next: s => this.status.set(s) });
    this.refresh();
    this.interval = setInterval(() => this.refresh(), this.REFRESH_MS);
  }

  ngOnDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  refresh() {
    this.mt.getLiveClients().subscribe({
      next: (data) => {
        this.stats.set(data.stats);
        this.allClients.set(data.clients);
        this.lastUpdate.set(new Date(data.timestamp).toLocaleTimeString('es-DO'));
        this.applyFilter();
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); }
    });
  }

  applyFilter() {
    let result = this.allClients();
    const term = this.search.toLowerCase();

    if (term) {
      result = result.filter(c =>
        c.client?.name?.toLowerCase().includes(term) ||
        c.queueName?.toLowerCase().includes(term) ||
        c.ip?.includes(term) ||
        c.client?.phone?.includes(term)
      );
    }

    if (this.filterBy === 'active') result = result.filter(c => c.isActive);
    else if (this.filterBy === 'overlimit') result = result.filter(c => c.downloadPct > 70 || c.uploadPct > 70);
    else if (this.filterBy === 'top') {
      result = [...result].sort((a, b) => (b.uploadBps + b.downloadBps) - (a.uploadBps + a.downloadBps)).slice(0, 20);
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (this.sortBy) {
        case 'combined': return (b.uploadBps + b.downloadBps) - (a.uploadBps + a.downloadBps);
        case 'download': return b.downloadBps - a.downloadBps;
        case 'upload': return b.uploadBps - a.uploadBps;
        case 'historical': return b.totalBytes - a.totalBytes;
        case 'name': return (a.client?.name || a.queueName).localeCompare(b.client?.name || b.queueName);
      }
      return 0;
    });

    this.filtered.set(result);
  }

  formatBps(bps: number): string {
    if (!bps || bps < 1) return '0 bps';
    if (bps < 1000) return Math.round(bps) + ' bps';
    if (bps < 1000000) return (bps / 1000).toFixed(1) + ' Kbps';
    if (bps < 1000000000) return (bps / 1000000).toFixed(2) + ' Mbps';
    return (bps / 1000000000).toFixed(2) + ' Gbps';
  }

  formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  getInvoiceClass(status: string): string {
    if (status?.toLowerCase() === 'pagadas') return 'status-paid';
    if (status?.toLowerCase().includes('pendiente')) return 'status-pending';
    return '';
  }
}
