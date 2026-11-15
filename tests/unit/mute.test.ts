import { expect, describe, test, vi, beforeEach } from 'vitest';
import { POST } from '../../src/app/api/mute/route';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import * as tempExt from '../../src/lib/temp';
import * as ffmpegExt from '../../src/lib/ffmpeg';

const { mockExecSync, mockExecFileSync } = vi.hoisted(() => ({ mockExecSync: vi.fn(), mockExecFileSync: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, execSync: mockExecSync, execFileSync: mockExecFileSync, default: { ...actual.default, execSync: mockExecSync, execFileSync: mockExecFileSync } };
});

vi.mock('../../src/lib/temp', () => ({
  writeInputFile: vi.fn(),
  cleanupJobDir: vi.fn(),
  createJobDir: vi.fn().mockReturnValue('/mock/master')
}));

vi.mock('../../src/lib/ffmpeg', () => ({
  executeFfmpeg: vi.fn(),
  probeMediaStreams: vi.fn().mockResolvedValue({ hasVideo: true, hasAudio: true, duration: 10 })
}));

describe('/api/mute POST', () => {
  beforeEach(() => { 
    vi.clearAllMocks(); 
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mockzip'));
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['muted_test1.mp4'] as any);
  });

  test('returns 400 when missing files', async () => {
    const req = {
      formData: async () => new FormData(),
      headers: new Headers({ authorization: 'Bearer user_test' }),
    } as any as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test('processes files sequentially and yields SSE zip payload', async () => {
    const formData = new FormData();
    formData.append('mode', 'remove');
    formData.append('files', new File(['mock'], 'test1.mp4', { type: 'video/mp4' }));
    
    const req = {
      formData: async () => formData,
      headers: new Headers({ authorization: 'Bearer user_test' }),
    } as any as NextRequest;

    vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/master/test1.mp4');
    
    const mockStream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
        c.enqueue(new TextEncoder().encode('data: {"status":"done"}\n\n'));
        c.close();
      }
    });

    vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

    const res = await POST(req);
    expect(res.status).toBe(200);
    
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      text += decoder.decode(value);
    }

    expect(text).toContain('"progress":100');
    expect(text).toMatch(/"downloadUrl":"\/api\/download\?jobId=[a-zA-Z0-9\-]+&file=output\.zip"/);
    expect(mockExecFileSync).toHaveBeenCalledWith('zip', ['-j', 'output.zip', '--', 'muted_test1.mp4'], { cwd: '/mock/master' });
  });
});

