import { NextRequest, NextResponse } from 'next/server';
import { CompressInputSchema } from '../../../schemas/compress';
import { executeFfmpeg, probeMediaStreams, isEncoderAvailable } from '../../../lib/media/ffmpeg';
import { writeInputFile, createJobDir, cleanupJobDir } from '../../../lib/system/temp';
import { randomUUID } from 'crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { verifyAuth, registerJobOwner } from '../../../lib/security/auth';
import { sanitizeError, sanitizeSseError } from '../../../lib/security/errors';
import { createZipArchive } from '../../../lib/utils/archive';

export const dynamic = 'force-dynamic';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp', '.tiff']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma', '.alac']);

export async function POST(req: NextRequest) {
  const session = verifyAuth(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const masterJobId = randomUUID();
  registerJobOwner(masterJobId, session.userId);

  try {
    const formData = await req.formData();
    const videoCodec = (formData.get('videoCodec') as string) || 'hevc';
    const videoCrf = formData.get('videoCrf') ? parseInt(formData.get('videoCrf') as string, 10) : 28;
    const videoPreset = (formData.get('videoPreset') as string) || 'medium';
    const resolution = (formData.get('resolution') as string) || 'original';
    
    const audioBitrate = (formData.get('audioBitrate') as string) || '128k';
    const audioFormat = (formData.get('audioFormat') as string) || 'mp3';
    
    const imageQuality = formData.get('imageQuality') ? parseInt(formData.get('imageQuality') as string, 10) : 80;
    const imageFormat = (formData.get('imageFormat') as string) || 'webp';
    const maxDimension = (formData.get('maxDimension') as string) || 'original';
    
    const hardwareAccel = formData.get('hardwareAccel') === 'true';
    const rawFiles = formData.getAll('files') as File[];

    if (rawFiles.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const payload = {
      videoCodec,
      videoCrf,
      videoPreset,
      resolution,
      audioBitrate,
      audioFormat,
      imageQuality,
      imageFormat,
      maxDimension,
      hardwareAccel,
      files: rawFiles.map(f => ({ filename: f.name, size: f.size, mimetype: f.type }))
    };

    const validation = CompressInputSchema.safeParse(payload);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.format() }, { status: 400 });
    }

    const masterDir = createJobDir(masterJobId);
    const inputPaths: string[] = [];
    for (const f of rawFiles) {
      inputPaths.push(await writeInputFile(masterJobId, f.name, f));
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
      cleanupJobDir(masterJobId);
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
        try {
          const generatedFiles: { name: string; size: number; downloadUrl: string }[] = [];

          for (let i = 0; i < inputPaths.length; i++) {
            if (req.signal?.aborted || cleanedUp) break;
            // eslint-disable-next-line security/detect-object-injection
            const inputPath = inputPaths[i];
            const parsed = path.parse(inputPath);
            const ext = parsed.ext.toLowerCase();

            const info = await probeMediaStreams(inputPath);
            const isImage = IMAGE_EXTS.has(ext) || (!info.hasVideo && !info.hasAudio);
            const isAudioOnly = AUDIO_EXTS.has(ext) || (info.hasAudio && !info.hasVideo);
            let outputExt = ext;
            let outputFileName = `compressed_${parsed.name}${ext}`;
            if (isImage) {
              const targetExt = imageFormat === 'jpeg' ? '.jpg' : `.${imageFormat}`;
              outputExt = targetExt;
              outputFileName = `compressed_${parsed.name}${targetExt}`;
            } else if (isAudioOnly) {
              outputExt = `.${audioFormat}`;
              outputFileName = `compressed_${parsed.name}.${audioFormat}`;
            } else {
              outputExt = '.mp4';
              outputFileName = `compressed_${parsed.name}.mp4`;
            }
            const outputPath = path.join(masterDir, outputFileName);
            const args = ['-i', inputPath];

            if (isImage) {
              let imageProcessed = false;

              // Priority 1: High performance native cwebp for WebP target
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

              // Priority 2: macOS native sips for JPEG / PNG
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

              // Priority 3: Universal FFmpeg image2 encoder fallback
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

                const ffmpegStream = executeFfmpeg(inputPath, imgArgs, 1);
                const reader = ffmpegStream.getReader();
                activeReader = reader;
                const decoder = new TextDecoder();
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  const text = decoder.decode(value);
                  if (text.includes('"error"')) throw new Error(text);
                }
              }

              const globalProg = Math.round(((i + 1) * 100) / rawFiles.length);
              controller.enqueue(new TextEncoder().encode(`data: {"progress":${globalProg},"fileIndex":${i}}\n\n`));
            } else if (isAudioOnly) {
              outputExt = `.${audioFormat}`;
              outputFileName = `compressed_${parsed.name}.${audioFormat}`;
              const outputPath = path.join(masterDir, outputFileName);

              if (audioFormat === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', audioBitrate);
              else if (audioFormat === 'aac') args.push('-c:a', 'aac', '-b:a', audioBitrate);
              else if (audioFormat === 'ogg') args.push('-c:a', 'libvorbis', '-b:a', audioBitrate);
              else if (audioFormat === 'flac') args.push('-c:a', 'flac');

              if (outputExt === '.m4a' || outputExt === '.mp4') {
                args.push('-movflags', '+faststart');
              }
              args.push('-y', outputPath);

              const ffmpegStream = executeFfmpeg(inputPath, args);
              const reader = ffmpegStream.getReader();
              activeReader = reader;
              const decoder = new TextDecoder();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value);
                const messages = text.split('\n\n').filter(Boolean);
                for (const msg of messages) {
                  if (msg.includes('"status":"done"')) continue;
                  if (msg.includes('"error"')) throw new Error(msg);
                  const match = msg.match(/"progress":(\d+)/);
                  if (match) {
                    const localProg = parseInt(match[1], 10);
                    const globalProg = Math.round(((i * 100) + localProg) / rawFiles.length);
                    controller.enqueue(new TextEncoder().encode(`data: {"progress":${globalProg},"fileIndex":${i}}\n\n`));
                  }
                }
              }
            } else {
              outputExt = '.mp4';
              outputFileName = `compressed_${parsed.name}.mp4`;
              const outputPath = path.join(masterDir, outputFileName);

              if (hwEncoder) {
                if (hwEncoder.includes('videotoolbox')) {
                  // VideoToolbox uses 1-100 quality scale (100 = best quality, 1 = maximum compression)
                  // Invert CRF (18-35) so CRF 18 (High Quality) -> 85, CRF 28 -> 50, CRF 35 (High Compression) -> 25
                  const vtQuality = Math.max(15, Math.min(95, Math.round(85 - ((videoCrf - 18) * (60 / 17)))));
                  args.push('-c:v', hwEncoder, '-q:v', String(vtQuality));
                } else if (hwEncoder.includes('nvenc')) {
                  args.push('-c:v', hwEncoder, '-cq:v', String(videoCrf));
                } else {
                  args.push('-c:v', hwEncoder, '-q:v', String(videoCrf));
                }
              } else if (videoCodec === 'av1') {
                if (await isEncoderAvailable('libsvtav1')) {
                  const svtPresetMap: Record<string, string> = { ultrafast: '10', fast: '8', medium: '6', slow: '4' };
                  // eslint-disable-next-line security/detect-object-injection
                  const svtPreset = svtPresetMap[videoPreset] || '6';
                  args.push('-c:v', 'libsvtav1', '-crf', String(videoCrf), '-preset', svtPreset, '-pix_fmt', 'yuv420p');
                } else if (await isEncoderAvailable('libaom-av1')) {
                  const aomCpuUsedMap: Record<string, string> = { ultrafast: '8', fast: '7', medium: '6', slow: '4' };
                  // eslint-disable-next-line security/detect-object-injection
                  const cpuUsed = aomCpuUsedMap[videoPreset] || '6';
                  args.push('-c:v', 'libaom-av1', '-crf', String(videoCrf), '-b:v', '0', '-cpu-used', cpuUsed, '-row-mt', '1', '-pix_fmt', 'yuv420p');
                } else {
                  args.push('-c:v', 'libx264', '-crf', String(videoCrf), '-preset', videoPreset, '-pix_fmt', 'yuv420p');
                }
              } else if (videoCodec === 'vp9') {
                const vp9CpuUsedMap: Record<string, string> = { ultrafast: '5', fast: '4', medium: '2', slow: '1' };
                // eslint-disable-next-line security/detect-object-injection
                const cpuUsed = vp9CpuUsedMap[videoPreset] || '2';
                args.push('-c:v', 'libvpx-vp9', '-crf', String(videoCrf), '-b:v', '0', '-deadline', 'good', '-cpu-used', cpuUsed, '-pix_fmt', 'yuv420p');
              } else {
                const codecMap: Record<string, string> = {
                  hevc: 'libx265',
                  h264: 'libx264',
                };
                // eslint-disable-next-line security/detect-object-injection
                const encoder = codecMap[videoCodec] || 'libx265';
                args.push('-c:v', encoder, '-crf', String(videoCrf), '-preset', videoPreset);
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
                if (outputExt === '.webm') {
                  args.push('-c:a', 'libopus', '-b:a', audioBitrate);
                } else {
                  args.push('-c:a', 'aac', '-b:a', audioBitrate);
                }
              } else {
                args.push('-an');
              }
              if (videoCodec === 'hevc') {
                args.push('-tag:v', 'hvc1');
              }
              if (outputExt === '.mp4' || outputExt === '.mov' || outputExt === '.m4a') {
                args.push('-movflags', '+faststart');
              }
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
                    const globalProg = Math.round(((i * 100) + localProg) / rawFiles.length);
                    controller.enqueue(new TextEncoder().encode(`data: {"progress":${globalProg},"fileIndex":${i}}\n\n`));
                  }
                }
              }
            }

            try {
              // eslint-disable-next-line security/detect-non-literal-fs-filename
              if (fs.existsSync(outputPath)) {
                // eslint-disable-next-line security/detect-non-literal-fs-filename
                const stat = fs.statSync(outputPath);
                generatedFiles.push({
                  name: outputFileName,
                  size: stat.size,
                  downloadUrl: `/api/download?jobId=${masterJobId}&file=${encodeURIComponent(outputFileName)}`
                });
              }
            } catch {
              // file stat error fallback
            }
          }

          let zipFiles: string[] = [];
          try {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            if (fs.existsSync(masterDir)) {
              // eslint-disable-next-line security/detect-non-literal-fs-filename
              zipFiles = fs.readdirSync(masterDir).filter(f => f.startsWith('compressed_') && f !== 'output.zip');
            }
          } catch {
            zipFiles = [];
          }

          const isSingle = generatedFiles.length === 1;
          let finalDownloadUrl = '';
          let finalFilename = '';

          if (isSingle) {
            const singleFile = generatedFiles[0].name;
            finalDownloadUrl = `/api/download?jobId=${masterJobId}&file=${encodeURIComponent(singleFile)}`;
            finalFilename = singleFile;
          } else {
            if (zipFiles.length > 0) {
              try {
                createZipArchive(masterDir, zipFiles, 'output.zip');
              } catch (zipErr) {
                console.warn('zip archive creation failed:', zipErr);
              }
            }
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            const zipCreated = fs.existsSync(path.join(masterDir, 'output.zip'));
            if (zipCreated) {
              finalDownloadUrl = `/api/download?jobId=${masterJobId}&file=output.zip`;
              finalFilename = 'compressed_batch.zip';
            } else if (generatedFiles.length > 0) {
              finalDownloadUrl = `/api/download?jobId=${masterJobId}&file=${encodeURIComponent(generatedFiles[0].name)}`;
              finalFilename = generatedFiles[0].name;
            }
          }

          if (!req.signal?.aborted) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
              status: 'complete',
              downloadUrl: finalDownloadUrl,
              filename: finalFilename,
              files: generatedFiles
            })}\n\n`));
          }

        } catch (err: unknown) {
          if (activeReader) {
            try {
              await activeReader.cancel(err);
            } catch {}
          }
          if (!cleanedUp) {
            try {
              controller.enqueue(new TextEncoder().encode(sanitizeSseError(err, 'SSE /api/compress')));
            } catch {}
            cleanupJobDir(masterJobId);
            cleanedUp = true;
          }
        } finally {
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

  } catch (err: unknown) {
    if (masterJobId) cleanupJobDir(masterJobId);
    const { error: msg, status } = sanitizeError(err, 'POST /api/compress');
    return NextResponse.json({ error: msg }, { status });
  }
}
