import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideActivity, LucideArrowDown, LucideArrowUp, LucideChevronDown, LucideChevronRight, LucideCircleCheck,
  LucideGlobe, LucideMapPin, LucideRadioTower, LucideRefreshCw, LucideRouter, LucideSiren,
  LucideTriangleAlert, LucideUsers,
} from '@lucide/angular';
import { firstValueFrom, timeout } from 'rxjs';
import { NavbarComponent } from '../../components/layout/navbar';
import { formatPlanName } from '../../pipes/plan-label.pipe';
import { MikrotikService, MtLiveClient, MtLiveResponse, MtStatus, MtSystem } from '../../services/mikrotik.service';
import { NetworkAuditService, NetworkAuditStatus } from '../../services/network-audit.service';
import { NocIncident, NocService, NocSummary } from '../../services/noc.service';
import { OltPon, OltService, OltSignalAlert, OltStatus } from '../../services/olt.service';
import { PingToolComponent } from './ping-tool';

interface WanTraffic { ifaceName: string; rxBps: number; txBps: number; maxBps: number; degraded?: boolean }
type Tone = 'ok' | 'warn' | 'danger' | 'muted';
interface Issue { tone: 'warn' | 'danger'; text: string; link: string; queryParams?: Record<string, string> }

const REFRESH_MS = 120_000;

/**
 * Centro de red: salud de toda la infraestructura en una pantalla (MikroTik, enlace a internet,
 * OLT/PON, clientes en línea, incidentes). Solo lectura: usa los mismos endpoints que el Dashboard.
 */
