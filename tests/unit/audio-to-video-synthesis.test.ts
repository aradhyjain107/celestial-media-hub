import { expect, describe, test, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import { ConvertInputSchema } from '../../schemas/convert';
import {
  buildAudioVideoSynthesisArgs,
  buildVisualizerSynthesisArgs,
  executeFfmpeg,
  probeMediaStreams,
  getMediaDuration,
  hexToFfmpegColor,
} from '../../lib/ffmpeg';
import { POST } from '../../app/api/convert/route';
import * as tempExt from '../../lib/temp';
import * as ffmpegExt from '../../lib/ffmpeg';
import * as authExt from '../../lib/auth';

// ── Mock Setup ────────────────────────────────────────────────────────────────

vi.mock('../../lib/temp', () => ({
  writeInputFile: vi.fn(),
  cleanupJobDir: vi.fn(),
  createJobDir: vi.fn().mockReturnValue('/mock/tmp/job-a2v-123'),
  sanitizeFilename: vi.fn((f: string) => f.replace(/[^a-zA-Z0-9._-]/g, '_')),
}));

vi.mock('../../lib/ffmpeg', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    executeFfmpeg: vi.fn(actual.executeFfmpeg),
    probeMediaStreams: vi.fn(actual.probeMediaStreams),
    getMediaDuration: vi.fn(actual.getMediaDuration),
  };
});

vi.mock('../../lib/env', () => ({
  env: {
    FFMPEG_PATH: '/mock/ffmpeg',
    YTDLP_PATH: '/mock/ytdlp',
    TEMP_DIR: '/mock/tmp',
    JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!',
  },
}));

vi.mock('../../lib/auth', () => ({
  verifyAuth: vi.fn().mockReturnValue({ userId: 'user_test_a2v' }),
  registerJobOwner: vi.fn(),
  verifyJobOwnership: vi.fn().mockReturnValue(true),
}));

