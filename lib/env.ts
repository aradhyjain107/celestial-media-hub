import { z } from 'zod';

const envSchema = z.object({
  FFMPEG_PATH: z.string().min(1, "FFMPEG_PATH is required"),
  YTDLP_PATH: z.string().min(1, "YTDLP_PATH is required"),
  TEMP_DIR: z.string().min(1, "TEMP_DIR is required"),
  NEXT_PUBLIC_API_BASE_URL: z.string().optional(),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  const missingVars = _env.error.issues.map(i => i.path[0]).join(', ');
  throw new Error(`CRITICAL SYSTEM FAILURE: Invalid or missing required environment variables: [${missingVars}]. Please refer to .env.example.`);
}

export const env = _env.data;
