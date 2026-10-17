import { Request, Response, NextFunction } from 'express';
import pool from '../database/db';

type KeyResolver = (req: Request) => string;

// Resolve the client address without trusting proxy headers directly.
// `req.ip` honors Express `trust proxy`; when that is not configured it falls
// back to the socket address, so X-Forwarded-For is never used blindly.
function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown-ip';
}

const defaultKeyResolver: KeyResolver = (req) => clientIp(req);

function accountKeyResolver(req: Request): string {
  const account = String(req.body?.username || req.body?.telefono || req.body?.identifier || '')
    .trim()
    .toLowerCase();
  return account || clientIp(req);
}

interface LimitOptions {
  namespace: string;
  windowMs: number;
  limit: number;
  keyResolver?: KeyResolver;
}

// Single atomic statement: the window bucket and reset time are computed by
// PostgreSQL (`now()`), so both the counter increment and the expiry share one
// clock and concurrent requests can never race the read-modify-write.
async function enforceRateLimit(req: Request, res: Response, next: NextFunction, options: LimitOptions) {
  const keyBase = options.keyResolver ? options.keyResolver(req) : defaultKeyResolver(req);
  const bucketPrefix = `${options.namespace}:${keyBase}`;

  try {
    const result = await pool.query(
      `WITH w AS (
         SELECT floor(extract(epoch FROM now()) * 1000 / $2)::bigint AS bucket
       )
       INSERT INTO api_rate_limit_counters (bucket_key, hits, reset_at, updated_at)
       SELECT $1 || ':' || w.bucket,
              1,
              to_timestamp((w.bucket + 1) * $2 / 1000.0),
              now()
       FROM w
       ON CONFLICT (bucket_key)
       DO UPDATE SET hits = api_rate_limit_counters.hits + 1, updated_at = now()
       RETURNING hits,
                 reset_at,
                 GREATEST(1, ceil(extract(epoch FROM (reset_at - now()))))::int AS retry_after`,
      [bucketPrefix, options.windowMs]
    );

    const hits = Number(result.rows[0].hits);
    if (hits > options.limit) {
      res.setHeader('Retry-After', String(result.rows[0].retry_after));
      return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta nuevamente más tarde.' });
    }
    next();
  } catch (error) {
    next(error);
  }
}

function factory(options: LimitOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    enforceRateLimit(req, res, next, options);
  };
}

// Login attempts per client IP. Caps spraying across many distinct accounts
// from a single address.
export const authIpRateLimiter = factory({
  namespace: 'auth-login-ip',
  windowMs: 15 * 60 * 1000,
  limit: 30
});

// Login attempts per account (username / phone), independent of the IP cap.
export const authRateLimiter = factory({
  namespace: 'auth-login-account',
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyResolver: accountKeyResolver
});

// Registrations per client IP.
export const registrationRateLimiter = factory({
  namespace: 'sidro-register',
  windowMs: 60 * 60 * 1000,
  limit: 5
});

export const passwordResetIpRateLimiter = factory({
  namespace: 'sidro-password-reset-ip',
  windowMs: 60 * 60 * 1000,
  limit: 10
});

export const passwordResetAccountRateLimiter = factory({
  namespace: 'sidro-password-reset-account',
  windowMs: 60 * 60 * 1000,
  limit: 3,
  keyResolver: accountKeyResolver
});

// Broad per-IP ceiling for the whole API.
export const sensitiveRateLimiter = factory({
  namespace: 'sensitive',
  windowMs: 60 * 1000,
  limit: 120
});

// Expiration policy: rows whose window has ended are removed by a periodic
// job, never during a request. The `reset_at` column makes them identifiable.
export async function cleanupExpiredRateLimitCounters(): Promise<number> {
  const result = await pool.query('DELETE FROM api_rate_limit_counters WHERE reset_at < now()');
  return result.rowCount ?? 0;
}

let cleanupTimer: NodeJS.Timeout | null = null;

export function startRateLimitCleanup(intervalMs = 5 * 60 * 1000) {
  if (cleanupTimer) return cleanupTimer;
  cleanupTimer = setInterval(() => {
    cleanupExpiredRateLimitCounters().catch((error: any) => {
      console.error('[RATE-LIMIT] Error en limpieza periódica:', error.message);
    });
  }, intervalMs);
  cleanupTimer.unref?.();
  return cleanupTimer;
}
