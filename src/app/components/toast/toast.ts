import { Component, inject } from '@angular/core';
import { LucideCircleCheck, LucideCircleX, LucideInfo, LucideX } from '@lucide/angular';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [LucideCircleCheck, LucideCircleX, LucideInfo, LucideX],
  template: `
    <div class="toast-container" aria-live="polite" aria-atomic="false">
      @for (toast of toastSvc.toasts(); track toast.id) {
        <div class="toast" [class]="'toast-' + toast.type"
          [attr.role]="toast.type === 'error' ? 'alert' : 'status'"
          title="Clic para cerrar"
          (click)="toastSvc.dismiss(toast.id)">
          <span class="toast-icon" aria-hidden="true">
            @if (toast.type === 'success') {
              <svg lucideCircleCheck size="18"></svg>
            } @else if (toast.type === 'error') {
              <svg lucideCircleX size="18"></svg>
            } @else {
              <svg lucideInfo size="18"></svg>
            }
          </span>
          <div class="toast-body">
            <strong>{{ toastTitle(toast.type) }}</strong>
            <span>{{ toast.message }}</span>
          </div>
          <button type="button" class="toast-close" aria-label="Cerrar notificación"
            (click)="$event.stopPropagation(); toastSvc.dismiss(toast.id)">
            <svg lucideX size="14"></svg>
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: min(380px, calc(100vw - 32px));
      pointer-events: none;
    }

    .toast {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 10px 12px 14px;
      border-radius: 12px;
      border: 1px solid #e0e6e1;
      border-left-width: 4px;
      background: #fff;
      color: #2d3b34;
      font-size: 13px;
      line-height: 1.4;
      cursor: pointer;
      box-shadow: 0 10px 28px rgba(14, 29, 23, 0.14);
      animation: slideIn 0.25s ease;
      pointer-events: auto;
    }

    .toast-success { border-left-color: #0f7a53; }
    .toast-success .toast-icon { color: #0f7a53; background: #e9f8f1; }
    .toast-error { border-left-color: #b42318; }
    .toast-error .toast-icon { color: #b42318; background: #fff0ef; }
    .toast-info { border-left-color: #0b6b52; }
    .toast-info .toast-icon { color: #0b6b52; background: #e6f2ec; }

    .toast-icon {
      flex-shrink: 0;
      width: 28px; height: 28px;
      display: grid; place-items: center;
      border-radius: 9px;
    }

    .toast-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-top: 1px; }
    .toast-body strong { font-size: 13px; font-weight: 700; color: #15211c; }
    .toast-body span { word-break: break-word; }

    .toast-close {
      flex-shrink: 0;
      background: none; border: none; cursor: pointer;
      color: #56665e; padding: 4px; border-radius: 9px;
      display: grid; place-items: center;
    }
    .toast-close:hover { background: #eef6f1; color: #15211c; }

    @keyframes slideIn {
      from { transform: translateY(12px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    /* En celular y tableta los avisos quedan sobre la barra inferior, sin taparla. */
    @media (max-width: 1024px) {
      .toast-container { bottom: calc(82px + env(safe-area-inset-bottom)); }
    }
    @media (max-width: 480px) {
      .toast-container { right: 12px; left: 12px; bottom: calc(82px + env(safe-area-inset-bottom)); width: auto; }
    }
  `]
})
export class ToastComponent {
  toastSvc = inject(ToastService);

  toastTitle(type: string): string {
    if (type === 'success') return 'Listo';
    if (type === 'error') return 'Algo salió mal';
    return 'Aviso';
  }
}
