import { Request, Response } from 'express';
import pool from '../database/db';
import { google } from 'googleapis';
import path from 'path';
import { AppointmentService } from '../services/appointment.service';
import { SidroAppointmentReconciliationService } from '../services/sidroAppointmentReconciliation.service';
import { GoogleCalendarOutboxService } from '../services/googleCalendarOutbox.service';


const ownEmployeeId = (req: Request): string | null => {
    const value = req.user?.employee_id;
    return value === null || value === undefined || value === '' ? null : String(value);
};

export const getAppointments = async (req: Request, res: Response) => {
    try {
        const ownOnly = req.userRole === 'professional';
        const employeeId = ownEmployeeId(req);
        if (ownOnly && !employeeId) return res.status(403).json({ error: 'Tu cuenta no está vinculada a un profesional' });
        const { rows } = await pool.query(
            `SELECT a.*,
                    c.nombre as client_nombre,
                    i.nombre as item_nombre,
                    e.nombre as employee_nombre
             FROM appointments a
             LEFT JOIN clients c ON a.client_id = c.id
             LEFT JOIN items i ON a.item_id = i.id
             LEFT JOIN employees e ON a.employee_id = e.id
             ${ownOnly ? 'WHERE a.employee_id = $1' : ''}
             ORDER BY a.fecha_inicio ASC`,
            ownOnly ? [employeeId] : []
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
        const ownOnly = req.userRole === 'professional';
        const employeeId = ownEmployeeId(req);
        if (ownOnly && !employeeId) return res.status(403).json({ error: 'Tu cuenta no está vinculada a un profesional' });
        const { rows, rowCount } = await pool.query(
            `SELECT * FROM appointments WHERE id = $1 ${ownOnly ? 'AND employee_id = $2' : ''}`,
            ownOnly ? [id, employeeId] : [id]
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
    if (force && !['owner', 'admin'].includes(req.userRole || '')) {
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
    const id = String(req.params.id);
    const { client_id, item_id, employee_id, fecha_inicio, fecha_fin, estado, notas } = req.body;

    let client;
    try {
        const force = req.query.force === 'true';
        if (force && !['owner', 'admin'].includes(req.userRole || '')) {
            return res.status(403).json({ error: 'Solo un administrador puede forzar conflictos de horario' });
        }

        client = await pool.connect();
        await client.query('BEGIN');
        const { rows: currentRows } = await client.query('SELECT * FROM appointments WHERE id = $1 FOR UPDATE', [id]);
        if (currentRows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Cita no encontrada' });
        }
        const current = currentRows[0];
        if (req.userRole === 'professional') {
            const employeeIdOwn = ownEmployeeId(req);
            if (!employeeIdOwn || String(current.employee_id) !== employeeIdOwn) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Solo puedes modificar citas asignadas a tu profesional' });
            }
            const changesOperationalData =
                (client_id !== undefined && String(client_id) !== String(current.client_id)) ||
                (item_id !== undefined && String(item_id) !== String(current.item_id)) ||
                (employee_id !== undefined && String(employee_id) !== String(current.employee_id)) ||
                fecha_inicio !== undefined || fecha_fin !== undefined;
            if (changesOperationalData) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Tu rol solo puede actualizar estado y notas de sus propias citas' });
            }
        }
        const next = {
            client_id: client_id ?? current.client_id,
            item_id: item_id ?? current.item_id,
            employee_id: employee_id ?? current.employee_id,
            fecha_inicio: fecha_inicio ?? new Date(current.fecha_inicio).toISOString(),
            fecha_fin: fecha_fin ?? new Date(current.fecha_fin).toISOString(),
            estado: estado ?? current.estado,
            notas: notas ?? current.notas
        };
        const relatedRequestIds = await SidroAppointmentReconciliationService.getRelatedRequestIds(client, id);

        if (next.estado !== 'CANCELADA') {
            await AppointmentService.validateOfficialAppointmentAvailability(client, {
                employee_id: next.employee_id,
                fecha_inicio: next.fecha_inicio,
                fecha_fin: next.fecha_fin,
                force,
                exclude_appointment_id: id
            });
        }

        // 2. Actualizar en PostgreSQL
        const { rows, rowCount } = await client.query(
            `UPDATE appointments
             SET client_id = $1, item_id = $2, employee_id = $3,
                 fecha_inicio = $4, fecha_fin = $5, estado = $6, notas = $7
             WHERE id = $8 RETURNING *`,
            [next.client_id, next.item_id, next.employee_id, next.fecha_inicio, next.fecha_fin, next.estado, next.notas, id]
        );

        if (rowCount === 0) throw new Error('Cita no encontrada al actualizar');
        await SidroAppointmentReconciliationService.reconcileRequests(client, relatedRequestIds);
        await GoogleCalendarOutboxService.enqueueForAppointment(client, id);
        await client.query('COMMIT');

        res.status(200).json(rows[0]);
    } catch (error: any) {
        if (client) await client.query('ROLLBACK');
        console.error('Error actualizando cita:', error);
        if (/agendada|retenida|Conflicto/i.test(error.message || '')) {
            return res.status(409).json({ error: 'Conflicto de horario', conflict: error.message });
        }
        res.status(500).json({ error: 'Error al actualizar cita' });
    } finally {
        if (client) client.release();
    }
};

export const deleteAppointment = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const locked = await client.query('SELECT id FROM appointments WHERE id = $1 FOR UPDATE', [id]);
        if (locked.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Cita no encontrada' });
        }
        const relatedRequestIds = await SidroAppointmentReconciliationService.getRelatedRequestIds(client, id);
        // El payload conserva calendar_id y google_event_id antes de que el
        // DELETE local elimine las relaciones mediante CASCADE.
        await GoogleCalendarOutboxService.enqueueForAppointment(client, id, 'DELETE');
        await client.query('DELETE FROM appointments WHERE id = $1', [id]);
        await SidroAppointmentReconciliationService.reconcileRequests(client, relatedRequestIds);
        await client.query('COMMIT');
        return res.status(200).json({ message: 'Cita eliminada correctamente; Calendar se actualizará en segundo plano' });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.error('Error eliminando cita:', error);
        return res.status(500).json({ error: 'Error al eliminar cita' });
    } finally {
        client.release();
    }
};

export default {
    getAppointments,
    getAppointmentById,
    createAppointment,
    updateAppointment,
    deleteAppointment
};
