import { Component, inject, input, output, signal } from '@angular/core';
import { ClientAction, ClientActionsService } from '../../services/client-actions.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-client-block-actions',
  standalone: true,
  template: `
    <div class="actions" (click)="$event.stopPropagation()">
      <button
        type="button"
        class="btn-ac btn-warn"
        [disabled]="busy() !== null || crmAction() === 'block'"
        (click)="run('moroso')"
      >
        {{ busy() === 'moroso' ? '...' : 'Moroso' }}
      </button>
      <button
        type="button"
        class="btn-ac btn-danger"
        [disabled]="busy() !== null"
        (click)="run('block')"
      >
        {{ busy() === 'block' ? '...' : 'Desactivar' }}
      </button>
      @if (crmAction() === 'moroso' || crmAction() === 'block') {
        <button
          type="button"
          class="btn-ac btn-ok"
          [disabled]="busy() !== null"
          (click)="run('clear')"
        >
          {{ busy() === 'clear' ? '...' : 'Reactivar' }}
        </button>
      }
    </div>
  `,
  styles: [`
    .actions { display: inline-flex; gap: 6px; flex-wrap: wrap; }
    .btn-ac {
      padding: 5px 10px; border-radius: 8px; font-size: 11px;
      font-weight: 700; border: none; cursor: pointer;
      letter-spacing: 0.05em; transition: filter 0.15s, transform 0.1s;
    }
    .btn-ac:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-ac:not(:disabled):hover { filter: brightness(1.08); transform: translateY(-1px); }
    .btn-warn { background: #f97316; color: white; }
    .btn-danger { background: #dc2626; color: white; }
    .btn-ok { background: #16a34a; color: white; }
  `],
})
export class ClientBlockActionsComponent {
  private svc = inject(ClientActionsService);
  private toast = inject(ToastService);

  idServicio = input.required<number>();
  clientName = input.required<string>();
  crmAction = input<string | null | undefined>(null);

  changed = output<{ action: ClientAction; result: unknown }>();

  busy = signal<ClientAction | null>(null);

  run(action: ClientAction) {
    const verb = action === 'moroso' ? 'Marcar como moroso' : action === 'block' ? 'Desactivar servicio' : 'Reactivar';
    const def = action === 'moroso' ? 'Falta de pago' : action === 'block' ? 'Desactivado manualmente' : 'Reactivado';
    const reason = window.prompt(`${verb} a ${this.clientName()}\nMotivo:`, def);
    if (reason === null) return;

    this.busy.set(action);
    this.svc.apply(this.idServicio(), action, reason || def).subscribe({
      next: (res) => {
        this.busy.set(null);
        if (res.ok) {
          const killed = res.connectionsKilled ? `, sesiones cerradas: ${res.connectionsKilled}` : '';
          this.toast.success(`${verb} OK (${res.ip})${killed}`);
          this.changed.emit({ action, result: res });
        } else {
          this.toast.error(res.error || 'Error');
        }
      },
      error: (err) => {
        this.busy.set(null);
        this.toast.error(err.error?.error || err.message || 'Error');
      },
    });
  }
}
