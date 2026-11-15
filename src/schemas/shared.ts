import { z } from 'zod';

export const FileUploadSchema = z.object({
  filename: z.string().min(1),
  size: z.number().positive().max(5 * 1024 * 1024 * 1024), // 5GB max
  mimetype: z.string(),
});
