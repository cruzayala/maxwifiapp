import { DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideActivity, LucideArrowDown, LucideArrowUp, LucideCircleCheck, LucideGauge, LucideRouter,
  LucideTriangleAlert, LucideWifiOff,
} from '@lucide/angular';
import { WispHubClient } from '../../models/client.model';
import { formatPlanName } from '../../pipes/plan-label.pipe';
import { ToastService } from '../../services/toast.service';
import { parsePlanSpeed } from './speed-utils';

interface LinkTestResult {
  ip: string;
  client: { idServicio: number; nombre: string; plan: string | null; estado: string | null } | null;
  queue: { name: string | null; target: string | null; disabled: boolean; maxUploadBps: number; maxDownloadBps: number; comment: string | null };
  traffic: { seconds: number; avgUploadBps: number; avgDownloadBps: number; instantUploadBps: number; instantDownloadBps: number; uploadBytes: number; downloadBytes: number };
  ping: { address: string; count: number; sent: number; received: number; lossPercent: number | null; avgMs: number | null; maxMs: number | null };
  presence: { inArp: boolean; macAddress: string | null; interface: string | null };
  readAt: string;
}

/**
 * Prueba del enlace MikroTik -> equipo del cliente: qué velocidad le permite el router,
 * cuánta está usando y si el equipo responde. Solo lectura, no genera tráfico artificial.
 */
