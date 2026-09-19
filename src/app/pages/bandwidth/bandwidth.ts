import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideActivity, LucideArrowDown, LucideArrowUp, LucideAudioWaveform, LucideInfo, LucidePlay } from '@lucide/angular';
import { NavbarComponent } from '../../components/layout/navbar';
import { BandwidthService, SpeedResult } from '../../services/bandwidth.service';
import { LocalDbService } from '../../services/local-db.service';
import { WispHubClient } from '../../models/client.model';
import { ToastService } from '../../services/toast.service';
import { DbService } from '../../services/db.service';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PlanLabelPipe } from '../../pipes/plan-label.pipe';
import { LinkTestComponent } from './link-test';
import { SpeedHistoryComponent } from './speed-history';
import { PLAN_OK_PCT, PlanComparison, PlanLevel, compareToPlan, parsePlanSpeed, planLevelLabel } from './speed-utils';

@Component({
  selector: 'app-bandwidth',
  standalone: true,
  imports: [
    NavbarComponent, FormsModule, DecimalPipe, PlanLabelPipe, SpeedHistoryComponent, LinkTestComponent,
    LucideActivity, LucideArrowDown, LucideArrowUp, LucideAudioWaveform, LucideInfo, LucidePlay,
  ],
  template: `
    <app-navbar pageTitle="Prueba de velocidad" />

    <div class="page">
      <app-link-test [clients]="clients()" />

      <div class="info-banner">
        <svg lucideInfo size="20" aria-hidden="true"></svg>
        <div>
          <strong>Dos pruebas distintas</strong>
          <p>Arriba, <b>desde el MikroTik</b>: qué velocidad le permite el router a un cliente, cuánta usa y si su equipo responde; se puede hacer desde la oficina.
             Abajo, <b>desde este dispositivo</b> (PC, celular o tableta) hacia internet: mide la salida real, y para que valga por un cliente hay que hacerla conectado a la red de su casa. Cada resultado queda en el historial.</p>
        </div>
      </div>

      <section class="card test-card">
        <h3>Prueba de internet desde este dispositivo</h3>

        <div class="client-selector">
          <label for="bw-client">Cliente (opcional)</label>
          <div class="client-picker">
            <input type="search" class="form-input" placeholder="Buscar cliente por nombre o IP" aria-label="Buscar cliente"
              [ngModel]="clientSearch()" (ngModelChange)="clientSearch.set($event)" [disabled]="testing()" />
            <select id="bw-client" [ngModel]="selectedClientId()" (ngModelChange)="selectedClientId.set($event)" class="form-input" [disabled]="testing()">
              <option [ngValue]="0">Sin cliente (prueba general)</option>
              @for (c of clientOptions(); track c.id_servicio) {
                <option [ngValue]="c.id_servicio">{{ c.nombre }} · {{ c.plan_internet?.nombre | planLabel }}</option>
              }
            </select>
          </div>
          @if (clientSearch() && clientOptions().length === 0) {
            <small class="hint">Ningún cliente activo coincide con «{{ clientSearch() }}».</small>
          } @else if (clientSearch()) {
            <small class="hint">{{ clientOptions().length }} {{ clientOptions().length === 1 ? 'cliente coincide' : 'clientes coinciden' }}.</small>
          }
        </div>

        <div class="speed-test-area">
          <div class="gauge-row">
            <div class="gauge" [class.active]="phase() === 'down'">
              <div class="gauge-icon down"><svg lucideArrowDown size="26" aria-hidden="true"></svg></div>
              <div class="gauge-value">{{ currentDown() | number:'1.1-1' }}</div>
              <div class="gauge-unit">Mbps</div>
              <div class="gauge-label">Descarga</div>
            </div>
            <div class="gauge" [class.active]="phase() === 'up'">
              <div class="gauge-icon up"><svg lucideArrowUp size="26" aria-hidden="true"></svg></div>
              <div class="gauge-value">{{ currentUp() | number:'1.1-1' }}</div>
              <div class="gauge-unit">Mbps</div>
              <div class="gauge-label">Subida</div>
            </div>
            <div class="gauge" [class.active]="phase() === 'ping'">
              <div class="gauge-icon ping"><svg lucideActivity size="26" aria-hidden="true"></svg></div>
              <div class="gauge-value">{{ currentPing() | number:'1.0-0' }}</div>
              <div class="gauge-unit">ms</div>
              <div class="gauge-label">Latencia (ping)</div>
            </div>
            <div class="gauge" title="Cuánto varía la latencia entre mediciones. Menos es mejor.">
              <div class="gauge-icon jitter"><svg lucideAudioWaveform size="26" aria-hidden="true"></svg></div>
              <div class="gauge-value">{{ currentJitter() | number:'1.1-1' }}</div>
              <div class="gauge-unit">ms</div>
              <div class="gauge-label">Variación (jitter)</div>
            </div>
          </div>

          @if (testing()) {
            <div class="progress-bar" role="progressbar" [attr.aria-valuenow]="progress()" aria-valuemin="0" aria-valuemax="100">
              <div class="progress-fill" [style.width.%]="progress()"></div>
            </div>
            <div class="progress-text" aria-live="polite">{{ phaseText() }} No cierre esta pantalla.</div>
          }

          <button class="btn btn-primary big-btn" type="button" (click)="startTest()" [disabled]="testing()">
            @if (testing()) {
              <div class="btn-spinner"></div>
              <span>{{ phaseText() || 'Preparando…' }}</span>
            } @else {
              <svg lucidePlay size="18" aria-hidden="true"></svg>
              <span>{{ history().length ? 'Iniciar otra prueba' : 'Iniciar prueba' }}</span>
            }
          </button>

          @if (!testing() && lastResult(); as res) {
            <div class="verdict" [class]="'verdict ' + lastVerdict().level" aria-live="polite">
              @if (lastVerdict().plan; as plan) {
                <div class="verdict-head">
                  <span class="verdict-badge">{{ levelLabel(lastVerdict().level) }}</span>
                  <strong>{{ res.clientName }}: la descarga llegó al {{ lastVerdict().pct | number:'1.0-0' }} % del plan</strong>
                </div>
                <div class="verdict-bars">
                  <div>
                    <span>Descarga <b>{{ res.downloadMbps | number:'1.1-1' }}</b> de {{ plan.down | number:'1.0-1' }} Mbps</span>
                    <div class="vbar"><i [style.width.%]="Math.min(100, lastVerdict().pct || 0)"></i><em [style.left.%]="okPct"></em></div>
                  </div>
                  <div>
                    <span>Subida <b>{{ res.uploadMbps | number:'1.1-1' }}</b> de {{ plan.up | number:'1.0-1' }} Mbps</span>
                    <div class="vbar"><i [style.width.%]="Math.min(100, lastVerdict().upPct || 0)"></i><em [style.left.%]="okPct"></em></div>
                  </div>
                </div>
                <p>
                  @if (lastVerdict().level === 'ok') { El cliente recibe la velocidad contratada. }
                  @else { Por debajo del {{ okPct }} % del plan. Repita la prueba con cable y con los demás equipos desconectados; si sigue baja, revise la señal de la ONU y la cola del cliente. }
                </p>
              } @else if (res.clientId) {
                <p>No se pudo leer la velocidad del plan de {{ res.clientName }} para compararla. Revise el nombre del plan en su ficha.</p>
              } @else {
                <p>Prueba general guardada. Para compararla con un plan, elija el cliente antes de iniciar la prueba.</p>
              }
            </div>
          } @else if (!testing() && selectedPlan(); as plan) {
            <p class="plan-hint">Plan del cliente: <b>{{ plan.down | number:'1.0-1' }} Mbps de bajada / {{ plan.up | number:'1.0-1' }} Mbps de subida</b>. Al terminar verá si cumple.</p>
          }
        </div>
      </section>

      @if (planCapacity().length) {
        <section class="capacity-section">
          <h3>Demanda estimada por plan</h3>
          <p class="section-note">Cálculo aproximado: velocidad del plan × clientes activos × 30 % de uso simultáneo.</p>
          <div class="capacity-grid">
            @for (p of planCapacity(); track p.name) {
              <div class="cap-card">
                <div class="cap-head">
                  <strong [title]="p.name">{{ p.name | planLabel }}</strong>
                  <span>{{ p.count }} {{ p.count === 1 ? 'cliente' : 'clientes' }}</span>
                </div>
                <div class="cap-bar">
                  <div class="cap-fill" [style.width.%]="p.pct"></div>
                </div>
                <div class="cap-metric">
                  <strong>~{{ p.estimatedBandwidth | number:'1.0-0' }} Mbps</strong>
                  <span>en hora pico</span>
                </div>
              </div>
            }
          </div>
        </section>
      }

      <app-speed-history [history]="history()" [planById]="planById()" />
    </div>
  `,
  styles: [`
    :host { display: block; background: #f8fafc; min-height: 100%; }
    .page { padding: 24px 28px 40px; max-width: 1280px; color: #334250; }

    .info-banner {
      display: flex; gap: 12px; align-items: flex-start;
      background: #f2f7ff; border: 1px solid #cfe0f8; border-radius: 8px;
      padding: 12px 16px; margin-bottom: 18px; color: #1267dd;
    }
    .info-banner svg { flex-shrink: 0; margin-top: 2px; }
    .info-banner strong { display: block; font-size: 13px; color: #172535; }
    .info-banner p { margin: 2px 0 0; font-size: 13px; color: #334250; line-height: 1.5; }

    .card { background: white; border: 1px solid #dfe5ea; border-radius: 8px; padding: 20px; margin-bottom: 18px; }
    .card h3, .capacity-section h3 { margin: 0 0 14px; font-size: 16px; font-weight: 700; color: #172535; }

    .client-selector { margin-bottom: 18px; }
    .client-selector label { display: block; font-size: 12px; font-weight: 600; color: #334250; margin-bottom: 6px; }
    .client-picker { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(220px, 2fr); gap: 8px; }
    .hint { display: block; margin-top: 5px; color: #667582; font-size: 12px; }

    .form-input {
      width: 100%; height: 40px; padding: 0 12px; border: 1px solid #ccd6de; border-radius: 6px;
      font-size: 13px; color: #334250; background: #fff; outline: none; box-sizing: border-box;
    }
    .form-input:focus { border-color: #1267dd; box-shadow: 0 0 0 2px #edf4ff; }
    .form-input:disabled { background: #f8fafc; color: #8792a0; }

    .gauge-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
    .gauge { min-width: 0; background: #f8fafc; border: 1px solid #dfe5ea; border-radius: 8px; padding: 16px 10px; text-align: center; transition: border-color .3s, background .3s; }
    .gauge.active { border-color: #1267dd; background: #edf4ff; animation: pulse 1s infinite; }
    @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(18,103,221,0.35); } 50% { box-shadow: 0 0 0 8px rgba(18,103,221,0); } }

    .gauge-icon { width: 44px; height: 44px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 8px; }
    .gauge-icon.down { background: #edf4ff; color: #1267dd; }
    .gauge-icon.up { background: #e9f8f1; color: #13875a; }
    .gauge-icon.ping { background: #fff6e8; color: #b36b12; }
    .gauge-icon.jitter { background: #eef1f4; color: #52606d; }

    .gauge-value { font-size: 26px; font-weight: 800; color: #172535; line-height: 1; font-variant-numeric: tabular-nums; }
    .gauge-unit { margin-top: 2px; font-size: 12px; color: #667582; font-weight: 600; }
    .gauge-label { font-size: 11px; color: #667582; text-transform: uppercase; font-weight: 700; margin-top: 4px; letter-spacing: .02em; }

    .progress-bar { height: 6px; background: #e6ebf0; border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
    .progress-fill { height: 100%; background: #1267dd; transition: width 0.3s; }
    .progress-text { font-size: 13px; color: #667582; text-align: center; margin-bottom: 14px; }

    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 700; cursor: pointer; border: none; transition: background .15s; }
    .btn-primary { background: #1267dd; color: white; }
    .btn-primary:hover:not(:disabled) { background: #0d58c0; }
    .btn-primary:disabled { opacity: 0.85; cursor: progress; }
    .btn:focus-visible, a:focus-visible { outline: 2px solid #1267dd; outline-offset: 2px; }
    .big-btn { width: 100%; min-height: 48px; font-size: 15px; }
    .btn-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.35); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .capacity-section { margin-bottom: 18px; }
    .capacity-section h3 { margin-bottom: 4px; }
    .section-note { margin: 0 0 12px; color: #667582; font-size: 12px; }
    .capacity-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
    .cap-card { min-width: 0; background: white; border: 1px solid #dfe5ea; border-radius: 8px; padding: 12px 14px; }
    .cap-head { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; margin-bottom: 8px; }
    .cap-head strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #172535; }
    .cap-head span { flex-shrink: 0; color: #667582; }
    .cap-bar { height: 6px; background: #e6ebf0; border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
    .cap-fill { height: 100%; background: #1267dd; }
    .cap-metric { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 12px; color: #667582; }
    .cap-metric strong { color: #172535; font-size: 13px; }

    .verdict { margin-top: 14px; padding: 14px 16px; border-radius: 8px; border: 1px solid #dfe5ea; background: #f8fafc; }
    .verdict p { margin: 8px 0 0; font-size: 13px; line-height: 1.5; color: #334250; }
    .verdict.none p { margin: 0; }
    .verdict-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .verdict-head strong { font-size: 14px; color: #172535; }
    .verdict-badge { padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 800; background: #eef1f4; color: #52606d; }
    .verdict.ok { background: #e9f8f1; border-color: #bfe5d2; } .verdict.ok .verdict-badge { background: #13875a; color: #fff; }
    .verdict.low { background: #fff6e8; border-color: #efd3a8; } .verdict.low .verdict-badge { background: #b36b12; color: #fff; }
    .verdict.bad { background: #fff0ef; border-color: #f6cfcb; } .verdict.bad .verdict-badge { background: #b42318; color: #fff; }
    .verdict-bars { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; font-size: 12px; color: #667582; }
    .verdict-bars b { color: #172535; }
    .vbar { position: relative; height: 8px; margin-top: 5px; border-radius: 4px; background: rgba(23,37,53,.1); }
    .vbar i { display: block; height: 100%; border-radius: 4px; background: #1267dd; }
    .verdict.ok .vbar i { background: #13875a; } .verdict.low .vbar i { background: #b36b12; } .verdict.bad .vbar i { background: #b42318; }
    .vbar em { position: absolute; top: -3px; bottom: -3px; width: 2px; background: #172535; opacity: .45; }
    .plan-hint { margin: 12px 0 0; font-size: 12px; color: #667582; text-align: center; }
    .plan-hint b { color: #172535; }

    @media (max-width: 720px) {
      .page { padding: 16px 12px 32px; }
      .client-picker { grid-template-columns: 1fr; }
      .gauge-row { grid-template-columns: 1fr 1fr; gap: 8px; }
      .gauge-value { font-size: 22px; }
      .card { padding: 16px 14px; }
      .verdict-bars { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      .gauge.active, .btn-spinner { animation: none; }
    }
  `]
})
export class BandwidthComponent implements OnInit {
  private bandwidth = inject(BandwidthService);
  private db = inject(LocalDbService);
  private toast = inject(ToastService);
  private serverDb = inject(DbService);

