import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { MikrotikService } from '../../services/mikrotik.service';
import { ClientActionsService } from '../../services/client-actions.service';
import { SurveyService } from '../../services/survey.service';
import { ToastService } from '../../services/toast.service';
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

interface WanSample { t: number; rx: number; tx: number; }
interface Alert { id: number; ts: number; kind: 'limit' | 'spike'; ip: string; name: string; message: string; }

const STORAGE_PAUSED = 'live.paused';
const STORAGE_INTERVAL = 'live.intervalMs';
const HISTORY_MAX = 200;          // ~10 min @ 3s
const ALERT_TTL_MS = 2 * 60 * 1000; // 2 min

@Component({
  selector: 'app-live',
  standalone: true,
  imports: [NavbarComponent, FormsModule, RouterLink],
  template: `
    <app-navbar pageTitle="Consumo en Vivo" />

    <div class="page">
      <!-- LIVE STATS BAR + CONTROLS -->
      <div class="live-bar">
        <div class="live-pulse">
          <span class="pulse-dot" [class.paused]="paused()"></span>
          <span>{{ paused() ? 'PAUSADO' : 'EN VIVO' }}</span>
        </div>
        <div class="controls-inline">
          <button class="btn-icon" (click)="togglePause()" [title]="paused() ? 'Reanudar' : 'Pausar'">
            @if (paused()) { ▶ } @else { ⏸ }
          </button>
          <select class="interval-sel" [(ngModel)]="refreshMs" (change)="changeInterval()">
            <option [ngValue]="1000">1s</option>
            <option [ngValue]="3000">3s</option>
            <option [ngValue]="10000">10s</option>
            <option [ngValue]="30000">30s</option>
          </select>
          <button class="btn-icon bell" (click)="toggleAlertsDrop()" [class.has-alerts]="alerts().length > 0">
            🔔
            @if (alerts().length > 0) { <span class="alert-count">{{ alerts().length }}</span> }
          </button>
        </div>
        <div class="live-time">{{ lastUpdate() }}</div>
      </div>

      <!-- ALERTS DROPDOWN -->
      @if (showAlerts() && alerts().length > 0) {
        <div class="alerts-drop">
          <div class="alerts-header">
            <strong>{{ alerts().length }} alertas activas</strong>
            <button class="link-btn" (click)="clearAlerts()">Limpiar</button>
          </div>
          @for (a of alerts(); track a.id) {
            <div class="alert-item" [class.spike]="a.kind === 'spike'">
              <span class="alert-icon">{{ a.kind === 'spike' ? '⚡' : '⚠' }}</span>
              <div class="alert-body">
                <strong>{{ a.name }}</strong>
                <span class="alert-msg">{{ a.message }}</span>
              </div>
              <span class="alert-time">{{ formatRel(a.ts) }}</span>
            </div>
          }
        </div>
      }

      <!-- WAN PANEL -->
      @if (wan(); as w) {
        <div class="wan-panel">
          <div class="wan-header">
            <div class="wan-title">
              <span class="wan-iface">🌐 WAN — {{ w.ifaceName }}</span>
              <span class="wan-mbps">{{ formatBps(w.rxBps) }} / {{ formatBps(w.maxBps) }}</span>
            </div>
            <div class="wan-sparkline" [innerHTML]="wanSparkline()"></div>
          </div>
          <div class="wan-bars">
            <div class="wan-bar-row">
              <span class="wan-bar-label">↓ DOWN</span>
              <div class="wan-bar-track">
                <div class="wan-bar-fill" [class]="wanColorClass(wanPctDown())" [style.width.%]="wanPctDown()"></div>
              </div>
              <span class="wan-bar-val">{{ wanPctDown().toFixed(0) }}%</span>
            </div>
            <div class="wan-bar-row">
              <span class="wan-bar-label">↑ UP</span>
              <div class="wan-bar-track">
                <div class="wan-bar-fill" [class]="wanColorClass(wanPctUp())" [style.width.%]="wanPctUp()"></div>
              </div>
              <span class="wan-bar-val">{{ wanPctUp().toFixed(0) }}%</span>
            </div>
          </div>
        </div>
      }

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

      <!-- CONTROLS (search/filter) -->
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

            <!-- INLINE ACTIONS -->
            @if (c.client) {
              <div class="card-actions" (click)="$event.stopPropagation()">
                <button class="act-btn block" (click)="$event.stopPropagation(); actBlock(c)" [disabled]="actLoading() === c.ip" title="Desactivar cliente y mostrar pagina informativa">
                  🚫 Bloquear
                </button>
                <button class="act-btn moroso" (click)="$event.stopPropagation(); actMoroso(c)" [disabled]="actLoading() === c.ip" title="Marcar moroso (captive)">
                  ⏰ Moroso
                </button>
                <button class="act-btn survey" (click)="$event.stopPropagation(); actSurvey(c)" [disabled]="actLoading() === c.ip" title="Crear enlace seguro de encuesta sin tocar internet">
                  📝 Encuesta
                </button>
                <button class="act-btn clear-survey" (click)="$event.stopPropagation(); clearSurvey(c)" [disabled]="actLoading() === c.ip" title="Quitar encuesta pendiente">
                  Quitar encuesta
                </button>
              </div>
            }
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
      flex-wrap: wrap; gap: 10px;
    }
    .live-pulse {
      display: flex; align-items: center; gap: 8px;
      font-size: 11px; font-weight: 700; letter-spacing: 1px;
    }
    .pulse-dot {
      width: 8px; height: 8px; border-radius: 50%; background: #ef4444;
      animation: pulse 1.5s infinite;
    }
    .pulse-dot.paused { background: #94a3b8; animation: none; }
    @keyframes pulse {
      0%,100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
      50% { opacity: 0.6; box-shadow: 0 0 0 8px rgba(239,68,68,0); }
    }
    .live-time { font-size: 12px; color: #94a3b8; font-family: 'Courier New', monospace; }
    .controls-inline { display: flex; align-items: center; gap: 8px; }
    .btn-icon {
      background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2);
      border-radius: 8px; padding: 4px 10px; font-size: 14px; cursor: pointer;
      position: relative;
    }
    .btn-icon:hover { background: rgba(255,255,255,0.2); }
    .btn-icon.bell.has-alerts { background: rgba(239,68,68,0.2); border-color: rgba(239,68,68,0.5); }
    .alert-count {
      position: absolute; top: -4px; right: -4px;
      background: #ef4444; color: white; border-radius: 999px;
      font-size: 9px; padding: 1px 5px; font-weight: 700;
    }
    .interval-sel {
      background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2);
      border-radius: 8px; padding: 4px 8px; font-size: 12px; cursor: pointer; outline: none;
    }
    .interval-sel option { background: #0f172a; color: white; }

    .alerts-drop {
      background: white; border: 1px solid #e2e8f0; border-radius: 12px;
      padding: 8px; margin-bottom: 12px; max-height: 250px; overflow-y: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }
    .alerts-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 6px 10px; border-bottom: 1px solid #f1f5f9; margin-bottom: 6px;
    }
    .link-btn { background: none; border: none; color: #6366f1; cursor: pointer; font-size: 12px; }
    .alert-item {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border-radius: 8px;
      font-size: 12px;
    }
    .alert-item:hover { background: #f8fafc; }
    .alert-item.spike { background: #fef3c7; }
    .alert-icon { font-size: 18px; }
    .alert-body { flex: 1; display: flex; flex-direction: column; }
    .alert-body strong { color: #0f172a; font-size: 13px; }
    .alert-msg { color: #64748b; font-size: 11px; }
    .alert-time { color: #94a3b8; font-size: 11px; font-family: monospace; }

    .wan-panel {
      background: white; border: 1px solid #e2e8f0; border-radius: 14px;
      padding: 12px 18px; margin-bottom: 14px;
    }
    .wan-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 10px; gap: 14px; flex-wrap: wrap;
    }
    .wan-title { display: flex; flex-direction: column; gap: 2px; }
    .wan-iface { font-weight: 700; color: #0f172a; font-size: 14px; }
    .wan-mbps { font-size: 12px; color: #64748b; font-family: monospace; }
    .wan-sparkline { flex: 1; max-width: 320px; height: 40px; }
    .wan-sparkline svg { display: block; width: 100%; height: 100%; }

    .wan-bars { display: flex; flex-direction: column; gap: 6px; }
    .wan-bar-row { display: flex; align-items: center; gap: 10px; }
    .wan-bar-label { font-size: 11px; font-weight: 700; color: #475569; width: 50px; }
    .wan-bar-track {
      flex: 1; height: 12px; background: #f1f5f9; border-radius: 6px; overflow: hidden;
    }
    .wan-bar-fill {
      height: 100%; transition: width 0.4s ease, background 0.3s ease;
    }
    .wan-bar-fill.green { background: linear-gradient(90deg, #22c55e, #16a34a); }
    .wan-bar-fill.yellow { background: linear-gradient(90deg, #f59e0b, #d97706); }
    .wan-bar-fill.red { background: linear-gradient(90deg, #ef4444, #dc2626); }
    .wan-bar-val { font-family: monospace; font-size: 12px; font-weight: 700; color: #0f172a; width: 44px; text-align: right; }

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

    .card-actions {
      display: flex; gap: 6px; margin-top: 10px;
      padding-top: 8px; border-top: 1px dashed #f1f5f9;
    }
    .act-btn {
      flex: 1; padding: 6px 8px; border-radius: 6px; font-size: 11px; font-weight: 600;
      cursor: pointer; border: 1px solid transparent; transition: all 0.15s;
    }
    .act-btn:disabled { opacity: 0.5; cursor: wait; }
    .act-btn.block { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
    .act-btn.block:hover:not(:disabled) { background: #fecaca; }
    .act-btn.moroso { background: #fef3c7; color: #92400e; border-color: #fde68a; }
    .act-btn.moroso:hover:not(:disabled) { background: #fde68a; }
    .act-btn.survey { background: #eff6ff; color: #2563eb; border-color: #bfdbfe; }
    .act-btn.survey:hover:not(:disabled) { background: #dbeafe; }
    .act-btn.clear-survey { background: #f8fafc; color: #475569; border-color: #cbd5e1; }
    .act-btn.clear-survey:hover:not(:disabled) { background: #f1f5f9; color: #0f172a; }

    .empty { text-align: center; padding: 60px; color: #94a3b8; }

    @media (max-width: 768px) {
      .big-stats { grid-template-columns: repeat(2, 1fr); }
      .bs-value { font-size: 18px; }
      .wan-sparkline { display: none; }
    }
    @media (max-width: 480px) {
      .big-stats { grid-template-columns: 1fr; }
    }
  `]
})
export class LiveComponent implements OnInit, OnDestroy {
  private mt = inject(MikrotikService);
  private actions = inject(ClientActionsService);
  private survey = inject(SurveyService);
  private toast = inject(ToastService);

