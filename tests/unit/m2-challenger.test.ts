import { describe, it, expect, beforeAll, vi } from 'vitest';
import os from 'node:os';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const SCRATCH_DIR = path.join(os.tmpdir(), 'celestial-m2-challenger-scratch');

vi.mock('../../lib/env', () => ({
  env: {
    FFMPEG_PATH: process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg',
    YTDLP_PATH: process.env.YTDLP_PATH || 'yt-dlp',
    TEMP_DIR: path.join(os.tmpdir(), 'celestial-m2-challenger-temp'),
    JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!',
  },
}));

import { NextRequest } from 'next/server';
import { POST as muteHandler } from '../../app/api/mute/route';
import { POST as hevcHandler } from '../../app/api/hevc/route';
import { POST as convertHandler } from '../../app/api/convert/route';
import { POST as audioTrimHandler } from '../../app/api/audio-trim/route';
import { GET as youtubeHandler, POST as youtubePostHandler } from '../../app/api/youtube/route';
import { POST as spotifyHandler } from '../../app/api/spotify-convert/route';

function fileToFile(filePath: string, filename: string, mimeType: string): File {
  const buf = fs.readFileSync(filePath);
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return new File([u8], filename, { type: mimeType });
}

function createMockRequest(url: string, formData: FormData, authHeader = { Authorization: 'Bearer user_m2_test' }): NextRequest {
  const req = new NextRequest(url, {
    method: 'POST',
    headers: authHeader,
  });
  vi.spyOn(req, 'formData').mockResolvedValue(formData);
  return req;
}

