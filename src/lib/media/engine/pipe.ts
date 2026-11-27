import { spawn } from 'node:child_process';
import { PassThrough, Readable } from 'node:stream';
import { env } from '../../system/env';

interface StreamSource {
  url: string;
  type: 'video' | 'audio';
  contentLength?: number;
}

export interface PipeOptions {
  outputFormat: 'mp4' | 'mkv' | 'mp3';
  onProgress?: (percent: number) => void;
}

/**
 * CelestialStreamer
 * 
 * The core engine for zero-copy media muxing.
 * Pipes raw streams directly from source to user without disk writes.
 */
export class CelestialStreamer {
  private ffmpegPath: string;

  constructor() {
    this.ffmpegPath = env.FFMPEG_PATH || 'ffmpeg';
  }

  /**
   * Muxes multiple input streams into a single output stream.
   * Uses fragmented MP4 (fMP4) for instant browser-side playback.
   */
  public mux(sources: StreamSource[], options: PipeOptions): Readable {
    const output = new PassThrough();

    // Prepare FFmpeg arguments
    // We use extra pipes (3, 4, etc.) to handle multiple inputs concurrently
    const args: string[] = [];
    
    sources.forEach((source, index) => {
      args.push('-i', `pipe:${3 + index}`);
    });

    // Output configuration
    if (sources.length > 1) {
      sources.forEach((_, index) => {
        args.push('-map', `${index}`);
      });
    } else {
      args.push('-map', '0');
    }

    if (options.outputFormat === 'mp4') {
      args.push(
        '-c', 'copy', 
        '-f', 'mp4',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof'
      );
    } else if (options.outputFormat === 'mkv') {
      args.push('-c', 'copy', '-f', 'matroska');
    } else if (options.outputFormat === 'mp3') {
      args.push('-c:a', 'libmp3lame', '-f', 'mp3');
    }

    args.push('pipe:1');

    // Spawn FFmpeg with additional pipes for inputs
    const stdio: any[] = ['ignore', 'pipe', 'pipe']; // stdin, stdout, stderr
    sources.forEach(() => stdio.push('pipe')); // Add a pipe for each input source

    const ffmpeg = spawn(this.ffmpegPath, args, { stdio });

    const killFfmpeg = () => {
      if (!ffmpeg.killed) {
        try {
          ffmpeg.kill('SIGTERM');
        } catch {}
        const killTimer = setTimeout(() => {
          if (!ffmpeg.killed) {
            try {
              ffmpeg.kill('SIGKILL');
            } catch {}
          }
        }, 500);
        if (typeof killTimer.unref === 'function') {
          killTimer.unref();
        }
      }
    };

    output.on('close', killFfmpeg);
    output.on('error', killFfmpeg);

    ffmpeg.on('error', (err) => {
      console.error(`FFmpeg Pipe Spawn Error:`, err);
      output.emit('error', err);
    });

    // Handle inputs
    sources.forEach((source, index) => {
      const inputPipe = ffmpeg.stdio[3 + index] as any;
      if (inputPipe) {
        inputPipe.on?.('error', (err: any) => {
          console.warn(`[TURBO] Input pipe ${3 + index} error:`, err);
        });
      }
      
      // In a real implementation, we would initiate the HTTP request here
      // and pipe the response body into this inputPipe.
      this.initiateSourceDownload(source, inputPipe, options, () => ffmpeg.killed || output.destroyed);
    });

    // Handle output with backpressure
    ffmpeg.stdout.pipe(output);

    // Handle errors and logging
    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
      // Optional: Parse FFmpeg progress logs here for more granular feedback
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0 && !ffmpeg.killed) {
        console.error(`FFmpeg Pipe Error: ${stderr}`);
        output.emit('error', new Error(`FFmpeg failed with code ${code}`));
      }
    });

    return output;
  }

  /**
   * Placeholder for the Turbo-Parallel Downloader.
   * This will eventually use lib/engine/downloader.ts
   */
  private isSafeStreamUrl(rawUrl: string): boolean {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host === '[::1]' ||
        host === '0.0.0.0' ||
        host === '169.254.169.254' ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async initiateSourceDownload(
    source: StreamSource, 
    targetPipe: any,
    options: PipeOptions,
    isCancelled?: () => boolean
  ) {
    try {
      if (!this.isSafeStreamUrl(source.url)) {
        throw new Error(`Blocked unsafe upstream stream URL for ${source.type}`);
      }
      console.log(`[TURBO] Connecting to ${source.type} stream...`);
      const response = await fetch(source.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
          'Connection': 'keep-alive',
        }
      });

      if (!response.ok) {
        throw new Error(`Stream fetch failed: ${response.status} ${response.statusText}`);
      }
      
      if (!response.body) throw new Error(`No body for ${source.type} stream`);

      const reader = response.body.getReader();
      
      let receivedLength = 0;
      while (true) {
        if (isCancelled?.() || targetPipe.destroyed) break;
        const { done, value } = await reader.read();
        if (done) break;
        if (isCancelled?.() || targetPipe.destroyed) break;
        
        const chunk = Buffer.from(value);
        const canContinue = targetPipe.write(chunk);
        if (!canContinue) {
          await new Promise<void>((resolve) => {
            const onDrain = () => {
              cleanup();
              resolve();
            };
            const onError = () => {
              cleanup();
              resolve();
            };
            const cleanup = () => {
              targetPipe.removeListener?.('drain', onDrain);
              targetPipe.removeListener?.('error', onError);
              targetPipe.removeListener?.('close', onError);
            };
            targetPipe.once?.('drain', onDrain);
            targetPipe.once?.('error', onError);
            targetPipe.once?.('close', onError);
          });
        }
        receivedLength += value.length;

        // Optional: report progress back to the UI
        if (source.contentLength && options.onProgress) {
          options.onProgress((receivedLength / source.contentLength) * 100);
        }
      }
      
      targetPipe.end();
      console.log(`[TURBO] Finished streaming ${source.type}`);
    } catch (err) {
      console.error(`[TURBO] Source pipe failed: ${source.type}`, err);
      if (targetPipe && typeof targetPipe.destroy === 'function') {
        targetPipe.destroy(err as any);
      }
    }
  }
}
