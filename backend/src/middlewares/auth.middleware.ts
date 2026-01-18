import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

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

export const verifyToken = (req: Request, res: Response, next: NextFunction) => {
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

  try {
    // 4. Verificamos la firma
    const decoded: any = jwt.verify(token, JWT_SECRET);
    
    // 5. ¡ÉXITO! Guardamos los datos para que el Controller los use
    // Guardamos en ambos lugares para asegurar compatibilidad
    req.userId = decoded.sub || decoded.id; 
    req.userRole = decoded.role;
    req.user = decoded;

    console.log('✅ Token Válido. Usuario ID:', req.userId);
    next(); // Pase usted, caballero.

  } catch (error) {
    console.log('❌ Token Inválido:', error);
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};