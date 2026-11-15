import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '../env';

const execFileAsync = promisify(execFile);

export interface VideoMetadata {
  title: string;
  thumbnail: string;
  duration: number;
  streams: {
    url: string;
    mimeType: string;
    bitrate: number;
    quality?: string;
    contentLength: number;
    type: 'video' | 'audio';
  }[];
}

/**
 * CelestialExtractor
 * 
 * Extracts video metadata and streaming URLs.
 * Uses client impersonation (Android/TV) to bypass signature deciphering where possible.
 */
export class CelestialExtractor {

  public async getMetadata(url: string): Promise<VideoMetadata> {
    const videoId = this.extractVideoId(url);
    if (!videoId) throw new Error('Invalid YouTube URL');

    try {
      console.log(`[TURBO] Using yt-dlp skeleton key for: ${videoId}`);
      const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const { stdout } = await execFileAsync(env.YTDLP_PATH, [
        '--dump-json',
        '--no-warnings',
        '--no-playlist',
        '--',
        targetUrl
      ]);
      const data = JSON.parse(stdout);

      const streams = (data.formats || []).map((format: any) => ({
        url: format.url,
        mimeType: format.ext,
        bitrate: format.tbr,
        quality: format.format_note || format.resolution,
        contentLength: format.filesize || 0,
        type: format.vcodec !== 'none' ? 'video' : 'audio',
      }));

      return {
        title: data.title,
        thumbnail: data.thumbnail,
        duration: data.duration,
        streams,
      };
    } catch (err: any) {
      console.error('[TURBO] yt-dlp extraction failed:', err);
      throw new Error(`Celestial Extraction failed: ${err.message}`);
    }
  }

  private extractVideoId(url: string): string | null {
    const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
    return match ? match[1] : null;
  }
}
