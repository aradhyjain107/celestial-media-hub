import { NextRequest, NextResponse } from 'next/server';
import { CelestialExtractor } from '../../../../lib/media/engine/extractor';
import { CelestialStreamer } from '../../../../lib/media/engine/pipe';
import { verifyAuth } from '../../../../lib/security/auth';
import { sanitizeError } from '../../../../lib/security/errors';

/** Allowed domain patterns for turbo-download (strict allowlist against SSRF / DNS rebinding) */
const ALLOWED_DOMAINS = [
  /^(www\.)?youtube\.com$/i,
  /^youtu\.be$/i,
  /^(www\.)?vimeo\.com$/i,
  /^(www\.)?soundcloud\.com$/i,
  /^(i\.)?ytimg\.com$/i,
];

const SAFE_LABEL_REGEX = /^[a-z0-9-]+$/i;

function isGoogleVideoSubdomain(hostname: string): boolean {
  const suffix = '.googlevideo.com';
  if (!hostname.endsWith(suffix)) return false;
  const prefix = hostname.slice(0, -suffix.length);
  if (!prefix) return false;
  const labels = prefix.split('.');
  return labels.every((label) => label.length > 0 && SAFE_LABEL_REGEX.test(label));
}


function validateUrl(raw: string): { valid: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, reason: 'Malformed URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only http/https protocols are allowed' };
  }
  const hostname = parsed.hostname.toLowerCase();
  const isAllowed =
    ALLOWED_DOMAINS.some((pattern) => pattern.test(hostname)) ||
    isGoogleVideoSubdomain(hostname);
  if (!isAllowed) {
    return { valid: false, reason: 'Domain not in allowed media provider list' };
  }
  return { valid: true };
}


export const dynamic = 'force-dynamic';

/**
 * GET /api/experimental/turbo-download
 * 
 * Experimental route to test the Native Celestial Engine.
 * Usage: /api/experimental/turbo-download?url=YOUTUBE_URL
 */
export async function GET(req: NextRequest) {
  const session = verifyAuth(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing URL parameter' }, { status: 400 });
  }

  // SSRF guard: validate URL before passing to extractor
  const urlCheck = validateUrl(url);
  if (!urlCheck.valid) {
    return NextResponse.json({ error: urlCheck.reason ?? 'Invalid URL' }, { status: 400 });
  }

  try {
    const extractor = new CelestialExtractor();
    const streamer = new CelestialStreamer();

    console.log('[TURBO] Extracting metadata for:', url);
    const metadata = await extractor.getMetadata(url);

    // Resilient selection logic: sort by quality and pick the top one
    const videoStreams = metadata.streams
      .filter(s => s.type === 'video')
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    
    const audioStreams = metadata.streams
      .filter(s => s.type === 'audio')
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    const videoStream = videoStreams[0];
    const audioStream = audioStreams[0];

    if (!videoStream || !audioStream) {
      console.error('[TURBO] Available Streams:', metadata.streams.length);
      throw new Error(`Could not find suitable streams. Available: ${metadata.streams.length}`);
    }

    console.log(`[TURBO] Selected: Video (${videoStream.quality}), Audio (${audioStream.quality})`);

    const muxedStream = streamer.mux([
      { url: videoStream.url, type: 'video', contentLength: videoStream.contentLength },
      { url: audioStream.url, type: 'audio', contentLength: audioStream.contentLength }
    ], {
      outputFormat: 'mp4'
    });

    // Convert Node.js Readable to Web ReadableStream for Next.js 14 with backpressure
    const webStream = new ReadableStream({
      start(controller) {
        muxedStream.on('data', (chunk) => {
          controller.enqueue(new Uint8Array(chunk));
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            if (typeof muxedStream.pause === 'function') {
              muxedStream.pause();
            }
          }
        });
        muxedStream.on('end', () => {
          try {
            controller.close();
          } catch {}
        });
        muxedStream.on('error', (err) => {
          try {
            controller.error(err);
          } catch {}
        });
      },
      pull() {
        if (typeof muxedStream.resume === 'function') {
          muxedStream.resume();
        }
      },
      cancel() {
        if (typeof muxedStream.destroy === 'function') {
          muxedStream.destroy();
        }
      }
    });

    if (req.signal) {
      if (req.signal.aborted) {
        if (typeof muxedStream.destroy === 'function') {
          muxedStream.destroy();
        }
      } else {
        req.signal.addEventListener('abort', () => {
          if (typeof muxedStream.destroy === 'function') {
            muxedStream.destroy();
          }
        }, { once: true });
      }
    }

    const isHttp2 = (req as any).httpVersion === '2.0' ||
                    req.headers.get('x-http-version') === '2.0' ||
                    req.headers.get('x-forwarded-proto') === 'h2';
    const rawTitle = (metadata.title || 'video').replace(/[\r\n"/\\]/g, '').trim() || 'video';
    const asciiFallback = rawTitle.replace(/[^\x20-\x7E]/g, '_') || 'video';
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'video/mp4',
      // RFC 6266: sanitized ASCII fallback + percent-encoded UTF-8 filename*
      'Content-Disposition': `attachment; filename="${asciiFallback}.mp4"; filename*=UTF-8''${encodeURIComponent(rawTitle)}.mp4`,
      'Cache-Control': 'no-cache',
    };
    if (!isHttp2) {
      responseHeaders['Transfer-Encoding'] = 'chunked';
    }

    return new Response(webStream, {
      headers: responseHeaders,
    });

  } catch (error: unknown) {
    const { error: msg, status } = sanitizeError(error, 'GET /api/experimental/turbo-download');
    return NextResponse.json({ error: msg }, { status });
  }
}
