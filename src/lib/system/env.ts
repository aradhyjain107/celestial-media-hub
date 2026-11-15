import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production';
const defaultDevSecret = 'dev-secret-key-min-32-chars-long-security-token';
const defaultTempDir = path.join(os.tmpdir(), 'celestial');

const envSchema = z.object({
  FFMPEG_PATH: z.preprocess((v) => (v && typeof v === 'string' && v.trim() ? v : 'ffmpeg'), z.string().min(1)),
  FFPROBE_PATH: z.preprocess((v) => (v && typeof v === 'string' && v.trim() ? v : 'ffprobe'), z.string().min(1)),
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
