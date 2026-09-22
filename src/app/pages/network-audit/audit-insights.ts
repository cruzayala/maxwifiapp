import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  LucideClock3, LucideDownload, LucideExternalLink, LucideMapPin, LucideRefreshCw, LucideSignal,
  LucideTrendingDown, LucideTrendingUp, LucideTriangleAlert, LucideZap, LucideMinus,
} from '@lucide/angular';
import { ClientAuditRow } from '../../services/network-audit.service';
import { ExportService } from '../../services/export.service';
import { ToastService } from '../../services/toast.service';
import { formatPlanName } from '../../pipes/plan-label.pipe';
import { parsePlanSpeed } from '../bandwidth/speed-utils';
import { formatDuration, hoursFromSamples, stateLabel } from './audit-utils';

export interface AuditTrend {
  availability: number;
  stability: number;
  downHours: number;
  clients: number;
  prevAvailability: number | null;
  prevStability: number | null;
  prevDownHours: number | null;
}

type RankId = 'down' | 'unstable' | 'optic' | 'usage';

interface RankItem { row: ClientAuditRow; value: string; detail: string; bar: number; tone: 'bad' | 'warn' | 'info'; }

interface ZoneSummary {
  zone: string;
  clients: number;
  availability: number;
  downHours: number;
  attention: number;
  worst: ClientAuditRow | null;
}

/** Con menos lecturas que esto (1 hora a 10 min) el cliente no entra en los rankings: sus % no son confiables. */
const MIN_SAMPLES = 6;

