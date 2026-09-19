'use strict';

const { createHash } = require('node:crypto');
const categories = ['inventario', 'nomina', 'servicios', 'transporte', 'otros'];
const fields = ['category', 'description', 'amount', 'expenseDate', 'paymentMethod', 'reference', 'clientIdServicio', 'notes'];
const fail = (message, status = 400, code = 'INVALID_EXPENSE') => { throw Object.assign(new Error(message), { status, code }); };
const version = (row) => createHash('sha256').update(JSON.stringify(row, Object.keys(row).sort())).digest('hex');
const presentExpense = (row) => ({ ...row, version: version(row), editable: !row.purchaseId && !row.payrollId,
  blockedReason: row.purchaseId ? 'Este gasto se administra desde su compra.' : row.payrollId ? 'Este gasto se administra desde nomina.' : null });

function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) fail('Fecha invalida. Usa AAAA-MM-DD.');
  const day = new Date(value.slice(0, 10) + 'T00:00:00.000Z');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) fail('Fecha invalida.');
  return date;
}
function validateExpense(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Gasto invalido.');
  if (Object.keys(body).some((key) => !fields.includes(key))) fail('El gasto contiene campos no permitidos.');
  const data = {};
  if (!partial && fields.slice(0, 4).some((key) => body[key] == null)) fail('Categoria, descripcion, importe y fecha son obligatorios.');
  for (const key of fields) {
    if (body[key] === undefined) continue;
    const value = body[key];
    if (key === 'category') {
      if (!categories.includes(value)) fail('Categoria invalida.');
      data[key] = value;
    } else if (key === 'amount') {
      if (!['number', 'string'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value)) || !Number.isFinite(Number(value)) || Number(value) > 1e12) fail('Importe invalido: usa un valor positivo con hasta dos decimales.');
      data[key] = Number(value);
    } else if (key === 'expenseDate') data[key] = dateValue(value);
    else if (key === 'clientIdServicio') {
      if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) fail('Cliente invalido.');
      data[key] = value;
    } else {
      const max = key === 'notes' ? 4000 : key === 'description' ? 500 : 200;
      if (value !== null && typeof value !== 'string') fail('Texto invalido.');
      const text = value?.trim() || null;
      if (key === 'description' && !text || text?.length > max) fail(`Campo ${key} invalido.`);
      data[key] = text;
    }
  }
  if (!Object.keys(data).length) fail('No hay cambios para guardar.');
  return data;
}
async function changeExpense(tx, { id, data, remove = false, expectedVersion, actor }) {
  const previous = id ? await tx.expense.findUnique({ where: { id } }) : null;
  if (id && !previous) fail('Gasto no encontrado.', 404, 'NOT_FOUND');
  if (previous?.purchaseId || previous?.payrollId) fail(presentExpense(previous).blockedReason, 409, 'LINKED_EXPENSE');
  if (previous && expectedVersion && version(previous) !== expectedVersion) fail('El gasto cambio en otro dispositivo. Actualiza antes de editar.', 409, 'STALE_EXPENSE');
  if (data?.clientIdServicio && !await tx.client.findUnique({ where: { idServicio: data.clientIdServicio }, select: { idServicio: true } })) fail('Cliente no encontrado.', 404, 'NOT_FOUND');
  const current = remove ? await tx.expense.delete({ where: { id } }) : id
    ? await tx.expense.update({ where: { id }, data })
    : await tx.expense.create({ data: { ...data, createdBy: actor } });
  await tx.activity.create({ data: { action: remove ? 'delete_expense' : id ? 'update_expense' : 'create_expense',
    entityType: 'expense', entityId: String(current.id), details: JSON.stringify({ actor, before: previous, after: remove ? null : current }) } });
  return remove ? { success: true, id } : presentExpense(current);
}

module.exports = { categories, validateExpense, changeExpense, presentExpense, dateValue };
