import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ToastService } from './toast.service';

/**
 * Los avisos de cobro automaticos los envia el servidor (lib/payment-reminders.js), a la hora
 * de Ajustes en Santo Domingo, aunque nadie tenga ISP Max abierto.
 *
 * Antes este servicio los mandaba desde el navegador: cada pestana abierta corria su propio
 * programador (podia duplicar mensajes) y sin una pestana abierta a esa hora no salia nada.
 * start/stop quedan para no romper a quien los llama; ya no envian nada.
 */
@Injectable({ providedIn: 'root' })
export class NotificationSchedulerService {
  private http = inject(HttpClient);
  private toast = inject(ToastService);

  start() {}

  stop() {}

  async runNow() {
    try {
      const result = await firstValueFrom(this.http.post<{ planned: number }>('/db/notification-state/run-now', {}));
      if (!result.planned) this.toast.info('Hoy no hay avisos pendientes: nadie con deuda está en sus días de aviso.');
      else this.toast.success(`Enviando ${result.planned} ${result.planned === 1 ? 'aviso' : 'avisos'} por WhatsApp (uno cada 2 segundos).`);
    } catch (error: any) {
      this.toast.error(error?.error?.error || 'No se pudieron enviar los avisos.');
    }
  }
}
