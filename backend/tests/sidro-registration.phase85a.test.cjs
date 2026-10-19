const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');

process.env.JWT_SECRET = 'phase85a-registration-linking-test-secret-long-enough';
process.env.SIDRO_PUBLIC_URL = 'https://sidro.test.local';

const ids = {
  owner: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  admin: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  reception: 'cccccccc-3333-4333-8333-cccccccccccc',
  professional: 'dddddddd-4444-4444-8444-dddddddddddd'
};

const EMPLOYEE_UUID = '11111111-2222-4333-8444-555555555555';
const SERVICE_UUID = '99999999-8888-4777-8666-555555555555';
const LEGACY_ACCOUNT_ID = 'a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1';
const OTHER_ACCOUNT_ID = 'a2a2a2a2-2222-4222-8222-a2a2a2a2a2a2';
const CLIENT_A_ID = 'c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1';
const CLIENT_B_ID = 'c2c2c2c2-2222-4222-8222-c2c2c2c2c2c2';
const CLIENT_LINKED_ID = 'c3c3c3c3-3333-4333-8333-c3c3c3c3c3c3';

const users = {
  [ids.owner]: { id: ids.owner, username: 'owner', role: 'owner', active: true, employee_id: null },
  [ids.admin]: { id: ids.admin, username: 'admin', role: 'admin', active: true, employee_id: null },
  [ids.reception]: { id: ids.reception, username: 'recepcion', role: 'reception', active: true, employee_id: null },
  [ids.professional]: { id: ids.professional, username: 'profesional', role: 'professional', active: true, employee_id: EMPLOYEE_UUID }
};

const state = {
  accounts: [],
  registeredCount: 0,
  links: [],
  nextLink: 1,
  clients: [],
  requests: [],
  notifications: [],
  notificationKeys: new Set(),
  nextNotificationId: 1,
  audits: [],
  events: [],
  rateCounters: new Map(),
  queries: [],
  failAccountInsertCode: null,
  failClientInsertCode: null,
  failProfileUpdateCode: null,
  failNotificationInsert: false,
  createOfficialCalls: 0,
  createOfficialArgs: null,
  createOfficialError: null
};

const resetState = () => {
  state.accounts = [
    {
      id: LEGACY_ACCOUNT_ID,
      nombre_completo: 'Sandra Paredes',
      telefono: '+593988888888',
      email: null,
      documento: null,
      direccion: null,
      password_hash: 'legacy-hash',
      is_active: true,
      token_version: 0,
      email_verified_at: '2026-01-01T00:00:00.000Z',
      pending_email: null,
      email_verification_token_hash: null,
      email_verification_expires_at: null,
      privacy_accepted_at: null
    }
  ];
  state.registeredCount = 0;
  state.links = [];
  state.nextLink = 1;
  state.clients = [];
  state.requests = [];
  state.notifications = [];
  state.notificationKeys.clear();
  state.nextNotificationId = 1;
  state.audits = [];
  state.events = [];
  state.rateCounters.clear();
  state.queries = [];
  state.failAccountInsertCode = null;
  state.failClientInsertCode = null;
  state.failProfileUpdateCode = null;
  state.failNotificationInsert = false;
  state.createOfficialCalls = 0;
  state.createOfficialArgs = null;
  state.createOfficialError = null;
  brevo.configured = true;
  brevo.fail = false;
  brevo.calls.length = 0;
};

const findAccount = (id) => state.accounts.find((account) => String(account.id) === String(id)) || null;
const findLink = (predicate) => state.links.find(predicate) || null;

const digits = (value) => String(value ?? '').replace(/\D/g, '');

