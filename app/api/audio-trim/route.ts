import { NextRequest, NextResponse } from 'next/server';
import { TrimInputSchema } from '../../../schemas/trim';
import { executeFfmpeg } from '../../../lib/ffmpeg';
import { writeInputFile, createJobDir, cleanupJobDir } from '../../../lib/temp';
import { randomUUID } from 'crypto';
import path from 'node:path';
import fs from 'node:fs';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const masterJobId = randomUUID();
  try {
    const formData = await req.formData();
    const mode = formData.get('mode') as 'trim' | 'merge';
    const outputFormat = formData.get('outputFormat') as string || 'mp3';
    
    const startTimeRaw = formData.get('startTime') as string;
    const endTimeRaw = formData.get('endTime') as string;
    const startTime = startTimeRaw ? parseFloat(startTimeRaw) : undefined;
    const endTime = endTimeRaw ? parseFloat(endTimeRaw) : undefined;
    
    const fadeIn = formData.has('fadeIn') ? parseFloat(formData.get('fadeIn') as string) : undefined;
    const fadeOut = formData.has('fadeOut') ? parseFloat(formData.get('fadeOut') as string) : undefined;
    
    const rawFiles = formData.getAll('files') as File[];
    
    if (rawFiles.length === 0) return NextResponse.json({ error: 'No files provided' }, { status: 400 });

    const payload = {
      mode, 
      outputFormat, 
      startTime, 
      endTime, 
      fadeIn, 
      fadeOut,
      files: rawFiles.map((f, i) => ({ filename: f.name, size: f.size, mimetype: f.type, order: i }))
    };

    const validation = TrimInputSchema.safeParse(payload);
    if (!validation.success) return NextResponse.json({ error: validation.error.format() }, { status: 400 });

    const masterDir = createJobDir(masterJobId);
    const inputPaths: string[] = [];
    for (const f of rawFiles) {
      inputPaths.push(await writeInputFile(masterJobId, f.name, await f.arrayBuffer()));
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const outputPath = path.join(masterDir, `processed.${outputFormat}`);
          let args: string[] = [];
          let executionTargetFile = inputPaths[0];

          if (mode === 'trim') {
            args = ['-i', executionTargetFile];
            if (startTime !== undefined) args.push('-ss', String(startTime));
            if (endTime !== undefined) args.push('-to', String(endTime));
            
            const filters = [];
            if (fadeIn && fadeIn > 0) filters.push(`afade=t=in:ss=${startTime || 0}:d=${fadeIn}`);
            if (fadeOut && fadeOut > 0 && endTime) filters.push(`afade=t=out:st=${endTime - fadeOut}:d=${fadeOut}`);
            
            if (filters.length > 0) args.push('-af', filters.join(','));
          } else if (mode === 'merge') {
            const listPath = path.join(masterDir, 'files.txt');
            const fileList = inputPaths.map(p => `file '${p}'`).join('\n');
            fs.writeFileSync(listPath, fileList);
            
            executionTargetFile = listPath;
            args = ['-f', 'concat', '-safe', '0', '-i', listPath];
          }

          if (outputFormat === 'mp3') args.push('-c:a', 'libmp3lame');
          else if (outputFormat === 'flac') args.push('-c:a', 'flac');
          else args.push('-c:a', 'copy'); // defaults fallback
          
          args.push('-y', outputPath);

          const ffmpegStream = executeFfmpeg('/tmp/NON_EXISTENT_DUMMY', executionTargetFile, args);
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
                controller.enqueue(new TextEncoder().encode(`data: {"progress":${parseInt(match[1], 10)}}\n\n`));
              }
            }
          }
          
          const fileBase64 = fs.readFileSync(outputPath).toString('base64');
          controller.enqueue(new TextEncoder().encode(`data: {"status":"done", "fileBase64":"${fileBase64}"}\n\n`));
          
        } catch (err: any) {
          controller.enqueue(new TextEncoder().encode(`data: {"error":"${err.message}"}\n\n`));
        } finally {
          cleanupJobDir(masterJobId);
          controller.close();
        }
      }
    });

    return new NextResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  } catch (error: any) {
    cleanupJobDir(masterJobId);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
