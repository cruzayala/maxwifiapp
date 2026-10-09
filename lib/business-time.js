'use strict';

// Hora y calendario del negocio para las automatizaciones.
//
// Por que existe: el servidor corre en UTC (Railway). Las automatizaciones usaban
// getHours() y el dia UTC: un recordatorio configurado para las 9 salia a las 5 a. m.
// de Santo Domingo, y desde las 8 p. m. los dias de atraso se contaban con uno de mas.

const BUSINESS_TIME_ZONE = process.env.BUSINESS_TZ || 'America/Santo_Domingo';
const DAY = 86_400_000;

/** Fecha (YYYY-MM-DD) y hora (0-23) en la zona del negocio. */
function businessClock(now = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type).value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) % 24 };
}

/**
 * Dias calendario desde la fecha de corte hasta hoy en Santo Domingo: 0 el mismo dia,
 * 3 tres dias despues, -1 la vispera. `cutDate` es la fecha (sin hora) que trae WispHub.
 */
function calendarDaysOverdue(cutDate, now = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  if (!(cutDate instanceof Date) || Number.isNaN(cutDate.getTime())) return null;
  const cut = Date.UTC(cutDate.getFullYear(), cutDate.getMonth(), cutDate.getDate());
  const today = Date.parse(`${businessClock(now, timeZone).date}T00:00:00Z`);
  return Math.round((today - cut) / DAY);
}

/**
 * Una tarea diaria a la hora del negocio. Revisa cada pocos minutos (un reinicio dentro
 * de la hora ya no hace perder el dia) y guarda en la base el ultimo dia corrido (un
 * reinicio despues de correr ya no la repite).
 *   hour():    hora configurada (0-23)
 *   enabled(): si la tarea esta activa ahora
 *   run():     la tarea
 *   store:     { get(key) -> string|null, set(key, value) }
 */
function createDailyRunner({ name, hour, enabled = () => true, run, store, now = () => new Date(), timeZone = BUSINESS_TIME_ZONE, log = () => {} }) {
  const key = `automation:${name}:lastRunDate`;
  let running = false;
  return {
    key,
    async tick() {
      if (running) return { ran: false, reason: 'running' };
      if (!(await enabled())) return { ran: false, reason: 'disabled' };
      const clock = businessClock(now(), timeZone);
      if (clock.hour !== Number(await hour())) return { ran: false, reason: 'not_the_hour' };
      if ((await store.get(key)) === clock.date) return { ran: false, reason: 'already_ran_today' };
      running = true;
      try {
        // Se marca antes de correr: si la tarea se cae a mitad, no se repite el mismo dia
        // (un recordatorio duplicado es peor que uno que falto).
        await store.set(key, clock.date);
        log(`[${name}] corriendo la tarea del ${clock.date} a las ${clock.hour}:00 (${timeZone})`);
        return { ran: true, date: clock.date, result: await run() };
      } finally {
        running = false;
      }
    },
  };
}

module.exports = { businessClock, calendarDaysOverdue, createDailyRunner, BUSINESS_TIME_ZONE };
