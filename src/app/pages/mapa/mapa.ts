import { Component, OnInit, OnDestroy, inject, signal, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { NavbarComponent } from '../../components/layout/navbar';
import { ToastService } from '../../services/toast.service';

// MapLibre GL JS - vector tiles, 3D buildings, sin API key.
// JS se carga via CDN dinamicamente para no inflar el bundle de Angular.
declare const maplibregl: any;
const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

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
            EN VIVO · {{ lastUpdate() }}
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
            <option value="satellite">Satelite-like</option>
          </select>
          <button class="btn-icon" (click)="reload()" title="Recargar">⟳</button>
          <button class="btn-icon" (click)="fitAll()" title="Ajustar a todos">🎯</button>
          <button class="btn-icon" (click)="rotateView()" title="Rotar vista">↻ Rotar</button>
        </div>
      </div>

      @if (loadError()) {
        <div class="empty">
          <h3>Error cargando datos</h3>
          <p>{{ loadError() }}</p>
        </div>
      } @else if (loading()) {
        <div class="empty">
          <div class="loader"></div>
          <p>Cargando mapa 3D...</p>
        </div>
      } @else if (allClients().length === 0) {
        <div class="empty">
          <h3>Sin clientes con GPS</h3>
          <p>Para que aparezcan, captura ubicacion desde la pagina del cliente: <strong>📍 Capturar mi ubicacion actual</strong></p>
        </div>
      }

      <div #mapEl class="map-container" [class.hidden]="loading() || allClients().length === 0"></div>
    </div>
  `,
  styles: [`
    .page { padding: 16px 24px 32px; display: flex; flex-direction: column; height: calc(100vh - 80px); }
    .toolbar {
      display: flex; justify-content: space-between; align-items: center;
      flex-wrap: wrap; gap: 12px; margin-bottom: 14px;
    }
    .kpis { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .kpi {
      background: white; border: 1px solid #e2e8f0; border-radius: 999px;
      padding: 6px 14px; font-size: 12px; color: #475569;
      display: inline-flex; align-items: center; gap: 6px;
    }
    .kpi strong { color: #0f172a; }
    .kpi-green { border-color: #86efac; background: #dcfce7; color: #166534; }
    .kpi-red { border-color: #fca5a5; background: #fee2e2; color: #991b1b; }
    .kpi-blue { border-color: #bfdbfe; background: #eff6ff; color: #1e40af; }

    .pulse-dot {
      width: 8px; height: 8px; border-radius: 50%; background: #ef4444;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%,100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
      50% { opacity: 0.6; box-shadow: 0 0 0 8px rgba(239,68,68,0); }
    }

    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .input {
      padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;
      font-size: 13px; background: white; outline: none;
    }
    .input:focus { border-color: #6366f1; }
    .btn-icon {
      background: white; border: 1px solid #e2e8f0; color: #475569;
      border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer;
    }
    .btn-icon:hover { border-color: #6366f1; color: #6366f1; }

    .map-container {
      flex: 1; min-height: 500px; border-radius: 12px; overflow: hidden;
      border: 1px solid #e2e8f0; background: #0a0e27;
    }
    .map-container.hidden { display: none; }

    .empty {
      background: white; border: 1px solid #e2e8f0; border-radius: 12px;
      padding: 60px 20px; text-align: center; color: #64748b;
    }
    .empty h3 { color: #1e293b; margin-bottom: 8px; }
    .loader {
      width: 40px; height: 40px; border: 3px solid #e2e8f0;
      border-top-color: #6366f1; border-radius: 50%; margin: 0 auto 14px;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Markers custom */
    :host ::ng-deep .marker-pin {
      width: 28px; height: 28px; border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid white; box-shadow: 0 3px 8px rgba(0,0,0,.4);
      cursor: pointer;
      transition: transform 0.2s;
    }
    :host ::ng-deep .marker-pin:hover { transform: rotate(-45deg) scale(1.2); }
    :host ::ng-deep .marker-pin.active { background: #22c55e; }
    :host ::ng-deep .marker-pin.suspended { background: #ef4444; animation: pinPulse 2s infinite; }
    :host ::ng-deep .marker-pin.cut { background: #94a3b8; }
    :host ::ng-deep .marker-pin.other { background: #6366f1; }

    @keyframes pinPulse {
      0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.6), 0 3px 8px rgba(0,0,0,.4); }
      50% { box-shadow: 0 0 0 12px rgba(239,68,68,0), 0 3px 8px rgba(0,0,0,.4); }
    }

    :host ::ng-deep .maplibregl-popup { max-width: 280px !important; }
    :host ::ng-deep .maplibregl-popup-content {
      border-radius: 12px !important; padding: 14px !important;
      box-shadow: 0 8px 30px rgba(0,0,0,.25) !important;
    }
    :host ::ng-deep .popup-name { font-weight: 700; color: #0f172a; font-size: 14px; margin-bottom: 6px; }
    :host ::ng-deep .popup-meta { font-size: 12px; color: #64748b; line-height: 1.6; }
    :host ::ng-deep .popup-meta strong { color: #0f172a; }
    :host ::ng-deep .popup-btn {
      display: inline-block; background: #6366f1; color: white !important;
      padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600;
      text-decoration: none; margin-top: 10px;
    }
    :host ::ng-deep .popup-btn:hover { background: #4f46e5; }
    :host ::ng-deep .popup-badge {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 10px; font-weight: 700; margin-left: 4px;
    }
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
  loading = signal(true);
  loadError = signal<string | null>(null);
  lastUpdate = signal('');

  search = '';
  estadoFilter = '';
  viewMode: '3d' | '2d' | 'satellite' = '3d';

  private map: any = null;
  private markers: any[] = [];
  private maplibreLoaded = false;
  private refreshTimer: any = null;
  private currentBearing = 0;

  countByEstado(e: string): number {
    return this.allClients().filter(c => c.estado === e).length;
  }
  countBySource(s: string): number {
    return this.allClients().filter(c => c.source === s).length;
  }

  async ngOnInit() {
    try {
      await this.loadMapLibre();
    } catch (e: any) {
      this.loadError.set('No se pudo cargar MapLibre: ' + e.message);
      this.loading.set(false);
      return;
    }
    this.reload();
    // Auto-refresh cada 30s
    this.refreshTimer = setInterval(() => this.reload(true), 30000);
  }

  ngAfterViewInit() {}

  ngOnDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.map) { this.map.remove(); this.map = null; }
  }

  private loadMapLibre(): Promise<void> {
    if (this.maplibreLoaded || typeof (window as any).maplibregl !== 'undefined') {
      this.maplibreLoaded = true;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = MAPLIBRE_JS;
      s.async = true;
      s.crossOrigin = '';
      s.onload = () => { this.maplibreLoaded = true; resolve(); };
      s.onerror = () => reject(new Error('CDN no disponible'));
      document.head.appendChild(s);
    });
  }

  reload(silent = false) {
    if (!silent) this.loading.set(true);
    this.loadError.set(null);
    this.http.get<any>('/db/clients/map').subscribe({
      next: (r) => {
        this.allClients.set(r.clients || []);
        this.lastUpdate.set(new Date().toLocaleTimeString('es-DO'));
        if (!silent) this.loading.set(false);
        setTimeout(() => this.initOrRender(), 0);
      },
      error: (e) => {
        if (!silent) this.loading.set(false);
        this.loadError.set(e.error?.error || e.message || 'Error de red');
      },
    });
  }

  private initOrRender() {
    if (!this.maplibreLoaded || typeof (window as any).maplibregl === 'undefined') return;
    if (this.allClients().length === 0) return;
    if (!this.map) this.initMap();
    else this.render();
  }

  private initMap() {
    const ml: any = (window as any).maplibregl;
    const first = this.allClients()[0];
    const center: [number, number] = first ? [first.lng, first.lat] : [-69.9312, 18.4861];
    this.map = new ml.Map({
      container: this.mapEl.nativeElement,
      style: STYLE_URL,
      center,
      zoom: 15,
      pitch: this.viewMode === '3d' ? 55 : 0,
      bearing: 0,
      antialias: true,
    });

    // Navigation controls (zoom, pitch, compass)
    this.map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');

    // Cuando el mapa carga, añadir 3D buildings y los markers
    this.map.on('load', () => {
      this.add3DBuildings();
      this.render();
      this.fitAll();
    });

    // Error de tiles
    this.map.on('error', (e: any) => {
      console.warn('[mapa] error:', e?.error?.message || e);
    });
  }

  private add3DBuildings() {
    // El estilo Liberty de OpenFreeMap ya incluye una capa de buildings 3D ('building-3d').
    // Si no esta, intentamos agregar una capa fill-extrusion sobre la capa "building"
    try {
      const layers = this.map.getStyle().layers || [];
      const buildLayer = layers.find((l: any) => l.id === 'building-3d' || l.id === 'building');
      if (!buildLayer) return;
      // Ya viene en el style, solo asegurarse de que sea visible
      this.map.setLayoutProperty(buildLayer.id, 'visibility', 'visible');
    } catch {}
  }

  changeView() {
    if (!this.map) return;
    if (this.viewMode === '3d') {
      this.map.easeTo({ pitch: 55, bearing: this.currentBearing, duration: 800 });
    } else if (this.viewMode === '2d') {
      this.map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
      this.currentBearing = 0;
    } else if (this.viewMode === 'satellite') {
      // El estilo Liberty no es satelite, simulamos con pitch alto + brillo bajo
      this.map.easeTo({ pitch: 70, bearing: this.currentBearing, duration: 800 });
    }
  }

  rotateView() {
    if (!this.map) return;
    this.currentBearing = (this.currentBearing + 45) % 360;
    this.map.easeTo({ bearing: this.currentBearing, duration: 600 });
  }

  render() {
    if (!this.map) return;
    const ml: any = (window as any).maplibregl;
    // Limpiar markers anteriores
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

    for (const c of filtered) {
      const el = document.createElement('div');
      el.className = 'marker-pin ' + this.classFor(c);

      const popup = new ml.Popup({ offset: 18, closeButton: true }).setHTML(`
        <div class="popup-name">
          ${this.escape(c.nombre || '-')}
          ${this.badgeFor(c)}
        </div>
        <div class="popup-meta">
          ${c.plan ? '<strong>Plan:</strong> ' + this.escape(c.plan) + '<br>' : ''}
          ${c.estado ? '<strong>Estado:</strong> ' + this.escape(c.estado) + '<br>' : ''}
          ${c.estadoFacturas ? '<strong>Facturas:</strong> ' + this.escape(c.estadoFacturas) + '<br>' : ''}
          ${c.ip ? '<strong>IP:</strong> ' + this.escape(c.ip) + '<br>' : ''}
          ${c.telefono ? '<strong>Tel:</strong> ' + this.escape(c.telefono) + '<br>' : ''}
          ${c.zona ? '<strong>Zona:</strong> ' + this.escape(c.zona) + '<br>' : ''}
          ${c.direccion ? '<em>' + this.escape(c.direccion) + '</em><br>' : ''}
          <small style="color:#94a3b8">GPS: ${c.source === 'tecnico' ? 'tecnico' : 'WispHub'}${c.accuracy ? ' · ±' + Math.round(c.accuracy) + 'm' : ''}</small>
        </div>
        <a class="popup-btn" href="/clients/${c.id}">Ver ficha del cliente</a>
      `);
      const marker = new ml.Marker({ element: el }).setLngLat([c.lng, c.lat]).setPopup(popup).addTo(this.map);
      this.markers.push(marker);
    }
  }

  fitAll() {
    if (!this.map || this.markers.length === 0) return;
    const ml: any = (window as any).maplibregl;
    const bounds = new ml.LngLatBounds();
    for (const c of this.filtered()) bounds.extend([c.lng, c.lat]);
    if (this.filtered().length === 1) {
      // Un solo marker -> centrarlo
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
    if (c.estado === 'Activo' && !c.estadoFacturas?.includes('endiente')) {
      return '<span class="popup-badge green">ACTIVO</span>';
    }
    if (c.estado === 'Suspendido' || c.estadoFacturas?.includes('endiente')) {
      return '<span class="popup-badge red">SUSPENDIDO</span>';
    }
    return '<span class="popup-badge gray">' + this.escape(c.estado || '?') + '</span>';
  }

  private escape(s: any): string {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
