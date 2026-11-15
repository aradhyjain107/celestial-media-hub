import cp, { type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';

export interface MediaStreamInfo {
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  duration: number;
  formatName?: string;
}

export interface AudioVideoSynthesisOptions {
  audioPath: string;
  videoPath: string;
  outputPath?: string;
  outputFormat?: string;
  videoStartTime?: number;
  videoEndTime?: number;
  audioDuration?: number;
  videoDuration?: number;
  audioSyncMode?: 'fit-audio' | 'fit-video' | 'loop-video' | 'trim-audio';
  videoLoop?: boolean;
  resolution?: 'original' | '1080p' | '720p' | '480p' | '360p' | string;
  preset?: string;
  speed?: number;
}

export interface VisualizerSynthesisOptions {
  audioPath: string;
  outputPath?: string;
  outputFormat?: string;
  audioDuration?: number;
  visualizerStyle?: 'none' | 'waveform' | 'frequency' | 'circular' | 'minimal' | 'obsidian_pulse' | 'cyber_bars' | 'nebula_spectrum' | 'minimal_wave';
  visualizerColor?: string;
  visualizerBg?: string;
  resolution?: 'original' | '1080p' | '720p' | '480p' | '360p' | string;
  preset?: string;
  speed?: number;
}

export interface SynthesisResult extends Array<string> {
  args: string[];
  targetDuration: number;
  strategy: string;
  reason: string;
}

export function hexToFfmpegColor(hex?: string, defaultHex: string = '0xFF5A00'): string {
  if (!hex || typeof hex !== 'string') return defaultHex;
  const cleaned = hex.trim();
  if (/^0x[0-9a-fA-F]{6}$/i.test(cleaned)) return cleaned;
  if (/^#[0-9a-fA-F]{6}$/i.test(cleaned)) return `0x${cleaned.slice(1)}`;
  if (/^[0-9a-fA-F]{6}$/i.test(cleaned)) return `0x${cleaned}`;
  return defaultHex;
}

export function buildAtempoFilter(speed: number): string {
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining}`);
  return filters.join(',');
}

export function buildAudioVideoSynthesisArgs(opts: AudioVideoSynthesisOptions): SynthesisResult {
  const {
    audioPath,
    videoPath,
    outputPath,
    outputFormat = 'mp4',
    videoStartTime,
    videoEndTime,
    audioDuration = 0,
    videoDuration = 0,
    audioSyncMode = 'fit-audio',
    resolution = 'original',
    speed = 1.0,
    preset = 'auto',
    videoLoop,
  } = opts;

  const rawVideoDur = videoDuration && videoDuration > 0 ? videoDuration : 0;
  let vStart = typeof videoStartTime === 'number' && isFinite(videoStartTime) ? Math.max(0, videoStartTime) : 0;
  let vEnd = typeof videoEndTime === 'number' && isFinite(videoEndTime) ? videoEndTime : undefined;

  // Boundary condition handling: inverted timestamps
  if (vEnd !== undefined && vEnd <= vStart) {
    vEnd = vStart + 0.1;
  }
  // Boundary condition handling: videoEndTime exceeds raw video duration
  if (rawVideoDur > 0 && vEnd !== undefined && vEnd > rawVideoDur) {
    vEnd = rawVideoDur;
  }
  if (rawVideoDur > 0 && vStart >= rawVideoDur) {
    vStart = Math.max(0, rawVideoDur - 0.1);
  }

  const clipDuration = vEnd !== undefined
    ? Math.max(0.1, vEnd - vStart)
    : (rawVideoDur > 0 ? Math.max(0.1, rawVideoDur - vStart) : (audioDuration > 0 ? audioDuration : 10));

  const shouldLoopVideo = videoLoop === true ||
    audioSyncMode === 'loop-video' ||
    (audioSyncMode === 'fit-audio' && clipDuration < audioDuration);

  let targetDuration: number;
  if (audioSyncMode === 'fit-video' || audioSyncMode === 'trim-audio') {
    targetDuration = clipDuration;
  } else {
    targetDuration = audioDuration > 0 ? audioDuration : clipDuration;
  }

  if (speed > 0 && speed !== 1.0) {
    targetDuration = targetDuration / speed;
  }

  const args: string[] = ['-threads', '0'];

  // Input 0: Primary Audio
  if ((audioSyncMode === 'fit-video' || audioSyncMode === 'trim-audio') && audioDuration > 0 && audioDuration < clipDuration) {
    args.push('-stream_loop', '-1');
  }
  args.push('-i', audioPath);

  // Input 1: Attached Video
  if (vStart > 0) {
    args.push('-ss', vStart.toString());
  }
  if (vEnd !== undefined && (rawVideoDur === 0 || vEnd < rawVideoDur || vStart > 0)) {
    args.push('-to', vEnd.toString());
  }
  if (shouldLoopVideo) {
    args.push('-stream_loop', '-1');
  }
  args.push('-i', videoPath);

  const fmt = (outputFormat || (outputPath ? path.extname(outputPath).replace('.', '') : 'mp4')).toLowerCase();

  // Stream Isolation Mapping
  if (fmt !== 'gif') {
    args.push('-map', '1:v:0', '-map', '0:a:0');
  } else {
    args.push('-map', '1:v:0');
  }

  // Zero-Drift Video Filters
  const vfFilters: string[] = ['setpts=PTS-STARTPTS', 'fps=30'];

  if (speed > 0 && speed !== 1.0) {
    vfFilters.push(`setpts=(1/${speed})*PTS`);
  }

  if (resolution === '1080p' || preset === 'instagram' || preset === 'tiktok') {
    if (preset === 'instagram' || preset === 'tiktok') {
      vfFilters.push('scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1');
    } else {
      vfFilters.push('scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1');
    }
  } else if (resolution === '720p' || preset === 'discord') {
    vfFilters.push('scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1');
  } else if (resolution === '480p' || preset === 'whatsapp') {
    vfFilters.push('scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2,setsar=1');
  } else if (resolution === '360p' || preset === 'email') {
    vfFilters.push('scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1');
  }

  if (fmt === 'gif') {
    const gifSpeedPrefix = speed > 0 && speed !== 1.0 ? `setpts=PTS-STARTPTS,setpts=(1/${speed})*PTS,` : '';
    const gifFilter = `${gifSpeedPrefix}fps=15,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
    args.push('-vf', gifFilter, '-loop', '0');
  } else {
    args.push('-vf', vfFilters.join(','));

    // Zero-Drift Audio Filters
    const afFilters: string[] = ['asetpts=PTS-STARTPTS'];
    if (speed > 0 && speed !== 1.0) {
      afFilters.push(buildAtempoFilter(speed));
    }
    afFilters.push('aresample=async=1000');
    args.push('-af', afFilters.join(','));
  }

  // Codecs & Flags
  if (fmt === 'mp4' || fmt === 'mov' || fmt === 'mkv') {
    if (preset === 'high') {
      args.push('-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-pix_fmt', 'yuv420p');
      args.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000');
    } else if (preset === 'whatsapp') {
      args.push('-c:v', 'libx264', '-crf', '28', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
      args.push('-c:a', 'aac', '-b:a', '96k', '-ar', '48000');
    } else if (preset === 'discord') {
      args.push('-c:v', 'libx264', '-crf', '26', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
      args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '48000');
    } else if (preset === 'email') {
      args.push('-c:v', 'libx264', '-crf', '32', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
      args.push('-c:a', 'aac', '-b:a', '64k', '-ar', '48000');
    } else {
      args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p');
      args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
    }

    if (fmt === 'mp4' || fmt === 'mov') {
      args.push('-movflags', 'faststart');
    }
  } else if (fmt === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30');
    args.push('-c:a', 'libopus', '-b:a', '128k', '-ar', '48000');
  } else if (fmt === 'gif') {
    args.push('-an');
  }

  // Duration cutoff
  if (audioSyncMode === 'trim-audio' || audioSyncMode === 'fit-video') {
    args.push('-t', targetDuration.toString());
  } else {
    args.push('-shortest');
  }

  if (outputPath) {
    args.push('-y', outputPath);
  }

  const result: any = [...args];
  result.args = args;
  result.targetDuration = targetDuration;
  result.strategy = 'AUDIO+VIDEO-SYNTHESIS';
  result.reason = `Synthesized primary audio with companion video clip (${audioSyncMode}, ${shouldLoopVideo ? 'looped' : 'trimmed'})`;
  return result as SynthesisResult;
}

export function buildVisualizerSynthesisArgs(opts: VisualizerSynthesisOptions): SynthesisResult {
  const {
    audioPath,
    outputPath,
    outputFormat = 'mp4',
    audioDuration = 0,
    visualizerStyle = 'waveform',
    visualizerColor = '#FF5A00',
    visualizerBg = '#0a0a0c',
    resolution = '1080p',
    speed = 1.0,
    preset = 'auto',
  } = opts;

  let width = 1920;
  let height = 1080;
  if (resolution === '720p' || preset === 'discord') {
    width = 1280;
    height = 720;
  } else if (resolution === '480p' || preset === 'whatsapp') {
    width = 854;
    height = 480;
  } else if (resolution === '360p' || preset === 'email') {
    width = 640;
    height = 360;
  } else if (preset === 'instagram' || preset === 'tiktok') {
    width = 1080;
    height = 1920;
  }

  const duration = audioDuration > 0 ? audioDuration : 10;
  let targetDuration = duration;
  if (speed > 0 && speed !== 1.0) {
    targetDuration = targetDuration / speed;
  }

  const fgColor = hexToFfmpegColor(visualizerColor, '0xFF5A00');
  const bgColor = hexToFfmpegColor(visualizerBg, '0x0a0a0c');

  const videoSpeedFilter = speed > 0 && speed !== 1.0 ? `,setpts=(1/${speed})*PTS` : '';

  let filterComplex = '';
  if (visualizerStyle === 'frequency' || visualizerStyle === 'cyber_bars') {
    filterComplex = `[0:a]showfreqs=s=${width}x${height}:mode=bar:ascale=log:fscale=log:colors=${fgColor}|0xFFA500:rate=30,format=yuv420p${videoSpeedFilter}[freqs];color=c=${bgColor}:s=${width}x${height}:r=30:d=${targetDuration}[bg];[bg][freqs]overlay=(W-w)/2:(H-h)/2:shortest=1[v]`;
  } else if (visualizerStyle === 'circular' || visualizerStyle === 'nebula_spectrum') {
    const hexClean = fgColor.replace(/^0x/i, '');
    const r = parseInt(hexClean.slice(0, 2) || 'FF', 16);
    const g = parseInt(hexClean.slice(2, 4) || '5A', 16);
    const b = parseInt(hexClean.slice(4, 6) || '00', 16);
    filterComplex = `[0:a]aformat=channel_layouts=stereo,avectorscope=s=${width}x${height}:m=lissajous:draw=line:rc=${r}:gc=${g}:bc=${b}:rf=25:gf=25:bf=25:rate=30,format=yuv420p${videoSpeedFilter}[scope];color=c=${bgColor}:s=${width}x${height}:r=30:d=${targetDuration}[bg];[bg][scope]overlay=(W-w)/2:(H-h)/2:shortest=1[v]`;
  } else if (visualizerStyle === 'minimal' || visualizerStyle === 'minimal_wave') {
    const halfHeight = Math.round(height * 0.5);
    filterComplex = `color=c=${bgColor}:s=${width}x${height}:r=30:d=${targetDuration},drawgrid=w=64:h=64:t=1:c=0x222228@0.3[bggrid];[0:a]showwaves=s=${width}x${halfHeight}:mode=p2p:colors=${fgColor}@0.85:rate=30,format=yuv420p${videoSpeedFilter}[waves];[bggrid][waves]overlay=0:(H-h)/2:shortest=1[v]`;
  } else if (visualizerStyle === 'none') {
    filterComplex = `color=c=${bgColor}:s=${width}x${height}:r=30:d=${targetDuration},format=yuv420p[v]`;
  } else {
    // Default waveform (including obsidian_pulse)
    filterComplex = `[0:a]showwaves=s=${width}x${height}:mode=line:colors=${fgColor}@0.9:scale=cbrt:rate=30,format=yuv420p${videoSpeedFilter}[waves];color=c=${bgColor}:s=${width}x${height}:r=30:d=${targetDuration}[bg];[bg][waves]overlay=(W-w)/2:(H-h)/2:shortest=1[v]`;
  }

  const args: string[] = [
    '-threads', '0',
    '-i', audioPath,
  ];

  const fmt = (outputFormat || (outputPath ? path.extname(outputPath).replace('.', '') : 'mp4')).toLowerCase();

  if (fmt === 'gif') {
    filterComplex += ';[v]split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse[gifv]';
    args.push('-filter_complex', filterComplex, '-map', '[gifv]', '-loop', '0', '-an', '-shortest');
  } else {
    args.push('-filter_complex', filterComplex, '-map', '[v]', '-map', '0:a:0');

    if (speed > 0 && speed !== 1.0) {
      args.push('-af', buildAtempoFilter(speed));
    }

    if (fmt === 'mp4' || fmt === 'mov' || fmt === 'mkv') {
      args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p');
      args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
      if (fmt === 'mp4' || fmt === 'mov') {
        args.push('-movflags', 'faststart');
      }
    } else if (fmt === 'webm') {
      args.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30');
      args.push('-c:a', 'libopus', '-b:a', '128k', '-ar', '48000');
    }
    args.push('-shortest');
  }

  if (outputPath) {
    args.push('-y', outputPath);
  }

  const result: any = [...args];
  result.args = args;
  result.targetDuration = targetDuration;
  result.strategy = 'AUDIO-VISUALIZER-SYNTHESIS';
  result.reason = `Procedural ${visualizerStyle} visualizer synthesized on Celestial Obsidian backdrop`;
  return result as SynthesisResult;
}

export function getFfprobePath(): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  if (env.FFPROBE_PATH && env.FFPROBE_PATH !== 'ffprobe') return env.FFPROBE_PATH;
  if (!env.FFMPEG_PATH || env.FFMPEG_PATH === 'ffmpeg') return 'ffprobe';
  const dir = path.dirname(env.FFMPEG_PATH);
  const ext = path.extname(env.FFMPEG_PATH);
  return path.join(dir, `ffprobe${ext}`);
}

export async function probeMediaStreams(inputPath: string): Promise<MediaStreamInfo> {
  return new Promise((resolve) => {
    const ffprobePath = getFfprobePath();
    const ffprobe = cp.spawn(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ]);

    let output = '';
    ffprobe.stdout.on('data', chunk => output += chunk.toString());

    ffprobe.on('close', code => {
      if (code !== 0) {
        return resolve({ hasVideo: false, hasAudio: false, duration: 0 });
      }
      try {
        const data = JSON.parse(output);
        const streams = data.streams || [];
        const format = data.format || {};

        const videoStream = streams.find((s: any) => s.codec_type === 'video');
        const audioStream = streams.find((s: any) => s.codec_type === 'audio');

        let duration = parseFloat(format.duration);
        if (!isFinite(duration) || duration <= 0) {
          const streamWithDur = streams.find((s: any) => isFinite(parseFloat(s.duration)) && parseFloat(s.duration) > 0);
          duration = streamWithDur ? parseFloat(streamWithDur.duration) : 0;
        }

        resolve({
          hasVideo: !!videoStream,
          hasAudio: !!audioStream,
          videoCodec: videoStream?.codec_name,
          audioCodec: audioStream?.codec_name,
          duration: isFinite(duration) && duration > 0 ? duration : 0,
          formatName: format.format_name,
        });
      } catch {
        resolve({ hasVideo: false, hasAudio: false, duration: 0 });
      }
    });

    ffprobe.on('error', () => {
      resolve({ hasVideo: false, hasAudio: false, duration: 0 });
    });
  });
}

