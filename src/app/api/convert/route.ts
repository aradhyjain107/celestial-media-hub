import { NextRequest, NextResponse } from 'next/server';
import { ConvertInputSchema } from '../../../schemas/convert';
import {
  executeFfmpeg,
  probeMediaStreams,
  buildAudioVideoSynthesisArgs,
  buildVisualizerSynthesisArgs,
  buildAtempoFilter,
  getOptimalFfmpegThreads,
} from '../../../lib/media/ffmpeg';
import { writeInputFile, createJobDir, cleanupJobDir } from '../../../lib/system/temp';
import { decideStrategy, buildStrategyArgs } from '../../../lib/media/remuxDecision';
import { randomUUID } from 'crypto';
import path from 'node:path';
import fs from 'node:fs';
import { verifyAuth, registerJobOwner } from '../../../lib/security/auth';
import { sanitizeError, sanitizeSseError } from '../../../lib/security/errors';
import { isPdfFile, convertPdfToImage } from '../../../lib/media/pdfRasterizer';
import { createZipArchive } from '../../../lib/utils/archive';

export const dynamic = 'force-dynamic';

const AUDIO_ONLY_FORMATS = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus'];
const VIDEO_FORMATS = ['mp4', 'mkv', 'mov', 'webm', 'gif'];
const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'avif'];

