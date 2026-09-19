import { Component, inject, input } from '@angular/core';
import { LucideCopy } from '@lucide/angular';
import { ToastService } from '../../services/toast.service';

/** Valor técnico (serial, IP, MAC) con botón para copiarlo al portapapeles. Solo lectura. */
@Component({
  selector: 'app-copy-value',
  standalone: true,
  imports: [LucideCopy],
  template: `
    <span class="value" [class.mono]="mono()" [class.empty]="!value()">{{ value() || '--' }}</span>
    @if (value()) {
      <button type="button" class="copy" [title]="'Copiar ' + label()" [attr.aria-label]="'Copiar ' + label()" (click)="copy($event)">
        <svg lucideCopy size="13" aria-hidden="true"></svg>
      </button>
    }
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-width: 0; vertical-align: middle; }
    .value { min-width: 0; overflow-wrap: anywhere; }
    .value.empty { color: #8a969f; }
    .mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; }
    .copy { width: 24px; height: 24px; flex: 0 0 auto; display: inline-grid; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #7a8893; cursor: pointer; }
    .copy:hover, .copy:focus-visible { border-color: #cfd8df; background: #edf4ff; color: #1267dd; outline: 0; }
  `],
})
export class CopyValueComponent {
  private readonly toast = inject(ToastService);
  readonly value = input<string | null | undefined>('');
  readonly label = input('valor');
  readonly mono = input(true);

  copy(event: MouseEvent) {
    event.stopPropagation();
    const text = String(this.value() || '').trim();
    if (!text) return;
    if (!navigator.clipboard) { this.toast.info('El navegador no permite copiar automáticamente'); return; }
    navigator.clipboard.writeText(text)
      .then(() => this.toast.success(`Copiado al portapapeles: ${text}`))
      .catch(() => this.toast.error('No se pudo copiar al portapapeles'));
  }
}
