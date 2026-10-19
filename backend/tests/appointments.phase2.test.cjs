const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

let queryHandler = async () => ({ rows: [], rowCount: 0 });
const queries = [];
const fakePool = {
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

const dbPath = require.resolve('../dist/database/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { __esModule: true, default: fakePool } };

const businessTime = require('../dist/utils/businessTime.js');
const { AvailabilityEngine } = require('../dist/services/availability.engine.js');
const { AppointmentService } = require('../dist/services/appointment.service.js');
const { SidroRequestAppointmentsService } = require('../dist/services/sidroRequestAppointments.service.js');
const { SidroAppointmentReconciliationService } = require('../dist/services/sidroAppointmentReconciliation.service.js');

const SRC = path.resolve(__dirname, '../src');
const read = (relative) => fs.readFileSync(path.join(SRC, relative), 'utf8');
const serviceA = '11111111-1111-4111-8111-111111111111';
const serviceB = '22222222-2222-4222-8222-222222222222';

const availabilityFixture = ({ appointments = [], requests = [], blocks = [], schedule = [{ start_time: '09:00:00', end_time: '18:00:00' }], durations = {} } = {}) => {
  queryHandler = async (sql, params) => {
    if (/WITH requested_services/i.test(sql)) return {
      rows: params[0].map((id, index) => ({
        service_id: id, service_name: `Servicio ${index + 1}`,
        duration_minutes: durations[id]?.duration ?? 60,
        padding_minutes: durations[id]?.padding ?? 0,
        total_minutes: (durations[id]?.duration ?? 60) + (durations[id]?.padding ?? 0), position: index + 1
      }))
    };
    if (/FROM sidro_employee_schedules/i.test(sql)) return { rows: schedule };
    if (/FROM sidro_employee_blocks/i.test(sql)) return { rows: blocks };
    if (/WITH bounds AS/i.test(sql)) return { rows: appointments };
    if (/FROM sidro_appointment_requests/i.test(sql)) return { rows: requests };
    return { rows: [], rowCount: 0 };
  };
};

test.beforeEach(() => { queries.length = 0; availabilityFixture(); });

test('1. una cita POS historica es considerada por disponibilidad', async () => {
  availabilityFixture({ appointments: [{ start_minute: 600, end_minute: 660 }] });
  const slots = await AvailabilityEngine.getAvailableSlots(serviceA, 'employee-old', '2030-12-12');
  assert.ok(!slots.includes('10:00'));
});

test('2. una cita 15:00-16:00 bloquea 14:30, 15:00 y 15:30', async () => {
  availabilityFixture({ appointments: [{ start_minute: 900, end_minute: 960 }] });
  const slots = await AvailabilityEngine.getAvailableSlots(serviceA, 7, '2030-12-12');
  for (const blocked of ['14:30', '15:00', '15:30']) assert.ok(!slots.includes(blocked));
  assert.ok(slots.includes('14:00') && slots.includes('16:00'));
});

test('3. la consulta POS fija explicitamente America/Guayaquil', async () => {
  await AvailabilityEngine.getAvailableSlots(serviceA, 7, '2030-12-12');
  const sql = queries.find((q) => /WITH bounds AS/i.test(q.sql)).sql;
  assert.match(sql, /AT TIME ZONE 'America\/Guayaquil'/);
  assert.doesNotMatch(sql, /fecha_inicio::(?:date|time)/i);
});

test('4. una cita que cruza el dia UTC se recorta dentro del dia local', async () => {
  availabilityFixture({ appointments: [{ start_minute: 1200, end_minute: 1260 }] });
  const slots = await AvailabilityEngine.getAvailableSlots(serviceA, 7, '2030-12-12');
  assert.ok(!slots.includes('20:00'));
  assert.match(queries.find((q) => /WITH bounds AS/i.test(q.sql)).sql, /fecha_inicio < bounds\.day_end/);
});

test('5. 15:00 Ecuador se convierte en 20:00Z al crear cita oficial', () => {
  assert.equal(businessTime.localMinutesToInstant('2026-12-12', 15 * 60), '2026-12-12T20:00:00.000Z');
});

const officialClient = (segments) => {
  let nextId = 100;
  const inserted = [];
  const appointmentRows = new Map();
  return {
    inserted,
    async query(sql, params = []) {
      if (/FROM sidro_appointment_request_services/i.test(sql)) return { rows: segments };
      if (/SELECT id FROM employees/i.test(sql)) return { rows: [{ id: params[0] }] };
      if (/SELECT a\.id, a\.employee_id/i.test(sql) && /WHERE a\.id = \$1/i.test(sql)) return { rows: appointmentRows.has(params[0]) ? [appointmentRows.get(params[0])] : [] };
      if (/SELECT DISTINCT c\.id/i.test(sql)) return { rows: [] };
      if (/FROM appointments a/i.test(sql)) return { rows: [] };
      if (/FROM sidro_appointment_requests r/i.test(sql)) return { rows: [] };
      if (/SELECT\s+\(SELECT nombre FROM employees/i.test(sql)) return { rows: [{ emp_name: 'E', item_name: 'S', client_name: 'C' }] };
      if (/INSERT INTO appointments/i.test(sql)) {
        inserted.push(params);
        const row = { id: nextId++, client_id: params[0], item_id: params[1], employee_id: params[2], fecha_inicio: params[3], fecha_fin: params[4], estado: params[5], notas: params[6], emp_name: 'E', item_name: 'S', client_name: 'C' };
        appointmentRows.set(row.id, row);
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }
  };
};

test('6. aprobacion vinculada crea cita oficial y conserva relacion', async () => {
  const client = officialClient([{ service_id: serviceA, service_name: 'A', duration_minutes: 60, padding_minutes: 0, total_minutes: 60, position: 1 }]);
  const ids = await SidroRequestAppointmentsService.createOfficialAppointments(client, { id: 9, service_id: serviceA, employee_id: 7, start_time: '15:00:00' }, 'client', '2026-12-12', 'SIDRO');
  assert.deepEqual(ids, [100]);
  assert.equal(client.inserted[0][3], '2026-12-12T20:00:00.000Z');
});

test('7. aprobacion sin vinculacion valida y conserva una retencion sin insertar', async () => {
  const client = officialClient([{ service_id: serviceA, service_name: 'A', duration_minutes: 60, padding_minutes: 0, total_minutes: 60, position: 1 }]);
  await SidroRequestAppointmentsService.validateOfficialAppointments(client, { id: 9, service_id: serviceA, employee_id: 7, start_time: '15:00:00' }, '2026-12-12');
  assert.equal(client.inserted.length, 0);
});

test('8. la vinculacion posterior usa creacion oficial y marca CONFIRMADA', () => {
  const source = read('controllers/adminSidro.controller.ts');
  assert.match(source, /createOfficialAppointments[\s\S]*status = 'CONFIRMADA'/);
});

test('9. multiples servicios crean segmentos consecutivos con sus relaciones', async () => {
  const client = officialClient([
    { service_id: serviceA, service_name: 'A', duration_minutes: 45, padding_minutes: 15, total_minutes: 60, position: 1 },
    { service_id: serviceB, service_name: 'B', duration_minutes: 30, padding_minutes: 0, total_minutes: 30, position: 2 }
  ]);
  const ids = await SidroRequestAppointmentsService.createOfficialAppointments(client, { id: 9, service_id: serviceA, employee_id: 'uuid-employee', start_time: '15:00' }, 'client', '2026-12-12', 'SIDRO');
  assert.deepEqual(ids, [100, 101]);
  assert.equal(client.inserted[0][4], client.inserted[1][3]);
  assert.equal(client.inserted[1][4], '2026-12-12T21:30:00.000Z');
});

test('10. retencion SIDRO impide una creacion POS incompatible', async () => {
  const client = { query: async (sql) => {
    if (/SELECT id FROM employees/i.test(sql)) return { rows: [{ id: 7 }] };
    if (/FROM appointments a/i.test(sql)) return { rows: [] };
    if (/FROM sidro_appointment_requests r/i.test(sql)) return { rows: [{ item_nombre: 'Color' }] };
    return { rows: [] };
  }};
  await assert.rejects(() => AppointmentService.validateOfficialAppointmentAvailability(client, { employee_id: 7, fecha_inicio: '2026-12-12T20:00:00Z', fecha_fin: '2026-12-12T21:00:00Z' }), /solicitud retenida/);
});

test('11. actualizacion POS reutiliza validacion y excluye su propia cita', () => {
  const source = read('controllers/appointments.controller.ts');
  assert.match(source, /validateOfficialAppointmentAvailability[\s\S]*exclude_appointment_id: id/);
});

test('12. dos creaciones concurrentes para el mismo profesional no se solapan', async () => {
  assert.match(read('controllers/adminSidro.controller.ts'), /FOR UPDATE/);
  assert.match(read('services/appointment.service.ts'), /SELECT id FROM employees WHERE id = \$1 FOR UPDATE/);
  let locked = false;
  const waiters = [];
  const occupied = [];
  const acquire = async () => {
    if (!locked) { locked = true; return; }
    await new Promise((resolve) => waiters.push(resolve));
    locked = true;
  };
  const release = () => {
    locked = false;
    const next = waiters.shift();
    if (next) next();
  };
  const makeClient = () => ({ query: async (sql, params = []) => {
    if (/SELECT id FROM employees/i.test(sql)) { await acquire(); return { rows: [{ id: 7 }] }; }
    if (/FROM appointments a/i.test(sql)) return { rows: occupied.length ? [{ item_nombre: 'A', client_nombre: 'C', fecha_inicio: occupied[0][3], fecha_fin: occupied[0][4] }] : [] };
    if (/FROM sidro_appointment_requests r/i.test(sql)) return { rows: [] };
    if (/SELECT\s+\(SELECT nombre FROM employees/i.test(sql)) return { rows: [{ emp_name: 'E', item_name: 'A', client_name: 'C' }] };
    if (/INSERT INTO appointments/i.test(sql)) { occupied.push(params); return { rows: [{ id: 1 }], rowCount: 1 }; }
    return { rows: [], rowCount: 1 };
  }});
  const create = async () => {
    try {
      return await AppointmentService.createOfficialAppointment(makeClient(), {
        client_id: 'client', item_id: serviceA, employee_id: 7,
        fecha_inicio: '2026-12-12T20:00:00Z', fecha_fin: '2026-12-12T21:00:00Z'
      });
    } finally { release(); }
  };
  const results = await Promise.allSettled([create(), create()]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(occupied.length, 1);
});

test('13. doble clic no puede volver a aprobar una solicitud procesada', () => {
  assert.match(read('controllers/adminSidro.controller.ts'), /peticion\.status !== 'PENDIENTE'/);
});

test('14. PROPUESTA no se confirma por la ruta del horario original', () => {
  const admin = read('controllers/adminSidro.controller.ts');
  const client = read('controllers/sidroAppointments.controller.ts');
  assert.match(admin, /Solo una solicitud pendiente puede aprobarse en su horario original/);
  assert.match(admin, /WHERE id = \$4 AND status = 'PENDIENTE' RETURNING id/);
  assert.match(client, /sidro_account_id = \$2 AND status = 'PROPUESTA'/);
});

test('15. cancelar la ultima cita SIDRO cambia la solicitud a CANCELADA', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM appointments appointment/i.test(sql)) return { rows: [] };
    return { rows: [], rowCount: 1 };
  }};
  await SidroAppointmentReconciliationService.reconcileRequests(client, [4]);
  assert.ok(calls.some((q) => /SET status = 'CANCELADA'/i.test(q.sql)));
});

test('16. eliminar una cita conserva solicitud si queda otro segmento activo', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM appointments appointment/i.test(sql)) return { rows: [{ id: 88 }] };
    return { rows: [], rowCount: 1 };
  }};
  await SidroAppointmentReconciliationService.reconcileRequests(client, [4]);
  assert.ok(calls.some((q) => /SET official_appointment_id = \$1/i.test(q.sql)));
  assert.ok(!calls.some((q) => /SET status = 'CANCELADA'/i.test(q.sql)));
});

