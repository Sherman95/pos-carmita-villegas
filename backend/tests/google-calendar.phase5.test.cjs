const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

process.env.JWT_SECRET = 'phase5-local-test-secret-with-at-least-32-characters';
process.env.GOOGLE_CALENDAR_ENABLED = 'false';

const outbox = require('../dist/services/googleCalendarOutbox.service.js');
const worker = require('../dist/workers/googleCalendarWorkerPhase5.js');
const appointmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const appointment = {
  id: appointmentId, employee_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  fecha_inicio: new Date('2026-12-12T20:00:00.000Z'), fecha_fin: new Date('2026-12-12T21:00:00.000Z'),
  estado: 'PROGRAMADA', notas: 'Detalle', emp_name: 'Profesional', item_name: 'Servicio', client_name: 'Clienta'
};
const calendars = [1, 2, 3].map(id => ({ id, calendar_id: `general${id}@example.invalid`, eligible: true, google_event_id: null }));

function outboxClient(options = {}) {
  let insertId = 0;
  const calls = [];
  const client = { calls, async query(sql, params = []) {
    calls.push({ sql: String(sql), params });
    if (/JOIN google_calendars gc/.test(sql)) return { rows: [options.manualRow || { ...appointment, google_calendar_id: 1, calendar_id: calendars[0].calendar_id, google_event_id: null }] };
    if (/FROM appointments a/.test(sql) && /WHERE a.id/.test(sql)) return { rows: [options.appointment || appointment] };
    if (/SELECT DISTINCT c.id/.test(sql)) return { rows: options.calendars ?? calendars };
    if (/INSERT INTO google_calendar_outbox/.test(sql)) {
      if (options.duplicate) return { rows: [] };
      return { rows: [{ id: ++insertId }] };
    }
    return { rows: [], rowCount: 0 };
  }};
  return client;
}

function jobClient({ link = null, current = { estado: 'PROGRAMADA' }, newer = false } = {}) {
  const calls = [];
  return { calls, async query(sql, params = []) {
    calls.push({ sql: String(sql), params });
    if (/SELECT 1 FROM google_calendar_outbox/.test(sql)) return { rows: newer ? [{ '?column?': 1 }] : [] };
    if (/SELECT google_event_id FROM appointment_google_events/.test(sql)) return { rows: link ? [{ google_event_id: link }] : [] };
    if (/SELECT estado FROM appointments/.test(sql)) return { rows: current ? [current] : [] };
    return { rows: [], rowCount: 1 };
  }};
}

const baseJob = (overrides = {}) => ({
  id: 1, appointment_key: appointmentId, google_calendar_id: 1,
  calendar_id_snapshot: calendars[0].calendar_id, operation: 'UPSERT', attempts: 1,
  payload: { summary: '[Profesional] Servicio - Clienta', description: 'Detalle', start: '2026-12-12T20:00:00.000Z', end: '2026-12-12T21:00:00.000Z', timeZone: 'America/Guayaquil', googleEventId: null },
  ...overrides
});
const api = () => ({ events: { insert: async () => ({ data: { id: 'remote' } }), patch: async () => ({}), delete: async () => ({}) } });

