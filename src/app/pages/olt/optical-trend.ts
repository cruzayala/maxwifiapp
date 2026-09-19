import { Component, computed, input } from '@angular/core';
import { LucideMinus, LucideTrendingDown, LucideTrendingUp } from '@lucide/angular';
import type { OltOpticalReading } from '../../services/olt.service';
import { RX_CRITICAL_DBM, RX_WEAK_DBM, formatDateTime, isCriticalPower, isWeakPower, relativeTime, signalLabel } from './olt-helpers';

type TrendVerdict = 'empty' | 'critical' | 'worse' | 'unstable' | 'better' | 'stable';

interface TrendRow {
  reading: OltOpticalReading;
  delta: number | null;
}

const WIDTH = 320;
const HEIGHT = 96;
const PAD_X = 6;
const PAD_Y = 8;

/** Historial óptico legible: tendencia, variación y lecturas recientes. Solo lectura. */
@Component({
  selector: 'app-optical-trend',
  standalone: true,
  imports: [LucideTrendingDown, LucideTrendingUp, LucideMinus],
  template: `
    @if (!sorted().length) {
      <p class="empty">La primera medición se guardará al consultar esta ONU. Pulse «Actualizar» para leerla ahora.</p>
    } @else {
      <div [class]="'verdict ' + verdict()">
        @if (verdict() === 'worse' || verdict() === 'critical') { <svg lucideTrendingDown size="18" aria-hidden="true"></svg> }
        @else if (verdict() === 'better') { <svg lucideTrendingUp size="18" aria-hidden="true"></svg> }
        @else { <svg lucideMinus size="18" aria-hidden="true"></svg> }
        <div><strong>{{ verdictTitle() }}</strong><span>{{ verdictDetail() }}</span></div>
      </div>

      <dl class="stats">
        <div><dt>Actual</dt><dd [class.weak]="weak(stats().current)" [class.critical]="critical(stats().current)">{{ dbm(stats().current) }}</dd></div>
        <div><dt>Mínimo</dt><dd [class.weak]="weak(stats().min)" [class.critical]="critical(stats().min)">{{ dbm(stats().min) }}</dd></div>
        <div><dt>Máximo</dt><dd>{{ dbm(stats().max) }}</dd></div>
        <div><dt>Promedio</dt><dd>{{ dbm(stats().avg) }}</dd></div>
        <div><dt>Variación</dt><dd>{{ signed(stats().delta) }}</dd></div>
        <div><dt>Sin conexión</dt><dd [class.critical]="stats().offline > 0">{{ stats().offline }} de {{ sorted().length }}</dd></div>
      </dl>

      @if (chart(); as c) {
        <svg class="chart" [attr.viewBox]="'0 0 ' + c.width + ' ' + c.height" role="img" [attr.aria-label]="'Tendencia de señal RX: ' + verdictTitle()">
          <rect class="band-weak" [attr.x]="0" [attr.width]="c.width" [attr.y]="c.weakY" [attr.height]="c.criticalY - c.weakY"></rect>
          <rect class="band-critical" [attr.x]="0" [attr.width]="c.width" [attr.y]="c.criticalY" [attr.height]="c.height - c.criticalY"></rect>
          <line class="threshold weak" x1="0" [attr.x2]="c.width" [attr.y1]="c.weakY" [attr.y2]="c.weakY"></line>
          <line class="threshold critical" x1="0" [attr.x2]="c.width" [attr.y1]="c.criticalY" [attr.y2]="c.criticalY"></line>
          @if (c.path) { <polyline class="line" [attr.points]="c.path"></polyline> }
          @for (point of c.points; track point.key) {
            <circle [class]="'point ' + point.tone" [attr.cx]="point.x" [attr.cy]="point.y" [attr.r]="point.last ? 4 : 2.5"><title>{{ point.title }}</title></circle>
          }
          @for (mark of c.offline; track mark.key) {
            <rect class="offline-mark" [attr.x]="mark.x - 1.5" [attr.y]="c.height - 7" width="3" height="7"><title>{{ mark.title }}</title></rect>
          }
        </svg>
        <div class="axis"><span>{{ date(sorted()[0].capturedAt) }}</span><span>{{ date(sorted()[sorted().length - 1].capturedAt) }}</span></div>
        <div class="legend"><span><i class="weak"></i>Débil ≤ {{ weakLimit }} dBm</span><span><i class="critical"></i>Crítica ≤ {{ criticalLimit }} dBm</span>@if (stats().offline) { <span><i class="offline"></i>Sin conexión</span> }</div>
      }

      <div class="rows">
        @for (row of recent(); track row.reading.id) {
          <div>
            <time [title]="date(row.reading.capturedAt)">{{ ago(row.reading.capturedAt) }}</time>
            @if (row.reading.online && row.reading.rxPowerDbm != null) {
              <span class="value" [class.weak]="weak(row.reading.rxPowerDbm)" [class.critical]="critical(row.reading.rxPowerDbm)">{{ dbm(row.reading.rxPowerDbm) }} · {{ label(row.reading.rxPowerDbm) }}</span>
            } @else {
              <span class="value critical">Sin conexión</span>
            }
            <span class="delta" [class.down]="(row.delta ?? 0) <= -0.5" [class.up]="(row.delta ?? 0) >= 0.5">{{ row.delta == null ? '' : signed(row.delta) }}</span>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .empty { margin: 0; padding: 16px; border: 1px dashed #ccd6de; border-radius: 6px; color: #667582; font-size: 12px; text-align: center; }
    .verdict { display: flex; align-items: flex-start; gap: 9px; padding: 10px 11px; border-radius: 6px; background: #e9f8f1; color: #13875a; }
    .verdict > div { display: grid; gap: 2px; }
    .verdict strong { font-size: 13px; }
    .verdict span { color: #334250; font-size: 12px; line-height: 1.4; }
    .verdict.worse, .verdict.unstable { background: #fff6e8; color: #b36b12; }
    .verdict.critical { background: #fff0ef; color: #b42318; }
    .verdict.better { background: #edf4ff; color: #1267dd; }
    .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; margin: 10px 0; overflow: hidden; border: 1px solid #dfe5ea; border-radius: 6px; background: #dfe5ea; }
    .stats div { padding: 7px 9px; background: #f8fafc; }
    .stats dt { color: #667582; font-size: 11px; }
    .stats dd { margin: 2px 0 0; color: #13875a; font: 700 13px ui-monospace, 'Cascadia Mono', Consolas, monospace; }
    .stats dd.weak { color: #b36b12; } .stats dd.critical { color: #b42318; }
    .chart { display: block; width: 100%; height: auto; border: 1px solid #dfe5ea; border-radius: 6px; background: #fff; }
    .band-weak { fill: #fff6e8; } .band-critical { fill: #fff0ef; }
    .threshold { stroke-width: 1; stroke-dasharray: 3 3; } .threshold.weak { stroke: #e0b06a; } .threshold.critical { stroke: #e39a93; }
    .line { fill: none; stroke: #1267dd; stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
    .point { fill: #13875a; stroke: #fff; stroke-width: 1; } .point.warning { fill: #b36b12; } .point.critical { fill: #b42318; }
    .offline-mark { fill: #b42318; }
    .axis { display: flex; justify-content: space-between; margin-top: 4px; color: #667582; font-size: 11px; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; color: #667582; font-size: 11px; }
    .legend span { display: inline-flex; align-items: center; gap: 5px; }
    .legend i { width: 12px; height: 8px; border-radius: 2px; }
    .legend i.weak { background: #fff6e8; border: 1px solid #e0b06a; } .legend i.critical { background: #fff0ef; border: 1px solid #e39a93; } .legend i.offline { width: 4px; background: #b42318; }
    .rows { margin-top: 10px; overflow: hidden; border: 1px solid #dfe5ea; border-radius: 6px; }
    .rows > div { min-height: 34px; display: grid; grid-template-columns: minmax(92px, auto) 1fr auto; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid #eef2f5; font-size: 12px; }
    .rows > div:last-child { border-bottom: 0; }
    .rows time { color: #667582; }
    .value { color: #13875a; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-weight: 700; }
    .value.weak { color: #b36b12; } .value.critical { color: #b42318; }
    .delta { min-width: 52px; color: #667582; font: 600 11px ui-monospace, 'Cascadia Mono', Consolas, monospace; text-align: right; }
    .delta.down { color: #b42318; } .delta.up { color: #13875a; }
    @media (max-width: 480px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `],
})
export class OpticalTrendComponent {
  readonly readings = input<OltOpticalReading[]>([]);
  readonly weakLimit = RX_WEAK_DBM;
  readonly criticalLimit = RX_CRITICAL_DBM;

