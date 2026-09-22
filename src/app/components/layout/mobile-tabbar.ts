import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { LucideMenu } from '@lucide/angular';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { UiService } from '../../services/ui.service';
import { NAV_GROUPS, NavItem, navItemActive } from './nav';
import { NavIconComponent } from './nav-icon';

/**
 * Barra inferior del celular: las cuatro pantallas de uso diario a un toque del pulgar
 * y "Menu" para el resto. Solo se muestra en pantallas angostas.
 */
@Component({
  selector: 'app-mobile-tabbar',
  standalone: true,
  imports: [RouterLink, LucideMenu, NavIconComponent],
  template: `
    <nav class="tabbar" aria-label="Accesos rápidos">
      @for (item of tabs(); track item.path) {
        <a class="tab" [routerLink]="item.path" [class.active]="active(item)" [attr.aria-current]="active(item) ? 'page' : null">
          <span class="tab-icon"><app-nav-icon [icon]="item.icon" [size]="21" /></span>
          <span class="tab-label">{{ item.label }}</span>
        </a>
      }
      <button class="tab" type="button" (click)="ui.openSidebar()" [class.active]="ui.sidebarOpen()" aria-label="Abrir el menú completo">
        <span class="tab-icon"><svg lucideMenu size="21" aria-hidden="true"></svg></span>
        <span class="tab-label">Menú</span>
      </button>
    </nav>
  `,
  styles: [`
    :host { display: none; }
    @media (max-width: 1024px) { :host { display: block; } }
    .tabbar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 90;
      display: flex; gap: 2px;
      padding: 6px 6px calc(6px + env(safe-area-inset-bottom));
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: saturate(160%) blur(14px);
      -webkit-backdrop-filter: saturate(160%) blur(14px);
      border-top: 1px solid #e0e6e1;
      box-shadow: 0 -8px 24px rgba(14, 29, 23, 0.06);
    }
    .tab {
      flex: 1; min-width: 0; min-height: 54px;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
      border: 0; background: none; padding: 0; cursor: pointer;
      color: #56665e; font-family: var(--isp-body); font-size: 11px; font-weight: 600; text-decoration: none;
    }
    .tab-icon {
      width: 56px; height: 30px; display: grid; place-items: center; border-radius: 15px;
      transition: background-color .18s ease, transform .18s ease;
    }
    .tab.active { color: #08523f; }
    .tab.active .tab-icon { background: #e6f2ec; transform: translateY(-1px); }
    .tab-label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `],
})
export class MobileTabbarComponent implements OnInit {
  readonly ui = inject(UiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly url = signal('');

  /** Inicio y Clientes para todos; Cobranza y Red segun lo que el rol puede abrir. */
  readonly tabs = computed(() => {
    this.auth.currentUser();
    const all = NAV_GROUPS.flatMap((group) => group.items);
    const pick = (path: string) => all.find((item) => item.path === path && !item.queryParams);
    return [pick('/dashboard'), pick('/clients'), pick('/morosos'), pick('/network')]
      .filter((item): item is NavItem => !!item && (!item.roles || this.auth.hasAnyRole(item.roles)))
      .map((item) => item.path === '/morosos' ? { ...item, label: 'Cobranza' } : item.path === '/network' ? { ...item, label: 'Red' } : item);
  });

  ngOnInit(): void {
    this.url.set(this.router.url);
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((event) => this.url.set(event.urlAfterRedirects));
  }

  active(item: NavItem): boolean {
    this.url();
    return navItemActive(this.router, item);
  }
}
