/** Cálculos de solo lectura para la auditoría de red (todo en el navegador). */

export const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

export type HealthLike = 'stable' | 'degraded' | 'offline' | 'unknown' | string;

const STATE_WEIGHT: Record<string, number> = { offline: 3, degraded: 2, stable: 1, unknown: 0 };

export function worstState(a: HealthLike, b: HealthLike): HealthLike {
  return (STATE_WEIGHT[b] ?? 0) > (STATE_WEIGHT[a] ?? 0) ? b : a;
}

export function stateLabel(state: HealthLike): string {
  return ({ stable: 'Estable', degraded: 'Degradado', offline: 'Fuera de línea', unknown: 'Sin datos' } as Record<string, string>)[state] || state;
}

/** "45 min", "2 h 30 min", "3 d 4 h". */
export function formatDuration(ms: number): string {
  const totalMin = Math.round(Math.max(0, ms) / 60000);
  if (totalMin < 1) return 'menos de 1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

export function hoursFromSamples(samples: number, intervalMs: number): number {
  return (Math.max(0, samples) * (intervalMs || DEFAULT_INTERVAL_MS)) / 3_600_000;
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const min = Math.floor(Math.max(0, now - t) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

export interface Episode {
  start: number;
  end: number;
  durationMs: number;
  samples: number;
  worst: HealthLike;
}

/**
 * Agrupa lecturas consecutivas que cumplen `isBad` en episodios (caídas, incidentes).
 * Un hueco sin lecturas mayor a 2,5 intervalos corta el episodio.
 * `points` debe venir ordenado del más antiguo al más reciente.
 */
export function buildEpisodes<T>(points: T[], time: (p: T) => number, isBad: (p: T) => boolean, state: (p: T) => HealthLike, intervalMs: number): Episode[] {
  const gap = (intervalMs || DEFAULT_INTERVAL_MS) * 2.5;
  const out: Episode[] = [];
  let current: Episode | null = null;
  let lastTime = 0;
  for (const p of points) {
    const t = time(p);
    if (!Number.isFinite(t)) continue;
    const bad = isBad(p);
    if (current && (!bad || t - lastTime > gap)) {
      current.durationMs = current.end - current.start + (intervalMs || DEFAULT_INTERVAL_MS);
      out.push(current);
      current = null;
    }
    if (bad) {
      if (!current) current = { start: t, end: t, durationMs: 0, samples: 0, worst: state(p) };
      current.end = t;
      current.samples += 1;
      current.worst = worstState(current.worst, state(p));
    }
    lastTime = t;
  }
  if (current) {
    current.durationMs = current.end - current.start + (intervalMs || DEFAULT_INTERVAL_MS);
    out.push(current);
  }
  return out;
}

export interface Bucket<T> { start: number; end: number; items: T[]; }

/** Reparte puntos ordenados en como máximo `max` grupos consecutivos (para gráficas compactas). */
export function bucketize<T>(points: T[], max: number, time: (p: T) => number): Bucket<T>[] {
  if (!points.length) return [];
  const size = Math.max(1, Math.ceil(points.length / Math.max(1, max)));
  const out: Bucket<T>[] = [];
  for (let i = 0; i < points.length; i += size) {
    const items = points.slice(i, i + size);
    out.push({ start: time(items[0]), end: time(items[items.length - 1]), items });
  }
  return out;
}

/** Construye el atributo `d` de una línea SVG en un lienzo de width×height. */
export function linePath(values: number[], max: number, width: number, height: number): string {
  if (!values.length || max <= 0) return '';
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(height - (Math.max(0, v) / max) * height).toFixed(1)}`).join(' ');
}

export function areaPath(values: number[], max: number, width: number, height: number): string {
  const line = linePath(values, max, width, height);
  if (!line) return '';
  const lastX = values.length > 1 ? width : 0;
  return `${line} L${lastX},${height} L0,${height} Z`;
}

/** Máximo "bonito" para el eje (1, 2, 5 × 10^n) con un margen. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const raw = value * 1.1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString('es-DO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function stateColor(state: HealthLike): string {
  return ({ stable: '#0f7a53', degraded: '#b36b12', offline: '#b42318' } as Record<string, string>)[state] || '#cfd8d2';
}
