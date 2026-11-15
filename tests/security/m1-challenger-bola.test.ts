import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/env', () => ({
  env: { FFMPEG_PATH: '/mock/ffmpeg', YTDLP_PATH: '/mock/ytdlp', TEMP_DIR: '/mock/tmp', JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!' },
}));

import { NextRequest } from 'next/server';
import { verifyAuth, registerJobOwner, unregisterJobOwner, verifyJobOwnership, cleanExpiredJobOwners } from '../../src/lib/auth';
import { middleware } from '../../src/middleware';
import { GET as downloadGET } from '../../src/app/api/download/route';
import { GET as spotifyGET, POST as spotifyPOST } from '../../src/app/api/spotify-convert/route';
import { POST as spotifyRetryPOST } from '../../src/app/api/spotify-convert/retry/route';

describe('Milestone 1 Challenger 2: BOLA / IDOR & Job Ownership Stress Test Suite', () => {

  describe('1. Cross-User Access Attempts (BOLA / IDOR)', () => {
    test('User B cannot download job owned by User A via GET /api/download', async () => {
      const jobId = 'job-alice-download-101';
      registerJobOwner(jobId, 'alice');

      const req = new NextRequest(`http://localhost/api/download?jobId=${jobId}&file=video.mp4`, {
        method: 'GET',
        headers: { authorization: 'Bearer user_bob' },
      });

      const res = await downloadGET(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
    });

    test('User B cannot connect to Spotify conversion SSE stream owned by User A via GET /api/spotify-convert', async () => {
      const jobId = 'job-alice-spotify-102';
      registerJobOwner(jobId, 'alice');

      const req = new NextRequest(`http://localhost/api/spotify-convert?jobId=${jobId}`, {
        method: 'GET',
        headers: { authorization: 'Bearer user_bob' },
      });

      const res = await spotifyGET(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
    });

    test('User B cannot trigger retry on job owned by User A via POST /api/spotify-convert/retry', async () => {
      const jobId = 'job-alice-spotify-retry-103';
      registerJobOwner(jobId, 'alice');

      const req = new NextRequest('http://localhost/api/spotify-convert/retry', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user_bob',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jobId, trackId: 't-1' }),
      });

      const res = await spotifyRetryPOST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
    });
  });

  describe('2. Unregistered Job IDs Access Attempts', () => {
    test('Unregistered job ID returns 403 Forbidden on GET /api/download', async () => {
      const req = new NextRequest('http://localhost/api/download?jobId=ghost-job-999&file=file.mp3', {
        method: 'GET',
        headers: { authorization: 'Bearer user_bob' },
      });

      const res = await downloadGET(req);
      expect(res.status).toBe(403);
    });

    test('Unregistered job ID returns 403 Forbidden on GET /api/spotify-convert', async () => {
      const req = new NextRequest('http://localhost/api/spotify-convert?jobId=ghost-job-999', {
        method: 'GET',
        headers: { authorization: 'Bearer user_bob' },
      });

      const res = await spotifyGET(req);
      expect(res.status).toBe(403);
    });

    test('Unregistered job ID returns 403 Forbidden on POST /api/spotify-convert/retry', async () => {
      const req = new NextRequest('http://localhost/api/spotify-convert/retry', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user_bob',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jobId: 'ghost-job-999', trackId: 't-1' }),
      });

      const res = await spotifyRetryPOST(req);
      expect(res.status).toBe(403);
    });
  });

  describe('3. Job Owner Cleanup & Lifetime Management', () => {
    test('unregisterJobOwner removes job entry so subsequent access is denied', () => {
      const jobId = 'job-to-unregister-201';
      registerJobOwner(jobId, 'charlie');

      expect(verifyJobOwnership(jobId, { userId: 'charlie', role: 'user', token: 'user_charlie', iat: 123 })).toBe(true);

      unregisterJobOwner(jobId);

      expect(verifyJobOwnership(jobId, { userId: 'charlie', role: 'user', token: 'user_charlie', iat: 123 })).toBe(false);
    });

    test('cleanExpiredJobOwners purges entries older than maxAgeMs', async () => {
      const oldJobId = 'job-old-301';
      const freshJobId = 'job-fresh-302';

      registerJobOwner(oldJobId, 'david');
      
      // Fast forward time for testing
      const realNow = Date.now;
      Date.now = () => realNow() + 7200000; // +2 hours

      registerJobOwner(freshJobId, 'david');

      // Clean jobs older than 1 hour (3600000 ms)
      cleanExpiredJobOwners(3600000);

      Date.now = realNow;

      expect(verifyJobOwnership(oldJobId, { userId: 'david', role: 'user', token: 'user_david', iat: 123 })).toBe(false);
      expect(verifyJobOwnership(freshJobId, { userId: 'david', role: 'user', token: 'user_david', iat: 123 })).toBe(true);
    });
  });

  describe('4. Role-Based Admin Overrides & BOLA Bypass Vulnerability Stress-Tests', () => {
    test('Legitimate Admin token bypasses BOLA checks for job owned by User A', async () => {
      const jobId = 'job-alice-admin-override-401';
      registerJobOwner(jobId, 'alice');

      const adminReq = new NextRequest(`http://localhost/api/download?jobId=${jobId}&file=output.mp3`, {
        method: 'GET',
        headers: { authorization: 'Bearer admin-root' },
      });

      const res = await downloadGET(adminReq);
      // Status should be 404 (file not on disk) rather than 403 Forbidden
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    });

    test('[SECURITY VULNERABILITY TEST] Attacker sending x-user-role: admin header spoofing role escalation', async () => {
      const jobId = 'job-alice-secret-501';
      registerJobOwner(jobId, 'alice');

      // Attacker Bob sends his own user token 'user_bob', but injects header 'x-user-role: admin'
      const attackerReq = new NextRequest(`http://localhost/api/download?jobId=${jobId}&file=secret.mp4`, {
        method: 'GET',
        headers: {
          authorization: 'Bearer user_bob',
          'x-user-role': 'admin',
        },
      });

      // Pass request through middleware (simulating real request pipeline)
      const middlewareRes = middleware(attackerReq);
      expect(middlewareRes.status).toBe(200);

      // Downstream endpoint execution
      const routeRes = await downloadGET(attackerReq);

      // EXPECTATION: An unprivileged user SHOULD NOT be able to access Alice's job by sending x-user-role: admin.
      // If routeRes is NOT 403 Forbidden, BOLA security is BROKEN due to unauthenticated header trust!
      expect(routeRes.status).toBe(403);
    });

    test('[SECURITY VULNERABILITY TEST] Attacker using user token containing "admin" substring (e.g. user_admin_99)', async () => {
      const jobId = 'job-alice-secret-502';
      registerJobOwner(jobId, 'alice');

      // Attacker Bob uses a user token like 'user_admin_bob'
      const attackerReq = new NextRequest(`http://localhost/api/download?jobId=${jobId}&file=secret.mp4`, {
        method: 'GET',
        headers: {
          authorization: 'Bearer user_admin_bob',
        },
      });

      const routeRes = await downloadGET(attackerReq);

      // EXPECTATION: 'user_admin_bob' is a normal user token (starts with user_), so it should NOT be granted admin role.
      // Accessing Alice's job should be DENIED with 403 Forbidden.
      expect(routeRes.status).toBe(403);
    });
  });

});
