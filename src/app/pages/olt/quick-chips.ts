import { Component, input, output } from '@angular/core';

export interface QuickChip {
  key: string;
  label: string;
  count?: number | null;
  tone?: 'neutral' | 'danger' | 'warning' | 'info' | 'success';
  hint?: string;
}

/** Filtros rápidos en forma de chips con contador. Solo cambia la vista local. */
@Component({
  selector: 'app-quick-chips',
  standalone: true,
  template: `
    <div class="chips" role="group" [attr.aria-label]="ariaLabel()">
      @for (chip of chips(); track chip.key) {
        <button type="button" [class]="'chip tone-' + (chip.tone || 'neutral')" [class.active]="active() === chip.key"
          [attr.aria-pressed]="active() === chip.key" [title]="chip.hint || chip.label" (click)="selected.emit(chip.key)">
          <span>{{ chip.label }}</span>
          @if (chip.count != null) { <b>{{ chip.count }}</b> }
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .chips { display: flex; gap: 6px; overflow-x: auto; padding: 1px 1px 3px; scrollbar-width: thin; }
    .chip { flex: 0 0 auto; min-height: 32px; display: inline-flex; align-items: center; gap: 7px; padding: 0 10px; border: 1px solid #ccd6de; border-radius: 16px; background: #fff; color: #334250; font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; white-space: nowrap; }
    .chip:hover { border-color: #9fb3c2; background: #f8fafc; }
    .chip:focus-visible { outline: 2px solid #1267dd; outline-offset: 1px; }
    .chip b { min-width: 20px; height: 20px; display: inline-grid; place-items: center; padding: 0 6px; border-radius: 10px; background: #eef2f5; color: #334250; font-size: 11px; }
    .chip.tone-danger b { background: #fff0ef; color: #b42318; }
    .chip.tone-warning b { background: #fff6e8; color: #b36b12; }
    .chip.tone-info b { background: #edf4ff; color: #1267dd; }
    .chip.tone-success b { background: #e9f8f1; color: #13875a; }
    .chip.active { border-color: #1267dd; background: #edf4ff; color: #0d58c0; }
    .chip.active b { background: #1267dd; color: #fff; }
  `],
})
export class QuickChipsComponent {
  readonly chips = input.required<QuickChip[]>();
  readonly active = input<string | null>(null);
  readonly ariaLabel = input('Filtros rápidos');
  readonly selected = output<string>();
}
