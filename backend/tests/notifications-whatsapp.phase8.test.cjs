const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'phase8-notifications-whatsapp-test-secret-long-enough';

const ids = {
  owner: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  admin: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  reception: 'cccccccc-3333-4333-8333-cccccccccccc',
  professional: 'dddddddd-4444-4444-8444-dddddddddddd',
  inactive: 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee',
  sidro: 'ffffffff-6666-4666-8666-ffffffffffff',
  otherSidro: 'ffffffff-7777-4777-8777-ffffffffffff'
};

const EMPLOYEE_UUID = '11111111-2222-4333-8444-555555555555';
const SERVICE_UUID = '99999999-8888-4777-8666-555555555555';

const users = {
  [ids.owner]: { id: ids.owner, username: 'owner', role: 'owner', active: true, employee_id: null },
  [ids.admin]: { id: ids.admin, username: 'admin', role: 'admin', active: true, employee_id: null },
  [ids.reception]: { id: ids.reception, username: 'recepcion', role: 'reception', active: true, employee_id: null },
  [ids.professional]: { id: ids.professional, username: 'profesional', role: 'professional', active: true, employee_id: EMPLOYEE_UUID },
  [ids.inactive]: { id: ids.inactive, username: 'inactivo', role: 'owner', active: false, employee_id: null }
};

const state = {
  config: new Map(),
  notifications: [],
  notificationKeys: new Set(),
  nextNotificationId: 1,
  audits: [],
  queries: [],
  pendingRequest: null,
  linkedClientId: null,
  availableSlots: ['09:00'],
  failNotificationInsert: false,
  createOfficialCalls: 0,
  createdRequests: [],
  listRows: []
};

const resetState = () => {
  state.config.clear();
  state.notifications.length = 0;
  state.notificationKeys.clear();
  state.nextNotificationId = 1;
  state.audits.length = 0;
  state.queries.length = 0;
  state.pendingRequest = null;
  state.linkedClientId = null;
  state.availableSlots = ['09:00'];
  state.failNotificationInsert = false;
  state.createOfficialCalls = 0;
  state.createdRequests.length = 0;
  state.listRows = [];
};

