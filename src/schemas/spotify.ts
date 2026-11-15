import { z } from 'zod';

export const SpotifyInputSchema = z.object({
  playlistUrl: z.string().url().refine(val => {
    try {
      const parsed = new URL(val);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
      return parsed.hostname === 'open.spotify.com' || parsed.hostname === 'spotify.com';
    } catch {
      return false;
    }
  }, {
    message: "Must be a valid Spotify URL"
  }),
  outputFormat: z.enum(['mp3','m4a','wav']).default('mp3'),
  quality: z.enum(['128','192','256','320']).default('320'),
});
