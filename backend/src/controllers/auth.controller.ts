import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import pool from '../database/db';
import { JWT_ISSUER, POS_JWT_AUDIENCE } from '../middlewares/auth.middleware';
import { AdminAuditService } from '../services/adminAudit.service';
import { BrevoService } from '../services/brevo.service';
import { assignableRoles, canManageRole, canonicalRole, permissionsForRole, POS_ROLES, PosRole } from '../security/rbac';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET es obligatorio y debe tener al menos 32 caracteres');
}

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,40}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 10;

const normalizedEmail = (value: unknown): string | null => {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return null;
  if (email.length > 255 || !EMAIL_PATTERN.test(email)) throw new Error('Correo electrónico no válido');
  return email;
};

const validPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= PASSWORD_MIN_LENGTH && value.length <= 128;

const signPosToken = (user: any) => jwt.sign(
  {
    sub: user.id,
    role: canonicalRole(user.role),
    username: user.username,
    identity_type: 'pos_staff',
    token_version: Number(user.token_version || 0)
  },
  JWT_SECRET,
  { expiresIn: '8h', algorithm: 'HS256', issuer: JWT_ISSUER, audience: POS_JWT_AUDIENCE }
);

const selectManagedUsers = `
  SELECT
    u.id,
    u.username,
    u.role,
    u.active,
    u.employee_id,
    u.email,
    u.email_verified_at,
    COALESCE(u.must_change_password, false) AS must_change_password,
    COALESCE(u.token_version, 0) AS token_version,
    u.last_login_at,
    u.password_changed_at,
    e.nombre AS employee_name,
    u.created_at,
    u.updated_at
  FROM users u
  LEFT JOIN employees e ON e.id = u.employee_id
`;

const canonicalManagedRow = (row: any) => ({
  ...row,
  role: canonicalRole(row.role) ?? row.role
});

export const getUsers = async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`${selectManagedUsers} ORDER BY lower(u.username)`);
    return res.json(rows.map(canonicalManagedRow));
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    return res.status(500).json({ error: 'No se pudieron cargar los usuarios' });
  }
};

