import { Component, OnInit, OnDestroy, inject, signal, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { NavbarComponent } from '../../components/layout/navbar';
import { ToastService } from '../../services/toast.service';

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
  source: 'tecnico' | 'wisphub' | null;
}

@Component({
  selector: 'app-mapa',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent],
  template: `
    <app-navbar pageTitle="Mapa en Vivo" />

    <div class="page">
      <div class="toolbar">
        <div class="kpis">
          <span class="kpi">
            <span class="pulse-dot"></span>
            EN VIVO · {{ lastUpdate() || '--:--:--' }}
          </span>
          <span class="kpi"><strong>{{ filtered().length }}</strong> en mapa</span>
          <span class="kpi kpi-green"><strong>{{ countByEstado('Activo') }}</strong> activos</span>
          <span class="kpi kpi-red"><strong>{{ countByEstado('Suspendido') }}</strong> suspendidos</span>
          <span class="kpi kpi-blue"><strong>{{ countBySource('tecnico') }}</strong> GPS tecnico</span>
        </div>
        <div class="filters">
          <input type="text" placeholder="Buscar nombre/IP..." [(ngModel)]="search" (input)="render()" class="input" />
          <select [(ngModel)]="estadoFilter" (change)="render()" class="input">
            <option value="">Todos los estados</option>
            <option value="Activo">Activo</option>
            <option value="Suspendido">Suspendido</option>
            <option value="Cortado">Cortado</option>
            <option value="Retirado">Retirado</option>
          </select>
          <select [(ngModel)]="viewMode" (change)="changeView()" class="input">
            <option value="3d">Vista 3D</option>
            <option value="2d">Vista 2D plana</option>
          </select>
          <button class="btn-icon" (click)="reload()" title="Recargar">⟳</button>
          <button class="btn-icon" (click)="goHome()" title="Volver a zona norte RD">🏠 Norte RD</button>
          <button class="btn-icon" (click)="fitAll()" title="Ajustar a todos">🎯</button>
          <button class="btn-icon" (click)="rotateView()" title="Rotar vista">↻ Rotar</button>
        </div>
      </div>

      <div class="map-wrapper">
        <div #mapEl class="map-container"></div>

        @if (mapBootError()) {
          <div class="overlay overlay-error">
            <h3>No se pudo cargar el mapa</h3>
            <p>{{ mapBootError() }}</p>
            <button class="btn-icon" (click)="retryMap()">Reintentar</button>
          </div>
        } @else if (mapBooting()) {
          <div class="overlay overlay-loader">
            <div class="loader"></div>
            <p>Cargando mapa 3D...</p>
          </div>
        }

        @if (!mapBooting() && !mapBootError()) {
          @if (loadError()) {
            <div class="overlay-corner overlay-warn">
              <strong>Error cargando clientes:</strong> {{ loadError() }}
            </div>
          } @else if (allClients().length === 0 && !loading()) {
            <div class="overlay-corner overlay-info">
              <strong>Sin clientes con GPS aun.</strong>
              @if (stats(); as s) {
                <br>De {{ s.totalClients }} clientes en DB, 0 tienen GPS capturado.
              }
              <br>Captura desde la ficha de cada cliente con <em>📍 Capturar mi ubicacion actual</em>.
            </div>
          } @else if (stats(); as s) {
            <div class="overlay-corner overlay-debug">
              <strong>{{ s.totalClients }}</strong> clientes en DB ·
              <span style="color:#16a34a;font-weight:700">{{ s.withGpsTecnico }} con GPS tecnico</span> ·
              {{ s.withCoordsWispHub }} con coords WispHub ·
              <strong>{{ s.shownInMap }} en mapa</strong>
              @if (s.skippedBadCoords > 0) {
                · <span style="color:#ef4444">{{ s.skippedBadCoords }} con coords invalidas</span>
              }
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 16px 24px 32px; display: flex; flex-direction: column; height: calc(100vh - 80px); }
    .toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px; }
    .kpis { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .kpi { background: white; border: 1px solid #e2e8f0; border-radius: 999px; padding: 6px 14px; font-size: 12px; color: #475569; display: inline-flex; align-items: center; gap: 6px; }
    .kpi strong { color: #0f172a; }
    .kpi-green { border-color: #86efac; background: #dcfce7; color: #166534; }
    .kpi-red { border-color: #fca5a5; background: #fee2e2; color: #991b1b; }
    .kpi-blue { border-color: #bfdbfe; background: #eff6ff; color: #1e40af; }
    .pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239,68,68,0.5); } 50% { opacity: 0.6; box-shadow: 0 0 0 8px rgba(239,68,68,0); } }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .input { padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; background: white; outline: none; }
    .input:focus { border-color: #6366f1; }
    .btn-icon { background: white; border: 1px solid #e2e8f0; color: #475569; border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
    .btn-icon:hover { border-color: #6366f1; color: #6366f1; }
    .map-wrapper { flex: 1; min-height: 500px; position: relative; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; background: #0a0e27; }
    .map-container { position: absolute; inset: 0; width: 100%; height: 100%; }
    .overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.85); color: white; padding: 40px 20px; text-align: center; z-index: 5; }
    .overlay h3 { margin: 0 0 8px; }
    .overlay p { color: #cbd5e1; margin: 0 0 14px; }
    .overlay-error { background: rgba(127, 29, 29, 0.92); }
    .loader { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,.15); border-top-color: white; border-radius: 50%; margin-bottom: 14px; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .overlay-corner { position: absolute; top: 12px; left: 12px; max-width: 360px; padding: 10px 14px; border-radius: 10px; font-size: 12px; line-height: 1.5; z-index: 5; box-shadow: 0 4px 12px rgba(0,0,0,.2); }
    .overlay-warn { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
    .overlay-info { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
    .overlay-debug { background: #ffffff; color: #0f172a; border: 1px solid #cbd5e1; max-width: 520px !important; }
    .overlay-corner em { font-style: normal; font-weight: 700; }
    :host ::ng-deep .marker-pin { width: 28px; height: 28px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid white; box-shadow: 0 3px 8px rgba(0,0,0,.4); cursor: pointer; transition: transform 0.2s; }
    :host ::ng-deep .marker-pin:hover { transform: rotate(-45deg) scale(1.2); }
    :host ::ng-deep .marker-pin.active { background: #22c55e; }
    :host ::ng-deep .marker-pin.suspended { background: #ef4444; animation: pinPulse 2s infinite; }
    :host ::ng-deep .marker-pin.cut { background: #94a3b8; }
    :host ::ng-deep .marker-pin.other { background: #6366f1; }
    @keyframes pinPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.6), 0 3px 8px rgba(0,0,0,.4); } 50% { box-shadow: 0 0 0 12px rgba(239,68,68,0), 0 3px 8px rgba(0,0,0,.4); } }
    :host ::ng-deep .maplibregl-popup { max-width: 280px !important; }
    :host ::ng-deep .maplibregl-popup-content { border-radius: 12px !important; padding: 14px !important; box-shadow: 0 8px 30px rgba(0,0,0,.25) !important; }
    :host ::ng-deep .popup-name { font-weight: 700; color: #0f172a; font-size: 14px; margin-bottom: 6px; }
    :host ::ng-deep .popup-meta { font-size: 12px; color: #64748b; line-height: 1.6; }
    :host ::ng-deep .popup-meta strong { color: #0f172a; }
    :host ::ng-deep .popup-btn { display: inline-block; background: #6366f1; color: white !important; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; text-decoration: none; margin-top: 10px; }
    :host ::ng-deep .popup-btn:hover { background: #4f46e5; }
    :host ::ng-deep .popup-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; margin-left: 4px; }
    :host ::ng-deep .popup-badge.green { background: #dcfce7; color: #166534; }
    :host ::ng-deep .popup-badge.red { background: #fee2e2; color: #991b1b; }
    :host ::ng-deep .popup-badge.gray { background: #f1f5f9; color: #475569; }
  `]
})
export class MapaComponent implements OnInit, OnDestroy, AfterViewInit {
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  private router = inject(Router);

  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>;

