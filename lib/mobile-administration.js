'use strict';

const { createHash, createHmac } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { categories, validateExpense, changeExpense, presentExpense, dateValue } = require('./expense-service');

const payrollStatuses = new Set(['pending', 'paid', 'cancelled']);
const paymentMethods = new Set(['efectivo', 'transferencia', 'cheque']);
const userRoles = new Set(['super_admin', 'admin', 'tecnico', 'cobranza', 'viewer']);
const version = (value) => createHash('sha256').update(JSON.stringify(value, Object.keys(value).sort())).digest('hex');
const employeeVersion = (row) => version(Object.fromEntries([
  'id', 'fullName', 'documentId', 'position', 'email', 'phone', 'baseSalary', 'hiredAt', 'terminatedAt', 'active', 'notes', 'updatedAt',
].map((field) => [field, row[field] ?? null])));
const payrollVersion = (row) => version(Object.fromEntries([
  'id', 'employeeId', 'period', 'periodStart', 'periodEnd', 'baseAmount', 'bonus', 'deductions', 'netAmount', 'paidAt', 'paymentMethod', 'status', 'notes', 'createdBy', 'createdAt',
].map((field) => [field, row[field] ?? null])));
const fail = (message, status = 400, code = 'INVALID_ADMIN_DATA') => {
  throw Object.assign(new Error(message), { status, code });
};

function cleanText(value, label, { required = false, max = 250 } = {}) {
  if (value == null || value === '') {
    if (required) fail(`${label} es requerido.`);
    return null;
  }
  if (typeof value !== 'string') fail(`${label} invalido.`);
  const text = value.trim();
  if (required && !text) fail(`${label} es requerido.`);
  if (text.length > max) fail(`${label} supera ${max} caracteres.`);
  return text || null;
}

