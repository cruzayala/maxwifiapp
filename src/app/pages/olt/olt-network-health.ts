import { Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideAlertTriangle, LucideChevronRight, LucideCircleCheck, LucideDownload, LucideGauge, LucideInfo, LucidePlugZap,
  LucideUnplug, LucideUserX,
} from '@lucide/angular';
import { ExportService } from '../../services/export.service';
import type { OltAlarm, OltOnu, OltPon, OltSignalAlert } from '../../services/olt.service';
import { CopyValueComponent } from './copy-value';
import {
  ONU_CSV_COLUMNS, RX_CRITICAL_DBM, alarmLevelLabel, RX_WEAK_DBM, formatDateTime, isCriticalPower, isWeakPower, offlineCause,
  onuDisplayName, onuHealthState, phaseStateLabel, relativeTime,
} from './olt-helpers';

type Tone = 'critical' | 'warning' | 'info' | 'healthy';

export interface PonHealthRow {
  pon: OltPon;
  tone: Tone;
  toneLabel: string;
  reason: string;
  los: number;
  power: number;
  otherDown: number;
  worst: OltOnu | null;
}

interface Insight {
  key: string;
  tone: Tone;
  title: string;
  detail: string;
  pon?: number;
  filter?: string;
}

interface AlertGroup {
  onuIndex: string;
  onu: OltOnu | null;
  detections: number;
  alerts: number;
  critical: boolean;
  lastSeenAt: string;
  message: string;
}

const TONE_RANK: Record<Tone, number> = { critical: 0, warning: 1, info: 2, healthy: 3 };
const RX_SCALE_BEST = -8;
const RX_SCALE_WORST = -32;

/**
 * Panel «Salud de la red óptica»: rankings, resumen por PON con semáforo y alertas priorizadas.
 * Todo se calcula en el navegador con el inventario, PON y alarmas que la pantalla ya cargó.
 */
@Component({
  selector: 'app-olt-network-health',
  standalone: true,
  imports: [
    RouterLink, CopyValueComponent, LucideAlertTriangle, LucideChevronRight, LucideCircleCheck, LucideDownload,
    LucideGauge, LucideInfo, LucidePlugZap, LucideUnplug, LucideUserX,
  ],
  templateUrl: './olt-network-health.html',
  styleUrl: './olt-network-health.scss',
})
export class OltNetworkHealthComponent {
  private readonly exporter = inject(ExportService);

  readonly onus = input.required<OltOnu[]>();
  readonly pons = input.required<OltPon[]>();
  readonly alarms = input<OltAlarm[]>([]);
  readonly signalAlerts = input<OltSignalAlert[]>([]);
  readonly totalOnus = input(0);
  readonly loadedAt = input<Date | null>(null);

  readonly openOnu = output<OltOnu>();
  readonly openPon = output<number>();
  readonly showInventory = output<string>();

  readonly weakLimit = RX_WEAK_DBM;
  readonly criticalLimit = RX_CRITICAL_DBM;

  private readonly byIndex = computed(() => new Map(this.onus().map((onu) => [onu.onuIndex, onu])));

  readonly kpis = computed(() => {
    const rows = this.onus();
    const online = rows.filter((onu) => onu.online);
    const readings = online.filter((onu) => onu.rxPowerDbm != null).map((onu) => Number(onu.rxPowerDbm));
    const offline = rows.filter((onu) => !onu.online);
    return {
      total: rows.length,
      online: online.length,
      onlinePercent: rows.length ? Math.round((online.length / rows.length) * 100) : 0,
      offline: offline.length,
      los: offline.filter((onu) => offlineCause(onu) === 'los').length,
      power: offline.filter((onu) => offlineCause(onu) === 'power').length,
      critical: online.filter((onu) => isCriticalPower(onu.rxPowerDbm)).length,
      weak: online.filter((onu) => isWeakPower(onu.rxPowerDbm) && !isCriticalPower(onu.rxPowerDbm)).length,
      noReading: online.filter((onu) => onu.rxPowerDbm == null).length,
      unlinked: rows.filter((onu) => !onu.clientIdServicio).length,
      avgRx: readings.length ? Math.round((readings.reduce((sum, value) => sum + value, 0) / readings.length) * 10) / 10 : null,
      alerts: this.alarms().length + this.signalAlerts().length,
    };
  });

