'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { autoBlockDecision, reminderType } = require('../lib/collection-rules');

const limits = { hardDays: 7, morosoDays: 0 };

test('nobody is cut or marked without a real pending invoice', () => {
  // Un servicio con estado_facturas viejo o una factura ya pagada: aunque el corte
  // haya pasado hace 60 dias, no se toca.
  assert.deepEqual(autoBlockDecision({ owing: false, crmAction: null, overdueDays: 60 }, limits), { wouldDo: null, skip: 'sin_factura_pendiente' });
});

test('an overdue client is marked first and cut after the hard limit', () => {
  assert.deepEqual(autoBlockDecision({ owing: true, crmAction: null, overdueDays: 0 }, limits), { wouldDo: 'moroso', skip: null });
  assert.deepEqual(autoBlockDecision({ owing: true, crmAction: null, overdueDays: 6 }, limits), { wouldDo: 'moroso', skip: null });
  assert.deepEqual(autoBlockDecision({ owing: true, crmAction: 'moroso', overdueDays: 6 }, limits), { wouldDo: null, skip: null }, 'already marked, not yet at the limit');
  assert.deepEqual(autoBlockDecision({ owing: true, crmAction: 'moroso', overdueDays: 7 }, limits), { wouldDo: 'block', skip: null });
});

test('a blocked client or one not yet due is left alone', () => {
  assert.equal(autoBlockDecision({ owing: true, crmAction: 'block', overdueDays: 30 }, limits).skip, 'ya_bloqueado');
  assert.equal(autoBlockDecision({ owing: true, crmAction: null, overdueDays: -2 }, limits).skip, 'no_vencido');
  assert.equal(autoBlockDecision({ owing: true, crmAction: null, overdueDays: null }, limits).skip, 'no_vencido');
});

test('reminders go out only on their days', () => {
  assert.equal(reminderType(-3), 'reminder_t-3');
  assert.equal(reminderType(-1), 'reminder_t-1');
  assert.equal(reminderType(0), 'due_today');
  assert.equal(reminderType(3), 'overdue_t3');
  assert.equal(reminderType(7), 'overdue_t7');
  for (const day of [-4, -2, 1, 2, 4, 8, 30, null]) assert.equal(reminderType(day), null);
});
