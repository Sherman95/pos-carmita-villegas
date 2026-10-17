import { PoolClient } from 'pg';
import { assertAbsoluteInterval } from '../utils/businessTime';

export class AppointmentService {
    static async validateOfficialAppointmentAvailability(
        client: PoolClient,
        data: {
            employee_id: string | number;
            fecha_inicio: string;
            fecha_fin: string;
            force?: boolean;
            exclude_request_id?: number;
            exclude_appointment_id?: string | number;
        }
    ) {
        const { employee_id, fecha_inicio, fecha_fin, force, exclude_request_id, exclude_appointment_id } = data;

        assertAbsoluteInterval(fecha_inicio, fecha_fin);

        // Serializa la comprobacion por profesional dentro de la transaccion.
        await client.query('SELECT id FROM employees WHERE id = $1 FOR UPDATE', [employee_id]);

        if (force) return;

        const conflictQuery = `
            SELECT a.*, c.nombre as client_nombre, i.nombre as item_nombre
            FROM appointments a
            JOIN clients c ON a.client_id = c.id
            JOIN items i ON a.item_id = i.id
            WHERE a.employee_id = $1
              AND a.fecha_inicio < $3::timestamptz
              AND a.fecha_fin > $2::timestamptz
              AND COALESCE(a.estado, 'PROGRAMADA') <> 'CANCELADA'
              ${exclude_appointment_id !== undefined ? 'AND a.id <> $4' : ''}
        `;
        const conflictParams: Array<string | number> = [employee_id, fecha_inicio, fecha_fin];
        if (exclude_appointment_id !== undefined) conflictParams.push(exclude_appointment_id);
        const { rows: conflicts } = await client.query(conflictQuery, conflictParams);

        if (conflicts.length > 0) {
            const conflict = conflicts[0];
            const formatTime = (date: string) => new Date(date).toLocaleString('es-EC', {
                timeZone: 'America/Guayaquil',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
            throw new Error(
                `El profesional ya tiene una cita agendada: "${conflict.item_nombre}" con el cliente "${conflict.client_nombre}" de ${formatTime(conflict.fecha_inicio)} a ${formatTime(conflict.fecha_fin)}.`
            );
        }

        const requestConflictQuery = `
            SELECT r.*, i.nombre as item_nombre
            FROM sidro_appointment_requests r
            JOIN items i ON r.service_id = i.id
            WHERE r.employee_id = $1
              AND r.status = 'APROBADA_PENDIENTE_VINCULACION'
              AND ((r.request_date + r.start_time) AT TIME ZONE 'America/Guayaquil') < $3::timestamptz
              AND ((r.request_date + r.end_time) AT TIME ZONE 'America/Guayaquil') > $2::timestamptz
              ${exclude_request_id !== undefined ? `AND r.id != $4` : ''}
        `;
        const params: Array<string | number> = [employee_id, fecha_inicio, fecha_fin];
        if (exclude_request_id !== undefined) params.push(exclude_request_id);

        const { rows: requestConflicts } = await client.query(requestConflictQuery, params);
        if (requestConflicts.length > 0) {
            const conflict = requestConflicts[0];
            throw new Error(
                `El profesional tiene una solicitud retenida pendiente de vinculacion para: "${conflict.item_nombre}" que interfiere en este horario.`
            );
        }
    }

    static async createOfficialAppointment(
        client: PoolClient,
        data: {
            client_id: string;
            item_id: string;
            employee_id: string | number;
            fecha_inicio: string;
            fecha_fin: string;
            estado?: string;
            notas?: string;
            force?: boolean;
            exclude_request_id?: number;
        }
    ) {
        const { client_id, item_id, employee_id, fecha_inicio, fecha_fin, estado, notas, force, exclude_request_id } = data;

        await this.validateOfficialAppointmentAvailability(client, {
            employee_id,
            fecha_inicio,
            fecha_fin,
            force,
            exclude_request_id
        });

        // 3. Obtener nombres para el título del evento
        const { rows: details } = await client.query(
            `SELECT
                (SELECT nombre FROM employees WHERE id = $1) as emp_name,
                (SELECT nombre FROM items WHERE id = $2) as item_name,
                (SELECT nombre FROM clients WHERE id = $3) as client_name`,
            [employee_id, item_id, client_id]
        );
        const { emp_name, item_name, client_name } = details[0];

        // 4. Insertar en PostgreSQL (Transaccional)
        const { rows } = await client.query(
            `INSERT INTO appointments
            (client_id, item_id, employee_id, fecha_inicio, fecha_fin, estado, notas)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [client_id, item_id, employee_id, fecha_inicio, fecha_fin, estado || 'PROGRAMADA', notas || null]
        );
        const newAppointment = rows[0];

        // 5. Encolar para Google Calendar (fuera de la transacción de red)
        await client.query(
            `INSERT INTO google_calendar_sync_queue (appointment_id, employee_id) VALUES ($1, $2)`,
            [newAppointment.id, employee_id]
        );

        return newAppointment;
    }
}
