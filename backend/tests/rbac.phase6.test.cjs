const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

process.env.JWT_SECRET = 'phase6-rbac-local-test-secret-with-enough-length';
delete process.env.BREVO_API_KEY;
delete process.env.BREVO_SENDER_EMAIL;

let queryHandler = async () => ({ rows: [], rowCount: 0 });
const queries = [];
const fakePool = {
  on() {},
  query(sql, params = []) {
    queries.push({ sql: String(sql), params });
    return queryHandler(String(sql), params);
  },
  async connect() {
    return {
      query(sql, params = []) {
        queries.push({ sql: String(sql), params });
        return queryHandler(String(sql), params);
      },
      release() {}
    };
  }
};

const dbModulePath = require.resolve('../dist/database/db.js');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: { __esModule: true, default: fakePool }
};

const authMiddleware = require('../dist/middlewares/auth.middleware.js');
const authRoutes = require('../dist/routes/auth.routes.js').default;
const rbac = require('../dist/security/rbac.js');

const SECRET = process.env.JWT_SECRET;
const ids = {
  owner: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  admin: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  flagged: 'cccccccc-3333-4333-8333-cccccccccccc',
  reception: 'dddddddd-4444-4444-8444-dddddddddddd',
  professional: 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee',
  mailer: 'ffffffff-6666-4666-8666-ffffffffffff',
  legacy: '11111111-7777-4777-8777-111111111111',
  weird: '22222222-8888-4888-8888-222222222222',
  sidro: '33333333-9999-4999-8999-333333333333',
  owner2: '55555555-bbbb-4bbb-8bbb-555555555555',
  created: '44444444-aaaa-4aaa-8aaa-444444444444'
};

const USERS = {
  [ids.owner]: { id: ids.owner, username: 'propietaria', role: 'owner', active: true, token_version: 3, email: 'owner@example.com', email_verified_at: new Date().toISOString(), business_name: 'Carmita Villegas', tax_rate: 15 },
  [ids.owner2]: { id: ids.owner2, username: 'propietaria.dos', role: 'owner', active: true, token_version: 0, business_name: 'Carmita Villegas' },
  [ids.admin]: { id: ids.admin, username: 'administracion', role: 'admin', active: true, token_version: 0, business_name: 'Carmita Villegas' },
  [ids.flagged]: { id: ids.flagged, username: 'temporal', role: 'admin', active: true, token_version: 0, must_change_password: true, email: null, email_verified_at: null },
  [ids.reception]: { id: ids.reception, username: 'recepcion', role: 'reception', active: true, token_version: 1 },
  [ids.professional]: { id: ids.professional, username: 'profesional', role: 'professional', active: true, token_version: 0 },
  [ids.mailer]: { id: ids.mailer, username: 'mailer', role: 'reception', active: true, token_version: 0, email: 'mailer@example.com', email_verified_at: new Date().toISOString() },
  [ids.legacy]: { id: ids.legacy, username: 'colaboradora', role: 'user', active: true, token_version: 0, business_name: 'Carmita Villegas' },
  [ids.weird]: { id: ids.weird, username: 'raro', role: 'superadmin', active: true, token_version: 0 },
  [ids.sidro]: { id: ids.sidro, username: 'sidro_cliente', role: 'sidro_client', active: true }
};

let currentPasswordHash = null;
const loginPasswords = {
  [ids.admin]: 'clave-administracion-123',
  [ids.legacy]: 'clave-colaboradora-123',
  [ids.flagged]: 'clave-temporal-123'
};

let activeOwnerCount = 1;
let employeeExists = true;
let linkedUserId = null;
let resetRecord = null;
let resetAccountActive = true;
let createdManagedRow = null;

const managedRow = (user) => ({
  id: user.id,
  username: user.username,
  role: user.role,
  active: user.active,
  employee_id: user.employee_id ?? null,
  email: user.email ?? null,
  email_verified_at: user.email_verified_at ?? null,
  must_change_password: Boolean(user.must_change_password),
  token_version: user.token_version ?? 0,
  last_login_at: user.last_login_at ?? null,
  password_changed_at: user.password_changed_at ?? null,
  employee_name: user.employee_name ?? null,
  created_at: user.created_at ?? new Date(),
  updated_at: user.updated_at ?? new Date()
});

const rowCounted = (count) => ({ rows: [], rowCount: count });

