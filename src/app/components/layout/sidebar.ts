import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { LucideLogOut, LucideX } from '@lucide/angular';

import { of, timer } from 'rxjs';
import { catchError, filter, switchMap } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { NAV_GROUPS, NavItem, navItemActive } from './nav';
import { NavIconComponent } from './nav-icon';

interface HealthStatus {
  status?: string;
  database?: string;
  mikrotik?: string;
  whatsapp?: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, LucideLogOut, LucideX, NavIconComponent],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class SidebarComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);

  // null = aun sin respuesta; 'offline' = el servidor no responde.
  readonly health = signal<HealthStatus | 'offline' | null>(null);
  readonly systemState = computed(() => {
    const h = this.health();
    if (h === null) return { tone: 'pending', title: 'Verificando sistemas', detail: 'Consultando el servidor…' };
    if (h === 'offline' || h.database !== 'connected') {
      return { tone: 'error', title: 'Servidor sin respuesta', detail: 'Los datos pueden estar desactualizados' };
    }
    const whatsapp = h.whatsapp === 'connected' ? 'WhatsApp activo' : 'WhatsApp desconectado';
    if (h.mikrotik !== 'connected') return { tone: 'warning', title: 'MikroTik sin conexión', detail: whatsapp };
    return { tone: 'ok', title: 'Sistemas conectados', detail: 'MikroTik en línea · ' + whatsapp };
  });

  readonly isOpen = input(false);
  readonly onClose = output<void>();
  /** Se recalcula al navegar para marcar la opcion activa. */
  readonly url = signal('');

  readonly groups = computed(() => {
    this.auth.currentUser();
    return NAV_GROUPS
      .map((group) => ({ ...group, items: group.items.filter((item) => !item.roles || this.auth.hasAnyRole(item.roles)) }))
      .filter((group) => group.items.length);
  });

  readonly userName = computed(() => {
    const user = this.auth.currentUser();
    return user?.fullName || user?.username || 'Usuario';
  });
  readonly userInitials = computed(() => this.userName().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase());
  readonly roleLabel = computed(() => ({
    super_admin: 'Super admin', admin: 'Administrador', tecnico: 'Técnico', cobranza: 'Cobranza', viewer: 'Consulta',
  } as Record<string, string>)[this.auth.currentUser()?.role ?? ''] ?? '');

  ngOnInit(): void {
    this.url.set(this.router.url);
    timer(0, 60_000).pipe(
      switchMap(() => this.http.get<HealthStatus>('/health').pipe(catchError(() => of('offline' as const)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((status) => this.health.set(status));
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((event) => this.url.set(event.urlAfterRedirects));
  }

  isItemActive(item: NavItem): boolean {
    this.url();
    return navItemActive(this.router, item);
  }

  closeSidebar(): void {
    this.onClose.emit();
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
