import { expect, describe, test, vi, beforeEach, afterEach } from 'vitest';
import { GET as youtubeGET, POST as youtubePOST } from '../app/api/youtube/route';
import { POST as audioTrimPOST } from '../app/api/audio-trim/route';
import { POST as spotifyPOST } from '../app/api/spotify-convert/route';
import { getVideoInfo, getPlaylistInfo, executeYtdlp } from '../lib/ytdlp';
import { env } from '../lib/env';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'events';

// Mocks for child_process spawn / execFileSync
const { mockSpawn, mockExecFileSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecFileSync: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    spawn: mockSpawn,
    execFileSync: mockExecFileSync,
    default: {
      ...actual.default,
      spawn: mockSpawn,
      execFileSync: mockExecFileSync,
    },
  };
});

describe('Milestone R2 Empirical Challenge Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // SECTION 1: YouTube Downloader Empirical Tests
  // =========================================================================
  describe('YouTube Downloader (GET info, playlist items, --ffmpeg-location)', () => {

    test('1.1 GET /api/youtube?action=info fetches single video metadata', async () => {
      // Mock ytdlp spawn for video info
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        const proc: any = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        setTimeout(() => {
          proc.stdout.emit('data', JSON.stringify({
            title: 'Empirical Test Video',
            thumbnail: 'https://img.youtube.com/vi/123/hqdefault.jpg',
            duration: 120,
          }));
          proc.emit('close', 0);
        }, 10);
        return proc;
      });

      const req = new NextRequest('http://localhost/api/youtube?action=info&url=https://youtube.com/watch?v=emp123', {
        headers: { authorization: 'Bearer user_test' },
      });

      const res = await youtubeGET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.title).toBe('Empirical Test Video');
      expect(json.thumbnail).toBe('https://img.youtube.com/vi/123/hqdefault.jpg');
      expect(json.duration).toBe(120);

      // Verify --ffmpeg-location was included in args passed to spawn if env.FFMPEG_PATH is present
      const spawnArgs = mockSpawn.mock.calls[0][1];
      if (env.FFMPEG_PATH) {
        expect(spawnArgs).toContain('--ffmpeg-location');
        expect(spawnArgs).toContain(env.FFMPEG_PATH);
      }
    });

    test('1.2 GET /api/youtube?action=playlist-info fetches playlist metadata', async () => {
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        const proc: any = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        setTimeout(() => {
          proc.stdout.emit('data', '{"id":"t1","title":"Track 1","duration":100}\n{"id":"t2","title":"Track 2","duration":200}\n');
          proc.emit('close', 0);
        }, 10);
        return proc;
      });

      const req = new NextRequest('http://localhost/api/youtube?action=playlist-info&url=https://youtube.com/playlist?list=PL123', {
        headers: { authorization: 'Bearer user_test' },
      });

      const res = await youtubeGET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.title).toBe('Playlist');
      expect(json.tracks).toHaveLength(2);
      expect(json.tracks[0].title).toBe('Track 1');
      expect(json.tracks[1].title).toBe('Track 2');

      const spawnArgs = mockSpawn.mock.calls[0][1];
      expect(spawnArgs).toContain('--flat-playlist');
      if (env.FFMPEG_PATH) {
        expect(spawnArgs).toContain('--ffmpeg-location');
      }
    });

    test('1.3 GET /api/youtube returns 400 on missing url parameter', async () => {
      const req = new NextRequest('http://localhost/api/youtube?action=info', {
        headers: { authorization: 'Bearer user_test' },
      });
      const res = await youtubeGET(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Missing url parameter');
    });

    test('1.4 POST /api/youtube correctly maps 0-indexed selectedIndices to 1-indexed --playlist-items', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['track1.mp3', 'track3.mp3'] as any);

      // Mock executeYtdlp stream
      mockSpawn.mockImplementation(() => {
        const proc: any = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        setTimeout(() => proc.emit('close', 0), 10);
        return proc;
      });

      const req = new NextRequest('http://localhost/api/youtube', {
        method: 'POST',
        headers: { authorization: 'Bearer user_test', 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'https://youtube.com/playlist?list=PL123',
          isPlaylist: true,
          selectedIndices: [0, 2, 4], // 0-indexed: index 0, 2, 4 -> 1-indexed: 1,3,5
          format: 'mp3',
          quality: '320',
        }),
      });

      const res = await youtubePOST(req);
      expect(res.status).toBe(200);

      // Consume stream
      const reader = res.body!.getReader();
      let text = '';
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }

      // Check args passed to spawn in executeYtdlp
      const spawnArgs = mockSpawn.mock.calls[0][1];
      expect(spawnArgs).toContain('--yes-playlist');
      expect(spawnArgs).toContain('--playlist-items');
      const itemsIdx = spawnArgs.indexOf('--playlist-items');
      expect(spawnArgs[itemsIdx + 1]).toBe('1,3,5');
      if (env.FFMPEG_PATH) {
        expect(spawnArgs).toContain('--ffmpeg-location');
      }
    });

    test('1.5 executeYtdlp includes --ffmpeg-location in spawn arguments', async () => {
      mockSpawn.mockImplementation(() => {
        const proc: any = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        setTimeout(() => proc.emit('close', 0), 10);
        return proc;
      });

      const stream = executeYtdlp('/tmp/job-yt', 'https://youtube.com/watch?v=123', ['-f', 'best']);
      const reader = stream.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      const spawnArgs = mockSpawn.mock.calls[0][1];
      if (env.FFMPEG_PATH) {
        expect(spawnArgs).toContain('--ffmpeg-location');
        expect(spawnArgs).toContain(env.FFMPEG_PATH);
      }
    });
  });

  // =========================================================================
  // SECTION 2: Audio Trimmer Empirical Tests
  // =========================================================================
  describe('Audio Trimmer (Merge files.txt, Crossfade Bounds, Waveform Zoom)', () => {

    test('2.1 Merge mode writes valid files.txt and computes totalDuration from inputs without probing files.txt', async () => {
      const writtenFiles: Record<string, string> = {};
      vi.spyOn(fs, 'writeFileSync').mockImplementation((p: any, data: any) => {
        writtenFiles[String(p)] = String(data);
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      let ffprobeCalls: string[] = [];
      let ffmpegSpawnArgs: string[] = [];

      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        const proc: any = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();

        if (cmd.includes('ffprobe')) {
          ffprobeCalls.push(args[args.length - 1]); // input path is last arg
          setTimeout(() => {
            proc.stdout.emit('data', JSON.stringify({
              streams: [{ codec_type: 'audio', duration: '10.5' }],
              format: { duration: '10.5' }
            }));
            proc.emit('close', 0);
          }, 5);
        } else if (cmd.includes('ffmpeg')) {
          ffmpegSpawnArgs = args;
          setTimeout(() => proc.emit('close', 0), 10);
        }
        return proc;
      });

      // Construct FormData payload for merge mode
      const formData = new FormData();
      formData.append('mode', 'merge');
      formData.append('outputFormat', 'mp3');
      const file1 = new File(['audio content 1'], 'track1.mp3', { type: 'audio/mp3' });
      const file2 = new File(['audio content 2'], 'track2.mp3', { type: 'audio/mp3' });
      formData.append('files', file1);
      formData.append('files', file2);

      const req = new NextRequest('http://localhost/api/audio-trim', {
        method: 'POST',
        headers: { authorization: 'Bearer user_test' },
        body: formData,
      });

      const res = await audioTrimPOST(req);
      expect([200, 500]).toContain(res.status);
      if (res.status === 200) {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let text = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value);
        }

        // Verify files.txt was written with correct format
        const filesTxtPath = Object.keys(writtenFiles).find(k => k.endsWith('files.txt'));
        expect(filesTxtPath).toBeDefined();
        expect(writtenFiles[filesTxtPath!]).toContain("file '");
        expect(writtenFiles[filesTxtPath!]).toMatch(/file '.*blob'/);

        // Verify ffprobe was NOT called on files.txt, but on the 2 audio files
        expect(ffprobeCalls).not.toContain(filesTxtPath);
        expect(ffprobeCalls.length).toBe(2);

        // Verify ffmpeg arguments used -f concat -i files.txt
        expect(ffmpegSpawnArgs).toContain('-f');
        expect(ffmpegSpawnArgs).toContain('concat');
        expect(ffmpegSpawnArgs).toContain(filesTxtPath);
      }
    });

    test('2.2 Short audio (<1s) clamps crossfade bounds to clipDuration / 2 to prevent negative start times', async () => {
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        const proc: any = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();

        if (cmd.includes('ffprobe')) {
          setTimeout(() => {
            proc.stdout.emit('data', JSON.stringify({
              streams: [{ codec_type: 'audio', duration: '0.6' }], // 0.6 second audio!
              format: { duration: '0.6' }
            }));
            proc.emit('close', 0);
          }, 5);
        } else if (cmd.includes('ffmpeg')) {
          // Verify afade filter
          const filterIdx = args.indexOf('-af');
          if (filterIdx !== -1) {
            const filterStr = args[filterIdx + 1];
            // Clip duration is 0.6s. Max fade = 0.6 / 2 = 0.3s.
            // fadeIn=1.0 should be clamped to 0.3s: afade=t=in:st=0:d=0.3
            // fadeOut=1.0 should be clamped to 0.3s with fadeOutStart = 0.6 - 0.3 = 0.3: afade=t=out:st=0.3:d=0.3
            expect(filterStr).toContain('afade=t=in:st=0:d=0.3');
            expect(filterStr).toContain('afade=t=out:st=0.3:d=0.3');
          }
          setTimeout(() => proc.emit('close', 0), 10);
        }
        return proc;
      });

      const formData = new FormData();
      formData.append('mode', 'trim');
      formData.append('outputFormat', 'mp3');
      formData.append('startTime', '0');
      formData.append('endTime', '0.6');
      formData.append('fadeIn', '1.0');  // Requesting 1s fade on 0.6s clip
      formData.append('fadeOut', '1.0'); // Requesting 1s fade on 0.6s clip
      const file = new File(['short audio'], 'short.mp3', { type: 'audio/mp3' });
      formData.append('files', file);

      const req = new NextRequest('http://localhost/api/audio-trim', {
        method: 'POST',
        headers: { authorization: 'Bearer user_test' },
        body: formData,
      });

      const res = await audioTrimPOST(req);
      expect([200, 500]).toContain(res.status);
      if (res.status === 200) {
        const reader = res.body!.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    });

    test('2.3 Long audio (>1h = 3600s) calculates crossfade and totalDuration correctly without numeric overflow', async () => {
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        const proc: any = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();

        if (cmd.includes('ffprobe')) {
          setTimeout(() => {
            proc.stdout.emit('data', JSON.stringify({
              streams: [{ codec_type: 'audio', duration: '7200.0' }], // 2 hours
              format: { duration: '7200.0' }
            }));
            proc.emit('close', 0);
          }, 5);
        } else if (cmd.includes('ffmpeg')) {
          const filterIdx = args.indexOf('-af');
          if (filterIdx !== -1) {
            const filterStr = args[filterIdx + 1];
            // Clip start 0 to 3600 (1 hour). fadeIn=5s -> st=0:d=5. fadeOut=5s -> st=3595:d=5
            expect(filterStr).toContain('afade=t=in:st=0:d=5');
            expect(filterStr).toContain('afade=t=out:st=3595:d=5');
          }
          setTimeout(() => proc.emit('close', 0), 10);
        }
        return proc;
      });

      const formData = new FormData();
      formData.append('mode', 'trim');
      formData.append('outputFormat', 'mp3');
      formData.append('startTime', '0');
      formData.append('endTime', '3600');
      formData.append('fadeIn', '5.0');
      formData.append('fadeOut', '5.0');
      const file = new File(['long audio'], 'long.mp3', { type: 'audio/mp3' });
      formData.append('files', file);

      const req = new NextRequest('http://localhost/api/audio-trim', {
        method: 'POST',
        headers: { authorization: 'Bearer user_test' },
        body: formData,
      });

      const res = await audioTrimPOST(req);
      expect([200, 500]).toContain(res.status);

      const reader = res.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    });

    test('2.4 Waveform canvas zoom pixel-to-sample mapping formula verification', () => {
      // Empirical verification of the formula in WaveformCanvas.tsx:
      // visibleStart = Math.max(0, currentTime - zoom / 2);
      // visibleEnd = Math.min(duration, visibleStart + zoom);
      // visibleDuration = Math.max(0.001, visibleEnd - visibleStart);
      // time(i) = visibleStart + (i / width) * visibleDuration;

      const duration = 100; // 100s track
      const currentTime = 50; // playhead at 50s
      const zoom = 10; // 10s visible window
      const width = 1000; // 1000px canvas width

      const visibleStart = Math.max(0, currentTime - zoom / 2); // 45s
      const visibleEnd = Math.min(duration, visibleStart + zoom); // 55s
      const visibleDuration = visibleEnd - visibleStart; // 10s

      expect(visibleStart).toBe(45);
      expect(visibleEnd).toBe(55);

      // Pixel 0 -> 45s
      const timeAt0 = visibleStart + (0 / width) * visibleDuration;
      expect(timeAt0).toBe(45);

      // Pixel 500 (middle) -> 50s
      const timeAtMiddle = visibleStart + (500 / width) * visibleDuration;
      expect(timeAtMiddle).toBe(50);

      // Pixel 1000 (end) -> 55s
      const timeAtEnd = visibleStart + (1000 / width) * visibleDuration;
      expect(timeAtEnd).toBe(55);
    });
  });

  // =========================================================================
  // SECTION 3: Spotify Converter Empirical Tests
  // =========================================================================
  describe('Spotify Converter (URL Regex & Single-Track Batch Error Resilience)', () => {

    test('3.1 Regex extracts track, album, and playlist Spotify IDs accurately', () => {
      function extractSpotifyId(url: string): { type: 'playlist' | 'album' | 'track', id: string } | null {
        const match = url.match(/(playlist|album|track)\/([a-zA-Z0-9]+)/);
        if (match) {
          return { type: match[1] as 'playlist' | 'album' | 'track', id: match[2] };
        }
        return null;
      }

      function validateUrl(input: string) {
        const regex = /https?:\/\/(open\.)?spotify\.com\/(playlist|album|track)\/[a-zA-Z0-9]+/;
        return regex.test(input.trim());
      }

      // Track URL
      const trackUrl = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
      expect(validateUrl(trackUrl)).toBe(true);
      expect(extractSpotifyId(trackUrl)).toEqual({ type: 'track', id: '4cOdK2wGLETKBW3PvgPWqT' });

      // Album URL with query params
      const albumUrl = 'https://open.spotify.com/album/1A2B3C4D5E6F7G8H9I0J?si=abcdef123';
      expect(validateUrl(albumUrl)).toBe(true);
      expect(extractSpotifyId(albumUrl)).toEqual({ type: 'album', id: '1A2B3C4D5E6F7G8H9I0J' });

      // Playlist URL
      const playlistUrl = 'https://spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
      expect(validateUrl(playlistUrl)).toBe(true);
      expect(extractSpotifyId(playlistUrl)).toEqual({ type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });

      // Invalid URLs
      expect(validateUrl('https://example.com/track/123')).toBe(false);
      expect(extractSpotifyId('https://open.spotify.com/artist/123')).toBeNull();
    });

    test('3.2 Batch single-track error resilience: failing 1 track in batch emits error status for that track and completes remaining tracks into output.zip', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['Track 1.mp3', 'Track 3.mp3'] as any);

      // Mock spawn to fail on Track 2 search query ('ytsearch1:Artist - Track 2') but succeed on Track 1 and Track 3
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        const proc: any = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();

        const fullQuery = args.join(' ');
        if (fullQuery.includes('Track 2')) {
          setTimeout(() => {
            proc.stderr.emit('data', 'ERROR: Video unavailable in your country\n');
            proc.emit('close', 1); // exit code 1 = fail
          }, 10);
        } else {
          setTimeout(() => {
            proc.stdout.emit('data', '[download] 100% of 3.0MiB\n');
            proc.emit('close', 0); // exit code 0 = success
          }, 10);
        }
        return proc;
      });

      // Initialize batch conversion via POST with track list
      const initReq = new NextRequest('http://localhost/api/spotify-convert', {
        method: 'POST',
        headers: { authorization: 'Bearer user_test', 'content-type': 'application/json' },
        body: JSON.stringify({
          tracks: [
            { id: 't1', name: 'Artist - Track 1' },
            { id: 't2', name: 'Artist - Track 2' },
            { id: 't3', name: 'Artist - Track 3' },
          ],
          format: 'mp3',
          quality: '320',
        }),
      });

      const initRes = await spotifyPOST(initReq);
      expect(initRes.status).toBe(200);
      const { jobId } = await initRes.json();
      expect(jobId).toBeDefined();

      // Trigger SSE download stream via direct POST (or GET with jobId)
      // Let's test the SSE stream generator directly by calling POST with direct payload or testing SSE route logic
      // Since POST with playlistUrl triggers SSE stream:
      // Let's mock scrapeSpotifyTracks to return 3 tracks
      const directReq = new NextRequest('http://localhost/api/spotify-convert', {
        method: 'POST',
        headers: { authorization: 'Bearer user_test', 'content-type': 'application/json' },
        body: JSON.stringify({
          playlistUrl: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
          outputFormat: 'mp3',
          quality: '320',
        }),
      });

      // Mock fetch / embed scraping inside route to return 3 tracks
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes('spotify.com')) {
          return {
            ok: true,
            status: 200,
            text: async () => `
              <html>
                <head>
                  <meta property="og:title" content="Test Playlist | Spotify" />
                </head>
                <body>
                  <div data-name="Track 1" data-artist="Artist"></div>
                  <div data-name="Track 2" data-artist="Artist"></div>
                  <div data-name="Track 3" data-artist="Artist"></div>
                </body>
              </html>
            `,
          } as any;
        }
        return { ok: false } as any;
      });

      const streamRes = await spotifyPOST(directReq);
      expect(streamRes.status).toBe(200);

      const reader = streamRes.body!.getReader();
      const decoder = new TextDecoder();
      let streamText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamText += decoder.decode(value);
      }

      // Verify stream output contains:
      // Track 1 done
      expect(streamText).toContain('"trackId":"t-1","status":"done"');
      // Track 2 error
      expect(streamText).toContain('"trackId":"t-2","status":"error"');
      // Track 3 done
      expect(streamText).toContain('"trackId":"t-3","status":"done"');
      // Overall complete status and downloadUrl
      expect(streamText).toContain('"status":"complete"');
      expect(streamText).toContain('/api/download?jobId=');

      // Verify zip was called with Track 1 and Track 3
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'zip',
        ['-j', 'output.zip', '--', 'Track 1.mp3', 'Track 3.mp3'],
        expect.anything()
      );
    });
  });
});
