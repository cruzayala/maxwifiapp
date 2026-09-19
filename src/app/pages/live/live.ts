import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import {
  LucideActivity,
  LucideBan,
  LucideChevronLeft,
  LucideChevronRight,
  LucideCircleAlert,
  LucideCircleCheck,
  LucideClock3,
  LucideCopy,
  LucideDatabase,
  LucideExternalLink,
  LucideFilterX,
  LucideHistory,
  LucideLockOpen,
  LucideMessageCircle,
  LucidePackage,
  LucidePause,
  LucidePlay,
  LucideRadioTower,
  LucideRefreshCw,
  LucideSearch,
  LucideServer,
  LucideSlidersHorizontal,
  LucideWifi,
  LucideWifiOff,
  LucideX,
  LucideZap,
} from '@lucide/angular';
import { NavbarComponent } from '../../components/layout/navbar';
import { ClientActionsService } from '../../services/client-actions.service';
import { MikrotikService } from '../../services/mikrotik.service';
import { ServerSyncStatus, SyncService } from '../../services/sync.service';
import { ToastService } from '../../services/toast.service';

type LiveView = 'operation' | 'incidents' | 'sync';
type QuickFilter = 'all' | 'online' | 'offline' | 'overdue' | 'no_ip' | 'differences' | 'overlimit';
type SortMode = 'priority' | 'traffic' | 'name' | 'zone' | 'uptime';
type SyncState = 'synced' | 'missing_wisphub' | 'missing_mikrotik' | 'missing_ip' | 'queue_mismatch' | 'state_mismatch';

interface LiveClientProfile {
  id: number;
  username?: string | null;
  name: string;
  wisphubName?: string | null;
  phone?: string | null;
  address?: string | null;
  plan?: string | null;
  price?: string | null;
  balance?: string | null;
  zone?: string | null;
  router?: string | null;
  interface?: string | null;
  macAddress?: string | null;
  snOnu?: string | null;
  status?: string | null;
  invoiceStatus?: string | null;
  crmAction?: string | null;
  crmActionReason?: string | null;
  paymentPilotEnabled?: boolean;
  paymentPilotEnabledAt?: string | null;
  syncedAt?: string | null;
  mtSyncedAt?: string | null;
  equipmentCount?: number;
}

interface LiveClient {
  queueName: string;
  ip: string;
  client: LiveClientProfile | null;
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
  isOnline: boolean;
  isTransmitting: boolean;
  isDisabled: boolean;
  interface?: string | null;
  macAddress?: string | null;
  sessionUptime?: string | null;
  sessionUser?: string | null;
  syncState: SyncState;
}

interface LiveStats {
  totalQueues: number;
  mikrotikQueues: number;
  totalClients: number;
  activeClients: number;
  onlineClients: number;
  offlineClients: number;
  transmittingClients: number;
  differences: number;
  overdueClients: number;
  disabledQueues: number;
  missingWisphub: number;
  missingMikrotik: number;
  clientsWithoutIp: number;
  totalUploadBps: number;
  totalDownloadBps: number;
  totalBpsCombined: number;
}

interface LiveResponse {
  timestamp: string;
  stats: LiveStats;
  clients: LiveClient[];
}

interface TrafficSample {
  t: number;
  upload: number;
  download: number;
}

interface WanState {
  ifaceName: string;
  rxBps: number;
  txBps: number;
  maxBps: number;
}

interface EquipmentLite {
  id: number;
  serialNumber?: string | null;
  macAddress?: string | null;
  brand?: string | null;
  model?: string | null;
  status: string;
  assignedAt?: string | null;
  type?: { name: string; category: string } | null;
}

interface BlockEvent {
  id: number;
  action: string;
  reason: string;
  createdBy?: string | null;
  createdAt: string;
}

interface LiveAlert {
  id: number;
  ts: number;
  kind: 'limit' | 'spike' | 'offline';
  ip: string;
  name: string;
  message: string;
}

