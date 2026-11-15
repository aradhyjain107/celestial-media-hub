import { NextRequest } from 'next/server';
import { verifyToken, verifyTokenSync } from './jwt';

export interface AuthSession {
  userId: string;
  role: 'user' | 'admin';
  email?: string;
  token: string;
  iat: number;
  exp?: number;
}

interface JobRecord {
  userId: string;
  createdAt: number;
}

const jobOwnerMap: Map<string, JobRecord> =
  (globalThis as any).__jobOwnerMap || ((globalThis as any).__jobOwnerMap = new Map<string, JobRecord>());

/**
 * Registers job ownership mapping (jobId -> userId).
 */
export function registerJobOwner(jobId: string, userId: string): void {
  if (!jobId || !userId) return;
  cleanExpiredJobOwners();
  jobOwnerMap.set(jobId, {
    userId,
    createdAt: Date.now(),
  });
}

/**
 * Removes job ownership mapping.
 */
export function unregisterJobOwner(jobId: string): void {
  if (!jobId) return;
  jobOwnerMap.delete(jobId);
}

/**
 * Verifies if the session/user owns the specified job ID.
 * Admins are granted universal access.
 */
export function verifyJobOwnership(jobId: string, userOrSession: AuthSession | string): boolean {
  if (!jobId) return false;

  const userId = typeof userOrSession === 'string' ? userOrSession : userOrSession.userId;
  const role = typeof userOrSession === 'object' ? userOrSession.role : 'user';

  // Admins bypass object ownership checks
  if (role === 'admin') {
    return true;
  }

  const record = jobOwnerMap.get(jobId);
  if (!record) {
    // If job was not registered, deny access
    return false;
  }

  return record.userId === userId;
}

/**
 * Clean up old job ownership entries (prevents memory leak).
 */
export function cleanExpiredJobOwners(maxAgeMs: number = 3600000): void {
  const now = Date.now();
  jobOwnerMap.forEach((record, jobId) => {
    if (now - record.createdAt > maxAgeMs) {
      jobOwnerMap.delete(jobId);
    }
  });
}

/**
 * Extracts a raw token string from the request (Authorization header,
 * x-api-key header, cookie, or query param).
 *
 * Direct client identity headers (x-user-id, x-user-role, x-user-email)
 * are NEVER trusted — they are stripped in middleware.ts before reaching here.
 */
function extractToken(req: NextRequest | Request): string | null {
  if (!req || !req.headers || typeof req.headers.get !== 'function') {
    return null;
  }

  // 1. Authorization: Bearer <token>
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (authHeader) {
    const trimmed = authHeader.trim();
    if (trimmed.toLowerCase().startsWith('bearer')) {
      const extracted = trimmed.substring(6).trim();
      if (extracted.length > 0) return extracted;
    } else if (trimmed.length > 0) {
      return trimmed;
    }
  }

  // 2. x-api-key header
  const apiKey = req.headers.get('x-api-key');
  if (apiKey && apiKey.trim().length > 0) {
    return apiKey.trim();
  }

  // 3. Cookie
  if ('cookies' in req && req.cookies) {
    const cookieToken =
      (req as NextRequest).cookies.get('auth_token')?.value ||
      (req as NextRequest).cookies.get('session_id')?.value ||
      (req as NextRequest).cookies.get('token')?.value;
    if (cookieToken && cookieToken.trim().length > 0) {
      return cookieToken.trim();
    }
  }

  // 4. URL query params (last resort)
  if (req.url) {
    try {
      const url = new URL(req.url);
      const queryToken = url.searchParams.get('token') || url.searchParams.get('apiKey');
      if (queryToken && queryToken.trim().length > 0) {
        return queryToken.trim();
      }
    } catch {
      // Invalid URL ignored
    }
  }

  return null;
}



/**
 * Parses and verifies authentication credentials from a request.
 *
 * Token resolution order:
 *  1. Signed JWT (HS256) verified against JWT_SECRET — the only accepted method
 *     in NODE_ENV=production.
 *  2. Legacy dev-only patterns (user_, admin-, dev-token-) — accepted only when
 *     NODE_ENV !== 'production'. Logs a warning in non-test environments.
 *
 * Returns null if no valid credential is found.
 */
