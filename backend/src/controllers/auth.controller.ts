import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../database/db';
import { JWT_ISSUER, POS_JWT_AUDIENCE } from '../middlewares/auth.middleware';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET es obligatorio y debe tener al menos 32 caracteres');
}

type PosRole = 'admin' | 'user';

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const selectManagedUsers = `
  SELECT
    u.id,
    u.username,
    u.role,
    u.active,
    u.employee_id,
    e.nombre AS employee_name,
    u.created_at,
    u.updated_at
  FROM users u
  LEFT JOIN employees e ON e.id = u.employee_id
`;

export const getUsers = async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`${selectManagedUsers} ORDER BY lower(u.username)`);
    return res.json(rows);
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

  if (role !== undefined && role !== 'admin' && role !== 'user') {
    return res.status(400).json({ error: 'El rol debe ser admin o user' });
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
      role: PosRole;
      active: boolean;
    };
    const nextRole = role ?? target.role;
    const nextActive = active ?? target.active;
    const isPrimaryAdmin = target.username.trim().toLowerCase() === 'admin';

    if (isPrimaryAdmin && (nextRole !== 'admin' || !nextActive)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'La cuenta principal admin debe permanecer activa y con rol administrador'
      });
    }

    if (target.id === req.userId && (nextRole !== 'admin' || !nextActive)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'No puedes quitar tus propios permisos administrativos' });
    }

    const removesActiveAdmin = target.role === 'admin' && target.active &&
      (nextRole !== 'admin' || !nextActive);

    if (removesActiveAdmin) {
      const activeAdmins = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM users
         WHERE role = 'admin' AND active = true AND id <> $1`,
        [target.id]
      );

      if (activeAdmins.rows[0].total === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Debe permanecer al menos un administrador activo' });
      }
    }

    await client.query(
      `UPDATE users
       SET role = $1, active = $2, updated_at = NOW()
       WHERE id = $3`,
      [nextRole, nextActive, target.id]
    );

    const updatedResult = await client.query(`${selectManagedUsers} WHERE u.id = $1`, [target.id]);
    await client.query('COMMIT');

    return res.json({
      message: 'Permisos actualizados',
      user: updatedResult.rows[0]
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
         id, username, role, active, tax_rate,
         business_name, business_ruc, business_address, business_phone
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.userId]
    );

    if (!rows.length || !rows[0].active) {
      return res.status(401).json({ error: 'La cuenta está inactiva o ya no existe' });
    }

    return res.json({ user: rows[0] });
  } catch (error) {
    console.error('Error obteniendo la sesión actual:', error);
    return res.status(500).json({ error: 'No se pudo actualizar la sesión' });
  }
};

// =========================================================================
// ✅ 1. LOGIN (AHORA LEE LOS DATOS DEL NEGOCIO)
// =========================================================================
export const login = async (req: Request, res: Response) => {
  console.log('\n🟢 ============ INICIO LOGIN ============');

  const { username, password } = req.body as { username?: string; password?: string };
  console.log('1️⃣  Datos recibidos:', { username, password: password ? '******' : 'NO_PASSWORD' });

  if (!username || !password) {
    return res.status(400).json({ error: 'username y password son requeridos' });
  }

  try {
    // 🔥 CAMBIO 1: Agregamos las columnas nuevas al SELECT
    const { rows } = await pool.query(
      `SELECT
         id, username, password, role, active,
         tax_rate, business_name, business_ruc, business_address, business_phone
       FROM users WHERE username = $1 LIMIT 1`,
      [username]
    );

    if (!rows.length || !rows[0].active) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);

    if (!ok) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    console.log('2️⃣  Contraseña correcta. Generando Token...');

    const token = jwt.sign(
      { sub: user.id, role: user.role, username: user.username, identity_type: 'pos_staff' },
      JWT_SECRET,
      { expiresIn: '8h', algorithm: 'HS256', issuer: JWT_ISSUER, audience: POS_JWT_AUDIENCE }
    );

    // 🔥 CAMBIO 2: Enviamos todos los datos al Frontend
    const responseData = {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        tax_rate: user.tax_rate,
        // Datos del negocio
        business_name: user.business_name,
        business_ruc: user.business_ruc,
        business_address: user.business_address,
        business_phone: user.business_phone
      }
    };

    console.log('3️⃣  Login Exitoso. Enviando datos.');
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
  console.log('\n🔵 ============ INICIO UPDATE PROFILE ============');

  // Obtenemos ID del token
  const id = req.user?.sub || req.user?.id || req.userId;

  // 🔥 CAMBIO 3: Recibimos TODOS los campos del formulario
  const {
    tax_rate,
    username,
    business_name,
    business_ruc,
    business_address,
    business_phone
  } = req.body;

  console.log('1️⃣  Usuario ID:', id);
  console.log('2️⃣  Datos a actualizar:', req.body);

  if (!id) {
    return res.status(401).json({ error: "Usuario no identificado" });
  }

  try {
    const current = await pool.query('SELECT username FROM users WHERE id = $1 AND active = true LIMIT 1', [id]);
    if (!current.rows.length) {
      return res.status(401).json({ error: 'La cuenta está inactiva o ya no existe' });
    }
    if (username !== undefined && String(username).trim() !== current.rows[0].username) {
      return res.status(403).json({ error: 'El nombre de usuario no puede modificarse desde el perfil' });
    }

    // 🔥 CAMBIO 4: SQL Dinámico para guardar todo
    const query = `
      UPDATE users
      SET
        tax_rate = COALESCE($1, tax_rate),
        username = username,
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

    console.log('3️⃣  ¡Perfil Actualizado! Datos nuevos en BD:', result.rows[0]);

    res.json({ message: "Perfil actualizado", user: result.rows[0] });

  } catch (error) {
    console.error('❌ CRASH EN UPDATE:', error);
    res.status(500).json({ error: "Error al actualizar perfil" });
  }
};
