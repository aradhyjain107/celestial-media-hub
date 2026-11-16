import { expect, describe, test, vi, beforeEach } from 'vitest';
import { POST } from '../../src/app/api/convert/route';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import * as tempExt from '../../src/lib/system/temp';
import * as ffmpegExt from '../../src/lib/media/ffmpeg';

vi.mock('../../src/lib/system/temp', () => ({
  writeInputFile: vi.fn(),
  cleanupJobDir: vi.fn(),
  createJobDir: vi.fn().mockReturnValue('/mock/convertPath')
}));

vi.mock('../../src/lib/system/env', () => ({
  env: { FFMPEG_PATH: '/mock/ffmpeg', YTDLP_PATH: '/mock/ytdlp', TEMP_DIR: '/mock/tmp' }
}));

vi.mock('../../src/lib/media/ffmpeg', () => ({
  executeFfmpeg: vi.fn(),
  probeMediaStreams: vi.fn().mockResolvedValue({ hasVideo: true, hasAudio: true, videoCodec: 'h264', audioCodec: 'aac', duration: 10 }),
  getOptimalFfmpegThreads: vi.fn().mockReturnValue('2')
}));

vi.mock('../../src/lib/media/pdfRasterizer', () => ({
  isPdfFile: (name: string) => name.toLowerCase().endsWith('.pdf'),
  convertPdfToImage: vi.fn().mockResolvedValue(['/mock/convertPath/output.png']),
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
    
    const req = {
      formData: async () => formData,
      headers: new Headers({ authorization: 'Bearer user_test' }),
    } as any as NextRequest;

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
        '/mock/convertPath/video.mp4', 
        ['-i', '/mock/convertPath/video.mp4', '-threads', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', 'faststart', '-y', '/mock/convertPath/output.mp4']
    );
    expect(text).toMatch(/"downloadUrl":"\/api\/download\?jobId=[a-zA-Z0-9\-]+&file=output\.mp4"/);
  });

  test('converts input to image format with -vframes 1 flag', async () => {
    const formData = new FormData();
    formData.append('outputFormat', 'png');
    formData.append('file', new File(['mock'], 'sample.jpg', { type: 'image/jpeg' }));
    
    const req = {
      formData: async () => formData,
      headers: new Headers({ authorization: 'Bearer user_test' }),
    } as any as NextRequest;

    vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/convertPath/sample.jpg');
    
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
      '/mock/convertPath/sample.jpg',
      ['-i', '/mock/convertPath/sample.jpg', '-threads', '2', '-vframes', '1', '-pix_fmt', 'rgba', '-y', '/mock/convertPath/output.png']
    );
    expect(text).toMatch(/"downloadUrl":"\/api\/download\?jobId=[a-zA-Z0-9\-]+&file=output\.png"/);
  });

  test('converts Canon RAW (.cr2) file to png image format with pix_fmt compatibility', async () => {
    const formData = new FormData();
    formData.append('outputFormat', 'png');
    formData.append('file', new File(['rawcontent'], 'photo.cr2', { type: 'image/x-canon-cr2' }));

    const req = {
      formData: async () => formData,
      headers: new Headers({ authorization: 'Bearer user_test' }),
    } as any as NextRequest;

    vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/convertPath/photo.cr2');

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
      '/mock/convertPath/photo.cr2',
      ['-i', '/mock/convertPath/photo.cr2', '-threads', '2', '-vframes', '1', '-pix_fmt', 'rgba', '-y', '/mock/convertPath/output.png']
    );
    expect(text).toMatch(/"downloadUrl":"\/api\/download\?jobId=[a-zA-Z0-9\-]+&file=output\.png"/);
  });

  test('auto-detects incompatible AC3 audio on remux and heals to AAC with faststart for QuickTime compatibility', async () => {
    vi.mocked(ffmpegExt.probeMediaStreams).mockResolvedValue({
      hasVideo: true,
      hasAudio: true,
      videoCodec: 'h264',
      audioCodec: 'ac3',
      duration: 120,
    });

    const formData = new FormData();
    formData.append('preset', 'remux');
    formData.append('outputFormat', 'mov');
    formData.append('file', new File(['mock'], 'movie.mp4', { type: 'video/mp4' }));

    const req = {
      formData: async () => formData,
      headers: new Headers({ authorization: 'Bearer user_test' }),
    } as any as NextRequest;

    vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/convertPath/movie.mp4');

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

    // Video is copied losslessly, audio is healed to AAC, and faststart is attached
    expect(ffmpegExt.executeFfmpeg).toHaveBeenCalledWith(
      '/mock/convertPath/movie.mp4',
      ['-i', '/mock/convertPath/movie.mp4', '-threads', '2', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-y', '/mock/convertPath/output.mov']
    );
  });

  test('converts PDF document to PNG using PDF rasterization pipeline', async () => {
    const formData = new FormData();
    formData.append('outputFormat', 'png');
    formData.append('file', new File(['%PDF-1.4 mock pdf data'], 'document.pdf', { type: 'application/pdf' }));

    const req = {
      formData: async () => formData,
      headers: new Headers({ authorization: 'Bearer user_test' }),
    } as any as NextRequest;

    vi.mocked(tempExt.writeInputFile).mockResolvedValue('/mock/convertPath/document.pdf');
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 } as any);

    const res = await POST(req);
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      text += decoder.decode(value);
    }

    expect(text).toContain('PDF-RASTERIZE');
    expect(text).toContain('"status":"complete"');
    expect(text).toMatch(/"downloadUrl":"\/api\/download\?jobId=[a-zA-Z0-9\-]+&file=output\.png"/);
  });

  test('ignores H.264/AAC preset overrides when outputFormat is gif, webp, or webm', async () => {
    for (const [inputName, outputFormat, expectedCodecFlag] of [
      ['sample.mp4', 'gif', 'gif'],
      ['sample.png', 'webp', '-vframes'],
      ['sample.mp4', 'webm', 'libvpx-vp9'],
    ] as const) {
      vi.clearAllMocks();
      const formData = new FormData();
      formData.append('preset', 'high');
      formData.append('outputFormat', outputFormat);
      formData.append('files', new File(['mock'], inputName, { type: 'application/octet-stream' }));

      const req = {
        formData: async () => formData,
        headers: new Headers({ authorization: 'Bearer user_test' }),
      } as any as NextRequest;

      vi.mocked(tempExt.writeInputFile).mockResolvedValue(`/mock/convertPath/${inputName}`);
      vi.mocked(ffmpegExt.executeFfmpeg).mockReturnValue(new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"progress":100}\n\n'));
          c.enqueue(new TextEncoder().encode('data: {"status":"done"}\n\n'));
          c.close();
        }
      }));

      const res = await POST(req);
      const reader = res.body?.getReader();
      while (reader) {
        const { done } = await reader.read();
        if (done) break;
      }

      const calledArgs = vi.mocked(ffmpegExt.executeFfmpeg).mock.calls[0][1] as string[];
      expect(calledArgs).toContain(expectedCodecFlag);
      expect(calledArgs).not.toContain('libx264');
      expect(calledArgs).not.toContain('aac');
    }
  });
});

