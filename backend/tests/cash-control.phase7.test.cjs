const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'phase7-cash-control-test-secret-with-enough-length';

const ids = {
  owner: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  admin: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  reception: 'cccccccc-3333-4333-8333-cccccccccccc',
  professional: 'dddddddd-4444-4444-8444-dddddddddddd',
  inactive: 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee',
  sidro: 'ffffffff-6666-4666-8666-ffffffffffff'
};

const users = {
  [ids.owner]: { id: ids.owner, username: 'owner', role: 'owner', active: true },
  [ids.admin]: { id: ids.admin, username: 'admin', role: 'admin', active: true },
  [ids.reception]: { id: ids.reception, username: 'recepcion', role: 'reception', active: true },
  [ids.professional]: { id: ids.professional, username: 'profesional', role: 'professional', active: true },
  [ids.inactive]: { id: ids.inactive, username: 'inactivo', role: 'owner', active: false }
};

let controlEnabled = true;
let openRegister = null;
const queries = [];
const audits = [];

const query = async (sql, params = []) => {
  const text = String(sql);
  queries.push({ sql: text, params });
  if (/BEGIN|COMMIT|ROLLBACK/i.test(text)) return { rows: [], rowCount: 0 };
  if (/pg_advisory_xact_lock/i.test(text)) return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
  if (/FROM sidro_client_accounts WHERE id/i.test(text)) {
    return { rows: [{ id: params[0], is_active: true, token_version: 0 }], rowCount: 1 };
  }
  if (/FROM users WHERE id = \$1 LIMIT 1/i.test(text)) {
    const user = users[String(params[0])];
    return user ? { rows: [{ ...user, token_version: 0, must_change_password: false, employee_id: null }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/SELECT config_value FROM business_config/i.test(text)) {
    return { rows: [{ config_value: String(controlEnabled) }], rowCount: 1 };
  }
  if (/FROM cash_registers[\s\S]*estado = 'ABIERTA'/i.test(text)) {
    return openRegister ? { rows: [openRegister], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/INSERT INTO business_config/i.test(text)) {
    controlEnabled = String(params[1]).toLowerCase() !== 'false';
    return { rows: [], rowCount: 1 };
  }
  if (/INSERT INTO admin_audit_log/i.test(text)) {
    audits.push({ action: params[1], metadata: JSON.parse(params[3]) });
    return { rows: [], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
};

const fakePool = {
  on() {},
  query,
  async connect() { return { query, release() {} }; }
};

const dbModulePath = require.resolve('../dist/database/db.js');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: { __esModule: true, default: fakePool }
};

const auth = require('../dist/middlewares/auth.middleware.js');
const settingsRoutes = require('../dist/routes/businessSettings.routes.js').default;
const cashControl = require('../dist/services/cashControl.service.js');
const rbac = require('../dist/security/rbac.js');

const root = path.resolve(__dirname, '..');
const source = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = source('cash_control_phase7.sql');
const salesSource = source('src/controllers/sales.controller.ts');
const expensesSource = source('src/controllers/expenses.controller.ts');
const cashSource = source('src/controllers/cashIntegrity.controller.ts');
const financeSource = source('src/services/financialIntegrity.service.ts');
const settingsSource = source('src/controllers/businessSettings.controller.ts');
const routesSource = source('src/routes/businessSettings.routes.ts');

const signPos = (id) => jwt.sign(
  { sub: id, role: users[id]?.role, identity_type: 'pos_staff', token_version: 0 },
  process.env.JWT_SECRET,
  { algorithm: 'HS256', issuer: auth.JWT_ISSUER, audience: auth.POS_JWT_AUDIENCE, expiresIn: '1h' }
);
const signSidro = () => jwt.sign(
  { sub: ids.sidro, role: 'sidro_client', identity_type: 'sidro_client', token_version: 0 },
  process.env.JWT_SECRET,
  { algorithm: 'HS256', issuer: auth.JWT_ISSUER, audience: auth.SIDRO_JWT_AUDIENCE, expiresIn: '1h' }
);

let server;
let baseUrl;
const api = async (method, route, token, body) => {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRoutes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server?.close());
test.beforeEach(() => {
  controlEnabled = true;
  openRegister = null;
  queries.length = 0;
  audits.length = 0;
});

const policyClient = (enabled, open = false) => ({
  async query(sql) {
    const text = String(sql);
    if (/pg_advisory_xact_lock_shared/i.test(text)) return { rows: [{}] };
    if (/business_config/i.test(text)) return { rows: [{ config_value: String(enabled) }] };
    if (/cash_registers/i.test(text)) return { rows: open ? [{ id: 'cash-1' }] : [] };
    return { rows: [] };
  }
});

// Configuración y seguridad
test('01 valor ausente conserva el control activado', async () => {
  const enabled = await cashControl.getCashControlEnabled({ query: async () => ({ rows: [] }) });
  assert.equal(enabled, true);
});
test('02 la migración inserta true por defecto', () => assert.match(migration, /cash_control_enabled[\s\S]*'true'/i));
test('03 la migración es idempotente', () => assert.match(migration, /ON CONFLICT \(config_key\) DO NOTHING/i));
test('04 la propietaria puede leer la configuración', async () => assert.equal((await api('GET', '/api/settings/cash-control', signPos(ids.owner))).status, 200));
test('05 la propietaria puede desactivar sin caja abierta', async () => {
  const response = await api('PUT', '/api/settings/cash-control', signPos(ids.owner), { controlEnabled: false });
  assert.equal(response.status, 200);
  assert.equal(response.body.controlEnabled, false);
});
test('06 recepción no puede modificar la configuración', async () => assert.equal((await api('PUT', '/api/settings/cash-control', signPos(ids.reception), { controlEnabled: false })).status, 403));
test('07 profesional no puede modificar la configuración', async () => assert.equal((await api('PUT', '/api/settings/cash-control', signPos(ids.professional), { controlEnabled: false })).status, 403));
test('08 administrador no recibe el permiso específico', () => assert.equal(rbac.roleHasPermission('admin', rbac.PERMISSIONS.cashSettingsManage), false));
test('09 token SIDRO no puede leer configuración financiera', async () => assert.equal((await api('GET', '/api/settings/cash-control', signSidro())).status, 403));
test('10 petición sin token recibe 401', async () => assert.equal((await api('GET', '/api/settings/cash-control')).status, 401));
test('11 usuario desactivado no puede modificar', async () => assert.equal((await api('PUT', '/api/settings/cash-control', signPos(ids.inactive), { controlEnabled: false })).status, 401));
test('12 payload no booleano se rechaza', async () => assert.equal((await api('PUT', '/api/settings/cash-control', signPos(ids.owner), { controlEnabled: 'false' })).status, 400));
test('13 el estado persiste en lecturas posteriores', async () => {
  await api('PUT', '/api/settings/cash-control', signPos(ids.owner), { controlEnabled: false });
  const response = await api('GET', '/api/settings/cash-control', signPos(ids.owner));
  assert.equal(response.body.controlEnabled, false);
});
test('14 el cambio exitoso genera auditoría', async () => {
  await api('PUT', '/api/settings/cash-control', signPos(ids.owner), { controlEnabled: false });
  assert.deepEqual(audits.map((entry) => entry.action), ['CASH_CONTROL_SETTINGS_UPDATED']);
  assert.equal(audits[0].metadata.result, 'updated');
});

// Política financiera
test('15 control activo rechaza operación sin caja', async () => await assert.rejects(() => cashControl.enforceCashPolicyForFinancialOperation(policyClient(true, false)), /CAJA ESTA CERRADA/i));
test('16 control activo permite operación con caja', async () => assert.equal(await cashControl.enforceCashPolicyForFinancialOperation(policyClient(true, true)), true));
test('17 control desactivado permite venta sin caja', async () => assert.equal(await cashControl.enforceCashPolicyForFinancialOperation(policyClient(false, false)), false));
test('18 venta usa la política compartida', () => assert.match(salesSource, /enforceCashPolicyForFinancialOperation\(client\)/));
test('19 abono usa la política compartida', () => assert.equal((salesSource.match(/enforceCashPolicyForFinancialOperation\(client\)/g) || []).length, 2));
test('20 gasto usa la política compartida', () => assert.match(expensesSource, /enforceCashPolicyForFinancialOperation\(client\)/));
test('21 no se crea una sesión ficticia al omitir el control', () => assert.doesNotMatch(source('src/services/cashControl.service.ts'), /INSERT INTO cash_registers/i));
test('22 las ventas conservan operation_id y usuario responsable', () => {
  assert.match(salesSource, /requireUuid\(operation_id, 'operation_id'\)/);
  assert.match(salesSource, /operation_id, usuario_id/);
});
test('23 los abonos conservan operation_id y usuario responsable', () => {
  assert.match(financeSource, /payment_history WHERE operation_id = \$1/);
  assert.match(financeSource, /operation_id, usuario_id/);
});
test('24 el abono conserva FOR UPDATE', () => assert.match(financeSource, /FROM sales WHERE id = \$1 FOR UPDATE/));
test('25 el sobrepago continúa rechazado', () => assert.match(financeSource, /El abono supera el saldo pendiente/));
test('26 los estados parcial y pagado se conservan', () => assert.match(financeSource, /newBalanceCents === 0 \? 'PAGADO' : 'PARCIAL'/));
test('27 las ventas a crédito conservan PENDIENTE', () => assert.match(salesSource, /initialPaymentCents > 0 \? 'PARCIAL' : 'PENDIENTE'/));

// Cambios de modo y concurrencia
test('28 desactivar con caja abierta se rechaza', async () => {
  openRegister = { id: 'cash-open', fecha_apertura: new Date().toISOString() };
  const response = await api('PUT', '/api/settings/cash-control', signPos(ids.owner), { controlEnabled: false });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /Cierra la caja actual/i);
  assert.equal(controlEnabled, true);
});
test('29 rechazo por caja abierta queda auditado', async () => {
  openRegister = { id: 'cash-open' };
  await api('PUT', '/api/settings/cash-control', signPos(ids.owner), { controlEnabled: false });
  assert.equal(audits[0].metadata.result, 'rejected_open_register');
});
test('30 reactivar el control funciona', async () => {
  controlEnabled = false;
  const response = await api('PUT', '/api/settings/cash-control', signPos(ids.owner), { controlEnabled: true });
  assert.equal(response.status, 200);
  assert.equal(controlEnabled, true);
});
test('31 abrir caja exige control activado', () => assert.match(cashSource, /requireCashControlEnabled\(client\)[\s\S]*cash_register_single_open/));
test('32 cerrar caja exige control activado', () => assert.equal((cashSource.match(/requireCashControlEnabled\(client\)/g) || []).length, 2));
test('33 las operaciones toman bloqueo compartido', () => assert.match(source('src/services/cashControl.service.ts'), /pg_advisory_xact_lock_shared/));
test('34 el cambio de modo toma bloqueo exclusivo', () => assert.match(settingsSource, /lockCashControlExclusive\(client\)/));
test('35 el modo y la escritura se confirman en una sola transacción', () => assert.match(settingsSource, /BEGIN[\s\S]*lockCashControlExclusive[\s\S]*INSERT INTO business_config[\s\S]*COMMIT/));

// Historial, reportes y separación de dominios
test('36 reportes generales no filtran por cash_register_id', () => assert.doesNotMatch(financeSource, /cash_register_id/));
test('37 el cálculo evita doble conteo con NOT EXISTS', () => assert.match(financeSource, /NOT EXISTS \(SELECT 1 FROM payment_history/));
test('38 historial y reporte permanecen como rutas de lectura', () => {
  const routes = source('src/routes/cash.routes.ts');
  assert.match(routes, /router\.get\('\/history'/);
  assert.match(routes, /router\.get\('\/report\/:id'/);
});
test('39 rutas de configuración exigen identidad POS', () => assert.match(routesSource, /verifyToken, requireStaff/));
test('40 SIDRO no recibe rutas de caja ni configuración', () => {
  const sidroRoutes = source('src/routes/sidro.routes.ts');
  assert.doesNotMatch(sidroRoutes, /cash-control|cash_register|business_config/i);
});

