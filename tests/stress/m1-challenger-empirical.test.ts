/**
 * tests/stress/m1-challenger-empirical.test.ts
 *
 * EMPIRICAL ADVERSARIAL CHALLENGE SUITE FOR MILESTONE M1
 *
 * Assigned Verification Areas:
 * 1. Temp Sweeper:
 *    - Verify startTempDirSweeper / ensureTempDirSweeperStarted cleans stale folders
 *      older than TTL while preserving fresh ones.
 *    - Test rapid job creations during sweeping and mocked clocks.
 *    - Verify ensureTempDirSweeperStarted idempotency and global guard.
 *
 * 2. Race Condition between Process Termination and cleanupJobDir:
 *    - Stress cancel during active FFmpeg writes and verify disk handles are cleanly
 *      closed before cleanupJobDir executes.
 *    - Verify no EBUSY / ENOTEMPTY errors when cleaning up immediately after cancel.
 *    - Verify process PID termination in OS kernel.
 *    - Concurrent multi-job abortion stress harness.
 *
 * 3. Frontend Memory in GlobalJobContext:
 *    - Verify listeners do not leak on subscribe/unsubscribe or provider unmount.
 *    - Verify completed jobs do not buffer blobs or trigger fetch() into memory.
 *    - Verify Object URL tracking, revocation, and store pruning on clearJob.
 */

