import { Component, OnInit, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LocalDbService } from '../../services/local-db.service';
import { WispHubClient } from '../../models/client.model';
import { UiService } from '../../services/ui.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [FormsModule],
  template: `
    <header class="navbar">
      <div class="navbar-left">
        <button class="menu-btn" (click)="ui.openSidebar()">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <h1 class="page-title">{{ pageTitle() }}</h1>
      </div>
      <div class="navbar-right">
        <div class="search-box" [class.focused]="searchFocused()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Buscar cliente..."
            [(ngModel)]="searchTerm"
            (focus)="searchFocused.set(true); search()"
            (blur)="closeSoon()"
            (input)="search()" />
          @if (searchFocused() && results().length > 0) {
            <div class="search-results">
              @for (c of results(); track c.id_servicio) {
                <div class="result-item" (mousedown)="goToClient(c.id_servicio)">
                  <div class="result-main">
                    <span class="result-name">{{ c.nombre }}</span>
                    <span class="result-plan">{{ c.plan_internet?.nombre || '' }}</span>
                  </div>
                  <div class="result-meta">
                    <span class="result-ip">{{ c.ip }}</span>
                    <span class="result-phone">{{ c.telefono || '' }}</span>
                  </div>
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
      height: 64px; background: white; border-bottom: 1px solid #e2e8f0;
      display: flex; align-items: center; justify-content: space-between; padding: 0 24px;
      position: sticky; top: 0; z-index: 50;
    }
    .navbar-left { display: flex; align-items: center; gap: 12px; }
    .menu-btn {
      display: none; background: none; border: none; padding: 8px;
      border-radius: 8px; cursor: pointer; color: #334155;
    }
    .menu-btn:hover { background: #f1f5f9; }

    .page-title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0; }
    .navbar-right { display: flex; align-items: center; gap: 16px; }

    .search-box {
      position: relative; display: flex; align-items: center; gap: 8px;
      background: #f1f5f9; border-radius: 10px; padding: 8px 16px;
      color: #94a3b8; border: 2px solid transparent; transition: all 0.2s;
    }
    .search-box.focused { background: white; border-color: #6366f1; box-shadow: 0 4px 15px rgba(99,102,241,0.15); }
    .search-box input { border: none; background: none; outline: none; font-size: 14px; color: #334155; width: 220px; }
    .search-box input::placeholder { color: #94a3b8; }

    .search-results {
      position: absolute; top: 48px; right: 0; width: 360px; max-width: 90vw;
      background: white; border: 1px solid #e2e8f0; border-radius: 12px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.12); max-height: 320px; overflow-y: auto; z-index: 200;
    }
    .result-item {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 16px; cursor: pointer; transition: background 0.1s;
    }
    .result-item:hover { background: #f0f4ff; }
    .result-name { display: block; font-size: 14px; font-weight: 600; color: #0f172a; }
    .result-plan { display: block; font-size: 11px; color: #6366f1; }
    .result-meta { text-align: right; }
    .result-ip { display: block; font-size: 12px; font-family: 'Courier New', monospace; color: #475569; }
    .result-phone { display: block; font-size: 11px; color: #94a3b8; }

    @media (max-width: 1024px) {
      .menu-btn { display: flex; }
      .page-title { font-size: 18px; }
    }

    @media (max-width: 640px) {
      .navbar { padding: 0 12px; }
      .search-box input { width: 120px; }
      .search-box { padding: 6px 12px; }
      .page-title { font-size: 16px; }
    }

    @media (max-width: 480px) {
      .page-title { display: none; }
      .search-box input { width: 100%; }
      .search-box { flex: 1; }
      .navbar-right { flex: 1; margin-left: 8px; }
      .search-results { width: 100%; right: 0; }
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

  closeSoon() {
    setTimeout(() => { this.searchFocused.set(false); this.results.set([]); }, 200);
  }
}