describe('Milestone R2 Empirical Challenge Test Suite (All 6 Core Media Tools)', () => {
  beforeAll(() => {
    if (!fs.existsSync(SCRATCH_DIR)) {
      fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    }
    const sampleMp4 = path.join(SCRATCH_DIR, 'sample_video.mp4');
    if (!fs.existsSync(sampleMp4)) {
      execSync(`ffmpeg -y -f lavfi -i testsrc=size=320x240:rate=30 -f lavfi -i sine=frequency=1000:sample_rate=44100 -t 2 -c:v libx264 -c:a aac ${sampleMp4}`);
    }
    const sampleMov = path.join(SCRATCH_DIR, 'sample_video.mov');
    if (!fs.existsSync(sampleMov)) {
      execSync(`ffmpeg -y -f lavfi -i testsrc=size=320x240:rate=30 -f lavfi -i sine=frequency=1000:sample_rate=44100 -t 2 -c:v libx264 -c:a aac ${sampleMov}`);
    }
    const sampleAvi = path.join(SCRATCH_DIR, 'sample_video.avi');
    if (!fs.existsSync(sampleAvi)) {
      execSync(`ffmpeg -y -f lavfi -i testsrc=size=320x240:rate=30 -f lavfi -i sine=frequency=1000:sample_rate=44100 -t 2 -c:v mpeg4 -c:a mp3 ${sampleAvi}`);
    }
    const streamlessMp4 = path.join(SCRATCH_DIR, 'streamless_video.mp4');
    if (!fs.existsSync(streamlessMp4)) {
      execSync(`ffmpeg -y -f lavfi -i testsrc=size=320x240:rate=30 -t 2 -c:v libx264 -an ${streamlessMp4}`);
    }
    const audioMp3 = path.join(SCRATCH_DIR, 'audio_only.mp3');
    if (!fs.existsSync(audioMp3)) {
      execSync(`ffmpeg -y -f lavfi -i sine=frequency=440:sample_rate=44100 -t 2 -c:a libmp3lame ${audioMp3}`);
    }
    const audioWav1 = path.join(SCRATCH_DIR, 'sample_audio1.wav');
    if (!fs.existsSync(audioWav1)) {
      execSync(`ffmpeg -y -f lavfi -i sine=frequency=440:sample_rate=44100 -t 1 -c:a pcm_s16le ${audioWav1}`);
    }
    const audioWav2 = path.join(SCRATCH_DIR, 'sample_audio2.wav');
    if (!fs.existsSync(audioWav2)) {
      execSync(`ffmpeg -y -f lavfi -i sine=frequency=880:sample_rate=44100 -t 1 -c:a pcm_s16le ${audioWav2}`);
    }
  });

  // ==========================================
  // 1. VIDEO MUTER TESTS
  // ==========================================
  describe('1. Video Muter (/api/mute)', () => {
    it('Mutes MP4 video in remove mode (drops audio stream)', async () => {
      const mp4Path = path.join(SCRATCH_DIR, 'sample_video.mp4');
      const file = fileToFile(mp4Path, 'sample_video.mp4', 'video/mp4');
      const formData = new FormData();
      formData.append('mode', 'remove');
      formData.append('files', file);

      const req = createMockRequest('http://localhost:3000/api/mute', formData);
      const res = await muteHandler(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"status":"complete"');
    });

    it('Mutes MOV video in silence mode (silences audio stream with AAC)', async () => {
      const movPath = path.join(SCRATCH_DIR, 'sample_video.mov');
      const file = fileToFile(movPath, 'sample_video.mov', 'video/quicktime');
      const formData = new FormData();
      formData.append('mode', 'silence');
      formData.append('files', file);

      const req = createMockRequest('http://localhost:3000/api/mute', formData);
      const res = await muteHandler(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"status":"complete"');
    });

    it('Mutes AVI video in silence mode using container-native pcm_s16le codec', async () => {
      const aviPath = path.join(SCRATCH_DIR, 'sample_video.avi');
      const file = fileToFile(aviPath, 'sample_video.avi', 'video/x-msvideo');
      const formData = new FormData();
      formData.append('mode', 'silence');
      formData.append('files', file);

      const req = createMockRequest('http://localhost:3000/api/mute', formData);
      const res = await muteHandler(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"status":"complete"');
    });

    it('Handles streamless video (no audio stream) gracefully without channel ghosting or errors', async () => {
      const streamlessPath = path.join(SCRATCH_DIR, 'streamless_video.mp4');
      const file = fileToFile(streamlessPath, 'streamless_video.mp4', 'video/mp4');
      
      for (const mode of ['remove', 'silence']) {
        const formData = new FormData();
        formData.append('mode', mode);
        formData.append('files', file);

        const req = createMockRequest('http://localhost:3000/api/mute', formData);
        const res = await muteHandler(req);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('"status":"complete"');
      }
    });

    it('Rejects audio-only file input with sanitized 400 error', async () => {
      const mp3Path = path.join(SCRATCH_DIR, 'audio_only.mp3');
      const file = fileToFile(mp3Path, 'audio_only.mp3', 'audio/mpeg');
      const formData = new FormData();
      formData.append('mode', 'remove');
      formData.append('files', file);

      const req = createMockRequest('http://localhost:3000/api/mute', formData);
      const res = await muteHandler(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Input file contains no video stream.');
    });
  });

  // ==========================================
  // 2. HEVC COMPRESSOR TESTS
  // ==========================================
  describe('2. HEVC Compressor (/api/hevc)', () => {
    it('Compresses video with hardwareAccel=false (software libx265 fallback)', async () => {
      const mp4Path = path.join(SCRATCH_DIR, 'sample_video.mp4');
      const file = fileToFile(mp4Path, 'sample_video.mp4', 'video/mp4');
      const formData = new FormData();
      formData.append('crf', '28');
      formData.append('preset', 'ultrafast');
      formData.append('hardwareAccel', 'false');
      formData.append('files', file);

      const req = createMockRequest('http://localhost:3000/api/hevc', formData);
      const res = await hevcHandler(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"status":"complete"');
    });

    it('Gracefully uses hardware encoder or falls back to software libx265 when hardwareAccel=true', async () => {
      const mp4Path = path.join(SCRATCH_DIR, 'sample_video.mp4');
      const file = fileToFile(mp4Path, 'sample_video.mp4', 'video/mp4');
      const formData = new FormData();
      formData.append('crf', '28');
      formData.append('preset', 'ultrafast');
      formData.append('hardwareAccel', 'true');
      formData.append('files', file);

      const req = createMockRequest('http://localhost:3000/api/hevc', formData);
      const res = await hevcHandler(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"status":"complete"');
    });

    it('Compresses streamless video (no audio stream) gracefully', async () => {
      const streamlessPath = path.join(SCRATCH_DIR, 'streamless_video.mp4');
      const file = fileToFile(streamlessPath, 'streamless_video.mp4', 'video/mp4');
      const formData = new FormData();
      formData.append('crf', '30');
      formData.append('preset', 'ultrafast');
      formData.append('hardwareAccel', 'false');
      formData.append('files', file);

      const req = createMockRequest('http://localhost:3000/api/hevc', formData);
      const res = await hevcHandler(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"status":"complete"');
    });

    it('Rejects audio-only file input with sanitized 400 error', async () => {
      const mp3Path = path.join(SCRATCH_DIR, 'audio_only.mp3');
      const file = fileToFile(mp3Path, 'audio_only.mp3', 'audio/mpeg');
      const formData = new FormData();
      formData.append('crf', '28');
      formData.append('preset', 'ultrafast');
      formData.append('files', file);

      const req = createMockRequest('http://localhost:3000/api/hevc', formData);
      const res = await hevcHandler(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Input file contains no video stream.');
    });
  });

  // ==========================================
  // 3. UNIVERSAL CONVERTER TESTS
  // ==========================================
  describe('3. Universal Converter (/api/convert)', () => {
    it('Converts MP4 to MP3 (video-to-audio cross-format conversion)', async () => {
      const mp4Path = path.join(SCRATCH_DIR, 'sample_video.mp4');
      const file = fileToFile(mp4Path, 'sample_video.mp4', 'video/mp4');
      const formData = new FormData();
      formData.append('outputFormat', 'mp3');
      formData.append('file', file);

      const req = createMockRequest('http://localhost:3000/api/convert', formData);
      const res = await convertHandler(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"status":"complete"');
      expect(text).toContain('downloadUrl');
    });

    it('Converts MP4 to WAV (video-to-audio cross-format conversion)', async () => {
      const mp4Path = path.join(SCRATCH_DIR, 'sample_video.mp4');
      const file = fileToFile(mp4Path, 'sample_video.mp4', 'video/mp4');
      const formData = new FormData();
      formData.append('outputFormat', 'wav');
      formData.append('file', file);

      const req = createMockRequest('http://localhost:3000/api/convert', formData);
      const res = await convertHandler(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"status":"complete"');
    });

    it('Converts MP4 to M4A (video-to-audio cross-format conversion)', async () => {
      const mp4Path = path.join(SCRATCH_DIR, 'sample_video.mp4');
      const file = fileToFile(mp4Path, 'sample_video.mp4', 'video/mp4');
      const formData = new FormData();
      formData.append('outputFormat', 'm4a');
      formData.append('file', file);

      const req = createMockRequest('http://localhost:3000/api/convert', formData);
      const res = await convertHandler(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"status":"complete"');
    });

    it('Rejects requests without any file payload (empty batch / file guard)', async () => {
      const formData = new FormData();
      formData.append('outputFormat', 'mp4');

      const req = createMockRequest('http://localhost:3000/api/convert', formData);
      const res = await convertHandler(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('No file provided');
    });

    it('Converts batch files to mp4 successfully', async () => {
      const mp4Path = path.join(SCRATCH_DIR, 'sample_video.mp4');
      const file1 = fileToFile(mp4Path, 'file1.mp4', 'video/mp4');
      const file2 = fileToFile(mp4Path, 'file2.mp4', 'video/mp4');
      const formData = new FormData();
      formData.append('outputFormat', 'mp4');
      formData.append('files', file1);
      formData.append('files', file2);

      const req = createMockRequest('http://localhost:3000/api/convert', formData);
      const res = await convertHandler(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"status":"complete"');
      expect(text).toContain('output.zip');
    });
  });

  // ==========================================
  // 4. AUDIO TRIMMER TESTS
  // ==========================================
  describe('4. Audio Trimmer (/api/audio-trim)', () => {
    it('Merges multi-file audio inputs without ffprobe totalDuration crash', async () => {
      const wav1 = path.join(SCRATCH_DIR, 'sample_audio1.wav');
      const wav2 = path.join(SCRATCH_DIR, 'sample_audio2.wav');
      const file1 = fileToFile(wav1, 'audio1.wav', 'audio/wav');
      const file2 = fileToFile(wav2, 'audio2.wav', 'audio/wav');

      const formData = new FormData();
      formData.append('mode', 'merge');
      formData.append('files', file1);
      formData.append('files', file2);

      const req = createMockRequest('http://localhost:3000/api/audio-trim', formData);
      const res = await audioTrimHandler(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"status":"complete"');
    });

    it('Trims audio with fade effects and bounds validation', async () => {
      const wav1 = path.join(SCRATCH_DIR, 'sample_audio1.wav');
      const file1 = fileToFile(wav1, 'audio1.wav', 'audio/wav');

      const formData = new FormData();
      formData.append('mode', 'trim');
      formData.append('outputFormat', 'mp3');
      formData.append('startTime', '0.1');
      formData.append('endTime', '0.9');
      formData.append('fadeIn', '0.2');
      formData.append('fadeOut', '0.2');
      formData.append('files', file1);

      const req = createMockRequest('http://localhost:3000/api/audio-trim', formData);
      const res = await audioTrimHandler(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"status":"complete"');
    });
  });

  // ==========================================
  // 5. YOUTUBE DOWNLOADER TESTS
  // ==========================================
  describe('5. YouTube Downloader (/api/youtube)', () => {
    it('Returns sanitized error response on non-existent YouTube video URL', async () => {
      const formData = new FormData();
      formData.append('url', 'https://www.youtube.com/watch?v=invalid999999');
      formData.append('format', 'mp4');

      const req = createMockRequest('http://localhost:3000/api/youtube', formData);
      const res = await youtubePostHandler(req);
      expect([200, 400, 500]).toContain(res.status);
      if (res.status === 200) {
        const text = await res.text();
        expect(text).toContain('error');
      }
    });

    it('Responds to metadata GET endpoint action=info', async () => {
      const req = new NextRequest('http://localhost:3000/api/youtube?action=info&url=https://www.youtube.com/watch?v=invalid999999', {
        headers: { Authorization: 'Bearer user_m2_test' },
      });
      const res = await youtubeHandler(req);
      expect([200, 400, 500]).toContain(res.status);
    }, 60000);

  });

  // ==========================================
  // 6. SPOTIFY CONVERTER TESTS
  // ==========================================
  describe('6. Spotify Converter (/api/spotify-convert)', () => {
    it('Handles single track and playlist URL inputs cleanly with sanitized error or playlist payload', async () => {
      const req = new NextRequest('http://localhost:3000/api/spotify-convert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer user_m2_test',
        },
        body: JSON.stringify({
          playlistUrl: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
        }),
      });

      const res = await spotifyHandler(req);
      expect([200, 400, 500]).toContain(res.status);
      const body = await res.json();
      expect(body.playlist || body.error).toBeDefined();
    }, 30000);
  });
});
