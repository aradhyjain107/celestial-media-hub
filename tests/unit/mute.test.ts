import { expect, describe, test, vi, beforeEach } from 'vitest';
import { POST } from '../../app/api/mute/route';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import * as tempExt from '../../lib/temp';
import * as ffmpegExt from '../../lib/ffmpeg';

const { mockExecSync } = vi.hoisted(() => ({ mockExecSync: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, execSync: mockExecSync, default: { ...actual.default, execSync: mockExecSync } };
});

vi.mock('../../lib/temp', () => ({
  writeInputFile: vi.fn(),
  cleanupJobDir: vi.fn(),
  createJobDir: vi.fn().mockReturnValue('/mock/master')
}));

vi.mock('../../lib/ffmpeg', () => ({
  executeFfmpeg: vi.fn()
}));

describe('/api/mute POST', () => {
  beforeEach(() => { 
    vi.clearAllMocks(); 
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mockzip'));
  });

  test('returns 400 when missing files', async () => {
    const req = { formData: async () => new FormData() } as any as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test('processes files sequentially and yields SSE zip payload', async () => {
    const formData = new FormData();
    formData.append('mode', 'remove');
    formData.append('files', new File(['mock'], 'test1.mp4', { type: 'video/mp4' }));
    
    const req = { formData: async () => formData } as any as NextRequest;

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
    expect(text).toContain('"zipBase64":"bW9ja3ppcA=="');
    expect(tempExt.cleanupJobDir).toHaveBeenCalled();
    expect(mockExecSync).toHaveBeenCalledWith('zip -j output.zip muted_*', { cwd: '/mock/master' });
  });
});