@Component({
  selector: 'app-network-monitor',
  standalone: true,
  imports: [
    NavbarComponent, RouterLink, DecimalPipe, PingToolComponent,
    LucideActivity, LucideArrowDown, LucideArrowUp, LucideChevronDown, LucideChevronRight, LucideCircleCheck,
    LucideGlobe, LucideMapPin, LucideRadioTower, LucideRefreshCw, LucideRouter, LucideSiren,
    LucideTriangleAlert, LucideUsers,
  ],
  template: `
    <app-navbar pageTitle="Centro de red" />

    <div class="page">
      <header class="hub-head">
        <div>
          <span class="eyebrow">Red e infraestructura</span>
          <h1>Estado de la red</h1>
          <p>{{ lastUpdated() ? 'Actualizado ' + relative(lastUpdated()!.toISOString()) + ' · se renueva solo cada 2 min' : 'Consultando MikroTik, OLT e incidentes…' }}</p>
        </div>
        <button type="button" class="btn btn-outline" (click)="load()" [disabled]="refreshing()"><svg lucideRefreshCw size="16" [class.spinning]="refreshing()"></svg>{{ refreshing() ? 'Actualizando…' : 'Actualizar' }}</button>
      </header>

      @if (loading()) {
        <div class="skeleton-grid" aria-busy="true" aria-label="Cargando estado de la red">@for (n of [1,2,3,4,5]; track n) { <i></i> }</div>
      } @else {
        <!-- VEREDICTO GENERAL -->
        <section class="verdict" [class]="'verdict ' + verdictTone()" role="status">
          @if (issues().length === 0) {
            <svg lucideCircleCheck size="26"></svg>
            <div><strong>Todo en orden</strong><p>Router, OLT y enlace a internet responden sin alertas.</p></div>
          } @else {
            <svg lucideTriangleAlert size="26"></svg>
            <div>
              <strong>{{ issues().length === 1 ? 'Hay 1 punto que revisar' : 'Hay ' + issues().length + ' puntos que revisar' }}</strong>
              <ul>
                @for (issue of issues(); track issue.text) {
                  <li [class]="issue.tone"><a [routerLink]="issue.link" [queryParams]="issue.queryParams ?? null">{{ issue.text }}<svg lucideChevronRight size="14"></svg></a></li>
                }
              </ul>
            </div>
          }
          @if (sourceErrors().length) { <small class="partial">No se pudo leer: {{ sourceErrors().join(', ') }}.</small> }
        </section>

        <!-- SISTEMAS -->
        <section class="systems" aria-label="Sistemas">
          <a class="sys-card" routerLink="/mikrotik" [class]="'sys-card ' + routerTone()">
            <header><span class="sys-icon"><svg lucideRouter size="18"></svg></span><strong>Router MikroTik</strong><em>{{ routerLabel() }}</em></header>
            @if (mikrotik()?.connected) {
              <div class="meters">
                <div class="meter"><span>CPU</span><b>{{ cpu() ?? '—' }}@if (cpu() !== null) {%}</b><i><u [style.width.%]="cpu() ?? 0" [class]="meterTone(cpu())"></u></i></div>
                <div class="meter"><span>Memoria</span><b>{{ memory() ?? '—' }}@if (memory() !== null) {%}</b><i><u [style.width.%]="memory() ?? 0" [class]="meterTone(memory())"></u></i></div>
              </div>
              <footer>
                <span>Encendido {{ uptime() }}</span>
                @if (temperature() !== null) { <span [class.hot]="temperature()! >= 70">{{ temperature() }} °C</span> }
                @if (version()) { <span>RouterOS {{ version() }}</span> }
              </footer>
            } @else {
              <p class="sys-empty">{{ mikrotik()?.error || 'Sin conexión con el router.' }}</p>
            }
          </a>

          <a class="sys-card" routerLink="/auditoria-red" [class]="'sys-card ' + wanTone()">
            <header><span class="sys-icon"><svg lucideGlobe size="18"></svg></span><strong>Enlace a internet</strong><em>{{ wan()?.ifaceName || 'WAN' }}</em></header>
            @if (wan(); as w) {
              @if (w.degraded && !mikrotik()?.connected) { <p class="sys-empty">Sin lectura: el router no responde.</p> } @else {
              <div class="wan-values">
                <div><svg lucideArrowDown size="15"></svg><b>{{ mbps(w.rxBps) }}</b><span>Mbps bajada</span></div>
                <div><svg lucideArrowUp size="15"></svg><b>{{ mbps(w.txBps) }}</b><span>Mbps subida</span></div>
              </div>
              <div class="meter wide"><span>Uso del enlace</span><b>{{ wanPct() }}%</b><i><u [style.width.%]="wanPct()" [class]="meterTone(wanPct())"></u></i></div>
              <footer><span>Capacidad {{ mbps(w.maxBps) }} Mbps</span>@if (w.degraded) { <span class="hot">Enlace degradado</span> }</footer>
              }
            } @else {
              <p class="sys-empty">Sin lectura del tráfico de internet.</p>
            }
          </a>

          <a class="sys-card" routerLink="/olt" [class]="'sys-card ' + oltTone()">
            <header><span class="sys-icon"><svg lucideRadioTower size="18"></svg></span><strong>Fibra (OLT)</strong><em>{{ olt()?.connected ? 'Conectada' : olt()?.enabled === false ? 'Desactivada · datos guardados' : 'Sin conexión · datos guardados' }}</em></header>
            @if (olt(); as o) {
              <div class="big-number"><b>{{ o.totals.onlineOnus }}</b><span>de {{ o.totals.totalOnus }} ONUs en línea</span></div>
              <div class="meter wide"><span>En línea</span><b>{{ pct(o.totals.onlineOnus, o.totals.totalOnus) }}%</b><i><u [style.width.%]="pct(o.totals.onlineOnus, o.totals.totalOnus)" [class]="pct(o.totals.onlineOnus, o.totals.totalOnus) >= 95 ? 'ok' : pct(o.totals.onlineOnus, o.totals.totalOnus) >= 85 ? 'warn' : 'danger'"></u></i></div>
              <footer><span>{{ o.totals.offlineOnus }} {{ o.totals.offlineOnus === 1 ? 'caída' : 'caídas' }}</span><span>{{ o.totals.activeAlarms }} {{ o.totals.activeAlarms === 1 ? 'alarma' : 'alarmas' }}</span><span>{{ signalAlerts().length }} de señal</span></footer>
            } @else {
              <p class="sys-empty">Sin datos de la OLT.</p>
            }
          </a>

          <a class="sys-card" routerLink="/live" [class]="'sys-card ' + clientsTone()">
            <header><span class="sys-icon"><svg lucideUsers size="18"></svg></span><strong>Clientes</strong><em>según tráfico real</em></header>
            @if (live(); as l) {
              <div class="big-number"><b>{{ l.stats.onlineClients }}</b><span>de {{ l.stats.activeClients }} activos en línea</span></div>
              <div class="meter wide"><span>Conectados</span><b>{{ pct(l.stats.onlineClients, l.stats.activeClients) }}%</b><i><u [style.width.%]="pct(l.stats.onlineClients, l.stats.activeClients)" [class]="clientsTone()"></u></i></div>
              <footer><span>{{ offlineActive().length }} activos sin conexión</span><span>{{ l.stats.transmittingClients }} con tráfico</span></footer>
            } @else {
              <p class="sys-empty">Sin datos del MikroTik.</p>
            }
          </a>

          <a class="sys-card" routerLink="/incidents" [class]="'sys-card ' + nocTone()">
            <header><span class="sys-icon"><svg lucideSiren size="18"></svg></span><strong>Incidentes</strong><em>Centro NOC</em></header>
            @if (noc(); as n) {
              <div class="big-number"><b>{{ n.active }}</b><span>{{ n.active === 1 ? 'incidente activo' : 'incidentes activos' }}</span></div>
              <footer><span [class.hot]="n.critical > 0">{{ n.critical }} críticos</span><span>{{ n.affectedClients }} clientes afectados</span><span>{{ n.last24h }} en 24 h</span></footer>
            } @else {
              <p class="sys-empty">Sin datos del Centro NOC.</p>
            }
          </a>
        </section>

        <div class="panels">
          <!-- ZONAS CON CLIENTES CAÍDOS: pista de una avería de zona -->
          <section class="panel">
            <header class="panel-head"><div><span class="eyebrow">Posibles averías</span><h2>Clientes activos sin conexión</h2></div><a routerLink="/live" class="panel-link">Ver en vivo <svg lucideChevronRight size="14"></svg></a></header>
            @if (!live()) {
              <p class="panel-empty">Sin datos del MikroTik.</p>
            } @else if (offlineActive().length === 0) {
              <p class="panel-empty good"><svg lucideCircleCheck size="16"></svg>Todos los clientes activos están conectados.</p>
            } @else {
              <p class="panel-note">Si muchos caídos se concentran en una zona, suele ser una avería de esa zona (fibra, antena o energía), no de cada cliente.</p>
              <div class="zone-list">
                @for (zone of offlineByZone(); track zone.name) {
                  <div class="zone-row" [class.alert]="zone.share >= 30 && zone.offline >= 3">
                    <span class="zone-name"><svg lucideMapPin size="14"></svg>{{ zone.name }}</span>
                    <span class="zone-bar"><i [style.width.%]="zone.share"></i></span>
                    <b>{{ zone.offline }} de {{ zone.total }}</b>
                  </div>
                }
              </div>
              <ul class="client-list">
                @for (c of offlineActive().slice(0, 12); track c.queueId ?? c.ip) {
                  <li>
                    @if (c.client) { <a [routerLink]="['/clients', c.client.id]">{{ c.client.name }}</a> } @else { <span>{{ c.queueName }}</span> }
                    <span class="mono">{{ c.ip }}</span>
                    <small>{{ c.client?.zone || 'Sin zona' }}</small>
                  </li>
                }
              </ul>
              @if (offlineActive().length > 12) { <a routerLink="/live" class="more-link">Ver los {{ offlineActive().length }} en Monitoreo en vivo</a> }
            }
          </section>

          <!-- PON -->
          <section class="panel">
            <header class="panel-head"><div><span class="eyebrow">Fibra óptica</span><h2>Puertos PON</h2></div><a routerLink="/olt" class="panel-link">Abrir OLT <svg lucideChevronRight size="14"></svg></a></header>
            @if (sortedPons().length === 0) {
              <p class="panel-empty">Sin datos de puertos PON.</p>
            } @else {
              <div class="pon-grid">
                @for (p of sortedPons(); track p.ponIndex) {
                  <a class="pon-tile" routerLink="/olt" [class]="'pon-tile ' + p.health" [title]="'PON ' + p.pon + ': ' + p.online + ' de ' + p.total + ' en línea'">
                    <header><b>PON {{ p.pon }}</b><em>{{ healthLabel(p.health) }}</em></header>
                    <div class="pon-count"><strong>{{ p.online }}</strong>/{{ p.total }} en línea</div>
                    <div class="pon-bar" [title]="p.utilizationPercent + '% de ocupación'"><i [style.width.%]="p.utilizationPercent"></i></div>
                    <footer>
                      @if (p.critical) { <span class="danger">{{ p.critical }} señal crítica</span> }
                      @if (p.weak) { <span class="warn">{{ p.weak }} débil</span> }
                      @if (p.offline) { <span>{{ p.offline }} {{ p.offline === 1 ? 'caída' : 'caídas' }}</span> }
                      @if (p.avgRxPowerDbm !== null && p.avgRxPowerDbm !== undefined) { <span>RX {{ p.avgRxPowerDbm | number:'1.1-1' }} dBm</span> }
                    </footer>
                  </a>
                }
              </div>
            }
          </section>

          <!-- CONSUMO AHORA -->
          <section class="panel">
            <header class="panel-head"><div><span class="eyebrow">Tráfico</span><h2>Mayor consumo ahora</h2></div><a routerLink="/mikrotik" class="panel-link">Ver colas <svg lucideChevronRight size="14"></svg></a></header>
            @if (topConsumers().length === 0) {
              <p class="panel-empty">No hay clientes transmitiendo en este momento.</p>
            } @else {
              <div class="consumer-list">
                @for (c of topConsumers(); track c.queueId ?? c.ip) {
                  <div class="consumer">
                    <div class="consumer-name">
                      @if (c.client) { <a [routerLink]="['/clients', c.client.id]">{{ c.client.name }}</a> } @else { <span>{{ c.queueName }}</span> }
                      <small>{{ planName(c) }}</small>
                    </div>
                    <div class="consumer-rate"><b>{{ mbps(c.downloadBps) }}</b><small>↓ Mbps · ↑ {{ mbps(c.uploadBps) }}</small></div>
                    <div class="consumer-bar" [title]="c.downloadPct + '% de su plan'"><i [style.width.%]="min100(c.downloadPct)" [class.full]="c.downloadPct >= 90"></i></div>
                  </div>
                }
              </div>
              <p class="panel-note">La barra indica cuánto de su plan está usando. Al 90 % o más, el cliente está al límite de su velocidad contratada.</p>
            }
          </section>

          <!-- INCIDENTES -->
          <section class="panel">
            <header class="panel-head"><div><span class="eyebrow">Centro NOC</span><h2>Incidentes activos</h2></div><a routerLink="/incidents" class="panel-link">Ver todos <svg lucideChevronRight size="14"></svg></a></header>
            @if (incidents().length === 0) {
              <p class="panel-empty good"><svg lucideCircleCheck size="16"></svg>No hay incidentes activos.</p>
            } @else {
              <ul class="incident-list">
                @for (i of incidents(); track i.id) {
                  <li [class]="i.severity">
                    <b>{{ i.title }}</b>
                    <span>{{ i.scopeLabel }} · {{ i.affectedClients }} {{ i.affectedClients === 1 ? 'cliente' : 'clientes' }} · desde {{ relative(i.detectedAt) }}</span>
                  </li>
                }
              </ul>
            }
            @if (signalAlerts().length) {
              <h3 class="sub-head">Alertas de señal óptica</h3>
              <ul class="incident-list">
                @for (a of signalAlerts().slice(0, 5); track a.id) {
                  <li [class]="a.severity"><b>{{ a.message }}</b><span>ONU {{ a.onuIndex }}@if (a.currentValue !== null && a.currentValue !== undefined) { · {{ a.currentValue | number:'1.1-1' }} dBm } · {{ relative(a.lastSeenAt) }}</span></li>
                }
              </ul>
            }
            @if (audit(); as a) {
              <p class="panel-note">Auditoría automática: última muestra {{ a.lastSuccessAt ? relative(a.lastSuccessAt) : 'pendiente' }}@if (a.lastError) { · <span class="hot">último error: {{ a.lastError }}</span> }.</p>
            }
          </section>
        </div>

        <!-- HERRAMIENTA MANUAL -->
        <details class="tool" (toggle)="pingOpen.set($any($event.target).open)">
          <summary><svg lucideActivity size="17"></svg><span><b>Prueba de ping manual</b><small>Comprobar cliente por cliente desde WispHub (lento; útil para confirmar un caso puntual)</small></span><svg lucideChevronDown size="17" class="chev"></svg></summary>
          @if (pingOpen()) { <div class="tool-body"><app-ping-tool /></div> }
        </details>
      }
    </div>
  `,
  styles: [`
    :host { display: block; background: #f8fafc; min-height: 100%; }
    .page { padding: 20px 24px 40px; color: #334250; }
    .eyebrow { display: block; color: #1267dd; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .hub-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .hub-head h1 { margin: 3px 0 2px; color: #172535; font-size: 22px; }
    .hub-head p { margin: 0; color: #667582; font-size: 13px; }
    .btn { display: inline-flex; align-items: center; gap: 7px; height: 38px; padding: 0 14px; border-radius: 6px; font-size: 13px; font-weight: 650; cursor: pointer; border: 1px solid transparent; }
    .btn-outline { background: #fff; border-color: #ccd6de; color: #334250; }
    .btn-outline:hover:not(:disabled) { border-color: #1267dd; color: #1267dd; }
    .btn:disabled { opacity: .6; cursor: wait; }
    .spinning { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .skeleton-grid i { height: 150px; border-radius: 8px; background: linear-gradient(90deg, #eef1f4 25%, #f7f9fa 50%, #eef1f4 75%); background-size: 220% 100%; animation: shimmer 1.3s infinite; }
    @keyframes shimmer { to { background-position: -220% 0; } }

    .verdict { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 14px; padding: 14px 16px; border: 1px solid #cfe8dc; border-left: 5px solid #13875a; border-radius: 8px; background: #f4fbf7; }
    .verdict > svg { flex: 0 0 auto; color: #13875a; }
    .verdict strong { display: block; color: #172535; font-size: 15px; }
    .verdict p { margin: 2px 0 0; color: #526b80; font-size: 13px; }
    .verdict.warn { border-color: #efcf97; border-left-color: #b36b12; background: #fffaf1; }
    .verdict.warn > svg { color: #b36b12; }
    .verdict.danger { border-color: #f0b4ae; border-left-color: #b42318; background: #fff6f5; }
    .verdict.danger > svg { color: #b42318; }
    .verdict > div { flex: 1; min-width: 240px; }
    .verdict ul { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 4px; }
    .verdict li a { display: inline-flex; align-items: center; gap: 4px; color: #334250; font-size: 13px; text-decoration: none; }
    .verdict li a:hover { color: #1267dd; text-decoration: underline; }
    .verdict li::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: #b36b12; }
    .verdict li.danger::before { background: #b42318; }
    .verdict li { display: flex; align-items: center; }
    .partial { width: 100%; color: #9a5b0f; font-size: 12px; }

    .systems { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
    .sys-card { min-width: 0; display: grid; align-content: start; gap: 10px; padding: 13px 14px; border: 1px solid #dfe5ea; border-top: 4px solid #ccd6de; border-radius: 8px; background: #fff; color: inherit; text-decoration: none; transition: box-shadow .15s, transform .15s; }
    .sys-card:hover { box-shadow: 0 8px 20px rgba(20, 33, 45, .08); transform: translateY(-1px); }
    .sys-card.ok { border-top-color: #13875a; } .sys-card.warn { border-top-color: #b36b12; } .sys-card.danger { border-top-color: #b42318; } .sys-card.muted { border-top-color: #ccd6de; }
    .sys-card > header { display: grid; grid-template-columns: 32px minmax(0, 1fr); column-gap: 8px; align-items: center; }
    .sys-icon { grid-row: span 2; width: 32px; height: 32px; display: grid; place-items: center; border-radius: 6px; background: #edf4ff; color: #1267dd; }
    .sys-card.ok .sys-icon { background: #e9f8f1; color: #13875a; } .sys-card.warn .sys-icon { background: #fff6e8; color: #b36b12; } .sys-card.danger .sys-icon { background: #fff0ef; color: #b42318; }
    .sys-card > header strong { color: #172535; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sys-card > header em { color: #667582; font-size: 12px; font-style: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sys-card footer { display: flex; flex-wrap: wrap; gap: 4px 10px; color: #667582; font-size: 12px; }
    .hot { color: #b42318 !important; font-weight: 700; }
    .sys-empty { margin: 0; color: #b42318; font-size: 13px; }
    .meters { display: grid; gap: 8px; }
    .meter { display: grid; grid-template-columns: 1fr auto; gap: 3px 8px; align-items: center; font-size: 12px; color: #667582; }
    .meter b { color: #172535; font-size: 13px; }
    .meter i { grid-column: 1 / -1; height: 7px; border-radius: 4px; background: #e8edf1; overflow: hidden; }
    .meter u { display: block; height: 100%; border-radius: inherit; background: #13875a; }
    .meter u.warn { background: #d08a1a; } .meter u.danger { background: #b42318; } .meter u.muted { background: #9aa6b0; }
    .big-number { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
    .big-number b { color: #172535; font-size: 26px; line-height: 1; }
    .big-number span { color: #667582; font-size: 12px; }
    .wan-values { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .wan-values div { display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: 5px; }
    .wan-values svg { color: #1267dd; grid-row: span 2; }
    .wan-values b { color: #172535; font-size: 20px; line-height: 1.1; }
    .wan-values span { color: #667582; font-size: 11px; }

    .panels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
    .panel { min-width: 0; padding: 14px 16px; border: 1px solid #dfe5ea; border-radius: 8px; background: #fff; }
    .panel-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
    .panel-head h2 { margin: 2px 0 0; color: #172535; font-size: 16px; }
    .panel-link { display: inline-flex; align-items: center; gap: 3px; color: #1267dd; font-size: 13px; font-weight: 700; text-decoration: none; white-space: nowrap; }
    .panel-link:hover { text-decoration: underline; }
    .panel-empty { display: flex; align-items: center; gap: 7px; margin: 8px 0; color: #667582; font-size: 13px; }
    .panel-empty.good { color: #13875a; font-weight: 600; }
    .panel-note { margin: 8px 0 0; color: #667582; font-size: 12px; line-height: 1.45; }
    .sub-head { margin: 14px 0 6px; color: #334250; font-size: 13px; }
    .mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 12px; }

    .zone-list { display: grid; gap: 6px; margin: 10px 0 12px; }
    .zone-row { display: grid; grid-template-columns: minmax(90px, 1fr) 2fr auto; align-items: center; gap: 10px; font-size: 13px; }
    .zone-name { display: inline-flex; align-items: center; gap: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #334250; }
    .zone-bar { height: 8px; border-radius: 4px; background: #eef1f4; overflow: hidden; }
    .zone-bar i { display: block; height: 100%; border-radius: inherit; background: #d08a1a; }
    .zone-row.alert .zone-bar i { background: #b42318; }
    .zone-row.alert b { color: #b42318; }
    .zone-row b { color: #172535; font-size: 12px; white-space: nowrap; }
    .client-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
    .client-list li { display: grid; grid-template-columns: minmax(0, 1.4fr) auto minmax(0, 1fr); gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid #f0f3f6; font-size: 13px; }
    .client-list li:last-child { border-bottom: 0; }
    .client-list a, .consumer-name a { color: #172535; font-weight: 650; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .client-list a:hover, .consumer-name a:hover { color: #1267dd; text-decoration: underline; }
    .client-list small { color: #667582; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
    .more-link { display: inline-block; margin-top: 8px; color: #1267dd; font-size: 13px; font-weight: 700; text-decoration: none; }

    .pon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .pon-tile { min-width: 0; display: grid; gap: 5px; padding: 9px 10px; border: 1px solid #dfe5ea; border-left: 4px solid #13875a; border-radius: 6px; color: inherit; text-decoration: none; font-size: 12px; }
    .pon-tile:hover { background: #f8fafc; }
    .pon-tile.warning { border-left-color: #d08a1a; background: #fffcf6; }
    .pon-tile.critical { border-left-color: #b42318; background: #fffafa; }
    .pon-tile header { display: flex; justify-content: space-between; gap: 6px; }
    .pon-tile header b { color: #172535; font-size: 13px; }
    .pon-tile header em { color: #667582; font-style: normal; }
    .pon-tile.critical header em { color: #b42318; font-weight: 700; } .pon-tile.warning header em { color: #9a5b0f; font-weight: 700; }
    .pon-count { color: #667582; } .pon-count strong { color: #172535; font-size: 15px; }
    .pon-bar { height: 5px; border-radius: 3px; background: #eef1f4; overflow: hidden; }
    .pon-bar i { display: block; height: 100%; background: #1267dd; }
    .pon-tile footer { display: flex; flex-wrap: wrap; gap: 2px 8px; color: #667582; }
    .pon-tile footer .danger { color: #b42318; font-weight: 700; } .pon-tile footer .warn { color: #9a5b0f; font-weight: 700; }

    .consumer-list { display: grid; gap: 8px; }
    .consumer { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 10px; align-items: center; }
    .consumer-name { display: grid; min-width: 0; font-size: 13px; }
    .consumer-name small, .consumer-rate small { color: #667582; font-size: 11px; }
    .consumer-rate { display: grid; text-align: right; } .consumer-rate b { color: #172535; font-size: 15px; }
    .consumer-bar { grid-column: 1 / -1; height: 6px; border-radius: 3px; background: #eef1f4; overflow: hidden; }
    .consumer-bar i { display: block; height: 100%; background: #1267dd; } .consumer-bar i.full { background: #d08a1a; }

    .incident-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
    .incident-list li { display: grid; gap: 2px; padding: 8px 10px; border: 1px solid #dfe5ea; border-left: 4px solid #d08a1a; border-radius: 6px; font-size: 12px; }
    .incident-list li.critical, .incident-list li.high { border-left-color: #b42318; }
    .incident-list li.low, .incident-list li.info { border-left-color: #9aa6b0; }
    .incident-list b { color: #172535; font-size: 13px; }
    .incident-list span { color: #667582; }

    .tool { border: 1px solid #dfe5ea; border-radius: 8px; background: #fff; }
    .tool > summary { display: flex; align-items: center; gap: 10px; padding: 12px 16px; cursor: pointer; list-style: none; color: #1267dd; }
    .tool > summary::-webkit-details-marker { display: none; }
    .tool > summary span { flex: 1; display: grid; }
    .tool > summary b { color: #172535; font-size: 14px; }
    .tool > summary small { color: #667582; font-size: 12px; }
    .tool[open] .chev { transform: rotate(180deg); }
    .tool-body { padding: 4px 16px 16px; border-top: 1px solid #edf0f2; }

    a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid #1267dd; outline-offset: 2px; }

    @media (max-width: 1350px) { .systems { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 980px) { .panels { grid-template-columns: 1fr; } .systems { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 560px) {
      .page { padding: 14px 12px 32px; }
      .systems { grid-template-columns: 1fr; }
      .client-list li { grid-template-columns: minmax(0, 1fr) auto; }
      .client-list small { display: none; }
      .zone-row { grid-template-columns: minmax(0, 1fr) auto; }
      .zone-bar { grid-column: 1 / -1; grid-row: 2; }
    }
    @media (prefers-reduced-motion: reduce) { .spinning, .skeleton-grid i { animation: none; } .sys-card { transition: none; } }
  `],
})
export class NetworkMonitorComponent implements OnInit, OnDestroy {
  private mt = inject(MikrotikService);
  private oltApi = inject(OltService);
  private nocApi = inject(NocService);
  private auditApi = inject(NetworkAuditService);

