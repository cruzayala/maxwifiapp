import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ConfigService } from './config.service';
import { LocalDbService } from './local-db.service';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class NotificationSchedulerService {
  private http = inject(HttpClient);
  private config = inject(ConfigService);
  private db = inject(LocalDbService);
  private toast = inject(ToastService);

  private readonly LAST_RUN_KEY = 'wishub_notif_last_run';
  private readonly SENT_LOG_KEY = 'wishub_notif_sent';
  private intervalId: any;

  start() {
    this.stop();
    // Check every 30 minutes if we need to send
    this.intervalId = setInterval(() => this.checkAndRun(), 30 * 60 * 1000);
    // Run once on start
    setTimeout(() => this.checkAndRun(), 5000);
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private getLastRun(): Date | null {
    const ts = localStorage.getItem(this.LAST_RUN_KEY);
    return ts ? new Date(ts) : null;
  }

  private setLastRun() {
    localStorage.setItem(this.LAST_RUN_KEY, new Date().toISOString());
  }

  private getSentLog(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem(this.SENT_LOG_KEY) || '{}'); }
    catch { return {}; }
  }

  private markSent(phone: string, type: 'reminder' | 'overdue') {
    const log = this.getSentLog();
    log[`${type}_${phone}`] = new Date().toISOString();
    localStorage.setItem(this.SENT_LOG_KEY, JSON.stringify(log));
  }

  private wasSentRecently(phone: string, type: 'reminder' | 'overdue', maxDays: number): boolean {
    const log = this.getSentLog();
    const key = `${type}_${phone}`;
    if (!log[key]) return false;
    const days = (Date.now() - new Date(log[key]).getTime()) / (1000 * 60 * 60 * 24);
    return days < maxDays;
  }

  async checkAndRun() {
    const cfg = this.config.getNotifConfig();
    if (!cfg.enabled) return;

    // Check WhatsApp status
    try {
      const status = await this.http.get<any>('/wa/status').toPromise();
      if (status?.status !== 'connected') return;
    } catch {
      return;
    }

    const now = new Date();
    const currentHour = now.getHours();
    if (currentHour !== cfg.scheduleHour) return;

    // Prevent running twice the same day
    const lastRun = this.getLastRun();
    if (lastRun && lastRun.toDateString() === now.toDateString()) return;

    this.setLastRun();
    await this.runJob();
  }

  async runJob() {
    const cfg = this.config.getNotifConfig();
    const clients = await this.db.getClients();
    const reminders: any[] = [];
    const overdue: any[] = [];

    const today = new Date();

    for (const c of clients) {
      if (!c.telefono || c.telefono.length < 7) continue;
      if (c.estado?.toLowerCase() !== 'activo') continue;

      const corteDate = this.parseDate(c.fecha_corte);
      if (!corteDate) continue;

      const daysToCorte = Math.floor((corteDate.getTime() - today.getTime()) / 86400000);

      // Recordatorio antes del corte
      if (daysToCorte >= 0 && daysToCorte <= cfg.reminderDays) {
        if (c.estado_facturas?.toLowerCase().includes('pendiente')) {
          if (!this.wasSentRecently(c.telefono, 'reminder', 7)) {
            reminders.push({
              phone: c.telefono,
              message: this.buildMessage(cfg.reminderMsg, c, Math.abs(daysToCorte)),
              client: c.nombre,
            });
          }
        }
      }

      // Aviso de morosos (ya vencido)
      if (cfg.overdueEnabled && daysToCorte < 0) {
        if (c.estado_facturas?.toLowerCase().includes('pendiente')) {
          if (!this.wasSentRecently(c.telefono, 'overdue', cfg.overdueInterval)) {
            overdue.push({
              phone: c.telefono,
              message: this.buildMessage(cfg.overdueMsg, c, Math.abs(daysToCorte)),
              client: c.nombre,
              type: 'overdue',
            });
          }
        }
      }
    }

    const all = [...reminders, ...overdue];
    if (all.length === 0) return;

    try {
      const response = await this.http.post<any>('/wa/send-bulk', { contacts: all }).toPromise();
      const sent = response?.results?.filter((r: any) => r.status === 'sent') || [];
      sent.forEach((r: any) => {
        const item = all.find(x => x.phone === r.phone);
        if (item) this.markSent(item.phone, item.type === 'overdue' ? 'overdue' : 'reminder');
      });
      this.toast.success(`${sent.length} notificaciones automaticas enviadas`);
    } catch (e) {
      console.error('Auto-notif error', e);
    }
  }

  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      return new Date(+parts[2], +parts[1] - 1, +parts[0]);
    }
    return new Date(dateStr);
  }

  private buildMessage(template: string, client: any, dias: number): string {
    return template
      .replace(/\{nombre\}/g, client.nombre || '')
      .replace(/\{empresa\}/g, this.config.companyName())
      .replace(/\{fecha_corte\}/g, client.fecha_corte || '')
      .replace(/\{precio\}/g, client.precio_plan || '0')
      .replace(/\{dias_vencido\}/g, String(dias))
      .replace(/\{plan\}/g, client.plan_internet?.nombre || '');
  }

  async runNow() {
    this.toast.info('Ejecutando envio automatico ahora...');
    await this.runJob();
    this.setLastRun();
  }
}
