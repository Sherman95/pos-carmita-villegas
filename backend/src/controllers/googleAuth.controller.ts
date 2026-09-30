import { Request, Response } from 'express';
import { google } from 'googleapis';
import path from 'path';
import pool from '../database/db';

export const getGoogleCalendarClient = async () => {
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
    try {
        const { rows: calRows } = await pool.query('SELECT * FROM google_calendars WHERE id = $1', [id]);
        if (calRows.length > 0) {
            const calendarRecord = calRows[0];
            const googleConfig = await getGoogleCalendarClient();
            if (googleConfig) {
                const { rows: syncRows } = await pool.query('SELECT google_event_id FROM appointment_google_events WHERE google_calendar_id = $1', [id]);
                for (const sync of syncRows) {
                    try {
                        await googleConfig.calendar.events.delete({
                            calendarId: calendarRecord.calendar_id,
                            eventId: sync.google_event_id
                        });
                    } catch (e) {
                        console.error(`Error borrando evento ${sync.google_event_id} en Google Calendar:`, e);
                    }
                }
            }
        }
        await pool.query('DELETE FROM google_calendars WHERE id = $1', [id]);
        res.status(200).json({ success: true, message: 'Calendario eliminado' });
    } catch (error: any) {
        console.error('Error eliminando calendario:', error.message);
        res.status(500).json({ error: 'Error eliminando calendario' });
    }
};

export const syncAllAppointments = async (req: Request, res: Response) => {
    const { id } = req.params; // ID from google_calendars table
    try {
        const { rows: calRows } = await pool.query('SELECT * FROM google_calendars WHERE id = $1', [id]);
        if (calRows.length === 0) return res.status(404).json({ error: 'Calendario no encontrado' });
        
        const calendarRecord = calRows[0];
        const googleConfig = await getGoogleCalendarClient();
        if (!googleConfig) return res.status(500).json({ error: 'Credenciales de Google no configuradas' });

        // Get future appointments
        let query = `
            SELECT a.*, c.nombre as client_name, i.nombre as item_name, e.nombre as emp_name
            FROM appointments a
            LEFT JOIN clients c ON a.client_id = c.id
            LEFT JOIN items i ON a.item_id = i.id
            LEFT JOIN employees e ON a.employee_id = e.id
            WHERE a.fecha_inicio >= NOW()
        `;
        const params: any[] = [];
        if (calendarRecord.employee_id) {
            query += ' AND a.employee_id = $1';
            params.push(calendarRecord.employee_id);
        }

        const { rows: appointments } = await pool.query(query, params);
        let syncCount = 0;

        for (const appt of appointments) {
            // Check if it's already synced in appointment_google_events for this calendar
            const { rows: existingSync } = await pool.query(
                'SELECT id FROM appointment_google_events WHERE appointment_id = $1 AND google_calendar_id = $2',
                [appt.id, calendarRecord.id]
            );

            if (existingSync.length === 0) {
                try {
                    const response = await googleConfig.calendar.events.insert({
                        calendarId: calendarRecord.calendar_id,
                        requestBody: {
                            summary: `[${appt.emp_name}] ${appt.item_name} - ${appt.client_name}`,
                            description: appt.notas || '',
                            start: { dateTime: new Date(appt.fecha_inicio).toISOString() },
                            end: { dateTime: new Date(appt.fecha_fin).toISOString() }
                        }
                    });

                    if (response.data.id) {
                        await pool.query(
                            'INSERT INTO appointment_google_events (appointment_id, google_calendar_id, google_event_id) VALUES ($1, $2, $3)',
                            [appt.id, calendarRecord.id, response.data.id]
                        );
                        syncCount++;
                    }
                } catch (e) {
                    console.error('Failed to sync appointment', appt.id, e);
                }
            }
        }

        res.status(200).json({ success: true, message: `Sincronización completada. ${syncCount} citas sincronizadas.` });
    } catch (error: any) {
        console.error('Error syncing calendar:', error.message);
        res.status(500).json({ error: 'Error sincronizando calendario' });
    }
};
