import { Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ClientNetworkSample } from '../../services/network-audit.service';
import {
  areaPath, bucketize, buildEpisodes, fmtDateTime, formatDuration, linePath, niceMax, relativeTime,
  stateColor, stateLabel, worstState, Episode, HealthLike,
} from './audit-utils';

interface DailyRow { day: string; sampleCount: number; onlineSamples: number; stableSamples: number; offlineSamples: number; }

const W = 600;
const H = 120;

/** Gráficas compactas del detalle de un cliente, calculadas con las lecturas ya cargadas. */
@Component({
  selector: 'app-client-charts',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    @if (points().length) {
      <section class="block">
        <div class="outage-kpis">
          <div [class.bad]="episodes().length > 0"><small>Caídas</small><strong>{{ episodes().length }}</strong></div>
          <div [class.bad]="downMs() > 0"><small>Tiempo sin servicio</small><strong>{{ downMs() ? duration(downMs()) : '0 min' }}</strong></div>
          <div><small>Caída más larga</small><strong>{{ longest() ? duration(longest()!.durationMs) : '—' }}</strong></div>
          <div><small>Última caída</small><strong>{{ lastEpisode() ? rel(lastEpisode()!.end) : 'Ninguna' }}</strong></div>
        </div>

        <h4>Estado de cada lectura <span>{{ rangeLabel() }}</span></h4>
        <svg class="strip" [attr.viewBox]="'0 0 ' + strip().length + ' 10'" preserveAspectRatio="none" role="img" [attr.aria-label]="'Línea de tiempo del servicio: ' + episodes().length + ' caídas'">
          @for (b of strip(); track $index) {
            <rect [attr.x]="$index" y="0" width="1.02" height="10" [attr.fill]="color(b.state)"><title>{{ b.label }}</title></rect>
          }
        </svg>
        <div class="axis"><span>{{ firstLabel() }}</span><span>{{ lastLabel() }}</span></div>
        <p class="legend"><span><i style="background:#13875a"></i>Estable</span><span><i style="background:#b36b12"></i>Degradado</span><span><i style="background:#b42318"></i>Sin servicio</span></p>

        <h4>Consumo de bajada <span>máx. {{ traffic().max | number:'1.0-1' }} Mbps</span></h4>
        <div class="chart">
          <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" preserveAspectRatio="none" role="img" [attr.aria-label]="'Consumo de bajada: promedio ' + (traffic().avg | number:'1.1-1') + ' Mbps'">
            <path [attr.d]="traffic().area" fill="#1267dd" fill-opacity=".14" />
            <path [attr.d]="traffic().line" fill="none" stroke="#1267dd" stroke-width="1.6" vector-effect="non-scaling-stroke" />
            @if (traffic().limitY != null) {
              <line x1="0" [attr.x2]="w" [attr.y1]="traffic().limitY" [attr.y2]="traffic().limitY" stroke="#b36b12" stroke-width="1.2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" />
            }
          </svg>
        </div>
        <p class="legend">
          <span><i style="background:#1267dd"></i>Bajada usada (promedio {{ traffic().avg | number:'1.1-1' }} Mbps)</span>
          @if (traffic().limit) { <span><i class="dash"></i>Límite del plan {{ traffic().limit | number:'1.0-1' }} Mbps</span> }
        </p>
        @if (traffic().saturatedPct >= 10) {
          <p class="tip">En el {{ traffic().saturatedPct | number:'1.0-0' }} % de las lecturas el cliente estaba usando 90 % o más de su plan: puede sentir que «el Internet está lento» aunque la red esté bien.</p>
        }

        @if (episodes().length) {
          <h4>Caídas recientes</h4>
          <ul class="episodes">
            @for (e of recentEpisodes(); track e.start) {
              <li><span class="dot" [style.background]="color(e.worst)"></span><span>{{ when(e.start) }}</span><strong>{{ duration(e.durationMs) }}</strong></li>
            }
          </ul>
        }
      </section>
    }

    @if (dailyStats(); as d) {
      <section class="block">
        <h4>Disponibilidad por día <span>últimos {{ d.bars.length }} días con lecturas</span></h4>
        <div class="days" role="img" [attr.aria-label]="'Disponibilidad diaria. Período actual ' + (d.current | number:'1.1-2') + ' %'">
          @for (b of d.bars; track b.day) {
            <i [style.height.%]="Math.max(4, b.pct)" [class]="tone(b.pct)" [title]="b.label"></i>
          }
        </div>
        <p class="compare">
          Últimos {{ d.days }} días: <b>{{ d.current | number:'1.1-2' }} %</b>
          @if (d.previous != null) {
            · {{ d.days }} días anteriores: <b>{{ d.previous | number:'1.1-2' }} %</b>
            <span [class]="d.current - d.previous >= 0 ? 'up' : 'down'">
              ({{ d.current - d.previous >= 0 ? 'mejoró' : 'empeoró' }} {{ Math.abs(d.current - d.previous) | number:'1.1-2' }} pp)
            </span>
          } @else { · sin lecturas del período anterior para comparar }
        </p>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .block { margin: 0 16px 14px; padding: 14px; background: #fff; border: 1px solid #dce2e8; border-radius: 8px; }
    h4 { display: flex; justify-content: space-between; gap: 8px; margin: 14px 0 6px; font-size: 13px; color: #172535; }
    h4:first-child, .outage-kpis + h4 { margin-top: 12px; }
    h4 span { font-size: 11px; font-weight: 500; color: #8792a0; }
    .outage-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .outage-kpis div { display: grid; gap: 2px; padding: 8px 10px; border-radius: 6px; background: #f8fafc; min-width: 0; }
    .outage-kpis small { font-size: 11px; color: #667582; }
    .outage-kpis strong { font-size: 15px; color: #172535; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .outage-kpis .bad { background: #fff0ef; } .outage-kpis .bad strong { color: #b42318; }
    .strip { display: block; width: 100%; height: 22px; border-radius: 4px; overflow: hidden; background: #edf0f3; }
    .axis { display: flex; justify-content: space-between; font-size: 11px; color: #8792a0; margin-top: 3px; }
    .chart { height: 110px; border-bottom: 1px solid #dfe5ea; background: linear-gradient(#f1f3f5 1px, transparent 1px) 0 0 / 100% 25%; }
    .chart svg { display: block; width: 100%; height: 100%; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 0 0; font-size: 11px; color: #667582; }
    .legend span { display: inline-flex; align-items: center; gap: 5px; }
    .legend i { width: 10px; height: 10px; border-radius: 2px; }
    .legend i.dash { height: 0; border-top: 2px dashed #b36b12; border-radius: 0; }
    .tip { margin: 8px 0 0; padding: 8px 10px; border-radius: 6px; background: #fff6e8; color: #7a4a0c; font-size: 12px; line-height: 1.5; }
    .episodes { list-style: none; margin: 0; padding: 0; }
    .episodes li { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f1f3f5; font-size: 12px; color: #334250; }
    .episodes li:last-child { border-bottom: 0; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .days { display: flex; align-items: flex-end; gap: 2px; height: 70px; padding-top: 4px; border-bottom: 1px solid #dfe5ea; }
    .days i { flex: 1; min-width: 3px; border-radius: 2px 2px 0 0; }
    i.excellent { background: #13875a; } i.good { background: #6cc49c; } i.fair { background: #e0a043; } i.poor { background: #b42318; }
    .compare { margin: 8px 0 0; font-size: 12px; color: #667582; }
    .compare b { color: #172535; }
    .compare .up { color: #13875a; font-weight: 700; } .compare .down { color: #b42318; font-weight: 700; }
    @media (max-width: 650px) { .block { margin: 0 12px 12px; } .outage-kpis { grid-template-columns: 1fr 1fr; } }
  `],
})
export class ClientChartsComponent {
  readonly samples = input.required<ClientNetworkSample[]>();
  readonly daily = input<DailyRow[]>([]);
  readonly periodDays = input(30);
  readonly intervalMs = input(600000);

  readonly Math = Math;
  readonly w = W;
  readonly h = H;

  /** Lecturas del más antiguo al más reciente. */
  readonly points = computed(() => [...this.samples()]
    .map(s => ({ s, t: new Date(s.capturedAt).getTime() }))
    .filter(p => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t));

  readonly episodes = computed(() => buildEpisodes(this.points(), p => p.t, p => p.s.healthState === 'offline', p => p.s.healthState, this.intervalMs()));
  readonly downMs = computed(() => this.episodes().reduce((sum, e) => sum + e.durationMs, 0));
  readonly longest = computed(() => this.episodes().reduce<Episode | null>((best, e) => !best || e.durationMs > best.durationMs ? e : best, null));
  readonly lastEpisode = computed(() => this.episodes().at(-1) || null);
  readonly recentEpisodes = computed(() => [...this.episodes()].reverse().slice(0, 6));

  readonly strip = computed(() => bucketize(this.points(), 180, p => p.t).map(b => {
    const state = b.items.reduce<HealthLike>((acc, p) => worstState(acc, p.s.healthState), 'unknown');
    return { state, label: `${fmtDateTime(b.start)}${b.items.length > 1 ? ' – ' + fmtDateTime(b.end) : ''}: ${stateLabel(state)}` };
  }));

  readonly firstLabel = computed(() => this.points().length ? fmtDateTime(this.points()[0].t) : '');
  readonly lastLabel = computed(() => this.points().length ? fmtDateTime(this.points()[this.points().length - 1].t) : '');
  readonly rangeLabel = computed(() => `${this.points().length} lecturas`);

  readonly traffic = computed(() => {
    const pts = this.points();
    const buckets = bucketize(pts, 150, p => p.t);
    const values = buckets.map(b => b.items.reduce((sum, p) => sum + (p.s.downloadBps || 0), 0) / b.items.length / 1e6);
    const limits = pts.map(p => p.s.maxDownloadBps || 0).filter(v => v > 0);
    const limit = limits.length ? limits[limits.length - 1] / 1e6 : 0;
    const peak = Math.max(0, ...values);
    const max = niceMax(Math.max(peak, limit));
    const saturated = limit ? pts.filter(p => (p.s.downloadBps || 0) / 1e6 >= limit * 0.9).length : 0;
    return {
      line: linePath(values, max, W, H),
      area: areaPath(values, max, W, H),
      max,
      limit,
      limitY: limit ? H - (limit / max) * H : null,
      avg: pts.length ? pts.reduce((sum, p) => sum + (p.s.downloadBps || 0), 0) / pts.length / 1e6 : 0,
      saturatedPct: pts.length ? (saturated / pts.length) * 100 : 0,
    };
  });

  readonly dailyStats = computed(() => {
    const rows = [...(this.daily() || [])]
      .filter(r => r && r.sampleCount > 0)
      .sort((a, b) => new Date(b.day).getTime() - new Date(a.day).getTime());
    if (!rows.length) return null;
    const days = Math.min(this.periodDays(), 365);
    const now = Date.now();
    const inRange = (r: DailyRow, fromDays: number, toDays: number) => {
      const age = (now - new Date(r.day).getTime()) / 86_400_000;
      return age >= fromDays && age < toDays;
    };
    const avail = (list: DailyRow[]) => {
      const samples = list.reduce((sum, r) => sum + r.sampleCount, 0);
      return samples ? list.reduce((sum, r) => sum + r.onlineSamples, 0) / samples * 100 : null;
    };
    const currentRows = rows.filter(r => inRange(r, -1, days));
    const previousRows = rows.filter(r => inRange(r, days, days * 2));
    const current = avail(currentRows);
    if (current == null) return null;
    const bars = rows.slice(0, 30).reverse().map(r => {
      const pct = r.onlineSamples / r.sampleCount * 100;
      const date = new Date(r.day).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', timeZone: 'UTC' });
      return { day: r.day, pct, label: `${date}: ${pct.toFixed(1)} % disponible (${r.offlineSamples} lecturas sin servicio)` };
    });
    return { days, current, previous: avail(previousRows), bars };
  });

  color(state: HealthLike): string { return stateColor(state); }
  tone(pct: number): string { return pct >= 99.5 ? 'excellent' : pct >= 98 ? 'good' : pct >= 95 ? 'fair' : 'poor'; }
  duration(ms: number): string { return formatDuration(ms); }
  rel(ms: number): string { return relativeTime(new Date(ms).toISOString()); }
  when(ms: number): string { return fmtDateTime(ms); }
}
