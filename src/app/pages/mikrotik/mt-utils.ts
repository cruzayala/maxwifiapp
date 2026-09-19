// Utilidades de solo lectura para la pantalla MikroTik: todo se calcula en el navegador
// con los datos que ya devuelven los endpoints existentes. Nada aquí escribe en el router.
import { MtLiveClient, MtSystem } from '../../services/mikrotik.service';

export type HealthLevel = 'ok' | 'warn' | 'crit' | 'none';

export interface HealthMetric {
  label: string;
  value: number | null;
  display: string;
  detail: string;
  level: HealthLevel;
}

export interface SensorReading {
  key: string;
  label: string;
  display: string;
  kind: 'temperature' | 'voltage' | 'fan' | 'psu' | 'other';
  level: HealthLevel;
}

export interface RouterHealth {
  level: HealthLevel;
  label: string;
  reasons: string[];
  cpu: HealthMetric;
  memory: HealthMetric;
  disk: HealthMetric;
  sensors: SensorReading[];
  uptimeSeconds: number | null;
  version: string;
  board: string;
  architecture: string;
  cpuInfo: string;
}

const LEVEL_RANK: Record<HealthLevel, number> = { none: 0, ok: 1, warn: 2, crit: 3 };

export function worstLevel(levels: HealthLevel[]): HealthLevel {
  return levels.reduce<HealthLevel>((worst, level) => (LEVEL_RANK[level] > LEVEL_RANK[worst] ? level : worst), 'none');
}

