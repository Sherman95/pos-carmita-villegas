require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const username = process.env.MIGRATE_USERNAME;
const password = process.env.MIGRATE_PASSWORD;

if (!username || !password) {
  throw new Error('Define MIGRATE_USERNAME y MIGRATE_PASSWORD fuera del código fuente');
}

const db = new Client({ connectionString: process.env.DATABASE_URL });

(async () => {
  await db.connect();
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await db.query(
      `UPDATE users SET password = $1, updated_at = NOW()
       WHERE username = $2
       RETURNING id, username`,
      [hash, username]
    );
    if (result.rowCount !== 1) throw new Error('Usuario no encontrado');
    console.log(`Contraseña migrada para ${result.rows[0].username}`);
  } finally {
    await db.end();
  }
})().catch(error => {
  console.error(`Migración fallida: ${error.message}`);
  process.exitCode = 1;
});
