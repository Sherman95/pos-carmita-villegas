import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../database/db';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

export const login = async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    return res.status(400).json({ error: 'username y password son requeridos' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, username, password, role, active FROM users WHERE username = $1 LIMIT 1',
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

    const token = jwt.sign({ sub: user.id, role: user.role, username: user.username }, JWT_SECRET, {
      expiresIn: '8h'
    });

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Error en login', err);
    return res.status(500).json({ error: 'Error en login' });
  }
};
