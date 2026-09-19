/** Utilidades de solo lectura para comparar pruebas de velocidad con el plan contratado. */

export type PlanLevel = 'ok' | 'low' | 'bad' | 'none';

export interface PlanSpeed { down: number; up: number; }

export interface PlanComparison {
  plan: PlanSpeed | null;
  /** Descarga medida como % de la bajada del plan (null si el plan no tiene velocidad legible). */
  pct: number | null;
  upPct: number | null;
  level: PlanLevel;
}

/** A partir de este % de la bajada del plan la prueba se considera "cumple". */
export const PLAN_OK_PCT = 80;
/** Por debajo de este % se considera "muy por debajo". */
export const PLAN_BAD_PCT = 50;

const TOKEN = /(\d+(?:[.,]\d+)?)\s*([kKmMgG])/g;

/**
 * Lee la velocidad del nombre del plan: "3300k/3300k" -> 3.3/3.3, "10M | 10M Fibra" -> 10/10,
 * "4M/2600k" -> 4/2.6, "Plan 20 Mbps" -> 20/20. Devuelve null si el nombre no trae velocidad.
 */
export function parsePlanSpeed(name: string | null | undefined): PlanSpeed | null {
  const text = String(name || '');
  const values: number[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const n = Number(match[1].replace(',', '.'));
    const unit = match[2].toLowerCase();
    const mbps = unit === 'k' ? n / 1000 : unit === 'g' ? n * 1000 : n;
    if (Number.isFinite(mbps) && mbps > 0) values.push(mbps);
    if (values.length === 2) break;
  }
  if (!values.length) return null;
  return { down: values[0], up: values[1] ?? values[0] };
}

export function compareToPlan(downloadMbps: number, uploadMbps: number, planName: string | null | undefined): PlanComparison {
  const plan = parsePlanSpeed(planName);
  if (!plan) return { plan: null, pct: null, upPct: null, level: 'none' };
  const pct = (Number(downloadMbps) || 0) / plan.down * 100;
  const upPct = (Number(uploadMbps) || 0) / plan.up * 100;
  const level: PlanLevel = pct >= PLAN_OK_PCT ? 'ok' : pct >= PLAN_BAD_PCT ? 'low' : 'bad';
  return { plan, pct, upPct, level };
}

export function planLevelLabel(level: PlanLevel): string {
  return ({ ok: 'Cumple', low: 'Por debajo', bad: 'Muy por debajo', none: 'Sin plan comparable' } as Record<PlanLevel, string>)[level];
}

/** "hace 3 min", "hace 2 h", "ayer", "hace 5 días"… */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ayer';
  if (d < 30) return `hace ${d} días`;
  const m = Math.floor(d / 30);
  return m === 1 ? 'hace 1 mes' : m < 12 ? `hace ${m} meses` : 'hace más de un año';
}

export function fullDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
}
