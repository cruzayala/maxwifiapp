import { Component, inject, input, signal, OnInit, OnDestroy, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { LucideGauge, LucideTriangleAlert } from '@lucide/angular';

interface Metrics {
  idServicio: number;
  nombre: string;
  creditScore: number | null;
  creditTier: string | null;
  creditFactors: { key: string; impact: number }[];
  consumptionMb30d: number | null;
  consumptionPct: number | null;
  consumptionTier: string | null;
  metricsUpdatedAt: string | null;
}

const TIER_INFO: Record<string, { label: string; color: string; bg: string }> = {
  EXCELENTE: { label: 'Excelente', color: '#0f7a53', bg: '#e9f8f1' },
  BUENO:     { label: 'Bueno',     color: '#0b6b52', bg: '#e6f2ec' },
  REGULAR:   { label: 'Regular',   color: '#b36b12', bg: '#fff6e8' },
  RIESGO:    { label: 'Riesgo',    color: '#b4540f', bg: '#ffeedd' },
  CRITICO:   { label: 'Crítico',   color: '#b42318', bg: '#fff0ef' },
};

const CONS_INFO: Record<string, { label: string; color: string; bg: string }> = {
  INTENSIVO: { label: 'Intensivo', color: '#b36b12', bg: '#fff6e8' },
  NORMAL:    { label: 'Normal',    color: '#0b6b52', bg: '#e6f2ec' },
  BAJO:      { label: 'Bajo',      color: '#526b80', bg: '#eef3f7' },
  INACTIVO:  { label: 'Inactivo',  color: '#56665e', bg: '#edf1ed' },
};

@Component({
  selector: 'app-client-metrics',
  standalone: true,
  imports: [DecimalPipe, LucideGauge, LucideTriangleAlert],
  template: `
    @if (metrics()) {
      <div class="metrics-card">
        <div class="metrics-head">
          <h3><svg lucideGauge size="17"></svg> Estado de cuenta y consumo</h3>
          <span class="updated">
            @if (metrics()!.metricsUpdatedAt) {
              Actualizado {{ formatAgo(metrics()!.metricsUpdatedAt!) }}
            }
          </span>
        </div>

        <div class="grid">
          <!-- CREDIT SCORE -->
          <div class="metric-block">
            <div class="metric-label">Puntuación de pago</div>
            <div class="score-row">
              <div class="score-circle" [style.background]="creditTierInfo()?.bg || '#edf1ed'" [style.color]="creditTierInfo()?.color || '#56665e'" [attr.aria-label]="'Puntuación ' + (metrics()!.creditScore ?? 'sin datos') + ' de 100'">
                {{ metrics()!.creditScore ?? '—' }}
              </div>
              <div class="tier-info">
                <span class="tier-badge" [style.background]="creditTierInfo()?.bg || '#edf1ed'" [style.color]="creditTierInfo()?.color || '#56665e'">
                  {{ creditTierInfo()?.label || 'Sin datos' }}
                </span>
                <div class="tier-desc">{{ tierDescription() || 'Aún no hay suficiente historial de pagos.' }}</div>
              </div>
            </div>
            @if (metrics()!.creditFactors && metrics()!.creditFactors.length > 0) {
              <details class="factors">
                <summary>¿Por qué esta puntuación? ({{ metrics()!.creditFactors.length }} factores)</summary>
                <ul>
                  @for (f of metrics()!.creditFactors; track f.key) {
                    <li [class.neg]="f.impact < 0" [class.pos]="f.impact > 0">
                      <span>{{ formatFactor(f.key) }}</span>
                      <strong>{{ f.impact > 0 ? '+' : '' }}{{ f.impact }}</strong>
                    </li>
                  }
                </ul>
              </details>
            }
          </div>

          <!-- CONSUMPTION TIER -->
          <div class="metric-block">
            <div class="metric-label">Consumo de internet</div>
            <div class="cons-info">
              <span class="tier-badge" [style.background]="consTierInfo()?.bg || '#edf1ed'" [style.color]="consTierInfo()?.color || '#56665e'">
                {{ consTierInfo()?.label || 'Sin datos' }}
              </span>
              @if (metrics()!.consumptionMb30d !== null) {
                <div class="cons-detail">
                  <strong>{{ formatBytes(metrics()!.consumptionMb30d) }}</strong> en los últimos 30 días
                  @if (metrics()!.consumptionPct !== null) {
                    ({{ metrics()!.consumptionPct | number:'1.1-1' }}% del plan)
                  }
                </div>
                @if (metrics()!.consumptionPct !== null) {
                  <div class="bar" role="img" [attr.aria-label]="'Uso del plan: ' + (metrics()!.consumptionPct | number:'1.0-0') + '%'">
                    <div class="bar-fill" [style.width.%]="barWidth()" [style.background]="consTierInfo()?.color || '#0b6b52'"></div>
                  </div>
                }
              } @else {
                <div class="cons-detail">Sin datos de consumo: el cliente no tiene IP asignada o su límite de velocidad no está registrado en el MikroTik.</div>
              }
            </div>
          </div>
        </div>
      </div>
    } @else if (loadFailed()) {
      <div class="metrics-card state error">
        <svg lucideTriangleAlert size="20"></svg>
        <div><strong>No se pudo cargar el monitoreo del cliente.</strong><p>Se volverá a intentar automáticamente en unos segundos.</p></div>
      </div>
    } @else {
      <div class="metrics-card state"><span class="spinner"></span><div><strong>Cargando monitoreo…</strong><p>Puntuación de pago y consumo de los últimos 30 días.</p></div></div>
    }
  `,
  styles: [`
    .metrics-card { background: white; border: 1px solid #e0e6e1; border-radius: 12px; padding: 18px; margin-bottom: 16px; color: #2d3b34; }
    .metrics-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
    .metrics-head h3 { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 15px; font-weight: 700; color: #15211c; }
    .metrics-head h3 svg { color: #0b6b52; }
    .updated { font-size: 12px; color: #56665e; }

    .state { display: flex; align-items: flex-start; gap: 12px; }
    .state strong { color: #15211c; font-size: 14px; }
    .state p { margin: 3px 0 0; color: #56665e; font-size: 13px; }
    .state.error { background: #fff0ef; border-color: #f0b4ae; }
    .state.error > svg { color: #b42318; flex: 0 0 auto; margin-top: 1px; }
    .spinner { width: 20px; height: 20px; flex: 0 0 auto; border: 2px solid #e0e6e1; border-top-color: #0b6b52; border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .metric-block { background: #f4f6f2; border: 1px solid #ecf0ec; border-radius: 12px; padding: 14px; min-width: 0; }
    .metric-label { font-size: 11px; color: #56665e; text-transform: uppercase; font-weight: 700; margin-bottom: 10px; }

    .score-row { display: flex; align-items: center; gap: 14px; }
    .score-circle { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 800; flex-shrink: 0; }
    .tier-info { flex: 1; min-width: 0; }
    .tier-badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
    .tier-desc { font-size: 13px; color: #2d3b34; margin-top: 5px; }

    .cons-info { min-width: 0; }
    .cons-detail { font-size: 13px; color: #2d3b34; margin-top: 8px; line-height: 1.45; }
    .cons-detail strong { color: #15211c; }
    .bar { height: 8px; background: #e3e9ee; border-radius: 4px; overflow: hidden; margin-top: 8px; }
    .bar-fill { height: 100%; transition: width 0.4s ease; }

    .factors { margin-top: 12px; font-size: 13px; }
    .factors summary { cursor: pointer; color: #0b6b52; font-weight: 600; user-select: none; }
    .factors ul { list-style: none; padding: 8px 0 0; margin: 0; }
    .factors li { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; border-bottom: 1px solid #e6ebef; }
    .factors li.neg strong { color: #b42318; }
    .factors li.pos strong { color: #0f7a53; }

    @media (max-width: 768px) {
      .grid { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) { .bar-fill { transition: none; } .spinner { animation-duration: 2s; } }
  `],
})
export class ClientMetricsComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);

  idServicio = input.required<number>();
  refreshIntervalMs = input(30000); // 30s default

  metrics = signal<Metrics | null>(null);
  loadFailed = signal(false);
  private timer: ReturnType<typeof setInterval> | null = null;

  creditTierInfo = computed(() => {
    const m = this.metrics();
    if (!m?.creditTier) return null;
    return TIER_INFO[m.creditTier] || null;
  });

  consTierInfo = computed(() => {
    const m = this.metrics();
    if (!m?.consumptionTier) return null;
    return CONS_INFO[m.consumptionTier] || null;
  });

  ngOnInit() {
    this.load();
    this.timer = setInterval(() => this.load(), this.refreshIntervalMs());
  }

  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  load() {
    this.http.get<Metrics>(`/metrics/${this.idServicio()}`).subscribe({
      next: (m) => { this.metrics.set(m); this.loadFailed.set(false); },
      error: () => this.loadFailed.set(true),
    });
  }

  barWidth(): number {
    return Math.min(100, Math.max(0, Number(this.metrics()?.consumptionPct) || 0));
  }

  tierDescription(): string {
    const m = this.metrics();
    if (!m?.creditTier) return '';
    return {
      EXCELENTE: 'Cliente al día, paga puntual.',
      BUENO: 'Buen historial, sin alertas.',
      REGULAR: 'Algunos atrasos ocasionales.',
      RIESGO: 'Atrasos frecuentes; conviene darle seguimiento.',
      CRITICO: 'Mucha deuda acumulada o servicio bloqueado.',
    }[m.creditTier] || '';
  }

  formatFactor(key: string): string {
    const map: Record<string, string> = {
      factura_pendiente: 'Factura pendiente',
      factura_vencida: 'Factura vencida',
      al_dia: 'Pagos al día',
      bloqueado_admin: 'Bloqueado por administración',
      marcado_moroso: 'Marcado como moroso',
      servicio_suspendido: 'Servicio suspendido en WispHub',
      cliente_retirado: 'Cliente retirado',
      servicio_activo: 'Servicio activo',
      saldo_pendiente: 'Saldo pendiente',
    };
    if (key.startsWith('saldo_')) {
      const m = key.match(/saldo_(.+)_meses/);
      if (m) return `Debe ${m[1]} ${m[1] === '1' ? 'mes' : 'meses'} de plan`;
    }
    if (key.startsWith('') && key.endsWith('_bloqueos_historicos')) {
      const n = parseInt(key);
      return `${n} ${n === 1 ? 'bloqueo' : 'bloqueos'} en el historial`;
    }
    return map[key] || key;
  }

  formatBytes(mb: number | null): string {
    if (mb === null || mb === undefined) return '0 MB';
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  }

  formatAgo(iso: string): string {
    const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (!Number.isFinite(sec)) return '';
    if (sec < 60) return 'hace menos de un minuto';
    if (sec < 3600) return `hace ${Math.floor(sec / 60)} min`;
    if (sec < 86400) return `hace ${Math.floor(sec / 3600)} h`;
    const days = Math.floor(sec / 86400);
    return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  }
}
