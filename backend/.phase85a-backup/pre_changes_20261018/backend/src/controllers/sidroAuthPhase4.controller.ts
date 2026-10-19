import { Request, Response } from 'express';
import pool from '../database/db';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { BrevoService } from '../services/brevo.service';
import { JWT_ISSUER, SIDRO_JWT_AUDIENCE } from '../middlewares/auth.middleware';
import { createOpaqueToken, hashOpaqueToken, isOpaqueToken, isValidEmail, isValidPassword, legacyWhatsappCandidates, normalizeEmail, normalizeWhatsapp } from '../services/sidroIdentity.service';

const JWT_SECRET = process.env.JWT_SECRET;
const RESET_TTL = 15 * 60 * 1000;
const EMAIL_TTL = 30 * 60 * 1000;
const RESET_RESPONSE = 'Si el correo corresponde a una cuenta SIDRO activa, recibirás un enlace en los próximos minutos.';
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET es obligatorio y debe tener al menos 32 caracteres');

const issueToken = (a: any) => jwt.sign({ sub: a.id, id: a.id, role: 'sidro_client', identity_type: 'sidro_client', client_id: a.client_id ?? null, token_version: Number(a.token_version ?? 0) }, JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256', issuer: JWT_ISSUER, audience: SIDRO_JWT_AUDIENCE });
const providerCode = (e: any) => String(e?.providerCode || (e?.status ? `HTTP_${e.status}` : 'PROVIDER_ERROR')).replace(/[^A-Z0-9_-]/gi, '_').slice(0, 64);
const appUrl = (path: string, token?: string) => {
  const base = process.env.SIDRO_PUBLIC_URL?.trim();
  if (!base) throw new Error('SIDRO_PUBLIC_URL no está configurado');
  const url = new URL(path, base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('SIDRO_PUBLIC_URL no es válida');
  if (token) url.searchParams.set('token', token);
  return url.toString();
};
const event = async (accountId: string | null, type: string, outcome: string, messageId: string | null = null, metadata: Record<string, unknown> = {}) => {
  try {
    await pool.query(`INSERT INTO sidro_security_events (sidro_account_id,event_type,outcome,provider_message_id,metadata) VALUES ($1,$2,$3,$4,$5::jsonb)`, [accountId, type, outcome, messageId, JSON.stringify(metadata)]);
  } catch (e: any) {
    console.error('[SIDRO][SECURITY-EVENT]', type, outcome, e?.code || 'UNKNOWN');
  }
};

export const register = async (req: Request, res: Response) => {
  const name = String(req.body?.nombre_completo || '').trim();
  const phone = normalizeWhatsapp(req.body?.telefono);
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  if (!name || !phone || !isValidEmail(email) || !isValidPassword(password)) return res.status(400).json({ error: 'Nombre, WhatsApp, correo válido y contraseña de 8 a 128 caracteres son obligatorios' });
  try {
    const hash = await argon2.hash(password);
    const result = await pool.query(`INSERT INTO sidro_client_accounts (nombre_completo,telefono,email,email_verified_at,password_hash) VALUES ($1,$2,$3,NOW(),$4) RETURNING id,nombre_completo,telefono,email,email_verified_at,is_active`, [name, phone, email, hash]);
    return res.status(201).json(result.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'El WhatsApp o correo ya está registrado' });
    console.error('[SIDRO] Registro:', e?.code || 'UNKNOWN');
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const login = async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  if (!isValidEmail(email) || !password) return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });
  try {
    const { rows } = await pool.query(`SELECT a.id,a.password_hash,a.is_active,a.token_version,a.email_verified_at,l.client_id FROM sidro_client_accounts a LEFT JOIN sidro_account_links l ON a.id=l.sidro_account_id AND l.is_active=true WHERE lower(a.email)=$1 LIMIT 1`, [email]);
    const a = rows[0];
    if (!a?.is_active || !a.email_verified_at || !await argon2.verify(a.password_hash, password)) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    return res.json({ token: issueToken(a) });
  } catch (e: any) {
    console.error('[SIDRO] Login:', e?.code || 'UNKNOWN');
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const legacyLogin = async (req: Request, res: Response) => {
  const candidates = legacyWhatsappCandidates(req.body?.telefono);
  const password = String(req.body?.password || '');
  if (!candidates.length || !password) return res.status(400).json({ error: 'WhatsApp y contraseña son obligatorios' });
  try {
    const { rows } = await pool.query(`SELECT a.id,a.password_hash,a.is_active,a.token_version,l.client_id FROM sidro_client_accounts a LEFT JOIN sidro_account_links l ON a.id=l.sidro_account_id AND l.is_active=true WHERE a.email IS NULL AND regexp_replace(a.telefono,'\\D','','g')=ANY($1::text[]) LIMIT 1`, [candidates]);
    const a = rows[0];
    if (!a?.is_active || !await argon2.verify(a.password_hash, password)) return res.status(401).json({ error: 'WhatsApp o contraseña incorrectos' });
    return res.json({ token: issueToken(a), legacy_account: true });
  } catch (e: any) {
    console.error('[SIDRO] Login legacy:', e?.code || 'UNKNOWN');
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const requestPasswordReset = async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email || req.body?.identifier);
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Ingresa un correo válido' });
  try {
    const { rows } = await pool.query(`SELECT id,nombre_completo,email FROM sidro_client_accounts WHERE is_active=true AND lower(email)=$1 LIMIT 1`, [email]);
    const a = rows[0];
    if (!a?.email) {
      await event(null, 'password_reset_requested', 'account_not_found');
      return res.json({ message: RESET_RESPONSE });
    }
    if (!BrevoService.isConfigured()) {
      await pool.query(`UPDATE sidro_client_accounts SET password_reset_delivery_status='provider_unconfigured',password_reset_last_error_code='BREVO_NOT_CONFIGURED',password_reset_requested_at=NOW(),updated_at=NOW() WHERE id=$1`, [a.id]);
      await event(a.id, 'password_reset_requested', 'provider_unconfigured');
      return res.json({ message: RESET_RESPONSE });
    }
    const { token, tokenHash } = createOpaqueToken();
    await pool.query(`UPDATE sidro_client_accounts SET password_reset_token_hash=$1,password_reset_expires_at=$2,password_reset_requested_at=NOW(),password_reset_delivery_status='pending',password_reset_provider_message_id=NULL,password_reset_last_error_code=NULL,updated_at=NOW() WHERE id=$3`, [tokenHash, new Date(Date.now() + RESET_TTL), a.id]);
    try {
      const d = await BrevoService.sendPasswordResetEmail({ recipientEmail: a.email, recipientName: a.nombre_completo, resetUrl: appUrl('/reset-password', token) });
      await pool.query(`UPDATE sidro_client_accounts SET password_reset_delivery_status='accepted',password_reset_provider_message_id=$1,updated_at=NOW() WHERE id=$2 AND password_reset_token_hash=$3`, [d.messageId, a.id, tokenHash]);
      await event(a.id, 'password_reset_requested', 'provider_accepted', d.messageId);
    } catch (e: any) {
      const code = providerCode(e);
      await pool.query(`UPDATE sidro_client_accounts SET password_reset_token_hash=NULL,password_reset_expires_at=NULL,password_reset_delivery_status='provider_error',password_reset_last_error_code=$1,updated_at=NOW() WHERE id=$2 AND password_reset_token_hash=$3`, [code, a.id, tokenHash]);
      await event(a.id, 'password_reset_requested', 'provider_error', null, { code });
      console.error('[SIDRO] Brevo recuperación:', code);
    }
    return res.json({ message: RESET_RESPONSE });
  } catch (e: any) {
    console.error('[SIDRO] Recuperación:', e?.code || 'UNKNOWN');
    await event(null, 'password_reset_requested', 'internal_error');
    return res.json({ message: RESET_RESPONSE });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  const token = String(req.body?.token || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!isOpaqueToken(token)) return res.status(400).json({ error: 'El enlace de recuperación no es válido' });
  if (!isValidPassword(password)) return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT id,nombre_completo,email,password_reset_expires_at FROM sidro_client_accounts WHERE password_reset_token_hash=$1 AND is_active=true FOR UPDATE`, [hashOpaqueToken(token)]);
    const a = rows[0];
    if (!a) {
      await client.query('ROLLBACK');
      await event(null, 'password_reset_consumed', 'invalid_or_used');
      return res.status(400).json({ error: 'El enlace expiró o ya fue utilizado' });
    }
    if (new Date(a.password_reset_expires_at).getTime() <= Date.now()) {
      await client.query(`UPDATE sidro_client_accounts SET password_reset_token_hash=NULL,password_reset_expires_at=NULL,password_reset_delivery_status='expired',updated_at=NOW() WHERE id=$1`, [a.id]);
      await client.query('COMMIT');
      await event(a.id, 'password_reset_consumed', 'expired');
      return res.status(400).json({ error: 'El enlace expiró o ya fue utilizado' });
    }
    await client.query(`UPDATE sidro_client_accounts SET password_hash=$1,password_reset_token_hash=NULL,password_reset_expires_at=NULL,password_reset_delivery_status='used',token_version=token_version+1,updated_at=NOW() WHERE id=$2`, [await argon2.hash(password), a.id]);
    await client.query('COMMIT');
    await event(a.id, 'password_reset_consumed', 'success');
    if (a.email && BrevoService.isConfigured()) BrevoService.sendPasswordChangedEmail({ recipientEmail: a.email, recipientName: a.nombre_completo, loginUrl: appUrl('/login') }).catch((e: any) => console.error('[SIDRO] Aviso contraseña:', providerCode(e)));
    return res.json({ message: 'Tu contraseña fue actualizada. Ya puedes iniciar sesión.' });
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[SIDRO] Restablecer:', e?.code || 'UNKNOWN');
    return res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
  } finally { client.release(); }
};

export const requestEmailChange = async (req: Request, res: Response) => {
  const id = req.userId;
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.current_password || '');
  if (!id || req.userRole !== 'sidro_client') return res.status(401).json({ error: 'No autorizado' });
  if (!isValidEmail(email) || !password) return res.status(400).json({ error: 'Correo y contraseña actual son obligatorios' });
  try {
    const { rows } = await pool.query(`SELECT id,nombre_completo,email,password_hash FROM sidro_client_accounts WHERE id=$1 AND is_active=true LIMIT 1`, [id]);
    const a = rows[0];
    if (!a || !await argon2.verify(a.password_hash, password)) return res.status(403).json({ error: 'La contraseña actual no es correcta' });
    if (normalizeEmail(a.email) === email) return res.status(400).json({ error: 'Ese correo ya es el principal de tu cuenta' });
    if (!BrevoService.isConfigured()) return res.status(503).json({ error: 'La verificación por correo no está disponible en este momento' });
    if ((await pool.query(`SELECT id FROM sidro_client_accounts WHERE id<>$1 AND (lower(email)=$2 OR lower(pending_email)=$2) LIMIT 1`, [id, email])).rows.length) return res.status(409).json({ error: 'Ese correo ya está asociado a otra cuenta SIDRO' });
    const { token, tokenHash } = createOpaqueToken();
    await pool.query(`UPDATE sidro_client_accounts SET pending_email=$1,email_verification_token_hash=$2,email_verification_expires_at=$3,email_change_requested_at=NOW(),updated_at=NOW() WHERE id=$4`, [email, tokenHash, new Date(Date.now() + EMAIL_TTL), id]);
    try {
      const d = await BrevoService.sendEmailVerificationEmail({ recipientEmail: email, recipientName: a.nombre_completo, verificationUrl: appUrl('/verify-email', token) });
      await event(id, 'email_change_requested', 'provider_accepted', d.messageId);
      return res.json({ pending_email: email, message: 'Enviamos un enlace al nuevo correo. El cambio se aplicará cuando lo confirmes.' });
    } catch (e: any) {
      const code = providerCode(e);
      await pool.query(`UPDATE sidro_client_accounts SET pending_email=NULL,email_verification_token_hash=NULL,email_verification_expires_at=NULL,updated_at=NOW() WHERE id=$1 AND email_verification_token_hash=$2`, [id, tokenHash]);
      await event(id, 'email_change_requested', 'provider_error', null, { code });
      return res.status(502).json({ error: 'No se pudo enviar la verificación. Tu correo principal no cambió.' });
    }
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ese correo ya está asociado a otra cuenta SIDRO' });
    console.error('[SIDRO] Cambio correo:', e?.code || 'UNKNOWN');
    return res.status(500).json({ error: 'No se pudo solicitar el cambio de correo' });
  }
};
export const updateRecoveryEmail = requestEmailChange;

export const verifyEmailChange = async (req: Request, res: Response) => {
  const token = String(req.body?.token || req.query?.token || '').trim().toLowerCase();
  if (!isOpaqueToken(token)) return res.status(400).json({ error: 'El enlace de verificación no es válido' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT id,nombre_completo,email,pending_email,email_verification_expires_at FROM sidro_client_accounts WHERE email_verification_token_hash=$1 AND is_active=true FOR UPDATE`, [hashOpaqueToken(token)]);
    const a = rows[0];
    if (!a || new Date(a.email_verification_expires_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El enlace expiró o ya fue utilizado' });
    }
    await client.query(`UPDATE sidro_client_accounts SET email=lower(pending_email),email_verified_at=NOW(),pending_email=NULL,email_verification_token_hash=NULL,email_verification_expires_at=NULL,token_version=token_version+1,updated_at=NOW() WHERE id=$1`, [a.id]);
    await client.query('COMMIT');
    await event(a.id, 'email_change_verified', 'success');
    if (a.email && BrevoService.isConfigured()) BrevoService.sendEmailChangedNotice({ recipientEmail: a.email, recipientName: a.nombre_completo, loginUrl: appUrl('/login') }).catch((e: any) => console.error('[SIDRO] Aviso correo anterior:', providerCode(e)));
    return res.json({ message: 'Correo verificado. Inicia sesión nuevamente con tu nuevo correo.' });
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (e.code === '23505') return res.status(409).json({ error: 'Ese correo ya está asociado a otra cuenta SIDRO' });
    console.error('[SIDRO] Verificar correo:', e?.code || 'UNKNOWN');
    return res.status(500).json({ error: 'No se pudo verificar el correo' });
  } finally { client.release(); }
};

export const updateWhatsapp = async (req: Request, res: Response) => {
  const id = req.userId;
  const phone = normalizeWhatsapp(req.body?.whatsapp ?? req.body?.telefono);
  const password = String(req.body?.current_password || '');
  if (!id || req.userRole !== 'sidro_client') return res.status(401).json({ error: 'No autorizado' });
  if (!phone) return res.status(400).json({ error: 'Ingresa un número de WhatsApp válido, por ejemplo +593991234567' });
  try {
    const a = (await pool.query(`SELECT email,password_hash FROM sidro_client_accounts WHERE id=$1 AND is_active=true LIMIT 1`, [id])).rows[0];
    if (!a) return res.status(404).json({ error: 'Perfil no encontrado' });
    if (!a.email && (!password || !await argon2.verify(a.password_hash, password))) return res.status(403).json({ error: 'Confirma tu contraseña actual para cambiar el WhatsApp de una cuenta antigua' });
    const updated = await pool.query(`UPDATE sidro_client_accounts SET telefono=$1,updated_at=NOW() WHERE id=$2 RETURNING telefono`, [phone, id]);
    await event(id, 'whatsapp_changed', 'success');
    return res.json({ whatsapp: updated.rows[0].telefono, message: 'WhatsApp actualizado' });
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ese WhatsApp ya está registrado' });
    console.error('[SIDRO] WhatsApp:', e?.code || 'UNKNOWN');
    return res.status(500).json({ error: 'No se pudo actualizar el WhatsApp' });
  }
};

export const changePassword = async (req: Request, res: Response) => {
  const id = req.userId;
  const current = String(req.body?.current_password || '');
  const next = String(req.body?.new_password || '');
  if (!id || req.userRole !== 'sidro_client') return res.status(401).json({ error: 'No autorizado' });
  if (!current || !isValidPassword(next)) return res.status(400).json({ error: 'La contraseña nueva debe tener entre 8 y 128 caracteres' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const a = (await client.query(`SELECT password_hash FROM sidro_client_accounts WHERE id=$1 AND is_active=true FOR UPDATE`, [id])).rows[0];
    if (!a || !await argon2.verify(a.password_hash, current)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'La contraseña actual no es correcta' }); }
    if (await argon2.verify(a.password_hash, next)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'La contraseña nueva debe ser diferente a la actual' }); }
    await client.query(`UPDATE sidro_client_accounts SET password_hash=$1,password_reset_token_hash=NULL,password_reset_expires_at=NULL,token_version=token_version+1,updated_at=NOW() WHERE id=$2`, [await argon2.hash(next), id]);
    await client.query('COMMIT');
    await event(id, 'password_changed_authenticated', 'success');
    return res.json({ message: 'Contraseña actualizada. Inicia sesión nuevamente.' });
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[SIDRO] Cambiar contraseña:', e?.code || 'UNKNOWN');
    return res.status(500).json({ error: 'No se pudo cambiar la contraseña' });
  } finally { client.release(); }
};

export const getProfile = async (req: Request, res: Response) => {
  const id = req.userId;
  if (!id || req.userRole !== 'sidro_client') return res.status(401).json({ error: 'No autorizado' });
  try {
    const { rows } = await pool.query(`SELECT a.id,a.nombre_completo,a.telefono,a.email,a.email_verified_at,a.pending_email,l.client_id,COALESCE(l.is_active,false) AS linked FROM sidro_client_accounts a LEFT JOIN sidro_account_links l ON a.id=l.sidro_account_id AND l.is_active=true WHERE a.id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Perfil no encontrado' });
    const p = rows[0];
    return res.json({ ...p, email_verified: Boolean(p.email_verified_at), legacy_account: !p.email });
  } catch (e: any) {
    console.error('[SIDRO] Perfil:', e?.code || 'UNKNOWN');
    return res.status(500).json({ error: 'Error al obtener perfil' });
  }
};
