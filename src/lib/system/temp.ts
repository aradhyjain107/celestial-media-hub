/* eslint-disable security/detect-non-literal-fs-filename */
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';

export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return 'file';
  }
  // Normalize backslashes to forward slashes
  let sanitized = filename.replace(/\\/g, '/');
  // Remove control characters and null bytes
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
  // Get base name
  sanitized = path.basename(sanitized);
  // Strip .. sequences
  sanitized = sanitized.replace(/\.\.+/g, '');
  // Strip leading dots and slashes
  sanitized = sanitized.replace(/^[./]+/, '');
  return sanitized || 'file';
}

export function sanitizeJobId(jobId: string): string {
  if (!jobId || typeof jobId !== 'string') {
    throw new Error('Invalid jobId');
  }
  // Normalize backslashes to forward slashes
  let sanitized = jobId.replace(/\\/g, '/');
  // Remove control characters and null bytes
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
  // Extract base name
  sanitized = path.basename(sanitized);
  // Strip .. sequences
  sanitized = sanitized.replace(/\.\.+/g, '');
  // Strip leading dots and slashes
  sanitized = sanitized.replace(/^[./]+/, '');
  if (!sanitized) {
    throw new Error('Invalid jobId');
  }
  return sanitized;
}

export function createJobDir(jobId: string): string {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test') {
    ensureTempDirSweeperStarted();
  }
  const cleanJobId = sanitizeJobId(jobId);
  const baseDir = path.resolve(env.TEMP_DIR);
  const dir = path.resolve(baseDir, cleanJobId);

  if (!dir.startsWith(baseDir + path.sep) && dir !== baseDir) {
    throw new Error('Path traversal detected');
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(dir)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function cleanupJobDir(jobId: string): void {
  const cleanJobId = sanitizeJobId(jobId);
  getActiveJobSet().delete(cleanJobId);
  const baseDir = path.resolve(env.TEMP_DIR);
  const dir = path.resolve(baseDir, cleanJobId);

  if (!dir.startsWith(baseDir + path.sep)) {
    throw new Error('Path traversal detected');
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const GLOBAL_SWEEPER_KEY = Symbol.for('celestial.tempDirSweeperStarted');
const GLOBAL_ACTIVE_JOBS_KEY = Symbol.for('celestial.activeJobDirs');

function getActiveJobSet(): Set<string> {
  const g = globalThis as any;
  // eslint-disable-next-line security/detect-object-injection
  if (!g[GLOBAL_ACTIVE_JOBS_KEY]) {
    // eslint-disable-next-line security/detect-object-injection
    g[GLOBAL_ACTIVE_JOBS_KEY] = new Set<string>();
  }
  // eslint-disable-next-line security/detect-object-injection
  return g[GLOBAL_ACTIVE_JOBS_KEY] as Set<string>;
}

export function markJobActive(jobId: string): void {
  try {
    getActiveJobSet().add(sanitizeJobId(jobId));
  } catch {
    // Ignore invalid jobId
  }
}

export function markJobInactive(jobId: string): void {
  try {
    getActiveJobSet().delete(sanitizeJobId(jobId));
  } catch {
    // Ignore invalid jobId
  }
}

export function ensureTempDirSweeperStarted(
  ttlMs: number = 30 * 60 * 1000,
  intervalMs: number = 5 * 60 * 1000
): NodeJS.Timeout | null {
  const g = globalThis as any;
  // eslint-disable-next-line security/detect-object-injection
  if (g[GLOBAL_SWEEPER_KEY]) {
    return null;
  }
  // eslint-disable-next-line security/detect-object-injection
  g[GLOBAL_SWEEPER_KEY] = true;
  return startTempDirSweeper(ttlMs, intervalMs);
}

export function resetTempDirSweeperForTesting(): void {
  const g = globalThis as any;
  // eslint-disable-next-line security/detect-object-injection
  g[GLOBAL_SWEEPER_KEY] = false;
}

export function startTempDirSweeper(
  ttlMs: number = 30 * 60 * 1000,
  intervalMs: number = 5 * 60 * 1000
): NodeJS.Timeout {
  const sweep = async () => {
    try {
      const baseDir = path.resolve(env.TEMP_DIR);
      if (!fs.existsSync(baseDir)) return;

      let entries: any[] = [];
      if (typeof (fs.promises?.readdir as any)?.mock !== 'undefined') {
        entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
      } else {
        try {
          entries = fs.readdirSync(baseDir, { withFileTypes: true });
        } catch {
          entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
        }
      }
      const now = Date.now();

      const activeJobs = getActiveJobSet();
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (activeJobs.has(entry.name)) continue;
          const dirPath = path.resolve(baseDir, entry.name);
          if (!dirPath.startsWith(baseDir + path.sep)) continue;

          try {
            const stats = await fs.promises.stat(dirPath);
            const age = now - stats.mtimeMs;
            if (age > ttlMs) {
              await fs.promises.rm(dirPath, { recursive: true, force: true });
            }
          } catch {
            // Ignore error for individual dir
          }
        }
      }
    } catch {
      // Ignore top-level readdir errors
    }
  };

  void sweep();

  const timer = setInterval(() => {
    void sweep();
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return timer;
}

import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export async function writeInputFile(
  jobId: string,
  filename: string,
  source: ArrayBuffer | Buffer | File | Blob | NodeJS.ReadableStream | ReadableStream<any> | ArrayBufferView
): Promise<string> {
  const cleanFilename = sanitizeFilename(filename);
  const dir = createJobDir(jobId);
  const resolvedDir = path.resolve(dir);
  const filePath = path.resolve(resolvedDir, cleanFilename);

  if (!filePath.startsWith(resolvedDir + path.sep)) {
    throw new Error('Path traversal detected');
  }

  const CHUNK_LIMIT = 16 * 1024 * 1024; // 16 MB chunk write safety barrier

  // Helper to write buffer/typed-array in safe <= 16MB slices to prevent Node.js 2GB ERR_OUT_OF_RANGE
  const safeWriteBuffer = async (targetPath: string, buffer: Buffer | Uint8Array) => {
    const handle = await fs.promises.open(targetPath, 'w');
    try {
      if (buffer.byteLength <= CHUNK_LIMIT) {
        await handle.write(buffer, 0, buffer.byteLength);
      } else {
        for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_LIMIT) {
          const len = Math.min(CHUNK_LIMIT, buffer.byteLength - offset);
          const chunk = buffer.subarray(offset, offset + len);
          await handle.write(chunk, 0, chunk.byteLength);
        }
      }
    } finally {
      await handle.close();
    }
  };

  // 1. Web File / Blob streaming via .stream() (Zero-RAM chunk streaming)
  if (source && typeof (source as any).stream === 'function') {
    try {
      const webStream = (source as any).stream();
      if (webStream && typeof webStream.getReader === 'function') {
        const reader = webStream.getReader();
        const handle = await fs.promises.open(filePath, 'w');
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.byteLength > 0) {
              if (value.byteLength <= CHUNK_LIMIT) {
                await handle.write(value, 0, value.byteLength);
              } else {
                for (let offset = 0; offset < value.byteLength; offset += CHUNK_LIMIT) {
                  const len = Math.min(CHUNK_LIMIT, value.byteLength - offset);
                  const chunk = value.subarray ? value.subarray(offset, offset + len) : value.slice(offset, offset + len);
                  await handle.write(chunk, 0, chunk.byteLength);
                }
              }
            }
          }
        } finally {
          await handle.close();
        }
        return filePath;
      }
    } catch {
      // Fallback to arrayBuffer if streaming pipeline fails in polyfill/test environments
    }
  }

  // 2. Web ReadableStream (used for direct streaming request bodies e.g. req.body)
  if (source && typeof (source as any).getReader === 'function') {
    const reader = (source as any).getReader();
    const handle = await fs.promises.open(filePath, 'w');
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          if (value.byteLength <= CHUNK_LIMIT) {
            await handle.write(value, 0, value.byteLength);
          } else {
            for (let offset = 0; offset < value.byteLength; offset += CHUNK_LIMIT) {
              const len = Math.min(CHUNK_LIMIT, value.byteLength - offset);
              const chunk = value.subarray ? value.subarray(offset, offset + len) : value.slice(offset, offset + len);
              await handle.write(chunk, 0, chunk.byteLength);
            }
          }
        }
      }
    } finally {
      await handle.close();
    }
    return filePath;
  }

  // 3. Web File / Blob arrayBuffer fallback
  if (source && typeof (source as any).arrayBuffer === 'function') {
    const ab = await (source as any).arrayBuffer();
    await safeWriteBuffer(filePath, new Uint8Array(ab));
    return filePath;
  }

  // 4. Node.js Readable stream
  if (source && typeof (source as any).pipe === 'function') {
    const handle = await fs.promises.open(filePath, 'w');
    try {
      for await (const chunk of (source as any)) {
        if (chunk && chunk.byteLength > 0) {
          if (chunk.byteLength <= CHUNK_LIMIT) {
            await handle.write(chunk, 0, chunk.byteLength);
          } else {
            for (let offset = 0; offset < chunk.byteLength; offset += CHUNK_LIMIT) {
              const len = Math.min(CHUNK_LIMIT, chunk.byteLength - offset);
              const sub = chunk.subarray ? chunk.subarray(offset, offset + len) : chunk.slice(offset, offset + len);
              await handle.write(sub, 0, sub.byteLength);
            }
          }
        }
      }
    } finally {
      await handle.close();
    }
    return filePath;
  }

  // 5. Buffer
  if (Buffer.isBuffer(source)) {
    await safeWriteBuffer(filePath, source);
    return filePath;
  }

  // 6. ArrayBuffer
  if (source instanceof ArrayBuffer) {
    await safeWriteBuffer(filePath, new Uint8Array(source));
    return filePath;
  }

  // 7. TypedArray / ArrayBufferView
  if (ArrayBuffer.isView(source)) {
    const view = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    await safeWriteBuffer(filePath, view);
    return filePath;
  }

  // 8. String or raw data
  if (typeof source === 'string') {
    await fs.promises.writeFile(filePath, source, 'utf-8');
    return filePath;
  }

  const data = new Uint8Array(source as any);
  await safeWriteBuffer(filePath, data);
  return filePath;
}

// Automatically initialize sweeper in production server runtime
if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test') {
  ensureTempDirSweeperStarted();
}