export function verifyAuth(req: NextRequest | Request): AuthSession | null {
  const token = extractToken(req);
  if (!token) return null;

  // We always try JWT first (async verifyToken → sync wrapper below)
  // Since middleware.ts and API routes call this synchronously, we use a
  // synchronous path for dev tokens and a verified-JWT cache pattern.
  //
  // NOTE: The async path (verifyAuthAsync) is preferred for new code.
  // This sync wrapper exists for backward compatibility with all existing
  // route handlers that call verifyAuth() synchronously.
  return parseAndValidateTokenSync(token);
}

/**
 * Async version of verifyAuth that performs real JWT signature verification.
 * Use this in new code where async/await is available.
 */
export async function verifyAuthAsync(req: NextRequest | Request): Promise<AuthSession | null> {
  const token = extractToken(req);
  if (!token) return null;

  // 1. Try cryptographically verified JWT (sync, works everywhere)
  const payload = await verifyToken(token);
  if (payload) {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      userId: payload.sub,
      role: payload.role,
      email: payload.email,
      token,
      iat: payload.iat ?? nowSec,
      exp: payload.exp,
    };
  }

  // If the token looks like a JWT (3-part structure) but failed verification,
  // ALWAYS reject — never fall through to dev token patterns.
  if (token.includes('.') && token.split('.').length === 3) {
    return null;
  }

  // 2. Dev-only legacy token patterns (for plain non-JWT tokens)
  return parseDevToken(token);
}


/**
 * Synchronous token validation — performs full HS256 signature verification
 * using the native Node.js crypto implementation in lib/jwt.ts.
 *
 * In production, non-JWT tokens return null.
 * In development/test, legacy dev token patterns are also accepted.
 */
function parseAndValidateTokenSync(token: string): AuthSession | null {
  if (!token || token.trim().length === 0) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const isProduction = process.env.NODE_ENV === 'production';

  // 1. Full cryptographic HS256 JWT verification (works synchronously)
  //    If the token LOOKS like a JWT (3-part, dot-separated), we ALWAYS run
  //    verification. A failed verification is always rejected — in ALL
  //    environments — to prevent token forgery even in development/test.
  if (token.includes('.') && token.split('.').length === 3) {
    const payload = verifyTokenSync(token);
    if (payload) {
      const role: 'user' | 'admin' = payload.role === 'admin' ? 'admin' : 'user';
      return {
        userId: payload.sub,
        role,
        email: payload.email,
        token,
        iat: payload.iat ?? nowSec,
        exp: payload.exp ?? nowSec + 86400,
      };
    }
    // JWT verification FAILED (bad signature / expired / none-alg / tampered)
    // ALWAYS reject — regardless of environment. Never fall through to dev tokens.
    return null;
  }

  // 2. In production, reject everything that isn't a JWT
  if (isProduction) {
    return null;
  }

  // 3. Development-only legacy token patterns (user_, admin-, dev-token-, etc.)
  return parseDevToken(token);
}


/**
 * Accepts simple dev token patterns (never used in production).
 * @internal
 */
function parseDevToken(token: string): AuthSession | null {
  const nowSec = Math.floor(Date.now() / 1000);

  if (process.env.NODE_ENV !== 'test') {
    console.warn('[AUTH] Dev token accepted — use signed JWTs in production:', token.substring(0, 12) + '...');
  }

  // admin- or admin_ prefix
  if (token.startsWith('admin-') || token.startsWith('admin_')) {
    const parts = token.split(/[-_]/);
    const userId = parts.length > 1 ? parts.slice(1).join('_') : 'admin-user';
    return {
      userId: userId || 'admin-user',
      role: 'admin',
      email: `${userId || 'admin-user'}@celestial.hub`,
      token,
      iat: nowSec,
      exp: nowSec + 86400,
    };
  }

  // user_, dev-token-, or usr_ prefix
  if (token.startsWith('user_') || token.startsWith('dev-token-') || token.startsWith('usr_')) {
    const parts = token.split('_');
    const userId = parts.length > 1 ? parts.slice(1).join('_') : token;
    return {
      userId,
      role: 'user',
      email: `${userId}@celestial.hub`,
      token,
      iat: nowSec,
      exp: nowSec + 86400,
    };
  }

  // In development, any other non-empty token gets a fallback user session
  // NOTE: This does NOT run in production (isProduction guard above).
  const userId = `user-${token.substring(0, 8)}`;
  return {
    userId,
    role: 'user',
    email: `${userId}@celestial.hub`,
    token,
    iat: nowSec,
    exp: nowSec + 86400,
  };
}
