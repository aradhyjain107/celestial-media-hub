import { describe, test, expect, vi } from 'vitest';

vi.mock('../../lib/env', () => ({
  env: { FFMPEG_PATH: '/mock/ffmpeg', YTDLP_PATH: '/mock/ytdlp', TEMP_DIR: '/mock/tmp', JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!' },
}));

import { NextRequest } from 'next/server';
import { verifyAuth, registerJobOwner, verifyJobOwnership, AuthSession } from '../../lib/auth';
import { middleware } from '../../middleware';
import { GET as downloadGET } from '../../app/api/download/route';
import { GET as spotifyGET } from '../../app/api/spotify-convert/route';
import { POST as convertPOST } from '../../app/api/convert/route';
import { POST as audioTrimPOST } from '../../app/api/audio-trim/route';
import { POST as youtubePOST } from '../../app/api/youtube/route';
import { GET as turboGET } from '../../app/api/experimental/turbo-download/route';

describe('Milestone 1 Security Audit Test Suite: Authentication & BOLA Prevention', () => {

  describe('1. lib/auth.ts Token Parsing & Job Registry Unit Tests', () => {
    test('parses standard user Bearer token correctly', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        headers: { authorization: 'Bearer user_alice' },
      });
      const session = verifyAuth(req);
      expect(session).not.toBeNull();
      expect(session?.userId).toBe('alice');
      expect(session?.role).toBe('user');
    });

    test('parses admin Bearer token correctly', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        headers: { authorization: 'Bearer admin-root' },
      });
      const session = verifyAuth(req);
      expect(session).not.toBeNull();
      expect(session?.role).toBe('admin');
    });

    test('parses x-api-key header correctly', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        headers: { 'x-api-key': 'usr_charlie_key' },
      });
      const session = verifyAuth(req);
      expect(session).not.toBeNull();
      expect(session?.userId).toBe('charlie_key');
    });

    test('rejects unauthenticated requests with identity headers and no token', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        headers: { 'x-user-id': 'dev_user_123', 'x-user-role': 'admin' },
      });
      const session = verifyAuth(req);
      expect(session).toBeNull();
    });

    test('returns null for unauthenticated NextRequest with empty headers', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        headers: new Headers(),
      });
      const session = verifyAuth(req);
      expect(session).toBeNull();
    });

    test('enforces object ownership in job registry correctly', () => {
      const jobId = 'job-security-101';
      const aliceSession: AuthSession = {
        userId: 'alice',
        role: 'user',
        token: 'user_alice',
        iat: Date.now(),
      };
      const bobSession: AuthSession = {
        userId: 'bob',
        role: 'user',
        token: 'user_bob',
        iat: Date.now(),
      };
      const adminSession: AuthSession = {
        userId: 'admin1',
        role: 'admin',
        token: 'admin-key',
        iat: Date.now(),
      };

      registerJobOwner(jobId, 'alice');

      expect(verifyJobOwnership(jobId, aliceSession)).toBe(true);
      expect(verifyJobOwnership(jobId, bobSession)).toBe(false);
      expect(verifyJobOwnership(jobId, adminSession)).toBe(true); // Admin bypass
      expect(verifyJobOwnership('non-existent-job', aliceSession)).toBe(false);
    });
  });

  describe('2. middleware.ts Global API Authentication Tests', () => {
    test('returns 401 Unauthorized for unauthenticated API requests', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: new Headers(),
      });
      const res = middleware(req);
      expect(res.status).toBe(401);
    });

    test('injects x-user-id and x-user-role headers for authenticated requests', () => {
      const req = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: { authorization: 'Bearer user_david' },
      });
      const res = middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-user-id')).toBe('david');
      expect(res.headers.get('x-user-role')).toBe('user');
    });
  });

  describe('3. Route Handlers Unauthenticated Rejection (R1)', () => {
    test('POST /api/convert returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: new Headers(),
      });
      const res = await convertPOST(req);
      expect(res.status).toBe(401);
    });

    test('POST /api/audio-trim returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost/api/audio-trim', {
        method: 'POST',
        headers: new Headers(),
      });
      const res = await audioTrimPOST(req);
      expect(res.status).toBe(401);
    });

    test('GET /api/download returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost/api/download?jobId=j1&file=out.mp3', {
        method: 'GET',
        headers: new Headers(),
      });
      const res = await downloadGET(req);
      expect(res.status).toBe(401);
    });

    test('POST /api/youtube returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost/api/youtube', {
        method: 'POST',
        headers: new Headers(),
      });
      const res = await youtubePOST(req);
      expect(res.status).toBe(401);
    });

    test('GET /api/experimental/turbo-download returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost/api/experimental/turbo-download?url=http://example.com', {
        method: 'GET',
        headers: new Headers(),
      });
      const res = await turboGET(req);
      expect(res.status).toBe(401);
    });
  });

  describe('4. BOLA Ownership Enforcement on Resources (R2)', () => {
    test('GET /api/download returns 403 Forbidden when requesting user does not own job', async () => {
      const jobId = 'job-bola-download-test';
      registerJobOwner(jobId, 'alice');

      // Bob tries to access Alice's job file
      const bobReq = new NextRequest(`http://localhost/api/download?jobId=${jobId}&file=secret.mp4`, {
        method: 'GET',
        headers: { authorization: 'Bearer user_bob' },
      });

      const res = await downloadGET(bobReq);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Forbidden');
    });

    test('GET /api/spotify-convert returns 403 Forbidden when requesting user does not own job', async () => {
      const jobId = 'job-bola-spotify-test';
      registerJobOwner(jobId, 'alice');

      // Bob tries to connect to Alice's Spotify SSE stream
      const bobReq = new NextRequest(`http://localhost/api/spotify-convert?jobId=${jobId}`, {
        method: 'GET',
        headers: { authorization: 'Bearer user_bob' },
      });

      const res = await spotifyGET(bobReq);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Forbidden');
    });

    test('GET /api/download grants access to job owner', async () => {
      const jobId = 'job-owner-download-test';
      registerJobOwner(jobId, 'alice');

      // Alice accesses her job file (will return 404 because file doesn't exist on disk, not 403 Forbidden)
      const aliceReq = new NextRequest(`http://localhost/api/download?jobId=${jobId}&file=output.mp3`, {
        method: 'GET',
        headers: { authorization: 'Bearer user_alice' },
      });

      const res = await downloadGET(aliceReq);
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    });
  });

});
