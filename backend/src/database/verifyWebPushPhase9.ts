import pool from './db';

export interface WebPushSchemaStatus {
  ok: boolean;
  missing: string[];
}

export async function verifyWebPushPhase9(): Promise<WebPushSchemaStatus> {
  const result = await pool.query(
    `SELECT to_regclass('public.push_subscriptions')::text AS subscriptions,
            to_regclass('public.push_outbox')::text AS outbox`
  );
  const missing: string[] = [];
  if (!result.rows[0]?.subscriptions) missing.push('push_subscriptions');
  if (!result.rows[0]?.outbox) missing.push('push_outbox');
  return { ok: missing.length === 0, missing };
}