// Helper to consume an SSE stream into a string
async function readSseStream(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ConvertInputSchema — Audio-to-Video Schema Validation
// ─────────────────────────────────────────────────────────────────────────────
describe('1. ConvertInputSchema — Audio-to-Video Schema Validation', () => {
  test('populates default audio-to-video parameters when omitted', () => {
    const parsed = ConvertInputSchema.parse({
      outputFormat: 'mp4',
    });
    expect(parsed.audioSyncMode).toBe('fit-audio');
    expect(parsed.visualizerStyle).toBe('none');
    expect(parsed.visualizerColor).toBe('#00F2FE');
    expect(parsed.visualizerBg).toBe('#0a0a0c');
    expect(parsed.videoLoop).toBe(true);
    expect(parsed.preset).toBe('auto');
    expect(parsed.speed).toBe(1);
    expect(parsed.resolution).toBe('original');
  });

  test('validates valid attached video metadata and trimming parameters', () => {
    const payload = {
      outputFormat: 'mp4',
      videoFile: {
        filename: 'background_clip.mp4',
        size: 15_000_000,
        mimetype: 'video/mp4',
      },
      videoStartTime: 3.5,
      videoEndTime: 18.2,
      audioSyncMode: 'fit-video' as const,
      videoLoop: true,
    };
    const validation = ConvertInputSchema.safeParse(payload);
    expect(validation.success).toBe(true);
    if (validation.success) {
      expect(validation.data.videoStartTime).toBe(3.5);
      expect(validation.data.videoEndTime).toBe(18.2);
      expect(validation.data.audioSyncMode).toBe('fit-video');
      expect(validation.data.videoLoop).toBe(true);
      expect(validation.data.videoFile?.filename).toBe('background_clip.mp4');
    }
  });

  test('validates all audioSyncMode enum values', () => {
    const modes = ['fit-audio', 'fit-video', 'loop-video', 'trim-audio'] as const;
    for (const mode of modes) {
      const res = ConvertInputSchema.safeParse({ outputFormat: 'mp4', audioSyncMode: mode });
      expect(res.success).toBe(true);
    }
  });

  test('validates all visualizerStyle enum values', () => {
    const styles = ['none', 'waveform', 'frequency', 'circular', 'minimal'] as const;
    for (const style of styles) {
      const res = ConvertInputSchema.safeParse({ outputFormat: 'mp4', visualizerStyle: style });
      expect(res.success).toBe(true);
    }
  });

  test('validates all video output formats for synthesis', () => {
    const videoFormats = ['mp4', 'mkv', 'mov', 'webm', 'gif'] as const;
    for (const fmt of videoFormats) {
      const res = ConvertInputSchema.safeParse({ outputFormat: fmt });
      expect(res.success).toBe(true);
    }
  });

  test('rejects negative videoStartTime', () => {
    const res = ConvertInputSchema.safeParse({
      outputFormat: 'mp4',
      videoStartTime: -2.5,
    });
    expect(res.success).toBe(false);
  });

  test('rejects negative videoEndTime', () => {
    const res = ConvertInputSchema.safeParse({
      outputFormat: 'mp4',
      videoEndTime: -5.0,
    });
    expect(res.success).toBe(false);
  });

  test('rejects invalid audioSyncMode value', () => {
    const res = ConvertInputSchema.safeParse({
      outputFormat: 'mp4',
      audioSyncMode: 'invalid-sync-mode' as any,
    });
    expect(res.success).toBe(false);
  });

  test('rejects invalid visualizerStyle value', () => {
    const res = ConvertInputSchema.safeParse({
      outputFormat: 'mp4',
      visualizerStyle: 'unsupported-3d' as any,
    });
    expect(res.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. buildAudioVideoSynthesisArgs — Audio + Attached Video Synthesis
// ─────────────────────────────────────────────────────────────────────────────
describe('2. buildAudioVideoSynthesisArgs — Audio + Attached Video Synthesis', () => {
  const baseOpts = {
    audioPath: '/tmp/job/audio.mp3',
    videoPath: '/tmp/job/clip.mp4',
    outputPath: '/tmp/job/output.mp4',
    outputFormat: 'mp4',
    audioDuration: 60.0,
    videoDuration: 15.0,
    videoStartTime: 2.0,
    videoEndTime: 12.0,
    audioSyncMode: 'fit-audio' as const,
    videoLoop: false,
    resolution: 'original',
    speed: 1,
  };

  test('generates standard MP4 synthesis args with zero-drift filters and stream isolation', () => {
    const args = buildAudioVideoSynthesisArgs(baseOpts);
    const cmd = args.join(' ');

    // Threading & Overwrite
    expect(args).toContain('-threads');
    expect(args).toContain('0');
    expect(args).toContain('-y');
    expect(args[args.length - 1]).toBe('/tmp/job/output.mp4');

    // Input Ordering & Seeking
    expect(cmd).toContain('-i /tmp/job/audio.mp3');
    expect(cmd).toContain('-ss 2 -to 12');
    expect(cmd).toContain('-i /tmp/job/clip.mp4');

    // Stream Isolation (Video from clip, Audio from user song)
    expect(cmd).toContain('-map 1:v:0');
    expect(cmd).toContain('-map 0:a:0');

    // Video & Audio Codecs for MP4
    expect(cmd).toContain('-c:v libx264');
    expect(cmd).toContain('-preset ultrafast');
    expect(cmd).toContain('-profile:v high');
    expect(cmd).toContain('-level 4.2');
    expect(cmd).toContain('-pix_fmt yuv420p');
    expect(cmd).toContain('-c:a aac');
    expect(cmd).toContain('-b:a 192k');
    expect(cmd).toContain('-movflags faststart');

    // Zero-drift timestamp alignment & audio resampling
    expect(cmd).toContain('setpts=PTS-STARTPTS');
    expect(cmd).toContain('fps=30');
    expect(cmd).toContain('asetpts=PTS-STARTPTS');
    expect(cmd).toContain('aresample=async=1000');
  });

  test('generates WebM synthesis args with VP9 and Opus', () => {
    const args = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      outputFormat: 'webm',
      outputPath: '/tmp/job/output.webm',
    });
    const cmd = args.join(' ');

    expect(cmd).toContain('-c:v libvpx-vp9');
    expect(cmd).toContain('-b:v 0');
    expect(cmd).toContain('-crf 30');
    expect(cmd).toContain('-c:a libopus');
    expect(cmd).toContain('-b:a 128k');
    expect(cmd).toContain('-map 1:v:0 -map 0:a:0');
  });

  test('generates MKV synthesis args with H.264 and AAC', () => {
    const args = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      outputFormat: 'mkv',
      outputPath: '/tmp/job/output.mkv',
    });
    const cmd = args.join(' ');

    expect(cmd).toContain('-c:v libx264');
    expect(cmd).toContain('-c:a aac');
    expect(cmd).toContain('-map 1:v:0 -map 0:a:0');
  });

  test('generates MOV synthesis args with faststart', () => {
    const args = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      outputFormat: 'mov',
      outputPath: '/tmp/job/output.mov',
    });
    const cmd = args.join(' ');

    expect(cmd).toContain('-c:v libx264');
    expect(cmd).toContain('-c:a aac');
    expect(cmd).toContain('-movflags faststart');
  });

  test('applies -stream_loop -1 when video is shorter than audio in fit-audio mode', () => {
    const args = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      audioDuration: 60.0,
      videoDuration: 10.0,
      videoStartTime: 0,
      videoEndTime: 10.0,
      audioSyncMode: 'fit-audio',
    });
    const cmd = args.join(' ');

    // -stream_loop -1 must be placed before -i <videoPath>
    expect(cmd).toMatch(/-stream_loop -1.*-i \/tmp\/job\/clip\.mp4/);
    expect(cmd).toContain('-shortest');
  });

  test('applies -stream_loop -1 in explicit loop-video mode', () => {
    const args = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      audioSyncMode: 'loop-video',
    });
    const cmd = args.join(' ');

    expect(cmd).toMatch(/-stream_loop -1.*-i \/tmp\/job\/clip\.mp4/);
    expect(cmd).toContain('-shortest');
  });

  test('bounds duration to video clip length in fit-video mode without looping', () => {
    const args = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      audioDuration: 120.0,
      videoDuration: 10.0,
      videoStartTime: 0,
      videoEndTime: 10.0,
      audioSyncMode: 'fit-video',
    });
    const cmd = args.join(' ');

    expect(cmd).not.toContain('-stream_loop -1 -i /tmp/job/clip.mp4');
    expect(cmd).toContain('-t 10');
  });

  test('generates animated GIF from attached video with palettegen and lanczos scale', () => {
    const args = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      outputFormat: 'gif',
      outputPath: '/tmp/job/output.gif',
      videoStartTime: 1.0,
      videoEndTime: 6.0,
    });
    const cmd = args.join(' ');

    expect(cmd).toContain('palettegen');
    expect(cmd).toContain('paletteuse');
    expect(cmd).toContain('flags=lanczos');
    expect(cmd).toContain('-loop 0');
    expect(cmd).not.toContain('-c:a'); // GIFs have no audio
  });

  test('applies speed variations adjusting setpts and atempo in synthesis', () => {
    const doubleSpeed = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      speed: 2.0,
    });
    expect(doubleSpeed.join(' ')).toContain('setpts=(1/2)*PTS');
    expect(doubleSpeed.join(' ')).toContain('atempo=2');
    expect(doubleSpeed.targetDuration).toBe(30.0);

    const quadSpeed = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      speed: 4.0,
    });
    expect(quadSpeed.join(' ')).toContain('atempo=2.0,atempo=2');
    expect(quadSpeed.targetDuration).toBe(15.0);

    const halfSpeed = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      speed: 0.5,
    });
    expect(halfSpeed.join(' ')).toContain('atempo=0.5');
    expect(halfSpeed.targetDuration).toBe(120.0);
  });

  test('applies social platform presets in synthesis', () => {
    const instagram = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      preset: 'instagram',
    });
    expect(instagram.join(' ')).toContain('scale=1080:1920');

    const highQuality = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      preset: 'high',
    });
    expect(highQuality.join(' ')).toContain('-crf 18');
    expect(highQuality.join(' ')).toContain('-b:a 256k');

    const whatsapp = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      preset: 'whatsapp',
    });
    expect(whatsapp.join(' ')).toContain('-crf 28');
    expect(whatsapp.join(' ')).toContain('scale=854:480');

    const discord = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      preset: 'discord',
    });
    expect(discord.join(' ')).toContain('-crf 26');
    expect(discord.join(' ')).toContain('scale=1280:720');

    const email = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      preset: 'email',
    });
    expect(email.join(' ')).toContain('-crf 32');
    expect(email.join(' ')).toContain('scale=640:360');
  });

  test('loops audio in fit-video mode when audio is shorter than video', () => {
    const loopedAudio = buildAudioVideoSynthesisArgs({
      ...baseOpts,
      audioDuration: 5.0,
      videoDuration: 30.0,
      videoStartTime: 0,
      videoEndTime: 30.0,
      audioSyncMode: 'fit-video',
    });
    expect(loopedAudio.join(' ')).toMatch(/-stream_loop -1.*-i \/tmp\/job\/audio\.mp3/);
    expect(loopedAudio.targetDuration).toBe(30.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. buildVisualizerSynthesisArgs — Audio + Procedural Visualizer Synthesis
// ─────────────────────────────────────────────────────────────────────────────
describe('3. buildVisualizerSynthesisArgs — Audio + Procedural Visualizer Synthesis', () => {
  const baseVizOpts = {
    audioPath: '/tmp/job/song.mp3',
    outputPath: '/tmp/job/output.mp4',
    outputFormat: 'mp4',
    audioDuration: 90.5,
    visualizerStyle: 'waveform' as const,
    visualizerColor: '#FF5A00',
    visualizerBg: '#0a0a0c',
    resolution: '1080p',
  };

  test('builds waveform visualizer filter graph with obsidian backdrop', () => {
    const args = buildVisualizerSynthesisArgs(baseVizOpts);
    const cmd = args.join(' ');

    expect(cmd).toContain('-filter_complex');
    expect(cmd).toContain('showwaves');
    expect(cmd).toContain('0xFF5A00');
    expect(cmd).toContain('color=c=0x0a0a0c');
    expect(cmd).toContain('d=90.5');
    expect(cmd).toContain('overlay');
    expect(cmd).toContain('-map [v]');
    expect(cmd).toContain('-map 0:a:0');
    expect(cmd).toContain('-c:v libx264');
    expect(cmd).toContain('-c:a aac');
    expect(cmd).toContain('-movflags faststart');
  });

  test('builds frequency spectrum visualizer with logarithmic bars', () => {
    const args = buildVisualizerSynthesisArgs({
      ...baseVizOpts,
      visualizerStyle: 'frequency',
    });
    const cmd = args.join(' ');

    expect(cmd).toContain('showfreqs');
    expect(cmd).toMatch(/ascale=log|fscale=log|mode=bar/);
    expect(cmd).toContain('-map [v]');
    expect(cmd).toContain('-map 0:a:0');
  });

  test('builds circular vectorscope visualizer', () => {
    const args = buildVisualizerSynthesisArgs({
      ...baseVizOpts,
      visualizerStyle: 'circular',
    });
    const cmd = args.join(' ');

    expect(cmd).toMatch(/avectorscope|showwaves/);
    expect(cmd).toContain('-map [v]');
  });

  test('builds minimal visualizer with grid overlay', () => {
    const args = buildVisualizerSynthesisArgs({
      ...baseVizOpts,
      visualizerStyle: 'minimal',
    });
    const cmd = args.join(' ');

    expect(cmd).toMatch(/drawgrid|showwaves/);
    expect(cmd).toContain('-map [v]');
  });

  test('formats custom hex colors for foreground and background', () => {
    const args = buildVisualizerSynthesisArgs({
      ...baseVizOpts,
      visualizerColor: '#00FFCC',
      visualizerBg: '#1A1A24',
    });
    const cmd = args.join(' ');

    expect(cmd).toMatch(/0x00FFCC|0x00ffcc/);
    expect(cmd).toMatch(/0x1A1A24|0x1a1a24/);
  });

  test('generates WebM visualizer with VP9 and Opus', () => {
    const args = buildVisualizerSynthesisArgs({
      ...baseVizOpts,
      outputFormat: 'webm',
      outputPath: '/tmp/job/output.webm',
    });
    const cmd = args.join(' ');

    expect(cmd).toContain('-c:v libvpx-vp9');
    expect(cmd).toContain('-c:a libopus');
    expect(cmd).toContain('-b:v 0');
    expect(cmd).toContain('-crf 30');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /api/convert — Route Handling & SSE Pipeline
// ─────────────────────────────────────────────────────────────────────────────
describe('4. POST /api/convert — Route Handling & SSE Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mockAudioPayload'));
  });

  test('processes Audio + Attached Video synthesis and streams SSE events', async () => {
    const formData = new FormData();
    formData.append('outputFormat', 'mp4');
    formData.append('audioSyncMode', 'fit-audio');
    formData.append('videoStartTime', '1.5');
    formData.append('videoEndTime', '10.0');
    formData.append('file', new File(['mockAudio'], 'song.mp3', { type: 'audio/mpeg' }));
    formData.append('videoFile', new File(['mockVideo'], 'clip.mp4', { type: 'video/mp4' }));

    const req = {
      formData: async () => formData,
      headers: new Headers({ authorization: 'Bearer user_test_token' }),
    } as any as NextRequest;

    vi.mocked(tempExt.writeInputFile)
      .mockResolvedValueOnce('/mock/tmp/job-a2v-123/song.mp3')
      .mockResolvedValueOnce('/mock/tmp/job-a2v-123/clip.mp4');

    vi.mocked(ffmpegExt.probeMediaStreams).mockImplementation(async (filePath: string) => {
      if (filePath.includes('song.mp3')) {
        return { hasVideo: false, hasAudio: true, audioCodec: 'mp3', duration: 45.0 };
      }
      return { hasVideo: true, hasAudio: true, videoCodec: 'h264', audioCodec: 'aac', duration: 15.0 };
    });

    const mockStream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"progress":50}\n\n'));
        c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
        c.enqueue(new TextEncoder().encode('data: {"status":"done"}\n\n'));
        c.close();
      },
    });

    vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    const sseOutput = await readSseStream(res);
    expect(sseOutput).toContain('"strategy":"AUDIO+VIDEO-SYNTHESIS"');
    expect(sseOutput).toContain('"progress":50');
    expect(sseOutput).toContain('"progress":100');
    expect(sseOutput).toContain('"status":"complete"');
    expect(sseOutput).toMatch(/"downloadUrl":"\/api\/download\?jobId=[a-zA-Z0-9\-]+&file=output\.mp4"/);

    expect(authExt.registerJobOwner).toHaveBeenCalled();
  });

  test('processes Audio + Visualizer synthesis when audio is converted to video without attached video', async () => {
    const formData = new FormData();
    formData.append('outputFormat', 'mp4');
    formData.append('visualizerStyle', 'frequency');
    formData.append('visualizerColor', '#FF5A00');
    formData.append('file', new File(['mockAudio'], 'podcast.wav', { type: 'audio/wav' }));

    const req = {
      formData: async () => formData,
      headers: new Headers({ authorization: 'Bearer user_test_token' }),
    } as any as NextRequest;

    vi.mocked(tempExt.writeInputFile).mockResolvedValueOnce('/mock/tmp/job-a2v-123/podcast.wav');

    vi.mocked(ffmpegExt.probeMediaStreams).mockResolvedValue({
      hasVideo: false,
      hasAudio: true,
      audioCodec: 'pcm_s16le',
      duration: 30.0,
    });

    const mockStream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"progress":50}\n\n'));
        c.enqueue(new TextEncoder().encode('data: {"status":"done"}\n\n'));
        c.close();
      },
    });

    vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

    const res = await POST(req);
    expect(res.status).toBe(200);

    const sseOutput = await readSseStream(res);
    expect(sseOutput).toContain('"strategy":"AUDIO-VISUALIZER-SYNTHESIS"');
    expect(sseOutput).toContain('"status":"complete"');
  });

  test('rejects unauthenticated request with 401', async () => {
    vi.mocked(authExt.verifyAuth).mockReturnValueOnce(null);

    const req = {
      formData: async () => new FormData(),
      headers: new Headers(),
    } as any as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  test('handles FFmpeg failure gracefully by streaming sanitized SSE error and cleaning temp directory', async () => {
    const formData = new FormData();
    formData.append('outputFormat', 'mp4');
    formData.append('file', new File(['mockAudio'], 'song.mp3', { type: 'audio/mpeg' }));

    const req = {
      formData: async () => formData,
      headers: new Headers({ authorization: 'Bearer user_test_token' }),
    } as any as NextRequest;

    vi.mocked(tempExt.writeInputFile).mockResolvedValueOnce('/mock/tmp/job-a2v-123/song.mp3');
    vi.mocked(ffmpegExt.probeMediaStreams).mockResolvedValue({
      hasVideo: false,
      hasAudio: true,
      audioCodec: 'mp3',
      duration: 10.0,
    });

    const errorStream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"error":"FFmpeg process crashed /internal/path/error"}\n\n'));
        c.close();
      },
    });

    vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(errorStream);

    const res = await POST(req);
    expect(res.status).toBe(200);

    const sseOutput = await readSseStream(res);
    expect(sseOutput).toContain('error');
    // Ensure no internal paths leaked
    expect(sseOutput).not.toContain('/internal/path/error');
    expect(tempExt.cleanupJobDir).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Boundary Conditions, Edge Cases & Zero-Drift Verification
