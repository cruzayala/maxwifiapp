import { Pipe, PipeTransform } from '@angular/core';

const SPEED = /(\d+(?:\.\d+)?)\s*([kKmM])/;

function toMbps(value: string, unit: string): string {
  const mbps = unit.toLowerCase() === 'k' ? Number(value) / 1000 : Number(value);
  return Number(mbps.toFixed(1)).toString();
}

/**
 * Nombres de plan de WispHub a texto legible:
 * "3300k/3300k" -> "3.3 Mbps", "4M/2600k" -> "4 / 2.6 Mbps", "10M | 10M FIbra" -> "10 Mbps · Fibra".
 * Cualquier otro nombre se devuelve tal cual.
 */
export function formatPlanName(raw: string | null | undefined, empty = 'Sin plan'): string {
  const name = String(raw || '').trim();
  if (!name) return empty;
  const match = name.match(/^(\d+(?:\.\d+)?)\s*([kKmM])\s*[/|]\s*(\d+(?:\.\d+)?)\s*([kKmM])\s*(.*)$/);
  if (!match || !SPEED.test(name)) return name;
  const down = toMbps(match[1], match[2]);
  const up = toMbps(match[3], match[4]);
  const speed = down === up ? `${down} Mbps` : `${down} / ${up} Mbps`;
  const suffix = match[5].trim();
  if (!suffix) return speed;
  const pretty = suffix.charAt(0).toUpperCase() + suffix.slice(1).toLowerCase();
  return `${speed} · ${pretty}`;
}

@Pipe({ name: 'planLabel', standalone: true })
export class PlanLabelPipe implements PipeTransform {
  transform(value: string | null | undefined, empty = 'Sin plan'): string {
    return formatPlanName(value, empty);
  }
}