@Component({
  selector: 'app-audit-insights',
  standalone: true,
  imports: [
    DecimalPipe, RouterLink,
    LucideClock3, LucideDownload, LucideExternalLink, LucideMapPin, LucideRefreshCw, LucideSignal,
    LucideTrendingDown, LucideTrendingUp, LucideTriangleAlert, LucideZap, LucideMinus,
  ],
  template: `
    @if (loading()) {
      <div class="panel loading" aria-busy="true">
        <div class="spinner" aria-hidden="true"></div>
        <strong>Analizando todos los clientes del período…</strong>
        <span>Esto se calcula una sola vez; al cambiar de pestaña no se vuelve a pedir.</span>
      </div>
    } @else if (error()) {
      <div class="panel loading" role="alert">
        <svg lucideTriangleAlert size="26" aria-hidden="true"></svg>
        <strong>No se pudo preparar el análisis</strong>
        <span>{{ error() }}</span>
        <button type="button" class="btn-out" (click)="retry.emit()"><svg lucideRefreshCw size="15" aria-hidden="true"></svg>Reintentar</button>
      </div>
    } @else if (!rows().length) {
      <div class="panel loading">
        <svg lucideClock3 size="26" aria-hidden="true"></svg>
        <strong>Todavía no hay lecturas para analizar en este período</strong>
        <span>Las lecturas se guardan solas cada {{ intervalMin() }} minutos.</span>
      </div>
    } @else {
      <div class="bar-top">
        <p>{{ rows().length }} clientes con lecturas · {{ periodLabel() }}. Solo entran en los rankings clientes con al menos {{ minSamples }} lecturas.</p>
        <button type="button" class="btn-out" (click)="exportCsv()"><svg lucideDownload size="15" aria-hidden="true"></svg>Exportar análisis</button>
      </div>

      @if (trend(); as t) {
        <section class="trend" aria-label="Comparado con el período anterior">
          <div>
            <small>Disponibilidad</small>
            <strong>{{ t.availability | number:'1.1-2' }} %</strong>
            <span [class]="'delta ' + deltaTone(t.availability, t.prevAvailability, true)">
              @switch (deltaTone(t.availability, t.prevAvailability, true)) {
                @case ('good') { <svg lucideTrendingUp size="14" aria-hidden="true"></svg> }
                @case ('bad') { <svg lucideTrendingDown size="14" aria-hidden="true"></svg> }
                @default { <svg lucideMinus size="14" aria-hidden="true"></svg> }
              }
              {{ deltaText(t.availability, t.prevAvailability, ' pp') }}
            </span>
          </div>
          <div>
            <small>Estabilidad</small>
            <strong>{{ t.stability | number:'1.1-2' }} %</strong>
            <span [class]="'delta ' + deltaTone(t.stability, t.prevStability, true)">{{ deltaText(t.stability, t.prevStability, ' pp') }}</span>
          </div>
          <div>
            <small>Horas sin servicio (suma de clientes)</small>
            <strong>{{ t.downHours | number:'1.0-0' }} h</strong>
            <span [class]="'delta ' + deltaTone(t.downHours, t.prevDownHours, false)">{{ deltaText(t.downHours, t.prevDownHours, ' h', 0) }}</span>
          </div>
          <div>
            <small>Salud de los clientes</small>
            <div class="dist" role="img" [attr.aria-label]="distLabel()">
              @for (d of distribution(); track d.id) {
                @if (d.count) { <i [class]="d.id" [style.flex-grow]="d.count" [title]="d.label + ': ' + d.count"></i> }
              }
            </div>
            <span class="dist-legend">
              @for (d of distribution(); track d.id) { <em><i [class]="d.id"></i>{{ d.short }} {{ d.count }}</em> }
            </span>
          </div>
        </section>
        <p class="trend-note">«pp» = puntos porcentuales frente a los {{ periodDays() }} días anteriores.@if (t.prevAvailability == null) { Todavía no hay lecturas del período anterior para comparar. }</p>
      }

      <div class="rank-grid">
        @for (r of ranks; track r.id) {
          <section class="rank">
            <header>
              <span [class]="'ico ' + r.id">
                @switch (r.id) {
                  @case ('down') { <svg lucideClock3 size="16" aria-hidden="true"></svg> }
                  @case ('unstable') { <svg lucideTriangleAlert size="16" aria-hidden="true"></svg> }
                  @case ('optic') { <svg lucideSignal size="16" aria-hidden="true"></svg> }
                  @case ('usage') { <svg lucideZap size="16" aria-hidden="true"></svg> }
                }
              </span>
              <div><h3>{{ r.title }}</h3><p>{{ r.hint }}</p></div>
            </header>
            @if (!rankings()[r.id].length) {
              <p class="rank-empty">{{ r.empty }}</p>
            } @else {
              <ol>
                @for (item of rankings()[r.id]; track item.row.idServicio; let i = $index) {
                  <li>
                    <span class="pos">{{ i + 1 }}</span>
                    <button type="button" class="who" (click)="openClient.emit(item.row)" [title]="'Ver lecturas de ' + item.row.name">
                      <strong>{{ item.row.name }}</strong>
                      <small>{{ item.detail }}</small>
                      <span class="mini"><i [class]="item.tone" [style.width.%]="item.bar"></i></span>
                    </button>
                    <b [class]="'val ' + item.tone">{{ item.value }}</b>
                    <a class="ext" [routerLink]="['/clients', item.row.idServicio]" title="Abrir expediente del cliente" [attr.aria-label]="'Abrir expediente de ' + item.row.name"><svg lucideExternalLink size="14" aria-hidden="true"></svg></a>
                  </li>
                }
              </ol>
            }
          </section>
        }
      </div>

      @if (zones().length > 1) {
        <section class="zones">
          <header><h3><svg lucideMapPin size="16" aria-hidden="true"></svg>Por zona</h3><p>Primero la zona con peor disponibilidad. Si varios clientes de la misma zona fallan a la vez, suele ser un problema de la zona (energía, fibra troncal, splitter), no de cada casa.</p></header>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Zona</th><th>Clientes</th><th>Disponibilidad</th><th>Horas sin servicio</th><th>Con problemas ahora</th><th>Cliente más afectado</th></tr></thead>
              <tbody>
                @for (z of zones(); track z.zone) {
                  <tr>
                    <td><strong>{{ z.zone }}</strong></td>
                    <td>{{ z.clients }}</td>
                    <td><div class="zbar"><span [class]="availTone(z.availability)">{{ z.availability | number:'1.1-2' }} %</span><div><i [class]="availTone(z.availability)" [style.width.%]="z.availability"></i></div></div></td>
                    <td>{{ z.downHours | number:'1.0-1' }} h</td>
                    <td>@if (z.attention) { <span class="warn-txt">{{ z.attention }} de {{ z.clients }}</span> } @else { <span class="ok-txt">Ninguno</span> }</td>
                    <td>@if (z.worst; as w) { <button type="button" class="link-btn" (click)="openClient.emit(w)">{{ w.name }}</button> } @else { — }</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .panel { background: #fff; border: 1px solid #dce2e8; border-radius: 12px; }
    .loading { min-height: 240px; display: grid; place-content: center; justify-items: center; gap: 8px; padding: 24px; text-align: center; color: #56665e; font-size: 13px; }
    .loading strong { color: #15211c; font-size: 15px; }
    .spinner { width: 30px; height: 30px; border: 3px solid #e0e6e1; border-top-color: #0b6b52; border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .btn-out { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border: 1px solid #b9cdea; border-radius: 9px; background: #eef6f1; color: #0b6b52; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }
    .btn-out:hover { border-color: #0b6b52; }
    button:focus-visible, a:focus-visible { outline: 2px solid #0b6b52; outline-offset: 2px; }
    .bar-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
    .bar-top p { margin: 0; font-size: 12px; color: #56665e; }
    .trend { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.4fr); background: #fff; border: 1px solid #dce2e8; border-radius: 12px; }
    .trend > div { display: grid; gap: 3px; align-content: start; padding: 14px 16px; border-right: 1px solid #e7ebef; min-width: 0; }
    .trend > div:last-child { border-right: 0; }
    .trend small { font-size: 11px; font-weight: 700; color: #56665e; text-transform: uppercase; }
    .trend strong { font-size: 22px; color: #15211c; font-variant-numeric: tabular-nums; }
    .delta { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; color: #56665e; }
    .delta.good { color: #0f7a53; } .delta.bad { color: #b42318; }
    .trend-note { margin: 6px 2px 14px; font-size: 11px; color: #86938c; }
    .dist { display: flex; height: 12px; margin: 6px 0 4px; border-radius: 9px; overflow: hidden; background: #ecf0ec; }
    .dist i { display: block; min-width: 4px; }
    .dist-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: #56665e; }
    .dist-legend em { display: inline-flex; align-items: center; gap: 4px; font-style: normal; }
    .dist-legend i { width: 8px; height: 8px; border-radius: 2px; }
    i.excellent { background: #0f7a53; } i.good { background: #6cc49c; } i.fair { background: #e0a043; } i.poor { background: #b42318; }
    .rank-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
    .rank { background: #fff; border: 1px solid #dce2e8; border-radius: 12px; min-width: 0; }
    .rank header { display: flex; gap: 10px; align-items: flex-start; padding: 13px 14px 10px; border-bottom: 1px solid #ecf0ec; }
    .rank h3, .zones h3 { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 14px; color: #15211c; }
    .rank header p, .zones header p { margin: 2px 0 0; font-size: 12px; color: #56665e; }
    .ico { flex-shrink: 0; width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; }
    .ico.down { background: #fff0ef; color: #b42318; } .ico.unstable { background: #fff6e8; color: #b36b12; }
    .ico.optic { background: #e6f2ec; color: #0b6b52; } .ico.usage { background: #e9f8f1; color: #0f7a53; }
    ol { list-style: none; margin: 0; padding: 4px 0; }
    li { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto 30px; align-items: center; gap: 8px; padding: 6px 12px; }
    li + li { border-top: 1px solid #f1f3f5; }
    .pos { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; background: #edf1ed; color: #52606d; font-size: 11px; font-weight: 800; }
    .who { display: grid; gap: 1px; min-width: 0; padding: 2px 0; border: 0; background: none; text-align: left; font: inherit; cursor: pointer; }
    .who strong { color: #15211c; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .who:hover strong { color: #0b6b52; text-decoration: underline; }
    .who small { color: #86938c; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mini { height: 4px; margin-top: 3px; border-radius: 2px; background: #ecf0ec; overflow: hidden; }
    .mini i { display: block; height: 100%; border-radius: 2px; }
    i.bad { background: #b42318; } i.warn { background: #b36b12; } i.info { background: #0b6b52; }
    .val { font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .val.bad { color: #b42318; } .val.warn { color: #b36b12; } .val.info { color: #0b6b52; }
    .ext { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 9px; color: #86938c; }
    .ext:hover { background: #e6f2ec; color: #0b6b52; }
    .rank-empty { margin: 0; padding: 22px 14px; text-align: center; font-size: 13px; color: #0f7a53; font-weight: 600; }
    .zones { background: #fff; border: 1px solid #dce2e8; border-radius: 12px; }
    .zones header { padding: 13px 14px 10px; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; min-width: 760px; border-collapse: collapse; }
    th { padding: 9px 13px; text-align: left; background: #f7f8fa; border-top: 1px solid #ecf0ec; border-bottom: 1px solid #e0e6e1; color: #627084; font-size: 11px; text-transform: uppercase; }
    td { padding: 9px 13px; border-bottom: 1px solid #ecf0ec; font-size: 12px; color: #3a475a; }
    td strong { color: #15211c; }
    .zbar { display: grid; gap: 3px; min-width: 120px; }
    .zbar span { font-weight: 700; }
    .zbar div { height: 4px; border-radius: 2px; background: #ecf0ec; overflow: hidden; }
    .zbar i { display: block; height: 100%; }
    span.excellent, span.good { color: #0f7a53; } span.fair { color: #b36b12; } span.poor { color: #b42318; }
    .warn-txt { color: #b36b12; font-weight: 700; } .ok-txt { color: #0f7a53; }
    .link-btn { padding: 0; border: 0; background: none; color: #0b6b52; font: inherit; font-weight: 600; cursor: pointer; text-align: left; }
    .link-btn:hover { text-decoration: underline; }
    @media (max-width: 1000px) { .trend { grid-template-columns: 1fr 1fr; } .trend > div:nth-child(2) { border-right: 0; } .trend > div:nth-child(-n+2) { border-bottom: 1px solid #e7ebef; } .rank-grid { grid-template-columns: 1fr; } }
    @media (max-width: 560px) { .trend { grid-template-columns: 1fr; } .trend > div { border-right: 0; border-bottom: 1px solid #e7ebef; } .bar-top { flex-direction: column; align-items: stretch; } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  `],
})
export class AuditInsightsComponent {
  private readonly exporter = inject(ExportService);
  private readonly toast = inject(ToastService);

