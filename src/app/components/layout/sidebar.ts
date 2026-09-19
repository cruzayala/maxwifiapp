import { Component, DestroyRef, OnInit, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import {
  LucideBriefcaseBusiness,
  LucideChevronDown,
  LucideLayoutDashboard,
  LucideMessagesSquare,
  LucideNetwork,
  LucideSettings,
  LucideUsersRound,
  LucideX,
} from '@lucide/angular';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';

type MenuGroupId = 'operations' | 'customers' | 'network' | 'communications' | 'administration' | 'system';

interface MenuItem {
  label: string;
  path: string;
  queryParams?: Record<string, string>;
  exact?: boolean;
  adminOnly?: boolean;
  live?: boolean;
}

interface MenuGroup {
  id: MenuGroupId;
  label: string;
  description: string;
  items: MenuItem[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [
    RouterLink,
    LucideBriefcaseBusiness,
    LucideChevronDown,
    LucideLayoutDashboard,
    LucideMessagesSquare,
    LucideNetwork,
    LucideSettings,
    LucideUsersRound,
    LucideX,
  ],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class SidebarComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly storageKey = 'isp-max-sidebar-group';

  readonly isOpen = input(false);
  readonly onClose = output<void>();
  readonly openGroup = signal<MenuGroupId | null>('operations');

  readonly groups: MenuGroup[] = [
    {
      id: 'operations',
      label: 'Centro de operaciones',
      description: 'Supervision diaria',
      items: [
        { label: 'Dashboard', path: '/dashboard', exact: true },
        { label: 'En vivo', path: '/live', exact: true, live: true },
        { label: 'Incidentes NOC', path: '/incidents', exact: true },
      ],
    },
    {
      id: 'customers',
      label: 'Clientes y cobros',
      description: 'Servicio y facturacion',
      items: [
        { label: 'Clientes', path: '/clients' },
        { label: 'Nuevo cliente', path: '/clients/new', exact: true, adminOnly: true },
        { label: 'Facturas', path: '/invoices', exact: true },
        { label: 'Morosos', path: '/morosos', exact: true },
        { label: 'Tickets', path: '/tickets', exact: true },
        { label: 'Planes', path: '/plans', exact: true },
        { label: 'Reportes', path: '/reports', exact: true },
      ],
    },
    {
      id: 'network',
      label: 'Red e infraestructura',
      description: 'MikroTik, OLT y ONU',
      items: [
        { label: 'Estado de red', path: '/network', exact: true },
        { label: 'Velocidad', path: '/bandwidth', exact: true },
        { label: 'Auditoria de red', path: '/auditoria-red', exact: true },
        { label: 'MikroTik', path: '/mikrotik', exact: true },
        { label: 'IPs libres', path: '/mikrotik', queryParams: { tab: 'ipam' }, exact: true },
        { label: 'OLT y ONU', path: '/olt', exact: true },
        { label: 'Configurar ONU', path: '/onu-provisioner', exact: true },
        { label: 'Mapa en vivo', path: '/mapa', exact: true },
      ],
    },
    {
      id: 'communications',
      label: 'Comunicaciones',
      description: 'Mensajeria y bot',
      items: [
        { label: 'WhatsApp', path: '/whatsapp', exact: true },
        { label: 'Bot', path: '/whatsapp-bot', exact: true },
      ],
    },
    {
      id: 'administration',
      label: 'Administracion',
      description: 'Recursos internos',
      items: [
        { label: 'Inventario', path: '/inventory', exact: true },
        { label: 'Gastos', path: '/expenses', exact: true },
        { label: 'Nomina', path: '/payroll', exact: true },
      ],
    },
    {
      id: 'system',
      label: 'Sistema',
      description: 'Acceso y configuracion',
      items: [
        { label: 'Usuarios', path: '/users', exact: true, adminOnly: true },
        { label: 'Configuracion', path: '/settings', exact: true, adminOnly: true },
      ],
    },
  ];

  ngOnInit(): void {
    this.openActiveGroup();
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => this.openActiveGroup());
  }

  visibleItems(group: MenuGroup): MenuItem[] {
    return group.items.filter((item) => !item.adminOnly || this.auth.hasRole(['admin']));
  }

  onGroupToggle(groupId: MenuGroupId, event: Event): void {
    const details = event.target as HTMLDetailsElement;
    const next = details.open ? groupId : (this.openGroup() === groupId ? null : this.openGroup());
    this.openGroup.set(next);
    try {
      if (next) sessionStorage.setItem(this.storageKey, next);
      else sessionStorage.removeItem(this.storageKey);
    } catch {
      // La preferencia visual no debe impedir la navegacion.
    }
  }

  isItemActive(item: MenuItem): boolean {
    const tree = this.router.parseUrl(this.router.url);
    const path = `/${tree.root.children['primary']?.segments.map((segment) => segment.path).join('/') ?? ''}`;
    const expectedTab = item.queryParams?.['tab'];
    const currentTab = tree.queryParams['tab'];

    if (expectedTab) return path === item.path && currentTab === expectedTab;
    if (item.path === '/mikrotik') return path === item.path && !currentTab;
    if (item.path === '/clients' && !item.exact) {
      return path === '/clients' || (/^\/clients\/[^/]+$/.test(path) && path !== '/clients/new');
    }
    return item.exact ? path === item.path : path.startsWith(item.path);
  }

  groupHasActiveItem(group: MenuGroup): boolean {
    return this.visibleItems(group).some((item) => this.isItemActive(item));
  }

  closeSidebar(): void {
    this.onClose.emit();
  }

  private openActiveGroup(): void {
    const active = this.groups.find((group) => this.groupHasActiveItem(group));
    if (active) {
      this.openGroup.set(active.id);
      return;
    }

    try {
      const stored = sessionStorage.getItem(this.storageKey) as MenuGroupId | null;
      if (stored && this.groups.some((group) => group.id === stored)) this.openGroup.set(stored);
    } catch {
      this.openGroup.set('operations');
    }
  }
}
