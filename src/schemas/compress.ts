import { z } from 'zod';
import { FileUploadSchema } from './shared';

export const CompressInputSchema = z.object({
  files: z.array(FileUploadSchema).min(1).max(50),
  videoCodec: z.enum(['hevc', 'h264', 'av1', 'vp9']).default('hevc'),
  videoCrf: z.number().int().min(18).max(35).default(28),
  videoPreset: z.enum(['ultrafast', 'fast', 'medium', 'slow']).default('medium'),
  resolution: z.enum(['original', '1080p', '720p', '480p']).default('original'),
  audioBitrate: z.enum(['64k', '128k', '192k', '320k']).default('128k'),
  audioFormat: z.enum(['mp3', 'aac', 'ogg', 'flac']).default('mp3'),
  imageQuality: z.number().int().min(10).max(100).default(80),
  imageFormat: z.enum(['webp', 'jpeg', 'png', 'avif']).default('webp'),
  maxDimension: z.enum(['original', '3840', '1920', '1080', '800']).default('original'),
  hardwareAccel: z.boolean().default(false),
});

export type CompressInput = z.infer<typeof CompressInputSchema>;
