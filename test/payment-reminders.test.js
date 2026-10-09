'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planPaymentReminders, readConfig } = require('../lib/payment-reminders');

// Fecha de WispHub "DD/MM/YYYY" -> fecha local, como parseFechaCorte de server.js.
const parseCut = (text) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text || '');
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
};
const config = readConfig({ autoNotifEnabled: 'true', autoNotifReminderDays: '3', autoNotifOverdueInterval: '3', companyName: 'Cruz Ayala' });
// 10:00 a. m. del 8 de octubre en Santo Domingo.
const now = new Date('2026-10-08T14:00:00Z');
const client = (idServicio, fechaCorte, extra = {}) => ({ idServicio, nombre: `Cliente ${idServicio}`, telefono: `809555${String(idServicio).padStart(4, '0')}`, estado: 'Activo', fechaCorte, precioPlan: '1200', ...extra });

test('only active clients who really owe get a message, on the right day', () => {
  const clients = [
    client(1, '10/10/2026'),                                   // vence en 2 dias -> recordatorio
    client(2, '05/10/2026'),                                   // vencio hace 3 dias -> aviso de mora
    client(3, '10/10/2026'),                                   // ya pago: no debe
    client(4, '10/10/2026', { missingFromWisphubAt: new Date() }), // borrado en WispHub
    client(5, '10/10/2026', { estado: 'Suspendido' }),
    client(6, '20/10/2026'),                                   // falta mucho
    client(7, '10/10/2026', { telefono: '123' }),
  ];
  const owing = new Set([1, 2, 4, 5, 6, 7]);
  const { plan, skipped } = planPaymentReminders({ clients, owing, lastSent: new Map(), config, now, parseCut });
  assert.deepEqual(plan.map((item) => [item.idServicio, item.type]), [[1, 'reminder'], [2, 'overdue']]);
  assert.equal(skipped.sin_deuda, 1);
  assert.equal(skipped.borrado_en_wisphub, 1);
  assert.equal(skipped.no_activo, 1);
  assert.equal(skipped.fuera_de_fecha, 1);
  assert.equal(skipped.sin_telefono, 1);
  assert.match(plan[0].message, /Cliente 1.*Cruz Ayala.*10\/10\/2026.*RD\$ 1200/);
  assert.match(plan[1].message, /vencido hace 3 días/);
});

test('no repeated messages: reminders once a week, overdue notices every N days, one per phone', () => {
  const clients = [client(1, '10/10/2026'), client(2, '05/10/2026'), client(9, '10/10/2026', { telefono: '8095550001' })];
  const owing = new Set([1, 2, 9]);
  const lastSent = new Map([
    ['reminder_8095550001', new Date('2026-10-05T14:00:00Z')], // hace 3 dias
    ['overdue_8095550002', new Date('2026-10-04T14:00:00Z')],  // hace 4 dias: ya toca otra vez
  ]);
  const { plan, skipped } = planPaymentReminders({ clients, owing, lastSent, config, now, parseCut });
  assert.deepEqual(plan.map((item) => item.idServicio), [2]);
  assert.equal(skipped.enviado_hace_poco, 2, 'client 1 was reminded 3 days ago and client 9 shares its phone');
});

test('the cut day counts in Santo Domingo even late at night', () => {
  // 9:30 p. m. del 6 de octubre = 01:30 UTC del 7; corte el 10 -> faltan 4 dias, fuera de los 3.
  const late = new Date('2026-10-07T01:30:00Z');
  const { plan } = planPaymentReminders({ clients: [client(1, '10/10/2026')], owing: new Set([1]), lastSent: new Map(), config, now: late, parseCut });
  assert.equal(plan.length, 0);
});

test('settings are read with safe defaults', () => {
  const defaults = readConfig({});
  assert.equal(defaults.enabled, false, 'off unless explicitly enabled');
  assert.equal(defaults.scheduleHour, 10);
  assert.equal(defaults.overdueEnabled, true);
  assert.equal(readConfig({ autoNotifScheduleHour: '99', autoNotifReminderDays: '-1' }).scheduleHour, 10);
  assert.equal(readConfig({ autoNotifReminderDays: '-1' }).reminderDays, 3);
});
