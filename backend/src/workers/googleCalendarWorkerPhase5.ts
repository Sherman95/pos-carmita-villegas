import pool from '../database/db';
import { deterministicGoogleEventId } from '../services/googleCalendarOutbox.service';

const MAX_ATTEMPTS = 5;
const STALE_AFTER_MINUTES = 5;
let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = false;

export const googleErrorCode = (error: any): string =>
  String(error?.code || error?.response?.status || error?.cause?.code || 'UNKNOWN').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 64);

export const isTransientGoogleError = (error: any): boolean => {
  const code = googleErrorCode(error).toUpperCase();
  return ['408', '409', '429', '500', '502', '503', '504', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code);
};

export const retryDelaySeconds = (attempts: number): number => Math.min(1800, 30 * (2 ** Math.max(0, attempts - 1)));

async function claimNextJob(client: any): Promise<any | null> {
  const result = await client.query(
    `WITH candidate AS (
       SELECT q.id
       FROM google_calendar_outbox q
       WHERE q.status IN ('PENDING', 'FAILED_RETRY')
         AND q.attempts < $1 AND q.next_attempt_at <= NOW()
       ORDER BY q.id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE google_calendar_outbox q
     SET status = 'PROCESSING', attempts = q.attempts + 1, locked_at = NOW(), updated_at = NOW()
     FROM candidate
     WHERE q.id = candidate.id
     RETURNING q.*`, [MAX_ATTEMPTS]
  );
  return result.rows[0] || null;
}

async function markResult(client: any, id: unknown, status: string, code: string | null = null, detail: string | null = null, delaySeconds = 0) {
  await client.query(
    `UPDATE google_calendar_outbox
     SET status=$2, last_error_code=$3, last_error=$4,
         next_attempt_at=CASE WHEN $5::int > 0 THEN NOW()+($5::text||' seconds')::interval ELSE next_attempt_at END,
         locked_at=NULL, updated_at=NOW()
     WHERE id=$1`, [id, status, code, detail?.slice(0, 500) || null, delaySeconds]
  );
}

