import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideChevronRight, LucideCircleCheck, LucideCopy, LucideExternalLink, LucideTriangleAlert } from '@lucide/angular';
import { MtIpamResponse, MtLiveClient } from '../../services/mikrotik.service';
import { ToastService } from '../../services/toast.service';
import { ISSUE_INFO, ISSUE_ORDER, IssueKind, copyToClipboard, detectIssues, normalizeMac } from './mt-utils';

interface IssueGroup {
  kind: IssueKind;
  title: string;
  detail: string;
  level: 'crit' | 'warn' | 'info';
  count: number;
  unit: string;
  rows: MtLiveClient[];
}

/** Inconsistencias calculadas en el navegador con /clients-live e /ipam. Solo lectura y navegación. */
@Component({
  selector: 'app-mt-network-issues',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideChevronRight, LucideCircleCheck, LucideCopy, LucideExternalLink, LucideTriangleAlert],
  host: { class: 'panel mt-issues' },
  template: `
    <header>
      <div>
        <span class="section-icon"><svg lucideTriangleAlert size="18" aria-hidden="true"></svg></span>
        <div><h2>Inconsistencias de red</h2><p>Router comparado con WispHub · {{ groups().length ? groups().length + ' tipos por revisar' : 'sin pendientes' }}</p></div>
      </div>
    </header>

    @if (!clients().length) {
      <div class="empty"><span>Esperando la lista de colas del router…</span></div>
    } @else {
      @if (!groups().length && !ipamConflicts()) {
        <div class="empty ok"><svg lucideCircleCheck size="22" aria-hidden="true"></svg><span>Todo coincide: no hay colas duplicadas, clientes sin cola ni colas sin cliente.</span></div>
      }
      <ul class="issue-list">
        @for (group of groups(); track group.kind) {
          <li [class]="group.level" [class.open]="expanded() === group.kind">
            <button type="button" class="issue-head" (click)="toggle(group.kind)" [attr.aria-expanded]="expanded() === group.kind">
              <i aria-hidden="true"></i>
              <span class="issue-text"><strong>{{ group.title }}</strong><small>{{ group.detail }}</small></span>
              <b class="count">{{ group.count }} <em>{{ group.unit }}</em></b>
              <svg lucideChevronRight size="16" class="chev" aria-hidden="true"></svg>
            </button>
            @if (expanded() === group.kind) {
              <div class="issue-body">
                @for (row of group.rows.slice(0, 8); track $index) {
                  <div class="issue-row">
                    <span class="who">
                      <strong>{{ row.client?.name || row.queueName || 'Sin nombre' }}</strong>
                      <small>{{ extra(group.kind, row) }}</small>
                    </span>
                    @if (row.ip) {
                      <button type="button" class="ip-chip" (click)="copy(row.ip)" [title]="'Copiar ' + row.ip" [attr.aria-label]="'Copiar IP ' + row.ip">
                        <span>{{ row.ip }}</span><svg lucideCopy size="12" aria-hidden="true"></svg>
                      </button>
                    }
                    @if (row.client?.id) {
                      <a class="go" [routerLink]="['/clients', row.client?.id]" title="Abrir expediente del cliente" aria-label="Abrir expediente del cliente"><svg lucideExternalLink size="14" aria-hidden="true"></svg></a>
                    } @else { <span class="go muted" title="Sin cliente en WispHub">—</span> }
                  </div>
                }
                <button type="button" class="see-all" (click)="filter.emit(group.kind)">Ver {{ group.rows.length > 8 ? 'los ' + group.rows.length : 'todos' }} en Clientes y colas</button>
              </div>
            }
          </li>
        }
        @if (ipamConflicts(); as conflicts) {
          <li class="crit">
            <button type="button" class="issue-head" (click)="ipam.emit()">
              <i aria-hidden="true"></i>
              <span class="issue-text"><strong>Conflictos en el inventario IP</strong><small>{{ conflicts.ip }} IPs con varias MAC · {{ conflicts.mac }} MAC en varias IPs (DHCP y ARP)</small></span>
              <b class="count">{{ conflicts.ip + conflicts.mac }}</b>
              <svg lucideChevronRight size="16" class="chev" aria-hidden="true"></svg>
            </button>
          </li>
        }
      </ul>
      @if (okCount()) { <p class="ok-line"><svg lucideCircleCheck size="13" aria-hidden="true"></svg>{{ okCount() }} revisiones sin problemas</p> }
    }
  `,
  styles: [`
    :host { display: block; }
    .empty { display: flex; align-items: center; gap: 10px; padding: 20px 16px; color: #56665e; font-size: 12px; }
    .empty.ok { color: #0f7a53; }
    .issue-list { margin: 0; padding: 0; list-style: none; }
    .issue-list > li { border-bottom: 1px solid #edf0f4; }
    .issue-head { width: 100%; display: grid; grid-template-columns: 8px minmax(0, 1fr) auto 16px; align-items: center; gap: 10px; padding: 10px 14px; border: 0; background: transparent; text-align: left; cursor: pointer; font: inherit; }
    .issue-head:hover { background: #f4f6f2; }
    .issue-head i { width: 8px; height: 8px; border-radius: 50%; background: #56665e; }
    li.crit .issue-head i { background: #b42318; }
    li.warn .issue-head i { background: #d08a1c; }
    li.info .issue-head i { background: #0b6b52; }
    .issue-text { min-width: 0; display: flex; flex-direction: column; }
    .issue-text strong { color: #15211c; font-size: 12px; }
    .issue-text small { color: #56665e; font-size: 11px; line-height: 1.4; }
    .count { color: #2d3b34; font-size: 15px; white-space: nowrap; }
    .count em { color: #56665e; font-size: 11px; font-style: normal; font-weight: 600; }
    li.crit .count { color: #b42318; }
    li.warn .count { color: #b36b12; }
    .chev { color: #8a95a6; transition: transform .15s ease; }
    li.open .chev { transform: rotate(90deg); }
    .issue-body { padding: 0 14px 10px 32px; }
    .issue-row { display: grid; grid-template-columns: minmax(0, 1fr) auto 28px; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px dashed #e8ecf1; }
    .who { min-width: 0; display: flex; flex-direction: column; }
    .who strong { color: #15211c; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .who small { color: #56665e; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ip-chip { display: inline-flex; align-items: center; gap: 5px; min-height: 26px; padding: 0 7px; border: 1px solid #e0e6e1; border-radius: 9px; background: #fff; color: #2d3b34; font: 12px 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace; cursor: pointer; }
    .ip-chip:hover { border-color: #0b6b52; color: #0b6b52; }
    .go { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 9px; color: #0b6b52; }
    .go:hover { background: #e6f2ec; }
    .go.muted { color: #b6c0cb; }
    .see-all { margin-top: 6px; min-height: 30px; padding: 0 10px; border: 1px solid #cfd8d2; border-radius: 9px; background: #fff; color: #0b6b52; font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; }
    .see-all:hover { background: #eef6f1; }
    .ok-line { display: flex; align-items: center; gap: 5px; margin: 0; padding: 9px 14px; color: #0f7a53; font-size: 11px; }
    @media (prefers-reduced-motion: reduce) { .chev { transition: none; } }
  `],
})
export class MtNetworkIssuesComponent {
  private readonly toast = inject(ToastService);

