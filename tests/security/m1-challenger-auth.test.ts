import { describe, test, expect, vi } from 'vitest';

vi.mock('../../lib/env', () => ({
  env: { FFMPEG_PATH: '/mock/ffmpeg', YTDLP_PATH: '/mock/ytdlp', TEMP_DIR: '/mock/tmp', JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!' },
}));

import { NextRequest } from 'next/server';
import { verifyAuth } from '../../lib/auth';
import { middleware } from '../../middleware';

describe('Milestone 1 Challenger 1: Authentication Stress & Edge Case Test Suite', () => {

  describe('1. Unauthenticated Identity Header Injection & Privilege Escalation', () => {
    test('[CRITICAL] External request with no token but sending x-user-id header', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: {
          'x-user-id': 'unauthenticated_attacker',
        },
      });

      const session = verifyAuth(req);
      // VULNERABILITY DETECTED: if session is not null, unauthenticated identity spoofing is possible!
      expect(session).toBeNull();
    });

    test('[CRITICAL] External request with no token but sending x-user-id and x-user-role: admin', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: {
          'x-user-id': 'fake_admin',
          'x-user-role': 'admin',
        },
      });

      const session = verifyAuth(req);
      expect(session).toBeNull();
    });

    test('[CRITICAL] Privilege escalation: Valid user token sending x-user-role: admin header', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user_alice',
          'x-user-role': 'admin',
        },
      });

      const session = verifyAuth(req);
      expect(session).not.toBeNull();
      // User 'user_alice' should NOT be elevated to admin role just by providing header x-user-role: admin
      expect(session?.role).toBe('user');
    });
  });

  describe('2. Malformed Bearer Tokens & Case-Sensitivity Edge Cases', () => {
    test('Empty Bearer token: "Authorization: Bearer "', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        headers: { authorization: 'Bearer ' },
      });
      const session = verifyAuth(req);
      expect(session).toBeNull();
    });

    test('Bearer without token or space: "Authorization: Bearer"', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        headers: { authorization: 'Bearer' },
      });
      const session = verifyAuth(req);
      // 'Bearer' trim() gives 'Bearer', which fallback parses as user-Bearer
      // Evaluate if this should be null or parsed as token string 'Bearer'
      expect(session?.userId).not.toBe('admin-user');
    });

    test('Case-sensitivity: lowercase "bearer user_alice"', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        headers: { authorization: 'bearer user_alice' },
      });
      const session = verifyAuth(req);
      expect(session).not.toBeNull();
      // Lowercase bearer should ideally strip 'bearer ' and resolve userId to 'alice'
      expect(session?.userId).toBe('alice');
    });

    test('Case-sensitivity: uppercase "BEARER user_alice"', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        headers: { authorization: 'BEARER user_alice' },
      });
      const session = verifyAuth(req);
      expect(session).not.toBeNull();
      expect(session?.userId).toBe('alice');
    });

    test('Leading space in Authorization header: "Authorization:   Bearer user_alice"', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        headers: { authorization: '  Bearer user_alice' },
      });
      const session = verifyAuth(req);
      expect(session).not.toBeNull();
      expect(session?.userId).toBe('alice');
    });

    test('Multiple spaces after Bearer: "Authorization: Bearer   user_alice"', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        headers: { authorization: 'Bearer   user_alice' },
      });
      const session = verifyAuth(req);
      expect(session).not.toBeNull();
      expect(session?.userId).toBe('alice');
    });

    test('User token containing "admin" substring: "user_admin_bob"', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        headers: { authorization: 'Bearer user_admin_bob' },
      });
      const session = verifyAuth(req);
      expect(session).not.toBeNull();
      // Regular user with 'admin' in username should NOT be given role 'admin'
      expect(session?.role).toBe('user');
      expect(session?.userId).toBe('admin_bob');
    });
  });

  describe('3. JWT Token Expiration Stress Test', () => {
    test('Expired JWT token should be rejected (returns null)', () => {
      const pastSec = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      // Build a properly-structured JWT: valid base64url header + expired payload + fake sig
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const expiredPayload = Buffer.from(JSON.stringify({ sub: 'john_doe', role: 'user', iat: pastSec - 3600, exp: pastSec })).toString('base64url');
      const expiredJwt = `${header}.${expiredPayload}.fakesignature`;

      const req = new NextRequest('http://localhost/api/convert', {
        headers: { authorization: `Bearer ${expiredJwt}` },
      });

      const session = verifyAuth(req);
      expect(session).toBeNull();
    });
  });

  describe('4. Middleware Path Traversal & Public Route Matching', () => {
    test('Public route /api/health bypasses authentication', () => {
      const req = new NextRequest('http://localhost/api/health', {
        method: 'GET',
      });
      const res = middleware(req);
      expect(res.status).toBe(200);
    });

    test('Path traversal trick: /api/health/../convert should NOT bypass authentication', () => {
      const req = new NextRequest('http://localhost/api/health/../convert', {
        method: 'POST',
      });
      const res = middleware(req);
      // NextUrl normalizes pathname to /api/convert or middleware checks pathname
      expect(res.status).toBe(401);
    });

    test('Path traversal trick: /api/status/..%2fconvert should NOT bypass authentication', () => {
      const req = new NextRequest('http://localhost/api/status/..%2fconvert', {
        method: 'POST',
      });
      const res = middleware(req);
      expect(res.status).toBe(401);
    });
  });

  describe('5. Alternative Token Sources (Cookies, Query Params, x-api-key)', () => {
    test('x-api-key header authentication', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        headers: { 'x-api-key': 'usr_key_123' },
      });
      const session = verifyAuth(req);
      expect(session).not.toBeNull();
      expect(session?.userId).toBe('key_123');
    });

    test('URL query parameter authentication', () => {
      const req = new NextRequest('http://localhost/api/convert?token=user_query_user', {
        method: 'GET',
      });
      const session = verifyAuth(req);
      expect(session).not.toBeNull();
      expect(session?.userId).toBe('query_user');
    });
  });

});
