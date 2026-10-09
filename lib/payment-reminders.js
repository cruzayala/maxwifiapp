'use strict';

// Avisos de cobro por WhatsApp con la configuracion de Ajustes > Notificaciones.
//
// Por que existe: antes los mandaba el navegador. Cada pestana de ISP Max abierta corria su
// propio programador (dos PCs abiertas a la hora del envio podian duplicar mensajes), si
// nadie tenia ISP Max abierto a esa hora no salia nada, y bastaba un estado_facturas
// congelado para escribirle a quien ya habia pagado o a un servicio borrado en WispHub.
// Ahora hay un solo programador, en el servidor, a la hora de Santo Domingo.

const { calendarDaysOverdue } = require('./business-time');

const REMINDER_REPEAT_DAYS = 7;
const DAY = 86_400_000;

const digits = (value) => String(value || '').replace(/\D/g, '');

function readConfig(settings = {}) {
  const number = (key, fallback, min, max) => {
    const value = Number(settings[key]);
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  };
  return {
    enabled: String(settings.autoNotifEnabled) === 'true',
    reminderDays: number('autoNotifReminderDays', 3, 0, 30),
    overdueEnabled: settings.autoNotifOverdueEnabled === undefined ? true : String(settings.autoNotifOverdueEnabled) === 'true',
    overdueInterval: number('autoNotifOverdueInterval', 3, 1, 60),
    scheduleHour: number('autoNotifScheduleHour', 10, 0, 23),
    // Los mismos textos por defecto que muestra Ajustes (src/app/services/config.service.ts).
    reminderMsg: settings.autoNotifReminderMsg || 'Hola {nombre}, le recordamos que su factura de internet con {empresa} vence el {fecha_corte}. Monto: RD$ {precio}. Gracias por su pago puntual.',
    overdueMsg: settings.autoNotifOverdueMsg || 'Hola {nombre}, su servicio de internet con {empresa} tiene un pago pendiente vencido hace {dias_vencido} días. Monto: RD$ {precio}. Para evitar la suspensión, por favor regularice a la brevedad.',
    companyName: settings.companyName || 'ISP Max',
  };
}

function renderMessage(template, client, days, companyName) {
  return String(template)
    .replace(/\{nombre\}/g, client.aliasNombre || client.nombre || '')
    .replace(/\{empresa\}/g, companyName)
    .replace(/\{fecha_corte\}/g, client.fechaCorte || '')
    .replace(/\{precio\}/g, client.precioPlan || '0')
    .replace(/\{dias_vencido\}/g, String(days))
    .replace(/\{plan\}/g, client.planInternetName || '');
}

/**
 * Que avisos tocan hoy. No envia nada.
 *   clients:  filas de Client (idServicio, nombre, telefono, estado, fechaCorte, ...)
 *   owing:    Set de idServicio con factura pendiente de verdad
 *   lastSent: Map 'reminder_<telefono>' | 'overdue_<telefono>' -> fecha del ultimo envio
 *   parseCut: convierte fechaCorte (texto de WispHub) a Date
 */
function planPaymentReminders({ clients, owing, lastSent, config, now = new Date(), parseCut }) {
  const plan = [];
  const skipped = { sin_telefono: 0, no_activo: 0, borrado_en_wisphub: 0, sin_deuda: 0, sin_fecha_corte: 0, enviado_hace_poco: 0, fuera_de_fecha: 0 };
  const sentWithin = (key, days) => {
    const at = lastSent.get(key);
    return Boolean(at) && now.getTime() - new Date(at).getTime() < days * DAY;
  };
  const planned = new Set();
  for (const client of clients) {
    const phone = digits(client.aliasTelefono || client.telefono);
    if (phone.length < 7) { skipped.sin_telefono++; continue; }
    if (String(client.estado || '').toLowerCase() !== 'activo') { skipped.no_activo++; continue; }
    if (client.missingFromWisphubAt) { skipped.borrado_en_wisphub++; continue; }
    if (!owing.has(client.idServicio)) { skipped.sin_deuda++; continue; }
    const overdue = calendarDaysOverdue(parseCut(client.fechaCorte), now);
    if (overdue === null) { skipped.sin_fecha_corte++; continue; }
    const daysToCut = -overdue;
    let type = null;
    if (daysToCut >= 0 && daysToCut <= config.reminderDays) type = 'reminder';
    else if (config.overdueEnabled && daysToCut < 0) type = 'overdue';
    if (!type) { skipped.fuera_de_fecha++; continue; }
    const key = `${type}_${phone}`;
    // Un telefono compartido por varios servicios recibe un solo aviso por tipo.
    if (planned.has(key) || sentWithin(key, type === 'reminder' ? REMINDER_REPEAT_DAYS : config.overdueInterval)) { skipped.enviado_hace_poco++; continue; }
    planned.add(key);
    plan.push({
      idServicio: client.idServicio,
      phone,
      type,
      clientName: client.aliasNombre || client.nombre,
      message: renderMessage(type === 'reminder' ? config.reminderMsg : config.overdueMsg, client, Math.abs(daysToCut), config.companyName),
    });
  }
  return { plan, skipped };
}

module.exports = { planPaymentReminders, readConfig, renderMessage };
