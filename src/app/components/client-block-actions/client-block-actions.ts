import { Component, inject, input, output, signal } from '@angular/core';
import { ClientAction, ClientActionsService } from '../../services/client-actions.service';
import { ToastService } from '../../services/toast.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-client-block-actions',
  standalone: true,
  template: `
    @if (!canMark) {
      <p class="no-permission">Su usuario no puede cambiar el estado de cobro de este cliente.</p>
    } @else {
    <div class="actions" (click)="$event.stopPropagation()">
      <button
        type="button"
        class="btn-ac btn-warn"
        [disabled]="busy() !== null || crmAction() === 'block' || crmAction() === 'moroso'"
        [title]="crmAction() === 'block' ? 'El servicio ya está desactivado; reactívelo primero' : crmAction() === 'moroso' ? 'Ya está marcado como moroso' : 'Mostrarle un aviso de pago al navegar (no corta el internet)'"
        (click)="run('moroso')"
      >
        {{ busy() === 'moroso' ? 'Aplicando…' : 'Marcar moroso' }}
      </button>
      @if (paymentPilotEnabled() && canCut) {
        <button
          type="button"
          class="btn-ac btn-danger"
          [disabled]="busy() !== null || crmAction() === 'block'"
          [title]="crmAction() === 'block' ? 'El servicio ya está desactivado' : 'Desactivar el servicio y mostrar el portal de pago'"
          (click)="run('block')"
        >
          {{ busy() === 'block' ? 'Aplicando…' : 'Desactivar con portal' }}
        </button>
      }
      @if (crmAction() === 'moroso' || crmAction() === 'block') {
        <button
          type="button"
          class="btn-ac btn-ok"
          [disabled]="busy() !== null"
          title="Quitar la marca y devolver el servicio a la normalidad"
          (click)="run('clear')"
        >
          {{ busy() === 'clear' ? 'Aplicando…' : 'Reactivar' }}
        </button>
      }
    </div>
    }
  `,
  styles: [`
    .actions { display: inline-flex; gap: 6px; flex-wrap: wrap; }
    .btn-ac {
      min-height: 30px; padding: 5px 10px; border-radius: 6px; font-size: 12px;
      font-weight: 700; border: 1px solid transparent; cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .btn-ac:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-warn { background: #fff6e8; border-color: #f3d19e; color: #8a520c; }
    .btn-warn:not(:disabled):hover { background: #ffeccc; }
    .btn-danger { background: #fff0ef; border-color: #f0b4ae; color: #b42318; }
    .btn-danger:not(:disabled):hover { background: #ffe2df; }
    .btn-ok { background: #13875a; color: white; }
    .btn-ok:not(:disabled):hover { background: #0f704b; }
    .btn-ac:focus-visible { outline: 2px solid #1267dd; outline-offset: 2px; }
    .no-permission { margin: 0; color: #667582; font-size: 12px; }
  `],
})
export class ClientBlockActionsComponent {
  private svc = inject(ClientActionsService);
  private toast = inject(ToastService);
  private auth = inject(AuthService);
  // Mismos permisos que el servidor: aviso de pago/reactivar = cobranza; cortar = administrador.
  readonly canMark = this.auth.hasRole(['cobranza']);
  readonly canCut = this.auth.hasRole(['admin']);

  idServicio = input.required<number>();
  clientName = input.required<string>();
  crmAction = input<string | null | undefined>(null);
  paymentPilotEnabled = input(false);

  changed = output<{ action: ClientAction; result: unknown }>();

  busy = signal<ClientAction | null>(null);

  run(action: ClientAction) {
    const verb = action === 'moroso' ? 'Marcar como moroso' : action === 'block' ? 'Desactivar servicio' : 'Reactivar';
    const done = action === 'moroso' ? 'Marcado como moroso' : action === 'block' ? 'Servicio desactivado' : 'Servicio reactivado';
    const def = action === 'moroso' ? 'Falta de pago' : action === 'block' ? 'Desactivado manualmente' : 'Reactivado';
    // Efecto real en el MikroTik (ver applyClientAction en server.js).
    const effect = action === 'block'
      ? 'Se CORTARÁ su internet: solo podrá abrir la página de pago hasta que lo reactive.'
      : action === 'clear'
        ? 'Se quita la marca y el aviso: su internet vuelve a la normalidad.'
        : 'Al navegar verá un aviso de pago. Su internet sigue funcionando, pero sus conexiones actuales se reiniciarán.';
    const reason = window.prompt(`${verb}: ${this.clientName()}\n${effect}\n\nEscriba el motivo (queda en el historial) y pulse Aceptar para confirmar:`, def);
    if (reason === null) return;

    this.busy.set(action);
    this.svc.apply(this.idServicio(), action, reason || def, action === 'block').subscribe({
      next: (res) => {
        this.busy.set(null);
        if (res.ok) {
          const killed = res.connectionsKilled ? ` · ${res.connectionsKilled} conexiones cerradas` : '';
          const ip = res.ip ? ` (IP ${res.ip})` : '';
          this.toast.success(`${done}: ${this.clientName()}${ip}${killed}`);
          this.changed.emit({ action, result: res });
        } else {
          this.toast.error(res.error || `No se pudo completar: ${verb.toLowerCase()}`);
        }
      },
      error: (err) => {
        this.busy.set(null);
        this.toast.error(err.error?.error || err.message || 'No se pudo conectar con el servidor. Intente de nuevo.');
      },
    });
  }
}