  readonly rows = input.required<ClientAuditRow[]>();
  readonly intervalMs = input(600000);
  readonly periodDays = input(30);
  readonly trend = input<AuditTrend | null>(null);
  readonly loading = input(false);
  readonly error = input('');
  readonly openClient = output<ClientAuditRow>();
  readonly retry = output<void>();

  readonly minSamples = MIN_SAMPLES;
  readonly ranks: Array<{ id: RankId; title: string; hint: string; empty: string }> = [
    { id: 'down', title: 'Más horas sin servicio', hint: 'Suma del tiempo que cada cliente estuvo fuera de línea.', empty: 'Ningún cliente estuvo sin servicio en el período.' },
    { id: 'unstable', title: 'Más inestables', hint: 'Menor % de lecturas sin problemas (caídas, señal o cola).', empty: 'Todos los clientes estuvieron estables.' },
    { id: 'optic', title: 'Peor señal de fibra', hint: 'Promedio de luz en la ONU. Más negativo es peor.', empty: 'No hay lecturas de señal óptica en el período.' },
    { id: 'usage', title: 'Mayor consumo', hint: 'Bajada promedio del período y pico frente al plan.', empty: 'Sin consumo registrado.' },
  ];

  readonly intervalMin = computed(() => Math.round((this.intervalMs() || 600000) / 60000));
  readonly periodLabel = computed(() => this.periodDays() === 1 ? 'hoy' : `últimos ${this.periodDays()} días`);

