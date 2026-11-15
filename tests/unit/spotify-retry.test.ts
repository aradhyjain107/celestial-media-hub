import { expect, describe, test, vi, beforeEach } from 'vitest';
import { POST } from '../../src/app/api/spotify-convert/retry/route';
import { NextRequest } from 'next/server';
import * as authExt from '../../src/lib/security/auth';

describe('POST /api/spotify-convert/retry — Unit Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authExt.registerJobOwner('spotify-job-1', 'owner');
    authExt.registerJobOwner('spotify-job-2', 'other_user');
  });

  // ── 1. Authentication & Authorization (BOLA) ──────────────────────────────
  describe('1. Authentication & Authorization (BOLA)', () => {
    test('returns 401 Unauthorized when request lacks authorization', async () => {
      const req = new NextRequest('http://localhost:3000/api/spotify-convert/retry', {
        method: 'POST',
        body: JSON.stringify({ jobId: 'spotify-job-1', trackId: 'track_123' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    test('returns 403 Forbidden when user attempts to retry a track on another user’s job', async () => {
      const req = new NextRequest('http://localhost:3000/api/spotify-convert/retry', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user_attacker',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId: 'spotify-job-1', trackId: 'track_123' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Forbidden');
    });

    test('returns 403 Forbidden when jobId is provided but not found in job owner map', async () => {
      const req = new NextRequest('http://localhost:3000/api/spotify-convert/retry', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user_owner',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId: 'nonexistent-job', trackId: 'track_123' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Forbidden');
    });

    test('allows track retry when requested by the legitimate job owner', async () => {
      const req = new NextRequest('http://localhost:3000/api/spotify-convert/retry', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user_owner',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId: 'spotify-job-1', trackId: 'spotify_track_456' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.trackId).toBe('spotify_track_456');
    });

    test('allows track retry when requested by an admin user', async () => {
      const req = new NextRequest('http://localhost:3000/api/spotify-convert/retry', {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin_super',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId: 'spotify-job-2', trackId: 'spotify_track_789' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.trackId).toBe('spotify_track_789');
    });
  });

  // ── 2. Payload Handling & Fault Resilience ────────────────────────────────
  describe('2. Payload Resilience & Error Handling', () => {
    test('handles empty or malformed JSON payload without unhandled server crash', async () => {
      const req = {
        headers: new Headers({ authorization: 'Bearer user_owner' }),
        json: async () => {
          throw new SyntaxError('Unexpected token in JSON');
        },
      } as any as NextRequest;

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.trackId).toBeUndefined();
    });

    test('handles retry request without jobId (jobId optional/omitted)', async () => {
      const req = new NextRequest('http://localhost:3000/api/spotify-convert/retry', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user_owner',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trackId: 'track_no_job' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.trackId).toBe('track_no_job');
    });

    test('handles unexpected runtime errors by returning sanitized 500 status', async () => {
      const req = {
        headers: new Headers({ authorization: 'Bearer user_owner' }),
        json: () => {
          throw new Error('Fatal body reader error');
        },
      } as any as NextRequest;

      const res = await POST(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('An internal server error occurred. Please try again later.');
      expect(JSON.stringify(json)).not.toContain('Fatal body reader error');
    });
  });
});
