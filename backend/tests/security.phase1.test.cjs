const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const argon2 = require('argon2');

process.env.JWT_SECRET = 'phase1-local-test-secret-with-at-least-32-characters';

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
const authController = require('../dist/controllers/auth.controller.js');
const sidroAuthController = require('../dist/controllers/sidroAuth.controller.js');
const cashRoutes = require('../dist/routes/cash.routes.js').default;
const reportsRoutes = require('../dist/routes/reports.routes.js').default;
const salesRoutes = require('../dist/routes/sales.routes.js').default;
const employeesRoutes = require('../dist/routes/employees.routes.js').default;
const appointmentsRoutes = require('../dist/routes/appointments.routes.js').default;
const authRoutes = require('../dist/routes/auth.routes.js').default;
const adminSidroRoutes = require('../dist/routes/adminSidro.routes.js').default;
const sidroRoutes = require('../dist/routes/sidro.routes.js').default;

const SECRET = process.env.JWT_SECRET;
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  user: '22222222-2222-4222-8222-222222222222',
  inactive: '33333333-3333-4333-8333-333333333333',
  sidro: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sidroInactive: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
};

const signPos = (id = ids.user, extra = {}, options = {}) => jwt.sign(
  { sub: id, role: 'user', identity_type: 'pos_staff', ...extra },
  SECRET,
  { algorithm: 'HS256', issuer: authMiddleware.JWT_ISSUER, audience: authMiddleware.POS_JWT_AUDIENCE, expiresIn: '1h', ...options }
);
const signSidro = (id = ids.sidro, extra = {}, options = {}) => jwt.sign(
  { sub: id, id, role: 'sidro_client', identity_type: 'sidro_client', token_version: 0, ...extra },
  SECRET,
  { algorithm: 'HS256', issuer: authMiddleware.JWT_ISSUER, audience: authMiddleware.SIDRO_JWT_AUDIENCE, expiresIn: '1h', ...options }
);

