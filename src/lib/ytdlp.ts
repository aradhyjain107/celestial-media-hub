import cp, { type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';

function isTemporaryArtifact(filename: string): boolean {
  if (filename === 'output.zip' || filename.startsWith('.')) return true;
  if (
    filename.endsWith('.part') ||
    filename.endsWith('.ytdl') ||
    filename.endsWith('.tmp') ||
    filename.endsWith('.temp.mp4')
  ) {
    return true;
  }
  // Unmerged yt-dlp intermediate stream files like "video.f137.mp4" or "video.fdash-123v.mp4"
  if (/\.f[0-9A-Za-z_-]+\.(mp4|m4a|webm|mkv)$/i.test(filename)) {
    return true;
  }
  return false;
}

export function listCompletedMediaFiles(dir: string): string[] {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(dir)) return [];
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return fs.readdirSync(dir).filter((f) => {
      if (isTemporaryArtifact(f)) return false;
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const st = fs.statSync(path.join(dir, f));
        return st.isFile() && st.size > 0;
      } catch {
        return true;
      }
    });
  } catch {
    return [];
  }
}

function ensurePlayableMp4Files(dir: string): void {
  const ffmpegBin = env.FFMPEG_PATH || 'ffmpeg';
  const ffprobeBin = env.FFPROBE_PATH || (ffmpegBin.endsWith('/ffmpeg') ? ffmpegBin.replace(/\/ffmpeg$/, '/ffprobe') : 'ffprobe');
  const files = listCompletedMediaFiles(dir).filter((f) => f.toLowerCase().endsWith('.mp4'));

  for (const file of files) {
    const fullPath = path.join(dir, file);
    let videoCodec = '';
    let pixFmt = '';
    try {
      const probeOut = cp.execFileSync(
        ffprobeBin,
        [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'stream=codec_name,pix_fmt',
          '-of', 'default=noprint_wrappers=1:nokey=0',
          fullPath,
        ],
        { encoding: 'utf8', timeout: 10000 }
      );
      const codecMatch = probeOut.match(/codec_name=([^\r\n]+)/);
      const pixMatch = probeOut.match(/pix_fmt=([^\r\n]+)/);
      videoCodec = codecMatch ? codecMatch[1].trim() : '';
      pixFmt = pixMatch ? pixMatch[1].trim() : '';
    } catch {
      continue;
    }

    // QuickTime / Finder / iOS require h264 (yuv420p) inside .mp4; VP9/AV1 in .mp4 appears broken/corrupted
    if (videoCodec && (videoCodec !== 'h264' || (pixFmt && pixFmt !== 'yuv420p'))) {
      const tempOut = path.join(dir, `.reencode_${Date.now()}.temp.mp4`);
      try {
        cp.execFileSync(
          ffmpegBin,
          [
            '-y',
            '-i', fullPath,
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '20',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-movflags', '+faststart',
            tempOut,
          ],
          { timeout: 60000, stdio: 'ignore' }
        );
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(tempOut) && fs.statSync(tempOut).size > 0) {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          fs.renameSync(tempOut, fullPath);
        }
      } catch {
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
        } catch {}
      }
    }
  }
}

export interface YtdlpPlaylistInfo {
  id: string;
  title: string;
  duration?: number;
}

export interface YtdlpVideoInfo {
  title: string;
  thumbnail?: string;
  duration?: number;
}

