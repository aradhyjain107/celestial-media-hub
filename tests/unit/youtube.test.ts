import { expect, describe, test, vi, beforeEach } from 'vitest';
import { POST } from '../../src/app/api/youtube/route';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import * as tempExt from '../../src/lib/temp';
import * as ytdlpExt from '../../src/lib/ytdlp';

const { mockExecSync, mockExecFileSync } = vi.hoisted(() => ({ mockExecSync: vi.fn(), mockExecFileSync: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, execSync: mockExecSync, execFileSync: mockExecFileSync, default: { ...actual.default, execSync: mockExecSync, execFileSync: mockExecFileSync } };
});

vi.mock('../../src/lib/temp', () => ({
  cleanupJobDir: vi.fn(),
  createJobDir: vi.fn().mockImplementation((id: string) => `/mock/yt/${id.includes('dummy') ? 'dummy' : ''}`.replace(/\/$/, ''))
}));

vi.mock('../../src/lib/ytdlp', () => ({
  executeYtdlp: vi.fn()
}));

describe('/api/youtube POST', () => {
  beforeEach(() => { 
    vi.clearAllMocks(); 
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mockYt'));
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['video.mp3'] as any);
  });

  test('validates URL payloads and triggers yt-dlp pipelines resolving via SSE', async () => {
    const req = {
      json: async () => ({
        url: 'https://youtube.com/watch?v=123',
        isPlaylist: false,
        format: 'mp3',
        quality: '320'
      }),
      headers: new Headers({ authorization: 'Bearer user_test' }),
    } as any as NextRequest;

    const mockStream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"progress":55.5}\n\n'));
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

    expect(ytdlpExt.executeYtdlp).toHaveBeenCalledWith(
        '/mock/yt', 
        'https://youtube.com/watch?v=123', 
        ['-P', '/mock/yt', '-o', '%(title)s.%(ext)s', '-x', '--audio-format', 'mp3', '--audio-quality', '320K', '--no-playlist']
    );
    expect(text).toContain('"progress":56');
    expect(text).toMatch(/"downloadUrl":"\/api\/download\?jobId=[a-zA-Z0-9\-]+&file=output\.zip"/);
    expect(mockExecFileSync).toHaveBeenCalledWith('zip', ['-j', 'output.zip', '--', 'video.mp3'], { cwd: '/mock/yt' });
  });

  test('accepts Instagram batch URLs (urls array) and carousel playlist mode', async () => {
    const req = {
      json: async () => ({
        url: 'https://www.instagram.com/reel/C8reel123/',
        urls: [
          'https://www.instagram.com/reel/C8reel123/',
          'https://www.instagram.com/p/C9carousel456/'
        ],
        isPlaylist: true,
        format: 'mp4',
        quality: '1080p'
      }),
      headers: new Headers({ authorization: 'Bearer user_test' }),
    } as any as NextRequest;

    vi.mocked(ytdlpExt.executeYtdlp).mockImplementation(() => new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"progress":50}\n\n'));
        c.enqueue(new TextEncoder().encode('data: {"status":"done"}\n\n'));
        c.close();
      }
    }));

    const res = await POST(req);
    const reader = res.body?.getReader();
    while (true) {
      const { done } = await reader!.read();
      if (done) break;
    }

    expect(ytdlpExt.executeYtdlp).toHaveBeenCalledTimes(2);
    expect(ytdlpExt.executeYtdlp).toHaveBeenNthCalledWith(
      1,
      '/mock/yt',
      'https://www.instagram.com/reel/C8reel123/',
      ['-P', '/mock/yt', '-o', '%(title).120s [%(id)s].%(ext)s', '-f', 'bestvideo[height<=1080]+bestaudio/best', '--merge-output-format', 'mp4', '--yes-playlist', '-i']
    );
    expect(ytdlpExt.executeYtdlp).toHaveBeenNthCalledWith(
      2,
      '/mock/yt',
      'https://www.instagram.com/p/C9carousel456/',
      ['-P', '/mock/yt', '-o', '%(title).120s [%(id)s].%(ext)s', '-f', 'bestvideo[height<=1080]+bestaudio/best', '--merge-output-format', 'mp4', '--yes-playlist', '-i']
    );
  });
});

