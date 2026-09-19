import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly STORAGE_KEY = 'wishub_config';
  private readonly http = inject(HttpClient);
  loaded = signal(false);

  companyName = signal('MaxWiFi RD');
  companySlogan = signal('Servicio de Internet');
  companyPhone = signal('');
  companyAddress = signal('');
  rnc = signal('');
  defaultPaperSize = signal<'58mm' | '80mm'>('80mm');

  // WhatsApp notificaciones automaticas
  autoNotifEnabled = signal(false);
  autoNotifReminderDays = signal(3); // dias antes del corte para recordatorio
  autoNotifOverdueEnabled = signal(true); // avisar cuando ya esta vencido
  autoNotifOverdueInterval = signal(3); // cada cuantos dias avisar a un moroso
  autoNotifScheduleHour = signal(10); // hora del dia para enviar (24h)
  autoNotifReminderMsg = signal(
    'Hola {nombre}, le recordamos que su factura de internet con {empresa} vence el {fecha_corte}. Monto: RD$ {precio}. Gracias por su pago puntual.'
  );
  autoNotifOverdueMsg = signal(
    'Hola {nombre}, su servicio de internet con {empresa} tiene un pago pendiente vencido hace {dias_vencido} dias. Monto: RD$ {precio}. Para evitar la suspension, por favor regularice a la brevedad.'
  );

  constructor() {
    this.load();
  }

  load() {
    this.http.get<Record<string, string>>('/db/settings').subscribe({
      next: (settings) => {
        if (Object.keys(settings).length) {
          this.apply(settings);
          this.removeLegacyBrowserConfig();
          this.loaded.set(true);
          return;
        }
        const legacy = this.readLegacyBrowserConfig();
        if (legacy) {
          this.apply(legacy);
          this.save().subscribe({ next: () => this.removeLegacyBrowserConfig() });
        }
        this.loaded.set(true);
      },
      error: () => {
        const legacy = this.readLegacyBrowserConfig();
        if (legacy) this.apply(legacy);
        this.loaded.set(true);
      },
    });
  }

  save(): Observable<unknown> {
    return this.http.put('/db/settings', this.snapshot()).pipe(tap(() => this.removeLegacyBrowserConfig()));
  }

  private snapshot() {
    return {
      companyName: this.companyName(),
      companySlogan: this.companySlogan(),
      companyPhone: this.companyPhone(),
      companyAddress: this.companyAddress(),
      rnc: this.rnc(),
      defaultPaperSize: this.defaultPaperSize(),
      autoNotifEnabled: this.autoNotifEnabled(),
      autoNotifReminderDays: this.autoNotifReminderDays(),
      autoNotifOverdueEnabled: this.autoNotifOverdueEnabled(),
      autoNotifOverdueInterval: this.autoNotifOverdueInterval(),
      autoNotifScheduleHour: this.autoNotifScheduleHour(),
      autoNotifReminderMsg: this.autoNotifReminderMsg(),
      autoNotifOverdueMsg: this.autoNotifOverdueMsg(),
    };
  }

  private apply(c: Record<string, unknown>) {
    if (c['companyName']) this.companyName.set(String(c['companyName']));
    if (c['companySlogan']) this.companySlogan.set(String(c['companySlogan']));
    if (c['companyPhone']) this.companyPhone.set(String(c['companyPhone']));
    if (c['companyAddress']) this.companyAddress.set(String(c['companyAddress']));
    if (c['rnc']) this.rnc.set(String(c['rnc']));
    if (c['defaultPaperSize'] === '58mm' || c['defaultPaperSize'] === '80mm') this.defaultPaperSize.set(c['defaultPaperSize']);
    if (c['autoNotifEnabled'] !== undefined) this.autoNotifEnabled.set(String(c['autoNotifEnabled']) === 'true');
    if (c['autoNotifReminderDays']) this.autoNotifReminderDays.set(Number(c['autoNotifReminderDays']));
    if (c['autoNotifOverdueEnabled'] !== undefined) this.autoNotifOverdueEnabled.set(String(c['autoNotifOverdueEnabled']) === 'true');
    if (c['autoNotifOverdueInterval']) this.autoNotifOverdueInterval.set(Number(c['autoNotifOverdueInterval']));
    if (c['autoNotifScheduleHour'] !== undefined) this.autoNotifScheduleHour.set(Number(c['autoNotifScheduleHour']));
    if (c['autoNotifReminderMsg']) this.autoNotifReminderMsg.set(String(c['autoNotifReminderMsg']));
    if (c['autoNotifOverdueMsg']) this.autoNotifOverdueMsg.set(String(c['autoNotifOverdueMsg']));
  }

  private readLegacyBrowserConfig(): Record<string, unknown> | null {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  private removeLegacyBrowserConfig() {
    try { localStorage.removeItem(this.STORAGE_KEY); } catch {}
  }

  getNotifConfig() {
    return {
      enabled: this.autoNotifEnabled(),
      reminderDays: this.autoNotifReminderDays(),
      overdueEnabled: this.autoNotifOverdueEnabled(),
      overdueInterval: this.autoNotifOverdueInterval(),
      scheduleHour: this.autoNotifScheduleHour(),
      reminderMsg: this.autoNotifReminderMsg(),
      overdueMsg: this.autoNotifOverdueMsg(),
      companyName: this.companyName(),
    };
  }
}
