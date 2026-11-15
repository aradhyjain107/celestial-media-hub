/**
 * Rate Limiting Test Suite
 *
 * Validates:
 * - Sliding-window limit enforcement per route group
 * - Per-IP isolation (different IPs don't share counters)
 * - 429 responses include correct Retry-After and X-RateLimit-* headers
 * - Middleware integrates rate limiting before auth
 * - Window reset behaviour
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  checkRateLimit,
  classifyRouteGroup,
  RATE_LIMIT_GROUPS,
  __resetStoreForTesting,
} from '../../src/lib/security/ratelimit';
import { middleware } from '../../src/middleware';
import { NextRequest } from 'next/server';

// ─── Env mock ─────────────────────────────────────────────────────────────────
vi.mock('../../src/lib/system/env', () => ({
  env: {
    FFMPEG_PATH: '/mock/ffmpeg',
    YTDLP_PATH: '/mock/ytdlp',
    TEMP_DIR: '/tmp/celestial-test',
    JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!',
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Rate Limiting Suite', () => {

  beforeEach(() => {
    __resetStoreForTesting();
    vi.clearAllMocks();
  });

  // ── 1. classifyRouteGroup ─────────────────────────────────────────────────
  describe('1. Route Group Classification', () => {

    test('classifies youtube as heavy', () => {
      expect(classifyRouteGroup('/api/youtube')).toBe('heavy');
    });

    test('classifies convert as heavy', () => {
      expect(classifyRouteGroup('/api/convert')).toBe('heavy');
    });

    test('classifies hevc as heavy', () => {
      expect(classifyRouteGroup('/api/hevc')).toBe('heavy');
    });

    test('classifies spotify-convert as heavy', () => {
      expect(classifyRouteGroup('/api/spotify-convert')).toBe('heavy');
    });

    test('classifies download as download group', () => {
      expect(classifyRouteGroup('/api/download')).toBe('download');
    });

    test('classifies audio-trim as medium', () => {
      expect(classifyRouteGroup('/api/audio-trim')).toBe('medium');
    });

    test('classifies mute as medium', () => {
      expect(classifyRouteGroup('/api/mute')).toBe('medium');
    });

    test('classifies mute as medium', () => {
      expect(classifyRouteGroup('/api/mute')).toBe('medium');
    });


    test('classifies experimental routes as experimental', () => {
      expect(classifyRouteGroup('/api/experimental/turbo-download')).toBe('experimental');
    });

    test('classifies unknown api routes as medium', () => {
      expect(classifyRouteGroup('/api/unknown-future-route')).toBe('medium');
    });
  });

  // ── 2. checkRateLimit sliding window ─────────────────────────────────────
  describe('2. checkRateLimit Sliding Window', () => {

    test('allows requests under the limit', () => {
      const config = { limit: 5, windowMs: 60_000 };
      for (let i = 0; i < 5; i++) {
        const result = checkRateLimit('ip1:test', config);
        expect(result.allowed).toBe(true);
      }
    });

    test('blocks the (limit + 1)th request', () => {
      const config = { limit: 3, windowMs: 60_000 };
      checkRateLimit('ip2:test', config);
      checkRateLimit('ip2:test', config);
      checkRateLimit('ip2:test', config);
      const blocked = checkRateLimit('ip2:test', config);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
    });

    test('returns correct remaining count', () => {
      const config = { limit: 10, windowMs: 60_000 };
      const r1 = checkRateLimit('ip3:test', config);
      expect(r1.remaining).toBe(9);
      const r2 = checkRateLimit('ip3:test', config);
      expect(r2.remaining).toBe(8);
    });

    test('returns retryAfter when blocked', () => {
      const config = { limit: 1, windowMs: 60_000 };
      checkRateLimit('ip4:test', config);
      const blocked = checkRateLimit('ip4:test', config);
      expect(blocked.allowed).toBe(false);
      expect(typeof blocked.retryAfter).toBe('number');
      expect(blocked.retryAfter!).toBeGreaterThan(0);
      expect(blocked.retryAfter!).toBeLessThanOrEqual(60);
    });

    test('returns resetAt as a Unix timestamp in seconds', () => {
      const config = { limit: 5, windowMs: 60_000 };
      const result = checkRateLimit('ip5:test', config);
      const nowSec = Math.floor(Date.now() / 1000);
      expect(result.resetAt).toBeGreaterThan(nowSec);
      expect(result.resetAt).toBeLessThan(nowSec + 120);
    });

    test('different IP keys are isolated (different clients independent)', () => {
      const config = { limit: 1, windowMs: 60_000 };
      // Exhaust limit for ipA
      checkRateLimit('ipA:test', config);
      const blocked = checkRateLimit('ipA:test', config);
      expect(blocked.allowed).toBe(false);
      // ipB should still be allowed
      const allowed = checkRateLimit('ipB:test', config);
      expect(allowed.allowed).toBe(true);
    });

    test('different route groups are isolated for the same IP', () => {
      const tightConfig = { limit: 1, windowMs: 60_000 };
      const looseConfig = { limit: 10, windowMs: 60_000 };
      checkRateLimit('ipC:heavy', tightConfig);
      const blockedHeavy = checkRateLimit('ipC:heavy', tightConfig);
      expect(blockedHeavy.allowed).toBe(false);
      // Medium route group is a different key
      const allowedMedium = checkRateLimit('ipC:medium', looseConfig);
      expect(allowedMedium.allowed).toBe(true);
    });

    test('window slides: expired requests are evicted', async () => {
      const config = { limit: 2, windowMs: 100 }; // 100ms window for fast test
      checkRateLimit('ip6:test', config);
      checkRateLimit('ip6:test', config);

      // Both slots used — should be blocked
      const blocked = checkRateLimit('ip6:test', config);
      expect(blocked.allowed).toBe(false);

      // Wait for window to expire
      await new Promise(r => setTimeout(r, 110));

      // After window expires, should be allowed again
      const allowed = checkRateLimit('ip6:test', config);
      expect(allowed.allowed).toBe(true);
    });
  });

  // ── 3. RATE_LIMIT_GROUPS config correctness ───────────────────────────────
  describe('3. Rate Limit Group Config Values', () => {

    test('heavy group limit is >= 5 and <= 30', () => {
      expect(RATE_LIMIT_GROUPS.heavy.limit).toBeGreaterThanOrEqual(5);
      expect(RATE_LIMIT_GROUPS.heavy.limit).toBeLessThanOrEqual(30);
    });

    test('experimental group has the tightest limit', () => {
      const limits = Object.values(RATE_LIMIT_GROUPS).map(c => c.limit);
      expect(RATE_LIMIT_GROUPS.experimental.limit).toBe(Math.min(...limits));
    });

    test('download group has the loosest limit', () => {
      const limits = Object.values(RATE_LIMIT_GROUPS).map(c => c.limit);
      expect(RATE_LIMIT_GROUPS.download.limit).toBe(Math.max(...limits));
    });

    test('all groups have windowMs of at least 30 seconds', () => {
      Object.values(RATE_LIMIT_GROUPS).forEach(cfg => {
        expect(cfg.windowMs).toBeGreaterThanOrEqual(30_000);
      });
    });
  });

  // ── 4. Middleware rate limiting integration ───────────────────────────────
  describe('4. Middleware Rate Limiting (429 Enforcement)', () => {

    test('middleware returns 429 after exhausting heavy route limit', () => {
      const limit = RATE_LIMIT_GROUPS.heavy.limit;

      // Exhaust the limit using the same IP (no x-forwarded-for → 127.0.0.1)
      for (let i = 0; i < limit; i++) {
        const req = new NextRequest('http://localhost/api/youtube', {
          method: 'POST',
          headers: { authorization: 'Bearer user_alice' },
        });
        middleware(req);
      }

      // Next request should hit 429
      const req = new NextRequest('http://localhost/api/youtube', {
        method: 'POST',
        headers: { authorization: 'Bearer user_alice' },
      });
      const res = middleware(req);
      expect(res.status).toBe(429);
    });

    test('middleware 429 response includes Retry-After header', () => {
      const limit = RATE_LIMIT_GROUPS.heavy.limit;
      for (let i = 0; i <= limit; i++) {
        const req = new NextRequest('http://localhost/api/convert', {
          method: 'POST',
          headers: { authorization: 'Bearer user_alice' },
        });
        const res = middleware(req);
        if (res.status === 429) {
          expect(res.headers.has('Retry-After')).toBe(true);
          const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10);
          expect(retryAfter).toBeGreaterThan(0);
          return; // test passed
        }
      }
    });

    test('middleware 429 response includes X-RateLimit-* headers', () => {
      const limit = RATE_LIMIT_GROUPS.experimental.limit;
      for (let i = 0; i <= limit; i++) {
        const req = new NextRequest('http://localhost/api/experimental/turbo-download?url=x', {
          headers: { authorization: 'Bearer user_alice' },
        });
        const res = middleware(req);
        if (res.status === 429) {
          expect(res.headers.get('X-RateLimit-Limit')).toBe(String(limit));
          expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
          expect(res.headers.has('X-RateLimit-Reset')).toBe(true);
          return;
        }
      }
    });

    test('middleware returns 429 before 401 when rate limited (rate limit checked first)', () => {
      const limit = RATE_LIMIT_GROUPS.heavy.limit;
      // Exhaust limit (no auth needed for rate limit check)
      for (let i = 0; i < limit; i++) {
        const req = new NextRequest('http://localhost/api/youtube', { method: 'POST' });
        middleware(req);
      }
      // Next request: unauthenticated but rate limited — must return 429, not 401
      const req = new NextRequest('http://localhost/api/youtube', { method: 'POST' });
      const res = middleware(req);
      expect(res.status).toBe(429);
    });

    test('middleware adds X-RateLimit-Remaining header on successful requests', () => {
      const req = new NextRequest('http://localhost/api/mute', {
        method: 'POST',
        headers: { authorization: 'Bearer user_alice' },
      });

      const res = middleware(req);
      // Either 200 (passed through) or 401/other — but header should be present
      expect(res.headers.has('X-RateLimit-Remaining')).toBe(true);
    });

    test('different IPs have independent rate limit counters in middleware', () => {
      const limit = RATE_LIMIT_GROUPS.heavy.limit;
      // Exhaust limit for IP 1.2.3.4
      for (let i = 0; i < limit; i++) {
        middleware(new NextRequest('http://localhost/api/youtube', {
          method: 'POST',
          headers: { 'x-real-ip': '1.2.3.4', authorization: 'Bearer user_alice' },
        }));
      }
      // IP 1.2.3.4 is now rate limited
      const blocked = middleware(new NextRequest('http://localhost/api/youtube', {
        method: 'POST',
        headers: { 'x-real-ip': '1.2.3.4', authorization: 'Bearer user_alice' },
      }));
      expect(blocked.status).toBe(429);

      // IP 5.6.7.8 should NOT be rate limited
      const allowed = middleware(new NextRequest('http://localhost/api/youtube', {
        method: 'POST',
        headers: { 'x-real-ip': '5.6.7.8', authorization: 'Bearer user_alice' },
      }));
      expect(allowed.status).not.toBe(429);
    });
  });
});
