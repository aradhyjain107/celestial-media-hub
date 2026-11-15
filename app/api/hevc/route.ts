import { NextRequest, NextResponse } from 'next/server';
import { HevcInputSchema } from '../../../schemas/hevc';
import { executeFfmpeg, probeMediaStreams, isEncoderAvailable } from '../../../lib/ffmpeg';
import { writeInputFile, createJobDir, cleanupJobDir } from '../../../lib/temp';
import { randomUUID } from 'crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
    const crf = formData.get('crf') ? parseInt(formData.get('crf') as string, 10) : 28;
    const preset = formData.get('preset') as string || 'medium';
    const hardwareAccel = formData.get('hardwareAccel') === 'true';
    const rawFiles = formData.getAll('files') as File[];
    
    if (rawFiles.length === 0) return NextResponse.json({ error: 'No files provided' }, { status: 400 });

    const payload = {
      crf,
      preset,
      hardwareAccel,
      files: rawFiles.map(f => ({ filename: f.name, size: f.size, mimetype: f.type }))
    };

    const validation = HevcInputSchema.safeParse(payload);
    if (!validation.success) return NextResponse.json({ error: validation.error.format() }, { status: 400 });

    const masterDir = createJobDir(masterJobId);
    const inputPaths: string[] = [];
    for (const f of rawFiles) {
      inputPaths.push(await writeInputFile(masterJobId, f.name, f));
    }

    for (const inputPath of inputPaths) {
      const info = await probeMediaStreams(inputPath);
      if (!info.hasVideo) {
        cleanupJobDir(masterJobId);
        return NextResponse.json({ error: 'Input file contains no video stream.' }, { status: 400 });
      }
    }

    let hwEncoder: string | null = null;
    if (hardwareAccel) {
      if (await isEncoderAvailable('hevc_videotoolbox')) {
        hwEncoder = 'hevc_videotoolbox';
      } else if (await isEncoderAvailable('hevc_nvenc')) {
        hwEncoder = 'hevc_nvenc';
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
          for (let i = 0; i < inputPaths.length; i++) {
            if (req.signal?.aborted || cleanedUp) break;
            // eslint-disable-next-line security/detect-object-injection
            const inputPath = inputPaths[i];
            const parsed = path.parse(inputPath);
            const outputPath = path.join(masterDir, `hevc_${parsed.name}.mp4`);
            const info = await probeMediaStreams(inputPath);
            
            const args = ['-i', inputPath];
            if (hwEncoder) {
              if (hwEncoder.includes('videotoolbox')) {
                const vtQuality = Math.max(15, Math.min(95, Math.round(85 - ((crf - 18) * (60 / 17)))));
                args.push('-c:v', hwEncoder, '-q:v', String(vtQuality));
              } else if (hwEncoder.includes('nvenc')) {
                args.push('-c:v', hwEncoder, '-cq:v', String(crf));
              } else {
                args.push('-c:v', hwEncoder, '-q:v', String(crf));
              }
            } else {
              args.push('-c:v', 'libx265', '-crf', String(crf), '-preset', preset, '-pix_fmt', 'yuv420p');
            }

            if (info.hasAudio) {
              if (info.audioCodec && !['aac', 'mp3', 'alac', 'pcm_s16le', 'pcm_s24le'].includes(info.audioCodec.toLowerCase())) {
                args.push('-c:a', 'aac', '-b:a', '192k');
              } else {
                args.push('-c:a', 'copy');
              }
            } else {
              args.push('-an');
            }
            args.push('-tag:v', 'hvc1', '-movflags', '+faststart');
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
                  controller.enqueue(new TextEncoder().encode(`data: {"progress":${globalProg}}\n\n`));
                }
              }
            }
          }
          
          let files: string[] = [];
          try {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            if (fs.existsSync(masterDir)) {
              // eslint-disable-next-line security/detect-non-literal-fs-filename
              files = fs.readdirSync(masterDir).filter(f => f.startsWith('hevc_') && f !== 'output.zip');
            }
          } catch {
            files = [];
          }
          if (files.length === 0) {
            throw new Error('No compressed video files were generated');
          }

          try {
            execFileSync('zip', ['-j', 'output.zip', '--', ...files], { cwd: masterDir });
          } catch (zipErr) {
            console.warn('zip command failed or not available:', zipErr);
          }
          if (!req.signal?.aborted) {
            controller.enqueue(new TextEncoder().encode(`data: {"status":"complete", "downloadUrl":"/api/download?jobId=${masterJobId}&file=output.zip"}\n\n`));
          }
          
        } catch (err: unknown) {
          if (activeReader) {
            try {
              await activeReader.cancel(err);
            } catch {}
          }
          if (!cleanedUp) {
            try {
              controller.enqueue(new TextEncoder().encode(sanitizeSseError(err, 'SSE /api/hevc')));
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
    const { error: msg, status } = sanitizeError(error, 'POST /api/hevc');
    return NextResponse.json({ error: msg }, { status });
  }
}