@Component({
  selector: 'app-link-test',
  standalone: true,
  imports: [
    DecimalPipe, FormsModule, RouterLink, LucideActivity, LucideArrowDown, LucideArrowUp, LucideCircleCheck,
    LucideGauge, LucideRouter, LucideTriangleAlert, LucideWifiOff,
  ],
  template: `
    <section class="card link-card">
      <header class="card-head">
        <div>
          <span class="eyebrow">Desde el MikroTik</span>
          <h2>Prueba del enlace del cliente</h2>
          <p>Mide lo que el router le entrega a ese cliente: la velocidad que tiene permitida, cuánta está usando en este momento y si su equipo responde. No consume datos del cliente.</p>
        </div>
      </header>

      <div class="link-form">
        <label class="field">
          <span>Cliente</span>
          <input type="search" list="link-test-clients" [(ngModel)]="query" (ngModelChange)="onQuery($event)" placeholder="Nombre, IP o número de servicio" aria-label="Buscar cliente para probar" />
          <datalist id="link-test-clients">
            @for (c of suggestions(); track c.id_servicio) { <option [value]="optionLabel(c)"></option> }
          </datalist>
        </label>
        <label class="field small">
          <span>Duración</span>
          <select [(ngModel)]="seconds" aria-label="Duración de la medición">
            <option [ngValue]="5">5 segundos</option>
            <option [ngValue]="8">8 segundos</option>
            <option [ngValue]="15">15 segundos</option>
          </select>
        </label>
        <button type="button" class="btn btn-primary" (click)="run()" [disabled]="running() || !selected()"
          [title]="selected() ? 'Consultar el MikroTik' : 'Elija un cliente de la lista'">
          <svg lucideActivity size="16"></svg>{{ running() ? 'Midiendo…' : 'Probar enlace' }}
        </button>
      </div>
      @if (!selected() && query.trim()) { <p class="hint">Elija un cliente de la lista para continuar.</p> }
      @if (selected(); as c) { <p class="hint selected">Se probará <b>{{ c.nombre }}</b> · IP {{ c.ip }} · plan {{ planText(c) }}</p> }

      @if (error()) { <p class="link-error" role="alert"><svg lucideTriangleAlert size="16"></svg>{{ error() }}</p> }

      @if (result(); as r) {
        <div class="verdict" [class]="'verdict ' + verdictTone()">
          @if (verdictTone() === 'ok') { <svg lucideCircleCheck size="22"></svg> } @else { <svg lucideTriangleAlert size="22"></svg> }
          <div><strong>{{ verdictTitle() }}</strong><p>{{ verdictDetail() }}</p></div>
        </div>

        <div class="result-grid">
          <article class="result-card">
            <header><svg lucideRouter size="16"></svg><span>Velocidad permitida</span></header>
            <div class="rates">
              <div><svg lucideArrowDown size="14"></svg><b>{{ mbps(r.queue.maxDownloadBps) }}</b><small>Mbps bajada</small></div>
              <div><svg lucideArrowUp size="14"></svg><b>{{ mbps(r.queue.maxUploadBps) }}</b><small>Mbps subida</small></div>
            </div>
            <footer>
              @if (planMismatch(); as diff) { <span class="warn">El plan dice {{ diff }}: revise la cola</span> }
              @else if (r.client?.plan) { <span class="ok">Coincide con su plan ({{ planLabel(r.client?.plan) }})</span> }
              @if (r.queue.disabled) { <span class="bad">La cola está pausada: el cliente no navega</span> }
            </footer>
          </article>

          <article class="result-card">
            <header><svg lucideGauge size="16"></svg><span>Uso durante la prueba</span></header>
            <div class="rates">
              <div><svg lucideArrowDown size="14"></svg><b>{{ mbps(r.traffic.avgDownloadBps) }}</b><small>Mbps bajada</small></div>
              <div><svg lucideArrowUp size="14"></svg><b>{{ mbps(r.traffic.avgUploadBps) }}</b><small>Mbps subida</small></div>
            </div>
            <div class="use-bar" [title]="usePercent() + '% de su velocidad permitida'"><i [style.width.%]="usePercent()" [class.full]="usePercent() >= 90"></i></div>
            <footer><span>{{ usePercent() }}% de lo permitido · promedio de {{ r.traffic.seconds }} s</span></footer>
          </article>

          <article class="result-card">
            <header><svg lucideActivity size="16"></svg><span>Respuesta del equipo</span></header>
            @if (r.ping.received > 0) {
              <div class="rates single">
                <div><b>{{ r.ping.avgMs !== null ? (r.ping.avgMs | number:'1.0-1') : '—' }}</b><small>ms de respuesta</small></div>
              </div>
              <footer>
                <span>{{ r.ping.received }} de {{ r.ping.sent }} respuestas@if (r.ping.maxMs !== null) { · máximo {{ r.ping.maxMs | number:'1.0-1' }} ms }</span>
                @if ((r.ping.lossPercent ?? 0) > 0) { <span class="warn">{{ r.ping.lossPercent }}% de pérdida</span> }
              </footer>
            } @else {
              <p class="no-answer"><svg lucideWifiOff size="18"></svg>El equipo no respondió al ping</p>
              <footer><span>Puede estar apagado, desconectado o con el firewall bloqueando.</span></footer>
            }
          </article>

          <article class="result-card">
            <header><svg lucideRouter size="16"></svg><span>Presencia en la red</span></header>
            <p class="presence">{{ r.presence.inArp ? 'El router ve el equipo conectado' : 'El router no ve el equipo en la red' }}</p>
            <footer>
              @if (r.presence.macAddress) { <span class="mono">{{ r.presence.macAddress }}</span> }
              @if (r.presence.interface) { <span>por {{ r.presence.interface }}</span> }
              @if (r.client?.idServicio) { <a [routerLink]="['/clients', r.client?.idServicio]">Ver expediente</a> }
            </footer>
          </article>
        </div>

        <p class="link-note">
          Esta prueba no descarga nada por la línea del cliente: lee la cola del MikroTik, su tráfico real y la respuesta del equipo.
          Para ver la velocidad máxima real, pida al cliente que descargue algo y vuelva a medir, o use la prueba desde el dispositivo del técnico
          conectado a su red.
        </p>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .link-card { padding: 16px 18px; border: 1px solid #e0e6e1; border-radius: 10px; background: #fff; }
    .eyebrow { display: block; color: #0b6b52; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .card-head h2 { margin: 3px 0 4px; color: #15211c; font-size: 17px; }
    .card-head p { margin: 0; max-width: 780px; color: #56665e; font-size: 13px; line-height: 1.5; }
    .link-form { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; margin: 14px 0 0; }
    .field { display: grid; gap: 4px; min-width: 0; flex: 1 1 280px; }
    .field.small { flex: 0 0 150px; }
    .field span { color: #56665e; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .field input, .field select { height: 40px; min-width: 0; padding: 0 11px; border: 1px solid #cfd8d2; border-radius: 9px; background: #fff; color: #15211c; font: inherit; font-size: 13px; }
    .field input:focus, .field select:focus { outline: 0; border-color: #0b6b52; box-shadow: 0 0 0 3px rgba(11, 107, 82, .1); }
    .btn { display: inline-flex; align-items: center; gap: 7px; height: 40px; padding: 0 16px; border: 1px solid transparent; border-radius: 9px; font-size: 13px; font-weight: 700; cursor: pointer; }
    .btn-primary { background: #0b6b52; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #08523f; }
    .btn:disabled { opacity: .55; cursor: not-allowed; }
    .hint { margin: 8px 0 0; color: #56665e; font-size: 12px; }
    .hint.selected b { color: #15211c; }
    .link-error { display: flex; align-items: center; gap: 7px; margin: 12px 0 0; padding: 10px 12px; border: 1px solid #f0b4ae; border-radius: 12px; background: #fff5f4; color: #b42318; font-size: 13px; }

    .verdict { display: flex; gap: 10px; align-items: flex-start; margin: 14px 0 0; padding: 12px 14px; border: 1px solid #cfe8dc; border-left: 4px solid #0f7a53; border-radius: 12px; background: #f4fbf7; }
    .verdict > svg { color: #0f7a53; flex: 0 0 auto; }
    .verdict strong { display: block; color: #15211c; font-size: 14px; }
    .verdict p { margin: 2px 0 0; color: #526b80; font-size: 13px; }
    .verdict.warn { border-color: #efcf97; border-left-color: #b36b12; background: #fffaf1; } .verdict.warn > svg { color: #b36b12; }
    .verdict.danger { border-color: #f0b4ae; border-left-color: #b42318; background: #fff6f5; } .verdict.danger > svg { color: #b42318; }

    .result-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; margin-top: 12px; }
    .result-card { min-width: 0; display: grid; align-content: start; gap: 8px; padding: 11px 12px; border: 1px solid #e3e9ee; border-radius: 12px; background: #fbfcfd; }
    .result-card > header { display: flex; align-items: center; gap: 6px; color: #56665e; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .rates { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .rates.single { grid-template-columns: 1fr; }
    .rates div { display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: 5px; }
    .rates svg { color: #0b6b52; grid-row: span 2; }
    .rates b { color: #15211c; font-size: 20px; line-height: 1.1; }
    .rates small { color: #56665e; font-size: 11px; }
    .use-bar { height: 7px; border-radius: 4px; background: #e8edf1; overflow: hidden; }
    .use-bar i { display: block; height: 100%; background: #0b6b52; } .use-bar i.full { background: #b36b12; }
    .result-card footer { display: flex; flex-wrap: wrap; gap: 3px 10px; color: #56665e; font-size: 12px; }
    .result-card footer .warn { color: #9a5b0f; font-weight: 700; }
    .result-card footer .bad { color: #b42318; font-weight: 700; }
    .result-card footer .ok { color: #0f7a53; }
    .result-card footer a { color: #0b6b52; font-weight: 700; text-decoration: none; }
    .result-card footer a:hover { text-decoration: underline; }
    .no-answer { display: flex; align-items: center; gap: 7px; margin: 0; color: #b42318; font-size: 13px; font-weight: 650; }
    .presence { margin: 0; color: #15211c; font-size: 13px; }
    .mono { font-family: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace; }
    .link-note { margin: 12px 0 0; color: #56665e; font-size: 12px; line-height: 1.5; }

    @media (max-width: 640px) {
      .link-form { flex-direction: column; align-items: stretch; }
      .field, .field.small { flex: 1 1 auto; }
      .btn { justify-content: center; }
    }
  `],
})
export class LinkTestComponent {
  private http = inject(HttpClient);
  private toast = inject(ToastService);

