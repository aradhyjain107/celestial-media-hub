import { expect, describe, test, vi, beforeEach } from 'vitest';
import { POST, GET } from '../../src/app/api/spotify-convert/route';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import * as tempExt from '../../src/lib/system/temp';
import * as ytdlpExt from '../../src/lib/media/ytdlp';

const { mockExecSync, mockExecFileSync } = vi.hoisted(() => ({ mockExecSync: vi.fn(), mockExecFileSync: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, execSync: mockExecSync, execFileSync: mockExecFileSync, default: { ...actual.default, execSync: mockExecSync, execFileSync: mockExecFileSync } };
});

vi.mock('../../src/lib/system/temp', () => ({
  cleanupJobDir: vi.fn(),
  createJobDir: vi.fn().mockImplementation((id: string) => `/mock/spot/${id.includes('dummy') ? 'dummy' : ''}`.replace(/\/$/, ''))
}));
vi.mock('../../src/lib/media/ytdlp', () => ({ executeYtdlp: vi.fn() }));

describe('/api/spotify-convert POST', () => {
  beforeEach(() => { 
    vi.clearAllMocks(); 
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mockSpot'));
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['Song.mp3'] as any);
    
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: async () => `<script id="resource" type="application/json">${encodeURIComponent(JSON.stringify({
        data: { entity: { trackList: [{ subtitle: 'Artist', title: 'Song' }] } }
      }))}</script>`
    }));
  });


  test('scrapes embed and delegates search iterations to yt-dlp yielding zipped artifacts', async () => {
    const req = {
      json: async () => ({ playlistUrl: 'https://open.spotify.com/track/123', outputFormat: 'mp3', quality: '320' }),
      headers: new Headers({ authorization: 'Bearer user_test' }),
    } as any as NextRequest;

    const mockStream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
        c.enqueue(new TextEncoder().encode('data: {"status":"done"}\n\n'));
        c.close();
      }
    });

    vi.mocked(ytdlpExt.executeYtdlp).mockReturnValue(mockStream);

    const res = await POST(req);
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      text += decoder.decode(value);
    }

    expect(global.fetch).toHaveBeenCalledWith('https://open.spotify.com/embed/track/123', expect.any(Object));
    expect(ytdlpExt.executeYtdlp).toHaveBeenCalledWith(
        '/mock/spot', 
        'ytsearch1:Artist - Song', 
        ['-P', '/mock/spot', '-o', '%(title)s.%(ext)s', '-x', '--audio-format', 'mp3', '--audio-quality', '320K']
    );
    
    expect(text).toContain('"progress":100');
    expect(text).toMatch(/"downloadUrl":"\/api\/download\?jobId=[a-zA-Z0-9\-]+&file=output\.zip"/);
    
    vi.unstubAllGlobals();
  });

  test('extracts single track metadata from __NEXT_DATA__ embed payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: async () => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: {
          pageProps: {
            state: {
              data: {
                entity: {
                  type: 'track',
                  id: '4cOdK2wGLETKBW3PvgPWqT',
                  name: 'Never Gonna Give You Up',
                  title: 'Never Gonna Give You Up',
                  artists: [{ name: 'Rick Astley' }],
                },
              },
            },
          },
        },
      })}</script>`,
    }));

    const req = {
      json: async () => ({ action: 'extract', url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT' }),
      headers: new Headers({ authorization: 'Bearer user_test' }),
    } as any as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.playlist.name).toBe('Never Gonna Give You Up');
    expect(json.playlist.tracks).toEqual([
      { id: '4cOdK2wGLETKBW3PvgPWqT', name: 'Rick Astley - Never Gonna Give You Up' },
    ]);

    vi.unstubAllGlobals();
  });

  test('queues track titles from body.tracks and emits SSE heartbeat + search query', async () => {
    const req = {
      json: async () => ({
        trackIds: ['t-rick'],
        tracks: [{ id: 't-rick', name: 'Rick Astley - Never Gonna Give You Up' }],
        format: 'mp3',
        quality: '320',
      }),
      headers: new Headers({ authorization: 'Bearer user_test' }),
    } as any as NextRequest;

    const initRes = await POST(req);
    expect(initRes.status).toBe(200);
    const { jobId } = await initRes.json();

    vi.mocked(ytdlpExt.executeYtdlp).mockReturnValue(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
        c.close();
      }
    }));

    const sseReq = new NextRequest(`http://localhost:3000/api/spotify-convert?jobId=${jobId}`, {
      headers: { authorization: 'Bearer user_test' },
    });
    const sseRes = await GET(sseReq);
    const reader = sseRes.body?.getReader();
    const decoder = new TextDecoder();
    let sseText = '';
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      sseText += decoder.decode(value);
    }

    expect(sseText).toContain(': connected');
    expect(ytdlpExt.executeYtdlp).toHaveBeenCalledWith(
      expect.any(String),
      'ytsearch1:Rick Astley - Never Gonna Give You Up',
      expect.any(Array),
    );

    vi.unstubAllGlobals();
  });
});
