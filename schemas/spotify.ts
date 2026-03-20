import { z } from 'zod';

export const SpotifyInputSchema = z.object({
  playlistUrl: z.string().url().refine(val => val.includes('spotify.com'), {
    message: "Must be a valid Spotify URL"
  }),
  outputFormat: z.enum(['mp3','m4a','wav']).default('mp3'),
  quality: z.enum(['128','192','256','320']).default('320'),
});
