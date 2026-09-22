import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideActivity, LucideAlertTriangle, LucideChevronLeft, LucideChevronRight,
  LucideCircleCheck, LucideClock3, LucideCopy, LucideDownload, LucideExternalLink, LucideGauge, LucideMapPin, LucideRefreshCw,
  LucideSearch, LucideServer, LucideSignal, LucideTrophy, LucideWifi, LucideX,
} from '@lucide/angular';
import { forkJoin, of, switchMap, map } from 'rxjs';
import { NavbarComponent } from '../../components/layout/navbar';
import { PlanLabelPipe } from '../../pipes/plan-label.pipe';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import {
  ClientAuditPage, ClientAuditRow, ClientNetworkSample, NetworkAuditService,
  NetworkAuditStatus, NetworkHealthState, WanAuditResponse,
} from '../../services/network-audit.service';
import { AuditInsightsComponent, AuditTrend } from './audit-insights';
import { ClientChartsComponent } from './client-charts';
import { MetricsHelpComponent } from './metrics-help';
import { WanInsightsComponent } from './wan-insights';
import { DEFAULT_INTERVAL_MS, formatDuration, hoursFromSamples, relativeTime } from './audit-utils';

type AuditView = 'clients' | 'insights' | 'wan';
const VIEW_KEY = 'ispmax.networkAudit.view';

@Component({
  selector: 'app-network-audit',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, FormsModule, RouterLink, NavbarComponent, PlanLabelPipe,
    AuditInsightsComponent, ClientChartsComponent, MetricsHelpComponent, WanInsightsComponent,
    LucideActivity, LucideAlertTriangle, LucideChevronLeft, LucideChevronRight,
    LucideCircleCheck, LucideClock3, LucideCopy, LucideDownload, LucideExternalLink, LucideGauge, LucideMapPin, LucideRefreshCw,
    LucideSearch, LucideServer, LucideSignal, LucideTrophy, LucideWifi, LucideX,
  ],
  templateUrl: './network-audit.html',
  styleUrl: './network-audit.scss',
  host: { '(document:keydown.escape)': 'selected() && closeDetail()' },
})
export class NetworkAuditComponent implements OnInit {
  private readonly audit = inject(NetworkAuditService);
  private readonly toast = inject(ToastService);
  readonly auth = inject(AuthService);

  status = signal<NetworkAuditStatus | null>(null);
  pageData = signal<ClientAuditPage | null>(null);
  wan = signal<WanAuditResponse | null>(null);
  loading = signal(true);
  collecting = signal(false);
  error = signal('');
  view = signal<AuditView>(this.savedView());
  search = signal('');
  state = signal('all');
  days = signal(30);
  page = signal(1);
  pageSize = 50;
  selected = signal<ClientAuditRow | null>(null);
  detail = signal<ClientNetworkSample[]>([]);
  detailDaily = signal<any[]>([]);
  detailLoading = signal(false);
  exporting = signal(false);

  /** Análisis «Lo peor primero»: todos los clientes del período, pedido una sola vez al abrir la pestaña. */
  insightsRows = signal<ClientAuditRow[]>([]);
  insightsTrend = signal<AuditTrend | null>(null);
  insightsLoading = signal(false);
  insightsError = signal('');
  private insightsDays: number | null = null;

  totalPages = computed(() => this.pageData()?.pages || 1);
  latestWan = computed(() => this.status()?.latestWan || this.wan()?.items?.[0] || null);
  hasFilters = computed(() => !!this.search().trim() || this.state() !== 'all' || this.days() !== 30);
  intervalMs = computed(() => this.status()?.intervalMs || DEFAULT_INTERVAL_MS);
  lastReadingRel = computed(() => relativeTime(this.status()?.lastSuccessAt || this.latestWan()?.capturedAt || null));

  ngOnInit(): void {
    this.load();
    if (this.view() === 'insights') this.loadInsights();
  }

