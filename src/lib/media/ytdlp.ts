import cp, { type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../system/env';

function isYoutubeUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'youtube.com' ||
      host === 'www.youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtu.be' ||
      host.endsWith('.youtube.com')
    );
  } catch {
    return false;
  }
}

function appendFfmpegLocationIfExplicit(args: string[]): void {
  const ffmpegLoc = env.FFMPEG_PATH?.trim();
  if (!ffmpegLoc || args.includes('--ffmpeg-location')) return;
  args.push('--ffmpeg-location', ffmpegLoc);
}

function appendOptionalRuntimeArgs(args: string[]): void {
  if (!args.includes('--ignore-config')) {
    args.push('--ignore-config');
  }
  const cookiesPath = process.env.YTDLP_COOKIES_PATH?.trim();
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (cookiesPath && fs.existsSync(cookiesPath) && !args.includes('--cookies')) {
    args.push('--cookies', cookiesPath);
  }
  const proxyUrl = process.env.YTDLP_PROXY?.trim();
  if (proxyUrl && !args.includes('--proxy')) {
    args.push('--proxy', proxyUrl);
  }
}

function classifyYtdlpFailureCode(stderrLog: string): string | null {
  const lower = stderrLog.toLowerCase();
  if (
    lower.includes('sign in to confirm') ||
    lower.includes('not a bot') ||
    lower.includes('bot verification')
  ) {
    return 'YOUTUBE_BOT_CHECK';
  }
  if (
    lower.includes('sign in to confirm your age') ||
    lower.includes('age-restricted') ||
    lower.includes('members-only')
  ) {
    return 'AGE_RESTRICTED';
  }
  if (
    lower.includes('video unavailable') ||
    lower.includes('private video') ||
    lower.includes('this video has been removed') ||
    lower.includes('not available in your country') ||
    lower.includes('copyright')
  ) {
    return 'MEDIA_UNAVAILABLE';
  }
  if (lower.includes('http error 429') || lower.includes('too many requests')) {
    return 'YOUTUBE_RATE_LIMIT';
  }
  if (lower.includes('requested format is not available') || lower.includes('only images are available')) {
    return 'FORMAT_UNAVAILABLE';
  }
  if (lower.includes('postprocessing:') || lower.includes('ffprobe and ffmpeg not found')) {
    return 'POSTPROCESS_FAILED';
  }
  if (lower.includes('timed out')) {
    return 'UPSTREAM_TIMEOUT';
  }
  if (lower.includes('http error 403') || lower.includes('unable to extract') || lower.includes('connection reset')) {
    return 'NETWORK_ERROR';
  }
  return null;
}

function isRetryableYoutubeClientError(stderrLog: string): boolean {
  const lower = stderrLog.toLowerCase();
  return (
    lower.includes('sign in to confirm') ||
    lower.includes('not a bot') ||
    lower.includes('http error 403') ||
    lower.includes('requested format is not available') ||
    lower.includes('failed to extract any player response') ||
    lower.includes('no supported javascript runtime')
  );
}

