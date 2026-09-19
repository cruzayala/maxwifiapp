import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideAlertTriangle, LucideArrowDown, LucideArrowRight, LucideArrowUp,
  LucideCircleCheck, LucideCircleDollarSign, LucideDatabase, LucideFileText,
  LucideGauge, LucideRadioTower, LucideRefreshCw, LucideRouter,
  LucideTriangleAlert, LucideUserPlus, LucideWifi,
} from '@lucide/angular';
import { firstValueFrom, timeout } from 'rxjs';
import { NavbarComponent } from '../../components/layout/navbar';
import { PlanLabelPipe } from '../../pipes/plan-label.pipe';
import { WispHubClient } from '../../models/client.model';
import { Invoice } from '../../models/invoice.model';
import { LocalDbService } from '../../services/local-db.service';
import { MikrotikService, MtLiveResponse, MtStatus } from '../../services/mikrotik.service';
import { NetworkAuditService, NetworkAuditStatus, WanAuditResponse } from '../../services/network-audit.service';
import { NocIncident, NocService, NocSummary } from '../../services/noc.service';
import { OltPon, OltService, OltStatus } from '../../services/olt.service';
import { ServerSyncStatus, SyncService } from '../../services/sync.service';

interface DashboardFinance {
  expected: number;
  billed: number;
  collected: number;
  pending: number;
  collectionRate: number;
  issuedCount: number;
  paidCount: number;
}

interface DashboardAttention {
  tone: 'critical' | 'warning' | 'info' | 'success';
  title: string;
  detail: string;
  route: string;
}

interface DashboardWanTraffic {
  ifaceName: string;
  rxBps: number;
  txBps: number;
  maxBps: number;
  degraded?: boolean;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    NavbarComponent, RouterLink, DecimalPipe, PlanLabelPipe, LucideAlertTriangle, LucideArrowDown,
    LucideArrowRight, LucideArrowUp, LucideCircleCheck, LucideCircleDollarSign,
    LucideDatabase, LucideFileText, LucideGauge, LucideRadioTower,
    LucideRefreshCw, LucideRouter, LucideTriangleAlert, LucideUserPlus, LucideWifi,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly db = inject(LocalDbService);
  readonly sync = inject(SyncService);
  private readonly mikrotikApi = inject(MikrotikService);
  private readonly oltApi = inject(OltService);
  private readonly nocApi = inject(NocService);
  private readonly auditApi = inject(NetworkAuditService);

  clients = signal<WispHubClient[]>([]);
  invoices = signal<Invoice[]>([]);
  live = signal<MtLiveResponse | null>(null);
  mikrotik = signal<MtStatus | null>(null);
  wan = signal<DashboardWanTraffic | null>(null);
  olt = signal<OltStatus | null>(null);
  pons = signal<OltPon[]>([]);
  noc = signal<NocSummary | null>(null);
  incidents = signal<NocIncident[]>([]);
  audit = signal<NetworkAuditStatus | null>(null);
  wanHistory = signal<WanAuditResponse | null>(null);
  syncStatus = signal<ServerSyncStatus | null>(null);
  signalAlerts = signal(0);
  loading = signal(true);
  refreshing = signal(false);
  sourceErrors = signal<string[]>([]);
  lastUpdated = signal<Date | null>(null);

  totalClients = computed(() => this.clients().length);
  activeClients = computed(() => this.clients().filter(client => this.normalized(client.estado) === 'activo').length);
  suspendedClients = computed(() => this.clients().filter(client => ['suspendido', 'cortado', 'retirado'].includes(this.normalized(client.estado))).length);
  pendingClients = computed(() => this.clients().filter(client => {
    const state = this.normalized(client.estado_facturas);
    return state.includes('pendiente') || state.includes('vencid') || state.includes('moros');
  }).sort((a, b) => this.clientDebt(b) - this.clientDebt(a)));

  finance = computed<DashboardFinance>(() => {
    const active = this.clients().filter(client => this.normalized(client.estado) === 'activo');
    const monthInvoices = this.invoices().filter(invoice => this.inCurrentMonth(invoice.fecha_emision));
    const paidThisMonth = this.invoices().filter(invoice => this.inCurrentMonth(invoice.fecha_pago));
    const billed = monthInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    const collectedFromMonth = monthInvoices.reduce((sum, invoice) => sum + Number(invoice.total_cobrado || 0), 0);
    return {
      expected: active.reduce((sum, client) => sum + Number(client.precio_plan || 0), 0),
      billed,
      collected: paidThisMonth.reduce((sum, invoice) => sum + Number(invoice.total_cobrado || 0), 0),
      pending: monthInvoices.reduce((sum, invoice) => sum + Number(invoice.saldo || 0), 0),
      collectionRate: billed > 0 ? Math.min(100, (collectedFromMonth / billed) * 100) : 0,
      issuedCount: monthInvoices.length,
      paidCount: paidThisMonth.length,
    };
  });

