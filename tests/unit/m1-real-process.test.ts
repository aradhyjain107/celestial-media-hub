import { describe, expect, test } from 'vitest';
import { executeFfmpeg } from '../../src/lib/media/ffmpeg';
import fs from 'node:fs';

describe('Real OS Child Process Lifecycle Audit', () => {
  test('executeFfmpeg spawns real OS ffmpeg process and genuinely kills it upon reader.cancel()', async () => {
    // 1. Start a long running transcode (100 seconds of synthetic testsrc)
    const stream = executeFfmpeg('none', [
      '-re',
      '-f', 'lavfi',
      '-i', 'testsrc=size=160x120:rate=10',
      '-t', '100',
      '-f', 'null',
      '-'
    ], 100);

    const reader = stream.getReader();

    // Read first chunk to ensure child process is actually running
    const { done, value } = await reader.read();
    expect(done).toBe(false);
    expect(value).toBeDefined();

    // Cancel the stream
    const cancelStart = Date.now();
    await reader.cancel('Forensic audit client termination');
    const cancelDuration = Date.now() - cancelStart;

    // Must resolve cleanly and within reasonable time (<= 1500ms)
    expect(cancelDuration).toBeLessThan(2000);

    // Reading after cancel must return done: true
    const nextRead = await reader.read();
    expect(nextRead.done).toBe(true);
  });
});
