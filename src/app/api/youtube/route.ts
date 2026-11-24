import { NextRequest, NextResponse } from 'next/server';
import { YoutubeInputSchema, isValidMediaUrl, detectMediaPlatform } from '../../../schemas/youtube';
import { executeYtdlp, getVideoInfo, getPlaylistInfo } from '../../../lib/media/ytdlp';
import * as tempManager from '../../../lib/system/temp';
const { createJobDir, cleanupJobDir } = tempManager;
import { randomUUID } from 'crypto';
import path from 'node:path';
import fs from 'node:fs';
import { verifyAuth, registerJobOwner } from '../../../lib/security/auth';
import { sanitizeError, sanitizeSseError } from '../../../lib/security/errors';
import { createZipArchive } from '../../../lib/utils/archive';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = verifyAuth(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  if (!isValidMediaUrl(url)) {
    return NextResponse.json({ error: 'Invalid URL parameter (must be YouTube or Instagram)' }, { status: 400 });
  }

  const platform = detectMediaPlatform(url);
  try {
    if (action === 'playlist-info') {
      const tracks = await getPlaylistInfo(url);
      return NextResponse.json({
        tracks,
        title: platform === 'instagram' ? 'Instagram Carousel / Batch' : 'Playlist',
        thumbnail: ''
      });
    } else {
      const info = await getVideoInfo(url);
      return NextResponse.json(info);
    }
  } catch (err: unknown) {
    if (platform === 'instagram') {
      const match = url.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
      const shortcode = match ? match[2] : 'Media';
      if (action === 'playlist-info') {
        return NextResponse.json({
          tracks: [{ id: shortcode, title: `Instagram ${shortcode}`, duration: undefined }],
          title: `Instagram Carousel (${shortcode})`,
          thumbnail: ''
        });
      }
      return NextResponse.json({
        title: `Instagram Reel / Post (${shortcode})`,
        thumbnail: '',
        duration: 'INSTAGRAM STREAM'
      });
    }
    const { error: msg, status } = sanitizeError(err, 'GET /api/youtube');
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: NextRequest) {
  const session = verifyAuth(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const masterJobId = randomUUID();
  registerJobOwner(masterJobId, session.userId);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid or empty JSON payload' }, { status: 400 });
    }
    const validation = YoutubeInputSchema.safeParse(body);
    if (!validation.success) return NextResponse.json({ error: validation.error.format() }, { status: 400 });

    const { url, urls, format, quality, isPlaylist, selectedIndices } = validation.data;
    const batchList = urls && urls.length > 0 ? urls : [url];
    const isMultiUrlBatch = batchList.length > 1;
    
    const masterDir = createJobDir(masterJobId);
    try {
      tempManager.markJobActive?.(masterJobId);
    } catch {}
    
    const outputTemplate = isMultiUrlBatch ? '%(title).120s [%(id)s].%(ext)s' : '%(title)s.%(ext)s';
    const args = ['-P', masterDir, '-o', outputTemplate];
    
    if (format === 'mp3' || format === 'm4a' || format === 'wav') {
      args.push('-x', '--audio-format', format);
      if (quality) {
        const qStr = String(quality).toLowerCase().endsWith('k') ? String(quality) : `${quality}K`;
        args.push('--audio-quality', qStr);
      }
    } else {
      if (quality === '1080p') args.push('-f', 'bestvideo[height<=1080]+bestaudio/best');
      else if (quality === '720p') args.push('-f', 'bestvideo[height<=720]+bestaudio/best');
      else if (quality === '480p') args.push('-f', 'bestvideo[height<=480]+bestaudio/best');
      else args.push('-f', 'bestvideo+bestaudio/best');

      args.push('--merge-output-format', 'mp4');
    }

    if (!isPlaylist) args.push('--no-playlist');
    else {
      args.push('--yes-playlist', '-i');
      if (!isMultiUrlBatch && selectedIndices && selectedIndices.length > 0) {
        const items1Indexed = selectedIndices.map((i: number) => i + 1).join(',');
        args.push('--playlist-items', items1Indexed);
      }
    }

    let activeReader: ReadableStreamDefaultReader | null = null;
    let activeStream: ReadableStream | null = null;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let cleanedUp = false;
    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };
    const handleAbort = async (reason?: any) => {
      if (cleanedUp) return;
      cleanedUp = true;
      stopHeartbeat();
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
          // Immediately flush SSE headers and keep Cloudflare/Render connections alive while yt-dlp warms up.
          controller.enqueue(new TextEncoder().encode(': connected\n\n'));
          heartbeatTimer = setInterval(() => {
            if (cleanedUp || req.signal?.aborted) {
              stopHeartbeat();
              return;
            }
            try {
              controller.enqueue(new TextEncoder().encode(': keepalive\n\n'));
            } catch {
              stopHeartbeat();
            }
          }, 5000);
          if (typeof heartbeatTimer.unref === 'function') {
            heartbeatTimer.unref();
          }

          let lastError: unknown = null;
          let idx = -1;
          for (const targetUrl of batchList) {
            idx += 1;
            if (req.signal?.aborted || cleanedUp) return;
            const ytdlpStream = executeYtdlp(masterDir, targetUrl, args);
            activeStream = ytdlpStream;
            if (req.signal?.aborted || cleanedUp) {
              void ytdlpStream.cancel();
              return;
            }
            const reader = ytdlpStream.getReader();
            activeReader = reader;
            if (req.signal?.aborted || cleanedUp) {
              void reader.cancel();
              return;
            }
            const decoder = new TextDecoder();
            
            try {
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
                  
                  // eslint-disable-next-line security/detect-unsafe-regex
                  const match = msg.match(/"progress":(\d+(\.\d*)?)/);
                  if (match) {
                    const itemProg = Math.round(parseFloat(match[1]));
                    const overallProg = isMultiUrlBatch
                      ? Math.round(((idx + itemProg / 100) / batchList.length) * 100)
                      : itemProg;
                    controller.enqueue(new TextEncoder().encode(`data: {"progress":${overallProg}}\n\n`));
                  }
                }
              }
            } catch (itemErr) {
              lastError = itemErr;
              if (!isMultiUrlBatch) throw itemErr;
            }
          }
          
          let files: string[] = [];
          try {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            if (fs.existsSync(masterDir)) {
              // eslint-disable-next-line security/detect-non-literal-fs-filename
              files = fs.readdirSync(masterDir).filter(f => {
                if (f === 'output.zip' || f.startsWith('.')) return false;
                if (f.endsWith('.part') || f.endsWith('.ytdl') || f.endsWith('.tmp') || f.endsWith('.temp.mp4')) return false;
                if (/\.f[0-9A-Za-z_-]+\.(mp4|m4a|webm|mkv)$/i.test(f)) return false;
                return true;
              });
            }
          } catch {
            files = [];
          }
          if (files.length === 0) {
            if (lastError) throw lastError;
            throw new Error('No files were downloaded');
          }

          let useZip = false;
          if (files.length > 1) {
            try {
              createZipArchive(masterDir, files, 'output.zip');
              // eslint-disable-next-line security/detect-non-literal-fs-filename
              useZip = fs.existsSync(path.join(masterDir, 'output.zip'));
            } catch (zipErr) {
              console.warn('zip archive creation failed:', zipErr);
            }
          }
          const finalDownloadUrl = useZip
            ? `/api/download?jobId=${masterJobId}&file=output.zip`
            : `/api/download?jobId=${masterJobId}&file=${encodeURIComponent(files[0])}`;
          const finalFilename = useZip ? 'youtube_downloads.zip' : files[0];

          // Refresh ownership & directory mtime after long downloads so /api/download remains valid
          registerJobOwner(masterJobId, session.userId);
          try {
            const now = new Date();
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            fs.utimesSync(masterDir, now, now);
          } catch {}

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
              controller.enqueue(new TextEncoder().encode(sanitizeSseError(err, 'SSE /api/youtube')));
            } catch {}
            cleanupJobDir(masterJobId);
            cleanedUp = true;
          }
        } finally {
          try {
            tempManager.markJobInactive?.(masterJobId);
          } catch {}
          stopHeartbeat();
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
    const { error: msg, status } = sanitizeError(error, 'POST /api/youtube');
    return NextResponse.json({ error: msg }, { status });
  }
}