async function buildConvertArgs(inputPath: string, opts: any, preset: string): Promise<{ args: string[]; strategy: string; reason: string }> {
  const args: string[] = ['-i', inputPath, '-threads', getOptimalFfmpegThreads()];

  const isAudioTarget = AUDIO_ONLY_FORMATS.includes(opts.outputFormat);
  const isVideoContainerSupportingH264 = !isAudioTarget && !opts.isImage && !opts.isGif && opts.outputFormat !== 'webm';

  if (isVideoContainerSupportingH264) {
    const isVTB = process.platform === 'darwin' && !process.env.VITEST;
    const vEncoder = isVTB ? 'h264_videotoolbox' : 'libx264';
    const vEncodeFlags = isVTB
      ? ['-c:v', 'h264_videotoolbox', '-b:v']
      : ['-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p'];

    const applyPresetModifiers = (targetArgs: string[]) => {
      if (opts.stripAudio && !targetArgs.includes('-an')) {
        const caIdx = targetArgs.indexOf('-c:a');
        if (caIdx !== -1) targetArgs.splice(caIdx, 2);
        const baIdx = targetArgs.indexOf('-b:a');
        if (baIdx !== -1) targetArgs.splice(baIdx, 2);
        targetArgs.push('-an');
      }
      if (opts.stripMetadata && !targetArgs.includes('-map_metadata')) {
        targetArgs.push('-map_metadata', '-1');
      }
      return targetArgs;
    };

    if (preset === 'twitter') {
      if (isVTB) {
        args.push('-c:v', 'h264_videotoolbox', '-b:v', '4M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', 'faststart');
      } else {
        args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'high', '-level', '4.2',
                  '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', 'faststart');
      }
      return { args: applyPresetModifiers(args), strategy: 'ENCODE', reason: 'Twitter preset — H.264/AAC hardware accelerated' };
    } else if (preset === 'instagram' || preset === 'tiktok') {
      if (isVTB) {
        args.push('-c:v', 'h264_videotoolbox', '-b:v', '4M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
                  '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2');
      } else {
        args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'high', '-level', '4.2',
                  '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
                  '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2');
      }
      return { args: applyPresetModifiers(args), strategy: 'ENCODE', reason: `${preset} preset — vertical crop` };
    } else if (preset === 'whatsapp') {
      if (isVTB) {
        args.push('-c:v', 'h264_videotoolbox', '-b:v', '1.2M', '-pix_fmt', 'yuv420p', '-vf', 'scale=-2:480',
                  '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart');
      } else {
        args.push('-c:v', 'libx264', '-crf', '28', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-vf', 'scale=-2:480',
                  '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart');
      }
      return { args: applyPresetModifiers(args), strategy: 'ENCODE', reason: 'WhatsApp preset — compressed 480p' };
    } else if (preset === 'discord') {
      if (isVTB) {
        args.push('-c:v', 'h264_videotoolbox', '-b:v', '2M', '-pix_fmt', 'yuv420p', '-vf', 'scale=-2:720',
                  '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart');
      } else {
        args.push('-c:v', 'libx264', '-crf', '26', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-vf', 'scale=-2:720',
                  '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart');
      }
      return { args: applyPresetModifiers(args), strategy: 'ENCODE', reason: 'Discord preset — 720p' };
    } else if (preset === 'email') {
      if (isVTB) {
        args.push('-c:v', 'h264_videotoolbox', '-b:v', '800k', '-pix_fmt', 'yuv420p', '-vf', 'scale=-2:360',
                  '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart');
      } else {
        args.push('-c:v', 'libx264', '-crf', '32', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-vf', 'scale=-2:360',
                  '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart');
      }
      return { args: applyPresetModifiers(args), strategy: 'ENCODE', reason: 'Email preset — low bitrate 360p' };
    } else if (preset === 'high') {
      if (isVTB) {
        args.push('-c:v', 'h264_videotoolbox', '-b:v', '8M', '-pix_fmt', 'yuv420p',
                  '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart');
      } else {
        args.push('-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-pix_fmt', 'yuv420p',
                  '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart');
      }
      return { args: applyPresetModifiers(args), strategy: 'ENCODE', reason: 'High quality preset — hardware accelerated' };
    } else if (preset === 'remux') {
      const streamInfo = await probeMediaStreams(inputPath);
      const isQuickTimeContainer = opts.outputFormat === 'mp4' || opts.outputFormat === 'mov' || opts.outputFormat === 'm4a';
      const isAudioIncompatibleWithQuickTime = isQuickTimeContainer && streamInfo.hasAudio && streamInfo.audioCodec && !['aac', 'mp3', 'alac', 'pcm_s16le', 'pcm_s24le'].includes(streamInfo.audioCodec.toLowerCase());
      const isHevc = streamInfo.videoCodec && (streamInfo.videoCodec.toLowerCase().includes('hevc') || streamInfo.videoCodec.toLowerCase().includes('h265'));

      if (isAudioIncompatibleWithQuickTime) {
        // QuickTime Audio Healing: Copy video losslessly, transcode incompatible audio (AC3/DTS/Opus) to high-bitrate AAC
        args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k');
        if (isQuickTimeContainer) {
          args.push('-movflags', '+faststart');
          if (isHevc) {
            args.push('-tag:v', 'hvc1');
          }
        }
        return {
          args,
          strategy: 'COPY-VIDEO',
          reason: `Smart QuickTime healing — lossless video copy, audio healed (${streamInfo.audioCodec?.toUpperCase()} → AAC)`
        };
      }

      args.push('-c', 'copy');
      if (isQuickTimeContainer) {
        args.push('-movflags', '+faststart');
        if (isHevc) {
          args.push('-tag:v', 'hvc1');
        }
      }
      return { args, strategy: 'REMUX', reason: 'Lossless remux — near-instant container rewrap' };
    }
  }

  const streamInfo = await probeMediaStreams(inputPath);
  const parsedInput = path.parse(inputPath);
  const inputExt = parsedInput.ext.replace('.', '').toLowerCase();
  const targetExt = opts.outputFormat.toLowerCase();
  const isQuickTimeContainer = targetExt === 'mp4' || targetExt === 'mov' || targetExt === 'm4a';
  const isHevc = streamInfo.videoCodec && (streamInfo.videoCodec.toLowerCase().includes('hevc') || streamInfo.videoCodec.toLowerCase().includes('h265'));

  // Audio-only input safety if output is also audio or non-video
  if (!streamInfo.hasVideo && streamInfo.hasAudio) {
    if (!AUDIO_ONLY_FORMATS.includes(targetExt)) {
      const targetAudio = targetExt === 'mp4' || targetExt === 'mov' ? 'm4a' : 'mp3';
      args.push('-vn', '-c:a', targetAudio === 'm4a' ? 'aac' : 'libmp3lame');
      return {
        args,
        strategy: 'AUDIO-CONVERT',
        reason: `Audio-only input converted to ${targetAudio.toUpperCase()} stream for ${targetExt.toUpperCase()}`
      };
    }
  }

  // Intelligent Pass-Through: If input extension and target extension match and transformations are default
  if (inputExt === targetExt && opts.speed === 1 && opts.resolution === 'original' && !opts.stripAudio && !opts.stripMetadata) {
    args.push('-c', 'copy');
    if (isQuickTimeContainer) {
      args.push('-movflags', '+faststart');
      if (isHevc) {
        args.push('-tag:v', 'hvc1');
      }
    }
    return {
      args,
      strategy: 'REMUX',
      reason: `Matching ${targetExt.toUpperCase()} format — lossless stream pass-through`
    };
  }

  const decision = decideStrategy({ videoCodec: streamInfo.videoCodec, audioCodec: streamInfo.audioCodec }, opts);
  const strategyArgs = buildStrategyArgs(decision.strategy, opts);
  args.push(...strategyArgs);

  if (isQuickTimeContainer) {
    if (isHevc && !args.includes('-tag:v')) {
      args.push('-tag:v', 'hvc1');
    }
    const hasH264OrHevc = isHevc ||
      args.includes('libx264') ||
      args.includes('libx265') ||
      args.includes('h264_videotoolbox') ||
      args.includes('hevc_videotoolbox');
    if (hasH264OrHevc && !args.includes('-pix_fmt')) {
      args.push('-pix_fmt', 'yuv420p');
    }
  }

  return {
    args,
    strategy: decision.strategy.toUpperCase().replace('-', '+'),
    reason: decision.reason,
  };
}

