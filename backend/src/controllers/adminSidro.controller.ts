import { Request, Response } from 'express';
import { PoolClient } from 'pg';
import pool from '../database/db';
import { SidroRequestAppointmentsService } from '../services/sidroRequestAppointments.service';
import { isValidAddress, isValidEmail, isValidFullName, normalizeAddress, normalizeEmail, normalizeFullName, normalizeWhatsapp } from '../services/sidroIdentity.service';
import { NotificationsService } from '../services/notifications.service';
import { SidroNotificationTemplates } from '../services/notificationTemplates';
import { CloudinaryService } from '../services/cloudinary.service';
import { normalizeDateOnly, minutesToTime, timeToMinutes } from '../utils/businessTime';
import { canManageRole } from '../security/rbac';
import { AdminAuditService } from '../services/adminAudit.service';
import { normalizeDocumento, validateEcuadorDocument } from '../utils/ecuadorId';

const canManageAllSidroRequests = (role: string | undefined) => ['owner', 'admin', 'reception'].includes(role || '');
const canManageAllSchedules = (role: string | undefined) => ['owner', 'admin'].includes(role || '');

const getUserEmployeeId = async (userId: string): Promise<string | null> => {
    const res = await pool.query('SELECT employee_id FROM users WHERE id = $1', [userId]);
    return res.rows[0]?.employee_id || null;
};

