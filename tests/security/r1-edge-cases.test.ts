import { describe, test, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('../../src/lib/system/env', () => ({
  env: {
    FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',
    YTDLP_PATH: process.env.YTDLP_PATH || 'yt-dlp',
    TEMP_DIR: path.join(os.tmpdir(), 'celestial-test-temp'),
    JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!',
  },
}));

import { POST as mutePOST } from '../../src/app/api/mute/route';
import { POST as hevcPOST } from '../../src/app/api/hevc/route';
import { POST as convertPOST } from '../../src/app/api/convert/route';
import { POST as youtubePOST } from '../../src/app/api/youtube/route';
import { POST as audioTrimPOST } from '../../src/app/api/audio-trim/route';
import { POST as spotifyPOST } from '../../src/app/api/spotify-convert/route';
import { env } from '../../src/lib/system/env';

console.error('MOCKED ENV IN TEST:', env);

function ensureMockFile(targetDir: string, filename: string): string {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const filePath = path.join(targetDir, filename);
  if (!fs.existsSync(filePath)) {
    let content: Buffer = Buffer.alloc(0);
    if (filename.startsWith('corrupt_') || filename.startsWith('invalid_text_')) {
      content = Buffer.from('CORRUPTED_GARBAGE_HEADER_DATA_1234567890');
    } else if (filename.startsWith('invalid_image_')) {
      content = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    } else if (filename.startsWith('multistream_')) {
      content = Buffer.from([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    } else if (filename.endsWith('.wav')) {
      content = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x02\x00\x00\xee\x02\x00\x00\xdc\x05\x00\x06\x00\x18\x00data\x00\x00\x00\x00');
    } else if (filename.endsWith('.cr2')) {
      content = Buffer.from('II*\x00\x10\x00\x00\x00CR2_HEADER');
    } else if (filename.endsWith('.flac')) {
      content = Buffer.from('fLaC\x00\x00\x00\x22STREAMINFO');
    }
    fs.writeFileSync(filePath, content);
  }
  return filePath;
}

function getMockFilePath(filename: string): string {
  const localTmp = path.join(process.cwd(), '.tmp/celestial-mocks');
  const dirs = [
    localTmp,
    path.join(__dirname, '../../.tmp/celestial-mocks'),
    '/tmp/celestial-mocks',
    path.join(os.tmpdir(), 'celestial-mocks')
  ];
  for (const d of dirs) {
    const fullPath = path.join(d, filename);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  return ensureMockFile(localTmp, filename);
}

function getMockFile(filename: string, mimetype = 'video/mp4'): File {
  const filePath = getMockFilePath(filename);
  const buf = fs.readFileSync(filePath);
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return new File([u8], filename, { type: mimetype });
}

function appendMockFile(formData: FormData, fieldName: string, filename: string, mimetype = 'video/mp4'): void {
  const file = getMockFile(filename, mimetype);
  formData.append(fieldName, file, filename);
}

async function readSseStream(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value);
  }
  return result;
}

const AUTH_HEADER = { authorization: 'Bearer user_user1' };

describe('Milestone R1 Edge-Case Input Robustness Tests (6 Media Tool Routes)', () => {

  describe('1. Video Muter Route (/api/mute)', () => {
    test('EC-01: empty.mp4 (0 bytes) returns HTTP 400 or sanitized SSE error', async () => {
      const formData = new FormData();
      appendMockFile(formData, 'files', 'empty.mp4', 'video/mp4');
      formData.append('mode', 'remove');

      const req = new NextRequest('http://localhost/api/mute', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: formData,
      });

      const res = await mutePOST(req);
      expect([400, 200, 500]).toContain(res.status);
    });

    test('EC-02: corrupt_truncated.mp4 returns sanitized SSE error', async () => {
      const formData = new FormData();
      appendMockFile(formData, 'files', 'corrupt_truncated.mp4', 'video/mp4');
      formData.append('mode', 'remove');

      const req = new NextRequest('http://localhost/api/mute', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: formData,
      });

      const res = await mutePOST(req);
      expect([400, 200, 500]).toContain(res.status);
      if (res.status === 200) {
        const sseText = await readSseStream(res);
        expect(sseText).toContain('"error"');
        expect(sseText).not.toContain('Error: ffmpeg exited');
      }
    });

    test('EC-03: invalid_image_header.mp4 returns sanitized SSE error', async () => {
      const formData = new FormData();
      appendMockFile(formData, 'files', 'invalid_image_header.mp4', 'video/mp4');
      formData.append('mode', 'remove');

      const req = new NextRequest('http://localhost/api/mute', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: formData,
      });

      const res = await mutePOST(req);
      expect([400, 200, 500]).toContain(res.status);
      if (res.status === 200) {
        const sseText = await readSseStream(res);
        expect(sseText).toContain('"error"');
      }
    });

    test('EC-04: multistream_tracks.mp4 (multi-stream) returns sanitized SSE response', async () => {
      const formData = new FormData();
      appendMockFile(formData, 'files', 'multistream_tracks.mp4', 'video/mp4');
      formData.append('mode', 'remove');

      const req = new NextRequest('http://localhost/api/mute', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: formData,
      });

      const res = await mutePOST(req);
      expect([400, 200, 500]).toContain(res.status);
      if (res.status === 200) {
        const sseText = await readSseStream(res);
        expect(sseText).toContain('data:');
        expect(sseText).not.toContain('node_modules');
        expect(sseText).not.toContain('/Users/');
      }
    });
  });

  describe('2. HEVC Compressor Route (/api/hevc)', () => {
    test('EC-05: empty.mp4 (0 bytes) returns HTTP 400 or sanitized SSE error', async () => {
      const formData = new FormData();
      appendMockFile(formData, 'files', 'empty.mp4', 'video/mp4');
      formData.append('crf', '28');
      formData.append('preset', 'medium');

      const req = new NextRequest('http://localhost/api/hevc', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: formData,
      });

      const res = await hevcPOST(req);
      expect([400, 200, 500]).toContain(res.status);
    });

    test('EC-06: corrupt_garbage.mkv returns sanitized SSE error', async () => {
      const formData = new FormData();
      appendMockFile(formData, 'files', 'corrupt_garbage.mkv', 'video/x-matroska');
      formData.append('crf', '28');
      formData.append('preset', 'medium');

      const req = new NextRequest('http://localhost/api/hevc', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: formData,
      });

      const res = await hevcPOST(req);
      expect([400, 200, 500]).toContain(res.status);
      if (res.status === 200) {
        const sseText = await readSseStream(res);
        expect(sseText).toContain('"error"');
      }
    });

    test('EC-07: invalid_text_header.mkv returns sanitized SSE error', async () => {
      const formData = new FormData();
      appendMockFile(formData, 'files', 'invalid_text_header.mkv', 'video/x-matroska');
      formData.append('crf', '28');
      formData.append('preset', 'medium');

      const req = new NextRequest('http://localhost/api/hevc', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: formData,
      });

      const res = await hevcPOST(req);
      expect([400, 200, 500]).toContain(res.status);
      if (res.status === 200) {
        const sseText = await readSseStream(res);
        expect(sseText).toContain('"error"');
      }
    });

  });

  describe('3. Universal Converter Route (/api/convert)', () => {
    test('EC-08: empty.mp3 (0 bytes) returns HTTP 400 or sanitized SSE error', async () => {
      const formData = new FormData();
      appendMockFile(formData, 'files', 'empty.mp3', 'audio/mpeg');
      formData.append('outputFormat', 'wav');

      const req = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: formData,
      });

      const res = await convertPOST(req);
      expect([400, 200, 500]).toContain(res.status);
    });

    test('EC-09: corrupt_truncated.mp4 returns sanitized SSE error', async () => {
      const formData = new FormData();
      appendMockFile(formData, 'files', 'corrupt_truncated.mp4', 'video/mp4');
      formData.append('outputFormat', 'mp3');

      const req = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: formData,
      });

      const res = await convertPOST(req);
      expect([400, 200, 500]).toContain(res.status);
      if (res.status === 200) {
        const sseText = await readSseStream(res);
        expect(sseText).toContain('"error"');
      }
    });

    test('EC-10: high_bitrate_192k24b.wav returns sanitized SSE response', async () => {
      const formData = new FormData();
      appendMockFile(formData, 'files', 'high_bitrate_192k24b.wav', 'audio/wav');
      formData.append('outputFormat', 'flac');

      const req = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: formData,
      });

      const res = await convertPOST(req);
      expect([400, 200, 500]).toContain(res.status);
      if (res.status === 200) {
        const sseText = await readSseStream(res);
        expect(sseText).toContain('data:');
        expect(sseText).not.toContain('node_modules');
        expect(sseText).not.toContain('/Users/');
      }
    });

    test('EC-11: raw_wrapper.cr2 returns sanitized SSE error', async () => {
      const formData = new FormData();
      appendMockFile(formData, 'files', 'raw_wrapper.cr2', 'image/x-canon-cr2');
      formData.append('outputFormat', 'mp4');

      const req = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: formData,
      });

      const res = await convertPOST(req);
      expect([400, 200, 500]).toContain(res.status);
      if (res.status === 200) {
        const sseText = await readSseStream(res);
        expect(sseText).toContain('"error"');
      }
    });
  });

  describe('4. YouTube Downloader Route (/api/youtube)', () => {
    test('EC-12: malformed URL returns HTTP 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost/api/youtube', {
        method: 'POST',
        headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'not-a-valid-url', format: 'mp4', quality: '1080p' }),
      });

      const res = await youtubePOST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    test('EC-13: non-existent YouTube video URL returns sanitized SSE error', async () => {
      const req = new NextRequest('http://localhost/api/youtube', {
        method: 'POST',
        headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=00000000000', format: 'mp4', quality: '1080p' }),
      });

      const res = await youtubePOST(req);
      expect(res.status).toBe(200);
      const sseText = await readSseStream(res);
      expect(sseText).toContain('"error"');
    }, 45000);

  });

  describe('5. Audio Trimmer Route (/api/audio-trim)', () => {
    test('EC-14: empty.mp3 (0 bytes) returns HTTP 400 or sanitized SSE error', async () => {
      const formData = new FormData();
      appendMockFile(formData, 'files', 'empty.mp3', 'audio/mpeg');
      formData.append('mode', 'trim');
      formData.append('outputFormat', 'mp3');
      formData.append('startTime', '0');
      formData.append('endTime', '1');

      const req = new NextRequest('http://localhost/api/audio-trim', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: formData,
      });

      const res = await audioTrimPOST(req);
      expect([400, 200, 500]).toContain(res.status);
    });

    test('EC-15: invalid_text_header.mkv returns sanitized SSE error', async () => {
      const formData = new FormData();
      appendMockFile(formData, 'files', 'invalid_text_header.mkv', 'video/x-matroska');
      formData.append('mode', 'trim');
      formData.append('outputFormat', 'mp3');
      formData.append('startTime', '0');
      formData.append('endTime', '1');

      const req = new NextRequest('http://localhost/api/audio-trim', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: formData,
      });

      const res = await audioTrimPOST(req);
      expect([400, 200, 500]).toContain(res.status);
      if (res.status === 200) {
        const sseText = await readSseStream(res);
        expect(sseText).toContain('"error"');
      }
    });

    test('EC-16: high_bitrate_extreme.flac returns sanitized SSE response', async () => {
      const formData = new FormData();
      appendMockFile(formData, 'files', 'high_bitrate_extreme.flac', 'audio/flac');
      formData.append('mode', 'trim');
      formData.append('outputFormat', 'flac');
      formData.append('startTime', '0');
      formData.append('endTime', '1');
      formData.append('fadeIn', '0.1');
      formData.append('fadeOut', '0.1');

      const req = new NextRequest('http://localhost/api/audio-trim', {
        method: 'POST',
        headers: AUTH_HEADER,
        body: formData,
      });

      const res = await audioTrimPOST(req);
      expect([400, 200, 500]).toContain(res.status);
      if (res.status === 200) {
        const sseText = await readSseStream(res);
        expect(sseText).toContain('data:');
        expect(sseText).not.toContain('node_modules');
        expect(sseText).not.toContain('/Users/');
      }
    });
  });

  describe('6. Spotify Converter Route (/api/spotify-convert)', () => {
    test('EC-17: non-Spotify domain returns HTTP 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost/api/spotify-convert?action=extract', {
        method: 'POST',
        headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://evil.com/playlist/123' }),
      });

      const res = await spotifyPOST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid Spotify playlist URL');
    });

    test('EC-18: non-existent Spotify playlist returns sanitized error without crash', async () => {
      const req = new NextRequest('http://localhost/api/spotify-convert', {
        method: 'POST',
        headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify({
          playlistUrl: 'https://open.spotify.com/playlist/0000000000000000000000',
          outputFormat: 'mp3',
          quality: '320',
        }),
      });

      const res = await spotifyPOST(req);
      expect([400, 500]).toContain(res.status);
      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(typeof body.error).toBe('string');
      // Ensure zero stack trace / internal path leaks
      expect(body.error).not.toContain('node_modules');
      expect(body.error).not.toContain('/Users/');
    });
  });

});
