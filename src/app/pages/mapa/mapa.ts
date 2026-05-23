import { Component, OnInit, OnDestroy, inject, signal, computed, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { NavbarComponent } from '../../components/layout/navbar';
import { ToastService } from '../../services/toast.service';

// Carga Leaflet dinamicamente desde CDN solo cuando se abre el mapa (no infla bundle)
declare const L: any;
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

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
    <app-navbar pageTitle="Mapa de Clientes" />

    <div class="page">
      <div class="toolbar">
        <div class="kpis">
          <span class="kpi"><strong>{{ filtered().length }}</strong> mostrando</span>
          <span class="kpi kpi-green"><strong>{{ countByEstado('Activo') }}</strong> activos</span>
          <span class="kpi kpi-red"><strong>{{ countByEstado('Suspendido') }}</strong> suspendidos</span>
          <span class="kpi kpi-blue"><strong>{{ countBySource('tecnico') }}</strong> GPS tecnico</span>
          <span class="kpi kpi-gray"><strong>{{ countBySource('wisphub') }}</strong> GPS WispHub</span>
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
          <select [(ngModel)]="sourceFilter" (change)="render()" class="input">
            <option value="">Cualquier GPS</option>
            <option value="tecnico">Solo GPS tecnico</option>
            <option value="wisphub">Solo GPS WispHub</option>
          </select>
          <button class="btn-icon" (click)="reload()" title="Recargar">⟳</button>
          <button class="btn-icon" (click)="fitAll()" title="Ajustar a todos">🎯</button>
        </div>
      </div>

      @if (loadError()) {
        <div class="empty">
          <h3>Error cargando datos</h3>
          <p>{{ loadError() }}</p>
        </div>
      } @else if (loading()) {
        <div class="empty">Cargando mapa...</div>
      } @else if (allClients().length === 0) {
        <div class="empty">
          <h3>Sin clientes con GPS</h3>
          <p>Para que aparezcan clientes aqui, captura su ubicacion desde la pagina del cliente.</p>
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
    .kpis { display: flex; gap: 10px; flex-wrap: wrap; }
    .kpi {
      background: white; border: 1px solid #e2e8f0; border-radius: 999px;
      padding: 6px 14px; font-size: 12px; color: #475569;
    }
    .kpi strong { color: #0f172a; }
    .kpi-green { border-color: #86efac; background: #dcfce7; color: #166534; }
    .kpi-red { border-color: #fca5a5; background: #fee2e2; color: #991b1b; }
    .kpi-blue { border-color: #bfdbfe; background: #eff6ff; color: #1e40af; }
    .kpi-gray { border-color: #cbd5e1; background: #f1f5f9; color: #475569; }

    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .input {
      padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;
      font-size: 13px; background: white; outline: none;
    }
    .input:focus { border-color: #6366f1; }
    .btn-icon {
      background: white; border: 1px solid #e2e8f0; color: #475569;
      border-radius: 8px; padding: 6px 12px; font-size: 16px; cursor: pointer;
    }
    .btn-icon:hover { border-color: #6366f1; color: #6366f1; }

    .map-container {
      flex: 1; min-height: 400px; border-radius: 12px; overflow: hidden;
      border: 1px solid #e2e8f0;
    }
    .map-container.hidden { display: none; }

    .empty {
      background: white; border: 1px solid #e2e8f0; border-radius: 12px;
      padding: 60px 20px; text-align: center; color: #64748b;
    }
    .empty h3 { color: #1e293b; margin-bottom: 8px; }

    :host ::ng-deep .popup-name { font-weight: 700; color: #0f172a; font-size: 14px; margin-bottom: 4px; }
    :host ::ng-deep .popup-meta { font-size: 12px; color: #64748b; line-height: 1.5; }
    :host ::ng-deep .popup-meta strong { color: #0f172a; }
    :host ::ng-deep .popup-btn {
      display: inline-block; background: #6366f1; color: white !important;
      padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600;
      text-decoration: none; margin-top: 8px;
    }
    :host ::ng-deep .popup-btn:hover { background: #4f46e5; }
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

  search = '';
  estadoFilter = '';
  sourceFilter = '';

  private map: any = null;
  private markers: any[] = [];
  private leafletLoaded = false;

  countByEstado(e: string): number {
    return this.allClients().filter(c => c.estado === e).length;
  }
  countBySource(s: string): number {
    return this.allClients().filter(c => c.source === s).length;
  }

  async ngOnInit() {
    await this.loadLeaflet();
    this.reload();
  }

  ngAfterViewInit() {
    // Map se inicializa una vez tenemos data + el div
  }

  ngOnDestroy() {
    if (this.map) { this.map.remove(); this.map = null; }
  }

  private loadLeaflet(): Promise<void> {
    if (this.leafletLoaded || typeof (window as any).L !== 'undefined') {
      this.leafletLoaded = true;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LEAFLET_JS;
      s.async = true;
      s.crossOrigin = '';
      s.onload = () => { this.leafletLoaded = true; resolve(); };
      s.onerror = () => reject(new Error('No se pudo cargar Leaflet desde CDN'));
      document.head.appendChild(s);
    });
  }

  reload() {
    this.loading.set(true);
    this.loadError.set(null);
    this.http.get<any>('/db/clients/map').subscribe({
      next: (r) => {
        this.allClients.set(r.clients || []);
        this.loading.set(false);
        // Esperar siguiente tick para que el div del mapa este visible
        setTimeout(() => this.initOrRender(), 0);
      },
      error: (e) => {
        this.loading.set(false);
        this.loadError.set(e.error?.error || e.message || 'Error de red');
      },
    });
  }

  private initOrRender() {
    if (!this.leafletLoaded || typeof (window as any).L === 'undefined') return;
    if (this.allClients().length === 0) return;
    if (!this.map) this.initMap();
    this.render();
  }

  private initMap() {
    const Lmod: any = (window as any).L;
    // Centro inicial: primer cliente con GPS o RD genericamente (18.4861, -69.9312)
    const first = this.allClients()[0];
    const center = first ? [first.lat, first.lng] : [18.4861, -69.9312];
    this.map = Lmod.map(this.mapEl.nativeElement, {
      center, zoom: 14, scrollWheelZoom: true,
    });
    Lmod.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(this.map);
  }

  render() {
    if (!this.map) return;
    const Lmod: any = (window as any).L;
    // Limpiar markers anteriores
    for (const m of this.markers) this.map.removeLayer(m);
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
      if (this.sourceFilter && c.source !== this.sourceFilter) return false;
      return true;
    });
    this.filtered.set(filtered);

    for (const c of filtered) {
      const color = this.colorFor(c);
      const icon = Lmod.divIcon({
        className: 'custom-pin',
        html: `<div style="
          background:${color}; width:14px; height:14px; border-radius:50%;
          border:2px solid white; box-shadow:0 1px 4px rgba(0,0,0,.4);
        "></div>`,
        iconSize: [18, 18], iconAnchor: [9, 9],
      });
      const marker = Lmod.marker([c.lat, c.lng], { icon }).addTo(this.map);
      const popup = `
        <div class="popup-name">${this.escape(c.nombre || '-')}</div>
        <div class="popup-meta">
          ${c.plan ? '<strong>Plan:</strong> ' + this.escape(c.plan) + '<br>' : ''}
          ${c.estado ? '<strong>Estado:</strong> ' + this.escape(c.estado) + '<br>' : ''}
          ${c.estadoFacturas ? '<strong>Facturas:</strong> ' + this.escape(c.estadoFacturas) + '<br>' : ''}
          ${c.ip ? '<strong>IP:</strong> ' + this.escape(c.ip) + '<br>' : ''}
          ${c.telefono ? '<strong>Tel:</strong> ' + this.escape(c.telefono) + '<br>' : ''}
          ${c.zona ? '<strong>Zona:</strong> ' + this.escape(c.zona) + '<br>' : ''}
          ${c.direccion ? '<em>' + this.escape(c.direccion) + '</em><br>' : ''}
          <small style="color:#94a3b8">GPS: ${c.source === 'tecnico' ? 'tecnico' : 'WispHub'}</small>
        </div>
        <a class="popup-btn" href="/clients/${c.id}">Ver cliente</a>
      `;
      marker.bindPopup(popup);
      this.markers.push(marker);
    }
  }

  fitAll() {
    if (!this.map || this.markers.length === 0) return;
    const Lmod: any = (window as any).L;
    const group = Lmod.featureGroup(this.markers);
    this.map.fitBounds(group.getBounds().pad(0.1));
  }

  private colorFor(c: MapClient): string {
    if (c.estado === 'Suspendido' || c.estadoFacturas?.includes('endiente')) return '#ef4444';
    if (c.estado === 'Activo') return '#22c55e';
    if (c.estado === 'Cortado') return '#94a3b8';
    return '#6366f1';
  }

  private escape(s: any): string {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
