/**
 * Test-only JWT helper — creates and verifies JWTs using native Node.js crypto.
 * This avoids the jose webapi/browser-crypto incompatibility in jsdom.
 * NOT for production use.
 */
import { createHmac } from 'node:crypto';

const TEST_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';

function base64url(str: string): string {
  return Buffer.from(str).toString('base64url');
}

function base64urlToStr(b64: string): string {
  return Buffer.from(b64, 'base64url').toString('utf-8');
}

export function createTestJwt(payload: Record<string, unknown>, secret = TEST_SECRET): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iat: nowSec,
    exp: nowSec + 3600,
    ...payload,
  }));
  const signingInput = `${header}.${claims}`;
  const sig = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${sig}`;
}

export function createExpiredTestJwt(payload: Record<string, unknown>): string {
  const pastSec = Math.floor(Date.now() / 1000) - 3600;
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iat: pastSec - 3600,
    exp: pastSec,
    ...payload,
  }));
  const signingInput = `${header}.${claims}`;
  const sig = createHmac('sha256', TEST_SECRET)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${sig}`;
}

export function verifyTestJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const signingInput = `${parts[0]}.${parts[1]}`;
  const expectedSig = createHmac('sha256', TEST_SECRET)
    .update(signingInput)
    .digest('base64url');
  if (expectedSig !== parts[2]) return null;
  try {
    const payload = JSON.parse(base64urlToStr(parts[1]));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export { TEST_SECRET };
