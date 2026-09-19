import { Component, OnInit, OnDestroy, inject, signal, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { NavbarComponent } from '../../components/layout/navbar';
import { LucideCrosshair, LucideHouse, LucideRefreshCw, LucideRotateCw, LucideSearch } from '@lucide/angular';
import { formatPlanName } from '../../pipes/plan-label.pipe';
import { ToastService } from '../../services/toast.service';
import { LocalDbService } from '../../services/local-db.service';
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

@Component({
  selector: 'app-mapa',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent, LucideCrosshair, LucideHouse, LucideRefreshCw, LucideRotateCw, LucideSearch],
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
          <span class="kpi kpi-green"><strong>{{ countByEstado('Activo') }}</strong> activos</span>
          <span class="kpi kpi-red"><strong>{{ countByEstado('Suspendido') }}</strong> suspendidos</span>
          <span class="kpi kpi-blue" title="Ubicación capturada en sitio por un técnico"><strong>{{ countBySource('tecnico') }}</strong> con GPS del técnico</span>
        </div>
        <div class="filters">
          <label class="input search-input">
            <svg lucideSearch size="15" aria-hidden="true"></svg>
            <input type="search" placeholder="Buscar nombre, IP o teléfono" [(ngModel)]="search" (input)="render()" aria-label="Buscar cliente en el mapa" />
          </label>
          <select [(ngModel)]="estadoFilter" (change)="render()" class="input" aria-label="Filtrar por estado">
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
            <span><i style="background:#13875a"></i>Activo</span>
            <span><i style="background:#b42318"></i>Suspendido o con pago pendiente</span>
            <span><i style="background:#8792a0"></i>Cortado</span>
            <span><i style="background:#1267dd"></i>Otro estado</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; background: #f8fafc; }
    .page { padding: 16px 24px 24px; display: flex; flex-direction: column; height: calc(100vh - 80px); box-sizing: border-box; color: #334250; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px; }
    .kpis { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .kpi { background: white; border: 1px solid #dfe5ea; border-radius: 999px; padding: 6px 12px; font-size: 12px; color: #334250; display: inline-flex; align-items: center; gap: 6px; }
    .kpi strong { color: #172535; }
    .kpi-green { border-color: #c7ebd9; background: #e9f8f1; color: #13875a; }
    .kpi-red { border-color: #f6cfcb; background: #fff0ef; color: #b42318; }
    .kpi-blue { border-color: #cfe0f8; background: #edf4ff; color: #1267dd; }
    .kpi-green strong, .kpi-red strong, .kpi-blue strong { color: inherit; }
    .pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: #13875a; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; box-shadow: 0 0 0 0 rgba(19,135,90,0.45); } 50% { opacity: 0.6; box-shadow: 0 0 0 7px rgba(19,135,90,0); } }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .input { height: 36px; box-sizing: border-box; padding: 0 12px; border: 1px solid #ccd6de; border-radius: 6px; font-size: 13px; color: #334250; background: white; outline: none; }
    .input:focus, .search-input:focus-within { border-color: #1267dd; box-shadow: 0 0 0 2px #edf4ff; }
    .search-input { display: inline-flex; align-items: center; gap: 6px; color: #667582; }
    .search-input input { width: 190px; border: 0; outline: 0; font-size: 13px; color: #172535; background: transparent; }
    .btn-icon { display: inline-flex; align-items: center; gap: 6px; height: 36px; background: white; border: 1px solid #ccd6de; color: #334250; border-radius: 6px; padding: 0 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn-icon:hover:not(:disabled) { border-color: #b9cdea; background: #f2f7ff; color: #1267dd; }
    .btn-icon:disabled { opacity: .6; cursor: wait; }
    .btn-icon:focus-visible, .input:focus-visible { outline: 2px solid #1267dd; outline-offset: 2px; }
    .spinning { animation: spin .8s linear infinite; }
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
    .txt-green { color: #13875a; font-weight: 700; }
    .txt-red { color: #b42318; font-weight: 700; }
    .map-legend { position: absolute; left: 12px; bottom: 34px; z-index: 5; display: flex; flex-wrap: wrap; gap: 6px 12px; max-width: calc(100% - 24px); padding: 7px 10px; border: 1px solid #dfe5ea; border-radius: 8px; background: rgba(255,255,255,.95); box-shadow: 0 2px 8px rgba(15,23,42,.15); font-size: 11px; color: #334250; }
    .map-legend span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
    .map-legend i { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.15); }
    @media (max-width: 640px) {
      .page { padding: 10px 12px 16px; height: calc(100vh - 64px); }
      .filters { width: 100%; }
      .search-input { flex: 1 1 100%; }
      .search-input input { width: 100%; }
      .filters select { flex: 1 1 40%; }
      .btn-icon span { display: none; }
      .map-wrapper { min-height: 420px; }
      .map-legend { bottom: 30px; }
    }
    @media (prefers-reduced-motion: reduce) { .pulse-dot, .spinning { animation: none; } }
    .overlay-corner em { font-style: normal; font-weight: 700; }
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
    :host ::ng-deep .marker-pin { width: 28px; height: 28px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid white; box-shadow: 0 3px 8px rgba(0,0,0,.4); cursor: pointer; transition: transform 0.2s; }
    :host ::ng-deep .marker-pin:hover { transform: rotate(-45deg) scale(1.2); }
    :host ::ng-deep .marker-pin.active { background: #22c55e; }
    :host ::ng-deep .marker-pin.suspended { background: #ef4444; animation: pinPulse 2s infinite; }
    :host ::ng-deep .marker-pin.cut { background: #94a3b8; }
    :host ::ng-deep .marker-pin.other { background: #1267dd; }
    @keyframes pinPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.6), 0 3px 8px rgba(0,0,0,.4); } 50% { box-shadow: 0 0 0 12px rgba(239,68,68,0), 0 3px 8px rgba(0,0,0,.4); } }
    :host ::ng-deep .maplibregl-popup { max-width: 280px !important; }
    :host ::ng-deep .maplibregl-popup-content { border-radius: 12px !important; padding: 14px !important; box-shadow: 0 8px 30px rgba(0,0,0,.25) !important; }
    :host ::ng-deep .popup-name { font-weight: 700; color: #0f172a; font-size: 14px; margin-bottom: 6px; }
    :host ::ng-deep .popup-meta { font-size: 12px; color: #64748b; line-height: 1.6; }
    :host ::ng-deep .popup-meta strong { color: #0f172a; }
    :host ::ng-deep .popup-btn { display: inline-block; background: #1267dd; color: white !important; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; text-decoration: none; margin-top: 10px; }
    :host ::ng-deep .popup-btn:hover { background: #0d58c0; }
    :host ::ng-deep .popup-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; margin-left: 4px; }
    :host ::ng-deep .popup-badge.green { background: #dcfce7; color: #166534; }
    :host ::ng-deep .popup-badge.red { background: #fee2e2; color: #991b1b; }
    :host ::ng-deep .popup-badge.gray { background: #f1f5f9; color: #475569; }
  `]
})
export class MapaComponent implements OnInit, OnDestroy, AfterViewInit {
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  private router = inject(Router);
  private db = inject(LocalDbService);

  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>;

  allClients = signal<MapClient[]>([]);
  filtered = signal<MapClient[]>([]);
  loading = signal(false);
  loadError = signal<string | null>(null);
  lastUpdate = signal('');
  mapBooting = signal(true);
  mapBootError = signal<string | null>(null);
  stats = signal<{ totalClients: number; withGpsTecnico: number; withCoordsWispHub: number; shownInMap: number; skippedBadCoords: number; localGps?: number; localFallback?: number } | null>(null);

  search = '';
  estadoFilter = '';
  viewMode: '3d' | '2d' = '3d';

  private map: MapLibreMap | null = null;
  private markers: Marker[] = [];
  private refreshTimer: any = null;
  private currentBearing = 0;
  private didAutoFit = false;
  private mapGeneration = 0;
  private fallbackActive = false;
  private fallbackTimeout: ReturnType<typeof setTimeout> | null = null;

  countByEstado(e: string): number { return this.allClients().filter(c => c.estado === e).length; }
  countBySource(s: string): number {
    return this.allClients().filter(c => s === 'tecnico' ? c.source === 'tecnico' || c.source === 'local' : c.source === s).length;
  }

  ngOnInit() {
    this.reload();
    this.refreshTimer = setInterval(() => this.reload(true), 30000);
  }

  ngAfterViewInit() {
    // El div #mapEl ya existe. Esperar 2 frames para asegurar dimensiones reales.
    requestAnimationFrame(() => requestAnimationFrame(() => this.bootMap()));
  }

  ngOnDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.fallbackTimeout) clearTimeout(this.fallbackTimeout);
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
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    try {
      const el = this.mapEl?.nativeElement;
      if (!el) throw new Error('Contenedor del mapa no encontrado');
      const rect = el.getBoundingClientRect();
      console.log('[mapa] container size:', rect.width, 'x', rect.height);
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
      console.log('[mapa] map loaded with', isFallback ? 'raster fallback' : 'vector style');
      this.mapBooting.set(false);
      this.render();
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
          console.log('[mapa] data cargada:', stats, 'clients:', merged.length);
          if (!silent) this.loading.set(false);
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
          if (this.map) this.render();
        }).catch(() => {
          if (!silent) this.loading.set(false);
          this.loadError.set(e.error?.error || e.message || 'Error de red');
        });
      },
    });
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

  render() {
    if (!this.map) return;
    for (const m of this.markers) m.remove();
    this.markers = [];

    const term = (this.search || '').toLowerCase().trim();
    const filtered = this.allClients().filter(c => {
      if (term) {
        const hay = (c.nombre || '').toLowerCase().includes(term)
          || (c.ip || '').includes(term)
          || (c.telefono || '').includes(term);
        if (!hay) return false;
      }
      if (this.estadoFilter && c.estado !== this.estadoFilter) return false;
      return true;
    });
    this.filtered.set(filtered);

    const renderClients = this.withVisualOffsets(filtered);

    console.log('[mapa] rendering', renderClients.length, 'markers');
    for (const c of renderClients) {
      const color = this.colorFor(c);
      const label = (text: string) => '<strong style="color:#172535">' + text + ':</strong> ';
      const popupHtml = `
        <div style="font-weight:700;color:#172535;font-size:14px;margin-bottom:6px">
          ${this.escape(c.nombre || '—')} ${this.badgeFor(c)}
        </div>
        <div style="font-size:12px;color:#667582;line-height:1.6">
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
      const link = document.createElement('a');
      link.href = `/clients/${c.id}`;
      link.textContent = 'Ver ficha del cliente';
      link.setAttribute('style', 'display:inline-block;background:#1267dd;color:white;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;margin-top:10px');
      // Navegación interna (sin recargar toda la aplicación)
      link.addEventListener('click', (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        void this.router.navigate(['/clients', c.id]);
      });
      content.appendChild(link);
      const popup = new Popup({ offset: 25, closeButton: true }).setDOMContent(content);
      const marker = new Marker({ element: this.createMarkerElement(color, c.nombre), anchor: 'bottom' })
        .setLngLat([c.renderLng, c.renderLat])
        .setPopup(popup)
        .addTo(this.map);
      this.markers.push(marker);
    }
    console.log('[mapa] markers attached:', this.markers.length);

    // Primera vez con data: auto-encuadrar para que el usuario vea los pins de cerca
    if (!this.didAutoFit && filtered.length > 0) {
      this.didAutoFit = true;
      setTimeout(() => this.fitAll(), 300);
    }
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

  private createMarkerElement(color: string, label: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('aria-label', `Cliente GPS: ${label || '-'}`);
    wrapper.title = label || 'Cliente GPS';
    wrapper.style.width = '30px';
    wrapper.style.height = '36px';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'flex-start';
    wrapper.style.justifyContent = 'center';
    wrapper.style.cursor = 'pointer';

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

  private classFor(c: MapClient): string {
    if (c.estado === 'Suspendido' || c.estadoFacturas?.includes('endiente')) return 'suspended';
    if (c.estado === 'Activo') return 'active';
    if (c.estado === 'Cortado') return 'cut';
    return 'other';
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
