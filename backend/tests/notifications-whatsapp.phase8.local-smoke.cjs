const assert = require('node:assert/strict');
const { Client } = require('pg');
require('dotenv').config();

const { initNotificationsPhase8Table } = require('../dist/database/migrateNotificationsPhase8.js');
const { NotificationsService } = require('../dist/services/notifications.service.js');
const { SidroNotificationTemplates } = require('../dist/services/notificationTemplates.js');

(async () => {
  const configured = new URL(process.env.DATABASE_URL);
  const expectedDb = configured.pathname.replace(/^\//, '');
  if (
    !['localhost', '127.0.0.1', '::1'].includes(configured.hostname) ||
    expectedDb.toLowerCase() !== 'poscarmitavlocal'
  ) {
    throw new Error('Smoke Fase 8 abortado: DATABASE_URL no apunta a poscarmitaVlocal en localhost');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const identity = (await client.query(
    'SELECT current_database() AS db, inet_server_addr()::text AS address'
  )).rows[0];
  assert.equal(String(identity.db).toLowerCase(), 'poscarmitavlocal');
  assert.match(String(identity.address), /^(::1\/128|127\.0\.0\.1\/32)$/);

  await initNotificationsPhase8Table();
  await initNotificationsPhase8Table();

  const columns = (
    await client.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'notifications' ORDER BY ordinal_position`
    )
  ).rows.map((row) => row.column_name);
  for (const expected of [
    'id',
    'recipient_type',
    'recipient_id',
    'type',
    'title',
    'body',
    'data',
    'dedupe_key',
    'read_at',
    'created_at',
    'expires_at'
  ]) {
    assert.ok(columns.includes(expected), `Falta la columna ${expected}`);
  }

  const constraints = (
    await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid = 'notifications'::regclass`
    )
  ).rows;
  assert.ok(
    constraints.some((row) => row.definition.includes('UNIQUE (recipient_type, recipient_id, dedupe_key)')),
    'Falta la restriccion unica de dedupe'
  );

  const indexes = (
    await client.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'notifications'`)
  ).rows.map((row) => row.indexname);
  assert.ok(indexes.includes('notifications_recipient_created_idx'));
  assert.ok(indexes.includes('notifications_recipient_unread_idx'));

  await client.query('BEGIN');
  try {
    const recipient = `smoke-${Date.now()}`;
    const input = {
      type: 'sidro_request_created',
      title: 'Smoke Fase 8',
      body: 'Prueba local de dedupe.',
      data: { url: '/citas/solicitudes?open=999' },
      dedupeKey: 'smoke:dedupe'
    };
    await NotificationsService.insertForRecipient(client, 'pos_user', recipient, input);
    await NotificationsService.insertForRecipient(client, 'pos_user', recipient, input);
    const deduped = (
      await client.query(
        `SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_id = $1`,
        [recipient]
      )
    ).rows[0].count;
    assert.equal(deduped, 1, 'El dedupe debe evitar filas repetidas');

    await NotificationsService.insertForRecipient(client, 'pos_user', recipient, {
      ...input,
      dedupeKey: 'smoke:second'
    });
    assert.equal(
      (
        await client.query(`SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_id = $1`, [
          recipient
        ])
      ).rows[0].count,
      2
    );

    const template = SidroNotificationTemplates.requestConfirmed({
      requestId: 999,
      clientName: 'Ana',
      serviceName: 'Coloración',
      date: '2026-10-20',
      time: '09:00:00'
    });
    assert.equal(template.data.url, '/my-requests?open=999');
    await NotificationsService.notifySidroAccount(client, 'smoke-account', {
      ...template,
      dedupeKey: 'smoke:sidro'
    });
    assert.equal(
      (
        await client.query(
          `SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_type = 'sidro_account' AND recipient_id = 'smoke-account'`
        )
      ).rows[0].count,
      1
    );
  } finally {
    await client.query('ROLLBACK');
  }

  await client.query(
    `SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_id LIKE 'smoke-%' OR recipient_id = 'smoke-account'`
  ).then((result) => assert.equal(result.rows[0].count, 0, 'El smoke no debe dejar filas'));

  await client.end();
  console.log(
    'Smoke Fase 8 OK: migracion idempotente, columnas, unique de dedupe, indices, dedupe real y plantillas.'
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
