const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
require('dotenv').config();

process.env.WEB_PUSH_ENABLED = 'true';
process.env.VAPID_PUBLIC_KEY = 'local-smoke-public-key';
process.env.VAPID_PRIVATE_KEY = 'local-smoke-private-key';
process.env.VAPID_SUBJECT = 'mailto:local-smoke@example.invalid';

const { NotificationsService } = require('../dist/services/notifications.service.js');

(async () => {
  const url = new URL(process.env.DATABASE_URL);
  const db = url.pathname.replace(/^\//, '');
  if (!['localhost','127.0.0.1','::1'].includes(url.hostname) || db.toLowerCase() !== 'poscarmitavlocal') {
    throw new Error('Smoke Fase 9 abortado: solo poscarmitaVlocal en localhost');
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const identity = (await client.query('SELECT current_database() db,inet_server_addr()::text address')).rows[0];
  assert.equal(String(identity.db).toLowerCase(),'poscarmitavlocal');
  assert.match(String(identity.address),/^(::1\/128|127\.0\.0\.1\/32)$/);
  const before = {
    subscriptions: Number((await client.query('SELECT count(*) FROM push_subscriptions')).rows[0].count),
    outbox: Number((await client.query('SELECT count(*) FROM push_outbox')).rows[0].count)
  };
  await client.query('BEGIN');
  try {
    const recipient = randomUUID();
    const endpoint = `https://push.example.invalid/${randomUUID()}`;
    await client.query(
      `INSERT INTO push_subscriptions(subscriber_type,subscriber_id,endpoint,p256dh,auth)
       VALUES('pos_user',$1,$2,$3,$4)`,
      [recipient, endpoint, 'A'.repeat(64), 'B'.repeat(24)]
    );
    const notificationId = await NotificationsService.insertForRecipient(client,'pos_user',recipient,{
      type:'phase9_smoke',title:'Dato interno detallado',body:'No debe salir como Push',
      data:{url:'/citas/solicitudes?open=999'},dedupeKey:`phase9:${randomUUID()}`
    });
    assert.ok(notificationId);
    assert.equal(Number((await client.query('SELECT count(*) FROM push_outbox WHERE notification_id=$1',[notificationId])).rows[0].count),1);
    const duplicate = await NotificationsService.insertForRecipient(client,'pos_user',recipient,{
      type:'phase9_smoke',title:'Dato interno detallado',body:'No debe salir como Push',
      data:{url:'/citas/solicitudes?open=999'},dedupeKey:(await client.query('SELECT dedupe_key FROM notifications WHERE id=$1',[notificationId])).rows[0].dedupe_key
    });
    assert.equal(duplicate,null);
  } finally { await client.query('ROLLBACK'); }
  assert.equal(Number((await client.query('SELECT count(*) FROM push_subscriptions')).rows[0].count),before.subscriptions);
  assert.equal(Number((await client.query('SELECT count(*) FROM push_outbox')).rows[0].count),before.outbox);
  console.log(JSON.stringify({ok:true,database:identity.db,rolledBack:true,noRealPush:true}));
  await client.end();
})().catch((error)=>{console.error(error);process.exitCode=1;});
