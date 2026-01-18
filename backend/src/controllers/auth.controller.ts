import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../database/db';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

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
    
    if (!ok && password !== user.password) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    console.log('2️⃣  Contraseña correcta. Generando Token...');

    const token = jwt.sign({ sub: user.id, role: user.role, username: user.username }, JWT_SECRET, {
      expiresIn: '8h'
    });

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
    // 🔥 CAMBIO 4: SQL Dinámico para guardar todo
    const query = `
      UPDATE users 
      SET 
        tax_rate = COALESCE($1, tax_rate),
        username = COALESCE($2, username),
        business_name = COALESCE($3, business_name),
        business_ruc = COALESCE($4, business_ruc),
        business_address = COALESCE($5, business_address),
        business_phone = COALESCE($6, business_phone),
        updated_at = NOW()
      WHERE id = $7 
      RETURNING 
        id, username, role, tax_rate, 
        business_name, business_ruc, business_address, business_phone
    `;

    const values = [
        tax_rate,           // $1
        username,           // $2
        business_name,      // $3
        business_ruc,       // $4
        business_address,   // $5
        business_phone,     // $6
        id                  // $7
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