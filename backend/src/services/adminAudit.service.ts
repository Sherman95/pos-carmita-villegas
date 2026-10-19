import { Pool, PoolClient } from 'pg';
import pool from '../database/db';

type AuditDb = Pool | PoolClient;

const safeMetadata = (metadata: Record<string, unknown> = {}) => {
  const blocked = new Set(['password', 'current_password', 'new_password', 'temporary_password', 'token', 'token_hash']);
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !blocked.has(key.toLowerCase())));
};

export class AdminAuditService {
  static async record(
    action: string,
    actorUserId: string | null,
    targetUserId: string | null,
    metadata: Record<string, unknown> = {},
    db: AuditDb = pool
  ): Promise<void> {
    await db.query(
      `INSERT INTO admin_audit_log(actor_user_id, action, target_user_id, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [actorUserId, action, targetUserId, JSON.stringify(safeMetadata(metadata))]
    );
  }
}

