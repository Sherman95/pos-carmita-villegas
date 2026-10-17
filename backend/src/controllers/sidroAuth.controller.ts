import { Request, Response } from 'express';
import pool from '../database/db';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { BrevoService } from '../services/brevo.service';

const JWT_SECRET = process.env.JWT_SECRET;
const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
const PASSWORD_RESET_RESPONSE = 'Si encontramos una cuenta con correo de recuperación, recibirás un enlace en los próximos minutos.';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET es obligatorio y debe tener al menos 32 caracteres');
}

export const register = async (req: Request, res: Response) => {
  const { nombre_completo, telefono, email, password } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!nombre_completo || !telefono || !normalizedEmail || !password) {
    return res.status(400).json({ error: 'Nombre, teléfono, correo y contraseña son obligatorios' });
  }
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Ingresa un correo válido' });
  }
  if (String(password).length < 8 || String(password).length > 128) {
    return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres' });
  }

  try {
    const password_hash = await argon2.hash(password);
    const result = await pool.query(
      `INSERT INTO sidro_client_accounts (nombre_completo, telefono, email, password_hash)
       VALUES ($1, $2, $3, $4) RETURNING id, nombre_completo, telefono, email, is_active`,
      [String(nombre_completo).trim(), String(telefono).trim(), normalizedEmail, password_hash]
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({ error: 'El teléfono o email ya está registrado' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const login = async (req: Request, res: Response) => {
  const { telefono, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT a.id, a.password_hash, a.is_active, a.token_version, l.client_id
       FROM sidro_client_accounts a
       LEFT JOIN sidro_account_links l ON a.id = l.sidro_account_id AND l.is_active = true
       WHERE a.telefono = $1`,
      [telefono]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const account = result.rows[0];
    if (!account.is_active) {
      return res.status(403).json({ error: 'Cuenta desactivada' });
    }

    const valid = await argon2.verify(account.password_hash, password);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      { id: account.id, role: 'sidro_client', client_id: account.client_id, token_version: account.token_version },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

const passwordResetUrl = (token: string): string => {
  const configuredUrl = process.env.SIDRO_PUBLIC_URL?.trim();
  if (!configuredUrl) throw new Error('SIDRO_PUBLIC_URL no está configurado');
  const url = new URL('/reset-password', configuredUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('SIDRO_PUBLIC_URL no es válida');
  }
  url.searchParams.set('token', token);
  return url.toString();
};

const sidroLoginUrl = (): string => {
  const configuredUrl = process.env.SIDRO_PUBLIC_URL?.trim();
  if (!configuredUrl) throw new Error('SIDRO_PUBLIC_URL no está configurado');
  const url = new URL('/login', configuredUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('SIDRO_PUBLIC_URL no es válida');
  }
  return url.toString();
};

export const requestPasswordReset = async (req: Request, res: Response) => {
  // `identifier` se conserva temporalmente como compatibilidad para clientes
  // anteriores, pero la recuperación solo admite direcciones de correo.
  const email = String(req.body?.email || req.body?.identifier || '').trim().toLowerCase();
  if (!email || email.length > 160 || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Ingresa un correo válido' });
  }

  try {
    const result = await pool.query(
      `SELECT id, nombre_completo, email
       FROM sidro_client_accounts
       WHERE is_active = true
         AND lower(email) = $1
       LIMIT 1`,
      [email]
    );
    const account = result.rows[0];

    if (account?.email && BrevoService.isConfigured()) {
      const token = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

      await pool.query(
        `UPDATE sidro_client_accounts
         SET password_reset_token_hash = $1,
             password_reset_expires_at = $2,
             password_reset_requested_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [tokenHash, expiresAt, account.id]
      );

      try {
        await BrevoService.sendPasswordResetEmail({
          recipientEmail: account.email,
          recipientName: account.nombre_completo,
          resetUrl: passwordResetUrl(token)
        });
      } catch (error: any) {
        await pool.query(
          `UPDATE sidro_client_accounts
           SET password_reset_token_hash = NULL,
               password_reset_expires_at = NULL,
               updated_at = NOW()
           WHERE id = $1 AND password_reset_token_hash = $2`,
          [account.id, tokenHash]
        );
        console.error('[SIDRO] No se pudo enviar el correo de recuperación:', error.message);
      }
    }

    return res.json({ message: PASSWORD_RESET_RESPONSE });
  } catch (error) {
    console.error('[SIDRO] Error preparando recuperación de contraseña:', error);
    return res.status(500).json({ error: 'No se pudo procesar la solicitud en este momento' });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  const token = String(req.body?.token || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ error: 'El enlace de recuperación no es válido' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const result = await client.query(
      `SELECT id, nombre_completo, email
       FROM sidro_client_accounts
       WHERE password_reset_token_hash = $1
         AND password_reset_expires_at > NOW()
         AND is_active = true
       FOR UPDATE`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El enlace expiró o ya fue utilizado' });
    }

    const account = result.rows[0];
    const passwordHash = await argon2.hash(password);
    await client.query(
      `UPDATE sidro_client_accounts
       SET password_hash = $1,
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL,
           token_version = token_version + 1,
           updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, account.id]
    );
    await client.query('COMMIT');

    if (account.email && BrevoService.isConfigured()) {
      try {
        await BrevoService.sendPasswordChangedEmail({
          recipientEmail: account.email,
          recipientName: account.nombre_completo,
          loginUrl: sidroLoginUrl()
        });
      } catch (error: any) {
        console.error('[SIDRO] No se pudo enviar el aviso de contraseña actualizada:', error.message);
      }
    }

    return res.json({ message: 'Tu contraseña fue actualizada. Ya puedes iniciar sesión.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[SIDRO] Error restableciendo contraseña:', error);
    return res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
  } finally {
    client.release();
  }
};

export const updateRecoveryEmail = async (req: Request, res: Response) => {
  const sidroAccountId = req.userId;
  const email = String(req.body?.email || '').trim().toLowerCase();
  const currentPassword = String(req.body?.current_password || '');

  if (!sidroAccountId || req.userRole !== 'sidro_client') {
    return res.status(401).json({ error: 'No autorizado' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || !currentPassword) {
    return res.status(400).json({ error: 'Correo y contraseña actual son obligatorios' });
  }

  try {
    const account = await pool.query(
      'SELECT password_hash FROM sidro_client_accounts WHERE id = $1 AND is_active = true LIMIT 1',
      [sidroAccountId]
    );
    if (!account.rows.length || !await argon2.verify(account.rows[0].password_hash, currentPassword)) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    }

    const updated = await pool.query(
      `UPDATE sidro_client_accounts
       SET email = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING email`,
      [email, sidroAccountId]
    );
    return res.json({ email: updated.rows[0].email, message: 'Correo de recuperación actualizado' });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ese correo ya está asociado a otra cuenta SIDRO' });
    }
    console.error('[SIDRO] Error actualizando correo de recuperación:', error);
    return res.status(500).json({ error: 'No se pudo actualizar el correo' });
  }
};

export const getProfile = async (req: Request, res: Response) => {
  const sidroAccountId = req.userId; // Viene del JWT validado por verifyToken

  if (!sidroAccountId || req.userRole !== 'sidro_client') {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const result = await pool.query(
      `SELECT a.id, a.nombre_completo, a.telefono, a.email, l.client_id, l.is_active as linked
       FROM sidro_client_accounts a
       LEFT JOIN sidro_account_links l ON a.id = l.sidro_account_id AND l.is_active = true
       WHERE a.id = $1`,
      [sidroAccountId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Perfil no encontrado' });
    }

    // Retorna sólo la data segura (sin contraseñas)
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
};
