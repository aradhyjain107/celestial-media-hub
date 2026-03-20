import { expect, describe, test, vi, beforeEach } from 'vitest';
import { POST } from '../../app/api/inspect/route';
import { NextRequest } from 'next/server';
import { EventEmitter } from 'events';
import * as tempExt from '../../lib/temp';

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, spawn: mockSpawn, default: { ...actual.default, spawn: mockSpawn } };
});

vi.mock('../../lib/temp', () => ({
  writeInputFile: vi.fn(),
  cleanupJobDir: vi.fn(),
  createJobDir: vi.fn()
}));
vi.mock('../../lib/env', () => ({ env: { FFMPEG_PATH: '/mock/ffmpeg' } }));

describe('/api/inspect POST', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  test('returns 400 when missing file', async () => {
    const req = {
      formData: async () => new FormData()
    } as any as NextRequest;
    
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test('runs ffprobe and returns metadata', async () => {
    const req = {
      formData: async () => {
        const fd = new FormData();
        fd.append('file', new File(['mock content'], 'test.mp4', { type: 'video/mp4' }));
        return fd;
      }
    } as any as NextRequest;

    vi.mocked(tempExt.writeInputFile).mockResolvedValue('/tmp/123/test.mp4');

    mockSpawn.mockImplementation(() => {
      const proc: any = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      setTimeout(() => {
        proc.stdout.emit('data', JSON.stringify({
          format: { format_name: 'mp4', duration: '120.5', bit_rate: '300000' },
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '60/1' },
            { codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' }
          ]
        }));
        proc.emit('close', 0);
      }, 5);
      return proc as any;
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.format).toBe('mp4');
    expect(data.duration).toBe(120.5);
    expect(data.resolution).toBe('1920x1080');
    expect(data.frameRate).toBe(60);
    expect(data.videoCodec).toBe('h264');
    
    expect(tempExt.cleanupJobDir).toHaveBeenCalled();
  });
});
