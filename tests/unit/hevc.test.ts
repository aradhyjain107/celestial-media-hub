import { expect, describe, test, vi, beforeEach } from 'vitest';
import { POST } from '../../app/api/hevc/route';
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
  createJobDir: vi.fn().mockReturnValue('/mock/hevcPath')
}));

vi.mock('../../lib/ffmpeg', () => ({
  executeFfmpeg: vi.fn()
}));

describe('/api/hevc POST', () => {
  beforeEach(() => { 
    vi.clearAllMocks(); 
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mockhevc'));
  });

  test('generates accurate HEVC flag sequences safely triggering mock streams', async () => {
    const formData = new FormData();
    formData.append('crf', '28');
    formData.append('preset', 'fast');
    formData.append('hardwareAccel', 'true');
    formData.append('files', new File(['mock'], 'video.mp4', { type: 'video/mp4' }));
    
    const req = { formData: async () => formData } as any as NextRequest;

    vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/hevcPath/video.mp4');
    
    const mockStream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"progress":90}\n\n'));
        c.enqueue(new TextEncoder().encode('data: {"status":"done"}\n\n'));
        c.close();
      }
    });

    vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(mockStream);

    const res = await POST(req);
    
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      text += decoder.decode(value);
    }

    expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
        '/tmp/NON_EXISTENT_DUMMY_DIR', 
        '/mock/hevcPath/video.mp4', 
        ['-i', '/mock/hevcPath/video.mp4', '-c:v', 'hevc_videotoolbox', '-q:v', '70', '-c:a', 'copy', '-y', '/mock/hevcPath/hevc_video.mp4']
    );
    expect(text).toContain('"zipBase64":"bW9ja2hldmM="');
  });
});
