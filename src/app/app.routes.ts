import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login').then(m => m.LoginComponent) },

  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', canActivate: [authGuard], loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.DashboardComponent) },
  { path: 'clients', canActivate: [authGuard], loadComponent: () => import('./pages/clients/clients').then(m => m.ClientsComponent) },
  { path: 'clients/new', canActivate: [authGuard], loadComponent: () => import('./pages/new-client/new-client').then(m => m.NewClientComponent) },
  { path: 'clients/:id', canActivate: [authGuard], loadComponent: () => import('./pages/client-detail/client-detail').then(m => m.ClientDetailComponent) },
  { path: 'invoices', canActivate: [authGuard], loadComponent: () => import('./pages/invoices/invoices').then(m => m.InvoicesComponent) },
  { path: 'tickets', canActivate: [authGuard], loadComponent: () => import('./pages/tickets/tickets').then(m => m.TicketsComponent) },
  { path: 'plans', canActivate: [authGuard], loadComponent: () => import('./pages/plans/plans').then(m => m.PlansComponent) },
  { path: 'reports', canActivate: [authGuard], loadComponent: () => import('./pages/reports/reports').then(m => m.ReportsComponent) },
  { path: 'network', canActivate: [authGuard], loadComponent: () => import('./pages/network-monitor/network-monitor').then(m => m.NetworkMonitorComponent) },
  { path: 'bandwidth', canActivate: [authGuard], loadComponent: () => import('./pages/bandwidth/bandwidth').then(m => m.BandwidthComponent) },
  { path: 'mikrotik', canActivate: [authGuard], loadComponent: () => import('./pages/mikrotik/mikrotik').then(m => m.MikrotikComponent) },
  { path: 'live', canActivate: [authGuard], loadComponent: () => import('./pages/live/live').then(m => m.LiveComponent) },
  { path: 'whatsapp', canActivate: [authGuard], loadComponent: () => import('./pages/whatsapp/whatsapp').then(m => m.WhatsappComponent) },
  { path: 'whatsapp-bot', canActivate: [authGuard], loadComponent: () => import('./pages/whatsapp-bot/whatsapp-bot').then(m => m.WhatsappBotComponent) },
  { path: 'morosos', canActivate: [authGuard], loadComponent: () => import('./pages/morosos/morosos').then(m => m.MorososComponent) },
  { path: 'encuestas', canActivate: [authGuard], loadComponent: () => import('./pages/encuestas/encuestas').then(m => m.EncuestasComponent) },
  { path: 'mapa', canActivate: [authGuard], loadComponent: () => import('./pages/mapa/mapa').then(m => m.MapaComponent) },
  { path: 'settings', canActivate: [authGuard], loadComponent: () => import('./pages/settings/settings').then(m => m.SettingsComponent) },
  { path: '**', redirectTo: 'dashboard' }
];