  loading = signal(true);
  refreshing = signal(false);
  lastUpdated = signal<Date | null>(null);
  sourceErrors = signal<string[]>([]);
  pingOpen = signal(false);

  mikrotik = signal<MtStatus | null>(null);
  system = signal<MtSystem | null>(null);
  wan = signal<WanTraffic | null>(null);
  live = signal<MtLiveResponse | null>(null);
  olt = signal<OltStatus | null>(null);
  pons = signal<OltPon[]>([]);
  signalAlerts = signal<OltSignalAlert[]>([]);
  noc = signal<NocSummary | null>(null);
  incidents = signal<NocIncident[]>([]);
  audit = signal<NetworkAuditStatus | null>(null);

  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = signal(0); // refresca los "hace X min"

  // ─── Router ───
  private resource = computed(() => this.system()?.resource ?? null);
  cpu = computed<number | null>(() => this.num(this.resource()?.['cpu-load']));
  memory = computed<number | null>(() => {
    const total = this.num(this.resource()?.['total-memory']);
    const free = this.num(this.resource()?.['free-memory']);
    return total && free !== null ? Math.round(((total - free) / total) * 100) : null;
  });
  version = computed(() => String(this.resource()?.['version'] || '').split(' ')[0]);
  uptime = computed(() => this.humanUptime(this.resource()?.['uptime']));
  temperature = computed<number | null>(() => {
    const health = this.system()?.health ?? [];
    const item = health.find((h: any) => /temperature/i.test(String(h?.name ?? h?.['name'] ?? '')));
    return item ? this.num(item.value) : this.num(this.resource()?.['cpu-temperature']);
  });
  routerTone = computed<Tone>(() => {
    if (!this.mikrotik()?.connected) return 'danger';
    const worst = Math.max(this.cpu() ?? 0, this.memory() ?? 0);
    return worst >= 90 ? 'danger' : worst >= 75 ? 'warn' : 'ok';
  });
  routerLabel = computed(() => this.mikrotik()?.connected ? (this.system()?.identity || 'Conectado') : 'Sin conexión');