function getSafeFfmpegColor(hex?: string, defaultHex: string = '0xFF5A00'): string {
  if (!hex || typeof hex !== 'string') return defaultHex;
  const cleaned = hex.trim();
  if (/^0x[0-9a-fA-F]{6}$/i.test(cleaned)) return cleaned;
  if (/^#[0-9a-fA-F]{6}$/i.test(cleaned)) return `0x${cleaned.slice(1)}`;
  if (/^[0-9a-fA-F]{6}$/i.test(cleaned)) return `0x${cleaned}`;
  return defaultHex;
}

function internalBuildAudioVideoSynthesisArgs(opts: any) {
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

  if (vEnd !== undefined && vEnd <= vStart) {
    vEnd = vStart + 0.1;
  }
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

  const args: string[] = ['-threads', getOptimalFfmpegThreads()];

  if ((audioSyncMode === 'fit-video' || audioSyncMode === 'trim-audio') && audioDuration > 0 && audioDuration < clipDuration) {
    args.push('-stream_loop', '-1');
  }
  args.push('-i', audioPath);

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

  if (fmt !== 'gif') {
    args.push('-map', '1:v:0', '-map', '0:a:0');
  } else {
    args.push('-map', '1:v:0');
  }

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
    const afFilters: string[] = ['asetpts=PTS-STARTPTS'];
    if (speed > 0 && speed !== 1.0) {
      afFilters.push(buildAtempoFilter(speed));
    }
    afFilters.push('aresample=async=1000');
    args.push('-af', afFilters.join(','));
  }

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
      args.push('-movflags', '+faststart');
    }
  } else if (fmt === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30');
    args.push('-c:a', 'libopus', '-b:a', '128k', '-ar', '48000');
  } else if (fmt === 'gif') {
    args.push('-an');
  }

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
  return result;
}

function internalBuildVisualizerSynthesisArgs(opts: any) {
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

  const fgColor = getSafeFfmpegColor(visualizerColor, '0xFF5A00');
  const bgColor = getSafeFfmpegColor(visualizerBg, '0x0a0a0c');

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
    filterComplex = `[0:a]showwaves=s=${width}x${height}:mode=line:colors=${fgColor}@0.9:scale=cbrt:rate=30,format=yuv420p${videoSpeedFilter}[waves];color=c=${bgColor}:s=${width}x${height}:r=30:d=${targetDuration}[bg];[bg][waves]overlay=(W-w)/2:(H-h)/2:shortest=1[v]`;
  }

  const args: string[] = ['-threads', getOptimalFfmpegThreads(), '-i', audioPath];
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
        args.push('-movflags', '+faststart');
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
  return result;
}

function resolveAudioVideoSynthesis(opts: any) {
  if (typeof buildAudioVideoSynthesisArgs === 'function') {
    try {
      const res = buildAudioVideoSynthesisArgs(opts);
      if (res && res.args) return res;
    } catch {}
  }
  return internalBuildAudioVideoSynthesisArgs(opts);
}

function resolveVisualizerSynthesis(opts: any) {
  if (typeof buildVisualizerSynthesisArgs === 'function') {
    try {
      const res = buildVisualizerSynthesisArgs(opts);
      if (res && res.args) return res;
    } catch {}
  }
  return internalBuildVisualizerSynthesisArgs(opts);
}