  private route = inject(ActivatedRoute);

  Math = Math;
  readonly okPct = PLAN_OK_PCT;

  clients = signal<WispHubClient[]>([]);
  /** Plan actual de cada cliente (todos los estados) para comparar el historial. */
  planById = signal<Map<number, string>>(new Map());
  selectedClientId = signal(0);
  clientSearch = signal('');
  /** Lista del selector filtrada por la búsqueda; el cliente ya elegido se mantiene visible. */
  clientOptions = computed(() => {
    const term = this.clientSearch().trim().toLowerCase();
    const all = this.clients();
    if (!term) return all;
    return all.filter(c =>
      c.id_servicio === this.selectedClientId() ||
      (c.nombre || '').toLowerCase().includes(term) ||
      (c.ip || '').includes(term));
  });

  testing = signal(false);
  phase = signal<'idle' | 'ping' | 'down' | 'up'>('idle');
  phaseText = signal('');
  progress = signal(0);

  currentDown = signal(0);
  currentUp = signal(0);
  currentPing = signal(0);
  currentJitter = signal(0);

  history = signal<SpeedResult[]>([]);
  /** Última prueba hecha en esta pantalla, para el veredicto frente al plan. */
  lastResult = signal<SpeedResult | null>(null);
  lastVerdict = computed<PlanComparison>(() => {
    const res = this.lastResult();
    if (!res) return compareToPlan(0, 0, null);
    return compareToPlan(res.downloadMbps, res.uploadMbps, res.clientId ? this.planById().get(res.clientId) : null);
  });
  selectedPlan = computed(() => {
    const id = this.selectedClientId();
    return id ? parsePlanSpeed(this.planById().get(id)) : null;
  });
  planCapacity = signal<Array<{ name: string; count: number; estimatedBandwidth: number; pct: number }>>([]);

