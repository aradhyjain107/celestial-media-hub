import { z } from 'zod';
import { FileUploadSchema } from './shared';

export const ConvertInputSchema = z.object({
  file: FileUploadSchema,
  outputFormat: z.enum(['mp4','mkv','mov','webm','gif','mp3','wav','m4a','ogg','flac']),
  preset: z.enum(['whatsapp','discord','email','twitter','high','custom']).default('high'),
  speed: z.number().min(0.5).max(4).default(1),
  resolution: z.enum(['original','1080p','720p','480p','360p']).default('original'),
  stripAudio: z.boolean().default(false),
  stripMetadata: z.boolean().default(false),
});
