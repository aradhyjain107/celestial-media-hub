import { NextRequest, NextResponse } from 'next/server';
import { ConvertInputSchema } from '../../../schemas/convert';
import { executeFfmpeg } from '../../../lib/ffmpeg';
import { writeInputFile, createJobDir, cleanupJobDir } from '../../../lib/temp';
import { randomUUID } from 'crypto';
import path from 'node:path';
import fs from 'node:fs';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const jobId = randomUUID();
  try {
    const formData = await req.formData();
    const preset = formData.get('preset') as string || 'none';
    const outputFormat = formData.get('outputFormat') as string;
    const rawFile = formData.get('file') as File | null;
    
    if (!rawFile) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const payload = {
      preset,
      outputFormat,
      file: { filename: rawFile.name, size: rawFile.size, mimetype: rawFile.type }
    };

    const validation = ConvertInputSchema.safeParse(payload);
    if (!validation.success) return NextResponse.json({ error: validation.error.format() }, { status: 400 });

    const masterDir = createJobDir(jobId);
    const inputPath = await writeInputFile(jobId, rawFile.name, await rawFile.arrayBuffer());
    
    const parsed = path.parse(inputPath);
    const outputPath = path.join(masterDir, `converted_${parsed.name}.${outputFormat}`);

    const args = ['-i', inputPath];

    if (preset === 'twitter') {
      args.push('-c:v', 'libx264', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', 'faststart');
    } else if (preset === 'instagram' || preset === 'tiktok') {
      args.push('-c:v', 'libx264', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', 'faststart', '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2');
    }

    if (outputFormat === 'gif') {
      args.push('-vf', 'fps=15,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse', '-loop', '0');
    }

    args.push('-y', outputPath);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const ffmpegStream = executeFfmpeg('/tmp/NON_EXISTENT_DUMMY', inputPath, args);
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
                const prog = parseInt(match[1], 10);
                controller.enqueue(new TextEncoder().encode(`data: {"progress":${prog}}\n\n`));
              }
            }
          }
          
          const fileBase64 = fs.readFileSync(outputPath).toString('base64');
          controller.enqueue(new TextEncoder().encode(`data: {"status":"done", "fileBase64":"${fileBase64}"}\n\n`));
          
        } catch (err: any) {
          controller.enqueue(new TextEncoder().encode(`data: {"error":"${err.message}"}\n\n`));
        } finally {
          cleanupJobDir(jobId);
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
    cleanupJobDir(jobId);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
