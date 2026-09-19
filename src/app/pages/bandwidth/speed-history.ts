import { Component, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideDownload, LucideMapPin, LucideSearch, LucideUsers, LucideList } from '@lucide/angular';
import { SpeedResult } from '../../services/bandwidth.service';
import { ExportService } from '../../services/export.service';
import { ToastService } from '../../services/toast.service';
import { PlanLabelPipe, formatPlanName } from '../../pipes/plan-label.pipe';
import {
  PLAN_BAD_PCT, PLAN_OK_PCT, PlanComparison, PlanLevel, compareToPlan, fullDate, planLevelLabel, relativeTime,
} from './speed-utils';

type Chip = 'all' | 'ok' | 'below' | 'general';
type Tab = 'tests' | 'clients';

interface TestRow {
  key: number;
  r: SpeedResult;
  plan: string | null;
  cmp: PlanComparison;
}

interface ClientSummary {
  clientId: number;
  name: string;
  ip: string | null;
  plan: string | null;
  tests: number;
  last: TestRow;
  bestDown: number;
  avgDown: number;
  okCount: number;
  comparable: number;
}

const PREFS_KEY = 'ispmax.bandwidth.history';
const LEVEL_ORDER: Record<PlanLevel, number> = { bad: 0, low: 1, ok: 2, none: 3 };