const EMPTY_STATS: LiveStats = {
  totalQueues: 0,
  mikrotikQueues: 0,
  totalClients: 0,
  activeClients: 0,
  onlineClients: 0,
  offlineClients: 0,
  transmittingClients: 0,
  differences: 0,
  overdueClients: 0,
  disabledQueues: 0,
  missingWisphub: 0,
  missingMikrotik: 0,
  clientsWithoutIp: 0,
  totalUploadBps: 0,
  totalDownloadBps: 0,
  totalBpsCombined: 0,
};

const STORAGE_PAUSED = 'live.paused';
const STORAGE_INTERVAL = 'live.intervalMs';
const TRAFFIC_HISTORY_LIMIT = 30;
const ALERT_TTL_MS = 5 * 60 * 1000;

@Component({
  selector: 'app-live',
  standalone: true,
  imports: [
    NavbarComponent,
    FormsModule,
    RouterLink,
    LucideActivity,
    LucideBan,
    LucideChevronLeft,
    LucideChevronRight,
    LucideCircleAlert,
    LucideCircleCheck,
    LucideClock3,
    LucideCopy,
    LucideDatabase,
    LucideExternalLink,
    LucideFilterX,
    LucideHistory,
    LucideLockOpen,
    LucideMessageCircle,
    LucidePackage,
    LucidePause,
    LucidePlay,
    LucideRadioTower,
    LucideRefreshCw,
    LucideSearch,
    LucideServer,
    LucideSlidersHorizontal,
    LucideWifi,
    LucideWifiOff,
    LucideX,
    LucideZap,
  ],
  templateUrl: './live.html',
})
export class LiveComponent implements OnInit, OnDestroy {
  private readonly mt = inject(MikrotikService);
  private readonly actions = inject(ClientActionsService);
  private readonly sync = inject(SyncService);
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  status = signal({ connected: false, configured: false, host: '' });
  syncStatus = signal<ServerSyncStatus | null>(null);
  stats = signal<LiveStats>(EMPTY_STATS);
  allClients = signal<LiveClient[]>([]);
  selectedClient = signal<LiveClient | null>(null);
  selectedHistory = signal<TrafficSample[]>([]);
  equipment = signal<EquipmentLite[]>([]);
  events = signal<BlockEvent[]>([]);
  alerts = signal<LiveAlert[]>([]);
  wan = signal<WanState | null>(null);

  loading = signal(true);
  refreshing = signal(false);
  contextLoading = signal(false);
  actionLoading = signal(false);
  pinging = signal(false);
  syncingNow = signal(false);
  errorMessage = signal('');
  pingResult = signal('');
  paused = signal(false);
  lastUpdate = signal<Date | null>(null);
  nowTick = signal(Date.now());
  nextRefreshAt = signal(Date.now());
  effectiveRefreshMs = signal(3000);

  activeView = signal<LiveView>('operation');
  quickFilter = signal<QuickFilter>('all');
  search = signal('');
  zoneFilter = signal('');
  planFilter = signal('');
  interfaceFilter = signal('');
  sortBy = signal<SortMode>('priority');
  page = signal(1);
  pageSize = signal(25);
  refreshMs = 3000;

  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private supportTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private refreshInProgress = false;
  private consecutiveRefreshFailures = 0;
  private readonly historyByIp = new Map<string, TrafficSample[]>();
  private readonly overLimitTicks = new Map<string, number>();
  private readonly recentDownload = new Map<string, number[]>();
  private readonly previousOnline = new Map<string, boolean>();
  private readonly alertCooldown = new Map<string, number>();
  private alertId = 0;

  zones = computed(() => this.uniqueSorted(this.allClients().map(c => c.client?.zone)));
  plans = computed(() => this.uniqueSorted(this.allClients().map(c => c.client?.plan)));
  interfaces = computed(() => this.uniqueSorted(this.allClients().map(c => c.interface || c.client?.interface)));

