import { Component, OnInit, OnDestroy, inject, signal, computed, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NavbarComponent } from '../../components/layout/navbar';
import {
  LucideCrosshair, LucideExternalLink, LucideHouse, LucideLocateFixed, LucideMapPinOff, LucideNavigation,
  LucideRefreshCw, LucideRotateCw, LucideSearch, LucideX,
} from '@lucide/angular';
import { forkJoin, of, map, switchMap } from 'rxjs';
import { formatPlanName } from '../../pipes/plan-label.pipe';
import { ToastService } from '../../services/toast.service';
import { LocalDbService } from '../../services/local-db.service';
import { NetworkAuditService, NetworkHealthState } from '../../services/network-audit.service';
import { WispHubClient } from '../../models/client.model';

// MapLibre GL JS bundled (no CDN). Estilo Liberty de OpenFreeMap (vector tiles 3D, sin API key).
import maplibregl, { Map as MapLibreMap, Marker, Popup, NavigationControl, LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
// Fallback raster (OSM directo) si el style vector falla por CORS/red
const FALLBACK_STYLE: any = {
  version: 8,
  sources: {
    'osm-raster': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm-raster' }],
};

// Default: zona norte RD (Cibao) - entre Santiago y Puerto Plata
const DEFAULT_CENTER: [number, number] = [-70.6970, 19.6200];
const DEFAULT_ZOOM = 9;
const PREFS_KEY = 'ispmax.mapa.prefs';

interface MapClient {
  id: number;
  nombre: string;
  telefono: string | null;
  ip: string | null;
  plan: string | null;
  estado: string | null;
  estadoFacturas: string | null;
  zona: string | null;
  direccion: string | null;
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string | null;
  source: 'tecnico' | 'local' | 'wisphub' | null;
}

interface RenderMapClient extends MapClient {
  renderLat: number;
  renderLng: number;
  overlapCount: number;
}

interface NoGpsClient { id: number; nombre: string; estado: string | null; zona: string | null; direccion: string | null; ip: string | null; }
interface NetInfo { state: NetworkHealthState; at: string | null; }

type Chip = 'all' | 'online' | 'offline' | 'moroso';
type ColorMode = 'account' | 'network';
type Panel = 'none' | 'nogps' | 'near';

@Component({
  selector: 'app-mapa',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, NavbarComponent,
    LucideCrosshair, LucideExternalLink, LucideHouse, LucideLocateFixed, LucideMapPinOff, LucideNavigation,
    LucideRefreshCw, LucideRotateCw, LucideSearch, LucideX,
  ],
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    <app-navbar pageTitle="Mapa en vivo" />

    <div class="page">
      <div class="toolbar">
        <div class="kpis">
          <span class="kpi" title="Se actualiza cada 30 segundos">
            <span class="pulse-dot" aria-hidden="true"></span>
            En vivo · {{ lastUpdate() ? 'actualizado ' + lastUpdate() : 'cargando…' }}
          </span>
          <span class="kpi"><strong>{{ filtered().length }}</strong> en el mapa</span>
          <span class="kpi kpi-blue" title="Ubicación capturada en sitio por un técnico"><strong>{{ countBySource('tecnico') }}</strong> con GPS del técnico</span>
          <button type="button" class="kpi kpi-warn kpi-btn" [class.on]="panel() === 'nogps'" (click)="togglePanel('nogps')" [attr.aria-pressed]="panel() === 'nogps'" title="Clientes que no aparecen en el mapa porque no tienen ubicación guardada">
            <svg lucideMapPinOff size="14" aria-hidden="true"></svg><strong>{{ noGps().length }}</strong> sin ubicación
          </button>
        </div>
        <div class="filters">
          <div class="search-box">
            <label class="input search-input">
              <svg lucideSearch size="15" aria-hidden="true"></svg>
              <input type="search" placeholder="Buscar nombre, IP, teléfono o zona" [ngModel]="search()" (ngModelChange)="onSearch($event)"
                (keydown.enter)="pickFirst()" (focus)="suggestOpen.set(true)" (blur)="closeSuggestSoon()"
                aria-label="Buscar cliente en el mapa" autocomplete="off" />
            </label>
            @if (suggestOpen() && search().trim() && suggestions().length) {
              <ul class="suggest" role="listbox" aria-label="Clientes encontrados">
                @for (s of suggestions(); track s.id + '-' + s.hasGps) {
                  <li role="option" [attr.aria-selected]="false">
                    @if (s.hasGps) {
                      <button type="button" (mousedown)="$event.preventDefault()" (click)="focusClient(s.id)">
                        <i [style.background]="s.color" aria-hidden="true"></i>
                        <span><strong>{{ s.nombre }}</strong><small>{{ s.sub }}</small></span>
                      </button>
                    } @else {
                      <a [routerLink]="['/clients', s.id]" title="Abrir la ficha para capturar su ubicación">
                        <svg lucideMapPinOff size="14" aria-hidden="true"></svg>
                        <span><strong>{{ s.nombre }}</strong><small>Sin ubicación · abrir ficha para capturarla</small></span>
                      </a>
                    }
                  </li>
                }
              </ul>
            }
          </div>
          <select [(ngModel)]="estadoFilter" (change)="render()" class="input" aria-label="Filtrar por estado de la cuenta">
            <option value="">Todos los estados</option>
            <option value="Activo">Activo</option>
            <option value="Suspendido">Suspendido</option>
            <option value="Cortado">Cortado</option>
            <option value="Retirado">Retirado</option>
          </select>
          <select [(ngModel)]="viewMode" (change)="changeView()" class="input" aria-label="Tipo de vista">
            <option value="3d">Vista 3D</option>
            <option value="2d">Vista plana (2D)</option>
          </select>
          <button type="button" class="btn-icon" (click)="reload()" [disabled]="loading()" title="Recargar clientes" aria-label="Recargar clientes"><svg lucideRefreshCw size="16" [class.spinning]="loading()" aria-hidden="true"></svg></button>
          <button type="button" class="btn-icon" (click)="fitAll()" title="Encuadrar todos los clientes visibles" aria-label="Ver todos los clientes"><svg lucideCrosshair size="16" aria-hidden="true"></svg><span>Ver todos</span></button>
          <button type="button" class="btn-icon" (click)="goHome()" title="Volver a la zona norte (Cibao)" aria-label="Volver a la zona norte"><svg lucideHouse size="16" aria-hidden="true"></svg><span>Zona norte</span></button>
          <button type="button" class="btn-icon" (click)="rotateView()" title="Girar el mapa 45°" aria-label="Girar el mapa"><svg lucideRotateCw size="16" aria-hidden="true"></svg><span>Girar</span></button>
        </div>
      </div>

      <div class="subbar">
        <div class="chips" role="group" aria-label="Filtro rápido">
          @for (c of chips; track c.id) {
            <button type="button" [class]="'chip ' + c.id" [class.on]="chip() === c.id" [attr.aria-pressed]="chip() === c.id" (click)="setChip(c.id)" [title]="c.hint">
              {{ c.label }}
              @if (chipBadge(c.id); as n) { <b>{{ n }}</b> }
            </button>
          }
        </div>
        <div class="seg" role="group" aria-label="Colorear marcadores por">
          <span>Colores:</span>
          <button type="button" [class.on]="colorMode() === 'account'" [attr.aria-pressed]="colorMode() === 'account'" (click)="setColorMode('account')">Cuenta</button>
          <button type="button" [class.on]="colorMode() === 'network'" [attr.aria-pressed]="colorMode() === 'network'" (click)="setColorMode('network')">Conexión</button>
        </div>
        @if (canLocate) {
          <button type="button" class="btn-icon locate" (click)="locateMe()" [disabled]="locating()" title="Centrar el mapa en su ubicación y ver los clientes más cercanos">
            <svg lucideLocateFixed size="16" [class.spinning]="locating()" aria-hidden="true"></svg><span>{{ locating() ? 'Ubicando…' : 'Mi ubicación' }}</span>
          </button>
        }
      </div>

      <div class="map-wrapper">
        <div #mapEl class="map-container"></div>

        @if (mapBootError()) {
          <div class="overlay overlay-error">
            <h3>No se pudo cargar el mapa</h3>
            <p>Revise la conexión a Internet e intente de nuevo.</p>
            <small class="overlay-detail">{{ mapBootError() }}</small>
            <button type="button" class="btn-icon" (click)="retryMap()">Reintentar</button>
          </div>
        } @else if (mapBooting()) {
          <div class="overlay overlay-loader">
            <div class="loader"></div>
            <p>Cargando mapa…</p>
          </div>
        }

        @if (!mapBooting() && !mapBootError()) {
          @if (loadError()) {
            <div class="overlay-corner overlay-warn" role="alert">
              <strong>No se pudieron cargar los clientes.</strong> Revise la conexión y pulse recargar.
              <br><small>{{ loadError() }}</small>
            </div>
          } @else if (allClients().length === 0 && !loading()) {
            <div class="overlay-corner overlay-info">
              <strong>Todavía no hay clientes con ubicación.</strong>
              @if (stats(); as s) {
                <br>De {{ s.totalClients }} clientes registrados, ninguno tiene GPS guardado.
              }
              <br>Para agregarlos, abra la ficha del cliente en su casa y use <em>Capturar mi ubicación actual</em>.
            </div>
          } @else if (filtered().length === 0 && allClients().length > 0) {
            <div class="overlay-corner overlay-info">
              <strong>Ningún cliente coincide con los filtros.</strong>
              <br><button type="button" class="link-btn" (click)="clearFilters()">Quitar filtros</button>
            </div>
          } @else if (stats(); as s) {
            <div class="overlay-corner overlay-debug">
              <strong>{{ s.shownInMap }}</strong> de {{ s.totalClients }} clientes en el mapa ·
              <span class="txt-green">{{ s.withGpsTecnico }} con GPS del técnico</span> ·
              {{ s.withCoordsWispHub || 0 }} con ubicación de WispHub
              @if (s.skippedBadCoords > 0) {
                · <span class="txt-red">{{ s.skippedBadCoords }} con ubicación inválida</span>
              }
            </div>
          }

          <div class="map-legend" aria-label="Leyenda de colores">
            @for (l of legend(); track l.label) {
              <span [title]="l.hint"><i [style.background]="l.color"></i>{{ l.label }} <b>{{ l.count }}</b></span>
            }
            @if (colorMode() === 'network') {
              <small>{{ netNote() }}</small>
            } @else if (netLoaded() && netOfflineCount()) {
              <small><i class="down-dot"></i>Punto rojo = caído en la última lectura</small>
            }
          </div>

          @if (panel() !== 'none') {
            <aside class="side-panel" [attr.aria-label]="panel() === 'nogps' ? 'Clientes sin ubicación' : 'Clientes cercanos'">
              <header>
                @if (panel() === 'nogps') {
                  <div><h3>Clientes sin ubicación</h3><p>{{ noGps().length }} no aparecen en el mapa. Abra la ficha en casa del cliente y pulse «Capturar mi ubicación actual».</p></div>
                } @else {
                  <div><h3>Clientes más cercanos</h3><p>Distancia en línea recta desde su ubicación{{ myLocation()?.accuracy ? ' (±' + (myLocation()!.accuracy | number:'1.0-0') + ' m)' : '' }}.</p></div>
                }
                <button type="button" class="close" (click)="panel.set('none')" aria-label="Cerrar panel" title="Cerrar (Esc)"><svg lucideX size="16" aria-hidden="true"></svg></button>
              </header>
              @if (panel() === 'nogps') {
                <label class="panel-search"><svg lucideSearch size="14" aria-hidden="true"></svg><input type="search" placeholder="Filtrar por nombre, zona o IP" [ngModel]="noGpsTerm()" (ngModelChange)="noGpsTerm.set($event)" aria-label="Filtrar clientes sin ubicación" /></label>
                @if (!noGpsFiltered().length) {
                  <p class="panel-empty">{{ noGps().length ? 'Ningún cliente coincide.' : 'Todos los clientes tienen ubicación.' }}</p>
                } @else {
                  <ul>
                    @for (c of noGpsFiltered().slice(0, 100); track c.id) {
                      <li>
                        <span class="who"><strong>{{ c.nombre }}</strong><small>{{ [c.zona, c.direccion, c.ip].filter(isText).join(' · ') || 'Sin dirección registrada' }}</small></span>
                        @if (c.estado && c.estado !== 'Activo') { <em class="tag">{{ c.estado }}</em> }
                        <a class="go" [routerLink]="['/clients', c.id]" title="Abrir ficha para capturar la ubicación" [attr.aria-label]="'Abrir ficha de ' + c.nombre"><svg lucideExternalLink size="14" aria-hidden="true"></svg></a>
                      </li>
                    }
                  </ul>
                  @if (noGpsFiltered().length > 100) { <p class="panel-empty">Se muestran 100 de {{ noGpsFiltered().length }}. Use el filtro para encontrar otros.</p> }
                }
              } @else {
                @if (!nearby().length) {
                  <p class="panel-empty">No hay clientes visibles con los filtros actuales.</p>
                } @else {
                  <ul>
                    @for (n of nearby(); track n.c.id) {
                      <li>
                        <i class="dot" [style.background]="markerColor(n.c)" aria-hidden="true"></i>
                        <button type="button" class="who" (click)="focusClient(n.c.id)"><strong>{{ n.c.nombre }}</strong><small>{{ n.c.zona || n.c.direccion || n.c.ip || '—' }}</small></button>
                        <b class="dist">{{ formatDistance(n.meters) }}</b>
                        <a class="go" [href]="directionsUrl(n.c)" target="_blank" rel="noopener" title="Cómo llegar (Google Maps)" [attr.aria-label]="'Cómo llegar a ' + n.c.nombre"><svg lucideNavigation size="14" aria-hidden="true"></svg></a>
                      </li>
                    }
                  </ul>
                }
              }
            </aside>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; background: #f8fafc; }
    .page { padding: 16px 24px 24px; display: flex; flex-direction: column; height: calc(100vh - 80px); box-sizing: border-box; color: #334250; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
    .kpis { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .kpi { background: white; border: 1px solid #dfe5ea; border-radius: 999px; padding: 6px 12px; font-size: 12px; color: #334250; display: inline-flex; align-items: center; gap: 6px; }
    .kpi strong { color: #172535; }
    .kpi-blue { border-color: #cfe0f8; background: #edf4ff; color: #1267dd; }
    .kpi-warn { border-color: #efd3a8; background: #fff6e8; color: #7a4a0c; }
    .kpi-blue strong, .kpi-warn strong { color: inherit; }
    .kpi-btn { font: inherit; font-size: 12px; cursor: pointer; }
    .kpi-btn:hover, .kpi-btn.on { border-color: #b36b12; }
    .pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: #13875a; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; box-shadow: 0 0 0 0 rgba(19,135,90,0.45); } 50% { opacity: 0.6; box-shadow: 0 0 0 7px rgba(19,135,90,0); } }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .input { height: 36px; box-sizing: border-box; padding: 0 12px; border: 1px solid #ccd6de; border-radius: 6px; font-size: 13px; color: #334250; background: white; outline: none; }
    .input:focus, .search-input:focus-within { border-color: #1267dd; box-shadow: 0 0 0 2px #edf4ff; }
    .search-box { position: relative; }
    .search-input { display: inline-flex; align-items: center; gap: 6px; color: #667582; }
    .search-input input { width: 220px; border: 0; outline: 0; font-size: 13px; color: #172535; background: transparent; }
    .suggest { position: absolute; top: 40px; left: 0; z-index: 30; width: max(100%, 300px); max-height: 340px; overflow: auto; margin: 0; padding: 4px; list-style: none; background: #fff; border: 1px solid #dfe5ea; border-radius: 8px; box-shadow: 0 10px 30px rgba(15,23,42,.18); }
    .suggest button, .suggest a { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 8px; border: 0; border-radius: 6px; background: none; color: #8792a0; font: inherit; text-align: left; text-decoration: none; cursor: pointer; }
    .suggest button:hover, .suggest a:hover, .suggest button:focus-visible, .suggest a:focus-visible { background: #f2f7ff; outline: none; }
    .suggest i { flex-shrink: 0; width: 10px; height: 10px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.15); }
    .suggest span, .side-panel .who { display: grid; min-width: 0; }
    .suggest strong, .side-panel .who strong { font-size: 13px; color: #172535; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .suggest small, .side-panel .who small { font-size: 11px; color: #8792a0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .btn-icon { display: inline-flex; align-items: center; gap: 6px; height: 36px; background: white; border: 1px solid #ccd6de; color: #334250; border-radius: 6px; padding: 0 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn-icon:hover:not(:disabled) { border-color: #b9cdea; background: #f2f7ff; color: #1267dd; }
    .btn-icon:disabled { opacity: .6; cursor: wait; }
    .btn-icon:focus-visible, .input:focus-visible, .chip:focus-visible, .seg button:focus-visible, .kpi-btn:focus-visible { outline: 2px solid #1267dd; outline-offset: 2px; }
    .spinning { animation: spin .8s linear infinite; }
    .subbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-bottom: 12px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { height: 32px; padding: 0 12px; border: 1px solid #ccd6de; border-radius: 999px; background: #fff; color: #334250; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    .chip b { margin-left: 3px; color: #667582; }
    .chip.on { background: #edf4ff; border-color: #1267dd; color: #1267dd; }
    .chip.online.on { background: #e9f8f1; border-color: #13875a; color: #13875a; }
    .chip.offline.on, .chip.moroso.on { background: #fff0ef; border-color: #b42318; color: #b42318; }
    .chip.on b { color: inherit; }
    .seg { display: inline-flex; align-items: center; gap: 0; font-size: 12px; color: #667582; }
    .seg span { margin-right: 6px; }
    .seg button { height: 32px; padding: 0 11px; border: 1px solid #ccd6de; background: #fff; color: #334250; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    .seg button:first-of-type { border-radius: 6px 0 0 6px; }
    .seg button:last-of-type { border-radius: 0 6px 6px 0; border-left: 0; }
    .seg button.on { background: #1267dd; border-color: #1267dd; color: #fff; }
    .locate { height: 32px; margin-left: auto; }
    .map-wrapper { flex: 1; min-height: 500px; position: relative; border-radius: 8px; overflow: hidden; border: 1px solid #dfe5ea; background: #0a0e27; }
    .map-container { position: absolute; inset: 0; width: 100%; height: 100%; }
    .overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.85); color: white; padding: 40px 20px; text-align: center; z-index: 5; }
    .overlay h3 { margin: 0 0 8px; }
    .overlay p { color: #cbd5e1; margin: 0 0 14px; }
    .overlay-error { background: rgba(122, 27, 20, 0.92); }
    .overlay-detail { display: block; margin: -6px 0 14px; color: #f5c6c1; font-size: 11px; max-width: 460px; overflow-wrap: anywhere; }
    .loader { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,.15); border-top-color: white; border-radius: 50%; margin-bottom: 14px; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .overlay-corner { position: absolute; top: 12px; left: 12px; max-width: min(360px, calc(100% - 70px)); padding: 10px 14px; border-radius: 8px; font-size: 12px; line-height: 1.5; z-index: 5; box-shadow: 0 4px 12px rgba(0,0,0,.2); }
    .overlay-warn { background: #fff0ef; color: #b42318; border: 1px solid #f6cfcb; }
    .overlay-info { background: #fff6e8; color: #7a4a0c; border: 1px solid #efc98f; }
    .overlay-debug { background: #ffffff; color: #172535; border: 1px solid #dfe5ea; max-width: min(520px, calc(100% - 70px)) !important; }
    .overlay-corner em { font-style: normal; font-weight: 700; }
    .link-btn { padding: 0; border: 0; background: none; color: #1267dd; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
    .txt-green { color: #13875a; font-weight: 700; }
    .txt-red { color: #b42318; font-weight: 700; }
    .map-legend { position: absolute; left: 12px; bottom: 34px; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; max-width: calc(100% - 24px); padding: 7px 10px; border: 1px solid #dfe5ea; border-radius: 8px; background: rgba(255,255,255,.95); box-shadow: 0 2px 8px rgba(15,23,42,.15); font-size: 11px; color: #334250; box-sizing: border-box; }
    .map-legend span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
    .map-legend b { color: #667582; }
    .map-legend i { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.15); }
    .map-legend small { flex-basis: 100%; display: inline-flex; align-items: center; gap: 5px; color: #667582; font-size: 11px; }
    .map-legend .down-dot { width: 8px; height: 8px; background: #b42318; }
    .side-panel { position: absolute; top: 12px; right: 52px; z-index: 6; display: flex; flex-direction: column; width: 330px; max-height: calc(100% - 70px); background: #fff; border: 1px solid #dfe5ea; border-radius: 8px; box-shadow: 0 10px 30px rgba(15,23,42,.22); }
    .side-panel header { display: flex; gap: 8px; align-items: flex-start; padding: 12px 12px 8px; border-bottom: 1px solid #edf0f3; }
    .side-panel h3 { margin: 0; font-size: 14px; color: #172535; }
    .side-panel header p { margin: 3px 0 0; font-size: 12px; line-height: 1.4; color: #667582; }
    .close { flex-shrink: 0; width: 28px; height: 28px; display: grid; place-items: center; margin-left: auto; border: 1px solid #dfe5ea; border-radius: 6px; background: #fff; color: #667582; cursor: pointer; }
    .panel-search { display: flex; align-items: center; gap: 6px; margin: 8px 12px 4px; padding: 0 9px; height: 32px; border: 1px solid #ccd6de; border-radius: 6px; color: #667582; }
    .panel-search input { flex: 1; min-width: 0; border: 0; outline: 0; font: inherit; font-size: 12px; color: #172535; background: transparent; }
    .side-panel ul { list-style: none; margin: 0; padding: 4px 0; overflow: auto; }
    .side-panel li { display: flex; align-items: center; gap: 8px; padding: 7px 12px; }
    .side-panel li + li { border-top: 1px solid #f1f3f5; }
    .side-panel .who { flex: 1; padding: 0; border: 0; background: none; font: inherit; text-align: left; cursor: pointer; }
    button.who:hover strong { color: #1267dd; text-decoration: underline; }
    .side-panel .dot { flex-shrink: 0; width: 10px; height: 10px; border-radius: 50%; }
    .dist { font-size: 12px; color: #172535; white-space: nowrap; }
    .tag { flex-shrink: 0; padding: 2px 7px; border-radius: 999px; background: #eef1f4; color: #52606d; font-size: 11px; font-style: normal; font-weight: 700; }
    .go { flex-shrink: 0; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px; color: #1267dd; }
    .go:hover { background: #edf4ff; }
    .panel-empty { margin: 0; padding: 14px 12px; font-size: 12px; color: #667582; text-align: center; }
    @media (max-width: 640px) {
      .page { padding: 10px 12px 16px; height: calc(100vh - 64px); }
      .filters { width: 100%; min-width: 0; box-sizing: border-box; }
      .filters > * { min-width: 0; max-width: 100%; }
      .search-box { flex: 1 1 100%; }
      .search-input { width: 100%; }
      .search-input input { width: 100%; }
      .suggest { width: 100%; }
      .filters select { flex: 1 1 40%; }
      .btn-icon span { display: none; }
      .locate span { display: inline; }
      .map-wrapper { min-height: 420px; }
      .map-legend { bottom: 30px; }
      .side-panel { top: auto; left: 8px; right: 8px; bottom: 8px; width: auto; max-height: 60%; }
    }
    @media (prefers-reduced-motion: reduce) { .pulse-dot, .spinning { animation: none; } }
    :host ::ng-deep .maplibregl-map { position: relative; overflow: hidden; width: 100%; height: 100%; }
    :host ::ng-deep .maplibregl-canvas-container { position: absolute; inset: 0; width: 100%; height: 100%; }
    :host ::ng-deep .maplibregl-canvas { position: absolute; inset: 0; }
    :host ::ng-deep .maplibregl-marker { position: absolute; top: 0; left: 0; will-change: transform; }
    :host ::ng-deep .maplibregl-control-container { position: absolute; inset: 0; pointer-events: none; }
    :host ::ng-deep .maplibregl-ctrl-top-right,
    :host ::ng-deep .maplibregl-ctrl-bottom-right,
    :host ::ng-deep .maplibregl-ctrl-bottom-left { position: absolute; pointer-events: auto; }
    :host ::ng-deep .maplibregl-ctrl-top-right { top: 10px; right: 10px; }
    :host ::ng-deep .maplibregl-ctrl-bottom-right { right: 10px; bottom: 10px; }
    :host ::ng-deep .maplibregl-ctrl-bottom-left { left: 10px; bottom: 10px; }
    :host ::ng-deep .maplibregl-popup { max-width: 280px !important; }
    :host ::ng-deep .maplibregl-popup-content { border-radius: 12px !important; padding: 14px !important; box-shadow: 0 8px 30px rgba(0,0,0,.25) !important; }
    :host ::ng-deep .me-dot { width: 16px; height: 16px; border-radius: 50%; background: #1267dd; border: 3px solid #fff; box-shadow: 0 0 0 6px rgba(18,103,221,.25), 0 2px 6px rgba(0,0,0,.35); }
  `]
})
export class MapaComponent implements OnInit, OnDestroy, AfterViewInit {
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private db = inject(LocalDbService);
  private audit = inject(NetworkAuditService);

  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>;

  allClients = signal<MapClient[]>([]);
  filtered = signal<MapClient[]>([]);
  loading = signal(false);
  loadError = signal<string | null>(null);
  lastUpdate = signal('');
  mapBooting = signal(true);
  mapBootError = signal<string | null>(null);
  stats = signal<{ totalClients: number; withGpsTecnico: number; withCoordsWispHub: number; shownInMap: number; skippedBadCoords: number; localGps?: number; localFallback?: number } | null>(null);

  search = signal('');
  suggestOpen = signal(false);
  estadoFilter = '';
  viewMode: '3d' | '2d' = '3d';

  readonly chips: Array<{ id: Chip; label: string; hint: string }> = [
    { id: 'all', label: 'Todos', hint: 'Mostrar todos los clientes con ubicación' },
    { id: 'online', label: 'En línea', hint: 'Con servicio en la última lectura automática de la red' },
    { id: 'offline', label: 'Caídos', hint: 'Sin servicio en la última lectura automática de la red' },
    { id: 'moroso', label: 'Morosos', hint: 'Suspendidos o con facturas pendientes' },
  ];
  chip = signal<Chip>('all');
  colorMode = signal<ColorMode>('account');
  panel = signal<Panel>('none');

  /** Estado de conexión por cliente según la auditoría de red (lecturas automáticas cada 10 min). */
  netState = signal<Map<number, NetInfo>>(new Map());
  netLoaded = signal(false);
  netLoading = signal(false);
  netUnavailable = signal(false);
  private netLatestAt = signal<string | null>(null);

  noGps = signal<NoGpsClient[]>([]);
  noGpsTerm = signal('');
  noGpsFiltered = computed(() => {
    const term = this.noGpsTerm().trim().toLowerCase();
    const list = this.noGps();
    if (!term) return list;
    return list.filter(c => [c.nombre, c.zona, c.direccion, c.ip].some(v => (v || '').toLowerCase().includes(term)));
  });

  readonly canLocate = typeof navigator !== 'undefined' && !!navigator.geolocation;
  locating = signal(false);
  myLocation = signal<{ lat: number; lng: number; accuracy: number | null } | null>(null);
  nearby = computed(() => {
    const me = this.myLocation();
    if (!me) return [];
    return this.filtered()
      .map(c => ({ c, meters: this.distanceMeters(me.lat, me.lng, c.lat, c.lng) }))
      .sort((a, b) => a.meters - b.meters)
      .slice(0, 10);
  });

  suggestions = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return [];
    const matches = (values: Array<string | null | undefined>) => values.some(v => (v || '').toLowerCase().includes(term));
    const withGps = this.allClients()
      .filter(c => matches([c.nombre, c.ip, c.telefono, c.zona, String(c.id)]))
      .slice(0, 8)
      .map(c => ({ id: c.id, nombre: c.nombre, hasGps: true, color: this.markerColor(c), sub: [c.ip, c.zona, this.netLabel(c.id)].filter(Boolean).join(' · ') || (c.estado || '') }));
    const noGps = withGps.length >= 8 ? [] : this.noGps()
      .filter(c => matches([c.nombre, c.ip, c.zona, String(c.id)]))
      .slice(0, 8 - withGps.length)
      .map(c => ({ id: c.id, nombre: c.nombre, hasGps: false, color: '', sub: '' }));
    return [...withGps, ...noGps];
  });

  netOfflineCount = computed(() => this.allClients().filter(c => this.netState().get(c.id)?.state === 'offline').length);

  legend = computed(() => {
    const clients = this.allClients();
    this.netState();
    const count = (color: string) => clients.filter(c => this.markerColor(c) === color).length;
    if (this.colorMode() === 'network') {
      return [
        { label: 'En línea', color: '#13875a', count: count('#13875a'), hint: 'Con servicio y sin problemas' },
        { label: 'Con problemas', color: '#b36b12', count: count('#b36b12'), hint: 'Con servicio pero con señal débil u otro aviso' },
        { label: 'Caído', color: '#b42318', count: count('#b42318'), hint: 'Sin servicio en la última lectura' },
        { label: 'Sin lectura', color: '#8792a0', count: count('#8792a0'), hint: 'La auditoría no tiene datos de hoy de este cliente' },
      ];
    }
    return [
      { label: 'Activo', color: '#13875a', count: count('#13875a'), hint: 'Cuenta activa y al día' },
      { label: 'Suspendido o con pago pendiente', color: '#b42318', count: count('#b42318'), hint: 'Moroso' },
      { label: 'Cortado', color: '#8792a0', count: count('#8792a0'), hint: 'Servicio cortado' },
      { label: 'Otro estado', color: '#1267dd', count: count('#1267dd'), hint: 'Gratis, retirado u otro' },
    ];
  });

  netNote = computed(() => {
    if (this.netLoading()) return 'Cargando el estado de conexión…';
    if (this.netUnavailable()) return 'No se pudo leer el estado de conexión. Pulse recargar para intentar de nuevo.';
    if (!this.netLoaded()) return '';
    const at = this.netLatestAt();
    return at ? `Conexión según la lectura automática de ${this.relative(at)}.` : 'Todavía no hay lecturas automáticas de hoy.';
  });

  private map: MapLibreMap | null = null;
  private markers: Marker[] = [];
  private markerById = new Map<number, Marker>();
  private meMarker: Marker | null = null;
  private refreshTimer: any = null;
  private currentBearing = 0;
  private didAutoFit = false;
  private mapGeneration = 0;
  private fallbackActive = false;
  private fallbackTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingFocusId: number | null = null;
  private suggestTimer: ReturnType<typeof setTimeout> | null = null;

  countBySource(s: string): number {
    return this.allClients().filter(c => s === 'tecnico' ? c.source === 'tecnico' || c.source === 'local' : c.source === s).length;
  }

  ngOnInit() {
    this.restorePrefs();
    const focus = Number(this.route.snapshot.queryParamMap.get('cliente'));
    if (focus) {
      this.pendingFocusId = focus;
      this.didAutoFit = true; // no encuadrar todo: vamos directo al cliente pedido
    }
    this.reload();
    this.refreshTimer = setInterval(() => this.reload(true), 30000);
    if (this.colorMode() === 'network' || this.chip() === 'online' || this.chip() === 'offline') this.loadNetState();
  }

  ngAfterViewInit() {
    // El div #mapEl ya existe. Esperar 2 frames para asegurar dimensiones reales.
    requestAnimationFrame(() => requestAnimationFrame(() => this.bootMap()));
  }

  ngOnDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.fallbackTimeout) clearTimeout(this.fallbackTimeout);
    if (this.suggestTimer) clearTimeout(this.suggestTimer);
    if (this.map) { this.map.remove(); this.map = null; }
  }

  private bootMap() {
    this.mapBooting.set(true);
    this.mapBootError.set(null);
    this.fallbackActive = false;
    this.mapGeneration += 1;
    const generation = this.mapGeneration;
    if (this.fallbackTimeout) {
      clearTimeout(this.fallbackTimeout);
      this.fallbackTimeout = null;
    }
    for (const marker of this.markers) marker.remove();
    this.markers = [];
    this.markerById.clear();
    this.meMarker = null;
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    try {
      const el = this.mapEl?.nativeElement;
      if (!el) throw new Error('Contenedor del mapa no encontrado');
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        el.style.minHeight = '600px';
      }
      this.initMap(STYLE_URL, generation, false);
    } catch (e: any) {
      console.error('[mapa] boot error:', e);
      this.mapBootError.set('Detalle técnico: ' + (e?.message || e));
      this.mapBooting.set(false);
    }
  }

  retryMap() {
    this.bootMap();
  }

  private initMap(style: any, generation: number, isFallback: boolean) {
    const map = new maplibregl.Map({
      container: this.mapEl.nativeElement,
      style,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: this.viewMode === '3d' ? 55 : 0,
      bearing: 0,
      antialias: true,
      maxBounds: [[-72.5, 17.3], [-68.0, 20.2]],
    });
    this.map = map;

    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');

    const isCurrentMap = () => generation === this.mapGeneration && this.map === map;
    const switchToFallback = () => {
      if (!isCurrentMap() || this.fallbackActive) return;
      console.warn('[mapa] retrying with raster fallback');
      this.fallbackActive = true;
      if (this.fallbackTimeout) {
        clearTimeout(this.fallbackTimeout);
        this.fallbackTimeout = null;
      }
      map.remove();
      if (this.map === map) this.map = null;
      this.initMap(FALLBACK_STYLE, generation, true);
    };

    map.on('load', () => {
      if (!isCurrentMap()) return;
      this.mapBooting.set(false);
      this.render();
      this.renderMe();
    });

    map.on('error', (e: any) => {
      if (!isCurrentMap()) return;
      const msg = e?.error?.message || String(e?.error || e);
      console.warn('[mapa] error:', msg);
      const networkStyleError = /Failed to fetch|NetworkError|CORS|404|Unable to/i.test(msg);
      if (!isFallback && networkStyleError && this.mapBooting()) {
        switchToFallback();
      }
    });

    // Safety net: si en 8s no carga, forzar fallback raster
    if (!isFallback) {
      this.fallbackTimeout = setTimeout(() => {
        if (isCurrentMap() && this.mapBooting()) {
          console.warn('[mapa] timeout cargando vector, forzando raster');
          switchToFallback();
        }
      }, 8000);
    }
  }

  changeView() {
    this.savePrefs();
    if (!this.map) return;
    if (this.viewMode === '3d') {
      this.map.easeTo({ pitch: 55, bearing: this.currentBearing, duration: 800 });
    } else {
      this.map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
      this.currentBearing = 0;
    }
  }

  rotateView() {
    if (!this.map) return;
    this.currentBearing = (this.currentBearing + 45) % 360;
    this.map.easeTo({ bearing: this.currentBearing, duration: 600 });
  }

  goHome() {
    if (!this.map) return;
    this.currentBearing = 0;
    this.map.easeTo({
      center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM,
      pitch: this.viewMode === '3d' ? 55 : 0,
      bearing: 0, duration: 1000,
    });
  }

  reload(silent = false) {
    if (!silent) this.loading.set(true);
    this.loadError.set(null);
    // El estado de conexión solo se vuelve a pedir al recargar a mano (no en el refresco automático de 30 s).
    if (!silent && this.netLoaded()) this.loadNetState();
    this.http.get<any>('/db/clients/map').subscribe({
      next: (r) => {
        void this.loadLocalMapClients().then((localClients) => {
          const serverClients = this.normalizeMapClients(r.clients || []);
          const merged = this.mergeMapClients(serverClients, localClients);
          const localFallback = merged.filter((c) => c.source === 'local').length;
          const localGps = localClients.filter((c) => c.source === 'local').length;
          const stats = {
            ...(r.stats || {}),
            totalClients: Math.max(r.stats?.totalClients || 0, localClients.length),
            withGpsTecnico: Math.max(r.stats?.withGpsTecnico || 0, localGps),
            shownInMap: merged.length,
            localGps,
            localFallback,
          };
          this.allClients.set(merged);
          this.stats.set(stats);
          this.lastUpdate.set(new Date().toLocaleTimeString('es-DO'));
          if (!silent) this.loading.set(false);
          void this.updateNoGps(merged);
          if (this.map) this.render();
        }).catch(() => {
          this.allClients.set(this.normalizeMapClients(r.clients || []));
          this.stats.set(r.stats || null);
          this.lastUpdate.set(new Date().toLocaleTimeString('es-DO'));
          if (!silent) this.loading.set(false);
          if (this.map) this.render();
        });
      },
      error: (e) => {
        void this.loadLocalMapClients().then((localClients) => {
          this.allClients.set(localClients);
          this.stats.set({
            totalClients: localClients.length,
            withGpsTecnico: localClients.filter((c) => c.source === 'local').length,
            withCoordsWispHub: localClients.filter((c) => c.source === 'wisphub').length,
            shownInMap: localClients.length,
            skippedBadCoords: 0,
            localGps: localClients.filter((c) => c.source === 'local').length,
            localFallback: localClients.length,
          });
          this.lastUpdate.set(new Date().toLocaleTimeString('es-DO'));
          this.loadError.set(localClients.length ? null : (e.error?.error || e.message || 'Error de red'));
          if (!silent) this.loading.set(false);
          void this.updateNoGps(localClients);
          if (this.map) this.render();
        }).catch(() => {
          if (!silent) this.loading.set(false);
          this.loadError.set(e.error?.error || e.message || 'Error de red');
        });
      },
    });
  }

  /**
   * Estado de conexión de hoy por cliente, tomado de la auditoría de red (datos ya guardados en el servidor,
   * no consulta el MikroTik). Se pide solo cuando se usa el filtro/colores de conexión o al recargar a mano.
   */
  loadNetState() {
    if (this.netLoading()) return;
    this.netLoading.set(true);
    const pageSize = 200;
    this.audit.clients({ days: 1, page: 1, pageSize }).pipe(
      switchMap(first => {
        const rest = Array.from({ length: Math.max(0, first.pages - 1) }, (_, i) => this.audit.clients({ days: 1, page: i + 2, pageSize }));
        return (rest.length ? forkJoin(rest) : of([])).pipe(map(pages => [first, ...pages]));
      }),
    ).subscribe({
      next: pages => {
        const state = new Map<number, NetInfo>();
        let latest: string | null = null;
        for (const row of pages.flatMap(page => page.items)) {
          state.set(row.idServicio, { state: row.latestState, at: row.lastCapturedAt });
          if (row.lastCapturedAt && (!latest || row.lastCapturedAt > latest)) latest = row.lastCapturedAt;
        }
        this.netState.set(state);
        this.netLatestAt.set(latest);
        this.netLoaded.set(true);
        this.netUnavailable.set(false);
        this.netLoading.set(false);
        if (this.map) this.render();
      },
      error: () => {
        this.netLoading.set(false);
        this.netUnavailable.set(true);
        if (!this.netLoaded() && (this.chip() === 'online' || this.chip() === 'offline')) {
          this.toast.error('No se pudo leer el estado de conexión de los clientes. Intente de nuevo.');
        }
      },
    });
  }

  private async updateNoGps(onMap: MapClient[]) {
    try {
      const shown = new Set(onMap.map(c => c.id));
      const clients = await this.db.getClients();
      const list = clients
        .filter(c => !shown.has(c.id_servicio) && String(c.estado || '').toLowerCase() !== 'retirado')
        .map<NoGpsClient>(c => ({ id: c.id_servicio, nombre: c.nombre, estado: c.estado || null, zona: c.zona?.nombre || null, direccion: c.direccion || null, ip: c.ip || null }))
        .sort((a, b) => Number(b.estado === 'Activo') - Number(a.estado === 'Activo') || (a.nombre || '').localeCompare(b.nombre || ''));
      this.noGps.set(list);
    } catch {
      /* sin la lista local no se puede calcular; el contador queda como estaba */
    }
  }

  private normalizeMapClients(clients: any[]): MapClient[] {
    return clients
      .map((c) => ({
        ...c,
        lat: Number(c.lat),
        lng: Number(c.lng),
        source: c.source || 'tecnico',
      }))
      .filter((c) => this.isValidLatLng(c.lat, c.lng));
  }

  private async loadLocalMapClients(): Promise<MapClient[]> {
    const clients = await this.db.getClients();
    return clients.map((c) => this.localClientToMap(c)).filter((c): c is MapClient => !!c);
  }

  private localClientToMap(c: WispHubClient): MapClient | null {
    let lat = typeof c.gpsLat === 'number' ? c.gpsLat : null;
    let lng = typeof c.gpsLng === 'number' ? c.gpsLng : null;
    let source: MapClient['source'] = lat != null && lng != null ? 'local' : null;

    if ((lat == null || lng == null) && c.coordenadas) {
      const parsed = this.parseCoords(c.coordenadas);
      if (parsed) {
        lat = parsed.lat;
        lng = parsed.lng;
        source = 'wisphub';
      }
    }

    if (lat == null || lng == null || !this.isValidLatLng(lat, lng)) return null;
    return {
      id: c.id_servicio,
      nombre: c.nombre,
      telefono: c.telefono || null,
      ip: c.ip || null,
      plan: c.plan_internet?.nombre || null,
      estado: c.estado || null,
      estadoFacturas: c.estado_facturas || null,
      zona: c.zona?.nombre || null,
      direccion: c.direccion || null,
      lat,
      lng,
      accuracy: c.gpsAccuracy ?? null,
      capturedAt: c.gpsCapturedAt ?? null,
      source,
    };
  }

  private mergeMapClients(serverClients: MapClient[], localClients: MapClient[]): MapClient[] {
    const byId = new Map<number, MapClient>();
    for (const c of serverClients) byId.set(c.id, c);
    for (const c of localClients) {
      const existing = byId.get(c.id);
      if (!existing || c.source === 'local') byId.set(c.id, c);
    }
    return Array.from(byId.values());
  }

  private parseCoords(value: string): { lat: number; lng: number } | null {
    const parts = value.split(/[,\s]+/).filter(Boolean);
    if (parts.length < 2) return null;
    const lat = Number(parts[0]);
    const lng = Number(parts[1]);
    return this.isValidLatLng(lat, lng) ? { lat, lng } : null;
  }

  private isValidLatLng(lat: number, lng: number): boolean {
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  // ─── Filtros y búsqueda ───

  onSearch(value: string) {
    this.search.set(value || '');
    this.suggestOpen.set(true);
    this.render();
  }

  closeSuggestSoon() {
    if (this.suggestTimer) clearTimeout(this.suggestTimer);
    this.suggestTimer = setTimeout(() => this.suggestOpen.set(false), 150);
  }

  pickFirst() {
    const first = this.suggestions()[0];
    if (!first) return;
    if (first.hasGps) this.focusClient(first.id);
    else void this.router.navigate(['/clients', first.id]);
  }

  onEscape() {
    if (this.suggestOpen()) this.suggestOpen.set(false);
    else if (this.panel() !== 'none') this.panel.set('none');
  }

  setChip(chip: Chip) {
    this.chip.set(chip);
    if ((chip === 'online' || chip === 'offline') && !this.netLoaded()) this.loadNetState();
    this.savePrefs();
    this.render();
  }

  setColorMode(mode: ColorMode) {
    this.colorMode.set(mode);
    if (mode === 'network' && !this.netLoaded()) this.loadNetState();
    this.savePrefs();
    this.render();
  }

  togglePanel(panel: Panel) {
    this.panel.set(this.panel() === panel ? 'none' : panel);
  }

  clearFilters() {
    this.search.set('');
    this.estadoFilter = '';
    this.chip.set('all');
    this.savePrefs();
    this.render();
  }

  /** Número a mostrar en cada chip; los de conexión quedan vacíos hasta que se pida ese dato. */
  chipBadge(chip: Chip): string {
    const clients = this.allClients();
    if (chip === 'all') return String(clients.length);
    if (chip === 'moroso') return String(clients.filter(c => this.isMoroso(c)).length);
    if (this.netLoading() && !this.netLoaded()) return '…';
    if (!this.netLoaded()) return '';
    return String(clients.filter(c => this.matchesChip(c, chip)).length);
  }

  private matchesChip(c: MapClient, chip: Chip): boolean {
    if (chip === 'moroso') return this.isMoroso(c);
    if (chip === 'online' || chip === 'offline') {
      const state = this.netState().get(c.id)?.state;
      if (!state || state === 'unknown') return false;
      return chip === 'offline' ? state === 'offline' : state !== 'offline';
    }
    return true;
  }

  private isMoroso(c: MapClient): boolean {
    return c.estado === 'Suspendido' || /pendiente/i.test(c.estadoFacturas || '');
  }

  private restorePrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (['all', 'online', 'offline', 'moroso'].includes(saved.chip)) this.chip.set(saved.chip);
      if (saved.colorMode === 'account' || saved.colorMode === 'network') this.colorMode.set(saved.colorMode);
      if (saved.viewMode === '2d' || saved.viewMode === '3d') this.viewMode = saved.viewMode;
    } catch { /* preferencias no disponibles */ }
  }

  private savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ chip: this.chip(), colorMode: this.colorMode(), viewMode: this.viewMode }));
    } catch { /* sin almacenamiento */ }
  }

  render() {
    if (!this.map) return;
    for (const m of this.markers) m.remove();
    this.markers = [];
    this.markerById.clear();

    const term = this.search().toLowerCase().trim();
    const chip = this.chip();
    const filtered = this.allClients().filter(c => {
      if (term) {
        const hay = (c.nombre || '').toLowerCase().includes(term)
          || (c.ip || '').includes(term)
          || (c.telefono || '').includes(term)
          || (c.zona || '').toLowerCase().includes(term);
        if (!hay) return false;
      }
      if (this.estadoFilter && c.estado !== this.estadoFilter) return false;
      if (chip !== 'all' && !this.matchesChip(c, chip)) return false;
      return true;
    });
    this.filtered.set(filtered);

    const renderClients = this.withVisualOffsets(filtered);

    for (const c of renderClients) {
      const color = this.markerColor(c);
      const net = this.netState().get(c.id);
      const label = (text: string) => '<strong style="color:#172535">' + text + ':</strong> ';
      const netLine = net && net.state !== 'unknown'
        ? label('Conexión') + '<span style="color:' + this.netColor(net.state) + ';font-weight:700">' + this.escape(this.netStateLabel(net.state)) + '</span>'
          + (net.at ? ' <small style="color:#8792a0">(' + this.escape(this.relative(net.at)) + ')</small>' : '') + '<br>'
        : '';
      const popupHtml = `
        <div style="font-weight:700;color:#172535;font-size:14px;margin-bottom:6px">
          ${this.escape(c.nombre || '—')} ${this.badgeFor(c)}
        </div>
        <div style="font-size:12px;color:#667582;line-height:1.6">
          ${netLine}
          ${c.plan ? label('Plan') + this.escape(formatPlanName(c.plan)) + '<br>' : ''}
          ${c.estado ? label('Estado') + this.escape(c.estado) + '<br>' : ''}
          ${c.estadoFacturas ? label('Facturas') + this.escape(c.estadoFacturas) + '<br>' : ''}
          ${c.ip ? label('IP') + '<span style="font-family:ui-monospace,\'Cascadia Mono\',Consolas,monospace">' + this.escape(c.ip) + '</span><br>' : ''}
          ${c.telefono ? label('Teléfono') + this.escape(c.telefono) + '<br>' : ''}
          ${c.zona ? label('Zona') + this.escape(c.zona) + '<br>' : ''}
          ${c.direccion ? '<em>' + this.escape(c.direccion) + '</em><br>' : ''}
          ${c.overlapCount > 1 ? '<strong style="color:#b36b12">Nota:</strong> hay ' + c.overlapCount + ' clientes en este mismo punto; los marcadores se separaron un poco para poder verlos.<br>' : ''}
          <small style="color:#8792a0">Ubicación: ${c.source === 'wisphub' ? 'WispHub' : 'GPS del técnico'}${c.accuracy ? ' · precisión ±' + Math.round(c.accuracy) + ' m' : ''}</small>
        </div>
      `;
      const content = document.createElement('div');
      content.innerHTML = popupHtml;
      const actions = document.createElement('div');
      actions.setAttribute('style', 'display:flex;flex-wrap:wrap;gap:6px;margin-top:10px');
      const link = document.createElement('a');
      link.href = `/clients/${c.id}`;
      link.textContent = 'Ver ficha del cliente';
      link.setAttribute('style', 'display:inline-block;background:#1267dd;color:white;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none');
      // Navegación interna (sin recargar toda la aplicación)
      link.addEventListener('click', (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        void this.router.navigate(['/clients', c.id]);
      });
      const route = document.createElement('a');
      route.href = this.directionsUrl(c);
      route.target = '_blank';
      route.rel = 'noopener';
      route.textContent = 'Cómo llegar';
      route.setAttribute('style', 'display:inline-block;border:1px solid #b9cdea;background:#f2f7ff;color:#1267dd;padding:5px 11px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none');
      actions.appendChild(link);
      actions.appendChild(route);
      content.appendChild(actions);
      const popup = new Popup({ offset: 25, closeButton: true }).setDOMContent(content);
      const marker = new Marker({ element: this.createMarkerElement(color, c.nombre, net?.state === 'offline' && this.colorMode() === 'account'), anchor: 'bottom' })
        .setLngLat([c.renderLng, c.renderLat])
        .setPopup(popup)
        .addTo(this.map);
      this.markers.push(marker);
      this.markerById.set(c.id, marker);
    }

    if (this.pendingFocusId != null && this.allClients().length) {
      const id = this.pendingFocusId;
      this.pendingFocusId = null;
      setTimeout(() => this.focusClient(id), 300);
    }

    // Primera vez con data: auto-encuadrar para que el usuario vea los pins de cerca
    if (!this.didAutoFit && filtered.length > 0) {
      this.didAutoFit = true;
      setTimeout(() => this.fitAll(), 300);
    }
  }

  /** Centra el mapa en un cliente y abre su ficha rápida. Quita filtros si lo estaban ocultando. */
  focusClient(id: number) {
    this.suggestOpen.set(false);
    const client = this.allClients().find(c => c.id === id);
    if (!client) {
      const noGps = this.noGps().find(c => c.id === id);
      this.toast.info(noGps ? `${noGps.nombre} no tiene ubicación guardada. Abra su ficha para capturarla.` : 'Ese cliente no tiene ubicación en el mapa.');
      return;
    }
    if (!this.filtered().some(c => c.id === id)) {
      this.search.set('');
      this.estadoFilter = '';
      this.chip.set('all');
      this.render();
    }
    const marker = this.markerById.get(id);
    if (!this.map || !marker) return;
    const pos = marker.getLngLat();
    this.map.flyTo({ center: pos, zoom: Math.max(this.map.getZoom(), 17), pitch: this.viewMode === '3d' ? 50 : 0, duration: 900 });
    for (const m of this.markers) if (m !== marker && m.getPopup()?.isOpen()) m.togglePopup();
    if (!marker.getPopup()?.isOpen()) marker.togglePopup();
    if (window.innerWidth <= 640) this.panel.set('none');
  }

  // ─── Mi ubicación ───

  locateMe() {
    if (!this.canLocate || this.locating()) return;
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.locating.set(false);
        const me = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null };
        this.myLocation.set(me);
        this.renderMe();
        this.panel.set('near');
        this.map?.flyTo({ center: [me.lng, me.lat], zoom: 15, duration: 900 });
      },
      (err) => {
        this.locating.set(false);
        this.toast.error(err.code === err.PERMISSION_DENIED
          ? 'El navegador no dio permiso para usar su ubicación. Actívelo en la configuración del sitio e intente de nuevo.'
          : 'No se pudo obtener su ubicación. Revise que el GPS esté encendido e intente de nuevo.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  private renderMe() {
    const me = this.myLocation();
    if (!this.map || !me) return;
    if (this.meMarker) this.meMarker.remove();
    const el = document.createElement('div');
    el.className = 'me-dot';
    el.title = 'Usted está aquí';
    el.setAttribute('aria-label', 'Su ubicación');
    this.meMarker = new Marker({ element: el }).setLngLat([me.lng, me.lat]).addTo(this.map);
  }

  distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const rad = (d: number) => d * Math.PI / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  formatDistance(m: number): string {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  }

  directionsUrl(c: MapClient): string {
    return `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
  }

  isText(value: string | null): boolean { return !!value && !!value.trim(); }

  // ─── Colores y etiquetas ───

  markerColor(c: MapClient): string {
    if (this.colorMode() === 'network') {
      const state = this.netState().get(c.id)?.state;
      if (state === 'offline') return '#b42318';
      if (state === 'degraded') return '#b36b12';
      if (state === 'stable') return '#13875a';
      return '#8792a0';
    }
    return this.colorFor(c);
  }

  private netColor(state: NetworkHealthState): string {
    return state === 'offline' ? '#b42318' : state === 'degraded' ? '#b36b12' : state === 'stable' ? '#13875a' : '#8792a0';
  }

  private netStateLabel(state: NetworkHealthState): string {
    return state === 'offline' ? 'Caído' : state === 'degraded' ? 'En línea con problemas' : state === 'stable' ? 'En línea' : 'Sin lectura';
  }

  private netLabel(id: number): string {
    const state = this.netState().get(id)?.state;
    return state && state !== 'unknown' ? this.netStateLabel(state) : '';
  }

  relative(iso: string): string {
    const min = Math.floor(Math.max(0, Date.now() - new Date(iso).getTime()) / 60000);
    if (!Number.isFinite(min)) return '';
    if (min < 1) return 'hace un momento';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
  }

  private withVisualOffsets(clients: MapClient[]): RenderMapClient[] {
    const groups = new Map<string, MapClient[]>();
    for (const c of clients) {
      // Agrupa clientes a ~11m para evitar pins montados cuando se capturan en el mismo sitio.
      const key = `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`;
      const group = groups.get(key) || [];
      group.push(c);
      groups.set(key, group);
    }

    const out: RenderMapClient[] = [];
    for (const group of groups.values()) {
      if (group.length === 1) {
        const c = group[0];
        out.push({ ...c, renderLat: c.lat, renderLng: c.lng, overlapCount: 1 });
        continue;
      }

      const radius = 0.00018; // ~19m visuales, suficiente para distinguir pins en zoom 17.
      group.forEach((c, index) => {
        const angle = (Math.PI * 2 * index) / group.length;
        out.push({
          ...c,
          renderLat: c.lat + Math.sin(angle) * radius,
          renderLng: c.lng + Math.cos(angle) * radius,
          overlapCount: group.length,
        });
      });
    }
    return out;
  }

  private createMarkerElement(color: string, label: string, down = false): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('aria-label', `Cliente GPS: ${label || '-'}${down ? ' (caído)' : ''}`);
    wrapper.title = (label || 'Cliente GPS') + (down ? ' · caído en la última lectura' : '');
    wrapper.style.width = '30px';
    wrapper.style.height = '36px';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'flex-start';
    wrapper.style.justifyContent = 'center';
    wrapper.style.cursor = 'pointer';
    wrapper.style.position = 'relative';

    const pin = document.createElement('div');
    pin.style.width = '24px';
    pin.style.height = '24px';
    pin.style.background = color;
    pin.style.border = '2px solid #ffffff';
    pin.style.borderRadius = '50% 50% 50% 0';
    pin.style.boxShadow = '0 3px 10px rgba(15, 23, 42, 0.45)';
    pin.style.transform = 'rotate(-45deg)';
    pin.style.transformOrigin = 'center';

    const dot = document.createElement('div');
    dot.style.width = '8px';
    dot.style.height = '8px';
    dot.style.borderRadius = '50%';
    dot.style.background = '#ffffff';
    dot.style.margin = '7px';
    pin.appendChild(dot);
    wrapper.appendChild(pin);

    if (down) {
      const badge = document.createElement('div');
      badge.style.position = 'absolute';
      badge.style.top = '-3px';
      badge.style.right = '0';
      badge.style.width = '10px';
      badge.style.height = '10px';
      badge.style.borderRadius = '50%';
      badge.style.background = '#b42318';
      badge.style.border = '2px solid #ffffff';
      badge.style.boxShadow = '0 1px 3px rgba(0,0,0,.4)';
      wrapper.appendChild(badge);
    }
    return wrapper;
  }

  // Color HEX para el pin del cliente
  private colorFor(c: MapClient): string {
    if (c.estado === 'Suspendido' || c.estadoFacturas?.includes('endiente')) return '#b42318'; // rojo
    if (c.estado === 'Activo') return '#13875a'; // verde
    if (c.estado === 'Cortado') return '#8792a0'; // gris
    return '#1267dd'; // azul (otros: Gratis, Retirado, etc.)
  }

  fitAll() {
    if (!this.map || this.filtered().length === 0) {
      this.toast.info('No hay clientes con ubicación para mostrar');
      return;
    }
    const renderClients = this.withVisualOffsets(this.filtered());
    const bounds = new LngLatBounds();
    for (const c of renderClients) bounds.extend([c.renderLng, c.renderLat]);
    if (renderClients.length === 1) {
      const c = renderClients[0];
      this.map.easeTo({ center: [c.renderLng, c.renderLat], zoom: 17, pitch: this.viewMode === '3d' ? 55 : 0, duration: 800 });
    } else {
      this.map.fitBounds(bounds, { padding: 110, pitch: this.viewMode === '3d' ? 50 : 0, duration: 800, maxZoom: 17 });
    }
  }

  private badgeFor(c: MapClient): string {
    const badge = (bg: string, fg: string, text: string) =>
      `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-left:4px;background:${bg};color:${fg}">${text}</span>`;
    if (c.estado === 'Activo' && !c.estadoFacturas?.includes('endiente')) return badge('#e9f8f1', '#13875a', 'Activo');
    if (c.estado === 'Suspendido') return badge('#fff0ef', '#b42318', 'Suspendido');
    if (c.estadoFacturas?.includes('endiente')) return badge('#fff0ef', '#b42318', 'Pago pendiente');
    return badge('#eef1f4', '#52606d', this.escape(c.estado || 'Sin estado'));
  }
  private escape(s: any): string {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
