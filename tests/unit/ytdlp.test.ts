import { expect, describe, test, vi, beforeEach } from 'vitest';
import { executeYtdlp, getPlaylistInfo } from '../../src/lib/ytdlp';
import fs from 'node:fs';
import { EventEmitter } from 'events';

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn()
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, spawn: mockSpawn, default: { ...actual.default, spawn: mockSpawn } };
});

vi.mock('../../src/lib/env', () => ({ env: { YTDLP_PATH: '/mock/ytdlp' } }));

describe('executeYtdlp and getPlaylistInfo', () => {
  beforeEach(() => { vi.clearAllMocks(); });

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

  test('successful progress streaming for ytdlp', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'rmSync').mockImplementation(() => undefined as any);

    mockSpawn.mockImplementation((cmd: any) => {
      const proc: any = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      
      setTimeout(() => {
        proc.stdout.emit('data', '[download]  50.0% of 10MiB\n');
        setTimeout(() => proc.emit('close', 0), 10);
      }, 5);
      return proc as any;
    });

    const stream = executeYtdlp('/tmp/yt', 'http://test', []);
    const output = await readStream(stream);

    expect(output).toContain('"progress":50');
    expect(output).toContain('"status":"done"');
  });

  test('handles carriage return (\\r) delimited progress streaming properly', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'rmSync').mockImplementation(() => undefined as any);

    mockSpawn.mockImplementation((cmd: any) => {
      const proc: any = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      
      setTimeout(() => {
        proc.stdout.emit('data', '[download]  25.0% of 10MiB\r[download]  75.0% of 10MiB\r');
        setTimeout(() => proc.emit('close', 0), 10);
      }, 5);
      return proc as any;
    });

    const stream = executeYtdlp('/tmp/yt', 'http://test', []);
    const output = await readStream(stream);

    expect(output).toContain('"progress":25');
    expect(output).toContain('"progress":75');
    expect(output).toContain('"status":"done"');
  });

  test('extracts playlist info correctly', async () => {
    mockSpawn.mockImplementation((cmd: any) => {
      const proc: any = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      
      setTimeout(() => {
        proc.stdout.emit('data', '{"id": "123", "title": "Song 1", "duration": 180}\n{"id": "456", "title": "Song 2"}');
        setTimeout(() => proc.emit('close', 0), 10);
      }, 5);
      return proc as any;
    });

    const info = await getPlaylistInfo('http://playlist');
    expect(info).toHaveLength(2);
    expect(info[0].title).toBe('Song 1');
    expect(info[1].id).toBe('456');
  });
});