  topPlans = computed(() => {
    const counts = new Map<string, number>();
    for (const client of this.clients()) {
      const name = client.plan_internet?.nombre || 'Sin plan';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const shown: Array<[string, number]> = sorted.slice(0, 6);
    const remainder = sorted.slice(6).reduce((sum, [, count]) => sum + count, 0);
    if (remainder) shown.push(['Otros planes', remainder]);
    const max = shown[0]?.[1] || 1;
    return shown.map(([name, count]) => ({ name, count, pct: Math.max(3, count / max * 100) }));
  });

  wanUtilization = computed(() => {
    const value = this.wan();
    if (!value?.maxBps) return 0;
    return Math.min(100, Math.max(value.rxBps, value.txBps) / value.maxBps * 100);
  });

  attention = computed<DashboardAttention[]>(() => {
    const items: DashboardAttention[] = [];
    const noc = this.noc();
    const olt = this.olt();
    const live = this.live();
    const audit = this.audit();
    if ((noc?.critical || 0) > 0) items.push({ tone: 'critical', title: this.plural(noc!.critical, 'incidente crítico', 'incidentes críticos'), detail: `${this.plural(noc!.affectedClients, 'cliente afectado', 'clientes afectados')} por incidentes activos`, route: '/incidents' });
    else if ((noc?.active || 0) > 0) items.push({ tone: 'warning', title: this.plural(noc!.active, 'incidente activo', 'incidentes activos'), detail: noc!.open === 1 ? '1 todavía no ha sido reconocido' : `${noc!.open} todavía no han sido reconocidos`, route: '/incidents' });
    if (olt && !olt.connected) items.push({ tone: 'critical', title: 'OLT sin telemetría reciente', detail: 'Revise la conexión con la OLT y su última lectura', route: '/olt' });
    if ((olt?.totals.offlineOnus || 0) > 0) items.push({ tone: 'warning', title: `${olt!.totals.offlineOnus} ${olt!.totals.offlineOnus === 1 ? 'ONU' : 'ONUs'} fuera de línea`, detail: `${olt!.totals.onlineOnus} siguen en línea`, route: '/olt' });
    if (this.signalAlerts() > 0) items.push({ tone: 'warning', title: this.plural(this.signalAlerts(), 'alerta de señal óptica', 'alertas de señal óptica'), detail: 'Potencia débil, crítica o con caída reciente', route: '/olt' });
    if ((olt?.totals.unconfiguredOnus || 0) > 0) items.push({ tone: 'info', title: `${olt!.totals.unconfiguredOnus} ${olt!.totals.unconfiguredOnus === 1 ? 'ONU' : 'ONUs'} por autorizar`, detail: 'Equipos detectados que esperan aprovisionamiento', route: '/olt' });
    if ((live?.stats.differences || 0) > 0) items.push({ tone: 'info', title: this.plural(live!.stats.differences, 'diferencia entre WispHub y MikroTik', 'diferencias entre WispHub y MikroTik'), detail: 'Revise los clientes marcados en Monitoreo en vivo', route: '/live' });
    if ((audit?.lastError || '').trim()) items.push({ tone: 'warning', title: 'Auditoría de red degradada', detail: audit!.lastError!, route: '/auditoria-red' });
    if (items.length === 0) items.push({ tone: 'success', title: 'Operación estable', detail: 'No hay alertas prioritarias en las fuentes conectadas', route: '/live' });
    return items.slice(0, 5);
  });

  ponAttention = computed(() => [...this.pons()]
    .filter(pon => pon.health !== 'healthy' || pon.offline > 0 || pon.weak > 0 || pon.critical > 0)
    .sort((a, b) => (b.critical - a.critical) || (b.offline - a.offline) || (b.weak - a.weak))
    .slice(0, 5));

  networkState = computed<'stable' | 'warning' | 'offline'>(() => {
    if (this.mikrotik() && !this.mikrotik()!.connected) return 'offline';
    if (this.audit()?.latestWan?.healthState === 'offline') return 'offline';
    if ((this.noc()?.critical || 0) > 0 || this.olt()?.connected === false ||
        (this.olt()?.totals.offlineOnus || 0) > 0 || this.signalAlerts() > 0 ||
        this.audit()?.latestWan?.healthState === 'degraded') return 'warning';
    return 'stable';
  });

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    await this.load(true);
    this.refreshTimer = setInterval(() => this.load(false), 60_000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  async load(initial = false): Promise<void> {
    if (initial) this.loading.set(true);
    else this.refreshing.set(true);
    const errors: string[] = [];
    const settled = await Promise.allSettled<any>([
      this.db.getClients(),
      this.db.getInvoices(),
      firstValueFrom(this.mikrotikApi.getStatus().pipe(timeout(15_000))),
      firstValueFrom(this.mikrotikApi.getLiveClients().pipe(timeout(30_000))),
      firstValueFrom(this.mikrotikApi.getWanTraffic().pipe(timeout(15_000))),
      firstValueFrom(this.oltApi.getStatus().pipe(timeout(15_000))),
      firstValueFrom(this.oltApi.getPons().pipe(timeout(15_000))),
      firstValueFrom(this.oltApi.getSignalAlerts(true).pipe(timeout(15_000))),
      firstValueFrom(this.nocApi.summary().pipe(timeout(15_000))),
      firstValueFrom(this.nocApi.incidents({ status: 'active', page: 1, pageSize: 10 }).pipe(timeout(15_000))),
      firstValueFrom(this.auditApi.status().pipe(timeout(15_000))),
      firstValueFrom(this.auditApi.wan(24, 160).pipe(timeout(15_000))),
      firstValueFrom(this.sync.getServerStatus().pipe(timeout(15_000))),
    ]);
    const read = <T>(index: number, source: string): T | null => {
      const result = settled[index];
      if (result.status === 'fulfilled') return result.value as T;
      errors.push(source);
      return null;
    };
    const clients = read<WispHubClient[]>(0, 'Clientes');
    const invoices = read<Invoice[]>(1, 'Facturas');
    const mikrotik = read<MtStatus>(2, 'MikroTik');
    const live = read<MtLiveResponse>(3, 'Monitoreo en vivo');
    const wan = read<DashboardWanTraffic>(4, 'Tráfico WAN');
    const olt = read<OltStatus>(5, 'OLT');
    const pons = read<OltPon[]>(6, 'Puertos PON');
    const signalAlerts = read<any[]>(7, 'Señal óptica');
    const noc = read<NocSummary>(8, 'Centro NOC');
    const incidents = read<{ items: NocIncident[] }>(9, 'Incidentes');
    const audit = read<NetworkAuditStatus>(10, 'Auditoría de red');
    const wanHistory = read<WanAuditResponse>(11, 'Historial WAN');
    const syncStatus = read<ServerSyncStatus>(12, 'Sincronización');

    if (clients) this.clients.set(clients);
    if (invoices) this.invoices.set(invoices);
    if (mikrotik) this.mikrotik.set(mikrotik);
    if (live) this.live.set(live);
    if (wan) this.wan.set(wan);
    if (olt) this.olt.set(olt);
    if (pons) this.pons.set(pons);
    if (signalAlerts) this.signalAlerts.set(signalAlerts.length);
    if (noc) this.noc.set(noc);
    if (incidents) this.incidents.set(incidents.items);
    if (audit) this.audit.set(audit);
    if (wanHistory) this.wanHistory.set(wanHistory);
    if (syncStatus) this.syncStatus.set(syncStatus);
    this.sourceErrors.set(errors);
    this.lastUpdated.set(new Date());
    this.loading.set(false);
    this.refreshing.set(false);
  }

  async syncAll(): Promise<void> {
    await this.sync.syncAll();
    await this.load(false);
  }

  monthLabel(): string {
    const value = new Intl.DateTimeFormat('es-DO', { month: 'long', year: 'numeric' }).format(new Date());
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  sourceTitle(source: 'wisphub' | 'mikrotik' | 'olt'): string {
    const names = { wisphub: 'WispHub', mikrotik: 'MikroTik', olt: 'OLT' };
    return `${names[source]}: ${this.sourceOnline(source) ? 'conectado' : 'sin conexión'}`;
  }

  sourceOnline(source: 'wisphub' | 'mikrotik' | 'olt'): boolean {
    if (source === 'wisphub') return this.syncStatus()?.lastSyncResult?.sources?.wisphub === 'ok';
    if (source === 'mikrotik') return Boolean(this.mikrotik()?.connected);
    return Boolean(this.olt()?.connected);
  }

  formatBits(value: number | null | undefined): string {
    const bps = Math.max(0, Number(value || 0));
    if (bps >= 1e9) return `${(bps / 1e9).toFixed(bps >= 10e9 ? 0 : 2)} Gbps`;
    if (bps >= 1e6) return `${(bps / 1e6).toFixed(bps >= 100e6 ? 0 : 1)} Mbps`;
    if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} Kbps`;
    return `${Math.round(bps)} bps`;
  }

  formatTime(value: string | Date | null | undefined): string {
    if (!value) return 'Sin lectura';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sin lectura';
    return date.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  clientDebt(client: WispHubClient): number {
    const balance = Number(client.saldo || 0);
    return balance > 0 ? balance : Number(client.precio_plan || 0);
  }

  private plural(count: number, singular: string, pluralText: string): string {
    return `${count} ${count === 1 ? singular : pluralText}`;
  }

  private normalized(value: string | null | undefined): string {
    return String(value || '').trim().toLowerCase();
  }

  private inCurrentMonth(value: string | null | undefined): boolean {
    if (!value) return false;
    const match = String(value).match(/^(\d{4})-(\d{2})/);
    const now = new Date();
    if (match) return Number(match[1]) === now.getFullYear() && Number(match[2]) === now.getMonth() + 1;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }
}
