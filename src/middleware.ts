import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from './lib/security/auth';
import { checkRateLimit, classifyRouteGroup, RATE_LIMIT_GROUPS } from './lib/security/ratelimit';
import {
  STATIC_OR_MACHINE_PATHS,
  getPageMarkdown,
  isKnownNonApiPath,
  normalizePagePath,
  prefersMarkdown,
  renderNotFoundMarkdown,
} from './lib/agent/siteContent';

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon\\.svg|upi-qr\\.png|og-image\\.png|bootstrap-guard\\.js|hardware-probe-worker\\.js).*)',
  ],
};

// Public endpoints that bypass global auth (e.g. health check endpoints)
const PUBLIC_API_ROUTES = new Set<string>([
  '/api/health',
  '/api/system/hardware',
]);

/**
 * Extracts the best available client identifier for rate limiting.
 * Prefers Cloudflare's verified header, then the rightmost proxy-appended hop
 * of X-Forwarded-For (preventing client spoofing of leftmost XFF entries),
 * falling back to X-Real-IP and local loopback.
 */
function getClientIp(req: NextRequest): string {
  const cfIp = req.headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;

  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map(part => part.trim()).filter(Boolean);
    if (hops.length > 0) {
      return hops[hops.length - 1];
    }
  }

  return req.headers.get('x-real-ip')?.trim() || '127.0.0.1';
}

function handleAgentContentNegotiation(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const normalizedPath = normalizePagePath(pathname);
  const acceptHeader = req.headers.get('accept');

  // Let machine-readable endpoints & static files handle their own Content-Type
  if (STATIC_OR_MACHINE_PATHS.has(normalizedPath)) {
    return NextResponse.next();
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && prefersMarkdown(acceptHeader)) {
    const markdown = getPageMarkdown(normalizedPath);
    if (markdown) {
      return new NextResponse(req.method === 'HEAD' ? null : markdown, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Vary': 'Accept',
          'Cache-Control': 'public, max-age=0, must-revalidate',
        },
      });
    }

    if (!isKnownNonApiPath(normalizedPath)) {
      return new NextResponse(
        req.method === 'HEAD' ? null : renderNotFoundMarkdown(pathname),
        {
          status: 404,
          headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Vary': 'Accept',
            'Cache-Control': 'no-store',
          },
        }
      );
    }
  }

  const res = NextResponse.next();
  const existingVary = res.headers.get('Vary');
  if (!existingVary) {
    res.headers.set('Vary', 'Accept');
  } else if (!existingVary.toLowerCase().includes('accept')) {
    res.headers.set('Vary', `${existingVary}, Accept`);
  }
  return res;
}

function isValidHostHeader(raw: string): boolean {
  const parts = raw.split(':');
  if (parts.length > 2) return false;
  const host = parts[0];
  const port = parts[1];
  if (!host || !/^[a-zA-Z0-9.-]+$/.test(host)) return false;
  if (port !== undefined && !/^\d{1,5}$/.test(port)) return false;
  return true;
}

function isBindOrLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === '0.0.0.0' || h === '::' || h === '[::]' || h === '127.0.0.1' || h === 'localhost';
}

function resolveRequestOrigin(req: NextRequest): string {
  const trustProxyHeaders =
    process.env.TRUST_PROXY === 'true' ||
    process.env.RENDER === 'true' ||
    isBindOrLoopbackHost(req.nextUrl.hostname);

  if (trustProxyHeaders) {
    const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    if (forwardedHost && isValidHostHeader(forwardedHost)) {
      const rawProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
      const proto = rawProto === 'http' || rawProto === 'https'
        ? rawProto
        : req.nextUrl.protocol.replace(':', '') || 'https';
      return `${proto}://${forwardedHost}`;
    }
  }
  return req.nextUrl.origin;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname !== '/api' && !pathname.startsWith('/api/')) {
    return handleAgentContentNegotiation(req);
  }

  // ── CORS & Preflight (OPTIONS) ─────────────────────────────────────────
  const origin = req.headers.get('origin');
  const configuredOrigin = (
    process.env.ALLOWED_ORIGIN?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    ''
  ).replace(/\/+$/, '');
  const allowedOrigin = configuredOrigin || resolveRequestOrigin(req);

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
  const isSafeCrossSiteNavigation =
    fetchMode === 'navigate' &&
    req.method === 'GET' &&
    !pathname.startsWith('/api/experimental/') &&
    !['object', 'embed'].includes(fetchDest || '');

  if (
    fetchSite === 'cross-site' &&
    !(origin && origin === allowedOrigin) &&
    !isSafeCrossSiteNavigation
  ) {
    const forbidden = NextResponse.json(
      { error: 'Forbidden cross-site API request' },
      { status: 403 }
    );
    forbidden.headers.set('Vary', 'Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site');
    return forbidden;
  }

  const clientIp = getClientIp(req);

  // Rate-limited public API routes (health & hardware telemetry)
  if (PUBLIC_API_ROUTES.has(pathname)) {
    const pubLimit = checkRateLimit(`${clientIp}:public`, { limit: 120, windowMs: 60_000 });
    if (!pubLimit.allowed) {
      return NextResponse.json(
        { error: 'Too Many Requests' },
        { status: 429, headers: { 'Retry-After': String(pubLimit.retryAfter ?? 60) } }
      );
    }
    const publicRes = NextResponse.next();
    publicRes.headers.set('Vary', 'Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site');
    return publicRes;
  }


  // ── Rate Limiting (R7) ──────────────────────────────────────────────────
  // Applied BEFORE auth to protect against credential-stuffing / DoS.
  // Key: ip:routeGroup — isolates limits per-client and per-endpoint-class.
  const routeGroup = classifyRouteGroup(pathname);

  // Isolate authenticated internal monitoring daemon requests only when a server secret is configured
  const monitoringSecret = process.env.MONITORING_SECRET?.trim();
  const isInternalMonitoring =
    Boolean(monitoringSecret) &&
    req.headers.get('x-monitoring-secret') === monitoringSecret;

  const rateLimitKey = isInternalMonitoring
    ? `internal-monitoring:${routeGroup}`
    : `${clientIp}:${routeGroup}`;

  const rateLimitConfig = isInternalMonitoring
    ? { limit: 1000, windowMs: 60_000 }
    : (Object.entries(RATE_LIMIT_GROUPS).find(([group]) => group === routeGroup)?.[1] ?? RATE_LIMIT_GROUPS.standard);

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