  incidentCount = computed(() => this.allClients().filter(c => this.hasIncident(c)).length);
  filteredClients = computed(() => {
    const term = this.normalize(this.search());
    const zone = this.zoneFilter();
    const plan = this.planFilter();
    const iface = this.interfaceFilter();
    const quick = this.quickFilter();
    const view = this.activeView();

    let result = this.allClients().filter(client => {
      if (view === 'incidents' && !this.hasIncident(client)) return false;
      if (view === 'sync' && client.syncState === 'synced') return false;

      if (term) {
        const haystack = [
          client.client?.name,
          client.client?.wisphubName,
          client.client?.username,
          client.queueName,
          client.ip,
          client.client?.phone,
          client.macAddress,
          client.client?.snOnu,
        ].map(value => this.normalize(value)).join(' ');
        if (!haystack.includes(term)) return false;
      }

      if (zone && client.client?.zone !== zone) return false;
      if (plan && client.client?.plan !== plan) return false;
      if (iface && (client.interface || client.client?.interface) !== iface) return false;

      if (quick === 'online' && !client.isOnline) return false;
      if (quick === 'offline' && client.isOnline) return false;
      if (quick === 'overdue' && !this.isOverdue(client)) return false;
      if (quick === 'no_ip' && client.syncState !== 'missing_ip') return false;
      if (quick === 'differences' && client.syncState === 'synced') return false;
      if (quick === 'overlimit' && Math.max(client.downloadPct, client.uploadPct) < 70) return false;
      return true;
    });

    result = [...result].sort((a, b) => this.compareClients(a, b, this.sortBy()));
    return result;
  });

  totalPages = computed(() => Math.max(1, Math.ceil(this.filteredClients().length / this.pageSize())));
  pagedClients = computed(() => {
    const page = Math.min(this.page(), this.totalPages());
    const start = (page - 1) * this.pageSize();
    return this.filteredClients().slice(start, start + this.pageSize());
  });
  rangeStart = computed(() => this.filteredClients().length ? ((this.page() - 1) * this.pageSize()) + 1 : 0);
  rangeEnd = computed(() => Math.min(this.page() * this.pageSize(), this.filteredClients().length));
  nextRefreshSeconds = computed(() => {
    if (this.paused()) return 0;
    return Math.max(0, Math.ceil((this.nextRefreshAt() - this.nowTick()) / 1000));
  });
  syncHealthy = computed(() => {
    const sync = this.syncStatus();
    const result = sync?.lastSyncResult;
    return !!result && result.status === 'success' && result.sources?.wisphub === 'ok'
      && result.sources?.mikrotik === 'ok' && result.errors === 0;
  });
  wanDownloadPct = computed(() => {
    const wan = this.wan();
    return wan?.maxBps ? Math.min(100, (wan.rxBps / wan.maxBps) * 100) : 0;
  });
  wanUploadPct = computed(() => {
    const wan = this.wan();
    return wan?.maxBps ? Math.min(100, (wan.txBps / wan.maxBps) * 100) : 0;
  });
  wanTotalBps = computed(() => (this.wan()?.rxBps || 0) + (this.wan()?.txBps || 0));
  selectedDownloadPath = computed(() => this.sparklinePath(this.selectedHistory(), 'download', 320, 64));
  selectedUploadPath = computed(() => this.sparklinePath(this.selectedHistory(), 'upload', 320, 64));

  ngOnInit(): void {
    this.paused.set(this.storageGet(STORAGE_PAUSED) === '1');
    const savedInterval = Number(this.storageGet(STORAGE_INTERVAL) || 3000);
    if ([3000, 5000, 10000, 30000].includes(savedInterval)) this.refreshMs = savedInterval;
    this.effectiveRefreshMs.set(this.refreshMs);

    this.refresh(true);
    this.refreshSupportingData();
    this.supportTimer = setInterval(() => this.refreshSupportingData(), 15000);
    this.clockTimer = setInterval(() => this.nowTick.set(Date.now()), 1000);
  }

