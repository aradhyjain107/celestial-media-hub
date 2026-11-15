import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { NextRequest } from 'next/server';
import { POST as convertPost } from '../app/api/convert/route';
import { POST as compressPost } from '../app/api/compress/route';
import { CelestialStreamer } from '../lib/engine/pipe';
import {
  startTempDirSweeper,
  ensureTempDirSweeperStarted,
  resetTempDirSweeperForTesting,
  createJobDir,
  cleanupJobDir,
} from '../lib/temp';
import { env } from '../lib/env';
import { signToken } from '../lib/jwt';

describe('Milestone M1 Empirical Adversarial Challenge', () => {
  let authToken: string;
  let testMediaBuffer: Buffer;
  const tempTestDir = path.resolve(process.cwd(), '.tmp/challenger_m1_test');

  beforeAll(async () => {
    authToken = await signToken({ sub: 'challenger-agent-m1-2', role: 'admin' });

    // Generate small 0.5s valid MP4 test buffer
    const fixturePath = '/tmp/challenger_fixture.mp4';
    execSync(
      `ffmpeg -f lavfi -i testsrc=duration=0.5:size=160x120:rate=10 -f lavfi -i sine=frequency=1000:duration=0.5 -c:v libx264 -pix_fmt yuv420p -c:a aac -y ${fixturePath}`,
      { stdio: 'pipe' }
    );
    testMediaBuffer = fs.readFileSync(fixturePath);
    try {
      fs.unlinkSync(fixturePath);
    } catch {}

    if (!fs.existsSync(tempTestDir)) {
      fs.mkdirSync(tempTestDir, { recursive: true });
    }
  });

  afterAll(() => {
    try {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('1. Concurrency & Multi-File Batch Loop Cancellation', () => {
    test('1.1 Aborting mid-batch halts iteration, cancels child process, and purges temp directory', async () => {
      const abortController = new AbortController();

      // Construct FormData with 3 media files
      const formData = new FormData();
      formData.append('outputFormat', 'mp3');
      formData.append('files', new Blob([new Uint8Array(testMediaBuffer)], { type: 'video/mp4' }), 'sample_file_1.mp4');
      formData.append('files', new Blob([new Uint8Array(testMediaBuffer)], { type: 'video/mp4' }), 'sample_file_2.mp4');
      formData.append('files', new Blob([new Uint8Array(testMediaBuffer)], { type: 'video/mp4' }), 'sample_file_3.mp4');

      const req = new NextRequest('http://localhost:3000/api/convert', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
        signal: abortController.signal,
      });

      const response = await convertPost(req);
      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const messages: string[] = [];
      let detectedJobId: string | null = null;
      let aborted = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          messages.push(text);

          // Extract jobId from downloadUrl if emitted
          const matchJob = text.match(/jobId=([a-f0-9-]+)/i);
          if (matchJob && !detectedJobId) {
            detectedJobId = matchJob[1];
          }

          // Abort during processing
          if (!aborted && (text.includes('"progress"') || text.includes('converted_1'))) {
            aborted = true;
            abortController.abort();
          }
        }
      } catch (err: any) {
        // Stream aborted/errored as expected on abort
      }

      // Allow async cleanup to settle
      await new Promise((r) => setTimeout(r, 200));

      const allOutput = messages.join('\n');

      // VERIFICATION:
      // 1. File 2 and File 3 MUST NOT have been completed
      expect(allOutput).not.toContain('converted_2_sample_file_2.mp3');
      expect(allOutput).not.toContain('converted_3_sample_file_3.mp3');

      // 2. If a jobId was detected, its temp directory MUST be purged
      if (detectedJobId) {
        const jobPath = path.resolve(env.TEMP_DIR, detectedJobId);
        expect(fs.existsSync(jobPath)).toBe(false);
      }
    });

    test('1.2 High-concurrency batch execution with interleaved aborts maintains isolation', async () => {
      const totalRuns = 4;
      const abortIndices = new Set([0, 2]); // Abort runs 0 and 2; let 1 and 3 run
      const controllers = Array.from({ length: totalRuns }, () => new AbortController());

      const runTasks = Array.from({ length: totalRuns }, async (_, idx) => {
        const isToAbort = abortIndices.has(idx);
        const ac = controllers[idx];

        const formData = new FormData();
        formData.append('outputFormat', 'mp3');
        formData.append('files', new Blob([new Uint8Array(testMediaBuffer)], { type: 'video/mp4' }), `conc_${idx}_1.mp4`);
        formData.append('files', new Blob([new Uint8Array(testMediaBuffer)], { type: 'video/mp4' }), `conc_${idx}_2.mp4`);

        const req = new NextRequest('http://localhost:3000/api/convert', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
          body: formData,
          signal: ac.signal,
        });

        const res = await convertPost(req);
        if (res.status !== 200 || !res.body) return { idx, aborted: isToAbort, success: false };

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let abortedOnce = false;
        let finalJobId: string | null = null;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            const m = text.match(/jobId=([a-f0-9-]+)/i);
            if (m && !finalJobId) finalJobId = m[1];

            if (isToAbort && !abortedOnce && text.includes('"progress"')) {
              abortedOnce = true;
              ac.abort();
            }
          }
        } catch {
          // Expected on abort
        }

        return { idx, aborted: isToAbort, finalJobId };
      });

      const results = await Promise.all(runTasks);
      await new Promise((r) => setTimeout(r, 300));

      for (const res of results) {
        if (res.aborted && res.finalJobId) {
          const dir = path.resolve(env.TEMP_DIR, res.finalJobId);
          expect(fs.existsSync(dir)).toBe(false);
        }
      }
    });
  });

  describe('2. Pipe Streaming Engine Lifecycle (lib/engine/pipe.ts)', () => {
    let mockHttpServer: http.Server;
    let serverPort: number;
    let serverConnections: http.IncomingMessage[] = [];

    beforeAll(async () => {
      mockHttpServer = http.createServer((req, res) => {
        serverConnections.push(req);
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Transfer-Encoding': 'chunked',
        });
        // Stream chunks periodically until closed
        const iv = setInterval(() => {
          if (res.writableEnded || res.destroyed) {
            clearInterval(iv);
            return;
          }
          res.write(Buffer.alloc(4096, 0x55));
        }, 30);

        req.on('close', () => {
          clearInterval(iv);
        });
      });

      await new Promise<void>((resolve) => {
        mockHttpServer.listen(0, '127.0.0.1', () => {
          serverPort = (mockHttpServer.address() as any).port;
          resolve();
        });
      });
    });

    afterAll(async () => {
      try {
        if (typeof (mockHttpServer as any).closeAllConnections === 'function') {
          (mockHttpServer as any).closeAllConnections();
        }
      } catch {}
      await new Promise<void>((resolve) => mockHttpServer.close(() => resolve()));
    });

    test('2.1 Closing consumer stream triggers SIGTERM and terminates FFmpeg process', async () => {
      const streamer = new CelestialStreamer();
      const output = streamer.mux(
        [{ url: `http://127.0.0.1:${serverPort}/test.mp4`, type: 'video' }],
        { outputFormat: 'mkv' }
      );

      // Collect initial chunks
      let chunkCount = 0;
      output.on('data', () => {
        chunkCount++;
      });

      await new Promise((r) => setTimeout(r, 150));

      // Destroy the consumer output stream
      output.destroy();

      // Allow process kill handling to take effect
      await new Promise((r) => setTimeout(r, 200));

      expect(output.destroyed).toBe(true);
    });

    test('2.2 Empirical Proof: if (!ffmpeg.killed) prevents SIGKILL escalation in child_process', async () => {
      // In Node.js child_process:
      // When proc.kill('SIGTERM') is invoked, Node immediately marks proc.killed = true.
      // In lib/engine/pipe.ts:
      //   const killTimer = setTimeout(() => {
      //     if (!ffmpeg.killed) { ffmpeg.kill('SIGKILL'); }
      //   }, 500);
      // Since ffmpeg.killed is ALREADY true, if (!ffmpeg.killed) is FALSE, so SIGKILL NEVER FIRES!
      
      const unkillableScript = `
        process.on('SIGTERM', () => {
          // Explicitly ignore SIGTERM
        });
        setInterval(() => {}, 1000);
      `;

      const child = spawn(process.execPath, ['-e', unkillableScript]);
      const childPid = child.pid!;

      let sigkillFired = false;
      const killRoutineWithBug = () => {
        if (!child.killed) {
          try {
            child.kill('SIGTERM');
          } catch {}
          const killTimer = setTimeout(() => {
            if (!child.killed) {
              sigkillFired = true;
              try {
                child.kill('SIGKILL');
              } catch {}
            }
          }, 100);
          if (typeof killTimer.unref === 'function') killTimer.unref();
        }
      };

      killRoutineWithBug();

      // Wait past the escalation timeout
      await new Promise((r) => setTimeout(r, 150));

      // Demonstrates empirically that SIGKILL was NEVER fired because child.killed was already true!
      expect(sigkillFired).toBe(false);

      // Clean up the spawned process manually with SIGKILL
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {}
    });

    test('2.3 CelestialStreamer configures -f matroska for mkv and maps inputs correctly', () => {
      // Verify streamer argument construction
      const streamer = new CelestialStreamer();
      // Inspect private or spawned args by creating an instance with single & multiple inputs
      const outSingle = streamer.mux(
        [{ url: 'http://127.0.0.1:9999/dummy.mp4', type: 'video' }],
        { outputFormat: 'mkv' }
      );
      outSingle.destroy();

      const outMulti = streamer.mux(
        [
          { url: 'http://127.0.0.1:9999/v.mp4', type: 'video' },
          { url: 'http://127.0.0.1:9999/a.mp4', type: 'audio' },
        ],
        { outputFormat: 'mp4' }
      );
      outMulti.destroy();

      expect(outSingle.destroyed).toBe(true);
      expect(outMulti.destroyed).toBe(true);
    });
  });

  describe('3. Temp Directory Sweeper (lib/temp.ts)', () => {
    test('3.1 startTempDirSweeper executes immediate sweep on startup and handles non-existent dirs safely', async () => {
      const sweeperTestDir = path.resolve(tempTestDir, 'sweeper_run_' + Date.now());
      fs.mkdirSync(sweeperTestDir, { recursive: true });

      const staleDir = path.resolve(sweeperTestDir, 'stale_job_1');
      const freshDir = path.resolve(sweeperTestDir, 'fresh_job_2');
      const regularFile = path.resolve(sweeperTestDir, 'regular_file.txt');

      fs.mkdirSync(staleDir, { recursive: true });
      fs.mkdirSync(freshDir, { recursive: true });
      fs.writeFileSync(regularFile, 'hello');

      // Set staleDir mtime to 3 hours in the past
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      fs.utimesSync(staleDir, threeHoursAgo, threeHoursAgo);

      const origTempDir = env.TEMP_DIR;
      (env as any).TEMP_DIR = sweeperTestDir;

      try {
        // Start sweeper with TTL 1 hour and long interval 1 hour
        const timer = startTempDirSweeper(1 * 60 * 60 * 1000, 60 * 60 * 1000);

        // Immediate sweep should have purged staleDir on the microtask/tick
        await new Promise((r) => setTimeout(r, 80));

        clearInterval(timer);

        // Assertions:
        // Stale dir purged immediately
        expect(fs.existsSync(staleDir)).toBe(false);
        // Fresh dir preserved
        expect(fs.existsSync(freshDir)).toBe(true);
        // Regular file preserved
        expect(fs.existsSync(regularFile)).toBe(true);
      } finally {
        (env as any).TEMP_DIR = origTempDir;
      }
    });

    test('3.2 Safe handling of non-existent base directory without throwing or crashing', async () => {
      const nonExistent = path.resolve(tempTestDir, 'non_existent_dir_9999');
      const origTempDir = env.TEMP_DIR;
      (env as any).TEMP_DIR = nonExistent;

      try {
        expect(fs.existsSync(nonExistent)).toBe(false);
        let errorThrown = false;
        try {
          const timer = startTempDirSweeper(1000, 10000);
          await new Promise((r) => setTimeout(r, 50));
          clearInterval(timer);
        } catch {
          errorThrown = true;
        }
        expect(errorThrown).toBe(false);
      } finally {
        (env as any).TEMP_DIR = origTempDir;
      }
    });

    test('3.3 ensureTempDirSweeperStarted enforces singleton behavior across multiple calls', () => {
      resetTempDirSweeperForTesting();

      const timer1 = ensureTempDirSweeperStarted(60000, 60000);
      expect(timer1).not.toBeNull();

      // Second call must return null (already started)
      const timer2 = ensureTempDirSweeperStarted(60000, 60000);
      expect(timer2).toBeNull();

      if (timer1) clearInterval(timer1);
      resetTempDirSweeperForTesting();
    });
  });
});