const loadSidroRequestNames = async (
    client: PoolClient,
    sidroAccountId: string | number,
    serviceId: string
): Promise<{ clientName: string; serviceName: string }> => {
    const [clientRow, serviceRow] = await Promise.all([
        client.query('SELECT nombre_completo FROM sidro_client_accounts WHERE id = $1', [sidroAccountId]),
        client.query('SELECT nombre FROM items WHERE id = $1', [serviceId])
    ]);
    return {
        clientName: clientRow.rows[0]?.nombre_completo || 'Una clienta',
        serviceName: serviceRow.rows[0]?.nombre || 'servicio'
    };
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

interface LinkRequestOutcome {
  confirmed: Array<{ request_id: number; appointment_id: string | number; date: string; time: string }>;
  conflicts: Array<{ request_id: number; date: string; time: string }>;
}

const processPendingRequestsForLink = async (
  client: PoolClient,
  sidroAccountId: string | number,
  clientId: string,
  notePrefix: string
): Promise<LinkRequestOutcome> => {
  const pendingReqs = await client.query(
    `SELECT * FROM sidro_appointment_requests
     WHERE sidro_account_id = $1 AND status = 'APROBADA_PENDIENTE_VINCULACION' FOR UPDATE`,
    [sidroAccountId]
  );

  const outcome: LinkRequestOutcome = { confirmed: [], conflicts: [] };
  const confirmedContexts: Array<{ requestId: number; clientName: string; serviceName: string; date: string; time: string }> = [];
  const conflictContexts: Array<{ requestId: number; clientName: string; serviceName: string; date: string; time: string }> = [];

  for (const reqData of pendingReqs.rows) {
    const names = await loadSidroRequestNames(client, reqData.sidro_account_id, reqData.service_id);
    const context = {
      requestId: reqData.id,
      clientName: names.clientName,
      serviceName: names.serviceName,
      date: reqData.request_date,
      time: reqData.start_time
    };
    try {
      const dateStr = normalizeDateOnly(reqData.request_date);
      const officialAppointmentIds = await SidroRequestAppointmentsService.createOfficialAppointments(
        client,
        reqData,
        clientId,
        dateStr,
        notePrefix
      );
      await client.query(
        `UPDATE sidro_appointment_requests SET status = 'CONFIRMADA', official_appointment_id = $1 WHERE id = $2`,
        [officialAppointmentIds[0], reqData.id]
      );
      confirmedContexts.push(context);
      outcome.confirmed.push({ request_id: reqData.id, appointment_id: officialAppointmentIds[0], date: reqData.request_date, time: reqData.start_time });
    } catch (e: any) {
      console.error(`Conflicto al procesar solicitud ${reqData.id}:`, e.message);
      await client.query(`UPDATE sidro_appointment_requests SET status = 'CONFLICTO_VINCULACION' WHERE id = $1`, [reqData.id]);
      conflictContexts.push(context);
      outcome.conflicts.push({ request_id: reqData.id, date: reqData.request_date, time: reqData.start_time });
    }
  }

  for (const context of confirmedContexts) {
    await NotificationsService.notifySidroAccount(
      client,
      sidroAccountId,
      SidroNotificationTemplates.requestConfirmed(context)
    );
  }
  for (const context of conflictContexts) {
    await NotificationsService.notifyPosStaff(client, SidroNotificationTemplates.linkConflict(context));
  }

  return outcome;
};

export const linkAccount = async (req: Request, res: Response) => {
  const { sidro_account_id, client_id, force } = req.body;
  const allowReassignment = force === true;
  const admin_id = (req as any).userId; // o (req as any).user.id dependiendo de la auth

  if (!sidro_account_id || !client_id) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // Verificar si el cliente ya esta vinculado a otra cuenta
    if (!allowReassignment) {
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

    const outcome = await processPendingRequestsForLink(client, sidro_account_id, client_id, 'Generada desde SIDRO post-vinculacion');

    await AdminAuditService.record('SIDRO_ACCOUNT_LINKED', req.userId || null, null, {
      link_id: String(result.rows[0].id),
      sidro_account_id: String(sidro_account_id),
      client_id: String(client_id),
      reassignment: allowReassignment,
      confirmed_requests: outcome.confirmed.length,
      conflicts: outcome.conflicts.length
    }, client);

    await client.query('COMMIT');
    res.json({
      message: 'Vinculacion exitosa y solicitudes procesadas',
      id: result.rows[0].id,
      confirmed_requests: outcome.confirmed,
      conflicts: outcome.conflicts
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Error al vincular cuentas' });
  } finally {
    if (client) client.release();
  }
};

const loadAccountForLinking = async (client: PoolClient, sidroAccountId: string) => {
  const account = (await client.query(
    `SELECT id, nombre_completo, telefono, email, documento, direccion
     FROM sidro_client_accounts WHERE id = $1 AND is_active = true FOR UPDATE`,
    [sidroAccountId]
  )).rows[0];
  if (!account) return null;
  const activeLink = (await client.query(
    `SELECT id, client_id FROM sidro_account_links WHERE sidro_account_id = $1 AND is_active = true FOR UPDATE`,
    [sidroAccountId]
  )).rows[0] || null;
  return { account, activeLink };
};

const findClientMatches = async (
  client: PoolClient,
  account: { id: string; telefono: string | null; email: string | null; documento: string | null }
) => {
  const digits = String(account.telefono ?? '').replace(/\D/g, '');
  const phones = new Set<string>();
  if (digits) {
    phones.add(digits);
    if (digits.startsWith('5939')) phones.add(`0${digits.slice(3)}`);
  }
  const rows = (await client.query(
    `SELECT c.id, c.nombre, c.cedula, c.telefono, c.email, c.direccion,
            ($1::text IS NOT NULL AND c.cedula = $1) AS match_documento,
            ($2::text <> '' AND c.email IS NOT NULL AND lower(c.email) = lower($2)) AS match_email,
            (c.telefono IS NOT NULL AND regexp_replace(c.telefono, '\\D', '', 'g') = ANY($3::text[])) AS match_telefono,
            l.sidro_account_id AS linked_sidro_account_id
     FROM clients c
     LEFT JOIN sidro_account_links l ON l.client_id = c.id AND l.is_active = true
     WHERE (($1::text IS NOT NULL AND c.cedula = $1)
        OR ($2::text <> '' AND c.email IS NOT NULL AND lower(c.email) = lower($2))
        OR (c.telefono IS NOT NULL AND regexp_replace(c.telefono, '\\D', '', 'g') = ANY($3::text[])))
     ORDER BY match_documento DESC, match_email DESC
     LIMIT 10`,
    [account.documento, account.email || '', [...phones, '__none__']]
  )).rows;

  return rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    cedula: row.cedula,
    telefono: row.telefono,
    email: row.email,
    direccion: row.direccion,
    match_reasons: [
      row.match_documento ? 'documento' : null,
      row.match_email ? 'correo' : null,
      row.match_telefono ? 'telefono' : null
    ].filter(Boolean),
    linked_to_other: Boolean(row.linked_sidro_account_id && row.linked_sidro_account_id !== account.id)
  }));
};

