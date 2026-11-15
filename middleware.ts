import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from './lib/auth';
import { checkRateLimit, classifyRouteGroup, RATE_LIMIT_GROUPS } from './lib/ratelimit';

export const config = {
  matcher: ['/api/:path*'],
};

// Public endpoints that bypass global auth (e.g. health check endpoints)
const PUBLIC_API_ROUTES = new Set<string>([
  '/api/health',
  '/api/status',
  '/api/system/hardware',
]);

/**
 * Extracts the best available client identifier for rate limiting.
 * Prefers the real IP from trusted proxy headers, falls back to socket IP.
 */
function getClientIp(req: NextRequest): string {
  // Vercel / Cloudflare / AWS headers (set by trusted infrastructure)
  const ip =
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    '127.0.0.1';  // fallback for local dev
  return ip;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── CORS & Preflight (OPTIONS) ─────────────────────────────────────────
  const origin = req.headers.get('origin');
  const allowedOrigin = process.env.ALLOWED_ORIGIN || req.nextUrl.origin;

  if (req.method === 'OPTIONS') {
    // If request has an Origin header that doesn't match allowed origin, reject CORS preflight (403)
    if (origin && origin !== allowedOrigin) {
      return NextResponse.json({ error: 'CORS policy violation: Origin not allowed' }, { status: 403 });
    }

    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin, Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site',
      },
    });
  }

  // ── Fetch Metadata Resource Isolation (Sec-Fetch-*) ────────────────────
  // Reject unexpected cross-site API requests before rate-limiting or auth checks
  const fetchSite = req.headers.get('sec-fetch-site');
  const fetchMode = req.headers.get('sec-fetch-mode');
  const fetchDest = req.headers.get('sec-fetch-dest');
  if (
    fetchSite === 'cross-site' &&
    !(origin && origin === allowedOrigin) &&
    !(fetchMode === 'navigate' && req.method === 'GET' && !['object', 'embed'].includes(fetchDest || ''))
  ) {
    const forbidden = NextResponse.json(
      { error: 'Forbidden cross-site API request' },
      { status: 403 }
    );
    forbidden.headers.set('Vary', 'Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site');
    return forbidden;
  }


  // Allow public API routes
  if (PUBLIC_API_ROUTES.has(pathname)) {
    const publicRes = NextResponse.next();
    publicRes.headers.set('Vary', 'Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site');
    return publicRes;
  }


  // ── Rate Limiting (R7) ──────────────────────────────────────────────────
  // Applied BEFORE auth to protect against credential-stuffing / DoS.
  // Key: ip:routeGroup — isolates limits per-client and per-endpoint-class.
  const clientIp = getClientIp(req);
  const routeGroup = classifyRouteGroup(pathname);

  // Isolate internal loopback monitoring daemon requests into their own high-capacity bucket
  // so health probes do not exhaust real user rate limit quotas on localhost.
  const isInternalMonitoring =
    (clientIp === '127.0.0.1' || clientIp === '::1') &&
    req.headers.get('x-monitoring-agent') === 'true';

  const rateLimitKey = isInternalMonitoring
    ? `internal-monitoring:${routeGroup}`
    : `${clientIp}:${routeGroup}`;

  const rateLimitConfig = isInternalMonitoring
    ? { limit: 1000, windowMs: 60_000 }
    : RATE_LIMIT_GROUPS[routeGroup];

  const rateLimit = checkRateLimit(rateLimitKey, rateLimitConfig);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Please wait ${rateLimit.retryAfter} second(s) before retrying.`,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfter ?? 60),
          'X-RateLimit-Limit': String(rateLimitConfig.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateLimit.resetAt),
        },
      }
    );
  }

  // ── Strip incoming untrusted client identity headers ────────────────────
  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete('x-user-id');
  requestHeaders.delete('x-user-role');
  requestHeaders.delete('x-user-email');

  // Allow rate-limited anonymous session bootstrap endpoint to issue initial JWTs
  if (pathname === '/api/auth/session') {
    const sessionRes = NextResponse.next({
      request: { headers: requestHeaders },
    });
    sessionRes.headers.set('Vary', 'Origin, Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site');
    return sessionRes;
  }

  // ── Authentication (R1) ─────────────────────────────────────────────────
  const session = verifyAuth(req);
  if (!session) {
    return NextResponse.json(
      {
        error: 'Unauthorized',
        message: 'Authentication required to access Celestial Media Hub API endpoints.',
      },
      { status: 401 }
    );
  }

  // ── Inject verified identity headers ────────────────────────────────────
  requestHeaders.set('x-user-id', session.userId);
  requestHeaders.set('x-user-role', session.role);
  if (session.email) {
    requestHeaders.set('x-user-email', session.email);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Expose rate limit state to clients on allowed responses
  response.headers.set('X-RateLimit-Limit', String(rateLimitConfig.limit));
  response.headers.set('X-RateLimit-Remaining', String(rateLimit.remaining));
  response.headers.set('X-RateLimit-Reset', String(rateLimit.resetAt));

  // Propagate verified identity to response headers
  response.headers.set('x-user-id', session.userId);
  response.headers.set('x-user-role', session.role);
  if (session.email) {
    response.headers.set('x-user-email', session.email);
  }

  // Set Access-Control-Allow-Origin and Fetch Metadata Vary headers on actual responses
  response.headers.set('Vary', 'Origin, Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site');
  if (origin && origin === allowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  } else if (!origin) {
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  }

  return response;

}
