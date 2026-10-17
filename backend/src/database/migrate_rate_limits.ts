import pool from './db';

export async function initRateLimitTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_rate_limit_counters (
      bucket_key TEXT PRIMARY KEY,
      hits INTEGER NOT NULL DEFAULT 0,
      reset_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