export async function POST(req: NextRequest) {
  const session = verifyAuth(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobId = randomUUID();
  registerJobOwner(jobId, session.userId);
  try {
    const contentType = req.headers.get('content-type') || '';
    const hasStreamHeader = !!req.headers.get('x-file-name') || contentType.includes('application/octet-stream');

    if (hasStreamHeader) {
      const filename = decodeURIComponent(req.headers.get('x-file-name') || 'video.mp4');
      const outputFormat = req.headers.get('x-output-format') || req.nextUrl.searchParams.get('outputFormat') || 'mp4';
      const preset = req.headers.get('x-preset') || req.nextUrl.searchParams.get('preset') || 'auto';
      const speed = req.headers.has('x-speed') ? parseFloat(req.headers.get('x-speed')!) : 1;
      const resolution = req.headers.get('x-resolution') || 'original';
      const stripAudio = req.headers.get('x-strip-audio') === 'true';
      const stripMetadata = req.headers.get('x-strip-metadata') === 'true';
      const gifFps = req.headers.has('x-gif-fps') ? parseInt(req.headers.get('x-gif-fps')!, 10) : 15;
      const gifPalette = req.headers.has('x-gif-palette') ? req.headers.get('x-gif-palette') !== 'false' : true;

      const validation = ConvertInputSchema.safeParse({
        preset,
        outputFormat,
        speed,
        resolution,
        stripAudio,
        stripMetadata,
        gifFps,
        gifPalette,
        file: { filename, size: 1024, mimetype: 'video/mp4' }
      });
      if (!validation.success) return NextResponse.json({ error: validation.error.format() }, { status: 400 });

      const isGif = outputFormat === 'gif';
      const isImage = IMAGE_FORMATS.includes(outputFormat);
      const opts = { outputFormat, speed, resolution, stripAudio, stripMetadata, isGif, isImage, gifFps: validation.data.gifFps, gifPalette: validation.data.gifPalette };
      const masterDir = createJobDir(jobId);

      if (!req.body) {
        cleanupJobDir(jobId);
        return NextResponse.json({ error: 'No file stream provided' }, { status: 400 });
      }
      ((globalThis as any)[Symbol.for('celestial.activeJobDirs')] ??= new Set<string>()).add(jobId);

      let activeReader: ReadableStreamDefaultReader | null = null;
      let activeStream: ReadableStream | null = null;
      let cleanedUp = false;
      const handleAbort = async (reason?: any) => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (activeReader) {
          try {
            await activeReader.cancel(reason);
          } catch {}
        } else if (activeStream) {
          try {
            await activeStream.cancel(reason);
          } catch {}
        }
        cleanupJobDir(jobId);
      };

      const onAbort = () => {
        void handleAbort('Request aborted by client');
      };

      if (req.signal) {
        if (req.signal.aborted) {
          onAbort();
        } else {
          req.signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          try {
            if (req.signal?.aborted || cleanedUp) return;
            const inputPath = await writeInputFile(jobId, filename, req.body!);
            if (req.signal?.aborted || cleanedUp) return;
            const outputFileName = `output.${outputFormat}`;
            const outputPath = path.join(masterDir, outputFileName);

            const { args, strategy, reason } = await buildConvertArgs(inputPath, opts, preset);
            args.push('-y', outputPath);

            if (req.signal?.aborted || cleanedUp) return;

            controller.enqueue(enc.encode(
              `data: {"strategy":"${strategy}","strategyReason":${JSON.stringify(reason)}}\n\n`
            ));

            if (req.signal?.aborted || cleanedUp) return;
            const ffmpegStream = executeFfmpeg(inputPath, args);
            activeStream = ffmpegStream;
            if (req.signal?.aborted || cleanedUp) {
              void ffmpegStream.cancel();
              return;
            }
            const reader = ffmpegStream.getReader();
            activeReader = reader;
            if (req.signal?.aborted || cleanedUp) {
              void reader.cancel();
              return;
            }
            const decoder = new TextDecoder();

            while (true) {
              if (req.signal?.aborted) break;
              const { done, value } = await reader.read();
              if (done) break;

              const text = decoder.decode(value);
              const messages = text.split('\n\n').filter(Boolean);

              for (const msg of messages) {
                if (msg.includes('"status":"done"')) continue;
                if (msg.includes('"error"')) throw new Error(msg);

                const match = msg.match(/"progress":(\d+)/);
                if (match) {
                  const prog = parseInt(match[1], 10);
                  controller.enqueue(enc.encode(`data: {"progress":${prog}}\n\n`));
                }
              }
            }

            if (!req.signal?.aborted) {
              controller.enqueue(enc.encode(
                `data: {"status":"complete","downloadUrl":"/api/download?jobId=${jobId}&file=${outputFileName}","filename":${JSON.stringify(outputFileName)}}\n\n`
              ));
            }
          } catch (err: unknown) {
            if (activeReader) {
              try {
                await activeReader.cancel(err);
              } catch {}
            }
            if (!cleanedUp) {
              try {
                controller.enqueue(enc.encode(sanitizeSseError(err, 'SSE /api/convert (stream)')));
              } catch {}
              cleanupJobDir(jobId);
              cleanedUp = true;
            }
          } finally {
            (globalThis as any)[Symbol.for('celestial.activeJobDirs')]?.delete?.(jobId);
            if (!cleanedUp) {
              try {
                const now = new Date();
                // eslint-disable-next-line security/detect-non-literal-fs-filename
                fs.utimesSync(masterDir, now, now);
              } catch {}
            }
            if (req.signal) {
              req.signal.removeEventListener('abort', onAbort);
            }
            try {
              controller.close();
            } catch {}
          }
        },
        async cancel(reason) {
          if (req.signal) {
            req.signal.removeEventListener('abort', onAbort);
          }
          await handleAbort(reason);
        }
      });

      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        },
      });
    }

    const formData = await req.formData();
    const preset        = formData.get('preset')        as string || 'auto';
    const outputFormat  = formData.get('outputFormat')  as string;
    const speed         = formData.has('speed')         ? parseFloat(formData.get('speed') as string)      : 1;
    const resolution    = formData.get('resolution')    as string || 'original';
    const stripAudio    = formData.get('stripAudio')    === 'true';
    const stripMetadata = formData.get('stripMetadata') === 'true';
    const gifFps        = formData.has('gifFps')        ? parseInt(formData.get('gifFps') as string, 10) : undefined;
    const gifPalette    = formData.has('gifPalette')    ? formData.get('gifPalette') !== 'false'         : undefined;
    const rawFiles      = formData.getAll('files')      as File[];
    const singleFile    = formData.get('file')           as File | null;
    const singleVideoFile = (formData.get('videoFile') || formData.get('attachedVideo')) as File | null;

    const videoStartTime  = formData.has('videoStartTime') ? parseFloat(formData.get('videoStartTime') as string) : undefined;
    const videoEndTime    = formData.has('videoEndTime') ? parseFloat(formData.get('videoEndTime') as string) : undefined;
    const audioSyncMode   = formData.get('audioSyncMode') as any || undefined;
    const visualizerStyle = formData.get('visualizerStyle') as any || undefined;
    const visualizerColor = formData.get('visualizerColor') as string || undefined;
    const visualizerBg    = formData.get('visualizerBg') as string || undefined;
    const videoLoop       = formData.has('videoLoop') ? formData.get('videoLoop') === 'true' : undefined;
    const useVisualizer   = formData.get('useVisualizer') === 'true';

    const filesToProcess = rawFiles.length > 0 ? rawFiles : (singleFile ? [singleFile] : []);
    if (filesToProcess.length === 0) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const payload: any = {
      preset,
      outputFormat,
      speed,
      resolution,
      stripAudio,
      stripMetadata,
      file: singleFile ? { filename: singleFile.name, size: singleFile.size, mimetype: singleFile.type } : undefined,
      files: rawFiles.map(f => ({ filename: f.name, size: f.size, mimetype: f.type })),
      videoFile: singleVideoFile ? { filename: singleVideoFile.name, size: singleVideoFile.size, mimetype: singleVideoFile.type } : undefined,
    };

    if (videoStartTime !== undefined) payload.videoStartTime = videoStartTime;
    if (videoEndTime !== undefined) payload.videoEndTime = videoEndTime;
    if (audioSyncMode !== undefined) payload.audioSyncMode = audioSyncMode;
    if (visualizerStyle !== undefined) payload.visualizerStyle = visualizerStyle;
    if (visualizerColor !== undefined) payload.visualizerColor = visualizerColor;
    if (visualizerBg !== undefined) payload.visualizerBg = visualizerBg;
    if (videoLoop !== undefined) payload.videoLoop = videoLoop;
    if (gifFps !== undefined) payload.gifFps = gifFps;
    if (gifPalette !== undefined) payload.gifPalette = gifPalette;

    const validation = ConvertInputSchema.safeParse(payload);
    if (!validation.success) return NextResponse.json({ error: validation.error.format() }, { status: 400 });
    const validated = validation.data;

    const masterDir = createJobDir(jobId);
    ((globalThis as any)[Symbol.for('celestial.activeJobDirs')] ??= new Set<string>()).add(jobId);
    const isGif   = outputFormat === 'gif';
    const isImage = IMAGE_FORMATS.includes(outputFormat);
    const opts    = {
      outputFormat,
      speed,
      resolution,
      stripAudio,
      stripMetadata,
      isGif,
      isImage,
      gifFps: validated.gifFps,
      gifPalette: validated.gifPalette,
    };

    const isMultiFile = filesToProcess.length > 1;

    let activeReader: ReadableStreamDefaultReader | null = null;
    let activeStream: ReadableStream | null = null;
    let cleanedUp = false;
    const handleAbort = async (reason?: any) => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (activeReader) {
        try {
          await activeReader.cancel(reason);
        } catch {}
      } else if (activeStream) {
        try {
          await activeStream.cancel(reason);
        } catch {}
      }
      cleanupJobDir(jobId);
    };

    const onAbort = () => {
      void handleAbort('Request aborted by client');
    };

    if (req.signal) {
      if (req.signal.aborted) {
        onAbort();
      } else {
        req.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        try {
          if (!isMultiFile) {
            const rawFile = filesToProcess[0];
            const inputPath = await writeInputFile(jobId, rawFile.name, rawFile);
            const outputFileName = `output.${outputFormat}`;
            const outputPath = path.join(masterDir, outputFileName);

            const streamInfo = await probeMediaStreams(inputPath);
            const isAudioInput = !streamInfo.hasVideo && streamInfo.hasAudio;
            const isVideoTarget = VIDEO_FORMATS.includes(outputFormat.toLowerCase());

            if (isAudioInput && isVideoTarget && singleVideoFile && !useVisualizer) {
              // Branch 1: Audio + Attached Video Synthesis
              const videoPath = await writeInputFile(jobId, singleVideoFile.name, singleVideoFile);
              const videoStreamInfo = await probeMediaStreams(videoPath);

              const synthesis = resolveAudioVideoSynthesis({
                audioPath: inputPath,
                videoPath,
                outputPath,
                outputFormat,
                videoStartTime: validated.videoStartTime,
                videoEndTime: validated.videoEndTime,
                audioDuration: streamInfo.duration,
                videoDuration: videoStreamInfo.duration,
                audioSyncMode: validated.audioSyncMode,
                videoLoop: validated.videoLoop,
                resolution: validated.resolution,
                preset: validated.preset,
                speed: validated.speed,
              });

              controller.enqueue(enc.encode(
                `data: {"strategy":"${synthesis.strategy}","strategyReason":${JSON.stringify(synthesis.reason)},"targetDuration":${synthesis.targetDuration}}\n\n`
              ));

              if (req.signal?.aborted || cleanedUp) return;
              const ffmpegStream = executeFfmpeg(inputPath, synthesis.args, synthesis.targetDuration);
              activeStream = ffmpegStream;
              if (req.signal?.aborted || cleanedUp) {
                void ffmpegStream.cancel();
                return;
              }
              const reader = ffmpegStream.getReader();
              activeReader = reader;
              if (req.signal?.aborted || cleanedUp) {
                void reader.cancel();
                return;
              }
              const decoder = new TextDecoder();

              while (true) {
                if (req.signal?.aborted || cleanedUp) break;
                const { done, value } = await reader.read();
                if (done) break;
                if (req.signal?.aborted || cleanedUp) break;

                const text = decoder.decode(value);
                const messages = text.split('\n\n').filter(Boolean);

                for (const msg of messages) {
                  if (msg.includes('"status":"done"')) continue;
                  if (msg.includes('"error"')) throw new Error(msg);

                  const match = msg.match(/"progress":(\d+)/);
                  if (match) {
                    const prog = parseInt(match[1], 10);
                    controller.enqueue(enc.encode(`data: {"progress":${prog}}\n\n`));
                  }
                }
              }

              if (!req.signal?.aborted && !cleanedUp) {
                controller.enqueue(enc.encode(
                  `data: {"status":"complete","downloadUrl":"/api/download?jobId=${jobId}&file=${outputFileName}"}\n\n`
                ));
              }

            } else if (isAudioInput && isVideoTarget && (!singleVideoFile || useVisualizer)) {
              // Branch 2: Audio + Visualizer Synthesis
              const synthesis = resolveVisualizerSynthesis({
                audioPath: inputPath,
                outputPath,
                outputFormat,
                audioDuration: streamInfo.duration,
                visualizerStyle: validated.visualizerStyle,
                visualizerColor: validated.visualizerColor,
                visualizerBg: validated.visualizerBg,
                resolution: validated.resolution,
                preset: validated.preset,
                speed: validated.speed,
              });

              controller.enqueue(enc.encode(
                `data: {"strategy":"${synthesis.strategy}","strategyReason":${JSON.stringify(synthesis.reason)},"targetDuration":${synthesis.targetDuration}}\n\n`
              ));

              if (req.signal?.aborted || cleanedUp) return;
              const ffmpegStream = executeFfmpeg(inputPath, synthesis.args, synthesis.targetDuration);
              activeStream = ffmpegStream;
              if (req.signal?.aborted || cleanedUp) {
                void ffmpegStream.cancel();
                return;
              }
              const reader = ffmpegStream.getReader();
              activeReader = reader;
              if (req.signal?.aborted || cleanedUp) {
                void reader.cancel();
                return;
              }
              const decoder = new TextDecoder();

              while (true) {
                if (req.signal?.aborted || cleanedUp) break;
                const { done, value } = await reader.read();
                if (done) break;
                if (req.signal?.aborted || cleanedUp) break;

                const text = decoder.decode(value);
                const messages = text.split('\n\n').filter(Boolean);

                for (const msg of messages) {
                  if (msg.includes('"status":"done"')) continue;
                  if (msg.includes('"error"')) throw new Error(msg);

                  const match = msg.match(/"progress":(\d+)/);
                  if (match) {
                    const prog = parseInt(match[1], 10);
                    controller.enqueue(enc.encode(`data: {"progress":${prog}}\n\n`));
                  }
                }
              }

              if (!req.signal?.aborted && !cleanedUp) {
                controller.enqueue(enc.encode(
                  `data: {"status":"complete","downloadUrl":"/api/download?jobId=${jobId}&file=${outputFileName}"}\n\n`
                ));
              }

            } else if (isPdfFile(inputPath) && IMAGE_FORMATS.includes(outputFormat)) {
              // Branch 3: PDF Document Rasterization to Image (All Pages)
              controller.enqueue(enc.encode(
                `data: {"strategy":"PDF-RASTERIZE","strategyReason":${JSON.stringify(`Rasterize PDF document pages to ${outputFormat.toUpperCase()}`)}}\n\n`
              ));
              controller.enqueue(enc.encode(`data: {"progress":20}\n\n`));
              
              const outFiles = await convertPdfToImage(inputPath, outputPath, outputFormat);
              controller.enqueue(enc.encode(`data: {"progress":100}\n\n`));
              
              if (outFiles.length > 1) {
                try {
                  const fileBasenames = outFiles.map(f => path.basename(f));
                  createZipArchive(masterDir, fileBasenames, 'output.zip');
                } catch {}
                controller.enqueue(enc.encode(
                  `data: {"status":"complete","downloadUrl":"/api/download?jobId=${jobId}&file=output.zip","filename":"output.zip"}\n\n`
                ));
              } else {
                const finalFile = path.basename(outFiles[0] || outputPath);
                controller.enqueue(enc.encode(
                  `data: {"status":"complete","downloadUrl":"/api/download?jobId=${jobId}&file=${finalFile}","filename":${JSON.stringify(finalFile)}}\n\n`
                ));
              }

            } else {
              // Branch 4: Standard single file convert
              const { args, strategy, reason } = await buildConvertArgs(inputPath, opts, preset);
              args.push('-y', outputPath);

              controller.enqueue(enc.encode(
                `data: {"strategy":"${strategy}","strategyReason":${JSON.stringify(reason)}}\n\n`
              ));

              if (req.signal?.aborted || cleanedUp) return;
              const ffmpegStream = executeFfmpeg(inputPath, args);
              activeStream = ffmpegStream;
              if (req.signal?.aborted || cleanedUp) {
                void ffmpegStream.cancel();
                return;
              }
              const reader = ffmpegStream.getReader();
              activeReader = reader;
              if (req.signal?.aborted || cleanedUp) {
                void reader.cancel();
                return;
              }
              const decoder = new TextDecoder();

              while (true) {
                if (req.signal?.aborted || cleanedUp) break;
                const { done, value } = await reader.read();
                if (done) break;
                if (req.signal?.aborted || cleanedUp) break;

                const text = decoder.decode(value);
                const messages = text.split('\n\n').filter(Boolean);

                for (const msg of messages) {
                  if (msg.includes('"status":"done"')) continue;
                  if (msg.includes('"error"')) throw new Error(msg);

                  const match = msg.match(/"progress":(\d+)/);
                  if (match) {
                    const prog = parseInt(match[1], 10);
                    controller.enqueue(enc.encode(`data: {"progress":${prog}}\n\n`));
                  }
                }
              }

              if (!req.signal?.aborted && !cleanedUp) {
                controller.enqueue(enc.encode(
                  `data: {"status":"complete","downloadUrl":"/api/download?jobId=${jobId}&file=${outputFileName}","filename":${JSON.stringify(outputFileName)}}\n\n`
                ));
              }
            }

          } else {
            // Multi-file batch processing
            controller.enqueue(enc.encode(
              `data: {"strategy":"ENCODE","strategyReason":${JSON.stringify(`Batch convert ${filesToProcess.length} files to ${outputFormat.toUpperCase()}`)}}\n\n`
            ));

            const seenInputNames = new Set<string>();
            for (let i = 0; i < filesToProcess.length; i++) {
              if (req.signal?.aborted || cleanedUp) break;
              // eslint-disable-next-line security/detect-object-injection
              const f = filesToProcess[i];
              let safeInputName = f.name;
              if (seenInputNames.has(safeInputName)) {
                const parsedIn = path.parse(safeInputName);
                safeInputName = `${parsedIn.name}_${i + 1}${parsedIn.ext}`;
              }
              seenInputNames.add(safeInputName);
              const inputPath = await writeInputFile(jobId, safeInputName, f);
              if (req.signal?.aborted || cleanedUp) break;
              const parsed = path.parse(f.name);
              const outputFileName = `converted_${i + 1}_${parsed.name}.${outputFormat}`;
              const outputPath = path.join(masterDir, outputFileName);

              if (isPdfFile(inputPath) && IMAGE_FORMATS.includes(outputFormat)) {
                if (req.signal?.aborted || cleanedUp) break;
                const globalProgStart = Math.round((i * 100) / filesToProcess.length);
                controller.enqueue(enc.encode(`data: {"progress":${globalProgStart + 10}}\n\n`));
                await convertPdfToImage(inputPath, outputPath, outputFormat);
                const globalProgEnd = Math.round(((i + 1) * 100) / filesToProcess.length);
                controller.enqueue(enc.encode(`data: {"progress":${globalProgEnd}}\n\n`));
              } else {
                if (req.signal?.aborted || cleanedUp) break;
                const { args } = await buildConvertArgs(inputPath, opts, preset);
                args.push('-y', outputPath);

                if (req.signal?.aborted || cleanedUp) break;
                const ffmpegStream = executeFfmpeg(inputPath, args);
                activeStream = ffmpegStream;
                if (req.signal?.aborted || cleanedUp) {
                  void ffmpegStream.cancel();
                  break;
                }
                const reader = ffmpegStream.getReader();
                activeReader = reader;
                if (req.signal?.aborted || cleanedUp) {
                  void reader.cancel();
                  break;
                }
                const decoder = new TextDecoder();

                while (true) {
                  if (req.signal?.aborted || cleanedUp) break;
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (req.signal?.aborted || cleanedUp) break;

                  const text = decoder.decode(value);
                  const messages = text.split('\n\n').filter(Boolean);

                  for (const msg of messages) {
                    if (msg.includes('"status":"done"')) continue;
                    if (msg.includes('"error"')) throw new Error(msg);

                    const match = msg.match(/"progress":(\d+)/);
                    if (match) {
                      const localProg = parseInt(match[1], 10);
                      const globalProg = Math.round(((i * 100) + localProg) / filesToProcess.length);
                      controller.enqueue(enc.encode(`data: {"progress":${globalProg}}\n\n`));
                    }
                  }
                }
              }
            }

            let files: string[] = [];
            try {
              // eslint-disable-next-line security/detect-non-literal-fs-filename
              if (fs.existsSync(masterDir)) {
                // eslint-disable-next-line security/detect-non-literal-fs-filename
                files = fs.readdirSync(masterDir).filter(f => f.startsWith('converted_') && f !== 'output.zip');
              }
            } catch {
              files = [];
            }
            if (files.length === 0) {
              throw new Error('No converted files were generated');
            }
            try {
              createZipArchive(masterDir, files, 'output.zip');
            } catch (zipErr) {
              // Graceful fallback for mock zip / missing zip tool
            }
            const isSingle = files.length === 1;
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            const zipCreated = fs.existsSync(path.join(masterDir, 'output.zip'));
            const finalFile = (!isSingle && zipCreated) ? 'output.zip' : files[0];
            controller.enqueue(enc.encode(
              `data: {"status":"complete","downloadUrl":"/api/download?jobId=${jobId}&file=${encodeURIComponent(finalFile)}"}\n\n`
            ));
          }

        } catch (err: unknown) {
          if (activeReader) {
            try {
              await activeReader.cancel(err);
            } catch {}
          }
          if (!cleanedUp) {
            try {
              controller.enqueue(enc.encode(sanitizeSseError(err, 'SSE /api/convert')));
            } catch {}
            cleanupJobDir(jobId);
            cleanedUp = true;
          }
        } finally {
          (globalThis as any)[Symbol.for('celestial.activeJobDirs')]?.delete?.(jobId);
          if (!cleanedUp) {
            try {
              const now = new Date();
              // eslint-disable-next-line security/detect-non-literal-fs-filename
              fs.utimesSync(masterDir, now, now);
            } catch {}
          }
          if (req.signal) {
            req.signal.removeEventListener('abort', onAbort);
          }
          try {
            controller.close();
          } catch {}
        }
      },
      async cancel(reason) {
        if (req.signal) {
          req.signal.removeEventListener('abort', onAbort);
        }
        await handleAbort(reason);
      }
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection':    'keep-alive',
      },
    });

  } catch (error: unknown) {
    if (jobId) cleanupJobDir(jobId);
    const { error: msg, status } = sanitizeError(error, 'POST /api/convert');
    return NextResponse.json({ error: msg }, { status });
  }
}