  async ngOnInit() {
    const clients = await this.db.getClients();
    this.clients.set(clients.filter(c => c.estado?.toLowerCase() === 'activo'));
    this.planById.set(new Map(clients.filter(c => c.plan_internet?.nombre).map(c => [c.id_servicio, c.plan_internet!.nombre])));
    // Enlace directo: /bandwidth?cliente=ID deja el cliente elegido.
    const preset = Number(this.route.snapshot.queryParamMap.get('cliente'));
    if (preset && this.clients().some(c => c.id_servicio === preset)) this.selectedClientId.set(preset);
    try {
      const records = await firstValueFrom(this.serverDb.getSpeedTests(undefined, 500));
      this.history.set(records.map(record => ({
        clientId: record.idServicio,
        clientName: record.clientName,
        clientIp: record.clientIp,
        downloadMbps: record.downloadMbps,
        uploadMbps: record.uploadMbps,
        pingMs: record.pingMs,
        jitterMs: record.jitterMs,
        timestamp: record.createdAt || new Date().toISOString(),
      })));
    } catch {
      this.toast.error('No se pudo cargar el historial de velocidad');
    }
    this.computeCapacity();
  }

  computeCapacity() {
    const planMap = new Map<string, number>();
    for (const c of this.clients()) {
      const name = c.plan_internet?.nombre || 'Sin plan';
      planMap.set(name, (planMap.get(name) || 0) + 1);
    }

    const sorted = [...planMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxCount = sorted[0]?.[1] || 1;
    const caps = sorted.map(([name, count]) => {
        // Velocidad de bajada a partir del nombre del plan: "3300k" = 3.3 Mbps, "10M" = 10 Mbps.
        const match = name.match(/(\d+(?:\.\d+)?)\s*([Mk])/i);
        const mbpsPerClient = match ? Number(match[1]) / (match[2].toLowerCase() === 'k' ? 1000 : 1) : 3;
        return {
          name, count,
          estimatedBandwidth: Math.round(mbpsPerClient * count * 0.3), // 30% de uso simultáneo
          pct: Math.max(4, (count / maxCount) * 100),
        };
      });

    this.planCapacity.set(caps);
  }

  async startTest() {
    this.testing.set(true);
    this.lastResult.set(null);
    this.currentDown.set(0);
    this.currentUp.set(0);
    this.currentPing.set(0);
    this.currentJitter.set(0);

    try {
      const result = await this.bandwidth.runSpeedTest((phase, pct) => {
        this.phaseText.set(phase);
        this.progress.set(pct);
        const text = phase.toLowerCase();
        if (text.includes('latencia')) this.phase.set('ping');
        else if (text.includes('descarga')) this.phase.set('down');
        else if (text.includes('subida')) this.phase.set('up');
      });

      // Update values smoothly
      this.currentDown.set(result.downloadMbps);
      this.currentUp.set(result.uploadMbps);
      this.currentPing.set(result.pingMs);
      this.currentJitter.set(result.jitterMs);

      // Save to history
      if (this.selectedClientId()) {
        const c = this.clients().find(x => x.id_servicio === this.selectedClientId());
        if (c) {
          result.clientId = c.id_servicio;
          result.clientName = c.nombre;
          result.clientIp = c.ip;
        }
      }
      const saved = await firstValueFrom(this.serverDb.logSpeedTest({
        idServicio: result.clientId,
        clientName: result.clientName,
        clientIp: result.clientIp,
        downloadMbps: result.downloadMbps,
        uploadMbps: result.uploadMbps,
        pingMs: result.pingMs,
        jitterMs: result.jitterMs,
      }));
      result.timestamp = saved.createdAt || result.timestamp;
      this.history.update(history => [result, ...history].slice(0, 500));
      this.lastResult.set(result);

      this.toast.success(`Prueba completada: bajada ${result.downloadMbps.toFixed(1)} Mbps, subida ${result.uploadMbps.toFixed(1)} Mbps`);
    } catch (e: any) {
      this.toast.error('La prueba no pudo completarse. Revise la conexión a Internet e intente de nuevo.');
      console.warn('[bandwidth] prueba fallida', e);
    }

    this.testing.set(false);
    this.phase.set('idle');
    this.phaseText.set('');
    this.progress.set(0);
  }

  levelLabel(level: PlanLevel): string { return planLevelLabel(level); }
}
