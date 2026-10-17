import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../database/db';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET es obligatorio y debe tener al menos 32 caracteres');
}

// Extendemos la definición de Request para TypeScript
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: string;
      user?: any;
    }
  }
}

export const verifyToken = async (req: Request, res: Response, next: NextFunction) => {
  console.log('🔒 [Middleware] Verificando Token...');

  // 1. Buscamos el token en varios lugares por si acaso
  let token = req.headers['authorization'] || req.headers['x-access-token'];

  // 2. Si es un array (caso raro), tomamos el primero
  if (Array.isArray(token)) token = token[0];

  if (!token) {
    console.log('❌ Acceso denegado: No hay token');
    return res.status(403).json({ error: 'No se proporcionó token' });
  }

  // 3. Limpieza: Si dice "Bearer ", se lo quitamos para dejar solo el código
  if (token.startsWith('Bearer ')) {
    token = token.slice(7, token.length);
  }

  let decoded: any;

  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.log('Token inválido:', error);
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  const userId = decoded.sub || decoded.id;
  if (!userId) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  try {
    if (decoded.role === 'sidro_client') {
      const { rows } = await pool.query(
        'SELECT id, is_active, token_version FROM sidro_client_accounts WHERE id = $1 LIMIT 1',
        [userId]
      );
      const sidroAccount = rows[0];

      if (!sidroAccount?.is_active) {
        return res.status(401).json({ error: 'La cuenta SIDRO está inactiva o ya no existe' });
      }

      if (Number(decoded.token_version ?? 0) !== Number(sidroAccount.token_version ?? 0)) {
        return res.status(401).json({ error: 'La sesión expiró. Inicia sesión nuevamente' });
      }

      req.userId = userId;
      req.userRole = 'sidro_client';
      req.user = {
        ...decoded,
        id: userId,
        role: 'sidro_client'
      };

      return next();
    }

    const { rows } = await pool.query(
      'SELECT username, role, active FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    const currentUser = rows[0];

    if (!currentUser?.active) {
      return res.status(401).json({ error: 'La cuenta está inactiva o ya no existe' });
    }

    req.userId = userId;
    req.userRole = currentUser.role;
    req.user = {
      ...decoded,
      sub: userId,
      username: currentUser.username,
      role: currentUser.role
    };

    return next();
  } catch (error) {
    console.error('Error verificando el estado del usuario:', error);
    return res.status(500).json({ error: 'No se pudo validar la sesión' });
  }
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.userRole?.trim().toLowerCase() !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado: se requiere rol de administrador' });
  }
  return next();
};