  /** Solo se analizan las ONUs devueltas en la carga del mapa (hasta 500). */
  readonly partialCoverage = computed(() => this.totalOnus() > this.onus().length);

  readonly ponRows = computed<PonHealthRow[]>(() => {
    const byPon = new Map<number, OltOnu[]>();
    for (const onu of this.onus()) byPon.set(onu.pon, [...(byPon.get(onu.pon) || []), onu]);
    return this.pons().map((pon) => {
      const rows = byPon.get(pon.pon) || [];
      const down = rows.filter((onu) => !onu.online);
      const los = down.filter((onu) => offlineCause(onu) === 'los').length;
      const power = down.filter((onu) => offlineCause(onu) === 'power').length;
      const worst = rows.filter((onu) => onu.online && onu.rxPowerDbm != null)
        .sort((a, b) => Number(a.rxPowerDbm) - Number(b.rxPowerDbm))[0] || null;
      const allDown = pon.total > 0 && pon.offline >= pon.total;
      let tone: Tone = 'healthy';
      let reason = 'Sin problemas detectados';
      if (allDown) { tone = 'critical'; reason = 'Todo el PON sin conexión'; }
      else if (los >= 3) { tone = 'critical'; reason = `${los} ONUs sin señal óptica a la vez`; }
      else if (pon.health === 'critical' || pon.critical > 0) { tone = 'critical'; reason = pon.critical ? `${pon.critical} con señal crítica` : 'Estado crítico reportado'; }
      else if (pon.offline > 0) { tone = 'warning'; reason = `${pon.offline} sin conexión`; }
      else if (pon.weak > 0) { tone = 'warning'; reason = `${pon.weak} con señal débil`; }
      else if (pon.avgRxPowerDbm != null && pon.avgRxPowerDbm <= -25) { tone = 'warning'; reason = 'RX promedio bajo'; }
      else if (pon.health === 'warning') { tone = 'warning'; reason = 'Requiere atención'; }
      else if (pon.utilizationPercent >= 90) { tone = 'info'; reason = 'Casi lleno'; }
      const toneLabel = ({ critical: 'Crítico', warning: 'Atención', info: 'Aviso', healthy: 'Bien' } as Record<Tone, string>)[tone];
      return { pon, tone, toneLabel, reason, los, power, otherDown: Math.max(0, pon.offline - los - power), worst };
    }).sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.pon.offline - a.pon.offline || b.pon.utilizationPercent - a.pon.utilizationPercent || a.pon.pon - b.pon.pon);
  });

  readonly insights = computed<Insight[]>(() => {
    const items: Insight[] = [];
    for (const row of this.ponRows()) {
      const pon = row.pon;
      if (pon.total > 0 && pon.offline >= pon.total) {
        items.push({ key: `all-${pon.pon}`, tone: 'critical', pon: pon.pon, title: `PON ${pon.pon}: todas sus ${pon.total} ONUs sin conexión`, detail: 'Revise el puerto PON, el patch cord en la OLT o la fibra troncal de esa salida.' });
        continue;
      }
      if (row.los >= 3) items.push({ key: `los-${pon.pon}`, tone: 'critical', pon: pon.pon, title: `PON ${pon.pon}: ${row.los} ONUs sin señal óptica (LOS)`, detail: 'Varias caídas LOS en el mismo PON suelen indicar corte de fibra, splitter o NAP dañada.' });
      if (row.power >= 3) items.push({ key: `power-${pon.pon}`, tone: 'warning', pon: pon.pon, title: `PON ${pon.pon}: ${row.power} ONUs sin energía`, detail: 'Probable apagón eléctrico en la zona. Confirme antes de enviar un técnico de fibra.' });
      if (pon.avgRxPowerDbm != null && pon.avgRxPowerDbm <= -25 && pon.online > 1) items.push({ key: `avg-${pon.pon}`, tone: 'warning', pon: pon.pon, title: `PON ${pon.pon}: RX promedio ${pon.avgRxPowerDbm} dBm`, detail: 'Toda la rama está baja: revise empalmes troncales, el splitter principal y los conectores de la OLT.' });
      if (pon.utilizationPercent >= 90) items.push({ key: `full-${pon.pon}`, tone: 'info', pon: pon.pon, title: `PON ${pon.pon} casi lleno: ${pon.total} de ${pon.capacity}`, detail: 'Planifique otra salida PON o splitter antes de nuevas instalaciones en esa zona.' });
    }
    const kpis = this.kpis();
    if (kpis.critical) items.push({ key: 'critical', tone: 'critical', filter: 'critical', title: `${kpis.critical} ${kpis.critical === 1 ? 'ONU' : 'ONUs'} con señal crítica (≤ ${RX_CRITICAL_DBM} dBm)`, detail: 'Pueden cortarse en cualquier momento. Priorice la visita técnica.' });
    if (kpis.weak) items.push({ key: 'weak', tone: 'warning', filter: 'weak', title: `${kpis.weak} ${kpis.weak === 1 ? 'ONU' : 'ONUs'} con señal débil`, detail: `Entre ${RX_WEAK_DBM} y ${RX_CRITICAL_DBM} dBm: limpie conectores y revise la acometida en la próxima visita.` });
    if (kpis.unlinked) items.push({ key: 'unlinked', tone: 'info', filter: 'unlinked', title: `${kpis.unlinked} ${kpis.unlinked === 1 ? 'ONU' : 'ONUs'} sin cliente asociado`, detail: 'Asócielas para ver el nombre del cliente en el mapa, en las alertas y en el diagnóstico.' });
    return items.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]).slice(0, 7);
  });

  readonly worstSignal = computed(() => this.onus()
    .filter((onu) => onu.online && onu.rxPowerDbm != null)
    .sort((a, b) => Number(a.rxPowerDbm) - Number(b.rxPowerDbm))
    .slice(0, 10));

  readonly downNow = computed(() => {
    const rank = { los: 0, power: 1, other: 2 } as const;
    return this.onus().filter((onu) => !onu.online)
      .sort((a, b) => rank[offlineCause(a)] - rank[offlineCause(b)] || a.pon - b.pon || a.onuId - b.onuId)
      .slice(0, 10);
  });

  readonly alertRanking = computed<AlertGroup[]>(() => {
    const groups = new Map<string, AlertGroup>();
    for (const alert of this.signalAlerts()) {
      const current = groups.get(alert.onuIndex);
      const isCritical = String(alert.severity).toLowerCase() === 'critical';
      if (!current) {
        groups.set(alert.onuIndex, {
          onuIndex: alert.onuIndex, onu: this.byIndex().get(alert.onuIndex) || null, detections: alert.occurrenceCount || 1,
          alerts: 1, critical: isCritical, lastSeenAt: alert.lastSeenAt, message: alert.message,
        });
        continue;
      }
      current.detections += alert.occurrenceCount || 1;
      current.alerts += 1;
      current.critical ||= isCritical;
      if (new Date(alert.lastSeenAt) > new Date(current.lastSeenAt)) { current.lastSeenAt = alert.lastSeenAt; current.message = alert.message; }
    }
    return [...groups.values()]
      .sort((a, b) => Number(b.critical) - Number(a.critical) || b.detections - a.detections)
      .slice(0, 10);
  });

  name(onu: OltOnu) { return onuDisplayName(onu); }
  state(onu: OltOnu) { return onuHealthState(onu); }
  causeLabel(onu: OltOnu) { return phaseStateLabel(onu.phaseState); }
  cause(onu: OltOnu) { return offlineCause(onu); }
  ago(value?: string | Date | null) { return relativeTime(value); }
  date(value?: string | Date | null) { return formatDateTime(value); }

  /** Ancho de la barra de señal: -8 dBm = barra llena, -32 dBm = vacía. */
  meter(value?: number | null) {
    if (value == null) return 0;
    const ratio = (Number(value) - RX_SCALE_WORST) / (RX_SCALE_BEST - RX_SCALE_WORST);
    return Math.max(4, Math.min(100, Math.round(ratio * 100)));
  }

  thresholdPosition(value: number) {
    return Math.round(((value - RX_SCALE_WORST) / (RX_SCALE_BEST - RX_SCALE_WORST)) * 100);
  }

  exportOnus() {
    this.exporter.exportCSV(this.onus(), 'onus_olt', ONU_CSV_COLUMNS);
  }

  exportPons() {
    this.exporter.exportCSV(this.ponRows(), 'resumen_pon', [
      { key: 'pon.pon', label: 'PON' },
      { key: 'pon.ponIndex', label: 'Índice' },
      { key: 'toneLabel', label: 'Semáforo' },
      { key: 'reason', label: 'Motivo' },
      { key: 'pon.total', label: 'ONUs' },
      { key: 'pon.capacity', label: 'Capacidad' },
      { key: 'pon.utilizationPercent', label: 'Ocupación %' },
      { key: 'pon.online', label: 'En línea' },
      { key: 'pon.offline', label: 'Sin conexión' },
      { key: 'los', label: 'Sin señal óptica (LOS)' },
      { key: 'power', label: 'Sin energía' },
      { key: 'pon.weak', label: 'Señal débil' },
      { key: 'pon.critical', label: 'Señal crítica' },
      { key: 'pon.avgRxPowerDbm', label: 'RX promedio (dBm)' },
      { key: 'worst', label: 'Peor ONU', transform: (value: OltOnu | null) => value ? `${onuDisplayName(value)} (${value.onuIndex})` : '' },
      { key: 'worst.rxPowerDbm', label: 'Peor RX (dBm)' },
    ]);
  }

  exportAlarms() {
    const rows = [
      ...this.signalAlerts().map((alert) => ({
        tipo: 'Señal óptica', nivel: alarmLevelLabel(alert.severity), descripcion: alert.message, onu: alert.onuIndex,
        cliente: this.byIndex().get(alert.onuIndex)?.client?.nombre || '', detecciones: alert.occurrenceCount,
        valor: alert.currentValue ?? '', referencia: alert.baselineValue ?? '',
        desde: formatDateTime(alert.firstSeenAt), ultima: formatDateTime(alert.lastSeenAt),
      })),
      ...this.alarms().map((alarm) => ({
        tipo: 'Chasis OLT', nivel: alarmLevelLabel(alarm.level), descripcion: alarm.description, onu: '', cliente: '',
        detecciones: '', valor: alarm.code || '', referencia: alarm.alarmId,
        desde: alarm.alarmTime || '', ultima: formatDateTime(alarm.lastSeenAt),
      })),
    ];
    this.exporter.exportCSV(rows, 'alarmas_olt', [
      { key: 'tipo', label: 'Tipo' }, { key: 'nivel', label: 'Nivel' }, { key: 'descripcion', label: 'Descripción' },
      { key: 'onu', label: 'ONU' }, { key: 'cliente', label: 'Cliente' }, { key: 'detecciones', label: 'Detecciones' },
      { key: 'valor', label: 'Valor / código' }, { key: 'referencia', label: 'Referencia / ID' },
      { key: 'desde', label: 'Desde' }, { key: 'ultima', label: 'Última vez' },
    ]);
  }
}