export const getAccountDetail = async (req: Request, res: Response) => {
  const id = getRouteParam(req.params.id);
  if (!uuidPattern.test(id)) return res.status(400).json({ error: 'Cuenta inválida' });
  try {
    const account = (await pool.query(
      `SELECT s.id, s.nombre_completo, s.telefono, s.email, s.documento, s.direccion, s.is_active,
              l.client_id AS linked_client_id, c.nombre AS linked_client_name
       FROM sidro_client_accounts s
       LEFT JOIN sidro_account_links l ON s.id = l.sidro_account_id AND l.is_active = true
       LEFT JOIN clients c ON c.id = l.client_id
       WHERE s.id = $1`,
      [id]
    )).rows[0];
    if (!account) return res.status(404).json({ error: 'Cuenta SIDRO no encontrada' });
    const documentValidation = account.documento ? validateEcuadorDocument(account.documento) : null;
    return res.json({
      account: {
        ...account,
        documento_checksum_valid: documentValidation ? documentValidation.checksum_valid : null,
        documento_verification_level: documentValidation ? documentValidation.verification_level : null,
        documento_official_verification: 'not_performed'
      }
    });
  } catch (error) {
    console.error('[SIDRO] Detalle de cuenta:', (error as any)?.code || 'UNKNOWN');
    return res.status(500).json({ error: 'No se pudo obtener la cuenta' });
  }
};

export const getAccountMatches = async (req: Request, res: Response) => {
  const id = getRouteParam(req.params.id);
  if (!uuidPattern.test(id)) return res.status(400).json({ error: 'Cuenta inválida' });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const loaded = await loadAccountForLinking(client, id);
    if (!loaded) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cuenta SIDRO no encontrada' });
    }
    const matches = await findClientMatches(client, loaded.account);
    await client.query('ROLLBACK');
    return res.json({ matches, linked_client_id: loaded.activeLink?.client_id || null });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    console.error('[SIDRO] Coincidencias:', (error as any)?.code || 'UNKNOWN');
    return res.status(500).json({ error: 'No se pudieron buscar coincidencias' });
  } finally {
    if (client) client.release();
  }
};

