import { describe, expect, test, vi, beforeEach } from 'vitest';
import { createJobDir, cleanupJobDir, writeInputFile } from '../../src/lib/system/temp';
import fs from 'node:fs';

vi.mock('../../src/lib/system/env', () => ({
  env: { TEMP_DIR: '/mock/temp' }
}));

describe('lib/temp.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('createJobDir creates directory if not exists', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);

    const dir = createJobDir('123');
    expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/temp/123', { recursive: true });
    expect(dir).toBe('/mock/temp/123');
  });

  test('cleanupJobDir removes directory if exists', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'rmSync').mockImplementation(() => undefined as any);
    
    cleanupJobDir('456');
    expect(fs.rmSync).toHaveBeenCalledWith('/mock/temp/456', { recursive: true, force: true });
  });

  test('writeInputFile writes buffer to disk asynchronously', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mockHandle = {
      write: vi.fn().mockResolvedValue({ bytesWritten: 4 }),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const openSpy = vi.spyOn(fs.promises, 'open').mockResolvedValue(mockHandle as any);
    
    const buf = Buffer.from('test');
    const filePath = await writeInputFile('789', 'test.txt', buf);
    expect(openSpy).toHaveBeenCalledWith('/mock/temp/789/test.txt', 'w');
    expect(mockHandle.write).toHaveBeenCalledWith(buf, 0, buf.byteLength);
    expect(mockHandle.close).toHaveBeenCalled();
    expect(filePath).toBe('/mock/temp/789/test.txt');
  });

  test('writeInputFile supports ArrayBuffer input', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mockHandle = {
      write: vi.fn().mockResolvedValue({ bytesWritten: 18 }),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const openSpy = vi.spyOn(fs.promises, 'open').mockResolvedValue(mockHandle as any);

    const ab = new TextEncoder().encode('hello array buffer').buffer;
    const filePath = await writeInputFile('789', 'sample.bin', ab);
    expect(openSpy).toHaveBeenCalledWith('/mock/temp/789/sample.bin', 'w');
    expect(mockHandle.write).toHaveBeenCalled();
    expect(mockHandle.close).toHaveBeenCalled();
    expect(filePath).toBe('/mock/temp/789/sample.bin');
  });

  test('writeInputFile supports ArrayBufferView input', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mockHandle = {
      write: vi.fn().mockResolvedValue({ bytesWritten: 18 }),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const openSpy = vi.spyOn(fs.promises, 'open').mockResolvedValue(mockHandle as any);

    const view = new Uint8Array([1, 2, 3, 4]);
    const filePath = await writeInputFile('789', 'view.bin', view);
    expect(openSpy).toHaveBeenCalledWith('/mock/temp/789/view.bin', 'w');
    expect(mockHandle.write).toHaveBeenCalled();
    expect(mockHandle.close).toHaveBeenCalled();
    expect(filePath).toBe('/mock/temp/789/view.bin');
  });

  test('startTempDirSweeper removes abandoned directories older than TTL', async () => {
    vi.useFakeTimers();
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs.promises, 'readdir').mockResolvedValue([
      { name: 'old_job', isDirectory: () => true } as any,
      { name: 'new_job', isDirectory: () => true } as any,
      { name: 'not_a_dir.txt', isDirectory: () => false } as any,
    ]);
    const rmSpy = vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined as any);
    vi.spyOn(fs.promises, 'stat').mockImplementation(async (targetPath: any) => {
      if (String(targetPath).includes('old_job')) {
        return { mtimeMs: Date.now() - (40 * 60 * 1000) } as any;
      }
      return { mtimeMs: Date.now() - (5 * 60 * 1000) } as any;
    });

    const { startTempDirSweeper } = await import('../../src/lib/system/temp');
    const timer = startTempDirSweeper(30 * 60 * 1000, 5 * 60 * 1000);
    
    // Advance timer to trigger sweep
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(rmSpy).toHaveBeenCalledWith('/mock/temp/old_job', { recursive: true, force: true });
    expect(rmSpy).not.toHaveBeenCalledWith('/mock/temp/new_job', expect.anything());

    clearInterval(timer);
    vi.useRealTimers();
  });
});
