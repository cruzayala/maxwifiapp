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
        <button class="search-toggle" type="button" aria-label="Buscar cliente" title="Buscar cliente"
          [attr.aria-expanded]="mobileSearch()" (click)="toggleMobileSearch()">
          @if (mobileSearch()) { <svg lucideX size="20"></svg> } @else { <svg lucideSearch size="20"></svg> }
        </button>
        <div class="search-box" [class.focused]="searchFocused()" [class.mobile-open]="mobileSearch()">
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
      height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 28px;
      position: sticky; top: 0; z-index: 50;
      background: rgba(255, 255, 255, 0.86);
      backdrop-filter: saturate(160%) blur(14px); -webkit-backdrop-filter: saturate(160%) blur(14px);
      border-bottom: 1px solid #e0e6e1;
    }
    .navbar-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .menu-btn, .search-toggle {
      display: none; width: 42px; height: 42px; align-items: center; justify-content: center;
      background: none; border: none; border-radius: 12px; cursor: pointer; color: #2d3b34;
    }
    .menu-btn:hover, .search-toggle:hover { background: #eef6f1; color: #0b6b52; }

    .page-title {
      margin: 0; font-family: var(--isp-display); font-size: 21px; font-weight: 600; letter-spacing: -0.3px; color: #15211c;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .navbar-right { display: flex; align-items: center; gap: 12px; min-width: 0; }

    .search-box {
      position: relative; display: flex; align-items: center; gap: 9px; height: 42px;
      background: #f4f6f2; border-radius: 12px; padding: 0 10px 0 14px;
      color: #56665e; border: 1px solid #e0e6e1;
    }
    .search-box.focused { background: white; border-color: #0b6b52; box-shadow: 0 0 0 3px rgba(11, 107, 82, 0.13); }
    .search-box input { border: none !important; box-shadow: none !important; background: none; outline: none; font-size: 13.5px; color: #2d3b34; width: 280px; min-width: 0; }
    .search-box input::placeholder { color: #56665e; }
    .search-box input::-webkit-search-cancel-button { display: none; }
    .clear-btn {
      display: grid; place-items: center; border: none; background: none; cursor: pointer;
      color: #56665e; padding: 4px; border-radius: 8px; flex-shrink: 0;
    }
    .clear-btn:hover { background: #e6f2ec; color: #0b6b52; }

    .search-results {
      position: absolute; top: calc(100% + 8px); right: 0; width: 400px; max-width: calc(100vw - 24px);
      background: white; border: 1px solid #e0e6e1; border-radius: 14px; padding: 6px;
      box-shadow: 0 18px 40px rgba(14, 29, 23, 0.14); max-height: 360px; overflow-y: auto; z-index: 200;
      animation: results-in .16s ease both;
    }
    @keyframes results-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    .result-item {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: 10px 12px; cursor: pointer; border-radius: 10px;
    }
    .result-item:hover { background: #eef6f1; }
    .result-main { min-width: 0; }
    .result-name { display: block; font-size: 13.5px; font-weight: 600; color: #15211c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .result-plan { display: block; font-size: 11.5px; color: #0b6b52; }
    .result-meta { text-align: right; flex-shrink: 0; }
    .result-ip { display: block; font-size: 12px; font-family: var(--isp-mono); color: #2d3b34; }
    .result-phone { display: block; font-size: 11.5px; color: #56665e; }
    .result-empty { padding: 14px; font-size: 13px; color: #2d3b34; }
    .result-empty small { display: block; margin-top: 4px; font-size: 12px; color: #56665e; }

    @media (max-width: 1024px) {
      .menu-btn { display: flex; }
      .navbar { padding: 0 16px; }
    }

    /* Celular: la lupa abre el buscador a lo ancho, debajo de la barra. */
    @media (max-width: 768px) {
      .navbar { height: 60px; padding: 0 10px; }
      .page-title { font-size: 18px; }
      .search-toggle { display: flex; }
      .search-box { display: none !important; }
      .search-box.mobile-open {
        display: flex !important; position: fixed; top: 64px; left: 10px; right: 10px; height: 48px; z-index: 60;
        background: white; box-shadow: 0 12px 30px rgba(14, 29, 23, 0.14);
      }
      .search-box.mobile-open input { width: 100%; font-size: 16px; }
      .search-results { position: fixed; top: 118px; left: 10px; right: 10px; width: auto; max-width: none; }
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
  mobileSearch = signal(false);
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
    this.mobileSearch.set(false);
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

  /** En el celular la lupa abre o cierra el buscador y le da el foco. */
  toggleMobileSearch() {
    const open = !this.mobileSearch();
    this.mobileSearch.set(open);
    if (open) setTimeout(() => (document.querySelector('.search-box.mobile-open input') as HTMLInputElement | null)?.focus(), 0);
    else this.clearSearch();
  }

  clearSearch() {
    this.searchTerm = '';
    this.results.set([]);
  }

  closeSoon() {
    setTimeout(() => { this.searchFocused.set(false); this.results.set([]); }, 200);
  }
}
