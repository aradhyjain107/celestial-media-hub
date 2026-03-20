import { z } from 'zod';
import { FileUploadSchema } from './shared';

export const InspectInputSchema = z.object({
  file: FileUploadSchema,
});

export const InspectOutputSchema = z.object({
  filename: z.string(),
  filesize: z.number(),
  duration: z.number().optional(),
  format: z.string(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  resolution: z.string().optional(),
  frameRate: z.number().optional(),
  bitrate: z.number().optional(),
  audioChannels: z.number().optional(),
  audioSampleRate: z.number().optional(),
  createdAt: z.string().optional(),
});
