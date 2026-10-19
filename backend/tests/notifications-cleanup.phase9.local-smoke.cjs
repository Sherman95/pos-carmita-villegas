const assert = require('node:assert/strict');
const { Client, Pool } = require('pg');
require('dotenv').config();

const { initNotificationsCleanupIndex } = require('../dist/database/migrateNotificationsCleanup.js');
const { purgeReadNotifications, NOTIFICATIONS_RETENTION_HOURS } = require('../dist/services/notificationsCleanup.service.js');

const CLEANUP_ADVISORY_LOCK_KEY = 78011941;

(async () => {
  const configured = new URL(process.env.DATABASE_URL);
  const expectedDb = configured.pathname.replace(/^\//, '');
  if (
    !['localhost', '127.0.0.1', '::1'].includes(configured.hostname) ||
    expectedDb.toLowerCase() !== 'poscarmitavlocal'
  ) {
    throw new Error('Smoke retencion Fase 9 abortado: DATABASE_URL no apunta a poscarmitaVlocal en localhost');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const identity = (await client.query(
    'SELECT current_database() AS db, inet_server_addr()::text AS address'
  )).rows[0];
  assert.equal(String(identity.db).toLowerCase(), 'poscarmitavlocal');
  assert.match(String(identity.address), /^(::1\/128|127\.0\.0\.1\/32)$/);

  assert.equal(NOTIFICATIONS_RETENTION_HOURS, 24);

  await initNotificationsCleanupIndex();
  await initNotificationsCleanupIndex();
  const indexDef = (
    await client.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'notifications_read_cleanup_idx'`)
  ).rows[0]?.indexdef;
  assert.ok(indexDef, 'el indice parcial de retencion debe existir');
  assert.match(String(indexDef), /WHERE \(read_at IS NOT NULL\)/);
  assert.match(String(indexDef), /\(read_at\)/);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const posRecipient = `cleanup-pos-${stamp}`;
  const sidroRecipient = `cleanup-sidro-${stamp}`;

  const insertProbe = async ({ recipientType, recipientId, dedupeKey, readOffset }) => {
    const result = await client.query(
      `INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data, dedupe_key, read_at, created_at)
       VALUES ($1, $2, 'sidro_request_created', 'Smoke retencion', 'Prueba local.', '{}'::jsonb, $3,
               CASE WHEN $4::text IS NULL THEN NULL ELSE NOW() - ($4::text)::interval END, NOW())
       RETURNING id`,
      [recipientType, recipientId, dedupeKey, readOffset]
    );
    return Number(result.rows[0].id);
  };

  let probeIds = [];
  let subscriptionId = null;
  try {
    const idA = await insertProbe({ recipientType: 'pos_user', recipientId: posRecipient, dedupeKey: 'cleanup-smoke:a', readOffset: '25 hours' });
    const idB = await insertProbe({ recipientType: 'pos_user', recipientId: posRecipient, dedupeKey: 'cleanup-smoke:b', readOffset: '23 hours' });
    const idC = await insertProbe({ recipientType: 'pos_user', recipientId: posRecipient, dedupeKey: 'cleanup-smoke:c', readOffset: null });
    const idD = await insertProbe({ recipientType: 'sidro_account', recipientId: sidroRecipient, dedupeKey: 'cleanup-smoke:d', readOffset: '24 hours 1 minute' });
    const idE = await insertProbe({ recipientType: 'sidro_account', recipientId: sidroRecipient, dedupeKey: 'cleanup-smoke:e', readOffset: '23 hours 58 minutes' });
    probeIds = [idA, idB, idC, idD, idE];

    const subscription = await client.query(
      `INSERT INTO push_subscriptions (subscriber_type, subscriber_id, endpoint, p256dh, auth)
       VALUES ('sidro_account', $1, $2, $3, $4) RETURNING id`,
      [sidroRecipient, `https://cleanup-smoke.invalid/${stamp}`, 'A'.repeat(64), 'B'.repeat(24)]
    );
    subscriptionId = Number(subscription.rows[0].id);

    await client.query(
      `INSERT INTO push_outbox (notification_id, subscription_id, status) VALUES ($1, $2, 'PENDING')`,
      [idA, subscriptionId]
    );
    await client.query(
      `INSERT INTO push_outbox (notification_id, subscription_id, status) VALUES ($1, $2, 'SENT')`,
      [idD, subscriptionId]
    );

    const result = await purgeReadNotifications({ pool });
    assert.equal(result.skipped, false, 'la purga debe ejecutarse con la BD libre');
    assert.ok(result.deleted >= 2, 'debe borrar al menos las dos notificaciones vencidas');
    assert.ok(result.supersededJobs >= 1, 'el job PENDING vencido debe supersederse');

    const remaining = (
      await client.query(`SELECT id FROM notifications WHERE id = ANY($1::bigint[])`, [probeIds])
    ).rows.map((row) => Number(row.id));
    assert.ok(!remaining.includes(idA), 'la leida hace 25h debe borrarse');
    assert.ok(!remaining.includes(idD), 'la leida hace 24h1m debe borrarse');
    assert.ok(remaining.includes(idB), 'la leida hace 23h debe conservarse');
    assert.ok(remaining.includes(idE), 'la leida hace 23h58m debe conservarse');
    assert.ok(remaining.includes(idC), 'la no leida de 3 dias debe conservarse');

    const orphanJobs = (
      await client.query(
        `SELECT COUNT(*)::int AS count FROM push_outbox WHERE notification_id = ANY($1::bigint[])`,
        [[idA, idD]]
      )
    ).rows[0].count;
    assert.equal(orphanJobs, 0, 'los jobs de notificaciones purgadas caen por cascada');
    const subscriptionAlive = (
      await client.query(`SELECT COUNT(*)::int AS count FROM push_subscriptions WHERE id = $1`, [subscriptionId])
    ).rows[0].count;
    assert.equal(subscriptionAlive, 1, 'la suscripcion no debe borrarse');

    const lockClient = new Client({ connectionString: process.env.DATABASE_URL });
    await lockClient.connect();
    try {
      await lockClient.query('SELECT pg_advisory_lock($1)', [CLEANUP_ADVISORY_LOCK_KEY]);
      const concurrent = await purgeReadNotifications({ pool });
      assert.equal(concurrent.skipped, true, 'otra instancia con lock no debe purgar');
      assert.equal(concurrent.deleted, 0);
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [CLEANUP_ADVISORY_LOCK_KEY]);
      await lockClient.end();
    }

    const secondRun = await purgeReadNotifications({ pool });
    assert.equal(secondRun.skipped, false);
    const probesRemain = (
      await client.query(
        `SELECT COUNT(*)::int AS count FROM notifications WHERE id = ANY($1::bigint[])`,
        [[idB, idC, idE]]
      )
    ).rows[0].count;
    assert.equal(probesRemain, 3, 'la segunda pasada no toca lo conservado');

    console.log(
      `Smoke retencion Fase 9 OK: indice parcial idempotente, cortes 23h/24h, sin leer conservada, ${result.deleted} borradas, ${result.supersededJobs} jobs superseded, cascada sin huerfanos, lock concurrente y segunda pasada idempotente.`
    );
  } finally {
    await client.query(`DELETE FROM notifications WHERE recipient_id = ANY($1::text[])`, [
      [posRecipient, sidroRecipient]
    ]);
    if (subscriptionId !== null) {
      await client.query(`DELETE FROM push_subscriptions WHERE id = $1`, [subscriptionId]);
    }
    const leftovers = (
      await client.query(`SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_id LIKE 'cleanup-%'`)
    ).rows[0].count;
    assert.equal(leftovers, 0, 'el smoke no debe dejar filas propias');
    await pool.end();
    try {
      await require('../dist/database/db.js').default.end();
    } catch {
      /* pool de la app ya cerrado */
    }
    await client.end();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
