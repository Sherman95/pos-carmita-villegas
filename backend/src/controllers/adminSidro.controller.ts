import { Request, Response } from 'express';
import pool from '../database/db';
import { SidroRequestAppointmentsService } from '../services/sidroRequestAppointments.service';
import { CloudinaryService } from '../services/cloudinary.service';

const getUserEmployeeId = async (userId: string): Promise<string | null> => {
    const res = await pool.query('SELECT employee_id FROM users WHERE id = $1', [userId]);
    return res.rows[0]?.employee_id || null;
};

export const listAccounts = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.nombre_completo, s.telefono, s.email, s.is_active, s.created_at,
             l.client_id, c.nombre as client_nombre
      FROM sidro_client_accounts s
      LEFT JOIN sidro_account_links l ON s.id = l.sidro_account_id AND l.is_active = true
      LEFT JOIN clients c ON l.client_id = c.id
      ORDER BY s.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al listar cuentas de SIDRO' });
  }
};

export const linkAccount = async (req: Request, res: Response) => {
  const { sidro_account_id, client_id, force } = req.body;
  const admin_id = (req as any).userId; // o (req as any).user.id dependiendo de la auth

  if (!sidro_account_id || !client_id) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // Verificar si el cliente ya esta vinculado a otra cuenta
    if (!force) {
        const { rows: existing } = await client.query(
            `SELECT * FROM sidro_account_links WHERE client_id = $1 AND is_active = true AND sidro_account_id != $2`,
            [client_id, sidro_account_id]
        );
        if (existing.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'El cliente historico ya esta vinculado a otra cuenta SIDRO. Confirma para sobreescribir.' });
        }
    }

    // Desactivar vinculaciones previas de la cuenta sidro y del cliente
    await client.query(`UPDATE sidro_account_links SET is_active = false WHERE sidro_account_id = $1 OR client_id = $2`, [sidro_account_id, client_id]);

    // Crear nueva vinculación
    const result = await client.query(
      `INSERT INTO sidro_account_links (sidro_account_id, client_id, admin_id, is_active)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [sidro_account_id, client_id, admin_id]
    );

    // Buscar solicitudes aprobadas pendientes de vinculacion
    const pendingReqs = await client.query(
        `SELECT * FROM sidro_appointment_requests
         WHERE sidro_account_id = $1 AND status = 'APROBADA_PENDIENTE_VINCULACION' FOR UPDATE`,
        [sidro_account_id]
    );

    for (const reqData of pendingReqs.rows) {
        try {
            // Formatear localmente para evitar desfases UTC
            const localDate = new Date(reqData.request_date);
            const yyyy = localDate.getFullYear();
            const mm = String(localDate.getMonth() + 1).padStart(2, '0');
            const dd = String(localDate.getDate()).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;

            const officialAppointmentIds = await SidroRequestAppointmentsService.createOfficialAppointments(
                client,
                reqData,
                client_id,
                dateStr,
                'Generada desde SIDRO post-vinculacion'
            );

            await client.query(
                `UPDATE sidro_appointment_requests SET status = 'CONFIRMADA', official_appointment_id = $1 WHERE id = $2`,
                [officialAppointmentIds[0], reqData.id]
            );
        } catch (e: any) {
            console.error(`Conflicto al procesar solicitud ${reqData.id}:`, e.message);
            await client.query(`UPDATE sidro_appointment_requests SET status = 'CONFLICTO_VINCULACION' WHERE id = $1`, [reqData.id]);
        }
    }

    await client.query('COMMIT');
    res.json({ message: 'Vinculacion exitosa y solicitudes procesadas', id: result.rows[0].id });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Error al vincular cuentas' });
  } finally {
    if (client) client.release();
  }
};

// --- Configuracion de Servicios ---
export const updateServiceConfig = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { is_reservable, duration_minutes, padding_minutes, professionals, precio } = req.body;

    const duration = Number(duration_minutes);
    const padding = Number(padding_minutes ?? 0);
    const price = Number(precio);
    if (!Number.isFinite(duration) || duration < 15 || duration > 720 ||
        !Number.isFinite(padding) || padding < 0 || padding > 180 ||
        !Number.isFinite(price) || price < 0) {
        return res.status(400).json({ error: 'Precio, duración o margen inválidos' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        await client.query(
            `UPDATE items
             SET is_reservable = $1, duration_minutes = $2, padding_minutes = $3,
                 precio = $4, updated_at = NOW()
             WHERE id = $5 AND tipo = 'SERVICIO'`,
            [Boolean(is_reservable), duration, padding, price, id]
        );

        // Actualizar profesionales vinculados
        if (Array.isArray(professionals)) {
            // Eliminar anteriores
            await client.query('DELETE FROM sidro_service_professionals WHERE service_id = $1', [id]);

            // Insertar nuevos
            for (const prof of professionals) {
                await client.query(
                    `INSERT INTO sidro_service_professionals (service_id, employee_id, specific_duration_minutes)
                     VALUES ($1, $2, $3)`,
                    [id, prof.employee_id, prof.specific_duration_minutes || null]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ message: 'Configuración actualizada' });
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar configuración' });
    } finally {
        if (client) client.release();
    }
};

export const getServiceConfig = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            `SELECT id, nombre, precio, is_reservable, duration_minutes, padding_minutes,
                    sidro_image_url, sidro_image_public_id
             FROM items WHERE id = $1 AND tipo = 'SERVICIO'`,
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Servicio no encontrado' });

        const profs = await pool.query(
            `SELECT p.employee_id, e.nombre, p.specific_duration_minutes
             FROM sidro_service_professionals p
             JOIN employees e ON p.employee_id = e.id
             WHERE p.service_id = $1`,
            [id]
        );

        res.json({
            ...result.rows[0],
            professionals: profs.rows,
            image_upload_enabled: CloudinaryService.isConfigured()
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const getRouteParam = (value: string | string[]): string => Array.isArray(value) ? (value[0] || '') : value;

export const getServiceImageUploadSignature = async (req: Request, res: Response) => {
    const id = getRouteParam(req.params.id);
    if (!uuidPattern.test(id)) return res.status(400).json({ error: 'Servicio inválido' });

    try {
        const service = await pool.query(
            `SELECT id FROM items WHERE id = $1 AND tipo = 'SERVICIO' AND active = true`,
            [id]
        );
        if (service.rows.length === 0) return res.status(404).json({ error: 'Servicio no encontrado' });
        return res.json(CloudinaryService.createServiceUploadSignature(id));
    } catch (error: any) {
        const status = /no está configurado/.test(error.message || '') ? 503 : 500;
        return res.status(status).json({ error: error.message || 'No se pudo preparar la carga de imagen' });
    }
};

export const saveServiceImageReference = async (req: Request, res: Response) => {
    const id = getRouteParam(req.params.id);
    const { image_url, image_public_id } = req.body as {
        image_url?: string;
        image_public_id?: string;
    };
    if (!uuidPattern.test(id) || !image_url || !image_public_id) {
        return res.status(400).json({ error: 'Referencia de imagen incompleta' });
    }

    try {
        CloudinaryService.validateServiceImageReference(id, image_url, image_public_id);
        const result = await pool.query(
            `UPDATE items
             SET sidro_image_url = $1, sidro_image_public_id = $2, updated_at = NOW()
             WHERE id = $3 AND tipo = 'SERVICIO'
             RETURNING id, sidro_image_url, sidro_image_public_id`,
            [image_url, image_public_id, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Servicio no encontrado' });
        return res.json(result.rows[0]);
    } catch (error: any) {
        const status = /no está configurado/.test(error.message || '') ? 503 : 400;
        return res.status(status).json({ error: error.message || 'No se pudo guardar la imagen' });
    }
};

export const removeServiceImage = async (req: Request, res: Response) => {
    const id = getRouteParam(req.params.id);
    if (!uuidPattern.test(id)) return res.status(400).json({ error: 'Servicio inválido' });

    try {
        const current = await pool.query(
            `SELECT sidro_image_public_id FROM items WHERE id = $1 AND tipo = 'SERVICIO'`,
            [id]
        );
        if (current.rows.length === 0) return res.status(404).json({ error: 'Servicio no encontrado' });

        const publicId = current.rows[0].sidro_image_public_id as string | null;
        if (publicId) await CloudinaryService.destroyServiceImage(publicId);

        const result = await pool.query(
            `UPDATE items
             SET sidro_image_url = NULL, sidro_image_public_id = NULL, updated_at = NOW()
             WHERE id = $1
             RETURNING id, sidro_image_url, sidro_image_public_id`,
            [id]
        );
        return res.json(result.rows[0]);
    } catch (error: any) {
        const status = /no está configurado/.test(error.message || '') ? 503 : 502;
        return res.status(status).json({ error: error.message || 'No se pudo eliminar la imagen' });
    }
};

// --- Horarios de Profesionales ---
export const setEmployeeSchedule = async (req: Request, res: Response) => {
    const { employee_id } = req.params;
    const { schedules } = req.body;

    if (req.userRole !== 'admin') {
        const uEmpId = await getUserEmployeeId(req.userId as string);
        if (String(uEmpId) !== String(employee_id)) return res.status(403).json({ error: 'No tienes permiso para gestionar este horario' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query('DELETE FROM sidro_employee_schedules WHERE employee_id = $1', [employee_id]);

        for (const sch of schedules) {
            await client.query(
                `INSERT INTO sidro_employee_schedules (employee_id, day_of_week, start_time, end_time)
                 VALUES ($1, $2, $3, $4)`,
                [employee_id, sch.day_of_week, sch.start_time, sch.end_time]
            );
        }
        await client.query('COMMIT');
        res.json({ message: 'Horarios actualizados' });
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar horarios' });
    } finally {
        if (client) client.release();
    }
};

export const getEmployeeSchedule = async (req: Request, res: Response) => {
    const { employee_id } = req.params;

    if (req.userRole !== 'admin') {
        const uEmpId = await getUserEmployeeId(req.userId as string);
        if (String(uEmpId) !== String(employee_id)) return res.status(403).json({ error: 'No tienes permiso para ver este horario' });
    }

    try {
        const result = await pool.query(
            `SELECT day_of_week, start_time, end_time
             FROM sidro_employee_schedules WHERE employee_id = $1 ORDER BY day_of_week, start_time`,
            [employee_id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener horarios' });
    }
};

export const listRequests = async (req: Request, res: Response) => {
    try {
        let query = `SELECT r.*, s.nombre_completo as client_name,
                    COALESCE(service_group.service_name, i.nombre) as service_name,
                    COALESCE(
                        service_group.services,
                        jsonb_build_array(jsonb_build_object(
                            'service_id', i.id,
                            'service_name', i.nombre,
                            'image_url', i.sidro_image_url,
                            'position', 1
                        ))
                    ) as services,
                    e.nombre as employee_name,
                    l.client_id as linked_client_id
             FROM sidro_appointment_requests r
             JOIN sidro_client_accounts s ON r.sidro_account_id = s.id
             JOIN items i ON r.service_id = i.id
             JOIN employees e ON r.employee_id = e.id
             LEFT JOIN sidro_account_links l ON s.id = l.sidro_account_id AND l.is_active = true
             LEFT JOIN LATERAL (
                 SELECT
                     string_agg(si.nombre, ' + ' ORDER BY rs.position) AS service_name,
                     jsonb_agg(
                         jsonb_build_object(
                             'service_id', rs.service_id,
                             'service_name', si.nombre,
                             'image_url', si.sidro_image_url,
                             'position', rs.position,
                             'duration_minutes', rs.duration_minutes,
                             'padding_minutes', rs.padding_minutes,
                             'official_appointment_id', rs.official_appointment_id
                         ) ORDER BY rs.position
                     ) AS services
                 FROM sidro_appointment_request_services rs
                 JOIN items si ON si.id = rs.service_id
                 WHERE rs.request_id = r.id
             ) service_group ON true`;
        let params: any[] = [];
        if (req.userRole !== 'admin') {
            const uEmpId = await getUserEmployeeId(req.userId as string);
            if (!uEmpId) return res.status(403).json({ error: 'Usuario no vinculado a profesional' });
            query += ` WHERE r.employee_id = $1`;
            params.push(uEmpId);
        }
        query += ` ORDER BY r.request_date DESC, r.start_time ASC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al listar solicitudes' });
    }
};

