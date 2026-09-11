import { Request, Response } from 'express';
import pool from '../database/db';
import { google } from 'googleapis';
import path from 'path';

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
);

// Función auxiliar para obtener el cliente configurado
const getGoogleCalendarClient = async () => {
    const { rows } = await pool.query(`SELECT config_key, config_value FROM business_config WHERE config_key IN ('google_refresh_token', 'google_calendar_id')`);
    
    let refreshToken = null;
    let calendarId = 'primary';

    rows.forEach(row => {
        if (row.config_key === 'google_refresh_token') refreshToken = row.config_value;
        if (row.config_key === 'google_calendar_id') calendarId = row.config_value;
    });

    // Buscar el archivo en varias posibles rutas
    const possiblePaths = [
        process.env.GOOGLE_CREDENTIALS_PATH,
        path.join(__dirname, '../../google-credentials.json'),
        '/etc/secrets/google-credentials.json'
    ];
    
    const keyFile = possiblePaths.find(p => p && require('fs').existsSync(p));

    if (!keyFile) return null;

    const auth = new google.auth.GoogleAuth({
        keyFile: keyFile,
        scopes: ['https://www.googleapis.com/auth/calendar.events'],
    });

    const calendar = google.calendar({ version: 'v3', auth });
    
    return { calendar, calendarId };
};

export const getAppointments = async (_req: Request, res: Response) => {
    try {
        const { rows } = await pool.query(
            `SELECT a.*, 
                    c.nombre as client_nombre, 
                    i.nombre as item_nombre, 
                    e.nombre as employee_nombre 
             FROM appointments a
             LEFT JOIN clients c ON a.client_id = c.id
             LEFT JOIN items i ON a.item_id = i.id
             LEFT JOIN employees e ON a.employee_id = e.id
             ORDER BY a.fecha_inicio ASC`
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error obteniendo citas:', error);
        res.status(500).json({ error: 'Error al obtener citas' });
    }
};

export const getAppointmentById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const { rows, rowCount } = await pool.query(
            'SELECT * FROM appointments WHERE id = $1',
            [id]
        );
        if (rowCount === 0) return res.status(404).json({ error: 'Cita no encontrada' });
        res.status(200).json(rows[0]);
    } catch (error) {
        console.error('Error obteniendo cita:', error);
        res.status(500).json({ error: 'Error al obtener cita' });
    }
};