const query = async (sql, params = []) => {
  const text = String(sql).replace(/\s+/g, ' ').trim();
  state.queries.push({ sql: text, params });

  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text)) return { rows: [], rowCount: 0 };

  if (/SELECT nombre_completo FROM sidro_client_accounts WHERE id = \$1/i.test(text)) {
    return { rows: [{ nombre_completo: 'Ana Perez' }], rowCount: 1 };
  }
  if (/SELECT nombre FROM items WHERE id = \$1/i.test(text)) {
    return { rows: [{ nombre: 'Coloracion' }], rowCount: 1 };
  }
  if (/FROM sidro_client_accounts WHERE id = \$1 LIMIT 1/i.test(text)) {
    return { rows: [{ id: params[0], is_active: true, token_version: 0 }], rowCount: 1 };
  }
  if (/FROM users WHERE id = \$1 LIMIT 1/i.test(text)) {
    const user = users[String(params[0])];
    return user
      ? { rows: [{ ...user, token_version: 0, must_change_password: false }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }
  if (/SELECT employee_id FROM users WHERE id = \$1/i.test(text)) {
    const user = users[String(params[0])];
    return user ? { rows: [{ employee_id: user.employee_id }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/SELECT id FROM users WHERE active = true AND lower\(role\) = ANY/i.test(text)) {
    const roles = (params[0] || []).map((role) => String(role).toLowerCase());
    const rows = Object.values(users)
      .filter((user) => user.active && roles.includes(user.role.toLowerCase()))
      .map((user) => ({ id: user.id }));
    return { rows, rowCount: rows.length };
  }
  if (/SELECT id FROM users WHERE active = true AND lower\(role\) = 'professional' AND employee_id = \$1/i.test(text)) {
    const rows = Object.values(users)
      .filter((user) => user.active && user.role === 'professional' && String(user.employee_id) === String(params[0]))
      .map((user) => ({ id: user.id }));
    return { rows, rowCount: rows.length };
  }
  if (/INSERT INTO notifications/i.test(text)) {
    if (state.failNotificationInsert) throw new Error('notification insert failure');
    const recipientType = String(params[0]);
    const recipientId = String(params[1]);
    const dedupeKey = String(params[6]);
    const key = `${recipientType}:${recipientId}:${dedupeKey}`;
    if (state.notificationKeys.has(key)) return { rows: [], rowCount: 0 };
    state.notificationKeys.add(key);
    state.notifications.push({
      id: state.nextNotificationId++,
      recipient_type: recipientType,
      recipient_id: recipientId,
      type: String(params[2]),
      title: String(params[3]),
      body: String(params[4]),
      data: JSON.parse(params[5]),
      dedupe_key: dedupeKey,
      read_at: null,
      created_at: new Date().toISOString()
    });
    return { rows: [], rowCount: 1 };
  }
  if (/count\(\*\)::int AS total/i.test(text)) {
    const mine = state.notifications.filter(
      (item) => item.recipient_type === params[0] && String(item.recipient_id) === String(params[1])
    );
    return {
      rows: [{ total: mine.length, unread: mine.filter((item) => !item.read_at).length }],
      rowCount: 1
    };
  }
  if (/FROM notifications WHERE recipient_type = \$1 AND recipient_id = \$2/i.test(text)) {
    const unreadOnly = /AND read_at IS NULL/i.test(text);
    let items = state.notifications.filter(
      (item) => item.recipient_type === params[0] && String(item.recipient_id) === String(params[1])
    );
    if (unreadOnly) items = items.filter((item) => !item.read_at);
    items = items.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
    const limit = Number(params[2]);
    const offset = Number(params[3]);
    return { rows: items.slice(offset, offset + limit), rowCount: Math.min(limit, items.length) };
  }
  if (/UPDATE notifications SET read_at = NOW\(\)/i.test(text)) {
    const target = state.notifications.find(
      (item) =>
        item.id === Number(params[0]) &&
        item.recipient_type === params[1] &&
        String(item.recipient_id) === String(params[2]) &&
        !item.read_at
    );
    if (!target) return { rows: [], rowCount: 0 };
    target.read_at = new Date().toISOString();
    return { rows: [{ id: target.id, read_at: target.read_at }], rowCount: 1 };
  }
  if (/SELECT id, read_at FROM notifications/i.test(text)) {
    const target = state.notifications.find(
      (item) =>
        item.id === Number(params[0]) &&
        item.recipient_type === params[1] &&
        String(item.recipient_id) === String(params[2])
    );
    return target ? { rows: [{ id: target.id, read_at: target.read_at }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/SELECT config_key, config_value FROM business_config WHERE config_key = ANY/i.test(text)) {
    const keys = params[0] || [];
    const rows = keys
      .filter((key) => state.config.has(key))
      .map((key) => ({ config_key: key, config_value: state.config.get(key) }));
    return { rows, rowCount: rows.length };
  }
  if (/INSERT INTO business_config/i.test(text)) {
    state.config.set(String(params[0]), String(params[1]));
    return { rows: [], rowCount: 1 };
  }
  if (/INSERT INTO admin_audit_log/i.test(text)) {
    state.audits.push({ action: params[1], metadata: JSON.parse(params[3]) });
    return { rows: [], rowCount: 1 };
  }
  if (/SELECT count\(\*\) FROM sidro_appointment_requests/i.test(text)) {
    return { rows: [{ count: '0' }], rowCount: 1 };
  }
  if (/INSERT INTO sidro_appointment_requests/i.test(text)) {
    const row = {
      id: 501,
      sidro_account_id: params[0],
      service_id: params[1],
      employee_id: params[2],
      request_date: params[3],
      start_time: params[4],
      end_time: params[5],
      status: 'PENDIENTE',
      client_notes: params[6] ?? null,
      proposed_date: null,
      proposed_start_time: null,
      proposed_end_time: null
    };
    state.createdRequests.push(row);
    return { rows: [row], rowCount: 1 };
  }
  if (/INSERT INTO sidro_appointment_request_services/i.test(text)) {
    return { rows: [], rowCount: 1 };
  }
  if (/SELECT \* FROM sidro_appointment_requests/i.test(text)) {
    return state.pendingRequest
      ? { rows: [state.pendingRequest], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }
  if (/UPDATE sidro_appointment_requests/i.test(text)) {
    const request = state.pendingRequest;
    if (!request) return { rows: [], rowCount: 0 };
    if (/SET status = 'RECHAZADA'/i.test(text)) request.status = 'RECHAZADA';
    else if (/SET status = 'PROPUESTA'/i.test(text)) {
      request.status = 'PROPUESTA';
      request.proposed_date = params[0];
      request.proposed_start_time = params[1];
      request.proposed_end_time = params[2];
    } else if (/status = 'APROBADA_PENDIENTE_VINCULACION'/i.test(text)) {
      request.status = 'APROBADA_PENDIENTE_VINCULACION';
    } else if (/status = 'CONFIRMADA'/i.test(text)) request.status = 'CONFIRMADA';
    else if (/SET status = 'CANCELADA'/i.test(text)) request.status = 'CANCELADA';
    return { rows: [{ id: request.id }], rowCount: 1 };
  }
  if (/SELECT client_id AS linked_client_id FROM sidro_account_links/i.test(text)) {
    return state.linkedClientId
      ? { rows: [{ linked_client_id: state.linkedClientId }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }
  if (/SELECT client_id FROM sidro_account_links/i.test(text)) {
    return state.linkedClientId
      ? { rows: [{ client_id: state.linkedClientId }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }
  if (/COALESCE\(NULLIF\(TRIM\(s\.telefono/i.test(text)) {
    return { rows: state.listRows, rowCount: state.listRows.length };
  }
  if (/FROM sidro_appointment_requests request /i.test(text)) {
    return { rows: [], rowCount: 0 };
  }
  return { rows: [], rowCount: 0 };
};

const fakePool = {
  on() {},
  query,
  async connect() {
    return { query, release() {} };
  }
};

const dbModulePath = require.resolve('../dist/database/db.js');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: { __esModule: true, default: fakePool }
};

const availability = require('../dist/services/availability.engine.js');
const requestAppointments = require('../dist/services/sidroRequestAppointments.service.js');
availability.AvailabilityEngine.getServicePlan = async () => [
  { service_id: SERVICE_UUID, position: 1, duration_minutes: 60, padding_minutes: 0, total_minutes: 60 }
];
availability.AvailabilityEngine.getAvailableSlotsForServices = async () => state.availableSlots;
requestAppointments.SidroRequestAppointmentsService.createOfficialAppointments = async () => {
  state.createOfficialCalls += 1;
  return ['appointment-1'];
};
requestAppointments.SidroRequestAppointmentsService.validateOfficialAppointments = async () => {};
requestAppointments.SidroRequestAppointmentsService.getSegments = async () => [{ service_id: SERVICE_UUID }];

const auth = require('../dist/middlewares/auth.middleware.js');
const rbac = require('../dist/security/rbac.js');
const settingsRoutes = require('../dist/routes/businessSettings.routes.js').default;
const sidroRoutes = require('../dist/routes/sidro.routes.js').default;
const notificationsRoutes = require('../dist/routes/notifications.routes.js').default;
const adminSidroRoutes = require('../dist/routes/adminSidro.routes.js').default;
const { SidroNotificationTemplates } = require('../dist/services/notificationTemplates.js');

const root = path.resolve(__dirname, '..');
const source = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = source('notifications_phase8.sql');
const templatesSource = source('src/services/notificationTemplates.ts');
const notificationsServiceSource = source('src/services/notifications.service.ts');
const notificationsControllerSource = source('src/controllers/notifications.controller.ts');
const adminSidroSource = source('src/controllers/adminSidro.controller.ts');
const appointmentsSource = source('src/controllers/appointments.controller.ts');
const businessSettingsSource = source('src/controllers/businessSettings.controller.ts');
const indexSource = source('src/index.ts');
const posRoot = path.resolve(root, '..', 'frontend', 'src', 'app');
const sidroRoot = path.resolve(root, '..', '..', 'SIDRO CARMITA VILLEGAS', 'src', 'app');
const posSource = (relative) => fs.readFileSync(path.join(posRoot, relative), 'utf8');
const sidroSourceSafe = (relative) => {
  try {
    return fs.readFileSync(path.join(sidroRoot, relative), 'utf8');
  } catch {
    return '';
  }
};

const signPos = (id) => jwt.sign(
  { sub: id, role: users[id]?.role, identity_type: 'pos_staff', token_version: 0 },
  process.env.JWT_SECRET,
  { algorithm: 'HS256', issuer: auth.JWT_ISSUER, audience: auth.POS_JWT_AUDIENCE, expiresIn: '1h' }
);
const signSidro = (id = ids.sidro) => jwt.sign(
  { sub: id, role: 'sidro_client', identity_type: 'sidro_client', token_version: 0 },
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
  app.use('/api/sidro', sidroRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/admin/sidro', adminSidroRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server?.close());
test.beforeEach(() => {
  state.queries.length = 0;
  state.audits.length = 0;
  state.failNotificationInsert = false;
});

const seedNotification = (recipientType, recipientId, overrides = {}) => {
  const notification = {
    id: state.nextNotificationId++,
    recipient_type: recipientType,
    recipient_id: String(recipientId),
    type: overrides.type || 'seed',
    title: overrides.title || 'Aviso de prueba',
    body: overrides.body || 'Contenido de prueba',
    data: overrides.data || {},
    dedupe_key: overrides.dedupe_key || `seed:${state.nextNotificationId}`,
    read_at: overrides.read_at || null,
    created_at: overrides.created_at || new Date().toISOString()
  };
  state.notifications.push(notification);
  return notification;
};

const setPendingRequest = (overrides = {}) => {
  state.pendingRequest = {
    id: 501,
    sidro_account_id: ids.sidro,
    service_id: SERVICE_UUID,
    employee_id: EMPLOYEE_UUID,
    request_date: '2026-11-05',
    start_time: '09:00:00',
    end_time: '10:00:00',
    status: 'PENDIENTE',
    client_notes: 'Corte y secado completo',
    proposed_date: null,
    proposed_start_time: null,
    proposed_end_time: null,
    ...overrides
  };
};

const createRequestPayload = {
  service_id: SERVICE_UUID,
  employee_id: EMPLOYEE_UUID,
  request_date: '2026-11-05',
  start_time: '09:00',
  client_notes: 'Quiero un corte y secado completo por favor'
};

// WhatsApp oficial (1-6)
test('01 la propietaria configura el numero oficial de WhatsApp', async () => {
  const response = await api('PUT', '/api/settings/whatsapp-contact', signPos(ids.owner), {
    enabled: true,
    whatsapp: '0991234567',
    message: 'Hola, quiero reservar en Carmita Villegas.'
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.whatsapp, '+593991234567');
  assert.equal(response.body.enabled, true);
  assert.equal(response.body.active, true);
  assert.deepEqual(state.audits.map((entry) => entry.action), ['WHATSAPP_CONTACT_SETTINGS_UPDATED']);
});

test('02 sin permiso no se puede modificar el WhatsApp oficial', async () => {
  const payload = { enabled: true, whatsapp: '0991234567', message: 'Intento no autorizado' };
  assert.equal((await api('PUT', '/api/settings/whatsapp-contact', signPos(ids.admin), payload)).status, 403);
  assert.equal((await api('PUT', '/api/settings/whatsapp-contact', signPos(ids.reception), payload)).status, 403);
  assert.equal((await api('PUT', '/api/settings/whatsapp-contact', signPos(ids.professional), payload)).status, 403);
  assert.equal(rbac.roleHasPermission('admin', rbac.PERMISSIONS.businessSettingsManage), false);
  assert.equal(rbac.roleHasPermission('reception', rbac.PERMISSIONS.businessSettingsManage), false);
});

test('03 SIDRO solo obtiene los datos publicos permitidos del WhatsApp', async () => {
  await api('PUT', '/api/settings/whatsapp-contact', signPos(ids.owner), {
    enabled: true,
    whatsapp: '0991234567',
    message: 'Hola, quiero reservar en Carmita Villegas.'
  });
  const publicResponse = await api('GET', '/api/sidro/public/whatsapp');
  assert.equal(publicResponse.status, 200);
  assert.deepEqual(Object.keys(publicResponse.body).sort(), ['enabled', 'message', 'whatsapp']);
  assert.equal(publicResponse.body.whatsapp, '+593991234567');
  assert.equal(
    (await api('GET', '/api/settings/whatsapp-contact', signSidro())).status,
    403
  );
});

test('04 el boton de WhatsApp no aparece sin un numero valido', async () => {
  await api('PUT', '/api/settings/whatsapp-contact', signPos(ids.owner), {
    enabled: true,
    whatsapp: '',
    message: 'Hola'
  });
  const publicResponse = await api('GET', '/api/sidro/public/whatsapp');
  assert.equal(publicResponse.body.enabled, false);
  assert.equal(publicResponse.body.whatsapp, null);

  state.listRows = [
    {
      id: 41,
      client_name: 'Ana Perez',
      client_phone: '+593991112223',
      service_name: 'Coloracion',
      employee_name: 'Carmita',
      status: 'PENDIENTE'
    },
    {
      id: 42,
      client_name: 'Beatriz Ruiz',
      client_phone: null,
      service_name: 'Corte',
      employee_name: 'Carmita',
      status: 'PENDIENTE'
    }
  ];
  const requests = await api('GET', '/api/admin/sidro/requests', signPos(ids.owner));
  assert.equal(requests.status, 200);
  assert.equal(requests.body[1].client_phone_normalized, null);

  const posHtml = posSource('components/sidro-requests/sidro-requests.component.html');
  assert.match(posHtml, /\[disabled\]="!hasWhatsapp\(request\)"/);
  const sidroHtml = sidroSourceSafe('components/my-requests/my-requests.view.html');
  assert.match(sidroHtml, /\*ngIf="salonWhatsappLink"/);
});

test('05 los numeros ecuatorianos se normalizan', () => {
  const identity = require('../dist/services/sidroIdentity.service.js');
  assert.equal(identity.normalizeWhatsapp('0991234567'), '+593991234567');
  assert.equal(identity.normalizeWhatsapp('593991234567'), '+593991234567');
  assert.equal(identity.normalizeWhatsapp('0987654321'), '+593987654321');
});

test('06 los numeros internacionales validos se conservan', () => {
  const identity = require('../dist/services/sidroIdentity.service.js');
  assert.equal(identity.normalizeWhatsapp('+14155552671'), '+14155552671');
  assert.equal(identity.normalizeWhatsapp('12345'), null);
});

// Botones y enlaces (7-12)
test('07 el enlace de WhatsApp apunta al destino correcto', () => {
  const posUtil = posSource('utils/whatsapp-link.ts');
  assert.match(posUtil, /https:\/\/wa\.me\//);
  const sidroUtil = sidroSourceSafe('utils/whatsapp-link.ts');
  assert.match(sidroUtil, /https:\/\/wa\.me\//);
});

test('08 el mensaje del enlace se codifica', () => {
  const posUtil = posSource('utils/whatsapp-link.ts');
  assert.match(posUtil, /encodeURIComponent/);
  const sidroUtil = sidroSourceSafe('utils/whatsapp-link.ts');
  assert.match(sidroUtil, /encodeURIComponent/);
});

test('09 el clic de WhatsApp no modifica el estado de la cita', () => {
  const componentSource = posSource('components/sidro-requests/sidro-requests.component.ts');
  const start = componentSource.indexOf('async openWhatsapp');
  assert.ok(start > -1);
  const end = componentSource.indexOf('async accept');
  const openBlock = componentSource.slice(start, end === -1 ? undefined : end);
  assert.match(openBlock, /window\.open\(link/);
  assert.doesNotMatch(openBlock, /sidroService\./);
  assert.doesNotMatch(openBlock, /\.subscribe\(/);
});

test('10 el POS obtiene el WhatsApp de la clienta correcta', async () => {
  state.listRows = [
    {
      id: 41,
      client_name: 'Ana Perez',
      client_phone: '0991112223',
      service_name: 'Coloracion',
      employee_name: 'Carmita',
      status: 'PENDIENTE'
    },
    {
      id: 42,
      client_name: 'Beatriz Ruiz',
      client_phone: null,
      service_name: 'Corte',
      employee_name: 'Carmita',
      status: 'PENDIENTE'
    }
  ];
  const response = await api('GET', '/api/admin/sidro/requests', signPos(ids.owner));
  assert.equal(response.status, 200);
  assert.equal(response.body[0].client_phone_normalized, '+593991112223');
  assert.equal(response.body[1].client_phone_normalized, null);
  assert.match(adminSidroSource, /COALESCE\(NULLIF\(TRIM\(s\.telefono\), ''\), c\.telefono\)/);
});

test('11 un token SIDRO no puede consultar telefonos privados del POS', async () => {
  assert.equal((await api('GET', '/api/admin/sidro/requests', signSidro())).status, 403);
  const mine = await api('GET', '/api/sidro/requests', signSidro());
  assert.equal(mine.status, 200);
  const listQuery = state.queries.find((entry) => /FROM sidro_appointment_requests request /.test(entry.sql));
  assert.ok(listQuery);
  assert.match(listQuery.sql, /WHERE request\.sidro_account_id = \$1/);
  assert.doesNotMatch(listQuery.sql, /telefono/i);
  assert.equal(String(listQuery.params[0]), ids.sidro);
});

test('12 la configuracion de WhatsApp no altera la vinculacion POS/SIDRO', async () => {
  state.queries.length = 0;
  await api('PUT', '/api/settings/whatsapp-contact', signPos(ids.owner), {
    enabled: true,
    whatsapp: '0991234567',
    message: 'Hola'
  });
  assert.equal(state.queries.some((entry) => /sidro_account_links/i.test(entry.sql)), false);
  assert.doesNotMatch(businessSettingsSource, /sidro_account_links/);
});

// Notificaciones (13-32)
test('13 una solicitud nueva avisa al personal autorizado', async () => {
  await api('PUT', '/api/settings/whatsapp-contact', signPos(ids.owner), {
    enabled: true,
    whatsapp: '0991234567',
    message: 'Hola'
  });
  state.notifications.length = 0;
  state.notificationKeys.clear();
  state.queries.length = 0;

  const response = await api('POST', '/api/sidro/requests', signSidro(), createRequestPayload);
  assert.equal(response.status, 201, JSON.stringify(response.body));

  const created = state.notifications.filter((item) => item.type === 'sidro_request_created');
  assert.equal(created.length, 4);
  const recipients = created.map((item) => item.recipient_id).sort();
  assert.deepEqual(recipients, [ids.admin, ids.owner, ids.professional, ids.reception].sort());
  for (const item of created) {
    assert.equal(item.recipient_type, 'pos_user');
    assert.equal(item.data.url, '/citas/solicitudes?open=501');
    assert.match(item.body, /Ana Perez/);
  }

  const beginIndex = state.queries.findIndex((entry) => /^BEGIN$/i.test(entry.sql));
  const insertIndex = state.queries.findIndex((entry) => /INSERT INTO notifications/i.test(entry.sql));
  const commitIndex = state.queries.findIndex((entry) => /^COMMIT$/i.test(entry.sql));
  assert.ok(beginIndex > -1 && insertIndex > beginIndex && commitIndex > insertIndex);
});

test('14 una solicitud fallida no genera avisos', async () => {
  state.notifications.length = 0;
  state.notificationKeys.clear();
  state.availableSlots = [];
  const response = await api('POST', '/api/sidro/requests', signSidro(), createRequestPayload);
  assert.equal(response.status, 409);
  assert.equal(state.notifications.length, 0);
  state.availableSlots = ['09:00'];
});

test('15 aprobar una solicitud avisa a la clienta', async () => {
  state.notifications.length = 0;
  state.notificationKeys.clear();
  setPendingRequest();
  state.linkedClientId = 'client-9';

  const response = await api('POST', '/api/admin/sidro/requests/501/accept', signPos(ids.owner));
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'CONFIRMADA');

  const clientaNotification = state.notifications.find((item) => item.recipient_type === 'sidro_account');
  assert.ok(clientaNotification);
  assert.equal(clientaNotification.recipient_id, ids.sidro);
  assert.equal(clientaNotification.type, 'sidro_request_confirmed');
  assert.equal(clientaNotification.dedupe_key, 'req:501:status:CONFIRMADA');
});

test('16 rechazar una solicitud avisa a la clienta', async () => {
  state.notifications.length = 0;
  state.notificationKeys.clear();
  setPendingRequest();
  state.linkedClientId = null;

  const response = await api('POST', '/api/admin/sidro/requests/501/reject', signPos(ids.owner));
  assert.equal(response.status, 200);

  const clientaNotification = state.notifications.find((item) => item.recipient_type === 'sidro_account');
  assert.ok(clientaNotification);
  assert.equal(clientaNotification.type, 'sidro_request_rejected');
  assert.equal(clientaNotification.dedupe_key, 'req:501:status:RECHAZADA');
});

test('17 proponer otro horario avisa a la clienta', async () => {
  state.notifications.length = 0;
  state.notificationKeys.clear();
  setPendingRequest();

  const response = await api('POST', '/api/admin/sidro/requests/501/propose', signPos(ids.owner), {
    new_date: '2026-11-07',
    new_time: '10:30'
  });
  assert.equal(response.status, 200);

  const clientaNotification = state.notifications.find((item) => item.recipient_type === 'sidro_account');
  assert.ok(clientaNotification);
  assert.equal(clientaNotification.type, 'sidro_request_proposal');
  assert.match(clientaNotification.body, /07\/11\/2026/);
  assert.match(clientaNotification.body, /10:30/);
});

test('18 confirmar una propuesta avisa al personal', async () => {
  state.notifications.length = 0;
  state.notificationKeys.clear();
  setPendingRequest({
    status: 'PROPUESTA',
    proposed_date: '2026-11-07',
    proposed_start_time: '09:00:00',
    proposed_end_time: '10:00:00'
  });
  state.linkedClientId = 'client-9';

  const response = await api('POST', '/api/sidro/requests/501/accept-proposal', signSidro());
  assert.equal(response.status, 200, JSON.stringify(response.body));

  const staffNotifications = state.notifications.filter((item) => item.type === 'sidro_proposal_accepted');
  assert.equal(staffNotifications.length, 3);
  for (const item of staffNotifications) {
    assert.equal(item.recipient_type, 'pos_user');
    assert.equal(item.dedupe_key, 'req:501:proposal-accepted');
  }
});

test('19 cancelar una cita confirmada avisa a la clienta', () => {
  const updateBlock = appointmentsSource.slice(
    appointmentsSource.indexOf('export const updateAppointment'),
    appointmentsSource.indexOf('export const deleteAppointment')
  );
  assert.match(updateBlock, /loadRelatedSidroRequests\(client, relatedRequestIds\)/);
  assert.match(updateBlock, /reconcileRequests\(client, relatedRequestIds\)/);
  assert.match(updateBlock, /notifyCancelledSidroRequests\(client, relatedSidroSnapshots\)/);
  assert.match(updateBlock, /notifyCancelledSidroRequests[\s\S]*await client\.query\('COMMIT'\)/);

  const deleteBlock = appointmentsSource.slice(appointmentsSource.indexOf('export const deleteAppointment'));
  assert.match(deleteBlock, /notifyCancelledSidroRequests\(client, relatedSidroSnapshots\)/);

  assert.match(templatesSource, /appointmentCancelled/);
  assert.match(templatesSource, /status:CANCELADA/);
});

test('20 una operacion repetida no duplica la notificacion', async () => {
  state.notifications.length = 0;
  state.notificationKeys.clear();

  const first = await api('POST', '/api/sidro/requests', signSidro(), createRequestPayload);
  assert.equal(first.status, 201);
  const afterFirst = state.notifications.filter((item) => item.type === 'sidro_request_created').length;
  assert.equal(afterFirst, 4);

  const second = await api('POST', '/api/sidro/requests', signSidro(), createRequestPayload);
  assert.equal(second.status, 201);
  const afterSecond = state.notifications.filter((item) => item.type === 'sidro_request_created').length;
  assert.equal(afterSecond, afterFirst);
  assert.match(notificationsServiceSource, /ON CONFLICT \(recipient_type, recipient_id, dedupe_key\) DO NOTHING/);
});

test('21 la clienta solo ve sus propias notificaciones', async () => {
  seedNotification('sidro_account', ids.otherSidro, { type: 'ajena' });
  seedNotification('pos_user', ids.owner, { type: 'ajena' });
  const response = await api('GET', '/api/sidro/notifications', signSidro());
  assert.equal(response.status, 200);
  assert.equal(response.body.items.every((item) => item.type !== 'ajena'), true);
  const mine = state.notifications.filter(
    (item) => item.recipient_type === 'sidro_account' && item.recipient_id === ids.sidro
  );
  assert.equal(Number(response.body.total), mine.length);
  assert.equal(response.body.items.every((item) => item.recipient_id === ids.sidro), true);
});

test('22 el empleado solo ve las notificaciones que le corresponden', async () => {
  const response = await api('GET', '/api/notifications', signPos(ids.professional));
  assert.equal(response.status, 200);
  assert.equal(response.body.items.length, 1);
  assert.equal(response.body.items[0].type, 'sidro_request_created');
});

test('23 las notificaciones persisten despues de cerrar sesion', async () => {
  const before = await api('GET', '/api/notifications', signPos(ids.professional));
  const freshToken = signPos(ids.professional);
  const after = await api('GET', '/api/notifications', freshToken);
  assert.deepEqual(
    after.body.items.map((item) => item.id),
    before.body.items.map((item) => item.id)
  );
  assert.ok(after.body.items.length >= 1);
});

test('24 marcar como leida solo modifica el registro autorizado', async () => {
  const professionalList = await api('GET', '/api/notifications', signPos(ids.professional));
  const ownId = professionalList.body.items[0].id;

  const foreign = state.notifications.find((item) => item.recipient_type === 'sidro_account');
  const foreignResponse = await api('POST', `/api/notifications/${foreign.id}/read`, signPos(ids.professional));
  assert.equal(foreignResponse.status, 404);
  const foreignAfter = state.notifications.find((item) => item.id === foreign.id);
  assert.equal(foreignAfter.read_at, null);

  const first = await api('POST', `/api/notifications/${ownId}/read`, signPos(ids.professional));
  assert.equal(first.status, 200);
  assert.equal(first.body.changed, true);
  const second = await api('POST', `/api/notifications/${ownId}/read`, signPos(ids.professional));
  assert.equal(second.status, 200);
  assert.equal(second.body.changed, false);
});

test('25 el contador de notificaciones no leidas es correcto', async () => {
  const response = await api('GET', '/api/notifications', signPos(ids.reception));
  assert.equal(response.status, 200);
  const mine = state.notifications.filter(
    (item) => item.recipient_type === 'pos_user' && item.recipient_id === ids.reception
  );
  assert.equal(Number(response.body.total), mine.length);
  assert.equal(Number(response.body.unread), mine.filter((item) => !item.read_at).length);
});

test('26 la paginacion de notificaciones funciona', async () => {
  for (let index = 0; index < 5; index += 1) {
    seedNotification('sidro_account', ids.otherSidro, {
      type: `pagina-${index}`,
      created_at: new Date(Date.now() + index * 1000).toISOString()
    });
  }
  const mine = state.notifications.filter(
    (item) => item.recipient_type === 'sidro_account' && item.recipient_id === ids.otherSidro
  );
  const response = await api('GET', '/api/sidro/notifications?limit=2&offset=2', signSidro(ids.otherSidro));
  assert.equal(response.status, 200);
  assert.equal(response.body.items.length, 2);
  assert.equal(Number(response.body.total), mine.length);
  assert.ok(mine.length >= 5);
  const capped = await api('GET', '/api/sidro/notifications?limit=999', signSidro(ids.otherSidro));
  assert.equal(Number(capped.body.limit), 50);
});

test('27 el enlace interno abre la seccion correcta', () => {
  assert.match(templatesSource, /\/citas\/solicitudes\?open=/);
  assert.match(templatesSource, /\/my-requests\?open=/);

  const bellSource = posSource('components/notifications-bell/notifications-bell.ts');
  assert.match(bellSource, /navigateByUrl\(url\)/);

  const posRequests = posSource('components/sidro-requests/sidro-requests.component.ts');
  assert.match(posRequests, /queryParamMap\.get\('open'\)/);
  assert.match(posRequests, /scrollIntoView/);
  assert.match(posSource('components/sidro-requests/sidro-requests.component.html'), /highlighted-row/);

  const sidroRequests = sidroSourceSafe('components/my-requests/my-requests.component.ts');
  assert.match(sidroRequests, /queryParamMap\.get\('open'\)/);
  assert.match(sidroSourceSafe('components/my-requests/my-requests.view.html'), /highlighted-request/);
});

test('28 un token expirado o revocado se rechaza', async () => {
  const expired = jwt.sign(
    { sub: ids.owner, role: 'owner', identity_type: 'pos_staff', token_version: 0 },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', issuer: auth.JWT_ISSUER, audience: auth.POS_JWT_AUDIENCE, expiresIn: '-1h' }
  );
  assert.equal((await api('GET', '/api/notifications', expired)).status, 401);
  assert.equal((await api('GET', '/api/notifications', signPos(ids.inactive))).status, 401);
  assert.equal((await api('GET', '/api/sidro/notifications')).status, 401);
});

test('29 un profesional no accede a datos privados ajenos', async () => {
  const response = await api('GET', `/api/notifications?recipient_id=${ids.owner}`, signPos(ids.professional));
  assert.equal(response.status, 200);
  assert.equal(
    response.body.items.every((item) => item.id <= 10_000),
    true
  );
  const mine = state.notifications.filter((item) => item.recipient_id === ids.professional);
  const foreignIds = state.notifications
    .filter((item) => item.recipient_id !== ids.professional)
    .map((item) => item.id);
  assert.equal(
    response.body.items.some((item) => foreignIds.includes(item.id)),
    false
  );
  assert.equal((await api('GET', '/api/sidro/notifications', signPos(ids.professional))).status, 403);
  assert.ok(mine.length >= 1);
});

test('30 la notificacion se revierte si falla la transaccion', async () => {
  state.notifications.length = 0;
  state.notificationKeys.clear();
  state.failNotificationInsert = true;
  const response = await api('POST', '/api/sidro/requests', signSidro(), createRequestPayload);
  assert.equal(response.status, 500);
  assert.equal(state.notifications.length, 0);
  assert.equal(state.queries.some((entry) => /^ROLLBACK$/i.test(entry.sql)), true);
  state.failNotificationInsert = false;
});

test('31 las notificaciones no duplican solicitudes ni citas', async () => {
  state.notifications.length = 0;
  state.notificationKeys.clear();
  setPendingRequest();
  state.linkedClientId = 'client-9';
  const requestsBefore = state.createdRequests.length;
  const callsBefore = state.createOfficialCalls;

  await api('POST', '/api/admin/sidro/requests/501/accept', signPos(ids.owner));

  assert.equal(state.createOfficialCalls, callsBefore + 1);
  assert.equal(state.createdRequests.length, requestsBefore);
  assert.match(migration, /UNIQUE \(recipient_type, recipient_id, dedupe_key\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS notifications/);
  assert.match(indexSource, /app\.use\('\/api\/notifications', notificationsRoutes\)/);
  assert.match(indexSource, /initNotificationsPhase8Table/);
});

test('32 el polling no continua despues de cerrar sesion', () => {
  const posNotificationsService = posSource('services/notifications.service.ts');
  assert.match(posNotificationsService, /stopPolling/);
  assert.match(posNotificationsService, /clearInterval/);
  const bellSource = posSource('components/notifications-bell/notifications-bell.ts');
  assert.match(bellSource, /ngOnDestroy[\s\S]*stopPolling/);
  assert.match(posSource('components/sidenav/sidenav.html'), /app-notifications-bell/);
  const sidroService = sidroSourceSafe('services/notifications.service.ts');
  assert.match(sidroService, /stopPolling/);
  assert.match(sidroService, /clearInterval/);
  const sidroBellSource = sidroSourceSafe('components/notifications-bell/notifications-bell.component.ts');
  assert.match(sidroBellSource, /ngOnDestroy[\s\S]*stopPolling/);
  assert.match(notificationsControllerSource, /recipient_id = \$3/);
});

test('33 la confirmacion presenta correctamente una fecha recibida como Date', () => {
  const dated = SidroNotificationTemplates.requestConfirmed({
    requestId: 501,
    serviceName: 'Manicure',
    date: new Date('2026-10-18T00:00:00.000Z'),
    time: '14:00:00'
  });

  assert.match(dated.body, /18\/10\/2026/);
  assert.match(dated.body, /14:00/);
  assert.doesNotMatch(dated.body, /fecha por confirmar|el fecha/);

  const undated = SidroNotificationTemplates.requestConfirmed({
    requestId: 502,
    serviceName: 'Manicure',
    date: null,
    time: '14:00:00'
  });
  assert.doesNotMatch(undated.body, /el fecha por confirmar/);
});
