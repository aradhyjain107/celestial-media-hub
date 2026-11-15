import { NextRequest, NextResponse } from 'next/server';
import { signToken, verifyToken } from '@/lib/jwt';

/**
 * Issues or reuses an anonymous session HS256 JWT so public web visitors
 * can invoke authenticated media routes and maintain isolated BOLA ownership
 * without requiring an explicit login wall.
 */
export async function GET(req: NextRequest) {
  const existingCookie = req.cookies.get('auth_token')?.value;
  if (existingCookie) {
    const payload = await verifyToken(existingCookie);
    if (payload && payload.sub) {
      return NextResponse.json(
        { token: existingCookie, userId: payload.sub },
        { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
      );
    }
  }

  const userId = `anon_${crypto.randomUUID()}`;
  const token = await signToken({ sub: userId, role: 'user' }, 86400);

  const isHttps =
    req.headers.get('x-forwarded-proto') === 'https' ||
    req.nextUrl.protocol === 'https:';

  const res = NextResponse.json(
    { token, userId },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  );

  res.cookies.set('auth_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: 86400,
  });

  return res;
}
