import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideCopy, LucideExternalLink, LucideSearch, LucideX } from '@lucide/angular';
import { MtIpamRow, MtLiveClient, MtUnknownDevice } from '../../services/mikrotik.service';
import { ToastService } from '../../services/toast.service';
import { copyToClipboard, normalizeMac } from './mt-utils';

export type SearchTab = 'reconciliation' | 'unknown' | 'ipam';

interface SearchHit {
  key: string;
  kind: 'client' | 'no-client' | 'no-queue' | 'unknown' | 'free' | 'ip';
  badge: string;
  title: string;
  subtitle: string;
  ip: string;
  mac: string | null;
  clientId: number | null;
  rate: string;
  online: boolean | null;
  tab: SearchTab;
  score: number;
}

const MAX_HITS = 12;

/** Búsqueda local sobre los datos ya cargados (colas, desconocidos e inventario IP). */
@Component({
  selector: 'app-mt-global-search',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideCopy, LucideExternalLink, LucideSearch, LucideX],
  host: { class: 'panel mt-search' },
  template: `
    <div class="box">
      <svg lucideSearch size="18" aria-hidden="true"></svg>
      <input #field type="search" [value]="query()" (input)="query.set($any($event.target).value)" (keydown.escape)="query.set('')"
        placeholder="Buscar cliente, usuario, IP, MAC o cola en todo el router" aria-label="Buscar en la red" autocomplete="off" />
      @if (query()) { <button type="button" class="clear" (click)="clear()" title="Limpiar búsqueda" aria-label="Limpiar búsqueda"><svg lucideX size="15" aria-hidden="true"></svg></button> }
      @else { <kbd title="Pulse / para buscar desde cualquier parte de esta vista">/</kbd> }
    </div>
    @if (query().trim().length >= 2) {
      <div class="results">
        @for (hit of hits(); track hit.key) {
          <div class="hit">
            <span class="badge" [class]="hit.kind">{{ hit.badge }}</span>
            <span class="who">
              <strong>{{ hit.title }}</strong>
              <small>{{ hit.subtitle }}</small>
            </span>
            <span class="rate">{{ hit.rate }}</span>
            <span class="actions">
              @if (hit.ip) { <button type="button" class="ip-chip" (click)="copy(hit.ip)" [attr.aria-label]="'Copiar IP ' + hit.ip" [title]="'Copiar ' + hit.ip">{{ hit.ip }}<svg lucideCopy size="12" aria-hidden="true"></svg></button> }
              @if (hit.clientId) { <a class="link" [routerLink]="['/clients', hit.clientId]" title="Abrir expediente del cliente"><svg lucideExternalLink size="14" aria-hidden="true"></svg>Expediente</a> }
              <button type="button" class="link" (click)="openIn(hit)">{{ tabLabel(hit.tab) }}</button>
            </span>
          </div>
        } @empty {
          <p class="none">No hay coincidencias para «{{ query().trim() }}».@if (!ipamRows().length) { Abra «IPs libres» para buscar también en el inventario de IP. }</p>
        }
        @if (total() > hits().length) { <p class="more">Se muestran {{ hits().length }} de {{ total() }} coincidencias. Escriba más para afinar.</p> }
        <p class="sources">Buscando en {{ sourcesText() }}</p>
      </div>
    }
  `,
  styles: [`
    :host { display: block; margin-bottom: 14px; overflow: visible; }
    .box { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 14px; color: #667582; }
    .box:focus-within { box-shadow: inset 0 0 0 2px #1267dd; border-radius: 8px; }
    .box input { flex: 1; min-width: 0; height: 44px; border: 0; outline: 0; background: transparent; color: #172535; font: inherit; font-size: 14px; }
    .clear { width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 6px; background: #eef1f4; color: #334250; cursor: pointer; }
    kbd { min-width: 22px; padding: 2px 6px; border: 1px solid #ccd6de; border-bottom-width: 2px; border-radius: 4px; color: #667582; font: 11px ui-monospace, 'Cascadia Mono', Consolas, monospace; text-align: center; }
    .results { border-top: 1px solid #e8ecf1; }
    .hit { display: grid; grid-template-columns: 118px minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid #edf0f4; }
    .badge { justify-self: start; display: inline-flex; align-items: center; min-height: 21px; padding: 0 7px; border-radius: 10px; font-size: 11px; font-weight: 750; white-space: nowrap; color: #334250; background: #eef1f4; }
    .badge.client { color: #0d58c0; background: #edf4ff; }
    .badge.no-client, .badge.no-queue { color: #b36b12; background: #fff6e8; }
    .badge.unknown { color: #b42318; background: #fff0ef; }
    .badge.free { color: #13875a; background: #e9f8f1; }
    .who { min-width: 0; display: flex; flex-direction: column; }
    .who strong { color: #172535; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .who small { color: #667582; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rate { color: #2767a5; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .ip-chip { display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 0 8px; border: 1px solid #dfe5ea; border-radius: 6px; background: #fff; color: #334250; font: 12px ui-monospace, 'Cascadia Mono', Consolas, monospace; cursor: pointer; }
    .ip-chip:hover { border-color: #1267dd; color: #1267dd; }
    .link { display: inline-flex; align-items: center; gap: 4px; min-height: 28px; padding: 0 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: #1267dd; font: inherit; font-size: 12px; font-weight: 650; text-decoration: none; cursor: pointer; white-space: nowrap; }
    .link:hover { background: #edf4ff; }
    .none, .more, .sources { margin: 0; padding: 10px 14px; color: #667582; font-size: 12px; }
    .sources { padding-top: 6px; font-size: 11px; color: #8a95a6; }
    @media (max-width: 820px) {
      .hit { grid-template-columns: minmax(0, 1fr) auto; }
      .badge { grid-column: 1 / -1; }
      .actions { grid-column: 1 / -1; justify-content: flex-start; }
    }
  `],
})
export class MtGlobalSearchComponent {
  private readonly toast = inject(ToastService);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  readonly clients = input<MtLiveClient[]>([]);
  readonly unknownDevices = input<MtUnknownDevice[]>([]);
  readonly ipamRows = input<MtIpamRow[]>([]);
  readonly formatRate = input<(bps: number) => string>((bps) => `${(bps / 1_000_000).toFixed(1)} Mbps`);
  readonly open = output<{ tab: SearchTab; query: string }>();

