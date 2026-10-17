require('dotenv').config();

const pool = require('../dist/database/db.js').default;
const { AvailabilityEngine } = require('../dist/services/availability.engine.js');

(async () => {
  try {
    const fixture = await pool.query(
      `SELECT appointment.employee_id, appointment.item_id
       FROM appointments appointment
       JOIN items item ON item.id = appointment.item_id
       WHERE (appointment.fecha_inicio AT TIME ZONE 'America/Guayaquil')::date = '2026-12-12'::date
         AND item.tipo = 'SERVICIO'
       LIMIT 1`
    );
    if (fixture.rows.length === 0) {
      console.log('LOCAL_DB_PHASE2: SKIP_NO_FIXTURE');
      return;
    }
    const row = fixture.rows[0];
    const sessionClient = await pool.connect();
    const readIntervals = async (timeZone) => {
      await sessionClient.query('BEGIN');
      try {
        await sessionClient.query(`SET LOCAL TIME ZONE '${timeZone}'`);
        const result = await sessionClient.query(
          `WITH bounds AS (
              SELECT $2::date::timestamp AT TIME ZONE 'America/Guayaquil' AS day_start,
                     ($2::date + 1)::timestamp AT TIME ZONE 'America/Guayaquil' AS day_end
           )
           SELECT FLOOR(EXTRACT(EPOCH FROM (GREATEST(appointment.fecha_inicio, bounds.day_start) - bounds.day_start)) / 60)::int AS start_minute,
                  CEIL(EXTRACT(EPOCH FROM (LEAST(appointment.fecha_fin, bounds.day_end) - bounds.day_start)) / 60)::int AS end_minute
           FROM appointments appointment
           CROSS JOIN bounds
           WHERE appointment.employee_id = $1
             AND appointment.fecha_inicio < bounds.day_end
             AND appointment.fecha_fin > bounds.day_start
             AND COALESCE(appointment.estado, 'PROGRAMADA') <> 'CANCELADA'
           ORDER BY appointment.fecha_inicio`,
          [row.employee_id, '2026-12-12']
        );
        return result.rows;
      } finally {
        await sessionClient.query('ROLLBACK');
      }
    };
    let utcIntervals;
    let ecuadorIntervals;
    try {
      utcIntervals = await readIntervals('UTC');
      ecuadorIntervals = await readIntervals('America/Guayaquil');
    } finally {
      sessionClient.release();
    }
    assertDeepEqual(utcIntervals, ecuadorIntervals, 'UTC y Ecuador devolvieron intervalos distintos');

    const slots = await AvailabilityEngine.getAvailableSlots(
      String(row.item_id),
      String(row.employee_id),
      '2026-12-12'
    );
    const result = {
      blocked1430: !slots.includes('14:30'),
      blocked1500: !slots.includes('15:00'),
      blocked1530: !slots.includes('15:30'),
      allows1400: slots.includes('14:00'),
      allows1600: slots.includes('16:00')
    };
    console.log(`LOCAL_DB_PHASE2: ${JSON.stringify({ ...result, sameIntervalsAcrossSessionTimeZones: true })}`);
    if (Object.values(result).some((value) => !value)) process.exitCode = 1;
  } catch (error) {
    console.error(`LOCAL_DB_PHASE2_ERROR: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}
