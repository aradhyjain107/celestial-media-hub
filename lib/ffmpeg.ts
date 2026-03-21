import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { env } from './env';

export async function getMediaDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobePath = env.FFMPEG_PATH.replace('ffmpeg', 'ffprobe');
    const ffprobe = spawn(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', inputPath]);
    
    let output = '';
    ffprobe.stdout.on('data', chunk => output += chunk.toString());
    
    ffprobe.on('close', code => {
      if (code !== 0) return reject(new Error('ffprobe failed to parse executable.'));
      try {
        resolve(parseFloat(JSON.parse(output).format.duration));
      } catch (e) {
        reject(new Error('Failed to parse ffprobe duration.'));
      }
    });
    ffprobe.on('error', err => reject(err));
  });
}

export function executeFfmpeg(jobDir: string, inputPath: string, args: string[]): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        const duration = await getMediaDuration(inputPath);
        const ffmpegArgs = [...args, '-progress', 'pipe:1'];
        const ffmpeg = spawn(env.FFMPEG_PATH, ffmpegArgs);
        
        let stderrLog = '';
        
        ffmpeg.stdout.on('data', (chunk) => {
          const match = chunk.toString().match(/out_time_ms=(\d+)/);
          if (match) {
            const timeMs = parseInt(match[1], 10);
            const progress = Math.min(100, Math.max(0, (timeMs / 1000000 / duration) * 100));
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ progress: Math.round(progress) })}\n\n`));
          }
        });

        ffmpeg.stderr.on('data', chunk => {
          stderrLog += chunk.toString();
        });

        await new Promise((resolve, reject) => {
          ffmpeg.on('close', code => {
            if (code !== 0) {
              reject(new Error(`FFmpeg error: ${stderrLog.substring(0, 200)}`));
            } else {
              resolve(null);
            }
          });
          ffmpeg.on('error', err => reject(err));
        });

        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ status: 'done' })}\n\n`));
      } catch (err: any) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
      } finally {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(jobDir)) {
          fs.rmSync(jobDir, { recursive: true, force: true });
        }
        controller.close();
      }
    }
  });
}