export const createAppointment = async (req: Request, res: Response) => {
    const { client_id, item_id, employee_id, fecha_inicio, fecha_fin, estado, notas } = req.body;

    if (!client_id || !item_id || !employee_id || !fecha_inicio || !fecha_fin) {
        return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const force = req.query.force === 'true';

    try {
        // 0. Detectar conflictos de horario
        if (!force) {
            const conflictQuery = `
                SELECT a.*, c.nombre as client_nombre, i.nombre as item_nombre
                FROM appointments a
                JOIN clients c ON a.client_id = c.id
                JOIN items i ON a.item_id = i.id
                WHERE a.employee_id = $1
                  AND a.fecha_inicio < $3
                  AND a.fecha_fin > $2
            `;
            const { rows: conflicts } = await pool.query(conflictQuery, [employee_id, fecha_inicio, fecha_fin]);
            
            if (conflicts.length > 0) {
                const c = conflicts[0];
                return res.status(409).json({ 
                    error: 'Conflicto de horario', 
                    conflict: `El profesional ya tiene una cita agendada: "${c.item_nombre}" con el cliente "${c.client_nombre}" de ${new Date(c.fecha_inicio).toLocaleTimeString()} a ${new Date(c.fecha_fin).toLocaleTimeString()}.`
                });
            }
        }

        // 1. Obtener nombres para el título del evento
        const { rows: details } = await pool.query(
            `SELECT 
                (SELECT nombre FROM employees WHERE id = $1) as emp_name,
                (SELECT nombre FROM items WHERE id = $2) as item_name,
                (SELECT nombre FROM clients WHERE id = $3) as client_name`,
            [employee_id, item_id, client_id]
        );
        const { emp_name, item_name, client_name } = details[0];

        // 2. Insertar en base de datos PostgreSQL primero
        const { rows } = await pool.query(
            `INSERT INTO appointments 
            (client_id, item_id, employee_id, fecha_inicio, fecha_fin, estado, notas) 
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [client_id, item_id, employee_id, fecha_inicio, fecha_fin, estado || 'PROGRAMADA', notas || null]
        );
        
        let newAppointment = rows[0];

        // 3. Crear evento en Google Calendar
        try {
            const googleConfig = await getGoogleCalendarClient();
            if (googleConfig) {
                const response = await googleConfig.calendar.events.insert({
                    calendarId: googleConfig.calendarId,
                    requestBody: {
                        summary: `[${emp_name}] ${item_name} - ${client_name}`,
                        description: notas || '',
                        start: { dateTime: new Date(fecha_inicio).toISOString() },
                        end: { dateTime: new Date(fecha_fin).toISOString() }
                    }
                });

                if (response.data.id) {
                    // 4. Actualizar cita con google_event_id
                    const updateRes = await pool.query(
                        'UPDATE appointments SET google_event_id = $1 WHERE id = $2 RETURNING *',
                        [response.data.id, newAppointment.id]
                    );
                    newAppointment = updateRes.rows[0];
                }
            }
        } catch (gcError) {
            console.error('Error al crear evento en Google Calendar:', gcError);
            // NOTA: No hacemos throw aquí para no bloquear la creación de la cita en BD si falla Google.
        }

        res.status(201).json(newAppointment);
    } catch (error) {
        console.error('Error creando cita:', error);
        res.status(500).json({ error: 'Error al crear cita' });
    }
};

export const updateAppointment = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { client_id, item_id, employee_id, fecha_inicio, fecha_fin, estado, notas } = req.body;

    try {
        const force = req.query.force === 'true';

        // 0. Detectar conflictos de horario
        if (!force) {
            const conflictQuery = `
                SELECT a.*, c.nombre as client_nombre, i.nombre as item_nombre
                FROM appointments a
                JOIN clients c ON a.client_id = c.id
                JOIN items i ON a.item_id = i.id
                WHERE a.employee_id = $1
                  AND a.id != $2
                  AND a.fecha_inicio < $4
                  AND a.fecha_fin > $3
            `;
            const { rows: conflicts } = await pool.query(conflictQuery, [employee_id, id, fecha_inicio, fecha_fin]);
            
            if (conflicts.length > 0) {
                const c = conflicts[0];
                return res.status(409).json({ 
                    error: 'Conflicto de horario', 
                    conflict: `El profesional ya tiene una cita agendada: "${c.item_nombre}" con el cliente "${c.client_nombre}" de ${new Date(c.fecha_inicio).toLocaleTimeString()} a ${new Date(c.fecha_fin).toLocaleTimeString()}.`
                });
            }
        }

        // 1. Obtener la cita actual para saber su google_event_id
        const { rows: currentRows } = await pool.query('SELECT google_event_id FROM appointments WHERE id = $1', [id]);
        if (currentRows.length === 0) return res.status(404).json({ error: 'Cita no encontrada' });
        
        const googleEventId = currentRows[0].google_event_id;

        // 2. Actualizar en PostgreSQL
        const { rows, rowCount } = await pool.query(
            `UPDATE appointments 
             SET client_id = $1, item_id = $2, employee_id = $3, 
                 fecha_inicio = $4, fecha_fin = $5, estado = $6, notas = $7
             WHERE id = $8 RETURNING *`,
            [client_id, item_id, employee_id, fecha_inicio, fecha_fin, estado, notas, id]
        );
        
        if (rowCount === 0) return res.status(404).json({ error: 'Cita no encontrada al actualizar' });

        // 3. Actualizar en Google Calendar si existe el evento
        if (googleEventId) {
            try {
                const googleConfig = await getGoogleCalendarClient();
                if (googleConfig) {
                    // Obtener nombres para el título
                    const { rows: details } = await pool.query(
                        `SELECT 
                            (SELECT nombre FROM employees WHERE id = $1) as emp_name,
                            (SELECT nombre FROM items WHERE id = $2) as item_name,
                            (SELECT nombre FROM clients WHERE id = $3) as client_name`,
                        [employee_id, item_id, client_id]
                    );
                    const { emp_name, item_name, client_name } = details[0];

                    await googleConfig.calendar.events.patch({
                        calendarId: googleConfig.calendarId,
                        eventId: googleEventId,
                        requestBody: {
                            summary: `[${emp_name}] ${item_name} - ${client_name}`,
                            description: notas || '',
                            start: { dateTime: new Date(fecha_inicio).toISOString() },
                            end: { dateTime: new Date(fecha_fin).toISOString() }
                        }
                    });
                }
            } catch (gcError) {
                console.error('Error al actualizar evento en Google Calendar:', gcError);
            }
        }

        res.status(200).json(rows[0]);
    } catch (error) {
        console.error('Error actualizando cita:', error);
        res.status(500).json({ error: 'Error al actualizar cita' });
    }
};

export const deleteAppointment = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        // 1. Obtener la cita actual para saber su google_event_id
        const { rows: currentRows } = await pool.query('SELECT google_event_id FROM appointments WHERE id = $1', [id]);
        if (currentRows.length === 0) return res.status(404).json({ error: 'Cita no encontrada' });
        
        const googleEventId = currentRows[0].google_event_id;

        // 2. Eliminar de PostgreSQL
        const { rowCount } = await pool.query('DELETE FROM appointments WHERE id = $1', [id]);
        if (rowCount === 0) return res.status(404).json({ error: 'Cita no encontrada al eliminar' });

        // 3. Eliminar de Google Calendar si existe
        if (googleEventId) {
            try {
                const googleConfig = await getGoogleCalendarClient();
                if (googleConfig) {
                    await googleConfig.calendar.events.delete({
                        calendarId: googleConfig.calendarId,
                        eventId: googleEventId
                    });
                }
            } catch (gcError) {
                console.error('Error al eliminar evento en Google Calendar:', gcError);
            }
        }
        
        res.status(200).json({ message: 'Cita eliminada correctamente' });
    } catch (error) {
        console.error('Error eliminando cita:', error);
        res.status(500).json({ error: 'Error al eliminar cita' });
    }
};

export default {
    getAppointments,
    getAppointmentById,
    createAppointment,
    updateAppointment,
    deleteAppointment
};