const query = async (sql, params = []) => {
  const text = String(sql).replace(/\s+/g, ' ').trim();
  state.queries.push({ sql: text, params });

  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text)) return { rows: [], rowCount: 0 };

  if (/INSERT INTO api_rate_limit_counters/i.test(text)) {
    const key = String(params[0]);
    const hits = (state.rateCounters.get(key) || 0) + 1;
    state.rateCounters.set(key, hits);
    return { rows: [{ hits, reset_at: new Date(Date.now() + 60000).toISOString(), retry_after: 60 }], rowCount: 1 };
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
  if (/FROM sidro_client_accounts WHERE id = \$1 LIMIT 1/i.test(text)) {
    return { rows: [{ id: params[0], is_active: true, token_version: 0 }], rowCount: 1 };
  }
  if (/SELECT id FROM users WHERE active = true AND lower\(role\) = ANY/i.test(text)) {
    const roles = (params[0] || []).map((role) => String(role).toLowerCase());
    const rows = Object.values(users)
      .filter((user) => user.active && roles.includes(user.role.toLowerCase()))
      .map((user) => ({ id: user.id }));
    return { rows, rowCount: rows.length };
  }

  // --- Registro SIDRO ---
  if (/SELECT id FROM sidro_client_accounts WHERE \(email IS NOT NULL AND lower\(email\) = \$1\) OR lower\(pending_email\) = \$1 OR telefono = \$2 OR documento = \$3/i.test(text)) {
    const [email, telefono, documento] = params;
    const match = state.accounts.find((account) => {
      if (email && account.email && account.email.toLowerCase() === String(email).toLowerCase()) return true;
      if (email && account.pending_email && String(account.pending_email).toLowerCase() === String(email).toLowerCase()) return true;
      if (telefono && account.telefono && account.telefono === telefono) return true;
      if (documento && account.documento && account.documento === documento) return true;
      return false;
    });
    return match ? { rows: [{ id: match.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/INSERT INTO sidro_client_accounts \(nombre_completo,telefono,email,documento,direccion,privacy_accepted_at,email_verification_token_hash,email_verification_expires_at,password_hash\)/i.test(text)) {
    if (state.failAccountInsertCode) {
      const code = state.failAccountInsertCode;
      state.failAccountInsertCode = null;
      const error = new Error('duplicate key value violates unique constraint');
      error.code = code;
      throw error;
    }
    state.registeredCount += 1;
    const row = {
      id: `70000000-0000-4000-8000-${String(state.registeredCount).padStart(12, '0')}`,
      nombre_completo: params[0],
      telefono: params[1],
      email: params[2],
      documento: params[3],
      direccion: params[4],
      email_verification_token_hash: params[5],
      email_verification_expires_at: params[6],
      password_hash: params[7],
      is_active: true,
      token_version: 0,
      privacy_accepted_at: new Date().toISOString(),
      email_verified_at: null,
      pending_email: null
    };
    state.accounts.push(row);
    return {
      rows: [{
        id: row.id,
        nombre_completo: row.nombre_completo,
        documento: row.documento,
        telefono: row.telefono,
        email: row.email,
        direccion: row.direccion,
        email_verified_at: row.email_verified_at,
        is_active: row.is_active
      }],
      rowCount: 1
    };
  }
  // --- Verificacion de correo y login SIDRO ---
  if (/SELECT id,nombre_completo,email,pending_email,email_verification_expires_at FROM sidro_client_accounts WHERE email_verification_token_hash=\$1 AND is_active=true FOR UPDATE/i.test(text)) {
    const account = state.accounts.find((item) => item.email_verification_token_hash && item.email_verification_token_hash === params[0]);
    return account
      ? {
          rows: [{
            id: account.id,
            nombre_completo: account.nombre_completo,
            email: account.email,
            pending_email: account.pending_email,
            email_verification_expires_at: account.email_verification_expires_at
          }],
          rowCount: 1
        }
      : { rows: [], rowCount: 0 };
  }
  if (/UPDATE sidro_client_accounts SET email_verified_at=NOW\(\),email_verification_token_hash=NULL/i.test(text)) {
    const account = findAccount(params[0]);
    if (!account) return { rows: [], rowCount: 0 };
    account.email_verified_at = new Date().toISOString();
    account.email_verification_token_hash = null;
    account.email_verification_expires_at = null;
    account.token_version = Number(account.token_version || 0) + 1;
    return { rows: [], rowCount: 1 };
  }
  if (/UPDATE sidro_client_accounts SET email=lower\(pending_email\),email_verified_at=NOW\(\)/i.test(text)) {
    const account = findAccount(params[0]);
    if (!account) return { rows: [], rowCount: 0 };
    account.email = String(account.pending_email || '').toLowerCase() || account.email;
    account.pending_email = null;
    account.email_verified_at = new Date().toISOString();
    account.email_verification_token_hash = null;
    account.email_verification_expires_at = null;
    account.token_version = Number(account.token_version || 0) + 1;
    return { rows: [], rowCount: 1 };
  }
  if (/SELECT a\.id,a\.password_hash,a\.is_active,a\.token_version,a\.email_verified_at,l\.client_id FROM sidro_client_accounts a LEFT JOIN sidro_account_links l ON a\.id=l\.sidro_account_id AND l\.is_active=true WHERE lower\(a\.email\)=\$1 LIMIT 1/i.test(text)) {
    const email = String(params[0]).toLowerCase();
    const account = state.accounts.find((item) => item.email && item.email.toLowerCase() === email) || null;
    if (!account) return { rows: [], rowCount: 0 };
    const link = findLink((item) => String(item.sidro_account_id) === String(account.id) && item.is_active);
    return {
      rows: [{
        id: account.id,
        password_hash: account.password_hash,
        is_active: account.is_active,
        token_version: account.token_version,
        email_verified_at: account.email_verified_at,
        client_id: link ? link.client_id : null
      }],
      rowCount: 1
    };
  }
  if (/WHERE a\.email IS NULL AND regexp_replace\(a\.telefono/i.test(text)) {
    const candidates = Array.isArray(params[0]) ? params[0] : [];
    const account = state.accounts.find((item) => !item.email && candidates.includes(digits(item.telefono))) || null;
    if (!account) return { rows: [], rowCount: 0 };
    return {
      rows: [{
        id: account.id,
        password_hash: account.password_hash,
        is_active: account.is_active,
        token_version: account.token_version,
        client_id: null
      }],
      rowCount: 1
    };
  }

  // --- Completar datos de perfil ---
  if (/SELECT id,documento,direccion FROM sidro_client_accounts WHERE id=\$1 AND is_active=true FOR UPDATE/i.test(text)) {
    const account = findAccount(params[0]);
    return account && account.is_active
      ? { rows: [{ id: account.id, documento: account.documento, direccion: account.direccion }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }
  if (/SELECT id FROM sidro_client_accounts WHERE documento=\$1 AND id<>\$2/i.test(text)) {
    const match = state.accounts.find((account) => account.documento === params[0] && String(account.id) !== String(params[1]));
    return match ? { rows: [{ id: match.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/UPDATE sidro_client_accounts SET documento = COALESCE\(\$1, documento\)/i.test(text)) {
    if (state.failProfileUpdateCode) {
      const code = state.failProfileUpdateCode;
      state.failProfileUpdateCode = null;
      const error = new Error('duplicate key value violates unique constraint');
      error.code = code;
      throw error;
    }
    const account = findAccount(params[2]);
    if (!account) return { rows: [], rowCount: 0 };
    if (params[0]) account.documento = params[0];
    if (params[1]) account.direccion = params[1];
    return {
      rows: [{
        id: account.id,
        nombre_completo: account.nombre_completo,
        documento: account.documento,
        direccion: account.direccion,
        telefono: account.telefono,
        email: account.email
      }],
      rowCount: 1
    };
  }
  if (/INSERT INTO sidro_security_events/i.test(text)) {
    state.events.push({
      account_id: params[0],
      type: params[1],
      outcome: params[2],
      message_id: params[3] ?? null,
      metadata: params[4] ? JSON.parse(params[4]) : null
    });
    return { rows: [], rowCount: 1 };
  }
  if (/SELECT a\.id,a\.nombre_completo,a\.telefono,a\.email,a\.email_verified_at,a\.pending_email,a\.documento,a\.direccion,a\.privacy_accepted_at,l\.client_id,COALESCE\(l\.is_active,false\) AS linked/i.test(text)) {
    const account = findAccount(params[0]);
    if (!account) return { rows: [], rowCount: 0 };
    const activeLink = findLink((link) => String(link.sidro_account_id) === String(account.id) && link.is_active);
    return {
      rows: [{
        id: account.id,
        nombre_completo: account.nombre_completo,
        telefono: account.telefono,
        email: account.email,
        email_verified_at: account.email_verified_at,
        pending_email: account.pending_email,
        documento: account.documento,
        direccion: account.direccion,
        privacy_accepted_at: account.privacy_accepted_at,
        client_id: activeLink ? activeLink.client_id : null,
        linked: Boolean(activeLink)
      }],
      rowCount: 1
    };
  }

  // --- Vinculacion admin ---
  if (/SELECT \* FROM sidro_account_links WHERE client_id = \$1 AND is_active = true AND sidro_account_id != \$2/i.test(text)) {
    const rows = state.links.filter(
      (link) => String(link.client_id) === String(params[0]) && link.is_active && String(link.sidro_account_id) !== String(params[1])
    );
    return { rows, rowCount: rows.length };
  }
  if (/UPDATE sidro_account_links SET is_active = false WHERE sidro_account_id = \$1 OR client_id = \$2/i.test(text)) {
    let updated = 0;
    for (const link of state.links) {
      if (String(link.sidro_account_id) === String(params[0]) || String(link.client_id) === String(params[1])) {
        if (link.is_active) updated += 1;
        link.is_active = false;
      }
    }
    return { rows: [], rowCount: updated };
  }
  if (/INSERT INTO sidro_account_links \(sidro_account_id, client_id, admin_id, is_active\)/i.test(text)) {
    const link = {
      id: `90000000-0000-4000-8000-${String(state.nextLink).padStart(12, '0')}`,
      sidro_account_id: String(params[0]),
      client_id: String(params[1]),
      admin_id: params[2] || null,
      is_active: true
    };
    state.nextLink += 1;
    state.links.push(link);
    return { rows: [{ id: link.id }], rowCount: 1 };
  }
  if (/SELECT \* FROM sidro_appointment_requests WHERE sidro_account_id = \$1 AND status = 'APROBADA_PENDIENTE_VINCULACION' FOR UPDATE/i.test(text)) {
    const rows = state.requests.filter(
      (request) => String(request.sidro_account_id) === String(params[0]) && request.status === 'APROBADA_PENDIENTE_VINCULACION'
    );
    return { rows, rowCount: rows.length };
  }
  if (/SELECT \* FROM sidro_appointment_requests/i.test(text)) {
    return { rows: [], rowCount: 0 };
  }
  if (/UPDATE sidro_appointment_requests SET status = 'CONFIRMADA', official_appointment_id = \$1 WHERE id = \$2/i.test(text)) {
    const request = state.requests.find((item) => Number(item.id) === Number(params[1]));
    if (!request) return { rows: [], rowCount: 0 };
    request.status = 'CONFIRMADA';
    request.official_appointment_id = params[0];
    return { rows: [{ id: request.id }], rowCount: 1 };
  }
  if (/UPDATE sidro_appointment_requests SET status = 'CONFLICTO_VINCULACION' WHERE id = \$1/i.test(text)) {
    const request = state.requests.find((item) => Number(item.id) === Number(params[0]));
    if (!request) return { rows: [], rowCount: 0 };
    request.status = 'CONFLICTO_VINCULACION';
    return { rows: [{ id: request.id }], rowCount: 1 };
  }
  if (/SELECT nombre_completo FROM sidro_client_accounts WHERE id = \$1/i.test(text)) {
    const account = findAccount(params[0]);
    return { rows: [{ nombre_completo: account?.nombre_completo || 'Ana Perez' }], rowCount: 1 };
  }
  if (/SELECT nombre FROM items WHERE id = \$1/i.test(text)) {
    return { rows: [{ nombre: 'Coloracion' }], rowCount: 1 };
  }
  if (/SELECT id, nombre_completo, telefono, email, documento, direccion FROM sidro_client_accounts WHERE id = \$1 AND is_active = true FOR UPDATE/i.test(text)) {
    const account = findAccount(params[0]);
    return account && account.is_active
      ? {
          rows: [{
            id: account.id,
            nombre_completo: account.nombre_completo,
            telefono: account.telefono,
            email: account.email,
            documento: account.documento,
            direccion: account.direccion
          }],
          rowCount: 1
        }
      : { rows: [], rowCount: 0 };
  }
  if (/SELECT id, client_id FROM sidro_account_links WHERE sidro_account_id = \$1 AND is_active = true FOR UPDATE/i.test(text)) {
    const link = findLink((item) => String(item.sidro_account_id) === String(params[0]) && item.is_active);
    return link ? { rows: [{ id: link.id, client_id: link.client_id }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/match_documento/i.test(text)) {
    const [documento, email, phones] = params;
    const phoneList = Array.isArray(phones) ? phones.filter((phone) => phone && phone !== '__none__') : [];
    const rows = state.clients
      .map((client) => {
        const reasons = [];
        if (documento && client.cedula && client.cedula === documento) reasons.push('documento');
        if (email && client.email && client.email.toLowerCase() === String(email).toLowerCase()) reasons.push('correo');
        if (client.telefono && phoneList.includes(digits(client.telefono))) reasons.push('telefono');
        return { client, reasons };
      })
      .filter((entry) => entry.reasons.length > 0)
      .slice(0, 10)
      .map(({ client, reasons }) => {
        const link = findLink((item) => String(item.client_id) === String(client.id) && item.is_active);
        return {
          id: client.id,
          nombre: client.nombre,
          cedula: client.cedula || null,
          telefono: client.telefono || null,
          email: client.email || null,
          direccion: client.direccion || null,
          match_documento: reasons.includes('documento'),
          match_email: reasons.includes('correo'),
          match_telefono: reasons.includes('telefono'),
          linked_sidro_account_id: link ? link.sidro_account_id : null
        };
      });
    return { rows, rowCount: rows.length };
  }
  if (/linked_client_name/i.test(text)) {
    const account = findAccount(params[0]);
    if (!account) return { rows: [], rowCount: 0 };
    const link = findLink((item) => String(item.sidro_account_id) === String(account.id) && item.is_active);
    const client = link ? state.clients.find((item) => String(item.id) === String(link.client_id)) : null;
    return {
      rows: [{
        id: account.id,
        nombre_completo: account.nombre_completo,
        telefono: account.telefono,
        email: account.email,
        documento: account.documento,
        direccion: account.direccion,
        is_active: account.is_active,
        linked_client_id: link ? link.client_id : null,
        linked_client_name: client ? client.nombre : null
      }],
      rowCount: 1
    };
  }
  if (/INSERT INTO clients \(nombre, cedula, telefono, email, direccion\)/i.test(text)) {
    if (state.failClientInsertCode) {
      const code = state.failClientInsertCode;
      state.failClientInsertCode = null;
      const error = new Error('duplicate key value violates unique constraint');
      error.code = code;
      throw error;
    }
    const client = {
      id: `80000000-0000-4000-8000-${String(state.clients.length + 1).padStart(12, '0')}`,
      nombre: params[0],
      cedula: params[1],
      telefono: params[2],
      email: params[3],
      direccion: params[4],
      created_at: new Date().toISOString()
    };
    state.clients.push(client);
    return { rows: [client], rowCount: 1 };
  }

  // --- Notificaciones y auditoria ---
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
  if (/INSERT INTO admin_audit_log/i.test(text)) {
    state.audits.push({ action: params[1], target: params[2], metadata: JSON.parse(params[3]) });
    return { rows: [], rowCount: 1 };
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

const brevo = {
  configured: true,
  fail: false,
  calls: [],
  isConfigured() { return this.configured; },
  async sendEmailVerificationEmail(input) {
    this.calls.push(['verify', input]);
    if (this.fail) throw Object.assign(new Error('mock'), { providerCode: 'MOCK_ERROR' });
    return { messageId: 'brevo-verify-local' };
  },
  async sendEmailChangedNotice(input) {
    this.calls.push(['changed', input]);
    return { messageId: 'brevo-changed-local' };
  }
};
const brevoPath = require.resolve('../dist/services/brevo.service.js');
require.cache[brevoPath] = {
  id: brevoPath,
  filename: brevoPath,
  loaded: true,
  exports: { BrevoService: brevo }
};

const idUtil = require('../dist/utils/ecuadorId.js');
const requestAppointments = require('../dist/services/sidroRequestAppointments.service.js');
requestAppointments.SidroRequestAppointmentsService.getSegments = async () => [{ service_id: SERVICE_UUID }];
requestAppointments.SidroRequestAppointmentsService.validateOfficialAppointments = async () => {};
requestAppointments.SidroRequestAppointmentsService.createOfficialAppointments = async (client, reqData, clientId, dateStr, notePrefix) => {
  state.createOfficialCalls += 1;
  state.createOfficialArgs = { clientId, dateStr, notePrefix, requestId: reqData.id };
  if (state.createOfficialError) throw new Error(state.createOfficialError);
  return ['appointment-77'];
};

const auth = require('../dist/middlewares/auth.middleware.js');
const rbac = require('../dist/security/rbac.js');
const sidroRoutes = require('../dist/routes/sidro.routes.js').default;
const adminSidroRoutes = require('../dist/routes/adminSidro.routes.js').default;

const root = path.resolve(__dirname, '..');
const source = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const posRoot = path.resolve(root, '..', 'frontend', 'src', 'app');
const sidroRoot = path.resolve(root, '..', '..', 'SIDRO CARMITA VILLEGAS', 'src', 'app');
const posSource = (relative) => fs.readFileSync(path.join(posRoot, relative), 'utf8');
const sidroSource = (relative) => fs.readFileSync(path.join(sidroRoot, relative), 'utf8');

const signPos = (id) => jwt.sign(
  { sub: id, role: users[id]?.role, identity_type: 'pos_staff', token_version: 0 },
  process.env.JWT_SECRET,
  { algorithm: 'HS256', issuer: auth.JWT_ISSUER, audience: auth.POS_JWT_AUDIENCE, expiresIn: '1h' }
);
const signSidro = (id = LEGACY_ACCOUNT_ID) => jwt.sign(
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
  app.use('/api/sidro', sidroRoutes);
  app.use('/api/admin/sidro', adminSidroRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server?.close());

test.beforeEach(() => {
  resetState();
});

const registerPayload = (overrides = {}) => ({
  nombre_completo: 'Lucía Mera',
  documento: '1710034065',
  telefono: '0991234567',
  email: 'lucia@example.com',
  direccion: 'Av. Amazonas 123 y Patria',
  password: 'Secreto123!',
  password_confirm: 'Secreto123!',
  privacy_accepted: true,
  ...overrides
});

const GENERIC_DUPLICATE = 'Esos datos ya están asociados a una cuenta SIDRO. Inicia sesión o recupera tu contraseña.';
const GENERIC_DOCUMENT_FAILURE = 'No se pudo guardar el documento indicado. Verifica la información o contacta al salón.';
const BLOCKED_CLIENT_MESSAGE = 'Ya existe un cliente en el POS con la misma cédula o correo. Revisa las coincidencias y vincula al cliente existente.';

const seedPendingRequest = (overrides = {}) => {
  const request = {
    id: 501,
    sidro_account_id: LEGACY_ACCOUNT_ID,
    service_id: SERVICE_UUID,
    employee_id: EMPLOYEE_UUID,
    request_date: '2026-11-05',
    start_time: '09:00:00',
    end_time: '10:00:00',
    status: 'APROBADA_PENDIENTE_VINCULACION',
    client_notes: null,
    proposed_date: null,
    proposed_start_time: null,
    proposed_end_time: null,
    official_appointment_id: null,
    ...overrides
  };
  state.requests.push(request);
  return request;
};

// ===== Registro SIDRO completo (01-21) =====

test('01 registro completo acepta cédula con código 01 y conserva el cero inicial', async () => {
  const response = await api('POST', '/api/sidro/register', null, registerPayload({ documento: '0122345671' }));
  assert.equal(response.status, 201);
  assert.equal(response.body.documento, '0122345671');
  assert.equal(response.body.nombre_completo, 'Lucía Mera');
  assert.equal(findAccount(response.body.id).documento, '0122345671');
});

test('02 registro completo acepta cédula de la provincia 30 (exterior)', async () => {
  const response = await api('POST', '/api/sidro/register', null, registerPayload({ documento: '3012345652', email: 'exterior@example.com' }));
  assert.equal(response.status, 201);
  assert.equal(response.body.documento, '3012345652');
});

test('03 registro completo acepta RUC natural de 13 dígitos', async () => {
  const response = await api('POST', '/api/sidro/register', null, registerPayload({ documento: '1710034065001' }));
  assert.equal(response.status, 201);
  assert.equal(response.body.documento, '1710034065001');
  assert.equal(idUtil.validateEcuadorDocument('1710034065001').type, 'RUC_NATURAL');
});

test('04 registro completo acepta RUC jurídico aunque falle el algoritmo clásico del SRI', async () => {
  const validation = idUtil.validateEcuadorDocument('1790012349001');
  assert.equal(validation.valid, true);
  assert.equal(validation.type, 'RUC_JURIDICO');
  assert.equal(validation.checksum_valid, false);

  const response = await api('POST', '/api/sidro/register', null, registerPayload({ documento: '1790012349001' }));
  assert.equal(response.status, 201);
  assert.equal(response.body.documento, '1790012349001');
});

test('05 registro completo acepta RUC público y reporta checksum válido', async () => {
  const validation = idUtil.validateEcuadorDocument('1760001550001');
  assert.equal(validation.valid, true);
  assert.equal(validation.type, 'RUC_PUBLICO');
  assert.equal(validation.checksum_valid, true);

  const response = await api('POST', '/api/sidro/register', null, registerPayload({ documento: '1760001550001' }));
  assert.equal(response.status, 201);
});

test('06 registro completo rechaza cédula con dígito verificador inválido', async () => {
  const response = await api('POST', '/api/sidro/register', null, registerPayload({ documento: '1234567890' }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'El dígito verificador de la cédula no es válido');
});

test('07 registro completo rechaza provincias inexistentes (25 y 99)', async () => {
  const first = await api('POST', '/api/sidro/register', null, registerPayload({ documento: '2522345671' }));
  assert.equal(first.status, 400);
  assert.equal(first.body.error, 'El código de provincia del documento no es válido');

  const second = await api('POST', '/api/sidro/register', null, registerPayload({ documento: '9922345671' }));
  assert.equal(second.status, 400);
  assert.equal(second.body.error, 'El código de provincia del documento no es válido');
});

test('08 registro completo rechaza tercer dígito no correspondiente a cédula o tipo de RUC', async () => {
  const cedula = await api('POST', '/api/sidro/register', null, registerPayload({ documento: '1782345670' }));
  assert.equal(cedula.status, 400);
  assert.equal(cedula.body.error, 'El documento no corresponde a una cédula ecuatoriana válida');

  const ruc = await api('POST', '/api/sidro/register', null, registerPayload({ documento: '1786543213001' }));
  assert.equal(ruc.status, 400);
  assert.equal(ruc.body.error, 'El tercer dígito del RUC no corresponde a un tipo de contribuyente soportado');
});

test('09 duplicado por correo devuelve el mensaje genérico sin enumerar el campo', async () => {
  state.accounts[0].email = 'lucia@example.com';
  const response = await api('POST', '/api/sidro/register', null, registerPayload({ telefono: '0987777777', documento: '0934567892' }));
  assert.equal(response.status, 409);
  assert.equal(response.body.error, GENERIC_DUPLICATE);
});

test('10 duplicado por teléfono devuelve el mismo mensaje genérico', async () => {
  state.accounts[0].telefono = '+593991234567';
  const response = await api('POST', '/api/sidro/register', null, registerPayload({ email: 'otra@example.com', documento: '0934567892' }));
  assert.equal(response.status, 409);
  assert.equal(response.body.error, GENERIC_DUPLICATE);
});

test('11 duplicado por documento devuelve el mismo mensaje genérico', async () => {
  state.accounts[0].documento = '1710034065';
  const response = await api('POST', '/api/sidro/register', null, registerPayload({ email: 'otra@example.com', telefono: '0987777777' }));
  assert.equal(response.status, 409);
  assert.equal(response.body.error, GENERIC_DUPLICATE);
});

test('12 el registro deja el correo pendiente de verificación y guarda un token de un solo uso', async () => {
  const response = await api('POST', '/api/sidro/register', null, registerPayload());
  assert.equal(response.status, 201);
  assert.equal(response.body.email_verified_at, null);
  assert.equal(response.body.verification_email_sent, true);
  assert.match(response.body.message, /Revisa tu correo para verificar tu cuenta/);

  const insert = state.queries.find((entry) => /INSERT INTO sidro_client_accounts/i.test(entry.sql));
  assert.match(insert.sql, /privacy_accepted_at,email_verification_token_hash,email_verification_expires_at,password_hash/);
  assert.doesNotMatch(insert.sql, /email_verified_at,password_hash/);
  assert.doesNotMatch(insert.sql, /NOW\(\),NOW\(\)/);

  const stored = findAccount(response.body.id);
  assert.ok(stored.privacy_accepted_at);
  assert.equal(stored.email_verified_at, null);
  assert.ok(stored.email_verification_token_hash);
  assert.ok(stored.email_verification_expires_at);
  assert.equal(brevo.calls.length, 1);
  assert.equal(brevo.calls[0][0], 'verify');
  assert.equal(brevo.calls[0][1].recipientEmail, 'lucia@example.com');
  assert.match(brevo.calls[0][1].verificationUrl, /\/verify-email\?token=[a-f0-9]{64}$/);
  assert.ok(state.events.some((entry) => entry.type === 'registration_email_verification' && entry.outcome === 'provider_accepted'));
});

test('13 el registro exige que la confirmación de contraseña coincida', async () => {
  const response = await api('POST', '/api/sidro/register', null, registerPayload({ password_confirm: 'OtraClave123' }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'La confirmación de contraseña no coincide');
});

test('14 el registro exige aceptar la política de privacidad', async () => {
  const response = await api('POST', '/api/sidro/register', null, registerPayload({ privacy_accepted: false }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Debes aceptar la política de privacidad para crear tu cuenta');
});

test('15 el registro exige una dirección de al menos 5 caracteres', async () => {
  const response = await api('POST', '/api/sidro/register', null, registerPayload({ direccion: 'Casa' }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Ingresa tu dirección (mínimo 5 caracteres)');
});

test('16 el registro exige una contraseña de entre 8 y 128 caracteres', async () => {
  const response = await api('POST', '/api/sidro/register', null, registerPayload({ password: 'corta1', password_confirm: 'corta1' }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'La contraseña debe tener entre 8 y 128 caracteres');
});

test('17 el registro exige un WhatsApp válido', async () => {
  const response = await api('POST', '/api/sidro/register', null, registerPayload({ telefono: '123' }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Ingresa un número de WhatsApp válido, por ejemplo +593991234567');
});

test('18 el registro exige apellidos y nombres completos', async () => {
  const shortName = await api('POST', '/api/sidro/register', null, registerPayload({ nombre_completo: 'Lu' }));
  assert.equal(shortName.status, 400);
  assert.equal(shortName.body.error, 'Ingresa tus apellidos y nombres completos');

  const digitsOnly = await api('POST', '/api/sidro/register', null, registerPayload({ nombre_completo: '123456' }));
  assert.equal(digitsOnly.status, 400);
  assert.equal(digitsOnly.body.error, 'Ingresa tus apellidos y nombres completos');
});

test('19 el registro normaliza nombre, correo, teléfono y documento antes de guardar', async () => {
  const response = await api('POST', '/api/sidro/register', null, registerPayload({
    nombre_completo: '  Lucía   Mera  ',
    email: '  LUCIA@Example.com ',
    telefono: '099-123-4567',
    direccion: '  Av. Amazonas 123   y Patria ',
    documento: '1710034065'
  }));
  assert.equal(response.status, 201);
  const stored = findAccount(response.body.id);
  assert.equal(stored.nombre_completo, 'Lucía Mera');
  assert.equal(stored.email, 'lucia@example.com');
  assert.equal(stored.telefono, '+593991234567');
  assert.equal(stored.direccion, 'Av. Amazonas 123 y Patria');
  assert.equal(stored.documento, '1710034065');
});

test('20 el registro rechaza documentos no numéricos o con longitud inválida', async () => {
  const response = await api('POST', '/api/sidro/register', null, registerPayload({ documento: 'ABC1234567' }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'La cédula debe tener 10 dígitos y el RUC 13 dígitos');
});

test('21 si el INSERT choca con un duplicado (23505) responde el mensaje genérico', async () => {
  state.failAccountInsertCode = '23505';
  const response = await api('POST', '/api/sidro/register', null, registerPayload());
  assert.equal(response.status, 409);
  assert.equal(response.body.error, GENERIC_DUPLICATE);
});

// ===== Completar datos de perfil (22-28) =====

test('22 completar datos exige token de clienta SIDRO', async () => {
  const anonymous = await api('PUT', '/api/sidro/profile/complete-data', null, { documento: '1710034065' });
  assert.equal(anonymous.status, 401);

  const posStaff = await api('PUT', '/api/sidro/profile/complete-data', signPos(ids.owner), { documento: '1710034065' });
  assert.equal(posStaff.status, 403);
});

test('23 completar datos guarda documento y dirección de cuentas antiguas', async () => {
  const response = await api('PUT', '/api/sidro/profile/complete-data', signSidro(), {
    documento: '1710034065',
    direccion: 'Av. Amazonas 123 y Patria'
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.documento, '1710034065');
  assert.equal(response.body.direccion, 'Av. Amazonas 123 y Patria');
  assert.equal(response.body.profile_complete, false);

  const stored = findAccount(LEGACY_ACCOUNT_ID);
  assert.equal(stored.documento, '1710034065');
  assert.equal(stored.direccion, 'Av. Amazonas 123 y Patria');
  assert.deepEqual(state.events.map((event) => event.type), ['profile_data_completed']);
});

test('24 el documento es inmutable y las colisiones usan mensajes neutrales', async () => {
  const account = findAccount(LEGACY_ACCOUNT_ID);
  account.documento = '1710034065';

  const immutable = await api('PUT', '/api/sidro/profile/complete-data', signSidro(), { documento: '0934567892' });
  assert.equal(immutable.status, 409);
  assert.equal(immutable.body.error, 'Tu documento ya está registrado. Para corregirlo, contacta al salón.');

  account.documento = null;
  state.accounts.push({
    ...account,
    id: OTHER_ACCOUNT_ID,
    email: 'otra@example.com',
    documento: '1710034065'
  });
  const collision = await api('PUT', '/api/sidro/profile/complete-data', signSidro(), { documento: '1710034065' });
  assert.equal(collision.status, 409);
  assert.equal(collision.body.error, GENERIC_DOCUMENT_FAILURE);
  assert.equal(findAccount(LEGACY_ACCOUNT_ID).documento, null);
});

test('25 si el UPDATE choca con 23505 responde neutral y no deja cambios parciales', async () => {
  state.failProfileUpdateCode = '23505';
  const response = await api('PUT', '/api/sidro/profile/complete-data', signSidro(), {
    documento: '1710034065',
    direccion: 'Av. Amazonas 123 y Patria'
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, GENERIC_DOCUMENT_FAILURE);

  const stored = findAccount(LEGACY_ACCOUNT_ID);
  assert.equal(stored.documento, null);
  assert.equal(stored.direccion, null);
});

test('26 completar datos no toca credenciales ni token_version', async () => {
  await api('PUT', '/api/sidro/profile/complete-data', signSidro(), { documento: '1710034065' });

  const controllerSource = source('src/controllers/sidroAuthPhase4.controller.ts');
  const completeSection = controllerSource.slice(controllerSource.indexOf('export const completeProfileData'));
  const updateStatement = completeSection.slice(completeSection.indexOf('UPDATE sidro_client_accounts'), completeSection.indexOf('RETURNING id,nombre_completo'));
  assert.doesNotMatch(updateStatement, /token_version|password_hash/);

  const updates = state.queries.filter((entry) => /UPDATE sidro_client_accounts/i.test(entry.sql));
  assert.equal(updates.length, 1);
  assert.equal(findAccount(LEGACY_ACCOUNT_ID).token_version, 0);
});

test('27 completar datos valida documento inválido y dirección corta', async () => {
  const invalidDocument = await api('PUT', '/api/sidro/profile/complete-data', signSidro(), { documento: '1234567890' });
  assert.equal(invalidDocument.status, 400);
  assert.equal(invalidDocument.body.error, 'El dígito verificador de la cédula no es válido');

  const shortAddress = await api('PUT', '/api/sidro/profile/complete-data', signSidro(), { direccion: 'Casa' });
  assert.equal(shortAddress.status, 400);
  assert.equal(shortAddress.body.error, 'Ingresa una dirección válida (mínimo 5 caracteres)');

  const empty = await api('PUT', '/api/sidro/profile/complete-data', signSidro(), {});
  assert.equal(empty.status, 400);
});

test('28 el perfil expone documento, dirección, privacidad y profile_complete', async () => {
  const account = findAccount(LEGACY_ACCOUNT_ID);
  account.documento = '1710034065';
  account.direccion = 'Av. Amazonas 123 y Patria';
  account.email = 'sandra@example.com';
  account.privacy_accepted_at = '2026-02-01T00:00:00.000Z';

  const response = await api('GET', '/api/sidro/profile', signSidro());
  assert.equal(response.status, 200);
  assert.equal(response.body.documento, '1710034065');
  assert.equal(response.body.direccion, 'Av. Amazonas 123 y Patria');
  assert.equal(response.body.privacy_accepted_at, '2026-02-01T00:00:00.000Z');
  assert.equal(response.body.profile_complete, true);
});

// ===== Vinculación (29-33) =====

test('29 vincular procesa solicitudes aprobadas: cita oficial, notificación y auditoría', async () => {
  seedPendingRequest();
  const response = await api('POST', '/api/admin/sidro/link', signPos(ids.admin), {
    sidro_account_id: LEGACY_ACCOUNT_ID,
    client_id: CLIENT_A_ID
  });
  assert.equal(response.status, 200);
  assert.equal(state.createOfficialCalls, 1);
  assert.equal(state.createOfficialArgs.clientId, CLIENT_A_ID);
  assert.equal(state.createOfficialArgs.notePrefix, 'Generada desde SIDRO post-vinculacion');

  assert.equal(state.requests[0].status, 'CONFIRMADA');
  assert.equal(state.requests[0].official_appointment_id, 'appointment-77');
  assert.equal(response.body.confirmed_requests.length, 1);
  assert.deepEqual(response.body.conflicts, []);

  const notification = state.notifications.find((item) => item.type === 'sidro_request_confirmed');
  assert.ok(notification);
  assert.equal(notification.recipient_type, 'sidro_account');
  assert.equal(notification.recipient_id, LEGACY_ACCOUNT_ID);

  assert.deepEqual(state.audits.map((entry) => entry.action), ['SIDRO_ACCOUNT_LINKED']);
  assert.equal(state.audits[0].target, null);
  assert.ok(state.audits[0].metadata.link_id);
  assert.equal(state.audits[0].metadata.confirmed_requests, 1);
});

test('30 un conflicto al agendar marca CONFLICTO_VINCULACION y avisa al personal', async () => {
  seedPendingRequest();
  state.createOfficialError = 'horario ocupado';
  const response = await api('POST', '/api/admin/sidro/link', signPos(ids.owner), {
    sidro_account_id: LEGACY_ACCOUNT_ID,
    client_id: CLIENT_A_ID
  });
  assert.equal(response.status, 200);
  assert.equal(state.requests[0].status, 'CONFLICTO_VINCULACION');
  assert.equal(response.body.confirmed_requests.length, 0);
  assert.equal(response.body.conflicts.length, 1);

  const staffNotifications = state.notifications.filter((item) => item.type === 'sidro_request_link_conflict');
  assert.equal(staffNotifications.length, 3);
  for (const notification of staffNotifications) {
    assert.equal(notification.recipient_type, 'pos_user');
  }
});

test('31 reprocesar no duplica notificaciones (dedupe por solicitud y estado)', async () => {
  seedPendingRequest();
  await api('POST', '/api/admin/sidro/link', signPos(ids.admin), {
    sidro_account_id: LEGACY_ACCOUNT_ID,
    client_id: CLIENT_A_ID
  });
  assert.equal(state.notifications.filter((item) => item.type === 'sidro_request_confirmed').length, 1);

  state.requests[0].status = 'APROBADA_PENDIENTE_VINCULACION';
  const second = await api('POST', '/api/admin/sidro/link', signPos(ids.admin), {
    sidro_account_id: LEGACY_ACCOUNT_ID,
    client_id: CLIENT_A_ID
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.confirmed_requests.length, 1);
  assert.equal(state.notifications.filter((item) => item.type === 'sidro_request_confirmed').length, 1);
});

test('32 la reasignación exige confirmación explícita y queda auditada', async () => {
  state.links.push({
    id: '90000000-0000-4000-8000-000000000099',
    sidro_account_id: OTHER_ACCOUNT_ID,
    client_id: CLIENT_A_ID,
    admin_id: null,
    is_active: true
  });

  const blocked = await api('POST', '/api/admin/sidro/link', signPos(ids.admin), {
    sidro_account_id: LEGACY_ACCOUNT_ID,
    client_id: CLIENT_A_ID
  });
  assert.equal(blocked.status, 409);

  const forced = await api('POST', '/api/admin/sidro/link', signPos(ids.admin), {
    sidro_account_id: LEGACY_ACCOUNT_ID,
    client_id: CLIENT_A_ID,
    force: true
  });
  assert.equal(forced.status, 200);
  assert.equal(state.audits.at(-1).metadata.reassignment, true);
  const active = state.links.filter((link) => link.is_active);
  assert.equal(active.length, 1);
  assert.equal(active[0].sidro_account_id, LEGACY_ACCOUNT_ID);
});

test('33 vincular solo está permitido a owner y admin', async () => {
  const payload = { sidro_account_id: LEGACY_ACCOUNT_ID, client_id: CLIENT_A_ID };
  assert.equal((await api('POST', '/api/admin/sidro/link', signPos(ids.reception), payload)).status, 403);
  assert.equal((await api('POST', '/api/admin/sidro/link', signPos(ids.professional), payload)).status, 403);
  assert.equal(rbac.roleHasPermission('reception', rbac.PERMISSIONS.sidroAccountsLink), false);
  assert.equal(rbac.roleHasPermission('professional', rbac.PERMISSIONS.sidroAccountsLink), false);
  assert.equal((await api('POST', '/api/admin/sidro/link', signPos(ids.owner), payload)).status, 200);
  assert.equal((await api('POST', '/api/admin/sidro/link', signPos(ids.admin), payload)).status, 200);
});

// ===== Detalle y coincidencias (34-35) =====

test('34 el detalle de cuenta valida uuid, 404 y devuelve documento y dirección', async () => {
  assert.equal((await api('GET', '/api/admin/sidro/accounts/no-es-uuid/detail', signPos(ids.admin))).status, 400);
  assert.equal(
    (await api('GET', '/api/admin/sidro/accounts/00000000-0000-4000-8000-000000000099/detail', signPos(ids.admin))).status,
    404
  );

  const account = findAccount(LEGACY_ACCOUNT_ID);
  account.documento = '1710034065';
  account.direccion = 'Av. Amazonas 123 y Patria';
  const response = await api('GET', `/api/admin/sidro/accounts/${LEGACY_ACCOUNT_ID}/detail`, signPos(ids.owner));
  assert.equal(response.status, 200);
  assert.equal(response.body.account.documento, '1710034065');
  assert.equal(response.body.account.direccion, 'Av. Amazonas 123 y Patria');
  assert.equal(response.body.account.linked_client_id, null);
});

test('35 las coincidencias explican el motivo y marcan vínculos de otras cuentas', async () => {
  const account = findAccount(LEGACY_ACCOUNT_ID);
  account.documento = '1710034065';
  state.clients.push(
    { id: CLIENT_A_ID, nombre: 'Ana Pérez', cedula: '1710034065', telefono: '0988888888', email: null, direccion: null },
    { id: CLIENT_B_ID, nombre: 'Otra Ana', cedula: null, telefono: '593988888888', email: null, direccion: null },
    { id: CLIENT_LINKED_ID, nombre: 'Zoe Vega', cedula: null, telefono: null, email: null, direccion: null }
  );
  state.links.push({
    id: '90000000-0000-4000-8000-000000000098',
    sidro_account_id: OTHER_ACCOUNT_ID,
    client_id: CLIENT_B_ID,
    admin_id: null,
    is_active: true
  });

  const response = await api('GET', `/api/admin/sidro/accounts/${LEGACY_ACCOUNT_ID}/matches`, signPos(ids.admin));
  assert.equal(response.status, 200);
  assert.equal(response.body.linked_client_id, null);

  const byId = new Map(response.body.matches.map((match) => [match.id, match]));
  assert.deepEqual(byId.get(CLIENT_A_ID).match_reasons.sort(), ['documento', 'telefono']);
  assert.equal(byId.get(CLIENT_A_ID).linked_to_other, false);
  assert.deepEqual(byId.get(CLIENT_B_ID).match_reasons, ['telefono']);
  assert.equal(byId.get(CLIENT_B_ID).linked_to_other, true);
  assert.equal(byId.has(CLIENT_LINKED_ID), false);
});

// ===== Crear cliente y vincular (36-38) =====

test('36 crear cliente y vincular inserta cliente, vínculo, procesa pendientes y audita', async () => {
  seedPendingRequest();
  const response = await api('POST', '/api/admin/sidro/link/create-client', signPos(ids.admin), {
    sidro_account_id: LEGACY_ACCOUNT_ID,
    nombre: 'Sandra Paredes',
    cedula: '1710034065',
    telefono: '0991234567',
    email: 'sandra@example.com',
    direccion: 'Av. Amazonas 123 y Patria'
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.message, 'Cliente creado y vinculado');
  assert.equal(response.body.client.cedula, '1710034065');
  assert.equal(response.body.client.telefono, '+593991234567');
  assert.equal(response.body.confirmed_requests.length, 1);

  const activeLink = state.links.find((link) => link.is_active);
  assert.ok(activeLink);
  assert.equal(activeLink.sidro_account_id, LEGACY_ACCOUNT_ID);
  assert.equal(activeLink.client_id, response.body.client.id);

  assert.deepEqual(state.audits.map((entry) => entry.action), ['SIDRO_CLIENT_CREATED_AND_LINKED']);
  assert.equal(state.audits[0].target, null);
  assert.ok(state.audits[0].metadata.link_id);
  assert.equal(state.audits[0].metadata.confirmed_requests, 1);
  assert.equal(state.requests[0].status, 'CONFIRMADA');
});

test('37 crear cliente bloquea cédula o correo ya existentes y muestra coincidencias', async () => {
  state.clients.push({
    id: CLIENT_A_ID,
    nombre: 'Ana Pérez',
    cedula: '1710034065',
    telefono: null,
    email: 'ana@example.com',
    direccion: null
  });

  const response = await api('POST', '/api/admin/sidro/link/create-client', signPos(ids.owner), {
    sidro_account_id: LEGACY_ACCOUNT_ID,
    nombre: 'Sandra Paredes',
    cedula: '1710034065',
    telefono: '0991234567',
    email: 'sandra@example.com',
    direccion: 'Av. Amazonas 123 y Patria'
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, BLOCKED_CLIENT_MESSAGE);
  assert.equal(response.body.matches.length, 1);
  assert.deepEqual(response.body.matches[0].match_reasons, ['documento']);

  assert.equal(state.clients.length, 1);
  assert.equal(state.links.length, 0);
  assert.equal(state.audits.length, 0);
});

test('38 crear cliente revierte ante 23505 y valida documentos y cuentas ya vinculadas', async () => {
  state.failClientInsertCode = '23505';
  const raced = await api('POST', '/api/admin/sidro/link/create-client', signPos(ids.admin), {
    sidro_account_id: LEGACY_ACCOUNT_ID,
    nombre: 'Sandra Paredes',
    cedula: '1710034065',
    telefono: '0991234567',
    email: 'sandra@example.com',
    direccion: 'Av. Amazonas 123 y Patria'
  });
  assert.equal(raced.status, 409);
  assert.equal(raced.body.error, BLOCKED_CLIENT_MESSAGE);
  assert.equal(state.links.length, 0);
  assert.equal(state.audits.length, 0);

  const invalidDocument = await api('POST', '/api/admin/sidro/link/create-client', signPos(ids.admin), {
    sidro_account_id: LEGACY_ACCOUNT_ID,
    nombre: 'Sandra Paredes',
    cedula: '1234567890',
    telefono: '0991234567',
    email: 'sandra@example.com',
    direccion: 'Av. Amazonas 123 y Patria'
  });
  assert.equal(invalidDocument.status, 400);
  assert.equal(invalidDocument.body.error, 'El dígito verificador de la cédula no es válido');

  state.links.push({
    id: '90000000-0000-4000-8000-000000000097',
    sidro_account_id: LEGACY_ACCOUNT_ID,
    client_id: CLIENT_A_ID,
    admin_id: null,
    is_active: true
  });
  const alreadyLinked = await api('POST', '/api/admin/sidro/link/create-client', signPos(ids.admin), {
    sidro_account_id: LEGACY_ACCOUNT_ID,
    nombre: 'Sandra Paredes',
    cedula: '1710034065',
    telefono: '0991234567',
    email: 'sandra@example.com',
    direccion: 'Av. Amazonas 123 y Patria'
  });
  assert.equal(alreadyLinked.status, 409);
  assert.equal(alreadyLinked.body.error, 'La cuenta SIDRO ya está vinculada a un cliente del POS');

  const invalidUuid = await api('POST', '/api/admin/sidro/link/create-client', signPos(ids.admin), {
    sidro_account_id: 'no-es-uuid',
    nombre: 'Sandra Paredes',
    cedula: '1710034065',
    telefono: '0991234567',
    email: 'sandra@example.com',
    direccion: 'Av. Amazonas 123 y Patria'
  });
  assert.equal(invalidUuid.status, 400);
  assert.equal(invalidUuid.body.error, 'Cuenta SIDRO inválida');
});

// ===== Seguridad y fuentes (39-40) =====

test('39 las rutas nuevas de vinculación rechazan a recepción, profesionales y tokens SIDRO', async () => {
  const routes = [
    ['GET', `/api/admin/sidro/accounts/${LEGACY_ACCOUNT_ID}/detail`],
    ['GET', `/api/admin/sidro/accounts/${LEGACY_ACCOUNT_ID}/matches`],
    ['POST', '/api/admin/sidro/link/create-client']
  ];
  for (const [method, route] of routes) {
    const body = method === 'POST' ? {} : undefined;
    assert.equal((await api(method, route, signPos(ids.reception), body)).status, 403);
    assert.equal((await api(method, route, signPos(ids.professional), body)).status, 403);
    assert.equal((await api(method, route, signSidro(), body)).status, 403);
  }
});

test('40 fuentes: migración idempotente, outbox de Calendar, POS intacto y validadores en paridad', () => {
  const migration = source('sidro_complete_registration_phase85.sql');
  assert.match(migration, /ALTER TABLE sidro_client_accounts ADD COLUMN IF NOT EXISTS documento VARCHAR\(13\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS direccion TEXT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ/);
  assert.match(migration, /sidro_client_accounts_documento_unique_idx/);
  assert.match(migration, /HAVING COUNT\(\*\) > 1/);
  assert.match(migration, /sidro_client_accounts_telefono_digits_idx/);

  const migrator = source('src/database/migrateSidroCompleteRegistration85.ts');
  assert.match(migrator, /initSidroCompleteRegistration85/);
  assert.match(migrator, /verifySidroCompleteRegistration85/);
  assert.match(migrator, /email_verification_constraint_ok/);
  const indexSource = source('src/index.ts');
  assert.doesNotMatch(indexSource, /initSidroCompleteRegistration85/);
  assert.match(indexSource, /verifySidroCompleteRegistration85/);
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'migrate-sidro-85a.cjs')), 'el despliegue debe poder aplicar la migración antes del arranque');
  const packageJson = JSON.parse(source('package.json'));
  assert.match(packageJson.scripts['migrate:sidro-85a'], /migrate-sidro-85a\.cjs/);

  const appointmentsSource = source('src/services/appointment.service.ts');
  const methodStart = appointmentsSource.indexOf('static async createOfficialAppointment');
  const nextMethod = appointmentsSource.indexOf('static async', methodStart + 10);
  const methodBody = appointmentsSource.slice(methodStart, nextMethod === -1 ? undefined : nextMethod);
  assert.match(methodBody, /GoogleCalendarOutboxService\.enqueueForAppointment\(client,/);

  assert.doesNotMatch(source('src/controllers/clients.controller.ts'), /validateEcuadorDocument/);

  const backendValidator = source('src/utils/ecuadorId.ts');
  const sidroValidator = sidroSource('utils/ecuador-id.ts');
  const posValidator = posSource('utils/ecuador-id.ts');
  const extract = (text, name) => text.match(new RegExp(`${name} = \\[([^\\]]+)\\]`))?.[1].replace(/\s+/g, '');
  for (const name of ['CEDULA_COEFFICIENTS', 'JURIDICO_COEFFICIENTS', 'PUBLICO_COEFFICIENTS']) {
    const expected = extract(backendValidator, name);
    assert.ok(expected, `${name} presente en el backend`);
    assert.equal(extract(sidroValidator, name), expected);
    assert.equal(extract(posValidator, name), expected);
  }
  for (const text of [backendValidator, sidroValidator, posValidator]) {
    assert.match(text, /numeric === 30/);
    assert.match(text, /numeric >= 1 && numeric <= 24/);
    assert.match(text, /verification_level/);
    assert.match(text, /structure_only/);
    assert.match(text, /official_verification: 'not_performed'/);
  }
});

// ===== Correcciones post-revisión Fase 8.5A (41-49) =====

const extractVerificationToken = (callIndex = 0) => {
  const url = new URL(brevo.calls[callIndex][1].verificationUrl);
  return url.searchParams.get('token');
};

test('41 el enlace de verificación de un solo uso activa la cuenta y habilita el login', async () => {
  const registered = await api('POST', '/api/sidro/register', null, registerPayload());
  assert.equal(registered.status, 201);

  const blocked = await api('POST', '/api/sidro/login', null, { email: 'lucia@example.com', password: 'Secreto123!' });
  assert.equal(blocked.status, 401);
  assert.equal(blocked.body.error, 'Correo o contraseña incorrectos');

  const token = extractVerificationToken();
  assert.match(token, /^[a-f0-9]{64}$/);

  const verified = await api('POST', '/api/sidro/email/verify', null, { token });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.message, 'Correo verificado. Ya puedes iniciar sesión.');

  const stored = findAccount(registered.body.id);
  assert.ok(stored.email_verified_at);
  assert.equal(stored.email_verification_token_hash, null);
  assert.equal(stored.email_verification_expires_at, null);
  assert.equal(stored.token_version, 1);
  assert.ok(state.events.some((entry) => entry.type === 'email_verified' && entry.outcome === 'success'));

  const session = await api('POST', '/api/sidro/login', null, { email: 'lucia@example.com', password: 'Secreto123!' });
  assert.equal(session.status, 200);
  assert.ok(session.body.token);
});

test('42 el token de verificación no puede reutilizarse', async () => {
  await api('POST', '/api/sidro/register', null, registerPayload());
  const token = extractVerificationToken();
  assert.equal((await api('POST', '/api/sidro/email/verify', null, { token })).status, 200);

  const replay = await api('POST', '/api/sidro/email/verify', null, { token });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, 'El enlace expiró o ya fue utilizado');
});

test('43 un enlace de verificación vencido se rechaza sin activar la cuenta', async () => {
  const registered = await api('POST', '/api/sidro/register', null, registerPayload());
  const stored = findAccount(registered.body.id);
  stored.email_verification_expires_at = new Date(Date.now() - 1000).toISOString();

  const token = extractVerificationToken();
  const response = await api('POST', '/api/sidro/email/verify', null, { token });
  assert.equal(response.status, 400);
  assert.equal(stored.email_verified_at, null);
});

test('44 la cuenta antigua sin correo conserva el acceso por WhatsApp', async () => {
  state.accounts[0].password_hash = await argon2.hash('Legacy123!');
  const response = await api('POST', '/api/sidro/login/legacy', null, { telefono: '0988888888', password: 'Legacy123!' });
  assert.equal(response.status, 200);
  assert.equal(response.body.legacy_account, true);
  assert.ok(response.body.token);
});

test('45 el registro rechaza un correo que otra cuenta tiene pendiente', async () => {
  state.accounts.push({
    id: OTHER_ACCOUNT_ID,
    nombre_completo: 'Otra Cuenta',
    telefono: '+593977777777',
    email: 'vieja@example.com',
    documento: null,
    direccion: null,
    password_hash: 'x',
    is_active: true,
    token_version: 0,
    email_verified_at: '2026-01-01T00:00:00.000Z',
    pending_email: 'lucia@example.com',
    email_verification_token_hash: null,
    email_verification_expires_at: null,
    privacy_accepted_at: null
  });
  const response = await api('POST', '/api/sidro/register', null, registerPayload());
  assert.equal(response.status, 409);
  assert.equal(response.body.error, GENERIC_DUPLICATE);
});

test('46 un RUC válido sin checksum clásico se registra sin presentarlo como verificado', async () => {
  const response = await api('POST', '/api/sidro/register', null, registerPayload({ documento: '1790012349001' }));
  assert.equal(response.status, 201);
  assert.equal(response.body.documento_checksum_valid, false);
  assert.equal(response.body.documento_verification_level, 'structure_only');
  assert.equal(response.body.documento_official_verification, 'not_performed');
  assert.ok(state.events.some((entry) => entry.type === 'document_structure_only' && entry.outcome === 'manual_review_pending'));
});

test('47 el validador separa formato, algoritmo y verificación oficial no realizada', () => {
  const cedula = idUtil.validateEcuadorDocument('1710034065');
  assert.equal(cedula.checksum_valid, true);
  assert.equal(cedula.verification_level, 'algorithmic');
  assert.equal(cedula.official_verification, 'not_performed');

  const juridicoOk = idUtil.validateEcuadorDocument('1790012344001');
  assert.equal(juridicoOk.type, 'RUC_JURIDICO');
  assert.equal(juridicoOk.checksum_valid, true);
  assert.equal(juridicoOk.verification_level, 'algorithmic');

  const juridicoSinChecksum = idUtil.validateEcuadorDocument('1790012349001');
  assert.equal(juridicoSinChecksum.valid, true);
  assert.equal(juridicoSinChecksum.checksum_valid, false);
  assert.equal(juridicoSinChecksum.verification_level, 'structure_only');
  assert.equal(juridicoSinChecksum.official_verification, 'not_performed');

  const invalido = idUtil.validateEcuadorDocument('1234567890');
  assert.equal(invalido.valid, false);
  assert.equal(invalido.verification_level, null);
  assert.equal(invalido.official_verification, 'not_performed');
});

test('48 si el proveedor de correo falla la cuenta queda pendiente y la respuesta lo informa', async () => {
  brevo.fail = true;
  const response = await api('POST', '/api/sidro/register', null, registerPayload());
  assert.equal(response.status, 201);
  assert.equal(response.body.verification_email_sent, false);
  assert.match(response.body.message, /no pudimos enviar el correo de verificación/i);
  const stored = findAccount(response.body.id);
  assert.equal(stored.email_verified_at, null);
  assert.ok(stored.email_verification_token_hash);
  assert.ok(state.events.some((entry) => entry.type === 'registration_email_verification' && entry.outcome === 'provider_error'));
});

test('49 sin proveedor configurado la cuenta nace pendiente y el evento queda observable', async () => {
  brevo.configured = false;
  const response = await api('POST', '/api/sidro/register', null, registerPayload());
  assert.equal(response.status, 201);
  assert.equal(response.body.verification_email_sent, false);
  assert.equal(findAccount(response.body.id).email_verified_at, null);
  assert.ok(state.events.some((entry) => entry.type === 'registration_email_verification' && entry.outcome === 'provider_unconfigured'));
});

test('50 la restricción de verificación de Fase 4 se relaja para el token inicial conservando salvaguardas', () => {
  const migration = source('sidro_complete_registration_phase85.sql');
  const migrator = source('src/database/migrateSidroCompleteRegistration85.ts');
  for (const text of [migration, migrator]) {
    assert.match(text, /sidro_client_accounts_email_verification_pair_check/);
    assert.match(text, /\(email_verification_token_hash IS NULL\) = \(email_verification_expires_at IS NULL\)/);
    assert.match(text, /pending_email IS NULL OR email_verification_token_hash IS NOT NULL/);
  }
  const phase4 = source('sidro_auth_phase4.sql');
  assert.match(phase4, /sidro_client_accounts_email_verification_pair_check/);
});
