import { expect, describe, test, vi, beforeEach } from 'vitest';
import { POST } from '../../src/app/api/audio-trim/route';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import * as tempExt from '../../src/lib/system/temp';
import * as ffmpegExt from '../../src/lib/media/ffmpeg';

vi.mock('../../src/lib/system/temp', () => ({
  writeInputFile: vi.fn(),
  cleanupJobDir: vi.fn(),
  createJobDir: vi.fn().mockReturnValue('/mock/trimPath')
}));
vi.mock('../../src/lib/media/ffmpeg', () => ({
  executeFfmpeg: vi.fn(),
  getMediaDuration: vi.fn().mockResolvedValue(10)
}));

describe('/api/audio-trim POST', () => {
  beforeEach(() => { 
    vi.clearAllMocks(); 
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mockAudio'));
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined as any);
  });

  test('validates merge configurations and correctly applies file list mapping for FFMPEG', async () => {
    const formData = new FormData();
    formData.append('mode', 'merge');
    formData.append('outputFormat', 'mp3');
    formData.append('files', new File(['mock'], 'one.mp3', { type: 'audio/mpeg' }));
    formData.append('files', new File(['mock'], 'two.mp3', { type: 'audio/mpeg' }));
    
    const req = {
      formData: async () => formData,
      headers: new Headers({ authorization: 'Bearer user_test' }),
    } as any as NextRequest;

    vi.mocked(tempExt.writeInputFile).mockResolvedValueOnce('/mock/trimPath/one.mp3').mockResolvedValueOnce('/mock/trimPath/two.mp3');
    
    const mockStream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"progress":50}\n\n'));
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

    expect(fs.writeFileSync).toHaveBeenCalledWith('/mock/trimPath/files.txt', "file '/mock/trimPath/one.mp3'\nfile '/mock/trimPath/two.mp3'");
    expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
        '/mock/trimPath/files.txt', 
        ['-f', 'concat', '-safe', '0', '-i', '/mock/trimPath/files.txt', '-c:a', 'libmp3lame', '-y', '/mock/trimPath/output.mp3'],
        20
    );
    expect(text).toMatch(/"downloadUrl":"\/api\/download\?jobId=[a-zA-Z0-9\-]+&file=output\.mp3"/);
  });
});