  readonly clients = input.required<WispHubClient[]>();

  query = '';
  seconds = 8;
  running = signal(false);
  error = signal('');
  result = signal<LinkTestResult | null>(null);
  private queryValue = signal('');

  readonly suggestions = computed(() => {
    const term = this.queryValue().toLowerCase().trim();
    const list = this.clients().filter((c) => c.ip);
    if (!term) return list.slice(0, 30);
    return list.filter((c) =>
      c.nombre?.toLowerCase().includes(term) || c.ip?.includes(term) || String(c.id_servicio).includes(term),
    ).slice(0, 30);
  });

  readonly selected = computed(() => {
    const term = this.queryValue().trim().toLowerCase();
    if (!term) return null;
    const list = this.clients().filter((c) => c.ip);
    return list.find((c) => this.optionLabel(c).toLowerCase() === term)
      ?? list.find((c) => c.ip?.toLowerCase() === term)
      ?? list.find((c) => String(c.id_servicio) === term)
      ?? null;
  });

  optionLabel(client: WispHubClient): string {
    return `${client.nombre} · ${client.ip} · #${client.id_servicio}`;
  }

  planText(client: WispHubClient): string {
    return formatPlanName(client.plan_internet?.nombre, 'sin plan');
  }

  planLabel(plan: string | null | undefined): string {
    return formatPlanName(plan, 'sin plan');
  }

