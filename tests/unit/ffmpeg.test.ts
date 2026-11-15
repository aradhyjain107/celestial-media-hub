import { expect, describe, test, vi, beforeEach } from 'vitest';
import { executeFfmpeg } from '../../lib/ffmpeg';
import fs from 'node:fs';
import { EventEmitter } from 'events';

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn()
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    spawn: mockSpawn,
    default: { ...actual.default, spawn: mockSpawn }
  };
});

vi.mock('../../lib/env', () => ({
  env: { FFMPEG_PATH: '/mock/ffmpeg' }
}));

describe('executeFfmpeg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const readStream = async (stream: ReadableStream) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let result = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value);
    }
    return result;
  };

  test('successful progress streaming and cleanup on success', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'rmSync').mockImplementation(() => {});

    mockSpawn.mockImplementation((cmd: any) => {
      const proc: any = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      
      setTimeout(() => {
        if (cmd === '/mock/ffprobe') {
          proc.stdout.emit('data', JSON.stringify({ format: { duration: '10.0' } }));
          proc.emit('close', 0);
        } else {
          proc.stdout.emit('data', 'out_time_ms=5000000\\n'); // 50%
          setTimeout(() => proc.emit('close', 0), 10);
        }
      }, 5);
      return proc as any;
    });

    const stream = executeFfmpeg('input.mp4', []);
    const output = await readStream(stream);

    expect(output).toContain('"progress":50');
    expect(output).toContain('"status":"done"');
  });

  test('error detection and cleanup on failure', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'rmSync').mockImplementation(() => {});

    mockSpawn.mockImplementation((cmd: any) => {
      const proc: any = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      
      setTimeout(() => {
        if (cmd === '/mock/ffprobe') {
          proc.stdout.emit('data', JSON.stringify({ format: { duration: '10.0' } }));
          proc.emit('close', 0);
        } else {
          proc.stderr.emit('data', 'Fatal FFmpeg Error Process Crashed');
          setTimeout(() => proc.emit('close', 1), 10);
        }
      }, 5);
      return proc as any;
    });

    const stream = executeFfmpeg('input.mp4', []);
    const output = await readStream(stream);

    expect(output).toContain('"error":"FFmpeg error: Fatal FFmpeg Error Process Crashed"');
  });
});