async function latestJobIsDifferent(client: any, job: any): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM google_calendar_outbox
     WHERE appointment_key=$1 AND google_calendar_id=$2 AND id>$3
     LIMIT 1`, [job.appointment_key, job.google_calendar_id, job.id]
  );
  return result.rows.length > 0;
}

export async function processCalendarJob(client: any, job: any, calendarApi: any): Promise<void> {
  if (await latestJobIsDifferent(client, job)) {
    await markResult(client, job.id, 'SUPERSEDED');
    return;
  }
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
  const deterministicId = deterministicGoogleEventId(job.appointment_key, job.calendar_id_snapshot);
  const link = (await client.query(
    `SELECT google_event_id FROM appointment_google_events
     WHERE appointment_id=$1 AND google_calendar_id=$2 LIMIT 1`,
    [job.appointment_key, job.google_calendar_id]
  )).rows[0];
  let eventId = link?.google_event_id || payload.googleEventId || deterministicId;
  let operation = job.operation;

  if (operation === 'UPSERT') {
    const current = (await client.query(`SELECT estado FROM appointments WHERE id=$1 LIMIT 1`, [job.appointment_key])).rows[0];
    if (!current || current.estado === 'CANCELADA') operation = 'DELETE';
  }

  if (operation === 'DELETE') {
    try {
      await calendarApi.events.delete({ calendarId: job.calendar_id_snapshot, eventId });
      console.log('[GCAL][WORKER] Evento eliminado', { jobId: job.id, calendarPk: String(job.google_calendar_id) });
    } catch (error: any) {
      if (Number(error?.code || error?.response?.status) !== 404) throw error;
    }
    await client.query(`DELETE FROM appointment_google_events WHERE appointment_id=$1 AND google_calendar_id=$2`, [job.appointment_key, job.google_calendar_id]);
    await markResult(client, job.id, 'COMPLETED');
    return;
  }

  const requestBody = {
    summary: payload.summary,
    description: payload.description || '',
    start: { dateTime: payload.start, timeZone: payload.timeZone || 'America/Guayaquil' },
    end: { dateTime: payload.end, timeZone: payload.timeZone || 'America/Guayaquil' }
  };

  if (link?.google_event_id) {
    try {
      await calendarApi.events.patch({ calendarId: job.calendar_id_snapshot, eventId, requestBody });
      console.log('[GCAL][WORKER] Evento actualizado', { jobId: job.id, calendarPk: String(job.google_calendar_id) });
    } catch (error: any) {
      if (Number(error?.code || error?.response?.status) !== 404) throw error;
      eventId = deterministicId;
      await calendarApi.events.insert({ calendarId: job.calendar_id_snapshot, requestBody: { ...requestBody, id: eventId } });
    }
  } else {
    eventId = deterministicId;
    try {
      await calendarApi.events.insert({ calendarId: job.calendar_id_snapshot, requestBody: { ...requestBody, id: eventId } });
      console.log('[GCAL][WORKER] Evento creado', { jobId: job.id, calendarPk: String(job.google_calendar_id) });
    } catch (error: any) {
      if (Number(error?.code || error?.response?.status) !== 409) throw error;
      await calendarApi.events.patch({ calendarId: job.calendar_id_snapshot, eventId, requestBody });
      console.log('[GCAL][WORKER] Evento remoto recuperado', { jobId: job.id, calendarPk: String(job.google_calendar_id) });
    }
  }

  await client.query(
    `INSERT INTO appointment_google_events (appointment_id,google_calendar_id,google_event_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (appointment_id,google_calendar_id)
     DO UPDATE SET google_event_id=EXCLUDED.google_event_id`,
    [job.appointment_key, job.google_calendar_id, eventId]
  );
  await markResult(client, job.id, 'COMPLETED');
}

export async function processGoogleCalendarQueue(options: { pool?: any; calendarApi?: any; limit?: number } = {}) {
  if (workerRunning && !options.pool) return;
  const db = options.pool || pool;
  const limit = options.limit ?? 10;
  let client: any;
  if (!options.pool) workerRunning = true;
  try {
    client = await db.connect();
    await client.query(
      `UPDATE google_calendar_outbox
       SET status='FAILED_RETRY', next_attempt_at=NOW(), locked_at=NULL,
           last_error_code='STALE_PROCESSING', updated_at=NOW()
       WHERE status='PROCESSING' AND locked_at < NOW()-($1::text||' minutes')::interval`,
      [STALE_AFTER_MINUTES]
    );
    await client.query(
      `UPDATE google_calendar_outbox older SET status='SUPERSEDED',locked_at=NULL,updated_at=NOW()
       WHERE older.status IN ('PENDING','FAILED_RETRY') AND EXISTS (
         SELECT 1 FROM google_calendar_outbox newer
         WHERE newer.appointment_key=older.appointment_key
           AND newer.google_calendar_id=older.google_calendar_id AND newer.id>older.id
       )`
    );

    let calendarApi = options.calendarApi;
    if (!calendarApi) {
      const { getGoogleCalendarClient } = require('../controllers/googleAuth.controller');
      const config = await getGoogleCalendarClient();
      calendarApi = config?.calendar;
    }

    for (let processed = 0; processed < limit; processed++) {
      const job = await claimNextJob(client);
      if (!job) break;
      console.log('[GCAL][WORKER] Procesando', { jobId: job.id, calendarPk: String(job.google_calendar_id), operation: job.operation, attempt: job.attempts });
      if (!calendarApi) {
        await markResult(client, job.id, 'FAILED_PERMANENT', 'GOOGLE_NOT_CONFIGURED', 'Credenciales de Google Calendar no disponibles');
        continue;
      }
      try {
        await processCalendarJob(client, job, calendarApi);
      } catch (error: any) {
        const code = googleErrorCode(error);
        const transient = isTransientGoogleError(error) && Number(job.attempts) < MAX_ATTEMPTS;
        await markResult(client, job.id, transient ? 'FAILED_RETRY' : 'FAILED_PERMANENT', code, error?.message || 'Error de Google Calendar', transient ? retryDelaySeconds(Number(job.attempts)) : 0);
        console.error('[GCAL][WORKER] Fallo de destino', { jobId: job.id, calendarPk: String(job.google_calendar_id), code, retry: transient });
      }
    }
  } catch (error: any) {
    console.error('[GCAL][WORKER] Error general', googleErrorCode(error));
  } finally {
    client?.release?.();
    if (!options.pool) workerRunning = false;
  }
}

export function startGoogleCalendarWorker() {
  if (process.env.GOOGLE_CALENDAR_ENABLED !== 'true') {
    console.log('[GCAL][WORKER] Deshabilitado; define GOOGLE_CALENDAR_ENABLED=true para activarlo');
    return null;
  }
  if (workerTimer) return workerTimer;
  console.log('[GCAL][WORKER] Iniciado (cada 30s)');
  void processGoogleCalendarQueue();
  workerTimer = setInterval(() => void processGoogleCalendarQueue(), 30000);
  workerTimer.unref?.();
  return workerTimer;
}
