const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();
const { Client } = require('pg');

const url = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname.slice(1) !== 'poscarmitaVlocal') {
  throw new Error(`Migracion bloqueada: el destino no es poscarmitaVlocal en localhost`);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

(async () => {
  await client.connect();
  const before = await client.query(
    `SELECT current_database() AS database,
            COUNT(*) FILTER (WHERE estado = 'ABIERTA')::int AS abiertas,
            COUNT(*)::int AS total
     FROM cash_registers`
  );
  if (before.rows[0].abiertas > 1) throw new Error('Hay mas de una caja abierta; no se aplico la migracion');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'financial_integrity_phase3.sql'), 'utf8');
  await client.query(sql);
  const after = await client.query(
    `SELECT
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'operation_id') AS sales_operation_id,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payment_history' AND column_name = 'operation_id') AS payment_operation_id,
       (SELECT COUNT(*) FILTER (WHERE estado = 'ABIERTA')::int FROM cash_registers) AS abiertas`
  );
  console.log(JSON.stringify({ before: before.rows[0], after: after.rows[0] }));
})().finally(() => client.end());
