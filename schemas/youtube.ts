import { z } from 'zod';

export const YoutubeInputSchema = z.object({
  url: z.string().url(),
  format: z.enum(['mp3','m4a','wav','mp4']),
  quality: z.enum(['128','192','256','320','1080p','720p','480p']),
  isPlaylist: z.boolean().default(false),
  selectedIndices: z.array(z.number().int().nonnegative()).optional(),
});
