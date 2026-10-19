import pool from './db';

export async function initNotificationsCleanupIndex() {
  await pool.query(`
    CREATE INDEX IF NOT EXISTS notifications_read_cleanup_idx
      ON notifications (read_at)
      WHERE read_at IS NOT NULL
  `);
}
