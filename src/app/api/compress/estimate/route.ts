import { NextRequest, NextResponse } from 'next/server';
import { executeFfmpeg, probeMediaStreams, isEncoderAvailable } from '../../../../lib/media/ffmpeg';
import { isConstrainedContainer } from '../../../../lib/system/serverHardwareProfiler';
import { buildSoftwareVideoCompressArgs } from '../../../../lib/media/videoCompressArgs';
import { createJobDir, cleanupJobDir } from '../../../../lib/system/temp';
import { verifyAuth } from '../../../../lib/security/auth';
import { sanitizeError } from '../../../../lib/security/errors';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export const dynamic = 'force-dynamic';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp', '.tiff']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma', '.alac']);

function getEstimateCacheDir(): string {
  return createJobDir('estimate-cache');
}

function getCacheFilePath(fileKey: string, originalName: string, size?: number): string {
  const dir = getEstimateCacheDir();
  const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.bin';
  const primaryHash = createHash('sha256').update(fileKey).digest('hex').slice(0, 24);
  const primaryPath = path.join(dir, `${primaryHash}${ext}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (fs.existsSync(primaryPath)) return primaryPath;

  if (typeof size === 'number' && size > 0) {
    const fallbackKey = `${originalName}_${size}`;
    const fallbackHash = createHash('sha256').update(fallbackKey).digest('hex').slice(0, 24);
    const fallbackPath = path.join(dir, `${fallbackHash}${ext}`);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (fs.existsSync(fallbackPath)) return fallbackPath;
  }
  return primaryPath;
}

async function runStreamToCompletion(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    if (text.includes('"error"')) {
      throw new Error(text);
    }
  }
}

export async function POST(req: NextRequest) {
  const session = verifyAuth(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const scratchJobId = `est_${randomUUID()}`;
  const scratchDir = createJobDir(scratchJobId);

  try {

    const contentType = req.headers.get('content-type') || '';
    let videoCodec = 'hevc';
    let videoCrf = 28;
    let videoPreset = 'medium';
    let resolution = 'original';
    let audioBitrate = '128k';
    let audioFormat = 'mp3';
    let imageQuality = 80;
    let imageFormat = 'webp';
    let maxDimension = 'original';
    let hardwareAccel = false;

    interface TargetItem {
      key: string;
      name: string;
      size: number;
      cachedPath: string;
    }
    const items: TargetItem[] = [];

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      videoCodec = (formData.get('videoCodec') as string) || 'hevc';
      videoCrf = formData.get('videoCrf') ? parseInt(formData.get('videoCrf') as string, 10) : 28;
      videoPreset = (formData.get('videoPreset') as string) || 'medium';
      resolution = (formData.get('resolution') as string) || 'original';
      audioBitrate = (formData.get('audioBitrate') as string) || '128k';
      audioFormat = (formData.get('audioFormat') as string) || 'mp3';
      imageQuality = formData.get('imageQuality') ? parseInt(formData.get('imageQuality') as string, 10) : 80;
      imageFormat = (formData.get('imageFormat') as string) || 'webp';
      maxDimension = (formData.get('maxDimension') as string) || 'original';
      hardwareAccel = formData.get('hardwareAccel') === 'true';

      const cacheOnly = formData.get('cacheOnly') === 'true';
      const keys = formData.getAll('fileKeys') as string[];
      const rawFiles = formData.getAll('files') as File[];

      for (let i = 0; i < rawFiles.length; i++) {
        // eslint-disable-next-line security/detect-object-injection
        const f = rawFiles[i];
        // eslint-disable-next-line security/detect-object-injection
        const key = keys[i] || `${f.name}_${f.size}_${f.lastModified || 0}`;
        const cachedPath = getCacheFilePath(key, f.name, f.size);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (!fs.existsSync(cachedPath)) {
          const buf = Buffer.from(await f.arrayBuffer());
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          fs.writeFileSync(cachedPath, buf);
        }
        items.push({ key, name: f.name, size: f.size, cachedPath });
      }

      if (cacheOnly) {
        return NextResponse.json({
          cached: true,
          needsUpload: false,
          keys: items.map(it => it.key),
        });
      }
    } else {
      const body = await req.json();
      videoCodec = body.videoCodec || 'hevc';
      videoCrf = typeof body.videoCrf === 'number' ? body.videoCrf : 28;
      videoPreset = body.videoPreset || 'medium';
      resolution = body.resolution || 'original';
      audioBitrate = body.audioBitrate || '128k';
      audioFormat = body.audioFormat || 'mp3';
      imageQuality = typeof body.imageQuality === 'number' ? body.imageQuality : 80;
      imageFormat = body.imageFormat || 'webp';
      maxDimension = body.maxDimension || 'original';
      hardwareAccel = Boolean(body.hardwareAccel);

      const fileRefs: Array<{ key: string; name: string; size: number }> = Array.isArray(body.files) ? body.files : [];
      const missingKeys: string[] = [];

      for (const ref of fileRefs) {
        const cachedPath = getCacheFilePath(ref.key, ref.name, ref.size);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (!fs.existsSync(cachedPath)) {
          missingKeys.push(ref.key);
        } else {
          items.push({ key: ref.key, name: ref.name, size: ref.size, cachedPath });
        }
      }

      if (missingKeys.length > 0 || body.cacheCheckOnly) {
        return NextResponse.json({ needsUpload: missingKeys.length > 0, missingKeys }, { status: 200 });
      }
    }

    let hwEncoder: string | null = null;
    if (hardwareAccel) {
      if (videoCodec === 'hevc') {
        if (await isEncoderAvailable('hevc_videotoolbox')) hwEncoder = 'hevc_videotoolbox';
        else if (await isEncoderAvailable('hevc_nvenc')) hwEncoder = 'hevc_nvenc';
      } else if (videoCodec === 'h264') {
        if (await isEncoderAvailable('h264_videotoolbox')) hwEncoder = 'h264_videotoolbox';
        else if (await isEncoderAvailable('h264_nvenc')) hwEncoder = 'h264_nvenc';
      }
    }

    const estimates: Record<string, number> = {};
    let totalEstimated = 0;

    for (let i = 0; i < items.length; i++) {
      if (req.signal?.aborted) break;
      // eslint-disable-next-line security/detect-object-injection
      const item = items[i];
      const inputPath = item.cachedPath;
      const parsed = path.parse(item.name);
      const ext = parsed.ext.toLowerCase();

      const info = await probeMediaStreams(inputPath);
      const isImage = IMAGE_EXTS.has(ext) || (!info.hasVideo && !info.hasAudio);
      const isAudioOnly = AUDIO_EXTS.has(ext) || (info.hasAudio && !info.hasVideo);

      let fileEstimatedBytes = item.size;

      if (isImage) {
        const targetExt = imageFormat === 'jpeg' ? '.jpg' : `.${imageFormat}`;
        const outputPath = path.join(scratchDir, `est_${i}${targetExt}`);
        let imageProcessed = false;

        if (imageFormat === 'webp') {
          try {
            const cwebpArgs = ['-q', String(imageQuality)];
            if (maxDimension !== 'original') {
              const maxDim = parseInt(maxDimension, 10);
              cwebpArgs.push('-resize', String(maxDim), '0');
            }
            cwebpArgs.push(inputPath, '-o', outputPath);
            execFileSync('cwebp', cwebpArgs, { stdio: 'pipe' });
            imageProcessed = true;
          } catch {
            imageProcessed = false;
          }
        }

        if (!imageProcessed && (imageFormat === 'jpeg' || imageFormat === 'png')) {
          try {
            const sipsFormat = imageFormat === 'jpeg' ? 'jpeg' : 'png';
            const sipsArgs = ['-s', 'format', sipsFormat];
            if (imageFormat === 'jpeg') {
              sipsArgs.push('-s', 'formatOptions', String(imageQuality));
            }
            if (maxDimension !== 'original') {
              const maxDim = parseInt(maxDimension, 10);
              sipsArgs.push('-Z', String(maxDim));
            }
            sipsArgs.push(inputPath, '--out', outputPath);
            execFileSync('sips', sipsArgs, { stdio: 'pipe' });
            imageProcessed = true;
          } catch {
            imageProcessed = false;
          }
        }

        if (!imageProcessed) {
          const imgArgs = ['-i', inputPath];
          if (maxDimension !== 'original') {
            const maxDim = parseInt(maxDimension, 10);
            imgArgs.push('-vf', `scale='if(gt(iw,ih),min(iw,${maxDim}),-2)':'if(gt(ih,iw),min(ih,${maxDim}),-2)'`);
          }
          if (imageFormat === 'webp') {
            imgArgs.push('-c:v', 'libwebp');
          } else if (imageFormat === 'jpeg' || imageFormat === 'jpg') {
            const qscale = Math.max(1, Math.round((100 - imageQuality) / 3));
            imgArgs.push('-c:v', 'mjpeg', '-q:v', String(qscale));
          } else if (imageFormat === 'png') {
            imgArgs.push('-c:v', 'png', '-compression_level', '6');
          }
          imgArgs.push('-frames:v', '1', '-y', outputPath);
          await runStreamToCompletion(executeFfmpeg(inputPath, imgArgs, 1));
        }

        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(outputPath)) {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          fileEstimatedBytes = fs.statSync(outputPath).size;
        }
      } else if (isAudioOnly) {
        const outputPath = path.join(scratchDir, `est_${i}.${audioFormat}`);
        const duration = info.duration > 0 ? info.duration : 0;
        const useSample = duration > 30;
        const sampleDuration = 8;
        const args: string[] = [];

        if (useSample) {
          args.push('-ss', String(Math.max(0, duration * 0.35)), '-t', String(sampleDuration));
        }
        args.push('-i', inputPath);

        if (audioFormat === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', audioBitrate);
        else if (audioFormat === 'aac') args.push('-c:a', 'aac', '-b:a', audioBitrate);
        else if (audioFormat === 'ogg') args.push('-c:a', 'libvorbis', '-b:a', audioBitrate);
        else if (audioFormat === 'flac') args.push('-c:a', 'flac');

        args.push('-y', outputPath);

        try {
          await runStreamToCompletion(executeFfmpeg(inputPath, args, useSample ? sampleDuration : duration || 1));
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          if (fs.existsSync(outputPath)) {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            const encodedSize = fs.statSync(outputPath).size;
            fileEstimatedBytes = useSample
              ? Math.round(encodedSize * (duration / sampleDuration))
              : encodedSize;
          }
        } catch {
          // Fallback to deterministic duration * bitrate math if encoder (e.g. libvorbis) is unavailable
          const kbps = parseInt(audioBitrate, 10) || 128;
          if (duration > 0) {
            if (audioFormat === 'flac') {
              fileEstimatedBytes = Math.round(duration * 92000);
            } else {
              fileEstimatedBytes = Math.round(duration * ((kbps * 1000) / 8) + 1024);
            }
          }
        }
      } else {
        const outputPath = path.join(scratchDir, `est_${i}.mp4`);
        const duration = info.duration > 0 ? info.duration : 0;
        const isShortClip = duration > 0 && duration <= 12 && item.size <= 30 * 1024 * 1024;
        const sampleDuration = 2.5;

        const buildVideoEncodeArgs = async (outFile: string, startSec?: number, durSec?: number): Promise<string[]> => {
          const args: string[] = [];
          if (typeof startSec === 'number' && typeof durSec === 'number') {
            args.push('-ss', startSec.toFixed(2), '-t', durSec.toFixed(2));
          }
          args.push('-i', inputPath);

          if (hwEncoder) {
            if (hwEncoder.includes('videotoolbox')) {
              const vtQuality = Math.max(15, Math.min(95, Math.round(85 - ((videoCrf - 18) * (60 / 17)))));
              args.push('-c:v', hwEncoder, '-q:v', String(vtQuality));
            } else if (hwEncoder.includes('nvenc')) {
              args.push('-c:v', hwEncoder, '-cq:v', String(videoCrf));
            } else {
              args.push('-c:v', hwEncoder, '-q:v', String(videoCrf));
            }
          } else {
            const swArgs = await buildSoftwareVideoCompressArgs({
              videoCodec,
              videoCrf,
              videoPreset: isShortClip ? videoPreset : 'faster',
              constrained: isConstrainedContainer(),
              hasEncoder: isEncoderAvailable,
            });
            args.push(...swArgs);
          }

          if (resolution !== 'original') {
            const heightMap: Record<string, number> = { '1080p': 1080, '720p': 720, '480p': 480 };
            // eslint-disable-next-line security/detect-object-injection
            const targetH = heightMap[resolution];
            if (targetH) {
              args.push('-vf', `scale=-2:${targetH}`);
            }
          }

          if (info.hasAudio) {
            args.push('-c:a', 'aac', '-b:a', audioBitrate);
          } else {
            args.push('-an');
          }
          if (videoCodec === 'hevc') {
            args.push('-tag:v', 'hvc1');
          }
          args.push('-movflags', '+faststart', '-y', outFile);
          return args;
        };

        if (isShortClip) {
          const args = await buildVideoEncodeArgs(outputPath);
          await runStreamToCompletion(executeFfmpeg(inputPath, args, duration));
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          if (fs.existsSync(outputPath)) {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            fileEstimatedBytes = fs.statSync(outputPath).size;
          }
        } else if (duration > 0) {
          const samplePoints = hwEncoder ? [0.2, 0.5, 0.78] : [0.25, 0.62];
          let sampledBytes = 0;
          let sampledSeconds = 0;
          for (let sIdx = 0; sIdx < samplePoints.length; sIdx++) {
            if (req.signal?.aborted) break;
            // eslint-disable-next-line security/detect-object-injection
            const frac = samplePoints[sIdx];
            const startSec = Math.max(0, (duration - sampleDuration) * frac);
            const sliceOut = path.join(scratchDir, `est_${i}_slice_${sIdx}.mp4`);
            const args = await buildVideoEncodeArgs(sliceOut, startSec, sampleDuration);
            await runStreamToCompletion(executeFfmpeg(inputPath, args, sampleDuration));
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            if (fs.existsSync(sliceOut)) {
              // eslint-disable-next-line security/detect-non-literal-fs-filename
              sampledBytes += fs.statSync(sliceOut).size;
              sampledSeconds += sampleDuration;
            }
          }
          if (sampledSeconds > 0) {
            const continuityCalibration = hwEncoder ? 1.0 : 1.03;
            fileEstimatedBytes = Math.round((sampledBytes / sampledSeconds) * duration * continuityCalibration);
          }
        }
      }

      // eslint-disable-next-line security/detect-object-injection
      estimates[item.key] = fileEstimatedBytes;
      totalEstimated += fileEstimatedBytes;
    }

    return NextResponse.json({
      needsUpload: false,
      estimates,
      totalEstimated
    });
  } catch (err: unknown) {
    const { error: msg, status } = sanitizeError(err, 'POST /api/compress/estimate');
    return NextResponse.json({ error: msg }, { status });
  } finally {
    try {
      cleanupJobDir(scratchJobId);
    } catch {}
  }
}
