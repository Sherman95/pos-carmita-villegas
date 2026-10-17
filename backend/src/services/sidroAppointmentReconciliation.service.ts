import { PoolClient } from 'pg';

export class SidroAppointmentReconciliationService {
    static async getRelatedRequestIds(
        client: PoolClient,
        appointmentId: string | number
    ): Promise<number[]> {
        const result = await client.query(
            `SELECT DISTINCT related.request_id
             FROM (
                 SELECT request.id AS request_id
                 FROM sidro_appointment_requests request
                 WHERE request.official_appointment_id = $1
                 UNION ALL
                 SELECT service.request_id
                 FROM sidro_appointment_request_services service
                 WHERE service.official_appointment_id = $1
             ) related`,
            [appointmentId]
        );
        return result.rows.map((row) => Number(row.request_id));
    }

    static async reconcileRequests(client: PoolClient, requestIds: number[]): Promise<void> {
        for (const requestId of [...new Set(requestIds)]) {
            const active = await client.query(
                `SELECT appointment.id
                 FROM appointments appointment
                 WHERE COALESCE(appointment.estado, 'PROGRAMADA') <> 'CANCELADA'
                   AND (
                       appointment.id = (SELECT official_appointment_id FROM sidro_appointment_requests WHERE id = $1)
                       OR appointment.id IN (
                           SELECT official_appointment_id
                           FROM sidro_appointment_request_services
                           WHERE request_id = $1 AND official_appointment_id IS NOT NULL
                       )
                   )
                 ORDER BY appointment.fecha_inicio
                 LIMIT 1`,
                [requestId]
            );

            if (active.rows.length > 0) {
                await client.query(
                    `UPDATE sidro_appointment_requests
                     SET official_appointment_id = $1
                     WHERE id = $2 AND status = 'CONFIRMADA'`,
                    [active.rows[0].id, requestId]
                );
                continue;
            }

            await client.query(
                `UPDATE sidro_appointment_requests
                 SET status = 'CANCELADA',
                     official_appointment_id = NULL,
                     proposed_date = NULL,
                     proposed_start_time = NULL,
                     proposed_end_time = NULL
                 WHERE id = $1 AND status = 'CONFIRMADA'`,
                [requestId]
            );
        }
    }
}
