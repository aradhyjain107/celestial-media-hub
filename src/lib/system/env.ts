import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production';
const defaultDevSecret = 'dev-secret-key-min-32-chars-long-security-token';
const defaultTempDir = path.join(os.tmpdir(), 'celestial');

/**
 * Resolves a bare executable name (e.g. "ffmpeg") against process.env.PATH without spawning a shell.
 * yt-dlp treats bare `--ffmpeg-location ffmpeg` as a relative path to cwd rather than searching PATH,
 * so resolving to an absolute executable path ensures ffmpeg/ffprobe post-processing works everywhere.
 */
function resolveExecutableOnPath(rawCommand: string): string {
  const cmd = rawCommand.trim();
  if (!cmd || path.isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\')) {
    return cmd;
  }

  const pathVar = process.env.PATH || '';
  const dirs = pathVar.split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const hasExt = ext && cmd.toLowerCase().endsWith(ext.toLowerCase());
      const candidate = path.join(dir, hasExt ? cmd : `${cmd}${ext}`);
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // Ignore unreadable PATH directory entries
      }
    }
  }
  return cmd;
}

const envSchema = z.object({
  FFMPEG_PATH: z.preprocess(
    (v) => resolveExecutableOnPath(v && typeof v === 'string' && v.trim() ? v : 'ffmpeg'),
    z.string().min(1)
  ),
  FFPROBE_PATH: z.preprocess(
    (v) => resolveExecutableOnPath(v && typeof v === 'string' && v.trim() ? v : 'ffprobe'),
    z.string().min(1)
  ),
  YTDLP_PATH: z.string().min(1).optional(),
  YT_DLP_PATH: z.string().min(1).optional(),
  TEMP_DIR: z.preprocess((v) => (v && typeof v === 'string' && v.trim() ? v : defaultTempDir), z.string().min(1)),
  NEXT_PUBLIC_API_BASE_URL: z.string().optional(),
  /**
   * Secret key used to sign and verify JWT tokens.
   * Must be at least 32 characters long (256-bit minimum for HS256).
   * In non-production environments, falls back to a development secret.
   */
  JWT_SECRET: isProd
    ? z.string().min(32, "JWT_SECRET must be at least 32 characters long")
    : z.preprocess((v) => (v && typeof v === 'string' && v.length >= 32 ? v : defaultDevSecret), z.string().min(32)),
}).transform((data) => ({
  ...data,
  YTDLP_PATH: data.YTDLP_PATH || data.YT_DLP_PATH || 'yt-dlp',
}));

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  const missingVars = _env.error.issues.map(i => i.path[0]).join(', ');
  throw new Error(`CRITICAL SYSTEM FAILURE: Invalid or missing required environment variables: [${missingVars}]. Please refer to .env.example.`);
}

export const env = _env.data;
