import pool from '../database/db';

interface TimeInterval {
    start: Date;
    end: Date;
}

export interface SidroServicePlanItem {
    service_id: string;
    service_name: string;
    duration_minutes: number;
    padding_minutes: number;
    total_minutes: number;
    position: number;
}

export class AvailabilityEngine {
    static async getServicePlan(
        serviceIds: string[],
        employeeId: string
    ): Promise<SidroServicePlanItem[]> {
        const uniqueServiceIds = [...new Set(serviceIds)];
        if (uniqueServiceIds.length === 0) {
            throw new Error('Selecciona al menos un servicio');
        }

        const result = await pool.query(
            `WITH requested_services AS (
                SELECT service_id, position
                FROM unnest($1::uuid[]) WITH ORDINALITY AS requested(service_id, position)
             )
             SELECT requested.service_id,
                    i.nombre AS service_name,
                    COALESCE(sp.specific_duration_minutes, i.duration_minutes, 60)::int AS duration_minutes,
                    COALESCE(i.padding_minutes, 0)::int AS padding_minutes,
                    (COALESCE(sp.specific_duration_minutes, i.duration_minutes, 60) +
                     COALESCE(i.padding_minutes, 0))::int AS total_minutes,
                    requested.position::int AS position
             FROM requested_services requested
             JOIN items i ON i.id = requested.service_id
             LEFT JOIN sidro_service_professionals sp
               ON sp.service_id = requested.service_id
              AND sp.employee_id = $2
             WHERE i.active = true
               AND i.tipo = 'SERVICIO'
               AND (i.is_reservable = true OR i.duration_minutes IS NULL)
               AND (
                    sp.employee_id IS NOT NULL
                    OR NOT EXISTS (
                        SELECT 1
                        FROM sidro_service_professionals configured_professional
                        WHERE configured_professional.service_id = requested.service_id
                    )
               )
             ORDER BY requested.position`,
            [uniqueServiceIds, employeeId]
        );

        if (result.rows.length !== uniqueServiceIds.length) {
            throw new Error('La profesional seleccionada no atiende todos los servicios elegidos');
        }

        return result.rows.map((row) => ({
            service_id: row.service_id,
            service_name: row.service_name,
            duration_minutes: Number(row.duration_minutes),
            padding_minutes: Number(row.padding_minutes),
            total_minutes: Number(row.total_minutes),
            position: Number(row.position)
        }));
    }

    static async getAvailableSlots(serviceId: string, employeeId: string, dateStr: string) {
        return this.getAvailableSlotsForServices([serviceId], employeeId, dateStr);
    }

    static async getAvailableSlotsForServices(
        serviceIds: string[],
        employeeId: string,
        dateStr: string
    ) {
        const dateObj = new Date(dateStr + 'T00:00:00');
        const dayOfWeek = dateObj.getDay();
        const servicePlan = await this.getServicePlan(serviceIds, employeeId);
        const totalDuration = servicePlan.reduce((sum, service) => sum + service.total_minutes, 0);

        const schedRes = await pool.query(
            `SELECT start_time, end_time FROM sidro_employee_schedules
             WHERE employee_id = $1 AND day_of_week = $2`,
            [employeeId, dayOfWeek]
        );

        if (schedRes.rows.length === 0) return [];

        const blocksRes = await pool.query(
            `SELECT start_time, end_time, block_type FROM sidro_employee_blocks
             WHERE employee_id = $1 AND block_date = $2`,
            [employeeId, dateStr]
        );

        if (blocksRes.rows.some((block) => !block.start_time || !block.end_time)) return [];

        const posApptRes = await pool.query(
            `SELECT fecha_inicio::time AS start_time, fecha_fin::time AS end_time
             FROM appointments
             WHERE employee_id = $1
               AND fecha_inicio::date = $2
               AND estado != 'CANCELADA'`,
            [employeeId, dateStr]
        );

        const reqRes = await pool.query(
            `SELECT start_time, end_time FROM sidro_appointment_requests
             WHERE employee_id = $1
               AND request_date = $2
               AND status IN ('CONFIRMADA', 'APROBADA_PENDIENTE_VINCULACION')`,
            [employeeId, dateStr]
        );

        const occupiedIntervals: TimeInterval[] = [];
        const parseTime = (timeStr: string) => new Date(`${dateStr}T${timeStr}`);

        for (const block of blocksRes.rows) {
            occupiedIntervals.push({ start: parseTime(block.start_time), end: parseTime(block.end_time) });
        }
        for (const appointment of posApptRes.rows) {
            occupiedIntervals.push({ start: parseTime(appointment.start_time), end: parseTime(appointment.end_time) });
        }
        for (const request of reqRes.rows) {
            occupiedIntervals.push({ start: parseTime(request.start_time), end: parseTime(request.end_time) });
        }

        const doesOverlap = (start: Date, end: Date) =>
            occupiedIntervals.some((occupied) => start < occupied.end && end > occupied.start);

        const nowInGuayaquilStr = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Guayaquil',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(new Date());
        const [datePart, timePart] = nowInGuayaquilStr.split(', ');
        const [month, day, year] = datePart.split('/');
        const nowInGuayaquil = new Date(`${year}-${month}-${day}T${timePart}`);

        const availableSlots: string[] = [];
        for (const schedule of schedRes.rows) {
            const shiftStart = parseTime(schedule.start_time);
            const shiftEnd = parseTime(schedule.end_time);
            const currentSlotStart = new Date(shiftStart.getTime());

            while (true) {
                const currentSlotEnd = new Date(currentSlotStart.getTime() + totalDuration * 60000);
                if (currentSlotEnd > shiftEnd) break;

                if (currentSlotStart > nowInGuayaquil && !doesOverlap(currentSlotStart, currentSlotEnd)) {
                    const hours = String(currentSlotStart.getHours()).padStart(2, '0');
                    const minutes = String(currentSlotStart.getMinutes()).padStart(2, '0');
                    availableSlots.push(`${hours}:${minutes}`);
                }

                currentSlotStart.setMinutes(currentSlotStart.getMinutes() + 30);
            }
        }

        return availableSlots;
    }
}