  // ─── Internet ───
  wanPct = computed(() => {
    const w = this.wan();
    if (!w || !w.maxBps) return 0;
    return Math.min(100, Math.round((Math.max(w.rxBps, w.txBps) / w.maxBps) * 100));
  });
  wanTone = computed<Tone>(() => !this.wan() || !this.mikrotik()?.connected ? 'muted' : this.wan()!.degraded || this.wanPct() >= 90 ? 'danger' : this.wanPct() >= 75 ? 'warn' : 'ok');

  // ─── OLT ───
  oltTone = computed<Tone>(() => {
    const o = this.olt();
    if (!o) return 'muted';
    if (!o.connected || this.pons().some((p) => p.health === 'critical')) return 'danger';
    if (o.totals.activeAlarms > 0 || this.signalAlerts().length > 0 || this.pons().some((p) => p.health === 'warning')) return 'warn';
    return 'ok';
  });
  sortedPons = computed(() => {
    const rank = { critical: 0, warning: 1, healthy: 2 } as Record<string, number>;
    return [...this.pons()].sort((a, b) => (rank[a.health] ?? 3) - (rank[b.health] ?? 3) || b.offlinePercent - a.offlinePercent || a.pon - b.pon);
  });

  // ─── Clientes ───
  offlineActive = computed<MtLiveClient[]>(() => (this.live()?.clients ?? [])
    .filter((c) => c.isActive && !c.isOnline && !c.isDisabled && c.client?.status?.toLowerCase() === 'activo')
    .sort((a, b) => String(a.client?.zone || '').localeCompare(String(b.client?.zone || '')) || String(a.client?.name).localeCompare(String(b.client?.name))));
  offlineByZone = computed(() => {
    const activeByZone = new Map<string, number>();
    for (const c of this.live()?.clients ?? []) {
      if (c.client?.status?.toLowerCase() !== 'activo') continue;
      const zone = c.client.zone || 'Sin zona';
      activeByZone.set(zone, (activeByZone.get(zone) || 0) + 1);
    }
    const offlineByZone = new Map<string, number>();
    for (const c of this.offlineActive()) {
      const zone = c.client?.zone || 'Sin zona';
      offlineByZone.set(zone, (offlineByZone.get(zone) || 0) + 1);
    }
    return [...offlineByZone.entries()]
      .map(([name, offline]) => {
        const total = Math.max(activeByZone.get(name) || offline, offline);
        return { name, offline, total, share: Math.round((offline / total) * 100) };
      })
      .sort((a, b) => b.offline - a.offline)
      .slice(0, 6);
  });
  clientsTone = computed<Tone>(() => {
    const l = this.live();
    if (!l) return 'muted';
    const pct = this.pct(l.stats.onlineClients, l.stats.activeClients);
    return pct >= 90 ? 'ok' : pct >= 75 ? 'warn' : 'danger';
  });
  topConsumers = computed(() => [...(this.live()?.clients ?? [])]
    .filter((c) => c.downloadBps + c.uploadBps > 0)
    .sort((a, b) => (b.downloadBps + b.uploadBps) - (a.downloadBps + a.uploadBps))
    .slice(0, 8));

