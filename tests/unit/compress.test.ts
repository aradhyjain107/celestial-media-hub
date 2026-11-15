import { expect, describe, test, vi, beforeEach } from 'vitest';
import { POST } from '../../app/api/compress/route';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import * as childProcess from 'node:child_process';
import * as tempExt from '../../lib/temp';
import * as ffmpegExt from '../../lib/ffmpeg';
import * as authExt from '../../lib/auth';

const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    execFileSync: mockExecFileSync,
    default: {
      ...actual.default,
      execFileSync: mockExecFileSync,
    },
  };
});

vi.mock('../../lib/temp', () => ({
  writeInputFile: vi.fn(),
  cleanupJobDir: vi.fn(),
  createJobDir: vi.fn().mockReturnValue('/mock/compressPath'),
}));

vi.mock('../../lib/ffmpeg', () => ({
  executeFfmpeg: vi.fn(),
  probeMediaStreams: vi.fn().mockResolvedValue({ hasVideo: true, hasAudio: true, duration: 10 }),
  isEncoderAvailable: vi.fn().mockResolvedValue(false),
}));

describe('POST /api/compress — Unit Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFileSync.mockReset();
    mockExecFileSync.mockReturnValue(Buffer.from(''));
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 } as any);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['compressed_video.mp4'] as any);
    vi.mocked(tempExt.createJobDir).mockReturnValue('/mock/compressPath');
    vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/input.mp4');
    vi.mocked(ffmpegExt.probeMediaStreams).mockResolvedValue({ hasVideo: true, hasAudio: true, duration: 10 });
    vi.mocked(ffmpegExt.isEncoderAvailable).mockResolvedValue(false);
  });

  // Helper to read an SSE response body
  async function readSseResponse(res: Response): Promise<{ text: string; events: any[] }> {
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      text += decoder.decode(value);
    }
    const events: any[] = [];
    const lines = text.split('\n\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        try {
          events.push(JSON.parse(trimmed.replace(/^data:\s*/, '')));
        } catch {
          events.push(trimmed);
        }
      }
    }
    return { text, events };
  }

  // ── 1. Authentication & Input Validation ──────────────────────────────────
  describe('1. Authentication & Input Validation', () => {
    test('returns 401 Unauthorized when request lacks authorization', async () => {
      const req = new NextRequest('http://localhost:3000/api/compress', {
        method: 'POST',
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    test('returns 400 Bad Request when no files are provided', async () => {
      const formData = new FormData();
      formData.append('videoCodec', 'hevc');
      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('No files provided');
    });

    test('returns 400 Bad Request when videoCrf is out of bounds (< 18 or > 35)', async () => {
      const formData = new FormData();
      formData.append('videoCrf', '50'); // Invalid CRF
      formData.append('files', new File(['mock content'], 'video.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    test('returns 400 Bad Request when videoCodec is invalid', async () => {
      const formData = new FormData();
      formData.append('videoCodec', 'invalid_codec');
      formData.append('files', new File(['mock content'], 'video.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    test('returns 400 Bad Request when audioBitrate is invalid', async () => {
      const formData = new FormData();
      formData.append('audioBitrate', '999k');
      formData.append('files', new File(['mock audio'], 'audio.mp3', { type: 'audio/mpeg' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  // ── 2. Video Compression ──────────────────────────────────────────────────
  describe('2. Video Compression (HEVC, H.264, AV1, VP9, CRF, Presets, Scaling)', () => {
    test('compresses video with HEVC (libx265) software encoder and custom CRF & preset', async () => {
      const formData = new FormData();
      formData.append('videoCodec', 'hevc');
      formData.append('videoCrf', '26');
      formData.append('videoPreset', 'slow');
      formData.append('audioBitrate', '128k');
      formData.append('files', new File(['mock vid'], 'sample.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/sample.mp4');

      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":50}\n\n'));
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.enqueue(new TextEncoder().encode('data: {"status":"done"}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/event-stream');

      const { events } = await readSseResponse(res);
      expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
        '/mock/compressPath/sample.mp4',
        [
          '-i', '/mock/compressPath/sample.mp4',
          '-c:v', 'libx265',
          '-crf', '26',
          '-preset', 'slow',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-tag:v', 'hvc1',
          '-movflags', '+faststart',
          '-y', '/mock/compressPath/compressed_sample.mp4'
        ]
      );

      const completeEvent = events.find((e) => e.status === 'complete');
      expect(completeEvent).toBeDefined();
      expect(completeEvent.downloadUrl).toMatch(/^\/api\/download\?jobId=/);
    });

    test('compresses video with H.264 (libx264), CRF 20, and 720p downscaling', async () => {
      const formData = new FormData();
      formData.append('videoCodec', 'h264');
      formData.append('videoCrf', '20');
      formData.append('videoPreset', 'fast');
      formData.append('resolution', '720p');
      formData.append('files', new File(['mock vid'], 'clip.mov', { type: 'video/quicktime' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/clip.mov');
      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await POST(req);
      await readSseResponse(res);

      expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
        '/mock/compressPath/clip.mov',
        [
          '-i', '/mock/compressPath/clip.mov',
          '-c:v', 'libx264',
          '-crf', '20',
          '-preset', 'fast',
          '-vf', 'scale=-2:720',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          '-y', '/mock/compressPath/compressed_clip.mp4'
        ]
      );
    });

    test('compresses video with AV1 (libsvtav1) and 1080p resolution', async () => {
      const formData = new FormData();
      formData.append('videoCodec', 'av1');
      formData.append('videoCrf', '30');
      formData.append('resolution', '1080p');
      formData.append('files', new File(['mock vid'], 'video.mkv', { type: 'video/x-matroska' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/video.mkv');
      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await POST(req);
      await readSseResponse(res);

      expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
        '/mock/compressPath/video.mkv',
        [
          '-i', '/mock/compressPath/video.mkv',
          '-c:v', 'libsvtav1',
          '-crf', '30',
          '-preset', 'medium',
          '-vf', 'scale=-2:1080',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          '-y', '/mock/compressPath/compressed_video.mp4'
        ]
      );
    });

    test('compresses video with VP9 (libvpx-vp9), 480p scaling, and strips audio (-an) when input has no audio', async () => {
      const formData = new FormData();
      formData.append('videoCodec', 'vp9');
      formData.append('videoCrf', '32');
      formData.append('resolution', '480p');
      formData.append('files', new File(['mock vid'], 'mute.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/mute.mp4');
      vi.mocked(ffmpegExt.probeMediaStreams).mockResolvedValue({ hasVideo: true, hasAudio: false, duration: 5 });

      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await POST(req);
      await readSseResponse(res);

      expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
        '/mock/compressPath/mute.mp4',
        [
          '-i', '/mock/compressPath/mute.mp4',
          '-c:v', 'libvpx-vp9',
          '-crf', '32',
          '-preset', 'medium',
          '-vf', 'scale=-2:480',
          '-an',
          '-movflags', '+faststart',
          '-y', '/mock/compressPath/compressed_mute.mp4'
        ]
      );
    });
  });

  // ── 3. Audio Compression ──────────────────────────────────────────────────
  describe('3. Audio Compression (MP3, AAC, OGG, FLAC & Bitrates)', () => {
    test('compresses MP3 audio with libmp3lame and 64k bitrate', async () => {
      const formData = new FormData();
      formData.append('audioFormat', 'mp3');
      formData.append('audioBitrate', '64k');
      formData.append('files', new File(['mock mp3'], 'song.mp3', { type: 'audio/mpeg' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/song.mp3');
      vi.mocked(ffmpegExt.probeMediaStreams).mockResolvedValue({ hasVideo: false, hasAudio: true, duration: 120 });

      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":50}\n\n'));
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await POST(req);
      await readSseResponse(res);

      expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
        '/mock/compressPath/song.mp3',
        ['-i', '/mock/compressPath/song.mp3', '-c:a', 'libmp3lame', '-b:a', '64k', '-y', '/mock/compressPath/compressed_song.mp3']
      );
    });

    test('compresses AAC audio with native aac encoder and 320k bitrate', async () => {
      const formData = new FormData();
      formData.append('audioFormat', 'aac');
      formData.append('audioBitrate', '320k');
      formData.append('files', new File(['mock aac'], 'track.m4a', { type: 'audio/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/track.m4a');
      vi.mocked(ffmpegExt.probeMediaStreams).mockResolvedValue({ hasVideo: false, hasAudio: true, duration: 180 });

      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await POST(req);
      await readSseResponse(res);

      expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
        '/mock/compressPath/track.m4a',
        ['-i', '/mock/compressPath/track.m4a', '-c:a', 'aac', '-b:a', '320k', '-y', '/mock/compressPath/compressed_track.aac']
      );
    });

    test('compresses OGG audio with libvorbis and 192k bitrate', async () => {
      const formData = new FormData();
      formData.append('audioFormat', 'ogg');
      formData.append('audioBitrate', '192k');
      formData.append('files', new File(['mock ogg'], 'voice.ogg', { type: 'audio/ogg' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/voice.ogg');
      vi.mocked(ffmpegExt.probeMediaStreams).mockResolvedValue({ hasVideo: false, hasAudio: true, duration: 60 });

      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await POST(req);
      await readSseResponse(res);

      expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
        '/mock/compressPath/voice.ogg',
        ['-i', '/mock/compressPath/voice.ogg', '-c:a', 'libvorbis', '-b:a', '192k', '-y', '/mock/compressPath/compressed_voice.ogg']
      );
    });

    test('compresses FLAC audio with lossless flac encoder', async () => {
      const formData = new FormData();
      formData.append('audioFormat', 'flac');
      formData.append('files', new File(['mock flac'], 'audio.wav', { type: 'audio/wav' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/audio.wav');
      vi.mocked(ffmpegExt.probeMediaStreams).mockResolvedValue({ hasVideo: false, hasAudio: true, duration: 45 });

      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await POST(req);
      await readSseResponse(res);

      expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
        '/mock/compressPath/audio.wav',
        ['-i', '/mock/compressPath/audio.wav', '-c:a', 'flac', '-y', '/mock/compressPath/compressed_audio.flac']
      );
    });
  });

  // ── 4. Photo Compression ──────────────────────────────────────────────────
  describe('4. Photo Compression (cwebp, macOS sips, FFmpeg image2)', () => {
    test('compresses image to WebP using cwebp binary', async () => {
      const formData = new FormData();
      formData.append('imageFormat', 'webp');
      formData.append('imageQuality', '85');
      formData.append('maxDimension', '1920');
      formData.append('files', new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/photo.jpg');
      vi.mocked(ffmpegExt.probeMediaStreams).mockResolvedValue({ hasVideo: false, hasAudio: false, duration: 0 });

      mockExecFileSync.mockReturnValue(Buffer.from(''));

      const res = await POST(req);
      await readSseResponse(res);

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'cwebp',
        ['-q', '85', '-resize', '1920', '0', '/mock/compressPath/photo.jpg', '-o', '/mock/compressPath/compressed_photo.webp'],
        { stdio: 'pipe' }
      );
    });

    test('compresses image to JPEG using macOS sips tool', async () => {
      const formData = new FormData();
      formData.append('imageFormat', 'jpeg');
      formData.append('imageQuality', '75');
      formData.append('maxDimension', '1080');
      formData.append('files', new File(['photo'], 'photo.png', { type: 'image/png' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/photo.png');
      vi.mocked(ffmpegExt.probeMediaStreams).mockResolvedValue({ hasVideo: false, hasAudio: false, duration: 0 });

      mockExecFileSync.mockReturnValue(Buffer.from(''));

      const res = await POST(req);
      await readSseResponse(res);

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'sips',
        ['-s', 'format', 'jpeg', '-s', 'formatOptions', '75', '-Z', '1080', '/mock/compressPath/photo.png', '--out', '/mock/compressPath/compressed_photo.jpg'],
        { stdio: 'pipe' }
      );
    });

    test('falls back to FFmpeg image2 encoder when cwebp / sips fail', async () => {
      const formData = new FormData();
      formData.append('imageFormat', 'png');
      formData.append('imageQuality', '90');
      formData.append('maxDimension', '800');
      formData.append('files', new File(['photo'], 'photo.bmp', { type: 'image/bmp' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/photo.bmp');
      vi.mocked(ffmpegExt.probeMediaStreams).mockResolvedValue({ hasVideo: false, hasAudio: false, duration: 0 });

      // Simulate sips failing
      mockExecFileSync.mockImplementation(() => {
        throw new Error('sips not found');
      });

      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await POST(req);
      await readSseResponse(res);

      expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
        '/mock/compressPath/photo.bmp',
        [
          '-i', '/mock/compressPath/photo.bmp',
          '-vf', "scale='if(gt(iw,ih),min(iw,800),-2)':'if(gt(ih,iw),min(ih,800),-2)'",
          '-c:v', 'png',
          '-compression_level', '6',
          '-frames:v', '1',
          '-y', '/mock/compressPath/compressed_photo.png'
        ],
        1
      );
    });
  });

  // ── 5. Hardware Acceleration Auto-Detection ───────────────────────────────
  describe('5. Hardware Acceleration Auto-Detection & Fallback', () => {
    test('uses hevc_videotoolbox when available and hardwareAccel=true', async () => {
      const formData = new FormData();
      formData.append('videoCodec', 'hevc');
      formData.append('videoCrf', '28');
      formData.append('hardwareAccel', 'true');
      formData.append('files', new File(['mock'], 'video.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/video.mp4');
      vi.mocked(ffmpegExt.isEncoderAvailable).mockImplementation(async (enc: string) => enc === 'hevc_videotoolbox');

      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await POST(req);
      await readSseResponse(res);

      expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
        '/mock/compressPath/video.mp4',
        [
          '-i', '/mock/compressPath/video.mp4',
          '-c:v', 'hevc_videotoolbox',
          '-q:v', '50', // CRF 28 mapped to VideoToolbox 1-100 quality scale = 50
          '-c:a', 'aac',
          '-b:a', '128k',
          '-tag:v', 'hvc1',
          '-movflags', '+faststart',
          '-y', '/mock/compressPath/compressed_video.mp4'
        ]
      );
    });

    test('uses h264_nvenc when available and hardwareAccel=true for h264', async () => {
      const formData = new FormData();
      formData.append('videoCodec', 'h264');
      formData.append('videoCrf', '24');
      formData.append('hardwareAccel', 'true');
      formData.append('files', new File(['mock'], 'video.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/video.mp4');
      vi.mocked(ffmpegExt.isEncoderAvailable).mockImplementation(async (enc: string) => enc === 'h264_nvenc');

      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await POST(req);
      await readSseResponse(res);

      expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
        '/mock/compressPath/video.mp4',
        [
          '-i', '/mock/compressPath/video.mp4',
          '-c:v', 'h264_nvenc',
          '-cq:v', '24', // NVENC uses standard constant quality scale 24
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          '-y', '/mock/compressPath/compressed_video.mp4'
        ]
      );
    });

    test('falls back to software libx264 when hardwareAccel=true but no HW encoders are available', async () => {
      const formData = new FormData();
      formData.append('videoCodec', 'h264');
      formData.append('videoCrf', '25');
      formData.append('hardwareAccel', 'true');
      formData.append('files', new File(['mock'], 'video.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/video.mp4');
      vi.mocked(ffmpegExt.isEncoderAvailable).mockResolvedValue(false);

      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await POST(req);
      await readSseResponse(res);

      expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
        '/mock/compressPath/video.mp4',
        [
          '-i', '/mock/compressPath/video.mp4',
          '-c:v', 'libx264',
          '-crf', '25',
          '-preset', 'medium',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          '-y', '/mock/compressPath/compressed_video.mp4'
        ]
      );
    });
  });

  // ── 6. Multi-file Batch & ZIP Bundling ────────────────────────────────────
  describe('6. Multi-file Batch Compression & ZIP Bundling', () => {
    test('processes multiple files sequentially, calculating global progress and bundling into zip', async () => {
      const formData = new FormData();
      formData.append('videoCodec', 'hevc');
      formData.append('files', new File(['file1'], 'first.mp4', { type: 'video/mp4' }));
      formData.append('files', new File(['file2'], 'second.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile)
        .mockResolvedValueOnce('/mock/compressPath/first.mp4')
        .mockResolvedValueOnce('/mock/compressPath/second.mp4');

      vi.spyOn(fs, 'readdirSync').mockReturnValue(['compressed_first.mp4', 'compressed_second.mp4'] as any);

      let callCount = 0;
      vi.mocked(ffmpegExt.executeFfmpeg).mockImplementation(() => {
        callCount++;
        return new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
            c.close();
          }
        });
      });

      const res = await POST(req);
      const { events } = await readSseResponse(res);

      expect(callCount).toBe(2);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'zip',
        ['-j', 'output.zip', '--', 'compressed_first.mp4', 'compressed_second.mp4'],
        { cwd: '/mock/compressPath' }
      );

      const completeEvent = events.find((e) => e.status === 'complete');
      expect(completeEvent).toBeDefined();
      expect(completeEvent.files.length).toBe(2);
    });
  });

  // ── 7. Stream Cancellation & Error Handling ──────────────────────────────
  describe('7. Stream Cancellation & Error Handling', () => {
    test('cleans up temp directory when stream error occurs and emits sanitized SSE error', async () => {
      const formData = new FormData();
      formData.append('videoCodec', 'hevc');
      formData.append('files', new File(['mock'], 'corrupted.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/corrupted.mp4');

      const mockErrorStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"error":"FFmpeg failed internally at /secret/path"}\n\n'));
          c.close();
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockErrorStream);

      const res = await POST(req);
      const { text } = await readSseResponse(res);

      expect(text).toContain('"error"');
      expect(text).not.toContain('/secret/path'); // Verifies sanitized error
      expect(tempExt.cleanupJobDir).toHaveBeenCalled();
    });

    test('cancels active reader and cleans temp directory when client aborts/cancels stream', async () => {
      const formData = new FormData();
      formData.append('videoCodec', 'hevc');
      formData.append('files', new File(['mock'], 'cancel_test.mp4', { type: 'video/mp4' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/compressPath/cancel_test.mp4');

      let cancelled = false;
      const mockStream = new ReadableStream({
        start(c) {
          // Keep stream open
        },
        cancel(reason) {
          cancelled = true;
        }
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const res = await POST(req);
      expect(res.body).toBeDefined();

      // Read one tick then cancel
      const reader = res.body!.getReader();
      await reader.cancel('User navigated away');

      expect(tempExt.cleanupJobDir).toHaveBeenCalled();
    });
  });
});