  private readonly eligible = computed(() => this.rows().filter(row => row.sampleCount >= MIN_SAMPLES));

  readonly rankings = computed<Record<RankId, RankItem[]>>(() => {
    const rows = this.eligible();
    const interval = this.intervalMs();
    const where = (row: ClientAuditRow) => [row.zone, row.ip].filter(Boolean).join(' · ') || formatPlanName(row.plan);

    const downRows = rows.filter(row => row.offlineSamples > 0).sort((a, b) => b.offlineSamples - a.offlineSamples || a.availabilityPercent - b.availabilityPercent).slice(0, 10);
    const maxDown = downRows[0]?.offlineSamples || 1;
    const down = downRows.map<RankItem>(row => ({
      row, value: formatDuration(hoursFromSamples(row.offlineSamples, interval) * 3_600_000),
      detail: `${row.availabilityPercent.toFixed(1)} % disponible · ${where(row)}`,
      bar: (row.offlineSamples / maxDown) * 100, tone: 'bad',
    }));

    const unstable = rows.filter(row => row.stabilityPercent < 100).sort((a, b) => a.stabilityPercent - b.stabilityPercent || b.offlineSamples - a.offlineSamples).slice(0, 10)
      .map<RankItem>(row => ({
        row, value: `${row.stabilityPercent.toFixed(1)} %`,
        detail: `${row.offlineSamples} caídas · ${row.degradedSamples} degradadas · ${stateLabel(row.latestState).toLowerCase()} ahora`,
        bar: 100 - row.stabilityPercent, tone: row.stabilityPercent < 95 ? 'bad' : 'warn',
      }));

    const optic = rows.filter(row => row.avgRxPowerDbm != null).sort((a, b) => (a.avgRxPowerDbm as number) - (b.avgRxPowerDbm as number)).slice(0, 10)
      .map<RankItem>(row => {
        const avg = row.avgRxPowerDbm as number;
        return {
          row, value: `${avg.toFixed(1)} dBm`,
          detail: `Peor lectura ${row.minRxPowerDbm == null ? '—' : row.minRxPowerDbm.toFixed(1) + ' dBm'}${row.onuIndex ? ' · ONU ' + row.onuIndex : ''}`,
          // Escala de −15 dBm (buena) a −32 dBm (muy mala).
          bar: Math.max(4, Math.min(100, ((-15 - avg) / 17) * 100)),
          tone: avg <= -30 ? 'bad' : avg <= -27 ? 'warn' : 'info',
        };
      });

    const usageRows = rows.filter(row => row.avgDownloadMbps > 0).sort((a, b) => b.avgDownloadMbps - a.avgDownloadMbps).slice(0, 10);
    const maxUsage = usageRows[0]?.avgDownloadMbps || 1;
    const usage = usageRows.map<RankItem>(row => {
      const plan = parsePlanSpeed(row.plan);
      const peakPct = plan ? (row.peakDownloadMbps / plan.down) * 100 : null;
      return {
        row, value: `${row.avgDownloadMbps.toFixed(1)} Mbps`,
        detail: `Pico ${row.peakDownloadMbps.toFixed(1)} Mbps${peakPct != null ? ' (' + Math.round(peakPct) + ' % del plan ' + formatPlanName(row.plan) + ')' : ''}`,
        bar: (row.avgDownloadMbps / maxUsage) * 100, tone: peakPct != null && peakPct >= 95 ? 'warn' : 'info',
      };
    });

    return { down, unstable, optic, usage };
  });

