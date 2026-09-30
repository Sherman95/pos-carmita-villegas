import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runMigration() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'migration_calendars.sql'), 'utf8');
    await pool.query(sql);
    console.log('Migration executed successfully.');
  } catch (err) {
    console.error('Error executing migration:', err);
  } finally {
    pool.end();
  }
}

runMigration();
