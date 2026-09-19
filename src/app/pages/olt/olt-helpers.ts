import type { ExportColumn } from '../../services/export.service';
import type { OltOnu } from '../../services/olt.service';

/**
 * Utilidades de solo lectura compartidas por la pantalla OLT y sus paneles hijos.
 * Todo se calcula en el navegador con los datos que ya devuelven los endpoints existentes.
 */

/** Umbrales de señal óptica RX usados en toda la pantalla (dBm). */
export const RX_WEAK_DBM = -27;
export const RX_CRITICAL_DBM = -30;

export function isWeakPower(value?: number | null) { return value != null && value <= RX_WEAK_DBM; }
export function isCriticalPower(value?: number | null) { return value != null && value <= RX_CRITICAL_DBM; }

export type OnuHealthState = 'online' | 'warning' | 'critical' | 'offline';

export function onuHealthState(onu: OltOnu): OnuHealthState {
  if (!onu.online) return 'offline';
  if (isCriticalPower(onu.rxPowerDbm)) return 'critical';
  if (isWeakPower(onu.rxPowerDbm)) return 'warning';
  return 'online';
}

/** Semáforo de señal óptica para el operador: Buena / Débil / Crítica. */
export function signalLabel(value?: number | null) {
  if (value == null) return 'Sin lectura';
  if (isCriticalPower(value)) return 'Crítica';
  if (isWeakPower(value)) return 'Débil';
  return 'Buena';
}

export function formatDbm(value?: number | null) {
  return value != null ? `${value} dBm` : '--';
}

/** Estados de fase que reporta la ZTE C320, traducidos para el operador. */
export function phaseStateLabel(phase?: string | null) {
  const labels: Record<string, string> = {
    'los': 'Sin señal óptica (LOS)',
    'dyinggasp': 'Sin energía',
    'offline': 'Fuera de línea',
    'not-seen': 'Nunca vista',
    'syncmib': 'Sincronizando',
    'logging': 'Registrándose',
    'authfailed': 'Autenticación fallida',
    'working': 'Operativa',
  };
  const key = String(phase || '').trim().toLowerCase();
  return labels[key] || phase || 'Fuera de línea';
}

/** Causa probable de una caída, agrupada para el técnico. */
export type OfflineCause = 'los' | 'power' | 'other';

export function offlineCause(onu: OltOnu): OfflineCause {
  const phase = String(onu.phaseState || '').trim().toLowerCase();
  if (phase === 'los') return 'los';
  if (phase === 'dyinggasp') return 'power';
  return 'other';
}

export function onuStatusLabel(onu: OltOnu) {
  if (!onu.online) return phaseStateLabel(onu.phaseState);
  if (isCriticalPower(onu.rxPowerDbm)) return 'Señal crítica';
  if (isWeakPower(onu.rxPowerDbm)) return 'Señal débil';
  return 'ONU en línea';
}

/** Nombre visible de la ONU: cliente asociado, nombre en la OLT o su índice. */
export function onuDisplayName(onu: Pick<OltOnu, 'client' | 'name' | 'onuIndex'>) {
  return onu.client?.nombre || onu.name || onu.onuIndex;
}

export function onuMac(onu: OltOnu) {
  return onu.agentInventory?.summary?.mac || '';
}

export function onuIp(onu: OltOnu) {
  return onu.client?.ip || onu.agentInventory?.summary?.wanIp || '';
}

/** Texto en el que busca la búsqueda global: cliente, usuario, IP, serial, MAC, nombre, índice y modelo. */
export function onuSearchText(onu: OltOnu) {
  return [
    onu.client?.nombre, onu.client?.usuario, onu.client?.telefono, onuIp(onu), onu.serial, onuMac(onu),
    onu.name, onu.onuIndex, onu.model, onu.clientIdServicio != null ? `#${onu.clientIdServicio}` : '',
  ].filter(Boolean).join(' ').toLowerCase();
}

export function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

/** Coincidencia tolerante: todas las palabras deben aparecer (sin tildes ni mayúsculas; MAC sin separadores). */
export function matchesOnu(onu: OltOnu, query: string) {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalizeSearch(onuSearchText(onu));
  const compact = haystack.replace(/[:.-]/g, '');
  return terms.every((term) => haystack.includes(term) || compact.includes(term.replace(/[:.-]/g, '')));
}

export function formatDateTime(value?: string | Date | null) {
  if (!value) return 'Sin registro';
  return new Intl.DateTimeFormat('es-DO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

/** Tiempo relativo legible: «hace 3 min», «hace 2 h», «hace 4 días». */
export function relativeTime(value?: string | Date | null, now = Date.now()) {
  if (!value) return 'sin registro';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'sin registro';
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 0) return 'ahora';
  if (seconds < 45) return 'hace unos segundos';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return formatDateTime(value);
}

/** Columnas del CSV de ONUs (inventario completo o vista filtrada). */
export const ONU_CSV_COLUMNS: ExportColumn[] = [
  { key: 'onuIndex', label: 'ONU' },
  { key: 'pon', label: 'PON' },
  { key: 'onuId', label: 'ID ONU' },
  { key: 'online', label: 'Estado', transform: (_: unknown, row: OltOnu) => onuStatusLabel(row) },
  { key: 'client.nombre', label: 'Cliente' },
  { key: 'client.usuario', label: 'Usuario' },
  { key: 'clientIdServicio', label: 'ID servicio' },
  { key: 'client.ip', label: 'IP', transform: (_: unknown, row: OltOnu) => onuIp(row) },
  { key: 'name', label: 'Nombre en OLT' },
  { key: 'model', label: 'Modelo' },
  { key: 'serial', label: 'Serial' },
  { key: 'agentInventory', label: 'MAC', transform: (_: unknown, row: OltOnu) => onuMac(row) },
  { key: 'rxPowerDbm', label: 'RX (dBm)' },
  { key: 'txPowerDbm', label: 'TX (dBm)' },
  { key: 'rxPowerDbm', label: 'Señal', transform: (value: number | null) => signalLabel(value) },
  { key: 'distanceM', label: 'Distancia (m)' },
  { key: 'onlineDuration', label: 'Tiempo en línea' },
  { key: 'lastOfflineCause', label: 'Última desconexión' },
  { key: 'lastSeenAt', label: 'Última lectura', transform: (_: unknown, row: OltOnu) => formatDateTime(row.lastDetailAt || row.lastSeenAt) },
];

export function alarmLevelLabel(level?: string | null) {
  const labels: Record<string, string> = {
    critical: 'Crítica', major: 'Mayor', minor: 'Menor', warning: 'Aviso', info: 'Informativa', normal: 'Normal',
  };
  const key = String(level || '').trim().toLowerCase();
  return labels[key] || level || 'Aviso';
}