  ngOnDestroy(): void {
    this.stopRefreshTimer();
    if (this.supportTimer) clearInterval(this.supportTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
  }

  refresh(manual = false): void {
    if (this.refreshInProgress) return;
    this.refreshInProgress = true;
    this.refreshing.set(true);
    if (manual) this.errorMessage.set('');

    this.mt.getLiveClients().subscribe({
      next: data => {
        const response = data as LiveResponse;
        this.stats.set({ ...EMPTY_STATS, ...response.stats });
        this.allClients.set(response.clients || []);
        this.lastUpdate.set(new Date(response.timestamp));
        this.captureTraffic(response.clients || []);
        this.detectAnomalies(response.clients || []);
        this.keepSelectedClientFresh(response.clients || []);
        this.loading.set(false);
        this.errorMessage.set('');
        this.finishRefresh(true);
      },
      error: error => {
        this.loading.set(false);
        this.errorMessage.set(error?.error?.error || 'No se pudo consultar MikroTik. Reintentaremos automáticamente.');
        this.finishRefresh(false);
      },
    });

    this.mt.getWanTraffic().subscribe({
      next: wan => this.wan.set(wan),
      error: () => this.wan.set(null),
    });
  }

  manualRefresh(): void {
    this.refresh(true);
    this.refreshSupportingData();
  }

  togglePause(): void {
    const next = !this.paused();
    this.paused.set(next);
    this.storageSet(STORAGE_PAUSED, next ? '1' : '0');
    if (next) this.stopRefreshTimer();
    else {
      this.refresh(true);
    }
  }

  changeInterval(value: number): void {
    this.refreshMs = Number(value);
    this.consecutiveRefreshFailures = 0;
    this.effectiveRefreshMs.set(this.refreshMs);
    this.storageSet(STORAGE_INTERVAL, String(this.refreshMs));
    if (!this.paused()) this.startRefreshTimer();
  }

  runSync(): void {
    if (this.syncingNow()) return;
    this.syncingNow.set(true);
    this.sync.runServerSync().subscribe({
      next: result => {
        this.syncingNow.set(false);
        this.toast.success(`Sincronización completa: ${result?.updated || 0} clientes, ${result?.errors || 0} errores`);
        this.refreshSupportingData();
        this.refresh(true);
      },
      error: error => {
        this.syncingNow.set(false);
        this.toast.error(error?.error?.error || 'No se pudo ejecutar la sincronización');
      },
    });
  }

  setView(view: LiveView): void {
    this.activeView.set(view);
    this.quickFilter.set('all');
    this.page.set(1);
  }

  setQuickFilter(filter: QuickFilter): void {
    this.quickFilter.set(filter);
    this.page.set(1);
  }

  updateSearch(value: string): void {
    this.search.set(value);
    this.page.set(1);
  }

  updateZone(value: string): void {
    this.zoneFilter.set(value);
    this.page.set(1);
  }

  updatePlan(value: string): void {
    this.planFilter.set(value);
    this.page.set(1);
  }

  updateInterface(value: string): void {
    this.interfaceFilter.set(value);
    this.page.set(1);
  }

  updateSort(value: SortMode): void {
    this.sortBy.set(value);
    this.page.set(1);
  }

  clearFilters(): void {
    this.search.set('');
    this.zoneFilter.set('');
    this.planFilter.set('');
    this.interfaceFilter.set('');
    this.quickFilter.set('all');
    this.sortBy.set('priority');
    this.page.set(1);
  }

  hasActiveFilters(): boolean {
    return !!(this.search() || this.zoneFilter() || this.planFilter() || this.interfaceFilter() || this.quickFilter() !== 'all' || this.sortBy() !== 'priority');
  }

  setPage(page: number): void {
    this.page.set(Math.min(Math.max(1, page), this.totalPages()));
  }

  setPageSize(value: number): void {
    this.pageSize.set(Number(value));
    this.page.set(1);
  }

  selectClient(client: LiveClient): void {
    this.selectedClient.set(client);
    this.selectedHistory.set([...(this.historyByIp.get(client.ip || this.clientKey(client)) || [])]);
    this.pingResult.set('');
    this.loadClientContext(client);
  }

  closeDrawer(): void {
    this.selectedClient.set(null);
    this.equipment.set([]);
    this.events.set([]);
    this.pingResult.set('');
  }

  pingSelected(): void {
    const client = this.selectedClient();
    if (!client?.ip || this.pinging()) return;
    this.pinging.set(true);
    this.pingResult.set('Consultando...');
    this.mt.ping(client.ip, 4).subscribe({
      next: rows => {
        const times = rows
          .map(row => this.parseLatency(row?.time || row?.['avg-rtt']))
          .filter((value): value is number => value !== null);
        if (!times.length) this.pingResult.set('Sin respuesta');
        else this.pingResult.set(`${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)} ms · ${times.length}/4`);
        this.pinging.set(false);
      },
      error: () => {
        this.pingResult.set('Sin respuesta');
        this.pinging.set(false);
      },
    });
  }

  copyIp(): void {
    const ip = this.selectedClient()?.ip;
    if (!ip) return;
    navigator.clipboard?.writeText(ip)
      .then(() => this.toast.success('IP copiada'))
      .catch(() => this.toast.info(ip));
  }

  openWhatsapp(): void {
    const phone = String(this.selectedClient()?.client?.phone || '').replace(/\D/g, '');
    if (!phone) {
      this.toast.info('Este cliente no tiene teléfono registrado');
      return;
    }
    const normalized = phone.length === 10 ? `1${phone}` : phone;
    window.open(`https://wa.me/${normalized}`, '_blank', 'noopener,noreferrer');
  }

  blockSelected(): void {
    const selected = this.selectedClient();
    if (!selected?.client?.paymentPilotEnabled) {
      this.toast.info('Habilita primero el piloto del portal para este cliente');
      return;
    }
    this.applyAction('block');
  }

  setPaymentPilot(enabled: boolean): void {
    const selected = this.selectedClient();
    if (!selected?.client?.id || this.actionLoading()) return;
    const label = enabled ? 'Habilitar' : 'Deshabilitar';
    if (!confirm(`${label} el piloto del portal de pago para ${this.displayName(selected)}?\n\nEsto no cambia el servicio por si solo.`)) return;

    this.actionLoading.set(true);
    this.actions.setPaymentPilot(selected.client.id, enabled).subscribe({
      next: result => {
        this.actionLoading.set(false);
        this.patchPaymentPilot(result.paymentPilotEnabled, result.paymentPilotEnabledAt || null);
        this.toast.success(`Piloto ${enabled ? 'habilitado' : 'deshabilitado'} para este cliente`);
      },
      error: error => {
        this.actionLoading.set(false);
        this.toast.error(error?.error?.error || 'No se pudo cambiar el piloto');
      },
    });
  }

  previewPaymentPortal(): void {
    const ip = this.selectedClient()?.ip;
    if (!ip) return;
    window.open(`/captive?ip=${encodeURIComponent(ip)}&preview=blocked`, '_blank', 'noopener,noreferrer');
  }

  markOverdueSelected(): void {
    this.applyAction('moroso');
  }

  clearSelected(): void {
    this.applyAction('clear');
  }

  clientKey(client: LiveClient): string {
    return client.client?.id ? `client-${client.client.id}` : `queue-${client.queueName}-${client.ip}`;
  }

  displayName(client: LiveClient): string {
    return client.client?.name || client.queueName || 'Sin nombre';
  }

  isOverdue(client: LiveClient): boolean {
    const action = this.normalize(client.client?.crmAction);
    const invoice = this.normalize(client.client?.invoiceStatus);
    return action === 'moroso' || invoice.includes('vencid') || invoice.includes('pendiente');
  }

  hasIncident(client: LiveClient): boolean {
    return !client.isOnline || client.isDisabled || client.syncState !== 'synced' || this.isOverdue(client) || Math.max(client.downloadPct, client.uploadPct) >= 70;
  }

  connectionLabel(client: LiveClient): string {
    if (client.syncState === 'missing_ip') return 'Sin IP';
    if (client.isDisabled) return 'Deshabilitado';
    if (client.isOnline && client.isTransmitting) return 'Transmitiendo';
    if (client.isOnline) return 'En línea';
    return 'Sin presencia';
  }

  syncLabel(state: SyncState): string {
    const labels: Record<SyncState, string> = {
      synced: 'Sin diferencias',
      missing_wisphub: 'Solo MikroTik',
      missing_mikrotik: 'Sin cola MikroTik',
      missing_ip: 'Sin IP',
      queue_mismatch: 'Cola diferente',
      state_mismatch: 'Estado diferente',
    };
    return labels[state] || 'Revisar';
  }

  eventLabel(action: string): string {
    const labels: Record<string, string> = { block: 'Servicio bloqueado', moroso: 'Marcado como moroso', unblock: 'Servicio reactivado' };
    return labels[action] || action;
  }

  formatBps(bps: number): string {
    if (!bps || bps < 1) return '0 bps';
    if (bps < 1000) return `${Math.round(bps)} bps`;
    if (bps < 1_000_000) return `${(bps / 1000).toFixed(1)} Kbps`;
    if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(bps >= 10_000_000 ? 1 : 2)} Mbps`;
    return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
  }

  formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  }

  formatMoney(value?: string | null): string {
    const amount = Number(value || 0);
    return new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 0 }).format(Number.isFinite(amount) ? amount : 0);
  }

  formatClock(date?: Date | string | null): string {
    if (!date) return 'Sin datos';
    const parsed = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(parsed.getTime())) return 'Sin datos';
    return parsed.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  formatDateTime(date?: string | null): string {
    if (!date) return 'Sin registro';
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return 'Sin registro';
    return parsed.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  syncAge(): string {
    const date = this.syncStatus()?.lastSyncAt;
    if (!date) return 'Sin sincronización';
    const diffSeconds = Math.max(0, Math.floor((this.nowTick() - new Date(date).getTime()) / 1000));
    if (diffSeconds < 60) return `hace ${diffSeconds} s`;
    if (diffSeconds < 3600) return `hace ${Math.floor(diffSeconds / 60)} min`;
    return `hace ${Math.floor(diffSeconds / 3600)} h`;
  }

  clientSparkline(client: LiveClient, key: 'upload' | 'download'): string {
    return this.sparklinePath(this.historyByIp.get(client.ip || this.clientKey(client)) || [], key, 92, 28);
  }

  private refreshSupportingData(): void {
    this.mt.getStatus().subscribe({
      next: status => this.status.set(status),
      error: () => this.status.update(current => ({ ...current, connected: false })),
    });
    this.sync.getServerStatus().subscribe({
      next: status => this.syncStatus.set(status),
      error: () => this.syncStatus.set(null),
    });
  }

  private finishRefresh(success: boolean): void {
    this.refreshInProgress = false;
    this.refreshing.set(false);
    if (success) {
      this.consecutiveRefreshFailures = 0;
      this.effectiveRefreshMs.set(this.refreshMs);
    } else {
      this.consecutiveRefreshFailures += 1;
      this.effectiveRefreshMs.set(Math.min(30_000, this.refreshMs * (2 ** Math.min(3, this.consecutiveRefreshFailures))));
    }
    this.purgeAlerts();
    if (!this.paused()) this.startRefreshTimer();
  }

  private startRefreshTimer(): void {
    this.stopRefreshTimer();
    const delay = this.effectiveRefreshMs();
    this.nextRefreshAt.set(Date.now() + delay);
    this.refreshTimer = setTimeout(() => this.refresh(), delay);
  }

  private stopRefreshTimer(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  private captureTraffic(clients: LiveClient[]): void {
    const now = Date.now();
    for (const client of clients) {
      const key = client.ip || this.clientKey(client);
      const history = this.historyByIp.get(key) || [];
      history.push({ t: now, upload: client.uploadBps, download: client.downloadBps });
      if (history.length > TRAFFIC_HISTORY_LIMIT) history.splice(0, history.length - TRAFFIC_HISTORY_LIMIT);
      this.historyByIp.set(key, history);
    }
    const selected = this.selectedClient();
    if (selected) this.selectedHistory.set([...(this.historyByIp.get(selected.ip || this.clientKey(selected)) || [])]);
  }

  private detectAnomalies(clients: LiveClient[]): void {
    for (const client of clients) {
      if (!client.client) continue;
      const key = client.ip || this.clientKey(client);
      const name = this.displayName(client);
      const usage = Math.max(client.downloadPct, client.uploadPct);
      const wasOnline = this.previousOnline.get(key);

      if (wasOnline === true && !client.isOnline) {
        this.pushAlert('offline', key, name, 'Perdió presencia en MikroTik');
      }
      this.previousOnline.set(key, client.isOnline);

      if (usage > 80) {
        const ticks = (this.overLimitTicks.get(key) || 0) + 1;
        this.overLimitTicks.set(key, ticks);
        if (ticks === 3) this.pushAlert('limit', key, name, `${usage.toFixed(0)}% del plan durante tres lecturas`);
      } else {
        this.overLimitTicks.delete(key);
      }

      const history = this.recentDownload.get(key) || [];
      const average = history.length ? history.reduce((sum, value) => sum + value, 0) / history.length : 0;
      if (average > 100_000 && client.downloadBps > average * 5) {
        this.pushAlert('spike', key, name, `Pico de descarga: ${this.formatBps(client.downloadBps)}`);
      }
      history.push(client.downloadBps);
      if (history.length > 5) history.shift();
      this.recentDownload.set(key, history);
    }
  }

  private pushAlert(kind: LiveAlert['kind'], ip: string, name: string, message: string): void {
    const key = `${ip}|${kind}`;
    const now = Date.now();
    if (now - (this.alertCooldown.get(key) || 0) < 60_000) return;
    this.alertCooldown.set(key, now);
    this.alerts.update(alerts => [{ id: ++this.alertId, ts: now, kind, ip, name, message }, ...alerts].slice(0, 30));
  }

  private purgeAlerts(): void {
    const cutoff = Date.now() - ALERT_TTL_MS;
    this.alerts.update(alerts => alerts.filter(alert => alert.ts >= cutoff));
  }

  private keepSelectedClientFresh(clients: LiveClient[]): void {
    const selected = this.selectedClient();
    if (!selected) return;
    const fresh = clients.find(client => this.clientKey(client) === this.clientKey(selected));
    if (fresh) this.selectedClient.set(fresh);
  }

  private loadClientContext(client: LiveClient): void {
    if (!client.client?.id) {
      this.equipment.set([]);
      this.events.set([]);
      return;
    }
    this.contextLoading.set(true);
    forkJoin({
      equipment: this.http.get<EquipmentLite[]>(`/clients/${client.client.id}/equipment`).pipe(catchError(() => of([]))),
      events: this.actions.events(client.client.id).pipe(catchError(() => of([]))),
    }).subscribe(({ equipment, events }) => {
      this.equipment.set(equipment);
      this.events.set((events as BlockEvent[]).slice(0, 8));
      this.contextLoading.set(false);
    });
  }

  private applyAction(action: 'block' | 'moroso' | 'clear'): void {
    const selected = this.selectedClient();
    if (!selected?.client?.id || !selected.ip || this.actionLoading()) return;
    const labels = {
      block: `¿Desactivar el servicio de ${this.displayName(selected)} y mostrarle solamente el portal de pago?`,
      moroso: `¿Marcar como moroso a ${this.displayName(selected)}?`,
      clear: `¿Reactivar el servicio de ${this.displayName(selected)}?`,
    };
    if (!confirm(labels[action])) return;

    this.actionLoading.set(true);
    const reason = action === 'block' ? 'Desactivado manualmente con portal de pago' : action === 'moroso' ? 'Moroso desde monitoreo En vivo' : 'Reactivado desde monitoreo En vivo';
    this.actions.apply(selected.client.id, action, reason, action === 'block').subscribe({
      next: result => {
        this.actionLoading.set(false);
        if (!result.ok) {
          this.toast.error(result.error || 'No se pudo completar la acción');
          return;
        }
        const success = action === 'block' ? 'Servicio bloqueado' : action === 'moroso' ? 'Cliente marcado como moroso' : 'Servicio reactivado';
        this.toast.success(success);
        this.refresh(true);
        this.loadClientContext(selected);
      },
      error: error => {
        this.actionLoading.set(false);
        this.toast.error(error?.error?.error || 'No se pudo completar la acción');
      },
    });
  }

  private patchPaymentPilot(enabled: boolean, enabledAt: string | null): void {
    const current = this.selectedClient();
    if (!current?.client) return;
    const updated: LiveClient = {
      ...current,
      client: { ...current.client, paymentPilotEnabled: enabled, paymentPilotEnabledAt: enabledAt },
    };
    this.selectedClient.set(updated);
    this.allClients.update(clients => clients.map(client => this.clientKey(client) === this.clientKey(current) ? updated : client));
  }

  private compareClients(a: LiveClient, b: LiveClient, sort: SortMode): number {
    if (sort === 'traffic') return (b.downloadBps + b.uploadBps) - (a.downloadBps + a.uploadBps);
    if (sort === 'name') return this.displayName(a).localeCompare(this.displayName(b), 'es');
    if (sort === 'zone') return String(a.client?.zone || '').localeCompare(String(b.client?.zone || ''), 'es');
    if (sort === 'uptime') return this.uptimeSeconds(b.sessionUptime) - this.uptimeSeconds(a.sessionUptime);

    const priority = (client: LiveClient) => {
      if (client.syncState === 'missing_ip') return 0;
      if (!client.isOnline) return 1;
      if (client.syncState !== 'synced') return 2;
      if (client.isDisabled || this.isOverdue(client)) return 3;
      if (Math.max(client.downloadPct, client.uploadPct) >= 70) return 4;
      return 5;
    };
    return priority(a) - priority(b) || (b.downloadBps + b.uploadBps) - (a.downloadBps + a.uploadBps);
  }

  private uptimeSeconds(value?: string | null): number {
    if (!value) return 0;
    const units: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
    let total = 0;
    for (const match of value.matchAll(/(\d+)([wdhms])/g)) total += Number(match[1]) * units[match[2]];
    return total;
  }

  private sparklinePath(data: TrafficSample[], key: 'upload' | 'download', width: number, height: number): string {
    if (data.length < 2) return '';
    const max = Math.max(...data.map(sample => sample[key]), 1);
    return data.map((sample, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((sample[key] / max) * (height - 4)) - 2;
      return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  private parseLatency(value: unknown): number | null {
    const match = String(value || '').match(/[\d.]+/);
    return match ? Number(match[0]) : null;
  }

  private uniqueSorted(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, 'es'));
  }

  private normalize(value: unknown): string {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  private storageGet(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  private storageSet(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch {}
  }
}