@Component({
  selector: 'app-speed-history',
  standalone: true,
  imports: [DecimalPipe, RouterLink, PlanLabelPipe, LucideDownload, LucideMapPin, LucideSearch, LucideUsers, LucideList],
  template: `
    <section class="card">
      <div class="head">
        <div>
          <h3>Historial de pruebas</h3>
          <p class="sub">Cada prueba con cliente se compara con la bajada de su plan actual. Cumple si llega al {{ okPct }} % o más.</p>
        </div>
        @if (history().length) {
          <button type="button" class="btn-out" (click)="exportCsv()" [title]="tab() === 'tests' ? 'Descargar las pruebas que está viendo' : 'Descargar el resumen por cliente'">
            <svg lucideDownload size="16" aria-hidden="true"></svg>Exportar CSV
          </button>
        }
      </div>

      @if (history().length === 0) {
        <div class="empty">
          <strong>Todavía no hay pruebas guardadas</strong>
          <span>Pulse «Iniciar prueba» para hacer la primera. Si la hace en casa de un cliente, elíjalo antes para compararla con su plan.</span>
        </div>
      } @else {
        <div class="kpis" aria-label="Resumen del historial">
          <div><small>Pruebas</small><strong>{{ history().length }}</strong><span>{{ stats().withClient }} con cliente</span></div>
          <div [class]="'lv ' + stats().level"><small>Cumplen el plan</small><strong>{{ stats().okPct == null ? '—' : (stats().okPct | number:'1.0-0') + ' %' }}</strong><span>{{ stats().ok }} de {{ stats().comparable }} comparables</span></div>
          <div><small>Descarga promedio</small><strong>{{ stats().avgDown | number:'1.1-1' }} Mbps</strong><span>Subida {{ stats().avgUp | number:'1.1-1' }} Mbps</span></div>
          <div><small>Última prueba</small><strong class="rel">{{ rel(history()[0].timestamp) }}</strong><span>{{ history()[0].clientName || 'Prueba general' }}</span></div>
        </div>

        <div class="tabs" role="tablist" aria-label="Vista del historial">
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'tests'" [class.on]="tab() === 'tests'" (click)="setTab('tests')"><svg lucideList size="15" aria-hidden="true"></svg>Pruebas</button>
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'clients'" [class.on]="tab() === 'clients'" (click)="setTab('clients')"><svg lucideUsers size="15" aria-hidden="true"></svg>Resumen por cliente <span class="pill">{{ clientSummary().length }}</span></button>
        </div>

        <div class="filters">
          <label class="search"><svg lucideSearch size="15" aria-hidden="true"></svg>
            <input type="search" placeholder="Buscar cliente o IP" aria-label="Buscar en el historial" [value]="term()" (input)="term.set($any($event.target).value); limit.set(50)" />
          </label>
          <div class="chips" role="group" aria-label="Filtrar por resultado">
            @for (c of chips; track c.id) {
              @if (tab() === 'tests' || c.id !== 'general') {
                <button type="button" [class]="'chip ' + c.id" [class.on]="chip() === c.id" [attr.aria-pressed]="chip() === c.id" (click)="setChip(c.id)">{{ c.label }} <b>{{ chipCount(c.id) }}</b></button>
              }
            }
          </div>
        </div>

        @if (tab() === 'tests') {
          @if (!filteredTests().length) {
            <div class="empty small"><strong>Ninguna prueba coincide</strong><span>Cambie la búsqueda o el filtro.</span></div>
          } @else {
            <div class="table-wrap">
              <table>
                <thead><tr>
                  <th>Fecha</th><th>Cliente</th><th>Plan</th><th>Descarga</th>
                  <th title="Descarga medida comparada con la bajada del plan">% del plan</th>
                  <th>Subida</th><th title="Tiempo de respuesta. Menos es mejor.">Ping</th><th title="Cuánto varía el ping. Menos es mejor.">Jitter</th>
                </tr></thead>
                <tbody>
                  @for (row of filteredTests().slice(0, limit()); track row.key) {
                    <tr>
                      <td [title]="full(row.r.timestamp)"><span class="date">{{ rel(row.r.timestamp) }}</span><small>{{ full(row.r.timestamp) }}</small></td>
                      <td>
                        @if (row.r.clientId) {
                          <a [routerLink]="['/clients', row.r.clientId]" class="link">{{ row.r.clientName || 'Cliente ' + row.r.clientId }}</a>
                          @if (row.r.clientIp) { <small class="mono">{{ row.r.clientIp }}</small> }
                        } @else { <span class="muted">Prueba general</span> }
                      </td>
                      <td>@if (row.plan) { {{ row.plan | planLabel }} } @else { <span class="muted">—</span> }</td>
                      <td class="mono strong" [class]="'mono strong t-' + speedLevel(row)">{{ row.r.downloadMbps | number:'1.1-1' }} Mbps</td>
                      <td>
                        @if (row.cmp.pct != null) {
                          <div class="pct" [class]="'pct ' + row.cmp.level">
                            <div class="bar"><i [style.width.%]="barWidth(row.cmp.pct)"></i></div>
                            <span><b>{{ row.cmp.pct | number:'1.0-0' }} %</b> {{ levelLabel(row.cmp.level) }}</span>
                          </div>
                        } @else { <span class="muted">—</span> }
                      </td>
                      <td class="mono">{{ row.r.uploadMbps | number:'1.1-1' }} Mbps</td>
                      <td class="mono">{{ row.r.pingMs | number:'1.0-0' }} ms</td>
                      <td class="mono">{{ row.r.jitterMs | number:'1.1-1' }} ms</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="foot">
              <span>Mostrando {{ Math.min(limit(), filteredTests().length) }} de {{ filteredTests().length }}</span>
              @if (limit() < filteredTests().length) { <button type="button" class="btn-out" (click)="limit.set(limit() + 50)">Ver 50 más</button> }
            </div>
          }
        } @else {
          @if (!filteredClients().length) {
            <div class="empty small"><strong>Ningún cliente coincide</strong><span>Las pruebas generales (sin cliente) no aparecen en este resumen.</span></div>
          } @else {
            <div class="table-wrap">
              <table>
                <thead><tr>
                  <th>Cliente</th><th>Plan</th><th>Pruebas</th><th>Última prueba</th><th>Última descarga</th>
                  <th title="Resultado de la última prueba contra el plan">Resultado</th><th>Mejor</th><th>Promedio</th><th></th>
                </tr></thead>
                <tbody>
                  @for (s of filteredClients(); track s.clientId) {
                    <tr>
                      <td><a [routerLink]="['/clients', s.clientId]" class="link">{{ s.name }}</a>@if (s.ip) { <small class="mono">{{ s.ip }}</small> }</td>
                      <td>@if (s.plan) { {{ s.plan | planLabel }} } @else { <span class="muted">—</span> }</td>
                      <td>{{ s.tests }}@if (s.comparable > 1) { <small>{{ s.okCount }} cumplen</small> }</td>
                      <td [title]="full(s.last.r.timestamp)">{{ rel(s.last.r.timestamp) }}</td>
                      <td class="mono strong">{{ s.last.r.downloadMbps | number:'1.1-1' }} Mbps</td>
                      <td>
                        @if (s.last.cmp.pct != null) {
                          <span [class]="'badge ' + s.last.cmp.level">{{ levelLabel(s.last.cmp.level) }} · {{ s.last.cmp.pct | number:'1.0-0' }} %</span>
                        } @else { <span class="muted">—</span> }
                      </td>
                      <td class="mono">{{ s.bestDown | number:'1.1-1' }}</td>
                      <td class="mono">{{ s.avgDown | number:'1.1-1' }}</td>
                      <td><a class="icon-link" [routerLink]="['/mapa']" [queryParams]="{ cliente: s.clientId }" title="Ver en el mapa" aria-label="Ver cliente en el mapa"><svg lucideMapPin size="15" aria-hidden="true"></svg></a></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="foot"><span>{{ filteredClients().length }} {{ filteredClients().length === 1 ? 'cliente' : 'clientes' }} · primero los que están peor</span></div>
          }
        }
        <p class="note">Cumple: {{ okPct }} % o más de la bajada del plan · Por debajo: {{ badPct }} a {{ okPct }} % · Muy por debajo: menos de {{ badPct }} %. Una prueba por Wi-Fi o con otros equipos usando Internet puede dar menos que el plan; si sale baja, repítala con cable.</p>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .card { background: #fff; border: 1px solid #dfe5ea; border-radius: 8px; padding: 20px; margin-bottom: 18px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
    h3 { margin: 0; font-size: 16px; font-weight: 700; color: #172535; }
    .sub { margin: 3px 0 0; font-size: 12px; color: #667582; }
    .btn-out { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border: 1px solid #b9cdea; border-radius: 6px; background: #f2f7ff; color: #1267dd; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }
    .btn-out:hover { background: #edf4ff; border-color: #1267dd; }
    button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid #1267dd; outline-offset: 2px; }
    .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid #dfe5ea; border-radius: 8px; margin-bottom: 14px; }
    .kpis > div { display: grid; gap: 2px; padding: 12px 14px; border-right: 1px solid #edf0f3; min-width: 0; }
    .kpis > div:last-child { border-right: 0; }
    .kpis small { font-size: 11px; font-weight: 700; color: #667582; text-transform: uppercase; }
    .kpis strong { font-size: 20px; color: #172535; font-variant-numeric: tabular-nums; }
    .kpis strong.rel { font-size: 16px; line-height: 1.5; }
    .kpis span { font-size: 12px; color: #667582; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kpis .lv.ok strong { color: #13875a; } .kpis .lv.low strong { color: #b36b12; } .kpis .lv.bad strong { color: #b42318; }
    .tabs { display: flex; gap: 18px; border-bottom: 1px solid #dfe5ea; margin-bottom: 12px; overflow-x: auto; }
    .tabs button { display: inline-flex; align-items: center; gap: 6px; padding: 9px 2px; border: 0; border-bottom: 3px solid transparent; background: none; color: #667582; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }
    .tabs button.on { color: #1267dd; border-color: #1267dd; }
    .pill { padding: 1px 7px; border-radius: 999px; background: #eef1f4; color: #52606d; font-size: 11px; }
    .filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px; }
    .search { display: flex; align-items: center; gap: 6px; flex: 1 1 220px; height: 36px; padding: 0 10px; border: 1px solid #ccd6de; border-radius: 6px; color: #667582; background: #fff; }
    .search:focus-within { border-color: #1267dd; box-shadow: 0 0 0 2px #edf4ff; }
    .search input { flex: 1; min-width: 0; border: 0; outline: 0; font: inherit; font-size: 13px; color: #172535; background: transparent; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { height: 32px; padding: 0 11px; border: 1px solid #ccd6de; border-radius: 999px; background: #fff; color: #334250; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    .chip b { margin-left: 3px; color: #667582; }
    .chip.on { background: #edf4ff; border-color: #1267dd; color: #1267dd; }
    .chip.ok.on { background: #e9f8f1; border-color: #13875a; color: #13875a; }
    .chip.below.on { background: #fff0ef; border-color: #b42318; color: #b42318; }
    .chip.on b { color: inherit; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; min-width: 820px; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; font-weight: 700; color: #667582; text-transform: uppercase; padding: 9px 10px; border-bottom: 1px solid #dfe5ea; background: #f8fafc; white-space: nowrap; }
    td { padding: 9px 10px; font-size: 13px; color: #334250; border-bottom: 1px solid #edf0f3; white-space: nowrap; vertical-align: middle; }
    td small { display: block; font-size: 11px; color: #8792a0; }
    tbody tr:hover td { background: #f8fafc; }
    .date { font-weight: 600; color: #172535; }
    .mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 12px; }
    .strong { font-weight: 700; font-size: 13px; }
    .t-ok { color: #13875a; } .t-low { color: #b36b12; } .t-bad { color: #b42318; }
    .link { color: #1267dd; font-weight: 600; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    .icon-link { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 6px; color: #667582; }
    .icon-link:hover { background: #edf4ff; color: #1267dd; }
    .muted { color: #8792a0; }
    .pct { display: grid; gap: 3px; min-width: 130px; font-size: 12px; }
    .pct .bar { height: 5px; border-radius: 3px; background: #e6ebf0; overflow: hidden; }
    .pct .bar i { display: block; height: 100%; border-radius: 3px; }
    .pct.ok i { background: #13875a; } .pct.low i { background: #b36b12; } .pct.bad i { background: #b42318; }
    .pct.ok b { color: #13875a; } .pct.low b { color: #b36b12; } .pct.bad b { color: #b42318; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; }
    .badge.ok { background: #e9f8f1; color: #13875a; } .badge.low { background: #fff6e8; color: #b36b12; } .badge.bad { background: #fff0ef; color: #b42318; }
    .foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding-top: 10px; font-size: 12px; color: #667582; }
    .note { margin: 12px 0 0; padding: 10px 12px; border-radius: 6px; background: #f8fafc; font-size: 12px; color: #667582; line-height: 1.5; }
    .empty { display: grid; gap: 4px; text-align: center; padding: 32px 16px; color: #667582; font-size: 13px; }
    .empty.small { padding: 22px 16px; }
    .empty strong { color: #172535; font-size: 14px; }
    @media (max-width: 720px) {
      .card { padding: 16px 14px; }
      .head { flex-direction: column; }
      .kpis { grid-template-columns: 1fr 1fr; }
      .kpis > div:nth-child(2) { border-right: 0; }
      .kpis > div:nth-child(-n+2) { border-bottom: 1px solid #edf0f3; }
    }
  `],
})
export class SpeedHistoryComponent {
  private readonly exporter = inject(ExportService);
  private readonly toast = inject(ToastService);