  // ─── NOC ───
  nocTone = computed<Tone>(() => {
    const n = this.noc();
    if (!n) return 'muted';
    return n.critical > 0 ? 'danger' : n.active > 0 ? 'warn' : 'ok';
  });

  // ─── Veredicto ───
  issues = computed<Issue[]>(() => {
    const list: Issue[] = [];
    const mt = this.mikrotik();
    if (mt && !mt.connected) list.push({ tone: 'danger', text: 'El MikroTik no responde', link: '/mikrotik' });
    if ((this.cpu() ?? 0) >= 85) list.push({ tone: 'warn', text: `CPU del router al ${this.cpu()} %`, link: '/mikrotik' });
    if ((this.memory() ?? 0) >= 90) list.push({ tone: 'warn', text: `Memoria del router al ${this.memory()} %`, link: '/mikrotik' });
    if ((this.temperature() ?? 0) >= 70) list.push({ tone: 'warn', text: `Router a ${this.temperature()} °C`, link: '/mikrotik' });
    // Si el router no responde, el enlace sale "degradado" por falta de lectura: no se repite el aviso.
    if (this.wan()?.degraded && mt?.connected) list.push({ tone: 'danger', text: 'Enlace a internet degradado', link: '/auditoria-red' });
    else if (mt?.connected && this.wanPct() >= 90) list.push({ tone: 'warn', text: `Enlace a internet al ${this.wanPct()} % de su capacidad`, link: '/auditoria-red' });
    const o = this.olt();
    if (o && o.enabled && !o.connected) list.push({ tone: 'danger', text: 'La OLT no responde', link: '/olt' });
    const critical = this.pons().filter((p) => p.health === 'critical');
    if (critical.length) list.push({ tone: 'danger', text: `${critical.length === 1 ? 'PON ' + critical[0].pon + ' en estado crítico' : critical.length + ' puertos PON en estado crítico'}`, link: '/olt' });
    if (this.signalAlerts().length) list.push({ tone: 'warn', text: `${this.signalAlerts().length} ${this.signalAlerts().length === 1 ? 'alerta' : 'alertas'} de señal óptica`, link: '/olt' });
    const n = this.noc();
    if (n?.critical) list.push({ tone: 'danger', text: `${n.critical} ${n.critical === 1 ? 'incidente crítico' : 'incidentes críticos'} (${n.affectedClients} clientes afectados)`, link: '/incidents' });
    else if (n?.active) list.push({ tone: 'warn', text: `${n.active} ${n.active === 1 ? 'incidente activo' : 'incidentes activos'}`, link: '/incidents' });
    const zone = this.offlineByZone().find((z) => z.share >= 30 && z.offline >= 3);
    if (zone) list.push({ tone: 'warn', text: `${zone.offline} de ${zone.total} clientes caídos en ${zone.name}: posible avería de zona`, link: '/live' });
    return list;
  });
  verdictTone = computed(() => this.issues().some((i) => i.tone === 'danger') ? 'danger' : this.issues().length ? 'warn' : 'ok');

