'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { businessClock, calendarDaysOverdue, createDailyRunner } = require('../lib/business-time');

test('the business clock is Santo Domingo time, not the UTC of the server', () => {
  // 13:00 UTC = 9:00 a. m. en Santo Domingo (UTC-4, sin horario de verano).
  assert.deepEqual(businessClock(new Date('2026-10-08T13:00:00Z')), { date: '2026-10-08', hour: 9 });
  // 01:15 UTC del 9 = 9:15 p. m. del 8.
  assert.deepEqual(businessClock(new Date('2026-10-09T01:15:00Z')), { date: '2026-10-08', hour: 21 });
  assert.deepEqual(businessClock(new Date('2026-10-09T04:00:00Z')), { date: '2026-10-09', hour: 0 });
});

test('days overdue are calendar days in Santo Domingo all day long', () => {
  const cut = new Date(2026, 9, 10); // corte el 10 de octubre
  assert.equal(calendarDaysOverdue(cut, new Date('2026-10-07T14:00:00Z')), -3, 'three days before, at 10 a.m.');
  assert.equal(calendarDaysOverdue(cut, new Date('2026-10-10T12:00:00Z')), 0, 'the cut day');
  // 9:30 p. m. del 9: antes contaba 0 ("vence hoy") porque en UTC ya era el 10.
  assert.equal(calendarDaysOverdue(cut, new Date('2026-10-10T01:30:00Z')), -1);
  assert.equal(calendarDaysOverdue(cut, new Date('2026-10-13T23:59:00Z')), 3);
  assert.equal(calendarDaysOverdue(null), null);
  assert.equal(calendarDaysOverdue(new Date('x')), null);
});

test('a daily task runs once, at the business hour, and a restart does not repeat it', async () => {
  let clock = new Date('2026-10-08T12:55:00Z'); // 8:55 a. m.
  const saved = new Map();
  const store = { get: async (key) => saved.get(key) ?? null, set: async (key, value) => { saved.set(key, value); } };
  let runs = 0;
  const make = () => createDailyRunner({ name: 'notif', hour: () => 9, run: async () => ++runs, store, now: () => clock });

  const first = make();
  assert.equal((await first.tick()).reason, 'not_the_hour');
  clock = new Date('2026-10-08T13:20:00Z'); // 9:20 a. m.
  assert.equal((await first.tick()).ran, true);
  assert.equal((await first.tick()).reason, 'already_ran_today');
  // Reinicio a las 9:40: el dia ya quedo guardado.
  clock = new Date('2026-10-08T13:40:00Z');
  assert.equal((await make().tick()).reason, 'already_ran_today');
  assert.equal(runs, 1);
  // Al dia siguiente vuelve a correr; a las 5 a. m. (9 UTC) no.
  clock = new Date('2026-10-09T09:05:00Z');
  assert.equal((await make().tick()).reason, 'not_the_hour', '9 UTC is 5 a.m. in Santo Domingo');
  clock = new Date('2026-10-09T13:05:00Z');
  assert.equal((await make().tick()).ran, true);
  assert.equal(runs, 2);
});

test('a disabled task never runs and a failing task is not retried the same day', async () => {
  const saved = new Map();
  const store = { get: async (key) => saved.get(key) ?? null, set: async (key, value) => { saved.set(key, value); } };
  const clock = new Date('2026-10-08T13:10:00Z');
  const off = createDailyRunner({ name: 'block', hour: () => 9, enabled: () => false, run: async () => assert.fail('must not run'), store, now: () => clock });
  assert.equal((await off.tick()).reason, 'disabled');
  let attempts = 0;
  const failing = createDailyRunner({ name: 'warn', hour: () => 9, run: async () => { attempts++; throw new Error('MikroTik caido'); }, store, now: () => clock });
  await assert.rejects(failing.tick(), /MikroTik caido/);
  assert.equal((await failing.tick()).reason, 'already_ran_today');
  assert.equal(attempts, 1);
});
