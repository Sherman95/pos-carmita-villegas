const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
require('dotenv').config();

(async () => {
  const configured = new URL(process.env.DATABASE_URL);
  const dbName = configured.pathname.replace(/^\//, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(configured.hostname) || dbName.toLowerCase() !== 'poscarmitavlocal') {
    throw new Error('Migración abortada: este comando solo acepta poscarmitaVlocal en localhost');
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const identity = (await client.query('SELECT current_database() db, inet_server_addr()::text address')).rows[0];
    if (String(identity.db).toLowerCase() !== 'poscarmitavlocal' || !/^(::1\/128|127\.0\.0\.1\/32)$/.test(String(identity.address))) {
      throw new Error('Migración abortada: PostgreSQL no confirmó una instancia local');
    }
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'web_push_phase9.sql'), 'utf8'));
    const tables = await client.query("SELECT to_regclass('public.push_subscriptions')::text subscriptions,to_regclass('public.push_outbox')::text outbox");
    console.log(JSON.stringify({ database: identity.db, address: identity.address, ...tables.rows[0] }));
  } finally { await client.end(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
