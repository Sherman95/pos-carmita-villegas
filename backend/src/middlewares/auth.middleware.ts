import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import pool from '../database/db';
import { canonicalRole, Permission, permissionsForRole, roleHasPermission } from '../security/rbac';

const JWT_SECRET = process.env.JWT_SECRET;

export const JWT_ISSUER = 'pos-carmita-villegas';
export const POS_JWT_AUDIENCE = 'pos';
export const SIDRO_JWT_AUDIENCE = 'sidro';

export type AuthIdentity = 'pos_staff' | 'sidro_client';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET es obligatorio y debe tener al menos 32 caracteres');
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: string;
      authIdentity?: AuthIdentity;
      user?: Record<string, unknown>;
      permissions?: Permission[];
    }
  }
}

const normalizedAudience = (audience: string | string[] | undefined): string | undefined =>
  Array.isArray(audience) ? audience[0] : audience;

const identityFromClaims = (claims: JwtPayload): AuthIdentity | null => {
  const audience = normalizedAudience(claims.aud);
  const claimedIdentity = claims.identity_type;

  if (audience !== undefined && audience !== POS_JWT_AUDIENCE && audience !== SIDRO_JWT_AUDIENCE) {
    return null;
  }
  if (claimedIdentity !== undefined && claimedIdentity !== 'pos_staff' && claimedIdentity !== 'sidro_client') {
    return null;
  }
  if (audience === POS_JWT_AUDIENCE) {
    return claimedIdentity === undefined || claimedIdentity === 'pos_staff' ? 'pos_staff' : null;
  }
  if (audience === SIDRO_JWT_AUDIENCE) {
    return claimedIdentity === undefined || claimedIdentity === 'sidro_client' ? 'sidro_client' : null;
  }
  if (claimedIdentity === 'pos_staff' || claimedIdentity === 'sidro_client') {
    return claimedIdentity;
  }

  // Compatibilidad temporal con tokens emitidos antes de introducir aud/identity_type.
  return claims.role === 'sidro_client' ? 'sidro_client' : 'pos_staff';
};

const bearerToken = (req: Request): string | null => {
  let value = req.headers.authorization || req.headers['x-access-token'];
  if (Array.isArray(value)) value = value[0];
  if (!value) return null;
  if (value.startsWith('Bearer ')) return value.slice(7).trim() || null;
  return value.trim() || null;
};

export const verifyToken = async (req: Request, res: Response, next: NextFunction) => {
  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'No se proporcionó token' });
  }

  let decoded: JwtPayload;
  try {
    const verified = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof verified === 'string') throw new Error('JWT payload inválido');
    decoded = verified;
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  const userId = String(decoded.sub || decoded.id || '').trim();
  const identity = identityFromClaims(decoded);
  if (!userId || !identity) {
    return res.status(401).json({ error: 'Token inválido o de identidad incorrecta' });
  }

  try {
    if (identity === 'sidro_client') {
      const { rows } = await pool.query(
        'SELECT id, is_active, token_version FROM sidro_client_accounts WHERE id = $1 LIMIT 1',
        [userId]
      );
      const account = rows[0];
      if (!account?.is_active) {
        return res.status(401).json({ error: 'La cuenta SIDRO está inactiva o ya no existe' });
      }
      if (Number(decoded.token_version ?? 0) !== Number(account.token_version ?? 0)) {
        return res.status(401).json({ error: 'La sesión expiró. Inicia sesión nuevamente' });
      }

      req.userId = String(account.id);
      req.userRole = 'sidro_client';
      req.authIdentity = 'sidro_client';
      req.user = { ...decoded, id: String(account.id), sub: String(account.id), role: 'sidro_client' };
      return next();
    }

    const { rows } = await pool.query(
      `SELECT id, username, role, active, employee_id,
              COALESCE(token_version, 0) AS token_version,
              COALESCE(must_change_password, false) AS must_change_password
       FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    const currentUser = rows[0];
    if (!currentUser?.active) {
      return res.status(401).json({ error: 'La cuenta está inactiva o ya no existe' });
    }
    const role = canonicalRole(currentUser.role);
    if (!role) {
      return res.status(403).json({ error: 'La cuenta no tiene un rol POS válido' });
    }
    if (Number(decoded.token_version ?? 0) !== Number(currentUser.token_version ?? 0)) {
      return res.status(401).json({ error: 'La sesión expiró. Inicia sesión nuevamente' });
    }

    req.userId = String(currentUser.id);
    req.userRole = role;
    req.authIdentity = 'pos_staff';
    req.permissions = permissionsForRole(role);
    req.user = {
      ...decoded,
      id: String(currentUser.id),
      sub: String(currentUser.id),
      username: currentUser.username,
      role,
      employee_id: currentUser.employee_id === null ? null : String(currentUser.employee_id),
      token_version: Number(currentUser.token_version || 0),
      must_change_password: Boolean(currentUser.must_change_password)
    };
    return next();
  } catch (error) {
    console.error('Error verificando el estado del usuario:', error);
    return res.status(500).json({ error: 'No se pudo validar la sesión' });
  }
};

export const requireStaff = (req: Request, res: Response, next: NextFunction) => {
  if (req.authIdentity !== 'pos_staff') {
    return res.status(403).json({ error: 'Acceso exclusivo para personal del POS' });
  }
  return next();
};

export const requireSidroClient = (req: Request, res: Response, next: NextFunction) => {
  if (req.authIdentity !== 'sidro_client') {
    return res.status(403).json({ error: 'Acceso exclusivo para cuentas SIDRO' });
  }
  return next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.authIdentity !== 'pos_staff' || !['owner', 'admin'].includes(req.userRole || '')) {
    return res.status(403).json({ error: 'Acceso denegado: se requiere rol de administrador' });
  }
  return next();
};

export const requireOwner = (req: Request, res: Response, next: NextFunction) => {
  if (req.authIdentity !== 'pos_staff' || req.userRole !== 'owner') {
    return res.status(403).json({ error: 'Acceso exclusivo para la cuenta propietaria' });
  }
  return next();
};

export const requirePermission = (permission: Permission) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (req.authIdentity !== 'pos_staff' || !roleHasPermission(req.userRole, permission)) {
      return res.status(403).json({ error: 'No tienes permiso para realizar esta acción', permission });
    }
    if (req.user?.must_change_password && permission !== 'profile.password.change') {
      return res.status(403).json({
        error: 'Debes cambiar tu contraseña temporal antes de continuar',
        code: 'PASSWORD_CHANGE_REQUIRED'
      });
    }
    return next();
  };

export const requireAnyPermission = (...permissions: Permission[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (req.authIdentity !== 'pos_staff' || !permissions.some(permission => roleHasPermission(req.userRole, permission))) {
      return res.status(403).json({ error: 'No tienes permiso para realizar esta acción' });
    }
    if (req.user?.must_change_password) {
      return res.status(403).json({
        error: 'Debes cambiar tu contraseña temporal antes de continuar',
        code: 'PASSWORD_CHANGE_REQUIRED'
      });
    }
    return next();
  };
