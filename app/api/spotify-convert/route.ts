import { NextRequest, NextResponse } from 'next/server';
import { SpotifyInputSchema } from '../../../schemas/spotify';
import { executeYtdlp } from '../../../lib/ytdlp';
import { createJobDir, cleanupJobDir } from '../../../lib/temp';
import { randomUUID } from 'crypto';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

export const dynamic = 'force-dynamic';

async function scrapeSpotifyTracks(url: string): Promise<string[]> {
  const embedUrl = url.replace('spotify.com/', 'spotify.com/embed/');
  const res = await fetch(embedUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
  const html = await res.text();
  
  const tracks: string[] = [];
  
  const resourceMatch = html.match(/<script id="resource" type="application\/json">\s*(.*?)\s*<\/script>/);
  if (resourceMatch) {
    try {
      const data = JSON.parse(decodeURIComponent(resourceMatch[1]));
      const entity = data?.data?.entity;
      if (entity?.trackList) {
        for (const t of entity.trackList) {
          tracks.push(`${t.subtitle} - ${t.title}`);
        }
        return tracks;
      } else if (entity?.title) {
        tracks.push(`${entity.subtitle} - ${entity.title}`);
        return tracks;
      }
    } catch (e) {}
  }

  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1]);
      const items = data?.props?.pageProps?.state?.data?.entity?.tracks?.items || [];
      for (const item of items) {
        if (item.track) tracks.push(`${item.track.artists?.[0]?.name} - ${item.track.name}`);
      }
      return tracks;
    } catch (e) {}
  }
  
  throw new Error('Failed to parse Spotify embed data. Extractors failed.');
}

export async function POST(req: NextRequest) {
  const masterJobId = randomUUID();
  try {
    const body = await req.json();
    const validation = SpotifyInputSchema.safeParse(body);
    if (!validation.success) return NextResponse.json({ error: validation.error.format() }, { status: 400 });

    const { playlistUrl, outputFormat, quality } = validation.data;
    
    const tracks = await scrapeSpotifyTracks(playlistUrl);
    if (tracks.length === 0) return NextResponse.json({ error: 'No tracks found in standard Spotify embed layer' }, { status: 400 });

    const masterDir = createJobDir(masterJobId);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (let i = 0; i < tracks.length; i++) {
            // eslint-disable-next-line security/detect-object-injection
            const trackQuery = tracks[i];
            const dummyDir = createJobDir(`${masterJobId}/dummy_${i}`);
            
            const args = [
              '-P', masterDir, 
              '-o', '%(title)s.%(ext)s', 
              '-x', '--audio-format', outputFormat, '--audio-quality', `${quality}K`,
              `ytsearch1:${trackQuery}`
            ];

            const ytdlpStream = executeYtdlp(dummyDir, `ytsearch1:${trackQuery}`, args);
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
                
                // eslint-disable-next-line security/detect-unsafe-regex
                const match = msg.match(/"progress":(\d+(\.\d*)?)/);
                if (match) {
                  const localProg = Math.round(parseFloat(match[1]));
                  const globalProg = Math.round(((i * 100) + localProg) / tracks.length);
                  controller.enqueue(new TextEncoder().encode(`data: {"progress":${globalProg}, "currentTrack":"${trackQuery}"}\n\n`));
                }
              }
            }
          }
          
          execSync(`zip -j output.zip *.*`, { cwd: masterDir });
          // eslint-disable-next-line security/detect-non-literal-fs-filename
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

    return new NextResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  } catch (error: any) {
    cleanupJobDir(masterJobId);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