  readonly sorted = computed(() => [...this.readings()].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime()));
  private readonly measured = computed(() => this.sorted().filter((reading) => reading.online && reading.rxPowerDbm != null));

  readonly stats = computed(() => {
    const values = this.measured().map((reading) => Number(reading.rxPowerDbm));
    const offline = this.sorted().filter((reading) => !reading.online).length;
    if (!values.length) return { current: null, min: null, max: null, avg: null, delta: null, swing: 0, offline };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10;
    const delta = values.length > 1 ? Math.round((values[values.length - 1] - values[0]) * 10) / 10 : null;
    return { current: values[values.length - 1], min, max, avg, delta, swing: Math.round((max - min) * 10) / 10, offline };
  });

  readonly verdict = computed<TrendVerdict>(() => {
    const stats = this.stats();
    if (stats.current == null) return 'empty';
    if (isCriticalPower(stats.current)) return 'critical';
    if (stats.delta != null && stats.delta <= -1.5) return 'worse';
    if (stats.swing >= 3 || stats.offline >= 2) return 'unstable';
    if (stats.delta != null && stats.delta >= 1.5) return 'better';
    return 'stable';
  });

  readonly recent = computed<TrendRow[]>(() => {
    const rows = this.sorted();
    return rows.map((reading, index): TrendRow => {
      const previous = rows.slice(0, index).reverse().find((item) => item.online && item.rxPowerDbm != null);
      const measured = reading.online && reading.rxPowerDbm != null;
      const delta = measured && previous ? Math.round((Number(reading.rxPowerDbm) - Number(previous.rxPowerDbm)) * 10) / 10 : null;
      return { reading, delta };
    }).reverse().slice(0, 8);
  });

  readonly chart = computed(() => {
    const rows = this.sorted();
    if (!rows.length) return null;
    const values = this.measured().map((reading) => Number(reading.rxPowerDbm));
    const top = Math.max(...values, RX_WEAK_DBM + 4) + 1;
    const bottom = Math.min(...values, RX_CRITICAL_DBM - 1) - 1;
    const x = (index: number) => rows.length === 1 ? WIDTH / 2 : PAD_X + (index / (rows.length - 1)) * (WIDTH - PAD_X * 2);
    const y = (value: number) => PAD_Y + ((top - value) / (top - bottom)) * (HEIGHT - PAD_Y * 2);
    const points = rows.map((reading, index) => ({ reading, index }))
      .filter(({ reading }) => reading.online && reading.rxPowerDbm != null)
      .map(({ reading, index }, position, all) => {
        const value = Number(reading.rxPowerDbm);
        return {
          key: reading.id,
          x: Math.round(x(index) * 10) / 10,
          y: Math.round(y(value) * 10) / 10,
          tone: isCriticalPower(value) ? 'critical' : isWeakPower(value) ? 'warning' : 'good',
          last: position === all.length - 1,
          title: `${formatDateTime(reading.capturedAt)}: ${value} dBm`,
        };
      });
    const offline = rows.map((reading, index) => ({ reading, index }))
      .filter(({ reading }) => !reading.online)
      .map(({ reading, index }) => ({ key: reading.id, x: x(index), title: `${formatDateTime(reading.capturedAt)}: sin conexión` }));
    return {
      width: WIDTH,
      height: HEIGHT,
      weakY: Math.round(y(RX_WEAK_DBM) * 10) / 10,
      criticalY: Math.round(y(RX_CRITICAL_DBM) * 10) / 10,
      path: points.length > 1 ? points.map((point) => `${point.x},${point.y}`).join(' ') : '',
      points,
      offline,
    };
  });

  verdictTitle() {
    const stats = this.stats();
    switch (this.verdict()) {
      case 'empty': return 'Sin lecturas de señal en línea';
      case 'critical': return 'Señal crítica ahora';
      case 'worse': return `Empeoró ${Math.abs(stats.delta || 0)} dB en el período`;
      case 'unstable': return stats.swing >= 3 ? `Inestable: varía ${stats.swing} dB` : `Con desconexiones: ${stats.offline} lecturas sin conexión`;
      case 'better': return `Mejoró ${stats.delta} dB en el período`;
      default: return 'Señal estable';
    }
  }

  verdictDetail() {
    const count = this.sorted().length;
    const since = relativeTime(this.sorted()[0]?.capturedAt);
    switch (this.verdict()) {
      case 'empty': return `Las ${count} lecturas guardadas fueron con la ONU sin conexión.`;
      case 'critical': return 'Por debajo de -30 dBm el servicio puede cortarse. Revise acometida, conectores y empalmes.';
      case 'worse': return 'La potencia viene bajando: limpie conectores y revise curvaturas o golpes en la fibra.';
      case 'unstable': return 'Cambios bruscos suelen indicar conector flojo, fibra doblada o problemas de energía en casa del cliente.';
      case 'better': return `Comparado con la primera lectura (${since}).`;
      default: return `${count} lecturas desde ${since}; sin cambios importantes.`;
    }
  }

  weak(value?: number | null) { return isWeakPower(value) && !isCriticalPower(value); }
  critical(value?: number | null) { return isCriticalPower(value); }
  dbm(value?: number | null) { return value == null ? '--' : `${value} dBm`; }
  label(value?: number | null) { return signalLabel(value); }
  signed(value?: number | null) { return value == null ? '--' : `${value > 0 ? '+' : ''}${value} dB`; }
  date(value?: string | null) { return formatDateTime(value); }
  ago(value?: string | null) { return relativeTime(value); }
}
