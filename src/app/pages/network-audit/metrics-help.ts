import { Component, input } from '@angular/core';
import { LucideCircleHelp } from '@lucide/angular';

/** Explicación en lenguaje sencillo de cada dato de la auditoría. */
@Component({
  selector: 'app-metrics-help',
  standalone: true,
  imports: [LucideCircleHelp],
  template: `
    <details class="help" [open]="open()">
      <summary><svg lucideCircleHelp size="16" aria-hidden="true"></svg>¿Qué significa cada dato?</summary>
      <dl>
        <div><dt>Disponibilidad</dt><dd>De todas las lecturas, cuántas encontraron al cliente <b>con servicio</b>. 100 % = nunca se cayó. Cada 1 % menos en 30 días son unas 7 horas sin Internet.</dd></div>
        <div><dt>Estabilidad</dt><dd>Cuántas lecturas salieron <b>sin ningún problema</b> (con servicio, buena señal de fibra y cola correcta). Es más exigente que la disponibilidad.</dd></div>
        <div><dt>Caídas / horas sin servicio</dt><dd>Lecturas en las que el cliente estaba fuera de línea. Como se lee cada {{ intervalLabel() }}, cada caída equivale a unos {{ intervalLabel() }} sin servicio.</dd></div>
        <div><dt>Lectura degradada</dt><dd>El cliente tenía servicio pero con un problema: señal de fibra fuera de rango, cola de velocidad desactivada o con nombre distinto al del sistema.</dd></div>
        <div><dt>Señal de fibra (dBm)</dt><dd>Potencia de luz que llega a la ONU. Entre −8 y −27 dBm está correcta; de −27 a −30 es débil (revisar conectores y empalmes); −30 o menos es crítica y el cliente puede perder el servicio. Más alta que −8 es demasiado fuerte.</dd></div>
        <div><dt>Uso actual y pico</dt><dd>Velocidad que el cliente estaba usando en la última lectura y la más alta vista en el período. Si el pico llega siempre al plan, el cliente se queda corto de velocidad.</dd></div>
        <div><dt>Muestras</dt><dd>Cantidad de lecturas guardadas. Con pocas muestras (cliente nuevo o auditoría recién activada) los porcentajes todavía no son confiables.</dd></div>
        <div><dt>Enlace a Internet</dt><dd>Tráfico total del proveedor de Internet, ping hacia fuera y pérdida de paquetes, medidos desde el MikroTik. Si el enlace se degrada, afecta a todos los clientes a la vez.</dd></div>
      </dl>
    </details>
  `,
  styles: [`
    :host { display: block; }
    .help { margin-bottom: 14px; background: #eef6f1; border: 1px solid #cfe0f8; border-radius: 12px; }
    summary { display: flex; align-items: center; gap: 7px; padding: 10px 14px; color: #0b6b52; font-size: 13px; font-weight: 700; cursor: pointer; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary::after { content: '▾'; margin-left: auto; transition: transform .15s; }
    details[open] summary::after { transform: rotate(180deg); }
    summary:focus-visible { outline: 2px solid #0b6b52; outline-offset: 2px; border-radius: 12px; }
    dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 20px; margin: 0; padding: 4px 14px 14px; }
    dl div { min-width: 0; }
    dt { font-size: 12px; font-weight: 800; color: #15211c; }
    dd { margin: 2px 0 0; font-size: 12px; line-height: 1.5; color: #2d3b34; }
    @media (max-width: 760px) { dl { grid-template-columns: 1fr; } }
  `],
})
export class MetricsHelpComponent {
  readonly open = input(false);
  readonly intervalMs = input(600000);
  intervalLabel(): string {
    const min = Math.round((this.intervalMs() || 600000) / 60000);
    return min === 1 ? '1 minuto' : `${min} minutos`;
  }
}