export const createClientAndLink = async (req: Request, res: Response) => {
  const sidroAccountId = String(req.body?.sidro_account_id || '');
  if (!uuidPattern.test(sidroAccountId)) return res.status(400).json({ error: 'Cuenta SIDRO inválida' });

  const name = normalizeFullName(req.body?.nombre);
  const documentValidation = validateEcuadorDocument(normalizeDocumento(req.body?.cedula ?? req.body?.documento));
  const phone = normalizeWhatsapp(req.body?.telefono);
  const email = normalizeEmail(req.body?.email);
  const address = normalizeAddress(req.body?.direccion);

  if (!isValidFullName(name)) return res.status(400).json({ error: 'Ingresa los apellidos y nombres del cliente' });
  if (!documentValidation.valid) return res.status(400).json({ error: documentValidation.error || 'Cédula o RUC no válido' });
  if (!phone) return res.status(400).json({ error: 'Ingresa un teléfono/WhatsApp válido' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Ingresa un correo electrónico válido' });
  if (!isValidAddress(address)) return res.status(400).json({ error: 'Ingresa la dirección del cliente' });

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const loaded = await loadAccountForLinking(client, sidroAccountId);
    if (!loaded) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cuenta SIDRO no encontrada' });
    }
    if (loaded.activeLink) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La cuenta SIDRO ya está vinculada a un cliente del POS' });
    }

    const matches = await findClientMatches(client, {
      id: loaded.account.id,
      telefono: phone,
      email,
      documento: documentValidation.normalized
    });
    const blockers = matches.filter((match) => match.match_reasons.includes('documento') || match.match_reasons.includes('correo'));
    if (blockers.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Ya existe un cliente en el POS con la misma cédula o correo. Revisa las coincidencias y vincula al cliente existente.',
        matches
      });
    }

    const createdClient = (await client.query(
      `INSERT INTO clients (nombre, cedula, telefono, email, direccion)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, nombre, cedula, telefono, email, direccion, created_at`,
      [name, documentValidation.normalized, phone, email, address]
    )).rows[0];

    const link = (await client.query(
      `INSERT INTO sidro_account_links (sidro_account_id, client_id, admin_id, is_active)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [sidroAccountId, createdClient.id, req.userId || null]
    )).rows[0];

    const outcome = await processPendingRequestsForLink(client, sidroAccountId, createdClient.id, 'Generada desde SIDRO post-vinculacion');

    await AdminAuditService.record('SIDRO_CLIENT_CREATED_AND_LINKED', req.userId || null, null, {
      link_id: String(link.id),
      sidro_account_id: sidroAccountId,
      client_id: String(createdClient.id),
      document_checksum_valid: documentValidation.checksum_valid,
      document_verification_level: documentValidation.verification_level,
      document_official_verification: documentValidation.official_verification,
      confirmed_requests: outcome.confirmed.length,
      conflicts: outcome.conflicts.length
    }, client);

    await client.query('COMMIT');
    return res.status(201).json({
      message: 'Cliente creado y vinculado',
      client: createdClient,
      link_id: link.id,
      confirmed_requests: outcome.confirmed,
      conflicts: outcome.conflicts,
      documento_checksum_valid: documentValidation.checksum_valid,
      documento_verification_level: documentValidation.verification_level,
      documento_official_verification: documentValidation.official_verification
    });
  } catch (error: any) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un cliente en el POS con la misma cédula o correo. Revisa las coincidencias y vincula al cliente existente.' });
    }
    console.error('[SIDRO] Crear cliente y vincular:', error?.code || 'UNKNOWN');
    return res.status(500).json({ error: 'No se pudo crear el cliente ni vincular la cuenta' });
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

    if (!canManageAllSchedules(req.userRole)) {
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

    if (!canManageAllSchedules(req.userRole)) {
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
                    COALESCE(NULLIF(TRIM(s.telefono), ''), c.telefono) as client_phone,
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
             LEFT JOIN clients c ON l.client_id = c.id
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
        if (!canManageAllSidroRequests(req.userRole)) {
            const uEmpId = await getUserEmployeeId(req.userId as string);
            if (!uEmpId) return res.status(403).json({ error: 'Usuario no vinculado a profesional' });
            query += ` WHERE r.employee_id = $1`;
            params.push(uEmpId);
        }
        query += ` ORDER BY r.request_date DESC, r.start_time ASC`;

        const result = await pool.query(query, params);
        res.json(result.rows.map((row) => ({
            ...row,
            client_phone: row.client_phone || null,
            client_phone_normalized: normalizeWhatsapp(row.client_phone)
        })));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al listar solicitudes' });
    }
};

export const acceptRequest = async (req: Request, res: Response) => {
    const id = String(req.params.id);
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

        if (!canManageAllSidroRequests(req.userRole)) {
            const uEmpId = await getUserEmployeeId(req.userId as string);
            if (String(uEmpId) !== String(peticion.employee_id)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'No tienes permiso para gestionar esta solicitud' });
            }
        }

        if (peticion.status !== 'PENDIENTE') {
            throw new Error('Solo una solicitud pendiente puede aprobarse en su horario original');
        }

        const dateStr = normalizeDateOnly(peticion.request_date);

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

            const names = await loadSidroRequestNames(client, peticion.sidro_account_id, peticion.service_id);
            await NotificationsService.notifySidroAccount(
                client,
                peticion.sidro_account_id,
                SidroNotificationTemplates.requestConfirmed({
                    requestId: id,
                    clientName: names.clientName,
                    serviceName: names.serviceName,
                    date: dateStr,
                    time: peticion.start_time
                })
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

            const names = await loadSidroRequestNames(client, peticion.sidro_account_id, peticion.service_id);
            const context = {
                requestId: id,
                clientName: names.clientName,
                serviceName: names.serviceName,
                date: peticion.request_date,
                time: peticion.start_time
            };
            await NotificationsService.notifySidroAccount(
                client,
                peticion.sidro_account_id,
                SidroNotificationTemplates.requestApprovedPendingLink(context)
            );
            await NotificationsService.notifyPosStaff(
                client,
                SidroNotificationTemplates.requestApprovedPendingLinkStaff(context)
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
    const id = String(req.params.id);
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const check = await client.query(
            `SELECT * FROM sidro_appointment_requests WHERE id = $1 FOR UPDATE`,
            [id]
        );
        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }
        const peticion = check.rows[0];
        if (!['PENDIENTE', 'PROPUESTA'].includes(peticion.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'La solicitud ya fue procesada o esta inactiva' });
        }
        if (!canManageAllSidroRequests(req.userRole)) {
            const uEmpId = await getUserEmployeeId(req.userId as string);
            if (String(uEmpId) !== String(peticion.employee_id)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'No tienes permiso para rechazar esta solicitud' });
            }
        }

        const updated = await client.query(
            `UPDATE sidro_appointment_requests SET status = 'RECHAZADA'
             WHERE id = $1 AND status IN ('PENDIENTE', 'PROPUESTA') RETURNING id`,
            [id]
        );
        if (updated.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'La solicitud cambio de estado; vuelve a cargar la lista' });
        }

        const names = await loadSidroRequestNames(client, peticion.sidro_account_id, peticion.service_id);
        await NotificationsService.notifySidroAccount(
            client,
            peticion.sidro_account_id,
            SidroNotificationTemplates.requestRejected({
                requestId: id,
                clientName: names.clientName,
                serviceName: names.serviceName,
                date: peticion.request_date,
                time: peticion.start_time
            })
        );

        await client.query('COMMIT');
        res.json({ message: 'Solicitud rechazada' });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => undefined);
        console.error(error);
        res.status(500).json({ error: 'Error al rechazar solicitud' });
    } finally {
        if (client) client.release();
    }
};

export const proposeAlternativeRequest = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const { new_date, new_time } = req.body;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const check = await client.query(
            `SELECT * FROM sidro_appointment_requests WHERE id = $1 FOR UPDATE`,
            [id]
        );
        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }
        const peticion = check.rows[0];
        if (peticion.status !== 'PENDIENTE') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Solo una solicitud pendiente puede recibir una propuesta' });
        }

        if (!canManageAllSidroRequests(req.userRole)) {
            const uEmpId = await getUserEmployeeId(req.userId as string);
            if (String(uEmpId) !== String(peticion.employee_id)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'No tienes permiso' });
            }
        }

        const durationMinutes = timeToMinutes(peticion.end_time) - timeToMinutes(peticion.start_time);
        const new_end_time = `${minutesToTime(timeToMinutes(new_time) + durationMinutes)}:00`;

        const updated = await client.query(
            `UPDATE sidro_appointment_requests
             SET status = 'PROPUESTA', proposed_date = $1, proposed_start_time = $2, proposed_end_time = $3
             WHERE id = $4 AND status = 'PENDIENTE' RETURNING id`,
            [new_date, new_time, new_end_time, id]
        );
        if (updated.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'La solicitud cambio de estado; vuelve a cargar la lista' });
        }

        const names = await loadSidroRequestNames(client, peticion.sidro_account_id, peticion.service_id);
        await NotificationsService.notifySidroAccount(
            client,
            peticion.sidro_account_id,
            SidroNotificationTemplates.proposalSent({
                requestId: id,
                clientName: names.clientName,
                serviceName: names.serviceName,
                date: peticion.request_date,
                time: peticion.start_time,
                proposedDate: new_date,
                proposedTime: new_time
            })
        );

        await client.query('COMMIT');
        res.json({ message: 'Propuesta enviada a la clienta' });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => undefined);
        console.error(error);
        res.status(500).json({ error: 'Error al enviar propuesta' });
    } finally {
        if (client) client.release();
    }
};

export const linkUserToEmployee = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { employee_id } = req.body;
    try {
        const target = (await pool.query('SELECT id,role FROM users WHERE id=$1', [id])).rows[0];
        if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (!canManageRole(req.userRole, target.role) || String(id) === String(req.userId)) {
            return res.status(403).json({ error: 'No puedes modificar la vinculación de esta cuenta' });
        }
        if (employee_id !== null && employee_id !== undefined && employee_id !== '') {
            const employee = await pool.query('SELECT id FROM employees WHERE id=$1 AND active=true', [employee_id]);
            if (!employee.rows.length) return res.status(400).json({ error: 'Profesional inexistente o inactivo' });
        }
        await pool.query('UPDATE users SET employee_id = $1,updated_at=NOW() WHERE id = $2', [employee_id || null, id]);
        await AdminAuditService.record('USER_EMPLOYEE_LINK_UPDATED', req.userId || null, String(id), { employee_id: employee_id || null });
        res.json({ message: 'Usuario vinculado a empleado correctamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al vincular usuario' });
    }
};
