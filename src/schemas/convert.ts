import { z } from 'zod';
import { FileUploadSchema } from './shared';

export const ConvertInputSchema = z.object({
  file: FileUploadSchema.optional(),
  files: z.array(FileUploadSchema).max(200).optional(),
  videoFile: FileUploadSchema.optional(),
  outputFormat: z.enum(['mp4','mkv','mov','webm','gif','mp3','wav','m4a','ogg','flac','png','jpg','jpeg','webp','bmp','tiff','avif']),
  preset: z.enum(['whatsapp','discord','email','twitter','instagram','tiktok','high','custom','auto','remux']).default('auto'),
  speed: z.coerce.number().min(0.5).max(4).default(1),
  resolution: z.enum(['original','1080p','720p','480p','360p']).default('original'),
  stripAudio: z.boolean().default(false),
  stripMetadata: z.boolean().default(false),
  gifFps: z.coerce.number().int().min(5).max(60).default(15),
  gifPalette: z.boolean().default(true),

  // Audio-to-Video Synthesis & Trimming parameters
  videoStartTime: z.coerce.number().min(0).default(0),
  videoEndTime: z.coerce.number().min(0).optional(),
  audioSyncMode: z.enum(['fit-audio', 'fit-video', 'loop-video', 'trim-audio']).default('fit-audio'),
  visualizerStyle: z.enum([
    'none', 'waveform', 'frequency', 'circular', 'minimal',
    'obsidian_pulse', 'cyber_bars', 'nebula_spectrum', 'minimal_wave'
  ]).default('none'),
  visualizerColor: z.string().default('#00F2FE'),
  visualizerBg: z.string().default('#0a0a0c'),
  videoLoop: z.boolean().default(true),
});

export type ConvertInput = z.infer<typeof ConvertInputSchema>;

