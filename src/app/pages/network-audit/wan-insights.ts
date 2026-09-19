import { Component, computed, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { LucideDownload } from '@lucide/angular';
import { WanNetworkSample } from '../../services/network-audit.service';
import { ExportService } from '../../services/export.service';
import { ToastService } from '../../services/toast.service';
import {
  areaPath, bucketize, buildEpisodes, fmtDateTime, formatDuration, linePath, niceMax,
  stateColor, stateLabel, worstState, HealthLike,
} from './audit-utils';

const W = 800;
const H = 150;

/** Gráficas del enlace a Internet con las lecturas ya cargadas (sin pedir nada nuevo al servidor). */
@Component({
  selector: 'app-wan-insights',
  standalone: true,
  imports: [DecimalPipe, LucideDownload],
  template: `
    @if (points().length > 1) {
      <div class="grid">
        <section class="card wide">
          <header>
            <div><h3>Tráfico del enlace</h3><p>{{ points().length }} lecturas · {{ rangeText() }}</p></div>
            <button type="button" class="btn-out" (click)="exportCsv()"><svg lucideDownload size="15" aria-hidden="true"></svg>Exportar CSV</button>
          </header>
          <div class="chart-row">
            <div class="y"><span>{{ traffic().max | number:'1.0-0' }}</span><span>{{ traffic().max / 2 | number:'1.0-0' }}</span><span>0</span></div>
            <div class="chart">
              <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" preserveAspectRatio="none" role="img" [attr.aria-label]="'Tráfico: bajada máxima ' + (traffic().peakRx | number:'1.0-1') + ' Mbps'">
                <path [attr.d]="traffic().rxArea" fill="#1267dd" fill-opacity=".15" />
                <path [attr.d]="traffic().rxLine" fill="none" stroke="#1267dd" stroke-width="1.8" vector-effect="non-scaling-stroke" />
                <path [attr.d]="traffic().txLine" fill="none" stroke="#13875a" stroke-width="1.5" vector-effect="non-scaling-stroke" />
              </svg>
            </div>
          </div>
          <div class="axis"><span>{{ firstLabel() }}</span><span>{{ lastLabel() }}</span></div>
          <p class="legend">
            <span><i style="background:#1267dd"></i>Bajada (Mbps)</span>
            <span><i style="background:#13875a"></i>Subida (Mbps)</span>
            @if (traffic().capacity) { <span>Capacidad del enlace: {{ traffic().capacity | number:'1.0-0' }} Mbps · pico al {{ traffic().peakUtil | number:'1.0-0' }} %</span> }
          </p>
          <h4>Estado del enlace</h4>
          <svg class="strip" [attr.viewBox]="'0 0 ' + strip().length + ' 10'" preserveAspectRatio="none" role="img" [attr.aria-label]="'Estado del enlace: ' + incidents().length + ' incidentes'">
            @for (b of strip(); track $index) {
              <rect [attr.x]="$index" y="0" width="1.02" height="10" [attr.fill]="color(b.state)"><title>{{ b.label }}</title></rect>
            }
          </svg>
          <p class="legend"><span><i style="background:#13875a"></i>Estable</span><span><i style="background:#b36b12"></i>Degradado</span><span><i style="background:#b42318"></i>Caído</span></p>
        </section>

        <section class="card">
          <header><div><h3>Ping hacia Internet</h3><p>Promedio {{ ping().avg == null ? '—' : (ping().avg | number:'1.0-1') + ' ms' }} · peor {{ ping().worst == null ? '—' : (ping().worst | number:'1.0-0') + ' ms' }}</p></div></header>
          @if (ping().line) {
            <div class="chart small">
              <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" preserveAspectRatio="none" role="img" aria-label="Ping del enlace en el tiempo">
                <path [attr.d]="ping().line" fill="none" stroke="#b36b12" stroke-width="1.6" vector-effect="non-scaling-stroke" />
                @for (m of ping().loss; track m.x) {
                  <line [attr.x1]="m.x" [attr.x2]="m.x" y1="0" [attr.y2]="h" stroke="#b42318" stroke-opacity=".5" stroke-width="2" vector-effect="non-scaling-stroke"><title>{{ m.label }}</title></line>
                }
              </svg>
            </div>
            <p class="legend"><span><i style="background:#b36b12"></i>Ping (ms, escala hasta {{ ping().max | number:'1.0-0' }})</span><span><i style="background:#b42318"></i>Pérdida de paquetes ({{ ping().lossCount }})</span></p>
          } @else {
            <p class="empty">No hay lecturas de ping en este período.</p>
          }
        </section>

        <section class="card">
          <header><div><h3>Horas de más uso</h3><p>Bajada promedio por hora del día. Las más altas son la hora pico.</p></div></header>
          <div class="hours" role="img" [attr.aria-label]="'Hora pico: ' + peakHoursText()">
            @for (hr of hours(); track hr.hour) {
              <div class="hcol" [title]="hr.label">
                <i [style.height.%]="hr.pct" [class.peak]="hr.peak"></i>
                <span>{{ hr.hour % 3 === 0 ? hr.hour : '' }}</span>
              </div>
            }
          </div>
          <p class="note">Hora pico: <b>{{ peakHoursText() }}</b>. Buen momento para trabajos de mantenimiento: <b>{{ quietHoursText() }}</b>.</p>
        </section>

        <section class="card wide">
          <header><div><h3>Incidentes del enlace</h3><p>Períodos seguidos en que el enlace no estuvo estable: pérdida de paquetes, ping de 80 ms o más, enlace al 85 % o más, OLT sin conexión o sin Internet.</p></div></header>
          @if (!incidents().length) {
            <p class="empty ok">Sin incidentes: el enlace estuvo estable en todas las lecturas cargadas.</p>
          } @else {
            <div class="table-wrap">
              <table>
                <thead><tr><th>Inicio</th><th>Duración</th><th>Peor estado</th><th>Pérdida máx.</th><th>Ping máx.</th><th>Detalle</th></tr></thead>
                <tbody>
                  @for (e of incidents(); track e.start) {
                    <tr>
                      <td>{{ when(e.start) }}</td>
                      <td><strong>{{ duration(e.durationMs) }}</strong></td>
                      <td><span class="state" [style.color]="color(e.worst)"><i [style.background]="color(e.worst)"></i>{{ label(e.worst) }}</span></td>
                      <td>{{ e.maxLoss == null ? '—' : (e.maxLoss | number:'1.0-1') + ' %' }}</td>
                      <td>{{ e.maxPing == null ? '—' : (e.maxPing | number:'1.0-0') + ' ms' }}</td>
                      <td class="detail">{{ e.detail || '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
    .card { min-width: 0; padding: 14px 16px; background: #fff; border: 1px solid #dce2e8; border-radius: 8px; }
    .wide { grid-column: 1 / -1; }
    header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
    h3 { margin: 0; font-size: 14px; color: #172535; }
    header p { margin: 2px 0 0; font-size: 12px; color: #667582; }
    h4 { margin: 14px 0 6px; font-size: 13px; color: #172535; }
    .btn-out { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid #b9cdea; border-radius: 6px; background: #f2f7ff; color: #1267dd; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
    .btn-out:focus-visible { outline: 2px solid #1267dd; outline-offset: 2px; }
    .chart-row { display: grid; grid-template-columns: 34px 1fr; gap: 6px; }
    .y { display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; font-size: 11px; color: #8792a0; height: 150px; }
    .chart { height: 150px; border-bottom: 1px solid #dfe5ea; background: linear-gradient(#f1f3f5 1px, transparent 1px) 0 0 / 100% 50%; }
    .chart.small { height: 120px; }
    .chart svg { display: block; width: 100%; height: 100%; }
    .axis { display: flex; justify-content: space-between; margin: 3px 0 0 40px; font-size: 11px; color: #8792a0; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 0 0; font-size: 11px; color: #667582; }
    .legend span { display: inline-flex; align-items: center; gap: 5px; }
    .legend i { width: 10px; height: 10px; border-radius: 2px; }
    .strip { display: block; width: 100%; height: 18px; border-radius: 4px; overflow: hidden; background: #edf0f3; }
    .hours { display: flex; align-items: flex-end; gap: 3px; height: 120px; }
    .hcol { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; min-width: 0; }
    .hcol i { display: block; border-radius: 2px 2px 0 0; background: #9dbfee; min-height: 2px; }
    .hcol i.peak { background: #1267dd; }
    .hcol span { height: 14px; font-size: 11px; color: #8792a0; text-align: center; }
    .note { margin: 8px 0 0; font-size: 12px; color: #667582; }
    .note b { color: #172535; }
    .empty { margin: 0; padding: 20px 0; text-align: center; font-size: 13px; color: #667582; }
    .empty.ok { color: #13875a; font-weight: 600; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; min-width: 720px; border-collapse: collapse; }
    th { padding: 8px 10px; text-align: left; background: #f7f8fa; border-bottom: 1px solid #dfe5ea; color: #627084; font-size: 11px; text-transform: uppercase; }
    td { padding: 8px 10px; border-bottom: 1px solid #edf0f3; font-size: 12px; color: #3a475a; }
    td.detail { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .state { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
    .state i { width: 7px; height: 7px; border-radius: 50%; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  `],
})
export class WanInsightsComponent {
  private readonly exporter = inject(ExportService);
  private readonly toast = inject(ToastService);

