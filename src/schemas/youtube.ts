import { z } from 'zod';

const ALLOWED_YOUTUBE_DOMAINS = [
  /^(www\.)?youtube\.com$/i,
  /^youtu\.be$/i,
  /^(music\.)?youtube\.com$/i,
  /^(m\.)?youtube\.com$/i,
  /^(www\.)?youtube-nocookie\.com$/i,
];

const ALLOWED_INSTAGRAM_DOMAINS = [
  /^(www\.)?instagram\.com$/i,
  /^(m\.)?instagram\.com$/i,
  /^(www\.)?instagr\.am$/i,
];

export type MediaPlatform = 'youtube' | 'instagram' | 'unknown';

export function detectMediaPlatform(urlStr: string): MediaPlatform {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    if (ALLOWED_YOUTUBE_DOMAINS.some(p => p.test(hostname))) return 'youtube';
    if (ALLOWED_INSTAGRAM_DOMAINS.some(p => p.test(hostname))) return 'instagram';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function isValidMediaUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '169.254.169.254' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('172.')
    ) {
      return false;
    }
    const isYt = ALLOWED_YOUTUBE_DOMAINS.some(p => p.test(hostname));
    const isIg = ALLOWED_INSTAGRAM_DOMAINS.some(p => p.test(hostname));
    return isYt || isIg;
  } catch {
    return false;
  }
}

export const isValidYouTubeUrl = isValidMediaUrl;

export const YoutubeInputSchema = z.object({
  url: z.string().url().refine(isValidMediaUrl, {
    message: 'Invalid URL. Only official YouTube and Instagram domains are allowed.',
  }),
  urls: z.array(
    z.string().url().refine(isValidMediaUrl, {
      message: 'Invalid URL in batch. Only official YouTube and Instagram domains are allowed.',
    })
  ).max(50).optional(),
  format: z.enum(['mp3','m4a','wav','mp4']),
  quality: z.enum(['128','192','256','320','1080p','720p','480p']),
  isPlaylist: z.boolean().default(false),
  selectedIndices: z.array(z.number().int().nonnegative()).optional(),
});
