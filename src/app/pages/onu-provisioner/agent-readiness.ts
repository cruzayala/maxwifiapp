import { Component, computed, input } from '@angular/core';
import { LucideCircleAlert, LucideCircleCheck, LucideClock } from '@lucide/angular';

/** Datos mínimos del agente que usa la lista de verificación (estructura del endpoint de agentes). */
export interface ReadinessAgent {
  online: boolean;
  active: boolean;
  isAdmin: boolean;
  version?: string | null;
  lastSeenAt?: string | null;
  capabilities?: {
    adapters?: Array<{ index: number; name: string; status?: string; supported?: boolean }>;
    networkRanges?: Array<{ cidr: string; active: boolean }>;
  } | null;
  discovery?: { detected?: boolean; next_action?: string; device?: { model?: string; host?: string } | null } | null;
}

interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  optional?: boolean;
  detail: string;
}

/**
 * «¿Listo para configurar?»: explica en lenguaje sencillo el estado del agente de Windows y qué hacer
 * si algo falta. Solo lectura: se calcula con los datos que el centro de agentes ya recibe.
 */
@Component({
  selector: 'app-agent-readiness',
  standalone: true,
  imports: [LucideCircleCheck, LucideCircleAlert, LucideClock],
  template: `
    <section class="readiness" [class.ready]="pending() === 0" aria-label="Estado del agente">
      <header>
        <div>
          <strong>{{ pending() === 0 ? 'Listo para configurar' : 'Antes de empezar: ' + pending() + (pending() === 1 ? ' punto pendiente' : ' puntos pendientes') }}</strong>
          <small><svg lucideClock size="13" aria-hidden="true"></svg>Última señal del agente {{ lastSeen() }}</small>
        </div>
        <span class="score">{{ okCount() }}/{{ checks().length }}</span>
      </header>
      <ol>
        @for (check of checks(); track check.key) {
          <li [class.ok]="check.ok" [class.optional]="!check.ok && check.optional">
            @if (check.ok) { <svg lucideCircleCheck size="16" aria-hidden="true"></svg> } @else { <svg lucideCircleAlert size="16" aria-hidden="true"></svg> }
            <span><b>{{ check.label }}</b><small>{{ check.detail }}</small></span>
          </li>
        }
      </ol>
    </section>
  `,
  styles: [`
    :host { display: block; margin-top: 14px; }
    .readiness { border: 1px solid #f0d3a6; border-radius: 8px; background: #fffdf8; overflow: hidden; }
    .readiness.ready { border-color: #b7e2cd; background: #fbfefc; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid #f3e4c9; background: #fff6e8; }
    .ready header { border-bottom-color: #d4efe1; background: #e9f8f1; }
    header > div { display: grid; gap: 3px; }
    header strong { color: #172535; font-size: 13px; }
    header small { display: inline-flex; align-items: center; gap: 5px; color: #667582; font-size: 11px; }
    .score { min-width: 42px; padding: 3px 8px; border-radius: 10px; background: #fff; color: #b36b12; font-size: 12px; font-weight: 800; text-align: center; }
    .ready .score { color: #13875a; }
    ol { margin: 0; padding: 4px 0; list-style: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    li { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; color: #b42318; }
    li.ok { color: #13875a; }
    li.optional { color: #b36b12; }
    li svg { flex: 0 0 auto; margin-top: 1px; }
    li span { display: grid; gap: 2px; min-width: 0; }
    li b { color: #172535; font-size: 12px; }
    li small { color: #667582; font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
    @media (max-width: 760px) { ol { grid-template-columns: 1fr; } }
  `],
})
export class AgentReadinessComponent {
  readonly agent = input.required<ReadinessAgent>();
  readonly latestVersion = input<string | null | undefined>(null);

  readonly checks = computed<ReadinessCheck[]>(() => {
    const agent = this.agent();
    const adapters = agent.capabilities?.adapters || [];
    const usable = adapters.filter((item) => item.supported !== false && String(item.status || '').toLowerCase() === 'up');
    const ranges = (agent.capabilities?.networkRanges || []).filter((item) => item.active);
    const latest = this.latestVersion();
    const outdated = Boolean(latest && agent.version && this.compareVersions(agent.version, latest) < 0);
    const device = agent.discovery?.device;
    return [
      {
        key: 'online', label: 'Agente conectado', ok: agent.online,
        detail: agent.online ? `ONU Studio responde (${this.lastSeen()}).` : 'Abra ONU Studio en esa PC y verifique que tenga Internet.',
      },
      {
        key: 'admin', label: 'Permisos de administrador', ok: agent.isAdmin,
        detail: agent.isAdmin ? 'Puede preparar la tarjeta de red automáticamente.' : 'Cierre ONU Studio y ábralo con clic derecho → «Ejecutar como administrador».',
      },
      {
        key: 'adapter', label: 'Cable Ethernet conectado', ok: usable.length > 0,
        detail: usable.length ? `Tarjeta lista: ${usable[0].name}.` : adapters.length ? 'Conecte el cable de red entre la PC y un puerto LAN de la ONU.' : 'El agente no reportó tarjetas de red. Reinicie ONU Studio.',
      },
      {
        key: 'detected', label: 'ONU detectada', ok: Boolean(agent.discovery?.detected),
        detail: agent.discovery?.detected
          ? `${device?.model || 'ONU'} responde en ${device?.host || 'la red local'}.`
          : (agent.discovery?.next_action || 'Encienda la ONU, espere 1 minuto y pulse «Actualizar detección».'),
      },
      {
        key: 'ranges', label: 'Rangos de IP para clientes', ok: ranges.length > 0, optional: true,
        detail: ranges.length ? `${ranges.length} ${ranges.length === 1 ? 'rango activo' : 'rangos activos'} para asignar IP.` : 'Necesario solo en modo Router: configure un rango activo en el agente.',
      },
      {
        key: 'version', label: 'Versión del agente', ok: !outdated, optional: true,
        detail: outdated ? `Tiene v${agent.version}; hay v${latest}. Descárguela con «Descargar agente para Windows».` : `v${agent.version || '--'}${latest ? ' (al día)' : ''}.`,
      },
    ];
  });

  readonly okCount = computed(() => this.checks().filter((check) => check.ok).length);
  /** Solo cuentan como bloqueo los puntos obligatorios. */
  readonly pending = computed(() => this.checks().filter((check) => !check.ok && !check.optional).length);

  lastSeen() {
    const value = this.agent().lastSeenAt;
    if (!value) return 'sin registro';
    const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return `hace ${seconds} s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    return `hace ${Math.round(hours / 24)} días`;
  }

  private compareVersions(left: string, right: string) {
    const a = left.replace(/^v/i, '').split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
    const b = right.replace(/^v/i, '').split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const diff = (a[index] || 0) - (b[index] || 0);
      if (diff) return diff;
    }
    return 0;
  }
}
