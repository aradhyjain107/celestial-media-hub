import { NextRequest, NextResponse } from 'next/server';
import { SpotifyInputSchema } from '../../../schemas/spotify';
import { executeYtdlp } from '../../../lib/media/ytdlp';
import { createJobDir, cleanupJobDir } from '../../../lib/system/temp';
import { randomUUID } from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyAuth, registerJobOwner, verifyJobOwnership } from '../../../lib/security/auth';
import { sanitizeError, sanitizeSseError } from '../../../lib/security/errors';
import { createZipArchive } from '../../../lib/utils/archive';

export const dynamic = 'force-dynamic';

interface JobData {
  jobId: string;
  tracks: { id: string; name: string }[];
  outputFormat: string;
  quality: string;
  createdAt: number;
}

const activeJobs = new Map<string, JobData>();

function cleanExpiredJobs() {
  const now = Date.now();
  const TEN_MINUTES_MS = 10 * 60 * 1000;
  activeJobs.forEach((job, jobId) => {
    if (now - job.createdAt > TEN_MINUTES_MS) {
      activeJobs.delete(jobId);
    }
  });
}


function extractSpotifyId(url: string): { type: 'playlist' | 'album' | 'track', id: string } | null {
  const match = url.match(/(playlist|album|track)\/([a-zA-Z0-9]+)/);
  if (match) {
    return { type: match[1] as 'playlist' | 'album' | 'track', id: match[2] };
  }
  return null;
}

async function getSpotifyAccessToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store'
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token;
}

async function fetchSpotifyApiTracks(url: string): Promise<{ name: string; tracks: { id: string; name: string }[] } | null> {
  const extracted = extractSpotifyId(url);
  if (!extracted) return null;
  const { type, id } = extracted;

  const token = await getSpotifyAccessToken();
  if (!token) return null;

  const trackList: { id: string; name: string }[] = [];
  let name = type === 'playlist' ? 'Spotify Playlist' : (type === 'album' ? 'Spotify Album' : 'Spotify Track');

  if (type === 'playlist') {
    const plRes = await fetch(`https://api.spotify.com/v1/playlists/${id}?fields=name`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (plRes.ok) {
      const plData = await plRes.json();
      if (plData.name) name = plData.name;
    }

    let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`;
    let trackIdx = 1;
    while (nextUrl) {
      const currentUrl: string = nextUrl;
      const tracksRes: Response = await fetch(currentUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!tracksRes.ok) break;
      const tracksData: any = await tracksRes.json();
      for (const item of tracksData.items || []) {
        const track = item.track;
        if (!track || !track.name) continue;
        const artist = track.artists?.[0]?.name || '';
        const title = track.name;
        const trackName = artist ? `${artist} - ${title}` : title;
        trackList.push({ id: track.id || `t-${trackIdx++}`, name: trackName });
      }
      nextUrl = tracksData.next || null;
    }
  } else if (type === 'album') {
    const alRes = await fetch(`https://api.spotify.com/v1/albums/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (alRes.ok) {
      const alData: any = await alRes.json();
      if (alData.name) name = alData.name;
      const artist = alData.artists?.[0]?.name || '';
      let nextUrl: string | null = `https://api.spotify.com/v1/albums/${id}/tracks?limit=50`;
      let trackIdx = 1;
      while (nextUrl) {
        const currentUrl: string = nextUrl;
        const tracksRes: Response = await fetch(currentUrl, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!tracksRes.ok) break;
        const tracksData: any = await tracksRes.json();
        for (const track of tracksData.items || []) {
          if (!track || !track.name) continue;
          const trackArtist = track.artists?.[0]?.name || artist;
          const title = track.name;
          const trackName = trackArtist ? `${trackArtist} - ${title}` : title;
          trackList.push({ id: track.id || `t-${trackIdx++}`, name: trackName });
        }
        nextUrl = tracksData.next || null;
      }
    }
  } else if (type === 'track') {
    const trRes = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (trRes.ok) {
      const trData: any = await trRes.json();
      if (trData.name) {
        const artist = trData.artists?.[0]?.name || '';
        const trackName = artist ? `${artist} - ${trData.name}` : trData.name;
        trackList.push({ id: trData.id || id, name: trackName });
        name = trackName;
      }
    }
  }

  if (trackList.length > 0) {
    return { name, tracks: trackList };
  }
  return null;
}

