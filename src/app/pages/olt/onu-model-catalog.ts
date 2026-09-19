import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideCircleCheck, LucideCpu, LucidePencil, LucidePlus, LucideRefreshCw,
  LucideShieldCheck, LucideX,
} from '@lucide/angular';
import {
  OnuCapabilityStatus, OnuManagementChannel, OnuModelCapability, OnuModelProfile, OltService,
} from '../../services/olt.service';
import { ToastService } from '../../services/toast.service';

type ProfileDraft = Omit<Partial<OnuModelProfile>, 'serialPrefixes' | 'defaults'> & {
  serialPrefixesText: string;
  vlan: number;
  capabilities: OnuModelCapability[];
};

const ACTION_LABELS: Record<string, string> = {
  olt_provision: 'Aprovisionamiento OLT', optical_read: 'Lectura óptica', equipment_read: 'Inventario',
  service_read: 'Lectura de servicio', ethernet_read: 'Lectura Ethernet', wifi_read: 'Lectura WiFi',
  wifi_write: 'Cambios WiFi', lan_read: 'Lectura LAN', lan_write: 'Cambios LAN', wan_read: 'Lectura WAN',
  wan_write: 'Cambios WAN', diagnostics: 'Diagnósticos', reboot: 'Reinicio', factory_reset: 'Restauración de fábrica',
  firmware_upgrade: 'Firmware', acs_config: 'Configuración ACS', security_config: 'NAT y seguridad',
};

@Component({
  selector: 'app-onu-model-catalog',
  standalone: true,
  imports: [
    FormsModule, LucideCircleCheck, LucideCpu, LucidePencil, LucidePlus, LucideRefreshCw,
    LucideShieldCheck, LucideX,
  ],
  templateUrl: './onu-model-catalog.html',
  styleUrl: './onu-model-catalog.scss',
})
export class OnuModelCatalogComponent implements OnInit {
  private readonly api = inject(OltService);
  private readonly toast = inject(ToastService);

