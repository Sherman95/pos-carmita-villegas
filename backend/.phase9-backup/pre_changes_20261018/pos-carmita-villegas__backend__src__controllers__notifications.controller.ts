import { Request, Response } from 'express';
import pool from '../database/db';
import { NotificationRecipientType } from '../services/notifications.service';

const recipientTypeFor = (req: Request): NotificationRecipientType =>
  req.authIdentity === 'sidro_client' ? 'sidro_account' : 'pos_user';

const parsePagination = (req: Request): { limit: number; offset: number; unreadOnly: boolean } => {
  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50) : 20;
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;
  const unreadOnly = String(req.query.unread ?? '').toLowerCase() === 'true';
  return { limit, offset, unreadOnly };
};

export const listNotifications = async (req: Request, res: Response) => {
  const recipientType = recipientTypeFor(req);
  const recipientId = String(req.userId || '');
  if (!recipientId) return res.status(401).json({ error: 'Token inválido' });

  const { limit, offset, unreadOnly } = parsePagination(req);

  try {
    const itemsResult = await pool.query(
      `SELECT id, type, title, body, data, read_at, created_at
       FROM notifications
       WHERE recipient_type = $1 AND recipient_id = $2
         ${unreadOnly ? 'AND read_at IS NULL' : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [recipientType, recipientId, limit, offset]
    );
    const totals = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE read_at IS NULL)::int AS unread
       FROM notifications
       WHERE recipient_type = $1 AND recipient_id = $2`,
      [recipientType, recipientId]
    );

    return res.json({
      items: itemsResult.rows,
      total: Number(totals.rows[0]?.total ?? 0),
      unread: Number(totals.rows[0]?.unread ?? 0),
      limit,
      offset
    });
  } catch (error) {
    console.error('[NOTIFICATIONS] Listado:', error);
    return res.status(500).json({ error: 'No se pudieron consultar las notificaciones' });
  }
};

export const markNotificationRead = async (req: Request, res: Response) => {
  const recipientType = recipientTypeFor(req);
  const recipientId = String(req.userId || '');
  const id = Number(req.params.id);
  if (!recipientId) return res.status(401).json({ error: 'Token inválido' });
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Notificación inválida' });
  }

  try {
    const updated = await pool.query(
      `UPDATE notifications
       SET read_at = NOW()
       WHERE id = $1 AND recipient_type = $2 AND recipient_id = $3 AND read_at IS NULL
       RETURNING id, read_at`,
      [id, recipientType, recipientId]
    );

    if (updated.rows.length > 0) {
      return res.json({ id, read_at: updated.rows[0].read_at, changed: true });
    }

    const existing = await pool.query(
      `SELECT id, read_at FROM notifications
       WHERE id = $1 AND recipient_type = $2 AND recipient_id = $3`,
      [id, recipientType, recipientId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Notificación no encontrada' });
    }
    return res.json({ id, read_at: existing.rows[0].read_at, changed: false });
  } catch (error) {
    console.error('[NOTIFICATIONS] Marcar leída:', error);
    return res.status(500).json({ error: 'No se pudo actualizar la notificación' });
  }
};