async function scrapeSpotifyTracks(url: string): Promise<{ name: string; tracks: { id: string; name: string }[] }> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('Invalid Spotify URL');
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    (parsed.hostname !== 'open.spotify.com' && parsed.hostname !== 'spotify.com')
  ) {
    throw new Error('Must be a valid Spotify URL');
  }

  let cleanUrl = url.trim();
  if (!cleanUrl.includes('/embed/')) {
    cleanUrl = cleanUrl.replace('spotify.com/', 'spotify.com/embed/');
  }

  const res = await fetch(cleanUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (res.status && !res.ok) {
    throw new Error(`Failed to fetch Spotify page (${res.status})`);
  }

  const html = await res.text();
  const trackList: { id: string; name: string }[] = [];
  let playlistName = 'Spotify Playlist';

  // Strategy 1: <script id="resource" type="application/json">
  const resourceMatch = html.match(/<script id="resource" type="application\/json">\s*(.*?)\s*<\/script>/);
  if (resourceMatch) {
    try {
      const decoded = decodeURIComponent(resourceMatch[1]);
      const data = JSON.parse(decoded);
      const entity = data?.data?.entity;
      if (entity?.name || entity?.title) {
        playlistName = entity.name || entity.title;
      }
      if (Array.isArray(entity?.trackList) && entity.trackList.length > 0) {
        entity.trackList.forEach((t: any, idx: number) => {
          const name = t.subtitle ? `${t.subtitle} - ${t.title}` : t.title;
          trackList.push({ id: t.id || `t-${idx + 1}`, name });
        });
        return { name: playlistName, tracks: trackList };
      } else if (entity?.title) {
        const name = entity.subtitle ? `${entity.subtitle} - ${entity.title}` : entity.title;
        trackList.push({ id: entity.id || 't-1', name });
        return { name: playlistName, tracks: trackList };
      }
    } catch (e) {}
  }

  // Strategy 2: <script id="__NEXT_DATA__" type="application/json">
  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1]);
      const entity = data?.props?.pageProps?.state?.data?.entity;
      if (entity?.name || entity?.title) {
        playlistName = entity.name || entity.title;
      }
      const items = entity?.tracks?.items || entity?.trackList || [];
      items.forEach((item: any, idx: number) => {
        const track = item.track || item;
        const artist = track.artists?.[0]?.name || track.subtitle || '';
        const title = track.name || track.title || '';
        if (title) {
          const name = artist ? `${artist} - ${title}` : title;
          trackList.push({ id: track.id || `t-${idx + 1}`, name });
        }
      });
      if (trackList.length > 0) {
        return { name: playlistName, tracks: trackList };
      }
    } catch (e) {}
  }

  // Strategy 3: Regex fallbacks
  const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
  if (ogTitleMatch) {
    playlistName = ogTitleMatch[1].replace(' | Spotify', '').replace(' - Spotify', '').trim();
  }

  const trackMatches = Array.from(html.matchAll(/data-name="([^"]+)"\s+data-artist="([^"]+)"/g));
  let idx = 1;
  for (const match of trackMatches) {
    trackList.push({ id: `t-${idx++}`, name: `${match[2]} - ${match[1]}` });
  }

  if (trackList.length > 0) {
    return { name: playlistName, tracks: trackList };
  }

  throw new Error('Failed to parse Spotify embed data. Extractors failed.');
}

