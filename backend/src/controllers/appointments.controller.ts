import { Request, Response } from 'express';
import pool from '../database/db';
import { google } from 'googleapis';
import path from 'path';
import { AppointmentService } from '../services/appointment.service';


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
    if (force && req.userRole !== 'admin') {
        return res.status(403).json({ error: 'Solo un administrador puede forzar conflictos de horario' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const newAppointment = await AppointmentService.createOfficialAppointment(client, {
            client_id, item_id, employee_id, fecha_inicio, fecha_fin, estado, notas, force
        });

        await client.query('COMMIT');
        res.status(201).json(newAppointment);
    } catch (error: any) {
        if (client) await client.query('ROLLBACK');
        console.error('Error creando cita:', error);
        if (error.message.includes('Conflicto') || error.message.includes('agendada')) {
            return res.status(409).json({ error: 'Conflicto de horario', conflict: error.message });
        }
        res.status(500).json({ error: 'Error al crear cita' });
    } finally {
        if (client) client.release();
    }
};

export const updateAppointment = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { client_id, item_id, employee_id, fecha_inicio, fecha_fin, estado, notas } = req.body;

    try {
        const force = req.query.force === 'true';
        if (force && req.userRole !== 'admin') {
            return res.status(403).json({ error: 'Solo un administrador puede forzar conflictos de horario' });
        }

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
                const formatTime = (d: string) => new Date(d).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
                return res.status(409).json({
                    error: 'Conflicto de horario',
                    conflict: `El profesional ya tiene una cita agendada: "${c.item_nombre}" con el cliente "${c.client_nombre}" de ${formatTime(c.fecha_inicio)} a ${formatTime(c.fecha_fin)}.`
                });
            }
        }

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
        try {
            const { getGoogleCalendarClient } = require('./googleAuth.controller');
            const googleConfig = await getGoogleCalendarClient();
            if (googleConfig) {
                // Get all synced events for this appointment
                const { rows: syncRows } = await pool.query(
                    `SELECT e.google_event_id, c.calendar_id
                     FROM appointment_google_events e
                     JOIN google_calendars c ON e.google_calendar_id = c.id
                     WHERE e.appointment_id = $1`,
                    [id]
                );

                if (syncRows.length > 0) {
                    const { rows: details } = await pool.query(
                        `SELECT
                            (SELECT nombre FROM employees WHERE id = $1) as emp_name,
                            (SELECT nombre FROM items WHERE id = $2) as item_name,
                            (SELECT nombre FROM clients WHERE id = $3) as client_name`,
                        [employee_id, item_id, client_id]
                    );
                    const { emp_name, item_name, client_name } = details[0];

                    for (const sync of syncRows) {
                        try {
                            await googleConfig.calendar.events.patch({
                                calendarId: sync.calendar_id,
                                eventId: sync.google_event_id,
                                requestBody: {
                                    summary: `[${emp_name}] ${item_name} - ${client_name}`,
                                    description: notas || '',
                                    start: { dateTime: new Date(fecha_inicio).toISOString() },
                                    end: { dateTime: new Date(fecha_fin).toISOString() }
                                }
                            });
                        } catch (e) {
                            console.error(`Error al actualizar evento en ${sync.calendar_id}:`, e);
                        }
                    }
                }
            }
        } catch (gcError) {
            console.error('Error al inicializar Google Calendar en actualización:', gcError);
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
        // Read synchronization records before deletion because the foreign key
        // cascade may remove them with the appointment.
        const { rows: syncRows } = await pool.query(
            `SELECT e.google_event_id, c.calendar_id
             FROM appointment_google_events e
             JOIN google_calendars c ON e.google_calendar_id = c.id
             WHERE e.appointment_id = $1`,
            [id]
        );
        // 1. Obtener la cita actual para saber su google_event_id
        const { rows: currentRows } = await pool.query('SELECT google_event_id FROM appointments WHERE id = $1', [id]);
        if (currentRows.length === 0) return res.status(404).json({ error: 'Cita no encontrada' });

        // Delete remote events first. If a remote operation fails, retain the
        // appointment and its local sync records so the operation can retry.
        try {
            const { getGoogleCalendarClient } = require('./googleAuth.controller');
            const googleConfig = await getGoogleCalendarClient();
            if (googleConfig) {
                for (const sync of syncRows) {
                    try {
                        await googleConfig.calendar.events.delete({
                            calendarId: sync.calendar_id,
                            eventId: sync.google_event_id
                        });
                    } catch (e) {
                        if ((e as any)?.code === 404) continue;
                        console.error(`Error al eliminar evento en ${sync.calendar_id}:`, e);
                        return res.status(502).json({ error: 'No se pudo sincronizar la eliminación de Calendar' });
                    }
                }
            }
        } catch (gcError) {
            console.error('Error al inicializar Google Calendar en eliminación:', gcError);
            return res.status(502).json({ error: 'No se pudo sincronizar la eliminación de Calendar' });
        }

        // 2. Eliminar de PostgreSQL only after remote deletion succeeds.
        const { rowCount } = await pool.query('DELETE FROM appointments WHERE id = $1', [id]);
        if (rowCount === 0) return res.status(404).json({ error: 'Cita no encontrada al eliminar' });

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