  readonly history = input.required<SpeedResult[]>();
  readonly planById = input.required<Map<number, string>>();

  readonly Math = Math;
  readonly okPct = PLAN_OK_PCT;
  readonly badPct = PLAN_BAD_PCT;
  readonly chips: Array<{ id: Chip; label: string }> = [
    { id: 'all', label: 'Todas' },
    { id: 'ok', label: 'Cumplen' },
    { id: 'below', label: 'Por debajo' },
    { id: 'general', label: 'Sin cliente' },
  ];

  readonly term = signal('');
  readonly limit = signal(50);
  readonly chip = signal<Chip>('all');
  readonly tab = signal<Tab>('tests');

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (['all', 'ok', 'below', 'general'].includes(saved.chip)) this.chip.set(saved.chip);
      if (saved.tab === 'tests' || saved.tab === 'clients') this.tab.set(saved.tab);
      if (this.tab() === 'clients' && this.chip() === 'general') this.chip.set('all');
    } catch { /* preferencias no disponibles */ }
  }

  readonly rows = computed<TestRow[]>(() => {
    const plans = this.planById();
    return this.history().map((r, key) => {
      const plan = r.clientId ? plans.get(r.clientId) ?? null : null;
      return { key, r, plan, cmp: compareToPlan(r.downloadMbps, r.uploadMbps, plan) };
    });
  });

  readonly stats = computed(() => {
    const rows = this.rows();
    const comparable = rows.filter(row => row.cmp.pct != null);
    const ok = comparable.filter(row => row.cmp.level === 'ok').length;
    const okPct = comparable.length ? (ok / comparable.length) * 100 : null;
    const avg = (pick: (r: SpeedResult) => number) => rows.length ? rows.reduce((sum, row) => sum + (pick(row.r) || 0), 0) / rows.length : 0;
    const level: PlanLevel = okPct == null ? 'none' : okPct >= 80 ? 'ok' : okPct >= 50 ? 'low' : 'bad';
    return {
      withClient: rows.filter(row => !!row.r.clientId).length,
      comparable: comparable.length, ok, okPct, level,
      avgDown: avg(r => r.downloadMbps), avgUp: avg(r => r.uploadMbps),
    };
  });

  private matchesTerm(name: string | undefined | null, ip: string | undefined | null): boolean {
    const term = this.term().trim().toLowerCase();
    if (!term) return true;
    return (name || '').toLowerCase().includes(term) || (ip || '').includes(term);
  }

  private matchesChip(level: PlanLevel, hasClient: boolean, chip: Chip): boolean {
    if (chip === 'ok') return level === 'ok';
    if (chip === 'below') return level === 'low' || level === 'bad';
    if (chip === 'general') return !hasClient;
    return true;
  }

  readonly filteredTests = computed(() => {
    const chip = this.chip();
    return this.rows().filter(row =>
      this.matchesChip(row.cmp.level, !!row.r.clientId, chip) &&
      this.matchesTerm(row.r.clientName || (row.r.clientId ? '' : 'prueba general'), row.r.clientIp));
  });

  readonly clientSummary = computed<ClientSummary[]>(() => {
    const byClient = new Map<number, TestRow[]>();
    for (const row of this.rows()) {
      if (!row.r.clientId) continue;
      const list = byClient.get(row.r.clientId) || [];
      list.push(row);
      byClient.set(row.r.clientId, list);
    }
    const out: ClientSummary[] = [];
    for (const [clientId, list] of byClient) {
      // El historial llega del más reciente al más antiguo.
      const last = list[0];
      const comparable = list.filter(row => row.cmp.pct != null);
      out.push({
        clientId,
        name: last.r.clientName || `Cliente ${clientId}`,
        ip: last.r.clientIp || null,
        plan: last.plan,
        tests: list.length,
        last,
        bestDown: Math.max(...list.map(row => row.r.downloadMbps || 0)),
        avgDown: list.reduce((sum, row) => sum + (row.r.downloadMbps || 0), 0) / list.length,
        okCount: comparable.filter(row => row.cmp.level === 'ok').length,
        comparable: comparable.length,
      });
    }
    return out.sort((a, b) =>
      LEVEL_ORDER[a.last.cmp.level] - LEVEL_ORDER[b.last.cmp.level] ||
      (a.last.cmp.pct ?? 999) - (b.last.cmp.pct ?? 999) ||
      a.name.localeCompare(b.name));
  });

  readonly filteredClients = computed(() => {
    const chip = this.chip();
    return this.clientSummary().filter(s => this.matchesChip(s.last.cmp.level, true, chip) && this.matchesTerm(s.name, s.ip));
  });

  chipCount(chip: Chip): number {
    if (this.tab() === 'clients') return this.clientSummary().filter(s => this.matchesChip(s.last.cmp.level, true, chip)).length;
    return this.rows().filter(row => this.matchesChip(row.cmp.level, !!row.r.clientId, chip)).length;
  }

  setChip(chip: Chip): void { this.chip.set(chip); this.limit.set(50); this.savePrefs(); }
  setTab(tab: Tab): void {
    this.tab.set(tab);
    if (tab === 'clients' && this.chip() === 'general') this.chip.set('all');
    this.savePrefs();
  }

  private savePrefs(): void {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ chip: this.chip(), tab: this.tab() })); } catch { /* sin almacenamiento */ }
  }

  speedLevel(row: TestRow): string {
    if (row.cmp.level !== 'none') return row.cmp.level;
    const mbps = row.r.downloadMbps;
    return mbps >= 20 ? 'ok' : mbps >= 5 ? 'low' : 'bad';
  }

  barWidth(pct: number): number { return Math.max(3, Math.min(100, pct)); }
  levelLabel(level: PlanLevel): string { return planLevelLabel(level); }
  rel(iso: string): string { return relativeTime(iso); }
  full(iso: string): string { return fullDate(iso); }

  exportCsv(): void {
    const pct = (value: number | null) => value == null ? '' : Math.round(value);
    const n1 = (value: number) => Number((value || 0).toFixed(2));
    if (this.tab() === 'tests') {
      const rows = this.filteredTests();
      if (!rows.length) { this.toast.info('No hay pruebas para exportar con este filtro'); return; }
      this.exporter.exportCSV(rows, 'pruebas-velocidad', [
        { key: 'r.timestamp', label: 'Fecha', transform: v => fullDate(v) },
        { key: 'r.clientName', label: 'Cliente', transform: (v, row) => row.r.clientId ? (v || `Cliente ${row.r.clientId}`) : 'Prueba general' },
        { key: 'r.clientId', label: 'ID servicio', transform: v => v || '' },
        { key: 'r.clientIp', label: 'IP', transform: v => v || '' },
        { key: 'plan', label: 'Plan', transform: v => v ? formatPlanName(v) : '' },
        { key: 'r.downloadMbps', label: 'Descarga Mbps', transform: v => n1(v) },
        { key: 'r.uploadMbps', label: 'Subida Mbps', transform: v => n1(v) },
        { key: 'cmp.pct', label: '% del plan (descarga)', transform: v => pct(v) },
        { key: 'cmp.level', label: 'Resultado', transform: v => v === 'none' ? '' : planLevelLabel(v) },
        { key: 'r.pingMs', label: 'Ping ms', transform: v => Math.round(v || 0) },
        { key: 'r.jitterMs', label: 'Jitter ms', transform: v => n1(v) },
      ]);
      this.toast.success(`Archivo descargado con ${rows.length} ${rows.length === 1 ? 'prueba' : 'pruebas'}`);
    } else {
      const rows = this.filteredClients();
      if (!rows.length) { this.toast.info('No hay clientes para exportar con este filtro'); return; }
      this.exporter.exportCSV(rows, 'velocidad-por-cliente', [
        { key: 'name', label: 'Cliente' },
        { key: 'clientId', label: 'ID servicio' },
        { key: 'ip', label: 'IP', transform: v => v || '' },
        { key: 'plan', label: 'Plan', transform: v => v ? formatPlanName(v) : '' },
        { key: 'tests', label: 'Pruebas' },
        { key: 'last.r.timestamp', label: 'Última prueba', transform: v => fullDate(v) },
        { key: 'last.r.downloadMbps', label: 'Última descarga Mbps', transform: v => n1(v) },
        { key: 'last.cmp.pct', label: '% del plan (última)', transform: v => pct(v) },
        { key: 'last.cmp.level', label: 'Resultado', transform: v => v === 'none' ? '' : planLevelLabel(v) },
        { key: 'bestDown', label: 'Mejor descarga Mbps', transform: v => n1(v) },
        { key: 'avgDown', label: 'Promedio descarga Mbps', transform: v => n1(v) },
        { key: 'okCount', label: 'Pruebas que cumplen' },
      ]);
      this.toast.success(`Archivo descargado con ${rows.length} ${rows.length === 1 ? 'cliente' : 'clientes'}`);
    }
  }
}
