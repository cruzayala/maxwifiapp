import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly STORAGE_KEY = 'wishub_config';

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
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (c.companyName) this.companyName.set(c.companyName);
        if (c.companySlogan) this.companySlogan.set(c.companySlogan);
        if (c.companyPhone) this.companyPhone.set(c.companyPhone);
        if (c.companyAddress) this.companyAddress.set(c.companyAddress);
        if (c.rnc) this.rnc.set(c.rnc);
        if (c.defaultPaperSize) this.defaultPaperSize.set(c.defaultPaperSize);
        if (c.autoNotifEnabled !== undefined) this.autoNotifEnabled.set(c.autoNotifEnabled);
        if (c.autoNotifReminderDays) this.autoNotifReminderDays.set(c.autoNotifReminderDays);
        if (c.autoNotifOverdueEnabled !== undefined) this.autoNotifOverdueEnabled.set(c.autoNotifOverdueEnabled);
        if (c.autoNotifOverdueInterval) this.autoNotifOverdueInterval.set(c.autoNotifOverdueInterval);
        if (c.autoNotifScheduleHour !== undefined) this.autoNotifScheduleHour.set(c.autoNotifScheduleHour);
        if (c.autoNotifReminderMsg) this.autoNotifReminderMsg.set(c.autoNotifReminderMsg);
        if (c.autoNotifOverdueMsg) this.autoNotifOverdueMsg.set(c.autoNotifOverdueMsg);
      }
    } catch {}
  }

  save() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
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
    }));
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
