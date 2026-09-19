import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideEye, LucideRadioTower, LucideUserRound } from '@lucide/angular';
import { OltOnu } from '../../services/olt.service';
import { CopyValueComponent } from './copy-value';
import {
  formatDateTime, formatDbm, isCriticalPower, isWeakPower, onuDisplayName, onuHealthState,
  onuStatusLabel, relativeTime, signalLabel,
} from './olt-helpers';

export type OnuViewMode = 'list' | 'cards' | 'grid' | 'pon' | 'signal';

interface OnuGroup {
  key: string;
  title: string;
  subtitle: string;
  tone: 'ok' | 'warn' | 'danger' | 'muted';
  onus: OltOnu[];
}

/**
 * Vistas alternativas del inventario de ONUs (tarjetas, mosaico, por PON y por señal).
 * La vista de lista vive en olt.html para reutilizar los estilos de tabla de la página.
 * Solo presentación: recibe las ONUs ya filtradas y avisa cuál abrir.
 */
@Component({
  selector: 'app-onu-views',
  standalone: true,
  imports: [RouterLink, CopyValueComponent, LucideEye, LucideRadioTower, LucideUserRound],
  template: `
    @switch (view()) {
      @case ('cards') {
        @if (!rows().length) { <div class="views-empty">{{ emptyText() }}</div> }
        <div class="onu-cards">
          @for (onu of rows(); track onu.id) {
            <article class="onu-card" [class]="'onu-card ' + health(onu)" (dblclick)="inspect.emit(onu)">
              <header>
                <span class="card-state" [class]="'card-state ' + health(onu)"></span>
                <div class="card-title">
                  @if (onu.clientIdServicio) { <a [routerLink]="['/clients', onu.clientIdServicio]" title="Abrir expediente del cliente">{{ displayName(onu) }}</a> }
                  @else { <strong>{{ onu.name || 'Sin asociar' }}</strong> }
                  <small>PON {{ onu.pon }} · <span class="mono">{{ onu.onuIndex }}</span></small>
                </div>
                <span class="card-status">{{ statusLabel(onu) }}</span>
              </header>
              <div class="card-signal">
                <div class="signal-bar" [class]="'signal-bar ' + signalTone(onu)" [title]="signalText(onu.rxPowerDbm)"><i [style.width.%]="signalPercent(onu.rxPowerDbm)"></i></div>
                <b class="mono">{{ onu.rxPowerDbm != null ? dbm(onu.rxPowerDbm) : 'Sin lectura' }}</b>
              </div>
              <dl class="card-facts">
                <div><dt>Modelo</dt><dd>{{ onu.model || '—' }}</dd></div>
                <div><dt>Serial</dt><dd><app-copy-value [value]="onu.serial" label="serial" /></dd></div>
                @if (onu.client?.ip) { <div><dt>IP</dt><dd class="mono">{{ onu.client?.ip }}</dd></div> }
                <div><dt>Última lectura</dt><dd>{{ ago(onu.lastDetailAt || onu.lastSeenAt) }}</dd></div>
              </dl>
              <footer>
                @if (onu.clientIdServicio) { <a class="card-link" [routerLink]="['/clients', onu.clientIdServicio]"><svg lucideUserRound size="14"></svg>Expediente</a> }
                @else { <span class="card-warn">Sin cliente asociado</span> }
                <button class="secondary-action compact-action" type="button" (click)="inspect.emit(onu)"><svg lucideEye size="15"></svg>Abrir</button>
              </footer>
            </article>
          }
        </div>
      }

      @case ('grid') {
        @if (!rows().length) { <div class="views-empty">{{ emptyText() }}</div> }
        <div class="onu-mosaic">
          @for (onu of rows(); track onu.id) {
            <button type="button" class="mosaic-tile" [class]="'mosaic-tile ' + health(onu)" (click)="inspect.emit(onu)"
              [title]="displayName(onu) + ' · ' + onu.onuIndex + ' · ' + statusLabel(onu) + (onu.rxPowerDbm != null ? ' · ' + dbm(onu.rxPowerDbm) : '')">
              <span class="tile-name">{{ displayName(onu) }}</span>
              <small>PON {{ onu.pon }}@if (onu.rxPowerDbm != null) { · {{ dbm(onu.rxPowerDbm) }} }</small>
            </button>
          }
        </div>
        <p class="views-note">Cada cuadro es una ONU. Verde: señal buena · ámbar: débil · rojo: crítica o sin conexión. Clic para abrir su diagnóstico.</p>
      }

    }

    @if (view() === 'pon' || view() === 'signal') {
      @if (!rows().length) { <div class="views-empty">{{ emptyText() }}</div> }
      <div class="onu-groups">
        @for (group of groups(); track group.key) {
          <section class="onu-group" [class]="'onu-group ' + group.tone">
            <header>
              <div><span class="group-icon"><svg lucideRadioTower size="16"></svg></span><strong>{{ group.title }}</strong><small>{{ group.subtitle }}</small></div>
              <b>{{ group.onus.length }}</b>
            </header>
            <div class="group-rows">
              @for (onu of group.onus; track onu.id) {
                <button type="button" class="group-row" (click)="inspect.emit(onu)" [title]="'Abrir ' + onu.onuIndex">
                  <span class="row-state" [class]="'row-state ' + health(onu)"></span>
                  <span class="row-name">{{ displayName(onu) }}</span>
                  <small class="mono">{{ onu.onuIndex }}</small>
                  <b class="mono" [class]="signalTone(onu)">{{ onu.rxPowerDbm != null ? dbm(onu.rxPowerDbm) : '—' }}</b>
                </button>
              }
            </div>
          </section>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .views-empty { padding: 26px 16px; text-align: center; color: #667582; font-size: 13px; }
    .views-note { margin: 10px 0 0; color: #667582; font-size: 12px; }
    .mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; }

    /* Tarjetas */
    .onu-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: 10px; }
    .onu-card { min-width: 0; display: grid; gap: 9px; padding: 12px 13px; border: 1px solid #dce4e8; border-left: 4px solid #1f8a5f; border-radius: 8px; background: #fff; }
    .onu-card.warning { border-left-color: #d08a1a; }
    .onu-card.critical { border-left-color: #b42318; }
    .onu-card.offline { border-left-color: #8b97a3; background: #fbfcfc; }
    .onu-card > header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 8px; }
    .card-state { width: 9px; height: 9px; margin-top: 5px; border-radius: 50%; background: #1f8a5f; }
    .card-state.warning { background: #d08a1a; } .card-state.critical { background: #b42318; } .card-state.offline { background: #8b97a3; }
    .card-title { min-width: 0; display: grid; }
    .card-title a, .card-title strong { color: #172535; font-size: 14px; font-weight: 700; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card-title a:hover { color: #1267dd; text-decoration: underline; }
    .card-title small { color: #66787f; font-size: 11px; }
    .card-status { color: #66787f; font-size: 11px; white-space: nowrap; }
    .card-signal { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; }
    .signal-bar { height: 7px; border-radius: 4px; background: #e9eef1; overflow: hidden; }
    .signal-bar i { display: block; height: 100%; background: #1f8a5f; }
    .signal-bar.warning i { background: #d08a1a; } .signal-bar.critical i { background: #b42318; } .signal-bar.none i { background: #c3ccd3; }
    .card-signal b { color: #223240; font-size: 13px; }
    .card-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; margin: 0; }
    .card-facts div { min-width: 0; }
    .card-facts dt { color: #7d8c95; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .card-facts dd { margin: 1px 0 0; color: #223240; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .onu-card > footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 8px; border-top: 1px solid #eef2f4; }
    .card-link { display: inline-flex; align-items: center; gap: 5px; color: #1267dd; font-size: 12px; font-weight: 700; text-decoration: none; }
    .card-link:hover { text-decoration: underline; }
    .card-warn { color: #9a5b0f; font-size: 12px; }

    /* Mosaico compacto */
    .onu-mosaic { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 6px; }
    .mosaic-tile { min-width: 0; display: grid; gap: 2px; padding: 7px 8px; border: 1px solid #cfe3d8; border-radius: 6px; background: #f2faf6; color: #166246; text-align: left; cursor: pointer; }
    .mosaic-tile:hover { outline: 2px solid #1267dd; outline-offset: 1px; }
    .mosaic-tile.warning { border-color: #ecd6a7; background: #fff8ec; color: #8a5a10; }
    .mosaic-tile.critical { border-color: #f0bdb7; background: #fff3f2; color: #a3241a; }
    .mosaic-tile.offline { border-color: #d7dde2; background: #f4f6f8; color: #5d6a75; }
    .tile-name { font-size: 12px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mosaic-tile small { font-size: 10px; opacity: .85; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; }

    /* Agrupado */
    .onu-groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; align-items: start; }
    .onu-group { border: 1px solid #dce4e8; border-top: 3px solid #1f8a5f; border-radius: 8px; background: #fff; overflow: hidden; }
    .onu-group.warn { border-top-color: #d08a1a; } .onu-group.danger { border-top-color: #b42318; } .onu-group.muted { border-top-color: #9aa6b0; }
    .onu-group > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 12px; border-bottom: 1px solid #eef2f4; background: #f7fafb; }
    .onu-group > header > div { display: flex; align-items: center; gap: 7px; min-width: 0; }
    .group-icon { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 6px; background: #e7f3ee; color: #1f6b72; }
    .onu-group strong { color: #172535; font-size: 13px; }
    .onu-group small { color: #66787f; font-size: 11px; }
    .onu-group > header b { color: #223240; font-size: 15px; }
    .group-rows { max-height: 320px; overflow-y: auto; }
    .group-row { width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 8px; padding: 7px 12px; border: 0; border-bottom: 1px solid #f2f5f7; background: #fff; text-align: left; cursor: pointer; }
    .group-row:last-child { border-bottom: 0; }
    .group-row:hover { background: #f4f9ff; }
    .row-state { width: 8px; height: 8px; border-radius: 50%; background: #1f8a5f; }
    .row-state.warning { background: #d08a1a; } .row-state.critical { background: #b42318; } .row-state.offline { background: #8b97a3; }
    .row-name { color: #223240; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .group-row small { color: #7d8c95; font-size: 11px; }
    .group-row b { font-size: 12px; color: #223240; }
    .group-row b.warning { color: #8a5a10; } .group-row b.critical { color: #a3241a; } .group-row b.offline, .group-row b.none { color: #7d8c95; }

    @media (max-width: 640px) {
      .onu-cards, .onu-groups { grid-template-columns: 1fr; }
      .onu-mosaic { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
    }
  `],
})
export class OnuViewsComponent {
  readonly rows = input.required<OltOnu[]>();
  readonly view = input<OnuViewMode>('list');
  readonly emptyText = input('No hay ONUs para estos filtros.');
  readonly inspect = output<OltOnu>();