  onQuery(value: string) {
    this.queryValue.set(value);
  }

  run() {
    const client = this.selected();
    if (!client || this.running()) return;
    this.running.set(true);
    this.error.set('');
    this.result.set(null);
    this.http.post<LinkTestResult>('/mikrotik/link-test', { idServicio: client.id_servicio, seconds: this.seconds }).subscribe({
      next: (data) => {
        this.running.set(false);
        this.result.set(data);
      },
      error: (err) => {
        this.running.set(false);
        const message = err?.error?.error || 'No se pudo consultar el MikroTik. Revise que el router esté en línea.';
        this.error.set(message);
        this.toast.error(message);
      },
    });
  }

  mbps(bps: number | null | undefined): string {
    const value = (Number(bps) || 0) / 1_000_000;
    return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  }

  usePercent(): number {
    const r = this.result();
    if (!r?.queue.maxDownloadBps) return 0;
    return Math.max(0, Math.min(100, Math.round((r.traffic.avgDownloadBps / r.queue.maxDownloadBps) * 100)));
  }

  /** Si la cola no coincide con el plan contratado, devuelve el texto del plan. */
  planMismatch(): string | null {
    const r = this.result();
    const plan = parsePlanSpeed(r?.client?.plan);
    if (!r || !plan) return null;
    const downMbps = r.queue.maxDownloadBps / 1_000_000;
    const upMbps = r.queue.maxUploadBps / 1_000_000;
    const off = Math.abs(downMbps - plan.down) > Math.max(0.5, plan.down * 0.1) || Math.abs(upMbps - plan.up) > Math.max(0.5, plan.up * 0.1);
    return off ? `${plan.down} / ${plan.up} Mbps` : null;
  }

  verdictTone(): 'ok' | 'warn' | 'danger' {
    const r = this.result();
    if (!r) return 'ok';
    if (r.queue.disabled || r.ping.received === 0) return 'danger';
    if (this.planMismatch() || (r.ping.lossPercent ?? 0) >= 20 || (r.ping.avgMs ?? 0) >= 80) return 'warn';
    return 'ok';
  }

  verdictTitle(): string {
    const r = this.result();
    if (!r) return '';
    if (r.queue.disabled) return 'El servicio está pausado en el router';
    if (r.ping.received === 0) return 'El equipo del cliente no responde';
    return `El router le permite hasta ${this.mbps(r.queue.maxDownloadBps)} Mbps de bajada`;
  }

  verdictDetail(): string {
    const r = this.result();
    if (!r) return '';
    if (r.queue.disabled) return 'Su cola está pausada en el MikroTik, así que no puede navegar aunque el equipo esté encendido.';
    if (r.ping.received === 0) return 'El MikroTik no recibió respuesta de su equipo: puede estar apagado, sin fibra o con el firewall bloqueando el ping.';
    const parts = [`Ahora mismo usa ${this.mbps(r.traffic.avgDownloadBps)} Mbps (${this.usePercent()}% de lo permitido)`];
    if (r.ping.avgMs !== null) parts.push(`responde en ${r.ping.avgMs.toFixed(0)} ms`);
    const mismatch = this.planMismatch();
    if (mismatch) parts.push(`ojo: su plan contratado es ${mismatch}`);
    return `${parts.join(' · ')}.`;
  }
}
