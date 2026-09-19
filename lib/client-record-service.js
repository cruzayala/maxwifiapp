'use strict';

const { createHash } = require('node:crypto');
const aliasFields = ['aliasNombre', 'aliasCedula', 'aliasTelefono', 'aliasNotas'];
const fail = (message, status = 400, code = 'INVALID_CLIENT_RECORD') => { throw Object.assign(new Error(message), { status, code }); };
const version = (row) => createHash('sha256').update(JSON.stringify(row, Object.keys(row).sort())).digest('hex');
const aliasSelect = { idServicio: true, nombre: true, ...Object.fromEntries(aliasFields.map(k => [k, true])) };
const aliasVersion = (row) => version(Object.fromEntries(['idServicio', ...aliasFields].map(k => [k, row[k] ?? null])));
const presentAlias = row => ({ ...row, version: aliasVersion(row), scope: 'ispmax_local' });
const presentPromise = row => ({ ...row, version: version(row) });

function validateAlias(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(k => !aliasFields.includes(k))) fail('Campos del expediente invalidos.');
  return Object.fromEntries(Object.entries(body).map(([key, value]) => {
    if (value !== null && typeof value !== 'string' || value?.length > (key === 'aliasNotas' ? 4000 : 200)) fail('Texto del expediente invalido.');
    return [key, value?.trim() || null];
  }));
}
function calendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Fecha invalida. Usa AAAA-MM-DD.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail('Fecha inexistente.');
  return date;
}
function validatePromise(body, partial = false) {
  const fields = partial ? ['amount', 'promisedDate', 'notes', 'status'] : ['idServicio', 'amount', 'promisedDate', 'notes'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(k => !fields.includes(k))) fail('Campos de promesa invalidos.');
  if (!partial && ['idServicio', 'amount', 'promisedDate'].some(k => body[k] == null)) fail('Selecciona cliente, importe y fecha.');
  const data = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'idServicio') {
      if (!Number.isSafeInteger(value) || value <= 0) fail('Cliente invalido.');
      data[key] = value;
    } else if (key === 'amount') {
      if (!['number', 'string'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value)) || Number(value) <= 0 || Number(value) > 1e9) fail('Importe positivo con hasta dos decimales requerido.');
      data[key] = Number(value);
    } else if (key === 'promisedDate') data[key] = calendarDay(value);
    else if (key === 'status') {
      if (!['pending', 'paid', 'broken'].includes(value)) fail('Estado de promesa invalido.');
      data[key] = value;
    } else {
      if (value !== null && typeof value !== 'string' || value?.length > 4000) fail('Nota invalida.');
      data[key] = value?.trim() || null;
    }
  }
  return data;
}
async function changeAlias(tx, { id, data, expectedVersion, actor }) {
  const previous = await tx.client.findUnique({ where: { idServicio: id }, select: aliasSelect });
  if (!previous) fail('Cliente no encontrado.', 404, 'NOT_FOUND');
  if (expectedVersion && expectedVersion !== aliasVersion(previous)) fail('El expediente cambio. Recarga antes de guardar.', 409, 'STALE_CLIENT');
  const row = await tx.client.update({ where: { idServicio: id }, data, select: aliasSelect });
  await tx.activity.create({ data: { action: 'client_alias_updated', entityType: 'client', entityId: String(id), details: JSON.stringify({ actor, fields: Object.keys(data), before: previous, after: row }) } });
  return presentAlias(row);
}
async function changePromise(tx, { id, data, expectedVersion, actor }) {
  const previous = id ? await tx.paymentPromise.findUnique({ where: { id } }) : null;
  if (id && !previous) fail('Promesa no encontrada.', 404, 'NOT_FOUND');
  if (previous && expectedVersion && expectedVersion !== version(previous)) fail('La promesa cambio. Recarga antes de guardar.', 409, 'STALE_PROMISE');
  const idServicio = previous?.idServicio ?? data.idServicio;
  const client = await tx.client.findUnique({ where: { idServicio }, select: { nombre: true, aliasNombre: true } });
  if (!client) fail('Cliente no encontrado.', 404, 'NOT_FOUND');
  // A fulfilled promise is a follow-up status, never a payment or invoice mutation.
  const values = { ...data };
  if (data.status) values.completedAt = data.status === 'pending' ? null : previous?.completedAt || new Date();
  const row = id ? await tx.paymentPromise.update({ where: { id }, data: values })
    : await tx.paymentPromise.create({ data: { ...values, clientName: client.aliasNombre || client.nombre, status: 'pending' } });
  await tx.activity.create({ data: { action: id ? 'payment_promise_updated' : 'payment_promise_created', entityType: 'client', entityId: String(idServicio), details: JSON.stringify({ actor, promiseId: row.id, before: previous, after: row }) } });
  return presentPromise(row);
}

module.exports = { aliasSelect, presentAlias, presentPromise, validateAlias, validatePromise, changeAlias, changePromise, calendarDay };
