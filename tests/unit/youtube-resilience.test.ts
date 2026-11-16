import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import cp from 'node:child_process';
import { NextRequest } from 'next/server';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { middleware } from '../../src/middleware';
import { resolveSafeSseMessage, sanitizeSseError } from '../../src/lib/security/errors';
import { authenticatedFetch, clearStoredSessionToken } from '../../src/lib/security/clientAuth';
import { getVideoInfo, executeYtdlp } from '../../src/lib/media/ytdlp';
import { env } from '../../src/lib/system/env';

describe('YouTube & Session Resilience Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearStoredSessionToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('1. Proxy-aware CORS origin in middleware.ts', () => {
    test('uses x-forwarded-host and x-forwarded-proto instead of internal 0.0.0.0:10000 binding', () => {
      const req = new NextRequest('https://0.0.0.0:10000/api/youtube', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user_render_test',
          'x-forwarded-host': 'celestial-media-hub.onrender.com',
          'x-forwarded-proto': 'https',
        },
      });

      const res = middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(
        'https://celestial-media-hub.onrender.com'
      );
    });
  });

  describe('2. clientAuth authenticatedFetch 401 self-healing', () => {
    test('refreshes stale JWT via /api/auth/session and retries once on 401', async () => {
      const staleJwt = 'hdr.stale.sig';
      const freshJwt = 'hdr.fresh.sig';

      vi.stubEnv('NODE_ENV', 'production');
      window.sessionStorage.setItem('celestial_session_jwt', staleJwt);

      const fetchMock = vi.fn()
        // 1st API call with stale cached token -> 401
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
        )
        // Auto refresh GET /api/auth/session -> 200 fresh JWT
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ token: freshJwt, userId: 'anon_2' }), { status: 200 })
        )
        // Retry original call with fresh token -> 200 OK
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), { status: 200 })
        );

      vi.stubGlobal('fetch', fetchMock);
      delete (window as any).__nativeFetch;

      try {
        const res = await authenticatedFetch('/api/youtube', { method: 'POST' });
        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(3);

        const firstAuth = (fetchMock.mock.calls[0]?.[1]?.headers as Headers).get('Authorization');
        const retryAuth = (fetchMock.mock.calls[2]?.[1]?.headers as Headers).get('Authorization');
        expect(firstAuth).toBe(`Bearer ${staleJwt}`);
        expect(retryAuth).toBe(`Bearer ${freshJwt}`);
        expect(window.sessionStorage.getItem('celestial_session_jwt')).toBe(freshJwt);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe('3. yt-dlp info oEmbed fallback & retry on bot-check', () => {
    test('getVideoInfo falls back to YouTube oEmbed when yt-dlp fails on cloud IP', async () => {
      vi.spyOn(cp, 'spawn').mockImplementation(() => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();
        queueMicrotask(() => {
          proc.stderr.emit('data', Buffer.from("ERROR: [youtube] cWheLYR8moU: Sign in to confirm you're not a bot."));
          proc.emit('close', 1);
        });
        return proc;
      });

      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            title: 'The Ones with the Whole Gang from Season 8 | Friends',
            thumbnail_url: 'https://i.ytimg.com/vi/cWheLYR8moU/hqdefault.jpg',
          }),
          { status: 200 }
        )
      );
      vi.stubGlobal('fetch', fetchSpy);

      const info = await getVideoInfo('https://www.youtube.com/watch?v=cWheLYR8moU');
      expect(info.title).toContain('Friends');
      expect(info.thumbnail).toBe('https://i.ytimg.com/vi/cWheLYR8moU/hqdefault.jpg');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('https://www.youtube.com/oembed?url='),
        expect.any(Object)
      );
    });

    test('executeYtdlp retries with alternate player clients on bot verification error and surfaces safe SSE code', async () => {
      const spawnCalls: string[][] = [];
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

      vi.spyOn(cp, 'spawn').mockImplementation((_cmd, args) => {
        spawnCalls.push([...(args as string[])]);
        const proc = new EventEmitter() as any;
        proc.stdin = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();
        queueMicrotask(() => {
          proc.stderr.emit('data', Buffer.from("ERROR: [youtube] Sign in to confirm you're not a bot."));
          proc.emit('close', 1);
          proc.emit('exit', 1);
        });
        return proc;
      });

      const stream = executeYtdlp('/tmp/job-test', 'https://www.youtube.com/watch?v=cWheLYR8moU', [
        '-P',
        '/tmp/job-test',
        '-x',
      ]);
      const reader = stream.getReader();
      let chunks = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks += new TextDecoder().decode(value);
      }

      expect(spawnCalls).toHaveLength(2);
      expect(spawnCalls[0]).toContain('--ffmpeg-location');
      expect(spawnCalls[0]).toContain(env.FFMPEG_PATH);
      expect(path.isAbsolute(env.FFMPEG_PATH)).toBe(true);
      expect(spawnCalls[1]).toContain('--extractor-args');
      expect(chunks).toContain('[SAFE:YOUTUBE_BOT_CHECK]');

      const sseOut = sanitizeSseError(new Error(chunks), 'SSE /api/youtube');
      expect(sseOut).toContain('YouTube blocked automated download from this shared cloud IP');
      expect(resolveSafeSseMessage(new Error('/secret/path/leak'))).toBeUndefined();
    });

    test('executeYtdlp classifies SIGKILL (512 MB OOM) cleanly without wasting time retrying', async () => {
      const spawnCalls: string[][] = [];
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

      vi.spyOn(cp, 'spawn').mockImplementation((_cmd, args) => {
        spawnCalls.push([...(args as string[])]);
        const proc = new EventEmitter() as any;
        proc.stdin = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();
        queueMicrotask(() => {
          proc.emit('close', null, 'SIGKILL');
          proc.emit('exit', null, 'SIGKILL');
        });
        return proc;
      });

      const stream = executeYtdlp('/tmp/job-oom', 'https://www.youtube.com/watch?v=jNQXAC9IVRw', [
        '-P',
        '/tmp/job-oom',
      ]);
      const reader = stream.getReader();
      let chunks = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks += new TextDecoder().decode(value);
      }

      expect(spawnCalls).toHaveLength(1);
      expect(chunks).toContain('[SAFE:MEMORY_LIMIT_EXCEEDED]');
      const sseOut = sanitizeSseError(new Error(chunks), 'SSE /api/youtube');
      expect(sseOut).toContain('512 MB memory limit');
    });
  });
});
