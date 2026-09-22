import { Router } from '@angular/router';
import {
  LucideActivity, LucideBanknote, LucideBot, LucideCable, LucideChartColumn, LucideClipboardCheck, LucideGauge,
  LucideHouse, LucideMap, LucideMessageCircle, LucideNetwork, LucidePackage, LucideRadioTower,
  LucideReceipt, LucideReceiptText, LucideRouter, LucideSettings, LucideShieldCheck, LucideTicket,
  LucideTriangleAlert, LucideUserCog, LucideUserPlus, LucideUsersRound, LucideWallet, LucideZap,
} from '@lucide/angular';
import { UserRole } from '../../services/auth.service';

export type NavIcon =
  | 'home' | 'clients' | 'new-client' | 'collections' | 'invoices' | 'plans' | 'reports'
  | 'network' | 'live' | 'incidents' | 'speed' | 'audit' | 'mikrotik' | 'ipam' | 'olt' | 'onu' | 'map'
  | 'whatsapp' | 'bot' | 'surveys' | 'tickets'
  | 'inventory' | 'expenses' | 'payroll' | 'users' | 'settings';

export interface NavItem {
  label: string;
  path: string;
  icon: NavIcon;
  queryParams?: Record<string, string>;
  exact?: boolean;
  /** Mismos roles que la ruta: sin ellos la opcion no se muestra. */
  roles?: UserRole[];
  live?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/** Menu de la web, agrupado como en el rediseño: Operación, Red, Comunicación y Administración. */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'operation',
    label: 'Operación',
    items: [
      { label: 'Inicio', path: '/dashboard', icon: 'home', exact: true },
      { label: 'Clientes', path: '/clients', icon: 'clients' },
      { label: 'Cliente nuevo', path: '/clients/new', icon: 'new-client', exact: true, roles: ['admin'] },
      { label: 'Cobranza', path: '/morosos', icon: 'collections', exact: true, roles: ['cobranza'] },
      { label: 'Facturas', path: '/invoices', icon: 'invoices', exact: true, roles: ['cobranza'] },
      { label: 'Planes', path: '/plans', icon: 'plans', exact: true },
      { label: 'Reportes', path: '/reports', icon: 'reports', exact: true },
    ],
  },
  {
    id: 'network',
    label: 'Red',
    items: [
      { label: 'Centro de red', path: '/network', icon: 'network', exact: true, roles: ['tecnico'] },
      { label: 'En vivo', path: '/live', icon: 'live', exact: true, roles: ['tecnico'], live: true },
      { label: 'Incidencias', path: '/incidents', icon: 'incidents', exact: true, roles: ['tecnico'] },
      { label: 'Velocidad', path: '/bandwidth', icon: 'speed', exact: true, roles: ['tecnico'] },
      { label: 'Auditoría', path: '/auditoria-red', icon: 'audit', exact: true, roles: ['tecnico'] },
      { label: 'MikroTik', path: '/mikrotik', icon: 'mikrotik', exact: true, roles: ['tecnico'] },
      { label: 'IPs libres', path: '/mikrotik', icon: 'ipam', queryParams: { tab: 'ipam' }, exact: true, roles: ['tecnico'] },
      { label: 'OLT y ONU', path: '/olt', icon: 'olt', exact: true, roles: ['tecnico'] },
      { label: 'Configurar ONU', path: '/onu-provisioner', icon: 'onu', exact: true, roles: ['tecnico'] },
      { label: 'Mapa', path: '/mapa', icon: 'map', exact: true, roles: ['tecnico'] },
    ],
  },
  {
    id: 'communication',
    label: 'Comunicación',
    items: [
      { label: 'WhatsApp', path: '/whatsapp', icon: 'whatsapp', exact: true, roles: ['cobranza'] },
      { label: 'Bot', path: '/whatsapp-bot', icon: 'bot', exact: true, roles: ['cobranza'] },
      { label: 'Encuestas', path: '/encuestas', icon: 'surveys', exact: true, roles: ['cobranza'] },
      { label: 'Tickets', path: '/tickets', icon: 'tickets', exact: true, roles: ['tecnico'] },
    ],
  },
  {
    id: 'administration',
    label: 'Administración',
    items: [
      { label: 'Inventario', path: '/inventory', icon: 'inventory', exact: true, roles: ['admin'] },
      { label: 'Gastos', path: '/expenses', icon: 'expenses', exact: true, roles: ['admin'] },
      { label: 'Nómina', path: '/payroll', icon: 'payroll', exact: true, roles: ['admin'] },
      { label: 'Usuarios', path: '/users', icon: 'users', exact: true, roles: ['admin'] },
      { label: 'Ajustes', path: '/settings', icon: 'settings', exact: true, roles: ['admin'] },
    ],
  },
];

/** Decide si una opcion del menu corresponde a la URL actual. */
export function navItemActive(router: Router, item: NavItem): boolean {
  const tree = router.parseUrl(router.url);
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

export const NAV_ICON_IMPORTS = [
  LucideActivity, LucideBanknote, LucideBot, LucideCable, LucideChartColumn, LucideClipboardCheck, LucideGauge,
  LucideHouse, LucideMap, LucideMessageCircle, LucideNetwork, LucidePackage, LucideRadioTower, LucideReceipt,
  LucideReceiptText, LucideRouter, LucideSettings, LucideShieldCheck, LucideTicket, LucideTriangleAlert,
  LucideUserCog, LucideUserPlus, LucideUsersRound, LucideWallet, LucideZap,
];

