import { expect, describe, test, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '../../src/app/api/download/route';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../src/lib/system/env';
import * as authExt from '../../src/lib/security/auth';
import * as tempExt from '../../src/lib/system/temp';
import EventEmitter from 'node:events';

vi.mock('../../src/lib/system/temp', () => ({
  cleanupJobDir: vi.fn(),
  createJobDir: vi.fn(),
  sanitizeJobId: vi.fn((id: string) => id),
  sanitizeFilename: vi.fn((f: string) => f),
}));

describe('GET /api/download — Unit Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // 'user_owner' dev token parses to userId: 'owner'
    authExt.registerJobOwner('valid-job-123', 'owner');
    authExt.registerJobOwner('admin-job-999', 'other_user');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. Authentication & Authorization (BOLA) ──────────────────────────────
  describe('1. Authentication & BOLA (Broken Object Level Authorization)', () => {
    test('returns 401 Unauthorized when request lacks authorization', async () => {
      const req = new NextRequest('http://localhost:3000/api/download?jobId=valid-job-123&file=output.mp4');
      const res = await GET(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    test('returns 400 Bad Request when jobId or file query param is missing', async () => {
      const req1 = new NextRequest('http://localhost:3000/api/download?file=output.mp4', {
        headers: { authorization: 'Bearer user_owner' },
      });
      const res1 = await GET(req1);
      expect(res1.status).toBe(400);

      const req2 = new NextRequest('http://localhost:3000/api/download?jobId=valid-job-123', {
        headers: { authorization: 'Bearer user_owner' },
      });
      const res2 = await GET(req2);
      expect(res2.status).toBe(400);
    });

    test('returns 403 Forbidden when user attempts to download another user’s job (BOLA violation)', async () => {
      // jobId 'valid-job-123' belongs to 'owner', requester is 'attacker' (user_attacker -> 'attacker')
      const req = new NextRequest('http://localhost:3000/api/download?jobId=valid-job-123&file=output.mp4', {
        headers: { authorization: 'Bearer user_attacker' },
      });

      const res = await GET(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Forbidden');
      expect(json.message).toContain('permission');
    });

    test('allows download when requested by the legitimate job owner', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 2048 } as any);

      const fakeReadStream = new EventEmitter() as any;
      fakeReadStream.destroy = vi.fn();
      vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeReadStream);

      const req = new NextRequest('http://localhost:3000/api/download?jobId=valid-job-123&file=output.mp4', {
        headers: { authorization: 'Bearer user_owner' },
      });

      const res = await GET(req);
      expect(res.status).toBe(200);
    });

    test('allows download when requested by an admin user regardless of owner', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 } as any);

      const fakeReadStream = new EventEmitter() as any;
      fakeReadStream.destroy = vi.fn();
      vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeReadStream);

      const req = new NextRequest('http://localhost:3000/api/download?jobId=admin-job-999&file=output.mp4', {
        headers: { authorization: 'Bearer admin_super' },
      });

      const res = await GET(req);
      expect(res.status).toBe(200);
    });
  });

  // ── 2. Path Traversal & Security Validation ───────────────────────────────
  describe('2. Path Traversal & Injection Guards', () => {
    test('rejects relative path traversal in filename (e.g. ../../etc/passwd)', async () => {
      const req = new NextRequest('http://localhost:3000/api/download?jobId=valid-job-123&file=../../etc/passwd', {
        headers: { authorization: 'Bearer user_owner' },
      });

      const res = await GET(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid filename or jobId');
    });

    test('rejects backslash traversal in filename on Windows / Unix', async () => {
      const req = new NextRequest('http://localhost:3000/api/download?jobId=valid-job-123&file=..\\..\\secret.txt', {
        headers: { authorization: 'Bearer user_owner' },
      });

      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    test('rejects path traversal in jobId parameter for authenticated admin or user', async () => {
      const req = new NextRequest('http://localhost:3000/api/download?jobId=../etc&file=output.mp4', {
        headers: { authorization: 'Bearer admin_super' },
      });

      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    test('returns 404 Not Found when file does not exist on filesystem', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const req = new NextRequest('http://localhost:3000/api/download?jobId=valid-job-123&file=nonexistent.mp4', {
        headers: { authorization: 'Bearer user_owner' },
      });

      const res = await GET(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain('File not found');
    });
  });

  // ── 3. Headers & RFC 6266 Content-Disposition ─────────────────────────────
  describe('3. Header Propagation & RFC 6266 Compliance', () => {
    test('sets correct Content-Type, Content-Length, and RFC 6266 Content-Disposition header with percent-encoding', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 5242880 } as any); // 5 MB

      const fakeReadStream = new EventEmitter() as any;
      fakeReadStream.destroy = vi.fn();
      vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeReadStream);

      const filename = 'special file [2026] & final.mp4';
      const req = new NextRequest(`http://localhost:3000/api/download?jobId=valid-job-123&file=${encodeURIComponent(filename)}`, {
        headers: { authorization: 'Bearer user_owner' },
      });

      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
      expect(res.headers.get('Content-Length')).toBe('5242880');

      const disposition = res.headers.get('Content-Disposition');
      expect(disposition).toBeDefined();
      expect(disposition).toContain('attachment;');
      expect(disposition).toContain('filename="special file [2026] & final.mp4"');
      expect(disposition).toContain("filename*=UTF-8''special%20file%20%5B2026%5D%20%26%20final.mp4");
    });
  });

  // ── 4. Streaming Lifecycle & Post-Download Cleanup ────────────────────────
  describe('4. Stream Lifecycle & Cleanup Sweeper Verification', () => {
    test('pipes file stream to response and cleans up job directory after stream finishes', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 100 } as any);

      const fakeReadStream = new EventEmitter() as any;
      fakeReadStream.destroy = vi.fn();
      vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeReadStream);

      const req = new NextRequest('http://localhost:3000/api/download?jobId=valid-job-123&file=output.zip', {
        headers: { authorization: 'Bearer user_owner' },
      });

      const res = await GET(req);
      expect(res.status).toBe(200);

      const reader = res.body!.getReader();

      // Emit chunk and end from fs.createReadStream
      fakeReadStream.emit('data', Buffer.from('mock zip data'));
      fakeReadStream.emit('end');

      const chunk = await reader.read();
      expect(chunk.value).toEqual(new Uint8Array(Buffer.from('mock zip data')));

      const done = await reader.read();
      expect(done.done).toBe(true);

      // Fast-forward 1000ms timer for cleanup
      vi.advanceTimersByTime(1000);
      expect(tempExt.cleanupJobDir).toHaveBeenCalledWith('valid-job-123');
    });

    test('cleans up job directory when stream encounters an error', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 100 } as any);

      const fakeReadStream = new EventEmitter() as any;
      fakeReadStream.destroy = vi.fn();
      vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeReadStream);

      const req = new NextRequest('http://localhost:3000/api/download?jobId=valid-job-123&file=error.mp4', {
        headers: { authorization: 'Bearer user_owner' },
      });

      const res = await GET(req);
      const reader = res.body!.getReader();

      fakeReadStream.emit('error', new Error('Disk read fault'));

      await expect(reader.read()).rejects.toThrow('Disk read fault');

      vi.advanceTimersByTime(1000);
      expect(tempExt.cleanupJobDir).toHaveBeenCalledWith('valid-job-123');
    });

    test('destroys fs readStream and cleans up when client cancels/aborts stream', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1000 } as any);

      const fakeReadStream = new EventEmitter() as any;
      fakeReadStream.destroy = vi.fn();
      vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeReadStream);

      const req = new NextRequest('http://localhost:3000/api/download?jobId=valid-job-123&file=aborted.mp4', {
        headers: { authorization: 'Bearer user_owner' },
      });

      const res = await GET(req);
      const reader = res.body!.getReader();

      await reader.cancel('User canceled');
      expect(fakeReadStream.destroy).toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(tempExt.cleanupJobDir).toHaveBeenCalledWith('valid-job-123');
    });
  });
});