const defaultRespond = async (sql, params) => {
  if (/INSERT INTO api_rate_limit_counters/i.test(sql)) {
    return { rows: [{ hits: 1, reset_at: new Date(Date.now() + 60000), retry_after: 60 }], rowCount: 1 };
  }
  if (/BEGIN|COMMIT|ROLLBACK/i.test(sql)) return { rows: [], rowCount: 0 };

  if (/FROM sidro_client_accounts WHERE id/i.test(sql)) {
    return { rows: [{ id: String(params[0]), is_active: true, token_version: 0 }], rowCount: 1 };
  }

  if (/FROM users u\b/i.test(sql)) {
    if (params.length > 0) {
      const id = String(params[0]);
      if (id === ids.created && createdManagedRow) return { rows: [createdManagedRow], rowCount: 1 };
      const user = USERS[id];
      return user ? { rows: [managedRow(user)], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    const rows = Object.values(USERS).filter((user) => user.role !== 'sidro_client').map(managedRow);
    return { rows, rowCount: rows.length };
  }

  if (/FROM users WHERE lower\(username\) = lower\(\$1\)/i.test(sql)) {
    const username = String(params[0]).toLowerCase();
    const user = Object.values(USERS).find((candidate) => candidate.username === username);
    if (!user) return { rows: [], rowCount: 0 };
    const password = loginPasswords[user.id] || user.passwordHash;
    if (!password) return { rows: [], rowCount: 0 };
    return { rows: [{ ...user, password }], rowCount: 1 };
  }

  if (/SELECT username FROM users WHERE id = \$1 AND active = true/i.test(sql)) {
    const user = USERS[String(params[0])];
    return user ? { rows: [{ username: user.username }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  if (/FROM users\s+WHERE id = \$1\s+LIMIT 1/i.test(sql) || /FROM users WHERE id = \$1 LIMIT 1/i.test(sql)) {
    const user = USERS[String(params[0])];
    if (!user) return { rows: [], rowCount: 0 };
    const { passwordHash, ...rest } = user;
    return { rows: [rest], rowCount: 1 };
  }

  if (/SELECT id,\s*username,\s*role,\s*active FROM users WHERE id\s*=\s*\$1 FOR UPDATE/i.test(sql)) {
    const user = USERS[String(params[0])];
    return user ? { rows: [{ id: user.id, username: user.username, role: user.role, active: user.active }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  if (/SELECT id,\s*username,\s*role,\s*active,\s*email,\s*employee_id FROM users WHERE id\s*=\s*\$1 FOR UPDATE/i.test(sql)) {
    const user = USERS[String(params[0])];
    return user ? { rows: [{ id: user.id, username: user.username, role: user.role, active: user.active, email: user.email ?? null, employee_id: user.employee_id ?? null }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  if (/SELECT id,username,role,email,email_verified_at FROM users WHERE id=\$1 AND active=true/i.test(sql)) {
    const user = USERS[String(params[0])];
    if (!user || !user.active) return { rows: [], rowCount: 0 };
    return { rows: [{ id: user.id, username: user.username, role: user.role, email: user.email ?? null, email_verified_at: user.email_verified_at ?? null }], rowCount: 1 };
  }

  if (/SELECT id,username,password,role,token_version FROM users WHERE id=\$1 AND active=true FOR UPDATE/i.test(sql)) {
    const user = USERS[String(params[0])];
    if (!user || !user.active) return { rows: [], rowCount: 0 };
    return { rows: [{ id: user.id, username: user.username, password: user.passwordHash, role: user.role, token_version: user.token_version ?? 0 }], rowCount: 1 };
  }

  if (/SELECT id,role FROM users WHERE id=\$1/i.test(sql)) {
    const user = USERS[String(params[0])];
    return user ? { rows: [{ id: user.id, role: user.role }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  if (/SELECT COUNT\(\*\)::int AS total/i.test(sql) || /SELECT count\(\*\)::int total/i.test(sql)) {
    return { rows: [{ total: activeOwnerCount }], rowCount: 1 };
  }

  if (/FROM employees WHERE id=\$1 AND active=true/i.test(sql)) {
    return employeeExists ? { rows: [{ id: params[0] }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  if (/FROM users WHERE employee_id=\$1/i.test(sql)) {
    return linkedUserId ? { rows: [{ id: linkedUserId }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  if (/INSERT INTO users\(/i.test(sql)) {
    const user = USERS[ids.created];
    createdManagedRow = managedRow({ ...user, username: String(params[0]), role: String(params[2]), employee_id: params[3] ?? null, email: params[4] ?? null, must_change_password: true });
    return { rows: [{ id: ids.created }], rowCount: 1 };
  }

  if (/INSERT INTO admin_audit_log/i.test(sql)) return rowCounted(1);
  if (/INSERT INTO pos_password_reset_tokens/i.test(sql)) return rowCounted(1);

  if (/SELECT id,user_id FROM pos_password_reset_tokens/i.test(sql)) {
    return resetRecord ? { rows: [{ id: 'reset-1', user_id: resetRecord.userId }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  if (/UPDATE users SET password=\$1,must_change_password=false/i.test(sql)) return rowCounted(resetAccountActive ? 1 : 0);
  if (/UPDATE users SET password=\$1,must_change_password=true/i.test(sql)) return rowCounted(1);
  if (/UPDATE users SET password=\$1,token_version=token_version\+1,\s*must_change_password=false/i.test(sql)) {
    const user = USERS[String(params[1])];
    return { rows: [{ id: user.id, username: user.username, role: user.role, token_version: (user.token_version ?? 0) + 1 }], rowCount: 1 };
  }
  if (/UPDATE users SET token_version=token_version\+1/i.test(sql)) return rowCounted(1);
  if (/UPDATE users SET last_login_at/i.test(sql)) return rowCounted(1);
  if (/UPDATE pos_password_reset_tokens/i.test(sql)) return rowCounted(1);

  if (/UPDATE users\s+SET\s+tax_rate/i.test(sql)) {
    const user = USERS[String(params[5])];
    return { rows: [{ ...managedRow(user), business_name: params[1], business_ruc: params[2], business_address: params[3], business_phone: params[4] }], rowCount: 1 };
  }

  if (/FROM admin_audit_log l/i.test(sql)) return { rows: [], rowCount: 0 };

  return { rows: [], rowCount: 0 };
};

const signPos = (id, extra = {}) => jwt.sign(
  { sub: id, role: USERS[id]?.role || 'professional', identity_type: 'pos_staff', token_version: USERS[id]?.token_version ?? 0, ...extra },
  SECRET,
  { algorithm: 'HS256', issuer: authMiddleware.JWT_ISSUER, audience: authMiddleware.POS_JWT_AUDIENCE, expiresIn: '1h' }
);

const signSidro = (id = ids.sidro) => jwt.sign(
  { sub: id, id, role: 'sidro_client', identity_type: 'sidro_client', token_version: 0 },
  SECRET,
  { algorithm: 'HS256', issuer: authMiddleware.JWT_ISSUER, audience: authMiddleware.SIDRO_JWT_AUDIENCE, expiresIn: '1h' }
);

let server;
let baseUrl;

const api = async (method, route, { token, body } = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: response.status, body: parsed };
};

const auditActions = () => queries
  .filter((entry) => /INSERT INTO admin_audit_log/i.test(entry.sql))
  .map((entry) => entry.params[1]);

test.before(async () => {
  loginPasswords[ids.admin] = await bcrypt.hash(loginPasswords[ids.admin], 4);
  loginPasswords[ids.legacy] = await bcrypt.hash(loginPasswords[ids.legacy], 4);
  loginPasswords[ids.flagged] = await bcrypt.hash(loginPasswords[ids.flagged], 4);
  currentPasswordHash = await bcrypt.hash('actual-pass-1234', 4);
  USERS[ids.flagged].passwordHash = currentPasswordHash;

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server?.close();
});

test.beforeEach(() => {
  queryHandler = defaultRespond;
  queries.length = 0;
  activeOwnerCount = 1;
  employeeExists = true;
  linkedUserId = null;
  resetRecord = null;
  resetAccountActive = true;
  createdManagedRow = null;
});

// ---------------------------------------------------------------------------
// Catálogo RBAC
// ---------------------------------------------------------------------------

test('rbac: roles canónicos y permisos por rol', () => {
  assert.equal(rbac.canonicalRole('user'), 'professional');
  assert.equal(rbac.canonicalRole('OWNER'), 'owner');
  assert.equal(rbac.canonicalRole('superadmin'), null);

  const professional = rbac.permissionsForRole('user');
  assert.ok(professional.includes(rbac.PERMISSIONS.appointmentsReadOwn));
  assert.ok(!professional.includes(rbac.PERMISSIONS.usersRead));
  assert.ok(!professional.includes(rbac.PERMISSIONS.salesCreate));

  const reception = rbac.permissionsForRole('reception');
  assert.ok(reception.includes(rbac.PERMISSIONS.salesCreate));
  assert.ok(!reception.includes(rbac.PERMISSIONS.usersRead));
  assert.ok(!reception.includes(rbac.PERMISSIONS.reportsRead));

  const admin = rbac.permissionsForRole('admin');
  assert.ok(admin.includes(rbac.PERMISSIONS.usersCreate));
  assert.ok(admin.includes(rbac.PERMISSIONS.auditRead));
  assert.ok(!admin.includes(rbac.PERMISSIONS.integrationsManage));
  assert.ok(!admin.includes(rbac.PERMISSIONS.businessSettingsManage));
  assert.ok(!admin.includes(rbac.PERMISSIONS.rolesManage));

  assert.equal(rbac.permissionsForRole('owner').length, Object.keys(rbac.PERMISSIONS).length);
  assert.deepEqual(rbac.permissionsForRole('desconocido'), []);
});

test('rbac: jerarquía de administración y roles asignables', () => {
  assert.equal(rbac.canManageRole('owner', 'owner'), true);
  assert.equal(rbac.canManageRole('owner', 'admin'), true);
  assert.equal(rbac.canManageRole('admin', 'reception'), true);
  assert.equal(rbac.canManageRole('admin', 'professional'), true);
  assert.equal(rbac.canManageRole('admin', 'admin'), false);
  assert.equal(rbac.canManageRole('admin', 'owner'), false);
  assert.equal(rbac.canManageRole('reception', 'professional'), false);
  assert.equal(rbac.canManageRole('professional', 'professional'), false);

  assert.deepEqual(rbac.assignableRoles('owner'), ['owner', 'admin', 'reception', 'professional']);
  assert.deepEqual(rbac.assignableRoles('admin'), ['reception', 'professional']);
  assert.deepEqual(rbac.assignableRoles('reception'), []);
});

// ---------------------------------------------------------------------------
// Frontera POS / SIDRO
// ---------------------------------------------------------------------------

test('un token SIDRO no puede administrar usuarios del POS', async () => {
  const response = await api('GET', '/api/auth/users', { token: signSidro() });
  assert.equal(response.status, 403);
  assert.match(response.body.error, /personal del POS/i);
});

test('un token con audiencia desconocida se rechaza', async () => {
  const forged = jwt.sign(
    { sub: ids.owner, role: 'owner', identity_type: 'pos_staff' },
    SECRET,
    { algorithm: 'HS256', issuer: authMiddleware.JWT_ISSUER, audience: 'otra-app', expiresIn: '1h' }
  );
  const response = await api('GET', '/api/auth/me', { token: forged });
  assert.equal(response.status, 401);
});

test('la versión de token invalida sesiones revocadas', async () => {
  const staleToken = signPos(ids.owner, { token_version: 0 });
  const response = await api('GET', '/api/auth/me', { token: staleToken });
  assert.equal(response.status, 401);
  assert.match(response.body.error, /sesión expiró/i);
});

test('un rol inexistente en base de datos no concede acceso', async () => {
  const response = await api('GET', '/api/auth/me', { token: signPos(ids.weird) });
  assert.equal(response.status, 403);
  assert.match(response.body.error, /rol POS válido/i);
});

// ---------------------------------------------------------------------------
// Mapeo temporal del rol legacy `user`
// ---------------------------------------------------------------------------

test('el rol legacy user opera como profesional sin permisos administrativos', async () => {
  const me = await api('GET', '/api/auth/me', { token: signPos(ids.legacy, { role: 'user' }) });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, 'professional');
  assert.ok(me.body.user.permissions.includes(rbac.PERMISSIONS.appointmentsReadOwn));
  assert.ok(!me.body.user.permissions.includes(rbac.PERMISSIONS.usersRead));

  const users = await api('GET', '/api/auth/users', { token: signPos(ids.legacy, { role: 'user' }) });
  assert.equal(users.status, 403);
  assert.equal(users.body.permission, 'users.read');

  const invoice = await api('PATCH', `/api/auth/users/${ids.reception}/access`, {
    token: signPos(ids.legacy, { role: 'user' }),
    body: { role: 'admin' }
  });
  assert.equal(invoice.status, 403);
});

// ---------------------------------------------------------------------------
// Permisos finos en rutas
// ---------------------------------------------------------------------------

test('recepción no puede leer usuarios ni administrar el negocio', async () => {
  const token = signPos(ids.reception);
  const users = await api('GET', '/api/auth/users', { token });
  assert.equal(users.status, 403);
  assert.equal(users.body.permission, 'users.read');

  const profile = await api('PUT', '/api/auth/profile', { token, body: { business_name: 'Hack' } });
  assert.equal(profile.status, 403);
  assert.equal(profile.body.permission, 'business_settings.manage');
});

test('la propietaria puede actualizar los datos del negocio', async () => {
  const response = await api('PUT', '/api/auth/profile', {
    token: signPos(ids.owner),
    body: { business_name: 'Carmita Villegas', business_ruc: '1790012345001' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.message, 'Perfil actualizado');
  assert.equal(response.body.user.business_ruc, '1790012345001');
});

test('la auditoría solo está disponible para jerarquía administrativa', async () => {
  const owner = await api('GET', '/api/auth/audit', { token: signPos(ids.owner) });
  assert.equal(owner.status, 200);

  const professional = await api('GET', '/api/auth/audit', { token: signPos(ids.professional) });
  assert.equal(professional.status, 403);
  assert.equal(professional.body.permission, 'audit.read');
});

// ---------------------------------------------------------------------------
// Contraseña temporal (must_change_password)
// ---------------------------------------------------------------------------

test('una contraseña temporal bloquea el resto de la API pero permite cambiarla', async () => {
  const token = signPos(ids.flagged);
  const blocked = await api('GET', '/api/auth/users', { token });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');

  const change = await api('POST', '/api/auth/change-password', {
    token,
    body: { current_password: 'actual-pass-1234', new_password: 'nueva-clave-segura-99', confirmation: 'nueva-clave-segura-99' }
  });
  assert.equal(change.status, 200);
  assert.deepEqual(auditActions(), ['OWN_PASSWORD_CHANGED']);
  const decoded = jwt.verify(change.body.token, SECRET, { audience: 'pos' });
  assert.equal(decoded.identity_type, 'pos_staff');
  assert.equal(decoded.role, 'admin');
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

test('el login responde con rol canónico y permisos', async () => {
  const response = await api('POST', '/api/auth/login', {
    body: { username: 'ADMINISTRACION', password: 'clave-administracion-123' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.user.role, 'admin');
  assert.ok(response.body.user.permissions.includes(rbac.PERMISSIONS.usersCreate));
  assert.ok(!response.body.user.permissions.includes(rbac.PERMISSIONS.businessSettingsManage));
  const decoded = jwt.verify(response.body.token, SECRET, { audience: 'pos' });
  assert.equal(decoded.token_version, 0);

  const legacy = await api('POST', '/api/auth/login', {
    body: { username: 'colaboradora', password: 'clave-colaboradora-123' }
  });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.user.role, 'professional');
});

// ---------------------------------------------------------------------------
// Creación de cuentas
// ---------------------------------------------------------------------------

test('un admin no puede crear propietarios ni administradores', async () => {
  for (const role of ['owner', 'admin']) {
    const response = await api('POST', '/api/auth/users', {
      token: signPos(ids.admin),
      body: { username: `intento.${role}`, role }
    });
    assert.equal(response.status, 403);
    assert.match(response.body.error, /No puedes crear/i);
  }
});

test('un admin crea recepción con contraseña temporal de un solo uso', async () => {
  const response = await api('POST', '/api/auth/users', {
    token: signPos(ids.admin),
    body: { username: 'nueva.recepcion', role: 'reception' }
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.user.role, 'reception');
  assert.equal(response.body.user.must_change_password, true);
  assert.ok(typeof response.body.temporary_password === 'string' && response.body.temporary_password.length >= 10);
  assert.ok(auditActions().includes('USER_CREATED'));
  const insert = queries.find((entry) => /INSERT INTO users\(/i.test(entry.sql));
  assert.equal(insert.params[2], 'reception');
});

test('una cuenta profesional exige empleado vinculado', async () => {
  const response = await api('POST', '/api/auth/users', {
    token: signPos(ids.owner),
    body: { username: 'profesional.sin.empleado', role: 'professional' }
  });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /vincularse a un empleado/i);

  const linked = await api('POST', '/api/auth/users', {
    token: signPos(ids.owner),
    body: { username: 'profesional.con.empleado', role: 'professional', employee_id: 7 }
  });
  assert.equal(linked.status, 201);
  const insert = queries.find((entry) => /INSERT INTO users\(/i.test(entry.sql));
  assert.equal(insert.params[3], 7);
});

test('un empleado ya vinculado no puede asociarse a otra cuenta', async () => {
  linkedUserId = ids.professional;
  const response = await api('POST', '/api/auth/users', {
    token: signPos(ids.owner),
    body: { username: 'duplicado.profesional', role: 'professional', employee_id: 7 }
  });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /ya está vinculado/i);
});

// ---------------------------------------------------------------------------
// Edición y jerarquía
// ---------------------------------------------------------------------------

test('el administrador no puede editar cuentas de igual o mayor jerarquía', async () => {
  const response = await api('PATCH', `/api/auth/users/${ids.owner}`, {
    token: signPos(ids.admin),
    body: { active: false }
  });
  assert.equal(response.status, 403);
  assert.match(response.body.error, /jerarquía/i);
});

test('nadie puede modificarse a sí mismo desde administración', async () => {
  const response = await api('PATCH', `/api/auth/users/${ids.owner}`, {
    token: signPos(ids.owner),
    body: { role: 'admin' }
  });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /tu propia cuenta/i);
});

test('el último propietario activo no puede ser degradado', async () => {
  activeOwnerCount = 0;
  const response = await api('PATCH', `/api/auth/users/${ids.owner2}/access`, {
    token: signPos(ids.owner),
    body: { role: 'admin' }
  });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /al menos un propietario activo/i);
});

// ---------------------------------------------------------------------------
// Revocación de sesiones y restablecimiento
// ---------------------------------------------------------------------------

test('el admin revoca sesiones de recepción pero no de la propietaria', async () => {
  const forbidden = await api('POST', `/api/auth/users/${ids.owner}/revoke-sessions`, { token: signPos(ids.admin) });
  assert.equal(forbidden.status, 403);
  assert.match(forbidden.body.error, /revocar sesiones/i);

  queries.length = 0;
  const allowed = await api('POST', `/api/auth/users/${ids.reception}/revoke-sessions`, { token: signPos(ids.admin) });
  assert.equal(allowed.status, 200);
  assert.ok(auditActions().includes('USER_SESSIONS_REVOKED'));
  assert.ok(queries.some((entry) => /UPDATE users SET token_version=token_version\+1/i.test(entry.sql)));
});

test('el restablecimiento por correo exige correo verificado y proveedor configurado', async () => {
  const unverified = await api('POST', `/api/auth/users/${ids.reception}/password-reset`, {
    token: signPos(ids.admin),
    body: { mode: 'email' }
  });
  assert.equal(unverified.status, 409);
  assert.match(unverified.body.error, /correo verificado/i);

  const noProvider = await api('POST', `/api/auth/users/${ids.mailer}/password-reset`, {
    token: signPos(ids.admin),
    body: { mode: 'email' }
  });
  assert.equal(noProvider.status, 503);
  assert.match(noProvider.body.error, /correo transaccional/i);
});

test('el restablecimiento temporal entrega una contraseña de un solo uso auditada', async () => {
  const response = await api('POST', `/api/auth/users/${ids.reception}/password-reset`, {
    token: signPos(ids.admin)
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.delivery, 'temporary');
  assert.ok(response.body.temporary_password.length >= 10);
  assert.ok(auditActions().includes('USER_TEMPORARY_PASSWORD_ISSUED'));
  assert.ok(queries.some((entry) => /must_change_password=true/i.test(entry.sql)));
});

test('el enlace de restablecimiento no aplica sobre cuentas inactivas', async () => {
  const badToken = await api('POST', '/api/auth/password-reset/complete', {
    body: { token: 'no-es-un-token', new_password: 'nueva-clave-segura-99', confirmation: 'nueva-clave-segura-99' }
  });
  assert.equal(badToken.status, 400);

  resetRecord = { userId: ids.reception };
  resetAccountActive = false;
  const inactive = await api('POST', '/api/auth/password-reset/complete', {
    body: { token: 'a'.repeat(64), new_password: 'nueva-clave-segura-99', confirmation: 'nueva-clave-segura-99' }
  });
  assert.equal(inactive.status, 409);
  assert.match(inactive.body.error, /no está activa/i);
  assert.ok(!auditActions().includes('USER_PASSWORD_RESET_COMPLETED'));
});
