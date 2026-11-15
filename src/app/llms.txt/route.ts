import { NextRequest, NextResponse } from 'next/server';
import { getSiteUrl, prefersMarkdown, renderLlmsTxt } from '@/lib/agent/siteContent';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const siteUrl = getSiteUrl(req.nextUrl.origin);
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