  readonly items = input.required<WanNetworkSample[]>();
  readonly intervalMs = input(600000);

  readonly w = W;
  readonly h = H;

  readonly points = computed(() => [...this.items()]
    .map(s => ({ s, t: new Date(s.capturedAt).getTime() }))
    .filter(p => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t));

  readonly firstLabel = computed(() => this.points().length ? fmtDateTime(this.points()[0].t) : '');
  readonly lastLabel = computed(() => this.points().length ? fmtDateTime(this.points()[this.points().length - 1].t) : '');
  readonly rangeText = computed(() => `del ${this.firstLabel()} al ${this.lastLabel()}`);

  readonly traffic = computed(() => {
    const buckets = bucketize(this.points(), 200, p => p.t);
    const avg = (items: typeof buckets[number]['items'], key: 'rxBps' | 'txBps') => items.reduce((sum, p) => sum + (p.s[key] || 0), 0) / items.length / 1e6;
    const rx = buckets.map(b => avg(b.items, 'rxBps'));
    const tx = buckets.map(b => avg(b.items, 'txBps'));
    const peakRx = Math.max(0, ...this.points().map(p => (p.s.rxBps || 0) / 1e6));
    const max = niceMax(Math.max(...rx, ...tx, 0));
    const caps = this.points().map(p => p.s.maxBps || 0).filter(v => v > 0);
    const capacity = caps.length ? caps[caps.length - 1] / 1e6 : 0;
    return {
      rxLine: linePath(rx, max, W, H), rxArea: areaPath(rx, max, W, H), txLine: linePath(tx, max, W, H),
      max, peakRx, capacity,
      peakUtil: Math.max(0, ...this.points().map(p => p.s.utilizationPercent || 0)),
    };
  });

