import { PoolClient } from 'pg';
import { enqueueNotificationPush } from './pushOutbox.service';

export type NotificationRecipientType = 'pos_user' | 'sidro_account';

export interface NotificationInput {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  dedupeKey: string;
  expiresAt?: Date | null;
}

export const POS_STAFF_ROLES = ['owner', 'admin', 'reception'] as const;

export class NotificationsService {
  static async insertForRecipient(
    client: PoolClient,
    recipientType: NotificationRecipientType,
    recipientId: string | number,
    input: NotificationInput
  ): Promise<string | null> {
    if (recipientId === null || recipientId === undefined || recipientId === '') return null;
    const inserted = await client.query(
      `INSERT INTO notifications(recipient_type, recipient_id, type, title, body, data, dedupe_key, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       ON CONFLICT (recipient_type, recipient_id, dedupe_key) DO NOTHING
       RETURNING id`,
      [
        recipientType,
        String(recipientId),
        input.type,
        input.title,
        input.body,
        JSON.stringify(input.data ?? {}),
        input.dedupeKey,
        input.expiresAt ?? null
      ]
    );
    const notificationId = inserted.rows[0]?.id;
    if (!notificationId) return null;
    await enqueueNotificationPush(client, notificationId, recipientType, recipientId);
    return String(notificationId);
  }

  static async staffRecipientIds(client: PoolClient): Promise<string[]> {
    const result = await client.query(
      `SELECT id FROM users
       WHERE active = true AND lower(role) = ANY($1::text[])`,
      [[...POS_STAFF_ROLES]]
    );
    return result.rows.map((row) => String(row.id));
  }

  static async assignedProfessionalRecipientIds(
    client: PoolClient,
    employeeId: string | number | null | undefined
  ): Promise<string[]> {
    if (employeeId === null || employeeId === undefined || employeeId === '') return [];
    const result = await client.query(
      `SELECT id FROM users
       WHERE active = true AND lower(role) = 'professional' AND employee_id = $1`,
      [employeeId]
    );
    return result.rows.map((row) => String(row.id));
  }

  static async notifyPosStaff(client: PoolClient, input: NotificationInput): Promise<void> {
    const ids = await this.staffRecipientIds(client);
    for (const id of ids) {
      await this.insertForRecipient(client, 'pos_user', id, input);
    }
  }

  static async notifyAssignedProfessional(
    client: PoolClient,
    employeeId: string | number | null | undefined,
    input: NotificationInput
  ): Promise<void> {
    const ids = await this.assignedProfessionalRecipientIds(client, employeeId);
    for (const id of ids) {
      await this.insertForRecipient(client, 'pos_user', id, input);
    }
  }

  static async notifySidroAccount(
    client: PoolClient,
    accountId: string | number | null | undefined,
    input: NotificationInput
  ): Promise<void> {
    await this.insertForRecipient(client, 'sidro_account', accountId as string | number, input);
  }
}