  readonly groups = computed<OnuGroup[]>(() => this.view() === 'signal' ? this.signalGroups() : this.ponGroups());

  health(onu: OltOnu) { return onuHealthState(onu); }
  statusLabel(onu: OltOnu) { return onuStatusLabel(onu); }
  displayName(onu: OltOnu) { return onuDisplayName(onu); }
  signalText(value?: number | null) { return signalLabel(value); }
  dbm(value?: number | null) { return formatDbm(value); }
  date(value?: string | Date | null) { return formatDateTime(value); }
  ago(value?: string | Date | null) { return relativeTime(value); }

  signalTone(onu: OltOnu): string {
    if (onu.rxPowerDbm == null) return 'none';
    if (isCriticalPower(onu.rxPowerDbm)) return 'critical';
    return isWeakPower(onu.rxPowerDbm) ? 'warning' : 'ok';
  }

  /** -18 dBm o mejor = 100 %; -30 dBm o peor = 0 %. Solo para la barra. */
  signalPercent(value?: number | null): number {
    if (value == null) return 0;
    return Math.max(4, Math.min(100, Math.round(((value + 30) / 12) * 100)));
  }

  private ponGroups(): OnuGroup[] {
    const map = new Map<number, OltOnu[]>();
    for (const onu of this.rows()) {
      const list = map.get(onu.pon) ?? [];
      list.push(onu);
      map.set(onu.pon, list);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([pon, onus]) => {
        const offline = onus.filter((o) => !o.online).length;
        const bad = onus.filter((o) => o.online && isWeakPower(o.rxPowerDbm)).length;
        return {
          key: `pon-${pon}`,
          title: `PON ${pon}`,
          subtitle: `${onus.length - offline} en línea${offline ? ` · ${offline} sin conexión` : ''}${bad ? ` · ${bad} con señal baja` : ''}`,
          tone: offline > 0 ? 'danger' : bad > 0 ? 'warn' : 'ok',
          onus: [...onus].sort((a, b) => Number(a.online) - Number(b.online) || (a.rxPowerDbm ?? 0) - (b.rxPowerDbm ?? 0)),
        } as OnuGroup;
      });
  }