function createSpotifySSEStream(
  masterJobId: string,
  masterDir: string,
  tracks: { id: string; name: string }[],
  outputFormat: string,
  quality: string,
  signal?: AbortSignal
) {
  let activeReader: ReadableStreamDefaultReader | null = null;
  let activeStream: ReadableStream | null = null;
  let cleanedUp = false;
  let isCancelled = false;

  const handleAbort = async (reason?: any) => {
    if (cleanedUp) return;
    cleanedUp = true;
    isCancelled = true;
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

  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for (let i = 0; i < tracks.length; i++) {
          if (isCancelled || signal?.aborted || cleanedUp) break;
          // eslint-disable-next-line security/detect-object-injection
          const track = tracks[i];
          const trackQuery = track.name;
          const trackId = track.id;

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ trackId, status: 'processing' })}\n\n`));

          try {
            const args = [
              '-P', masterDir,
              '-o', '%(title)s.%(ext)s',
              '-x', '--audio-format', outputFormat, '--audio-quality', `${quality}K`,
            ];

            if (isCancelled || signal?.aborted || cleanedUp) break;
            const ytdlpStream = executeYtdlp(masterDir, `ytsearch1:${trackQuery}`, args);
            activeStream = ytdlpStream;
            if (isCancelled || signal?.aborted || cleanedUp) {
              void ytdlpStream.cancel();
              break;
            }
            const reader = ytdlpStream.getReader();
            activeReader = reader;
            if (isCancelled || signal?.aborted || cleanedUp) {
              void reader.cancel();
              break;
            }
            const decoder = new TextDecoder();

            while (true) {
              if (isCancelled || signal?.aborted || cleanedUp) break;
              const { done, value } = await reader.read();
              if (done) break;
              if (isCancelled || signal?.aborted || cleanedUp) break;

              const text = decoder.decode(value);
              const messages = text.split('\n\n').filter(Boolean);

              for (const msg of messages) {
                if (msg.includes('"status":"done"')) continue;
                if (msg.includes('"error"')) throw new Error(msg);

                const match = msg.match(/"progress":\s*([0-9.]+)/);
                if (match) {
                  const localProg = Math.round(parseFloat(match[1]));
                  const globalProg = Math.round(((i * 100) + localProg) / tracks.length);
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: globalProg, currentTrack: trackQuery, trackId })}\n\n`));
                }
              }
            }

            if (!isCancelled && !signal?.aborted && !cleanedUp) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ trackId, status: 'done' })}\n\n`));
            }
          } catch (trackErr: unknown) {
            if (isCancelled || signal?.aborted || cleanedUp) break;
            console.error(`Error processing Spotify track ${trackId}:`, trackErr);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ trackId, status: 'error', error: String(trackErr) })}\n\n`));
          }
        }

        if (isCancelled || signal?.aborted || cleanedUp) {
          return;
        }

        let files: string[] = [];
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          if (fs.existsSync(masterDir)) {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            files = fs.readdirSync(masterDir).filter(f => f !== 'output.zip');
          }
        } catch {
          files = [];
        }
        if (files.length === 0) {
          throw new Error('No tracks were successfully downloaded');
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
        const finalFilename = zipCreated ? 'spotify_tracks.zip' : files[0];

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          status: 'complete',
          downloadUrl: finalDownloadUrl,
          filename: finalFilename
        })}\n\n`));

      } catch (err: unknown) {
        if (!cleanedUp) {
          controller.enqueue(encoder.encode(sanitizeSseError(err, 'SSE /api/spotify-convert')));
          cleanupJobDir(masterJobId);
          cleanedUp = true;
        }
      } finally {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        try {
          controller.close();
        } catch {}
      }
    },
    async cancel(reason) {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      await handleAbort(reason);
    }
  });
}

export async function POST(req: NextRequest) {
  const session = verifyAuth(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  cleanExpiredJobs();

  const urlObj = new URL(req.url || 'http://localhost/api/spotify-convert');
  const action = urlObj.searchParams.get('action');

  try {
    const body = await req.json().catch(() => ({}));

    // 1. Extraction action
    if (action === 'extract' || body.action === 'extract') {
      const targetUrl = body.url || body.playlistUrl;
      let isValidHost = false;
      if (targetUrl && typeof targetUrl === 'string') {
        try {
          const parsed = new URL(targetUrl);
          if (parsed.hostname === 'open.spotify.com' || parsed.hostname === 'spotify.com') {
            isValidHost = true;
          }
        } catch {}
      }

      if (!isValidHost) {
        return NextResponse.json({ error: 'Invalid Spotify playlist URL' }, { status: 400 });
      }

      const apiData = await fetchSpotifyApiTracks(targetUrl);
      const { name, tracks } = apiData || await scrapeSpotifyTracks(targetUrl);
      return NextResponse.json({
        playlist: {
          name,
          tracks,
        },
      });
    }

    // 2. Conversion initialization (returns jobId)
    if (body.trackIds || body.tracks) {
      const jobId = randomUUID();
      registerJobOwner(jobId, session.userId);
      let tracks: { id: string; name: string }[] = [];
      if (Array.isArray(body.tracks)) {
        tracks = body.tracks.map((t: any, idx: number) => ({
          id: t.id || `t-${idx + 1}`,
          name: t.name || t.title || `Track ${idx + 1}`,
        }));
      } else if (Array.isArray(body.trackIds)) {
        tracks = body.trackIds.map((id: string, idx: number) => ({
          id,
          name: `Track ${idx + 1}`,
        }));
      }

      const settingsValidation = SpotifyInputSchema.pick({ outputFormat: true, quality: true }).safeParse({
        outputFormat: body.format || body.outputFormat || 'mp3',
        quality: body.quality || '320'
      });

      if (!settingsValidation.success) {
        return NextResponse.json({ error: 'Invalid conversion settings' }, { status: 400 });
      }

      const { outputFormat, quality } = settingsValidation.data;

      activeJobs.set(jobId, {
        jobId,
        tracks,
        outputFormat,
        quality,
        createdAt: Date.now(),
      });

      return NextResponse.json({ jobId });
    }

    // 3. Direct POST conversion
    const validation = SpotifyInputSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.format() }, { status: 400 });
    }

    const { playlistUrl, outputFormat, quality } = validation.data;
    const apiData = await fetchSpotifyApiTracks(playlistUrl);
    const scraped = apiData || await scrapeSpotifyTracks(playlistUrl);
    if (scraped.tracks.length === 0) {
      return NextResponse.json({ error: 'No tracks found in standard Spotify embed layer' }, { status: 400 });
    }

    const masterJobId = randomUUID();
    registerJobOwner(masterJobId, session.userId);
    const masterDir = createJobDir(masterJobId);

    const stream = createSpotifySSEStream(masterJobId, masterDir, scraped.tracks, outputFormat, quality, req.signal);
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: unknown) {
    const { error: msg, status } = sanitizeError(error, 'POST /api/spotify-convert');
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function GET(req: NextRequest) {
  const session = verifyAuth(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  cleanExpiredJobs();

  const urlObj = new URL(req.url || 'http://localhost/api/spotify-convert');
  const jobId = urlObj.searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId parameter' }, { status: 400 });
  }

  if (!verifyJobOwnership(jobId, session)) {
    return NextResponse.json(
      { error: 'Forbidden', message: 'You do not have permission to access this Spotify conversion job' },
      { status: 403 }
    );
  }

  const job = activeJobs.get(jobId);
  const masterJobId = jobId;
  const masterDir = createJobDir(masterJobId);

  const tracks = job?.tracks ?? [{ id: 't1', name: 'Track 1' }];
  const outputFormat = job?.outputFormat ?? 'mp3';
  const quality = job?.quality ?? '320';

  if (job) {
    activeJobs.delete(jobId);
  }

  const stream = createSpotifySSEStream(masterJobId, masterDir, tracks, outputFormat, quality, req.signal);

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}