  readonly distribution = computed(() => {
    const rows = this.eligible();
    const count = (fn: (v: number) => boolean) => rows.filter(row => fn(row.availabilityPercent)).length;
    return [
      { id: 'excellent', label: 'Excelente (99,5 % o más)', short: 'Excelente', count: count(v => v >= 99.5) },
      { id: 'good', label: 'Bien (98 a 99,5 %)', short: 'Bien', count: count(v => v >= 98 && v < 99.5) },
      { id: 'fair', label: 'Regular (95 a 98 %)', short: 'Regular', count: count(v => v >= 95 && v < 98) },
      { id: 'poor', label: 'Mala (menos de 95 %)', short: 'Mala', count: count(v => v < 95) },
    ];
  });

  distLabel(): string {
    return 'Disponibilidad por cliente: ' + this.distribution().map(d => `${d.label}: ${d.count}`).join(', ');
  }

  readonly zones = computed<ZoneSummary[]>(() => {
    const interval = this.intervalMs();
    const groups = new Map<string, ClientAuditRow[]>();
    for (const row of this.rows()) {
      const zone = row.zone?.trim() || 'Sin zona';
      const list = groups.get(zone) || [];
      list.push(row);
      groups.set(zone, list);
    }
    return [...groups.entries()].map(([zone, list]) => {
      const samples = list.reduce((sum, row) => sum + row.sampleCount, 0);
      const online = list.reduce((sum, row) => sum + row.sampleCount * row.availabilityPercent / 100, 0);
      const offline = list.reduce((sum, row) => sum + row.offlineSamples, 0);
      const worst = [...list].filter(row => row.offlineSamples > 0).sort((a, b) => b.offlineSamples - a.offlineSamples)[0] || null;
      return {
        zone, clients: list.length,
        availability: samples ? (online / samples) * 100 : 0,
        downHours: hoursFromSamples(offline, interval),
        attention: list.filter(row => row.latestState !== 'stable').length,
        worst,
      };
    }).sort((a, b) => a.availability - b.availability || b.downHours - a.downHours);
  });