  private signalGroups(): OnuGroup[] {
    const definitions: { key: string; title: string; subtitle: string; tone: OnuGroup['tone']; test: (o: OltOnu) => boolean }[] = [
      { key: 'offline', title: 'Sin conexión', subtitle: 'No responden a la OLT', tone: 'muted', test: (o) => !o.online },
      { key: 'critical', title: 'Señal crítica', subtitle: '-30 dBm o peor: atender primero', tone: 'danger', test: (o) => o.online && isCriticalPower(o.rxPowerDbm) },
      { key: 'weak', title: 'Señal débil', subtitle: 'Entre -27 y -30 dBm', tone: 'warn', test: (o) => o.online && isWeakPower(o.rxPowerDbm) && !isCriticalPower(o.rxPowerDbm) },
      { key: 'good', title: 'Señal buena', subtitle: 'Mejor que -27 dBm', tone: 'ok', test: (o) => o.online && o.rxPowerDbm != null && !isWeakPower(o.rxPowerDbm) },
      { key: 'unknown', title: 'Sin lectura', subtitle: 'En línea pero sin medición óptica', tone: 'muted', test: (o) => o.online && o.rxPowerDbm == null },
    ];
    return definitions
      .map((definition) => ({
        key: definition.key,
        title: definition.title,
        subtitle: definition.subtitle,
        tone: definition.tone,
        onus: this.rows().filter(definition.test).sort((a, b) => (a.rxPowerDbm ?? 99) - (b.rxPowerDbm ?? 99)),
      }))
      .filter((group) => group.onus.length > 0);
  }
}
