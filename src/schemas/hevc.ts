import { z } from 'zod';
import { FileUploadSchema } from './shared';

export const HevcInputSchema = z.object({
  files: z.array(FileUploadSchema).min(1).max(10),
  crf: z.number().int().min(18).max(35).default(28),
  preset: z.enum(['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow']).default('medium'),
  hardwareAccel: z.boolean().default(false),
});
