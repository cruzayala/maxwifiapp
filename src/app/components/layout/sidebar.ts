import { Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <aside class="sidebar" [class.open]="isOpen()">
      <div class="sidebar-brand">
        <div class="brand-icon">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#6366f1"/>
            <path d="M8 16L14 22L24 10" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <span class="brand-text">WISP<span class="brand-accent">RD</span></span>
        <button class="close-btn" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <nav class="sidebar-nav">
        <a routerLink="/dashboard" routerLinkActive="active" class="nav-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          <span>Dashboard</span>
        </a>
        <a routerLink="/live" routerLinkActive="active" class="nav-item live-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 9a1.65 1.65 0 00.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 0024.5 4.6"/></svg>
          <span>EN VIVO</span>
          <span class="live-dot"></span>
        </a>
        <a routerLink="/clients" routerLinkActive="active" class="nav-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
          <span>Clientes</span>
        </a>
        <a routerLink="/invoices" routerLinkActive="active" class="nav-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          <span>Facturas</span>
        </a>
        <a routerLink="/tickets" routerLinkActive="active" class="nav-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"/></svg>
          <span>Tickets</span>
        </a>
        <a routerLink="/plans" routerLinkActive="active" class="nav-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          <span>Planes</span>
        </a>
        <a routerLink="/reports" routerLinkActive="active" class="nav-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          <span>Reportes</span>
        </a>
        <a routerLink="/morosos" routerLinkActive="active" class="nav-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.75-2.97l-7-12a2 2 0 00-3.5 0l-7 12A2 2 0 005.07 19z"/></svg>
          <span>Morosos</span>
        </a>
        <a routerLink="/network" routerLinkActive="active" class="nav-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          <span>Red</span>
        </a>
        <a routerLink="/bandwidth" routerLinkActive="active" class="nav-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/><path d="M12 3a9 9 0 00-9 9"/><path d="M12 12l5-5"/></svg>
          <span>Velocidad</span>
        </a>
        <a routerLink="/mikrotik" routerLinkActive="active" class="nav-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="6" cy="12" r="1"/><circle cx="10" cy="12" r="1"/><circle cx="14" cy="12" r="1"/><circle cx="18" cy="12" r="1"/></svg>
          <span>MikroTik</span>
        </a>
        <a routerLink="/whatsapp" routerLinkActive="active" class="nav-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
          <span>WhatsApp</span>
        </a>
        <a routerLink="/whatsapp-bot" routerLinkActive="active" class="nav-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>
          <span>Bot</span>
        </a>
        <a routerLink="/encuestas" routerLinkActive="active" class="nav-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="11" x2="13" y2="11"/></svg>
          <span>Encuestas</span>
        </a>
        <a routerLink="/settings" routerLinkActive="active" class="nav-item" (click)="closeSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          <span>Config</span>
        </a>
      </nav>

      <div class="sidebar-footer">
        <div class="sync-status">
          <div class="sync-dot"></div>
          <span>API conectada</span>
        </div>
      </div>
    </aside>
  `,
  styles: [`
    .sidebar {
      width: 260px;
      height: 100vh;
      background: #0f172a;
      display: flex;
      flex-direction: column;
      position: fixed;
      left: 0;
      top: 0;
      z-index: 100;
      border-right: 1px solid #1e293b;
      transition: transform 0.3s ease;
    }

    .sidebar-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 24px 20px;
      border-bottom: 1px solid #1e293b;
      position: relative;
    }

    .close-btn {
      display: none;
      position: absolute;
      right: 14px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 6px;
      border-radius: 8px;
    }
    .close-btn:hover { background: #1e293b; color: white; }

    .brand-text {
      font-size: 20px;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: -0.5px;
    }

    .brand-accent { color: #818cf8; }

    .sidebar-nav {
      flex: 1;
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow-y: auto;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 10px;
      color: #94a3b8;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }

    .nav-item:hover {
      background: #1e293b;
      color: #e2e8f0;
    }

    .nav-item.active {
      background: #6366f1;
      color: white;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
    }

    .sidebar-footer {
      padding: 20px;
      border-top: 1px solid #1e293b;
    }

    .sync-status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #64748b;
    }

    .sync-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .live-item { position: relative; }
    .live-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #ef4444; margin-left: auto;
      animation: pulseDot 1.2s infinite;
      box-shadow: 0 0 8px #ef4444;
    }
    @keyframes pulseDot {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(1.2); }
    }

    /* MOBILE */
    @media (max-width: 1024px) {
      .sidebar {
        transform: translateX(-100%);
        box-shadow: 4px 0 20px rgba(0,0,0,0.3);
      }
      .sidebar.open {
        transform: translateX(0);
      }
      .close-btn { display: block; }
    }
  `]
})
export class SidebarComponent {
  isOpen = input(false);
  onClose = output<void>();

  closeSidebar() {
    this.onClose.emit();
  }
}
