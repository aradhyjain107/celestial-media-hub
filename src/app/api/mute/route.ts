import { NextRequest, NextResponse } from 'next/server';
import { MuteInputSchema } from '../../../schemas/mute';
import { executeFfmpeg, probeMediaStreams } from '../../../lib/media/ffmpeg';
import { writeInputFile, createJobDir, cleanupJobDir } from '../../../lib/system/temp';
import { randomUUID } from 'crypto';
import path from 'node:path';
import fs from 'node:fs';
import { verifyAuth, registerJobOwner } from '../../../lib/security/auth';
import { sanitizeError, sanitizeSseError } from '../../../lib/security/errors';
import { createZipArchive } from '../../../lib/utils/archive';

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
    const mode = formData.get('mode') as 'remove' | 'silence' || 'remove';
    const rawFiles = formData.getAll('files') as File[];
    
    if (rawFiles.length === 0) return NextResponse.json({ error: 'No files provided' }, { status: 400 });

    const payload = {
      mode,
      files: rawFiles.map(f => ({ filename: f.name, size: f.size, mimetype: f.type }))
    };

    const validation = MuteInputSchema.safeParse(payload);
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
            const outputPath = path.join(masterDir, `muted_${parsed.name}${parsed.ext}`);
            const info = await probeMediaStreams(inputPath);
            
            const ext = parsed.ext.toLowerCase();
            const args = ['-i', inputPath];
            if (mode === 'remove') {
              args.push('-map', '0:v:0?', '-c:v', 'copy', '-an');
            } else {
              if (info.hasAudio) {
                let audioCodec = 'aac';
                if (ext === '.webm') {
                  audioCodec = 'libopus';
                } else if (ext === '.avi') {
                  audioCodec = 'pcm_s16le';
                }
                args.push('-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', audioCodec, '-ac', '2', '-af', 'volume=0');
              } else {
                args.push('-map', '0:v:0?', '-c:v', 'copy', '-an');
              }
            }

            if ((ext === '.mp4' || ext === '.mov') && (info.videoCodec?.toLowerCase() === 'hevc' || info.videoCodec?.toLowerCase() === 'h265')) {
              args.push('-tag:v', 'hvc1');
            }

            if (ext === '.mp4' || ext === '.m4a' || ext === '.mov') {
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
              files = fs.readdirSync(masterDir).filter(f => f.startsWith('muted_') && f !== 'output.zip');
            }
          } catch {
            files = [];
          }
          if (files.length === 0) {
            throw new Error('No muted video files were generated');
          }

          try {
            createZipArchive(masterDir, files, 'output.zip');
          } catch (zipErr) {
            console.warn('zip archive creation failed:', zipErr);
          }
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          const zipCreated = fs.existsSync(path.join(masterDir, 'output.zip'));
          const finalDownloadUrl = zipCreated
            ? `/api/download?jobId=${masterJobId}&file=output.zip`
            : `/api/download?jobId=${masterJobId}&file=${encodeURIComponent(files[0])}`;
          const finalFilename = zipCreated ? 'muted_videos.zip' : files[0];

          if (!req.signal?.aborted) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
              status: 'complete',
              downloadUrl: finalDownloadUrl,
              filename: finalFilename
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
              controller.enqueue(new TextEncoder().encode(sanitizeSseError(err, 'SSE /api/mute')));
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
    const { error: msg, status } = sanitizeError(error, 'POST /api/mute');
    return NextResponse.json({ error: msg }, { status });
  }
}

