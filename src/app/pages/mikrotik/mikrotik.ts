import { Component, OnDestroy, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, of } from 'rxjs';
import {
  LucideActivity,
  LucideArrowDownToLine,
  LucideArrowUpFromLine,
  LucideCable,
  LucideChevronLeft,
  LucideChevronRight,
  LucideCircleAlert,
  LucideCircleCheck,
  LucideCircleGauge,
  LucideCpu,
  LucideCopy,
  LucideDatabase,
  LucideHardDrive,
  LucideNetwork,
  LucidePencil,
  LucideRadioTower,
  LucideRefreshCw,
  LucideRouter,
  LucideSave,
  LucideSearch,
  LucideServer,
  LucideShieldAlert,
  LucideShieldCheck,
  LucideSlidersHorizontal,
  LucideSquareTerminal,
  LucideTrash2,
  LucideUsers,
  LucideWifi,
  LucideWifiOff,
  LucideX,
  LucideZap,
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

type MikrotikTab = 'overview' | 'reconciliation' | 'unknown' | 'interfaces' | 'firewall' | 'ipam' | 'netwatch' | 'backups' | 'security';
type UnknownFilter = 'all' | 'high' | 'unmanaged' | 'infrastructure';
type SyncFilter = 'all' | 'differences' | 'online' | 'offline' | 'disabled';
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
    LucideActivity,
    LucideArrowDownToLine,
    LucideArrowUpFromLine,
    LucideCable,
    LucideChevronLeft,
    LucideChevronRight,
    LucideCircleAlert,
    LucideCircleCheck,
    LucideCircleGauge,
    LucideCpu,
    LucideCopy,
    LucideDatabase,
    LucideHardDrive,
    LucideNetwork,
    LucidePencil,
    LucideRadioTower,
    LucideRefreshCw,
    LucideRouter,
    LucideSave,
    LucideSearch,
    LucideServer,
    LucideShieldAlert,
    LucideShieldCheck,
    LucideSlidersHorizontal,
    LucideSquareTerminal,
    LucideTrash2,
    LucideUsers,
    LucideWifi,
    LucideWifiOff,
    LucideX,
    LucideZap,
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

  canManage = computed(() => this.auth.hasAnyRole(['admin']));

  clients = computed(() => this.live()?.clients || []);
  filteredClients = computed(() => {
    const query = this.clientQuery().trim().toLowerCase();
    const filter = this.syncFilter();
    return this.clients().filter((row) => {
      const matchesQuery = !query || [row.client?.name, row.client?.username, row.ip, row.queueName]
        .some((value) => String(value || '').toLowerCase().includes(query));
      const matchesFilter = filter === 'all'
        || (filter === 'differences' && row.syncState !== 'synced')
        || (filter === 'online' && row.isOnline)
        || (filter === 'offline' && !row.isOnline)
        || (filter === 'disabled' && row.isDisabled);
      return matchesQuery && matchesFilter;
    });
  });
  clientPageCount = computed(() => Math.max(1, Math.ceil(this.filteredClients().length / this.pageSize)));
  pagedClients = computed(() => {
    const page = Math.min(this.clientPage(), this.clientPageCount());
    return this.filteredClients().slice((page - 1) * this.pageSize, page * this.pageSize);
  });

  topClients = computed(() => [...this.clients()]
    .filter((row) => row.uploadBps + row.downloadBps > 0)
    .sort((a, b) => (b.uploadBps + b.downloadBps) - (a.uploadBps + a.downloadBps))
    .slice(0, 8));

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
  }

  ngOnDestroy() {
    if (this.coreTimer) clearInterval(this.coreTimer);
    if (this.unknownTimer) clearInterval(this.unknownTimer);
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
        this.errorMessage.set(error.error?.error || 'No se pudo leer la operacion del MikroTik');
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
        if (showLoading) this.toast.error(error.error?.error || 'No se pudo completar la auditoria');
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
    if (!window.confirm(`Eliminar ${item.name} del MikroTik?`)) return;
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
    if (!window.confirm(`Se creara un respaldo automatico antes de ${action} esta regla. Continuar?`)) return;
    this.controlSaving.set(true);
    this.mt.toggleFirewallRule(rule.table, rule.id, !rule.disabled)
      .pipe(finalize(() => this.controlSaving.set(false))).subscribe({
        next: () => { this.toast.success(`Regla ${rule.disabled ? 'habilitada' : 'deshabilitada'}`); this.loadFirewall(); },
        error: (error) => this.toast.error(error.error?.error || 'No se pudo cambiar la regla'),
      });
  }

  deleteFirewallRule(rule: MtFirewallRule) {
    if (!window.confirm('Eliminar permanentemente esta regla? Se creara un respaldo automatico.')) return;
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
        if (data.stale) this.toast.info('Mostrando el ultimo inventario guardado en SQLite');
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
    await navigator.clipboard.writeText(ip);
    this.toast.success(`IP ${ip} copiada`);
  }

  ipamClassificationLabel(row: MtIpamResponse['rows'][number]) {
    if (row.conflict) return 'Conflicto';
    return {
      available: row.recommended ? 'Disponible sugerida' : 'Disponible',
      client: 'Cliente WispHub',
      unknown_lease: 'DHCP sin cliente',
      arp_only: 'ARP sin cliente',
      queue_only: 'Queue sin cliente',
      pool_reserved: 'Reserva de pool',
      router: 'Infraestructura',
    }[row.classification] || row.classification;
  }

  makeLeaseStatic(row: MtIpamResponse['rows'][number]) {
    if (!row.leaseId || !window.confirm(`Fijar ${row.ip} para ${row.macAddress || 'esta MAC'}? Se creara un respaldo automatico.`)) return;
    this.controlSaving.set(true);
    this.mt.makeLeaseStatic(row.leaseId).pipe(finalize(() => this.controlSaving.set(false))).subscribe({
      next: () => { this.toast.success('Concesion convertida a estatica'); this.loadIpam(); },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo fijar la concesion'),
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
    if (!window.confirm(`Eliminar la plantilla ${item.name}?`)) return;
    this.mt.deleteSpeedTemplate(item.id).subscribe({
      next: () => { this.toast.success('Plantilla eliminada'); this.loadSpeedTemplates(); },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo eliminar la plantilla'),
    });
  }

  applySpeedTemplate() {
    const queueIds = [...this.selectedQueueIds()];
    const template = this.speedTemplates().find((item) => item.id === this.selectedTemplateId);
    if (!template || !queueIds.length) return this.toast.error('Selecciona una plantilla y al menos una cola');
    if (!window.confirm(`Aplicar ${template.name} a ${queueIds.length} colas? Se creara un respaldo automatico.`)) return;
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
      error: (error) => this.toast.error(error.error?.error || 'No se pudo leer Netwatch'),
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
        this.toast.success('Sonda Netwatch creada');
        this.netwatchHost = '';
        this.netwatchComment = '';
        this.loadNetwatch();
      },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo crear la sonda'),
    });
  }

  toggleNetwatch(item: MtNetwatch) {
    if (!window.confirm(`${item.disabled ? 'Habilitar' : 'Deshabilitar'} la sonda ${item.host}?`)) return;
    this.controlSaving.set(true);
    this.mt.updateNetwatch(item.id, { disabled: !item.disabled }).pipe(finalize(() => this.controlSaving.set(false))).subscribe({
      next: () => { this.toast.success('Sonda actualizada'); this.loadNetwatch(); },
      error: (error) => this.toast.error(error.error?.error || 'No se pudo actualizar la sonda'),
    });
  }

  deleteNetwatch(item: MtNetwatch) {
    if (!window.confirm(`Eliminar la sonda ${item.host}? Se creara un respaldo automatico.`)) return;
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
      this.toast.error('Completa un nombre y limites validos');
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
      error: (error) => this.toast.error(error.error?.error || 'El ping fallo'),
    });
  }

  systemResource(key: string): string {
    return String(this.system()?.resource?.[key] ?? '-');
  }

  memoryUsage(): number {
    const total = Number(this.system()?.resource?.['total-memory'] || 0);
    const free = Number(this.system()?.resource?.['free-memory'] || 0);
    return total ? Math.max(0, Math.min(100, ((total - free) / total) * 100)) : 0;
  }

  temperature(): string {
    const item = this.system()?.health?.find((entry: any) => entry.name === 'cpu-temperature')
      || this.system()?.health?.find((entry: any) => entry.name === 'temperature');
    return item ? `${item.value} ${item.type || 'C'}` : '-';
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
    if (!upload && !download) return 'Sin limite';
    return `${this.compactMbps(upload)} / ${this.compactMbps(download)}`;
  }

  compactMbps(value: number): string {
    return `${Number.isInteger(value) ? value : value.toFixed(1)}M`;
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
    return ({ critical: 'Critico', high: 'Alto', medium: 'Medio', low: 'Bajo' } as Record<string, string>)[value] || value;
  }

  pingLine(row: any): string {
    if (row.received !== undefined) return `${row.host || this.pingTarget} · ${row.time || '-'} · TTL ${row.ttl || '-'}`;
    return `${row.host || this.pingTarget} · ${row.status || 'Sin respuesta'}`;
  }
}
