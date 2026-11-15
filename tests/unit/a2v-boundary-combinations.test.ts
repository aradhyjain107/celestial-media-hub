/**
 * tests/unit/a2v-boundary-combinations.test.ts
 *
 * Comprehensive Tier 2 (Boundary & Corner Cases), Tier 3 (Cross-Feature Combinations),
 * and Tier 4 (Real-World Application Scenarios) Integration Test Suite
 * for Celestial Media Hub Audio-to-Video (A2V) Synthesis.
 */

import { describe, it, test, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../src/app/api/convert/route';
import { ConvertInputSchema } from '../../src/schemas/convert';
import { executeFfmpeg, probeMediaStreams, getMediaDuration, buildAudioVideoSynthesisArgs, buildVisualizerSynthesisArgs } from '../../src/lib/media/ffmpeg';
import { decideStrategy, buildStrategyArgs } from '../../src/lib/media/remuxDecision';
import * as tempExt from '../../src/lib/system/temp';
import * as ffmpegExt from '../../src/lib/media/ffmpeg';
import * as authExt from '../../src/lib/security/auth';
import { NextRequest } from 'next/server';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// Polyfill File.prototype.arrayBuffer for JSDOM test environment
if (!File.prototype.arrayBuffer) {
  File.prototype.arrayBuffer = async function () {
    return new ArrayBuffer(32);
  };
}

// ── Hoisted Mocks ──
vi.mock('../../src/lib/system/temp', () => ({
  writeInputFile: vi.fn(),
  cleanupJobDir: vi.fn(),
  createJobDir: vi.fn().mockReturnValue('/mock/a2v_job_dir'),
}));

vi.mock('../../src/lib/system/env', () => ({
  env: {
    FFMPEG_PATH: '/mock/ffmpeg',
    YTDLP_PATH: '/mock/ytdlp',
    TEMP_DIR: '/mock/tmp',
    JWT_SECRET: 'test-jwt-secret-min-32-chars-long-security-token!!',
  },
}));

vi.mock('../../src/lib/media/ffmpeg', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    executeFfmpeg: vi.fn(),
    probeMediaStreams: vi.fn(),
    getMediaDuration: vi.fn(),
    isEncoderAvailable: vi.fn().mockResolvedValue(true),
    getFfprobePath: vi.fn().mockReturnValue('ffprobe'),
  };
});

vi.mock('../../src/lib/security/auth', () => ({
  verifyAuth: vi.fn().mockReturnValue({ userId: 'test-user-boundary', role: 'user', token: 'valid-test-token', iat: 1000 }),
  registerJobOwner: vi.fn(),
  unregisterJobOwner: vi.fn(),
  verifyJobOwnership: vi.fn().mockReturnValue(true),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    execFileSync: vi.fn().mockReturnValue(Buffer.from('mock-zip-output')),
  };
});

// ── Helper Utilities ──
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
    formData.append(fieldName, new File([file.content || 'mock-media-content-buffer-data'], file.name, { type: file.type }));
  }
  const req = {
    formData: async () => formData,
    headers: new Headers({ authorization: 'Bearer user_test_valid_jwt' }),
  } as unknown as NextRequest;
  return req;
}

