import { Component, ElementRef, HostListener, computed, input, output, signal, viewChild } from '@angular/core';
import { LucideSearch } from '@lucide/angular';
import type { OltOnu } from '../../services/olt.service';
import { formatDbm, matchesOnu, normalizeSearch, onuDisplayName, onuHealthState, onuIp, onuMac, onuStatusLabel } from './olt-helpers';

/**
 * Búsqueda global de la OLT: encuentra al instante por cliente, usuario, IP, serial, MAC o nombre
 * usando el inventario ya cargado (sin llamadas nuevas al servidor). Atajo: tecla «/» o Ctrl+K.
 */
@Component({
  selector: 'app-onu-global-search',
  standalone: true,
  imports: [LucideSearch],
  template: `
    <label class="search-box">
      <svg lucideSearch size="17" aria-hidden="true"></svg>
      <input #field type="search" [value]="query()" (input)="changed(field.value)" (focus)="open.set(true)" (blur)="open.set(false)"
        (keydown)="keydown($event)" placeholder="Buscar cliente, IP, serial o MAC" aria-label="Buscar ONU por cliente, IP, serial o MAC"
        role="combobox" [attr.aria-expanded]="showPanel()" aria-controls="onu-global-results" autocomplete="off" />
      <kbd title="Atajo de teclado">/</kbd>
    </label>
    @if (showPanel()) {
      <div class="panel" id="onu-global-results" role="listbox" (mousedown)="$event.preventDefault()">
        @for (onu of results(); track onu.id; let index = $index) {
          <button type="button" role="option" class="result" [class.active]="index === activeIndex()" [attr.aria-selected]="index === activeIndex()"
            (mouseenter)="activeIndex.set(index)" (click)="choose(onu)">
            <i [class]="'dot ' + state(onu)"></i>
            <span class="copy">
              <strong>{{ name(onu) }}</strong>
              <small>PON {{ onu.pon }} · ONU {{ onu.onuId }}@if (onu.serial) { · <span class="mono">{{ onu.serial }}</span> }@if (ip(onu)) { · <span class="mono">{{ ip(onu) }}</span> }@if (mac(onu)) { · <span class="mono">{{ mac(onu) }}</span> }</small>
            </span>
            <span [class]="'side ' + state(onu)">{{ onu.online ? dbm(onu.rxPowerDbm) : statusLabel(onu) }}</span>
          </button>
        } @empty {
          <p class="empty">Sin coincidencias en las {{ onus().length }} ONUs cargadas.</p>
        }
        <footer>
          <span>{{ matchCount() }} {{ matchCount() === 1 ? 'coincidencia' : 'coincidencias' }} · Enter abre la primera</span>
          <button type="button" (click)="open.set(false); showAll.emit()">Ver en inventario</button>
        </footer>
      </div>
    }
  `,
  styles: [`
    :host { position: relative; display: block; width: clamp(240px, 30vw, 400px); }
    .search-box { height: 38px; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 11px; border: 1px solid #ccd6de; border-radius: 6px; background: #fff; color: #667582; }
    .search-box:focus-within { border-color: #1267dd; box-shadow: 0 0 0 3px #edf4ff; }
    input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: #172535; font: inherit; font-size: 13px; }
    kbd { min-width: 20px; height: 20px; display: inline-grid; place-items: center; border: 1px solid #dfe5ea; border-radius: 4px; background: #f8fafc; color: #667582; font: 600 11px ui-monospace, 'Cascadia Mono', Consolas, monospace; }
    .panel { position: absolute; z-index: 60; top: calc(100% + 6px); right: 0; width: max(100%, 420px); max-width: calc(100vw - 20px); overflow: hidden; border: 1px solid #ccd6de; border-radius: 8px; background: #fff; box-shadow: 0 16px 40px rgba(23, 37, 53, .18); }
    .result { width: 100%; min-height: 54px; display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 8px 12px; border: 0; border-bottom: 1px solid #eef2f5; background: #fff; color: #334250; font: inherit; text-align: left; cursor: pointer; }
    .result.active { background: #f2f7ff; }
    .copy { min-width: 0; display: grid; gap: 2px; }
    .copy strong { overflow: hidden; color: #172535; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .copy small { overflow: hidden; color: #667582; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #13875a; }
    .dot.warning { background: #b36b12; } .dot.critical, .dot.offline { background: #b42318; }
    .side { font-size: 11px; font-weight: 700; color: #13875a; white-space: nowrap; }
    .side.warning { color: #b36b12; } .side.critical, .side.offline { color: #b42318; }
    .empty { margin: 0; padding: 18px 14px; color: #667582; font-size: 12px; text-align: center; }
    footer { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 12px; background: #f8fafc; color: #667582; font-size: 11px; }
    footer button { border: 0; background: transparent; color: #1267dd; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
    @media (max-width: 840px) { :host { flex: 1; width: auto; } }
    @media (max-width: 560px) { :host { width: 100%; } kbd { display: none; } .panel { width: 100%; } }
  `],
})
export class OnuGlobalSearchComponent {
  readonly onus = input.required<OltOnu[]>();
  readonly query = input('');
  readonly queryChange = output<string>();
  readonly openOnu = output<OltOnu>();
  readonly showAll = output<void>();