  ngOnInit() {
    void this.load(true);
    this.timer = setInterval(() => { this.tick.update((v) => v + 1); void this.load(); }, REFRESH_MS);
  }

  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async load(initial = false) {
    if (this.refreshing()) return;
    if (!initial) this.refreshing.set(true);
    const settled = await Promise.allSettled([
      firstValueFrom(this.mt.getStatus().pipe(timeout(15_000))),
      firstValueFrom(this.mt.getSystem().pipe(timeout(15_000))),
      firstValueFrom(this.mt.getWanTraffic().pipe(timeout(15_000))),
      firstValueFrom(this.mt.getLiveClients().pipe(timeout(30_000))),
      firstValueFrom(this.oltApi.getStatus().pipe(timeout(15_000))),
      firstValueFrom(this.oltApi.getPons().pipe(timeout(15_000))),
      firstValueFrom(this.oltApi.getSignalAlerts(true).pipe(timeout(15_000))),
      firstValueFrom(this.nocApi.summary().pipe(timeout(15_000))),
      firstValueFrom(this.nocApi.incidents({ status: 'active', page: 1, pageSize: 6 }).pipe(timeout(15_000))),
      firstValueFrom(this.auditApi.status().pipe(timeout(15_000))),
    ]);
    const errors: string[] = [];
    const read = <T>(index: number, source: string): T | null => {
      const result = settled[index];
      if (result.status === 'fulfilled') return result.value as T;
      errors.push(source);
      return null;
    };
    const status = read<MtStatus>(0, 'MikroTik');
    const system = read<MtSystem>(1, 'recursos del router');
    const wan = read<WanTraffic>(2, 'tráfico de internet');
    const live = read<MtLiveResponse>(3, 'clientes en vivo');
    const olt = read<OltStatus>(4, 'OLT');
    const pons = read<OltPon[]>(5, 'puertos PON');
    const alerts = read<OltSignalAlert[]>(6, 'alertas de señal');
    const noc = read<NocSummary>(7, 'Centro NOC');
    const incidents = read<{ items: NocIncident[] }>(8, 'incidentes');
    const audit = read<NetworkAuditStatus>(9, 'auditoría');

    this.mikrotik.set(status);
    // Si el router no responde, no se muestran recursos viejos.
    this.system.set(status?.connected ? system : null);
    this.wan.set(wan);
    this.live.set(live);
    this.olt.set(olt);
    this.pons.set(pons ?? []);
    this.signalAlerts.set((alerts ?? []).filter((a) => a.active));
    this.noc.set(noc);
    this.incidents.set(incidents?.items ?? []);
    this.audit.set(audit);
    this.sourceErrors.set(errors);
    this.lastUpdated.set(new Date());
    this.loading.set(false);
    this.refreshing.set(false);
  }