function queuePool(initialJobs, current = { estado: 'PROGRAMADA' }) {
  const jobs = initialJobs.map(job => ({ status: 'PENDING', attempts: 0, ...job }));
  const calls = [];
  const client = { calls, async query(sql, params = []) {
    calls.push({ sql: String(sql), params });
    if (/last_error_code='STALE_PROCESSING'/.test(sql)) {
      for (const job of jobs.filter(x => x.status === 'PROCESSING')) job.status = 'FAILED_RETRY';
      return { rows: [], rowCount: 0 };
    }
    if (/UPDATE google_calendar_outbox older/.test(sql)) return { rows: [], rowCount: 0 };
    if (/WITH candidate AS/.test(sql)) {
      const job = jobs.find(x => ['PENDING', 'FAILED_RETRY'].includes(x.status) && x.attempts < 5);
      if (!job) return { rows: [] };
      job.status = 'PROCESSING';
      job.attempts++;
      return { rows: [{ ...job }] };
    }
    if (/SELECT 1 FROM google_calendar_outbox/.test(sql)) return { rows: [] };
    if (/SELECT google_event_id FROM appointment_google_events/.test(sql)) return { rows: [] };
    if (/SELECT estado FROM appointments/.test(sql)) return { rows: current ? [current] : [] };
    if (/UPDATE google_calendar_outbox\s+SET status=\$2/.test(sql)) {
      const job = jobs.find(x => x.id === params[0]);
      Object.assign(job, { status: params[1], last_error_code: params[2], last_error: params[3] });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }, release() {} };
  return { jobs, calls, connect: async () => client };
}

test.after(async () => {
  await require('../dist/database/db.js').default.end();
});

test('01 normaliza appointment UUID como texto', () => assert.equal(outbox.normalizeCalendarKey(appointmentId), appointmentId));
test('02 normaliza appointment INTEGER como texto', () => assert.equal(outbox.normalizeCalendarKey(42), '42'));
test('03 eventId determinista es estable', () => assert.equal(outbox.deterministicGoogleEventId(42, 'a@b.com'), outbox.deterministicGoogleEventId('42', 'A@B.COM')));
test('04 eventId cambia por calendario', () => assert.notEqual(outbox.deterministicGoogleEventId(42, 'a@b.com'), outbox.deterministicGoogleEventId(42, 'c@d.com')));
test('05 eventId solo usa caracteres admitidos por Google', () => assert.match(outbox.deterministicGoogleEventId(42, 'a@b.com'), /^[a-v0-9]+$/));
test('06 cita crea un destino para cada uno de tres calendarios', async () => { const c = outboxClient(); assert.equal(await outbox.GoogleCalendarOutboxService.enqueueForAppointment(c, appointmentId), 3); });
test('07 cita sin calendarios no se marca falsamente como sincronizada', async () => { const c = outboxClient({ calendars: [] }); assert.equal(await outbox.GoogleCalendarOutboxService.enqueueForAppointment(c, appointmentId), 0); });
test('08 cita cancelada genera DELETE por destino', async () => { const c = outboxClient({ appointment: { ...appointment, estado: 'CANCELADA' } }); await outbox.GoogleCalendarOutboxService.enqueueForAppointment(c, appointmentId); assert.equal(c.calls.filter(x => /INSERT INTO google_calendar_outbox/.test(x.sql)).every(x => x.params[3] === 'DELETE'), true); });
test('09 calendario específico anterior recibe DELETE al dejar de ser elegible', async () => { const c = outboxClient({ calendars: [{ ...calendars[0], eligible: false, google_event_id: 'old' }] }); await outbox.GoogleCalendarOutboxService.enqueueForAppointment(c, appointmentId); assert.equal(c.calls.find(x => /INSERT INTO google_calendar_outbox/.test(x.sql)).params[3], 'DELETE'); });
test('10 operación repetida usa dedupe_key y no duplica trabajo', async () => { const c = outboxClient({ duplicate: true }); assert.equal(await outbox.GoogleCalendarOutboxService.enqueueForAppointment(c, appointmentId), 0); });
test('11 payload conserva instante absoluto 15:00 Ecuador igual a 20:00Z', async () => { const c = outboxClient(); await outbox.GoogleCalendarOutboxService.enqueueForAppointment(c, appointmentId); const payload = JSON.parse(c.calls.find(x => /INSERT INTO google_calendar_outbox/.test(x.sql)).params[4]); assert.equal(payload.start, '2026-12-12T20:00:00.000Z'); });
test('12 payload declara America/Guayaquil', async () => { const c = outboxClient(); await outbox.GoogleCalendarOutboxService.enqueueForAppointment(c, appointmentId); assert.equal(JSON.parse(c.calls.find(x => /INSERT INTO google_calendar_outbox/.test(x.sql)).params[4]).timeZone, 'America/Guayaquil'); });
test('13 sincronización manual comparte el outbox', async () => { const c = outboxClient(); assert.equal(await outbox.GoogleCalendarOutboxService.enqueueForCalendar(c, appointmentId, 1), true); });

test('14 worker crea evento y vínculo local', async () => { const c = jobClient(); let inserts = 0; const a = api(); a.events.insert = async () => { inserts++; return { data: { id: 'ignored-deterministic' } }; }; await worker.processCalendarJob(c, baseJob(), a); assert.equal(inserts, 1); assert.ok(c.calls.some(x => /INSERT INTO appointment_google_events/.test(x.sql))); });
test('15 worker actualiza evento vinculado conservando ID', async () => { const c = jobClient({ link: 'existing-event' }); let patched; const a = api(); a.events.patch = async x => { patched = x; }; await worker.processCalendarJob(c, baseJob(), a); assert.equal(patched.eventId, 'existing-event'); });
test('16 crash tras aceptación remota se recupera ante 409', async () => { const c = jobClient(); let patches = 0; const a = api(); a.events.insert = async () => { throw { code: 409 }; }; a.events.patch = async () => { patches++; }; await worker.processCalendarJob(c, baseJob(), a); assert.equal(patches, 1); assert.ok(c.calls.some(x => /INSERT INTO appointment_google_events/.test(x.sql))); });
test('17 DELETE elimina únicamente el evento de su calendario', async () => { const c = jobClient({ link: 'event-one' }); let removed; const a = api(); a.events.delete = async x => { removed = x; }; await worker.processCalendarJob(c, baseJob({ operation: 'DELETE' }), a); assert.equal(removed.calendarId, calendars[0].calendar_id); assert.equal(removed.eventId, 'event-one'); });
test('18 DELETE considera 404 como estado final idempotente', async () => { const c = jobClient({ link: 'missing' }); const a = api(); a.events.delete = async () => { throw { code: 404 }; }; await worker.processCalendarJob(c, baseJob({ operation: 'DELETE' }), a); assert.ok(c.calls.some(x => /status=\$2/.test(x.sql) && x.params[1] === 'COMPLETED')); });
test('19 trabajo UPSERT antiguo no recrea cita cancelada', async () => { const c = jobClient({ current: { estado: 'CANCELADA' } }); let deleted = 0; const a = api(); a.events.delete = async () => { deleted++; }; await worker.processCalendarJob(c, baseJob(), a); assert.equal(deleted, 1); });
test('20 trabajo UPSERT antiguo no recrea cita eliminada', async () => { const c = jobClient({ current: null }); let deleted = 0; const a = api(); a.events.delete = async () => { deleted++; }; await worker.processCalendarJob(c, baseJob(), a); assert.equal(deleted, 1); });
test('21 trabajo anterior se marca SUPERSEDED si existe uno nuevo', async () => { const c = jobClient({ newer: true }); let called = 0; const a = api(); a.events.insert = async () => { called++; }; await worker.processCalendarJob(c, baseJob(), a); assert.equal(called, 0); assert.ok(c.calls.some(x => x.params[1] === 'SUPERSEDED')); });
test('22 error 429 es temporal', () => assert.equal(worker.isTransientGoogleError({ code: 429 }), true));
test('23 error de red es temporal', () => assert.equal(worker.isTransientGoogleError({ code: 'ECONNRESET' }), true));
test('24 error 403 de permisos es permanente', () => assert.equal(worker.isTransientGoogleError({ code: 403 }), false));
test('25 backoff crece y tiene límite', () => { assert.equal(worker.retryDelaySeconds(1), 30); assert.equal(worker.retryDelaySeconds(3), 120); assert.equal(worker.retryDelaySeconds(20), 1800); });

test('26 worker usa SKIP LOCKED para múltiples instancias', () => { const s = fs.readFileSync(path.join(__dirname, '../src/workers/googleCalendarWorkerPhase5.ts'), 'utf8'); assert.match(s, /FOR UPDATE SKIP LOCKED/); });
test('27 worker recupera PROCESSING atascados', () => { const s = fs.readFileSync(path.join(__dirname, '../src/workers/googleCalendarWorkerPhase5.ts'), 'utf8'); assert.match(s, /STALE_PROCESSING/); });
test('28 worker solo arranca con habilitación explícita', () => { const s = fs.readFileSync(path.join(__dirname, '../src/workers/googleCalendarWorkerPhase5.ts'), 'utf8'); assert.match(s, /GOOGLE_CALENDAR_ENABLED !== 'true'/); });
test('29 actualización y eliminación POS ya no llaman Google directamente', () => { const s = fs.readFileSync(path.join(__dirname, '../src/controllers/appointments.controller.ts'), 'utf8'); assert.doesNotMatch(s, /calendar\.events\.(patch|delete)/); assert.match(s, /GoogleCalendarOutboxService\.enqueueForAppointment/); });
test('30 rutas administrativas Calendar conservan autorizacion administrativa', () => { const s = fs.readFileSync(path.join(__dirname, '../src/routes/auth.routes.ts'), 'utf8'); assert.match(s, /google\/calendar.*requireStaff, requirePermission\(PERMISSIONS\.integrationsManage\)/); });
test('31 solicitudes pendientes no crean citas oficiales', () => { const s = fs.readFileSync(path.join(__dirname, '../src/controllers/sidroAppointments.controller.ts'), 'utf8'); assert.doesNotMatch(s.slice(s.indexOf('export const createRequest'), s.indexOf('export const getMyRequests')), /createOfficialAppointment/); });
test('32 multiservicio crea una cita oficial por segmento', () => { const s = fs.readFileSync(path.join(__dirname, '../src/services/sidroRequestAppointments.service.ts'), 'utf8'); assert.match(s, /for \(const segment of segments\)/); assert.match(s, /AppointmentService\.createOfficialAppointment/); });
test('33 desconectar calendario encola borrados y no llama Google en HTTP', () => { const s = fs.readFileSync(path.join(__dirname, '../src/controllers/googleAuth.controller.ts'), 'utf8'); const fragment = s.slice(s.indexOf('export const deleteCalendar'), s.indexOf('export const syncAllAppointments')); assert.match(fragment, /enqueueCalendarRemoval/); assert.doesNotMatch(fragment, /calendar\.events\.delete/); });
test('34 desconexión crea un DELETE independiente por vínculo', async () => {
  let insertId = 0;
  const calls = [];
  const c = { calls, async query(sql, params = []) {
    calls.push({ sql: String(sql), params });
    if (/SELECT id, calendar_id FROM google_calendars/.test(sql)) return { rows: [{ id: 7, calendar_id: 'remove@example.invalid' }] };
    if (/FROM appointment_google_events linked/.test(sql)) return { rows: [
      { ...appointment, appointment_id: appointmentId, google_event_id: 'event-a' },
      { ...appointment, appointment_id: 42, google_event_id: 'event-b' }
    ] };
    if (/INSERT INTO google_calendar_outbox/.test(sql)) return { rows: [{ id: ++insertId }] };
    return { rows: [], rowCount: 1 };
  }};
  assert.equal(await outbox.GoogleCalendarOutboxService.enqueueCalendarRemoval(c, 7), 2);
  const inserts = calls.filter(x => /INSERT INTO google_calendar_outbox/.test(x.sql));
  assert.deepEqual(inserts.map(x => x.params[3]), ['DELETE', 'DELETE']);
  assert.deepEqual(inserts.map(x => JSON.parse(x.params[4]).googleEventId), ['event-a', 'event-b']);
});
test('35 UTC y Ecuador producen el mismo instante absoluto', () => {
  const script = `process.stdout.write(new Date('2026-12-12T20:00:00.000Z').toISOString())`;
  const run = tz => execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.equal(run('UTC'), run('America/Guayaquil'));
});
test('36 falla un calendario sin impedir completar los otros dos', async () => {
  const pool = queuePool([1, 2, 3].map(id => baseJob({ id, google_calendar_id: id, calendar_id_snapshot: calendars[id - 1].calendar_id })));
  const a = api();
  a.events.insert = async ({ calendarId }) => { if (calendarId === calendars[1].calendar_id) throw { code: 403, message: 'permission denied' }; return { data: {} }; };
  await worker.processGoogleCalendarQueue({ pool, calendarApi: a, limit: 3 });
  assert.deepEqual(pool.jobs.map(x => x.status), ['COMPLETED', 'FAILED_PERMANENT', 'COMPLETED']);
  assert.equal(pool.jobs[1].last_error_code, '403');
});
test('37 fallo temporal queda en reintento y después completa', async () => {
  const pool = queuePool([baseJob({ attempts: 0 })]);
  const first = api(); first.events.insert = async () => { throw { code: 503, message: 'temporary' }; };
  await worker.processGoogleCalendarQueue({ pool, calendarApi: first, limit: 1 });
  assert.equal(pool.jobs[0].status, 'FAILED_RETRY');
  await worker.processGoogleCalendarQueue({ pool, calendarApi: api(), limit: 1 });
  assert.equal(pool.jobs[0].status, 'COMPLETED');
  assert.equal(pool.jobs[0].attempts, 2);
});
test('38 falta de credenciales queda como error permanente controlado', async () => {
  const pool = queuePool([baseJob()]);
  await worker.processGoogleCalendarQueue({ pool, limit: 1 });
  assert.equal(pool.jobs[0].status, 'FAILED_PERMANENT');
  assert.equal(pool.jobs[0].last_error_code, 'GOOGLE_NOT_CONFIGURED');
});
test('39 reinicio recupera PROCESSING y termina el trabajo', async () => {
  const pool = queuePool([baseJob({ status: 'PROCESSING', attempts: 1 })]);
  await worker.processGoogleCalendarQueue({ pool, calendarApi: api(), limit: 1 });
  assert.equal(pool.jobs[0].status, 'COMPLETED');
  assert.equal(pool.jobs[0].attempts, 2);
});
