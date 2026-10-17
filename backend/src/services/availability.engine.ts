import pool from '../database/db';
import { dayOfWeekForBusinessDate, getBusinessNow, timeToMinutes, minutesToTime } from '../utils/businessTime';

interface TimeInterval {
    start: number;
    end: number;
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
        const dayOfWeek = dayOfWeekForBusinessDate(dateStr);
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
            `WITH bounds AS (
                SELECT $2::date::timestamp AT TIME ZONE 'America/Guayaquil' AS day_start,
                       ($2::date + 1)::timestamp AT TIME ZONE 'America/Guayaquil' AS day_end
             )
             SELECT FLOOR(EXTRACT(EPOCH FROM (GREATEST(a.fecha_inicio, bounds.day_start) - bounds.day_start)) / 60)::int AS start_minute,
                    CEIL(EXTRACT(EPOCH FROM (LEAST(a.fecha_fin, bounds.day_end) - bounds.day_start)) / 60)::int AS end_minute
             FROM appointments a
             CROSS JOIN bounds
             WHERE a.employee_id = $1
               AND a.fecha_inicio < bounds.day_end
               AND a.fecha_fin > bounds.day_start
               AND COALESCE(a.estado, 'PROGRAMADA') <> 'CANCELADA'`,
            [employeeId, dateStr]
        );

        const reqRes = await pool.query(
            `SELECT start_time, end_time FROM sidro_appointment_requests
             WHERE employee_id = $1
               AND request_date = $2
               AND status = 'APROBADA_PENDIENTE_VINCULACION'`,
            [employeeId, dateStr]
        );

        const occupiedIntervals: TimeInterval[] = [];

        for (const block of blocksRes.rows) {
            occupiedIntervals.push({ start: timeToMinutes(block.start_time), end: timeToMinutes(block.end_time) });
        }
        for (const appointment of posApptRes.rows) {
            occupiedIntervals.push({ start: Number(appointment.start_minute), end: Number(appointment.end_minute) });
        }
        for (const request of reqRes.rows) {
            occupiedIntervals.push({ start: timeToMinutes(request.start_time), end: timeToMinutes(request.end_time) });
        }

        const doesOverlap = (start: number, end: number) =>
            occupiedIntervals.some((occupied) => start < occupied.end && end > occupied.start);

        const businessNow = getBusinessNow();
        if (dateStr < businessNow.date) return [];

        const availableSlots: string[] = [];
        for (const schedule of schedRes.rows) {
            const shiftStart = timeToMinutes(schedule.start_time);
            const shiftEnd = timeToMinutes(schedule.end_time);

            for (let currentSlotStart = shiftStart; ; currentSlotStart += 30) {
                const currentSlotEnd = currentSlotStart + totalDuration;
                if (currentSlotEnd > shiftEnd) break;

                const isFuture = dateStr > businessNow.date || currentSlotStart > businessNow.minute;
                if (isFuture && !doesOverlap(currentSlotStart, currentSlotEnd)) {
                    availableSlots.push(minutesToTime(currentSlotStart));
                }
            }
        }

        return availableSlots;
    }
}