function amount(value, label) {
  if (typeof value === 'boolean' || value === '' || value == null) fail(`${label} invalido.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1e9 || Math.round(number * 100) !== number * 100) fail(`${label} invalido.`);
  return number;
}

function employeeData(body, editing = false) {
  const input = body || {};
  const result = {};
  const textFields = [
    ['fullName', 'Nombre', 160], ['documentId', 'Documento', 80], ['position', 'Cargo', 120],
    ['email', 'Correo', 180], ['phone', 'Telefono', 60], ['notes', 'Notas', 2000],
  ];
  for (const [field, label, max] of textFields) {
    if (!editing || Object.hasOwn(input, field)) result[field] = cleanText(input[field], label, { required: field === 'fullName' && !editing, max });
  }
  if (Object.hasOwn(input, 'fullName') && !result.fullName) fail('Nombre es requerido.');
  if (!editing || Object.hasOwn(input, 'baseSalary')) result.baseSalary = amount(input.baseSalary ?? 0, 'Salario base');
  for (const field of ['hiredAt', 'terminatedAt']) {
    if (Object.hasOwn(input, field)) result[field] = input[field] ? dateValue(input[field]) : null;
  }
  if (Object.hasOwn(input, 'active')) {
    if (typeof input.active !== 'boolean') fail('Estado de empleado invalido.');
    result.active = input.active;
  }
  if (editing && !Object.keys(result).length) fail('No hay cambios para guardar.');
  return result;
}

function presentEmployee(row) {
  return { ...row, version: employeeVersion(row) };
}

function payrollData(body) {
  const input = body || {};
  const employeeId = Number(input.employeeId);
  if (!Number.isSafeInteger(employeeId) || employeeId < 1) fail('Empleado invalido.');
  const period = cleanText(input.period, 'Periodo', { required: true, max: 80 });
  const periodStart = dateValue(input.periodStart);
  const periodEnd = dateValue(input.periodEnd);
  if (periodStart > periodEnd) fail('El periodo de nomina esta invertido.');
  const baseAmount = amount(input.baseAmount, 'Monto base');
  const bonus = amount(input.bonus ?? 0, 'Bono');
  const deductions = amount(input.deductions ?? 0, 'Deducciones');
  const netAmount = baseAmount + bonus - deductions;
  if (netAmount < 0) fail('El neto de nomina no puede ser negativo.');
  const status = String(input.status || 'pending');
  if (!payrollStatuses.has(status)) fail('Estado de nomina invalido.');
  const paidAt = input.paidAt ? dateValue(input.paidAt) : null;
  if (status === 'paid' && !paidAt) fail('La fecha de pago es requerida.');
  const paymentMethod = input.paymentMethod ? String(input.paymentMethod) : null;
  if (paymentMethod && !paymentMethods.has(paymentMethod)) fail('Forma de pago invalida.');
  return { employeeId, period, periodStart, periodEnd, baseAmount, bonus, deductions, netAmount, status, paidAt,
    paymentMethod, notes: cleanText(input.notes, 'Notas', { max: 2000 }) };
}

function presentPayroll(row) {
  return { ...row, version: payrollVersion(row) };
}

function presentUser(row) {
  const value = { id: row.id, username: row.username, fullName: row.fullName, email: row.email, role: row.role, isActive: row.isActive,
    lastLoginAt: row.lastLoginAt, lastLoginIp: row.lastLoginIp, createdAt: row.createdAt, passwordChangedAt: row.passwordChangedAt };
  return { ...value, version: version(value) };
}

function userData(body, editing = false) {
  const input = body || {};
  const data = {};
  if (!editing || Object.hasOwn(input, 'fullName')) data.fullName = cleanText(input.fullName, 'Nombre', { max: 160 });
  if (!editing || Object.hasOwn(input, 'email')) {
    data.email = cleanText(input.email, 'Correo', { max: 180 });
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) fail('Correo invalido.');
  }
  if (Object.hasOwn(input, 'role')) {
    if (!userRoles.has(String(input.role))) fail('Rol invalido.');
    data.role = String(input.role);
  }
  if (Object.hasOwn(input, 'isActive')) {
    if (typeof input.isActive !== 'boolean') fail('Estado de usuario invalido.');
    data.isActive = input.isActive;
  }
  return data;
}

function registerMobileAdministration(router, { prisma, wrap, permission, pagination, positiveId, searchWhere }) {
  router.get('/expenses', permission([]), wrap(async (req, res) => {
    const where = searchWhere(req.query, ['description', 'reference'], 'id');
    if (req.query.category) {
      if (!categories.includes(req.query.category)) throw Object.assign(new Error('Categoria invalida'), { status: 400 });
      where.category = req.query.category;
    }
    if (req.query.clientId) where.clientIdServicio = positiveId(req.query.clientId);
    if (req.query.from || req.query.to) {
      const from = req.query.from ? dateValue(req.query.from) : null;
      const to = req.query.to ? dateValue(req.query.to) : null;
      if (from && to && from > to) throw Object.assign(new Error('Rango de fechas invertido'), { status: 400 });
      where.expenseDate = { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86400000) } : {}) };
    }
    const { page, pageSize, skip, take } = pagination(req.query);
    const [total, rows, sum] = await prisma.$transaction([
      prisma.expense.count({ where }),
      prisma.expense.findMany({ where, orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }], skip, take }),
      prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);
    res.json({ items: rows.map(presentExpense), total, page, pageSize, hasMore: skip + rows.length < total,
      summary: { amount: sum._sum.amount || 0, count: total }, categories, fetchedAt: new Date() });
  }));
  router.get('/expenses/:id', permission([]), wrap(async (req, res) => {
    const row = await prisma.expense.findUnique({ where: { id: positiveId(req.params.id) } });
    if (!row) return res.status(404).json({ error: 'Gasto no encontrado' });
    res.json(presentExpense(row));
  }));

  async function mutate(req, remove = false) {
    const id = req.params.id ? positiveId(req.params.id) : null;
    const data = remove ? null : validateExpense(req.body, !!id);
    const requestKey = String(req.headers['idempotency-key'] || '');
    const expectedVersion = String(req.headers['if-match'] || '');
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey) || id && !/^[a-f0-9]{64}$/.test(expectedVersion)) {
      throw Object.assign(new Error('Falta la clave de operacion o la version del gasto.'), { status: 400 });
    }
    const requestHash = createHash('sha256').update(JSON.stringify({ operation: 'expense', id, data, remove, expectedVersion })).digest('hex');
    const key = { userId: req.mobileUser.id, requestKey };
    return prisma.$transaction(async (tx) => {
      const existing = await tx.mobileMutation.findUnique({ where: { userId_requestKey: key } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw Object.assign(new Error('Clave de operacion reutilizada con otros datos.'), { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
        return JSON.parse(existing.resultJson);
      }
      const result = await changeExpense(tx, { id, data, remove, expectedVersion, actor: req.mobileUser.username });
      await tx.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(result) } });
      return result;
    });
  }
  router.post('/expenses', permission([]), wrap(async (req, res) => res.status(201).json(await mutate(req))));
  router.patch('/expenses/:id', permission([]), wrap(async (req, res) => res.json(await mutate(req))));
  router.delete('/expenses/:id', permission([]), wrap(async (req, res) => res.json(await mutate(req, true))));

  async function once(req, operation, payload, execute) {
    const requestKey = String(req.headers['idempotency-key'] || '');
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey)) fail('Falta la clave de operacion.');
    const requestHash = createHash('sha256').update(JSON.stringify({ operation, payload })).digest('hex');
    const key = { userId: req.mobileUser.id, requestKey };
    return prisma.$transaction(async (tx) => {
      const existing = await tx.mobileMutation.findUnique({ where: { userId_requestKey: key } });
      if (existing) {
        if (existing.requestHash !== requestHash) fail('Clave de operacion reutilizada con otros datos.', 409, 'IDEMPOTENCY_CONFLICT');
        return JSON.parse(existing.resultJson);
      }
      const result = await execute(tx);
      await tx.mobileMutation.create({ data: { ...key, requestHash, resultJson: JSON.stringify(result) } });
      return result;
    });
  }

  function expectedVersion(req, label) {
    const value = String(req.headers['if-match'] || '');
    if (!/^[a-f0-9]{64}$/.test(value)) fail(`Falta la version de ${label}.`);
    return value;
  }

  function secretProof(req, value) {
    return createHmac('sha256', req.mobileUser.passwordHash).update(String(value)).digest('hex');
  }

  function requireSuperAdmin(req) {
    if (req.mobileUser.role !== 'super_admin') fail('Solo super_admin puede realizar esta accion.', 403, 'FORBIDDEN');
  }

  router.get('/users', permission([]), wrap(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const where = searchWhere(req.query, ['username', 'fullName', 'email'], 'id');
    if (req.query.role) {
      if (!userRoles.has(String(req.query.role))) fail('Filtro de rol invalido.');
      where.role = String(req.query.role);
    }
    if (req.query.active === 'true') where.isActive = true;
    else if (req.query.active === 'false') where.isActive = false;
    else if (req.query.active && req.query.active !== 'all') fail('Filtro de usuario invalido.');
    const [total, rows, active, admins] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, orderBy: [{ isActive: 'desc' }, { username: 'asc' }], skip, take }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isActive: true, role: { in: ['admin', 'super_admin'] } } }),
    ]);
    res.json({ items: rows.map(presentUser), total, page, pageSize, hasMore: skip + rows.length < total,
      summary: { active, admins }, roles: [...userRoles], fetchedAt: new Date() });
  }));

  router.get('/users/:id', permission([]), wrap(async (req, res) => {
    const row = await prisma.user.findUnique({ where: { id: positiveId(req.params.id) } });
    if (!row) return res.status(404).json({ error: 'Usuario no encontrado', code: 'USER_NOT_FOUND' });
    res.json(presentUser(row));
  }));

  router.post('/users', permission([]), wrap(async (req, res) => {
    requireSuperAdmin(req);
    const username = cleanText(req.body?.username, 'Usuario', { required: true, max: 80 });
    if (!/^[A-Za-z0-9._-]{3,80}$/.test(username)) fail('Usuario invalido. Usa letras, numeros, punto, guion o guion bajo.');
    const password = String(req.body?.password || '');
    if (password.length < 8 || password.length > 200) fail('La clave debe tener entre 8 y 200 caracteres.');
    const data = userData(req.body);
    const payload = { username, data, passwordProof: secretProof(req, password) };
    const result = await once(req, 'user.create', payload, async (tx) => {
      const row = await tx.user.create({ data: { username, ...data, role: data.role || 'admin', passwordHash: await bcrypt.hash(password, 10), passwordChangedAt: new Date(), createdById: req.mobileUser.id } });
      await tx.activity.create({ data: { action: 'mobile.user.create', entityType: 'user', entityId: String(row.id), details: JSON.stringify({ actor: req.mobileUser.username, role: row.role }) } });
      return presentUser(row);
    });
    res.status(201).json(result);
  }));

  router.patch('/users/:id', permission([]), wrap(async (req, res) => {
    const id = positiveId(req.params.id), expected = expectedVersion(req, 'usuario'), data = userData(req.body, true);
    if (!Object.keys(data).length) fail('No hay cambios para guardar.');
    if (Object.hasOwn(data, 'role') && req.mobileUser.role !== 'super_admin') fail('Solo super_admin puede cambiar roles.', 403, 'FORBIDDEN');
    if (id === req.mobileUser.id && data.isActive === false) fail('No puedes desactivar tu propia cuenta.', 409, 'SELF_DEACTIVATION');
    const result = await once(req, 'user.update', { id, expected, data }, async (tx) => {
      const old = await tx.user.findUnique({ where: { id } });
      if (!old) fail('Usuario no encontrado.', 404, 'USER_NOT_FOUND');
      if (presentUser(old).version !== expected) fail('El usuario cambio. Actualiza antes de guardar.', 409, 'STALE_USER');
      if (old.role === 'super_admin' && req.mobileUser.role !== 'super_admin') fail('Solo super_admin puede modificar esa cuenta.', 403, 'FORBIDDEN');
      if (old.role === 'super_admin' && (data.role && data.role !== 'super_admin' || data.isActive === false)) {
        const remaining = await tx.user.count({ where: { role: 'super_admin', isActive: true, id: { not: id } } });
        if (!remaining) fail('Debe quedar al menos un super_admin activo.', 409, 'LAST_SUPER_ADMIN');
      }
      const row = await tx.user.update({ where: { id }, data });
      if (data.isActive === false) await tx.mobileSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.activity.create({ data: { action: 'mobile.user.update', entityType: 'user', entityId: String(id), details: JSON.stringify({ actor: req.mobileUser.username, role: row.role, active: row.isActive }) } });
      return presentUser(row);
    });
    res.json(result);
  }));

  router.post('/users/:id/password', permission([]), wrap(async (req, res) => {
    const id = positiveId(req.params.id), expected = expectedVersion(req, 'usuario');
    const password = String(req.body?.newPassword || '');
    const currentPassword = String(req.body?.currentPassword || '');
    if (password.length < 8 || password.length > 200) fail('La nueva clave debe tener entre 8 y 200 caracteres.');
    if (id !== req.mobileUser.id && req.mobileUser.role !== 'super_admin') fail('Solo puedes cambiar tu propia clave.', 403, 'FORBIDDEN');
    const payload = { id, expected, passwordProof: secretProof(req, password), currentProof: currentPassword ? secretProof(req, currentPassword) : null };
    res.json(await once(req, 'user.password', payload, async (tx) => {
      const old = await tx.user.findUnique({ where: { id } });
      if (!old) fail('Usuario no encontrado.', 404, 'USER_NOT_FOUND');
      if (presentUser(old).version !== expected) fail('El usuario cambio. Actualiza antes de cambiar la clave.', 409, 'STALE_USER');
      if (id === req.mobileUser.id && req.mobileUser.role !== 'super_admin' && !await bcrypt.compare(currentPassword, old.passwordHash)) fail('La clave actual es incorrecta.', 401, 'CURRENT_PASSWORD_INVALID');
      await tx.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10), passwordChangedAt: new Date() } });
      await tx.mobileSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.activity.create({ data: { action: 'mobile.user.password', entityType: 'user', entityId: String(id), details: JSON.stringify({ actor: req.mobileUser.username }) } });
      return { success: true, id, sessionsRevoked: true };
    }));
  }));

  router.delete('/users/:id', permission([]), wrap(async (req, res) => {
    requireSuperAdmin(req);
    const id = positiveId(req.params.id), expected = expectedVersion(req, 'usuario');
    if (id === req.mobileUser.id) fail('No puedes eliminar tu propia cuenta.', 409, 'SELF_DELETE');
    res.json(await once(req, 'user.delete', { id, expected }, async (tx) => {
      const old = await tx.user.findUnique({ where: { id } });
      if (!old) fail('Usuario no encontrado.', 404, 'USER_NOT_FOUND');
      if (presentUser(old).version !== expected) fail('El usuario cambio. Actualiza antes de eliminar.', 409, 'STALE_USER');
      if (old.role === 'super_admin') {
        const remaining = await tx.user.count({ where: { role: 'super_admin', isActive: true, id: { not: id } } });
        if (!remaining) fail('Debe quedar al menos un super_admin activo.', 409, 'LAST_SUPER_ADMIN');
      }
      await tx.mobileSession.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
      await tx.activity.create({ data: { action: 'mobile.user.delete', entityType: 'user', entityId: String(id), details: JSON.stringify({ actor: req.mobileUser.username, username: old.username }) } });
      return { success: true, id };
    }));
  }));

  router.get('/employees', permission([]), wrap(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const where = searchWhere(req.query, ['fullName', 'documentId', 'position', 'email', 'phone'], 'id');
    if (req.query.active === 'true') where.active = true;
    else if (req.query.active === 'false') where.active = false;
    else if (req.query.active && req.query.active !== 'all') fail('Filtro de empleado invalido.');
    const [total, rows, active, salary] = await prisma.$transaction([
      prisma.employee.count({ where }),
      prisma.employee.findMany({ where, include: { _count: { select: { payroll: true } } }, orderBy: [{ active: 'desc' }, { fullName: 'asc' }], skip, take }),
      prisma.employee.count({ where: { active: true } }),
      prisma.employee.aggregate({ where: { active: true }, _sum: { baseSalary: true } }),
    ]);
    res.json({ items: rows.map(presentEmployee), total, page, pageSize, hasMore: skip + rows.length < total,
      summary: { active, monthlyBase: salary._sum.baseSalary || 0 }, fetchedAt: new Date() });
  }));

  router.get('/employees/:id', permission([]), wrap(async (req, res) => {
    const row = await prisma.employee.findUnique({ where: { id: positiveId(req.params.id) }, include: { _count: { select: { payroll: true } } } });
    if (!row) return res.status(404).json({ error: 'Empleado no encontrado', code: 'EMPLOYEE_NOT_FOUND' });
    res.json(presentEmployee(row));
  }));

  router.post('/employees', permission([]), wrap(async (req, res) => {
    const data = employeeData(req.body);
    const result = await once(req, 'employee.create', data, async (tx) => {
      const row = await tx.employee.create({ data });
      await tx.activity.create({ data: { action: 'mobile.employee.create', entityType: 'employee', entityId: String(row.id), details: JSON.stringify({ actor: req.mobileUser.username }) } });
      return presentEmployee({ ...row, _count: { payroll: 0 } });
    });
    res.status(201).json(result);
  }));

  router.patch('/employees/:id', permission([]), wrap(async (req, res) => {
    const id = positiveId(req.params.id), data = employeeData(req.body, true), expected = expectedVersion(req, 'empleado');
    const result = await once(req, 'employee.update', { id, data, expected }, async (tx) => {
      const old = await tx.employee.findUnique({ where: { id }, include: { _count: { select: { payroll: true } } } });
      if (!old) fail('Empleado no encontrado.', 404, 'EMPLOYEE_NOT_FOUND');
      if (employeeVersion(old) !== expected) fail('El empleado cambio. Actualiza antes de guardar.', 409, 'STALE_EMPLOYEE');
      const row = await tx.employee.update({ where: { id }, data, include: { _count: { select: { payroll: true } } } });
      await tx.activity.create({ data: { action: 'mobile.employee.update', entityType: 'employee', entityId: String(id), details: JSON.stringify({ actor: req.mobileUser.username }) } });
      return presentEmployee(row);
    });
    res.json(result);
  }));

  router.delete('/employees/:id', permission([]), wrap(async (req, res) => {
    const id = positiveId(req.params.id), expected = expectedVersion(req, 'empleado');
    res.json(await once(req, 'employee.delete', { id, expected }, async (tx) => {
      const old = await tx.employee.findUnique({ where: { id }, include: { _count: { select: { payroll: true } } } });
      if (!old) fail('Empleado no encontrado.', 404, 'EMPLOYEE_NOT_FOUND');
      if (employeeVersion(old) !== expected) fail('El empleado cambio. Actualiza antes de continuar.', 409, 'STALE_EMPLOYEE');
      const deactivated = old._count.payroll > 0;
      if (deactivated) await tx.employee.update({ where: { id }, data: { active: false, terminatedAt: old.terminatedAt || new Date() } });
      else await tx.employee.delete({ where: { id } });
      await tx.activity.create({ data: { action: deactivated ? 'mobile.employee.deactivate' : 'mobile.employee.delete', entityType: 'employee', entityId: String(id), details: JSON.stringify({ actor: req.mobileUser.username }) } });
      return { success: true, id, deactivated };
    }));
  }));

  router.get('/payroll', permission([]), wrap(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const where = {};
    if (req.query.employeeId) where.employeeId = positiveId(req.query.employeeId);
    if (req.query.status) {
      if (!payrollStatuses.has(String(req.query.status))) fail('Filtro de nomina invalido.');
      where.status = String(req.query.status);
    }
    if (req.query.period) where.period = { contains: cleanText(req.query.period, 'Periodo', { max: 80 }) };
    const [total, rows, sums] = await prisma.$transaction([
      prisma.payrollEntry.count({ where }),
      prisma.payrollEntry.findMany({ where, include: { employee: { select: { id: true, fullName: true, position: true } } }, orderBy: [{ periodStart: 'desc' }, { id: 'desc' }], skip, take }),
      prisma.payrollEntry.groupBy({ by: ['status'], where, _sum: { netAmount: true }, _count: { _all: true } }),
    ]);
    const summary = Object.fromEntries(sums.map((item) => [item.status, { amount: item._sum.netAmount || 0, count: item._count._all }]));
    res.json({ items: rows.map(presentPayroll), total, page, pageSize, hasMore: skip + rows.length < total, summary, fetchedAt: new Date() });
  }));

  router.get('/payroll/:id', permission([]), wrap(async (req, res) => {
    const row = await prisma.payrollEntry.findUnique({ where: { id: positiveId(req.params.id) }, include: { employee: { select: { id: true, fullName: true, position: true } } } });
    if (!row) return res.status(404).json({ error: 'Registro de nomina no encontrado', code: 'PAYROLL_NOT_FOUND' });
    res.json(presentPayroll(row));
  }));

  router.post('/payroll', permission([]), wrap(async (req, res) => {
    const data = payrollData(req.body);
    const result = await once(req, 'payroll.create', data, async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: data.employeeId } });
      if (!employee?.active) fail('El empleado no existe o esta inactivo.', 409, 'EMPLOYEE_INACTIVE');
      const row = await tx.payrollEntry.create({ data: { ...data, createdBy: req.mobileUser.username }, include: { employee: { select: { id: true, fullName: true, position: true } } } });
      if (row.status === 'paid') await tx.expense.create({ data: { category: 'nomina', description: `Nomina ${employee.fullName} - ${row.period}`, amount: row.netAmount, expenseDate: row.paidAt, payrollId: row.id, paymentMethod: row.paymentMethod, createdBy: req.mobileUser.username } });
      await tx.activity.create({ data: { action: 'mobile.payroll.create', entityType: 'payroll', entityId: String(row.id), details: JSON.stringify({ actor: req.mobileUser.username, status: row.status }) } });
      return presentPayroll(row);
    });
    res.status(201).json(result);
  }));

  router.post('/payroll/:id/pay', permission([]), wrap(async (req, res) => {
    const id = positiveId(req.params.id), expected = expectedVersion(req, 'nomina');
    const paidAt = req.body?.paidAt ? dateValue(req.body.paidAt) : new Date();
    const paymentMethod = String(req.body?.paymentMethod || '');
    if (!paymentMethods.has(paymentMethod)) fail('Forma de pago invalida.');
    res.json(await once(req, 'payroll.pay', { id, expected, paidAt, paymentMethod }, async (tx) => {
      const old = await tx.payrollEntry.findUnique({ where: { id }, include: { employee: { select: { id: true, fullName: true, position: true } } } });
      if (!old) fail('Registro de nomina no encontrado.', 404, 'PAYROLL_NOT_FOUND');
      if (payrollVersion(old) !== expected) fail('La nomina cambio. Actualiza antes de pagar.', 409, 'STALE_PAYROLL');
      if (old.status !== 'pending') fail('Solo una nomina pendiente puede marcarse como pagada.', 409, 'PAYROLL_NOT_PENDING');
      const row = await tx.payrollEntry.update({ where: { id }, data: { status: 'paid', paidAt, paymentMethod }, include: { employee: { select: { id: true, fullName: true, position: true } } } });
      await tx.expense.create({ data: { category: 'nomina', description: `Nomina ${row.employee.fullName} - ${row.period}`, amount: row.netAmount, expenseDate: paidAt, payrollId: row.id, paymentMethod, createdBy: req.mobileUser.username } });
      await tx.activity.create({ data: { action: 'mobile.payroll.pay', entityType: 'payroll', entityId: String(id), details: JSON.stringify({ actor: req.mobileUser.username }) } });
      return presentPayroll(row);
    }));
  }));

  router.delete('/payroll/:id', permission([]), wrap(async (req, res) => {
    const id = positiveId(req.params.id), expected = expectedVersion(req, 'nomina');
    res.json(await once(req, 'payroll.delete', { id, expected }, async (tx) => {
      const old = await tx.payrollEntry.findUnique({ where: { id } });
      if (!old) fail('Registro de nomina no encontrado.', 404, 'PAYROLL_NOT_FOUND');
      if (payrollVersion(old) !== expected) fail('La nomina cambio. Actualiza antes de eliminar.', 409, 'STALE_PAYROLL');
      if (old.status === 'paid') fail('Una nomina pagada se conserva como historial financiero.', 409, 'PAID_PAYROLL_LOCKED');
      await tx.payrollEntry.delete({ where: { id } });
      await tx.activity.create({ data: { action: 'mobile.payroll.delete', entityType: 'payroll', entityId: String(id), details: JSON.stringify({ actor: req.mobileUser.username }) } });
      return { success: true, id };
    }));
  }));
}

module.exports = { registerMobileAdministration };