  status = signal<any>({ connected: false });
  stats = signal<any>({ totalQueues: 0, activeClients: 0, totalUploadBps: 0, totalDownloadBps: 0, totalBpsCombined: 0 });
  allClients = signal<LiveClient[]>([]);
  filtered = signal<LiveClient[]>([]);
  lastUpdate = signal('');
  loading = signal(true);

  // WAN data
  wan = signal<{ ifaceName: string; rxBps: number; txBps: number; maxBps: number } | null>(null);
  wanHistory = signal<WanSample[]>([]);
  wanPctDown = computed(() => {
    const w = this.wan();
    if (!w || !w.maxBps) return 0;
    return Math.min(100, (w.rxBps / w.maxBps) * 100);
  });
  wanPctUp = computed(() => {
    const w = this.wan();
    if (!w || !w.maxBps) return 0;
    return Math.min(100, (w.txBps / w.maxBps) * 100);
  });

  // Pause + interval
  paused = signal(false);
  refreshMs = 3000;

  // Alerts
  alerts = signal<Alert[]>([]);
  showAlerts = signal(false);
  private alertIdSeq = 0;
  // Track sustained-high counters per IP and recent bps for spike detection
  private overLimitTicks = new Map<string, number>(); // ip -> consecutive ticks > 80%
  private recentBps = new Map<string, number[]>(); // ip -> last 5 download bps samples
  private alertsCooldown = new Map<string, number>(); // ip|kind -> ts

