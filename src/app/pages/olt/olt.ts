import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideActivity,
  LucideAlertTriangle,
  LucideBan,
  LucideBox,
  LucideChevronLeft,
  LucideChevronRight,
  LucideCircleCheck,
  LucideEye,
  LucideGauge,
  LucideLink2,
  LucideMoreHorizontal,
  LucideNetwork,
  LucidePlus,
  LucidePower,
  LucideRefreshCw,
  LucideSearch,
  LucideServer,
  LucideTrash2,
  LucideX,
} from '@lucide/angular';
import { forkJoin } from 'rxjs';
import { NavbarComponent } from '../../components/layout/navbar';
import { AuthService } from '../../services/auth.service';
import {
  OltActivity, OltAlarm, OltAssociationPreview, OltClientSummary, OltOnu, OltOnuPage, OltOpticalReading, OltPon,
  OltOperationPreview, OltPlanSyncPreview, OltProvisioningCatalog, OltProvisioningPayload, OltProvisioningPreview, OltProvisioningProfile, OltProvisioningResult,
  OltReconciliation, OltService, OltServiceDiagnostic, OltSignalAlert, OltSplitter, OltStatus, OltUnconfiguredOnu,
  ProvisioningCancellationPreview, ProvisioningIpAddress, ProvisioningIpCatalog, ProvisioningIpReservation, ProvisioningJob,
  Tr069Device, Tr069Task, Tr069TaskAction,
} from '../../services/olt.service';
import { ToastService } from '../../services/toast.service';
import { Tr069ConsoleComponent } from './tr069-console';
import { OnuModelCatalogComponent } from './onu-model-catalog';

type OltTab = 'overview' | 'onus' | 'topology' | 'profiles' | 'installations' | 'discovered' | 'alarms' | 'activity';
type OnuFilter = 'all' | 'online' | 'offline';
type MappingFilter = 'all' | 'linked' | 'unlinked';
type DiscoveryFilter = 'all' | 'new' | 'relocation' | 'review';

type PonPortState = 'online' | 'warning' | 'critical' | 'offline' | 'empty' | 'damaged';

interface PonMapPort {
  key: string;
  number: number;
  state: PonPortState;
  onu: OltOnu | null;
  label: string;
}

interface PonMapGroup {
  key: string;
  name: string;
  meta: string;
  ports: PonMapPort[];
}

const EMPTY_STATUS: OltStatus = {
  enabled: false,
  configured: false,
  syncing: false,
  connected: false,
  autoAuthorizeAgent: { enabled: false, running: false },
  syncIntervalMs: 60000,
  inventoryIntervalMs: 600000,
  totals: { totalOnus: 0, onlineOnus: 0, offlineOnus: 0, linkedOnus: 0, unlinkedOnus: 0, activeAlarms: 0, unconfiguredOnus: 0 },
  cards: [],
};

const EMPTY_PAGE: OltOnuPage = { items: [], total: 0, page: 1, limit: 50, pages: 1 };
const EMPTY_RECONCILIATION: OltReconciliation = {
  totalOnus: 0, linkedOnus: 0, unlinkedOnus: 0, manualLinks: 0, serialLinks: 0,
  duplicateAssignments: 0, clientsWithSerial: 0, clientsWithSerialNotFound: [],
};

@Component({
  selector: 'app-olt',
  standalone: true,
  imports: [
    NavbarComponent, FormsModule, RouterLink, LucideActivity, LucideAlertTriangle, LucideBan, LucideBox,
    LucideChevronLeft, LucideChevronRight, LucideCircleCheck, LucideGauge, LucideLink2, LucideRefreshCw,
    LucideEye, LucideMoreHorizontal, LucideNetwork, LucidePlus, LucidePower, LucideSearch, LucideServer,
    LucideTrash2, LucideX, Tr069ConsoleComponent,
    OnuModelCatalogComponent,
  ],
  templateUrl: './olt.html',
  styleUrl: './olt.scss',
})
export class OltComponent implements OnInit, OnDestroy {
  private readonly olt = inject(OltService);
  private readonly toast = inject(ToastService);
  readonly auth = inject(AuthService);