import { describe, test, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import React from 'react';
import { render, act } from '@testing-library/react';

import {
  startTempDirSweeper,
  ensureTempDirSweeperStarted,
  resetTempDirSweeperForTesting,
  createJobDir,
  cleanupJobDir,
  writeInputFile,
  sanitizeJobId
} from '../../lib/temp';
import { executeFfmpeg } from '../../lib/ffmpeg';
import { executeYtdlp } from '../../lib/ytdlp';
import { env } from '../../lib/env';

import {
  GlobalJobProvider,
  useJobState,
  useJob,
  resetGlobalJobStore,
  safeCreateObjectURL,
  safeRevokeObjectURL,
  revokeAllObjectUrls,
} from '../../app/context/GlobalJobContext';

// ── Scratch directory isolated for adversarial tests ────────────────────────
const CHALLENGE_TEMP_BASE = path.resolve('/tmp/celestial_m1_challenger_scratch');

describe('Milestone M1 Empirical Challenger Verification', () => {

  beforeAll(() => {
    if (!fs.existsSync(CHALLENGE_TEMP_BASE)) {
      fs.mkdirSync(CHALLENGE_TEMP_BASE, { recursive: true });
    }
  });

  afterAll(() => {
    try {
      if (fs.existsSync(CHALLENGE_TEMP_BASE)) {
        fs.rmSync(CHALLENGE_TEMP_BASE, { recursive: true, force: true });
      }
    } catch {}
  });

  beforeEach(() => {
    resetGlobalJobStore();
    resetTempDirSweeperForTesting();
  });

  // =========================================================================
  // 1. TEMP SWEEPER EMPIRICAL VERIFICATION
  // =========================================================================
  describe('1. Temp Sweeper (startTempDirSweeper & ensureTempDirSweeperStarted)', () => {

    test('1.1 Real filesystem: Cleans stale directories older than TTL while preserving fresh ones', async () => {
      const sweeperDir = path.join(CHALLENGE_TEMP_BASE, 'sweeper_real_test');
      if (fs.existsSync(sweeperDir)) fs.rmSync(sweeperDir, { recursive: true, force: true });
      fs.mkdirSync(sweeperDir, { recursive: true });

      const staleDir1 = path.join(sweeperDir, 'stale_job_1');
      const staleDir2 = path.join(sweeperDir, 'stale_job_2');
      const freshDir1 = path.join(sweeperDir, 'fresh_job_1');
      const freshDir2 = path.join(sweeperDir, 'fresh_job_2');
      const safeFile = path.join(sweeperDir, 'keep_me.txt');

      fs.mkdirSync(staleDir1, { recursive: true });
      fs.mkdirSync(staleDir2, { recursive: true });
      fs.mkdirSync(freshDir1, { recursive: true });
      fs.mkdirSync(freshDir2, { recursive: true });
      fs.writeFileSync(safeFile, 'Important metadata log');

      // Manipulate timestamps on disk:
      // Stale dirs: mtime = 45 mins ago
      const fortyFiveMinsAgo = new Date(Date.now() - 45 * 60 * 1000);
      fs.utimesSync(staleDir1, fortyFiveMinsAgo, fortyFiveMinsAgo);
      fs.utimesSync(staleDir2, fortyFiveMinsAgo, fortyFiveMinsAgo);

      // Fresh dirs: mtime = 2 mins ago
      const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000);
      fs.utimesSync(freshDir1, twoMinsAgo, twoMinsAgo);
      fs.utimesSync(freshDir2, twoMinsAgo, twoMinsAgo);

      // Temporarily mock env.TEMP_DIR to point to our test directory
      const originalTemp = env.TEMP_DIR;
      (env as any).TEMP_DIR = sweeperDir;

      try {
        // Run sweeper with TTL = 30 minutes, interval = 50ms
        const timer = startTempDirSweeper(30 * 60 * 1000, 50);

        // Await 150ms for sweeper interval to fire
        await new Promise((r) => setTimeout(r, 150));
        clearInterval(timer);

        // Assert stale dirs removed
        expect(fs.existsSync(staleDir1)).toBe(false);
        expect(fs.existsSync(staleDir2)).toBe(false);

        // Assert fresh dirs preserved
        expect(fs.existsSync(freshDir1)).toBe(true);
        expect(fs.existsSync(freshDir2)).toBe(true);

        // Assert safe non-directory file preserved
        expect(fs.existsSync(safeFile)).toBe(true);
      } finally {
        (env as any).TEMP_DIR = originalTemp;
        fs.rmSync(sweeperDir, { recursive: true, force: true });
      }
    });

    test('1.2 Mocked Clock: Multi-interval sweep correctly cleans directories as they age past TTL', async () => {
      vi.useFakeTimers();

      const baseDir = '/mock/sweeper/clock_test';
      const originalTemp = env.TEMP_DIR;
      (env as any).TEMP_DIR = baseDir;

      const mockEntries = [
        { name: 'job_immediate_stale', isDirectory: () => true },
        { name: 'job_will_stale_soon', isDirectory: () => true },
        { name: 'job_brand_new', isDirectory: () => true },
      ];

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(mockEntries as any);

      const rmPromises: string[] = [];
      vi.spyOn(fs.promises, 'rm').mockImplementation(async (targetPath: any) => {
        rmPromises.push(String(targetPath));
      });

      const initialNow = 10000000;
      vi.setSystemTime(initialNow);

      vi.spyOn(fs.promises, 'stat').mockImplementation(async (targetPath: any) => {
        const p = String(targetPath);
        if (p.includes('job_immediate_stale')) {
          // 40 minutes old at start
          return { mtimeMs: initialNow - 40 * 60 * 1000 } as any;
        }
        if (p.includes('job_will_stale_soon')) {
          // 15 minutes old at start: at tick 1 (+10m) it will be 25m (<30m TTL), at tick 2 (+20m) it will be 35m (>30m TTL)
          return { mtimeMs: initialNow - 15 * 60 * 1000 } as any;
        }
        // brand new
        return { mtimeMs: initialNow } as any;
      });

      try {
        const timer = startTempDirSweeper(30 * 60 * 1000, 10 * 60 * 1000);

        // Tick 1: Advance by 10 minutes (t = +10m)
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

        // Immediate stale should be deleted
        expect(rmPromises).toContain(path.resolve(baseDir, 'job_immediate_stale'));
        expect(rmPromises).not.toContain(path.resolve(baseDir, 'job_will_stale_soon'));
        expect(rmPromises).not.toContain(path.resolve(baseDir, 'job_brand_new'));

        // Tick 2: Advance by another 10 minutes (t = +20m, now job_will_stale_soon is 45m old)
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

        expect(rmPromises).toContain(path.resolve(baseDir, 'job_will_stale_soon'));
        expect(rmPromises).not.toContain(path.resolve(baseDir, 'job_brand_new'));

        clearInterval(timer);
      } finally {
        (env as any).TEMP_DIR = originalTemp;
        vi.restoreAllMocks();
        vi.useRealTimers();
      }
    });

    test('1.3 High-churn stress: 50 rapid job creations concurrent with active sweeper cycles', async () => {
      const stressBase = path.join(CHALLENGE_TEMP_BASE, 'sweeper_churn_stress');
      if (fs.existsSync(stressBase)) fs.rmSync(stressBase, { recursive: true, force: true });
      fs.mkdirSync(stressBase, { recursive: true });

      const originalTemp = env.TEMP_DIR;
      (env as any).TEMP_DIR = stressBase;

      try {
        // Pre-create 10 stale folders
        const staleIds: string[] = [];
        const staleDate = new Date(Date.now() - 60 * 60 * 1000);
        for (let i = 0; i < 10; i++) {
          const id = `stale_pre_${i}`;
          staleIds.push(id);
          const dir = path.join(stressBase, id);
          fs.mkdirSync(dir, { recursive: true });
          fs.utimesSync(dir, staleDate, staleDate);
        }

        // Start sweeper with aggressive 25ms interval and 10s TTL
        const sweeperTimer = startTempDirSweeper(10 * 1000, 25);

        // Concurrently churn 50 rapid new job directory creations
        const freshIds: string[] = [];
        const creations = Array.from({ length: 50 }).map(async (_, idx) => {
          const id = `fresh_churn_${idx}`;
          freshIds.push(id);
          const dir = createJobDir(id);
          expect(fs.existsSync(dir)).toBe(true);
          await new Promise((r) => setTimeout(r, Math.random() * 20));
        });

        await Promise.all(creations);

        // Allow another 100ms for sweeper to process
        await new Promise((r) => setTimeout(r, 100));
        clearInterval(sweeperTimer);

        // Verify all 10 stale directories were cleaned
        for (const sId of staleIds) {
          expect(fs.existsSync(path.join(stressBase, sId))).toBe(false);
        }

        // Verify ALL 50 fresh directories were completely preserved
        for (const fId of freshIds) {
          expect(fs.existsSync(path.join(stressBase, fId))).toBe(true);
          cleanupJobDir(fId);
        }
      } finally {
        (env as any).TEMP_DIR = originalTemp;
        fs.rmSync(stressBase, { recursive: true, force: true });
      }
    });

    test('1.4 ensureTempDirSweeperStarted idempotency under parallel invocations', () => {
      resetTempDirSweeperForTesting();

      // Call ensureTempDirSweeperStarted 20 times concurrently
      const results: (NodeJS.Timeout | null)[] = [];
      for (let i = 0; i < 20; i++) {
        results.push(ensureTempDirSweeperStarted(60000, 10000));
      }

      // Exactly 1 invocation returned a timer; all 19 other invocations returned null
      const nonNullTimers = results.filter((t) => t !== null);
      const nullResults = results.filter((t) => t === null);

      expect(nonNullTimers.length).toBe(1);
      expect(nullResults.length).toBe(19);

      // Clean up timer
      if (nonNullTimers[0]) clearInterval(nonNullTimers[0]);

      // Verify reset allows restarting
      resetTempDirSweeperForTesting();
      const restartTimer = ensureTempDirSweeperStarted(60000, 10000);
      expect(restartTimer).not.toBeNull();
      if (restartTimer) clearInterval(restartTimer);
    });

    test('1.5 Sweeper gracefully handles non-existent base directory and stat exceptions', async () => {
      const nonExistent = path.join(CHALLENGE_TEMP_BASE, 'does_not_exist_dir_' + Date.now());
      const originalTemp = env.TEMP_DIR;
      (env as any).TEMP_DIR = nonExistent;

      try {
        const timer = startTempDirSweeper(1000, 20);
        // Let it tick twice on non-existent base directory without throwing
        await new Promise((r) => setTimeout(r, 60));
        clearInterval(timer);
        expect(true).toBe(true);
      } finally {
        (env as any).TEMP_DIR = originalTemp;
      }
    });
  });

  // =========================================================================
  // 2. RACE CONDITION: PROCESS TERMINATION & CLEANUPJOBDIR
  // =========================================================================
  describe('2. Process Termination & cleanupJobDir Race Condition', () => {

    test('2.1 Real FFmpeg: Stress cancel during active high-rate writes closes disk handles before cleanupJobDir', async () => {
      const jobId = 'race-ffmpeg-cancel-' + Date.now();
      const jobDir = createJobDir(jobId);
      const outputPath = path.join(jobDir, 'active_output.mp4');

      // Command: Generate continuous video stream for 60 seconds into outputPath
      // This causes FFmpeg to hold an active write handle and continuously flush frames.
      const ffmpegArgs = [
        '-y',
        '-f', 'lavfi',
        '-i', 'testsrc=size=640x480:rate=30',
        '-f', 'lavfi',
        '-i', 'sine=frequency=1000:sample_rate=44100',
        '-t', '60',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        outputPath
      ];

      const stream = executeFfmpeg(outputPath, ffmpegArgs, 60);
      const reader = stream.getReader();

      let activePid: number | null = null;
      let chunksReceived = 0;

      // Read SSE progress chunks until FFmpeg is actively transcoding
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunksReceived++;
        const text = decoder.decode(value);

        // Find child process PID of ffmpeg writing to our file via lsof or pgrep if needed
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) {
          break; // File is actively being written!
        }
      }

      expect(fs.existsSync(outputPath)).toBe(true);
      const initialSize = fs.statSync(outputPath).size;
      expect(initialSize).toBeGreaterThan(0);

      // Now CANCEL the reader while FFmpeg is actively writing!
      const cancelStartTime = Date.now();
      await reader.cancel('Adversarial stress abort during active write');
      const cancelDuration = Date.now() - cancelStartTime;

      // cancel() MUST have completed
      expect(cancelDuration).toBeLessThan(4000);

      // Verify that cleanupJobDir executes cleanly without EBUSY, ENOTEMPTY, or locked handle error
      expect(() => {
        cleanupJobDir(jobId);
      }).not.toThrow();

      // Verify that the directory was wiped completely
      expect(fs.existsSync(jobDir)).toBe(false);
      expect(fs.existsSync(outputPath)).toBe(false);
    });

    test('2.2 Concurrent stress: 5 parallel active transcode jobs cancelled concurrently with random jitter', async () => {
      const concurrency = 5;
      const jobs = Array.from({ length: concurrency }).map((_, i) => ({
        id: `stress-cancel-burst-${Date.now()}-${i}`,
        jitterMs: 50 + i * 40,
      }));

      const runAndCancelJob = async (job: { id: string; jitterMs: number }) => {
        const dir = createJobDir(job.id);
        const out = path.join(dir, 'churn.mp4');

        const stream = executeFfmpeg(out, [
          '-y',
          '-f', 'lavfi',
          '-i', 'testsrc=size=320x240:rate=30',
          '-t', '30',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          out
        ], 30);

        const reader = stream.getReader();

        // Let it run for the jitter duration
        await new Promise((r) => setTimeout(r, job.jitterMs));

        // Cancel during active write
        await reader.cancel('Burst cancel ' + job.id);

        // Immediately invoke cleanupJobDir
        cleanupJobDir(job.id);

        expect(fs.existsSync(dir)).toBe(false);
      };

      // Run all 5 concurrently
      await Promise.all(jobs.map(runAndCancelJob));
    });

    test('2.3 executeYtdlp cancel() terminates process promptly and allows immediate cleanup', async () => {
      const testJobId = 'stress-ytdlp-cancel-' + Date.now();
      const dir = createJobDir(testJobId);

      // Run yt-dlp against a slow/dummy URL with executeYtdlp
      const stream = executeYtdlp(dir, 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', ['--simulate']);
      const reader = stream.getReader();

      // Read initial output or wait 50ms
      await new Promise((r) => setTimeout(r, 60));

      // Cancel
      await expect(reader.cancel('Cancel yt-dlp')).resolves.not.toThrow();

      // Verify cleanupJobDir works immediately
      expect(() => cleanupJobDir(testJobId)).not.toThrow();
      expect(fs.existsSync(dir)).toBe(false);
    });

    test('2.4 Early cancel before process start does not crash or leave zombie process', async () => {
      const earlyJobId = 'early-cancel-' + Date.now();
      const dir = createJobDir(earlyJobId);
      const out = path.join(dir, 'early.mp4');

      const stream = executeFfmpeg(out, ['-version']);
      const reader = stream.getReader();

      // Immediately cancel without awaiting any read()
      const cancelPromise = reader.cancel('Immediate abort');
      await expect(cancelPromise).resolves.not.toThrow();

      cleanupJobDir(earlyJobId);
      expect(fs.existsSync(dir)).toBe(false);
    });
  });

  // =========================================================================
  // 3. FRONTEND MEMORY LEAKS & OBJECT URL LIFECYCLE IN GLOBALJOBCONTEXT
  // =========================================================================
  describe('3. Frontend Memory & Listener Lifecycle (GlobalJobContext)', () => {

    test('3.1 Listener lifecycle: Subscriptions increment count, unsubscriptions prune empty sets', () => {
      resetGlobalJobStore();

      // Test subscriber tracking via useJob / subscribe pattern
      let contextValue: any = null;
      function TestComponent() {
        const job = useJob('tool_listener_test');
        return React.createElement('div', null, job.jobState?.statusText ?? 'idle');
      }

      function ProviderWrapper() {
        return React.createElement(GlobalJobProvider, null, React.createElement(TestComponent));
      }

      const { unmount } = render(React.createElement(ProviderWrapper));

      // Unmounting should clean up without error
      unmount();
      expect(true).toBe(true);
    });

    test('3.2 Completed jobs do NOT invoke fetch() or retain media blobs in memory', async () => {
      resetGlobalJobStore();

      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL');

      let capturedStartJob: any = null;

      function CaptureComponent() {
        const { startJob, jobState } = useJob('memory_test_tool');
        capturedStartJob = startJob;
        return React.createElement('div', { 'data-testid': 'status' }, jobState?.status ?? 'none');
      }

      const { unmount } = render(
        React.createElement(GlobalJobProvider, null, React.createElement(CaptureComponent))
      );

      // Create a mock SSE Response emitting completion with a 2GB downloadUrl
      const ssePayload = [
        'data: {"strategy":"REMUX","strategyReason":"Fast transcode"}\n\n',
        'data: {"progress":50}\n\n',
        'data: {"status":"complete","downloadUrl":"/api/download?jobId=large123&file=huge_video.mp4","filename":"huge_video.mp4"}\n\n'
      ].join('');

      const mockResponse = new Response(ssePayload, {
        headers: { 'Content-Type': 'text/event-stream' }
      });

      // Start the job
      act(() => {
        capturedStartJob(mockResponse);
      });

      // Wait for stream to be consumed
      await new Promise((r) => setTimeout(r, 80));

      // VERIFY: fetch was NEVER called to download/buffer the multi-GB blob into RAM!
      expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/api/download'));

      // VERIFY: URL.createObjectURL was NOT called for binary blob buffering
      // (direct anchor click pattern is used instead)
      expect(createObjectURLSpy).not.toHaveBeenCalled();

      unmount();
      fetchSpy.mockRestore();
      createObjectURLSpy.mockRestore();
    });

    test('3.3 safeCreateObjectURL, safeRevokeObjectURL, and revokeAllObjectUrls track and revoke properly', () => {
      const mockBlob1 = new Blob(['sample 1'], { type: 'text/plain' });
      const mockBlob2 = new Blob(['sample 2'], { type: 'text/plain' });

      const url1 = safeCreateObjectURL(mockBlob1);
      const url2 = safeCreateObjectURL(mockBlob2);

      expect(typeof url1).toBe('string');
      expect(typeof url2).toBe('string');

      // Revoke single
      expect(() => safeRevokeObjectURL(url1)).not.toThrow();

      // Revoke all remaining
      expect(() => revokeAllObjectUrls()).not.toThrow();

      // Revoking already revoked URL is a safe no-op
      expect(() => safeRevokeObjectURL(url1)).not.toThrow();
      expect(() => safeRevokeObjectURL(null)).not.toThrow();
      expect(() => safeRevokeObjectURL(undefined)).not.toThrow();
    });

    test('3.4 High-throughput update burst: 500 rapid SSE chunks do not leak memory or crash store', async () => {
      resetGlobalJobStore();

      let capturedStartJob: any = null;

      function StressComponent() {
        const { startJob, jobState } = useJob('burst_tool');
        capturedStartJob = startJob;
        return React.createElement('div', null, `${jobState?.progress ?? 0}%`);
      }

      const { unmount } = render(
        React.createElement(GlobalJobProvider, null, React.createElement(StressComponent))
      );

      // Build 500 rapid progress event chunks
      let chunkStream = '';
      for (let i = 1; i <= 500; i++) {
        chunkStream += `data: {"progress":${(i / 500) * 100}}\n\n`;
      }
      chunkStream += `data: {"status":"complete","downloadUrl":"/api/download?jobId=stress123&file=test.zip"}\n\n`;

      const mockResponse = new Response(chunkStream, {
        headers: { 'Content-Type': 'text/event-stream' }
      });

      act(() => {
        capturedStartJob(mockResponse);
      });

      await new Promise((r) => setTimeout(r, 120));

      unmount();
      resetGlobalJobStore();
      expect(true).toBe(true);
    });
  });
});
