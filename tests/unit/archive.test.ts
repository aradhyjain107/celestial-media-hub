import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { buildZipBuffer, createZipArchive, crc32 } from '../../src/lib/utils/archive';

describe('Cross-Platform ZIP Archive Helper (src/lib/utils/archive.ts)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celestial-archive-test-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('computes standard IEEE 802.3 CRC-32 values', () => {
    expect(crc32(Buffer.from('123456789', 'ascii'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0x00000000);
  });

  it('builds valid PKZIP 2.0 archive for compressible and incompressible entries', () => {
    const textData = Buffer.from('hello celestial media hub '.repeat(20), 'utf8');
    const binaryData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    const zipBuf = buildZipBuffer([
      { name: 'nested/dir/notes.txt', data: textData, mtime: new Date('2026-01-15T12:00:00Z') },
      { name: 'clip.bin', data: binaryData, mtime: new Date('2026-01-15T12:00:00Z') },
    ]);

    // Verify PKZIP signatures
    expect(zipBuf.readUInt32LE(0)).toBe(0x04034b50); // Local File Header
    const eocdOffset = zipBuf.length - 22;
    expect(zipBuf.readUInt32LE(eocdOffset)).toBe(0x06054b50); // End of Central Directory
    expect(zipBuf.readUInt16LE(eocdOffset + 8)).toBe(2); // entry count

    // Parse first entry back via local header + deflateRawSync
    const method = zipBuf.readUInt16LE(8);
    const compSize = zipBuf.readUInt32LE(18);
    const nameLen = zipBuf.readUInt16LE(26);
    const extraLen = zipBuf.readUInt16LE(28);
    const archivedName = zipBuf.subarray(30, 30 + nameLen).toString('utf8');
    expect(archivedName).toBe('notes.txt'); // junked path
    const payloadStart = 30 + nameLen + extraLen;
    const payload = zipBuf.subarray(payloadStart, payloadStart + compSize);
    const extracted = method === 8 ? zlib.inflateRawSync(payload) : payload;
    expect(extracted.equals(textData)).toBe(true);
  });

  it('createZipArchive produces a valid zip on disk and passes unzip verification when available', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.txt'), 'alpha payload '.repeat(10));
    fs.writeFileSync(path.join(tmpDir, 'beta.bin'), Buffer.from([1, 2, 3, 4, 5]));

    createZipArchive(tmpDir, ['alpha.txt', 'beta.bin'], 'output.zip');
    const zipPath = path.join(tmpDir, 'output.zip');
    expect(fs.existsSync(zipPath)).toBe(true);
    expect(fs.statSync(zipPath).size).toBeGreaterThan(22);

    // Also test pure-Node fallback path directly by overriding PATH so `zip` is absent
    const origPath = process.env.PATH;
    try {
      process.env.PATH = '';
      fs.unlinkSync(zipPath);
      createZipArchive(tmpDir, ['alpha.txt', 'beta.bin'], 'output.zip');
    } finally {
      process.env.PATH = origPath;
    }

    expect(fs.existsSync(zipPath)).toBe(true);
    const buf = fs.readFileSync(zipPath);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);

    // Validate with system `unzip -t` on POSIX if available
    try {
      execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  });
});
