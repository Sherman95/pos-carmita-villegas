import { Request, Response } from 'express';
import { google } from 'googleapis';
import path from 'path';
import pool from '../database/db';
import { GoogleCalendarOutboxService } from '../services/googleCalendarOutbox.service';

export const getGoogleCalendarClient = async () => {
    if (process.env.GOOGLE_CALENDAR_ENABLED === 'false') {
        return null;
    }

    const possiblePaths = [
        process.env.GOOGLE_CREDENTIALS_PATH,
        path.join(__dirname, '../../google-credentials.json'),
        '/etc/secrets/google-credentials.json'
    ];

    const keyFile = possiblePaths.find(p => p && require('fs').existsSync(p));
    if (!keyFile) return null;

    const auth = new google.auth.GoogleAuth({
        keyFile: keyFile,
        scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar'],
    });

    const calendar = google.calendar({ version: 'v3', auth });
    return { calendar, auth };
};

export const getCalendars = async (req: Request, res: Response) => {
    try {
        const { rows } = await pool.query(`
            SELECT c.*, e.nombre as employee_nombre
            FROM google_calendars c
            LEFT JOIN employees e ON c.employee_id = e.id
            ORDER BY c.created_at DESC
        `);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching calendars:', error);
        res.status(500).json({ error: 'Error verificando estado' });
    }
};

export const addCalendar = async (req: Request, res: Response) => {
    const { calendarId, employeeId, description } = req.body;
    try {
        if (!calendarId) {
             return res.status(400).json({ error: 'calendarId es requerido' });
        }

        const googleConfig = await getGoogleCalendarClient();
        if (!googleConfig) throw new Error('Archivo de credenciales (google-credentials.json) no encontrado.');

        // Verify calendar permissions
        await googleConfig.calendar.events.list({ calendarId, maxResults: 1 });

        const empId = employeeId ? employeeId : null;

        const { rows } = await pool.query(
            `INSERT INTO google_calendars (calendar_id, employee_id, description)
             VALUES ($1, $2, $3) RETURNING *`,
            [calendarId, empId, description || '']
        );

        res.status(200).json({ success: true, message: 'Calendario vinculado exitosamente', calendar: rows[0] });
    } catch (error: any) {
        console.error('Error vinculando calendario:', error.message);
        res.status(400).json({ error: 'Error vinculando calendario: ' + error.message });
    }
};

export const deleteCalendar = async (req: Request, res: Response) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const queued = await GoogleCalendarOutboxService.enqueueCalendarRemoval(client, id);
        const deleted = await client.query('DELETE FROM google_calendars WHERE id = $1 RETURNING id', [id]);
        if (!deleted.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Calendario no encontrado' });
        }
        await client.query('COMMIT');
        return res.status(202).json({ success: true, queued, message: `Calendario eliminado; ${queued} eventos quedaron en cola para limpieza remota.` });
    } catch (error: any) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.error('Error eliminando calendario:', error.message);
        return res.status(500).json({ error: 'Error eliminando calendario' });
    } finally {
        client.release();
    }
};

export const syncAllAppointments = async (req: Request, res: Response) => {
    const { id } = req.params; // ID from google_calendars table
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: calRows } = await client.query('SELECT * FROM google_calendars WHERE id = $1 FOR UPDATE', [id]);
        if (calRows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Calendario no encontrado' });
        }
        const calendarRecord = calRows[0];
        const params: any[] = [];
        let query = `SELECT id FROM appointments WHERE fecha_inicio >= NOW() AND COALESCE(estado,'PROGRAMADA') <> 'CANCELADA'`;
        if (calendarRecord.employee_id !== null) {
            params.push(calendarRecord.employee_id);
            query += ` AND employee_id = $1`;
        }
        query += ` ORDER BY fecha_inicio`;
        const appointments = (await client.query(query, params)).rows;
        let queued = 0;
        for (const appointment of appointments) {
            if (await GoogleCalendarOutboxService.enqueueForCalendar(client, appointment.id, calendarRecord.id)) queued++;
        }
        await client.query('COMMIT');
        return res.status(202).json({ success: true, queued, message: `Sincronización encolada para ${queued} citas sin crear duplicados.` });
    } catch (error: any) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.error('Error syncing calendar:', error.message);
        return res.status(500).json({ error: 'Error encolando sincronización de calendario' });
    } finally {
        client.release();
    }
};
