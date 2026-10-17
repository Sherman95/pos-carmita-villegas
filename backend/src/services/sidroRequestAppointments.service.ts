import { PoolClient } from 'pg';
import { AppointmentService } from './appointment.service';
import { buildSidroAppointmentNotes } from '../utils/sidroNotes';
import { localMinutesToInstant, timeToMinutes } from '../utils/businessTime';

export interface SidroRequestServiceSegment {
    service_id: string;
    service_name: string;
    duration_minutes: number;
    padding_minutes: number;
    total_minutes: number;
    position: number;
}

interface SidroRequestLike {
    id: number;
    service_id: string;
    employee_id: string | number;
    start_time: string;
    client_notes?: string | null;
}

export class SidroRequestAppointmentsService {
    static async getSegments(
        client: PoolClient,
        request: SidroRequestLike
    ): Promise<SidroRequestServiceSegment[]> {
        const result = await client.query(
            `SELECT request_service.service_id,
                    item.nombre AS service_name,
                    request_service.duration_minutes,
                    request_service.padding_minutes,
                    (request_service.duration_minutes + request_service.padding_minutes)::int AS total_minutes,
                    request_service.position
             FROM sidro_appointment_request_services request_service
             JOIN items item ON item.id = request_service.service_id
             WHERE request_service.request_id = $1
             ORDER BY request_service.position`,
            [request.id]
        );

        if (result.rows.length > 0) {
            return result.rows.map((row) => ({
                service_id: row.service_id,
                service_name: row.service_name,
                duration_minutes: Number(row.duration_minutes),
                padding_minutes: Number(row.padding_minutes),
                total_minutes: Number(row.total_minutes),
                position: Number(row.position)
            }));
        }

        const fallback = await client.query(
            `SELECT item.id AS service_id,
                    item.nombre AS service_name,
                    COALESCE(professional.specific_duration_minutes, item.duration_minutes, 60)::int AS duration_minutes,
                    COALESCE(item.padding_minutes, 0)::int AS padding_minutes
             FROM items item
             LEFT JOIN sidro_service_professionals professional
               ON professional.service_id = item.id
              AND professional.employee_id = $2
             WHERE item.id = $1`,
            [request.service_id, request.employee_id]
        );

        if (fallback.rows.length === 0) throw new Error('El servicio de la solicitud ya no existe');
        const service = fallback.rows[0];
        return [{
            service_id: service.service_id,
            service_name: service.service_name,
            duration_minutes: Number(service.duration_minutes),
            padding_minutes: Number(service.padding_minutes),
            total_minutes: Number(service.duration_minutes) + Number(service.padding_minutes),
            position: 1
        }];
    }

    static async createOfficialAppointments(
        client: PoolClient,
        request: SidroRequestLike,
        clientId: string,
        dateStr: string,
        notePrefix: string
    ): Promise<Array<string | number>> {
        const segments = await this.getSegments(client, request);
        const appointmentIds: Array<string | number> = [];
        let cursorMinutes = timeToMinutes(request.start_time);

        for (const segment of segments) {
            const segmentStart = cursorMinutes;
            const segmentEnd = cursorMinutes + segment.total_minutes;
            const appointment = await AppointmentService.createOfficialAppointment(client, {
                client_id: clientId,
                item_id: segment.service_id,
                employee_id: request.employee_id,
                fecha_inicio: localMinutesToInstant(dateStr, segmentStart),
                fecha_fin: localMinutesToInstant(dateStr, segmentEnd),
                estado: 'PROGRAMADA',
                notas: buildSidroAppointmentNotes(
                    `${notePrefix} · Servicio ${segment.position} de ${segments.length}`,
                    request.client_notes
                ),
                force: false,
                exclude_request_id: request.id
            });

            appointmentIds.push(appointment.id);
            await client.query(
                `UPDATE sidro_appointment_request_services
                 SET official_appointment_id = $1
                 WHERE request_id = $2 AND position = $3`,
                [appointment.id, request.id, segment.position]
            );
            cursorMinutes = segmentEnd;
        }

        return appointmentIds;
    }

    static async validateOfficialAppointments(
        client: PoolClient,
        request: SidroRequestLike,
        dateStr: string
    ): Promise<void> {
        const segments = await this.getSegments(client, request);
        let cursorMinutes = timeToMinutes(request.start_time);

        for (const segment of segments) {
            const segmentStart = cursorMinutes;
            const segmentEnd = cursorMinutes + segment.total_minutes;
            await AppointmentService.validateOfficialAppointmentAvailability(client, {
                employee_id: request.employee_id,
                fecha_inicio: localMinutesToInstant(dateStr, segmentStart),
                fecha_fin: localMinutesToInstant(dateStr, segmentEnd),
                force: false,
                exclude_request_id: request.id
            });
            cursorMinutes = segmentEnd;
        }
    }
}
