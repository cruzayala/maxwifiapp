import { Component, OnInit, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { BandwidthService, SpeedResult } from '../../services/bandwidth.service';
import { LocalDbService } from '../../services/local-db.service';
import { WispHubClient } from '../../models/client.model';
import { ToastService } from '../../services/toast.service';
import { DbService } from '../../services/db.service';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-bandwidth',
  standalone: true,
  imports: [NavbarComponent, FormsModule, DecimalPipe, RouterLink],
  template: `
    <app-navbar pageTitle="Velocidad & Consumo" />

    <div class="page">
      <!-- INFO BANNER -->
      <div class="info-banner">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <div>
          <strong>Sobre este modulo</strong>
          <p>El speedtest mide la velocidad real desde este dispositivo (PC/celular/tablet del tecnico). Ejecutalo desde la ubicacion del cliente para medir su velocidad real. Historial se guarda localmente.</p>
        </div>
      </div>

      <!-- SPEED TEST -->
      <div class="card test-card">
        <h3>Speed Test</h3>

        <div class="client-selector">
          <label>Cliente asociado (opcional)</label>
          <select [(ngModel)]="selectedClientId" class="form-input">
            <option [ngValue]="0">Sin cliente (test general)</option>
            @for (c of clients(); track c.id_servicio) {
              <option [ngValue]="c.id_servicio">{{ c.nombre }} - {{ c.plan_internet?.nombre }}</option>
            }
          </select>
        </div>

        <div class="speed-test-area">
          <div class="gauge-row">
            <!-- DOWNLOAD -->
            <div class="gauge" [class.active]="phase() === 'down'">
              <div class="gauge-icon down">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
              </div>
              <div class="gauge-value">{{ currentDown() | number:'1.1-1' }}</div>
              <div class="gauge-unit">Mbps</div>
              <div class="gauge-label">Descarga</div>
            </div>

            <!-- UPLOAD -->
            <div class="gauge" [class.active]="phase() === 'up'">
              <div class="gauge-icon up">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
              </div>
              <div class="gauge-value">{{ currentUp() | number:'1.1-1' }}</div>
              <div class="gauge-unit">Mbps</div>
              <div class="gauge-label">Subida</div>
            </div>

            <!-- PING -->
            <div class="gauge" [class.active]="phase() === 'ping'">
              <div class="gauge-icon ping">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              </div>
              <div class="gauge-value">{{ currentPing() | number:'1.0-0' }}</div>
              <div class="gauge-unit">ms</div>
              <div class="gauge-label">Latencia</div>
            </div>

            <!-- JITTER -->
            <div class="gauge">
              <div class="gauge-icon jitter">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2 12 7 12 11 4 13 20 17 12 22 12"/></svg>
              </div>
              <div class="gauge-value">{{ currentJitter() | number:'1.1-1' }}</div>
              <div class="gauge-unit">ms</div>
              <div class="gauge-label">Jitter</div>
            </div>
          </div>

          @if (testing()) {
            <div class="progress-bar">
              <div class="progress-fill" [style.width.%]="progress()"></div>
            </div>
            <div class="progress-text">{{ phaseText() }}</div>
          }

          <button class="btn btn-primary big-btn" (click)="startTest()" [disabled]="testing()">
            @if (testing()) {
              <div class="btn-spinner"></div>
              <span>{{ phaseText() }}</span>
            } @else {
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span>Iniciar Speed Test</span>
            }
          </button>
        </div>
      </div>

      <!-- CAPACITY OVERVIEW -->
      <div class="capacity-section">
        <h3>Resumen de Capacidad por Plan</h3>
        <div class="capacity-grid">
          @for (p of planCapacity(); track p.name) {
            <div class="cap-card">
              <div class="cap-head">
                <strong>{{ p.name }}</strong>
                <span>{{ p.count }} clientes</span>
              </div>
              <div class="cap-bar">
                <div class="cap-fill" [style.width.%]="Math.min(100, (p.count / 20) * 100)"></div>
              </div>
              <div class="cap-metric">
                <span>~{{ p.estimatedBandwidth }} Mbps</span>
                <span>demanda pico estimada</span>
              </div>
            </div>
          }
        </div>
      </div>

      <!-- HISTORY -->
      <div class="card">
        <div class="card-head">
          <h3>Historial de Tests ({{ history().length }})</h3>
          @if (history().length > 0) {
            <button class="btn-sm" (click)="clearHistory()">Limpiar</button>
          }
        </div>

        @if (history().length === 0) {
          <div class="empty-msg">Aun no hay tests ejecutados</div>
        } @else {
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Descarga</th>
                  <th>Subida</th>
                  <th>Ping</th>
                  <th>Jitter</th>
                </tr>
              </thead>
              <tbody>
                @for (h of history().slice(0, 50); track h.timestamp) {
                  <tr>
                    <td data-label="Fecha">{{ formatDate(h.timestamp) }}</td>
                    <td data-label="Cliente">
                      @if (h.clientId) {
                        <a [routerLink]="['/clients', h.clientId]" class="client-link">{{ h.clientName }}</a>
                      } @else {
                        <span class="muted">Test general</span>
                      }
                    </td>
                    <td data-label="Descarga" class="speed-cell" [class]="getSpeedClass(h.downloadMbps)">
                      {{ h.downloadMbps | number:'1.1-1' }} Mbps
                    </td>
                    <td data-label="Subida" class="speed-cell" [class]="getSpeedClass(h.uploadMbps)">
                      {{ h.uploadMbps | number:'1.1-1' }} Mbps
                    </td>
                    <td data-label="Ping" class="mono">{{ h.pingMs | number:'1.0-0' }} ms</td>
                    <td data-label="Jitter" class="mono">{{ h.jitterMs | number:'1.1-1' }} ms</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 24px 32px; }

    .info-banner {
      display: flex; gap: 14px; align-items: flex-start;
      background: linear-gradient(135deg, #eff6ff, #dbeafe);
      border: 1px solid #bfdbfe; border-radius: 12px;
      padding: 14px 18px; margin-bottom: 20px; color: #1e40af;
    }
    .info-banner svg { flex-shrink: 0; margin-top: 2px; }
    .info-banner strong { display: block; font-size: 14px; color: #1e3a8a; }
    .info-banner p { margin: 2px 0 0; font-size: 13px; color: #1e40af; }

    .card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; margin-bottom: 20px; }
    .card h3 { margin: 0 0 16px; font-size: 16px; font-weight: 600; color: #0f172a; }
    .card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    .card-head h3 { margin: 0; }

    .client-selector { margin-bottom: 20px; }
    .client-selector label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px; }

    .form-input {
      width: 100%; padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 10px;
      font-size: 14px; color: #334155; outline: none; box-sizing: border-box;
    }
    .form-input:focus { border-color: #6366f1; }

    .gauge-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
    .gauge {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;
      padding: 18px; text-align: center; transition: all 0.3s;
    }
    .gauge.active { border-color: #6366f1; background: #eef2ff; animation: pulse 1s infinite; }
    @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.4); } 50% { box-shadow: 0 0 0 8px rgba(99,102,241,0); } }

    .gauge-icon {
      width: 48px; height: 48px; border-radius: 12px;
      display: inline-flex; align-items: center; justify-content: center; margin-bottom: 8px;
    }
    .gauge-icon.down { background: #dbeafe; color: #2563eb; }
    .gauge-icon.up { background: #dcfce7; color: #16a34a; }
    .gauge-icon.ping { background: #fef3c7; color: #d97706; }
    .gauge-icon.jitter { background: #faf5ff; color: #9333ea; }

    .gauge-value { font-size: 28px; font-weight: 800; color: #0f172a; line-height: 1; }
    .gauge-unit { font-size: 12px; color: #64748b; font-weight: 600; }
    .gauge-label { font-size: 12px; color: #94a3b8; text-transform: uppercase; font-weight: 600; margin-top: 4px; }

    .progress-bar {
      height: 6px; background: #f1f5f9; border-radius: 3px; overflow: hidden; margin-bottom: 8px;
    }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); transition: width 0.3s; }
    .progress-text { font-size: 13px; color: #64748b; text-align: center; margin-bottom: 16px; }

    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      padding: 12px 28px; border-radius: 10px; font-size: 14px; font-weight: 600;
      cursor: pointer; border: none; transition: all 0.2s;
    }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-primary:disabled { opacity: 0.8; cursor: not-allowed; }
    .big-btn { width: 100%; padding: 14px 28px; font-size: 15px; }
    .btn-sm {
      padding: 6px 14px; border: 1px solid #e2e8f0; border-radius: 8px;
      background: white; font-size: 12px; color: #ef4444; cursor: pointer;
    }
    .btn-sm:hover { background: #ef4444; color: white; border-color: #ef4444; }

    .btn-spinner {
      width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .capacity-section { margin-bottom: 20px; }
    .capacity-section h3 { font-size: 16px; font-weight: 600; color: #0f172a; margin: 0 0 14px; }
    .capacity-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
    .cap-card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; }
    .cap-head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; }
    .cap-head strong { color: #0f172a; }
    .cap-head span { color: #94a3b8; }
    .cap-bar { height: 6px; background: #f1f5f9; border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
    .cap-fill { height: 100%; background: linear-gradient(90deg, #22c55e, #16a34a); }
    .cap-metric { display: flex; justify-content: space-between; font-size: 11px; color: #64748b; }

    .table-container { overflow-x: auto; }
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th { text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
    .data-table td { padding: 10px 12px; font-size: 13px; color: #334155; border-bottom: 1px solid #f1f5f9; }

    .speed-cell { font-family: 'Courier New', monospace; font-weight: 600; }
    .speed-cell.good { color: #16a34a; }
    .speed-cell.warning { color: #d97706; }
    .speed-cell.bad { color: #ef4444; }
    .mono { font-family: 'Courier New', monospace; font-size: 12px; }
    .client-link { color: #6366f1; text-decoration: none; font-weight: 600; }
    .client-link:hover { text-decoration: underline; }
    .muted { color: #94a3b8; }
    .empty-msg { text-align: center; padding: 40px; color: #94a3b8; font-size: 13px; }

    @media (max-width: 640px) {
      .gauge-row { grid-template-columns: 1fr 1fr; }
      .gauge-value { font-size: 22px; }
    }
  `]
})
export class BandwidthComponent implements OnInit {
  private bandwidth = inject(BandwidthService);
  private db = inject(LocalDbService);
  private toast = inject(ToastService);
  private serverDb = inject(DbService);