export function healthLevelLabel(level: HealthLevel): string {
  return { ok: 'Saludable', warn: 'Revisar', crit: 'Crítico', none: 'Sin datos' }[level];
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function levelFor(value: number | null, warn: number, crit: number): HealthLevel {
  if (value === null) return 'none';
  if (value >= crit) return 'crit';
  if (value >= warn) return 'warn';
  return 'ok';
}

export function formatBytesShort(value: number | null): string {
  const bytes = Number(value || 0);
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/** RouterOS entrega el tiempo encendido como "2w3d4h5m6s" o "2w3d04:05:06". */
export function parseRouterUptime(text: unknown): number | null {
  const value = String(text || '').trim();
  if (!value) return null;
  let seconds = 0;
  let matched = false;
  const units: Array<[RegExp, number]> = [[/(\d+)w/, 604_800], [/(\d+)d/, 86_400], [/(\d+)h/, 3_600], [/(\d+)m(?!s)/, 60], [/(\d+)s/, 1]];
  for (const [pattern, factor] of units) {
    const match = value.match(pattern);
    if (match) { seconds += Number(match[1]) * factor; matched = true; }
  }
  const clock = value.match(/(\d{1,2}):(\d{2}):(\d{2})$/);
  if (clock) {
    seconds += Number(clock[1]) * 3_600 + Number(clock[2]) * 60 + Number(clock[3]);
    matched = true;
  }
  return matched ? seconds : null;
}

export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds)) return '-';
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (days >= 7) {
    const weeks = Math.floor(days / 7);
    const rest = days % 7;
    return `${weeks} ${weeks === 1 ? 'semana' : 'semanas'}${rest ? ` y ${rest} ${rest === 1 ? 'día' : 'días'}` : ''}`;
  }
  if (days > 0) return `${days} ${days === 1 ? 'día' : 'días'}${hours ? ` y ${hours} h` : ''}`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${Math.max(1, minutes)} min`;
}

/** "hace 3 min" a partir de una fecha; `now` llega de un reloj local para que se refresque sin pedir datos. */
export function relativeTime(value: Date | string | number | null | undefined, now: number): string {
  if (value === null || value === undefined || value === '') return 'sin datos';
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(time)) return 'sin datos';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 10) return 'hace unos segundos';
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

function sensorLabel(name: string): string {
  const known: Record<string, string> = {
    'cpu-temperature': 'Temp. CPU', temperature: 'Temperatura', 'board-temperature1': 'Temp. placa',
    'board-temperature2': 'Temp. placa 2', 'sfp-temperature': 'Temp. SFP', 'switch-temperature': 'Temp. switch',
    'phy-temperature': 'Temp. puertos', voltage: 'Voltaje', 'power-consumption': 'Consumo eléctrico', current: 'Corriente',
  };
  if (known[name]) return known[name];
  const fan = name.match(/^fan(\d*)-speed$/);
  if (fan) return `Ventilador ${fan[1] || ''}`.trim();
  const psuState = name.match(/^psu(\d*)-state$/);
  if (psuState) return `Fuente ${psuState[1] || ''}`.trim();
  const psuVoltage = name.match(/^psu(\d*)-voltage$/);
  if (psuVoltage) return `Voltaje fuente ${psuVoltage[1] || ''}`.trim();
  return name.replace(/-/g, ' ');
}

/** Normaliza /system/health de RouterOS 7 (lista nombre/valor) y RouterOS 6 (un objeto). */
export function readSensors(health: unknown): SensorReading[] {
  const list = Array.isArray(health) ? health : [];
  const entries: Array<{ name: string; value: string; type: string }> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if ('name' in record && 'value' in record) {
      entries.push({ name: String(record['name']), value: String(record['value'] ?? ''), type: String(record['type'] ?? '') });
    } else {
      for (const [name, value] of Object.entries(record)) {
        if (name.startsWith('.')) continue;
        entries.push({ name, value: String(value ?? ''), type: '' });
      }
    }
  }
  return entries.filter((entry) => entry.value !== '').map((entry) => {
    const name = entry.name.toLowerCase();
    const value = num(entry.value);
    if (name.includes('temperature')) {
      const [warn, crit] = name.startsWith('cpu') ? [75, 85] : name.startsWith('sfp') ? [65, 75] : [60, 70];
      return { key: name, label: sensorLabel(name), display: value === null ? entry.value : `${value} °C`, kind: 'temperature' as const, level: levelFor(value, warn, crit) };
    }
    if (name.includes('voltage')) {
      return { key: name, label: sensorLabel(name), display: value === null ? entry.value : `${value} V`, kind: 'voltage' as const, level: 'ok' as HealthLevel };
    }
    if (name.includes('fan') && name.includes('speed')) {
      return { key: name, label: sensorLabel(name), display: value === null ? entry.value : `${value.toLocaleString('es-DO')} RPM`, kind: 'fan' as const, level: (value === 0 ? 'warn' : 'ok') as HealthLevel };
    }
    if (name.includes('psu') && name.includes('state')) {
      const ok = entry.value.toLowerCase() === 'ok';
      return { key: name, label: sensorLabel(name), display: ok ? 'Funciona' : 'Falla o sin conectar', kind: 'psu' as const, level: (ok ? 'ok' : 'warn') as HealthLevel };
    }
    const unit = entry.type && entry.type !== 'C' ? ` ${entry.type}` : '';
    return { key: name, label: sensorLabel(name), display: `${entry.value}${unit}`, kind: 'other' as const, level: 'none' as HealthLevel };
  });
}

export function evaluateRouterHealth(system: MtSystem | null): RouterHealth {
  const resource = (system?.resource || {}) as Record<string, unknown>;
  const cpuLoad = num(resource['cpu-load']);
  const totalMemory = num(resource['total-memory']);
  const freeMemory = num(resource['free-memory']);
  const totalDisk = num(resource['total-hdd-space']);
  const freeDisk = num(resource['free-hdd-space']);
  const memoryPct = totalMemory && freeMemory !== null ? Math.max(0, Math.min(100, ((totalMemory - freeMemory) / totalMemory) * 100)) : null;
  const diskPct = totalDisk && freeDisk !== null ? Math.max(0, Math.min(100, ((totalDisk - freeDisk) / totalDisk) * 100)) : null;
  const cpuCount = num(resource['cpu-count']);
  const cpuFrequency = num(resource['cpu-frequency']);

  const cpu: HealthMetric = {
    label: 'CPU', value: cpuLoad, display: cpuLoad === null ? '-' : `${cpuLoad.toFixed(0)}%`,
    detail: cpuCount ? `${cpuCount} ${cpuCount === 1 ? 'núcleo' : 'núcleos'}${cpuFrequency ? ` · ${cpuFrequency} MHz` : ''}` : 'Carga del procesador',
    level: levelFor(cpuLoad, 70, 85),
  };
  const memory: HealthMetric = {
    label: 'Memoria', value: memoryPct, display: memoryPct === null ? '-' : `${memoryPct.toFixed(0)}%`,
    detail: totalMemory && freeMemory !== null ? `${formatBytesShort(totalMemory - freeMemory)} de ${formatBytesShort(totalMemory)}` : 'Memoria RAM usada',
    level: levelFor(memoryPct, 80, 90),
  };
  const disk: HealthMetric = {
    label: 'Almacenamiento', value: diskPct, display: diskPct === null ? '-' : `${diskPct.toFixed(0)}%`,
    detail: totalDisk && freeDisk !== null ? `${formatBytesShort(freeDisk)} libres` : 'Espacio para respaldos',
    level: levelFor(diskPct, 80, 90),
  };
  const sensors = readSensors(system?.health);
  const uptimeSeconds = parseRouterUptime(resource['uptime']);

  const reasons: string[] = [];
  if (cpu.level === 'crit') reasons.push(`CPU muy cargada (${cpu.display})`);
  else if (cpu.level === 'warn') reasons.push(`CPU alta (${cpu.display})`);
  if (memory.level !== 'ok' && memory.level !== 'none') reasons.push(`Memoria ${memory.level === 'crit' ? 'casi llena' : 'alta'} (${memory.display})`);
  if (disk.level !== 'ok' && disk.level !== 'none') reasons.push(`Almacenamiento ${disk.level === 'crit' ? 'casi lleno' : 'alto'}: limpie respaldos viejos`);
  for (const sensor of sensors) {
    if (sensor.level === 'crit' || sensor.level === 'warn') {
      reasons.push(sensor.kind === 'psu' ? `${sensor.label}: falla o sin conectar`
        : sensor.kind === 'fan' ? `${sensor.label} detenido`
          : `${sensor.label} ${sensor.level === 'crit' ? 'muy alta' : 'elevada'} (${sensor.display})`);
    }
  }
  let uptimeLevel: HealthLevel = uptimeSeconds === null ? 'none' : 'ok';
  if (uptimeSeconds !== null && uptimeSeconds < 3_600) {
    uptimeLevel = 'warn';
    reasons.push(`Se reinició hace ${formatDuration(uptimeSeconds)}`);
  }

  const level = worstLevel([cpu.level, memory.level, disk.level, uptimeLevel, ...sensors.map((sensor) => sensor.level)]);
  const version = String(resource['version'] || '');
  return {
    level,
    label: healthLevelLabel(level),
    reasons,
    cpu, memory, disk, sensors, uptimeSeconds,
    version: version || '-',
    board: String(resource['board-name'] || '-'),
    architecture: String(resource['architecture-name'] || '-'),
    cpuInfo: String(resource['cpu'] || ''),
  };
}

// ---------------------------------------------------------------------------
// Inconsistencias calculables con /clients-live (sin pedir nada nuevo al servidor)

export type IssueKind = 'no-client' | 'no-queue' | 'no-ip' | 'dup-ip' | 'dup-mac' | 'name-diff' | 'state-diff' | 'paused' | 'no-limit' | 'saturated';

export const ISSUE_ORDER: IssueKind[] = ['dup-ip', 'no-client', 'no-queue', 'state-diff', 'paused', 'no-limit', 'dup-mac', 'saturated', 'no-ip', 'name-diff'];

export const ISSUE_INFO: Record<IssueKind, { title: string; detail: string; level: 'crit' | 'warn' | 'info'; short: string }> = {
  'dup-ip': { title: 'IP con más de una cola', detail: 'Dos colas apuntan a la misma IP: solo una limita al cliente.', level: 'crit', short: 'IP duplicada' },
  'no-client': { title: 'Colas sin cliente en WispHub', detail: 'Hay un equipo con cola en el router que no aparece como cliente. Puede estar navegando sin facturar.', level: 'warn', short: 'Sin cliente' },
  'no-queue': { title: 'Clientes sin cola', detail: 'Clientes de WispHub con IP que no tienen cola de velocidad en el router.', level: 'warn', short: 'Sin cola' },
  'state-diff': { title: 'Estado diferente', detail: 'La cola está deshabilitada en el router pero el cliente sigue activo en WispHub.', level: 'warn', short: 'Estado diferente' },
  paused: { title: 'Colas pausadas', detail: 'La cola existe pero está deshabilitada: ese equipo navega sin límite de velocidad.', level: 'warn', short: 'Cola pausada' },
  'no-limit': { title: 'Colas sin límite configurado', detail: 'La cola no tiene velocidad máxima: no controla el consumo del cliente.', level: 'warn', short: 'Sin límite' },
  'dup-mac': { title: 'MAC repetida en varias IPs', detail: 'El mismo equipo responde en varias IPs. Puede ser un repetidor o un cliente que cambió de IP.', level: 'info', short: 'MAC repetida' },
  saturated: { title: 'Clientes al tope del plan', detail: 'Usan 90% o más de su velocidad ahora mismo. Útil si reportan lentitud.', level: 'info', short: 'Al tope' },
  'no-ip': { title: 'Clientes sin IP asignada', detail: 'Clientes de WispHub sin IP: no se pueden vincular con el router.', level: 'info', short: 'Sin IP' },
  'name-diff': { title: 'Nombre de cola diferente', detail: 'El nombre de la cola no coincide con el registrado en WispHub.', level: 'info', short: 'Nombre diferente' },
};

export function normalizeMac(value: unknown): string {
  return String(value || '').toUpperCase().replace(/[^0-9A-F]/g, '');
}

export function detectIssues(rows: MtLiveClient[]): Record<IssueKind, MtLiveClient[]> {
  const result = Object.fromEntries(ISSUE_ORDER.map((kind) => [kind, [] as MtLiveClient[]])) as Record<IssueKind, MtLiveClient[]>;
  const queuesByIp = new Map<string, MtLiveClient[]>();
  const ipsByMac = new Map<string, Set<string>>();
  const rowsByMac = new Map<string, MtLiveClient[]>();

  for (const row of rows) {
    if (row.syncState === 'missing_wisphub') result['no-client'].push(row);
    if (row.syncState === 'missing_mikrotik') result['no-queue'].push(row);
    if (row.syncState === 'missing_ip') result['no-ip'].push(row);
    if (row.syncState === 'queue_mismatch') result['name-diff'].push(row);
    if (row.syncState === 'state_mismatch') result['state-diff'].push(row);
    if (row.queueId && row.isDisabled) result.paused.push(row);
    if (row.queueId && !row.maxUploadBps && !row.maxDownloadBps) result['no-limit'].push(row);
    if (row.queueId && row.isOnline && !row.isDisabled && Math.max(row.uploadPct || 0, row.downloadPct || 0) >= 90) result.saturated.push(row);
    if (row.queueId && row.ip) {
      const list = queuesByIp.get(row.ip) || [];
      list.push(row);
      queuesByIp.set(row.ip, list);
    }
    const mac = normalizeMac(row.macAddress);
    if (row.ip && mac.length === 12 && mac !== '000000000000' && mac !== 'FFFFFFFFFFFF') {
      const ips = ipsByMac.get(mac) || new Set<string>();
      ips.add(row.ip);
      ipsByMac.set(mac, ips);
      const list = rowsByMac.get(mac) || [];
      list.push(row);
      rowsByMac.set(mac, list);
    }
  }
  for (const list of queuesByIp.values()) if (list.length > 1) result['dup-ip'].push(...list);
  for (const [mac, ips] of ipsByMac) if (ips.size > 1) result['dup-mac'].push(...(rowsByMac.get(mac) || []));
  result.saturated.sort((a, b) => Math.max(b.uploadPct, b.downloadPct) - Math.max(a.uploadPct, a.downloadPct));
  result['dup-ip'].sort((a, b) => compareIp(a.ip, b.ip));
  result['dup-mac'].sort((a, b) => normalizeMac(a.macAddress).localeCompare(normalizeMac(b.macAddress)) || compareIp(a.ip, b.ip));
  return result;
}

// ---------------------------------------------------------------------------
// IPv4

export function ipToInt(ip: string): number | null {
  const parts = String(ip || '').split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!/^\d{1,3}$/.test(part) || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function intToIp(value: number): string {
  return [Math.floor(value / 16_777_216) % 256, Math.floor(value / 65_536) % 256, Math.floor(value / 256) % 256, value % 256].join('.');
}

export function compareIp(a: string | null | undefined, b: string | null | undefined): number {
  const left = ipToInt(String(a || ''));
  const right = ipToInt(String(b || ''));
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Preferencias de vista (solo comodidad local; si el navegador bloquea el almacenamiento, se ignora).
const PREFS_KEY = 'ispmax.mikrotik.prefs';

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const prefs = raw ? JSON.parse(raw) : {};
    return prefs && key in prefs ? (prefs[key] as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const prefs = raw ? JSON.parse(raw) : {};
    prefs[key] = value;
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Almacenamiento no disponible: la vista funciona igual sin recordar la preferencia.
  }
}
