import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';
import { BUSINESS_TIME_ZONE } from '../utils/businessTime';

export type CalendarOperation = 'UPSERT' | 'DELETE';

export interface CalendarEventPayload {
  summary: string;
  description: string;
  start: string;
  end: string;
  timeZone: string;
  googleEventId?: string | null;
}

const isoInstant = (value: unknown): string => {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error('Instante de cita inválido para Google Calendar');
  return date.toISOString();
};

export const normalizeCalendarKey = (value: unknown): string => String(value ?? '').trim();

export const deterministicGoogleEventId = (appointmentId: unknown, remoteCalendarId: unknown): string => {
  const seed = `${normalizeCalendarKey(appointmentId)}|${normalizeCalendarKey(remoteCalendarId).toLowerCase()}`;
  return `sidro${createHash('sha256').update(seed).digest('hex')}`;
};

const dedupeKey = (appointmentKey: string, calendarPk: unknown, operation: CalendarOperation, payload: CalendarEventPayload): string =>
  createHash('sha256').update(JSON.stringify({ appointmentKey, calendarPk: String(calendarPk), operation, payload })).digest('hex');

export class GoogleCalendarOutboxService {
  private static async enqueueDestination(
    client: PoolClient,
    appointmentKey: string,
    calendar: { id: string | number; calendar_id: string; google_event_id?: string | null },
    operation: CalendarOperation,
    payload: CalendarEventPayload
  ): Promise<boolean> {
    const finalPayload = { ...payload, googleEventId: calendar.google_event_id || payload.googleEventId || null };
    const key = dedupeKey(appointmentKey, calendar.id, operation, finalPayload);
    const inserted = await client.query(
      `INSERT INTO google_calendar_outbox
         (appointment_key, google_calendar_id, calendar_id_snapshot, operation, payload, dedupe_key)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [appointmentKey, calendar.id, calendar.calendar_id, operation, JSON.stringify(finalPayload), key]
    );
    if (!inserted.rows.length) return false;

    await client.query(
      `UPDATE google_calendar_outbox
       SET status = 'SUPERSEDED', updated_at = NOW()
       WHERE appointment_key = $1 AND google_calendar_id = $2
         AND id < $3 AND status IN ('PENDING', 'FAILED_RETRY')`,
      [appointmentKey, calendar.id, inserted.rows[0].id]
    );
    console.log('[GCAL][OUTBOX] Trabajo creado', { jobId: inserted.rows[0].id, appointmentKey, calendarPk: String(calendar.id), operation });
    return true;
  }

  static async enqueueForAppointment(client: PoolClient, appointmentId: unknown, forcedOperation?: CalendarOperation): Promise<number> {
    const appointmentKey = normalizeCalendarKey(appointmentId);
    if (!appointmentKey) throw new Error('appointment_id inválido para Calendar');
    const appointment = (await client.query(
      `SELECT a.id, a.employee_id, a.fecha_inicio, a.fecha_fin, a.estado, a.notas,
              e.nombre AS emp_name, i.nombre AS item_name, c.nombre AS client_name
       FROM appointments a
       LEFT JOIN employees e ON e.id = a.employee_id
       LEFT JOIN items i ON i.id = a.item_id
       LEFT JOIN clients c ON c.id = a.client_id
       WHERE a.id = $1`, [appointmentId]
    )).rows[0];
    if (!appointment) throw new Error('Cita no encontrada para sincronización Calendar');

    const calendars = (await client.query(
      `SELECT DISTINCT c.id, c.calendar_id, linked.google_event_id,
              (c.employee_id IS NULL OR c.employee_id = $2) AS eligible
       FROM google_calendars c
       LEFT JOIN appointment_google_events linked
         ON linked.google_calendar_id = c.id AND linked.appointment_id = $1
       WHERE c.employee_id IS NULL OR c.employee_id = $2 OR linked.id IS NOT NULL
       ORDER BY c.id`, [appointmentId, appointment.employee_id]
    )).rows;

    if (!calendars.length) {
      console.warn('[GCAL][OUTBOX] No hay calendarios configurados; la cita queda solo en POS', { appointmentKey });
      return 0;
    }

    const payload: CalendarEventPayload = {
      summary: `[${appointment.emp_name || 'Profesional'}] ${appointment.item_name || 'Servicio'} - ${appointment.client_name || 'Clienta'}`,
      description: appointment.notas || '',
      start: isoInstant(appointment.fecha_inicio),
      end: isoInstant(appointment.fecha_fin),
      timeZone: BUSINESS_TIME_ZONE
    };
    let count = 0;
    for (const calendar of calendars) {
      const operation: CalendarOperation = forcedOperation || appointment.estado === 'CANCELADA' || !calendar.eligible ? 'DELETE' : 'UPSERT';
      if (await this.enqueueDestination(client, appointmentKey, calendar, operation, payload)) count++;
    }
    return count;
  }

  static async enqueueForCalendar(client: PoolClient, appointmentId: unknown, googleCalendarId: unknown): Promise<boolean> {
    const appointmentKey = normalizeCalendarKey(appointmentId);
    const row = (await client.query(
      `SELECT a.id, a.fecha_inicio, a.fecha_fin, a.estado, a.notas,
              e.nombre AS emp_name, i.nombre AS item_name, c.nombre AS client_name,
              gc.id AS google_calendar_id, gc.calendar_id, linked.google_event_id
       FROM appointments a
       JOIN google_calendars gc ON gc.id = $2
       LEFT JOIN appointment_google_events linked ON linked.appointment_id = a.id AND linked.google_calendar_id = gc.id
       LEFT JOIN employees e ON e.id = a.employee_id
       LEFT JOIN items i ON i.id = a.item_id
       LEFT JOIN clients c ON c.id = a.client_id
       WHERE a.id = $1`, [appointmentId, googleCalendarId]
    )).rows[0];
    if (!row) return false;
    const payload: CalendarEventPayload = {
      summary: `[${row.emp_name || 'Profesional'}] ${row.item_name || 'Servicio'} - ${row.client_name || 'Clienta'}`,
      description: row.notas || '', start: isoInstant(row.fecha_inicio), end: isoInstant(row.fecha_fin),
      timeZone: BUSINESS_TIME_ZONE, googleEventId: row.google_event_id
    };
    return this.enqueueDestination(client, appointmentKey, { id: row.google_calendar_id, calendar_id: row.calendar_id, google_event_id: row.google_event_id }, row.estado === 'CANCELADA' ? 'DELETE' : 'UPSERT', payload);
  }

  static async enqueueCalendarRemoval(client: PoolClient, googleCalendarId: unknown): Promise<number> {
    const calendar = (await client.query(
      `SELECT id, calendar_id FROM google_calendars WHERE id = $1 FOR UPDATE`,
      [googleCalendarId]
    )).rows[0];
    if (!calendar) return 0;

    const links = (await client.query(
      `SELECT linked.appointment_id, linked.google_event_id,
              a.fecha_inicio, a.fecha_fin, a.notas,
              e.nombre AS emp_name, i.nombre AS item_name, c.nombre AS client_name
       FROM appointment_google_events linked
       LEFT JOIN appointments a ON a.id = linked.appointment_id
       LEFT JOIN employees e ON e.id = a.employee_id
       LEFT JOIN items i ON i.id = a.item_id
       LEFT JOIN clients c ON c.id = a.client_id
       WHERE linked.google_calendar_id = $1
       ORDER BY linked.appointment_id`,
      [googleCalendarId]
    )).rows;

    let queued = 0;
    for (const link of links) {
      const appointmentKey = normalizeCalendarKey(link.appointment_id);
      const payload: CalendarEventPayload = {
        summary: `[${link.emp_name || 'Profesional'}] ${link.item_name || 'Servicio'} - ${link.client_name || 'Clienta'}`,
        description: link.notas || '',
        start: link.fecha_inicio ? isoInstant(link.fecha_inicio) : new Date(0).toISOString(),
        end: link.fecha_fin ? isoInstant(link.fecha_fin) : new Date(0).toISOString(),
        timeZone: BUSINESS_TIME_ZONE,
        googleEventId: link.google_event_id
      };
      if (await this.enqueueDestination(
        client,
        appointmentKey,
        { id: calendar.id, calendar_id: calendar.calendar_id, google_event_id: link.google_event_id },
        'DELETE',
        payload
      )) queued++;
    }
    return queued;
  }
}