  allClients = signal<MapClient[]>([]);
  filtered = signal<MapClient[]>([]);
  loading = signal(false);
  loadError = signal<string | null>(null);
  lastUpdate = signal('');
  mapBooting = signal(true);
  mapBootError = signal<string | null>(null);
  stats = signal<{ totalClients: number; withGpsTecnico: number; withCoordsWispHub: number; shownInMap: number; skippedBadCoords: number } | null>(null);

  search = '';
  estadoFilter = '';
  viewMode: '3d' | '2d' = '3d';

  private map: MapLibreMap | null = null;
  private markers: Marker[] = [];
  private refreshTimer: any = null;
  private currentBearing = 0;
  private didAutoFit = false;

  countByEstado(e: string): number { return this.allClients().filter(c => c.estado === e).length; }
  countBySource(s: string): number { return this.allClients().filter(c => c.source === s).length; }

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
    if (this.map) { this.map.remove(); this.map = null; }
  }

  private bootMap() {
    this.mapBooting.set(true);
    this.mapBootError.set(null);
    try {
      const el = this.mapEl?.nativeElement;
      if (!el) throw new Error('Contenedor del mapa no encontrado');
      const rect = el.getBoundingClientRect();
      console.log('[mapa] container size:', rect.width, 'x', rect.height);
      if (rect.width === 0 || rect.height === 0) {
        el.style.minHeight = '600px';
      }
      this.initMap(STYLE_URL);
    } catch (e: any) {
      console.error('[mapa] boot error:', e);
      this.mapBootError.set('Error inicializando mapa: ' + (e?.message || e));
      this.mapBooting.set(false);
    }
  }

  retryMap() {
    if (this.map) { this.map.remove(); this.map = null; }
    this.bootMap();
  }

  private initMap(style: any) {
    this.map = new maplibregl.Map({
      container: this.mapEl.nativeElement,
      style,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: this.viewMode === '3d' ? 55 : 0,
      bearing: 0,
      antialias: true,
      maxBounds: [[-72.5, 17.3], [-68.0, 20.2]],
    });

    this.map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');

    let fallbackUsed = style === FALLBACK_STYLE;

    this.map.on('load', () => {
      console.log('[mapa] map loaded with', fallbackUsed ? 'raster fallback' : 'vector style');
      this.mapBooting.set(false);
      this.render();
    });

    this.map.on('error', (e: any) => {
      const msg = e?.error?.message || String(e?.error || e);
      console.warn('[mapa] error:', msg);
      // Si el style URL falla (CORS, red, etc.), reintentar con raster fallback
      if (!fallbackUsed && /Failed to fetch|NetworkError|CORS|404|Unable to/i.test(msg)) {
        console.warn('[mapa] retrying with raster fallback');
        if (this.map) { this.map.remove(); this.map = null; }
        fallbackUsed = true;
        this.initMap(FALLBACK_STYLE);
      }
    });

    // Safety net: si en 8s no carga, forzar fallback raster
    setTimeout(() => {
      if (this.mapBooting() && !fallbackUsed) {
        console.warn('[mapa] timeout cargando vector, forzando raster');
        if (this.map) { this.map.remove(); this.map = null; }
        this.initMap(FALLBACK_STYLE);
      }
    }, 8000);
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
        this.allClients.set(r.clients || []);
        this.stats.set(r.stats || null);
        this.lastUpdate.set(new Date().toLocaleTimeString('es-DO'));
        console.log('[mapa] data cargada:', r.stats, 'clients:', (r.clients || []).length);
        if (!silent) this.loading.set(false);
        if (this.map) this.render();
      },
      error: (e) => {
        if (!silent) this.loading.set(false);
        this.loadError.set(e.error?.error || e.message || 'Error de red');
      },
    });
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

    console.log('[mapa] rendering', filtered.length, 'markers');
    for (const c of filtered) {
      // Usamos el marker nativo de MapLibre (sin custom HTML) para garantizar
      // que se vea siempre, sin problemas de encapsulacion CSS de Angular.
      const color = this.colorFor(c);
      const popupHtml = `
        <div style="font-weight:700;color:#0f172a;font-size:14px;margin-bottom:6px">
          ${this.escape(c.nombre || '-')} ${this.badgeFor(c)}
        </div>
        <div style="font-size:12px;color:#64748b;line-height:1.6">
          ${c.plan ? '<strong style="color:#0f172a">Plan:</strong> ' + this.escape(c.plan) + '<br>' : ''}
          ${c.estado ? '<strong style="color:#0f172a">Estado:</strong> ' + this.escape(c.estado) + '<br>' : ''}
          ${c.estadoFacturas ? '<strong style="color:#0f172a">Facturas:</strong> ' + this.escape(c.estadoFacturas) + '<br>' : ''}
          ${c.ip ? '<strong style="color:#0f172a">IP:</strong> ' + this.escape(c.ip) + '<br>' : ''}
          ${c.telefono ? '<strong style="color:#0f172a">Tel:</strong> ' + this.escape(c.telefono) + '<br>' : ''}
          ${c.zona ? '<strong style="color:#0f172a">Zona:</strong> ' + this.escape(c.zona) + '<br>' : ''}
          ${c.direccion ? '<em>' + this.escape(c.direccion) + '</em><br>' : ''}
          <small style="color:#94a3b8">GPS: ${c.source === 'tecnico' ? 'tecnico' : 'WispHub'}${c.accuracy ? ' · ±' + Math.round(c.accuracy) + 'm' : ''}</small>
        </div>
        <a href="/clients/${c.id}" style="display:inline-block;background:#6366f1;color:white;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;margin-top:10px">Ver ficha del cliente</a>
      `;
      const popup = new Popup({ offset: 25, closeButton: true }).setHTML(popupHtml);
      const marker = new Marker({ color })
        .setLngLat([c.lng, c.lat])
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

  // Color HEX para el marker nativo de MapLibre
  private colorFor(c: MapClient): string {
    if (c.estado === 'Suspendido' || c.estadoFacturas?.includes('endiente')) return '#ef4444'; // rojo
    if (c.estado === 'Activo') return '#22c55e'; // verde
    if (c.estado === 'Cortado') return '#94a3b8'; // gris
    return '#6366f1'; // indigo (otros: Gratis, Retirado, etc.)
  }

  fitAll() {
    if (!this.map || this.filtered().length === 0) {
      this.toast.info('No hay clientes con GPS para encuadrar');
      return;
    }
    const bounds = new LngLatBounds();
    for (const c of this.filtered()) bounds.extend([c.lng, c.lat]);
    if (this.filtered().length === 1) {
      const c = this.filtered()[0];
      this.map.easeTo({ center: [c.lng, c.lat], zoom: 17, pitch: this.viewMode === '3d' ? 55 : 0, duration: 800 });
    } else {
      this.map.fitBounds(bounds, { padding: 80, pitch: this.viewMode === '3d' ? 50 : 0, duration: 800 });
    }
  }

  private classFor(c: MapClient): string {
    if (c.estado === 'Suspendido' || c.estadoFacturas?.includes('endiente')) return 'suspended';
    if (c.estado === 'Activo') return 'active';
    if (c.estado === 'Cortado') return 'cut';
    return 'other';
  }
  private badgeFor(c: MapClient): string {
    if (c.estado === 'Activo' && !c.estadoFacturas?.includes('endiente')) return '<span class="popup-badge green">ACTIVO</span>';
    if (c.estado === 'Suspendido' || c.estadoFacturas?.includes('endiente')) return '<span class="popup-badge red">SUSPENDIDO</span>';
    return '<span class="popup-badge gray">' + this.escape(c.estado || '?') + '</span>';
  }
  private escape(s: any): string {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
