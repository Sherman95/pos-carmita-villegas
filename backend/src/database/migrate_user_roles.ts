import pool from './db';

/**
 * Conserva la cuenta principal del POS como administradora.
 * Es idempotente y no cambia el rol de ninguna otra cuenta.
 */
export async function ensurePrimaryAdminRole(): Promise<void> {
  try {
    const result = await pool.query(
      `UPDATE users
       SET role = 'admin', updated_at = NOW()
       WHERE username = 'admin' AND role <> 'admin'`
    );

    if (result.rowCount) {
      console.log('[AUTH] Cuenta principal admin restaurada como administradora');
    }
  } catch (error) {
    console.error('[AUTH] No se pudo asegurar el rol de la cuenta admin:', error);
  }
}
