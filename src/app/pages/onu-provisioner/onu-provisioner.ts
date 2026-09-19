import { HttpClient, HttpParams } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  LucideActivity, LucideArrowLeft, LucideArrowRight, LucideCable, LucideCheck, LucideCircleAlert, LucideCircleCheck, LucideDownload,
  LucideHistory, LucideKeyRound, LucideLaptop, LucideLoaderCircle, LucidePencil,
  LucidePlay, LucideRefreshCw, LucideRouter, LucideSearch, LucideServer, LucideSettings,
  LucideShieldCheck, LucideShieldOff, LucideUserPlus, LucideWifi, LucideX,
} from '@lucide/angular';
import { firstValueFrom } from 'rxjs';
import { NavbarComponent } from '../../components/layout/navbar';
import { AuthService } from '../../services/auth.service';
import { PlanLabelPipe } from '../../pipes/plan-label.pipe';
import { ExportService } from '../../services/export.service';
import { CopyValueComponent } from '../olt/copy-value';
import { AgentReadinessComponent } from './agent-readiness';

type AgentTab = 'operation' | 'agents' | 'history';
type AgentTaskAction = 'discover' | 'check' | 'provision';
type AgentTaskStatus = 'pending' | 'processing' | 'success' | 'failed' | 'cancelled';
type ServiceOperation = 'new_client' | 'restore_same_onu' | 'replace_onu' | 'migrate_pon';
type WizardStep = 1 | 2 | 3 | 4;

interface AgentDiscovery {
  status?: string;
  detected?: boolean;
  next_action?: string;
  last_scan_at?: string | null;
  device?: null | {
    host?: string; model?: string; vendor?: string; adapter_name?: string;
    latency_ms?: number | null; serial?: string;
  };
}

interface AgentCapabilities {
  actions?: AgentTaskAction[];
  supportedDevices?: Array<{ model: string; vendor: string; writeCertified: boolean }>;
  adapters?: Array<{ index: number; name: string; status?: string; supported?: boolean }>;
  networkRanges?: Array<{
    id: string; name: string; cidr: string; vlan: number; gateway: string;
    primary_dns: string; secondary_dns?: string; active: boolean; priority?: number;
    allocation_start?: string | null; allocation_end?: string | null; exclusions?: string[];
  }>;
  recommendedLocalNetwork?: { adapter_index?: number | null; address?: string; prefix_length?: number };
}

interface OnuAgent {
  id: string; agentId: string; displayName: string; active: boolean; online: boolean;
  version?: string | null; hostname?: string | null; windowsUser?: string | null;
  osName?: string | null; architecture?: string | null; isAdmin: boolean;
  lastIp?: string | null; lastSeenAt?: string | null; createdBy?: string | null;
  tokenFingerprint?: string | null; pairedAt?: string | null;
  revokedAt?: string | null; revokedBy?: string | null;
  capabilities: AgentCapabilities; discovery?: AgentDiscovery | null;
  currentTask?: OnuAgentTask | null;
}

interface AgentTaskPayload {
  device?: { host?: string; model?: string; username?: string };
  local_network?: { adapter_index?: number; address?: string; prefix_length?: number };
  wan?: { ip_address?: string; vlan_id?: number; gateway?: string };
  wifi?: { ssid?: string; enabled?: boolean };
  cloud_job_id?: string | null;
  [key: string]: unknown;
}

interface OnuAgentTask {
  id: string; agentId: string; agentName?: string | null; action: AgentTaskAction;
  status: AgentTaskStatus; payload: AgentTaskPayload; hasProtectedData: boolean;
  result?: { localJobId?: string; events?: AgentTaskEvent[]; result?: Record<string, any> } | null;
  errorMessage?: string | null; errorCode?: string | null; stage: string;
  stageLabel: string; progress: number; localJobId?: string | null; cloudJobId?: string | null;
  attempts: number; createdBy: string; claimedAt?: string | null; heartbeatAt?: string | null;
  completedAt?: string | null; createdAt: string; updatedAt: string;
}

interface AgentTaskEvent { at: string; step: string; status: string; message: string; }
interface AgentManifest { version: string; fileName: string; sizeBytes: number; sha256?: string; releasedAt?: string; downloadUrl: string; }
interface ProvisioningJobSummary {
  id: string; clientName?: string | null; ip?: string | null; serial?: string | null;
  model?: string | null; vlan?: number | null; status: string; stage?: string | null;
}

interface CommercialOption { id: number; nombre?: string; name?: string; descripcion?: string; }
interface IpCatalogRow {
  ip: string; cidr: string; available: boolean; availabilityConfidence?: string;
  interface?: string | null; recommended?: boolean; rangeName?: string;
}
interface IpCatalog { rows: IpCatalogRow[]; networks: Array<{ cidr: string; available?: number }>; stale?: boolean; source?: string; }
interface ExistingClient {
  idServicio: number; nombre: string; usuario?: string | null; telefono?: string | null;
  ip?: string | null; snOnu?: string | null; estado?: string | null;
  planInternetId?: number | null; planInternetName?: string | null;
  zonaId?: number | null; zonaNombre?: string | null; ssidRouterWifi?: string | null;
  uploadMbps?: number | null; downloadMbps?: number | null;
  oltOnu?: { onuIndex?: string; serial?: string; pon?: number; online?: boolean; model?: string } | null;
}
interface OnuModelProfile {
  profileKey: string; manufacturer: string; model: string; certificationStatus: string;
  defaults?: { vlan?: number; wanMode?: string }; capabilities?: Array<{ action: string; channel: string; status: string }>;
}

