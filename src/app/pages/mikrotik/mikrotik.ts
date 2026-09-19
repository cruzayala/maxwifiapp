import { Component, OnDestroy, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, of } from 'rxjs';
import {
  LucideActivity,
  LucideArrowDownToLine,
  LucideArrowUpFromLine,
  LucideBan,
  LucideCable,
  LucideChevronLeft,
  LucideChevronRight,
  LucideCircleAlert,
  LucideCircleCheck,
  LucideCircleGauge,
  LucideCopy,
  LucideDatabase,
  LucideDownload,
  LucideHardDrive,
  LucideNetwork,
  LucidePencil,
  LucideRadioTower,
  LucideRefreshCw,
  LucideRouter,
  LucideSave,
  LucideSearch,
  LucideShieldAlert,
  LucideShieldCheck,
  LucideSlidersHorizontal,
  LucideSquareTerminal,
  LucideTrash2,
  LucideUsers,
  LucideWifi,
  LucideWifiOff,
  LucideX,
} from '@lucide/angular';
import { NavbarComponent } from '../../components/layout/navbar';
import { AuthService } from '../../services/auth.service';
import {
  MikrotikService,
  MtBackup,
  MtFirewallResponse,
  MtFirewallRule,
  MtFirewallTable,
  MtIpamResponse,
  MtLiveClient,
  MtLiveResponse,
  MtNetwatch,
  MtSecurityAudit,
  MtStatus,
  MtSpeedTemplate,
  MtSystem,
  MtSyncState,
  MtTraffic,
  MtUnknownDevice,
  MtUnknownResponse,
} from '../../services/mikrotik.service';
import { ToastService } from '../../services/toast.service';
import { ExportService } from '../../services/export.service';
import { PlanLabelPipe } from '../../pipes/plan-label.pipe';
import { MtRouterHealthComponent } from './mt-router-health';
import { MtNetworkIssuesComponent } from './mt-network-issues';
import { MtIpGridComponent } from './mt-ip-grid';
import { MtGlobalSearchComponent, SearchTab } from './mt-global-search';
import { ISSUE_INFO, ISSUE_ORDER, IssueKind, compareIp, detectIssues, evaluateRouterHealth, normalizeMac, readPref, relativeTime, writePref } from './mt-utils';

type MikrotikTab = 'overview' | 'reconciliation' | 'unknown' | 'interfaces' | 'firewall' | 'ipam' | 'netwatch' | 'backups' | 'security';
type UnknownFilter = 'all' | 'high' | 'unmanaged' | 'infrastructure';
type SyncFilter = 'all' | 'differences' | 'online' | 'offline' | 'disabled' | Exclude<IssueKind, 'paused'>;
type ClientSort = 'default' | 'traffic' | 'total' | 'usage' | 'ip' | 'name';
type RankingMode = 'now' | 'total';
type IpamFilter = 'all' | 'available' | 'client' | 'occupied' | 'conflict';

interface WanTraffic {
  ifaceName: string;
  rxBps: number;
  txBps: number;
  rxPps: number;
  txPps: number;
  maxBps: number;
  timestamp: number;
}

