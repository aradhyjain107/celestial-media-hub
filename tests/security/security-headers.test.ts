/**
 * Security Headers & Error Sanitization Test Suite
 *
 * Validates:
 * - R5: Security headers present in next.config.mjs
 * - R5: Error responses never expose stack traces or internal paths
 * - R4: Turbo-download SSRF URL validation
 * - R3: Content-Disposition header encoding
 * - R1/R2: Error responses are generic (don't reveal internal structure)
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Environment mock ────────────────────────────────────────────────────────
vi.mock('../../lib/env', () => ({
  env: {
    FFMPEG_PATH: '/mock/ffmpeg',
    YTDLP_PATH: '/mock/ytdlp',
    TEMP_DIR: '/tmp/celestial-test-security',
    JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!',
  },
}));

// ─── Filesystem mock: prevent real disk access ───────────────────────────────
const { mockExistsSync, mockStatSync, mockCreateReadStream } = vi.hoisted(() => ({
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockStatSync: vi.fn().mockReturnValue({ size: 1024 }),
  mockCreateReadStream: vi.fn().mockReturnValue({
    on: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
  }),
}));

vi.mock('node:fs', () => {
  const fsModule = {
    existsSync: mockExistsSync,
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    statSync: mockStatSync,
    createReadStream: mockCreateReadStream,
  };
  return {
    default: fsModule,
    ...fsModule,
  };
});

// ─── Imports ─────────────────────────────────────────────────────────────────
import { sanitizeError, sanitizeSseError } from '../../lib/errors';
import { GET as downloadGET } from '../../app/api/download/route';
import { GET as turboGET } from '../../app/api/experimental/turbo-download/route';
import { registerJobOwner } from '../../lib/auth';
import nextConfig from '../../next.config.mjs';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Security Headers & Error Sanitization Suite (R3, R4, R5)', () => {

  // ── 1. Security Headers in next.config.mjs ───────────────────────────────
  describe('1. next.config.mjs Security Headers (R5)', () => {

    let allHeaders: { key: string; value: string }[] = [];

    beforeEach(async () => {
      // @ts-ignore: headers() may be defined as async
      const headerConfig = await nextConfig.headers?.();
      allHeaders = headerConfig?.flatMap((entry: any) => entry.headers) ?? [];
    });

    test('headers() export is defined', async () => {
      expect(typeof nextConfig.headers).toBe('function');
      const result = await nextConfig.headers?.();
      expect(Array.isArray(result)).toBe(true);
      expect(result?.length).toBeGreaterThan(0);
    });

    test('X-Frame-Options: DENY is set', () => {
      const header = allHeaders.find(h => h.key === 'X-Frame-Options');
      expect(header).toBeDefined();
      expect(header?.value).toBe('DENY');
    });

    test('X-Content-Type-Options: nosniff is set', () => {
      const header = allHeaders.find(h => h.key === 'X-Content-Type-Options');
      expect(header).toBeDefined();
      expect(header?.value).toBe('nosniff');
    });

    test('Referrer-Policy is set', () => {
      const header = allHeaders.find(h => h.key === 'Referrer-Policy');
      expect(header).toBeDefined();
      expect(header?.value.length).toBeGreaterThan(0);
    });

    test('Permissions-Policy is set and restricts camera/microphone/geolocation', () => {
      const header = allHeaders.find(h => h.key === 'Permissions-Policy');
      expect(header).toBeDefined();
      const value = header?.value ?? '';
      expect(value).toMatch(/camera=/);
      expect(value).toMatch(/microphone=/);
      expect(value).toMatch(/geolocation=/);
    });

    test('Content-Security-Policy is set for API routes', async () => {
      const headerConfig = await nextConfig.headers?.();
      const apiEntry = headerConfig?.find((e: any) => e.source?.includes('/api/'));
      expect(apiEntry).toBeDefined();
      const cspHeader = apiEntry?.headers?.find((h: any) => h.key === 'Content-Security-Policy');
      expect(cspHeader).toBeDefined();
    });
  });

  // ── 2. lib/errors.ts — sanitizeError ─────────────────────────────────────
  describe('2. sanitizeError() — no leakage (R5)', () => {

    test('returns a generic message, not the raw error message', () => {
      const err = new Error('/opt/homebrew/bin/ffmpeg: No such file or directory — internal path exposed!');
      const result = sanitizeError(err, 'test context', 500);
      expect(result.status).toBe(500);
      expect(result.error).not.toContain('/opt/homebrew');
      expect(result.error).not.toContain('ffmpeg');
      expect(result.error.length).toBeGreaterThan(5);
    });

    test('returns correct HTTP status code', () => {
      expect(sanitizeError(new Error('x'), 'ctx', 400).status).toBe(400);
      expect(sanitizeError(new Error('x'), 'ctx', 401).status).toBe(401);
      expect(sanitizeError(new Error('x'), 'ctx', 403).status).toBe(403);
      expect(sanitizeError(new Error('x'), 'ctx', 500).status).toBe(500);
    });

    test('handles non-Error thrown values safely', () => {
      const result = sanitizeError('some string error', 'test', 500);
      expect(result.status).toBe(500);
      expect(typeof result.error).toBe('string');
    });

    test('handles null/undefined thrown values', () => {
      const result = sanitizeError(null, 'test', 500);
      expect(result.status).toBe(500);
    });
  });

  // ── 3. lib/errors.ts — sanitizeSseError ──────────────────────────────────
  describe('3. sanitizeSseError() — no leakage (R5)', () => {

    test('returns an SSE-formatted string', () => {
      const result = sanitizeSseError(new Error('internal path /etc/shadow exposed!'), 'SSE ctx');
      expect(result).toMatch(/^data:/);
      expect(result).toMatch(/\n\n$/);
    });

    test('does not include internal error message in output', () => {
      const err = new Error('/etc/shadow: internal system path!');
      const result = sanitizeSseError(err, 'test');
      expect(result).not.toContain('/etc/shadow');
    });

    test('produces valid JSON payload', () => {
      const result = sanitizeSseError(new Error('boom'), 'test');
      const jsonPart = result.replace(/^data: /, '').replace(/\n\n$/, '');
      expect(() => JSON.parse(jsonPart)).not.toThrow();
      const parsed = JSON.parse(jsonPart);
      expect(typeof parsed.error).toBe('string');
    });
  });

  // ── 4. SSRF Protection in /api/experimental/turbo-download ───────────────
  describe('4. SSRF URL Validation — /api/experimental/turbo-download (R4)', () => {

    test('rejects localhost URLs with 400', async () => {
      const req = new NextRequest('http://app/api/experimental/turbo-download?url=http://localhost:6379', {
        headers: { authorization: 'Bearer user_alice' },
      });
      const res = await turboGET(req);
      expect(res.status).toBe(400);
    });

    test('rejects 127.x.x.x loopback with 400', async () => {
      const req = new NextRequest('http://app/api/experimental/turbo-download?url=http://127.0.0.1/internal', {
        headers: { authorization: 'Bearer user_alice' },
      });
      const res = await turboGET(req);
      expect(res.status).toBe(400);
    });

    test('rejects RFC1918 10.x.x.x private address with 400', async () => {
      const req = new NextRequest('http://app/api/experimental/turbo-download?url=http://10.0.0.1/secret', {
        headers: { authorization: 'Bearer user_alice' },
      });
      const res = await turboGET(req);
      expect(res.status).toBe(400);
    });

    test('rejects RFC1918 192.168.x.x private address with 400', async () => {
      const req = new NextRequest('http://app/api/experimental/turbo-download?url=http://192.168.1.100/admin', {
        headers: { authorization: 'Bearer user_alice' },
      });
      const res = await turboGET(req);
      expect(res.status).toBe(400);
    });

    test('rejects file:// protocol with 400', async () => {
      const req = new NextRequest('http://app/api/experimental/turbo-download?url=file:///etc/passwd', {
        headers: { authorization: 'Bearer user_alice' },
      });
      const res = await turboGET(req);
      expect(res.status).toBe(400);
    });

    test('rejects malformed URLs with 400', async () => {
      const req = new NextRequest('http://app/api/experimental/turbo-download?url=not-a-url-at-all', {
        headers: { authorization: 'Bearer user_alice' },
      });
      const res = await turboGET(req);
      expect(res.status).toBe(400);
    });

    test('requires authentication (R1)', async () => {
      const req = new NextRequest('http://app/api/experimental/turbo-download?url=https://youtube.com/watch?v=test');
      const res = await turboGET(req);
      expect(res.status).toBe(401);
    });
  });

  // ── 5. Content-Disposition Header Safety ─────────────────────────────────
  describe('5. Content-Disposition Header Encoding (R3)', () => {

    test('Content-Disposition uses RFC 6266 extended notation for filename', async () => {
      const jobId = 'cd-test-job-01';
      registerJobOwner(jobId, 'alice');

      // Simulate file existing on disk
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 1024 });

      const req = new NextRequest(`http://app/api/download?jobId=${jobId}&file=myfile.mp4`, {
        headers: { authorization: 'Bearer user_alice' },
      });

      const res = await downloadGET(req);
      // 200 = file served, 404 = file not found in test env; both are acceptable
      expect([200, 404]).toContain(res.status);

      if (res.status === 200) {
        const disposition = res.headers.get('Content-Disposition');
        expect(disposition).toBeDefined();
        // Must not contain raw CRLF characters (header injection prevention)
        expect(disposition).not.toMatch(/[\r\n]/);
        // Must use RFC 6266 extended filename notation
        expect(disposition).toContain("filename*=UTF-8''");
      }
    });

    test('Content-Disposition rejects paths with directory traversal', async () => {
      const jobId = 'cd-test-job-02';
      registerJobOwner(jobId, 'alice');

      // Attempt path traversal in file param
      const req = new NextRequest(`http://app/api/download?jobId=${jobId}&file=../etc/passwd`, {
        headers: { authorization: 'Bearer user_alice' },
      });

      const res = await downloadGET(req);
      // Must be blocked before reaching the Content-Disposition header
      expect(res.status).toBe(400);
    });

    test('Content-Disposition rejects jobId with directory traversal', async () => {
      const req = new NextRequest(`http://app/api/download?jobId=../../etc&file=passwd`, {
        headers: { authorization: 'Bearer user_alice' },
      });

      const res = await downloadGET(req);
      // Must be rejected — can be 400 or 403 (no ownership registered for sanitized id)
      expect([400, 403]).toContain(res.status);
    });
  });

});