  readonly profiles = signal<OnuModelProfile[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly reconciling = signal(false);
  readonly editorOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly activeCount = computed(() => this.profiles().filter((profile) => profile.active).length);
  readonly certifiedCount = computed(() => this.profiles().filter((profile) => profile.certificationStatus === 'verified').length);
  readonly assignedCount = computed(() => this.profiles().reduce((sum, profile) => sum + profile.deviceCount, 0));

  readonly channels: OnuManagementChannel[] = ['OLT_CLI', 'OMCI', 'TR069', 'WEB_LOCAL'];
  readonly statuses: OnuCapabilityStatus[] = ['detected', 'verified', 'failed', 'blocked'];
  draft: ProfileDraft = this.emptyDraft();

  ngOnInit() {
    this.load();
  }

  load(silent = false) {
    if (!silent) this.loading.set(true);
    this.api.getOnuModelProfiles(false).subscribe({
      next: (profiles) => { this.profiles.set(profiles); this.loading.set(false); },
      error: (error: { error?: { error?: string } }) => {
        this.loading.set(false);
        this.toast.error(error.error?.error || 'No se pudo cargar el catálogo de ONU');
      },
    });
  }

  openNew() {
    this.editingId.set(null);
    this.draft = this.emptyDraft();
    this.editorOpen.set(true);
  }

  openEdit(profile: OnuModelProfile) {
    this.editingId.set(profile.id);
    this.draft = {
      ...profile,
      serialPrefixesText: profile.serialPrefixes.join(', '),
      vlan: profile.defaults.vlan || 101,
      capabilities: profile.capabilities.map((item) => ({ ...item })),
    };
    this.editorOpen.set(true);
  }

  closeEditor() {
    if (!this.saving()) this.editorOpen.set(false);
  }

  save() {
    if (this.saving()) return;
    const payload: Partial<OnuModelProfile> & { changeReason?: string } = {
      manufacturer: this.draft.manufacturer?.trim(), model: this.draft.model?.trim(),
      firmwarePattern: this.draft.firmwarePattern?.trim() || '*',
      serialPrefixes: this.draft.serialPrefixesText.split(/[\s,;]+/).map((item) => item.trim().toUpperCase()).filter(Boolean),
      ponType: this.draft.ponType || 'GPON', oltVendor: this.draft.oltVendor?.trim() || 'ZTE',
      oltModel: this.draft.oltModel?.trim() || 'C320', oltOnuType: this.draft.oltOnuType?.trim(),
      omciMode: this.draft.omciMode || 'baseline', extendedOmci: this.draft.extendedOmci === true,
      tr069ProfileKey: this.draft.tr069ProfileKey?.trim() || null,
      certificationStatus: this.draft.certificationStatus || 'detected', active: this.draft.active !== false,
      notes: this.draft.notes?.trim() || null, defaults: { vlan: Number(this.draft.vlan), wanMode: 'static', dataModel: 'InternetGatewayDevice' },
      capabilities: this.draft.capabilities.map((item) => ({ ...item, id: undefined })),
      changeReason: this.editingId() ? 'Actualizacion desde el catalogo de modelos' : undefined,
    };
    if (!payload.manufacturer || !payload.model || !payload.oltOnuType) {
      this.toast.error('Complete fabricante, modelo y tipo ONU de la OLT');
      return;
    }
    this.saving.set(true);
    const request = this.editingId()
      ? this.api.updateOnuModelProfile(this.editingId()!, payload)
      : this.api.createOnuModelProfile(payload);
    request.subscribe({
      next: (profile) => {
        this.saving.set(false);
        this.editorOpen.set(false);
        this.toast.success(`Perfil ${profile.manufacturer} ${profile.model} guardado`);
        this.load(true);
      },
      error: (error: { error?: { error?: string } }) => {
        this.saving.set(false);
        this.toast.error(error.error?.error || 'No se pudo guardar el perfil');
      },
    });
  }

  toggle(profile: OnuModelProfile) {
    if (profile.active && !window.confirm(`¿Archivar el tipo ${profile.manufacturer} ${profile.model}? Dejará de sugerirse al autorizar ONU nuevas.`)) return;
    this.api.updateOnuModelProfile(profile.id, {
      active: !profile.active,
      changeReason: profile.active ? 'Perfil archivado' : 'Perfil reactivado',
    }).subscribe({
      next: () => { this.toast.success(profile.active ? 'Perfil archivado' : 'Perfil activado'); this.load(true); },
      error: (error: { error?: { error?: string } }) => this.toast.error(error.error?.error || 'No se pudo actualizar el perfil'),
    });
  }

  reconcile() {
    if (this.reconciling()) return;
    this.reconciling.set(true);
    this.api.reconcileOnuModelProfiles().subscribe({
      next: (result) => {
        this.reconciling.set(false);
        this.toast.success(`${result.matched} de ${result.scanned} ONU asociadas a perfiles`);
        this.load(true);
      },
      error: (error: { error?: { error?: string } }) => {
        this.reconciling.set(false);
        this.toast.error(error.error?.error || 'No se pudo conciliar el catálogo');
      },
    });
  }

  actionLabel(action: string) { return ACTION_LABELS[action] || action.replaceAll('_', ' '); }
  statusLabel(status: OnuCapabilityStatus) {
    return ({ detected: 'Detectada', verified: 'Verificada', failed: 'Con fallo', blocked: 'Bloqueada' } as const)[status];
  }

  channelLabel(channel: string) {
    return ({ OLT_CLI: 'OLT (consola)', OMCI: 'OMCI (OLT)', TR069: 'TR-069 (remoto)', WEB_LOCAL: 'Web local' } as Record<string, string>)[channel] || channel;
  }

  omciModeLabel(mode?: string | null) {
    return ({ baseline: 'OMCI base', extended: 'OMCI extendido', vendor: 'OMCI propietario' } as Record<string, string>)[String(mode || '')] || mode || 'OMCI';
  }

  verifiedCapabilities(profile: OnuModelProfile) {
    return profile.capabilities.filter((item) => item.status === 'verified').length;
  }

  private emptyDraft(): ProfileDraft {
    return {
      manufacturer: '', model: '', firmwarePattern: '*', serialPrefixesText: '', ponType: 'GPON',
      oltVendor: 'ZTE', oltModel: 'C320', oltOnuType: '', omciMode: 'baseline', extendedOmci: false,
      tr069ProfileKey: '', certificationStatus: 'detected', active: true, notes: '', vlan: 101,
      capabilities: this.defaultCapabilities(),
    };
  }

  private defaultCapabilities(): OnuModelCapability[] {
    return Object.keys(ACTION_LABELS).map((action) => ({
      action,
      channel: action === 'olt_provision' ? 'OLT_CLI' : ['optical_read', 'equipment_read', 'service_read', 'reboot'].includes(action) ? 'OMCI' : 'TR069',
      status: action === 'olt_provision' ? 'detected' : 'blocked',
      rollbackSupported: false,
      destructive: ['factory_reset', 'firmware_upgrade'].includes(action),
    }));
  }
}
