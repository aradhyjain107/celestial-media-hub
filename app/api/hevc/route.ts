import { NextRequest, NextResponse } from 'next/server';
import { HevcInputSchema } from '../../../schemas/hevc';
import { executeFfmpeg } from '../../../lib/ffmpeg';
import { writeInputFile, createJobDir, cleanupJobDir } from '../../../lib/temp';
import { randomUUID } from 'crypto';
import path from 'node:path';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const masterJobId = randomUUID();
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
      inputPaths.push(await writeInputFile(masterJobId, f.name, await f.arrayBuffer()));
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (let i = 0; i < inputPaths.length; i++) {
            const inputPath = inputPaths[i];
            const parsed = path.parse(inputPath);
            const outputPath = path.join(masterDir, `hevc_${parsed.name}.mp4`);
            
            const args = ['-i', inputPath];
            if (hardwareAccel) {
              args.push('-c:v', 'hevc_videotoolbox', '-q:v', String(Math.round(crf * 2.5)));
            } else {
              args.push('-c:v', 'libx265', '-crf', String(crf), '-preset', preset);
            }
            args.push('-c:a', 'copy', '-y', outputPath);

            const ffmpegStream = executeFfmpeg('/tmp/NON_EXISTENT_DUMMY_DIR', inputPath, args);
            const reader = ffmpegStream.getReader();
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
                  controller.enqueue(new TextEncoder().encode(`data: {"progress":${globalProg}}\n\n`));
                }
              }
            }
          }
          
          execSync(`zip -j output.zip hevc_*`, { cwd: masterDir });
          const zipBase64 = fs.readFileSync(path.join(masterDir, 'output.zip')).toString('base64');
          controller.enqueue(new TextEncoder().encode(`data: {"status":"done", "zipBase64":"${zipBase64}"}\n\n`));
          
        } catch (err: any) {
          controller.enqueue(new TextEncoder().encode(`data: {"error":"${err.message}"}\n\n`));
        } finally {
          cleanupJobDir(masterJobId);
          controller.close();
        }
      }
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    cleanupJobDir(masterJobId);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
