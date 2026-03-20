import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';

export function createJobDir(jobId: string): string {
  const dir = path.join(env.TEMP_DIR, jobId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function cleanupJobDir(jobId: string): void {
  const dir = path.join(env.TEMP_DIR, jobId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function writeInputFile(jobId: string, filename: string, buffer: ArrayBuffer | Buffer): Promise<string> {
  const dir = createJobDir(jobId);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return filePath;
}