export async function isEncoderAvailable(encoderName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpeg = cp.spawn(env.FFMPEG_PATH, ['-encoders']);
    let output = '';
    ffmpeg.stdout.on('data', chunk => output += chunk.toString());
    ffmpeg.stderr.on('data', chunk => output += chunk.toString());

    ffmpeg.on('close', code => {
      if (code !== 0) return resolve(false);
      const tokens = output.split(/\W+/);
      resolve(tokens.includes(encoderName));
    });

    ffmpeg.on('error', () => resolve(false));
  });
}

export async function getMediaDuration(inputPath: string): Promise<number> {
  const info = await probeMediaStreams(inputPath);
  return info.duration;
}

import os from 'node:os';

export function getOptimalFfmpegThreads(): string {
  const cpus = os.cpus();
  const totalCores = cpus && cpus.length ? cpus.length : 4;
  // Reserve at least 2 cores for macOS WindowServer / desktop responsiveness, cap CPU worker threads to 4
  const safeThreads = Math.max(1, Math.min(totalCores - 2, 4));
  return String(safeThreads);
}

export function executeFfmpeg(inputPath: string, args: string[], customDuration?: number): ReadableStream {
  let ffmpegProc: ChildProcess | null = null;
  let hasExited = false;
  let isCancelled = false;
  let killTimer: NodeJS.Timeout | null = null;
  let exitPromiseResolve: (() => void) | null = null;
  const exitPromise = new Promise<void>((resolve) => {
    exitPromiseResolve = resolve;
  });

  const markExited = () => {
    if (!hasExited) {
      hasExited = true;
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      if (exitPromiseResolve) {
        exitPromiseResolve();
      }
    }
  };

  let terminatePromise: Promise<void> | null = null;
  const terminateProcess = (): Promise<void> => {
    if (hasExited) return Promise.resolve();
    if (!ffmpegProc) {
      return Promise.resolve();
    }
    if (!terminatePromise) {
      terminatePromise = (async () => {
        if (hasExited) return;
        if (ffmpegProc && typeof ffmpegProc.kill === 'function') {
          try {
            ffmpegProc.kill('SIGTERM');
          } catch {}

          killTimer = setTimeout(() => {
            if (!hasExited && ffmpegProc && typeof ffmpegProc.kill === 'function') {
              try {
                ffmpegProc.kill('SIGKILL');
              } catch {}
            }
          }, 500);

          if (killTimer && typeof killTimer.unref === 'function') {
            killTimer.unref();
          }
        } else {
          markExited();
        }

        await exitPromise;
      })();
    }
    return terminatePromise;
  };

  return new ReadableStream({
    async start(controller) {
      try {
        const duration = customDuration !== undefined ? customDuration : await getMediaDuration(inputPath);
        if (isCancelled) {
          markExited();
          return;
        }

        const hasThreads = args.includes('-threads');
        const ffmpegArgs = hasThreads 
          ? [...args, '-progress', 'pipe:1']
          : ['-threads', getOptimalFfmpegThreads(), ...args, '-progress', 'pipe:1'];

        if (isCancelled) {
          markExited();
          return;
        }

        const ffmpeg = cp.spawn(env.FFMPEG_PATH, ffmpegArgs);
        ffmpegProc = ffmpeg;

        ffmpeg.on('error', (err) => {
          markExited();
          if (isCancelled) return;
        });
        ffmpeg.stdin?.on('error', () => {});
        ffmpeg.stdout?.on('error', () => {});
        ffmpeg.stderr?.on('error', () => {});

        if (isCancelled) {
          await terminateProcess();
          return;
        }

        // Lower CPU scheduling priority on macOS/Unix to prevent WindowServer UI starvation
        if (ffmpeg.pid) {
          try {
            os.setPriority(ffmpeg.pid, os.constants.priority.PRIORITY_LOW);
          } catch {}
        }
        
        let stderrLog = '';
        
        ffmpeg.stdout?.on('data', (chunk) => {
          if (isCancelled) return;
          const match = chunk.toString().match(/out_time_ms=(\d+)/);
          if (match && isFinite(duration) && duration > 0) {
            const timeMs = parseInt(match[1], 10);
            const progress = Math.min(100, Math.max(0, (timeMs / 1000000 / duration) * 100));
            try {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ progress: Math.round(progress) })}\n\n`));
            } catch {}
          }
        });

        ffmpeg.stderr?.on('data', chunk => {
          stderrLog += chunk.toString();
        });

        ffmpeg.stdout?.on('error', () => {});
        ffmpeg.stderr?.on('error', () => {});

        ffmpeg.on('exit', () => {
          markExited();
        });

        await new Promise((resolve, reject) => {
          ffmpeg.on('close', code => {
            markExited();
            if (isCancelled) {
              resolve(null);
              return;
            }
            if (code !== 0) {
              console.error('executeFfmpeg failed code:', code, 'stderr:', stderrLog);
              reject(new Error(`FFmpeg error: ${stderrLog.substring(0, 200)}`));
            } else {
              resolve(null);
            }
          });
          ffmpeg.on('error', err => {
            markExited();
            if (isCancelled) {
              resolve(null);
              return;
            }
            reject(err);
          });
        });

        if (!isCancelled) {
          try {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ status: 'done' })}\n\n`));
          } catch {}
        }
      } catch (err: any) {
        if (!isCancelled) {
          try {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
          } catch {}
        }
      } finally {
        markExited();
        try {
          controller.close();
        } catch {}
      }
    },
    async cancel(reason) {
      isCancelled = true;
      await terminateProcess();
    }
  });
}

