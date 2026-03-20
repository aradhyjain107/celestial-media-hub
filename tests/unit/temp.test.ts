import { describe, expect, test, vi, beforeEach } from 'vitest';
import { createJobDir, cleanupJobDir, writeInputFile } from '../../lib/temp';
import fs from 'node:fs';

vi.mock('../../lib/env', () => ({
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

  test('writeInputFile writes buffer to disk', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined as any);
    
    const buf = Buffer.from('test');
    await writeInputFile('789', 'test.txt', buf);
    expect(fs.writeFileSync).toHaveBeenCalledWith('/mock/temp/789/test.txt', buf);
  });
});
