/* eslint-disable security/detect-object-injection */
/**
 * JWT helpers — sign and verify tokens using HS256.
 *
 * Uses the Web Crypto API (`crypto.subtle`) for native Next.js Edge Runtime,
 * Node.js, and browser compatibility with zero Node.js native crypto dependencies.
 * Also provides synchronous verification via pure JavaScript HMAC-SHA256.
 *
 * Usage:
 *   const token = await signToken({ sub: 'user-123', role: 'user' });
 *   const payload = await verifyToken(token);  // null if invalid/expired
 */

export interface CelestialTokenPayload {
  sub: string;       // userId
  role: 'user' | 'admin';
  email?: string;
  iat?: number;
  exp?: number;
  [key: string]: any;
}

const defaultDevSecret = 'dev-secret-key-min-32-chars-long-security-token';

/** Returns the raw JWT secret string. */
function getSecretKey(): string {
  const secret = process.env.JWT_SECRET || (process.env.NODE_ENV !== 'production' ? defaultDevSecret : undefined);
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long.');
  }
  return secret;
}

function base64UrlEncode(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf-8').toString('base64url');
  }
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(b64url: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64url, 'base64url').toString('utf-8');
  }
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function base64UrlToUint8Array(b64url: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64url, 'base64url'));
  }
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bufferToBase64Url(buf: ArrayBuffer): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buf).toString('base64url');
  }
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getWebCryptoKey(secret: string, usages: ('sign' | 'verify')[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto API (crypto.subtle) is not available in the current environment.');
  }
  return await subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages
  );
}

/**
 * Sign a new JWT token with HS256 using the Web Crypto API.
 * @param payload  Custom claims to embed (sub and role are required).
 * @param ttlSecs  Token lifetime in seconds (default: 86400 = 24 hours).
 */
export async function signToken(
  payload: Omit<CelestialTokenPayload, 'iat' | 'exp'>,
  ttlSecs: number = 86400
): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const claims: CelestialTokenPayload = {
    sub: payload.sub,
    role: payload.role,
    ...payload,
    iat: nowSec,
    exp: nowSec + ttlSecs,
  };

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${header}.${body}`;

  const key = await getWebCryptoKey(getSecretKey(), ['sign']);
  const enc = new TextEncoder();
  const sigBuffer = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(signingInput));
  const sig = bufferToBase64Url(sigBuffer);

  return `${signingInput}.${sig}`;
}

/**
 * Verify a JWT token and return its payload using the Web Crypto API.
 * Returns null if the token is invalid, expired, or uses an unsupported algorithm.
 */
export async function verifyToken(token: string): Promise<CelestialTokenPayload | null> {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    // 1. Decode and validate the header
    const headerStr = base64UrlDecode(parts[0]);
    const header = JSON.parse(headerStr);
    if (header.alg !== 'HS256' || String(header.alg).toLowerCase() === 'none') {
      return null;
    }

    // 2. Verify signature with Web Crypto API
    const signingInput = `${parts[0]}.${parts[1]}`;
    const key = await getWebCryptoKey(getSecretKey(), ['verify']);
    const enc = new TextEncoder();
    const sigBytes = base64UrlToUint8Array(parts[2]);
    const isValid = await globalThis.crypto.subtle.verify('HMAC', key, sigBytes as BufferSource, enc.encode(signingInput));
    if (!isValid) return null;

    // 3. Decode and validate the payload
    const payloadStr = base64UrlDecode(parts[1]);
    const payload = JSON.parse(payloadStr) as CelestialTokenPayload;

    // 4. Check expiration
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp !== undefined && payload.exp < nowSec) return null;

    // 5. Require 'sub' claim
    if (!payload.sub) return null;

    return payload;
  } catch {
    return null;
  }
}

// ── Pure JS SHA-256 and HMAC-SHA256 for Synchronous Verification ────────────────

function sha256Bytes(data: Uint8Array): Uint8Array {
  function ror(v: number, n: number): number {
    return (v >>> n) | (v << (32 - n));
  }
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  const l = data.length;
  const bitLen = l * 8;
  const newLen = ((l + 9 + 63) >>> 6) << 6;
  const buf = new Uint8Array(newLen);
  buf.set(data);
  buf[l] = 0x80;

  const view = new DataView(buf.buffer);
  view.setUint32(newLen - 4, bitLen >>> 0, false);
  view.setUint32(newLen - 8, Math.floor(bitLen / 0x100000000), false);

  const W = new Int32Array(64);

  for (let i = 0; i < newLen; i += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] = view.getInt32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = ror(W[t - 15], 7) ^ ror(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = ror(W[t - 2], 17) ^ ror(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }

    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];

    for (let t = 0; t < 64; t++) {
      const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
      const ch = (e & f) ^ ((~e) & g);
      const temp1 = (h + S1 + ch + K[t] + W[t]) | 0;
      const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let t = 0; t < 8; t++) {
    outView.setUint32(t * 4, H[t], false);
  }
  return out;
}

function hmacSha256(keyBytes: Uint8Array, messageBytes: Uint8Array): Uint8Array {
  const blockSize = 64;
  let key = keyBytes;
  if (key.length > blockSize) {
    key = sha256Bytes(key);
  }
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(key);

  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = paddedKey[i] ^ 0x5c;
    iKeyPad[i] = paddedKey[i] ^ 0x36;
  }

  const innerMsg = new Uint8Array(blockSize + messageBytes.length);
  innerMsg.set(iKeyPad);
  innerMsg.set(messageBytes, blockSize);
  const innerHash = sha256Bytes(innerMsg);

  const outerMsg = new Uint8Array(blockSize + 32);
  outerMsg.set(oKeyPad);
  outerMsg.set(innerHash, blockSize);
  return sha256Bytes(outerMsg);
}

function timingSafeEqualSync(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Synchronous internal verifier — used for backward compatibility with synchronous callers.
 */
export function verifyTokenSync(token: string): CelestialTokenPayload | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    // 1. Decode and validate the header
    const headerStr = base64UrlDecode(parts[0]);
    const header = JSON.parse(headerStr);
    if (header.alg !== 'HS256' || String(header.alg).toLowerCase() === 'none') {
      return null;
    }

    // 2. Verify signature using timing-safe comparison
    const signingInput = `${parts[0]}.${parts[1]}`;
    const enc = new TextEncoder();
    const expectedSigBytes = hmacSha256(enc.encode(getSecretKey()), enc.encode(signingInput));
    const actualSigBytes = base64UrlToUint8Array(parts[2]);

    if (!timingSafeEqualSync(expectedSigBytes, actualSigBytes)) {
      return null;
    }

    // 3. Decode and validate the payload
    const payloadStr = base64UrlDecode(parts[1]);
    const payload = JSON.parse(payloadStr) as CelestialTokenPayload;

    // 4. Check expiration
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp !== undefined && payload.exp < nowSec) return null;

    // 5. Require 'sub' claim
    if (!payload.sub) return null;

    return payload;
  } catch {
    return null;
  }
}