@Component({
  selector: 'app-mikrotik',
  standalone: true,
  imports: [
    NavbarComponent,
    FormsModule,
    RouterLink,
    PlanLabelPipe,
    MtRouterHealthComponent,
    MtNetworkIssuesComponent,
    MtIpGridComponent,
    MtGlobalSearchComponent,
    LucideActivity,
    LucideArrowDownToLine,
    LucideArrowUpFromLine,
    LucideBan,
    LucideCable,
    LucideChevronLeft,
    LucideChevronRight,
    LucideCircleAlert,
    LucideCircleCheck,
    LucideCircleGauge,
    LucideCopy,
    LucideDatabase,
    LucideDownload,
    LucideHardDrive,
    LucideNetwork,
    LucidePencil,
    LucideRadioTower,
    LucideRefreshCw,
    LucideRouter,
    LucideSave,
    LucideSearch,
    LucideShieldAlert,
    LucideShieldCheck,
    LucideSlidersHorizontal,
    LucideSquareTerminal,
    LucideTrash2,
    LucideUsers,
    LucideWifi,
    LucideWifiOff,
    LucideX,
  ],
  templateUrl: './mikrotik.html',
  styleUrl: './mikrotik.scss',
  encapsulation: ViewEncapsulation.None,
})
export class MikrotikComponent implements OnInit, OnDestroy {
  readonly Math = Math;
  readonly pageSize = 50;
  private readonly mt = inject(MikrotikService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly exporter = inject(ExportService);

  status = signal<MtStatus>({ configured: false, connected: false, host: '' });
  system = signal<MtSystem | null>(null);
  wan = signal<WanTraffic | null>(null);
  live = signal<MtLiveResponse | null>(null);
  unknown = signal<MtUnknownResponse | null>(null);
  security = signal<MtSecurityAudit | null>(null);
  traffic = signal<MtTraffic[]>([]);
  sessions = signal<{ pppoe: any[]; hotspot: any[] } | null>(null);
  backups = signal<MtBackup[]>([]);
  firewall = signal<MtFirewallResponse | null>(null);
  ipam = signal<MtIpamResponse | null>(null);
  speedTemplates = signal<MtSpeedTemplate[]>([]);
  netwatch = signal<MtNetwatch[]>([]);

  activeTab = signal<MikrotikTab>('overview');
  loading = signal(true);
  refreshing = signal(false);
  unknownLoading = signal(false);
  securityLoading = signal(false);
  controlLoading = signal(false);
  controlSaving = signal(false);
  queueSaving = signal(false);
  pinging = signal(false);
  errorMessage = signal('');
  lastUpdate = signal<Date | null>(null);

  clientQuery = signal('');
  syncFilter = signal<SyncFilter>('all');
  clientPage = signal(1);
  unknownQuery = signal('');
  unknownFilter = signal<UnknownFilter>('all');
  unknownPage = signal(1);
  firewallTable = signal<MtFirewallTable>('filter');
  ipamQuery = signal('');
  ipamFilter = signal<IpamFilter>('all');
  ipamNetwork = signal<string | null>(null);
  ipamPage = signal(1);
  selectedQueueIds = signal<Set<string>>(new Set());

  backupName = `ispmax-manual-${new Date().toISOString().slice(0, 10)}`;
  backupType: 'backup' | 'export' = 'backup';
  selectedTemplateId = '';
  templateName = '';
  templateUploadMbps = 10;
  templateDownloadMbps = 10;
  netwatchHost = '';
  netwatchType = 'icmp';
  netwatchInterval = '1m';
  netwatchPort: number | null = null;
  netwatchComment = '';

  queueEditor = signal<{ id: string | null; ip: string } | null>(null);
  queueName = '';
  queueUploadMbps = 1;
  queueDownloadMbps = 1;
  queueDisabled = false;
  queueComment = '';

  pingTarget = '';
  pingResult = signal<any[]>([]);

  private coreTimer?: ReturnType<typeof setInterval>;
  private unknownTimer?: ReturnType<typeof setInterval>;
  private clockTimer?: ReturnType<typeof setInterval>;

  canManage = computed(() => this.auth.hasAnyRole(['admin']));

  clients = computed(() => this.live()?.clients || []);

  // --- Funciones de análisis (solo lectura, calculadas en el navegador) ---
  /** Reloj local para los tiempos relativos ("hace 3 min"). No hace peticiones al servidor. */
  now = signal(Date.now());
  clientSort = signal<ClientSort>((['default', 'traffic', 'total', 'usage', 'ip', 'name'] as ClientSort[]).find((value) => value === readPref<string>('clientSort', 'default')) ?? 'default');
  rankingMode = signal<RankingMode>(readPref<string>('rankingMode', 'now') === 'total' ? 'total' : 'now');
  readonly issueOrder = ISSUE_ORDER.filter((kind) => kind !== 'paused');
  readonly issueInfo = ISSUE_INFO;
  readonly formatBpsFn = (value: number) => this.formatBps(value);

  unknownDevices = computed(() => this.unknown()?.devices ?? []);
  ipamRows = computed(() => this.ipam()?.rows ?? []);
  routerHealth = computed(() => evaluateRouterHealth(this.system()));
  issues = computed(() => detectIssues(this.clients()));
  private issueSets = computed(() => {
    const issues = this.issues();
    return Object.fromEntries(ISSUE_ORDER.map((kind) => [kind, new Set(issues[kind])])) as Record<IssueKind, Set<MtLiveClient>>;
  });
  issueChips = computed(() => ISSUE_ORDER
    .map((kind) => ({ kind, filter: (kind === 'paused' ? 'disabled' : kind) as SyncFilter, label: ISSUE_INFO[kind].short, level: ISSUE_INFO[kind].level, count: this.issues()[kind].length }))
    .filter((chip) => chip.count > 0));
  lastUpdateText = computed(() => relativeTime(this.lastUpdate(), this.now()));
  dataStale = computed(() => {
    const last = this.lastUpdate();
    return !!last && this.now() - last.getTime() > 60_000;
  });

  filteredClients = computed(() => {
    const query = this.clientQuery().trim().toLowerCase();
    const macQuery = normalizeMac(query);
    const filter = this.syncFilter();
    const sets = this.issueSets();
    const rows = this.clients().filter((row) => {
      const matchesQuery = !query || [row.client?.name, row.client?.username, row.ip, row.queueName, row.client?.zone, row.macAddress]
        .some((value) => String(value || '').toLowerCase().includes(query))
        || (macQuery.length >= 4 && !/^[\d.]+$/.test(query) && normalizeMac(row.macAddress).includes(macQuery));
      const matchesFilter = filter === 'all'
        || (filter === 'differences' && row.syncState !== 'synced')
        || (filter === 'online' && row.isOnline)
        || (filter === 'offline' && !row.isOnline)
        || (filter === 'disabled' && row.isDisabled)
        || (filter in sets && sets[filter as IssueKind].has(row));
      return matchesQuery && matchesFilter;
    });
    const sort = this.clientSort();
    if (sort === 'default') return rows;
    const name = (row: MtLiveClient) => String(row.client?.name || row.queueName || '');
    return [...rows].sort((a, b) => {
      switch (sort) {
        case 'traffic': return (b.uploadBps + b.downloadBps) - (a.uploadBps + a.downloadBps);
        case 'total': return (b.totalBytes || 0) - (a.totalBytes || 0);
        case 'usage': return Math.max(b.uploadPct, b.downloadPct) - Math.max(a.uploadPct, a.downloadPct);
        case 'ip': return compareIp(a.ip, b.ip);
        default: return name(a).localeCompare(name(b), 'es');
      }
    });
  });
  clientPageCount = computed(() => Math.max(1, Math.ceil(this.filteredClients().length / this.pageSize)));
  pagedClients = computed(() => {
    const page = Math.min(this.clientPage(), this.clientPageCount());
    return this.filteredClients().slice((page - 1) * this.pageSize, page * this.pageSize);
  });

  topClients = computed(() => {
    if (this.rankingMode() === 'total') {
      return [...this.clients()]
        .filter((row) => (row.totalBytes || 0) > 0)
        .sort((a, b) => (b.totalBytes || 0) - (a.totalBytes || 0))
        .slice(0, 10);
    }
    return [...this.clients()]
      .filter((row) => row.uploadBps + row.downloadBps > 0)
      .sort((a, b) => (b.uploadBps + b.downloadBps) - (a.uploadBps + a.downloadBps))
      .slice(0, 10);
  });

  filteredUnknown = computed(() => {
    const query = this.unknownQuery().trim().toLowerCase();
    const filter = this.unknownFilter();
    return (this.unknown()?.devices || []).filter((device) => {
      const matchesQuery = !query || [device.ip, device.macAddress, device.identity, device.platform, device.queueName]
        .some((value) => String(value || '').toLowerCase().includes(query));
      const matchesFilter = filter === 'all'
        || (filter === 'high' && device.risk === 'high')
        || (filter === 'unmanaged' && device.classification === 'unmanaged_device')
        || (filter === 'infrastructure' && device.classification === 'infrastructure_candidate');
      return matchesQuery && matchesFilter;
    });
  });
  unknownPageCount = computed(() => Math.max(1, Math.ceil(this.filteredUnknown().length / this.pageSize)));
  pagedUnknown = computed(() => {
    const page = Math.min(this.unknownPage(), this.unknownPageCount());
    return this.filteredUnknown().slice((page - 1) * this.pageSize, page * this.pageSize);
  });

  firewallRules = computed(() => this.firewall()?.tables?.[this.firewallTable()] || []);
  filteredIpamRows = computed(() => {
    const query = this.ipamQuery().trim().toLowerCase();
    const filter = this.ipamFilter();
    const network = this.ipamNetwork();
    return (this.ipam()?.rows || []).filter((row) => {
      const matchesQuery = !query || [row.ip, row.macAddress, row.hostName, row.queueName, row.poolName, row.client?.name, row.client?.username]
        .some((value) => String(value || '').toLowerCase().includes(query));
      const matchesNetwork = !network || row.cidr === network;
      const matchesFilter = filter === 'all'
        || (filter === 'available' && row.available)
        || (filter === 'client' && row.classification === 'client')
        || (filter === 'occupied' && !row.available && !['client', 'router'].includes(row.classification))
        || (filter === 'conflict' && row.conflict);
      return matchesQuery && matchesNetwork && matchesFilter;
    });
  });
  ipamPageCount = computed(() => Math.max(1, Math.ceil(this.filteredIpamRows().length / this.pageSize)));
  pagedIpamRows = computed(() => {
    const page = Math.min(this.ipamPage(), this.ipamPageCount());
    return this.filteredIpamRows().slice((page - 1) * this.pageSize, page * this.pageSize);
  });

  activeInterfaces = computed(() => this.traffic().filter((item) => item.running));
  wanUtilization = computed(() => {
    const wan = this.wan();
    if (!wan?.maxBps) return 0;
    return Math.min(100, (Math.max(wan.rxBps, wan.txBps) / wan.maxBps) * 100);
  });

  ngOnInit() {
    const requestedTab = this.route.snapshot.queryParamMap.get('tab');
    const validTabs: MikrotikTab[] = ['overview', 'ipam', 'reconciliation', 'unknown', 'interfaces', 'firewall', 'netwatch', 'backups', 'security'];
    if (requestedTab && validTabs.includes(requestedTab as MikrotikTab)) {
      this.activeTab.set(requestedTab as MikrotikTab);
    }
    this.refreshAll();
    this.coreTimer = setInterval(() => {
      if (!this.unknownLoading() && !this.securityLoading()) this.refreshCore(false);
    }, 15_000);
    this.unknownTimer = setInterval(() => {
      if (this.unknown()) this.loadUnknown(false);
    }, 300_000);
    // Solo refresca el texto "hace X"; no consulta al servidor.
    this.clockTimer = setInterval(() => this.now.set(Date.now()), 10_000);
  }

  ngOnDestroy() {
    if (this.coreTimer) clearInterval(this.coreTimer);
    if (this.unknownTimer) clearInterval(this.unknownTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
  }

  changeTab(tab: MikrotikTab) {
    this.activeTab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'overview' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    if (tab === 'unknown' && !this.unknown()) this.loadUnknown(true);
    if (tab === 'interfaces' && this.traffic().length === 0) this.loadInfrastructure();
    if (tab === 'security' && !this.security()) this.loadSecurity(true);
    if (tab === 'firewall' && !this.firewall()) this.loadFirewall();
    if (tab === 'ipam' && !this.ipam()) this.loadIpam();
    if (tab === 'netwatch' && this.netwatch().length === 0) this.loadNetwatch();
    if (tab === 'backups' && this.backups().length === 0) this.loadBackups();
    if (tab === 'reconciliation' && this.speedTemplates().length === 0) this.loadSpeedTemplates();
  }

  refreshAll() {
    const tab = this.activeTab();
    if (tab === 'unknown') return this.loadUnknown(true);
    if (tab === 'interfaces') return this.loadInfrastructure();
    if (tab === 'security') return this.loadSecurity(true);
    if (tab === 'firewall') return this.loadFirewall();
    if (tab === 'ipam') return this.loadIpam();
    if (tab === 'netwatch') return this.loadNetwatch();
    if (tab === 'backups') return this.loadBackups();
    return this.refreshCore(true);
  }

  refreshCore(showLoading = true) {
    if (showLoading) this.loading.set(true);
    this.refreshing.set(true);
    forkJoin({
      status: this.mt.getStatus().pipe(catchError(() => of(this.status()))),
      system: this.mt.getSystem().pipe(catchError(() => of(this.system()))),
      wan: this.mt.getWanTraffic().pipe(catchError(() => of(this.wan()))),
      live: this.mt.getLiveClients().pipe(catchError((error) => {
        this.errorMessage.set(error.error?.error || 'No se pudo leer la operación del MikroTik');
        return of(this.live());
      })),
    }).pipe(finalize(() => {
      this.loading.set(false);
      this.refreshing.set(false);
    })).subscribe(({ status, system, wan, live }) => {
      this.status.set(status);
      if (system) this.system.set(system as MtSystem);
      if (wan) this.wan.set(wan as WanTraffic);
      if (live) this.live.set(live as MtLiveResponse);
      this.lastUpdate.set(new Date());
      if (live) this.errorMessage.set('');
    });
  }

  loadUnknown(showLoading = true) {
    if (showLoading) this.unknownLoading.set(true);
    this.mt.getUnknownDevices().pipe(
      catchError((error) => {
        if (showLoading) this.toast.error(error.error?.error || 'No se pudo analizar dispositivos desconocidos');
        return of(null);
      }),
      finalize(() => this.unknownLoading.set(false)),
    ).subscribe((data) => { if (data) this.unknown.set(data); });
  }

  loadSecurity(showLoading = true) {
    if (showLoading) this.securityLoading.set(true);
    this.mt.getSecurityAudit().pipe(
      catchError((error) => {
        if (showLoading) this.toast.error(error.error?.error || 'No se pudo completar la auditoría');
        return of(null);
      }),
      finalize(() => this.securityLoading.set(false)),
    ).subscribe((data) => { if (data) this.security.set(data); });
  }

  loadInfrastructure() {
    forkJoin({
      traffic: this.mt.getTraffic().pipe(catchError(() => of([]))),
      sessions: this.mt.getActiveSessions().pipe(catchError(() => of({ pppoe: [], hotspot: [] }))),
    }).subscribe(({ traffic, sessions }) => {
      this.traffic.set(traffic);
      this.sessions.set(sessions);
    });
  }

  loadBackups() {
    this.controlLoading.set(true);
    this.mt.getBackups().pipe(finalize(() => this.controlLoading.set(false))).subscribe({
      next: (data) => this.backups.set(data),
      error: (error) => this.toast.error(error.error?.error || 'No se pudieron leer los respaldos'),
    });
  }

  createBackup() {
    if (!this.backupName.trim() || this.controlSaving()) return;
    this.controlSaving.set(true);
    this.mt.createBackup({ name: this.backupName.trim(), type: this.backupType, confirmation: 'CREAR' })
      .pipe(finalize(() => this.controlSaving.set(false))).subscribe({
        next: () => { this.toast.success('Respaldo creado en el MikroTik'); this.loadBackups(); },
        error: (error) => this.toast.error(error.error?.error || 'No se pudo crear el respaldo'),
      });
  }

  deleteBackup(item: MtBackup) {
    if (!window.confirm(`¿Eliminar el respaldo ${item.name} del MikroTik? Esta acción no se puede deshacer.`)) return;
    this.controlSaving.set(true);
    this.mt.deleteBackup(item.id).pipe(finalize(() => this.controlSaving.set(false))).subscribe({
      next: () => { this.toast.success('Respaldo eliminado'); this.loadBackups(); },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo eliminar el respaldo'),
    });
  }

  loadFirewall() {
    this.controlLoading.set(true);
    this.mt.getFirewall().pipe(finalize(() => this.controlLoading.set(false))).subscribe({
      next: (data) => this.firewall.set(data),
      error: (error) => this.toast.error(error.error?.error || 'No se pudo leer el firewall'),
    });
  }

  setFirewallTable(table: MtFirewallTable) { this.firewallTable.set(table); }

  toggleFirewallRule(rule: MtFirewallRule) {
    const action = rule.disabled ? 'habilitar' : 'deshabilitar';
    if (!window.confirm(`¿${action === 'habilitar' ? 'Habilitar' : 'Deshabilitar'} esta regla del firewall? Puede afectar el tráfico de los clientes. Antes se creará un respaldo automático.`)) return;
    this.controlSaving.set(true);
    this.mt.toggleFirewallRule(rule.table, rule.id, !rule.disabled)
      .pipe(finalize(() => this.controlSaving.set(false))).subscribe({
        next: () => { this.toast.success(`Regla ${rule.disabled ? 'habilitada' : 'deshabilitada'}`); this.loadFirewall(); },
        error: (error) => this.toast.error(error.error?.error || 'No se pudo cambiar la regla'),
      });
  }

  deleteFirewallRule(rule: MtFirewallRule) {
    if (!window.confirm('¿Eliminar permanentemente esta regla del firewall? Puede afectar el tráfico de los clientes. Antes se creará un respaldo automático.')) return;
    this.controlSaving.set(true);
    this.mt.deleteFirewallRule(rule.table, rule.id).pipe(finalize(() => this.controlSaving.set(false))).subscribe({
      next: () => { this.toast.success('Regla eliminada'); this.loadFirewall(); },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo eliminar la regla'),
    });
  }

  loadIpam() {
    this.controlLoading.set(true);
    this.mt.getIpam().pipe(finalize(() => this.controlLoading.set(false))).subscribe({
      next: (data) => {
        this.ipam.set(data);
        this.ipamPage.set(1);
        if (data.stale) this.toast.info('Mostrando el último inventario guardado');
      },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo construir el inventario IP'),
    });
  }

  setIpamQuery(value: string) { this.ipamQuery.set(value); this.ipamPage.set(1); }
  setIpamFilter(value: IpamFilter) { this.ipamFilter.set(value); this.ipamPage.set(1); }
  setIpamNetwork(value: string | null) { this.ipamNetwork.set(value); this.ipamPage.set(1); }
  moveIpamPage(delta: number) {
    this.ipamPage.set(Math.min(this.ipamPageCount(), Math.max(1, this.ipamPage() + delta)));
  }
  async copyAvailableIp(ip: string) {
    try {
      await navigator.clipboard.writeText(ip);
      this.toast.success(`IP ${ip} copiada`);
    } catch {
      this.toast.error(`No se pudo copiar. Anote la IP: ${ip}`);
    }
  }

  ipamClassificationLabel(row: MtIpamResponse['rows'][number]) {
    if (row.conflict) return 'Conflicto';
    return {
      available: row.recommended ? 'Disponible sugerida' : 'Disponible',
      client: 'Cliente WispHub',
      unknown_lease: 'DHCP sin cliente',
      arp_only: 'ARP sin cliente',
      queue_only: 'Cola sin cliente',
      pool_reserved: 'Reserva de pool',
      router: 'Infraestructura',
    }[row.classification] || row.classification;
  }

  makeLeaseStatic(row: MtIpamResponse['rows'][number]) {
    if (!row.leaseId || !window.confirm(`¿Fijar la IP ${row.ip} para ${row.macAddress || 'esta MAC'}? Antes se creará un respaldo automático.`)) return;
    this.controlSaving.set(true);
    this.mt.makeLeaseStatic(row.leaseId).pipe(finalize(() => this.controlSaving.set(false))).subscribe({
      next: () => { this.toast.success('Concesión DHCP convertida a fija'); this.loadIpam(); },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo fijar la concesión'),
    });
  }

  loadSpeedTemplates() {
    this.mt.getSpeedTemplates().subscribe({
      next: (data) => {
        this.speedTemplates.set(data);
        if (!this.selectedTemplateId && data.length) this.selectedTemplateId = data[0].id;
      },
      error: (error) => this.toast.error(error.error?.error || 'No se pudieron cargar las plantillas'),
    });
  }

  toggleQueueSelection(queueId: string | null, checked: boolean) {
    if (!queueId) return;
    const next = new Set(this.selectedQueueIds());
    if (checked) next.add(queueId); else next.delete(queueId);
    this.selectedQueueIds.set(next);
  }

  selectVisibleQueues(checked: boolean) {
    const next = new Set(this.selectedQueueIds());
    for (const row of this.pagedClients()) {
      if (!row.queueId) continue;
      if (checked) next.add(row.queueId); else next.delete(row.queueId);
    }
    this.selectedQueueIds.set(next);
  }

  saveSpeedTemplate() {
    if (!this.templateName.trim() || this.controlSaving()) return;
    this.controlSaving.set(true);
    this.mt.saveSpeedTemplate({
      name: this.templateName.trim(), uploadMbps: Number(this.templateUploadMbps), downloadMbps: Number(this.templateDownloadMbps),
    }).pipe(finalize(() => this.controlSaving.set(false))).subscribe({
      next: () => {
        this.toast.success('Plantilla guardada');
        this.templateName = '';
        this.loadSpeedTemplates();
      },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo guardar la plantilla'),
    });
  }

  deleteSpeedTemplate(item: MtSpeedTemplate) {
    if (!window.confirm(`¿Eliminar la plantilla ${item.name}?`)) return;
    this.mt.deleteSpeedTemplate(item.id).subscribe({
      next: () => { this.toast.success('Plantilla eliminada'); this.loadSpeedTemplates(); },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo eliminar la plantilla'),
    });
  }

  applySpeedTemplate() {
    const queueIds = [...this.selectedQueueIds()];
    const template = this.speedTemplates().find((item) => item.id === this.selectedTemplateId);
    if (!template || !queueIds.length) return this.toast.error('Selecciona una plantilla y al menos una cola');
    if (!window.confirm(`¿Aplicar la plantilla ${template.name} a ${queueIds.length} colas? Cambiará la velocidad de esos clientes. Antes se creará un respaldo automático.`)) return;
    this.controlSaving.set(true);
    this.mt.applySpeedTemplate(template.id, queueIds).pipe(finalize(() => this.controlSaving.set(false))).subscribe({
      next: () => {
        this.toast.success(`Plantilla aplicada a ${queueIds.length} colas`);
        this.selectedQueueIds.set(new Set());
        this.refreshCore(false);
      },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo aplicar la plantilla'),
    });
  }

  loadNetwatch() {
    this.controlLoading.set(true);
    this.mt.getNetwatch().pipe(finalize(() => this.controlLoading.set(false))).subscribe({
      next: (data) => this.netwatch.set(data),
      error: (error) => this.toast.error(error.error?.error || 'No se pudo leer el monitoreo (Netwatch)'),
    });
  }

  createNetwatch() {
    if (!this.netwatchHost.trim() || this.controlSaving()) return;
    this.controlSaving.set(true);
    const port = ['tcp-conn', 'http-get', 'https-get'].includes(this.netwatchType) && this.netwatchPort
      ? Number(this.netwatchPort) : undefined;
    this.mt.createNetwatch({
      host: this.netwatchHost.trim(), type: this.netwatchType, interval: this.netwatchInterval,
      port, comment: this.netwatchComment.trim() || undefined,
    }).pipe(finalize(() => this.controlSaving.set(false))).subscribe({
      next: () => {
        this.toast.success('Sonda de monitoreo creada');
        this.netwatchHost = '';
        this.netwatchComment = '';
        this.loadNetwatch();
      },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo crear la sonda'),
    });
  }

  toggleNetwatch(item: MtNetwatch) {
    if (!window.confirm(`¿${item.disabled ? 'Habilitar' : 'Deshabilitar'} la sonda ${item.host}?`)) return;
    this.controlSaving.set(true);
    this.mt.updateNetwatch(item.id, { disabled: !item.disabled }).pipe(finalize(() => this.controlSaving.set(false))).subscribe({
      next: () => { this.toast.success('Sonda actualizada'); this.loadNetwatch(); },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo actualizar la sonda'),
    });
  }

  deleteNetwatch(item: MtNetwatch) {
    if (!window.confirm(`¿Eliminar la sonda ${item.host}? Antes se creará un respaldo automático.`)) return;
    this.controlSaving.set(true);
    this.mt.deleteNetwatch(item.id).pipe(finalize(() => this.controlSaving.set(false))).subscribe({
      next: () => { this.toast.success('Sonda eliminada'); this.loadNetwatch(); },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo eliminar la sonda'),
    });
  }

  setClientQuery(value: string) {
    this.clientQuery.set(value);
    this.clientPage.set(1);
  }

  setSyncFilter(value: SyncFilter) {
    this.syncFilter.set(value);
    this.clientPage.set(1);
  }

  setUnknownQuery(value: string) {
    this.unknownQuery.set(value);
    this.unknownPage.set(1);
  }

  setUnknownFilter(value: UnknownFilter) {
    this.unknownFilter.set(value);
    this.unknownPage.set(1);
  }

  setClientSort(value: ClientSort) {
    this.clientSort.set(value);
    this.clientPage.set(1);
    writePref('clientSort', value);
  }

  setRankingMode(value: RankingMode) {
    this.rankingMode.set(value);
    writePref('rankingMode', value);
  }

  /** Desde el panel de inconsistencias: abre Clientes y colas con ese filtro. */
  showIssue(kind: IssueKind) {
    this.changeTab('reconciliation');
    this.setClientQuery('');
    this.setSyncFilter(kind === 'paused' ? 'disabled' : kind);
  }

  openIpamConflicts() {
    this.changeTab('ipam');
    this.setIpamNetwork(null);
    this.setIpamQuery('');
    this.setIpamFilter('conflict');
  }

  /** Desde el buscador global: abre la pestaña del resultado ya filtrada. */
  openSearchResult(event: { tab: SearchTab; query: string }) {
    this.changeTab(event.tab);
    if (event.tab === 'reconciliation') { this.setSyncFilter('all'); this.setClientQuery(event.query); }
    if (event.tab === 'unknown') { this.setUnknownFilter('all'); this.setUnknownQuery(event.query); }
    if (event.tab === 'ipam') { this.setIpamNetwork(null); this.setIpamFilter('all'); this.setIpamQuery(event.query); }
  }

  /** Clic en una IP ocupada del mapa: la muestra en la tabla del inventario. */
  focusIpamIp(ip: string) {
    this.setIpamFilter('all');
    this.setIpamQuery(ip);
    this.toast.info(`Mostrando ${ip} en la tabla`);
  }

  showTopConsumers() {
    this.changeTab('reconciliation');
    this.setSyncFilter('all');
    this.setClientSort(this.rankingMode() === 'total' ? 'total' : 'traffic');
  }

  /** Etiquetas extra (IP duplicada, al tope, etc.) que no se ven en la columna de sincronización. */
  rowIssues(row: MtLiveClient): string[] {
    const sets = this.issueSets();
    return (['dup-ip', 'dup-mac', 'paused', 'no-limit', 'saturated'] as IssueKind[])
      .filter((kind) => sets[kind].has(row))
      .map((kind) => ISSUE_INFO[kind].short);
  }

  wanShare(row: MtLiveClient): number {
    const wan = this.wan();
    const total = (wan?.rxBps || 0) + (wan?.txBps || 0);
    return total ? Math.min(100, ((row.uploadBps + row.downloadBps) / total) * 100) : 0;
  }

  ago(value: string | number | Date | null | undefined): string {
    return relativeTime(value, this.now());
  }

  // --- Exportar a CSV lo que se está viendo (respeta búsqueda y filtros) ---
  private readonly csvMbps = (value: number) => Number((Number(value || 0) / 1_000_000).toFixed(2));

  exportClients() {
    const rows = this.filteredClients();
    if (!rows.length) return this.toast.info('No hay filas para exportar con estos filtros');
    this.exporter.exportCSV(rows, 'mikrotik-colas', [
      { key: 'client.name', label: 'Cliente', transform: (value, row) => value || row.queueName },
      { key: 'client.username', label: 'Usuario' },
      { key: 'client.id', label: 'ID cliente' },
      { key: 'client.zone', label: 'Zona' },
      { key: 'ip', label: 'IP' },
      { key: 'macAddress', label: 'MAC' },
      { key: 'queueName', label: 'Cola' },
      { key: 'syncState', label: 'Sincronización', transform: (value) => this.syncLabel(value) },
      { key: 'maxUploadBps', label: 'Límite subida (Mbps)', transform: this.csvMbps },
      { key: 'maxDownloadBps', label: 'Límite descarga (Mbps)', transform: this.csvMbps },
      { key: 'uploadBps', label: 'Subida actual (Mbps)', transform: this.csvMbps },
      { key: 'downloadBps', label: 'Descarga actual (Mbps)', transform: this.csvMbps },
      { key: 'totalBytes', label: 'Consumo acumulado (GB)', transform: (value) => Number((Number(value || 0) / 1e9).toFixed(2)) },
      { key: 'isOnline', label: 'Estado', transform: (_value, row) => this.clientStateLabel(row) },
      { key: 'ip', label: 'Alertas', transform: (_value, row) => this.rowIssues(row).join(' / ') },
    ]);
    this.toast.success(`${rows.length} filas exportadas`);
  }

  exportUnknown() {
    const rows = this.filteredUnknown();
    if (!rows.length) return this.toast.info('No hay dispositivos para exportar con estos filtros');
    this.exporter.exportCSV(rows, 'mikrotik-desconocidos', [
      { key: 'ip', label: 'IP' },
      { key: 'macAddress', label: 'MAC' },
      { key: 'identity', label: 'Identidad' },
      { key: 'platform', label: 'Plataforma' },
      { key: 'bridgePort', label: 'Puerto físico', transform: (value, row) => value || row.interface || '' },
      { key: 'connectionCount', label: 'Conexiones' },
      { key: 'downloadBps', label: 'Descarga (Mbps)', transform: this.csvMbps },
      { key: 'uploadBps', label: 'Subida (Mbps)', transform: this.csvMbps },
      { key: 'queueName', label: 'Cola' },
      { key: 'maxLimit', label: 'Límite', transform: (value, row) => row.queueId ? this.formatLimit(value) : 'Sin cola' },
      { key: 'classification', label: 'Clasificación', transform: (value) => this.classificationLabel(value) },
      { key: 'risk', label: 'Riesgo', transform: (value) => this.severityLabel(value) },
    ]);
    this.toast.success(`${rows.length} dispositivos exportados`);
  }

  exportIpam() {
    const rows = this.filteredIpamRows();
    if (!rows.length) return this.toast.info('No hay direcciones para exportar con estos filtros');
    this.exporter.exportCSV(rows, 'mikrotik-ips', [
      { key: 'ip', label: 'IP' },
      { key: 'cidr', label: 'Rango' },
      { key: 'macAddress', label: 'MAC' },
      { key: 'hostName', label: 'Equipo' },
      { key: 'client.name', label: 'Cliente' },
      { key: 'client.username', label: 'Usuario' },
      { key: 'queueName', label: 'Cola' },
      { key: 'poolName', label: 'Pool' },
      { key: 'sources', label: 'Origen', transform: (value) => this.ipSourceLabel(value || []) },
      { key: 'classification', label: 'Estado', transform: (_value, row) => this.ipamClassificationLabel(row) },
      { key: 'recommended', label: 'Sugerida', transform: (value) => value ? 'Sí' : '' },
    ]);
    this.toast.success(`${rows.length} direcciones exportadas`);
  }

  exportFirewall() {
    const rows = this.firewallRules();
    if (!rows.length) return this.toast.info('No hay reglas para exportar en esta tabla');
    this.exporter.exportCSV(rows, `mikrotik-firewall-${this.firewallTable()}`, [
      { key: 'id', label: 'ID' },
      { key: 'comment', label: 'Comentario' },
      { key: 'chain', label: 'Cadena', transform: (value, row) => value || row.list || '' },
      { key: 'action', label: 'Acción', transform: (value, row) => value || row.address || '' },
      { key: 'srcAddress', label: 'Origen' },
      { key: 'dstAddress', label: 'Destino', transform: (value, row) => value || row.address || '' },
      { key: 'protocol', label: 'Protocolo' },
      { key: 'dstPort', label: 'Puerto destino' },
      { key: 'inInterface', label: 'Interfaz', transform: (value, row) => value || row.outInterface || '' },
      { key: 'bytes', label: 'Bytes' },
      { key: 'packets', label: 'Paquetes' },
      { key: 'disabled', label: 'Estado', transform: (_value, row) => row.dynamic ? 'Dinámica' : row.invalid ? 'Inválida' : row.disabled ? 'Deshabilitada' : 'Activa' },
    ]);
    this.toast.success(`${rows.length} reglas exportadas`);
  }

  moveClientPage(delta: number) {
    this.clientPage.set(Math.min(this.clientPageCount(), Math.max(1, this.clientPage() + delta)));
  }

  moveUnknownPage(delta: number) {
    this.unknownPage.set(Math.min(this.unknownPageCount(), Math.max(1, this.unknownPage() + delta)));
  }

  openClientQueue(row: MtLiveClient) {
    if (!row.ip) return;
    this.queueEditor.set({ id: row.queueId, ip: row.ip });
    this.queueName = row.queueName || row.client?.name || `Cliente - ${row.ip}`;
    this.queueUploadMbps = this.bpsToMbps(row.maxUploadBps) || 1;
    this.queueDownloadMbps = this.bpsToMbps(row.maxDownloadBps) || 1;
    this.queueDisabled = row.isDisabled;
    this.queueComment = row.client ? `Cliente WispHub #${row.client.id}` : 'IP sin cliente en WispHub ERP';
  }

  openUnknownQueue(device: MtUnknownDevice) {
    this.queueEditor.set({ id: device.queueId, ip: device.ip });
    this.queueName = device.queueName || `DESCONOCIDO - ${device.ip}`;
    const [upload, download] = this.limitValues(device.maxLimit);
    this.queueUploadMbps = upload || 1;
    this.queueDownloadMbps = download || 1;
    this.queueDisabled = device.disabled;
    this.queueComment = 'IP sin cliente en WispHub ERP - limitado desde ISP max';
  }

  closeQueueEditor() {
    if (!this.queueSaving()) this.queueEditor.set(null);
  }

  saveQueue() {
    const editor = this.queueEditor();
    if (!editor || this.queueSaving()) return;
    if (!this.queueName.trim() || this.queueUploadMbps < 0.1 || this.queueDownloadMbps < 0.1) {
      this.toast.error('Completa un nombre y límites válidos');
      return;
    }
    this.queueSaving.set(true);
    const payload = {
      name: this.queueName.trim(),
      uploadMbps: Number(this.queueUploadMbps),
      downloadMbps: Number(this.queueDownloadMbps),
      disabled: this.queueDisabled,
      comment: this.queueComment.trim(),
    };
    const request = editor.id
      ? this.mt.updateQueue(editor.id, payload)
      : this.mt.createQueue({ ...payload, targetIp: editor.ip });
    request.pipe(finalize(() => this.queueSaving.set(false))).subscribe({
      next: () => {
        this.toast.success(editor.id ? 'Cola actualizada' : 'Cola creada');
        this.queueEditor.set(null);
        this.refreshCore(false);
        this.loadUnknown(false);
      },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo guardar la cola'),
    });
  }

  runPing() {
    if (!this.pingTarget.trim() || this.pinging()) return;
    this.pinging.set(true);
    this.pingResult.set([]);
    this.mt.ping(this.pingTarget.trim(), 4).pipe(finalize(() => this.pinging.set(false))).subscribe({
      next: (result) => this.pingResult.set(result),
      error: (error) => this.toast.error(error.error?.error || 'El ping falló'),
    });
  }

  systemResource(key: string): string {
    return String(this.system()?.resource?.[key] ?? '-');
  }

  formatBps(value: number): string {
    if (!value) return '0 Mbps';
    if (value < 1_000_000) return `${(value / 1_000).toFixed(0)} Kbps`;
    return `${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1)} Mbps`;
  }

  formatBytes(value: number | string | undefined): string {
    const bytes = Number(value || 0);
    if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
    if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    if (bytes < 1_000_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
    return `${(bytes / 1_000_000_000_000).toFixed(2)} TB`;
  }

  formatLimit(value: string | null | undefined): string {
    const [upload, download] = this.limitValues(value);
    if (!upload && !download) return 'Sin límite';
    return `${this.compactMbps(upload)} / ${this.compactMbps(download)} Mbps`;
  }

  compactMbps(value: number): string {
    return `${Number.isInteger(value) ? value : value.toFixed(1)}`;
  }

  limitValues(value: string | null | undefined): [number, number] {
    const [upload = '0', download = '0'] = String(value || '0/0').split('/');
    return [this.bpsToMbps(Number(upload)), this.bpsToMbps(Number(download))];
  }

  bpsToMbps(value: number): number {
    return Number((Number(value || 0) / 1_000_000).toFixed(1));
  }

  syncLabel(state: MtSyncState): string {
    return ({
      synced: 'Sincronizado', missing_wisphub: 'Solo MikroTik', missing_mikrotik: 'Sin cola',
      missing_ip: 'Sin IP', queue_mismatch: 'Nombre diferente', state_mismatch: 'Estado diferente',
    })[state];
  }

  classificationLabel(value: MtUnknownDevice['classification']): string {
    return ({
      unregistered_queue: 'Cola sin ERP', unmanaged_device: 'Sin control', infrastructure_candidate: 'Posible infraestructura',
    })[value];
  }

  severityLabel(value: string): string {
    return ({ critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo' } as Record<string, string>)[value] || value;
  }

  clientStateLabel(row: MtLiveClient): string {
    return row.isDisabled ? 'Deshabilitado' : row.isOnline ? 'En línea' : 'Sin conexión';
  }

  netwatchStatusLabel(item: MtNetwatch): string {
    if (item.disabled) return 'Deshabilitada';
    return ({ up: 'Responde', down: 'Sin respuesta', unknown: 'Sin datos' } as Record<string, string>)[String(item.status || '').toLowerCase()] || item.status || 'Sin datos';
  }

  netwatchTypeLabel(type: string): string {
    return ({ icmp: 'Ping (ICMP)', simple: 'Ping simple', 'tcp-conn': 'Conexión TCP', 'http-get': 'Web HTTP', 'https-get': 'Web HTTPS', dns: 'DNS' } as Record<string, string>)[type] || type;
  }

  ipSourceLabel(sources: string[]): string {
    if (!sources.length) return 'Sin registros';
    const labels: Record<string, string> = { queue: 'Cola', queues: 'Cola', dhcp: 'DHCP', lease: 'DHCP', arp: 'ARP', wisphub: 'WispHub', client: 'WispHub', pool: 'Pool', address: 'Router', router: 'Router' };
    return sources.map((source) => labels[String(source).toLowerCase()] || source).join(' + ');
  }

  pingLine(row: any): string {
    if (row.received !== undefined) return `${row.host || this.pingTarget} · ${row.time || '-'} · TTL ${row.ttl || '-'}`;
    return `${row.host || this.pingTarget} · ${row.status || 'Sin respuesta'}`;
  }
}
