/* eslint-disable security/detect-non-literal-fs-filename */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    // eslint-disable-next-line security/detect-object-injection
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

export interface ZipEntryInput {
  name: string;
  data: Buffer;
  mtime?: Date;
}

const PRECOMPRESSED_MEDIA_EXTS = new Set([
  '.mp4', '.mkv', '.mov', '.webm', '.avi', '.m4v',
  '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac',
  '.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.zip',
]);

/**
 * Pure-Node PKZIP 2.0 archive serializer (STORE / DEFLATE) requiring no external `zip` binary.
 */
export function buildZipBuffer(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const cleanName = path.basename(entry.name);
    const ext = path.extname(cleanName).toLowerCase();
    const nameBuf = Buffer.from(cleanName, 'utf8');
    const raw = entry.data;
    const checksum = crc32(raw);

    // Skip expensive, memory-doubling deflate pass on already-compressed media streams
    let method = 0;
    let payload = raw;
    if (!PRECOMPRESSED_MEDIA_EXTS.has(ext)) {
      const deflated = zlib.deflateRawSync(raw);
      if (deflated.length < raw.length) {
        method = 8;
        payload = deflated;
      }
    }
    const { dosTime, dosDate } = toDosTimeDate(entry.mtime ?? new Date());

    // Local File Header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed: 2.0
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length >>> 0, 18);
    localHeader.writeUInt32LE(raw.length >>> 0, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBuf, payload);

    // Central Directory Header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 filename flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length >>> 0, 20);
    centralHeader.writeUInt32LE(raw.length >>> 0, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attrs
    centralHeader.writeUInt32LE(0, 38); // external file attrs
    centralHeader.writeUInt32LE(offset >>> 0, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirBuffer = Buffer.concat(centralParts);

  // End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuffer.length >>> 0, 12);
  eocd.writeUInt32LE(offset >>> 0, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirBuffer, eocd]);
}

/**
 * Writes a flat (`-j` junk paths) ZIP archive into `cwd`.
 * Uses native `zip` CLI when installed, falling back transparently to pure-Node ZIP
 * serialization on systems without `zip` (e.g., native Windows or slim Linux images).
 */
export function createZipArchive(
  cwd: string,
  files: string[],
  zipFilename: string = 'output.zip'
): void {
  if (files.length === 0) return;

  try {
    execFileSync('zip', ['-j', zipFilename, '--', ...files], { cwd });
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code !== 'ENOENT' && process.platform !== 'win32') {
      throw err;
    }
  }

  const baseDir = path.resolve(cwd);
  const safeZipName = path.basename(zipFilename);
  const entries: ZipEntryInput[] = [];

  for (const file of files) {
    const filePath = path.resolve(baseDir, file);
    if (!filePath.startsWith(baseDir + path.sep)) continue;
    if (!fs.existsSync(filePath)) continue;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;
    entries.push({
      name: path.basename(filePath),
      data: fs.readFileSync(filePath),
      mtime: stat.mtime,
    });
  }

  if (entries.length === 0) return;
  const archive = buildZipBuffer(entries);
  fs.writeFileSync(path.join(baseDir, safeZipName), archive);
}
