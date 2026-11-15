import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyJobOwnership } from '../../../../lib/auth';
import { sanitizeError } from '../../../../lib/errors';

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
    return NextResponse.json({ ok: true, trackId: body.trackId });
  } catch (error: unknown) {
    const { error: msg, status } = sanitizeError(error, 'POST /api/spotify-convert/retry');
    return NextResponse.json({ error: msg }, { status });
  }
}
