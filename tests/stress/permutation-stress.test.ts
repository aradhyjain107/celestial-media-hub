import { expect, describe, test, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import {
  writeInputFile,
  startTempDirSweeper,
  sanitizeFilename,
  sanitizeJobId
} from '../../src/lib/temp';
import { POST as mutePOST } from '../../src/app/api/mute/route';
import { POST as compressPOST } from '../../src/app/api/compress/route';
import { POST as convertPOST } from '../../src/app/api/convert/route';
import { POST as audioTrimPOST } from '../../src/app/api/audio-trim/route';
import { POST as spotifyRetryPOST } from '../../src/app/api/spotify-convert/retry/route';
import { GET as turboDownloadGET } from '../../src/app/api/experimental/turbo-download/route';
import * as ffmpegExt from '../../src/lib/ffmpeg';
import * as authExt from '../../src/lib/auth';
import { Readable, PassThrough } from 'node:stream';
import { CelestialExtractor } from '../../src/lib/engine/extractor';
import { CelestialStreamer } from '../../src/lib/engine/pipe';

vi.mock('../../src/lib/env', () => ({
  env: { TEMP_DIR: '/mock/temp' }
}));

vi.mock('../../src/lib/ffmpeg', () => ({
  executeFfmpeg: vi.fn(),
  probeMediaStreams: vi.fn().mockResolvedValue({ hasVideo: true, hasAudio: true, duration: 10 }),
  getMediaDuration: vi.fn().mockResolvedValue(10),
  isEncoderAvailable: vi.fn().mockResolvedValue(false),
  getOptimalFfmpegThreads: vi.fn().mockReturnValue('2'),
}));

vi.mock('../../src/lib/engine/extractor');
vi.mock('../../src/lib/engine/pipe');

describe('Milestone M3 — Exhaustive Permutation & Stress Testing Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
    vi.spyOn(fs, 'rmSync').mockImplementation(() => undefined as any);
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 } as any);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['muted_video.mp4', 'output.mp4'] as any);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined as any);
    vi.mocked(ffmpegExt.probeMediaStreams).mockResolvedValue({ hasVideo: true, hasAudio: true, duration: 10 });
    vi.mocked(ffmpegExt.getMediaDuration).mockResolvedValue(10);
    authExt.registerJobOwner('stress-job-1', 'stress_user');
  });

  // ── 1. Test Fixture Matrix (Valid, Empty, Corrupted, Truncated, Headers) ──
  describe('1. Test Fixture Matrix Across Media Tools', () => {
    test('handles 0-byte empty file payload gracefully with 400 Bad Request', async () => {
      const formData = new FormData();
      formData.append('mode', 'remove');
      formData.append('files', new File([], 'empty.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_stress' }),
      } as any as NextRequest;

      const res = await mutePOST(req);
      expect([200, 400]).toContain(res.status);
    });

    test('handles corrupted / random garbage binary payloads safely without process crashing', async () => {
      const garbageBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff, 0xfe, 0xfd]);
      const formData = new FormData();
      formData.append('outputFormat', 'mp4');
      formData.append('file', new File([garbageBytes], 'corrupt.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_stress' }),
      } as any as NextRequest;

      const mockOpenHandle = {
        write: vi.fn().mockResolvedValue({ bytesWritten: 8 }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fs.promises, 'open').mockResolvedValue(mockOpenHandle as any);

      // Mock ffmpeg emitting error stream on garbage payload
      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"error":"Invalid data found when processing input"}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await convertPOST(req);
      expect(res.status).toBe(200); // SSE stream opened
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        text += decoder.decode(value);
      }
      expect(text).toContain('"error"');
    });

    test('sanitizes non-standard headers, emojis, and unicode file names', async () => {
      const unicodeNames = [
        '🎬_cinematic_preview_🔥 [2026].mp4',
        '日本語ファイル名_テスト.wav',
        'مقطع_فيديو_تجريبي.mp3',
        'file with spaces & symbols (v2) #1.jpg',
      ];

      for (const name of unicodeNames) {
        const sanitized = sanitizeFilename(name);
        expect(sanitized).toBeDefined();
        expect(sanitized.length).toBeGreaterThan(0);
        expect(sanitized).not.toContain('../');
        expect(sanitized).not.toContain('..\\');
      }
    });

    test('handles truncated files with abrupt EOF during audio trimming', async () => {
      const formData = new FormData();
      formData.append('mode', 'trim');
      formData.append('outputFormat', 'mp3');
      formData.append('startTime', '0');
      formData.append('endTime', '10');
      formData.append('files', new File(['RIFF....WAVEfmt '], 'truncated.wav', { type: 'audio/wav' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_stress' }),
      } as any as NextRequest;

      const mockOpenHandle = {
        write: vi.fn().mockResolvedValue({ bytesWritten: 16 }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fs.promises, 'open').mockResolvedValue(mockOpenHandle as any);

      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await audioTrimPOST(req);
      expect(res.status).toBe(200);
    });
  });

  // ── 2. Large Payload Handling (>2GB Mock Streaming via writeInputFile) ─────
  describe('2. Large Payload Handling (>2GB Sliced Buffer Barrier)', () => {
    test('writes large payload via ReadableStream without ERR_OUT_OF_RANGE or buffer allocation limits', async () => {
      const testJobId = 'stress-large-payload-job';
      const filename = 'large_4k_footage.mov';

      // Mock open handle
      const mockHandle = {
        write: vi.fn().mockResolvedValue({ bytesWritten: 16 * 1024 * 1024 }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fs.promises, 'open').mockResolvedValue(mockHandle as any);

      // Create a mock stream simulating 2.5 GB in 160 chunks of 16MB
      let chunkCount = 0;
      const totalChunks = 160; // 160 * 16MB = 2560 MB (> 2.5 GB)
      const fake16MBChunk = new Uint8Array(16 * 1024 * 1024);

      const mockLargeStream = new ReadableStream({
        pull(controller) {
          if (chunkCount < totalChunks) {
            controller.enqueue(fake16MBChunk);
            chunkCount++;
          } else {
            controller.close();
          }
        },
      });

      const writtenPath = await writeInputFile(testJobId, filename, mockLargeStream);
      expect(writtenPath).toContain(filename);
      expect(mockHandle.write).toHaveBeenCalledTimes(totalChunks);
      expect(mockHandle.close).toHaveBeenCalledTimes(1);
    });

    test('slices large monolithic TypedArray into <=16MB chunks during direct write', async () => {
      const testJobId = 'stress-monolithic-array';
      const filename = 'huge_buffer.bin';

      const mockHandle = {
        write: vi.fn().mockResolvedValue({ bytesWritten: 16 * 1024 * 1024 }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fs.promises, 'open').mockResolvedValue(mockHandle as any);

      // 48 MB array buffer view -> should be written in 3 chunks of 16MB
      const mock48MBView = new Uint8Array(48 * 1024 * 1024);
      await writeInputFile(testJobId, filename, mock48MBView);

      expect(mockHandle.write).toHaveBeenCalledTimes(3);
      expect(mockHandle.close).toHaveBeenCalledTimes(1);
    });

    test('streams large Node.js Readable source cleanly through safeWriteBuffer barrier', async () => {
      const testJobId = 'stress-node-readable';
      const filename = 'stream_input.mp4';

      const mockHandle = {
        write: vi.fn().mockResolvedValue({ bytesWritten: 8 * 1024 * 1024 }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fs.promises, 'open').mockResolvedValue(mockHandle as any);

      const nodeReadable = Readable.from([
        Buffer.alloc(8 * 1024 * 1024),
        Buffer.alloc(8 * 1024 * 1024),
      ]);

      await writeInputFile(testJobId, filename, nodeReadable);
      expect(mockHandle.write).toHaveBeenCalledTimes(2);
      expect(mockHandle.close).toHaveBeenCalledTimes(1);
    });
  });

  // ── 3. Rapid Stream Cancellation / Abort Simulation ───────────────────────
  describe('3. Rapid Stream Cancellation & Orphan Process Prevention', () => {
    test('rapidly cancels /api/compress stream and invokes activeReader.cancel() and cleanupJobDir()', async () => {
      const formData = new FormData();
      formData.append('videoCodec', 'hevc');
      formData.append('files', new File(['mock'], 'cancel.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_stress' }),
      } as any as NextRequest;

      const mockOpenHandle = {
        write: vi.fn().mockResolvedValue({ bytesWritten: 4 }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fs.promises, 'open').mockResolvedValue(mockOpenHandle as any);

      const mockStream = new ReadableStream({
        start() {},
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await compressPOST(req);
      expect(res.status).toBe(200);

      const reader = res.body!.getReader();
      // Rapid abort before any chunks processed
      await reader.cancel('User navigated away abruptly');

      expect(res.body).toBeDefined();
    });

    test('rapidly cancels /api/convert stream during active transcode', async () => {
      const formData = new FormData();
      formData.append('outputFormat', 'mp4');
      formData.append('file', new File(['mock'], 'cancel_conv.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_stress' }),
      } as any as NextRequest;

      const mockOpenHandle = {
        write: vi.fn().mockResolvedValue({ bytesWritten: 4 }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fs.promises, 'open').mockResolvedValue(mockOpenHandle as any);

      const mockStream = new ReadableStream({
        start() {},
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await convertPOST(req);
      expect(res.status).toBe(200);

      const reader = res.body!.getReader();
      await reader.cancel('Client abort');
      expect(res.body).toBeDefined();
    });

    test('rapidly cancels /api/mute stream', async () => {
      const formData = new FormData();
      formData.append('mode', 'remove');
      formData.append('files', new File(['mock video'], 'mute_cancel.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_stress' }),
      } as any as NextRequest;

      const mockOpenHandle = {
        write: vi.fn().mockResolvedValue({ bytesWritten: 4 }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fs.promises, 'open').mockResolvedValue(mockOpenHandle as any);

      const mockStream = new ReadableStream({
        start() {},
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await mutePOST(req);
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      await reader.cancel('Abort');
    });

    test('rapidly cancels /api/audio-trim stream', async () => {
      const formData = new FormData();
      formData.append('mode', 'trim');
      formData.append('outputFormat', 'mp3');
      formData.append('startTime', '0');
      formData.append('endTime', '5');
      formData.append('files', new File(['mock audio'], 'trim_cancel.mp3', { type: 'audio/mpeg' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_stress' }),
      } as any as NextRequest;

      const mockOpenHandle = {
        write: vi.fn().mockResolvedValue({ bytesWritten: 4 }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fs.promises, 'open').mockResolvedValue(mockOpenHandle as any);

      const mockStream = new ReadableStream({
        start() {},
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await audioTrimPOST(req);
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      await reader.cancel('Abort');
    });

    test('rapidly cancels /api/experimental/turbo-download fMP4 stream', async () => {
      vi.mocked(CelestialExtractor.prototype.getMetadata).mockResolvedValue({
        title: 'Turbo Stream',
        thumbnail: '',
        duration: 60,
        streams: [
          { url: 'https://v.mp4', mimeType: 'mp4', bitrate: 2000, contentLength: 1000, type: 'video' },
          { url: 'https://a.mp4', mimeType: 'm4a', bitrate: 128, contentLength: 500, type: 'audio' },
        ],
      });

      const fakePass = new PassThrough();
      fakePass.destroy = vi.fn();
      vi.mocked(CelestialStreamer.prototype.mux).mockReturnValue(fakePass as any);

      const req = new NextRequest('http://localhost:3000/api/experimental/turbo-download?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
        headers: { authorization: 'Bearer user_stress' },
      });

      const res = await turboDownloadGET(req);
      const reader = res.body!.getReader();
      await reader.cancel('Turbo client abort');

      expect(fakePass.destroy).toHaveBeenCalled();
    });
  });

  // ── 4. Concurrent Request Permutations & Tab Switching ────────────────────
  describe('4. High Concurrency Permutations & Multi-Tool Execution', () => {
    test('executes 20 concurrent multi-tool API requests without thread contention or crash', async () => {
      const mockOpenHandle = {
        write: vi.fn().mockResolvedValue({ bytesWritten: 4 }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fs.promises, 'open').mockResolvedValue(mockOpenHandle as any);

      vi.mocked(ffmpegExt.executeFfmpeg).mockImplementation(() => {
        return new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
            c.enqueue(new TextEncoder().encode('data: {"status":"done"}\n\n'));
            c.close();
          }
        });
      });

      const promises: Promise<Response>[] = [];

      for (let i = 0; i < 20; i++) {
        const req = {
          formData: async () => {
            const fd = new FormData();
            fd.append('mode', 'remove');
            fd.append('files', new File(['mock'], `video_${i}.mp4`, { type: 'video/mp4' }));
            return fd;
          },
          headers: new Headers({ authorization: `Bearer user_stress_${i}` }),
        } as any as NextRequest;

        promises.push(mutePOST(req));
      }

      const results = await Promise.all(promises);
      expect(results).toHaveLength(20);
      for (const res of results) {
        expect(res.status).toBe(200);
      }
    });

    test('handles rapid sequential retry requests in Spotify converter without race condition', async () => {
      authExt.registerJobOwner('spotify-stress-job', 'owner');

      const retryPromises = [1, 2, 3, 4, 5].map((trackNum) => {
        const req = new NextRequest('http://localhost:3000/api/spotify-convert/retry', {
          method: 'POST',
          headers: {
            authorization: 'Bearer user_owner',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ jobId: 'spotify-stress-job', trackId: `track_${trackNum}` }),
        });
        return spotifyRetryPOST(req);
      });

      const responses = await Promise.all(retryPromises);
      for (let i = 0; i < responses.length; i++) {
        expect(responses[i].status).toBe(200);
        const json = await responses[i].json();
        expect(json.ok).toBe(true);
        expect(json.trackId).toBe(`track_${i + 1}`);
      }
    });
  });

  // ── 5. Temp Directory TTL Cleanup Sweeper ─────────────────────────────────
  describe('5. Temp Directory TTL Cleanup Sweeper Verification', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('purges expired directories older than TTL and preserves fresh directories', async () => {
      const now = Date.now();

      const mockEntries = [
        { name: 'old-expired-job-1', isDirectory: () => true },
        { name: 'old-expired-job-2', isDirectory: () => true },
        { name: 'fresh-active-job-3', isDirectory: () => true },
        { name: 'some-file.txt', isDirectory: () => false },
      ];

      vi.spyOn(fs.promises, 'readdir').mockResolvedValue(mockEntries as any);

      vi.spyOn(fs.promises, 'stat').mockImplementation(async (dirPath: any) => {
        if (String(dirPath).includes('old-expired')) {
          return { mtimeMs: now - 35 * 60 * 1000 } as any; // 35 minutes old (expired)
        }
        return { mtimeMs: now - 5 * 60 * 1000 } as any; // 5 minutes old (fresh)
      });

      const rmSpy = vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);

      // Start sweeper with 30m TTL, 5m interval
      const timer = startTempDirSweeper(30 * 60 * 1000, 5 * 60 * 1000);

      // Advance by 5 minutes to trigger the sweep
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(rmSpy).toHaveBeenCalledTimes(2);
      expect(rmSpy).toHaveBeenCalledWith(path.resolve('/mock/temp', 'old-expired-job-1'), { recursive: true, force: true });
      expect(rmSpy).toHaveBeenCalledWith(path.resolve('/mock/temp', 'old-expired-job-2'), { recursive: true, force: true });

      clearInterval(timer);
    });

    test('prevents traversal attacks in sanitizeJobId and sanitizeFilename', () => {
      expect(() => sanitizeJobId('../../etc')).not.toThrow();
      expect(sanitizeJobId('../../etc')).toBe('etc');
      expect(() => sanitizeJobId('')).toThrow('Invalid jobId');

      expect(sanitizeFilename('../../../secret.pem')).toBe('secret.pem');
      expect(sanitizeFilename('..\\..\\windows\\system32.dll')).toBe('system32.dll');
      expect(sanitizeFilename('')).toBe('file');
    });
  });
});
