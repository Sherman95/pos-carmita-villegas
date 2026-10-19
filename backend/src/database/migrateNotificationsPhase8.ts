import pool from './db';

export async function initNotificationsPhase8Table() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      recipient_type VARCHAR(16) NOT NULL CHECK (recipient_type IN ('pos_user', 'sidro_account')),
      recipient_id TEXT NOT NULL,
      type VARCHAR(64) NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      dedupe_key TEXT NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      CONSTRAINT notifications_recipient_dedupe_unique UNIQUE (recipient_type, recipient_id, dedupe_key)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
      ON notifications (recipient_type, recipient_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
      ON notifications (recipient_type, recipient_id)
      WHERE read_at IS NULL
  `);
}
