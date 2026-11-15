import { z } from 'zod';
import { FileUploadSchema } from './shared';

export const TrimInputSchema = z.object({
  mode: z.enum(['trim','merge']),
  files: z.array(z.object({
    ...FileUploadSchema.shape,
    startTime: z.number().nonnegative().optional(),   // seconds
    endTime: z.number().positive().optional(),   // seconds
    order: z.number().int().nonnegative(),
  })).min(1).max(20),
  outputFormat: z.enum(['mp3','wav','flac','m4a','aac']),
  fadeIn: z.number().min(0).max(5).optional().default(0),  // seconds
  fadeOut: z.number().min(0).max(5).optional().default(0),
  crossfade: z.number().min(0).max(5).optional().default(0),
  startTime: z.number().nonnegative().optional(),
  endTime: z.number().positive().optional(),
}).refine(data => {
  if (data.mode === 'trim' && data.startTime !== undefined && data.endTime !== undefined) {
    return data.startTime < data.endTime;
  }
  return true;
}, {
  message: 'startTime must be less than endTime',
  path: ['endTime'],
});

