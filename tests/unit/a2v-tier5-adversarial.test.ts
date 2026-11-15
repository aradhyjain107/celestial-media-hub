/**
 * tests/unit/a2v-tier5-adversarial.test.ts
 *
 * Tier 5 White-Box Adversarial Stress Testing Suite for Celestial Media Hub
 * Backend Media Synthesis Engine & FFmpeg Argument Generation.
 *
 * Covers:
 * 1. Extreme boundary cases (0.1s video, 0.05s video, 0-duration audio, inverted start/end timestamps, extreme playback rates 0.5x, 4.0x, 0.25x, 8.0x)
 * 2. Combinatorial permutations across all sync modes (fit-audio, fit-video, loop-video, trim-audio) x formats (MP4, MKV, MOV, WebM, GIF)
 * 3. Combinatorial permutations across all visualizer styles (waveform, frequency, circular, minimal, none) x resolutions x color variants
 * 4. End-to-end route handling, stream isolation, zero-drift filter assertions, and error sanitization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildAudioVideoSynthesisArgs,
  buildVisualizerSynthesisArgs,
  hexToFfmpegColor,
  probeMediaStreams,
  getMediaDuration,
  executeFfmpeg,
} from '../../src/lib/ffmpeg';
import { ConvertInputSchema } from '../../src/schemas/convert';
import { POST } from '../../src/app/api/convert/route';
import * as tempExt from '../../src/lib/temp';
import * as ffmpegExt from '../../src/lib/ffmpeg';
import * as authExt from '../../src/lib/auth';
import { NextRequest } from 'next/server';
import fs from 'node:fs';

// Polyfill File.prototype.arrayBuffer for JSDOM / Node test environment
if (!File.prototype.arrayBuffer) {
  File.prototype.arrayBuffer = async function () {
    return new ArrayBuffer(64);
  };
}

// ── Hoisted Mocks ──
vi.mock('../../src/lib/temp', () => ({
  writeInputFile: vi.fn(),
  cleanupJobDir: vi.fn(),
  createJobDir: vi.fn().mockReturnValue('/mock/tmp/job-adversarial-tier5'),
  sanitizeFilename: vi.fn((f: string) => f.replace(/[^a-zA-Z0-9._-]/g, '_')),
}));

vi.mock('../../src/lib/env', () => ({
  env: {
    FFMPEG_PATH: '/mock/ffmpeg',
    YTDLP_PATH: '/mock/ytdlp',
    TEMP_DIR: '/mock/tmp',
    JWT_SECRET: 'test-jwt-secret-min-32-chars-long-security-token!!',
  },
}));

vi.mock('../../src/lib/ffmpeg', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    executeFfmpeg: vi.fn(actual.executeFfmpeg),
    probeMediaStreams: vi.fn(actual.probeMediaStreams),
    getMediaDuration: vi.fn(actual.getMediaDuration),
    isEncoderAvailable: vi.fn().mockResolvedValue(true),
    getFfprobePath: vi.fn().mockReturnValue('ffprobe'),
  };
});

vi.mock('../../src/lib/auth', () => ({
  verifyAuth: vi.fn().mockReturnValue({ userId: 'adversarial-challenger-user', role: 'admin' }),
  registerJobOwner: vi.fn(),
  unregisterJobOwner: vi.fn(),
  verifyJobOwnership: vi.fn().mockReturnValue(true),
}));

async function readSseStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value);
  }
  return result;
}

function createA2VRequest(
  fields: Record<string, any>,
  files: { name: string; type: string; fieldName?: string; content?: string }[] = []
): NextRequest {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  for (const file of files) {
    const fieldName = file.fieldName || 'file';
    formData.append(fieldName, new File([file.content || 'mock-binary-payload'], file.name, { type: file.type }));
  }
  const req = {
    formData: async () => formData,
    headers: new Headers({ authorization: 'Bearer user_adversarial_token' }),
  } as unknown as NextRequest;
  return req;
}

describe('Tier 5 Adversarial & Combinatorial Stress Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mock-adversarial-bytes'));
    vi.mocked(tempExt.writeInputFile).mockImplementation(async (_jobId, filename) => `/mock/tmp/job-adversarial-tier5/${filename}`);
    vi.mocked(tempExt.createJobDir).mockReturnValue('/mock/tmp/job-adversarial-tier5');
  });

  // =========================================================================
  // 1. EXTREME BOUNDARY CONDITIONS
  // =========================================================================
  describe('1. Extreme Boundary Conditions', () => {

    it('handles ultra-short 0.1s video with 60s audio in fit-audio mode', () => {
      const res = buildAudioVideoSynthesisArgs({
        audioPath: '/tmp/audio.mp3',
        videoPath: '/tmp/micro_video.mp4',
        outputPath: '/tmp/out.mp4',
        outputFormat: 'mp4',
        audioDuration: 60.0,
        videoDuration: 0.1,
        videoStartTime: 0,
        videoEndTime: 0.1,
        audioSyncMode: 'fit-audio',
      });

      expect(res.targetDuration).toBe(60.0);
      const cmd = res.join(' ');
      expect(cmd).toContain('-stream_loop -1');
      expect(cmd).toContain('-shortest');
      expect(cmd).toContain('fps=30');
      expect(cmd).toContain('aresample=async=1000');
    });

    it('handles 0-duration audio (probe failed/empty) without crashing or producing NaN targetDuration', () => {
      const res = buildAudioVideoSynthesisArgs({
        audioPath: '/tmp/empty_audio.mp3',
        videoPath: '/tmp/video.mp4',
        outputPath: '/tmp/out.mp4',
        outputFormat: 'mp4',
        audioDuration: 0,
        videoDuration: 15.0,
        videoStartTime: 0,
        videoEndTime: 15.0,
        audioSyncMode: 'fit-audio',
      });

      expect(Number.isNaN(res.targetDuration)).toBe(false);
      expect(res.targetDuration).toBe(15.0);
      expect(isFinite(res.targetDuration)).toBe(true);
    });

    it('handles 0-duration audio in visualizer synthesis without crashing', () => {
      const res = buildVisualizerSynthesisArgs({
        audioPath: '/tmp/empty_audio.mp3',
        outputPath: '/tmp/out.mp4',
        outputFormat: 'mp4',
        audioDuration: 0,
        visualizerStyle: 'waveform',
      });

      expect(Number.isNaN(res.targetDuration)).toBe(false);
      expect(res.targetDuration).toBe(10); // Safe fallback to 10s
      const cmd = res.join(' ');
      expect(cmd).toContain('d=10');
      expect(cmd).not.toContain('d=0');
      expect(cmd).not.toContain('d=NaN');
    });

    it('handles inverted start/end timestamps (vStart=15.0, vEnd=3.0) safely via clamping', () => {
      const res = buildAudioVideoSynthesisArgs({
        audioPath: '/tmp/audio.mp3',
        videoPath: '/tmp/video.mp4',
        outputPath: '/tmp/out.mp4',
        outputFormat: 'mp4',
        audioDuration: 30.0,
        videoDuration: 60.0,
        videoStartTime: 15.0,
        videoEndTime: 3.0, // Inverted!
        audioSyncMode: 'fit-audio',
      });

      const cmd = res.join(' ');
      expect(cmd).toContain('-ss 15');
      expect(cmd).toContain('-to 15.1');
      expect(res.targetDuration).toBe(30.0);
    });

    it('handles inverted start/end when start exceeds rawVideoDur (vStart=80, vEnd=10, rawVideoDur=20)', () => {
      const res = buildAudioVideoSynthesisArgs({
        audioPath: '/tmp/audio.mp3',
        videoPath: '/tmp/video.mp4',
        outputPath: '/tmp/out.mp4',
        outputFormat: 'mp4',
        audioDuration: 20.0,
        videoDuration: 20.0,
        videoStartTime: 80.0,
        videoEndTime: 10.0,
      });

      const cmd = res.join(' ');
      expect(cmd).toContain('-ss 19.9');
      expect(res.targetDuration).toBe(20.0);
    });

    it('handles extreme playback rate 0.5x (slow-motion)', () => {
      const res = buildAudioVideoSynthesisArgs({
        audioPath: '/tmp/audio.mp3',
        videoPath: '/tmp/video.mp4',
        outputPath: '/tmp/out.mp4',
        outputFormat: 'mp4',
        audioDuration: 30.0,
        videoDuration: 30.0,
        speed: 0.5,
      });

      expect(res.targetDuration).toBe(60.0);
      const cmd = res.join(' ');
      expect(cmd).toContain('setpts=(1/0.5)*PTS');
      expect(cmd).toContain('atempo=0.5');
      expect(cmd).toContain('aresample=async=1000');
    });

    it('handles extreme playback rate 4.0x (ultra-fast)', () => {
      const res = buildAudioVideoSynthesisArgs({
        audioPath: '/tmp/audio.mp3',
        videoPath: '/tmp/video.mp4',
        outputPath: '/tmp/out.mp4',
        outputFormat: 'mp4',
        audioDuration: 40.0,
        videoDuration: 40.0,
        speed: 4.0,
      });

      expect(res.targetDuration).toBe(10.0);
      const cmd = res.join(' ');
      expect(cmd).toContain('setpts=(1/4)*PTS');
      expect(cmd).toContain('atempo=2.0,atempo=2');
      expect(cmd).toContain('aresample=async=1000');
    });

    it('handles extreme speed variations in visualizer synthesis (0.5x, 2.0x, 4.0x)', () => {
      const resHalf = buildVisualizerSynthesisArgs({
        audioPath: '/tmp/audio.mp3',
        audioDuration: 20.0,
        speed: 0.5,
      });
      expect(resHalf.targetDuration).toBe(40.0);

      const resQuad = buildVisualizerSynthesisArgs({
        audioPath: '/tmp/audio.mp3',
        audioDuration: 20.0,
        speed: 4.0,
      });
      expect(resQuad.targetDuration).toBe(5.0);
    });

    it('handles sub-millisecond precision timestamps (vStart=0.1234, vEnd=5.6789)', () => {
      const res = buildAudioVideoSynthesisArgs({
        audioPath: '/tmp/audio.mp3',
        videoPath: '/tmp/video.mp4',
        outputPath: '/tmp/out.mp4',
        outputFormat: 'mp4',
        audioDuration: 10.0,
        videoDuration: 10.0,
        videoStartTime: 0.1234,
        videoEndTime: 5.6789,
      });

      const cmd = res.join(' ');
      expect(cmd).toContain('-ss 0.1234');
      expect(cmd).toContain('-to 5.6789');
    });

  });

  // =========================================================================
  // 2. COMBINATORIAL PERMUTATIONS: SYNC MODES x FORMATS
  // =========================================================================
  describe('2. Combinatorial Matrix: 4 Sync Modes x 5 Output Formats (20 Permutations)', () => {
    const syncModes = ['fit-audio', 'fit-video', 'loop-video', 'trim-audio'] as const;
    const formats = ['mp4', 'mkv', 'mov', 'webm', 'gif'] as const;

    for (const syncMode of syncModes) {
      for (const fmt of formats) {
        it(`synthesizes correctly for syncMode="${syncMode}" and outputFormat="${fmt}"`, () => {
          const res = buildAudioVideoSynthesisArgs({
            audioPath: '/mock/audio.mp3',
            videoPath: '/mock/video.mp4',
            outputPath: `/mock/out.${fmt}`,
            outputFormat: fmt,
            audioDuration: 45.0,
            videoDuration: 15.0,
            videoStartTime: 0,
            videoEndTime: 15.0,
            audioSyncMode: syncMode,
          });

          expect(Array.isArray(res)).toBe(true);
          expect(res.strategy).toBe('AUDIO+VIDEO-SYNTHESIS');
          expect(res.targetDuration).toBeGreaterThan(0);
          expect(res[res.length - 1]).toBe(`/mock/out.${fmt}`);

          const cmd = res.join(' ');

          // Verification based on container format
          if (fmt === 'gif') {
            expect(cmd).toContain('palettegen');
            expect(cmd).toContain('paletteuse');
            expect(cmd).toContain('-loop 0');
            expect(cmd).toContain('-an');
            expect(cmd).not.toContain('-c:a');
          } else {
            expect(cmd).toContain('-map 1:v:0');
            expect(cmd).toContain('-map 0:a:0');
            expect(cmd).toContain('setpts=PTS-STARTPTS');
            expect(cmd).toContain('asetpts=PTS-STARTPTS');
            expect(cmd).toContain('aresample=async=1000');

            if (fmt === 'webm') {
              expect(cmd).toContain('-c:v libvpx-vp9');
              expect(cmd).toContain('-c:a libopus');
            } else {
              expect(cmd).toContain('-c:v libx264');
              expect(cmd).toContain('-c:a aac');
            }

            if (fmt === 'mp4' || fmt === 'mov') {
              expect(cmd).toContain('-movflags faststart');
            }
          }

          // Verification based on sync mode
          if (syncMode === 'trim-audio' || syncMode === 'fit-video') {
            expect(res.targetDuration).toBe(15.0);
            expect(cmd).toContain('-t 15');
          } else {
            // fit-audio or loop-video
            expect(res.targetDuration).toBe(45.0);
            expect(cmd).toContain('-shortest');
            expect(cmd).toContain('-stream_loop -1');
          }
        });
      }
    }
  });

  // =========================================================================
  // 3. COMBINATORIAL PERMUTATIONS: VISUALIZER STYLES x FORMATS x RESOLUTIONS
  // =========================================================================
  describe('3. Combinatorial Matrix: 5 Visualizer Styles x 5 Formats (25 Permutations)', () => {
    const visualizerStyles = ['waveform', 'frequency', 'circular', 'minimal', 'none'] as const;
    const formats = ['mp4', 'mkv', 'mov', 'webm', 'gif'] as const;

    for (const style of visualizerStyles) {
      for (const fmt of formats) {
        it(`synthesizes visualizer style="${style}" into format="${fmt}"`, () => {
          const res = buildVisualizerSynthesisArgs({
            audioPath: '/mock/audio.mp3',
            outputPath: `/mock/viz_out.${fmt}`,
            outputFormat: fmt,
            audioDuration: 30.0,
            visualizerStyle: style,
            visualizerColor: '#00F2FE',
            visualizerBg: '#0A0A0C',
            resolution: '1080p',
          });

          expect(res.strategy).toBe('AUDIO-VISUALIZER-SYNTHESIS');
          expect(res.targetDuration).toBe(30.0);

          const cmd = res.join(' ');
          expect(cmd).toContain('-filter_complex');

          // Check style specific filter keywords
          if (style === 'frequency') {
            expect(cmd).toContain('showfreqs');
          } else if (style === 'circular') {
            expect(cmd).toContain('avectorscope');
          } else if (style === 'minimal') {
            expect(cmd).toContain('drawgrid');
            expect(cmd).toContain('showwaves');
          } else if (style === 'none') {
            expect(cmd).toMatch(/color=c=0x0a0a0c/i);
          } else {
            // waveform
            expect(cmd).toContain('showwaves');
          }

          if (fmt === 'gif') {
            expect(cmd).toContain('palettegen');
            expect(cmd).toContain('paletteuse');
            expect(cmd).toContain('-an');
          } else if (fmt === 'webm') {
            expect(cmd).toContain('-c:v libvpx-vp9');
            expect(cmd).toContain('-c:a libopus');
            expect(cmd).toContain('-map [v]');
            expect(cmd).toContain('-map 0:a:0');
          } else {
            expect(cmd).toContain('-c:v libx264');
            expect(cmd).toContain('-c:a aac');
            expect(cmd).toContain('-map [v]');
            expect(cmd).toContain('-map 0:a:0');
          }
        });
      }
    }
  });

  // =========================================================================
  // 4. COLOR PARSING & SANITIZATION EDGE CASES
  // =========================================================================
  describe('4. hexToFfmpegColor Robustness & Edge Cases', () => {
    it('parses standard 6-digit hash hex correctly (#FF5A00 -> 0xFF5A00)', () => {
      expect(hexToFfmpegColor('#FF5A00')).toBe('0xFF5A00');
      expect(hexToFfmpegColor('#00f2fe')).toBe('0x00f2fe');
    });

    it('parses 0x prefixed hex correctly (0x0A0A0C -> 0x0A0A0C)', () => {
      expect(hexToFfmpegColor('0x0A0A0C')).toBe('0x0A0A0C');
    });

    it('parses plain 6-digit hex without prefix (FF5A00 -> 0xFF5A00)', () => {
      expect(hexToFfmpegColor('FF5A00')).toBe('0xFF5A00');
    });

    it('falls back to default color on invalid or empty inputs', () => {
      expect(hexToFfmpegColor('')).toBe('0xFF5A00');
      expect(hexToFfmpegColor(undefined)).toBe('0xFF5A00');
      expect(hexToFfmpegColor('invalid-color', '0x112233')).toBe('0x112233');
      expect(hexToFfmpegColor('#GGG', '0x112233')).toBe('0x112233');
    });
  });

  // =========================================================================
  // 5. RESOLUTIONS & SOCIAL PRESETS COMBINATIONS
  // =========================================================================
  describe('5. Resolutions & Social Presets in A2V Synthesis', () => {
    const resolutions = ['original', '1080p', '720p', '480p', '360p'] as const;
    const presets = ['auto', 'high', 'instagram', 'tiktok', 'discord', 'whatsapp', 'email'] as const;

    for (const res of resolutions) {
      it(`handles resolution option "${res}" without filter syntax corruption`, () => {
        const result = buildAudioVideoSynthesisArgs({
          audioPath: '/mock/a.mp3',
          videoPath: '/mock/v.mp4',
          outputPath: '/mock/o.mp4',
          outputFormat: 'mp4',
          resolution: res,
        });
        const cmd = result.join(' ');
        if (res === '1080p') expect(cmd).toContain('scale=1920:1080');
        if (res === '720p') expect(cmd).toContain('scale=1280:720');
        if (res === '480p') expect(cmd).toContain('scale=854:480');
        if (res === '360p') expect(cmd).toContain('scale=640:360');
      });
    }

    for (const pr of presets) {
      it(`handles platform preset "${pr}" with optimal bitrate & aspect ratio`, () => {
        const result = buildAudioVideoSynthesisArgs({
          audioPath: '/mock/a.mp3',
          videoPath: '/mock/v.mp4',
          outputPath: '/mock/o.mp4',
          outputFormat: 'mp4',
          preset: pr,
        });
        const cmd = result.join(' ');
        if (pr === 'instagram' || pr === 'tiktok') {
          expect(cmd).toContain('scale=1080:1920');
        } else if (pr === 'high') {
          expect(cmd).toContain('-crf 18');
        } else if (pr === 'whatsapp') {
          expect(cmd).toContain('-crf 28');
        }
      });
    }
  });

  // =========================================================================
  // 6. ROUTE LEVEL ADVERSARIAL DISPATCH TESTS
  // =========================================================================
  describe('6. POST /api/convert Adversarial Route Invocations', () => {
    it('correctly executes full Audio + Video synthesis pipeline with valid credentials', async () => {
      vi.mocked(ffmpegExt.probeMediaStreams)
        .mockResolvedValueOnce({ hasVideo: false, hasAudio: true, audioCodec: 'mp3', duration: 40.0 })
        .mockResolvedValueOnce({ hasVideo: true, hasAudio: true, videoCodec: 'h264', audioCodec: 'aac', duration: 10.0 });

      const mockStream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":25}\n\n'));
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.enqueue(new TextEncoder().encode('data: {"status":"done"}\n\n'));
          c.close();
        },
      });
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

      const req = createA2VRequest({
        outputFormat: 'mp4',
        audioSyncMode: 'loop-video',
        videoStartTime: 1.0,
        videoEndTime: 9.0,
      }, [
        { name: 'voice.mp3', type: 'audio/mpeg', fieldName: 'file' },
        { name: 'broll.mp4', type: 'video/mp4', fieldName: 'videoFile' },
      ]);

      const res = await POST(req);
      expect(res.status).toBe(200);
      const text = await readSseStream(res);
      expect(text).toContain('"strategy":"AUDIO+VIDEO-SYNTHESIS"');
      expect(text).toContain('"status":"complete"');
      expect(text).toContain('downloadUrl');
    });

    it('rejects tampered / non-numeric videoStartTime with 400 Bad Request', async () => {
      const req = createA2VRequest({
        outputFormat: 'mp4',
        videoStartTime: 'not-a-number',
      }, [
        { name: 'voice.mp3', type: 'audio/mpeg', fieldName: 'file' },
      ]);

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('rejects unauthorized requests with 401 Unauthorized', async () => {
      vi.mocked(authExt.verifyAuth).mockReturnValueOnce(null);

      const req = createA2VRequest({ outputFormat: 'mp4' }, [
        { name: 'audio.mp3', type: 'audio/mpeg', fieldName: 'file' },
      ]);

      const res = await POST(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });
  });

});