  // Action state
  actLoading = signal<string | null>(null); // ip currently performing action

  search = '';
  filterBy: 'active' | 'all' | 'top' | 'overlimit' = 'active';
  sortBy: 'combined' | 'download' | 'upload' | 'historical' | 'name' = 'combined';

  private interval: any;

  // Safe localStorage helpers — tolerantes a QuotaExceeded, modo privado, SSR, etc.
  private lsGet(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  }
  private lsSet(k: string, v: string): void {
    try { localStorage.setItem(k, v); } catch {}
  }

  ngOnInit() {
    // Restore localStorage prefs (defensivo)
    this.paused.set(this.lsGet(STORAGE_PAUSED) === '1');
    const savedMs = parseInt(this.lsGet(STORAGE_INTERVAL) || '3000');
    if ([1000, 3000, 10000, 30000].includes(savedMs)) this.refreshMs = savedMs;

    this.mt.getStatus().subscribe({ next: s => this.status.set(s) });
    if (!this.paused()) {
      this.refresh();
      this.startInterval();
    } else {
      this.loading.set(false);
    }
  }

  ngOnDestroy() {
    this.stopInterval();
  }

  private startInterval() {
    this.stopInterval();
    this.interval = setInterval(() => this.refresh(), this.refreshMs);
  }
  private stopInterval() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  togglePause() {
    const p = !this.paused();
    this.paused.set(p);
    this.lsSet(STORAGE_PAUSED, p ? '1' : '0');
    if (p) this.stopInterval();
    else { this.refresh(); this.startInterval(); }
  }

