import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../database/db';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// ✅ 1. LOGIN CON LOGS DETALLADOS
export const login = async (req: Request, res: Response) => {
  console.log('\n🟢 ============ INICIO LOGIN ============');
  
  const { username, password } = req.body as { username?: string; password?: string };
  console.log('1️⃣  Datos recibidos:', { username, password: password ? '******' : 'NO_PASSWORD' });

  if (!username || !password) {
    console.log('❌ Error: Faltan datos');
    return res.status(400).json({ error: 'username y password son requeridos' });
  }

  try {
    console.log('2️⃣  Ejecutando consulta SQL...');
    // 🔥 CAMBIO CLAVE: Agregamos 'tax_rate' al SELECT
    const { rows } = await pool.query(
      'SELECT id, username, password, role, active, tax_rate FROM users WHERE username = $1 LIMIT 1',
      [username]
    );

    console.log('3️⃣  Respuesta de la Base de Datos (Raw Row):', rows[0]); 
    // ^^^ ¡AQUÍ ES DONDE DEBES MIRAR! ^^^
    // Si aquí tax_rate dice 12 o 0.12, la BD está perfecta.
    // Si aquí no aparece tax_rate, la consulta está mal o la columna no existe.

    if (!rows.length || !rows[0].active) {
      console.log('❌ Usuario no encontrado o inactivo');
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    
    if (!ok && password !== user.password) {
      console.log('❌ Contraseña incorrecta');
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    console.log('4️⃣  Contraseña correcta. Generando Token...');

    const token = jwt.sign({ sub: user.id, role: user.role, username: user.username }, JWT_SECRET, {
      expiresIn: '8h'
    });

    const responseData = {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        tax_rate: user.tax_rate // 🔥 ENVIAMOS EL DATO AL FRONTEND
      }
    };

    console.log('5️⃣  Enviando respuesta final al Frontend:', responseData.user);
    console.log('🟢 ============ FIN LOGIN ============\n');

    return res.json(responseData);

  } catch (err) {
    console.error('❌ CRASH EN LOGIN:', err);
    return res.status(500).json({ error: 'Error en login' });
  }
};

// ✅ 2. UPDATE PROFILE CON LOGS DETALLADOS
export const updateProfile = async (req: Request | any, res: Response) => {
  console.log('\n🔵 ============ INICIO UPDATE PROFILE ============');
  
  // Nota: req.user viene del middleware de autenticación (verifyToken)
  const id = req.user?.sub || req.user?.id; 
  const { tax_rate, username } = req.body;

  console.log('1️⃣  Usuario ID (desde Token):', id);
  console.log('2️⃣  Datos a actualizar (Body):', { tax_rate, username });

  if (!id) {
    console.log('❌ Error: No hay ID de usuario en la request');
    return res.status(401).json({ error: "Usuario no identificado" });
  }

  try {
    console.log('3️⃣  Ejecutando UPDATE en Base de Datos...');
    
    // Actualizamos IVA y/o Nombre
    const result = await pool.query(
      `UPDATE users 
       SET tax_rate = $1, username = COALESCE($2, username)
       WHERE id = $3 
       RETURNING id, username, role, tax_rate`,
      [tax_rate, username, id]
    );

    if (result.rows.length === 0) {
      console.log('❌ Error: El UPDATE no retornó filas (¿Usuario no existe?)');
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    console.log('4️⃣  ¡ÉXITO! Dato guardado en BD y retornado:', result.rows[0]);
    // ^^^ AQUÍ CONFIRMAS QUE SE GUARDÓ ^^^

    console.log('🔵 ============ FIN UPDATE PROFILE ============\n');
    res.json({ message: "Perfil actualizado", user: result.rows[0] });

  } catch (error) {
    console.error('❌ CRASH EN UPDATE:', error);
    res.status(500).json({ error: "Error al actualizar perfil" });
  }
};