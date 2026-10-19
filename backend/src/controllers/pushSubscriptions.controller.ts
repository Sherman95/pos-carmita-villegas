import { createHash } from 'node:crypto';
import { Request, Response } from 'express';
import pool from '../database/db';
import { NotificationRecipientType } from '../services/notifications.service';
import { webPushConfigured, webPushRequested } from '../services/pushOutbox.service';

const recipientFor = (req: Request): { type: NotificationRecipientType; id: string } => ({
  type: req.authIdentity === 'sidro_client' ? 'sidro_account' : 'pos_user',
  id: String(req.userId || '')
});

const validBase64Url = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max && /^[A-Za-z0-9_-]+={0,2}$/.test(value);

const parseSubscription = (body: any) => {
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('Suscripción Push inválida'); }
  if (endpoint.length > 2048 || url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Suscripción Push inválida');
  }
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!validBase64Url(p256dh, 32, 256) || !validBase64Url(auth, 8, 128)) {
    throw new Error('Claves de suscripción Push inválidas');
  }
  return { endpoint, p256dh, auth };
};

const endpointFingerprint = (endpoint: string): string =>
  createHash('sha256').update(endpoint).digest('hex').slice(0, 16);

export const getPushConfiguration = async (_req: Request, res: Response) => {
  const enabled = webPushRequested() && webPushConfigured();
  return res.json({ enabled, publicKey: enabled ? process.env.VAPID_PUBLIC_KEY : null });
};

export const registerPushSubscription = async (req: Request, res: Response) => {
  const recipient = recipientFor(req);
  const tokenVersion = Number(req.user?.['token_version'] ?? 0);
  if (!recipient.id) return res.status(401).json({ error: 'Token inválido' });
  if (!webPushRequested() || !webPushConfigured()) {
    return res.status(503).json({ error: 'Las notificaciones Push no están configuradas' });
  }
  let subscription: ReturnType<typeof parseSubscription>;
  try { subscription = parseSubscription(req.body); }
  catch (error: any) { return res.status(400).json({ error: error.message }); }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const previous = await client.query(
      `SELECT id, subscriber_type, subscriber_id FROM push_subscriptions WHERE endpoint=$1 FOR UPDATE`,
      [subscription.endpoint]
    );
    const changedOwner = previous.rows[0]
      && (previous.rows[0].subscriber_type !== recipient.type || String(previous.rows[0].subscriber_id) !== recipient.id);
    const stored = await client.query(
      `INSERT INTO push_subscriptions(subscriber_type,subscriber_id,endpoint,p256dh,auth,token_version,user_agent,last_seen_at,disabled_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NULL)
       ON CONFLICT (endpoint) DO UPDATE SET
         subscriber_type=EXCLUDED.subscriber_type, subscriber_id=EXCLUDED.subscriber_id,
         p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, token_version=EXCLUDED.token_version, user_agent=EXCLUDED.user_agent,
         last_seen_at=NOW(), disabled_at=NULL, updated_at=NOW()
       RETURNING id, (xmax = 0) AS inserted`,
      [recipient.type, recipient.id, subscription.endpoint, subscription.p256dh, subscription.auth, tokenVersion, String(req.get('user-agent') || '').slice(0, 512) || null]
    );
    if (changedOwner) {
      await client.query(
        `UPDATE push_outbox SET status='SUPERSEDED',locked_at=NULL,updated_at=NOW()
         WHERE subscription_id=$1 AND status IN ('PENDING','FAILED_RETRY','PROCESSING')`,
        [stored.rows[0].id]
      );
    }
    await client.query('COMMIT');
    return res.status(stored.rows[0].inserted ? 201 : 200).json({
      enabled: true,
      subscriptionId: String(stored.rows[0].id),
      endpointFingerprint: endpointFingerprint(subscription.endpoint)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[PUSH][SUBSCRIPTION] No se pudo registrar', { recipientType: recipient.type });
    return res.status(500).json({ error: 'No se pudo registrar la suscripción Push' });
  } finally { client.release(); }
};

export const revokePushSubscription = async (req: Request, res: Response) => {
  const recipient = recipientFor(req);
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
  if (!recipient.id) return res.status(401).json({ error: 'Token inválido' });
  if (!endpoint || endpoint.length > 2048) return res.status(400).json({ error: 'Suscripción Push inválida' });
  try {
    const result = await pool.query(
      `UPDATE push_subscriptions SET disabled_at=NOW(),updated_at=NOW()
       WHERE endpoint=$1 AND subscriber_type=$2 AND subscriber_id=$3 AND disabled_at IS NULL
       RETURNING id`,
      [endpoint, recipient.type, recipient.id]
    );
    return res.json({ changed: result.rows.length > 0 });
  } catch {
    return res.status(500).json({ error: 'No se pudo desactivar la suscripción Push' });
  }
};