  changeInterval() {
    this.lsSet(STORAGE_INTERVAL, String(this.refreshMs));
    if (!this.paused()) this.startInterval();
  }

  toggleAlertsDrop() { this.showAlerts.update(v => !v); }
  clearAlerts() { this.alerts.set([]); this.showAlerts.set(false); }

  refresh() {
    // Clients
    this.mt.getLiveClients().subscribe({
      next: (data) => {
        this.stats.set(data.stats);
        this.allClients.set(data.clients);
        this.lastUpdate.set(new Date(data.timestamp).toLocaleTimeString('es-DO'));
        this.applyFilter();
        this.detectAnomalies(data.clients);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); }
    });
    // WAN
    this.mt.getWanTraffic().subscribe({
      next: (w) => {
        this.wan.set({ ifaceName: w.ifaceName, rxBps: w.rxBps, txBps: w.txBps, maxBps: w.maxBps });
        this.wanHistory.update(h => {
          const arr = [...h, { t: Date.now(), rx: w.rxBps, tx: w.txBps }];
          if (arr.length > HISTORY_MAX) arr.splice(0, arr.length - HISTORY_MAX);
          return arr;
        });
      },
      error: () => { /* WAN puede no estar disponible, no spam de errores */ }
    });
    // Purge old alerts
    this.purgeOldAlerts();
  }

  private detectAnomalies(clients: LiveClient[]) {
    const now = Date.now();
    for (const c of clients) {
      if (!c.client) continue;
      const ip = c.ip;
      const name = c.client.name || c.queueName;

      // 1) Sustained > 80% on download
      const pct = Math.max(c.downloadPct, c.uploadPct);
      if (pct > 80) {
        const prev = this.overLimitTicks.get(ip) || 0;
        this.overLimitTicks.set(ip, prev + 1);
        if (prev + 1 === 3) {
          this.pushAlertIfFresh('limit', ip, name, `${pct.toFixed(0)}% del plan por 3 lecturas seguidas`);
        }
      } else {
        this.overLimitTicks.delete(ip);
      }

      // 2) Spike: bps > 5x avg of last 5
      const arr = this.recentBps.get(ip) || [];
      const avg = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      if (avg > 100000 && c.downloadBps > avg * 5) {
        this.pushAlertIfFresh('spike', ip, name, `Pico subito: ${this.formatBps(c.downloadBps)} (avg era ${this.formatBps(avg)})`);
      }
      arr.push(c.downloadBps);
      if (arr.length > 5) arr.shift();
      this.recentBps.set(ip, arr);
    }
  }

  private pushAlertIfFresh(kind: 'limit' | 'spike', ip: string, name: string, message: string) {
    const key = `${ip}|${kind}`;
    const last = this.alertsCooldown.get(key) || 0;
    const now = Date.now();
    if (now - last < 60_000) return; // 1 min cooldown per (ip, kind)
    this.alertsCooldown.set(key, now);
    this.alerts.update(a => [{ id: ++this.alertIdSeq, ts: now, kind, ip, name, message }, ...a]);
  }

  private purgeOldAlerts() {
    const cutoff = Date.now() - ALERT_TTL_MS;
    this.alerts.update(a => a.filter(x => x.ts > cutoff));
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

  // Inline actions
  actBlock(c: LiveClient) {
    const name = c.client?.name || c.queueName;
    if (!confirm(`Desactivar a ${name} (${c.ip})?\nNo podra navegar. Al abrir HTTP vera una pagina con sus datos y el aviso de contactar administracion.`)) return;
    this.actLoading.set(c.ip);
    this.actions.apply(c.client.id, 'block', 'Desactivado desde En Vivo').subscribe({
      next: r => { this.actLoading.set(null); if (r.ok) this.toast.success(`Desactivado: ${name}`); else this.toast.error(r.error || 'Fallo desactivar'); },
      error: e => { this.actLoading.set(null); this.toast.error(e.error?.error || 'Fallo desactivar'); },
    });
  }
  actMoroso(c: LiveClient) {
    const name = c.client?.name || c.queueName;
    if (!confirm(`Marcar moroso a ${name}?\nLa próxima vez que abra HTTP vera el captive de pago.`)) return;
    this.actLoading.set(c.ip);
    this.actions.apply(c.client.id, 'moroso', 'Moroso desde En Vivo').subscribe({
      next: r => { this.actLoading.set(null); if (r.ok) this.toast.success(`Moroso: ${name}`); else this.toast.error(r.error || 'Fallo'); },
      error: e => { this.actLoading.set(null); this.toast.error(e.error?.error || 'Fallo'); },
    });
  }
  actSurvey(c: LiveClient) {
    const name = c.client?.name || c.queueName;
    if (!confirm(`Crear encuesta para ${name} (${c.ip})?\nSe creara un enlace seguro y recordatorios, sin tocar MikroTik ni el internet.`)) return;
    this.actLoading.set(c.ip);
    this.survey.start(c.ip, c.client?.id).subscribe({
      next: r => {
        this.actLoading.set(null);
        if (r.publicUrl) navigator.clipboard?.writeText(r.publicUrl).catch(() => {});
        if (r.alreadySubmitted) this.toast.info('Este cliente ya lleno la encuesta.');
        else if (r.alreadyPending) this.toast.info('Ya hay encuesta pendiente. Enlace copiado y recordatorio reactivado.');
        else if (r.ok) this.toast.success(`Encuesta creada para ${name}. Enlace copiado y recordatorios activos, sin tocar internet.`);
        else this.toast.error(r.error || 'Fallo activar encuesta');
      },
      error: e => { this.actLoading.set(null); this.toast.error(e.error?.error || 'Fallo'); },
    });
  }

  clearSurvey(c: LiveClient) {
    const name = c.client?.name || c.queueName;
    if (!confirm(`Pausar encuesta para ${name}?\nEl cliente navega normal. Si no la llena, el sistema volvera a recordarle en unas horas.`)) return;
    this.actLoading.set(c.ip);
    this.survey.clear(c.ip, c.client?.id).subscribe({
      next: r => {
        this.actLoading.set(null);
        if (!r.ok) {
          this.toast.error(r.error || 'No se pudo quitar');
          return;
        }
        const mtCleaned = r.mikrotik?.removed?.some((x: any) => x.wasInList);
        const detail = r.snoozed > 0 ? `${r.snoozed} pausada(s) por ${r.reminderIntervalHours || 4}h` : 'sin pendientes';
        this.toast.success(`Encuesta pausada: ${detail}${mtCleaned ? ', MikroTik limpio' : ''}`);
      },
      error: e => { this.actLoading.set(null); this.toast.error(e.error?.error || 'Fallo quitar encuesta'); },
    });
  }

  // WAN helpers
  wanColorClass(pct: number): string {
    if (pct > 85) return 'red';
    if (pct > 60) return 'yellow';
    return 'green';
  }

  // SVG sparkline (down=blue line, up=green line)
  wanSparkline(): string {
    const data = this.wanHistory();
    if (data.length < 2) return '';
    const W = 320, H = 40, PAD = 2;
    const maxVal = Math.max(...data.map(d => Math.max(d.rx, d.tx)), 1);
    const xStep = (W - PAD * 2) / (data.length - 1);
    const yScale = (v: number) => H - PAD - ((v / maxVal) * (H - PAD * 2));
    const pathFor = (key: 'rx' | 'tx') => data.map((d, i) => `${i === 0 ? 'M' : 'L'}${(PAD + i * xStep).toFixed(1)},${yScale(d[key]).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path d="${pathFor('rx')}" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="${pathFor('tx')}" fill="none" stroke="#22c55e" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
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

  formatRel(ts: number): string {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return Math.floor(diff) + 's';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    return Math.floor(diff / 3600) + 'h';
  }

  getInvoiceClass(status: string): string {
    if (status?.toLowerCase() === 'pagadas') return 'status-paid';
    if (status?.toLowerCase().includes('pendiente')) return 'status-pending';
    return '';
  }
}