  readonly ping = computed(() => {
    const pts = this.points();
    const buckets = bucketize(pts, 200, p => p.t);
    const values = buckets.map(b => {
      const withPing = b.items.filter(p => p.s.pingAvgMs != null);
      return withPing.length ? withPing.reduce((sum, p) => sum + (p.s.pingAvgMs as number), 0) / withPing.length : 0;
    });
    const measured = pts.filter(p => p.s.pingAvgMs != null);
    const worst = measured.length ? Math.max(...pts.map(p => p.s.pingMaxMs ?? p.s.pingAvgMs ?? 0)) : null;
    const max = niceMax(Math.max(...values, 0));
    const step = buckets.length > 1 ? W / (buckets.length - 1) : 0;
    const loss = buckets
      .map((b, i) => ({ b, i, lossMax: Math.max(0, ...b.items.map(p => p.s.pingLossPercent || 0)) }))
      .filter(x => x.lossMax > 0)
      .map(x => ({ x: +(x.i * step).toFixed(1), label: `${fmtDateTime(x.b.start)}: ${x.lossMax.toFixed(0)} % de pérdida` }));
    return {
      line: measured.length ? linePath(values, max, W, H) : '',
      max,
      avg: measured.length ? measured.reduce((sum, p) => sum + (p.s.pingAvgMs as number), 0) / measured.length : null,
      worst,
      loss,
      lossCount: pts.filter(p => (p.s.pingLossPercent || 0) > 0).length,
    };
  });

  readonly strip = computed(() => bucketize(this.points(), 200, p => p.t).map(b => {
    const state = b.items.reduce<HealthLike>((acc, p) => worstState(acc, p.s.healthState), 'unknown');
    return { state, label: `${fmtDateTime(b.start)}: ${stateLabel(state)}` };
  }));

  readonly hours = computed(() => {
    const sums = Array.from({ length: 24 }, () => ({ total: 0, count: 0 }));
    for (const p of this.points()) {
      const hour = new Date(p.t).getHours();
      sums[hour].total += (p.s.rxBps || 0) / 1e6;
      sums[hour].count += 1;
    }
    const avgs = sums.map(s => s.count ? s.total / s.count : 0);
    const max = Math.max(...avgs, 0) || 1;
    const top = [...avgs].map((v, hour) => ({ v, hour })).sort((a, b) => b.v - a.v).slice(0, 3).filter(x => x.v > 0).map(x => x.hour);
    return avgs.map((v, hour) => ({
      hour, pct: Math.max(1, (v / max) * 100), peak: top.includes(hour), avg: v, count: sums[hour].count,
      label: `${this.hourLabel(hour)}: ${sums[hour].count ? v.toFixed(1) + ' Mbps de promedio' : 'sin lecturas'}`,
    }));
  });