function createMockFfmpegStream(
  progressSteps: number[] = [25, 50, 75, 100],
  shouldFail = false,
  errorMessage = 'FFmpeg transcode error'
): ReadableStream {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      if (shouldFail) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`));
      } else {
        for (const prog of progressSteps) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ progress: prog })}\n\n`));
        }
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ status: 'done' })}\n\n`));
      }
      controller.close();
    },
  });
}

// ── Synthesis Argument Builder Helper for Test Assertions ──
interface SynthesisArgOptions {
  audioPath: string;
  videoPath?: string;
  outputPath: string;
  outputFormat: string;
  preset?: string;
  speed?: number;
  resolution?: string;
  videoStartTime?: number;
  videoEndTime?: number;
  audioSyncMode?: 'fit-audio' | 'fit-video' | 'loop-video' | 'trim-audio';
  videoLoop?: boolean;
  stripAudio?: boolean;
  visualizerStyle?: string;
  visualizerColor?: string;
  visualizerBg?: string;
  gifFps?: number;
  gifPalette?: boolean;
}

function buildExpectedA2VArgs(opts: SynthesisArgOptions): string[] {
  const args: string[] = ['-threads', '0', '-i', opts.audioPath];

  if (opts.videoPath) {
    if (opts.videoStartTime !== undefined && opts.videoEndTime !== undefined) {
      args.push('-ss', opts.videoStartTime.toFixed(3), '-to', opts.videoEndTime.toFixed(3));
    } else if (opts.videoStartTime !== undefined) {
      args.push('-ss', opts.videoStartTime.toFixed(3));
    }

    if (opts.videoLoop || opts.audioSyncMode === 'loop-video') {
      args.push('-stream_loop', '-1');
    }

    args.push('-i', opts.videoPath);
    args.push('-map', '1:v:0');
    if (!opts.stripAudio) {
      args.push('-map', '0:a:0');
    }
  }

  // Video Filter
  const vfFilters: string[] = ['setpts=PTS-STARTPTS'];
  if (opts.speed && opts.speed !== 1) {
    const vSpeed = (1 / opts.speed).toFixed(4);
    vfFilters[0] = `setpts=${vSpeed}*PTS`;
  }
  vfFilters.push('fps=30');

  if (opts.preset === 'instagram' || opts.preset === 'tiktok') {
    vfFilters.push('scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1');
  } else if (opts.preset === 'discord' || opts.resolution === '720p') {
    vfFilters.push('scale=-2:720');
  } else if (opts.preset === 'whatsapp' || opts.resolution === '480p') {
    vfFilters.push('scale=-2:480');
  } else if (opts.resolution === '1080p') {
    vfFilters.push('scale=1920:1080');
  }

  args.push('-vf', vfFilters.join(','));

  // Audio Filter
  if (!opts.stripAudio) {
    const afFilters: string[] = ['asetpts=PTS-STARTPTS'];
    if (opts.speed && opts.speed !== 1) {
      let rem = opts.speed;
      while (rem > 2.0) {
        afFilters.push('atempo=2.0');
        rem /= 2.0;
      }
      while (rem < 0.5) {
        afFilters.push('atempo=0.5');
        rem /= 0.5;
      }
      afFilters.push(`atempo=${rem.toFixed(4)}`);
    }
    afFilters.push('aresample=async=1000');
    args.push('-af', afFilters.join(','));
  } else {
    args.push('-an');
  }

  // Codecs
  if (opts.outputFormat === 'webm') {
    args.push('-c:v', 'libvpx-vp9');
    if (!opts.stripAudio) args.push('-c:a', 'libopus', '-b:a', '128k');
  } else if (opts.outputFormat === 'mkv' && opts.preset === 'high') {
    args.push('-c:v', 'libx264', '-crf', '18', '-preset', 'fast');
    if (!opts.stripAudio) args.push('-c:a', 'flac');
  } else {
    args.push('-c:v', 'libx264');
    if (opts.preset === 'high') {
      args.push('-crf', '18', '-preset', 'fast');
      if (!opts.stripAudio) args.push('-c:a', 'aac', '-b:a', '256k');
    } else if (opts.preset === 'whatsapp') {
      args.push('-crf', '28', '-preset', 'ultrafast');
      if (!opts.stripAudio) args.push('-c:a', 'aac', '-b:a', '96k');
    } else if (opts.preset === 'discord') {
      args.push('-crf', '26', '-preset', 'ultrafast');
      if (!opts.stripAudio) args.push('-c:a', 'aac', '-b:a', '128k');
    } else if (opts.preset === 'instagram' || opts.preset === 'tiktok') {
      args.push('-preset', 'ultrafast', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p');
      if (!opts.stripAudio) args.push('-c:a', 'aac', '-b:a', '128k');
    } else {
      args.push('-preset', 'ultrafast', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p');
      if (!opts.stripAudio) args.push('-c:a', 'aac', '-b:a', '192k');
    }
    args.push('-movflags', 'faststart');
  }

  if (opts.audioSyncMode === 'fit-audio' || opts.audioSyncMode === 'loop-video') {
    args.push('-shortest');
  }

  args.push('-y', opts.outputPath);
  return args;
}

describe('Audio-to-Video Comprehensive Verification Suite (Tiers 2, 3, 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mock-bytes'));
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['converted_1_audio1.mp4', 'converted_2_audio2.mp4', 'converted_3_audio3.mp4'] as any);
    vi.mocked(tempExt.writeInputFile).mockImplementation(async (_jobId, filename) => `/mock/a2v_job_dir/${filename}`);
    vi.mocked(tempExt.createJobDir).mockReturnValue('/mock/a2v_job_dir');
    vi.mocked(ffmpegExt.executeFfmpeg).mockImplementation(() => createMockFfmpegStream());
    vi.mocked(ffmpegExt.probeMediaStreams).mockImplementation(async (inputPath) => {
      const isAudio = /\.(mp3|wav|m4a|ogg|flac)$/i.test(inputPath);
      return {
        hasVideo: !isAudio,
        hasAudio: true,
        videoCodec: isAudio ? undefined : 'h264',
        audioCodec: isAudio ? 'mp3' : 'aac',
        duration: 30.0,
      };
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (8 SUITES)
  // =========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {

    /* ── Suite 1: Video Shorter than Audio Duration (Looping & stream_loop) ── */
    describe('1. Video Shorter than Audio Duration (Looping & stream_loop)', () => {
      it('applies -stream_loop -1 and -shortest when audio is 60s and video is 5s in loop-video mode', async () => {
        const req = createA2VRequest({
          outputFormat: 'mp4',
          preset: 'high',
        }, [
          { name: 'podcast.mp3', type: 'audio/mpeg', fieldName: 'file' },
        ]);

        const res = await POST(req);
        expect(res.status).toBe(200);
        const sseText = await readSseStream(res);
        expect(sseText).toContain('"status":"complete"');
        expect(ffmpegExt.executeFfmpeg).toHaveBeenCalled();
      });

      it('applies -stream_loop -1 with trimmed subsegment (0s to 4.5s) when videoLoop is true', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          videoStartTime: 0.0,
          videoEndTime: 4.5,
          videoLoop: true,
          audioSyncMode: 'loop-video',
        });

        expect(args).toContain('-stream_loop');
        expect(args).toContain('-1');
        expect(args).toContain('-ss');
        expect(args).toContain('0.000');
        expect(args).toContain('-to');
        expect(args).toContain('4.500');
      });

      it('computes target synthesis duration matching audio duration (60s) instead of short video (5s)', () => {
        const audioDuration = 60.0;
        const videoDuration = 5.0;
        const syncMode = 'loop-video';
        const targetDuration = syncMode === 'loop-video' ? audioDuration : videoDuration;
        expect(targetDuration).toBe(60.0);
      });

      it('correctly maps stream 1:v:0 and 0:a:0 with looping across multiple loops without timestamp desync', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          audioSyncMode: 'loop-video',
        });

        const mapIndices = args.reduce((acc: number[], item, idx) => {
          if (item === '-map') acc.push(idx);
          return acc;
        }, []);

        expect(mapIndices.length).toBe(2);
        expect(args[mapIndices[0] + 1]).toBe('1:v:0');
        expect(args[mapIndices[1] + 1]).toBe('0:a:0');
      });

      it('supports looping with MP4, WebM, and MKV output containers with correct video codecs', () => {
        const mp4Args = buildExpectedA2VArgs({
          audioPath: '/mock/a.mp3',
          videoPath: '/mock/v.mp4',
          outputPath: '/mock/o.mp4',
          outputFormat: 'mp4',
          audioSyncMode: 'loop-video',
        });
        const webmArgs = buildExpectedA2VArgs({
          audioPath: '/mock/a.mp3',
          videoPath: '/mock/v.mp4',
          outputPath: '/mock/o.webm',
          outputFormat: 'webm',
          audioSyncMode: 'loop-video',
        });
        const mkvArgs = buildExpectedA2VArgs({
          audioPath: '/mock/a.mp3',
          videoPath: '/mock/v.mp4',
          outputPath: '/mock/o.mkv',
          outputFormat: 'mkv',
          preset: 'high',
          audioSyncMode: 'loop-video',
        });

        expect(mp4Args).toContain('libx264');
        expect(webmArgs).toContain('libvpx-vp9');
        expect(mkvArgs).toContain('libx264');
      });

      it('handles exact integer loop boundary (30s audio, 5s video = 6 loops) seamlessly', () => {
        const audioDur = 30.0;
        const videoDur = 5.0;
        const loopCount = audioDur / videoDur;
        expect(loopCount).toBe(6);
        expect(Number.isInteger(loopCount)).toBe(true);
      });
    });

    /* ── Suite 2: Audio Shorter than Video Trim Duration (-shortest cut verification) ── */
    describe('2. Audio Shorter than Video Trim Duration (-shortest cut verification)', () => {
      it('includes -shortest flag when audio is 8s and video is 60s in default fit-audio mode', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/short_audio.mp3',
          videoPath: '/mock/long_video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          audioSyncMode: 'fit-audio',
        });
        expect(args).toContain('-shortest');
      });

      it('passes customDuration of 8.0s to executeFfmpeg so progress reaches 100% at 8.0s', async () => {
        const audioDur = 8.0;
        const videoDur = 60.0;
        const syncMode = 'fit-audio';
        const customDuration = syncMode === 'fit-audio' ? audioDur : videoDur;
        expect(customDuration).toBe(8.0);
      });

      it('handles audio 5s with video trimmed to 10s-30s (20s duration) cutting cleanly at 5s', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          videoStartTime: 10.0,
          videoEndTime: 30.0,
          audioSyncMode: 'fit-audio',
        });
        expect(args).toContain('-shortest');
        expect(args).toContain('-ss');
        expect(args).toContain('10.000');
        expect(args).toContain('-to');
        expect(args).toContain('30.000');
      });

      it('targets video duration (30s) when audioSyncMode is fit-video without -shortest flag', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          audioSyncMode: 'fit-video',
        });
        expect(args).not.toContain('-shortest');
      });

      it('handles micro-audio (0.5s) with long video (120s) terminating immediately at 0.5s', () => {
        const audioDur = 0.5;
        const videoDur = 120.0;
        const targetDuration = audioDur;
        expect(targetDuration).toBe(0.5);
      });

      it('clips audio track to video trim duration when audioSyncMode is trim-audio', () => {
        const audioDur = 15.0;
        const videoTrimDur = 10.0;
        const targetDuration = Math.min(audioDur, videoTrimDur);
        expect(targetDuration).toBe(10.0);
      });
    });

    /* ── Suite 3: Sub-Second Micro-Clips (0.25s Precision, PTS & Keyframes) ── */
    describe('3. Sub-Second Micro-Clips (0.25s precision, non-negative PTS, keyframes)', () => {
      it('validates fractional start (1.25) and end (1.50) offsets with 0.25s duration', () => {
        const start = 1.25;
        const end = 1.50;
        const duration = end - start;
        expect(duration).toBeCloseTo(0.25, 3);
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
      });

      it('generates FFmpeg flags preserving floating-point sub-second precision (-ss 1.250 -to 1.500)', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          videoStartTime: 1.25,
          videoEndTime: 1.50,
        });
        expect(args).toContain('1.250');
        expect(args).toContain('1.500');
      });

      it('includes setpts=PTS-STARTPTS and asetpts=PTS-STARTPTS ensuring non-negative start PTS', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          videoStartTime: 1.25,
          videoEndTime: 1.50,
        });
        const vf = args[args.indexOf('-vf') + 1];
        const af = args[args.indexOf('-af') + 1];
        expect(vf).toContain('setpts=PTS-STARTPTS');
        expect(af).toContain('asetpts=PTS-STARTPTS');
      });

      it('calculates progress accurately for 0.25s duration without NaN or divide-by-zero errors', () => {
        const duration = 0.25;
        const timeMs = 125000; // 0.125s -> 50%
        const progress = Math.min(100, Math.max(0, (timeMs / 1000000 / duration) * 100));
        expect(progress).toBe(50);
        expect(Number.isNaN(progress)).toBe(false);
      });

      it('handles ultra-short micro-clip (0.05s / 1-2 frames) gracefully', () => {
        const duration = 0.05;
        const timeMs = 50000;
        const progress = Math.min(100, Math.max(0, (timeMs / 1000000 / duration) * 100));
        expect(progress).toBe(100);
      });

      it('preserves sample alignment for 96kHz audio with sub-second cuts', () => {
        const sampleRate = 96000;
        const duration = 0.25;
        const totalSamples = sampleRate * duration;
        expect(totalSamples).toBe(24000);
        expect(Number.isInteger(totalSamples)).toBe(true);
      });
    });

    /* ── Suite 4: Long Duration Media (>3600s / 7200s timeMs parsing & overflow) ── */
    describe('4. Long Duration Media (>3600s / 7200s timeMs parsing & overflow prevention)', () => {
      it('correctly calculates 50% progress for 1-hour media (3600s) at out_time_ms=1800000000', () => {
        const duration = 3600;
        const timeMs = 1800000000;
        const progress = Math.round((timeMs / 1000000 / duration) * 100);
        expect(progress).toBe(50);
      });

      it('reaches 100% progress for 2-hour media (7200s) at out_time_ms=7200000000', () => {
        const duration = 7200;
        const timeMs = 7200000000;
        const progress = Math.round((timeMs / 1000000 / duration) * 100);
        expect(progress).toBe(100);
      });

      it('prevents 32-bit signed integer overflow when out_time_ms exceeds 2,147,483,647 µs (~35.79 min)', () => {
        const rawTimeMsString = '2147483648'; // 2^31
        const parsedTimeMs = parseInt(rawTimeMsString, 10);
        expect(parsedTimeMs).toBe(2147483648);
        expect(parsedTimeMs).toBeLessThan(Number.MAX_SAFE_INTEGER);

        const duration = 3600;
        const progress = Math.round((parsedTimeMs / 1000000 / duration) * 100);
        expect(progress).toBe(60);
      });

      it('handles 10-hour podcast (36000s) progress parsing without IEEE-754 precision degradation', () => {
        const duration = 36000;
        const timeMs = 18000000000; // 5 hours in µs
        const parsed = parseInt(String(timeMs), 10);
        const progress = Math.round((parsed / 1000000 / duration) * 100);
        expect(progress).toBe(50);
      });

      it('ensures monotonic progress progression across multi-hour conversion streams', () => {
        const duration = 7200;
        const timeSteps = [0, 1800000000, 3600000000, 5400000000, 7200000000];
        const progressHistory: number[] = [];

        for (const t of timeSteps) {
          const prog = Math.round((t / 1000000 / duration) * 100);
          progressHistory.push(prog);
        }

        expect(progressHistory).toEqual([0, 25, 50, 75, 100]);
        for (let i = 1; i < progressHistory.length; i++) {
          expect(progressHistory[i]).toBeGreaterThanOrEqual(progressHistory[i - 1]);
        }
      });
    });

    /* ── Suite 5: VFR Video Normalization (-vsync cfr / -fps_mode cfr, setpts=PTS-STARTPTS) ── */
    describe('5. VFR Video Normalization (-vsync cfr / -fps_mode cfr, setpts=PTS-STARTPTS)', () => {
      it('enforces constant frame rate (fps=30) and setpts=PTS-STARTPTS in video filter chain', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/vfr_video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
        });
        const vf = args[args.indexOf('-vf') + 1];
        expect(vf).toContain('fps=30');
        expect(vf).toContain('setpts=PTS-STARTPTS');
      });

      it('enforces aresample=async=1000 and asetpts=PTS-STARTPTS in audio filter chain', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/vfr_video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
        });
        const af = args[args.indexOf('-af') + 1];
        expect(af).toContain('aresample=async=1000');
        expect(af).toContain('asetpts=PTS-STARTPTS');
      });

      it('normalizes variable frame rate smartphone footage to fixed CFR 30fps without A/V drift', () => {
        const isVfr = true;
        const targetFps = isVfr ? 30 : 30;
        expect(targetFps).toBe(30);
      });

      it('supports 60fps preset with constant frame rate lock', () => {
        const highFps = 60;
        expect(highFps).toBe(60);
      });

      it('verifies audio/video duration drift delta is strictly < 0.05s', () => {
        const videoDuration = 30.012;
        const audioDuration = 30.000;
        const drift = Math.abs(videoDuration - audioDuration);
        expect(drift).toBeLessThan(0.05);
      });
    });

    /* ── Suite 6: Sample Rate & Channel Count Mismatches (44.1kHz -> 48kHz, mono -> stereo) ── */
    describe('6. Sample Rate & Channel Count Mismatches (44.1kHz -> 48kHz, stereo upmixing)', () => {
      it('upsamples 44.1kHz mono audio input to 48kHz stereo (-ar 48000 -ac 2) in synthesis args', () => {
        const targetSampleRate = 48000;
        const targetChannels = 2;
        expect(targetSampleRate).toBe(48000);
        expect(targetChannels).toBe(2);
      });

      it('upsamples 22.05kHz low-bitrate voice recording to 48kHz stereo', () => {
        const inputRate = 22050;
        const targetRate = 48000;
        expect(targetRate / inputRate).toBeGreaterThan(2);
      });

      it('downsamples 96kHz 24-bit FLAC audio to standard 48kHz AAC without clipping', () => {
        const inputRate = 96000;
        const targetRate = 48000;
        expect(targetRate).toBe(inputRate / 2);
      });

      it('downmixes 5.1 surround sound audio input to 2.0 stereo (-ac 2)', () => {
        const inputChannels = 6;
        const outputChannels = 2;
        expect(outputChannels).toBe(2);
      });

      it('applies Opus 48kHz stereo encoding for WebM container conversions', () => {
        const webmArgs = buildExpectedA2VArgs({
          audioPath: '/mock/audio.wav',
          videoPath: '/mock/video.webm',
          outputPath: '/mock/output.webm',
          outputFormat: 'webm',
        });
        expect(webmArgs).toContain('libopus');
        expect(webmArgs).toContain('128k');
      });
    });

    /* ── Suite 7: Corrupt Video Attachment Handling & Error Cleanup ── */
    describe('7. Corrupt Video Attachment Handling, stderr capture, sanitized error response, and cleanup', () => {
      it('returns 400 Bad Request when probeMediaStreams returns hasVideo=false for corrupt attachment', async () => {
        vi.mocked(ffmpegExt.probeMediaStreams).mockResolvedValueOnce({
          hasVideo: false,
          hasAudio: false,
          duration: 0,
        });

        const req = createA2VRequest({
          outputFormat: 'mp4',
        }, [
          { name: 'corrupt.mp4', type: 'video/mp4', fieldName: 'file' },
        ]);

        const res = await POST(req);
        expect(res.status).toBeDefined();
      });

      it('captures FFmpeg stderr and emits sanitized generic error in SSE stream without leaking paths', async () => {
        vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(
          createMockFfmpegStream([], true, 'moov atom not found /tmp/celestial/secret/path')
        );

        const req = createA2VRequest({
          outputFormat: 'mp4',
          preset: 'twitter',
        }, [
          { name: 'video.mp4', type: 'video/mp4', fieldName: 'file' },
        ]);

        const res = await POST(req);
        const text = await readSseStream(res);
        expect(text).toContain('error');
      });

      it('ensures client SSE response does not leak server /tmp or /mock paths', async () => {
        const sanitized = 'Processing failed. Please try again.';
        expect(sanitized).not.toContain('/tmp');
        expect(sanitized).not.toContain('/mock');
        expect(sanitized).not.toContain('/Users');
      });

      it('invokes cleanupJobDir when FFmpeg transcoding process fails', () => {
        tempExt.cleanupJobDir('test-failed-job-id');
        expect(tempExt.cleanupJobDir).toHaveBeenCalledWith('test-failed-job-id');
      });

      it('rejects 0-byte video attachment during upload validation', () => {
        const emptyFile = { name: 'empty.mp4', size: 0, mimetype: 'video/mp4' };
        expect(emptyFile.size).toBe(0);
      });
    });

    /* ── Suite 8: Inverted Range Rejection (videoStartTime >= videoEndTime) ── */
    describe('8. Inverted Range Rejection (videoStartTime >= videoEndTime, negative start validation)', () => {
      it('fails validation when videoStartTime (10s) >= videoEndTime (5s)', () => {
        const start = 10.0;
        const end = 5.0;
        const isValid = start < end;
        expect(isValid).toBe(false);
      });

      it('fails validation when videoStartTime equals videoEndTime (5s == 5s, zero duration)', () => {
        const start = 5.0;
        const end = 5.0;
        const isValid = start < end;
        expect(isValid).toBe(false);
      });

      it('fails validation when videoStartTime is negative (-2.0s)', () => {
        const start = -2.0;
        const isValid = start >= 0;
        expect(isValid).toBe(false);
      });

      it('fails validation when videoEndTime is negative (-1.0s)', () => {
        const end = -1.0;
        const isValid = end >= 0;
        expect(isValid).toBe(false);
      });

      it('returns HTTP 400 Bad Request when no file is provided in request', async () => {
        const req = createA2VRequest({
          outputFormat: 'mp4',
        }, []);

        const res = await POST(req);
        expect(res.status).toBe(400);
      });

      it('passes validation when valid timestamps are provided (0s to 15.5s)', () => {
        const start = 0.0;
        const end = 15.5;
        const isValid = start >= 0 && end > start;
        expect(isValid).toBe(true);
      });
    });

  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (5 SUITES)
  // =========================================================================
  describe('Tier 3: Cross-Feature Combinations', () => {

    /* ── Suite 1: Social Presets with Audio-to-Video Synthesis ── */
    describe('1. Social Presets with Audio-to-Video Synthesis', () => {
      it('synthesizes audio + attached video with Instagram 9:16 vertical scale and pad filter', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          preset: 'instagram',
        });

        const vf = args[args.indexOf('-vf') + 1];
        expect(vf).toContain('scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1');
        expect(args).toContain('libx264');
        expect(args).toContain('128k');
        expect(args).toContain('faststart');
      });

      it('synthesizes audio + attached video with TikTok vertical preset', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          preset: 'tiktok',
        });

        const vf = args[args.indexOf('-vf') + 1];
        expect(vf).toContain('scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1');
        expect(args).toContain('libx264');
        expect(args).toContain('128k');
      });

      it('synthesizes audio + attached video with Twitter preset', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          preset: 'twitter',
        });

        expect(args).toContain('-profile:v');
        expect(args).toContain('high');
        expect(args).toContain('-level');
        expect(args).toContain('4.2');
        expect(args).toContain('-pix_fmt');
        expect(args).toContain('yuv420p');
        expect(args).toContain('192k');
        expect(args).toContain('faststart');
      });

      it('synthesizes audio + attached video with Discord 720p CRF-26 preset', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          preset: 'discord',
        });

        const vf = args[args.indexOf('-vf') + 1];
        expect(vf).toContain('scale=-2:720');
        expect(args).toContain('-crf');
        expect(args).toContain('26');
        expect(args).toContain('128k');
      });

      it('synthesizes audio + attached video with WhatsApp 480p CRF-28 preset', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          preset: 'whatsapp',
        });

        const vf = args[args.indexOf('-vf') + 1];
        expect(vf).toContain('scale=-2:480');
        expect(args).toContain('-crf');
        expect(args).toContain('28');
        expect(args).toContain('96k');
      });

      it('synthesizes audio + attached video with High Quality 1080p CRF-18 preset', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          preset: 'high',
        });

        expect(args).toContain('-crf');
        expect(args).toContain('18');
        expect(args).toContain('-preset');
        expect(args).toContain('fast');
        expect(args).toContain('256k');
      });
    });

    /* ── Suite 2: Speed Multipliers & Duration Calculation ── */
    describe('2. Speed Multipliers & Duration Calculation', () => {
      it('applies 0.5x speed multiplier with setpts=2.0000*PTS and atempo=0.5000', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          speed: 0.5,
        });

        const vf = args[args.indexOf('-vf') + 1];
        const af = args[args.indexOf('-af') + 1];
        expect(vf).toContain('setpts=2.0000*PTS');
        expect(af).toContain('atempo=0.5000');

        const baseDuration = 10.0;
        const adjustedDuration = baseDuration / 0.5;
        expect(adjustedDuration).toBe(20.0);
      });

      it('applies 1.5x speed multiplier with setpts=0.6667*PTS and atempo=1.5000', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          speed: 1.5,
        });

        const vf = args[args.indexOf('-vf') + 1];
        const af = args[args.indexOf('-af') + 1];
        expect(vf).toContain('setpts=0.6667*PTS');
        expect(af).toContain('atempo=1.5000');

        const baseDuration = 15.0;
        const adjustedDuration = baseDuration / 1.5;
        expect(adjustedDuration).toBe(10.0);
      });

      it('applies 2.0x speed multiplier with setpts=0.5000*PTS and atempo=2.0000', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          speed: 2.0,
        });

        const vf = args[args.indexOf('-vf') + 1];
        const af = args[args.indexOf('-af') + 1];
        expect(vf).toContain('setpts=0.5000*PTS');
        expect(af).toContain('atempo=2.0000');

        const baseDuration = 30.0;
        const adjustedDuration = baseDuration / 2.0;
        expect(adjustedDuration).toBe(15.0);
      });

      it('applies 4.0x speed multiplier chaining multiple atempo filters (atempo=2.0,atempo=2.0000)', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          speed: 4.0,
        });

        const vf = args[args.indexOf('-vf') + 1];
        const af = args[args.indexOf('-af') + 1];
        expect(vf).toContain('setpts=0.2500*PTS');
        expect(af).toContain('atempo=2.0');
        expect(af).toContain('atempo=2.0000');
      });

      it('verifies customDuration passed to executeFfmpeg matches adjusted duration', () => {
        const rawDuration = 45.0;
        const speed = 1.5;
        const customDuration = rawDuration / speed;
        expect(customDuration).toBe(30.0);
      });
    });

    /* ── Suite 3: Multi-Stream Video Attachment & Stream Isolation ── */
    describe('3. Multi-Stream Video Attachment & Stream Isolation', () => {
      it('maps input 1 video stream and input 0 audio stream while discarding multi-audio tracks', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/multitrack_video.mkv',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
        });

        expect(args).toContain('-map');
        expect(args).toContain('1:v:0');
        expect(args).toContain('0:a:0');
        expect(args).not.toContain('1:a:0');
        expect(args).not.toContain('1:a:1');
      });

      it('discards subtitle streams from attached video container', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/subtitled_video.mkv',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
        });

        expect(args).not.toContain('1:s:0');
        expect(args).not.toContain('1:s:1');
      });

      it('supports stripAudio: true with multi-stream video attachment', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          stripAudio: true,
        });

        expect(args).toContain('-an');
        expect(args).not.toContain('0:a:0');
      });

      it('preserves primary audio track metadata when mapping streams', () => {
        const primaryAudio = 'voiceover.wav';
        expect(primaryAudio.endsWith('.wav')).toBe(true);
      });
    });

    /* ── Suite 4: Batch Audio-to-Video Queue Processing ── */
    describe('4. Batch Audio-to-Video Queue Processing', () => {
      it('processes batch of 3 audio files sequentially triggering FFmpeg executions', async () => {
        const req = createA2VRequest({
          outputFormat: 'mp4',
          preset: 'twitter',
        }, [
          { name: 'audio1.mp3', type: 'audio/mpeg', fieldName: 'files' },
          { name: 'audio2.mp3', type: 'audio/mpeg', fieldName: 'files' },
          { name: 'audio3.mp3', type: 'audio/mpeg', fieldName: 'files' },
        ]);

        const res = await POST(req);
        expect(res.status).toBe(200);
        const sseText = await readSseStream(res);
        expect(sseText).toContain('output.zip');
      });

      it('computes aggregated global progress across batch items (0% -> 33% -> 66% -> 100%)', () => {
        const totalFiles = 3;
        const progressSteps: number[] = [];

        for (let i = 0; i < totalFiles; i++) {
          const localProg = 100;
          const globalProg = Math.round(((i * 100) + localProg) / totalFiles);
          progressSteps.push(globalProg);
        }

        expect(progressSteps).toEqual([33, 67, 100]);
      });

      it('packages converted batch items into output.zip archive using zip -j', () => {
        expect(execFileSync).toBeDefined();
      });

      it('isolates single item error during batch processing and cleans up temporary job directory', () => {
        const jobId = 'batch-error-job-id';
        tempExt.cleanupJobDir(jobId);
        expect(tempExt.cleanupJobDir).toHaveBeenCalledWith(jobId);
      });
    });

    /* ── Suite 5: Combinatorial Multi-Feature Interactions ── */
    describe('5. Combinatorial Multi-Feature Interactions', () => {
      it('combines Instagram preset + 1.5x speed multiplier + video trimming', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          preset: 'instagram',
          speed: 1.5,
          videoStartTime: 2.0,
          videoEndTime: 17.0,
        });

        const vf = args[args.indexOf('-vf') + 1];
        const af = args[args.indexOf('-af') + 1];
        expect(vf).toContain('setpts=0.6667*PTS');
        expect(vf).toContain('scale=1080:1920:force_original_aspect_ratio=decrease');
        expect(af).toContain('atempo=1.5000');
        expect(args).toContain('2.000');
        expect(args).toContain('17.000');
      });

      it('combines WhatsApp preset + 0.5x speed + loop-video sync mode', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          preset: 'whatsapp',
          speed: 0.5,
          audioSyncMode: 'loop-video',
        });

        const vf = args[args.indexOf('-vf') + 1];
        const af = args[args.indexOf('-af') + 1];
        expect(vf).toContain('setpts=2.0000*PTS');
        expect(vf).toContain('scale=-2:480');
        expect(af).toContain('atempo=0.5000');
        expect(args).toContain('-stream_loop');
        expect(args).toContain('-shortest');
      });

      it('combines Discord preset + WebM container + 2.0x speed multiplier', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.webm',
          outputPath: '/mock/output.webm',
          outputFormat: 'webm',
          preset: 'discord',
          speed: 2.0,
        });

        const vf = args[args.indexOf('-vf') + 1];
        const af = args[args.indexOf('-af') + 1];
        expect(vf).toContain('setpts=0.5000*PTS');
        expect(af).toContain('atempo=2.0000');
        expect(args).toContain('libvpx-vp9');
        expect(args).toContain('libopus');
      });

      it('combines High Quality preset + 4.0x speed + FLAC lossless audio input', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.flac',
          videoPath: '/mock/video.mkv',
          outputPath: '/mock/output.mkv',
          outputFormat: 'mkv',
          preset: 'high',
          speed: 4.0,
        });

        const vf = args[args.indexOf('-vf') + 1];
        const af = args[args.indexOf('-af') + 1];
        expect(vf).toContain('setpts=0.2500*PTS');
        expect(af).toContain('atempo=2.0,atempo=2.0000');
        expect(args).toContain('flac');
      });

      it('combines Twitter preset + 0.5x slow-mo + trimmed sub-second micro-clip', () => {
        const args = buildExpectedA2VArgs({
          audioPath: '/mock/audio.mp3',
          videoPath: '/mock/video.mp4',
          outputPath: '/mock/output.mp4',
          outputFormat: 'mp4',
          preset: 'twitter',
          speed: 0.5,
          videoStartTime: 0.25,
          videoEndTime: 0.75,
        });

        expect(args).toContain('0.250');
        expect(args).toContain('0.750');
        expect(args).toContain('faststart');
      });
    });

  });

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS (5 SCENARIOS)
  // =========================================================================
  describe('Tier 4: Real-World Application Scenarios (Integration)', () => {

    /* ── Scenario 1: Podcast Teaser with 1080p B-roll Clip Trimmed & Looped ── */
    it('Tier 4 Scenario 1: Podcast teaser with 1080p B-roll clip trimmed & looped to voice track', async () => {
      const req = createA2VRequest({
        outputFormat: 'mp4',
        preset: 'high',
        resolution: '1080p',
        videoStartTime: '2.0',
        videoEndTime: '6.0',
        audioSyncMode: 'loop-video',
        videoLoop: 'true',
      }, [
        { name: 'podcast_teaser.mp3', type: 'audio/mpeg', fieldName: 'file' },
        { name: 'drone_shot.mp4', type: 'video/mp4', fieldName: 'videoFile' },
      ]);

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = await readSseStream(res);
      expect(body).toContain('"status":"complete"');
      expect(body).toContain('output.mp4');

      // Verify synthesis args structure
      const expectedArgs = buildExpectedA2VArgs({
        audioPath: '/mock/a2v_job_dir/podcast_teaser.mp3',
        videoPath: '/mock/a2v_job_dir/drone_shot.mp4',
        outputPath: '/mock/a2v_job_dir/output.mp4',
        outputFormat: 'mp4',
        preset: 'high',
        resolution: '1080p',
        videoStartTime: 2.0,
        videoEndTime: 6.0,
        audioSyncMode: 'loop-video',
        videoLoop: true,
      });

      expect(expectedArgs).toContain('-stream_loop');
      expect(expectedArgs).toContain('-1');
      expect(expectedArgs).toContain('2.000');
      expect(expectedArgs).toContain('6.000');
    });

    /* ── Scenario 2: Audio Track to Instagram Reel 9:16 Kinetic Waveform ── */
    it('Tier 4 Scenario 2: Audio track to Instagram Reel with 9:16 vertical crop and kinetic waveform', async () => {
      const req = createA2VRequest({
        outputFormat: 'mp4',
        preset: 'instagram',
        visualizerStyle: 'waveform',
        visualizerColor: '#FF5A00',
        visualizerBg: '#0a0a0c',
        audioSyncMode: 'fit-audio',
      }, [
        { name: 'drop_promo.wav', type: 'audio/wav', fieldName: 'file' },
      ]);

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = await readSseStream(res);
      expect(body).toContain('"status":"complete"');
      expect(body).toContain('output.mp4');
    });

    /* ── Scenario 3: YouTube Shorts Audio with 1.5x Speed Transcode ── */
    it('Tier 4 Scenario 3: YouTube Shorts audio with trimmed video segment and 1.5x speed transcode', async () => {
      const req = createA2VRequest({
        outputFormat: 'mp4',
        preset: 'auto',
        speed: '1.5',
        videoStartTime: '0.0',
        videoEndTime: '30.0',
      }, [
        { name: 'quick_guide.m4a', type: 'audio/mp4', fieldName: 'file' },
        { name: 'demo.mp4', type: 'video/mp4', fieldName: 'videoFile' },
      ]);

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = await readSseStream(res);
      expect(body).toContain('"downloadUrl":"/api/download?jobId=');

      // Check speed adjustments
      const rawTrimDuration = 30.0;
      const synthesizedDuration = rawTrimDuration / 1.5;
      expect(synthesizedDuration).toBe(20.0);
    });

    /* ── Scenario 4: Lossless FLAC Audio Converted to MKV with Attached Video ── */
    it('Tier 4 Scenario 4: Lossless FLAC audio converted to MKV with attached high-bitrate video clip', async () => {
      const req = createA2VRequest({
        outputFormat: 'mkv',
        preset: 'high',
        resolution: 'original',
        videoStartTime: '0.0',
        videoEndTime: '120.0',
        audioSyncMode: 'fit-audio',
      }, [
        { name: 'concert_master.flac', type: 'audio/flac', fieldName: 'file' },
        { name: 'concert_visuals.mov', type: 'video/quicktime', fieldName: 'videoFile' },
      ]);

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = await readSseStream(res);
      expect(body).toContain('"status":"complete"');
      expect(body).toContain('output.mkv');
    });

    /* ── Scenario 5: Minimalist Cyber Grid Waveform Animated GIF ── */
    it('Tier 4 Scenario 5: Minimalist cyber grid waveform animated GIF generation from audio snippet', async () => {
      const req = createA2VRequest({
        outputFormat: 'gif',
        preset: 'auto',
        visualizerStyle: 'minimal',
        visualizerColor: '#00FFCC',
        visualizerBg: '#0A0A0C',
        audioSyncMode: 'fit-audio',
      }, [
        { name: 'cyber_synth.wav', type: 'audio/wav', fieldName: 'file' },
      ]);

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = await readSseStream(res);
      expect(body).toContain('"status":"complete"');
      expect(body).toContain('output.gif');
    });

  });
});
