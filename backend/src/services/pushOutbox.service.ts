import { PoolClient } from 'pg';
import type { NotificationRecipientType } from './notifications.service';

export const webPushRequested = (): boolean => process.env.WEB_PUSH_ENABLED === 'true';

export const webPushConfigured = (): boolean => Boolean(
  process.env.VAPID_PUBLIC_KEY?.trim()
  && process.env.VAPID_PRIVATE_KEY?.trim()
  && process.env.VAPID_SUBJECT?.trim()
);

export const webPushOperational = (): boolean => webPushRequested() && webPushConfigured();

export async function enqueueNotificationPush(
  client: PoolClient,
  notificationId: string | number,
  recipientType: NotificationRecipientType,
  recipientId: string | number
): Promise<number> {
  if (!webPushOperational()) return 0;
  const result = await client.query(
    `INSERT INTO push_outbox(notification_id, subscription_id)
     SELECT $1, subscription.id
     FROM push_subscriptions subscription
     WHERE subscription.subscriber_type = $2
       AND subscription.subscriber_id = $3
       AND subscription.disabled_at IS NULL
     ON CONFLICT (notification_id, subscription_id) DO NOTHING
     RETURNING id`,
    [notificationId, recipientType, String(recipientId)]
  );
  return result.rows.length;
}
