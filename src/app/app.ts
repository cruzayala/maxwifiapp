import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet, NavigationEnd, Router } from '@angular/router';
import { SidebarComponent } from './components/layout/sidebar';
import { ToastComponent } from './components/toast/toast';
import { ReceiptPreviewComponent } from './components/receipt-preview/receipt-preview';
import { SyncService } from './services/sync.service';
import { UiService } from './services/ui.service';
import { NotificationSchedulerService } from './services/notification-scheduler.service';
import { ConfigService } from './services/config.service';
import { AuthService } from './services/auth.service';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, ToastComponent, ReceiptPreviewComponent],
  template: `
    <div class="app-layout" [class.no-sidebar]="!showLayout()">
      @if (showLayout()) {
        <app-sidebar [isOpen]="ui.sidebarOpen()" (onClose)="ui.closeSidebar()" />
        @if (ui.sidebarOpen()) {
          <div class="sidebar-overlay" (click)="ui.closeSidebar()"></div>
        }
      }
      <main class="main-content" [class.full-width]="!showLayout()">
        <router-outlet />
      </main>
    </div>
    <app-toast />
    <app-receipt-preview />

    <div class="global-sync-bar" [class.visible]="syncSvc.syncing()">
      <div class="gsync-spinner"></div>
      <span>{{ syncSvc.syncMessage() }}</span>
    </div>
  `,
  styles: [`
    .app-layout { display: flex; min-height: 100vh; }
    .main-content { flex: 1; margin-left: 260px; background: #f8fafc; min-height: 100vh; min-width: 0; }
    .main-content.full-width { margin-left: 0; }

    .sidebar-overlay {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 99;
      backdrop-filter: blur(2px);
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    .global-sync-bar {
      position: fixed; bottom: -50px; left: 260px; right: 0;
      height: 44px; background: #0f172a; color: white;
      display: flex; align-items: center; justify-content: center;
      gap: 10px; font-size: 13px; transition: bottom 0.3s; z-index: 200;
    }
    .global-sync-bar.visible { bottom: 0; }
    .gsync-spinner {
      width: 16px; height: 16px;
      border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 1024px) {
      .main-content { margin-left: 0; }
      .global-sync-bar { left: 0; }
    }
  `]
})
export class App implements OnInit {
  syncSvc = inject(SyncService);
  ui = inject(UiService);
  private router = inject(Router);
  private scheduler = inject(NotificationSchedulerService);
  private config = inject(ConfigService);
  private auth = inject(AuthService);

  showLayout = signal(true);

  ngOnInit() {
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe((e: any) => {
      this.showLayout.set(!e.urlAfterRedirects?.startsWith('/login'));
    });

    // Verificar si requiere PIN
    this.auth.checkPinRequired().subscribe();

    this.syncSvc.syncIfStale();

    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd)
    ).subscribe(() => this.ui.closeSidebar());

    // Start auto-notification scheduler if enabled
    if (this.config.autoNotifEnabled()) {
      this.scheduler.start();
    }
  }
}