  readonly clients = input<MtLiveClient[]>([]);
  readonly ipamData = input<MtIpamResponse | null>(null);
  readonly filter = output<IssueKind>();
  readonly ipam = output<void>();

  readonly expanded = signal<IssueKind | null>(null);

  readonly issues = computed(() => detectIssues(this.clients()));
  readonly groups = computed<IssueGroup[]>(() => {
    const issues = this.issues();
    return ISSUE_ORDER.filter((kind) => issues[kind].length > 0).map((kind) => {
      const rows = issues[kind];
      const info = ISSUE_INFO[kind];
      let count = rows.length;
      let unit = rows.length === 1 ? 'equipo' : 'equipos';
      if (kind === 'dup-ip') { count = new Set(rows.map((row) => row.ip)).size; unit = count === 1 ? 'IP' : 'IPs'; }
      if (kind === 'dup-mac') { count = new Set(rows.map((row) => normalizeMac(row.macAddress))).size; unit = 'MAC'; }
      if (kind === 'no-queue' || kind === 'no-ip' || kind === 'saturated' || kind === 'state-diff') unit = rows.length === 1 ? 'cliente' : 'clientes';
      if (kind === 'no-client' || kind === 'paused' || kind === 'no-limit' || kind === 'name-diff') unit = rows.length === 1 ? 'cola' : 'colas';
      return { kind, title: info.title, detail: info.detail, level: info.level, count, unit, rows };
    });
  });
  readonly okCount = computed(() => ISSUE_ORDER.length - this.groups().length);
  readonly ipamConflicts = computed(() => {
    const data = this.ipamData();
    const ip = data?.conflicts?.ip?.length || 0;
    const mac = data?.conflicts?.mac?.length || 0;
    return ip + mac > 0 ? { ip, mac } : null;
  });

  toggle(kind: IssueKind) {
    this.expanded.set(this.expanded() === kind ? null : kind);
  }

  extra(kind: IssueKind, row: MtLiveClient): string {
    if (kind === 'dup-mac' || kind === 'dup-ip') return `MAC ${row.macAddress || 'desconocida'} · cola ${row.queueName || '-'}`;
    if (kind === 'saturated') return `${Math.round(Math.max(row.uploadPct, row.downloadPct))}% del plan en uso`;
    if (kind === 'no-client') return `Cola ${row.queueName}${row.isOnline ? ' · en línea' : ''}`;
    if (kind === 'name-diff') return `Cola en el router: ${row.queueName}`;
    if (kind === 'paused' || kind === 'state-diff') return `Cola ${row.queueName} deshabilitada`;
    return row.client?.username || row.client?.zone || row.queueName || '';
  }

  async copy(ip: string) {
    if (await copyToClipboard(ip)) this.toast.success(`IP ${ip} copiada`);
    else this.toast.error(`No se pudo copiar. Anote la IP: ${ip}`);
  }
}