  readonly open = signal(false);
  readonly activeIndex = signal(0);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  private readonly matches = computed(() => {
    const query = this.query().trim();
    if (query.length < 2) return [];
    const exact = normalizeSearch(query).replace(/[:.-]/g, '');
    const rows = this.onus().filter((onu) => matchesOnu(onu, query));
    const isExact = (onu: OltOnu) => [onu.serial, onuIp(onu), onuMac(onu), onu.onuIndex]
      .some((value) => value && normalizeSearch(value).replace(/[:.-]/g, '') === exact);
    return rows.sort((a, b) => Number(isExact(b)) - Number(isExact(a)));
  });
  readonly results = computed(() => this.matches().slice(0, 8));
  readonly matchCount = computed(() => this.matches().length);
  readonly showPanel = computed(() => this.open() && this.query().trim().length >= 2);

  @HostListener('document:keydown', ['$event'])
  shortcut(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    const ctrlK = (event.ctrlKey || event.metaKey) && String(event.key || '').toLowerCase() === 'k';
    if (ctrlK || (event.key === '/' && !typing)) {
      event.preventDefault();
      this.field()?.nativeElement.focus();
      this.field()?.nativeElement.select();
    }
  }

  changed(value: string) {
    this.activeIndex.set(0);
    this.open.set(true);
    this.queryChange.emit(value);
  }

  keydown(event: KeyboardEvent) {
    const count = this.results().length;
    if (event.key === 'ArrowDown' && count) { event.preventDefault(); this.activeIndex.update((index) => (index + 1) % count); }
    else if (event.key === 'ArrowUp' && count) { event.preventDefault(); this.activeIndex.update((index) => (index - 1 + count) % count); }
    else if (event.key === 'Enter') {
      const onu = this.results()[this.activeIndex()] || this.results()[0];
      if (onu) { event.preventDefault(); this.choose(onu); }
    } else if (event.key === 'Escape') { this.open.set(false); }
  }

  choose(onu: OltOnu) {
    this.open.set(false);
    this.field()?.nativeElement.blur();
    this.openOnu.emit(onu);
  }

  name(onu: OltOnu) { return onuDisplayName(onu); }
  ip(onu: OltOnu) { return onuIp(onu); }
  mac(onu: OltOnu) { return onuMac(onu); }
  state(onu: OltOnu) { return onuHealthState(onu); }
  dbm(value?: number | null) { return formatDbm(value); }
  statusLabel(onu: OltOnu) { return onuStatusLabel(onu); }
}
