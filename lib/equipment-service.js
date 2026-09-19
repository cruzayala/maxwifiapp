'use strict';

const { createHash } = require('node:crypto');
const statuses = ['stock', 'assigned', 'rma', 'lost', 'retired'];
const fields = ['typeId', 'serialNumber', 'macAddress', 'brand', 'model', 'unitCost', 'notes', 'status'];
const fail = (message, status = 400, code = 'INVALID_EQUIPMENT') => { throw Object.assign(new Error(message), { status, code }); };
const version = (row) => createHash('sha256').update(JSON.stringify(row, Object.keys(row).sort())).digest('hex');
const presentEquipment = (row) => ({ ...row, version: version(row) });
const positive = (value) => Number.isSafeInteger(value) && value > 0;
function text(value, max = 200) {
  if (value !== null && typeof value !== 'string') fail('Texto invalido.');
  const result = value?.trim() || null;
  if (result?.length > max) fail(`Texto demasiado largo (maximo ${max}).`);
  return result;
}
function validateEquipment(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !fields.includes(k))) fail('Campos de equipo no permitidos.');
  if (!partial && !positive(body.typeId)) fail('Selecciona un tipo de equipo.');
  const data = {};
  for (const key of fields) {
    if (body[key] === undefined) continue;
    const value = body[key];
    if (key === 'typeId') { if (!positive(value)) fail('Tipo invalido.'); data[key] = value; }
    else if (key === 'status') { if (!statuses.includes(value)) fail('Estado invalido.'); data[key] = value; }
    else if (key === 'unitCost') {
      if (!['number', 'string'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value)) || Number(value) > 1e9) fail('Costo invalido. Usa hasta dos decimales.');
      data[key] = Number(value);
    } else {
      data[key] = text(value, key === 'notes' ? 4000 : 200);
      if (key === 'macAddress' && data[key]) {
        const mac = data[key].replace(/[:-]/g, '');
        if (!/^[0-9a-f]{12}$/i.test(mac)) fail('MAC invalida.');
        data[key] = mac.match(/../g).join(':').toUpperCase();
      }
    }
  }
  if (!Object.keys(data).length) fail('No hay cambios.');
  return data;
}
function validateAssignment(body) {
  if (!body || Array.isArray(body) || Object.keys(body).some(k => !['clientId', 'notes'].includes(k)) || !positive(body.clientId)) fail('Selecciona un cliente valido.');
  return { clientId: body.clientId, notes: body.notes === undefined ? null : text(body.notes, 4000) };
}
async function changeEquipment(tx, { id, operation, data = {}, expectedVersion, actor }) {
  const before = id ? await tx.equipment.findUnique({ where: { id } }) : null;
  if (id && !before) fail('Equipo no encontrado.', 404, 'NOT_FOUND');
  if (before && expectedVersion && version(before) !== expectedVersion) fail('El equipo cambio en otro dispositivo. Vuelve a abrirlo.', 409, 'STALE_EQUIPMENT');
  let changes;
  if (operation === 'assign') {
    if (before.status !== 'stock' || before.assignedToClientId) fail('Este equipo no esta disponible. Devuelvelo antes de asignarlo a otro cliente.', 409, 'EQUIPMENT_UNAVAILABLE');
    if (!await tx.client.findUnique({ where: { idServicio: data.clientId }, select: { idServicio: true } })) fail('Cliente no encontrado.', 404, 'NOT_FOUND');
    changes = { assignedToClientId: data.clientId, assignedAt: new Date(), assignedBy: actor, installNotes: data.notes, status: 'assigned' };
  } else if (operation === 'return') {
    if (!before.assignedToClientId && before.status !== 'assigned') fail('El equipo ya no esta asignado.', 409, 'EQUIPMENT_NOT_ASSIGNED');
    changes = { assignedToClientId: null, assignedAt: null, assignedBy: null, installNotes: null, status: 'stock' };
  } else if (operation === 'delete') {
    if (before.assignedToClientId || before.status === 'assigned') fail('Devuelve el equipo antes de eliminarlo.', 409, 'EQUIPMENT_ASSIGNED');
    if (before.purchaseId) fail('El equipo tiene una compra vinculada. Puedes marcarlo como retirado conservando su origen.', 409, 'LINKED_PURCHASE');
  } else if (operation === 'create' || operation === 'update') {
    changes = { ...data };
    if (operation === 'create' && changes.status && changes.status !== 'stock') fail('Los equipos nuevos ingresan a stock.');
    if (changes.status === 'assigned' && !before?.assignedToClientId || before?.assignedToClientId && changes.status && changes.status !== 'assigned') fail('Usa la asignacion o devolucion para cambiar el cliente.', 409, 'ASSIGNMENT_REQUIRED');
    if (before && changes.typeId !== undefined && changes.typeId !== before.typeId) fail('No se puede cambiar el tipo de una unidad existente.');
    if (!before || changes.typeId) {
      const type = await tx.equipmentType.findUnique({ where: { id: changes.typeId || before.typeId } });
      if (!type) fail('Tipo no encontrado.', 404, 'NOT_FOUND');
      if (type.unit !== 'u') fail('Este tipo se controla por cantidad desde compras, no como equipo individual.');
    }
    if (before?.purchaseId && changes.unitCost !== undefined && changes.unitCost !== before.unitCost) fail('El costo se administra desde la compra vinculada.', 409, 'LINKED_PURCHASE');
    if (changes.serialNumber) {
      const duplicate = await tx.$queryRaw`SELECT id FROM Equipment WHERE LOWER(TRIM(serialNumber)) = LOWER(${changes.serialNumber}) AND id != ${id || 0} LIMIT 1`;
      if (duplicate.length) fail('Ya existe un equipo con ese serial.', 409, 'DUPLICATE_SERIAL');
    }
  } else fail('Operacion no disponible.');
  const after = operation === 'delete' ? null : before
    ? await tx.equipment.update({ where: { id }, data: changes })
    : await tx.equipment.create({ data: { ...changes, status: 'stock' } });
  if (operation === 'delete') await tx.equipment.delete({ where: { id } });
  const entityId = String(after?.id || id);
  await tx.activity.create({ data: { action: `${operation}_equipment`, entityType: 'equipment', entityId,
    entityName: after?.serialNumber || before?.serialNumber || `#${entityId}`, details: JSON.stringify({ actor, before, after }) } });
  return after ? presentEquipment(after) : { success: true, id };
}
module.exports = { statuses, validateEquipment, validateAssignment, presentEquipment, changeEquipment };
