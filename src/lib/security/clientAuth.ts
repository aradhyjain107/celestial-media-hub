'use client';

import { useState, useEffect } from 'react';
import { safeFetch } from './safeFetch';

const STORAGE_KEY = 'celestial_session_jwt';
const DEV_FALLBACK_TOKEN = 'dev-token-ui';

let memoryToken: string | null = null;
let inflightPromise: Promise<string> | null = null;
const tokenListeners = new Set<(token: string) => void>();

function notifyTokenListeners(token: string): void {
  tokenListeners.forEach((listener) => {
    try {
      listener(token);
    } catch {
      // Ignore subscriber errors
    }
  });
}

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
  notifyTokenListeners(token);
}

/**
 * Clears cached client JWTs (used when recovering from container restarts / 401s).
 */
export function clearStoredSessionToken(): void {
  memoryToken = null;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage?.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
  notifyTokenListeners(DEV_FALLBACK_TOKEN);
}

/**
 * Returns the cached session JWT synchronously, or falls back to dev token
 * before bootstrap finishes (or in test environments).
 */
export function getAuthTokenSync(): string {
  return readStoredToken() || DEV_FALLBACK_TOKEN;
}

async function fetchSessionJwtOnce(apiBase: string): Promise<string | null> {
  const res = await safeFetch(`${apiBase}/api/auth/session`, {
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
  return null;
}

/**
 * Bootstraps an anonymous signed HS256 JWT session from `/api/auth/session`
 * so public deployments work seamlessly with `NODE_ENV=production` JWT checks.
 */
export async function ensureSessionToken(forceRefresh = false): Promise<string> {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
    return readStoredToken() || DEV_FALLBACK_TOKEN;
  }

  if (forceRefresh) {
    clearStoredSessionToken();
    inflightPromise = null;
  } else {
    const existing = readStoredToken();
    if (existing) return existing;
  }

  if (inflightPromise && !forceRefresh) {
    return inflightPromise;
  }

  inflightPromise = (async () => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const token = await fetchSessionJwtOnce(apiBase);
        if (token) return token;
      } catch {
        // Retry once after transient network / container spin-up hiccup
      }
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return readStoredToken() || DEV_FALLBACK_TOKEN;
  })();

  try {
    return await inflightPromise;
  } finally {
    inflightPromise = null;
  }
}

/**
 * Executes an authenticated API request using `safeFetch` and automatically
 * refreshes an expired/stale session JWT (e.g. after server restart) on 401.
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const sendWithToken = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return safeFetch(input, {
      ...init,
      headers,
      credentials: init.credentials ?? 'include',
    });
  };

  // Use cached JWT (or dev fallback in tests) before any await so synchronous callers dispatch immediately.
  const cachedOrTestToken =
    readStoredToken() ||
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test'
      ? DEV_FALLBACK_TOKEN
      : null);
  const initialToken = cachedOrTestToken ?? (await ensureSessionToken());
  const res = await sendWithToken(initialToken);
  if (res.status !== 401) {
    return res;
  }

  const refreshedToken = await ensureSessionToken(true);
  if (!refreshedToken || (refreshedToken === initialToken && refreshedToken === DEV_FALLBACK_TOKEN)) {
    return res;
  }

  return sendWithToken(refreshedToken);
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
    const onTokenUpdate = (nextToken: string) => {
      if (active) setToken(nextToken);
    };
    tokenListeners.add(onTokenUpdate);

    ensureSessionToken().then((resolved) => {
      if (active && resolved) {
        setToken(resolved);
      }
    });
    return () => {
      active = false;
      tokenListeners.delete(onTokenUpdate);
    };
  }, []);

  return token;
}