  availTone(value: number): string {
    return value >= 99.5 ? 'excellent' : value >= 98 ? 'good' : value >= 95 ? 'fair' : 'poor';
  }

  deltaTone(current: number, previous: number | null, higherIsBetter: boolean): 'good' | 'bad' | 'flat' {
    if (previous == null) return 'flat';
    const diff = current - previous;
    if (Math.abs(diff) < 0.05) return 'flat';
    return (diff > 0) === higherIsBetter ? 'good' : 'bad';
  }

  deltaText(current: number, previous: number | null, unit: string, decimals = 2): string {
    if (previous == null) return 'Sin período anterior';
    const diff = current - previous;
    if (Math.abs(diff) < (decimals ? 0.05 : 0.5)) return 'Igual que el período anterior';
    const sign = diff > 0 ? '+' : '−';
    return `${sign}${Math.abs(diff).toFixed(decimals)}${unit} vs período anterior`;
  }

  exportCsv(): void {
    const rows = this.rows();
    if (!rows.length) { this.toast.info('No hay datos para exportar'); return; }
    const interval = this.intervalMs();
    this.exporter.exportCSV(rows, `analisis-red-${this.periodDays()}d`, [
      { key: 'name', label: 'Cliente' },
      { key: 'idServicio', label: 'ID servicio' },
      { key: 'ip', label: 'IP', transform: v => v || '' },
      { key: 'zone', label: 'Zona', transform: v => v || '' },
      { key: 'plan', label: 'Plan', transform: v => v ? formatPlanName(v) : '' },
      { key: 'latestState', label: 'Estado actual', transform: v => stateLabel(v) },
      { key: 'availabilityPercent', label: 'Disponibilidad %' },
      { key: 'stabilityPercent', label: 'Estabilidad %' },
      { key: 'offlineSamples', label: 'Horas sin servicio', transform: v => Number(hoursFromSamples(v, interval).toFixed(2)) },
      { key: 'offlineSamples', label: 'Lecturas caído' },
      { key: 'degradedSamples', label: 'Lecturas degradadas' },
      { key: 'avgDownloadMbps', label: 'Bajada promedio Mbps' },
      { key: 'peakDownloadMbps', label: 'Pico bajada Mbps' },
      { key: 'avgRxPowerDbm', label: 'Señal promedio dBm', transform: v => v ?? '' },
      { key: 'minRxPowerDbm', label: 'Peor señal dBm', transform: v => v ?? '' },
      { key: 'sampleCount', label: 'Lecturas' },
    ]);
    this.toast.success(`Archivo descargado con ${rows.length} clientes`);
  }
}