  // ─── Formato ───
  mbps(bps: number | null | undefined): string {
    const value = (Number(bps) || 0) / 1_000_000;
    return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  }

  pct(part: number, total: number): number {
    return total > 0 ? Math.round((part / total) * 100) : 0;
  }

  min100(value: number): number {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  meterTone(value: number | null): string {
    if (value === null) return 'muted';
    return value >= 90 ? 'danger' : value >= 75 ? 'warn' : 'ok';
  }

  healthLabel(health: string): string {
    return health === 'critical' ? 'Crítico' : health === 'warning' ? 'Revisar' : 'Normal';
  }

  planName(c: MtLiveClient): string {
    return c.client?.plan ? formatPlanName(c.client.plan) : 'Sin plan';
  }

  relative(iso: string): string {
    this.tick();
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff)) return '—';
    const minutes = Math.round(diff / 60_000);
    if (minutes < 1) return 'hace un momento';
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.round(hours / 24);
    return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  }

  /** RouterOS: "2w3d04:05:06" o "3d4h5m" -> "2 sem 3 d 4 h". */
  private humanUptime(raw: unknown): string {
    const text = String(raw || '');
    if (!text) return '—';
    const part = (unit: string) => Number(text.match(new RegExp(`(\\d+)${unit}`))?.[1] || 0);
    const clock = text.match(/(\d+):(\d+):(\d+)/);
    const weeks = part('w');
    const days = part('d');
    const hours = clock ? Number(clock[1]) : part('h');
    const minutes = clock ? Number(clock[2]) : part('m');
    const out = [weeks && `${weeks} sem`, days && `${days} d`, hours && `${hours} h`].filter(Boolean);
    if (!out.length) return minutes ? `${minutes} min` : text;
    return out.join(' ');
  }

  private num(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
}
