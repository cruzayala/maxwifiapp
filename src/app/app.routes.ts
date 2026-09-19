import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { roleGuard } from './guards/role.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login').then(m => m.LoginComponent) },

  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', canActivate: [authGuard], loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.DashboardComponent) },
  { path: 'clients', canActivate: [authGuard], loadComponent: () => import('./pages/clients/clients').then(m => m.ClientsComponent) },
  { path: 'clients/new', canActivate: [authGuard, roleGuard], data: { roles: ['admin'] }, loadComponent: () => import('./pages/new-client/new-client').then(m => m.NewClientComponent) },
  { path: 'clients/:id', canActivate: [authGuard], loadComponent: () => import('./pages/client-detail/client-detail').then(m => m.ClientDetailComponent) },
  { path: 'invoices', canActivate: [authGuard, roleGuard], data: { roles: ['cobranza'] }, loadComponent: () => import('./pages/invoices/invoices').then(m => m.InvoicesComponent) },
  { path: 'tickets', canActivate: [authGuard, roleGuard], data: { roles: ['tecnico'] }, loadComponent: () => import('./pages/tickets/tickets').then(m => m.TicketsComponent) },
  { path: 'plans', canActivate: [authGuard], loadComponent: () => import('./pages/plans/plans').then(m => m.PlansComponent) },
  { path: 'reports', canActivate: [authGuard], loadComponent: () => import('./pages/reports/reports').then(m => m.ReportsComponent) },
  { path: 'network', canActivate: [authGuard, roleGuard], data: { roles: ['tecnico'] }, loadComponent: () => import('./pages/network-monitor/network-monitor').then(m => m.NetworkMonitorComponent) },
  { path: 'bandwidth', canActivate: [authGuard, roleGuard], data: { roles: ['tecnico'] }, loadComponent: () => import('./pages/bandwidth/bandwidth').then(m => m.BandwidthComponent) },
  { path: 'auditoria-red', canActivate: [authGuard, roleGuard], data: { roles: ['tecnico'] }, loadComponent: () => import('./pages/network-audit/network-audit').then(m => m.NetworkAuditComponent) },
  { path: 'mikrotik', canActivate: [authGuard, roleGuard], data: { roles: ['tecnico'] }, loadComponent: () => import('./pages/mikrotik/mikrotik').then(m => m.MikrotikComponent) },
  { path: 'olt', canActivate: [authGuard, roleGuard], data: { roles: ['tecnico'] }, loadComponent: () => import('./pages/olt/olt').then(m => m.OltComponent) },
  { path: 'onu-provisioner', canActivate: [authGuard, roleGuard], data: { roles: ['tecnico'] }, loadComponent: () => import('./pages/onu-provisioner/onu-provisioner').then(m => m.OnuProvisionerComponent) },
  { path: 'live', canActivate: [authGuard, roleGuard], data: { roles: ['tecnico'] }, loadComponent: () => import('./pages/live/live').then(m => m.LiveComponent) },
  { path: 'incidents', canActivate: [authGuard, roleGuard], data: { roles: ['tecnico'] }, loadComponent: () => import('./pages/incidents/incidents').then(m => m.IncidentsComponent) },
  { path: 'whatsapp', canActivate: [authGuard, roleGuard], data: { roles: ['cobranza'] }, loadComponent: () => import('./pages/whatsapp/whatsapp').then(m => m.WhatsappComponent) },
  { path: 'whatsapp-bot', canActivate: [authGuard, roleGuard], data: { roles: ['cobranza'] }, loadComponent: () => import('./pages/whatsapp-bot/whatsapp-bot').then(m => m.WhatsappBotComponent) },
  { path: 'morosos', canActivate: [authGuard, roleGuard], data: { roles: ['cobranza'] }, loadComponent: () => import('./pages/morosos/morosos').then(m => m.MorososComponent) },
  { path: 'mapa', canActivate: [authGuard, roleGuard], data: { roles: ['tecnico'] }, loadComponent: () => import('./pages/mapa/mapa').then(m => m.MapaComponent) },
  { path: 'inventory', canActivate: [authGuard, roleGuard], data: { roles: ['admin'] }, loadComponent: () => import('./pages/inventory/inventory').then(m => m.InventoryComponent) },
  { path: 'expenses', canActivate: [authGuard, roleGuard], data: { roles: ['admin'] }, loadComponent: () => import('./pages/expenses/expenses').then(m => m.ExpensesComponent) },
  { path: 'payroll', canActivate: [authGuard, roleGuard], data: { roles: ['admin'] }, loadComponent: () => import('./pages/payroll/payroll').then(m => m.PayrollComponent) },
  { path: 'users', canActivate: [authGuard, roleGuard], data: { roles: ['admin'] }, loadComponent: () => import('./pages/users/users').then(m => m.UsersComponent) },
  { path: 'settings', canActivate: [authGuard, roleGuard], data: { roles: ['admin'] }, loadComponent: () => import('./pages/settings/settings').then(m => m.SettingsComponent) },
  { path: '**', redirectTo: 'dashboard' }
];
