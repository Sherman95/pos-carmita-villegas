import { Request, Response } from 'express';
import pool from '../database/db';
import { AvailabilityEngine } from '../services/availability.engine';
import { SidroRequestAppointmentsService } from '../services/sidroRequestAppointments.service';

const isUuid = (value: unknown): value is string =>
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const normalizeEmployeeId = (value: unknown): string =>
    typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

// Producción usa employees.id INTEGER; algunas instalaciones locales antiguas usan UUID.
const isEmployeeId = (value: string): boolean => {
    if (isUuid(value)) return true;
    if (!/^[1-9]\d*$/.test(value)) return false;

    const numericId = Number(value);
    return Number.isSafeInteger(numericId) && numericId <= 2147483647;
};

const normalizeServiceIds = (serviceIds: unknown, serviceId?: unknown): string[] => {
    const rawIds = Array.isArray(serviceIds)
        ? serviceIds
        : typeof serviceIds === 'string'
            ? serviceIds.split(',')
            : serviceId
                ? [serviceId]
                : [];

    return [...new Set(rawIds.map((value) => String(value).trim()).filter(Boolean))];
};

export const createRequest = async (req: Request, res: Response) => {
    const sidroAccountId = req.userId;
    const { service_id, service_ids, employee_id, request_date, start_time, client_notes } = req.body;
    const normalizedServiceIds = normalizeServiceIds(service_ids, service_id);
    const normalizedEmployeeId = normalizeEmployeeId(employee_id);

    if (!sidroAccountId || normalizedServiceIds.length === 0 || !normalizedEmployeeId || !request_date || !start_time) {
        return res.status(400).json({ error: 'Faltan datos requeridos' });
    }
    if (normalizedServiceIds.length > 8 || normalizedServiceIds.some((id) => !isUuid(id)) ||
        !isEmployeeId(normalizedEmployeeId) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(request_date) ||
        !/^\d{2}:\d{2}(:\d{2})?$/.test(start_time)) {
        return res.status(400).json({ error: 'Identificadores o fecha/hora inválidos' });
    }
    if (typeof client_notes !== 'string' || client_notes.trim().length < 10 || client_notes.trim().length > 500) {
        return res.status(400).json({ error: 'Describe lo que deseas hacerte usando entre 10 y 500 caracteres' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const pendingCount = await client.query(
            `SELECT count(*) FROM sidro_appointment_requests
             WHERE sidro_account_id = $1 AND status = 'PENDIENTE'`,
            [sidroAccountId]
        );
        if (Number(pendingCount.rows[0].count) >= 3) {
            await client.query('ROLLBACK');
            return res.status(429).json({ error: 'Límite de solicitudes pendientes alcanzado (Máx. 3)' });
        }

        const servicePlan = await AvailabilityEngine.getServicePlan(normalizedServiceIds, normalizedEmployeeId);
        const availableSlots = await AvailabilityEngine.getAvailableSlotsForServices(
            normalizedServiceIds,
            normalizedEmployeeId,
            request_date
        );
        const requestedSlot = start_time.substring(0, 5);
        if (!availableSlots.includes(requestedSlot)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'El horario seleccionado ya no está disponible.' });
        }

        const totalDuration = servicePlan.reduce((sum, service) => sum + service.total_minutes, 0);
        const endDate = new Date(`1970-01-01T${requestedSlot}:00`);
        endDate.setMinutes(endDate.getMinutes() + totalDuration);
        const endTime = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;

        const result = await client.query(
            `INSERT INTO sidro_appointment_requests
             (sidro_account_id, service_id, employee_id, request_date, start_time, end_time, status, client_notes)
             VALUES ($1, $2, $3, $4, $5, $6, 'PENDIENTE', $7)
             RETURNING *`,
            [
                sidroAccountId,
                normalizedServiceIds[0],
                normalizedEmployeeId,
                request_date,
                start_time,
                endTime,
                client_notes.trim()
            ]
        );

        for (const service of servicePlan) {
            await client.query(
                `INSERT INTO sidro_appointment_request_services
                 (request_id, service_id, position, duration_minutes, padding_minutes)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    result.rows[0].id,
                    service.service_id,
                    service.position,
                    service.duration_minutes,
                    service.padding_minutes
                ]
            );
        }

        await client.query('COMMIT');
        return res.status(201).json({ ...result.rows[0], services: servicePlan });
    } catch (error: any) {
        if (client) await client.query('ROLLBACK');
        console.error(error);
        const status = /no atiende|no existe|no es reservable|Selecciona/.test(error.message || '') ? 400 : 500;
        return res.status(status).json({ error: error.message || 'Error al procesar solicitud' });
    } finally {
        if (client) client.release();
    }
};

export const getMyRequests = async (req: Request, res: Response) => {
    const sidroAccountId = req.userId;
    try {
        const result = await pool.query(
            `SELECT request.id, request.service_id, request.request_date, request.start_time,
                    request.end_time, request.status, request.client_notes,
                    request.proposed_date, request.proposed_start_time, request.proposed_end_time,
                    COALESCE(service_group.service_name, primary_service.nombre) AS service_name,
                    COALESCE(service_group.primary_image_url, primary_service.sidro_image_url) AS image_url,
                    COALESCE(
                        service_group.services,
                        jsonb_build_array(jsonb_build_object(
                            'service_id', primary_service.id,
                            'service_name', primary_service.nombre,
                            'image_url', primary_service.sidro_image_url,
                            'position', 1
                        ))
                    ) AS services,
                    employee.nombre AS employee_name
             FROM sidro_appointment_requests request
             JOIN items primary_service ON request.service_id = primary_service.id
             JOIN employees employee ON request.employee_id = employee.id
             LEFT JOIN LATERAL (
                 SELECT string_agg(item.nombre, ' + ' ORDER BY request_service.position) AS service_name,
                        max(item.sidro_image_url) FILTER (WHERE request_service.position = 1) AS primary_image_url,
                        jsonb_agg(
                            jsonb_build_object(
                                'service_id', item.id,
                                'service_name', item.nombre,
                                'image_url', item.sidro_image_url,
                                'duration_minutes', request_service.duration_minutes,
                                'padding_minutes', request_service.padding_minutes,
                                'position', request_service.position
                            ) ORDER BY request_service.position
                        ) AS services
                 FROM sidro_appointment_request_services request_service
                 JOIN items item ON item.id = request_service.service_id
                 WHERE request_service.request_id = request.id
             ) service_group ON true
             WHERE request.sidro_account_id = $1
             ORDER BY request.request_date DESC, request.start_time DESC`,
            [sidroAccountId]
        );
        return res.json(result.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error al listar solicitudes' });
    }
};

export const getAvailability = async (req: Request, res: Response) => {
    const { service_id, service_ids, employee_id, request_date } = req.query;
    const normalizedServiceIds = normalizeServiceIds(service_ids, service_id);
    const normalizedEmployeeId = normalizeEmployeeId(employee_id);

    if (normalizedServiceIds.length === 0 || !normalizedEmployeeId || !request_date) {
        return res.status(400).json({ error: 'service_ids, employee_id y request_date son requeridos' });
    }
    if (normalizedServiceIds.length > 8 || normalizedServiceIds.some((id) => !isUuid(id)) ||
        !isEmployeeId(normalizedEmployeeId) || !/^\d{4}-\d{2}-\d{2}$/.test(request_date as string)) {
        return res.status(400).json({ error: 'Identificadores o fecha inválidos' });
    }

    try {
        const slots = await AvailabilityEngine.getAvailableSlotsForServices(
            normalizedServiceIds,
            normalizedEmployeeId,
            request_date as string
        );
        return res.json(slots);
    } catch (error: any) {
        console.error(error);
        return res.status(400).json({ error: error.message || 'Error calculando disponibilidad' });
    }
};

export const getPublicServices = async (_req: Request, res: Response) => {
    try {
        const result = await pool.query(
            `SELECT id, nombre, precio,
                    COALESCE(duration_minutes, 60) AS duration_minutes,
                    COALESCE(padding_minutes, 0) AS padding_minutes,
                    sidro_image_url AS image_url
             FROM items
             WHERE active = true
               AND tipo = 'SERVICIO'
               AND (is_reservable = true OR duration_minutes IS NULL)
             ORDER BY nombre ASC`
        );
        return res.json(result.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error al listar servicios' });
    }
};

export const getServiceProfessionals = async (req: Request, res: Response) => {
    req.query.service_ids = req.params.id;
    return getServicesProfessionals(req, res);
};

export const getServicesProfessionals = async (req: Request, res: Response) => {
    const serviceIds = normalizeServiceIds(req.query.service_ids);
    if (serviceIds.length === 0 || serviceIds.length > 8 || serviceIds.some((id) => !isUuid(id))) {
        return res.status(400).json({ error: 'Selecciona entre 1 y 8 servicios válidos' });
    }

    try {
        const existingServices = await pool.query(
            `SELECT count(*)::int AS total
             FROM items
             WHERE id = ANY($1::uuid[])
               AND active = true
               AND tipo = 'SERVICIO'
               AND (is_reservable = true OR duration_minutes IS NULL)`,
            [serviceIds]
        );
        if (Number(existingServices.rows[0].total) !== serviceIds.length) {
            return res.status(400).json({ error: 'Uno o más servicios no están disponibles' });
        }

        const result = await pool.query(
            `WITH requested_services AS (
                SELECT unnest($1::uuid[]) AS service_id
             )
             SELECT employee.id AS employee_id, employee.nombre
             FROM employees employee
             WHERE employee.active = true
               AND NOT EXISTS (
                   SELECT 1
                   FROM requested_services requested
                   WHERE EXISTS (
                       SELECT 1 FROM sidro_service_professionals configured
                       WHERE configured.service_id = requested.service_id
                   )
                   AND NOT EXISTS (
                       SELECT 1 FROM sidro_service_professionals assigned
                       WHERE assigned.service_id = requested.service_id
                         AND assigned.employee_id = employee.id
                   )
               )
             ORDER BY employee.nombre ASC`,
            [serviceIds]
        );
        return res.json(result.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error al listar profesionales para los servicios' });
    }
};

export const acceptProposal = async (req: Request, res: Response) => {
    const sidroAccountId = req.userId;
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const check = await client.query(
            'SELECT * FROM sidro_appointment_requests WHERE id = $1 FOR UPDATE',
            [id]
        );
        if (check.rows.length === 0) throw new Error('Solicitud no encontrada');
        const request = check.rows[0];

        if (request.sidro_account_id !== sidroAccountId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'No autorizado' });
        }
        if (request.status !== 'PROPUESTA') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'La solicitud no es una propuesta' });
        }

        const localDate = new Date(request.proposed_date);
        const dateStr = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}`;
        const segments = await SidroRequestAppointmentsService.getSegments(client, request);
        const slots = await AvailabilityEngine.getAvailableSlotsForServices(
            segments.map((segment) => segment.service_id),
            request.employee_id,
            dateStr
        );
        if (!slots.includes(request.proposed_start_time.substring(0, 5))) {
            throw new Error('El horario propuesto ya fue ocupado por otra cita');
        }

        const linked = await client.query(
            `SELECT client_id FROM sidro_account_links
             WHERE sidro_account_id = $1 AND is_active = true`,
            [sidroAccountId]
        );

        if (linked.rows.length > 0) {
            const appointmentIds = await SidroRequestAppointmentsService.createOfficialAppointments(
                client,
                { ...request, start_time: request.proposed_start_time },
                linked.rows[0].client_id,
                dateStr,
                'Propuesta aceptada por clienta'
            );
            await client.query(
                `UPDATE sidro_appointment_requests
                 SET request_date = proposed_date,
                     start_time = proposed_start_time,
                     end_time = proposed_end_time,
                     proposed_date = NULL,
                     proposed_start_time = NULL,
                     proposed_end_time = NULL,
                     status = 'CONFIRMADA',
                     official_appointment_id = $1
                 WHERE id = $2`,
                [appointmentIds[0], id]
            );
            await client.query('COMMIT');
            return res.json({ message: 'Citas confirmadas', appointment_ids: appointmentIds });
        }

        await SidroRequestAppointmentsService.validateOfficialAppointments(
            client,
            { ...request, start_time: request.proposed_start_time },
            dateStr
        );
        await client.query(
            `UPDATE sidro_appointment_requests
             SET request_date = proposed_date,
                 start_time = proposed_start_time,
                 end_time = proposed_end_time,
                 proposed_date = NULL,
                 proposed_start_time = NULL,
                 proposed_end_time = NULL,
                 status = 'APROBADA_PENDIENTE_VINCULACION'
             WHERE id = $1`,
            [id]
        );
        await client.query('COMMIT');
        return res.json({ message: 'Propuesta aceptada, pendiente de vinculación' });
    } catch (error: any) {
        if (client) await client.query('ROLLBACK');
        return res.status(409).json({ error: error.message || 'Error al aceptar propuesta' });
    } finally {
        if (client) client.release();
    }
};

export const rejectProposal = async (req: Request, res: Response) => {
    const sidroAccountId = req.userId;
    const { id } = req.params;
    try {
        const check = await pool.query(
            'SELECT sidro_account_id FROM sidro_appointment_requests WHERE id = $1',
            [id]
        );
        if (check.rows.length === 0 || check.rows[0].sidro_account_id !== sidroAccountId) {
            return res.status(403).json({ error: 'No autorizado' });
        }
        await pool.query(
            `UPDATE sidro_appointment_requests
             SET status = 'CANCELADA',
                 proposed_date = NULL,
                 proposed_start_time = NULL,
                 proposed_end_time = NULL
             WHERE id = $1`,
            [id]
        );
        return res.json({ message: 'Propuesta rechazada y cancelada' });
    } catch (error) {
        return res.status(500).json({ error: 'Error' });
    }
};
