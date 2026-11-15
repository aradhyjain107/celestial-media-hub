import { describe, test, expect, vi, beforeEach } from 'vitest';
import { sanitizeFilename, sanitizeJobId } from '../../lib/temp';
import { SpotifyInputSchema } from '../../schemas/spotify';
import { getPlaylistInfo, executeYtdlp } from '../../lib/ytdlp';
import { GET as downloadGET } from '../../app/api/download/route';
import { POST as spotifyPOST } from '../../app/api/spotify-convert/route';
import { registerJobOwner } from '../../lib/auth';
import { NextRequest } from 'next/server';
import * as childProcess from 'node:child_process';

vi.mock('../../lib/env', () => ({
  env: { FFMPEG_PATH: '/mock/ffmpeg', YTDLP_PATH: '/mock/ytdlp', TEMP_DIR: '/tmp/celestial-test-temp', JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!' },
}));

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    spawn: mockSpawn,
    default: { ...actual.default, spawn: mockSpawn }
  };
});

describe('Milestone 2 Security Hardening Test Suite (R3 & R4 Protection)', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Path Traversal & Filename Sanitization (lib/temp.ts & /api/download)', () => {
    test('sanitizeFilename removes backslashes, path traversal, control characters', () => {
      expect(sanitizeFilename('..\\..\\etc\\passwd')).toBe('passwd');
      expect(sanitizeFilename('../../../secret.txt')).toBe('secret.txt');
      expect(sanitizeFilename('image\x00.png')).toBe('image.png');
      expect(sanitizeFilename('..')).toBe('file');
      expect(sanitizeFilename('')).toBe('file');
    });

    test('sanitizeJobId sanitizes job IDs and throws on invalid inputs', () => {
      expect(sanitizeJobId('job-123')).toBe('job-123');
      expect(sanitizeJobId('..\\..\\job-456')).toBe('job-456');
      expect(() => sanitizeJobId('')).toThrow('Invalid jobId');
      expect(() => sanitizeJobId('../..')).toThrow('Invalid jobId');
    });

    test('GET /api/download rejects path traversal attempts with HTTP 400/403', async () => {
      const jobId = 'test-job-traversal-1';
      registerJobOwner(jobId, 'user1');

      const attackReq1 = new NextRequest(`http://localhost/api/download?jobId=${jobId}&file=../etc/passwd`, {
        headers: { authorization: 'Bearer user_user1' }
      });
      const res1 = await downloadGET(attackReq1);
      expect(res1.status).toBe(400);

      const attackReq2 = new NextRequest(`http://localhost/api/download?jobId=..\\job1&file=test.mp4`, {
        headers: { authorization: 'Bearer user_user1' }
      });
      const res2 = await downloadGET(attackReq2);
      expect([400, 403]).toContain(res2.status);
    });
  });

  describe('2. SSRF Protection & Hostname Validation (Spotify API & Schema)', () => {
    test('SpotifyInputSchema rejects domain spoofing attempts', () => {
      expect(SpotifyInputSchema.safeParse({ playlistUrl: 'https://open.spotify.com/playlist/123' }).success).toBe(true);
      expect(SpotifyInputSchema.safeParse({ playlistUrl: 'https://spotify.com/playlist/123' }).success).toBe(true);

      // Domain spoofing attacks must be rejected
      expect(SpotifyInputSchema.safeParse({ playlistUrl: 'https://spotify.com.attacker.com/playlist/123' }).success).toBe(false);
      expect(SpotifyInputSchema.safeParse({ playlistUrl: 'http://attacker.com/spotify.com/playlist/123' }).success).toBe(false);
    });

    test('POST /api/spotify-convert extract rejects invalid hostnames with HTTP 400', async () => {
      const req = new NextRequest('http://localhost/api/spotify-convert?action=extract', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user_user1',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ url: 'https://spotify.com.evil.com/playlist/fake' })
      });

      const res = await spotifyPOST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid Spotify playlist URL');
    });
  });

  describe('3. CLI Option Injection & Argument Isolation (lib/ytdlp.ts)', () => {
    test('lib/ytdlp.ts appends -- option terminator before URL arguments', async () => {
      mockSpawn.mockImplementation(() => {
        const proc: any = new (require('events').EventEmitter)();
        proc.stdout = new (require('events').EventEmitter)();
        proc.stderr = new (require('events').EventEmitter)();
        setTimeout(() => proc.emit('close', 0), 5);
        return proc;
      });

      const optionPayload = '--config-location=http://attacker.com/evil.conf';
      executeYtdlp('/tmp', optionPayload, ['-x']);

      expect(mockSpawn).toHaveBeenCalledWith(
        '/mock/ytdlp',
        expect.arrayContaining(['-x', '--no-warnings', '--newline', '--progress', '--', optionPayload]),
        expect.any(Object)
      );
    });
  });

});
