import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { env } from './env';

export interface YtdlpPlaylistInfo {
  id: string;
  title: string;
  duration?: number;
}

export async function getPlaylistInfo(url: string): Promise<YtdlpPlaylistInfo[]> {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn(env.YTDLP_PATH, ['--dump-json', '--flat-playlist', url]);
    let output = '';
    ytdlp.stdout.on('data', chunk => output += chunk.toString());
    ytdlp.on('close', code => {
      if (code !== 0) return reject(new Error('yt-dlp failed to fetch playlist info'));
      try {
        const lines = output.trim().split('\n');
        const tracks = lines.filter(l => l.trim().length > 0).map(line => JSON.parse(line));
        resolve(tracks.map(t => ({
          id: t.id,
          title: t.title,
          duration: t.duration
        })));
      } catch (e) {
        reject(new Error('Failed to parse yt-dlp JSON'));
      }
    });
    ytdlp.on('error', err => reject(err));
  });
}

export function executeYtdlp(jobDir: string, url: string, args: string[]): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        const ytdlpArgs = [...args, '--newline', '--progress', url];
        const ytdlp = spawn(env.YTDLP_PATH, ytdlpArgs, { cwd: jobDir });
        
        let stderrLog = '';
        
        ytdlp.stdout.on('data', (chunk) => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            const match = line.match(/\[download\]\s+(\d+\.\d+)%/);
            if (match) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ progress: parseFloat(match[1]) })}\n\n`));
            }
          }
        });

        ytdlp.stderr.on('data', chunk => {
          stderrLog += chunk.toString();
        });

        await new Promise((resolve, reject) => {
          ytdlp.on('close', code => {
            if (code !== 0) {
              reject(new Error(`yt-dlp error: ${stderrLog.substring(0, 200)}`));
            } else {
              resolve(null);
            }
          });
          ytdlp.on('error', err => reject(err));
        });

        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ status: 'done' })}\n\n`));
      } catch (err: any) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
      } finally {
        if (fs.existsSync(jobDir)) {
          fs.rmSync(jobDir, { recursive: true, force: true });
        }
        controller.close();
      }
    }
  });
}