  readonly query = signal('');

  private readonly allHits = computed<SearchHit[]>(() => {
    const raw = this.query().trim().toLowerCase();
    if (raw.length < 2) return [];
    const macQuery = normalizeMac(raw);
    // Una IP ("192.168") también son dígitos hexadecimales: solo se compara MAC si no parece IP.
    const useMac = macQuery.length >= 4 && !/^[\d.]+$/.test(raw) && /^[0-9a-f:\-.\s]+$/i.test(raw);
    const fmt = this.formatRate();
    const seenIps = new Set<string>();
    const hits: SearchHit[] = [];

    const score = (fields: Array<string | null | undefined>, ip: string, mac: string | null | undefined): number => {
      let best = 0;
      if (ip) {
        if (ip === raw) best = 100;
        else if (ip.startsWith(raw)) best = Math.max(best, 70);
        else if (ip.includes(raw)) best = Math.max(best, 40);
      }
      if (useMac && mac && normalizeMac(mac).includes(macQuery)) best = Math.max(best, 80);
      for (const field of fields) {
        const text = String(field || '').toLowerCase();
        if (!text) continue;
        if (text === raw) best = Math.max(best, 90);
        else if (text.startsWith(raw)) best = Math.max(best, 60);
        else if (text.split(/\s+/).some((word) => word.startsWith(raw))) best = Math.max(best, 50);
        else if (text.includes(raw)) best = Math.max(best, 30);
      }
      return best;
    };

    for (const row of this.clients()) {
      const value = score([row.client?.name, row.client?.wisphubName, row.client?.username, row.queueName, row.client?.zone, row.client?.snOnu], row.ip, row.macAddress);
      if (!value) continue;
      const kind: SearchHit['kind'] = !row.client ? 'no-client' : !row.queueId ? 'no-queue' : 'client';
      const limit = row.queueId ? `${(row.maxUploadBps / 1e6).toFixed(1).replace('.0', '')} / ${(row.maxDownloadBps / 1e6).toFixed(1).replace('.0', '')} Mbps` : 'sin cola';
      hits.push({
        key: `c-${row.queueId || row.client?.id || row.ip}-${row.ip}`,
        kind,
        badge: kind === 'client' ? (row.isOnline ? 'Cliente en línea' : 'Cliente sin conexión') : kind === 'no-client' ? 'Cola sin cliente' : 'Cliente sin cola',
        title: row.client?.name || row.queueName || 'Sin nombre',
        subtitle: [row.client?.username, row.macAddress, `Límite ${limit}`].filter(Boolean).join(' · '),
        ip: row.ip,
        mac: row.macAddress || null,
        clientId: row.client?.id ?? null,
        rate: row.downloadBps + row.uploadBps > 0 ? `↓ ${fmt(row.downloadBps)}` : '',
        online: row.isOnline,
        tab: 'reconciliation',
        score: value + (row.isOnline ? 1 : 0),
      });
      if (row.ip) seenIps.add(row.ip);
    }

    for (const device of this.unknownDevices()) {
      const value = score([device.identity, device.platform, device.queueName, device.bridgePort, device.interface], device.ip, device.macAddress);
      if (!value || seenIps.has(device.ip)) continue;
      hits.push({
        key: `u-${device.ip}`,
        kind: 'unknown',
        badge: device.risk === 'high' ? 'Desconocido · riesgo alto' : 'Desconocido',
        title: device.identity || device.platform || 'Equipo sin identificar',
        subtitle: [device.macAddress, device.bridgePort || device.interface, `${device.connectionCount} conexiones`].filter(Boolean).join(' · '),
        ip: device.ip,
        mac: device.macAddress,
        clientId: null,
        rate: device.downloadBps + device.uploadBps > 0 ? `↓ ${fmt(device.downloadBps)}` : '',
        online: null,
        tab: 'unknown',
        score: value,
      });
      seenIps.add(device.ip);
    }

    for (const row of this.ipamRows()) {
      if (seenIps.has(row.ip)) continue;
      const value = score([row.hostName, row.queueName, row.client?.name, row.client?.username], row.ip, row.macAddress);
      if (!value) continue;
      hits.push({
        key: `i-${row.ip}`,
        kind: row.available ? 'free' : 'ip',
        badge: row.available ? 'IP libre' : 'Inventario IP',
        title: row.available ? 'Disponible para un equipo nuevo' : (row.client?.name || row.hostName || row.queueName || 'Ocupada sin cliente'),
        subtitle: [row.cidr, row.macAddress, row.hostName].filter(Boolean).join(' · '),
        ip: row.ip,
        mac: row.macAddress,
        clientId: row.client?.id ?? null,
        rate: '',
        online: null,
        tab: 'ipam',
        score: value - (row.available ? 5 : 0),
      });
    }

    return hits.sort((a, b) => b.score - a.score);
  });

  readonly total = computed(() => this.allHits().length);
  readonly hits = computed(() => this.allHits().slice(0, MAX_HITS));
  readonly sourcesText = computed(() => {
    const parts = [`${this.clients().length} colas y clientes`];
    if (this.unknownDevices().length) parts.push(`${this.unknownDevices().length} desconocidos`);
    if (this.ipamRows().length) parts.push(`${this.ipamRows().length} IPs del inventario`);
    return parts.join(', ');
  });

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent) {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    event.preventDefault();
    this.field()?.nativeElement.focus();
  }

  clear() {
    this.query.set('');
    this.field()?.nativeElement.focus();
  }

  tabLabel(tab: SearchTab): string {
    return { reconciliation: 'Ver en colas', unknown: 'Ver en desconocidos', ipam: 'Ver en IPs' }[tab];
  }

  openIn(hit: SearchHit) {
    this.open.emit({ tab: hit.tab, query: hit.ip || hit.title });
  }

  async copy(ip: string) {
    if (await copyToClipboard(ip)) this.toast.success(`IP ${ip} copiada`);
    else this.toast.error(`No se pudo copiar. Anote la IP: ${ip}`);
  }
}