// ─────────────────────────────────────────────────────────────────────────────
describe('5. Boundary Conditions, Edge Cases & Zero-Drift Verification', () => {
  test('handles videoStartTime > videoEndTime by clamping or safe fallback', () => {
    const args = buildAudioVideoSynthesisArgs({
      audioPath: '/tmp/audio.mp3',
      videoPath: '/tmp/video.mp4',
      outputPath: '/tmp/out.mp4',
      outputFormat: 'mp4',
      audioDuration: 30.0,
      videoDuration: 20.0,
      videoStartTime: 15.0,
      videoEndTime: 5.0, // Inverted!
    });
    expect(Array.isArray(args)).toBe(true);
    expect(args.length).toBeGreaterThan(0);
  });

  test('handles videoEndTime exceeding total video duration by clamping to videoDuration', () => {
    const args = buildAudioVideoSynthesisArgs({
      audioPath: '/tmp/audio.mp3',
      videoPath: '/tmp/video.mp4',
      outputPath: '/tmp/out.mp4',
      outputFormat: 'mp4',
      audioDuration: 30.0,
      videoDuration: 10.0,
      videoStartTime: 0,
      videoEndTime: 100.0, // Exceeds video duration
    });
    const cmd = args.join(' ');
    expect(cmd).not.toContain('-to 100');
  });

  test('handles zero audio duration fallback safely without NaN or infinite loop', () => {
    const args = buildVisualizerSynthesisArgs({
      audioPath: '/tmp/audio.mp3',
      outputPath: '/tmp/out.mp4',
      outputFormat: 'mp4',
      audioDuration: 0, // Probe failed or duration is 0
      visualizerStyle: 'waveform',
    });
    const cmd = args.join(' ');
    expect(cmd).not.toContain('d=NaN');
    expect(cmd).not.toContain('d=0');
  });

  test('handles special characters in filenames safely', () => {
    const args = buildAudioVideoSynthesisArgs({
      audioPath: '/tmp/My Song #1 (2026) [Remix] & "Track".mp3',
      videoPath: '/tmp/Background Clip #2 (4K).mp4',
      outputPath: '/tmp/Final Video #1.mp4',
      outputFormat: 'mp4',
      audioDuration: 40.0,
      videoDuration: 20.0,
    });
    expect(args).toContain('/tmp/My Song #1 (2026) [Remix] & "Track".mp3');
    expect(args).toContain('/tmp/Background Clip #2 (4K).mp4');
  });
});