@Component({
  selector: 'app-onu-provisioner',
  standalone: true,
  imports: [
    FormsModule, NgTemplateOutlet, NavbarComponent, PlanLabelPipe, LucideActivity, LucideArrowLeft, LucideArrowRight,
    LucideCable, LucideCheck, LucideCircleAlert, LucideCircleCheck,
    LucideDownload, LucideHistory, LucideKeyRound, LucideLaptop,
    LucideLoaderCircle, LucidePencil, LucidePlay, LucideRefreshCw, LucideRouter,
    LucideSearch, LucideServer, LucideSettings, LucideShieldCheck, LucideShieldOff,
    LucideUserPlus, LucideWifi, LucideX, AgentReadinessComponent, CopyValueComponent,
  ],
  templateUrl: './onu-provisioner.html',
  styleUrl: './onu-provisioner.scss',
})
export class OnuProvisionerComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly exporter = inject(ExportService);
  readonly tab = signal<AgentTab>('operation');
  readonly agents = signal<OnuAgent[]>([]);
  readonly tasks = signal<OnuAgentTask[]>([]);
  readonly provisioningJobs = signal<ProvisioningJobSummary[]>([]);
  readonly selectedAgentId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly creatingTask = signal(false);
  readonly downloading = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly showOperation = signal(false);
  readonly manifest = signal<AgentManifest | null>(null);
  readonly historyQuery = signal('');
  readonly showAgentAdmin = signal(false);
  readonly agentAdminMode = signal<'rename' | 'revoke'>('rename');
  readonly agentBeingManaged = signal<OnuAgent | null>(null);
  readonly savingAgent = signal(false);
  readonly wizardStep = signal<WizardStep>(1);
  readonly wizardBusy = signal(false);
  readonly wizardMessage = signal('Preparando el agente');
  readonly inspectionTaskId = signal<string | null>(null);
  readonly provisionTaskId = signal<string | null>(null);
  readonly onuInventory = signal<Record<string, any> | null>(null);
  readonly zones = signal<CommercialOption[]>([]);
  readonly plans = signal<CommercialOption[]>([]);
  readonly ipCatalog = signal<IpCatalog | null>(null);
  readonly selectedIp = signal<IpCatalogRow | null>(null);
  readonly clientResults = signal<ExistingClient[]>([]);
  readonly selectedExistingClient = signal<ExistingClient | null>(null);
  readonly modelProfiles = signal<OnuModelProfile[]>([]);
  readonly servicePrepared = signal(false);
  readonly wizardComplete = signal(false);

  readonly selectedAgent = computed(() => this.agents().find(agent => agent.id === this.selectedAgentId()) || null);
  readonly selectedAgentTasks = computed(() => this.tasks().filter(task => task.agentId === this.selectedAgentId()));
  readonly activeTask = computed(() => {
    const currentId = this.selectedAgent()?.currentTask?.id;
    return this.tasks().find(task => task.id === currentId)
      || this.selectedAgentTasks().find(task => ['pending', 'processing'].includes(task.status))
      || this.selectedAgentTasks()[0] || null;
  });
  readonly onlineCount = computed(() => this.agents().filter(agent => agent.online).length);
  readonly authorizedCount = computed(() => this.agents().filter(agent => agent.active).length);
  readonly revokedCount = computed(() => this.agents().filter(agent => !agent.active).length);
  readonly operationalAgents = computed(() => this.agents().filter(agent => agent.active));
  readonly canManageAgents = computed(() => this.auth.hasRole(['admin']));
  readonly activeTaskStatus = computed(() => this.activeTask()?.status || null);
  readonly inspectionTask = computed(() => this.tasks().find(task => task.id === this.inspectionTaskId()) || null);
  readonly provisionTask = computed(() => this.tasks().find(task => task.id === this.provisionTaskId()) || null);
  readonly detectedSerial = computed(() => {
    const inventory = this.onuInventory();
    return String(inventory?.['identity']?.['serial'] || this.selectedAgent()?.discovery?.device?.serial || '').trim().toUpperCase();
  });
  readonly matchedModelProfile = computed(() => {
    const model = this.normalizeModel(String(this.onuInventory()?.['device']?.['model'] || this.deviceModel));
    return this.modelProfiles().find(profile => profile.model.toUpperCase() === model.toUpperCase()) || null;
  });
  readonly filteredTasks = computed(() => {
    const query = this.historyQuery().trim().toLowerCase();
    if (!query) return this.tasks();
    return this.tasks().filter(task => [
      task.id, task.agentName, task.action, task.status, task.cloudJobId,
      task.payload.device?.model, task.payload.wifi?.ssid,
    ].some(value => String(value || '').toLowerCase().includes(query)));
  });
  readonly activity = computed<AgentTaskEvent[]>(() => {
    const active = this.activeTask();
    const events = active?.result?.events || [];
    if (events.length) return [...events].reverse().slice(0, 10);
    return this.selectedAgentTasks().slice(0, 8).map(task => ({
      at: task.updatedAt, step: task.stage,
      status: task.status === 'failed' ? 'error' : task.status === 'success' ? 'success' : 'running',
      message: task.stageLabel || this.actionLabel(task.action),
    }));
  });

  operationMode: 'check' | 'provision' = 'provision';
  serviceOperation: ServiceOperation = 'new_client';
  cloudJobId = '';
  deviceModel = 'EG8141A5';
  deviceHost = '192.168.100.1';
  deviceUsername = 'telecomadmin';
  devicePassword = '';
  adapterIndex: number | null = null;
  localAddress = '192.168.100.10';
  prefixLength = 24;
  serviceMode: 'router' | 'bridge' = 'router';
  vlan = 101;
  wanIp = '';
  gateway = '192.168.16.1';
  primaryDns = '8.8.8.8';
  secondaryDns = '';
  subnetMask = '255.255.255.0';
  mtu = 1500;
  wifiSsid = '';
  wifiPassword = '';
  wifiEnabled = true;
  wifiBroadcast = true;
  wifiWmm = true;
  wifiWps = false;
  wifiMaxClients = 32;
  tr069Enabled = true;
  omciEnabled = true;
  remoteAccessEnabled = true;
  replaceConflictingWan = true;
  clientName = '';
  clientSearch = '';
  zoneId: number | null = null;
  planId: number | null = null;
  uploadMbps: number | null = null;
  downloadMbps: number | null = null;
  operationReason = '';
  targetPonIndex = '';
  reservationToken = '';
  agentDisplayName = '';

  private timer?: ReturnType<typeof setInterval>;
  private wizardIdempotencyKey = '';
  private guidedTransitionBusy = false;

  ngOnInit() {
    this.loadDashboard(false);
    this.timer = setInterval(() => this.loadDashboard(true), 4000);
  }

  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }
  setTab(tab: AgentTab) { this.tab.set(tab); }
  selectAgent(id: string) {
    const agent = this.agents().find(item => item.id === id);
    if (!agent?.active) return;
    this.selectedAgentId.set(id); this.prepareOperationDefaults();
  }

  async loadDashboard(silent = false) {
    if (silent) this.refreshing.set(true); else this.loading.set(true);
    try {
      const [agents, tasks, manifest, jobs] = await Promise.all([
        firstValueFrom(this.http.get<OnuAgent[]>('/agent-api/agents')),
        firstValueFrom(this.http.get<OnuAgentTask[]>('/agent-api/tasks', { params: new HttpParams().set('limit', 100) })),
        firstValueFrom(this.http.get<AgentManifest>('/agent-api/downloads/windows/manifest')).catch(() => null),
        firstValueFrom(this.http.get<ProvisioningJobSummary[]>('/provisioning/jobs')).catch(() => []),
      ]);
      this.agents.set(agents); this.tasks.set(tasks); this.manifest.set(manifest);
      this.provisioningJobs.set(jobs.filter(job => !['cancelled', 'complete'].includes(job.status)).slice(0, 50));
      const selected = this.selectedAgentId();
      if (!selected || !agents.some(agent => agent.id === selected && agent.active)) {
        this.selectedAgentId.set(agents.find(agent => agent.online && agent.active)?.id || agents.find(agent => agent.active)?.id || null);
        this.prepareOperationDefaults();
      }
      if (!silent || !this.showOperation()) this.error.set(null);
      await this.syncGuidedOperation();
    } catch (error: any) {
      if (!silent) this.error.set(error?.error?.error || error?.message || 'No se pudo cargar el centro de agentes');
    } finally {
      this.loading.set(false); this.refreshing.set(false);
    }
  }

  async detectOnu() { await this.createRemoteTask('discover', {}); }

  openOperation(mode: 'check' | 'provision' = 'provision') {
    if (!this.selectedAgent()?.online) {
      this.error.set('Selecciona un agente conectado antes de iniciar una operación'); return;
    }
    this.operationMode = mode;
    this.resetGuidedOperation();
    this.prepareOperationDefaults();
    this.showOperation.set(true);
    setTimeout(() => this.startInspection(), 0);
  }

  closeOperation() {
    if (this.creatingTask() || this.wizardBusy() || this.provisionTask()?.status === 'processing') return;
    this.showOperation.set(false);
  }

  async startInspection(forceDiscovery = false) {
    const agent = this.selectedAgent();
    if (!agent?.online || this.wizardBusy()) return;
    this.wizardBusy.set(true); this.error.set(null); this.wizardMessage.set('Detectando la ONU conectada');
    try {
      this.prepareOperationDefaults();
      const shouldDiscover = forceDiscovery || !agent.discovery?.detected;
      const task = shouldDiscover
        ? await this.createRemoteTask('discover', {}, { refresh: false, announce: false })
        : await this.dispatchInspectionCheck();
      if (task) this.inspectionTaskId.set(task.id);
    } finally {
      this.wizardBusy.set(false);
    }
  }

  async searchClients() {
    const query = this.clientSearch.trim();
    if (query.length < 2) return this.error.set('Escribe al menos dos caracteres para buscar');
    this.wizardBusy.set(true); this.error.set(null);
    try {
      const rows = await firstValueFrom(this.http.get<ExistingClient[]>('/provisioning/clients', { params: { q: query } }));
      this.clientResults.set(rows);
      if (!rows.length) this.notice.set('No se encontraron clientes con esa búsqueda');
    } catch (error: any) { this.error.set(this.apiError(error, 'No se pudo buscar el cliente')); }
    finally { this.wizardBusy.set(false); }
  }

  selectExistingClient(client: ExistingClient) {
    this.selectedExistingClient.set(client); this.clientName = client.nombre;
    this.zoneId = client.zonaId || null; this.planId = client.planInternetId || null;
    this.uploadMbps = Number(client.uploadMbps) || this.inferPlanSpeed(client.planInternetName) || null;
    this.downloadMbps = Number(client.downloadMbps) || this.uploadMbps;
    this.wanIp = client.ip || ''; this.wifiSsid = client.ssidRouterWifi || this.ssidFromName(client.nombre);
    if (client.oltOnu?.model) this.deviceModel = this.normalizeModel(client.oltOnu.model);
    this.clientResults.set([]); this.applyAutomaticProfile();
  }

  setServiceOperation(operation: ServiceOperation) {
    if (this.servicePrepared()) {
      this.notice.set('El expediente ya está protegido. Finaliza esta operación para evitar duplicados.');
      return;
    }
    this.serviceOperation = operation; this.selectedExistingClient.set(null); this.clientResults.set([]);
    this.clientSearch = ''; this.operationReason = ''; this.targetPonIndex = '';
    this.servicePrepared.set(false); this.cloudJobId = ''; this.reservationToken = '';
    if (operation !== 'new_client') this.wanIp = '';
  }

  setServiceMode(mode: 'router' | 'bridge') {
    if (this.servicePrepared()) {
      this.notice.set('El perfil Router/Bridge ya forma parte del expediente y no puede cambiarse en este punto.');
      return;
    }
    this.serviceMode = mode; this.servicePrepared.set(false); this.applyAutomaticProfile();
  }

  onPlanChange() {
    const plan = this.plans().find(item => Number(item.id) === Number(this.planId));
    const speed = this.inferPlanSpeed(this.optionLabel(plan));
    if (speed) { this.uploadMbps = speed; this.downloadMbps = speed; }
  }

  chooseIp(row: IpCatalogRow) {
    if (!row.available) return;
    this.selectedIp.set(row); this.wanIp = row.ip;
    const range = this.selectedAgent()?.capabilities?.networkRanges?.find(item => item.cidr === row.cidr);
    if (range) {
      this.vlan = range.vlan || this.vlan; this.gateway = range.gateway || this.gateway;
      this.primaryDns = range.primary_dns || this.primaryDns; this.secondaryDns = range.secondary_dns || '';
    }
  }

  async prepareService() {
    if (!this.validateServiceStep()) return;
    this.wizardBusy.set(true); this.error.set(null); this.wizardMessage.set('Protegiendo cliente, IP y expediente');
    try {
      const serial = this.detectedSerial();
      const routed = this.serviceMode === 'router';
      if (this.serviceOperation === 'new_client' && routed && !this.reservationToken) {
        const cidrs = this.activeAgentRanges().map(item => item.cidr);
        const reservation = await firstValueFrom(this.http.post<any>('/provisioning/reservations', {
          ip: this.wanIp, clientName: this.clientName, serial, cidrs,
        }));
        this.reservationToken = reservation.token;
      }
      const client = this.selectedExistingClient();
      const job = await firstValueFrom(this.http.post<any>('/provisioning/jobs', {
        source: 'onu_studio', mode: this.serviceOperation, serviceMode: this.serviceMode,
        idempotencyKey: this.wizardIdempotencyKey, reservationToken: this.reservationToken || null,
        clientIdServicio: client?.idServicio || null, ip: routed ? this.wanIp : null,
        clientName: this.clientName, serial, model: this.deviceModel,
        macAddress: this.onuInventory()?.['device']?.['mac'] || this.onuInventory()?.['ethernet']?.['mac'] || null,
        zoneId: this.zoneId, planId: this.planId, uploadMbps: this.uploadMbps,
        downloadMbps: this.downloadMbps, vlan: this.vlan,
        targetPonIndex: this.targetPonIndex || null, operationReason: this.operationReason || null,
        configurationManifest: this.configurationManifest(false),
      }));
      this.cloudJobId = job.id;
      if (this.serviceOperation === 'new_client' && routed) {
        const provisioned = await firstValueFrom(this.http.post<any>('/client-provisioning', {
          jobId: job.id, ip: this.wanIp, serviceName: this.clientName,
          zoneId: this.zoneId, planId: this.planId,
          uploadMbps: this.uploadMbps, downloadMbps: this.downloadMbps,
        }));
        if (provisioned?.client?.idServicio) this.notice.set(`Cliente WispHub #${provisioned.client.idServicio} y MikroTik verificados`);
      }
      this.servicePrepared.set(true);
      if (!this.wifiSsid && routed) this.wifiSsid = this.ssidFromName(this.clientName);
      if (!this.wifiPassword && routed) this.wifiPassword = this.generateWifiPassword();
      this.wizardStep.set(3); this.wizardMessage.set('Servicio preparado sin duplicar recursos');
    } catch (error: any) {
      this.error.set(this.apiError(error, 'No se pudo preparar el servicio'));
    } finally { this.wizardBusy.set(false); }
  }

  goToReview() {
    if (this.serviceMode === 'router' && this.wifiEnabled) {
      if (!this.wifiSsid.trim()) return this.error.set('Escribe el nombre de la red WiFi');
      if (this.wifiPassword.length < 8) return this.error.set('La clave WiFi debe tener al menos 8 caracteres');
    }
    this.error.set(null); this.wizardStep.set(4);
  }

  previousWizardStep() {
    const step = this.wizardStep();
    if (step === 3 && this.servicePrepared()) {
      this.notice.set('Cliente, IP y perfil ya están protegidos. Puedes ajustar el WiFi o continuar a la revisión.');
      return;
    }
    if (step > 1 && !this.provisionTaskId()) this.wizardStep.set((step - 1) as WizardStep);
  }

  async submitOperation() {
    if (!this.selectedAgent()) return;
    if (this.adapterIndex == null) return this.error.set('Selecciona la tarjeta Ethernet que se conectará a la ONU');
    if (!this.servicePrepared() || !this.cloudJobId) return this.error.set('Primero prepara el cliente y el expediente');
    if (this.serviceMode === 'router') {
      if (!this.wanIp) return this.error.set('La IP WAN es obligatoria');
      if (this.wifiPassword.length < 8) return this.error.set('La clave WiFi debe tener al menos 8 caracteres');
    }
    const device: Record<string, unknown> = { host: this.deviceHost, model: this.deviceModel, username: this.deviceUsername };
    if (this.devicePassword) device['password'] = this.devicePassword;
    const localNetwork = { adapter_index: Number(this.adapterIndex), address: this.localAddress, prefix_length: Number(this.prefixLength) };
    const payload = {
      device, local_network: localNetwork,
      wan: {
        vlan_id: Number(this.vlan), priority: 0, ip_address: this.wanIp || '192.168.16.2',
        subnet_mask: this.subnetMask, gateway: this.gateway, primary_dns: this.primaryDns,
        secondary_dns: this.secondaryDns || null, mtu: Number(this.mtu), nat_enabled: this.serviceMode === 'router',
        bind_lan_ports: [1, 2, 3, 4], bind_ssid1: this.serviceMode === 'router',
      },
      wifi: {
        enabled: this.serviceMode === 'router' && this.wifiEnabled, ssid: this.wifiSsid || 'ISP Max',
        password: this.wifiPassword || '12345678', broadcast: this.wifiBroadcast, wmm_enabled: this.wifiWmm,
        wps_enabled: this.wifiWps, max_clients: Number(this.wifiMaxClients),
      },
      tr069: {
        enabled: this.serviceMode === 'router' && this.tr069Enabled,
        acs_url: 'http://10.254.250.2:7547/', username: 'ispmax-cpe',
        connection_request_username: 'ispmax-connection-request', periodic_inform_interval: 900,
      },
      remote_access: { enabled: this.serviceMode === 'router' && this.remoteAccessEnabled, source: `${this.gateway}/32`, http: true, telnet: false, ssh: false, ftp: false, icmp: false },
      save_configuration: true, create_backups: true, replace_conflicting_wan: this.replaceConflictingWan,
      cloud_job_id: this.cloudJobId || null, service_operation: this.serviceOperation, service_mode: this.serviceMode,
    };
    const created = await this.createRemoteTask('provision', payload, { refresh: false, announce: false });
    if (created) {
      this.provisionTaskId.set(created.id); this.wizardMessage.set('El agente está configurando y verificando la ONU');
      this.notice.set(`Trabajo enviado a ${this.selectedAgent()?.displayName}`);
    }
  }

  async cancelTask(task: OnuAgentTask) {
    if (task.status !== 'pending') return;
    try {
      await firstValueFrom(this.http.post(`/agent-api/tasks/${encodeURIComponent(task.id)}/cancel`, {}));
      this.notice.set('Trabajo cancelado'); await this.loadDashboard(true);
    } catch (error: any) { this.error.set(error?.error?.error || 'No se pudo cancelar el trabajo'); }
  }

  async retryTask(task: OnuAgentTask) {
    try {
      await firstValueFrom(this.http.post(`/agent-api/tasks/${encodeURIComponent(task.id)}/retry`, {}));
      this.notice.set('Reintento enviado al mismo agente'); this.tab.set('operation'); await this.loadDashboard(true);
    } catch (error: any) { this.error.set(error?.error?.error || 'No se pudo reintentar el trabajo'); }
  }

  async downloadAgent() {
    if (this.downloading()) return;
    this.downloading.set(true);
    try {
      const blob = await firstValueFrom(this.http.get('/agent-api/downloads/windows', { responseType: 'blob' }));
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `ONU-Studio-ISP-Max-v${this.manifest()?.version || 'latest'}.exe`;
      anchor.click(); URL.revokeObjectURL(url); this.notice.set('Descarga iniciada');
    } catch (error: any) { this.error.set(error?.error?.error || 'No se pudo descargar ONU Studio'); }
    finally { this.downloading.set(false); }
  }

  openAgentAdmin(agent: OnuAgent, mode: 'rename' | 'revoke') {
    if (!this.canManageAgents()) return;
    this.agentBeingManaged.set(agent); this.agentAdminMode.set(mode);
    this.agentDisplayName = agent.displayName; this.showAgentAdmin.set(true);
  }

  closeAgentAdmin() { if (!this.savingAgent()) this.showAgentAdmin.set(false); }

  async saveAgentAdmin() {
    const agent = this.agentBeingManaged();
    if (!agent || this.savingAgent()) return;
    this.savingAgent.set(true); this.error.set(null);
    try {
      if (this.agentAdminMode() === 'rename') {
        const displayName = this.agentDisplayName.trim();
        if (!displayName) throw new Error('Escribe un nombre para identificar esta PC');
        await firstValueFrom(this.http.patch(`/agent-api/agents/${encodeURIComponent(agent.id)}`, { displayName }));
        this.notice.set('Nombre del agente actualizado');
      } else {
        await firstValueFrom(this.http.post(`/agent-api/agents/${encodeURIComponent(agent.id)}/revoke`, {}));
        this.notice.set('Agente revocado. Esa PC deberá autenticarse de nuevo como administrador.');
      }
      this.showAgentAdmin.set(false); await this.loadDashboard(true);
    } catch (error: any) {
      this.error.set(error?.error?.error || error?.message || 'No se pudo administrar el agente');
    } finally { this.savingAgent.set(false); }
  }

  optionLabel(item?: CommercialOption | null) {
    return item?.nombre || item?.name || item?.descripcion || (item?.id ? `#${item.id}` : '');
  }

  operationLabel(operation = this.serviceOperation) {
    return ({
      new_client: 'Cliente nuevo', restore_same_onu: 'Restaurar la misma ONU',
      replace_onu: 'Cambiar la ONU', migrate_pon: 'Mover a otro PON',
    } as const)[operation];
  }

  managementLabel() {
    if (this.serviceMode === 'bridge') return 'OMCI · perfil Bridge';
    return this.tr069Enabled ? 'TR-069 + OMCI automáticos' : 'OMCI · TR-069 no certificado';
  }

  profileStatusLabel() {
    const profile = this.matchedModelProfile();
    if (!profile) return 'Perfil compatible del agente';
    return profile.certificationStatus === 'verified' ? 'Perfil certificado' : 'Perfil detectado';
  }

  inventoryFact(path: string, fallback = '--') {
    let value: any = this.onuInventory();
    for (const key of path.split('.')) value = value?.[key];
    return value == null || value === '' ? fallback : String(value);
  }

  /** Qué falta en el paso «Servicio» (solo informativo; la validación real sigue en prepareService). */
  serviceMissing() {
    const missing: string[] = [];
    if (!this.detectedSerial()) missing.push('serial leído de la ONU');
    if (this.serviceOperation === 'new_client') {
      if (!this.clientName.trim()) missing.push('nombre del cliente');
      if (!this.zoneId) missing.push('zona');
      if (!this.planId) missing.push('plan');
      if (this.serviceMode === 'router' && !this.wanIp) missing.push('IP disponible');
    } else {
      if (!this.selectedExistingClient()) missing.push('cliente existente');
      else if (!this.operationReason.trim()) missing.push('motivo técnico');
      if (this.serviceOperation === 'migrate_pon' && this.selectedExistingClient() && !this.targetPonIndex.trim()) missing.push('PON de destino');
    }
    return missing.length ? `Falta: ${missing.join(', ')}` : '';
  }

  /** Qué falta en el paso «WiFi» (solo informativo). */
  wifiMissing() {
    if (this.serviceMode !== 'router' || !this.wifiEnabled) return '';
    if (!this.wifiSsid.trim()) return 'Falta: nombre de la red WiFi';
    if (this.wifiPassword.length < 8) return 'Falta: clave WiFi de al menos 8 caracteres';
    return '';
  }

  /** Tiempo relativo corto para el último contacto de un agente. */
  seenAgo(value?: string | null) {
    if (!value) return 'sin registro';
    const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return `hace ${seconds} s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    return `hace ${Math.round(hours / 24)} días`;
  }

  /** Exporta a CSV el historial visible (respeta la búsqueda). */
  exportHistory() {
    const rows = this.filteredTasks();
    if (!rows.length) { this.notice.set('No hay trabajos en la vista actual para exportar'); return; }
    this.exporter.exportCSV(rows, 'trabajos_onu_studio', [
      { key: 'id', label: 'Trabajo' },
      { key: 'createdAt', label: 'Fecha', transform: (value: string) => this.formatDate(value) },
      { key: 'action', label: 'Operación', transform: (value: AgentTaskAction) => this.actionLabel(value) || value },
      { key: 'status', label: 'Estado', transform: (value: AgentTaskStatus) => this.statusLabel(value) || value },
      { key: 'stageLabel', label: 'Etapa' },
      { key: 'agentName', label: 'Agente' },
      { key: 'createdBy', label: 'Creado por' },
      { key: 'payload.device.model', label: 'Modelo' },
      { key: 'payload.wan.ip_address', label: 'IP WAN' },
      { key: 'payload.wan.vlan_id', label: 'VLAN' },
      { key: 'payload.wifi.ssid', label: 'WiFi' },
      { key: 'cloudJobId', label: 'Expediente' },
      { key: 'completedAt', label: 'Duración', transform: (_: unknown, row: OnuAgentTask) => this.taskDuration(row) },
      { key: 'errorMessage', label: 'Error' },
    ]);
  }

  generateWifiDefaults() {
    this.wifiSsid = this.ssidFromName(this.clientName || this.selectedExistingClient()?.nombre || 'ISP Max');
    this.wifiPassword = this.generateWifiPassword();
  }

  private async dispatchInspectionCheck() {
    this.prepareOperationDefaults();
    if (this.adapterIndex == null) {
      this.error.set('El agente no reportó una tarjeta Ethernet compatible para conectar la ONU');
      return null;
    }
    const device: Record<string, unknown> = {
      host: this.deviceHost, model: this.deviceModel, username: this.deviceUsername,
    };
    if (this.devicePassword) device['password'] = this.devicePassword;
    this.wizardMessage.set('Entrando a la ONU y leyendo su configuración');
    return this.createRemoteTask('check', {
      device,
      local_network: { adapter_index: Number(this.adapterIndex), address: this.localAddress, prefix_length: Number(this.prefixLength) },
      prepare_adapter: true,
    }, { refresh: false, announce: false });
  }

  private async syncGuidedOperation() {
    if (!this.showOperation() || this.guidedTransitionBusy) return;
    const inspection = this.inspectionTask();
    if (inspection?.status === 'failed') {
      this.wizardBusy.set(false);
      this.wizardMessage.set('La ONU respondió, pero no se pudo completar la lectura');
      return;
    }
    if (inspection?.status === 'success' && inspection.action === 'discover' && !this.onuInventory()) {
      const discovery = (inspection.result?.result || inspection.result || {}) as Record<string, any>;
      const device = discovery['device'] as Record<string, any> | null | undefined;
      if (!discovery['detected'] || !device?.['host']) {
        this.wizardBusy.set(false);
        this.wizardMessage.set(String(discovery['next_action'] || 'Conecta la ONU por Ethernet y vuelve a intentar'));
        return;
      }
      this.deviceHost = String(device['host']);
      this.deviceModel = this.normalizeModel(String(device['model'] || this.deviceModel));
      if (Number.isInteger(Number(device['adapter_index']))) this.adapterIndex = Number(device['adapter_index']);
      this.guidedTransitionBusy = true;
      try {
        const next = await this.dispatchInspectionCheck();
        if (next) this.inspectionTaskId.set(next.id);
      } finally { this.guidedTransitionBusy = false; }
      return;
    }
    if (inspection?.status === 'success' && inspection.action === 'check' && !this.onuInventory()) {
      const result = inspection.result?.result || {};
      const inventory = result['inventory'] as Record<string, any> | undefined;
      if (!inventory) {
        this.error.set('El agente inició sesión, pero no devolvió el inventario completo de la ONU');
        return;
      }
      this.onuInventory.set(inventory);
      this.deviceModel = this.normalizeModel(String(result['model'] || inventory?.['device']?.['model'] || this.deviceModel));
      this.deviceHost = String(result['host'] || this.deviceHost);
      this.deviceUsername = this.deviceModel === 'F670L' ? 'admin' : 'telecomadmin';
      this.wizardMessage.set('ONU autenticada e inventario leído');
      await this.loadWizardCatalogs();
      this.applyAutomaticProfile();
      if (this.operationMode === 'check') {
        this.wizardComplete.set(true);
      } else {
        this.wizardStep.set(2);
      }
    }
    const provision = this.provisionTask();
    if (provision?.status === 'success') {
      this.wizardComplete.set(true); this.wizardMessage.set('ONU configurada y verificada correctamente');
    } else if (provision?.status === 'failed') {
      this.wizardMessage.set('El agente detuvo la configuración para proteger el servicio');
    }
  }

  private async loadWizardCatalogs() {
    if (this.zones().length && this.modelProfiles().length && this.ipCatalog()) return;
    this.wizardBusy.set(true);
    try {
      const cidrs = this.activeAgentRanges().map(item => item.cidr);
      const [commercial, profiles, ipam] = await Promise.all([
        firstValueFrom(this.http.get<{ zones: CommercialOption[]; plans: CommercialOption[] }>('/provisioning/commercial-catalog')),
        firstValueFrom(this.http.get<OnuModelProfile[]>('/olt-api/model-profiles')).catch(() => []),
        cidrs.length
          ? firstValueFrom(this.http.post<IpCatalog>('/provisioning/ip-catalog/query', { cidrs }))
          : firstValueFrom(this.http.get<IpCatalog>('/provisioning/ip-catalog')),
      ]);
      this.zones.set(commercial.zones || []); this.plans.set(commercial.plans || []); this.modelProfiles.set(profiles || []);
      const filteredRows = this.filterIpRows(ipam.rows || []);
      const catalog = { ...ipam, rows: filteredRows };
      this.ipCatalog.set(catalog);
      const recommended = filteredRows[0] || null;
      if (recommended && !this.wanIp) this.chooseIp({ ...recommended, recommended: true });
    } catch (error: any) {
      this.error.set(this.apiError(error, 'No se pudieron cargar planes e IP disponibles'));
    } finally { this.wizardBusy.set(false); }
  }

  private filterIpRows(rows: IpCatalogRow[]) {
    const policies = new Map(this.activeAgentRanges().map(item => [item.cidr, item]));
    return rows.filter(row => {
      const policy = policies.get(row.cidr);
      if (!policy || !row.available) return false;
      if (policy.exclusions?.includes(row.ip) || row.ip === policy.gateway) return false;
      if (policy.allocation_start && this.compareIp(row.ip, policy.allocation_start) < 0) return false;
      if (policy.allocation_end && this.compareIp(row.ip, policy.allocation_end) > 0) return false;
      return true;
    }).sort((a, b) => {
      const pa = policies.get(a.cidr)?.priority || 100;
      const pb = policies.get(b.cidr)?.priority || 100;
      return pa - pb || this.compareIp(a.ip, b.ip);
    }).map((row, index) => ({ ...row, recommended: index === 0, rangeName: policies.get(row.cidr)?.name || row.cidr }));
  }

  private validateServiceStep() {
    const serial = this.detectedSerial();
    if (!serial) { this.error.set('La operación requiere el serial real leído por el agente'); return false; }
    if (this.serviceOperation === 'new_client') {
      if (!this.clientName.trim()) { this.error.set('Escribe el nombre del cliente'); return false; }
      if (!this.zoneId || !this.planId) { this.error.set('Selecciona la zona y el plan'); return false; }
      if (!this.uploadMbps || !this.downloadMbps) { this.error.set('El plan necesita velocidades válidas'); return false; }
      if (this.serviceMode === 'router' && !this.activeAgentRanges().length) { this.error.set('Configura al menos un rango IP activo en el agente'); return false; }
      if (this.serviceMode === 'router' && !this.wanIp) { this.error.set('Selecciona una IP disponible'); return false; }
    } else {
      if (!this.selectedExistingClient()) { this.error.set('Busca y selecciona el cliente existente'); return false; }
      if (!this.operationReason.trim()) { this.error.set('Indica brevemente el motivo del trabajo'); return false; }
      if (this.serviceOperation === 'migrate_pon' && !this.targetPonIndex.trim()) { this.error.set('Indica el PON de destino'); return false; }
    }
    return true;
  }

  private applyAutomaticProfile() {
    const profile = this.matchedModelProfile();
    const range = this.activeAgentRanges().find(item => !this.selectedIp()?.cidr || item.cidr === this.selectedIp()?.cidr);
    this.vlan = range?.vlan || profile?.defaults?.vlan || 101;
    this.gateway = range?.gateway || this.gateway; this.primaryDns = range?.primary_dns || this.primaryDns;
    this.secondaryDns = range?.secondary_dns || this.secondaryDns;
    this.omciEnabled = true;
    const hasTr069 = profile?.capabilities?.some(item => item.channel === 'TR069' && ['verified', 'detected'].includes(item.status)) ?? true;
    this.tr069Enabled = this.serviceMode === 'router' && hasTr069;
    this.remoteAccessEnabled = this.serviceMode === 'router';
    this.wifiEnabled = this.serviceMode === 'router';
    if (this.serviceMode === 'bridge') { this.wifiSsid = ''; this.wifiPassword = ''; this.wanIp = ''; }
    else if (!this.wanIp && this.selectedIp()) this.wanIp = this.selectedIp()!.ip;
  }

  private configurationManifest(verified: boolean) {
    return {
      schemaVersion: 1, serviceMode: this.serviceMode, serial: this.detectedSerial(), model: this.deviceModel,
      firmware: this.inventoryFact('device.software_version', ''), vlan: Number(this.vlan),
      wan: { mode: this.serviceMode === 'router' ? 'static' : 'bridge', ip: this.serviceMode === 'router' ? this.wanIp : null, gateway: this.serviceMode === 'router' ? this.gateway : null, nat: this.serviceMode === 'router' },
      lanPorts: [1, 2, 3, 4], ssidBinding: this.serviceMode === 'router',
      wifi: this.serviceMode === 'router' ? { enabled: this.wifiEnabled, ssid: this.wifiSsid } : null,
      channels: { tr069: this.tr069Enabled, omci: this.omciEnabled, webLocal: true }, verified,
    };
  }

  private activeAgentRanges() {
    return (this.selectedAgent()?.capabilities?.networkRanges || []).filter(item => item.active);
  }

  private compareIp(left: string, right: string) {
    const value = (ip: string) => ip.split('.').reduce((sum, part) => sum * 256 + Number(part), 0);
    return value(left) - value(right);
  }

  private resetGuidedOperation() {
    this.wizardStep.set(1); this.wizardBusy.set(false); this.wizardComplete.set(false);
    this.inspectionTaskId.set(null); this.provisionTaskId.set(null); this.onuInventory.set(null);
    this.servicePrepared.set(false); this.selectedExistingClient.set(null); this.clientResults.set([]);
    this.selectedIp.set(null); this.ipCatalog.set(null); this.error.set(null); this.cloudJobId = ''; this.reservationToken = '';
    this.serviceOperation = 'new_client'; this.serviceMode = 'router'; this.clientName = '';
    this.clientSearch = ''; this.zoneId = null; this.planId = null; this.uploadMbps = null; this.downloadMbps = null;
    this.operationReason = ''; this.targetPonIndex = ''; this.wifiSsid = ''; this.wifiPassword = '';
    this.wizardIdempotencyKey = `web-onu:${crypto.randomUUID()}`;
  }

  private inferPlanSpeed(label?: string | null) {
    const match = String(label || '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(?:g|gb|m|mb|mbps)?/i);
    if (!match) return null;
    const value = Number(match[1]);
    return /\d\s*g/i.test(String(label)) ? value * 1000 : value;
  }

  private generateWifiPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
  }

  private apiError(error: any, fallback: string) {
    return error?.error?.error || error?.error?.detail || error?.message || fallback;
  }

  selectCloudJob(jobId: string) {
    this.cloudJobId = jobId;
    const job = this.provisioningJobs().find(item => item.id === jobId);
    if (!job) return;
    if (job.ip) this.wanIp = job.ip; if (job.vlan) this.vlan = job.vlan;
    if (job.model) this.deviceModel = this.normalizeModel(job.model);
    if (job.clientName && !this.wifiSsid) this.wifiSsid = this.ssidFromName(job.clientName);
  }

  actionLabel(action: AgentTaskAction) { return ({ discover: 'Detectar ONU', check: 'Comprobar conexión', provision: 'Configurar ONU' } as const)[action]; }
  statusLabel(status: AgentTaskStatus) { return ({ pending: 'En cola', processing: 'En progreso', success: 'Completado', failed: 'Fallido', cancelled: 'Cancelado' } as const)[status]; }
  agentStateLabel(agent: OnuAgent) { return !agent.active ? 'Revocado' : agent.online ? 'Conectado' : 'Desconectado'; }
  formatDate(value?: string | null) { return value ? new Date(value).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'medium' }) : 'Sin registro'; }
  formatTime(value?: string | null) { return value ? new Date(value).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--'; }
  formatBytes(value?: number | null) { return value ? `${(value / 1024 / 1024).toFixed(0)} MB` : ''; }
  taskDuration(task: OnuAgentTask) {
    const end = task.completedAt ? new Date(task.completedAt).getTime() : Date.now();
    const seconds = Math.max(0, Math.floor((end - new Date(task.createdAt).getTime()) / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  trackAgent = (_: number, agent: OnuAgent) => agent.id;
  trackTask = (_: number, task: OnuAgentTask) => task.id;

  private async createRemoteTask(
    action: AgentTaskAction,
    payload: Record<string, unknown>,
    options: { refresh?: boolean; announce?: boolean } = {},
  ) {
    const agent = this.selectedAgent();
    if (!agent?.online) { this.error.set('El agente seleccionado no está conectado'); return null; }
    this.creatingTask.set(true); this.error.set(null);
    try {
      const task = await firstValueFrom(this.http.post<OnuAgentTask>('/agent-api/tasks', {
        agentId: agent.id, action, payload,
        idempotencyKey: `cloud:${agent.agentId}:${action}:${Date.now()}`,
      }));
      this.tasks.update(rows => [task, ...rows.filter(item => item.id !== task.id)]);
      if (options.announce !== false) this.notice.set(`${this.actionLabel(action)} enviado a ${agent.displayName}`);
      this.tab.set('operation');
      if (options.refresh !== false) await this.loadDashboard(true);
      return task;
    } catch (error: any) {
      this.error.set(error?.error?.error || error?.message || 'No se pudo enviar el trabajo al agente'); return null;
    } finally { this.creatingTask.set(false); }
  }

  private prepareOperationDefaults() {
    const agent = this.selectedAgent(); if (!agent) return;
    const discovery = agent.discovery?.device; const capability = agent.capabilities || {};
    const recommended = capability.recommendedLocalNetwork;
    const range = capability.networkRanges?.find(item => item.active);
    this.deviceModel = this.normalizeModel(discovery?.model || this.deviceModel);
    this.deviceHost = discovery?.host || this.deviceHost;
    this.deviceUsername = this.deviceModel === 'F670L' ? 'admin' : 'telecomadmin';
    this.adapterIndex = recommended?.adapter_index || capability.adapters?.find(item => item.status === 'Up' && item.supported)?.index || null;
    this.localAddress = recommended?.address || '192.168.100.10'; this.prefixLength = recommended?.prefix_length || 24;
    if (range) {
      this.vlan = range.vlan || 101; this.gateway = range.gateway || '192.168.16.1';
      this.primaryDns = range.primary_dns || '8.8.8.8'; this.secondaryDns = range.secondary_dns || '';
    }
    const queryIp = this.route.snapshot.queryParamMap.get('wanIp');
    const queryVlan = Number(this.route.snapshot.queryParamMap.get('vlan'));
    const querySsid = this.route.snapshot.queryParamMap.get('ssid');
    if (queryIp) this.wanIp = queryIp; if (queryVlan) this.vlan = queryVlan; if (querySsid) this.wifiSsid = querySsid;
  }

  private normalizeModel(model: string) { return String(model || '').toUpperCase().includes('F670') ? 'F670L' : 'EG8141A5'; }
  private ssidFromName(name: string) {
    return String(name || 'ISP Max').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 32) || 'ISP Max';
  }
}