async function fetchYoutubeOembedFallback(url: string): Promise<YtdlpVideoInfo | null> {
  if (!isYoutubeUrl(url)) return null;
  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data.title === 'string' && data.title.trim()) {
      return {
        title: data.title.trim(),
        thumbnail: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : undefined,
      };
    }
  } catch {
    // Ignore oEmbed network errors cleanly
  }
  return null;
}

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
  try {
    return await new Promise<YtdlpVideoInfo>((resolve, reject) => {
      const args = ['--dump-json', '--no-playlist', '--no-warnings', '--socket-timeout', '10'];
      appendOptionalRuntimeArgs(args);
      appendFfmpegLocationIfExplicit(args);
      args.push('--', url);

      const ytdlp = cp.spawn(env.YTDLP_PATH, args);
      const timeout = setTimeout(() => {
        try {
          ytdlp.kill('SIGKILL');
        } catch {}
        reject(new Error('yt-dlp timed out fetching video info'));
      }, 20000);

      let output = '';
      let stderr = '';
      ytdlp.stdout.on('data', chunk => output += chunk.toString());
      ytdlp.stderr?.on('data', chunk => stderr += chunk.toString());
      ytdlp.on('close', code => {
        clearTimeout(timeout);
        if (code !== 0) {
          return reject(new Error(`yt-dlp failed to fetch video info${stderr ? `: ${stderr.slice(0, 180)}` : ''}`));
        }
        try {
          const t = JSON.parse(output.trim());
          const isIg = url.includes('instagram.com') || url.includes('instagr.am');
          resolve({
            title: t.title || (typeof t.description === 'string' && t.description.trim() ? t.description.trim().slice(0, 80) : isIg ? 'Instagram Media' : t.title),
            thumbnail: t.thumbnail || t.thumbnails?.[0]?.url,
            duration: t.duration,
          });
        } catch {
          reject(new Error('Failed to parse yt-dlp JSON'));
        }
      });
      ytdlp.on('error', err => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  } catch (err) {
    const oembedFallback = await fetchYoutubeOembedFallback(url);
    if (oembedFallback) {
      return oembedFallback;
    }
    throw err;
  }
}

export async function getPlaylistInfo(url: string): Promise<YtdlpPlaylistInfo[]> {
  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--flat-playlist', '--no-warnings', '--socket-timeout', '10'];
    appendOptionalRuntimeArgs(args);
    appendFfmpegLocationIfExplicit(args);
    args.push('--', url);

    const ytdlp = cp.spawn(env.YTDLP_PATH, args);
    const timeout = setTimeout(() => {
      try {
        ytdlp.kill('SIGKILL');
      } catch {}
      reject(new Error('yt-dlp timed out fetching playlist info'));
    }, 25000);

    let output = '';
    let stderr = '';
    ytdlp.stdout.on('data', chunk => output += chunk.toString());
    ytdlp.stderr?.on('data', chunk => stderr += chunk.toString());
    ytdlp.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) {
        return reject(new Error(`yt-dlp failed to fetch playlist info${stderr ? `: ${stderr.slice(0, 180)}` : ''}`));
      }
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
        const baseArgs = [...args];

        if (isInstagram) {
          if (!baseArgs.includes('-i') && !baseArgs.includes('--ignore-errors')) {
            baseArgs.push('-i');
          }
          const outIdx = baseArgs.indexOf('-o');
          if (outIdx !== -1 && outIdx + 1 < baseArgs.length) {
            baseArgs.splice(outIdx + 1, 1, '%(title).120s [%(id)s].%(ext)s');
          }
          const fmtIdx = baseArgs.indexOf('-f');
          if (fmtIdx !== -1 && fmtIdx + 1 < baseArgs.length && !baseArgs.includes('-x')) {
            baseArgs.splice(
              fmtIdx + 1,
              1,
              'best[format_id!*=dash][acodec!=none]/best[format_id!*=dash]+bestaudio/best[format_id!*=dash]/bestvideo[vcodec^=avc1]+bestaudio/bestvideo+bestaudio/best'
            );
          }
        }

        appendOptionalRuntimeArgs(baseArgs);
        appendFfmpegLocationIfExplicit(baseArgs);
        if (!baseArgs.includes('--socket-timeout')) {
          baseArgs.push('--socket-timeout', '15');
        }
        if (!baseArgs.includes('--retries')) {
          baseArgs.push('--retries', '3');
        }
        if (!baseArgs.includes('--extractor-retries')) {
          baseArgs.push('--extractor-retries', '3');
        }
        baseArgs.push('--no-warnings', '--newline', '--progress');

        const runAttempt = async (extraArgs: string[]): Promise<{ stderrLog: string; timedOut: boolean }> => {
          if (isCancelled) {
            markExited();
            return { stderrLog: '', timedOut: false };
          }
          hasExited = false;
          terminatePromise = null;
          const attemptArgs = [...baseArgs, ...extraArgs, '--', url];
          const ytdlp = cp.spawn(env.YTDLP_PATH, attemptArgs, { cwd: jobDir });
          ytdlpProc = ytdlp;

          let timedOut = false;
          let activityTimer: NodeJS.Timeout | null = null;
          const resetActivityTimer = (ms = 90000) => {
            if (activityTimer) clearTimeout(activityTimer);
            activityTimer = setTimeout(() => {
              if (!hasExited && ytdlp) {
                timedOut = true;
                try {
                  ytdlp.kill('SIGKILL');
                } catch {}
              }
            }, ms);
          };
          resetActivityTimer(90000);

          let stderrLog = '';

          ytdlp.stdin?.on('error', () => {});
          ytdlp.stdout?.on('data', (chunk) => {
            resetActivityTimer(90000);
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
          ytdlp.stderr?.on('data', (chunk) => {
            resetActivityTimer(90000);
            stderrLog += chunk.toString();
          });
          ytdlp.stdout?.on('error', () => {});
          ytdlp.stderr?.on('error', () => {});

          ytdlp.on('exit', () => {
            if (activityTimer) clearTimeout(activityTimer);
            markExited();
          });

          if (isCancelled) {
            await terminateProcess();
            return { stderrLog, timedOut };
          }

          await new Promise<void>((resolve, reject) => {
            ytdlp.on('close', (code) => {
              if (activityTimer) clearTimeout(activityTimer);
              markExited();
              if (isCancelled) {
                resolve();
                return;
              }
              const filesAfter = listCompletedMediaFiles(jobDir);
              const downloadedNewFile = filesAfter.some((f) => !filesBefore.has(f));
              if (code !== 0 && !downloadedNewFile) {
                const detail = timedOut ? 'yt-dlp timed out waiting for upstream media' : stderrLog.substring(0, 220) || 'process terminated';
                reject(Object.assign(new Error(`yt-dlp error: ${detail}`), { stderrLog: timedOut ? `${stderrLog}\ntimed out` : stderrLog }));
              } else {
                resolve();
              }
            });
            ytdlp.on('error', (err) => {
              if (activityTimer) clearTimeout(activityTimer);
              markExited();
              if (isCancelled) {
                resolve();
                return;
              }
              reject(err);
            });
          });

          return { stderrLog, timedOut };
        };

        try {
          await runAttempt([]);
        } catch (firstErr: unknown) {
          const firstStderr =
            (firstErr && typeof firstErr === 'object' && 'stderrLog' in firstErr
              ? String((firstErr as { stderrLog?: string }).stderrLog ?? '')
              : '') ||
            (firstErr instanceof Error ? firstErr.message : '');

          if (!isCancelled && isYoutubeUrl(url) && isRetryableYoutubeClientError(firstStderr)) {
            try {
              await runAttempt(['--extractor-args', 'youtube:player_client=tv_simply,android_vr,web_embedded']);
            } catch (retryErr: unknown) {
              const retryStderr =
                (retryErr && typeof retryErr === 'object' && 'stderrLog' in retryErr
                  ? String((retryErr as { stderrLog?: string }).stderrLog ?? '')
                  : '') || firstStderr;
              const code = classifyYtdlpFailureCode(`${firstStderr}\n${retryStderr}`);
              if (code) {
                throw new Error(`[SAFE:${code}] ${retryErr instanceof Error ? retryErr.message : 'yt-dlp failed'}`);
              }
              throw retryErr;
            }
          } else {
            const code = classifyYtdlpFailureCode(firstStderr);
            if (code) {
              throw new Error(`[SAFE:${code}] ${firstErr instanceof Error ? firstErr.message : 'yt-dlp failed'}`);
            }
            throw firstErr;
          }
        }

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