export async function getVideoInfo(url: string): Promise<YtdlpVideoInfo> {
  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--no-playlist', '--no-warnings', '--socket-timeout', '5'];
    if (env.FFMPEG_PATH) {
      args.push('--ffmpeg-location', env.FFMPEG_PATH);
    }
    args.push('--', url);

    const ytdlp = cp.spawn(env.YTDLP_PATH, args);
    const timeout = setTimeout(() => {
      try {
        ytdlp.kill('SIGKILL');
      } catch {}
      reject(new Error('yt-dlp timed out fetching video info'));
    }, 8000);

    let output = '';
    ytdlp.stdout.on('data', chunk => output += chunk.toString());
    ytdlp.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error('yt-dlp failed to fetch video info'));
      try {
        const t = JSON.parse(output.trim());
        const isIg = url.includes('instagram.com') || url.includes('instagr.am');
        resolve({
          title: t.title || (typeof t.description === 'string' && t.description.trim() ? t.description.trim().slice(0, 80) : isIg ? 'Instagram Media' : t.title),
          thumbnail: t.thumbnail || t.thumbnails?.[0]?.url,
          duration: t.duration,
        });
      } catch (e) {
        reject(new Error('Failed to parse yt-dlp JSON'));
      }
    });
    ytdlp.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export async function getPlaylistInfo(url: string): Promise<YtdlpPlaylistInfo[]> {
  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--flat-playlist', '--no-warnings', '--socket-timeout', '5'];
    if (env.FFMPEG_PATH) {
      args.push('--ffmpeg-location', env.FFMPEG_PATH);
    }
    args.push('--', url);

    const ytdlp = cp.spawn(env.YTDLP_PATH, args);
    const timeout = setTimeout(() => {
      try {
        ytdlp.kill('SIGKILL');
      } catch {}
      reject(new Error('yt-dlp timed out fetching playlist info'));
    }, 8000);

    let output = '';
    ytdlp.stdout.on('data', chunk => output += chunk.toString());
    ytdlp.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error('yt-dlp failed to fetch playlist info'));
      try {
        const lines = output.trim().split('\n');
        const tracks = lines.filter(l => l.trim().length > 0).map(line => JSON.parse(line));
        const isIg = url.includes('instagram.com') || url.includes('instagr.am');
        resolve(tracks.map((t, idx) => ({
          id: t.id || String(idx + 1),
          title: t.title || (typeof t.description === 'string' && t.description.trim() ? t.description.trim().slice(0, 80) : isIg ? `Instagram Item #${idx + 1}` : t.title),
          duration: t.duration
        })));
      } catch (e) {
        reject(new Error('Failed to parse yt-dlp JSON'));
      }
    });
    ytdlp.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export function executeYtdlp(jobDir: string, url: string, args: string[]): ReadableStream {
  let ytdlpProc: ChildProcess | null = null;
  let hasExited = false;
  let isCancelled = false;
  let killTimer: NodeJS.Timeout | null = null;
  let exitPromiseResolve: (() => void) | null = null;
  const exitPromise = new Promise<void>((resolve) => {
    exitPromiseResolve = resolve;
  });

  const markExited = () => {
    if (!hasExited) {
      hasExited = true;
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      if (exitPromiseResolve) {
        exitPromiseResolve();
      }
    }
  };

  let terminatePromise: Promise<void> | null = null;
  const terminateProcess = (): Promise<void> => {
    if (hasExited) return Promise.resolve();
    if (!ytdlpProc) {
      return Promise.resolve();
    }
    if (!terminatePromise) {
      terminatePromise = (async () => {
        if (hasExited) return;
        if (ytdlpProc && typeof ytdlpProc.kill === 'function') {
          try {
            ytdlpProc.kill('SIGTERM');
          } catch {}

          killTimer = setTimeout(() => {
            if (!hasExited && ytdlpProc && typeof ytdlpProc.kill === 'function') {
              try {
                ytdlpProc.kill('SIGKILL');
              } catch {}
            }
          }, 500);

          if (killTimer && typeof killTimer.unref === 'function') {
            killTimer.unref();
          }
        } else {
          markExited();
        }

        await exitPromise;
      })();
    }
    return terminatePromise;
  };

  return new ReadableStream({
    async start(controller) {
      try {
        if (isCancelled) {
          markExited();
          return;
        }

        const filesBefore = new Set(listCompletedMediaFiles(jobDir));
        const isInstagram = url.includes('instagram.com') || url.includes('instagr.am');
        const ytdlpArgs = [...args];

        if (isInstagram) {
          if (!ytdlpArgs.includes('-i') && !ytdlpArgs.includes('--ignore-errors')) {
            ytdlpArgs.push('-i');
          }
          const outIdx = ytdlpArgs.indexOf('-o');
          if (outIdx !== -1 && outIdx + 1 < ytdlpArgs.length) {
            ytdlpArgs.splice(outIdx + 1, 1, '%(title).120s [%(id)s].%(ext)s');
          }
          const fmtIdx = ytdlpArgs.indexOf('-f');
          if (fmtIdx !== -1 && fmtIdx + 1 < ytdlpArgs.length && !ytdlpArgs.includes('-x')) {
            ytdlpArgs.splice(
              fmtIdx + 1,
              1,
              'best[format_id!*=dash][acodec!=none]/best[format_id!*=dash]+bestaudio/best[format_id!*=dash]/bestvideo[vcodec^=avc1]+bestaudio/bestvideo+bestaudio/best'
            );
          }
        }

        if (env.FFMPEG_PATH && !ytdlpArgs.includes('--ffmpeg-location')) {
          ytdlpArgs.push('--ffmpeg-location', env.FFMPEG_PATH);
        }
        if (!ytdlpArgs.includes('--socket-timeout')) {
          ytdlpArgs.push('--socket-timeout', '15');
        }
        if (!ytdlpArgs.includes('--retries')) {
          ytdlpArgs.push('--retries', '3');
        }
        if (!ytdlpArgs.includes('--extractor-retries')) {
          ytdlpArgs.push('--extractor-retries', '3');
        }
        ytdlpArgs.push('--no-warnings', '--newline', '--progress', '--', url);

        if (isCancelled) {
          markExited();
          return;
        }

        const ytdlp = cp.spawn(env.YTDLP_PATH, ytdlpArgs, { cwd: jobDir });
        ytdlpProc = ytdlp;

        ytdlp.on('error', () => {
          markExited();
          if (isCancelled) return;
        });
        ytdlp.stdin?.on('error', () => {});
        ytdlp.stdout?.on('error', () => {});
        ytdlp.stderr?.on('error', () => {});

        if (isCancelled) {
          await terminateProcess();
          return;
        }

        let activityTimer: NodeJS.Timeout | null = null;
        const resetActivityTimer = (ms = 45000) => {
          if (activityTimer) clearTimeout(activityTimer);
          activityTimer = setTimeout(() => {
            if (!hasExited && ytdlp) {
              try {
                ytdlp.kill('SIGKILL');
              } catch {}
            }
          }, ms);
        };
        resetActivityTimer(45000);
        
        let stderrLog = '';
        
        ytdlp.stdout?.on('data', (chunk) => {
          resetActivityTimer(45000);
          if (isCancelled) return;
          const lines = chunk.toString().split(/[\r\n]+/);
          for (const line of lines) {
            const match = line.match(/\[download\]\s+(\d+\.\d+)%/);
            if (match) {
              try {
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ progress: parseFloat(match[1]) })}\n\n`));
              } catch {}
            }
          }
        });

        ytdlp.stderr?.on('data', chunk => {
          resetActivityTimer(45000);
          stderrLog += chunk.toString();
        });

        ytdlp.stdout?.on('error', () => {});
        ytdlp.stderr?.on('error', () => {});

        ytdlp.on('exit', () => {
          if (activityTimer) clearTimeout(activityTimer);
          markExited();
        });

        await new Promise((resolve, reject) => {
          ytdlp.on('close', code => {
            if (activityTimer) clearTimeout(activityTimer);
            markExited();
            if (isCancelled) {
              resolve(null);
              return;
            }
            const filesAfter = listCompletedMediaFiles(jobDir);
            const downloadedNewFile = filesAfter.some((f) => !filesBefore.has(f));
            if (code !== 0 && !downloadedNewFile) {
              reject(new Error(`yt-dlp error: ${stderrLog.substring(0, 200) || 'process terminated'}`));
            } else {
              resolve(null);
            }
          });
          ytdlp.on('error', err => {
            if (activityTimer) clearTimeout(activityTimer);
            markExited();
            if (isCancelled) {
              resolve(null);
              return;
            }
            reject(err);
          });
        });

        if (!isCancelled) {
          ensurePlayableMp4Files(jobDir);
          try {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ status: 'done' })}\n\n`));
          } catch {}
        }
      } catch (err: any) {
        if (!isCancelled) {
          try {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
          } catch {}
        }
      } finally {
        markExited();
        try {
          controller.close();
        } catch {}
      }
    },
    async cancel(reason) {
      isCancelled = true;
      await terminateProcess();
    }
  });
}