  readonly peakHoursText = computed(() => {
    const peaks = this.hours().filter(h => h.peak).sort((a, b) => b.avg - a.avg);
    return peaks.length ? peaks.map(h => this.hourLabel(h.hour)).join(', ') : '—';
  });

  readonly quietHoursText = computed(() => {
    const quiet = this.hours().filter(h => h.count > 0).sort((a, b) => a.avg - b.avg).slice(0, 2).sort((a, b) => a.hour - b.hour);
    return quiet.length ? quiet.map(h => this.hourLabel(h.hour)).join(' y ') : '—';
  });

  readonly incidents = computed(() => {
    const pts = this.points();
    const eps = buildEpisodes(pts, p => p.t, p => p.s.healthState !== 'stable', p => p.s.healthState, this.intervalMs());
    return eps.reverse().slice(0, 20).map(e => {
      const inside = pts.filter(p => p.t >= e.start && p.t <= e.end && p.s.healthState !== 'stable');
      const losses = inside.map(p => p.s.pingLossPercent).filter((v): v is number => v != null);
      const pings = inside.map(p => p.s.pingMaxMs ?? p.s.pingAvgMs).filter((v): v is number => v != null);
      const reasons = new Set<string>();
      for (const p of inside) {
        if (p.s.healthState === 'offline') reasons.add('sin conexión a Internet');
        if ((p.s.pingLossPercent || 0) > 0 && (p.s.pingLossPercent || 0) < 100) reasons.add('pérdida de paquetes');
        if (p.s.pingLossPercent == null) reasons.add('sin lectura de ping');
        if ((p.s.pingAvgMs || 0) >= 80) reasons.add('ping alto');
        if ((p.s.utilizationPercent || 0) >= 85) reasons.add('enlace saturado');
        if (!p.s.oltConnected) reasons.add('OLT sin conexión');
        if (p.s.errorMessage) reasons.add(p.s.errorMessage);
      }
      return {
        ...e,
        maxLoss: losses.length ? Math.max(...losses) : null,
        maxPing: pings.length ? Math.max(...pings) : null,
        detail: [...reasons].slice(0, 4).join(' · '),
      };
    });
  });

  hourLabel(hour: number): string {
    const suffix = hour < 12 ? 'a. m.' : 'p. m.';
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${h12} ${suffix}`;
  }

  color(state: HealthLike): string { return stateColor(state); }
  label(state: HealthLike): string { return state === 'offline' ? 'Caído' : stateLabel(state); }
  duration(ms: number): string { return formatDuration(ms); }
  when(ms: number): string { return fmtDateTime(ms); }

  exportCsv(): void {
    const rows = this.items();
    if (!rows.length) { this.toast.info('No hay lecturas del enlace para exportar'); return; }
    const mb = (v: number) => Number(((v || 0) / 1e6).toFixed(2));
    this.exporter.exportCSV(rows, 'enlace-internet', [
      { key: 'capturedAt', label: 'Fecha', transform: v => fmtDateTime(new Date(v).getTime()) },
      { key: 'healthState', label: 'Estado', transform: v => this.label(v) },
      { key: 'rxBps', label: 'Bajada Mbps', transform: v => mb(v) },
      { key: 'txBps', label: 'Subida Mbps', transform: v => mb(v) },
      { key: 'utilizationPercent', label: 'Uso del enlace %' },
      { key: 'pingAvgMs', label: 'Ping promedio ms', transform: v => v ?? '' },
      { key: 'pingMaxMs', label: 'Ping máximo ms', transform: v => v ?? '' },
      { key: 'pingLossPercent', label: 'Pérdida %', transform: v => v ?? '' },
      { key: 'clientsOnline', label: 'Clientes en línea' },
      { key: 'clientsOffline', label: 'Clientes fuera de línea' },
      { key: 'oltConnected', label: 'OLT conectada', transform: v => v ? 'Sí' : 'No' },
      { key: 'oltOnlineOnus', label: 'ONUs en línea' },
      { key: 'oltOfflineOnus', label: 'ONUs fuera de línea' },
      { key: 'errorMessage', label: 'Detalle', transform: v => v || '' },
    ]);
    this.toast.success(`Archivo descargado con ${rows.length} lecturas`);
  }
}
