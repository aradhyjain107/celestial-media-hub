import { NextRequest, NextResponse } from 'next/server';
import { getSiteUrl, prefersMarkdown, renderLlmsTxt } from '@/lib/agent/siteContent';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  const requestOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : req.nextUrl.origin;
  const siteUrl = getSiteUrl(requestOrigin);
  const body = renderLlmsTxt(siteUrl);
  const contentType = prefersMarkdown(req.headers.get('accept'))
    ? 'text/markdown; charset=utf-8'
    : 'text/plain; charset=utf-8';

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Vary': 'Accept',
      'Cache-Control': 'public, max-age=300, must-revalidate',
    },
  });
}