test('17. citas CANCELADA no bloquean disponibilidad', () => {
  assert.match(read('services/availability.engine.ts'), /COALESCE\(a\.estado, 'PROGRAMADA'\) <> 'CANCELADA'/);
});

test('18. estado NULL aplica la politica compatible de PROGRAMADA activa', () => {
  const source = read('services/appointment.service.ts');
  assert.match(source, /COALESCE\(a\.estado, 'PROGRAMADA'\) <> 'CANCELADA'/);
});

test('19. employee UUID se pasa sin conversion ni cast de esquema', async () => {
  await AvailabilityEngine.getAvailableSlots(serviceA, 'b3a05bdf-1111-4111-8111-111111111111', '2030-12-12');
  assert.equal(queries.find((q) => /FROM sidro_employee_schedules/i.test(q.sql)).params[0], 'b3a05bdf-1111-4111-8111-111111111111');
});

test('20. employee INTEGER se pasa sin conversion ni cast de esquema', async () => {
  await AvailabilityEngine.getAvailableSlots(serviceA, 27, '2030-12-12');
  assert.equal(queries.find((q) => /FROM sidro_employee_schedules/i.test(q.sql)).params[0], 27);
});

test('21. solicitudes SIDRO mantienen comprobacion de propiedad', () => {
  assert.match(read('controllers/sidroAppointments.controller.ts'), /id = \$1 AND sidro_account_id = \$2/);
});

