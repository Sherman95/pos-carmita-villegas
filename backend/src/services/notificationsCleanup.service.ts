import pool from '../database/db';

export const NOTIFICATIONS_RETENTION_HOURS = 24;
const CLEANUP_ADVISORY_LOCK_KEY = 78011941;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_BATCHES = 40;

export interface CleanupResult {
  skipped: boolean;
  batches: number;
  deleted: number;
  supersededJobs: number;
  durationMs: number;
}

export const notificationsCleanupEnabled = (): boolean => process.env.NOTIFICATIONS_CLEANUP_DISABLED !== 'true';

export async function purgeReadNotifications(options: {
  pool?: any;
  retentionHours?: number;
  batchSize?: number;
  maxBatches?: number;
} = {}): Promise<CleanupResult> {
  const db = options.pool || pool;
  const retentionHours = options.retentionHours ?? NOTIFICATIONS_RETENTION_HOURS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;
  const startedAt = Date.now();
  const result: CleanupResult = { skipped: false, batches: 0, deleted: 0, supersededJobs: 0, durationMs: 0 };

  if (!notificationsCleanupEnabled()) {
    result.skipped = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const client = await db.connect();
  let locked = false;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [CLEANUP_ADVISORY_LOCK_KEY]);
    locked = Boolean(lock.rows?.[0]?.locked);
    if (!locked) {
      result.skipped = true;
      return result;
    }

    for (let batch = 0; batch < maxBatches; batch += 1) {
      await client.query('BEGIN');
      try {
        const candidates = await client.query(
          `SELECT id FROM notifications
           WHERE read_at IS NOT NULL AND read_at <= NOW() - ($1::int * INTERVAL '1 hour')
           ORDER BY read_at ASC
           LIMIT $2
           FOR UPDATE SKIP LOCKED`,
          [retentionHours, batchSize]
        );
        if (candidates.rows.length === 0) {
          await client.query('COMMIT');
          break;
        }
        const ids = candidates.rows.map((row: any) => row.id);
        const superseded = await client.query(
          `UPDATE push_outbox SET status='SUPERSEDED',locked_at=NULL,updated_at=NOW()
           WHERE notification_id = ANY($1::bigint[]) AND status IN ('PENDING','FAILED_RETRY')`,
          [ids]
        );
        const deleted = await client.query(
          'DELETE FROM notifications WHERE id = ANY($1::bigint[])',
          [ids]
        );
        await client.query('COMMIT');
        result.batches += 1;
        result.deleted += deleted.rowCount || 0;
        result.supersededJobs += superseded.rowCount || 0;
        if (ids.length < batchSize) break;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return result;
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [CLEANUP_ADVISORY_LOCK_KEY]);
      } catch {
        /* sin bloqueo */
      }
    }
    client?.release?.();
    result.durationMs = Date.now() - startedAt;
  }
}
