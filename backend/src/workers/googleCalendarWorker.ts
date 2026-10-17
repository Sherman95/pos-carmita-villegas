import pool from '../database/db';
import { google } from 'googleapis';

export async function processGoogleCalendarQueue() {
    let client;
    try {
        client = await pool.connect();

        // Recuperar trabajos atascados
        await client.query(`
            UPDATE google_calendar_sync_queue
            SET status = 'PENDING'
            WHERE status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '5 minutes'
        `);

        // 1. Obtener tareas pendientes (SKIP LOCKED para concurrencia)
        const { rows: jobs } = await client.query(
            `SELECT q.*,
                    a.client_id, a.item_id, a.fecha_inicio, a.fecha_fin, a.notas,
                    e.nombre as emp_name,
                    i.nombre as item_name,
                    c.nombre as client_name
             FROM google_calendar_sync_queue q
             JOIN appointments a ON q.appointment_id = a.id
             JOIN employees e ON a.employee_id = e.id
             JOIN items i ON a.item_id = i.id
             JOIN clients c ON a.client_id = c.id
             WHERE q.status = 'PENDING' OR (q.status = 'FAILED' AND q.attempts < 3)
             ORDER BY q.created_at ASC
             FOR UPDATE OF q SKIP LOCKED
             LIMIT 10`
        );

        if (jobs.length === 0) {
            return;
        }

        const { getGoogleCalendarClient } = require('../controllers/googleAuth.controller');
        const googleConfig = await getGoogleCalendarClient();
        if (!googleConfig) {
            return;
        }

        for (const job of jobs) {
            try {
                // Marcar como procesando
                await client.query(`UPDATE google_calendar_sync_queue SET status = 'PROCESSING', attempts = attempts + 1, updated_at = NOW() WHERE id = $1`, [job.id]);

                const { rows: cals } = await client.query(
                    'SELECT id, calendar_id FROM google_calendars WHERE employee_id IS NULL OR employee_id = $1',
                    [job.employee_id]
                );

                for (const cal of cals) {
                    // Evitar duplicados (idempotencia)
                    const { rows: existing } = await client.query(
                        'SELECT * FROM appointment_google_events WHERE appointment_id = $1 AND google_calendar_id = $2',
                        [job.appointment_id, cal.id]
                    );

                    if (existing.length > 0) continue; // Ya fue sincronizado en este calendario

                    const deterministicId = `sidro${job.appointment_id.replace(/-/g, '')}${cal.id}`.toLowerCase().replace(/[^a-v0-9]/g, '');

                    // pg devuelve la fecha interpretada en la zona horaria del servidor.
                    // Extraemos los componentes numéricos locales y agregamos el offset de Ecuador.
                    const getLocalStr = (d: Date) => {
                        const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
                        const hh = String(d.getHours()).padStart(2,'0'), min = String(d.getMinutes()).padStart(2,'0'), ss = String(d.getSeconds()).padStart(2,'0');
                        return `${y}-${m}-${dd}T${hh}:${min}:${ss}-05:00`;
                    };

                    try {
                        const response = await googleConfig.calendar.events.insert({
                            calendarId: cal.calendar_id,
                            requestBody: {
                                id: deterministicId,
                                summary: `[${job.emp_name}] ${job.item_name} - ${job.client_name}`,
                                description: job.notas || '',
                                start: { dateTime: getLocalStr(new Date(job.fecha_inicio)), timeZone: 'America/Guayaquil' },
                                end: { dateTime: getLocalStr(new Date(job.fecha_fin)), timeZone: 'America/Guayaquil' }
                            }
                        });

                        if (response.data.id) {
                            await client.query(
                                'INSERT INTO appointment_google_events (appointment_id, google_calendar_id, google_event_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                                [job.appointment_id, cal.id, response.data.id]
                            );
                        }
                    } catch (gErr: any) {
                        if (gErr.code === 409) {
                            // Ya existe en Google Calendar (crash previo del backend tras crear el evento)
                            await client.query(
                                'INSERT INTO appointment_google_events (appointment_id, google_calendar_id, google_event_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                                [job.appointment_id, cal.id, deterministicId]
                            );
                        } else {
                            throw gErr; // Repropagar para fallar el job
                        }
                    }
                }

                await client.query(`UPDATE google_calendar_sync_queue SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`, [job.id]);
            } catch (jobError: any) {
                console.error(`Error procesando sync queue ID ${job.id}:`, jobError.message);
                await client.query(`UPDATE google_calendar_sync_queue SET status = 'FAILED', updated_at = NOW() WHERE id = $1`, [job.id]);
            }
        }
    } catch (err: any) {
        console.error('Error general en worker de Google Calendar:', err.message);
    } finally {
        if (client) client.release();
    }
}

export function startGoogleCalendarWorker() {
    if (process.env.GOOGLE_CALENDAR_ENABLED === 'false') {
        console.log('[WORKER] Google Calendar deshabilitado para este entorno');
        return;
    }
    console.log('[WORKER] 🚀 Iniciando worker de Google Calendar (cada 30s)');
    setInterval(processGoogleCalendarQueue, 30000);
}