  Math = Math;

  clients = signal<WispHubClient[]>([]);
  selectedClientId = 0;

  testing = signal(false);
  phase = signal<'idle' | 'ping' | 'down' | 'up'>('idle');
  phaseText = signal('');
  progress = signal(0);

  currentDown = signal(0);
  currentUp = signal(0);
  currentPing = signal(0);
  currentJitter = signal(0);

  history = signal<SpeedResult[]>([]);
  planCapacity = signal<any[]>([]);

  async ngOnInit() {
    const clients = await this.db.getClients();
    this.clients.set(clients.filter(c => c.estado?.toLowerCase() === 'activo'));
    this.history.set(this.bandwidth.getSpeedHistory());
    this.computeCapacity();
  }

  computeCapacity() {
    const planMap = new Map<string, number>();
    for (const c of this.clients()) {
      const name = c.plan_internet?.nombre || 'Sin plan';
      planMap.set(name, (planMap.get(name) || 0) + 1);
    }

    const caps = [...planMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => {
        // Estimate bandwidth from plan name (extract numbers)
        const match = name.match(/(\d+)\s*[Mk]/i);
        const mbpsPerClient = match ? parseInt(match[1]) : 3;
        return {
          name, count,
          estimatedBandwidth: Math.round(mbpsPerClient * count * 0.3) // 30% oversubscription
        };
      });

    this.planCapacity.set(caps);
  }