export const acceptRequest = async (req: Request, res: Response) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Obtener la peticion y BLOCARLA PARA ACTUALIZACION (concurrencia)
        const reqRes = await client.query(
            `SELECT * FROM sidro_appointment_requests WHERE id = $1 FOR UPDATE`,
            [id]
        );
        if (reqRes.rows.length === 0) throw new Error('Solicitud no encontrada');
        const peticion = reqRes.rows[0];
        const linkRes = await client.query(
            `SELECT client_id AS linked_client_id
             FROM sidro_account_links
             WHERE sidro_account_id = $1 AND is_active = true`,
            [peticion.sidro_account_id]
        );
        peticion.linked_client_id = linkRes.rows[0]?.linked_client_id || null;

        if (req.userRole !== 'admin') {
            const uEmpId = await getUserEmployeeId(req.userId as string);
            if (uEmpId !== peticion.employee_id) throw new Error('No tienes permiso para gestionar esta solicitud');
        }

        if (peticion.status === 'RECHAZADA' || peticion.status === 'CONFIRMADA' || peticion.status === 'CANCELADA') {
            throw new Error('La solicitud ya fue procesada o esta inactiva');
        }

        const localDate = new Date(peticion.request_date);
        const yyyy = localDate.getFullYear();
        const mm = String(localDate.getMonth() + 1).padStart(2, '0');
        const dd = String(localDate.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;

        if (peticion.linked_client_id) {
            // Ya esta vinculada -> Crear la cita en POS usando el Servicio Transaccional y Validado
            const officialAppointmentIds = await SidroRequestAppointmentsService.createOfficialAppointments(
                client,
                peticion,
                peticion.linked_client_id,
                dateStr,
                'Generada desde SIDRO'
            );

            // Actualizar estado a CONFIRMADA
            await client.query(
                `UPDATE sidro_appointment_requests SET status = 'CONFIRMADA', official_appointment_id = $1 WHERE id = $2`,
                [officialAppointmentIds[0], id]
            );

            await client.query('COMMIT');
            return res.json({ message: 'Solicitud aprobada y convertida en cita oficial', status: 'CONFIRMADA' });
        } else {
            // No esta vinculada -> Queda aprobada pero pendiente de vinculacion
            // Tambien comprobamos conflictos solo por seguridad
            await SidroRequestAppointmentsService.validateOfficialAppointments(
                client,
                peticion,
                dateStr
            );

            await client.query(
                `UPDATE sidro_appointment_requests SET status = 'APROBADA_PENDIENTE_VINCULACION' WHERE id = $1`,
                [id]
            );
            await client.query('COMMIT');
            return res.json({ message: 'Solicitud aprobada y retenida. Falta vincular a la clienta.', status: 'APROBADA_PENDIENTE_VINCULACION' });
        }
    } catch (error: any) {
        if (client) await client.query('ROLLBACK');
        console.error(error);
        res.status(409).json({ error: error.message || 'Error al aprobar solicitud' });
    } finally {
        if (client) client.release();
    }
};

