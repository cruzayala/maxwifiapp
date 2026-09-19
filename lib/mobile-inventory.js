'use strict';

const { createHash } = require('node:crypto');

const categories = ['wifi', 'cable', 'onu', 'antena', 'otro'];
const units = ['u', 'm', 'kg', 'caja', 'rollo'];
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, status = 400, code = 'INVALID_INVENTORY_DATA') => {
  throw Object.assign(new Error(message), { status, code });
};
const text = (value, label, { required = false, max = 250 } = {}) => {
  if (value == null || value === '') {
    if (required) fail(`${label} es requerido.`);
    return null;
  }
  if (typeof value !== 'string') fail(`${label} invalido.`);
  const clean = value.trim();
  if (required && !clean) fail(`${label} es requerido.`);
  if (clean.length > max) fail(`${label} supera ${max} caracteres.`);
  return clean || null;
};
const money = (value, label) => {
  if (value === '' || value == null || typeof value === 'boolean') fail(`${label} invalido.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1e9 || Math.round(number * 100) !== number * 100) fail(`${label} invalido.`);
  return number;
};
const quantity = (value, label, integer = false) => {
  if (value === '' || value == null || typeof value === 'boolean') fail(`${label} invalida.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 100000 || integer && !Number.isSafeInteger(number)) fail(`${label} invalida.`);
  return number;
};
const strictDate = (value, label) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label} invalida.`);
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail(`${label} invalida.`);
  return date;
};
const typeVersion = (row) => hash([row.id, row.name, row.category, row.unit, row.description, row.createdAt]);
const purchaseVersion = (row) => hash([row.id, row.supplier, row.invoiceRef, row.purchasedAt, row.total, row.notes, row.createdBy, row.createdAt]);
const presentType = (row) => ({ ...row, version: typeVersion(row) });
const presentPurchase = (row) => ({
  ...row,
  version: purchaseVersion(row),
  equipmentCount: row._count?.equipment ?? row.equipment?.length ?? 0,
  canDelete: (row._count?.equipment ?? row.equipment?.length ?? 0) === 0,
});

function typeData(body, editing = false) {
  const input = body || {};
  const data = {};
  if (!editing || Object.hasOwn(input, 'name')) data.name = text(input.name, 'Nombre', { required: true, max: 120 });
  if (!editing || Object.hasOwn(input, 'category')) {
    if (!categories.includes(input.category)) fail('Categoria invalida.');
    data.category = input.category;
  }
  if (!editing || Object.hasOwn(input, 'unit')) {
    const unit = input.unit || 'u';
    if (!units.includes(unit)) fail('Unidad invalida.');
    data.unit = unit;
  }
  if (!editing || Object.hasOwn(input, 'description')) data.description = text(input.description, 'Descripcion', { max: 1000 });
  if (editing && !Object.keys(data).length) fail('No hay cambios para guardar.');
  return data;
}

async function mutation(tx, req, request, execute) {
  const requestKey = String(req.headers['idempotency-key'] || '');
  if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey)) fail('Falta la clave de operacion.');
  const requestHash = hash(request);
  const key = { userId: req.mobileUser.id, requestKey };
  const old = await tx.mobileMutation.findUnique({ where: { userId_requestKey: key } });
  if (old) {
    if (old.requestHash !== requestHash) fail('La clave pertenece a otra operacion.', 409, 'IDEMPOTENCY_CONFLICT');
    return JSON.parse(old.resultJson);
  }
  const result = await execute();
  await tx.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(result) } });
  return result;
}

function registerMobileInventory(router, { prisma, wrap, permission, pagination, positiveId, searchWhere }) {
  router.get('/inventory/types', permission([]), wrap(async (req, res) => {
    const where = searchWhere(req.query, ['name', 'description'], 'id');
    if (req.query.category) {
      if (!categories.includes(req.query.category)) fail('Categoria invalida.');
      where.category = req.query.category;
    }
    const { page, pageSize, skip, take } = pagination(req.query);
    const [total, rows] = await prisma.$transaction([
      prisma.equipmentType.count({ where }),
      prisma.equipmentType.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip, take,
        include: { _count: { select: { equipment: true, purchaseItems: true } } } }),
    ]);
    res.json({ items: rows.map(row => ({ ...presentType(row), equipmentCount: row._count.equipment, purchaseCount: row._count.purchaseItems,
      canDelete: row._count.equipment === 0 && row._count.purchaseItems === 0 })), total, page, pageSize,
    hasMore: skip + rows.length < total, categories, units, fetchedAt: new Date() });
  }));

  router.post('/inventory/types', permission([]), wrap(async (req, res) => {
    const data = typeData(req.body);
    const result = await prisma.$transaction(tx => mutation(tx, req, { module: 'inventory-type', operation: 'create', data }, async () => {
      const duplicate = await tx.equipmentType.findFirst({ where: { name: data.name } });
      if (duplicate) fail('Ya existe un tipo con ese nombre.', 409, 'DUPLICATE_TYPE');
      const row = await tx.equipmentType.create({ data });
      const value = presentType(row);
      await tx.activity.create({ data: { action: 'mobile.inventory_type.create', entityType: 'equipmentType', entityId: String(row.id), details: JSON.stringify({ actor: req.mobileUser.username, after: value }) } });
      return value;
    }));
    res.status(201).json(result);
  }));

  async function mutateType(req, remove = false) {
    const id = positiveId(req.params.id);
    const expectedVersion = String(req.headers['if-match'] || '');
    if (!/^[a-f0-9]{64}$/.test(expectedVersion)) fail('Falta la version del tipo.');
    const data = remove ? null : typeData(req.body, true);
    return prisma.$transaction(tx => mutation(tx, req, { module: 'inventory-type', operation: remove ? 'delete' : 'update', id, data, expectedVersion }, async () => {
      const current = await tx.equipmentType.findUnique({ where: { id }, include: { _count: { select: { equipment: true, purchaseItems: true } } } });
      if (!current) fail('Tipo no encontrado.', 404, 'NOT_FOUND');
      if (typeVersion(current) !== expectedVersion) fail('El tipo cambio. Actualiza antes de guardar.', 409, 'STALE_INVENTORY_TYPE');
      if (remove) {
        if (current._count.equipment || current._count.purchaseItems) fail('El tipo tiene equipos o compras y debe conservarse.', 409, 'TYPE_IN_USE');
        await tx.equipmentType.delete({ where: { id } });
        await tx.activity.create({ data: { action: 'mobile.inventory_type.delete', entityType: 'equipmentType', entityId: String(id), details: JSON.stringify({ actor: req.mobileUser.username, before: presentType(current) }) } });
        return { success: true, id };
      }
      if (data.name && data.name !== current.name && await tx.equipmentType.findFirst({ where: { name: data.name } })) fail('Ya existe un tipo con ese nombre.', 409, 'DUPLICATE_TYPE');
      const row = await tx.equipmentType.update({ where: { id }, data });
      const value = presentType(row);
      await tx.activity.create({ data: { action: 'mobile.inventory_type.update', entityType: 'equipmentType', entityId: String(id), details: JSON.stringify({ actor: req.mobileUser.username, before: presentType(current), after: value }) } });
      return value;
    }));
  }
  router.patch('/inventory/types/:id', permission([]), wrap(async (req, res) => res.json(await mutateType(req))));
  router.delete('/inventory/types/:id', permission([]), wrap(async (req, res) => res.json(await mutateType(req, true))));

  router.get('/inventory/purchases', permission([]), wrap(async (req, res) => {
    const where = searchWhere(req.query, ['supplier', 'invoiceRef', 'notes'], 'id');
    if (req.query.from || req.query.to) {
      const from = req.query.from ? strictDate(req.query.from, 'Fecha inicial') : null;
      const to = req.query.to ? strictDate(req.query.to, 'Fecha final') : null;
      if (from && to && from > to) fail('Rango de fechas invertido.');
      where.purchasedAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86400000) } : {}) };
    }
    const { page, pageSize, skip, take } = pagination(req.query);
    const [total, rows, sum] = await prisma.$transaction([
      prisma.purchase.count({ where }),
      prisma.purchase.findMany({ where, orderBy: [{ purchasedAt: 'desc' }, { id: 'desc' }], skip, take,
        include: { items: { include: { type: true } }, _count: { select: { equipment: true } } } }),
      prisma.purchase.aggregate({ where, _sum: { total: true } }),
    ]);
    res.json({ items: rows.map(presentPurchase), total, page, pageSize, hasMore: skip + rows.length < total,
      summary: { total: sum._sum.total || 0, count: total }, fetchedAt: new Date() });
  }));

  router.get('/inventory/purchases/:id', permission([]), wrap(async (req, res) => {
    const row = await prisma.purchase.findUnique({ where: { id: positiveId(req.params.id) }, include: {
      items: { include: { type: true } }, expense: true,
      equipment: { include: { type: true, client: { select: { idServicio: true, nombre: true } } } },
    } });
    if (!row) return res.status(404).json({ error: 'Compra no encontrada', code: 'NOT_FOUND' });
    res.json({ ...presentPurchase(row), fetchedAt: new Date() });
  }));

  router.post('/inventory/purchases', permission([]), wrap(async (req, res) => {
    const input = req.body || {};
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) fail('Agrega entre 1 y 100 articulos.');
    const purchasedAt = strictDate(input.purchasedAt, 'Fecha de compra');
    const base = { supplier: text(input.supplier, 'Proveedor', { max: 160 }), invoiceRef: text(input.invoiceRef, 'Comprobante', { max: 120 }),
      purchasedAt, notes: text(input.notes, 'Notas', { max: 2000 }), createEquipment: input.createEquipment !== false };
    const typeIds = [...new Set(input.items.map(item => Number(item?.typeId)))];
    if (typeIds.some(id => !Number.isSafeInteger(id) || id < 1)) fail('Tipo de articulo invalido.');
    const typesFound = await prisma.equipmentType.findMany({ where: { id: { in: typeIds } } });
    if (typesFound.length !== typeIds.length) fail('Uno de los tipos ya no existe.', 409, 'TYPE_NOT_FOUND');
    const typeMap = new Map(typesFound.map(row => [row.id, row]));
    const serialSet = new Set();
    const allSerials = [];
    const items = input.items.map((item, index) => {
      const type = typeMap.get(Number(item.typeId));
      const qty = quantity(item.quantity, `Cantidad del articulo ${index + 1}`, type.unit === 'u');
      const unitPrice = money(item.unitPrice, `Precio del articulo ${index + 1}`);
      const serials = Array.isArray(item.serials) ? item.serials.map((value) => text(value, 'Serial', { max: 160 })).filter(Boolean) : [];
      if (serials.length > qty) fail(`Hay mas seriales que unidades en ${type.name}.`);
      for (const serial of serials) {
        const key = serial.toLowerCase();
        if (serialSet.has(key)) fail(`El serial ${serial} esta repetido.`, 409, 'DUPLICATE_SERIAL');
        serialSet.add(key);
        allSerials.push(serial);
      }
      return { typeId: type.id, quantity: qty, unitPrice, subtotal: Math.round(qty * unitPrice * 100) / 100,
        notes: text(item.notes, 'Notas del articulo', { max: 500 }), serials,
        brand: text(item.brand, 'Marca', { max: 120 }), model: text(item.model, 'Modelo', { max: 120 }), type };
    });
    const total = Math.round(items.reduce((sum, item) => sum + item.subtotal, 0) * 100) / 100;
    const request = { module: 'inventory-purchase', operation: 'create', base: { ...base, purchasedAt: purchasedAt.toISOString() },
      items: items.map(({ type, ...item }) => item), total };
    const result = await prisma.$transaction(tx => mutation(tx, req, request, async () => {
      if (allSerials.length) {
        const duplicate = await tx.equipment.findFirst({ where: { serialNumber: { in: allSerials } } });
        if (duplicate) fail(`El serial ${duplicate.serialNumber} ya existe.`, 409, 'DUPLICATE_SERIAL');
      }
      const purchase = await tx.purchase.create({ data: { supplier: base.supplier, invoiceRef: base.invoiceRef, purchasedAt, total, notes: base.notes,
        createdBy: req.mobileUser.username, items: { create: items.map(item => ({ typeId: item.typeId, quantity: item.quantity, unitPrice: item.unitPrice, subtotal: item.subtotal, notes: item.notes })) } } });
      if (base.createEquipment) {
        for (const item of items.filter(item => item.type.unit === 'u')) {
          for (let i = 0; i < item.quantity; i++) await tx.equipment.create({ data: { typeId: item.typeId, serialNumber: item.serials[i] || null,
            brand: item.brand, model: item.model, status: 'stock', purchaseId: purchase.id, unitCost: item.unitPrice } });
        }
      }
      await tx.expense.create({ data: { category: 'inventario', description: `Compra ${base.invoiceRef || ''}${base.supplier ? ` - ${base.supplier}` : ''}`.trim() || 'Compra de inventario',
        amount: total, expenseDate: purchasedAt, purchaseId: purchase.id, createdBy: req.mobileUser.username } });
      const row = await tx.purchase.findUnique({ where: { id: purchase.id }, include: { items: { include: { type: true } }, _count: { select: { equipment: true } } } });
      const value = presentPurchase(row);
      await tx.activity.create({ data: { action: 'mobile.purchase.create', entityType: 'purchase', entityId: String(purchase.id), details: JSON.stringify({ actor: req.mobileUser.username, total, itemCount: items.length, equipmentCount: value.equipmentCount }) } });
      return value;
    }));
    res.status(201).json(result);
  }));

  router.delete('/inventory/purchases/:id', permission([]), wrap(async (req, res) => {
    const id = positiveId(req.params.id);
    const expectedVersion = String(req.headers['if-match'] || '');
    if (!/^[a-f0-9]{64}$/.test(expectedVersion)) fail('Falta la version de la compra.');
    const result = await prisma.$transaction(tx => mutation(tx, req, { module: 'inventory-purchase', operation: 'delete', id, expectedVersion }, async () => {
      const current = await tx.purchase.findUnique({ where: { id }, include: { _count: { select: { equipment: true } } } });
      if (!current) fail('Compra no encontrada.', 404, 'NOT_FOUND');
      if (purchaseVersion(current) !== expectedVersion) fail('La compra cambio. Actualiza antes de continuar.', 409, 'STALE_PURCHASE');
      if (current._count.equipment) fail('La compra genero equipos y debe conservarse como procedencia.', 409, 'PURCHASE_HAS_EQUIPMENT');
      await tx.expense.deleteMany({ where: { purchaseId: id } });
      await tx.purchase.delete({ where: { id } });
      await tx.activity.create({ data: { action: 'mobile.purchase.delete', entityType: 'purchase', entityId: String(id), details: JSON.stringify({ actor: req.mobileUser.username, before: presentPurchase(current) }) } });
      return { success: true, id };
    }));
    res.json(result);
  }));
}

module.exports = { registerMobileInventory, categories, units, presentType, presentPurchase };
