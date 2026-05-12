import { Component, inject, input, signal, OnInit, OnDestroy, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';

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

const TIER_INFO: Record<string, { label: string; color: string; bg: string; emoji: string }> = {
  EXCELENTE: { label: 'EXCELENTE', color: '#15803d', bg: '#dcfce7', emoji: '🌟' },
  BUENO:     { label: 'BUENO',     color: '#0e7490', bg: '#cffafe', emoji: '✅' },
  REGULAR:   { label: 'REGULAR',   color: '#a16207', bg: '#fef3c7', emoji: '⚠️' },
  RIESGO:    { label: 'RIESGO',    color: '#c2410c', bg: '#ffedd5', emoji: '🟠' },
  CRITICO:   { label: 'CRÍTICO',   color: '#b91c1c', bg: '#fee2e2', emoji: '🔴' },
};

const CONS_INFO: Record<string, { label: string; color: string; bg: string; emoji: string }> = {
  INTENSIVO: { label: 'INTENSIVO', color: '#7c2d12', bg: '#fed7aa', emoji: '🚀' },
  NORMAL:    { label: 'NORMAL',    color: '#1e40af', bg: '#dbeafe', emoji: '📊' },
  BAJO:      { label: 'BAJO',      color: '#475569', bg: '#f1f5f9', emoji: '💤' },
  INACTIVO:  { label: 'INACTIVO',  color: '#94a3b8', bg: '#e2e8f0', emoji: '⏸️' },
};

@Component({
  selector: 'app-client-metrics',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    @if (metrics()) {
      <div class="metrics-card">
        <div class="metrics-head">
          <h3>📊 Estado de Cuenta y Consumo</h3>
          <span class="updated">
            @if (metrics()!.metricsUpdatedAt) {
              Actualizado {{ formatAgo(metrics()!.metricsUpdatedAt!) }}
            }
          </span>
        </div>

        <div class="grid">
          <!-- CREDIT SCORE -->
          <div class="metric-block">
            <div class="metric-label">Score crediticio</div>
            <div class="score-row">
              <div class="score-circle" [style.background]="creditTierInfo()?.bg" [style.color]="creditTierInfo()?.color">
                {{ metrics()!.creditScore ?? '?' }}
              </div>
              <div class="tier-info">
                <span class="tier-badge" [style.background]="creditTierInfo()?.bg" [style.color]="creditTierInfo()?.color">
                  {{ creditTierInfo()?.emoji }} {{ creditTierInfo()?.label || 'Sin datos' }}
                </span>
                <div class="tier-desc">{{ tierDescription() }}</div>
              </div>
            </div>
            @if (metrics()!.creditFactors && metrics()!.creditFactors.length > 0) {
              <details class="factors">
                <summary>Ver factores ({{ metrics()!.creditFactors.length }})</summary>
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
            <div class="metric-label">Categoría de consumo</div>
            <div class="cons-row">
              <span class="cons-emoji">{{ consTierInfo()?.emoji }}</span>
              <div class="cons-info">
                <span class="tier-badge" [style.background]="consTierInfo()?.bg" [style.color]="consTierInfo()?.color">
                  {{ consTierInfo()?.label || 'Sin datos' }}
                </span>
                @if (metrics()!.consumptionMb30d !== null) {
                  <div class="cons-detail">
                    {{ formatBytes(metrics()!.consumptionMb30d) }} en últimos 30 días
                    @if (metrics()!.consumptionPct !== null) {
                      ({{ metrics()!.consumptionPct | number:'1.1-1' }}% del plan)
                    }
                  </div>
                  @if (metrics()!.consumptionPct !== null) {
                    <div class="bar">
                      <div class="bar-fill" [style.width.%]="metrics()!.consumptionPct" [style.background]="consTierInfo()?.color"></div>
                    </div>
                  }
                } @else {
                  <div class="cons-detail">Sin datos de consumo (cliente sin queue MikroTik o IP no asignada)</div>
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .metrics-card { background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 18px; margin-bottom: 16px; }
    .metrics-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .metrics-head h3 { margin: 0; font-size: 16px; font-weight: 700; color: #0f172a; }
    .updated { font-size: 11px; color: #94a3b8; }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .metric-block { background: #f8fafc; border-radius: 12px; padding: 14px; }
    .metric-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; margin-bottom: 10px; }

    .score-row { display: flex; align-items: center; gap: 14px; }
    .score-circle { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 800; flex-shrink: 0; }
    .tier-info { flex: 1; min-width: 0; }
    .tier-badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; }
    .tier-desc { font-size: 12px; color: #64748b; margin-top: 4px; }

    .cons-row { display: flex; align-items: flex-start; gap: 12px; }
    .cons-emoji { font-size: 32px; line-height: 1; }
    .cons-info { flex: 1; }
    .cons-detail { font-size: 12px; color: #475569; margin-top: 5px; }
    .bar { height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin-top: 8px; }
    .bar-fill { height: 100%; transition: width 0.4s ease; }

    .factors { margin-top: 12px; font-size: 12px; }
    .factors summary { cursor: pointer; color: #6366f1; font-weight: 500; user-select: none; }
    .factors ul { list-style: none; padding: 8px 0 0; margin: 0; }
    .factors li { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f1f5f9; }
    .factors li.neg strong { color: #dc2626; }
    .factors li.pos strong { color: #16a34a; }

    @media (max-width: 768px) {
      .grid { grid-template-columns: 1fr; }
    }
  `],
})
export class ClientMetricsComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);

  idServicio = input.required<number>();
  refreshIntervalMs = input(30000); // 30s default

  metrics = signal<Metrics | null>(null);
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
      next: (m) => this.metrics.set(m),
      error: () => {},
    });
  }

  tierDescription(): string {
    const m = this.metrics();
    if (!m?.creditTier) return '';
    return {
      EXCELENTE: 'Cliente al día, paga puntual',
      BUENO: 'Buen historial, sin alertas',
      REGULAR: 'Algunos atrasos ocasionales',
      RIESGO: 'Mora frecuente, atención',
      CRITICO: 'Alta mora o bloqueado',
    }[m.creditTier] || '';
  }

  formatFactor(key: string): string {
    const map: Record<string, string> = {
      factura_pendiente: 'Factura pendiente',
      factura_vencida: 'Factura vencida',
      al_dia: 'Pagos al día',
      bloqueado_admin: 'Bloqueado por admin',
      marcado_moroso: 'Marcado moroso',
      servicio_suspendido: 'Servicio suspendido en Wisphub',
      cliente_retirado: 'Cliente retirado',
      servicio_activo: 'Servicio activo',
      saldo_pendiente: 'Saldo pendiente',
    };
    if (key.startsWith('saldo_')) {
      const m = key.match(/saldo_(.+)_meses/);
      if (m) return `Debe ${m[1]} meses de plan`;
    }
    if (key.startsWith('') && key.endsWith('_bloqueos_historicos')) {
      const n = parseInt(key);
      return `${n} bloqueos en historial`;
    }
    return map[key] || key;
  }

  formatBytes(mb: number | null): string {
    if (mb === null || mb === undefined) return '0 MB';
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  }

  formatAgo(iso: string): string {
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return `hace ${sec}s`;
    if (sec < 3600) return `hace ${Math.floor(sec / 60)}m`;
    return `hace ${Math.floor(sec / 3600)}h`;
  }
}