test('22. rutas POS mantienen requireStaff', () => {
  assert.match(read('routes/appointments.routes.ts'), /router\.use\(verifyToken, requireStaff\)/);
});

test('23. administradores mantienen la accion legitima de aceptar', () => {
  assert.match(read('routes/adminSidro.routes.ts'), /requests\/:id\/accept/);
});

test('24. padding amplia el intervalo completo del servicio', async () => {
  availabilityFixture({ appointments: [{ start_minute: 660, end_minute: 720 }], durations: { [serviceA]: { duration: 45, padding: 15 } } });
  const slots = await AvailabilityEngine.getAvailableSlots(serviceA, 7, '2030-12-12');
  assert.ok(!slots.includes('10:30') && slots.includes('10:00') && slots.includes('12:00'));
});

test('25. horario laboral y bloqueo parcial se respetan', async () => {
  availabilityFixture({ schedule: [{ start_time: '10:00:00', end_time: '13:00:00' }], blocks: [{ start_time: '11:00:00', end_time: '12:00:00', block_type: 'PERSONAL' }] });
  const slots = await AvailabilityEngine.getAvailableSlots(serviceA, 7, '2030-12-12');
  assert.deepEqual(slots, ['10:00', '12:00']);
});

test('26. conversion local es independiente de la zona del proceso Node', () => {
  const modulePath = path.resolve(__dirname, '../dist/utils/businessTime.js');
  const script = `const t=require(${JSON.stringify(modulePath)});process.stdout.write(t.localMinutesToInstant('2026-12-12',900))`;
  const utc = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'UTC' }, encoding: 'utf8' });
  const tokyo = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'Asia/Tokyo' }, encoding: 'utf8' });
  assert.equal(utc, tokyo);
  assert.equal(utc, '2026-12-12T20:00:00.000Z');
});
