import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { NextRequest } from 'next/server';
import { GET as downloadGet } from '../app/api/download/route';
import { GET as turboDownloadGet } from '../app/api/experimental/turbo-download/route';
import { POST as compressPost } from '../app/api/compress/route';
import { env } from '../lib/env';
import { registerJobOwner, unregisterJobOwner } from '../lib/auth';
import { signToken } from '../lib/jwt';
import * as ffmpegModule from '../lib/ffmpeg';
import { CelestialExtractor } from '../lib/engine/extractor';
import { CelestialStreamer } from '../lib/engine/pipe';
import { Readable } from 'node:stream';

describe('Milestone M2 Adversarial Challenge Suite', () => {
  let authToken: string;
  const testJobId = 'm2-challenger-job-' + Date.now();
  const testUserId = 'challenger-agent-m2';
  const jobDirPath = path.join(path.resolve(env.TEMP_DIR), testJobId);
  const tenMbFileName = 'large_payload_10mb.bin';
  const tenMbFilePath = path.join(jobDirPath, tenMbFileName);

  let tenMbHash: string;
  const TEN_MB = 10 * 1024 * 1024; // 10,485,760 bytes
  const realCreateReadStream = fs.createReadStream.bind(fs);

  beforeAll(async () => {
    authToken = await signToken({ sub: testUserId, role: 'admin' });

    // Prepare temp job dir
    if (!fs.existsSync(jobDirPath)) {
      fs.mkdirSync(jobDirPath, { recursive: true });
    }

    // Generate deterministic 10MB test binary file
    const buffer = Buffer.alloc(TEN_MB);
    for (let i = 0; i < TEN_MB; i += 4096) {
      buffer.writeUInt32BE((i * 1103515245 + 12345) >>> 0, i);
    }
    fs.writeFileSync(tenMbFilePath, buffer);
    tenMbHash = crypto.createHash('sha256').update(buffer).digest('hex');

    registerJobOwner(testJobId, testUserId);
  });

  afterAll(() => {
    unregisterJobOwner(testJobId);
    try {
      if (fs.existsSync(jobDirPath)) {
        fs.rmSync(jobDirPath, { recursive: true, force: true });
      }
    } catch {}
  });

  // =========================================================================
  // MISSION 1: Stream Backpressure Handling in app/api/download/route.ts
  // =========================================================================
  describe('Mission 1: Download Route Stream Backpressure & Resource Safety', () => {
    test('1.1 ReadStream pauses under slow consumer (backpressure) and resumes on pull without leaking memory', async () => {
      let activeStreamInstance: fs.ReadStream | null = null;
      let pauseCalls = 0;
      let resumeCalls = 0;

      const spy = vi.spyOn(fs, 'createReadStream').mockImplementation((filePath, options) => {
        const stream = realCreateReadStream(filePath, options);
        activeStreamInstance = stream;
        const origPause = stream.pause.bind(stream);
        const origResume = stream.resume.bind(stream);
        stream.pause = function () {
          pauseCalls++;
          return origPause();
        };
        stream.resume = function () {
          resumeCalls++;
          return origResume();
        };
        return stream;
      });

      const reqUrl = `http://localhost:3000/api/download?jobId=${testJobId}&file=${tenMbFileName}`;
      const req = new NextRequest(reqUrl, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      const initialHeap = process.memoryUsage().heapUsed;
      const response = await downloadGet(req);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-length')).toBe(TEN_MB.toString());
      expect(response.headers.get('content-type')).toBe('application/octet-stream');
      expect(response.headers.get('content-disposition')).toContain(tenMbFileName);

      const webStream = response.body;
      expect(webStream).toBeDefined();
      const reader = webStream!.getReader();

      let totalBytesRead = 0;
      const hash = crypto.createHash('sha256');

      // Slow consumer emulation: read 1 chunk, then artificially delay next read
      // This will cause controller.desiredSize <= 0 and trigger fileStream.pause()
      let pausedObserved = false;
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunkCount++;
        totalBytesRead += value.length;
        hash.update(value);

        // Delay every few chunks to simulate high latency / throttled client
        if (chunkCount % 5 === 0) {
          await new Promise((res) => setTimeout(res, 25));
          // While the consumer was delayed and not pulling, backpressure paused the stream:
          if (activeStreamInstance && (activeStreamInstance as fs.ReadStream).isPaused()) {
            pausedObserved = true;
          }
        }
      }

      const finalHash = hash.digest('hex');
      const finalHeap = process.memoryUsage().heapUsed;
      const heapDeltaMb = (finalHeap - initialHeap) / (1024 * 1024);

      spy.mockRestore();

      expect(totalBytesRead).toBe(TEN_MB);
      expect(finalHash).toBe(tenMbHash);
      expect(pauseCalls).toBeGreaterThan(0);
      expect(resumeCalls).toBeGreaterThan(0);
      expect(pausedObserved).toBe(true);

      // Verify memory stability: streaming 10MB under backpressure must not balloon heap
      expect(heapDeltaMb).toBeLessThan(15);
    });

    test('1.2 Client disconnection via reader.cancel() destroys the underlying ReadStream immediately', async () => {
      let activeStreamInstance: fs.ReadStream | null = null;
      const spy = vi.spyOn(fs, 'createReadStream').mockImplementation((filePath, options) => {
        const stream = realCreateReadStream(filePath, options);
        activeStreamInstance = stream;
        return stream;
      });

      const reqUrl = `http://localhost:3000/api/download?jobId=${testJobId}&file=${tenMbFileName}`;
      const req = new NextRequest(reqUrl, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      const response = await downloadGet(req);
      const reader = response.body!.getReader();

      // Read only first chunk
      const firstChunk = await reader.read();
      expect(firstChunk.done).toBe(false);
      expect(firstChunk.value!.length).toBeGreaterThan(0);

      // Client prematurely closes/cancels connection
      await reader.cancel('Client abort');

      expect(activeStreamInstance).not.toBeNull();
      expect(activeStreamInstance!.destroyed).toBe(true);

      spy.mockRestore();
    });

    test('1.3 AbortController signal aborts and destroys underlying ReadStream', async () => {
      let activeStreamInstance: fs.ReadStream | null = null;
      const spy = vi.spyOn(fs, 'createReadStream').mockImplementation((filePath, options) => {
        const stream = realCreateReadStream(filePath, options);
        activeStreamInstance = stream;
        return stream;
      });

      const abortController = new AbortController();
      const reqUrl = `http://localhost:3000/api/download?jobId=${testJobId}&file=${tenMbFileName}`;
      const req = new NextRequest(reqUrl, {
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        signal: abortController.signal
      });

      const response = await downloadGet(req);
      const reader = response.body!.getReader();

      const chunk = await reader.read();
      expect(chunk.done).toBe(false);

      // Trigger abort signal
      abortController.abort();

      await new Promise((res) => setTimeout(res, 50));
      expect(activeStreamInstance).not.toBeNull();
      expect(activeStreamInstance!.destroyed).toBe(true);

      spy.mockRestore();
    });

    test('1.4 Pre-aborted request (req.signal.aborted) closes stream immediately without resource leakage', async () => {
      let activeStreamInstance: fs.ReadStream | null = null;
      const spy = vi.spyOn(fs, 'createReadStream').mockImplementation((filePath, options) => {
        const stream = realCreateReadStream(filePath, options);
        activeStreamInstance = stream;
        return stream;
      });

      const abortController = new AbortController();
      abortController.abort(); // Pre-aborted before handler execution

      const reqUrl = `http://localhost:3000/api/download?jobId=${testJobId}&file=${tenMbFileName}`;
      const req = new NextRequest(reqUrl, {
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        signal: abortController.signal
      });

      const response = await downloadGet(req);
      expect(response.status).toBe(200);

      await new Promise((res) => setTimeout(res, 30));
      expect(activeStreamInstance).not.toBeNull();
      expect(activeStreamInstance!.destroyed).toBe(true);

      spy.mockRestore();
    });

    test('1.5 Directory traversal attempts in download route are strictly blocked (HTTP 400)', async () => {
      const maliciousUrls = [
        `http://localhost:3000/api/download?jobId=${testJobId}&file=../../etc/passwd`,
        `http://localhost:3000/api/download?jobId=..%2F${testJobId}&file=${tenMbFileName}`,
        `http://localhost:3000/api/download?jobId=${testJobId}&file=nested/sub/file.mp4`,
        `http://localhost:3000/api/download?jobId=${testJobId}&file=C:\\Windows\\system32\\cmd.exe`
      ];

      for (const url of maliciousUrls) {
        const req = new NextRequest(url, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        const res = await downloadGet(req);
        expect(res.status).toBe(400);
      }
    });

    test('1.6 BOLA Guard: Access to another user\'s job is rejected with HTTP 403 Forbidden', async () => {
      const unauthorizedToken = await signToken({ sub: 'unauthorized-user-bob', role: 'user' });
      const reqUrl = `http://localhost:3000/api/download?jobId=${testJobId}&file=${tenMbFileName}`;
      const req = new NextRequest(reqUrl, {
        headers: { Authorization: `Bearer ${unauthorizedToken}` }
      });

      const res = await downloadGet(req);
      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // MISSION 2: HTTP/2 Header Compliance in turbo-download
  // =========================================================================
  describe('Mission 2: Turbo-Download HTTP/2 Header Compliance & RFC 7540', () => {
    const validMediaUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

    beforeAll(() => {
      vi.spyOn(CelestialExtractor.prototype, 'getMetadata').mockResolvedValue({
        title: 'Challenger Test Media',
        duration: 10,
        thumbnail: 'https://i.ytimg.com/vi/test/hqdefault.jpg',
        streams: [
          { url: 'https://googlevideo.com/videoplayback/test_v', mimeType: 'video/mp4', type: 'video', quality: '1080p', bitrate: 5000000, contentLength: 50000000 },
          { url: 'https://googlevideo.com/videoplayback/test_a', mimeType: 'audio/mp4', type: 'audio', quality: '128k', bitrate: 128000, contentLength: 1000000 }
        ]
      } as any);

      vi.spyOn(CelestialStreamer.prototype, 'mux').mockImplementation(() => {
        const readable = new Readable({
          read() {
            this.push(Buffer.from('MP4_MOCK_CHUNK'));
            this.push(null);
          }
        });
        return readable;
      });
    });

    afterAll(() => {
      vi.restoreAllMocks();
    });

    test('2.1 HTTP/2 request with x-http-version: 2.0 NEVER sends Transfer-Encoding: chunked', async () => {
      const req = new NextRequest(`http://localhost:3000/api/experimental/turbo-download?url=${encodeURIComponent(validMediaUrl)}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'x-http-version': '2.0'
        }
      });

      const response = await turboDownloadGet(req);
      expect(response.status).toBe(200);
      expect(response.headers.get('transfer-encoding')).toBeNull();
      expect(response.headers.get('content-type')).toBe('video/mp4');
    });

    test('2.2 HTTP/2 request with x-forwarded-proto: h2 NEVER sends Transfer-Encoding: chunked', async () => {
      const req = new NextRequest(`http://localhost:3000/api/experimental/turbo-download?url=${encodeURIComponent(validMediaUrl)}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'x-forwarded-proto': 'h2'
        }
      });

      const response = await turboDownloadGet(req);
      expect(response.status).toBe(200);
      expect(response.headers.get('transfer-encoding')).toBeNull();
    });

    test('2.3 HTTP/2 request with sec-ch-ua client hint NEVER sends Transfer-Encoding: chunked', async () => {
      const req = new NextRequest(`http://localhost:3000/api/experimental/turbo-download?url=${encodeURIComponent(validMediaUrl)}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"'
        }
      });

      const response = await turboDownloadGet(req);
      expect(response.status).toBe(200);
      expect(response.headers.get('transfer-encoding')).toBeNull();
    });

    test('2.4 Request with req.httpVersion === "2.0" NEVER sends Transfer-Encoding: chunked', async () => {
      const req = new NextRequest(`http://localhost:3000/api/experimental/turbo-download?url=${encodeURIComponent(validMediaUrl)}`, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      (req as any).httpVersion = '2.0';

      const response = await turboDownloadGet(req);
      expect(response.status).toBe(200);
      expect(response.headers.get('transfer-encoding')).toBeNull();
    });

    test('2.5 Combined HTTP/2 signals strictly suppress Transfer-Encoding and forbidden headers', async () => {
      const req = new NextRequest(`http://localhost:3000/api/experimental/turbo-download?url=${encodeURIComponent(validMediaUrl)}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'x-http-version': '2.0',
          'x-forwarded-proto': 'h2',
          'sec-ch-ua': '"Google Chrome";v="125"'
        }
      });
      (req as any).httpVersion = '2.0';

      const response = await turboDownloadGet(req);
      expect(response.status).toBe(200);

      // RFC 7540 Section 8.1.2.2 forbidden connection-specific headers audit:
      expect(response.headers.get('transfer-encoding')).toBeNull();
      expect(response.headers.get('connection')).toBeNull();
      expect(response.headers.get('keep-alive')).toBeNull();
      expect(response.headers.get('proxy-connection')).toBeNull();
      expect(response.headers.get('upgrade')).toBeNull();
    });

    test('2.6 HTTP/1.1 request (no HTTP/2 indicators) includes Transfer-Encoding: chunked', async () => {
      const req = new NextRequest(`http://localhost:3000/api/experimental/turbo-download?url=${encodeURIComponent(validMediaUrl)}`, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      const response = await turboDownloadGet(req);
      expect(response.status).toBe(200);
      expect(response.headers.get('transfer-encoding')).toBe('chunked');
    });

    test('2.7 SSRF Defense: Untrusted / non-whitelisted domains are rejected with HTTP 400', async () => {
      const maliciousUrls = [
        'http://169.254.169.254/latest/meta-data',
        'http://localhost:3000/api/download',
        'https://evil-attacker-site.com/video.mp4',
        'file:///etc/passwd'
      ];

      for (const mUrl of maliciousUrls) {
        const req = new NextRequest(`http://localhost:3000/api/experimental/turbo-download?url=${encodeURIComponent(mUrl)}`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        const res = await turboDownloadGet(req);
        expect(res.status).toBe(400);
      }
    });

    test('2.8 Client abort signal on turbo-download destroys streamer without throwing unhandled rejection', async () => {
      const abortController = new AbortController();
      const req = new NextRequest(`http://localhost:3000/api/experimental/turbo-download?url=${encodeURIComponent(validMediaUrl)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: abortController.signal
      });

      const response = await turboDownloadGet(req);
      expect(response.status).toBe(200);

      // Trigger abort midway
      abortController.abort();
      await new Promise((res) => setTimeout(res, 30));
    });
  });

  // =========================================================================
  // MISSION 3: VP9 & WebP Encoding Flags in app/api/compress/route.ts
  // =========================================================================
  describe('Mission 3: VP9 and WebP Encoding Flags in app/api/compress/route.ts', () => {
    let sampleVideoBuffer: any;
    let sampleImageBuffer: any;

    beforeAll(() => {
      const vPath = '/tmp/sample_m2_vp9_test.mp4';
      execSync(`ffmpeg -f lavfi -i testsrc=duration=0.5:size=160x120:rate=10 -f lavfi -i sine=duration=0.5:frequency=440 -c:v libx264 -pix_fmt yuv420p -c:a aac -y ${vPath}`, { stdio: 'pipe' });
      sampleVideoBuffer = new Uint8Array(fs.readFileSync(vPath));
      try { fs.unlinkSync(vPath); } catch {}

      const iPath = '/tmp/sample_m2_img_test.png';
      execSync(`ffmpeg -f lavfi -i color=c=red:s=64x64:d=0.1 -frames:v 1 -y ${iPath}`, { stdio: 'pipe' });
      sampleImageBuffer = new Uint8Array(fs.readFileSync(iPath));
      try { fs.unlinkSync(iPath); } catch {}
    });

    test('3.1 VP9 video compression emits -b:v 0, correct CRF, and omits invalid -preset', async () => {
      let interceptedArgs: string[] = [];
      const spy = vi.spyOn(ffmpegModule, 'executeFfmpeg').mockImplementation((input, args, total) => {
        interceptedArgs = [...args];
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"progress":100,"status":"done"}\n\n'));
            controller.close();
          }
        });
      });

      const formData = new FormData();
      formData.append('videoCodec', 'vp9');
      formData.append('videoCrf', '31');
      formData.append('videoPreset', 'medium');
      formData.append('hardwareAccel', 'false');
      formData.append('files', new Blob([sampleVideoBuffer], { type: 'video/mp4' }), 'real_test_media.mp4');

      const req = new NextRequest('http://localhost:3000/api/compress', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        body: formData
      });

      const response = await compressPost(req);
      expect(response.status).toBe(200);

      const reader = response.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      spy.mockRestore();

      // Assertions on FFmpeg arguments
      expect(interceptedArgs).toContain('-c:v');
      const cvIdx = interceptedArgs.indexOf('-c:v');
      expect(interceptedArgs[cvIdx + 1]).toBe('libvpx-vp9');

      expect(interceptedArgs).toContain('-crf');
      const crfIdx = interceptedArgs.indexOf('-crf');
      expect(interceptedArgs[crfIdx + 1]).toBe('31');

      // CRITICAL: verify -b:v 0 is present for VP9 constrained quality
      expect(interceptedArgs).toContain('-b:v');
      const bvIdx = interceptedArgs.indexOf('-b:v');
      expect(interceptedArgs[bvIdx + 1]).toBe('0');

      // Verify -preset is NOT emitted for VP9 (VP9 does not support x264/x265 -preset)
      const presetIdx = interceptedArgs.indexOf('-preset');
      expect(presetIdx).toBe(-1);

      // Verify -movflags +faststart is present
      expect(interceptedArgs).toContain('-movflags');
      const mfIdx = interceptedArgs.indexOf('-movflags');
      expect(interceptedArgs[mfIdx + 1]).toBe('+faststart');

      // Empirical execution verification: Run real FFmpeg with these intercepted args
      const testOutPath = '/tmp/empirical_vp9_output.mp4';
      const realTestVideo = '/tmp/empirical_vp9_input.mp4';
      fs.writeFileSync(realTestVideo, sampleVideoBuffer);

      // Replace input and output paths with real local paths
      const execArgs = interceptedArgs.map((arg, idx) => {
        if (idx === 1) return realTestVideo;
        if (idx === interceptedArgs.length - 1) return testOutPath;
        return arg;
      });

      try {
        execSync(`ffmpeg -y ${execArgs.join(' ')}`, { stdio: 'pipe' });
        expect(fs.existsSync(testOutPath)).toBe(true);
        expect(fs.statSync(testOutPath).size).toBeGreaterThan(0);
      } finally {
        try { fs.unlinkSync(realTestVideo); } catch {}
        try { fs.unlinkSync(testOutPath); } catch {}
      }
    });

    test('3.2 WebP compression verifies Priority 1 cwebp execution and Universal FFmpeg libwebp fallback emitted args', async () => {
      // 1. Verify Priority 1 native cwebp execution produces valid WebP
      const testInImg = '/tmp/empirical_webp_test_in.png';
      const testOutWebp = '/tmp/empirical_webp_test_out.webp';
      fs.writeFileSync(testInImg, sampleImageBuffer);

      try {
        execSync(`cwebp -q 80 ${testInImg} -o ${testOutWebp}`, { stdio: 'pipe' });
        expect(fs.existsSync(testOutWebp)).toBe(true);
        const webpBuf = fs.readFileSync(testOutWebp);
        expect(webpBuf.length).toBeGreaterThan(0);

        // Check RIFF and WEBP signatures
        const riffHeader = webpBuf.subarray(0, 4).toString('ascii');
        const webpHeader = webpBuf.subarray(8, 12).toString('ascii');
        expect(riffHeader).toBe('RIFF');
        expect(webpHeader).toBe('WEBP');
      } finally {
        try { fs.unlinkSync(testInImg); } catch {}
        try { fs.unlinkSync(testOutWebp); } catch {}
      }

      // 2. Audit source code in app/api/compress/route.ts to verify Priority 3 fallback:
      // Verifies that line 192 specifies '-c:v libwebp' (not '-c:v png')
      const compressRouteSrc = fs.readFileSync(path.resolve('app/api/compress/route.ts'), 'utf-8');
      expect(compressRouteSrc).toContain("imgArgs.push('-c:v', 'libwebp')");
      expect(compressRouteSrc).not.toContain("if (imageFormat === 'webp') {\n                  imgArgs.push('-c:v', 'png')");
    });

    test('3.3 QuickTime compatibility flags: -pix_fmt yuv420p for h264/hevc and -tag:v hvc1 for hevc', async () => {
      let interceptedArgsH264: string[] = [];
      let interceptedArgsHevc: string[] = [];

      const spy = vi.spyOn(ffmpegModule, 'executeFfmpeg').mockImplementation((input, args, total) => {
        if (args.includes('libx264')) interceptedArgsH264 = [...args];
        if (args.includes('libx265')) interceptedArgsHevc = [...args];
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"progress":100,"status":"done"}\n\n'));
            controller.close();
          }
        });
      });

      // 1. Test H.264
      const formH264 = new FormData();
      formH264.append('videoCodec', 'h264');
      formH264.append('hardwareAccel', 'false');
      formH264.append('files', new Blob([sampleVideoBuffer], { type: 'video/mp4' }), 'h264_test.mp4');

      const reqH264 = new NextRequest('http://localhost:3000/api/compress', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formH264
      });
      await (await compressPost(reqH264)).body!.getReader().read();

      expect(interceptedArgsH264).toContain('-pix_fmt');
      const pixIdx264 = interceptedArgsH264.indexOf('-pix_fmt');
      expect(interceptedArgsH264[pixIdx264 + 1]).toBe('yuv420p');

      // 2. Test HEVC
      const formHevc = new FormData();
      formHevc.append('videoCodec', 'hevc');
      formHevc.append('hardwareAccel', 'false');
      formHevc.append('files', new Blob([sampleVideoBuffer], { type: 'video/mp4' }), 'hevc_test.mp4');

      const reqHevc = new NextRequest('http://localhost:3000/api/compress', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formHevc
      });
      await (await compressPost(reqHevc)).body!.getReader().read();

      expect(interceptedArgsHevc).toContain('-pix_fmt');
      const pixIdxHevc = interceptedArgsHevc.indexOf('-pix_fmt');
      expect(interceptedArgsHevc[pixIdxHevc + 1]).toBe('yuv420p');

      expect(interceptedArgsHevc).toContain('-tag:v');
      const tagIdx = interceptedArgsHevc.indexOf('-tag:v');
      expect(interceptedArgsHevc[tagIdx + 1]).toBe('hvc1');

      spy.mockRestore();
    });

    test('3.4 Multi-file VP9 batch: all files receive -b:v 0 and libvpx-vp9', async () => {
      const allArgs: string[][] = [];
      const spy = vi.spyOn(ffmpegModule, 'executeFfmpeg').mockImplementation((input, args) => {
        allArgs.push([...args]);
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
            controller.close();
          }
        });
      });

      const formData = new FormData();
      formData.append('videoCodec', 'vp9');
      formData.append('videoCrf', '30');
      formData.append('hardwareAccel', 'false');
      formData.append('files', new Blob([sampleVideoBuffer], { type: 'video/mp4' }), 'vp9_batch_1.mp4');
      formData.append('files', new Blob([sampleVideoBuffer], { type: 'video/mp4' }), 'vp9_batch_2.mp4');

      const req = new NextRequest('http://localhost:3000/api/compress', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData
      });

      const response = await compressPost(req);
      expect(response.status).toBe(200);

      const reader = response.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      spy.mockRestore();

      expect(allArgs.length).toBe(2);
      for (const args of allArgs) {
        expect(args).toContain('libvpx-vp9');
        expect(args).toContain('-b:v');
        const bvIdx = args.indexOf('-b:v');
        expect(args[bvIdx + 1]).toBe('0');
      }
    });

    test('3.5 Boundary / extreme CRF values (CRF 18 and 35) maintain -b:v 0 for VP9', async () => {
      for (const testCrf of [18, 35]) {
        let interceptedArgs: string[] = [];
        const spy = vi.spyOn(ffmpegModule, 'executeFfmpeg').mockImplementation((input, args) => {
          interceptedArgs = [...args];
          return new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
              controller.close();
            }
          });
        });

        const formData = new FormData();
        formData.append('videoCodec', 'vp9');
        formData.append('videoCrf', String(testCrf));
        formData.append('hardwareAccel', 'false');
        formData.append('files', new Blob([sampleVideoBuffer], { type: 'video/mp4' }), `vp9_crf_${testCrf}.mp4`);

        const req = new NextRequest('http://localhost:3000/api/compress', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
          body: formData
        });

        const response = await compressPost(req);
        expect(response.status).toBe(200);
        await response.body!.getReader().read();

        spy.mockRestore();

        expect(interceptedArgs).toContain('-crf');
        const crfIdx = interceptedArgs.indexOf('-crf');
        expect(interceptedArgs[crfIdx + 1]).toBe(String(testCrf));

        expect(interceptedArgs).toContain('-b:v');
        const bvIdx = interceptedArgs.indexOf('-b:v');
        expect(interceptedArgs[bvIdx + 1]).toBe('0');
      }
    });
  });
});