export const rejectRequest = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const check = await pool.query('SELECT employee_id FROM sidro_appointment_requests WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });
        if (req.userRole !== 'admin') {
            const uEmpId = await getUserEmployeeId(req.userId as string);
            if (uEmpId !== check.rows[0].employee_id) return res.status(403).json({ error: 'No tienes permiso para rechazar esta solicitud' });
        }

        await pool.query(`UPDATE sidro_appointment_requests SET status = 'RECHAZADA' WHERE id = $1`, [id]);
        res.json({ message: 'Solicitud rechazada' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al rechazar solicitud' });
    }
};

export const proposeAlternativeRequest = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { new_date, new_time } = req.body;
    try {
        const check = await pool.query('SELECT employee_id, start_time, end_time FROM sidro_appointment_requests WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });

        if (req.userRole !== 'admin') {
            const uEmpId = await getUserEmployeeId(req.userId as string);
            if (uEmpId !== check.rows[0].employee_id) return res.status(403).json({ error: 'No tienes permiso' });
        }

        const durMs = new Date(`1970-01-01T${check.rows[0].end_time}`).getTime() - new Date(`1970-01-01T${check.rows[0].start_time}`).getTime();
        const endDt = new Date(new Date(`1970-01-01T${new_time}`).getTime() + durMs);
        const new_end_time = endDt.toTimeString().split(' ')[0];

        await pool.query(`UPDATE sidro_appointment_requests SET status = 'PROPUESTA', proposed_date = $1, proposed_start_time = $2, proposed_end_time = $3 WHERE id = $4`, [new_date, new_time, new_end_time, id]);
        res.json({ message: 'Propuesta enviada a la clienta' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al enviar propuesta' });
    }
};

export const linkUserToEmployee = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { employee_id } = req.body;
    try {
        await pool.query('UPDATE users SET employee_id = $1 WHERE id = $2', [employee_id, id]);
        res.json({ message: 'Usuario vinculado a empleado correctamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al vincular usuario' });
    }
};
