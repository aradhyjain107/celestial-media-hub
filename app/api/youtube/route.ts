import { NextRequest, NextResponse } from 'next/server';
import { YoutubeInputSchema } from '../../../schemas/youtube';
import { executeYtdlp } from '../../../lib/ytdlp';
import { createJobDir, cleanupJobDir } from '../../../lib/temp';
import { randomUUID } from 'crypto';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const masterJobId = randomUUID();
  try {
    const body = await req.json();
    const validation = YoutubeInputSchema.safeParse(body);
    if (!validation.success) return NextResponse.json({ error: validation.error.format() }, { status: 400 });

    const { url, format, quality, isPlaylist, selectedIndices } = validation.data;
    
    const masterDir = createJobDir(masterJobId);
    
    const args = ['-P', masterDir, '-o', '%(title)s.%(ext)s'];
    
    if (format === 'mp3' || format === 'm4a' || format === 'wav') {
      args.push('-x', '--audio-format', format);
    } else {
      if (quality === '1080p') args.push('-f', 'bestvideo[height<=1080]+bestaudio/best');
      else if (quality === '720p') args.push('-f', 'bestvideo[height<=720]+bestaudio/best');
      else if (quality === '480p') args.push('-f', 'bestvideo[height<=480]+bestaudio/best');
      else args.push('-f', 'bestvideo+bestaudio/best');
    }

    if (!isPlaylist) args.push('--no-playlist');
    else {
      args.push('--yes-playlist');
      if (selectedIndices && selectedIndices.length > 0) {
        args.push('--playlist-items', selectedIndices.join(','));
      }
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const dummyDir = createJobDir(`${masterJobId}/dummy`);
          const ytdlpStream = executeYtdlp(dummyDir, url, args);
          const reader = ytdlpStream.getReader();
          const decoder = new TextDecoder();
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const text = decoder.decode(value);
            const messages = text.split('\n\n').filter(Boolean);
            
            for (const msg of messages) {
              if (msg.includes('"status":"done"')) continue;
              if (msg.includes('"error"')) throw new Error(msg);
              
              const match = msg.match(/"progress":(\d+(\.\d*)?)/);
              if (match) {
                const prog = Math.round(parseFloat(match[1]));
                controller.enqueue(new TextEncoder().encode(`data: {"progress":${prog}}\n\n`));
              }
            }
          }
          
          execSync(`zip -j output.zip *.*`, { cwd: masterDir });
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
