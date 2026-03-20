import { expect, describe, test, vi, beforeEach } from 'vitest';
import { POST } from '../../app/api/youtube/route';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import * as tempExt from '../../lib/temp';
import * as ytdlpExt from '../../lib/ytdlp';

const { mockExecSync } = vi.hoisted(() => ({ mockExecSync: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, execSync: mockExecSync, default: { ...actual.default, execSync: mockExecSync } };
});

vi.mock('../../lib/temp', () => ({
  cleanupJobDir: vi.fn(),
  createJobDir: vi.fn().mockImplementation((id: string) => `/mock/yt/${id.includes('dummy') ? 'dummy' : ''}`.replace(/\/$/, ''))
}));

vi.mock('../../lib/ytdlp', () => ({
  executeYtdlp: vi.fn()
}));

describe('/api/youtube POST', () => {
  beforeEach(() => { 
    vi.clearAllMocks(); 
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mockYt'));
  });

  test('validates URL payloads and triggers yt-dlp pipelines resolving via SSE', async () => {
    const req = {
      json: async () => ({
        url: 'https://youtube.com/watch?v=123',
        isPlaylist: false,
        format: 'mp3',
        quality: '320'
      })
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
        '/mock/yt/dummy', 
        'https://youtube.com/watch?v=123', 
        ['-P', '/mock/yt', '-o', '%(title)s.%(ext)s', '-x', '--audio-format', 'mp3', '--no-playlist']
    );
    expect(text).toContain('"progress":56');
    expect(text).toContain('"zipBase64":"bW9ja1l0"');
    expect(mockExecSync).toHaveBeenCalledWith('zip -j output.zip *.*', { cwd: '/mock/yt' });
  });
});
