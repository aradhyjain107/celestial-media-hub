import { NextRequest, NextResponse } from 'next/server';
import { TrimInputSchema } from '../../../schemas/trim';
import { executeFfmpeg, getMediaDuration, probeMediaStreams } from '../../../lib/ffmpeg';
import { writeInputFile, createJobDir, cleanupJobDir } from '../../../lib/temp';
import { randomUUID } from 'crypto';
import path from 'node:path';
import fs from 'node:fs';
import { verifyAuth, registerJobOwner } from '../../../lib/auth';
import { sanitizeError, sanitizeSseError } from '../../../lib/errors';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = verifyAuth(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const masterJobId = randomUUID();
  registerJobOwner(masterJobId, session.userId);
  try {
    const formData = await req.formData();
    const mode = formData.get('mode') as 'trim' | 'merge';
    const outputFormat = formData.get('outputFormat') as string || 'mp3';
    
    const startTimeRaw = formData.get('startTime') as string;
    const endTimeRaw = formData.get('endTime') as string;
    const startTime = startTimeRaw !== null && startTimeRaw !== undefined && startTimeRaw !== '' ? parseFloat(startTimeRaw) : undefined;
    const endTime = endTimeRaw !== null && endTimeRaw !== undefined && endTimeRaw !== '' ? parseFloat(endTimeRaw) : undefined;
    
    const fadeInRaw = formData.get('fadeIn') as string;
    const fadeOutRaw = formData.get('fadeOut') as string;
    const fadeIn = fadeInRaw !== null && fadeInRaw !== undefined && fadeInRaw !== '' ? parseFloat(fadeInRaw) : undefined;
    const fadeOut = fadeOutRaw !== null && fadeOutRaw !== undefined && fadeOutRaw !== '' ? parseFloat(fadeOutRaw) : undefined;
    const crossfadeRaw = formData.get('crossfade') as string;
    const crossfade = crossfadeRaw !== null && crossfadeRaw !== undefined && crossfadeRaw !== '' ? parseFloat(crossfadeRaw) : undefined;
    
    const rawFiles = formData.getAll('files') as File[];
    
    if (rawFiles.length === 0) return NextResponse.json({ error: 'No files provided' }, { status: 400 });

    const payload = {
      mode, 
      outputFormat, 
      startTime, 
      endTime, 
      fadeIn, 
      fadeOut,
      crossfade,
      files: rawFiles.map((f, i) => ({ filename: f.name, size: f.size, mimetype: f.type, order: i }))
    };

    const validation = TrimInputSchema.safeParse(payload);
    if (!validation.success) return NextResponse.json({ error: validation.error.format() }, { status: 400 });

    const masterDir = createJobDir(masterJobId);
    const inputPaths: string[] = [];
    for (const f of rawFiles) {
      inputPaths.push(await writeInputFile(masterJobId, f.name, f));
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
          if (req.signal?.aborted || cleanedUp) return;
          const outputFileName = `output.${outputFormat}`;
          const outputPath = path.join(masterDir, outputFileName);
          let args: string[] = [];
          let executionTargetFile = inputPaths[0];
          let totalDuration = 0;
          let hasFilters = false;
          let inputCodec = '';

          if (mode === 'trim') {
            const [inputDur, inputInfo] = await Promise.all([
              getMediaDuration(inputPaths[0]),
              probeMediaStreams(inputPaths[0]).catch(() => ({ hasVideo: false, hasAudio: true, audioCodec: '' })),
            ]);
            inputCodec = inputInfo?.audioCodec?.toLowerCase() || '';
            const startSec = startTime ?? 0;
            const endSec = endTime ?? (inputDur > 0 ? inputDur : 0);
            const clipDuration = Math.max(0, endSec - startSec);
            totalDuration = clipDuration;

            args = ['-i', executionTargetFile];
            if (startTime !== undefined) args.push('-ss', String(startTime));
            if (endTime !== undefined) args.push('-to', String(endTime));
            
            const effectiveFadeIn = fadeIn ? Math.min(fadeIn, clipDuration / 2) : 0;
            const effectiveFadeOut = fadeOut ? Math.min(fadeOut, clipDuration / 2) : 0;

            const filters = [];
            if (effectiveFadeIn > 0) {
              filters.push(`afade=t=in:st=0:d=${effectiveFadeIn}`);
            }
            if (effectiveFadeOut > 0) {
              const fadeOutStart = Math.max(0, clipDuration - effectiveFadeOut);
              filters.push(`afade=t=out:st=${fadeOutStart}:d=${effectiveFadeOut}`);
            }
            
            if (filters.length > 0) {
              hasFilters = true;
              args.push('-af', `asetpts=PTS-STARTPTS,${filters.join(',')}`);
            }
          } else if (mode === 'merge') {
            const durations = await Promise.all(inputPaths.map(p => getMediaDuration(p)));
            const sumDuration = durations.reduce((a, b) => a + b, 0);

            if (crossfade !== undefined && crossfade > 0 && inputPaths.length >= 2) {
              hasFilters = true;
              executionTargetFile = inputPaths[0];
              args = [];
              for (const p of inputPaths) {
                args.push('-i', p);
              }
              const filterSteps: string[] = [];
              let currentMergedDur = durations[0] || 0;
              for (let i = 1; i < inputPaths.length; i++) {
                // eslint-disable-next-line security/detect-object-injection
                const rightDur = durations[i] || 0;
                const stepCrossfade = (currentMergedDur > 0 && rightDur > 0 && crossfade >= Math.min(currentMergedDur, rightDur))
                  ? Math.max(0.05, Number((Math.min(currentMergedDur, rightDur) * 0.5).toFixed(2)))
                  : crossfade;
                if (currentMergedDur > 0 && rightDur > 0) {
                  currentMergedDur = Math.max(0.1, currentMergedDur + rightDur - stepCrossfade);
                }
                const leftLabel = i === 1 ? '[0:a]' : `[a${i - 1}]`;
                const outLabel = i === inputPaths.length - 1 ? '[aout]' : `[a${i}]`;
                filterSteps.push(`${leftLabel}[${i}:a]acrossfade=d=${stepCrossfade}:c1=tri:c2=tri${outLabel}`);
              }
              totalDuration = currentMergedDur > 0
                ? currentMergedDur
                : Math.max(0.1, sumDuration - crossfade * (inputPaths.length - 1));
              args.push('-filter_complex', filterSteps.join(';'), '-map', '[aout]');
            } else {
              const listPath = path.join(masterDir, 'files.txt');
              const fileList = inputPaths.map(p => `file '${p.replace(/\\/g, '\\\\').replace(/'/g, "'\\''")}'`).join('\n');
              // eslint-disable-next-line security/detect-non-literal-fs-filename
              fs.writeFileSync(listPath, fileList);
              
              totalDuration = sumDuration;
              executionTargetFile = listPath;
              args = ['-f', 'concat', '-safe', '0', '-i', listPath];
            }
          }

          if (outputFormat === 'mp3') {
            args.push('-c:a', 'libmp3lame');
          } else if (outputFormat === 'flac') {
            args.push('-c:a', 'flac');
          } else if (outputFormat === 'wav') {
            if (hasFilters || !inputCodec.startsWith('pcm')) {
              args.push('-c:a', 'pcm_s16le');
            } else {
              args.push('-c:a', 'copy');
            }
          } else if (outputFormat === 'm4a' || outputFormat === 'aac') {
            if (hasFilters || (inputCodec !== 'aac' && inputCodec !== 'alac')) {
              args.push('-c:a', 'aac', '-b:a', '256k');
            } else {
              args.push('-c:a', 'copy');
            }
          } else if (hasFilters) {
            args.push('-c:a', 'aac');
          } else {
            args.push('-c:a', 'copy'); // defaults fallback
          }

          if (outputFormat === 'm4a' || outputFormat === 'mp4') {
            args.push('-movflags', '+faststart');
          }
          
          args.push('-y', outputPath);

          if (req.signal?.aborted || cleanedUp) return;
          const ffmpegStream = executeFfmpeg(executionTargetFile, args, totalDuration);
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
                controller.enqueue(new TextEncoder().encode(`data: {"progress":${parseInt(match[1], 10)}}\n\n`));
              }
            }
          }
          
          if (!req.signal?.aborted && !cleanedUp) {
            controller.enqueue(new TextEncoder().encode(`data: {"status":"complete", "downloadUrl":"/api/download?jobId=${masterJobId}&file=${outputFileName}"}\n\n`));
          }
          
        } catch (err: unknown) {
          if (activeReader) {
            try {
              await activeReader.cancel(err);
            } catch {}
          }
          if (!cleanedUp) {
            try {
              controller.enqueue(new TextEncoder().encode(sanitizeSseError(err, 'SSE /api/audio-trim')));
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
  } catch (error: unknown) {
    if (masterJobId) cleanupJobDir(masterJobId);
    const { error: msg, status } = sanitizeError(error, 'POST /api/audio-trim');
    return NextResponse.json({ error: msg }, { status });
  }
}