  private savedView(): AuditView {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      return saved === 'insights' || saved === 'wan' ? saved : 'clients';
    } catch { return 'clients'; }
  }

  /** Botón «Actualizar»: recarga la vista actual (y el análisis si está abierto). */
  refresh(): void {
    this.load();
    if (this.view() === 'insights') this.loadInsights(true);
  }

  /**
   * Trae todos los clientes del período en páginas de 200 (las mismas que usa «Exportar CSV») y el resumen del
   * doble de días para comparar con el período anterior. Solo se pide al abrir la pestaña o al cambiar el período.
   */
  loadInsights(force = false): void {
    const days = this.days();
    if (!force && this.insightsDays === days && (this.insightsRows().length || this.insightsLoading())) return;
    this.insightsDays = days;
    this.insightsLoading.set(true);
    this.insightsError.set('');
    const pageSize = 200;
    forkJoin({
      first: this.audit.clients({ days, page: 1, pageSize }),
      double: this.audit.clients({ days: Math.min(days * 2, 3650), page: 1, pageSize: 10 }),
    }).pipe(
      switchMap(({ first, double }) => {
        const rest = Array.from({ length: Math.max(0, first.pages - 1) }, (_, i) => this.audit.clients({ days, page: i + 2, pageSize }));
        return (rest.length ? forkJoin(rest) : of([] as ClientAuditPage[])).pipe(map(pages => ({ first, double, pages })));
      }),
    ).subscribe({
      next: ({ first, double, pages }) => {
        if (this.insightsDays !== days) return;
        const rows = [first, ...pages].flatMap(page => page.items);
        this.insightsRows.set(rows);
        this.insightsTrend.set(this.buildTrend(first, double, rows));
        this.insightsLoading.set(false);
      },
      error: error => {
        if (this.insightsDays !== days) return;
        this.insightsDays = null;
        this.insightsError.set(error?.error?.error || 'Revise la conexión e intente de nuevo.');
        this.insightsLoading.set(false);
      },
    });
  }

  /** Compara el período actual con el anterior restando el resumen de N días al de 2N días. */
  private buildTrend(current: ClientAuditPage, double: ClientAuditPage, rows: ClientAuditRow[]): AuditTrend {
    const cur = current.summary;
    const dbl = double.summary;
    const interval = this.intervalMs();
    const online = (s: ClientAuditPage['summary']) => s.totalSamples * s.availabilityPercent / 100;
    const stable = (s: ClientAuditPage['summary']) => s.totalSamples * s.stabilityPercent / 100;
    const prevSamples = dbl.totalSamples - cur.totalSamples;
    const hasPrev = double.days > current.days && prevSamples > 0;
    const prevOffline = prevSamples - (online(dbl) - online(cur));
    return {
      availability: cur.availabilityPercent,
      stability: cur.stabilityPercent,
      downHours: hoursFromSamples(rows.reduce((sum, row) => sum + row.offlineSamples, 0), interval),
      clients: cur.monitoredClients,
      prevAvailability: hasPrev ? Math.max(0, Math.min(100, (online(dbl) - online(cur)) / prevSamples * 100)) : null,
      prevStability: hasPrev ? Math.max(0, Math.min(100, (stable(dbl) - stable(cur)) / prevSamples * 100)) : null,
      prevDownHours: hasPrev ? hoursFromSamples(Math.max(0, prevOffline), interval) : null,
    };
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      status: this.audit.status(),
      clients: this.audit.clients({ days: this.days(), q: this.search(), status: this.state(), page: this.page(), pageSize: this.pageSize }),
      wan: this.audit.wan(Math.min(24 * this.days(), 8760), 500),
    }).subscribe({
      next: result => {
        this.status.set(result.status);
        this.pageData.set(result.clients);
        this.wan.set(result.wan);
        this.loading.set(false);
      },
      error: error => {
        this.error.set(error?.error?.error || 'No se pudo cargar la auditoría de red. Revise la conexión e intente de nuevo.');
        this.loading.set(false);
      },
    });
  }

  applyFilters(): void {
    this.page.set(1);
    this.load();
    if (this.view() === 'insights') this.loadInsights();
  }
  clearFilters(): void { this.search.set(''); this.state.set('all'); this.days.set(30); this.page.set(1); this.load(); }
  setView(view: AuditView): void {
    this.view.set(view);
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* sin almacenamiento */ }
    if (view === 'insights') this.loadInsights();
  }

  changeDays(days: number): void {
    this.days.set(days);
    this.applyFilters();
  }

  changePage(delta: number): void {
    const next = Math.max(1, Math.min(this.totalPages(), this.page() + delta));
    if (next === this.page()) return;
    this.page.set(next);
    this.load();
  }

  collectNow(): void {
    if (this.collecting()) return;
    this.collecting.set(true);
    this.audit.collect().subscribe({
      next: result => {
        this.toast.success(`Medición lista: ${result.clientsStored || 0} lecturas nuevas guardadas`);
        this.collecting.set(false);
        this.load();
      },
      error: error => {
        this.toast.error(error?.error?.error || 'No se pudo hacer la medición. Intente de nuevo en unos minutos.');
        this.collecting.set(false);
      },
    });
  }

  openDetail(row: ClientAuditRow): void {
    this.selected.set(row);
    this.detail.set([]);
    this.detailDaily.set([]);
    this.detailLoading.set(true);
    this.audit.clientDetail(row.idServicio, Math.min(this.days(), 14)).subscribe({
      next: result => {
        if (this.selected()?.idServicio !== row.idServicio) return;
        this.detail.set(result.samples);
        this.detailDaily.set(result.daily || []);
        this.detailLoading.set(false);
      },
      error: () => { this.detailLoading.set(false); this.toast.error('No se pudo cargar el detalle del cliente'); },
    });
  }

  closeDetail(): void { this.selected.set(null); this.detail.set([]); this.detailDaily.set([]); }

  async copy(value: string | null, what: string): Promise<void> {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      this.toast.success(`${what} copiada: ${value}`);
    } catch {
      this.toast.error('No se pudo copiar. Selecciónela y cópiela a mano.');
    }
  }

  rel(iso: string | null): string { return relativeTime(iso); }
  downHours(samples: number): string { return formatDuration(hoursFromSamples(samples, this.intervalMs()) * 3_600_000); }

  exportCsv(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    const pages = Math.max(1, Math.ceil((this.pageData()?.total || 0) / 200));
    const requests = Array.from({ length: pages }, (_, index) => this.audit.clients({
      days: this.days(), q: this.search(), status: this.state(), page: index + 1, pageSize: 200,
    }));
    forkJoin(requests).subscribe({
      next: results => {
        const rows = results.flatMap(result => result.items);
        const header = ['Cliente','Usuario','IP','Plan','Zona','Estado','Disponibilidad %','Estabilidad %','Promedio bajada Mbps','Pico bajada Mbps','Promedio subida Mbps','Pico subida Mbps','RX promedio dBm','ONU','Muestras','Última lectura'];
        const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const lines = [header, ...rows.map(row => [row.name,row.username,row.ip,row.plan,row.zone,this.stateLabel(row.latestState),row.availabilityPercent,row.stabilityPercent,row.avgDownloadMbps,row.peakDownloadMbps,row.avgUploadMbps,row.peakUploadMbps,row.avgRxPowerDbm,row.onuIndex,row.sampleCount,row.lastCapturedAt])];
        const blob = new Blob(['\ufeff' + lines.map(line => line.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `auditoria-red-${this.days()}d.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
        this.exporting.set(false);
        this.toast.success(`Archivo descargado con ${rows.length} clientes`);
      },
      error: () => { this.exporting.set(false); this.toast.error('No se pudo exportar la auditoría. Intente de nuevo.'); },
    });
  }

  stateLabel(state: NetworkHealthState | string): string {
    return ({ stable: 'Estable', degraded: 'Degradado', offline: 'Fuera de línea', unknown: 'Sin datos' } as Record<string, string>)[state] || state;
  }

  opticalLabel(state: string): string {
    return ({ healthy: 'Correcta', strong: 'Muy fuerte', weak: 'Débil', critical: 'Crítica', unknown: 'Sin lectura' } as Record<string, string>)[state] || state;
  }

  mbps(bps: number): number { return Number((Number(bps || 0) / 1e6).toFixed(2)); }
  issueLabel(value: string | null): string {
    if (!value) return 'Sin incidencias';
    const labels: Record<string, string> = {
      onu_offline: 'ONU fuera de línea',
      queue_disabled: 'cola de velocidad desactivada',
      missing_wisphub: 'cola sin cliente en el sistema',
      queue_mismatch: 'nombre de cola distinto al del sistema',
      state_mismatch: 'cola desactivada con cliente activo',
      optical_weak: 'señal óptica débil',
      optical_critical: 'señal óptica crítica',
      optical_strong: 'señal óptica demasiado fuerte',
      mikrotik_offline: 'sin conexión en el MikroTik',
      missing_mikrotik: 'sin lectura de MikroTik',
      client_offline: 'cliente sin conexión',
      high_utilization: 'uso elevado del plan',
      olt_offline: 'ONU fuera de línea',
      weak_optical_signal: 'señal óptica débil',
      critical_optical_signal: 'señal óptica crítica',
      missing_optical_data: 'sin lectura óptica',
    };
    return value.split(',').map(issue => labels[issue.trim()] || issue.trim()).join(', ');
  }
}
