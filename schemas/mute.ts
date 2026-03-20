import { z } from 'zod';
import { FileUploadSchema } from './shared';

export const MuteInputSchema = z.object({
  files: z.array(FileUploadSchema).min(1).max(20),
  mode: z.enum(['remove', 'silence']), // remove track or replace with silence
});
