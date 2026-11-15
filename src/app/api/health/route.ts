import { NextResponse } from 'next/server';

const TOOL_ROUTES = [
  '/tools/hevc',
  '/tools/converter',
  '/tools/muter',
  '/tools/trimmer',
  '/tools/spotify',
  '/tools/youtube',
];

export async function GET() {
  const uptime = process.uptime();
  const memBytes = process.memoryUsage().rss;
  const memMB = Math.round(memBytes / 1024 / 1024);
  const timestamp = new Date().toISOString();

  // Build per-route status map (all are statically registered, so OK if server is up)
  const routes: Record<string, string> = {};
  for (const route of TOOL_ROUTES) {
    // eslint-disable-next-line security/detect-object-injection
    routes[route] = 'ok';
  }

  // Memory pressure check — warn if RSS > 1.2 GB
  const memStatus = memMB > 1200 ? 'warn' : 'ok';
  const overallStatus = memStatus === 'warn' ? 'degraded' : 'ok';

  const body = {
    status: overallStatus,
    uptime: Math.round(uptime * 10) / 10,
    memoryMB: memMB,
    memStatus,
    nodeVersion: process.version,
    nextVersion: '14.2.35',
    timestamp,
    routes,
  };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      // Never cache the health endpoint
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Celestial-Health': overallStatus,
    },
  });
}