const defaultQueryHandler = async (sql, params) => {
  if (/SELECT employee_id FROM users/i.test(sql)) {
    return { rows: [{ employee_id: 10 }], rowCount: 1 };
  }
  if (/FROM sidro_client_accounts WHERE id/i.test(sql)) {
    const id = String(params[0]);
    if (id === ids.sidro) return { rows: [{ id, is_active: true, token_version: 0 }], rowCount: 1 };
    if (id === ids.sidroInactive) return { rows: [{ id, is_active: false, token_version: 0 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
  if (/FROM users WHERE id/i.test(sql) || /FROM users\s+WHERE id/i.test(sql)) {
    const id = String(params[0]);
    if (id === ids.admin) return { rows: [{ id, username: 'admin', role: 'admin', active: true }], rowCount: 1 };
    if (id === ids.user) return { rows: [{ id, username: 'colaborador', role: 'user', active: true }], rowCount: 1 };
    if (id === ids.inactive) return { rows: [{ id, username: 'inactivo', role: 'user', active: false }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
  if (/FROM sidro_appointment_requests request/i.test(sql)) {
    return { rows: [{ id: 'own-request', sidro_account_id: params[0] }], rowCount: 1 };
  }
  if (/FROM sidro_appointment_requests\s+WHERE id = \$1 AND sidro_account_id = \$2/i.test(sql)) {
    return { rows: [], rowCount: 0 };
  }
  if (/FROM sidro_appointment_requests r/i.test(sql)) {
    return { rows: [{ id: 'employee-request', employee_id: params[0] }], rowCount: 1 };
  }
  if (/FROM sidro_client_accounts a/i.test(sql) && /lower\(a.email\)/i.test(sql)) {
    return { rows: [], rowCount: 0 };
  }
  return { rows: [], rowCount: 0 };
};

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/cash', cashRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/sales', salesRoutes);
  app.use('/api/employees', employeesRoutes);
  app.use('/api/appointments', appointmentsRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/admin/sidro', adminSidroRoutes);
  app.use('/api/sidro', sidroRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test.beforeEach(() => {
  queries.length = 0;
  queryHandler = defaultQueryHandler;
});

const request = (url, token, init = {}) => fetch(`${baseUrl}${url}`, {
  ...init,
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(init.headers || {})
  }
});

const sidroDeniedCases = [
  ['no abre caja', '/api/cash/open', { method: 'POST', body: '{}' }],
  ['no cierra caja', '/api/cash/close/1', { method: 'POST', body: '{}' }],
  ['no consulta arqueos', '/api/cash/details', {}],
  ['no consulta reportes financieros', '/api/reports/expenses', {}],
  ['no crea ventas POS', '/api/sales', { method: 'POST', body: '{}' }],
  ['no registra abonos', '/api/sales/payment', { method: 'POST', body: '{}' }],
  ['no gestiona empleados', '/api/employees', { method: 'POST', body: '{}' }],
  ['no accede a usuarios POS', '/api/auth/users', {}],
  ['no accede a administración SIDRO del POS', '/api/admin/sidro/accounts', {}],
  ['no accede a citas operativas del POS', '/api/appointments', {}]
];

for (const [name, url, init] of sidroDeniedCases) {
  test(`token SIDRO ${name}`, async () => {
    const response = await request(url, signSidro(), init);
    assert.equal(response.status, 403);
  });
}

test('SIDRO consulta únicamente sus solicitudes', async () => {
  const response = await request('/api/sidro/requests', signSidro());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ id: 'own-request', sidro_account_id: ids.sidro }]);
  const ownershipQuery = queries.find((entry) => /WHERE request\.sidro_account_id = \$1/i.test(entry.sql));
  assert.deepEqual(ownershipQuery.params, [ids.sidro]);
});

test('SIDRO no actúa sobre la solicitud de otra cuenta usando un ID manipulado', async () => {
  const response = await request('/api/sidro/requests/other-request/reject-proposal', signSidro(), { method: 'POST', body: '{}' });
  assert.equal(response.status, 403);
  assert.ok(queries.some((entry) => /id = \$1 AND sidro_account_id = \$2/i.test(entry.sql)));
});

test('administrador POS conserva acceso administrativo', async () => {
  const response = await request('/api/auth/users', signPos(ids.admin, { role: 'admin' }));
  assert.equal(response.status, 200);
});

test('usuario POS común conserva acceso permitido', async () => {
  const response = await request('/api/auth/me', signPos(ids.user));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.role, 'professional');
});

test('usuario POS común no ejecuta acciones administrativas', async () => {
  const response = await request('/api/auth/users', signPos(ids.user));
  assert.equal(response.status, 403);
});

test('colaborador solo lista solicitudes de su employee_id', async () => {
  const response = await request('/api/admin/sidro/requests', signPos(ids.user));
  assert.equal(response.status, 200);
  const scopedQuery = queries.find((entry) => /WHERE r\.employee_id = \$1/i.test(entry.sql));
  assert.deepEqual(scopedQuery.params, [10]);
});

test('colaborador no gestiona solicitud de otro profesional', async () => {
  queryHandler = async (sql, params) => {
    if (/SELECT id, username, role, active FROM users/i.test(sql)) return defaultQueryHandler(sql, params);
    if (/SELECT \* FROM sidro_appointment_requests WHERE id/i.test(sql)) {
      return { rows: [{ id: params[0], employee_id: 99, status: 'PENDIENTE', sidro_account_id: ids.sidro }], rowCount: 1 };
    }
    return defaultQueryHandler(sql, params);
  };
  const response = await request('/api/admin/sidro/requests/request-99/accept', signPos(ids.user), { method: 'POST', body: '{}' });
  assert.equal(response.status, 403);
});

test('una cuenta POS no puede hacerse pasar por SIDRO', async () => {
  const response = await request('/api/sidro/requests', signPos(ids.user));
  assert.equal(response.status, 403);
});

test('JWT con firma inválida es rechazado', async () => {
  const token = jwt.sign({ sub: ids.user, identity_type: 'pos_staff' }, 'another-secret-with-more-than-thirty-two-characters');
  assert.equal((await request('/api/auth/me', token)).status, 401);
});

test('JWT expirado es rechazado', async () => {
  const token = signPos(ids.user, {}, { expiresIn: -1 });
  assert.equal((await request('/api/auth/me', token)).status, 401);
});

test('JWT con audiencia y tipo de identidad contradictorios es rechazado', async () => {
  const token = jwt.sign(
    { sub: ids.user, role: 'admin', identity_type: 'sidro_client' },
    SECRET,
    { algorithm: 'HS256', audience: 'pos', expiresIn: '1h' }
  );
  assert.equal((await request('/api/auth/me', token)).status, 401);
});

test('rol manipulado en JWT no sustituye el rol actual de la base', async () => {
  const token = signPos(ids.user, { role: 'admin' });
  assert.equal((await request('/api/auth/users', token)).status, 403);
});

test('cuenta POS desactivada pierde acceso con un token aún vigente', async () => {
  assert.equal((await request('/api/auth/me', signPos(ids.inactive))).status, 401);
});

test('cuenta SIDRO desactivada pierde acceso con un token aún vigente', async () => {
  assert.equal((await request('/api/sidro/requests', signSidro(ids.sidroInactive))).status, 401);
});

test('token SIDRO revocado por token_version es rechazado', async () => {
  assert.equal((await request('/api/sidro/requests', signSidro(ids.sidro, { token_version: 9 }))).status, 401);
});

test('petición protegida sin token es rechazada', async () => {
  assert.equal((await request('/api/cash/status')).status, 401);
});

const mockResponse = () => {
  const state = { status: 200, body: undefined };
  return {
    state,
    status(value) { state.status = value; return this; },
    json(value) { state.body = value; return this; }
  };
};

test('login POS sigue emitiendo identidad POS con audiencia separada', async () => {
  const password = 'Prueba-segura-123';
  const passwordHash = await bcrypt.hash(password, 4);
  queryHandler = async (sql) => /FROM users WHERE lower\(username\)/i.test(sql)
    ? { rows: [{ id: ids.admin, username: 'admin', password: passwordHash, role: 'admin', active: true, token_version: 0, must_change_password: false }], rowCount: 1 }
    : { rows: [], rowCount: 0 };
  const response = mockResponse();
  await authController.login({ body: { username: 'admin', password } }, response);
  assert.equal(response.state.status, 200);
  const decoded = jwt.verify(response.state.body.token, SECRET, { audience: 'pos', algorithms: ['HS256'] });
  assert.equal(decoded.identity_type, 'pos_staff');
});

test('login SIDRO sigue emitiendo identidad SIDRO con audiencia separada', async () => {
  const password = 'Prueba-segura-123';
  const passwordHash = await argon2.hash(password);
  queryHandler = async (sql) => /FROM sidro_client_accounts a/i.test(sql)
    ? { rows: [{ id: ids.sidro, password_hash: passwordHash, is_active: true, token_version: 0, client_id: null }], rowCount: 1 }
    : { rows: [], rowCount: 0 };
  const response = mockResponse();
  await sidroAuthController.login({ body: { email: 'cliente@example.com', password } }, response);
  assert.equal(response.state.status, 200);
  const decoded = jwt.verify(response.state.body.token, SECRET, { audience: 'sidro', algorithms: ['HS256'] });
  assert.equal(decoded.identity_type, 'sidro_client');
});

test('recuperación de contraseña conserva respuesta neutral para correo inexistente', async () => {
  queryHandler = async () => ({ rows: [], rowCount: 0 });
  const response = mockResponse();
  await sidroAuthController.requestPasswordReset({ body: { email: 'no-existe@example.com' } }, response);
  assert.equal(response.state.status, 200);
  assert.match(response.state.body.message, /cuenta SIDRO activa/i);
});

test('el perfil ignora cualquier intento de cambiar el username desde el body', async () => {
  queryHandler = async (sql) => {
    if (/SELECT username FROM users/i.test(sql)) return { rows: [{ username: 'admin' }], rowCount: 1 };
    if (/UPDATE users/i.test(sql)) return { rows: [{ id: ids.admin, username: 'admin', role: 'owner', tax_rate: 0.15 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const response = mockResponse();
  await authController.updateProfile(
    { userId: ids.admin, user: { sub: ids.admin }, body: { username: 'otro-admin', tax_rate: 0.15 } },
    response
  );
  assert.equal(response.state.status, 200);
  const updates = queries.filter((entry) => /UPDATE users/i.test(entry.sql));
  assert.ok(updates.length > 0);
  updates.forEach((entry) => assert.doesNotMatch(entry.sql, /username\s*=/i));
  assert.equal(response.state.body.user.username, 'admin');
});

test('todos los routers operativos exigen requireStaff o requireSidroClient', () => {
  const fs = require('node:fs');
  const routesDir = path.resolve(__dirname, '../src/routes');
  for (const file of ['cash.routes.ts', 'sales.routes.ts', 'employees.routes.ts', 'appointments.routes.ts', 'clients.routes.ts', 'items.routes.ts']) {
    const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
    assert.match(source, /router\.use\(verifyToken, requireStaff\)/, file);
  }
  assert.match(fs.readFileSync(path.join(routesDir, 'sidro.routes.ts'), 'utf8'), /router\.use\(verifyToken, requireSidroClient\)/);
  assert.match(fs.readFileSync(path.join(routesDir, 'adminSidro.routes.ts'), 'utf8'), /router\.use\(verifyToken, requireStaff\)/);
});
