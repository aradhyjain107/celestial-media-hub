import { describe, expect, test, vi, beforeEach } from 'vitest';
import { executeFfmpeg } from '../../src/lib/media/ffmpeg';
import { executeYtdlp } from '../../src/lib/media/ytdlp';
import { EventEmitter } from 'node:events';

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

vi.mock('../../src/lib/system/env', () => ({
  env: {
    FFMPEG_PATH: '/mock/ffmpeg',
    YTDLP_PATH: '/mock/ytdlp',
    TEMP_DIR: '/mock/temp'
  }
}));

describe('Forensic Verification of Child Process Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('executeFfmpeg cancel sends SIGTERM and escalates to SIGKILL after 500ms', async () => {
    vi.useFakeTimers();

    const killSignals: string[] = [];
    const mockProc: any = new EventEmitter();
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();
    mockProc.pid = 99999;
    mockProc.kill = vi.fn().mockImplementation((signal?: string) => {
      killSignals.push(signal || 'SIGTERM');
      return true;
    });

    mockSpawn.mockImplementation((cmd: string) => {
      if (cmd.includes('ffprobe')) {
        const probeProc: any = new EventEmitter();
        probeProc.stdout = new EventEmitter();
        probeProc.stderr = new EventEmitter();
        setTimeout(() => {
          probeProc.stdout.emit('data', JSON.stringify({ format: { duration: '10.0' } }));
          probeProc.emit('close', 0);
        }, 1);
        return probeProc;
      }
      return mockProc;
    });

    const stream = executeFfmpeg('/mock/input.mp4', ['-i', '/mock/input.mp4']);
    const reader = stream.getReader();

    // Advance to let probe resolve and ffmpeg spawn
    await vi.advanceTimersByTimeAsync(10);
    expect(mockSpawn).toHaveBeenCalled();

    // Now initiate cancel
    let cancelResolved = false;
    const cancelPromise = reader.cancel('Aborted').then(() => {
      cancelResolved = true;
    });

    // Should have immediately sent SIGTERM
    expect(killSignals).toContain('SIGTERM');
    expect(cancelResolved).toBe(false); // must wait for exitPromise

    // Advance 499ms (before SIGKILL timeout)
    await vi.advanceTimersByTimeAsync(499);
    expect(killSignals).toEqual(['SIGTERM']);
    expect(cancelResolved).toBe(false);

    // Advance past 500ms -> should trigger SIGKILL
    await vi.advanceTimersByTimeAsync(10);
    expect(killSignals).toContain('SIGKILL');
    expect(cancelResolved).toBe(false);

    // Now emit exit on mockProc
    mockProc.emit('exit', null, 'SIGKILL');
    mockProc.emit('close', null);

    await cancelPromise;
    expect(cancelResolved).toBe(true);

    vi.useRealTimers();
  });

  test('executeYtdlp cancel sends SIGTERM and escalates to SIGKILL after 500ms', async () => {
    vi.useFakeTimers();

    const killSignals: string[] = [];
    const mockProc: any = new EventEmitter();
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();
    mockProc.pid = 88888;
    mockProc.kill = vi.fn().mockImplementation((signal?: string) => {
      killSignals.push(signal || 'SIGTERM');
      return true;
    });

    mockSpawn.mockReturnValue(mockProc);

    const stream = executeYtdlp('/mock/job', 'https://youtube.com/watch?v=test', ['-f', 'best']);
    const reader = stream.getReader();

    // Let start() run
    await vi.advanceTimersByTimeAsync(5);
    expect(mockSpawn).toHaveBeenCalled();

    // Cancel
    let cancelResolved = false;
    const cancelPromise = reader.cancel('User cancel').then(() => {
      cancelResolved = true;
    });

    expect(killSignals).toContain('SIGTERM');
    expect(cancelResolved).toBe(false);

    // Advance past 500ms
    await vi.advanceTimersByTimeAsync(510);
    expect(killSignals).toContain('SIGKILL');
    expect(cancelResolved).toBe(false);

    // Emit close
    mockProc.emit('exit', 0);
    mockProc.emit('close', 0);

    await cancelPromise;
    expect(cancelResolved).toBe(true);

    vi.useRealTimers();
  });
});
