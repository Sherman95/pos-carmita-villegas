const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL no configurada');
  const parsed = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('Abortado: DATABASE_URL no apunta a PostgreSQL local');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const migration = fs.readFileSync(path.resolve(__dirname, '../google_calendar_phase5.sql'), 'utf8');
    await client.query(migration);
    await client.query(migration);
    await client.query(fs.readFileSync(path.resolve(__dirname, './google-calendar.phase5.local-smoke.sql'), 'utf8'));
    const result = await client.query(
      `SELECT to_regclass('public.google_calendar_outbox') AS table_name,
              count(1)::int AS rows
       FROM google_calendar_outbox`
    );
    console.log('[GCAL][SMOKE] Migración idempotente y rollback verificados', result.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[GCAL][SMOKE]', error.message);
  process.exitCode = 1;
});