  async startTest() {
    this.testing.set(true);
    this.currentDown.set(0);
    this.currentUp.set(0);
    this.currentPing.set(0);
    this.currentJitter.set(0);

    try {
      const result = await this.bandwidth.runSpeedTest((phase, pct) => {
        this.phaseText.set(phase);
        this.progress.set(pct);
        if (phase.includes('latencia')) this.phase.set('ping');
        else if (phase.includes('Descarga')) this.phase.set('down');
        else if (phase.includes('Subida')) this.phase.set('up');
      });

      // Update values smoothly
      this.currentDown.set(result.downloadMbps);
      this.currentUp.set(result.uploadMbps);
      this.currentPing.set(result.pingMs);
      this.currentJitter.set(result.jitterMs);

      // Save to history
      if (this.selectedClientId) {
        const c = this.clients().find(x => x.id_servicio === this.selectedClientId);
        if (c) {
          result.clientId = c.id_servicio;
          result.clientName = c.nombre;
          result.clientIp = c.ip;
        }
      }
      this.bandwidth.saveSpeedResult(result);

      // Save to server DB for history across devices
      this.serverDb.logSpeedTest({
        idServicio: result.clientId,
        clientName: result.clientName,
        clientIp: result.clientIp,
        downloadMbps: result.downloadMbps,
        uploadMbps: result.uploadMbps,
        pingMs: result.pingMs,
        jitterMs: result.jitterMs,
      }).subscribe({ error: () => {} });

      this.history.set(this.bandwidth.getSpeedHistory());

      this.toast.success(`Test completado: ${result.downloadMbps.toFixed(1)} / ${result.uploadMbps.toFixed(1)} Mbps`);
    } catch (e: any) {
      this.toast.error('Error en test: ' + (e.message || 'falló'));
    }

    this.testing.set(false);
    this.phase.set('idle');
    this.progress.set(0);
  }

  clearHistory() {
    if (!confirm('Eliminar todo el historial de tests?')) return;
    this.bandwidth.clearSpeedHistory();
    this.history.set([]);
    this.toast.info('Historial limpiado');
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString('es-DO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  getSpeedClass(mbps: number): string {
    if (mbps >= 20) return 'good';
    if (mbps >= 5) return 'warning';
    return 'bad';
  }
}
