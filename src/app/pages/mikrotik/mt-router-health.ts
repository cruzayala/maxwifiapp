import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LucideCircleAlert, LucideCircleCheck, LucideClock, LucideCpu, LucideServer, LucideThermometer, LucideZap } from '@lucide/angular';
import { MtSystem } from '../../services/mikrotik.service';
import { HealthLevel, HealthMetric, evaluateRouterHealth, formatDuration } from './mt-utils';

/** Panel de salud del router: medidores y semáforo calculados con /mikrotik/system (solo lectura). */
@Component({
  selector: 'app-mt-router-health',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideCircleAlert, LucideCircleCheck, LucideClock, LucideCpu, LucideServer, LucideThermometer, LucideZap],
  host: { class: 'panel mt-health' },
  template: `
    <header>
      <div>
        <span class="section-icon"><svg lucideServer size="18" aria-hidden="true"></svg></span>
        <div><h2>Salud del router</h2><p>{{ health().board }} · RouterOS {{ health().version }}</p></div>
      </div>
      <span class="semaphore" [class]="health().level">
        @if (health().level === 'ok') { <svg lucideCircleCheck size="14" aria-hidden="true"></svg> } @else { <svg lucideCircleAlert size="14" aria-hidden="true"></svg> }
        {{ health().label }}
      </span>
    </header>

    @if (!hasData()) {
      <div class="empty"><svg lucideCpu size="22" aria-hidden="true"></svg><span>El router aún no envía datos de recursos. Se actualizan solos cada pocos segundos.</span></div>
    } @else {
      <div class="gauges">
        @for (metric of gauges(); track metric.label) {
          <div class="gauge" [class]="metric.level" [attr.aria-label]="metric.label + ': ' + metric.display + ', ' + levelText(metric.level)">
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <circle class="track" cx="32" cy="32" r="26"></circle>
              <circle class="fill" cx="32" cy="32" r="26" [attr.stroke-dasharray]="dash(metric)"></circle>
            </svg>
            <strong>{{ metric.display }}</strong>
            <span>{{ metric.label }}</span>
            <small>{{ metric.detail }}</small>
          </div>
        }
      </div>

      @if (health().reasons.length) {
        <ul class="reasons">
          @for (reason of health().reasons; track reason) { <li><svg lucideCircleAlert size="13" aria-hidden="true"></svg>{{ reason }}</li> }
        </ul>
      }

      @if (health().sensors.length) {
        <div class="sensors" aria-label="Sensores del equipo">
          @for (sensor of health().sensors; track sensor.key) {
            <span class="sensor" [class]="sensor.level" [title]="sensor.label + ': ' + sensor.display">
              @if (sensor.kind === 'temperature') { <svg lucideThermometer size="13" aria-hidden="true"></svg> } @else { <svg lucideZap size="13" aria-hidden="true"></svg> }
              <em>{{ sensor.label }}</em><b>{{ sensor.display }}</b>
            </span>
          }
        </div>
      } @else {
        <p class="note">Este modelo no informa temperatura ni voltaje.</p>
      }

      <dl class="facts">
        <div><dt><svg lucideClock size="13" aria-hidden="true"></svg>Encendido</dt><dd>{{ uptimeText() }}</dd></div>
        <div><dt>Arquitectura</dt><dd>{{ health().architecture }}</dd></div>
        @if (health().cpuInfo) { <div><dt>Procesador</dt><dd>{{ health().cpuInfo }}</dd></div> }
      </dl>
    }
  `,
  styles: [`
    :host { display: block; }
    .semaphore { display: inline-flex; align-items: center; gap: 5px; min-height: 24px; padding: 0 9px; border-radius: 12px; font-size: 12px; font-weight: 750; white-space: nowrap; }
    .semaphore.ok { color: #0f7a53; background: #e9f8f1; }
    .semaphore.warn { color: #b36b12; background: #fff6e8; }
    .semaphore.crit { color: #b42318; background: #fff0ef; }
    .semaphore.none { color: #56665e; background: #eef1f5; }
    .empty { display: flex; align-items: center; gap: 10px; padding: 22px 16px; color: #56665e; font-size: 12px; }
    .gauges { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; padding: 14px 12px 6px; }
    .gauge { position: relative; display: flex; flex-direction: column; align-items: center; min-width: 0; text-align: center; }
    .gauge svg { width: 76px; height: 76px; transform: rotate(-90deg); }
    .gauge circle { fill: none; stroke-width: 7; }
    .gauge .track { stroke: #e8ede8; }
    .gauge .fill { stroke: #2b7c9f; stroke-linecap: round; transition: stroke-dasharray .4s ease; }
    .gauge.ok .fill { stroke: #0f7a53; }
    .gauge.warn .fill { stroke: #d08a1c; }
    .gauge.crit .fill { stroke: #b42318; }
    .gauge strong { position: absolute; top: 30px; left: 0; right: 0; color: #15211c; font-size: 15px; line-height: 1; }
    .gauge span { margin-top: 4px; color: #2d3b34; font-size: 12px; font-weight: 700; }
    .gauge small { max-width: 100%; color: #56665e; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gauge.warn span { color: #b36b12; }
    .gauge.crit span { color: #b42318; }
    .reasons { margin: 8px 14px 0; padding: 8px 10px; list-style: none; border-radius: 9px; background: #fff6e8; }
    .reasons li { display: flex; align-items: center; gap: 6px; color: #8a520e; font-size: 12px; line-height: 1.6; }
    .sensors { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 14px 4px; }
    .sensor { display: inline-flex; align-items: center; gap: 5px; min-height: 26px; padding: 0 8px; border: 1px solid #e0e6e1; border-radius: 9px; color: #2d3b34; font-size: 12px; }
    .sensor em { color: #56665e; font-style: normal; }
    .sensor b { font-weight: 750; }
    .sensor.ok { border-color: #bfe6d3; }
    .sensor.warn { border-color: #efc98a; background: #fff6e8; color: #b36b12; }
    .sensor.crit { border-color: #f1b8b3; background: #fff0ef; color: #b42318; }
    .note { margin: 10px 14px 0; color: #56665e; font-size: 11px; }
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px 12px; margin: 10px 0 0; padding: 11px 14px 13px; border-top: 1px solid #edf0f4; }
    .facts div { min-width: 0; }
    .facts dt { display: flex; align-items: center; gap: 4px; color: #56665e; font-size: 11px; font-weight: 650; }
    .facts dd { margin: 2px 0 0; color: #15211c; font-size: 12px; font-weight: 700; overflow-wrap: anywhere; }
    @media (prefers-reduced-motion: reduce) { .gauge .fill { transition: none; } }
  `],
})
export class MtRouterHealthComponent {
  readonly system = input<MtSystem | null>(null);

  readonly health = computed(() => evaluateRouterHealth(this.system()));
  readonly hasData = computed(() => Object.keys(this.system()?.resource || {}).length > 0);
  readonly gauges = computed(() => [this.health().cpu, this.health().memory, this.health().disk]);
  readonly uptimeText = computed(() => formatDuration(this.health().uptimeSeconds));

  private readonly circumference = 2 * Math.PI * 26;

  dash(metric: HealthMetric): string {
    const pct = Math.max(0, Math.min(100, metric.value ?? 0));
    const filled = (pct / 100) * this.circumference;
    return `${filled.toFixed(1)} ${this.circumference.toFixed(1)}`;
  }

  levelText(level: HealthLevel): string {
    return { ok: 'normal', warn: 'revisar', crit: 'crítico', none: 'sin datos' }[level];
  }
}
