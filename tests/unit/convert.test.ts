import { expect, describe, test, vi, beforeEach } from 'vitest';
import { POST } from '../../app/api/convert/route';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import * as tempExt from '../../lib/temp';
import * as ffmpegExt from '../../lib/ffmpeg';

vi.mock('../../lib/temp', () => ({
  writeInputFile: vi.fn(),
  cleanupJobDir: vi.fn(),
  createJobDir: vi.fn().mockReturnValue('/mock/convertPath')
}));

vi.mock('../../lib/ffmpeg', () => ({
  executeFfmpeg: vi.fn()
}));

describe('/api/convert POST', () => {
  beforeEach(() => { 
    vi.clearAllMocks(); 
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mockConvert'));
  });

  test('validates Convert parameters and pipes single output Base64 stream', async () => {
    const formData = new FormData();
    formData.append('preset', 'twitter');
    formData.append('outputFormat', 'mp4');
    formData.append('file', new File(['mock'], 'video.mp4', { type: 'video/mp4' }));
    
    const req = { formData: async () => formData } as any as NextRequest;

    vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/convertPath/video.mp4');
    
    const mockStream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
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
        '/tmp/NON_EXISTENT_DUMMY', 
        '/mock/convertPath/video.mp4', 
        ['-i', '/mock/convertPath/video.mp4', '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', 'faststart', '-y', '/mock/convertPath/converted_video.mp4']
    );
    expect(text).toContain('"fileBase64":"bW9ja0NvbnZlcnQ="');
  });
});
