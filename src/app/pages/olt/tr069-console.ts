import { Component, Input, OnChanges, OnDestroy, SimpleChanges, computed, inject, signal } from '@angular/core';
import { JsonPipe, KeyValuePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideActivity, LucideAlertTriangle, LucideBan, LucideCable, LucideCircleCheck, LucideCpu,
  LucideDatabase, LucideHistory, LucideLockOpen, LucideNetwork, LucidePlay, LucideRefreshCw,
  LucideRotateCcw, LucideRouter, LucideSearch, LucideShieldCheck, LucideSquareTerminal,
  LucideUsers, LucideWifi,
} from '@lucide/angular';
import {
  OltOnu, OltService, Tr069CapabilityAction, Tr069Device, Tr069Parameter, Tr069Task,
  Tr069TaskAction, Tr069Telemetry,
} from '../../services/olt.service';
import { ToastService } from '../../services/toast.service';

type ConsoleTab = 'overview' | 'fiber' | 'wifi' | 'lan' | 'wan' | 'clients' | 'diagnostics' | 'security' | 'system' | 'history' | 'parameters';

@Component({
  selector: 'app-tr069-console',
  standalone: true,
  imports: [
    FormsModule, JsonPipe, KeyValuePipe, LucideActivity, LucideAlertTriangle, LucideBan, LucideCable, LucideCircleCheck,
    LucideCpu, LucideDatabase, LucideHistory, LucideLockOpen, LucideNetwork, LucidePlay,
    LucideRefreshCw, LucideRotateCcw, LucideRouter, LucideSearch, LucideShieldCheck,
    LucideSquareTerminal, LucideUsers, LucideWifi,
  ],
  templateUrl: './tr069-console.html',
  styleUrl: './tr069-console.scss',
})
export class Tr069ConsoleComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) onu!: OltOnu;
  private readonly api = inject(OltService);
  private readonly toast = inject(ToastService);

  readonly device = signal<Tr069Device | null>(null);
  readonly telemetry = signal<Tr069Telemetry[]>([]);
  readonly parameters = signal<Tr069Parameter[]>([]);
  readonly parameterPage = signal(1);
  readonly parameterPageSize = 100;
  readonly parameterPageCount = computed(() => Math.max(1, Math.ceil(this.parameters().length / this.parameterPageSize)));
  readonly visibleParameters = computed(() => {
    const start = (this.parameterPage() - 1) * this.parameterPageSize;
    return this.parameters().slice(start, start + this.parameterPageSize);
  });
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly tab = signal<ConsoleTab>('overview');
  readonly remoteOnline = computed(() => this.device()?.managementChannels?.tr069?.online === true);
  readonly remoteRegistered = computed(() => this.device()?.managementChannels?.tr069?.available === true);
  readonly omciOnline = computed(() => this.device()?.managementChannels?.omci?.available === true);
  readonly visibleTabs = computed(() => {
    // Keep the last verified inventory visible while the CPE is stale or offline.
    // Mutating actions remain protected by remoteOnline() in blocked().
    if (this.remoteRegistered()) return this.tabs;
    if (this.omciOnline()) return this.tabs.filter((item) => ['overview', 'fiber', 'wan', 'system', 'history'].includes(item.id));
    return this.tabs.filter((item) => ['overview', 'history'].includes(item.id));
  });
  readonly parameterLoading = signal(false);
  private pollTimer?: ReturnType<typeof setTimeout>;

  readonly tabs: { id: ConsoleTab; label: string }[] = [
    { id: 'overview', label: 'Resumen' }, { id: 'fiber', label: 'Fibra' },
    { id: 'wifi', label: 'WiFi' }, { id: 'lan', label: 'LAN' },
    { id: 'wan', label: 'WAN' }, { id: 'clients', label: 'Clientes' },
    { id: 'diagnostics', label: 'Diagnosticos' }, { id: 'security', label: 'Seguridad' },
    { id: 'system', label: 'Sistema' }, { id: 'history', label: 'Historial' },
    { id: 'parameters', label: 'Parametros' },
  ];

  wifi = { ssid: '', password: '', enabled: true, broadcast: true, channel: 0, transmitPower: 100, standard: '11bgn', maxClients: 32, wmm: true, wps: false };
  dhcp = { enabled: true, minAddress: '', maxAddress: '', subnetMask: '', router: '', dnsServers: '', leaseTime: 86400 };
  time = { enabled: true, ntpServer1: 'pool.ntp.org', ntpServer2: '', timeZone: '-04:00', timeZoneName: 'America/Santo_Domingo', informInterval: 300 };
  diagnostics = { host: '8.8.8.8', downloadUrl: '', uploadUrl: '', testFileLength: 1048576 };
  wan = { connection: 1, enabled: true, addressingType: 'Static', ipAddress: '', subnetMask: '255.255.255.0', gateway: '', dnsServers: '', vlan: 101, mtu: 1500, natEnabled: true, serviceList: 'TR069_INTERNET' };
  security = { connection: 1, dmzEnabled: false, dmzHost: '' };
  parameterSearch = '';

  ngOnChanges(changes: SimpleChanges) {
    if (changes['onu'] && this.onu?.serial) this.load();
  }

  ngOnDestroy() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  load(silent = false) {
    const serial = this.onu?.serial;
    if (!serial) return;
    if (!silent) this.loading.set(true);
    this.api.getTr069Device(serial).subscribe({
      next: (device) => {
        this.device.set(device);
        this.populate(device);
        this.loading.set(false);
        if (device.tasks.some((task) => ['pending', 'processing'].includes(task.status))) this.schedulePoll();
      },
      error: (error: { error?: { error?: string } }) => {
        this.loading.set(false);
        if (!silent) this.toast.error(error.error?.error || 'No se pudo consultar el control de la ONU');
      },
    });
  }

  setEnabled(enabled: boolean) {
    if (!this.onu.serial || this.saving()) return;
    this.saving.set(true);
    this.api.setTr069Enabled(this.onu.serial, enabled).subscribe({
      next: (device) => {
        this.device.set(device); this.saving.set(false);
        this.toast.success(enabled ? 'Control de ONU activado' : 'Control de ONU desactivado');
        if (enabled) this.queue('refresh');
      },
      error: (error: { error?: { error?: string } }) => { this.saving.set(false); this.toast.error(error.error?.error || 'No se pudo cambiar el control de la ONU'); },
    });
  }

  selectTab(tab: ConsoleTab) {
    this.tab.set(tab);
    if (tab === 'parameters' && !this.parameters().length) this.loadParameters();
    if (tab === 'overview' && !this.telemetry().length) this.loadTelemetry();
  }

  capability(action: Tr069TaskAction): Tr069CapabilityAction | undefined {
    return this.device()?.capabilities.actions.find((item) => item.name === action);
  }

  blocked(action: Tr069TaskAction) {
    if (action === 'reboot' && this.omciOnline()) return false;
    if (action !== 'reboot' && !this.remoteOnline()) return true;
    return !this.capability(action)?.executable;
  }

  actionChannel(action: Tr069TaskAction) {
    if (action === 'reboot' && this.omciOnline()) return 'OLT nativo';
    return this.remoteOnline() ? 'Canal remoto' : 'No disponible';
  }

  saveWifi() {
    const payload: Record<string, unknown> = { ...this.wifi };
    if (!this.wifi.password) delete payload['password'];
    this.queue('set_wifi', payload);
  }

  saveLanPort(port: Record<string, unknown>) {
    this.queue('set_lan_port', {
      port: port['port'], enabled: port['enabled'], speed: port['speed'], duplex: port['duplex'],
      flowControl: port['flowControl'], l3Enabled: port['l3Enabled'],
    });
  }

  runDiagnostic(action: 'run_ping' | 'run_traceroute' | 'run_download_diagnostic' | 'run_upload_diagnostic') {
    const payload = action === 'run_ping'
      ? { host: this.diagnostics.host, repetitions: 4, timeout: 10000, blockSize: 56 }
      : action === 'run_traceroute'
        ? { host: this.diagnostics.host, maxHops: 30, timeout: 10000 }
        : action === 'run_download_diagnostic'
          ? { url: this.diagnostics.downloadUrl }
          : { url: this.diagnostics.uploadUrl, testFileLength: this.diagnostics.testFileLength };
    this.queue(action, payload);
  }

  queue(action: Tr069TaskAction, payload: Record<string, unknown> = {}) {
    const serial = this.onu.serial;
    if (!serial || this.saving()) return;
    if (action === 'reboot' && this.device()?.managementChannels?.omci?.available) {
      this.rebootThroughOlt();
      return;
    }
    const capability = this.capability(action);
    if (capability && !capability.executable) {
      this.toast.info('Acción bloqueada hasta certificar este firmware');
      return;
    }
    this.saving.set(true);
    this.api.createTr069Task(serial, action, payload).subscribe({
      next: (task) => {
        this.saving.set(false);
        if (action === 'set_wifi') this.wifi.password = '';
        this.device.update((device) => device ? { ...device, tasks: [task, ...device.tasks.filter((item) => item.id !== task.id)] } : device);
        this.toast.success(`${this.actionLabel(task)} enviada`);
        this.schedulePoll();
      },
      error: (error: { error?: { error?: string } }) => { this.saving.set(false); this.toast.error(error.error?.error || 'No se pudo crear la tarea'); },
    });
  }

  private rebootThroughOlt() {
    this.saving.set(true);
    this.api.executeOperation(this.onu, 'reboot', `REINICIAR ${this.onu.onuIndex}`).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.toast.success(result.message || 'Reinicio enviado por el canal nativo de la OLT');
        setTimeout(() => this.load(true), 12_000);
      },
      error: (error: { error?: { error?: string } }) => {
        this.saving.set(false);
        this.toast.error(error.error?.error || 'No se pudo reiniciar la ONU desde la OLT');
      },
    });
  }

  requestReboot() {
    if (!this.onu.serial) return;
    this.queue('reboot', { confirmation: `REINICIAR ${this.onu.serial}` });
  }

  cancel(task: Tr069Task) {
    this.api.cancelTr069Task(task.id).subscribe({ next: () => this.load(true), error: (error: { error?: { error?: string } }) => this.toast.error(error.error?.error || 'No se pudo cancelar') });
  }

  retry(task: Tr069Task) {
    this.api.retryTr069Task(task.id).subscribe({ next: () => { this.load(true); this.schedulePoll(); }, error: (error: { error?: { error?: string } }) => this.toast.error(error.error?.error || 'No se pudo reintentar') });
  }

  loadParameters() {
    if (!this.onu.serial || this.parameterLoading()) return;
    this.parameterLoading.set(true);
    this.api.getTr069Parameters(this.onu.serial, this.parameterSearch).subscribe({
      next: (rows) => { this.parameters.set(rows); this.parameterPage.set(1); this.parameterLoading.set(false); },
      error: () => { this.parameterLoading.set(false); this.toast.error('No se pudo leer el inventario técnico de la ONU'); },
    });
  }

  changeParameterPage(direction: -1 | 1) {
    this.parameterPage.update((page) => Math.min(this.parameterPageCount(), Math.max(1, page + direction)));
  }

  loadTelemetry() {
    if (!this.onu.serial) return;
    this.api.getTr069Telemetry(this.onu.serial).subscribe({ next: (rows) => this.telemetry.set(rows), error: () => undefined });
  }

  actionLabel(task: Pick<Tr069Task, 'action'>) {
    return this.capability(task.action)?.label || task.action.replaceAll('_', ' ');
  }

  formatDate(value?: string | null) {
    return value ? new Intl.DateTimeFormat('es-DO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '--';
  }

  formatBytes(value: unknown) {
    const bytes = Number(value || 0);
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  private populate(device: Tr069Device) {
    const snapshot = device.snapshot;
    this.wifi = { ...this.wifi, ssid: snapshot.wifi.ssid || '', enabled: snapshot.wifi.enabled, broadcast: snapshot.wifi.broadcast, channel: snapshot.wifi.channel ?? 0, transmitPower: snapshot.wifi.transmitPower ?? 100, standard: snapshot.wifi.standard || '11bgn', maxClients: snapshot.wifi.maxClients ?? 32, wmm: snapshot.wifi.wmm, wps: snapshot.wifi.wps };
    this.dhcp = { ...this.dhcp, enabled: snapshot.dhcp.enabled, minAddress: snapshot.dhcp.minAddress || '', maxAddress: snapshot.dhcp.maxAddress || '', subnetMask: snapshot.dhcp.subnetMask || '', router: snapshot.dhcp.router || '', dnsServers: snapshot.dhcp.dnsServers || '', leaseTime: snapshot.dhcp.leaseTime || 86400 };
    this.time = { ...this.time, enabled: snapshot.system.timeEnabled, timeZone: snapshot.system.timeZone || '-04:00', timeZoneName: snapshot.system.timeZoneName || 'America/Santo_Domingo', informInterval: snapshot.system.periodicInformInterval || 300 };
    this.wan = { ...this.wan, enabled: snapshot.wan.status !== 'Disconnected', addressingType: snapshot.wan.addressingType || 'Static', ipAddress: snapshot.wan.ip || '', gateway: snapshot.wan.gateway || '', dnsServers: snapshot.wan.dnsServers || '', vlan: snapshot.wan.vlan || 101, mtu: snapshot.wan.mtu || 1500, natEnabled: snapshot.wan.natEnabled, serviceList: snapshot.wan.serviceList || 'TR069_INTERNET' };
  }

  private schedulePoll() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.load(true), 3000);
  }
}
