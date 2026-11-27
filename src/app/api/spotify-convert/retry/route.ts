import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { verifyAuth, verifyJobOwnership, registerJobOwner } from '../../../../lib/security/auth';
import { sanitizeError, resolveSafeSseMessage } from '../../../../lib/security/errors';
import { executeYtdlp, listCompletedMediaFiles } from '../../../../lib/media/ytdlp';
import { createJobDir, cleanupJobDir } from '../../../../lib/system/temp';
import { SpotifyInputSchema } from '../../../../schemas/spotify';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = verifyAuth(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    if (body.jobId && !verifyJobOwnership(body.jobId, session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rawTrackName = typeof body.trackName === 'string' ? body.trackName.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 200) : '';
    if (!rawTrackName) {
      return NextResponse.json({ ok: true, trackId: body.trackId });
    }

    const settingsCheck = SpotifyInputSchema.pick({ outputFormat: true, quality: true }).safeParse({
      outputFormat: body.format || body.outputFormat || 'mp3',
      quality: body.quality || '320',
    });
    if (!settingsCheck.success) {
      return NextResponse.json({ error: 'Invalid conversion settings' }, { status: 400 });
    }

    const retryJobId = randomUUID();
    registerJobOwner(retryJobId, session.userId);
    const retryDir = createJobDir(retryJobId);

    try {
      const { outputFormat, quality } = settingsCheck.data;
      const args = [
        '-P', retryDir,
        '-o', '%(title).120s [%(id)s].%(ext)s',
        '-x', '--audio-format', outputFormat, '--audio-quality', `${quality}K`,
      ];
      const stream = executeYtdlp(retryDir, `ytsearch1:${rawTrackName}`, args);
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        if (text.includes('"error"')) {
          throw new Error(text);
        }
      }

      const files = listCompletedMediaFiles(retryDir);
      if (files.length === 0) {
        cleanupJobDir(retryJobId);
        return NextResponse.json({ error: 'Retry failed to locate downloadable audio stream.' }, { status: 502 });
      }

      return NextResponse.json({
        ok: true,
        trackId: body.trackId,
        downloadUrl: `/api/download?jobId=${retryJobId}&file=${encodeURIComponent(files[0])}`,
        filename: files[0],
      });
    } catch (retryErr: unknown) {
      cleanupJobDir(retryJobId);
      const safeMsg = resolveSafeSseMessage(retryErr) ?? 'Track retry failed. Please try again.';
      return NextResponse.json({ error: safeMsg }, { status: 502 });
    }
  } catch (error: unknown) {
    const { error: msg, status } = sanitizeError(error, 'POST /api/spotify-convert/retry');
    return NextResponse.json({ error: msg }, { status });
  }
}