  readonly status = signal<OltStatus>(EMPTY_STATUS);
  readonly pons = signal<OltPon[]>([]);
  readonly mapOnus = signal<OltOnu[]>([]);
  readonly onuPage = signal<OltOnuPage>(EMPTY_PAGE);
  readonly alarms = signal<OltAlarm[]>([]);
  readonly signalAlerts = signal<OltSignalAlert[]>([]);
  readonly topology = signal<OltSplitter[]>([]);
  readonly profiles = signal<OltProvisioningProfile[]>([]);
  readonly planSyncPreview = signal<OltPlanSyncPreview | null>(null);
  readonly planSyncLoading = signal(false);
  readonly planSyncSaving = signal(false);
  readonly unconfigured = signal<OltUnconfiguredOnu[]>([]);
  readonly discoveryFilter = signal<DiscoveryFilter>('all');
  readonly discoveryCounts = computed(() => {
    const rows = this.unconfigured();
    return {
      all: rows.length,
      new: rows.filter((onu) => !onu.relocation).length,
      relocation: rows.filter((onu) => Boolean(onu.relocation)).length,
      review: rows.filter((onu) => onu.authorizationStatus === 'review' || (onu.relocation && !onu.relocation.allowed)).length,
    };
  });
  readonly filteredUnconfigured = computed(() => {
    const filter = this.discoveryFilter();
    return this.unconfigured().filter((onu) => {
      if (filter === 'new') return !onu.relocation;
      if (filter === 'relocation') return Boolean(onu.relocation);
      if (filter === 'review') return onu.authorizationStatus === 'review' || Boolean(onu.relocation && !onu.relocation.allowed);
      return true;
    });
  });
  readonly installations = signal<ProvisioningJob[]>([]);
  readonly cancellationPreview = signal<ProvisioningCancellationPreview | null>(null);
  readonly cancellationTargetId = signal<string | null>(null);
  readonly cancellationLoading = signal(false);
  readonly cancellationSaving = signal(false);
  readonly activeInstallations = computed(() => this.installations().filter((job) => !['complete', 'cancelled'].includes(job.status)).length);
  readonly reconciliation = signal<OltReconciliation>(EMPTY_RECONCILIATION);
  readonly associationPreview = signal<OltAssociationPreview | null>(null);
  readonly associationLoading = signal(false);
  readonly associationSaving = signal(false);
  readonly activity = signal<OltActivity[]>([]);
  readonly selectedOnu = signal<OltOnu | null>(null);
  readonly selectedMapOnu = signal<OltOnu | null>(null);
  readonly selectedMapPon = signal<number | null>(null);
  readonly openOnuTabs = signal<OltOnu[]>([]);
  readonly activeWorkspace = signal<string>('map');
  readonly ponSearch = signal('');
  readonly legacyDrawerOnu = computed<OltOnu | null>(() => null);
  readonly opticalHistory = signal<OltOpticalReading[]>([]);
  readonly serviceDiagnostic = signal<OltServiceDiagnostic | null>(null);
  readonly diagnosticLoading = signal(false);
  readonly operationPreview = signal<OltOperationPreview | null>(null);
  readonly operationSaving = signal(false);
  readonly tr069Device = signal<Tr069Device | null>(null);
  readonly tr069Loading = signal(false);
  readonly tr069Saving = signal(false);
  readonly clientResults = signal<OltClientSummary[]>([]);
  readonly provisioningOnu = signal<OltUnconfiguredOnu | null>(null);
  readonly provisioningCatalog = signal<OltProvisioningCatalog | null>(null);
  readonly provisioningPreview = signal<OltProvisioningPreview | null>(null);
  readonly provisioningResult = signal<OltProvisioningResult | null>(null);
  readonly provisioningClient = signal<OltClientSummary | null>(null);
  readonly provisioningClientResults = signal<OltClientSummary[]>([]);
  readonly provisioningStep = signal(1);
  readonly provisioningLoading = signal(false);
  readonly provisioningSaving = signal(false);
  readonly provisioningClientSearching = signal(false);
  readonly provisioningClientQuery = signal('');
  readonly ipPickerOpen = signal(false);
  readonly ipPickerLoading = signal(false);
  readonly ipPickerSaving = signal(false);
  readonly ipCatalog = signal<ProvisioningIpCatalog | null>(null);
  readonly ipReservation = signal<ProvisioningIpReservation | null>(null);
  readonly selectedAvailableIp = signal<ProvisioningIpAddress | null>(null);
  readonly tab = signal<OltTab>('overview');
  readonly onuStatus = signal<OnuFilter>('all');
  readonly mappingStatus = signal<MappingFilter>('all');
  readonly selectedPon = signal<number | null>(null);
  readonly loading = signal(true);
  readonly syncing = signal(false);
  readonly detailLoading = signal(false);
  readonly mappingSaving = signal(false);
  readonly clientSearching = signal(false);
  readonly clientSearch = signal('');
  readonly search = signal('');
  readonly lastLoadedAt = signal<Date | null>(null);
  readonly onlinePercent = computed(() => {
    const totals = this.status().totals;
    return totals.totalOnus ? Math.round((totals.onlineOnus / totals.totalOnus) * 100) : 0;
  });
  readonly hottestCard = computed<import('../../services/olt.service').OltCard | null>(() => {
    const cards = this.status().cards.filter((card) => card.temperatureC != null);
    return cards.sort((a, b) => (b.temperatureC || 0) - (a.temperatureC || 0))[0] || null;
  });
  readonly filteredPons = computed(() => {
    const query = this.ponSearch().trim().toLowerCase();
    return this.pons().filter((pon) => !query || `pon ${pon.pon} ${pon.ponIndex}`.toLowerCase().includes(query));
  });
  readonly activePon = computed<OltPon | null>(() => this.pons().find((pon) => pon.pon === this.selectedMapPon()) || this.pons()[0] || null);
  readonly activePonOnus = computed(() => {
    const pon = this.activePon()?.pon;
    return this.mapOnus().filter((onu) => onu.pon === pon).sort((a, b) => a.onuId - b.onuId);
  });
  readonly ponMapGroups = computed<PonMapGroup[]>(() => this.buildPonMapGroups());

  private refreshTimer?: ReturnType<typeof setInterval>;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private clientSearchTimer?: ReturnType<typeof setTimeout>;
  private provisioningClientSearchTimer?: ReturnType<typeof setTimeout>;
  private tr069PollTimer?: ReturnType<typeof setTimeout>;

  provisioningOnuType = '';
  provisioningName = '';
  provisioningVlan = 101;
  provisioningTcontProfile = '';
  provisioningTrafficProfile = '';
  provisioningManagementIp = '';
  provisioningServiceMode: 'router' | 'bridge' = 'router';
  provisioningLanPorts = [1];
  provisioningProfileId: number | null = null;
  provisioningModelProfileId: number | null = null;
  ipPickerNetwork = '';
  ipPickerSearch = '';
  onuRenameName = '';
  tr069Ssid = '';
  tr069Password = '';
  tr069Channel: number | null = null;
  tr069WifiEnabled = true;
  tr069WifiBroadcast = true;
  newSplitter = { name: '', ponIndex: '1/1/1', ratio: 16, zone: '' };
  newNap = { code: '', name: '', splitterId: 0, capacity: 16, zone: '' };
  selectedNapPortId: number | null = null;
  selectedNapPortOnu = '';
  newProfile = { name: '', onuType: '', vendorPrefix: '', vlan: 101, tcontProfile: '', trafficProfile: '', isDefault: false };

  ngOnInit() {
    this.loadAll();
    this.refreshTimer = setInterval(() => this.loadAll(true), 60000);
  }

  ngOnDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.clientSearchTimer) clearTimeout(this.clientSearchTimer);
    if (this.provisioningClientSearchTimer) clearTimeout(this.provisioningClientSearchTimer);
    if (this.tr069PollTimer) clearTimeout(this.tr069PollTimer);
  }

  loadAll(silent = false) {
    if (!silent) this.loading.set(true);
    forkJoin({
      status: this.olt.getStatus(),
      pons: this.olt.getPons(),
      alarms: this.olt.getAlarms(),
      signalAlerts: this.olt.getSignalAlerts(),
      topology: this.olt.getTopology(),
      profiles: this.olt.getProfiles(),
      onus: this.olt.getOnus(this.filters()),
      mapOnus: this.olt.getOnus({ page: 1, limit: 500 }),
      unconfigured: this.olt.getUnconfigured(),
      installations: this.olt.getProvisioningJobs(),
      reconciliation: this.olt.getReconciliation(),
      activity: this.olt.getActivity(),
    }).subscribe({
      next: ({ status, pons, alarms, signalAlerts, topology, profiles, onus, mapOnus, unconfigured, installations, reconciliation, activity }) => {
        this.status.set(status);
        this.pons.set(pons);
        this.alarms.set(alarms);
        this.signalAlerts.set(signalAlerts);
        this.topology.set(topology);
        this.profiles.set(profiles);
        this.onuPage.set(onus);
        this.mapOnus.set(mapOnus.items);
        if (this.selectedMapPon() == null && pons.length) this.selectedMapPon.set(pons[0].pon);
        this.restoreMapSelection(mapOnus.items);
        this.unconfigured.set(unconfigured);
        this.installations.set(installations);
        this.reconciliation.set(reconciliation);
        this.activity.set(activity);
        this.lastLoadedAt.set(new Date());
        this.loading.set(false);
      },
      error: (error: { error?: { error?: string } }) => {
        this.loading.set(false);
        if (!silent) this.toast.error(error.error?.error || 'No se pudo cargar el estado de la OLT');
      },
    });
  }

  loadOnus(page = 1) {
    const filters = { ...this.filters(), page };
    this.olt.getOnus(filters).subscribe({
      next: (result) => this.onuPage.set(result),
      error: () => this.toast.error('No se pudo cargar el inventario de ONUs'),
    });
  }

  setTab(tab: OltTab) {
    this.tab.set(tab);
    this.activeWorkspace.set('map');
    if (tab === 'profiles' && !this.planSyncPreview()) this.loadPlanSyncPreview();
  }

  setDiscoveryFilter(filter: DiscoveryFilter) {
    this.discoveryFilter.set(filter);
  }

  discoveryEmptyTitle() {
    return ({
      all: 'Cola de autorización al día',
      new: 'Sin ONUs nuevas',
      relocation: 'Sin cambios de PON',
      review: 'Sin casos por revisar',
    } as Record<DiscoveryFilter, string>)[this.discoveryFilter()];
  }

  discoveryEmptyMessage() {
    return ({
      all: 'No hay equipos nuevos ni cambios de PON esperando autorización.',
      new: 'Ningún equipo nuevo está esperando autorización.',
      relocation: 'Ninguna ONU conocida apareció conectada en otro puerto PON.',
      review: 'No existen conflictos de serial, cliente o ubicación.',
    } as Record<DiscoveryFilter, string>)[this.discoveryFilter()];
  }

  isManagementTab() {
    return ['profiles', 'topology', 'discovered', 'alarms', 'activity'].includes(this.tab());
  }

  selectMapWorkspace() {
    this.tab.set('overview');
    this.activeWorkspace.set('map');
  }

  selectMapPon(pon: number) {
    this.selectedMapPon.set(pon);
    const rows = this.mapOnus().filter((onu) => onu.pon === pon).sort((a, b) => this.onuStateRank(a) - this.onuStateRank(b));
    this.selectedMapOnu.set(rows[0] || null);
  }

  selectMapOnu(onu: OltOnu | null) {
    this.selectedMapOnu.set(onu);
  }

  openOnuWorkspace(onu: OltOnu) {
    this.inspectOnu(onu);
  }

  activateOnuWorkspace(onu: OltOnu) {
    if (this.selectedOnu()?.id === onu.id && this.activeWorkspace() === `onu:${onu.id}`) return;
    this.inspectOnu(onu);
  }

  closeOnuWorkspace(event: MouseEvent, onu: OltOnu) {
    event.stopPropagation();
    const remaining = this.openOnuTabs().filter((row) => row.id !== onu.id);
    this.openOnuTabs.set(remaining);
    if (this.activeWorkspace() !== `onu:${onu.id}`) return;
    const next = remaining.at(-1);
    if (next) this.activateOnuWorkspace(next);
    else this.closeDetail();
  }

  refreshOpticalPreview(onu: OltOnu) {
    if (this.detailLoading()) return;
    this.detailLoading.set(true);
    this.olt.getOnuDetail(onu).subscribe({
      next: (detail) => {
        const enriched = { ...detail, client: onu.client };
        this.mapOnus.update((rows) => rows.map((row) => row.id === enriched.id ? enriched : row));
        this.onuPage.update((page) => ({ ...page, items: page.items.map((row) => row.id === enriched.id ? enriched : row) }));
        this.selectedMapOnu.set(enriched);
        this.openOnuTabs.update((rows) => rows.map((row) => row.id === enriched.id ? enriched : row));
        if (this.selectedOnu()?.id === enriched.id) this.selectedOnu.set(enriched);
        this.detailLoading.set(false);
        this.toast.success(`Lectura óptica actualizada: ${enriched.rxPowerDbm ?? '--'} dBm`);
      },
      error: (error: { error?: { error?: string } }) => {
        this.detailLoading.set(false);
        this.toast.error(error.error?.error || 'No se pudo actualizar la lectura óptica');
      },
    });
  }

  openQuickReboot(onu: OltOnu) {
    this.inspectOnu(onu);
    this.prepareReboot();
  }

  onuState(onu: OltOnu | null): PonPortState {
    if (!onu) return 'empty';
    if (!onu.online) return 'offline';
    if (this.isCriticalPower(onu.rxPowerDbm)) return 'critical';
    if (this.isWeakPower(onu.rxPowerDbm)) return 'warning';
    return 'online';
  }

  onuStatusLabel(onu: OltOnu) {
    if (!onu.online) return this.phaseStateLabel(onu.phaseState);
    if (this.isCriticalPower(onu.rxPowerDbm)) return 'Señal crítica';
    if (this.isWeakPower(onu.rxPowerDbm)) return 'Señal débil';
    return 'ONU en línea';
  }

  // Estados de fase que reporta la ZTE C320, traducidos para el operador.
  private phaseStateLabel(phase?: string | null) {
    const labels: Record<string, string> = {
      'los': 'Sin señal óptica (LOS)',
      'dyinggasp': 'Sin energía',
      'offline': 'Fuera de línea',
      'not-seen': 'Nunca vista',
      'syncmib': 'Sincronizando',
      'logging': 'Registrándose',
      'authfailed': 'Autenticación fallida',
      'working': 'Operativa',
    };
    const key = String(phase || '').trim().toLowerCase();
    return labels[key] || phase || 'Fuera de línea';
  }

  loadPlanSyncPreview() {
    if (this.planSyncLoading()) return;
    this.planSyncLoading.set(true);
    this.olt.getPlanSyncPreview().subscribe({
      next: (preview) => {
        this.planSyncPreview.set(preview);
        this.planSyncLoading.set(false);
      },
      error: (error: { error?: { error?: string } }) => {
        this.planSyncLoading.set(false);
        this.toast.error(error.error?.error || 'No se pudieron comparar los planes');
      },
    });
  }

  applyPlanSync() {
    const preview = this.planSyncPreview();
    if (!preview || this.planSyncSaving()) return;
    this.planSyncSaving.set(true);
    this.olt.applyPlanSync(preview.requiredConfirmation).subscribe({
      next: (result) => {
        this.planSyncPreview.set(result.preview);
        this.planSyncSaving.set(false);
        this.toast.success(result.changed ? 'Perfiles creados y verificados en la OLT' : 'Los perfiles ya estaban sincronizados');
        this.loadAll(true);
      },
      error: (error: { error?: { error?: string } }) => {
        this.planSyncSaving.set(false);
        this.toast.error(error.error?.error || 'No se pudieron sincronizar los perfiles');
      },
    });
  }

  installationStage(stage: string) {
    const labels: Record<string, string> = {
      draft: 'Borrador', onu_detected: 'ONU identificada', client_validating: 'Validando cliente',
      wisphub_ready: 'WispHub listo', client_ready: 'Cliente listo', waiting_optical: 'Esperando fibra',
      onu_configured: 'ONU configurada', olt_discovered: 'Detectada por OLT', service_ready: 'Servicio listo',
      local_network: 'Red local preparada', local_reachability: 'ONU accesible', local_login: 'Sesion ONU iniciada',
      local_identity: 'Identidad confirmada', local_backup_before: 'Respaldo previo', local_wan: 'WAN configurada',
      local_tr069: 'TR-069 configurado', local_wifi: 'WiFi configurado', local_remote: 'Acceso remoto configurado',
      local_save: 'Configuracion guardada', local_verify: 'Verificacion local', local_failed: 'Fallo en agente local',
      client_partial: 'Alta parcial', client_failed: 'Fallo en alta', olt_failed: 'Fallo en OLT', olt_rolled_back: 'OLT revertida',
      cancelled: 'Cancelada',
    };
    return labels[stage] || stage.replaceAll('_', ' ');
  }

  continueInstallation(job: ProvisioningJob) {
    if (!job.serial) return;
    const discovered = this.unconfigured().find((onu) => onu.serial.toUpperCase() === job.serial?.toUpperCase());
    if (discovered) this.openProvisioningWizard(discovered);
    else { this.tab.set('discovered'); this.toast.info('La ONU aun no aparece en descubrimiento. Conectela a la fibra y sincronice.'); }
  }

  openInstallationCancellation(job: ProvisioningJob) {
    if (this.cancellationLoading() || this.cancellationSaving()) return;
    this.cancellationPreview.set(null);
    this.cancellationTargetId.set(job.id);
    this.cancellationLoading.set(true);
    this.olt.getProvisioningCancellationPreview(job.id).subscribe({
      next: (preview) => {
        this.cancellationPreview.set(preview);
        this.cancellationLoading.set(false);
      },
      error: (error: { error?: { error?: string } }) => {
        this.cancellationLoading.set(false);
        this.cancellationTargetId.set(null);
        this.toast.error(error.error?.error || 'No se pudo preparar la cancelacion');
      },
    });
  }

  closeInstallationCancellation() {
    if (this.cancellationSaving()) return;
    this.cancellationPreview.set(null);
    this.cancellationTargetId.set(null);
  }

  confirmInstallationCancellation() {
    const preview = this.cancellationPreview();
    if (!preview || !preview.allowed || this.cancellationSaving()) return;
    this.cancellationSaving.set(true);
    this.olt.cancelProvisioningJob(preview.job.id, preview.requiredConfirmation).subscribe({
      next: (result) => {
        this.installations.update((jobs) => jobs.map((job) => job.id === result.job.id ? result.job : job));
        this.cancellationSaving.set(false);
        this.closeInstallationCancellation();
        this.toast.success(preview.operation === 'close' ? 'Expediente cerrado' : 'Instalacion cancelada');
        this.loadAll(true);
      },
      error: (error: { error?: { error?: string } }) => {
        this.cancellationSaving.set(false);
        this.toast.error(error.error?.error || 'No se pudo cancelar la instalacion');
      },
    });
  }

  canCloseInstallation(job: ProvisioningJob) {
    return this.auth.hasRole(['admin']) && job.status !== 'cancelled' && !job.onuIndex;
  }

  filterStatus(status: OnuFilter) {
    this.onuStatus.set(status);
    this.loadOnus(1);
  }

  filterPon(pon: number | null) {
    this.selectedPon.set(pon);
    this.tab.set('onus');
    this.loadOnus(1);
  }

  filterMapping(mapping: MappingFilter) {
    this.mappingStatus.set(mapping);
    this.loadOnus(1);
  }

  searchChanged(value: string) {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadOnus(1), 300);
  }

  runSync(full = false) {
    if (this.syncing()) return;
    this.syncing.set(true);
    this.olt.sync(full).subscribe({
      next: () => {
        this.syncing.set(false);
        this.toast.success(full ? 'Inventario OLT actualizado' : 'Estado OLT actualizado');
        this.loadAll(true);
      },
      error: (error: { error?: { error?: string } }) => {
        this.syncing.set(false);
        this.toast.error(error.error?.error || 'La OLT no respondió');
      },
    });
  }

  openProvisioningWizard(onu: OltUnconfiguredOnu) {
    this.provisioningOnu.set(onu);
    this.provisioningCatalog.set(null);
    this.provisioningPreview.set(null);
    this.provisioningResult.set(null);
    this.provisioningClient.set(onu.suggestedClient || null);
    this.provisioningClientResults.set([]);
    this.provisioningClientQuery.set('');
    this.provisioningStep.set(1);
    this.provisioningLoading.set(true);
    this.olt.getProvisioningOptions(onu.serial).subscribe({
      next: (catalog) => {
        this.provisioningCatalog.set(catalog);
        this.provisioningProfileId = catalog.profiles.find((profile) => profile.isDefault)?.id || null;
        this.provisioningModelProfileId = catalog.modelProfile?.id || null;
        this.provisioningOnuType = catalog.recommendedOnuType || catalog.onuTypes[0]?.name || '';
        this.provisioningVlan = catalog.defaults.vlan;
        this.provisioningTcontProfile = catalog.defaults.tcontProfile || catalog.tcontProfiles[0]?.name || '';
        this.provisioningTrafficProfile = catalog.defaults.trafficProfile || catalog.trafficProfiles[0]?.name || '';
        const defaultProfile = catalog.profiles.find((profile) => profile.isDefault);
        this.provisioningServiceMode = defaultProfile?.serviceMode || 'router';
        this.provisioningLanPorts = defaultProfile?.lanPorts?.length ? defaultProfile.lanPorts : [1];
        this.ipPickerNetwork = catalog.defaults.managementCidr;
        this.ipPickerSearch = '';
        const selected = this.provisioningClient();
        if (selected) this.selectProvisioningClient(selected);
        this.provisioningLoading.set(false);
      },
      error: (error: { error?: { error?: string } }) => {
        this.provisioningLoading.set(false);
        this.toast.error(error.error?.error || 'No se pudieron leer las opciones de la OLT');
      },
    });
  }

  closeProvisioningWizard() {
    if (this.provisioningSaving()) return;
    this.provisioningOnu.set(null);
    this.provisioningCatalog.set(null);
    this.provisioningPreview.set(null);
    this.provisioningResult.set(null);
    this.ipPickerOpen.set(false);
  }

  provisioningClientSearchChanged(value: string) {
    this.provisioningClientQuery.set(value);
    this.provisioningClient.set(null);
    if (this.provisioningClientSearchTimer) clearTimeout(this.provisioningClientSearchTimer);
    if (value.trim().length < 2) { this.provisioningClientResults.set([]); return; }
    this.provisioningClientSearchTimer = setTimeout(() => {
      this.provisioningClientSearching.set(true);
      this.olt.searchClients(value.trim()).subscribe({
        next: (clients) => { this.provisioningClientResults.set(clients); this.provisioningClientSearching.set(false); },
        error: () => { this.provisioningClientResults.set([]); this.provisioningClientSearching.set(false); },
      });
    }, 300);
  }

  selectProvisioningClient(client: OltClientSummary) {
    this.provisioningClient.set(client);
    this.provisioningClientQuery.set(client.nombre);
    this.provisioningClientResults.set([]);
    this.provisioningManagementIp = client.ip || '';
    this.provisioningName = this.safeProvisioningName(client.nombre || client.usuario || `cliente_${client.idServicio}`);
    const speed = this.commercialPlanSpeed(client.planInternetName);
    const matchedProfile = speed == null ? null : this.provisioningCatalog()?.profiles.find((profile) =>
      profile.name.toLowerCase() === `internet ${speed} mbps`
      || new RegExp(`(?:^|-)${speed}M(?:-|$)`, 'i').test(profile.tcontProfile),
    );
    if (matchedProfile) this.applyProvisioningProfile(matchedProfile.id);
  }

  openIpPicker() {
    if (!this.provisioningClient() || !this.provisioningOnu()) {
      this.toast.error('Seleccione primero el cliente de la instalación');
      return;
    }
    this.ipPickerOpen.set(true);
    this.selectedAvailableIp.set(null);
    this.loadAvailableIps();
  }

  closeIpPicker() {
    if (!this.ipPickerSaving()) this.ipPickerOpen.set(false);
  }

  loadAvailableIps() {
    this.ipPickerLoading.set(true);
    this.olt.getAvailableIps(this.ipPickerNetwork, this.ipPickerSearch.trim()).subscribe({
      next: (catalog) => {
        this.ipCatalog.set(catalog);
        this.ipPickerLoading.set(false);
      },
      error: (error: { error?: { error?: string } }) => {
        this.ipPickerLoading.set(false);
        this.toast.error(error.error?.error || 'No se pudo consultar el inventario de IP');
      },
    });
  }

  chooseAvailableIp(address: ProvisioningIpAddress) {
    if (!address.reservation) this.selectedAvailableIp.set(address);
  }

  assignAvailableIp() {
    const client = this.provisioningClient();
    const onu = this.provisioningOnu();
    const address = this.selectedAvailableIp();
    if (!client || !onu || !address || this.ipPickerSaving()) return;
    const previousReservation = this.ipReservation();
    this.ipPickerSaving.set(true);
    this.olt.reserveIp(address.ip, client.nombre, onu.serial).subscribe({
      next: (reservation) => {
        this.olt.assignReservedIp(client.idServicio, reservation.token, onu.serial).subscribe({
          next: (result) => {
            this.provisioningClient.set(result.client);
            this.provisioningManagementIp = result.client.ip || address.ip;
            this.ipReservation.set(reservation);
            this.installations.update((items) => [result.job, ...items.filter((job) => job.id !== result.job.id)]);
            this.ipPickerSaving.set(false);
            this.ipPickerOpen.set(false);
            if (previousReservation && previousReservation.token !== reservation.token) {
              this.olt.releaseIpReservation(previousReservation.token).subscribe({ error: () => undefined });
            }
            this.toast.success(`${address.ip} reservada y sincronizada con WispHub y MikroTik`);
          },
          error: (error: { error?: { error?: string } }) => {
            this.olt.releaseIpReservation(reservation.token).subscribe({ error: () => undefined });
            this.ipPickerSaving.set(false);
            this.toast.error(error.error?.error || 'No se pudo asignar la IP al cliente');
          },
        });
      },
      error: (error: { error?: { error?: string } }) => {
        this.ipPickerSaving.set(false);
        this.toast.error(error.error?.error || 'La IP ya no esta disponible');
        this.loadAvailableIps();
      },
    });
  }

  applyProvisioningProfile(profileId: number | null) {
    this.provisioningProfileId = profileId ? Number(profileId) : null;
    const profile = this.provisioningCatalog()?.profiles.find((item) => item.id === this.provisioningProfileId);
    if (!profile) return;
    this.provisioningVlan = profile.vlan;
    this.provisioningTcontProfile = profile.tcontProfile;
    this.provisioningTrafficProfile = profile.trafficProfile;
    this.provisioningServiceMode = profile.serviceMode || 'router';
    this.provisioningLanPorts = profile.lanPorts?.length ? profile.lanPorts : [1];
    if (this.provisioningServiceMode === 'bridge') this.provisioningManagementIp = '';
    if (profile.onuType) this.provisioningOnuType = profile.onuType;
  }

  previewProvisioning() {
    const onu = this.provisioningOnu();
    const payload = this.provisioningPayload();
    if (!onu || !payload) {
      this.toast.error('Seleccione el cliente y complete la configuración');
      return;
    }
    this.provisioningLoading.set(true);
    this.olt.previewProvisioning(onu.serial, payload).subscribe({
      next: (preview) => {
        this.provisioningPreview.set(preview);
        this.provisioningStep.set(3);
        this.provisioningLoading.set(false);
      },
      error: (error: { error?: { error?: string } }) => {
        this.provisioningLoading.set(false);
        this.toast.error(error.error?.error || 'La prevalidacion de la ONU fallo');
      },
    });
  }

  runProvisioning() {
    const onu = this.provisioningOnu();
    const payload = this.provisioningPayload();
    const preview = this.provisioningPreview();
    if (!onu || !payload || !preview || this.provisioningSaving()) return;
    this.provisioningSaving.set(true);
    this.olt.provisionOnu(onu.serial, payload, preview.requiredConfirmation).subscribe({
      next: (result) => {
        this.provisioningSaving.set(false);
        this.provisioningResult.set(result);
        this.provisioningStep.set(4);
        this.toast.success(`ONU ${result.onuIndex} autorizada y verificada`);
        this.loadAll(true);
      },
      error: (error: { error?: { error?: string; rollback?: { attempted?: boolean; ok?: boolean } } }) => {
        this.provisioningSaving.set(false);
        const rollback = error.error?.rollback;
        const suffix = rollback?.attempted ? (rollback.ok ? ' Se revirtio el cambio.' : ' Revise la OLT: el rollback fallo.') : '';
        this.toast.error((error.error?.error || 'No se pudo autorizar la ONU') + suffix);
      },
    });
  }

  provisioningPayload(): OltProvisioningPayload | null {
    const client = this.provisioningClient();
    if (!client) return null;
    return {
      profileId: this.provisioningProfileId,
      modelProfileId: this.provisioningModelProfileId,
      clientIdServicio: client.idServicio,
      onuType: this.provisioningOnuType,
      name: this.provisioningName,
      vlan: Number(this.provisioningVlan),
      tcontProfile: this.provisioningTcontProfile,
      trafficProfile: this.provisioningTrafficProfile,
      managementIp: this.provisioningServiceMode === 'bridge' ? null : this.provisioningManagementIp,
      serviceMode: this.provisioningServiceMode,
      lanPorts: this.provisioningLanPorts,
      previousOnuIndex: this.provisioningOnu()?.relocation?.previousLocation?.onuIndex || null,
    };
  }

  private safeProvisioningName(value: string) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 32) || 'ONU_nueva';
  }

  private commercialPlanSpeed(value?: string | null) {
    const name = String(value || '');
    const explicitMbps = name.match(/\b(\d{1,4})\s*M(?:BPS|B|EGAS?)?/i);
    if (explicitMbps) return Number(explicitMbps[1]);
    if (/fi(?:bra|nra)/i.test(name)) {
      const firstNumber = name.match(/\b(\d{1,4})\b/);
      if (firstNumber) return Number(firstNumber[1]);
    }
    return null;
  }

  formatTraffic(value?: number | null) {
    const bps = Number(value || 0);
    if (bps < 1) return '0 bps';
    if (bps < 1_000) return `${Math.round(bps)} bps`;
    if (bps < 1_000_000) return `${(bps / 1_000).toFixed(1)} Kbps`;
    if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(bps >= 10_000_000 ? 1 : 2)} Mbps`;
    return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
  }

  inspectOnu(onu: OltOnu) {
    this.tab.set('overview');
    this.activeWorkspace.set(`onu:${onu.id}`);
    this.openOnuTabs.update((rows) => rows.some((row) => row.id === onu.id) ? rows : [...rows, onu]);
    this.selectedOnu.set(onu);
    this.onuRenameName = this.safeProvisioningName(onu.name || onu.client?.nombre || 'ONU');
    this.opticalHistory.set([]);
    this.clientSearch.set('');
    this.clientResults.set([]);
    this.serviceDiagnostic.set(null);
    this.tr069Device.set(null);
    this.loadTr069(onu);
    this.detailLoading.set(true);
    this.olt.getOnuDetail(onu).subscribe({
      next: (detail) => {
        const enriched = { ...detail, client: onu.client };
        this.selectedOnu.set(enriched);
        this.selectedMapOnu.set(enriched);
        this.mapOnus.update((rows) => rows.map((row) => row.id === enriched.id ? enriched : row));
        this.openOnuTabs.update((rows) => rows.map((row) => row.id === enriched.id ? enriched : row));
        this.onuRenameName = this.safeProvisioningName(enriched.name || enriched.client?.nombre || 'ONU');
        this.detailLoading.set(false);
        this.onuPage.update((page) => ({ ...page, items: page.items.map((row) => row.id === detail.id ? enriched : row) }));
        this.loadOpticalHistory(enriched);
        this.loadServiceDiagnostic(enriched);
      },
      error: (error: { error?: { error?: string } }) => {
        this.detailLoading.set(false);
        this.toast.error(error.error?.error || 'No se pudo consultar la potencia óptica');
      },
    });
  }

  loadTr069(onu = this.selectedOnu(), silent = false) {
    if (!onu?.serial) return;
    if (!silent) this.tr069Loading.set(true);
    this.olt.getTr069Device(onu.serial).subscribe({
      next: (device) => {
        this.tr069Device.set(device);
        this.populateTr069Form(device);
        this.tr069Loading.set(false);
        if (device.tasks.some((task) => ['pending', 'processing'].includes(task.status))) this.scheduleTr069Poll();
      },
      error: () => {
        this.tr069Loading.set(false);
        if (!silent) this.toast.error('No se pudo consultar el control TR-069');
      },
    });
  }

  setTr069Enabled(enabled: boolean) {
    const onu = this.selectedOnu();
    if (!onu?.serial || this.tr069Saving()) return;
    this.tr069Saving.set(true);
    this.olt.setTr069Enabled(onu.serial, enabled).subscribe({
      next: (device) => {
        this.tr069Device.set(device);
        this.tr069Saving.set(false);
        this.toast.success(enabled ? 'ONU inscrita para control TR-069' : 'Control TR-069 desactivado');
        if (enabled) this.queueTr069Action('refresh');
      },
      error: (error) => {
        this.tr069Saving.set(false);
        this.toast.error(error?.error?.error || 'No se pudo cambiar la administracion TR-069');
      },
    });
  }

  saveTr069Wifi() {
    const payload: Record<string, unknown> = {
      ssid: this.tr069Ssid.trim(),
      enabled: this.tr069WifiEnabled,
      broadcast: this.tr069WifiBroadcast,
    };
    if (this.tr069Channel != null) payload['channel'] = Number(this.tr069Channel);
    if (this.tr069Password) payload['password'] = this.tr069Password;
    this.queueTr069Action('set_wifi', payload);
  }

  queueTr069Action(action: Tr069TaskAction, payload: Record<string, unknown> = {}) {
    const onu = this.selectedOnu();
    if (!onu?.serial || this.tr069Saving()) return;
    this.tr069Saving.set(true);
    this.olt.createTr069Task(onu.serial, action, payload).subscribe({
      next: (task) => {
        this.tr069Saving.set(false);
        this.tr069Password = '';
        this.tr069Device.update((device) => device ? { ...device, tasks: [task, ...device.tasks.filter((item) => item.id !== task.id)] } : device);
        this.toast.success(this.tr069ActionLabel(task) + ' enviada al agente local');
        this.scheduleTr069Poll();
      },
      error: (error) => {
        this.tr069Saving.set(false);
        this.toast.error(error?.error?.error || 'No se pudo crear la tarea TR-069');
      },
    });
  }

  tr069ActionLabel(task: Pick<Tr069Task, 'action'>) {
    return task.action === 'refresh' ? 'Actualizacion' : task.action === 'set_wifi' ? 'Configuracion WiFi' : 'Reinicio';
  }

  tr069StatusLabel(status: string) {
    return ({ pending: 'En cola', processing: 'Ejecutando', success: 'Completada', failed: 'Con error', cancelled: 'Cancelada' } as Record<string, string>)[status] || status;
  }

  private populateTr069Form(device: Tr069Device) {
    const wifi = device.snapshot?.wifi;
    if (!wifi) return;
    this.tr069Ssid = wifi.ssid || '';
    this.tr069Channel = wifi.channel ?? null;
    this.tr069WifiEnabled = wifi.enabled;
    this.tr069WifiBroadcast = wifi.broadcast !== false;
  }

  private scheduleTr069Poll() {
    if (this.tr069PollTimer) clearTimeout(this.tr069PollTimer);
    this.tr069PollTimer = setTimeout(() => this.loadTr069(this.selectedOnu(), true), 3000);
  }

  loadServiceDiagnostic(onu = this.selectedOnu()) {
    if (!onu || this.diagnosticLoading()) return;
    this.diagnosticLoading.set(true);
    this.olt.getServiceDiagnostics(onu).subscribe({
      next: (diagnostic) => { this.serviceDiagnostic.set(diagnostic); this.diagnosticLoading.set(false); },
      error: (error: { error?: { error?: string } }) => {
        this.diagnosticLoading.set(false);
        this.toast.error(error.error?.error || 'No se pudo verificar el servicio completo');
      },
    });
  }

  loadOpticalHistory(onu = this.selectedOnu()) {
    if (!onu) return;
    this.olt.getOpticalHistory(onu).subscribe({ next: (readings) => this.opticalHistory.set(readings) });
  }

  searchClientChanged(value: string) {
    this.clientSearch.set(value);
    if (this.clientSearchTimer) clearTimeout(this.clientSearchTimer);
    if (value.trim().length < 2) { this.clientResults.set([]); return; }
    this.clientSearchTimer = setTimeout(() => {
      this.clientSearching.set(true);
      this.olt.searchClients(value.trim()).subscribe({
        next: (clients) => { this.clientResults.set(clients); this.clientSearching.set(false); },
        error: () => { this.clientResults.set([]); this.clientSearching.set(false); },
      });
    }, 250);
  }

  assignClient(client: OltClientSummary | null) {
    const onu = this.selectedOnu();
    if (!onu || this.mappingSaving()) return;
    this.mappingSaving.set(true);
    this.olt.assignClient(onu, client?.idServicio ?? null).subscribe({
      next: () => {
        this.mappingSaving.set(false);
        this.selectedOnu.update((current) => current ? {
          ...current, clientIdServicio: client?.idServicio ?? null, client,
          mappingSource: client ? 'manual' : null, mappedAt: client ? new Date().toISOString() : null,
        } : null);
        this.clientSearch.set('');
        this.clientResults.set([]);
        this.toast.success(client ? `ONU asociada a ${client.nombre}` : 'Asociacion eliminada');
        this.loadAll(true);
      },
      error: (error: { error?: { error?: string } }) => {
        this.mappingSaving.set(false);
        this.toast.error(error.error?.error || 'No se pudo guardar la asociacion');
      },
    });
  }

  openAssociationPreview() {
    if (this.associationLoading()) return;
    this.associationLoading.set(true);
    this.olt.getAssociationPreview().subscribe({
      next: (preview) => {
        this.associationPreview.set(preview);
        this.associationLoading.set(false);
      },
      error: (error: { error?: { error?: string } }) => {
        this.associationLoading.set(false);
        this.toast.error(error.error?.error || 'No se pudo preparar la asociacion masiva');
      },
    });
  }

  closeAssociationPreview() {
    if (this.associationSaving()) return;
    this.associationPreview.set(null);
  }

  applyAssociationPreview() {
    const preview = this.associationPreview();
    if (!preview || !preview.matches.length || this.associationSaving()) return;
    this.associationSaving.set(true);
    this.olt.applyAssociationPreview(preview.requiredConfirmation).subscribe({
      next: (result) => {
        this.associationSaving.set(false);
        this.associationPreview.set(null);
        this.toast.success(`${result.applied} ONU asociadas con clientes verificados`);
        this.loadAll(true);
      },
      error: (error: { error?: { error?: string; preview?: OltAssociationPreview } }) => {
        this.associationSaving.set(false);
        if (error.error?.preview) this.associationPreview.set(error.error.preview);
        this.toast.error(error.error?.error || 'No se pudieron guardar las asociaciones');
      },
    });
  }

  associationConflictLabel(reason: string) {
    return ({
      ambiguous_client: 'Varios clientes coinciden',
      client_already_linked: 'El cliente ya tiene otra ONU',
      multiple_onus_for_client: 'Dos ONU coinciden con el mismo cliente',
      no_match: 'Sin coincidencia verificable',
    } as Record<string, string>)[reason] || reason;
  }

  createSplitter() {
    this.olt.createSplitter(this.newSplitter).subscribe({
      next: (created) => { this.toast.success(`Splitter ${created.name} creado`); this.newSplitter = { name: '', ponIndex: created.ponIndex, ratio: 16, zone: '' }; this.loadAll(true); },
      error: (error: { error?: { error?: string } }) => this.toast.error(error.error?.error || 'No se pudo crear el splitter'),
    });
  }

  createNap() {
    this.olt.createNap(this.newNap).subscribe({
      next: (created) => { this.toast.success(`NAP ${created.code} creada con ${created.capacity} puertos`); this.newNap = { code: '', name: '', splitterId: this.newNap.splitterId, capacity: 16, zone: '' }; this.loadAll(true); },
      error: (error: { error?: { error?: string } }) => this.toast.error(error.error?.error || 'No se pudo crear la NAP'),
    });
  }

  selectNapPort(id: number, onuIndex?: string | null) {
    this.selectedNapPortId = id;
    this.selectedNapPortOnu = onuIndex || '';
  }

  saveNapPort(status: 'available' | 'reserved' | 'assigned' | 'damaged') {
    if (!this.selectedNapPortId) return;
    this.olt.updateNapPort(this.selectedNapPortId, { status, onuIndex: status === 'assigned' ? this.selectedNapPortOnu : null }).subscribe({
      next: () => { this.toast.success('Puerto NAP actualizado'); this.selectedNapPortId = null; this.selectedNapPortOnu = ''; this.loadAll(true); },
      error: (error: { error?: { error?: string } }) => this.toast.error(error.error?.error || 'No se pudo actualizar el puerto'),
    });
  }

  createProfile() {
    this.olt.createProfile(this.newProfile).subscribe({
      next: (profile) => { this.toast.success(`Perfil ${profile.name} guardado`); this.newProfile = { name: '', onuType: '', vendorPrefix: '', vlan: 101, tcontProfile: '', trafficProfile: '', isDefault: false }; this.loadAll(true); },
      error: (error: { error?: { error?: string } }) => this.toast.error(error.error?.error || 'No se pudo guardar el perfil'),
    });
  }

  toggleProfile(profile: OltProvisioningProfile) {
    this.olt.updateProfile(profile.id, { active: !profile.active }).subscribe({
      next: () => { this.toast.success(profile.active ? 'Perfil archivado' : 'Perfil activado'); this.loadAll(true); },
      error: (error: { error?: { error?: string } }) => this.toast.error(error.error?.error || 'No se pudo actualizar el perfil'),
    });
  }

  prepareReboot() {
    const onu = this.selectedOnu();
    if (!onu) return;
    this.olt.previewOperation(onu, 'reboot').subscribe({
      next: (preview) => this.operationPreview.set(preview),
      error: (error: { error?: { error?: string } }) => this.toast.error(error.error?.error || 'No se pudo validar la operacion'),
    });
  }

  prepareRename() {
    const onu = this.selectedOnu();
    if (!onu) return;
    const name = this.safeProvisioningName(this.onuRenameName);
    this.onuRenameName = name;
    this.olt.previewOperation(onu, 'rename', name).subscribe({
      next: (preview) => this.operationPreview.set(preview),
      error: (error: { error?: { error?: string } }) => this.toast.error(error.error?.error || 'No se pudo validar el nuevo nombre'),
    });
  }

  prepareStaleLocationCleanup() {
    const onu = this.selectedOnu();
    if (!onu?.serial) return;
    this.olt.previewOperation(onu, 'retire-stale').subscribe({
      next: (preview) => this.operationPreview.set(preview),
      error: (error: { error?: { error?: string } }) => this.toast.error(error.error?.error || 'No se pudo analizar el cambio de puerto'),
    });
  }

  prepareFullRetirement() {
    const onu = this.selectedOnu();
    if (!onu?.serial) return;
    this.olt.previewOperation(onu, 'retire-full').subscribe({
      next: (preview) => this.operationPreview.set(preview),
      error: (error: { error?: { error?: string } }) => this.toast.error(error.error?.error || 'No se pudo preparar la eliminacion completa'),
    });
  }

  executeProtectedOperation() {
    const onu = this.selectedOnu();
    const preview = this.operationPreview();
    if (!onu || !preview || !preview.allowed || this.operationSaving()) return;
    this.operationSaving.set(true);
    this.olt.executeOperation(onu, preview.action, preview.requiredConfirmation, preview.newName || undefined).subscribe({
      next: (result) => {
        this.operationSaving.set(false);
        this.operationPreview.set(null);
        if (preview.action === 'rename' && result.newName) {
          this.onuRenameName = result.newName;
          this.selectedOnu.update((current) => current ? { ...current, name: result.newName } : current);
          this.onuPage.update((page) => ({ ...page, items: page.items.map((row) => row.onuIndex === onu.onuIndex ? { ...row, name: result.newName } : row) }));
          this.loadAll(true);
        }
        if (preview.action === 'retire-stale' || preview.action === 'retire-full') {
          this.closeDetail();
          this.loadAll(true);
        }
        this.toast.success(result.message);
      },
      error: (error: { error?: { error?: string } }) => { this.operationSaving.set(false); this.toast.error(error.error?.error || 'No se pudo completar la operacion'); },
    });
  }

  activityActionLabel(action: string) {
    return ({
      olt_onu_renamed: 'Nombre ONU cambiado',
      olt_onu_rebooted: 'ONU reiniciada',
      olt_stale_locations_retired: 'Ubicacion anterior retirada',
      olt_onu_retired_for_reassociation: 'ONU eliminada para reasociar',
      olt_onu_full_retirement_failed: 'Error eliminando ONU',
      olt_stale_location_cleanup_failed: 'Limpieza de ubicacion fallida',
    } as Record<string, string>)[action] || action;
  }

  activityDetail(event: OltActivity) {
    if (event.action === 'olt_onu_renamed') return `${event.details.oldName || 'sin_nombre'} -> ${event.details.newName || '--'}`;
    if (event.action === 'olt_stale_locations_retired') return `${event.details.removed?.join(', ') || '--'} -> ${event.details.activeLocation || '--'}`;
    return event.details.clientName || (event.details.totalOnus != null ? `${event.details.totalOnus} ONUs` : '--');
  }

  closeDetail() {
    if (this.tr069PollTimer) clearTimeout(this.tr069PollTimer);
    this.selectedOnu.set(null);
    this.clientResults.set([]);
    this.operationPreview.set(null);
    this.onuRenameName = '';
    this.tr069Device.set(null);
    this.activeWorkspace.set('map');
  }
  ponUsage(pon: OltPon) { return pon.utilizationPercent; }
  isWeakPower(value?: number | null) { return value != null && value <= -27; }
  isCriticalPower(value?: number | null) { return value != null && value <= -30; }
  trackPon(_: number, pon: OltPon) { return pon.ponIndex; }

  formatDate(value?: string | Date | null) {
    if (!value) return 'Sin registro';
    return new Intl.DateTimeFormat('es-DO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  }

  private filters() {
    return {
      page: this.onuPage().page || 1,
      limit: 50,
      search: this.search(),
      pon: this.selectedPon() || undefined,
      status: this.onuStatus(),
      mapping: this.mappingStatus(),
    };
  }

  private restoreMapSelection(rows: OltOnu[]) {
    const selected = this.selectedMapOnu();
    if (selected) {
      const updated = rows.find((row) => row.id === selected.id);
      if (updated) { this.selectedMapOnu.set(updated); return; }
    }
    const pon = this.selectedMapPon();
    const candidates = rows.filter((row) => pon == null || row.pon === pon).sort((a, b) => this.onuStateRank(a) - this.onuStateRank(b));
    this.selectedMapOnu.set(candidates[0] || null);
  }

  private onuStateRank(onu: OltOnu) {
    return ({ critical: 0, offline: 1, warning: 2, online: 3, empty: 4, damaged: 5 } as Record<PonPortState, number>)[this.onuState(onu)];
  }

  private buildPonMapGroups(): PonMapGroup[] {
    const activePon = this.activePon();
    if (!activePon) return [];
    const byIndex = new Map(this.activePonOnus().map((onu) => [onu.onuIndex, onu]));
    const splitters = this.topology().filter((splitter) => Number(splitter.ponIndex.split('/').at(-1)) === activePon.pon);
    const physicalGroups = splitters.flatMap((splitter) => splitter.naps.map((nap) => {
      const readings = nap.ports.map((port) => byIndex.get(port.onuIndex || '')).filter((onu): onu is OltOnu => Boolean(onu?.rxPowerDbm != null));
      const average = readings.length ? readings.reduce((total, onu) => total + Number(onu.rxPowerDbm), 0) / readings.length : null;
      return {
        key: `nap:${nap.id}`,
        name: nap.name || nap.code,
        meta: `${nap.usedPorts}/${nap.capacity} usados${average == null ? '' : ` · RX promedio ${average.toFixed(1)} dBm`}`,
        ports: nap.ports.map((port): PonMapPort => {
          const onu = byIndex.get(port.onuIndex || '') || null;
          return {
            key: `nap-port:${port.id}`,
            number: port.portNumber,
            state: port.status === 'damaged' ? 'damaged' : this.onuState(onu),
            onu,
            label: onu ? `${onu.client?.nombre || onu.name || onu.onuIndex}: ${this.onuStatusLabel(onu)}` : `${nap.name} puerto ${port.portNumber}: ${port.status}`,
          };
        }),
      };
    }));
    if (physicalGroups.length) return physicalGroups;

    const rows = this.activePonOnus();
    const capacity = Math.max(activePon.capacity || 32, rows.at(-1)?.onuId || 0);
    const lastAssignedId = rows.at(-1)?.onuId || 0;
    const visibleCapacity = Math.min(capacity, Math.max(8, Math.ceil(lastAssignedId / 8) * 8 + (lastAssignedId < capacity ? 8 : 0)));
    const groupCount = Math.max(1, Math.ceil(visibleCapacity / 8));
    return Array.from({ length: groupCount }, (_, groupIndex): PonMapGroup => {
      const first = groupIndex * 8 + 1;
      const ports = Array.from({ length: Math.min(8, capacity - groupIndex * 8) }, (_, offset): PonMapPort => {
        const number = first + offset;
        const onu = rows.find((row) => row.onuId === number) || null;
        return { key: `onu:${activePon.pon}:${number}`, number, state: this.onuState(onu), onu, label: onu ? `${onu.client?.nombre || onu.name || onu.onuIndex}: ${this.onuStatusLabel(onu)}` : `Posición ${number} disponible` };
      });
      const populated = ports.map((port) => port.onu).filter((onu): onu is OltOnu => Boolean(onu));
      const readings = populated.filter((onu) => onu.rxPowerDbm != null);
      const average = readings.length ? readings.reduce((total, onu) => total + Number(onu.rxPowerDbm), 0) / readings.length : null;
      return { key: `logical:${groupIndex}`, name: `Grupo ${String(first).padStart(2, '0')}-${String(first + ports.length - 1).padStart(2, '0')}`, meta: `${populated.length}/${ports.length} ONUs${average == null ? '' : ` · RX promedio ${average.toFixed(1)} dBm`}`, ports };
    });
  }
}