export const updateUserAccess = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = Array.isArray(id) ? id[0] : id;
  const { role, active } = req.body as { role?: PosRole; active?: boolean };

  if (!userId || !USER_ID_PATTERN.test(userId)) {
    return res.status(400).json({ error: 'Identificador de usuario no válido' });
  }

  if (role === undefined && active === undefined) {
    return res.status(400).json({ error: 'Debes indicar un rol o un estado' });
  }

  if (role !== undefined && !POS_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Rol POS no válido' });
  }

  if (active !== undefined && typeof active !== 'boolean') {
    return res.status(400).json({ error: 'El estado activo debe ser verdadero o falso' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const targetResult = await client.query(
      'SELECT id, username, role, active FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (!targetResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const target = targetResult.rows[0] as {
      id: string;
      username: string;
      role: string;
      active: boolean;
    };
    const targetRole = canonicalRole(target.role);
    const actorRole = canonicalRole(req.userRole);
    if (!targetRole || !actorRole || !canManageRole(actorRole, targetRole)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'No puedes administrar una cuenta de igual o mayor jerarquía' });
    }
    const nextRole = role ?? targetRole;
    const nextActive = active ?? target.active;
    if (role !== undefined && !assignableRoles(actorRole).includes(nextRole as PosRole)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'No puedes asignar ese rol' });
    }
    if (target.id === req.userId) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'No puedes modificar tu propio rol o estado' });
    }

    const removesActiveOwner = targetRole === 'owner' && target.active &&
      (nextRole !== 'owner' || !nextActive);

    if (removesActiveOwner) {
      const activeOwners = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM users
         WHERE role = 'owner' AND active = true AND id <> $1`,
        [target.id]
      );

      if (activeOwners.rows[0].total === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Debe permanecer al menos un propietario activo' });
      }
    }

    await client.query(
      `UPDATE users
       SET role = $1, active = $2,
           token_version = token_version + CASE WHEN role <> $1 OR active <> $2 THEN 1 ELSE 0 END,
           updated_at = NOW()
       WHERE id = $3`,
      [nextRole, nextActive, target.id]
    );

    await AdminAuditService.record('USER_ACCESS_UPDATED', req.userId || null, target.id, {
      previous_role: targetRole, next_role: nextRole,
      previous_active: target.active, next_active: nextActive
    }, client);
    const updatedResult = await client.query(`${selectManagedUsers} WHERE u.id = $1`, [target.id]);
    await client.query('COMMIT');

    return res.json({
      message: 'Permisos actualizados',
      user: canonicalManagedRow(updatedResult.rows[0])
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error actualizando permisos:', error);
    return res.status(500).json({ error: 'No se pudieron actualizar los permisos' });
  } finally {
    client.release();
  }
};

export const getCurrentUser = async (req: Request, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Usuario no identificado' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         id, username, role, active, employee_id, email, email_verified_at,
         COALESCE(must_change_password, false) AS must_change_password,
         last_login_at, tax_rate,
         business_name, business_ruc, business_address, business_phone
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.userId]
    );

    if (!rows.length || !rows[0].active) {
      return res.status(401).json({ error: 'La cuenta está inactiva o ya no existe' });
    }

    const user = rows[0];
    user.role = canonicalRole(user.role);
    user.permissions = permissionsForRole(user.role);
    return res.json({ user });
  } catch (error) {
    console.error('Error obteniendo la sesión actual:', error);
    return res.status(500).json({ error: 'No se pudo actualizar la sesión' });
  }
};

// =========================================================================
// ✅ 1. LOGIN (AHORA LEE LOS DATOS DEL NEGOCIO)
// =========================================================================
export const login = async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    return res.status(400).json({ error: 'username y password son requeridos' });
  }

  try {
    // 🔥 CAMBIO 1: Agregamos las columnas nuevas al SELECT
    const { rows } = await pool.query(
      `SELECT
         id, username, password, role, active,
         employee_id, email, email_verified_at,
         COALESCE(token_version, 0) AS token_version,
         COALESCE(must_change_password, false) AS must_change_password,
         tax_rate, business_name, business_ruc, business_address, business_phone
       FROM users WHERE lower(username) = lower($1) LIMIT 1`,
      [username.trim()]
    );

    if (!rows.length || !rows[0].active) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);

    if (!ok) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const role = canonicalRole(user.role);
    if (!role) return res.status(403).json({ error: 'La cuenta no tiene un rol POS válido' });
    await pool.query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [user.id]);
    const token = signPosToken(user);

    // 🔥 CAMBIO 2: Enviamos todos los datos al Frontend
    const responseData = {
      token,
      user: {
        id: user.id,
        username: user.username,
        role,
        permissions: permissionsForRole(role),
        employee_id: user.employee_id,
        email: user.email,
        email_verified_at: user.email_verified_at,
        must_change_password: user.must_change_password,
        tax_rate: user.tax_rate,
        // Datos del negocio
        business_name: user.business_name,
        business_ruc: user.business_ruc,
        business_address: user.business_address,
        business_phone: user.business_phone
      }
    };

    return res.json(responseData);

  } catch (err) {
    console.error('❌ CRASH EN LOGIN:', err);
    return res.status(500).json({ error: 'Error en login' });
  }
};

// =========================================================================
// ✅ 2. UPDATE PROFILE (AHORA GUARDA TODO)
// =========================================================================
export const updateProfile = async (req: Request | any, res: Response) => {
  // Obtenemos ID del token
  const id = req.user?.sub || req.user?.id || req.userId;

  // 🔥 CAMBIO 3: Recibimos TODOS los campos del formulario
  const {
    tax_rate,
    business_name,
    business_ruc,
    business_address,
    business_phone
  } = req.body;

  if (!id) {
    return res.status(401).json({ error: "Usuario no identificado" });
  }

  try {
    const current = await pool.query('SELECT username FROM users WHERE id = $1 AND active = true LIMIT 1', [id]);
    if (!current.rows.length) {
      return res.status(401).json({ error: 'La cuenta está inactiva o ya no existe' });
    }
    // 🔥 CAMBIO 4: SQL Dinámico para guardar todo
    const query = `
      UPDATE users
      SET
        tax_rate = COALESCE($1, tax_rate),
        business_name = COALESCE($2, business_name),
        business_ruc = COALESCE($3, business_ruc),
        business_address = COALESCE($4, business_address),
        business_phone = COALESCE($5, business_phone),
        updated_at = NOW()
      WHERE id = $6
      RETURNING
        id, username, role, tax_rate,
        business_name, business_ruc, business_address, business_phone
    `;

    const values = [
        tax_rate,           // $1
        business_name,      // $2
        business_ruc,       // $3
        business_address,   // $4
        business_phone,     // $5
        id                  // $6
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json({ message: "Perfil actualizado", user: result.rows[0] });

  } catch (error) {
    console.error('❌ CRASH EN UPDATE:', error);
    res.status(500).json({ error: "Error al actualizar perfil" });
  }
};

const userIdParam = (req: Request): string => String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id || '');
const temporaryPassword = (): string => `${randomBytes(12).toString('base64url')}Aa1!`;

const ensureEmployee = async (client: any, employeeId: unknown) => {
  if (employeeId === null || employeeId === undefined || employeeId === '') return null;
  const result = await client.query('SELECT id FROM employees WHERE id=$1 AND active=true LIMIT 1', [employeeId]);
  if (!result.rows.length) throw Object.assign(new Error('El profesional indicado no existe o está inactivo'), { status: 400 });
  return result.rows[0].id;
};

export const createUser = async (req: Request, res: Response) => {
  const username = String(req.body?.username || '').trim();
  const role = canonicalRole(req.body?.role);
  const actorRole = canonicalRole(req.userRole);
  if (!USERNAME_PATTERN.test(username)) return res.status(400).json({ error: 'El usuario debe tener entre 3 y 40 caracteres válidos' });
  if (['admin', 'owner'].includes(username.toLowerCase())) return res.status(409).json({ error: 'Ese nombre de usuario está reservado' });
  if (!role || !actorRole || !assignableRoles(actorRole).includes(role)) return res.status(403).json({ error: 'No puedes crear una cuenta con ese rol' });

  let email: string | null;
  try { email = normalizedEmail(req.body?.email); } catch (error: any) { return res.status(400).json({ error: error.message }); }
  const generatedPassword = temporaryPassword();
  const passwordHash = await bcrypt.hash(generatedPassword, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const employeeId = await ensureEmployee(client, req.body?.employee_id);
    if (role === 'professional' && !employeeId) throw Object.assign(new Error('Una cuenta profesional debe vincularse a un empleado'), { status: 400 });
    if (employeeId) {
      const linked = await client.query('SELECT id FROM users WHERE employee_id=$1 LIMIT 1', [employeeId]);
      if (linked.rows.length) throw Object.assign(new Error('Ese profesional ya está vinculado a otra cuenta'), { status: 409 });
    }
    const inserted = await client.query(
      `INSERT INTO users(username,password,role,active,employee_id,email,must_change_password,password_changed_at)
       VALUES($1,$2,$3,true,$4,$5,true,NOW()) RETURNING id`,
      [username, passwordHash, role, employeeId, email]
    );
    await AdminAuditService.record('USER_CREATED', req.userId || null, inserted.rows[0].id, { role, employee_id: employeeId, has_email: Boolean(email) }, client);
    const managed = await client.query(`${selectManagedUsers} WHERE u.id=$1`, [inserted.rows[0].id]);
    await client.query('COMMIT');
    return res.status(201).json({
      message: 'Cuenta creada. La contraseña temporal se muestra una sola vez.',
      user: canonicalManagedRow(managed.rows[0]),
      temporary_password: generatedPassword
    });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error?.code === '23505') return res.status(409).json({ error: 'El usuario, correo o profesional ya está asociado a otra cuenta' });
    return res.status(error?.status || 500).json({ error: error?.message || 'No se pudo crear la cuenta' });
  } finally { client.release(); }
};

export const updateManagedUser = async (req: Request, res: Response) => {
  const id = userIdParam(req);
  if (!USER_ID_PATTERN.test(id)) return res.status(400).json({ error: 'Identificador de usuario no válido' });
  if (id === req.userId) return res.status(409).json({ error: 'No puedes modificar tu propia cuenta desde administración' });
  const actorRole = canonicalRole(req.userRole);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query('SELECT id,username,role,active,email,employee_id FROM users WHERE id=$1 FOR UPDATE', [id]);
    if (!currentResult.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Usuario no encontrado' }); }
    const current = currentResult.rows[0];
    if (!actorRole || !canManageRole(actorRole, current.role)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'No puedes administrar una cuenta de igual o mayor jerarquía' }); }

    const nextRole = req.body?.role === undefined ? canonicalRole(current.role) : canonicalRole(req.body.role);
    if (!nextRole || (req.body?.role !== undefined && !assignableRoles(actorRole).includes(nextRole))) {
      await client.query('ROLLBACK'); return res.status(403).json({ error: 'No puedes asignar ese rol' });
    }
    const nextActive = req.body?.active === undefined ? current.active : req.body.active;
    if (typeof nextActive !== 'boolean') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Estado inválido' }); }
    if (canonicalRole(current.role) === 'owner' && current.active && (nextRole !== 'owner' || !nextActive)) {
      const owners = await client.query("SELECT count(*)::int total FROM users WHERE role='owner' AND active=true AND id<>$1", [id]);
      if (!owners.rows[0].total) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Debe permanecer al menos un propietario activo' }); }
    }

    const username = req.body?.username === undefined ? current.username : String(req.body.username).trim();
    if (!USERNAME_PATTERN.test(username) || (['admin', 'owner'].includes(username.toLowerCase()) && username !== current.username)) {
      await client.query('ROLLBACK'); return res.status(400).json({ error: 'Nombre de usuario inválido o reservado' });
    }
    let email: string | null;
    try { email = req.body?.email === undefined ? current.email : normalizedEmail(req.body.email); }
    catch (error: any) { await client.query('ROLLBACK'); return res.status(400).json({ error: error.message }); }
    const employeeId = req.body?.employee_id === undefined ? current.employee_id : await ensureEmployee(client, req.body.employee_id);
    if (nextRole === 'professional' && !employeeId) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Una cuenta profesional debe vincularse a un empleado' }); }
    if (employeeId) {
      const linked = await client.query('SELECT id FROM users WHERE employee_id=$1 AND id<>$2 LIMIT 1', [employeeId, id]);
      if (linked.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Ese profesional ya está vinculado a otra cuenta' }); }
    }
    const changedSensitive = nextRole !== canonicalRole(current.role) || nextActive !== current.active;
    await client.query(
      `UPDATE users SET username=$1,email=$2,
         email_verified_at=CASE WHEN email IS DISTINCT FROM $2 THEN NULL ELSE email_verified_at END,
         employee_id=$3,role=$4,active=$5,
         token_version=token_version+CASE WHEN $6 THEN 1 ELSE 0 END,updated_at=NOW()
       WHERE id=$7`,
      [username, email, employeeId, nextRole, nextActive, changedSensitive, id]
    );
    await AdminAuditService.record('USER_UPDATED', req.userId || null, id, {
      role_from: canonicalRole(current.role), role_to: nextRole,
      active_from: current.active, active_to: nextActive,
      employee_id: employeeId, email_changed: email !== current.email
    }, client);
    const updated = await client.query(`${selectManagedUsers} WHERE u.id=$1`, [id]);
    await client.query('COMMIT');
    return res.json({ message: 'Cuenta actualizada', user: canonicalManagedRow(updated.rows[0]) });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error?.code === '23505') return res.status(409).json({ error: 'El usuario, correo o profesional ya está asociado a otra cuenta' });
    return res.status(error?.status || 500).json({ error: error?.message || 'No se pudo actualizar la cuenta' });
  } finally { client.release(); }
};

export const changeOwnPassword = async (req: Request, res: Response) => {
  const currentPassword = req.body?.current_password;
  const newPassword = req.body?.new_password;
  const confirmation = req.body?.confirmation;
  if (!validPassword(newPassword) || newPassword !== confirmation) {
    return res.status(400).json({ error: `La nueva contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres y coincidir` });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT id,username,password,role,token_version FROM users WHERE id=$1 AND active=true FOR UPDATE', [req.userId]);
    if (!result.rows.length || !(await bcrypt.compare(String(currentPassword || ''), result.rows[0].password))) {
      await client.query('ROLLBACK'); return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    }
    if (await bcrypt.compare(newPassword, result.rows[0].password)) {
      await client.query('ROLLBACK'); return res.status(409).json({ error: 'La nueva contraseña debe ser diferente' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    const updated = (await client.query(
      `UPDATE users SET password=$1,token_version=token_version+1,must_change_password=false,
       password_changed_at=NOW(),updated_at=NOW() WHERE id=$2
       RETURNING id,username,role,token_version`, [hash, req.userId]
    )).rows[0];
    await client.query('UPDATE pos_password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL', [req.userId]);
    await AdminAuditService.record('OWN_PASSWORD_CHANGED', req.userId || null, req.userId || null, {}, client);
    await client.query('COMMIT');
    return res.json({ message: 'Contraseña actualizada', token: signPosToken(updated) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return res.status(500).json({ error: 'No se pudo cambiar la contraseña' });
  } finally { client.release(); }
};

export const revokeUserSessions = async (req: Request, res: Response) => {
  const id = userIdParam(req);
  if (!USER_ID_PATTERN.test(id) || id === req.userId) return res.status(400).json({ error: 'Usuario objetivo no válido' });
  const target = (await pool.query('SELECT id,role FROM users WHERE id=$1', [id])).rows[0];
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!canManageRole(req.userRole, target.role)) return res.status(403).json({ error: 'No puedes revocar sesiones de esta cuenta' });
  await pool.query('UPDATE users SET token_version=token_version+1,updated_at=NOW() WHERE id=$1', [id]);
  await AdminAuditService.record('USER_SESSIONS_REVOKED', req.userId || null, id);
  return res.json({ message: 'Sesiones revocadas' });
};

export const adminResetPassword = async (req: Request, res: Response) => {
  const id = userIdParam(req);
  if (!USER_ID_PATTERN.test(id) || id === req.userId) return res.status(400).json({ error: 'Usuario objetivo no válido' });
  const target = (await pool.query('SELECT id,username,role,email,email_verified_at FROM users WHERE id=$1 AND active=true', [id])).rows[0];
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado o inactivo' });
  if (!canManageRole(req.userRole, target.role)) return res.status(403).json({ error: 'No puedes restablecer esta cuenta' });

  if (req.body?.mode === 'email') {
    if (!target.email || !target.email_verified_at) return res.status(409).json({ error: 'La cuenta no tiene un correo verificado' });
    if (!BrevoService.isConfigured()) return res.status(503).json({ error: 'El correo transaccional no está configurado' });
    const rawToken = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(rawToken).digest('hex');
    await pool.query('UPDATE pos_password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL', [id]);
    await pool.query(
      `INSERT INTO pos_password_reset_tokens(user_id,requested_by,token_hash,expires_at)
       VALUES($1,$2,$3,NOW()+INTERVAL '20 minutes')`, [id, req.userId, hash]
    );
    const resetUrl = `${process.env.POS_PUBLIC_URL || 'http://localhost:4200'}/reset-password?token=${rawToken}`;
    try {
      await BrevoService.sendPosPasswordResetEmail({ recipientEmail: target.email, recipientName: target.username, resetUrl });
      await AdminAuditService.record('USER_PASSWORD_RESET_LINK_SENT', req.userId || null, id, {});
      return res.json({ message: 'Enlace de restablecimiento enviado al correo verificado', delivery: 'email' });
    } catch {
      await pool.query('UPDATE pos_password_reset_tokens SET used_at=NOW() WHERE token_hash=$1', [hash]);
      return res.status(502).json({ error: 'No se pudo entregar el correo de restablecimiento' });
    }
  }

  const generatedPassword = temporaryPassword();
  const hash = await bcrypt.hash(generatedPassword, 12);
  await pool.query(
    `UPDATE users SET password=$1,must_change_password=true,token_version=token_version+1,
     password_changed_at=NOW(),updated_at=NOW() WHERE id=$2`, [hash, id]
  );
  await pool.query('UPDATE pos_password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL', [id]);
  await AdminAuditService.record('USER_TEMPORARY_PASSWORD_ISSUED', req.userId || null, id, {});
  return res.json({
    message: 'Acceso temporal generado. Se muestra una sola vez y deberá cambiarse al ingresar.',
    delivery: 'temporary', temporary_password: generatedPassword
  });
};

export const completePosPasswordReset = async (req: Request, res: Response) => {
  const token = String(req.body?.token || '');
  const newPassword = req.body?.new_password;
  const confirmation = req.body?.confirmation;
  if (!/^[a-f0-9]{64}$/i.test(token) || !validPassword(newPassword) || newPassword !== confirmation) {
    return res.status(400).json({ error: 'Solicitud de restablecimiento no válida' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const record = (await client.query(
      `SELECT id,user_id FROM pos_password_reset_tokens
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE`, [tokenHash]
    )).rows[0];
    if (!record) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'El enlace no es válido o ya expiró' }); }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const applied = await client.query(
      `UPDATE users SET password=$1,must_change_password=false,token_version=token_version+1,
       password_changed_at=NOW(),updated_at=NOW() WHERE id=$2 AND active=true`, [passwordHash, record.user_id]
    );
    await client.query('UPDATE pos_password_reset_tokens SET used_at=NOW() WHERE id=$1', [record.id]);
    if (!applied.rowCount) {
      await client.query('COMMIT');
      return res.status(409).json({ error: 'La cuenta no está activa. Contacta a la administración del POS.' });
    }
    await AdminAuditService.record('USER_PASSWORD_RESET_COMPLETED', null, record.user_id, {}, client);
    await client.query('COMMIT');
    return res.json({ message: 'Contraseña restablecida. Ya puedes iniciar sesión.' });
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    return res.status(500).json({ error: 'No se pudo restablecer la contraseña' });
  } finally { client.release(); }
};

export const getAdminAuditLog = async (_req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT l.id,l.action,l.metadata,l.created_at,l.actor_user_id,l.target_user_id,
            actor.username AS actor_username,target.username AS target_username
     FROM admin_audit_log l
     LEFT JOIN users actor ON actor.id=l.actor_user_id
     LEFT JOIN users target ON target.id=l.target_user_id
     ORDER BY l.created_at DESC LIMIT 200`
  );
  return res.json(result.rows);
};
