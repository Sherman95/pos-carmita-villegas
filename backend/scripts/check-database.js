const path = require('node:path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

if (!process.env.DATABASE_URL) {
  console.error('[DB] DATABASE_URL no está configurada.');
  process.exit(1);
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function checkDatabase() {
  try {
    await client.connect();
    const result = await client.query(`
      SELECT
        current_database() AS database,
        current_user AS username,
        version() AS version
    `);

    const { database, username, version } = result.rows[0];
    console.log(`[DB] Conexión exitosa a "${database}" como "${username}".`);
    console.log(`[DB] ${version}`);
  } catch (error) {
    console.error(`[DB] No se pudo conectar: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

checkDatabase();
