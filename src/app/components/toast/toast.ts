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
      border-radius: 8px;
      border: 1px solid #dfe5ea;
      border-left-width: 4px;
      background: #fff;
      color: #334250;
      font-size: 13px;
      line-height: 1.4;
      cursor: pointer;
      box-shadow: 0 10px 28px rgba(17, 26, 36, 0.14);
      animation: slideIn 0.25s ease;
      pointer-events: auto;
    }

    .toast-success { border-left-color: #13875a; }
    .toast-success .toast-icon { color: #13875a; background: #e9f8f1; }
    .toast-error { border-left-color: #b42318; }
    .toast-error .toast-icon { color: #b42318; background: #fff0ef; }
    .toast-info { border-left-color: #1267dd; }
    .toast-info .toast-icon { color: #1267dd; background: #edf4ff; }

    .toast-icon {
      flex-shrink: 0;
      width: 28px; height: 28px;
      display: grid; place-items: center;
      border-radius: 6px;
    }

    .toast-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-top: 1px; }
    .toast-body strong { font-size: 13px; font-weight: 700; color: #172535; }
    .toast-body span { word-break: break-word; }

    .toast-close {
      flex-shrink: 0;
      background: none; border: none; cursor: pointer;
      color: #667582; padding: 4px; border-radius: 6px;
      display: grid; place-items: center;
    }
    .toast-close:hover { background: #f2f7ff; color: #172535; }

    @keyframes slideIn {
      from { transform: translateY(12px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    @media (max-width: 480px) {
      .toast-container { right: 16px; left: 16px; bottom: 16px; width: auto; }
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
