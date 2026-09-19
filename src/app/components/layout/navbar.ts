import { Component, OnInit, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LucideMenu, LucideSearch, LucideX } from '@lucide/angular';
import { LocalDbService } from '../../services/local-db.service';
import { WispHubClient } from '../../models/client.model';
import { UiService } from '../../services/ui.service';
import { PlanLabelPipe } from '../../pipes/plan-label.pipe';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [FormsModule, LucideMenu, LucideSearch, LucideX, PlanLabelPipe],
  template: `
    <header class="navbar">
      <div class="navbar-left">
        <button class="menu-btn" type="button" aria-label="Abrir menú" title="Abrir menú" (click)="ui.openSidebar()">
          <svg lucideMenu size="22"></svg>
        </button>
        <h1 class="page-title">{{ pageTitle() }}</h1>
      </div>
      <div class="navbar-right">
        <div class="search-box" [class.focused]="searchFocused()">
          <svg lucideSearch size="16" aria-hidden="true"></svg>
          <input type="search" placeholder="Buscar cliente por nombre, IP o teléfono…"
            aria-label="Buscar cliente por nombre, IP, teléfono, usuario o MAC"
            autocomplete="off"
            [(ngModel)]="searchTerm"
            (focus)="searchFocused.set(true); search()"
            (blur)="closeSoon()"
            (keydown.escape)="clearSearch()"
            (keydown.enter)="openFirst()"
            (input)="search()" />
          @if (searchTerm) {
            <button type="button" class="clear-btn" aria-label="Borrar búsqueda" title="Borrar búsqueda"
              (mousedown)="$event.preventDefault()" (click)="clearSearch()">
              <svg lucideX size="14"></svg>
            </button>
          }
          @if (searchFocused() && searchTerm.trim().length >= 2) {
            <div class="search-results" role="listbox">
              @for (c of results(); track c.id_servicio) {
                <div class="result-item" role="option" (mousedown)="goToClient(c.id_servicio)">
                  <div class="result-main">
                    <span class="result-name">{{ c.nombre }}</span>
                    <span class="result-plan">{{ c.plan_internet?.nombre | planLabel:'' }}</span>
                  </div>
                  <div class="result-meta">
                    <span class="result-ip">{{ c.ip || '—' }}</span>
                    @if (c.telefono) { <span class="result-phone">{{ c.telefono }}</span> }
                  </div>
                </div>
              } @empty {
                <div class="result-empty">
                  No se encontró ningún cliente con “{{ searchTerm.trim() }}”.
                  <small>Prueba con parte del nombre, la IP o el teléfono.</small>
                </div>
              }
            </div>
          }
        </div>
      </div>
    </header>
  `,
  styles: [`
    .navbar {
      height: 64px; background: white; border-bottom: 1px solid #dfe5ea;
      display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 24px;
      position: sticky; top: 0; z-index: 50;
    }
    .navbar-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .menu-btn {
      display: none; background: none; border: none; padding: 8px;
      border-radius: 6px; cursor: pointer; color: #334250;
    }
    .menu-btn:hover { background: #f2f7ff; color: #1267dd; }

    .page-title {
      font-size: 20px; font-weight: 700; color: #172535; margin: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .navbar-right { display: flex; align-items: center; gap: 16px; min-width: 0; }

    .search-box {
      position: relative; display: flex; align-items: center; gap: 8px;
      background: #f8fafc; border-radius: 6px; padding: 7px 10px 7px 14px;
      color: #667582; border: 1px solid #dfe5ea; transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    .search-box.focused { background: white; border-color: #1267dd; box-shadow: 0 0 0 3px rgba(18, 103, 221, 0.12); }
    .search-box input { border: none; background: none; outline: none; font-size: 13px; color: #334250; width: 260px; min-width: 0; }
    .search-box input::placeholder { color: #667582; }
    .search-box input::-webkit-search-cancel-button { display: none; }
    .clear-btn {
      display: grid; place-items: center; border: none; background: none; cursor: pointer;
      color: #667582; padding: 3px; border-radius: 6px; flex-shrink: 0;
    }
    .clear-btn:hover { background: #edf4ff; color: #1267dd; }

    .search-results {
      position: absolute; top: calc(100% + 6px); right: 0; width: 380px; max-width: calc(100vw - 32px);
      background: white; border: 1px solid #dfe5ea; border-radius: 8px;
      box-shadow: 0 12px 30px rgba(17, 26, 36, 0.12); max-height: 340px; overflow-y: auto; z-index: 200;
    }
    .result-item {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: 10px 14px; cursor: pointer; transition: background 0.1s;
      border-bottom: 1px solid #f0f3f6;
    }
    .result-item:last-child { border-bottom: none; }
    .result-item:hover { background: #f2f7ff; }
    .result-main { min-width: 0; }
    .result-name { display: block; font-size: 13px; font-weight: 600; color: #172535; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .result-plan { display: block; font-size: 11px; color: #1267dd; }
    .result-meta { text-align: right; flex-shrink: 0; }
    .result-ip { display: block; font-size: 12px; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; color: #334250; }
    .result-phone { display: block; font-size: 11px; color: #667582; }
    .result-empty { padding: 14px; font-size: 13px; color: #334250; }
    .result-empty small { display: block; margin-top: 4px; font-size: 12px; color: #667582; }

    @media (max-width: 1024px) {
      .menu-btn { display: flex; }
      .page-title { font-size: 18px; }
    }

    @media (max-width: 640px) {
      .navbar { padding: 0 12px; }
      .search-box input { width: 150px; }
      .page-title { font-size: 16px; }
    }

    @media (max-width: 480px) {
      .page-title { display: none; }
      .search-box input { width: 100%; }
      .search-box { flex: 1; }
      .navbar-right { flex: 1; }
      .search-results { position: fixed; top: 60px; left: 12px; right: 12px; width: auto; max-width: none; }
    }
  `]
})
export class NavbarComponent implements OnInit {
  pageTitle = input('Dashboard');
  ui = inject(UiService);

  private router = inject(Router);
  private db = inject(LocalDbService);

  searchTerm = '';
  searchFocused = signal(false);
  results = signal<WispHubClient[]>([]);
  private allClients: WispHubClient[] = [];

  async ngOnInit() {
    this.allClients = await this.db.getClients();
  }

  search() {
    const term = this.searchTerm.toLowerCase().trim();
    if (!term || term.length < 2) { this.results.set([]); return; }
    const r = this.allClients.filter(c =>
      c.nombre?.toLowerCase().includes(term) ||
      c.ip?.includes(term) ||
      c.telefono?.includes(term) ||
      c.usuario?.toLowerCase().includes(term) ||
      c.mac_cpe?.toLowerCase().includes(term)
    ).slice(0, 8);
    this.results.set(r);
  }

  goToClient(id: number) {
    this.searchTerm = '';
    this.results.set([]);
    this.searchFocused.set(false);
    this.router.navigate(['/clients', id]);
  }

  /** Enter abre el primer resultado. */
  openFirst() {
    const first = this.results()[0];
    if (first) this.goToClient(first.id_servicio);
  }

  clearSearch() {
    this.searchTerm = '';
    this.results.set([]);
  }

  closeSoon() {
    setTimeout(() => { this.searchFocused.set(false); this.results.set([]); }, 200);
  }
}
