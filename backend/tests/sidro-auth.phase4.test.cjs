const test = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = 'phase4-local-test-secret-with-at-least-32-characters';
process.env.SIDRO_PUBLIC_URL = 'http://localhost:4201';

let queryHandler = async () => ({ rows: [], rowCount: 0 });
const queries = [];
const fakePool = {
  query(sql, params = []) { queries.push({ sql: String(sql), params }); return queryHandler(String(sql), params); },
  async connect() { return { query(sql, params = []) { queries.push({ sql: String(sql), params }); return queryHandler(String(sql), params); }, release() {} }; },
  on() {}
};
const dbPath = require.resolve('../dist/database/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { __esModule: true, default: fakePool } };

const delivery = { accepted: true, messageId: 'brevo-message-local' };
const brevo = {
  configured: true,
  fail: false,
  calls: [],
  isConfigured() { return this.configured; },
  async sendPasswordResetEmail(input) { this.calls.push(['reset', input]); if (this.fail) throw Object.assign(new Error('mock'), { providerCode: 'MOCK_ERROR' }); return delivery; },
  async sendPasswordChangedEmail(input) { this.calls.push(['changed', input]); return delivery; },
  async sendEmailVerificationEmail(input) { this.calls.push(['verify', input]); if (this.fail) throw Object.assign(new Error('mock'), { providerCode: 'MOCK_ERROR' }); return delivery; },
  async sendEmailChangedNotice(input) { this.calls.push(['email-changed', input]); return delivery; }
};
const brevoPath = require.resolve('../dist/services/brevo.service.js');
require.cache[brevoPath] = { id: brevoPath, filename: brevoPath, loaded: true, exports: { BrevoService: brevo } };

const identity = require('../dist/services/sidroIdentity.service.js');
const controller = require('../dist/controllers/sidroAuthPhase4.controller.js');
const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const response = () => {
  const state = { status: 200, body: undefined };
  return { state, status(code) { state.status = code; return this; }, json(body) { state.body = body; return this; } };
};
const call = async (fn, body = {}, auth = {}) => { const res = response(); await fn({ body, query: {}, ...auth }, res); return res.state; };

test.beforeEach(() => { queries.length = 0; brevo.configured = true; brevo.fail = false; brevo.calls.length = 0; queryHandler = async () => ({ rows: [], rowCount: 0 }); });

test('01 normaliza email a minúsculas', () => assert.equal(identity.normalizeEmail('  A@Example.COM '), 'a@example.com'));
test('02 acepta email válido', () => assert.equal(identity.isValidEmail('a@example.com'), true));
test('03 rechaza email sin dominio', () => assert.equal(identity.isValidEmail('a@'), false));
test('04 rechaza email excesivo', () => assert.equal(identity.isValidEmail(`${'a'.repeat(156)}@x.co`), false));
test('05 normaliza móvil ecuatoriano local', () => assert.equal(identity.normalizeWhatsapp('099 123 4567'), '+593991234567'));
test('06 normaliza móvil ecuatoriano sin signo', () => assert.equal(identity.normalizeWhatsapp('593991234567'), '+593991234567'));
test('07 conserva móvil ecuatoriano internacional', () => assert.equal(identity.normalizeWhatsapp('+593991234567'), '+593991234567'));
test('08 acepta un número internacional E.164', () => assert.equal(identity.normalizeWhatsapp('+14155552671'), '+14155552671'));
test('09 rechaza letras en WhatsApp', () => assert.equal(identity.normalizeWhatsapp('hola'), null));
test('10 rechaza un número demasiado corto', () => assert.equal(identity.normalizeWhatsapp('0991'), null));
test('11 crea candidatos legacy local e internacional', () => assert.deepEqual(identity.legacyWhatsappCandidates('0991234567').sort(), ['0991234567', '593991234567'].sort()));
test('12 elimina separadores para comparación legacy', () => assert.equal(identity.whatsappDigits('+593 99-123-4567'), '593991234567'));
test('13 acepta contraseña de 8 caracteres', () => assert.equal(identity.isValidPassword('12345678'), true));
test('14 rechaza contraseña corta', () => assert.equal(identity.isValidPassword('1234567'), false));
test('15 token opaco tiene 64 hex y hash distinto', () => { const x = identity.createOpaqueToken(); assert.match(x.token, /^[a-f0-9]{64}$/); assert.notEqual(x.token, x.tokenHash); });
test('16 valida formato de token opaco', () => assert.equal(identity.isOpaqueToken('a'.repeat(64)), true));
test('17 rechaza token manipulado', () => assert.equal(identity.isOpaqueToken('z'.repeat(64)), false));

test('18 login por correo válido emite JWT SIDRO', async () => {
  const hash = await argon2.hash('Correcta123');
  queryHandler = async (sql) => /FROM sidro_client_accounts a/.test(sql) ? { rows: [{ id: accountId, password_hash: hash, is_active: true, token_version: 2, email_verified_at: new Date(), client_id: null }] } : { rows: [] };
  const r = await call(controller.login, { email: 'CLIENTE@EXAMPLE.COM', password: 'Correcta123' });
  assert.equal(r.status, 200); assert.ok(r.body.token);
});
test('19 login normaliza mayúsculas en consulta', async () => {
  queryHandler = async () => ({ rows: [] }); await call(controller.login, { email: 'A@EXAMPLE.COM', password: 'x' }); assert.equal(queries[0].params[0], 'a@example.com');
});
test('20 login rechaza contraseña incorrecta', async () => {
  const hash = await argon2.hash('Correcta123'); queryHandler = async () => ({ rows: [{ id: accountId, password_hash: hash, is_active: true, email_verified_at: new Date() }] });
  assert.equal((await call(controller.login, { email: 'a@example.com', password: 'Mala1234' })).status, 401);
});
test('21 login rechaza cuenta inactiva sin revelarla', async () => {
  const hash = await argon2.hash('Correcta123'); queryHandler = async () => ({ rows: [{ password_hash: hash, is_active: false, email_verified_at: new Date() }] });
  const r = await call(controller.login, { email: 'a@example.com', password: 'Correcta123' }); assert.equal(r.status, 401); assert.equal(r.body.error, 'Correo o contraseña incorrectos');
});
test('22 login rechaza cuenta inexistente con el mismo mensaje', async () => {
  const r = await call(controller.login, { email: 'a@example.com', password: 'Correcta123' }); assert.equal(r.status, 401); assert.equal(r.body.error, 'Correo o contraseña incorrectos');
});
test('23 login rechaza correo aún no verificado', async () => {
  const hash = await argon2.hash('Correcta123'); queryHandler = async () => ({ rows: [{ password_hash: hash, is_active: true, email_verified_at: null }] });
  assert.equal((await call(controller.login, { email: 'a@example.com', password: 'Correcta123' })).status, 401);
});
test('24 cuenta legacy sin email accede por WhatsApp', async () => {
  const hash = await argon2.hash('Correcta123'); queryHandler = async (sql) => /email IS NULL/.test(sql) ? { rows: [{ id: accountId, password_hash: hash, is_active: true, token_version: 0 }] } : { rows: [] };
  const r = await call(controller.legacyLogin, { telefono: '0991234567', password: 'Correcta123' }); assert.equal(r.status, 200); assert.equal(r.body.legacy_account, true);
});
test('25 cuenta con email no obtiene acceso legacy', async () => assert.equal((await call(controller.legacyLogin, { telefono: '0991234567', password: 'Correcta123' })).status, 401));
test('26 acceso legacy rechaza teléfono inválido', async () => assert.equal((await call(controller.legacyLogin, { telefono: 'abc', password: 'Correcta123' })).status, 400));

test('27 recuperación de email inexistente es neutral', async () => { const r = await call(controller.requestPasswordReset, { email: 'nadie@example.com' }); assert.equal(r.status, 200); assert.match(r.body.message, /Si el correo/); });
test('28 recuperación sin Brevo configurado es neutral y observable', async () => {
  brevo.configured = false; queryHandler = async (sql) => /SELECT id,nombre/.test(sql) ? { rows: [{ id: accountId, nombre_completo: 'Ana', email: 'a@example.com' }] } : { rows: [] };
  const r = await call(controller.requestPasswordReset, { email: 'a@example.com' }); assert.equal(r.status, 200); assert.ok(queries.some(q => /provider_unconfigured/.test(q.sql)));
});
test('29 Brevo aceptado conserva messageId', async () => {
  queryHandler = async (sql) => /SELECT id,nombre/.test(sql) ? { rows: [{ id: accountId, nombre_completo: 'Ana', email: 'a@example.com' }] } : { rows: [] };
  await call(controller.requestPasswordReset, { email: 'a@example.com' }); assert.ok(queries.some(q => q.params.includes('brevo-message-local')));
});
test('30 error Brevo invalida token sin romper respuesta neutral', async () => {
  brevo.fail = true; queryHandler = async (sql) => /SELECT id,nombre/.test(sql) ? { rows: [{ id: accountId, nombre_completo: 'Ana', email: 'a@example.com' }] } : { rows: [] };
  const r = await call(controller.requestPasswordReset, { email: 'a@example.com' }); assert.equal(r.status, 200); assert.ok(queries.some(q => /password_reset_token_hash=NULL/.test(q.sql)));
});
test('31 reset rechaza token con formato inválido', async () => assert.equal((await call(controller.resetPassword, { token: 'mal', password: 'Nueva1234' })).status, 400));
test('32 reset distingue token expirado internamente', async () => {
  queryHandler = async (sql) => /SELECT id,nombre/.test(sql) ? { rows: [{ id: accountId, password_reset_expires_at: new Date(Date.now() - 1000) }] } : { rows: [] };
  const r = await call(controller.resetPassword, { token: 'a'.repeat(64), password: 'Nueva1234' }); assert.equal(r.status, 400); assert.ok(queries.some(q => /delivery_status='expired'/.test(q.sql)));
});
test('33 reset válido incrementa token_version e invalida token', async () => {
  queryHandler = async (sql) => /SELECT id,nombre/.test(sql) ? { rows: [{ id: accountId, nombre_completo: 'Ana', email: null, password_reset_expires_at: new Date(Date.now() + 60000) }] } : { rows: [] };
  const r = await call(controller.resetPassword, { token: 'a'.repeat(64), password: 'Nueva1234' }); assert.equal(r.status, 200); assert.ok(queries.some(q => /token_version=token_version\+1/.test(q.sql)));
});
test('34 token ya usado devuelve respuesta genérica', async () => assert.equal((await call(controller.resetPassword, { token: 'a'.repeat(64), password: 'Nueva1234' })).status, 400));

test('35 cambio de correo exige contraseña actual', async () => {
  const hash = await argon2.hash('Correcta123'); queryHandler = async (sql) => /SELECT id,nombre/.test(sql) ? { rows: [{ id: accountId, password_hash: hash, email: 'old@example.com' }] } : { rows: [] };
  assert.equal((await call(controller.requestEmailChange, { email: 'new@example.com', current_password: 'Mala1234' }, { userId: accountId, userRole: 'sidro_client' })).status, 403);
});
test('36 cambio de correo duplicado retorna conflicto', async () => {
  const hash = await argon2.hash('Correcta123'); queryHandler = async (sql) => /SELECT id,nombre/.test(sql) ? { rows: [{ id: accountId, nombre_completo: 'Ana', password_hash: hash, email: 'old@example.com' }] } : /id<>/.test(sql) ? { rows: [{ id: 'otro' }] } : { rows: [] };
  assert.equal((await call(controller.requestEmailChange, { email: 'used@example.com', current_password: 'Correcta123' }, { userId: accountId, userRole: 'sidro_client' })).status, 409);
});
test('37 solicitud de correo solo crea pending_email', async () => {
  const hash = await argon2.hash('Correcta123'); queryHandler = async (sql) => /SELECT id,nombre/.test(sql) ? { rows: [{ id: accountId, nombre_completo: 'Ana', password_hash: hash, email: 'old@example.com' }] } : { rows: [] };
  const r = await call(controller.requestEmailChange, { email: 'new@example.com', current_password: 'Correcta123' }, { userId: accountId, userRole: 'sidro_client' }); assert.equal(r.status, 200); assert.ok(queries.some(q => /SET pending_email=/.test(q.sql))); assert.equal(queries.some(q => /SET email=\$/.test(q.sql)), false);
});
test('38 fallo al verificar envío conserva correo principal', async () => {
  brevo.fail = true; const hash = await argon2.hash('Correcta123'); queryHandler = async (sql) => /SELECT id,nombre/.test(sql) ? { rows: [{ id: accountId, nombre_completo: 'Ana', password_hash: hash, email: 'old@example.com' }] } : { rows: [] };
  const r = await call(controller.requestEmailChange, { email: 'new@example.com', current_password: 'Correcta123' }, { userId: accountId, userRole: 'sidro_client' }); assert.equal(r.status, 502); assert.ok(queries.some(q => /pending_email=NULL/.test(q.sql)));
});
test('39 verificación rechaza token manipulado', async () => assert.equal((await call(controller.verifyEmailChange, { token: 'x'.repeat(64) })).status, 400));
test('40 verificación rechaza token vencido', async () => {
  queryHandler = async (sql) => /SELECT id,nombre/.test(sql) ? { rows: [{ id: accountId, email_verification_expires_at: new Date(Date.now() - 1) }] } : { rows: [] };
  assert.equal((await call(controller.verifyEmailChange, { token: 'a'.repeat(64) })).status, 400);
});
test('41 verificación actualiza email atómicamente y revoca sesiones', async () => {
  queryHandler = async (sql) => /SELECT id,nombre/.test(sql) ? { rows: [{ id: accountId, nombre_completo: 'Ana', email: null, pending_email: 'new@example.com', email_verification_expires_at: new Date(Date.now() + 60000) }] } : { rows: [] };
  const r = await call(controller.verifyEmailChange, { token: 'a'.repeat(64) }); assert.equal(r.status, 200); assert.ok(queries.some(q => /email=lower\(pending_email\)/.test(q.sql) && /token_version=token_version\+1/.test(q.sql)));
});
test('42 segunda verificación no produce inconsistencia', async () => assert.equal((await call(controller.verifyEmailChange, { token: 'a'.repeat(64) })).status, 400));

test('43 actualiza WhatsApp propio normalizado', async () => {
  queryHandler = async (sql) => /SELECT email,password_hash/.test(sql) ? { rows: [{ email: 'a@example.com', password_hash: 'x' }] } : /RETURNING telefono/.test(sql) ? { rows: [{ telefono: '+593991234567' }] } : { rows: [] };
  const r = await call(controller.updateWhatsapp, { whatsapp: '099 123 4567' }, { userId: accountId, userRole: 'sidro_client' }); assert.equal(r.status, 200); assert.equal(r.body.whatsapp, '+593991234567'); assert.deepEqual(queries.find(q => /RETURNING telefono/.test(q.sql)).params, ['+593991234567', accountId]);
});
test('44 rechaza WhatsApp inválido', async () => assert.equal((await call(controller.updateWhatsapp, { whatsapp: '123' }, { userId: accountId, userRole: 'sidro_client' })).status, 400));
test('45 cuenta legacy requiere contraseña para cambiar WhatsApp', async () => {
  const hash = await argon2.hash('Correcta123'); queryHandler = async (sql) => /SELECT email,password_hash/.test(sql) ? { rows: [{ email: null, password_hash: hash }] } : { rows: [] };
  assert.equal((await call(controller.updateWhatsapp, { whatsapp: '0991234567' }, { userId: accountId, userRole: 'sidro_client' })).status, 403);
});
test('46 WhatsApp no modifica sidro_account_links', async () => {
  queryHandler = async (sql) => /SELECT email,password_hash/.test(sql) ? { rows: [{ email: 'a@example.com', password_hash: 'x' }] } : /RETURNING telefono/.test(sql) ? { rows: [{ telefono: '+593991234567' }] } : { rows: [] };
  await call(controller.updateWhatsapp, { whatsapp: '0991234567' }, { userId: accountId, userRole: 'sidro_client' }); assert.equal(queries.some(q => /UPDATE sidro_account_links/i.test(q.sql)), false);
});
test('47 cambio de contraseña rechaza la actual incorrecta', async () => {
  const hash = await argon2.hash('Correcta123'); queryHandler = async (sql) => /SELECT password_hash/.test(sql) ? { rows: [{ password_hash: hash }] } : { rows: [] };
  assert.equal((await call(controller.changePassword, { current_password: 'Mala1234', new_password: 'Nueva1234' }, { userId: accountId, userRole: 'sidro_client' })).status, 403);
});
test('48 cambio de contraseña revoca sesiones y tokens reset', async () => {
  const hash = await argon2.hash('Correcta123'); queryHandler = async (sql) => /SELECT password_hash/.test(sql) ? { rows: [{ password_hash: hash }] } : { rows: [] };
  const r = await call(controller.changePassword, { current_password: 'Correcta123', new_password: 'Nueva1234' }, { userId: accountId, userRole: 'sidro_client' }); assert.equal(r.status, 200); assert.ok(queries.some(q => /password_reset_token_hash=NULL/.test(q.sql) && /token_version=token_version\+1/.test(q.sql)));
});
test('49 perfil expone estado legacy/verificado sin contraseña', async () => {
  queryHandler = async (sql) => /SELECT a.id/.test(sql) ? { rows: [{ id: accountId, email: null, email_verified_at: null }] } : { rows: [] };
  const r = await call(controller.getProfile, {}, { userId: accountId, userRole: 'sidro_client' }); assert.equal(r.body.legacy_account, true); assert.equal(r.body.email_verified, false); assert.equal(r.body.password_hash, undefined);
});
test('50 plantillas Brevo incluyen remitente verificado', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/brevo.service.ts'), 'utf8');
  assert.match(source, /sender: \{ name: config\.senderName, email: config\.senderEmail \}/);
});
test('51 Brevo conserva messageId del proveedor', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/brevo.service.ts'), 'utf8');
  assert.match(source, /messageId: responsePayload\?\.messageId \|\| null/);
});
test('52 migración permite email NULL solo para transición legacy', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sidro_auth_phase4.sql'), 'utf8');
  assert.match(sql, /ALTER COLUMN email DROP NOT NULL/i);
});
test('53 migración protege unicidad del correo pendiente', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sidro_auth_phase4.sql'), 'utf8');
  assert.match(sql, /UNIQUE INDEX IF NOT EXISTS sidro_client_accounts_pending_email_lower_idx/i);
});
test('54 migración habilita RLS en eventos de seguridad', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sidro_auth_phase4.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE public\.sidro_security_events ENABLE ROW LEVEL SECURITY/i);
});
test('55 rutas privadas conservan requireSidroClient', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/sidro.routes.ts'), 'utf8');
  assert.match(source, /router\.use\(verifyToken, requireSidroClient\)/);
});
