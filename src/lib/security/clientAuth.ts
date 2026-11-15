'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'celestial_session_jwt';
const DEV_FALLBACK_TOKEN = 'dev-token-ui';

let memoryToken: string | null = null;
let inflightPromise: Promise<string> | null = null;

function readStoredToken(): string | null {
  if (memoryToken) return memoryToken;
  if (typeof window !== 'undefined') {
    try {
      const stored = window.sessionStorage?.getItem(STORAGE_KEY);
      if (stored && stored.split('.').length === 3) {
        memoryToken = stored;
        return stored;
      }
    } catch {
      // sessionStorage disabled in restricted browsing modes
    }
  }
  return null;
}

function writeStoredToken(token: string): void {
  memoryToken = token;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage?.setItem(STORAGE_KEY, token);
    } catch {
      // Ignore storage errors
    }
  }
}

/**
 * Returns the cached session JWT synchronously, or falls back to dev token
 * before bootstrap finishes (or in test environments).
 */
export function getAuthTokenSync(): string {
  return readStoredToken() || DEV_FALLBACK_TOKEN;
}

/**
 * Bootstraps an anonymous signed HS256 JWT session from `/api/auth/session`
 * so public deployments work seamlessly with `NODE_ENV=production` JWT checks.
 */
export async function ensureSessionToken(forceRefresh = false): Promise<string> {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
    return readStoredToken() || DEV_FALLBACK_TOKEN;
  }

  if (!forceRefresh) {
    const existing = readStoredToken();
    if (existing) return existing;
  }

  if (inflightPromise && !forceRefresh) {
    return inflightPromise;
  }

  inflightPromise = (async () => {
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
      const res = await fetch(`${apiBase}/api/auth/session`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      if (res && res.ok && typeof res.json === 'function') {
        const data = await res.json();
        if (data && typeof data.token === 'string' && data.token.split('.').length === 3) {
          writeStoredToken(data.token);
          return data.token;
        }
      }
    } catch {
      // Fallback safely for offline/unit-test environments
    } finally {
      inflightPromise = null;
    }
    return readStoredToken() || DEV_FALLBACK_TOKEN;
  })();

  return inflightPromise;
}

/**
 * Appends the active auth token to a download URL if not already present.
 */
export function appendAuthToken(rawHref: string, tokenOverride?: string): string {
  if (!rawHref) return rawHref;
  if (rawHref.includes('token=')) return rawHref;
  const token = tokenOverride || getAuthTokenSync();
  const sep = rawHref.includes('?') ? '&' : '?';
  return `${rawHref}${sep}token=${encodeURIComponent(token)}`;
}

/**
 * React hook that ensures a valid signed JWT is available for render-time download links.
 */
export function useSessionToken(): string {
  const [token, setToken] = useState<string>(() => getAuthTokenSync());

  useEffect(() => {
    let active = true;
    ensureSessionToken().then((resolved) => {
      if (active && resolved) {
        setToken(resolved);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return token;
}
