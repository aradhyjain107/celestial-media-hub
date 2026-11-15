import { expect, describe, test, vi, beforeEach } from 'vitest';
import { GET } from '../../src/app/api/experimental/turbo-download/route';
import { NextRequest } from 'next/server';
import { CelestialExtractor } from '../../src/lib/engine/extractor';
import { CelestialStreamer } from '../../src/lib/engine/pipe';
import { PassThrough } from 'node:stream';

vi.mock('../../src/lib/engine/extractor');
vi.mock('../../src/lib/engine/pipe');

describe('GET /api/experimental/turbo-download — Unit Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Authentication & Query Parameter Validation ────────────────────────
  describe('1. Authentication & Query Parameter Validation', () => {
    test('returns 401 Unauthorized when request lacks authorization', async () => {
      const req = new NextRequest('http://localhost:3000/api/experimental/turbo-download?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      const res = await GET(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    test('returns 400 Bad Request when url parameter is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/experimental/turbo-download', {
        headers: { authorization: 'Bearer user_test' },
      });
      const res = await GET(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Missing URL parameter');
    });
  });

  // ── 2. SSRF Domain Allowlist & Protocol Guards ─────────────────────────────
  describe('2. SSRF Domain Allowlist & URL Protocol Guards', () => {
    test('rejects malformed URL string with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/experimental/turbo-download?url=not_a_valid_url', {
        headers: { authorization: 'Bearer user_test' },
      });
      const res = await GET(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Malformed URL');
    });

    test('rejects non-http/https protocols (e.g. file://, ftp://, javascript:) with 400 Bad Request', async () => {
      const maliciousUrls = [
        'file:///etc/passwd',
        'ftp://www.youtube.com/resource',
        'javascript:alert(1)',
      ];

      for (const badUrl of maliciousUrls) {
        const req = new NextRequest(`http://localhost:3000/api/experimental/turbo-download?url=${encodeURIComponent(badUrl)}`, {
          headers: { authorization: 'Bearer user_test' },
        });
        const res = await GET(req);
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toContain('Only http/https protocols are allowed');
      }
    });

    test('rejects SSRF cloud metadata and internal domains with 400 Bad Request', async () => {
      const blockedUrls = [
        'http://169.254.169.254/latest/meta-data/',
        'http://localhost:3000/api/health',
        'http://127.0.0.1:8080/admin',
        'https://attacker-domain.evil.com/video.mp4',
        'https://dropbox.com/s/1234/test.mp4',
      ];

      for (const blocked of blockedUrls) {
        const req = new NextRequest(`http://localhost:3000/api/experimental/turbo-download?url=${encodeURIComponent(blocked)}`, {
          headers: { authorization: 'Bearer user_test' },
        });
        const res = await GET(req);
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toContain('Domain not in allowed media provider list');
      }
    });

    test('accepts all allowed provider domains (youtube, youtu.be, vimeo, soundcloud, googlevideo)', async () => {
      const allowedUrls = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ',
        'https://www.vimeo.com/123456789',
        'https://vimeo.com/123456789',
        'https://soundcloud.com/artist/track-name',
        'https://www.soundcloud.com/artist/track-name',
        'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        'https://rr1---sn-4g5ednls.googlevideo.com/videoplayback?expire=1234',
      ];

      // Mock extractor & streamer for successful response
      const fakePassThrough = new PassThrough();
      vi.mocked(CelestialExtractor.prototype.getMetadata).mockResolvedValue({
        title: 'Test Title',
        thumbnail: 'https://i.ytimg.com/thumb.jpg',
        duration: 120,
        streams: [
          { url: 'https://stream.video', mimeType: 'mp4', bitrate: 2000, quality: '1080p', contentLength: 1000, type: 'video' },
          { url: 'https://stream.audio', mimeType: 'm4a', bitrate: 128, quality: '128k', contentLength: 500, type: 'audio' },
        ],
      });
      vi.mocked(CelestialStreamer.prototype.mux).mockReturnValue(fakePassThrough as any);

      for (const allowedUrl of allowedUrls) {
        const req = new NextRequest(`http://localhost:3000/api/experimental/turbo-download?url=${encodeURIComponent(allowedUrl)}`, {
          headers: { authorization: 'Bearer user_test' },
        });
        const res = await GET(req);
        expect(res.status).toBe(200);
      }
    });
  });

  // ── 3. Stream Extraction & Fragmented MP4 Output ──────────────────────────
  describe('3. Stream Extraction & fMP4 Muxing Pipeline', () => {
    test('extracts metadata, selects highest bitrate streams, and streams fMP4 output with proper headers', async () => {
      const mockStreams = [
        { url: 'https://video.low', mimeType: 'mp4', bitrate: 500, quality: '480p', contentLength: 1000, type: 'video' as const },
        { url: 'https://video.high', mimeType: 'mp4', bitrate: 3000, quality: '1080p', contentLength: 5000, type: 'video' as const },
        { url: 'https://audio.low', mimeType: 'm4a', bitrate: 64, quality: '64k', contentLength: 200, type: 'audio' as const },
        { url: 'https://audio.high', mimeType: 'm4a', bitrate: 256, quality: '256k', contentLength: 800, type: 'audio' as const },
      ];

      vi.mocked(CelestialExtractor.prototype.getMetadata).mockResolvedValue({
        title: 'Celestial Space Symphony',
        thumbnail: 'https://i.ytimg.com/space.jpg',
        duration: 240,
        streams: mockStreams,
      });

      const fakeMuxStream = new PassThrough();
      vi.mocked(CelestialStreamer.prototype.mux).mockReturnValue(fakeMuxStream as any);

      const req = new NextRequest('http://localhost:3000/api/experimental/turbo-download?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
        headers: { authorization: 'Bearer user_test' },
      });

      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('video/mp4');
      expect(res.headers.get('Transfer-Encoding')).toBe('chunked');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(res.headers.get('Content-Disposition')).toBe(
        `attachment; filename="Celestial Space Symphony.mp4"; filename*=UTF-8''Celestial%20Space%20Symphony.mp4`
      );

      // Verify that highest bitrate streams were chosen
      expect(CelestialStreamer.prototype.mux).toHaveBeenCalledWith(
        [
          { url: 'https://video.high', type: 'video', contentLength: 5000 },
          { url: 'https://audio.high', type: 'audio', contentLength: 800 },
        ],
        { outputFormat: 'mp4' }
      );

      // Verify stream data reading
      const reader = res.body!.getReader();
      fakeMuxStream.write(Buffer.from('fMP4_HEADER_CHUNK'));
      fakeMuxStream.end();

      const chunk = await reader.read();
      expect(chunk.value).toEqual(new Uint8Array(Buffer.from('fMP4_HEADER_CHUNK')));
      const done = await reader.read();
      expect(done.done).toBe(true);
    });

    test('destroys muxedStream when client cancels web ReadableStream', async () => {
      vi.mocked(CelestialExtractor.prototype.getMetadata).mockResolvedValue({
        title: 'Cancel Test',
        thumbnail: 'https://i.ytimg.com/thumb.jpg',
        duration: 10,
        streams: [
          { url: 'https://v.mp4', mimeType: 'mp4', bitrate: 1000, contentLength: 100, type: 'video' },
          { url: 'https://a.mp4', mimeType: 'm4a', bitrate: 128, contentLength: 50, type: 'audio' },
        ],
      });

      const fakeMuxStream = new PassThrough();
      fakeMuxStream.destroy = vi.fn();
      vi.mocked(CelestialStreamer.prototype.mux).mockReturnValue(fakeMuxStream as any);

      const req = new NextRequest('http://localhost:3000/api/experimental/turbo-download?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
        headers: { authorization: 'Bearer user_test' },
      });

      const res = await GET(req);
      const reader = res.body!.getReader();
      await reader.cancel('User aborted');

      expect(fakeMuxStream.destroy).toHaveBeenCalled();
    });

    test('returns 500 sanitized error when suitable video/audio streams are missing', async () => {
      vi.mocked(CelestialExtractor.prototype.getMetadata).mockResolvedValue({
        title: 'No Streams',
        thumbnail: '',
        duration: 0,
        streams: [], // Empty streams array
      });

      const req = new NextRequest('http://localhost:3000/api/experimental/turbo-download?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
        headers: { authorization: 'Bearer user_test' },
      });

      const res = await GET(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    test('returns 500 sanitized error when extractor fails with runtime error', async () => {
      vi.mocked(CelestialExtractor.prototype.getMetadata).mockRejectedValue(new Error('yt-dlp binary crashed at /internal/bin/yt-dlp'));

      const req = new NextRequest('http://localhost:3000/api/experimental/turbo-download?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
        headers: { authorization: 'Bearer user_test' },
      });

      const res = await GET(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error).not.toContain('/internal/bin'); // Error sanitization
    });
  });
});
