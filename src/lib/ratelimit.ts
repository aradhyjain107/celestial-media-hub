/**
 * In-memory sliding-window rate limiter.
 *
 * Designed for single-process Next.js deployments (no Redis required).
 * For multi-instance deployments, replace with Upstash Redis or similar.
 *
 * Algorithm: sliding window — counts all requests within the last `windowMs`
 * milliseconds. This is more accurate than fixed-window and prevents burst
 * exploitation at window boundaries.
 */

interface RateLimitEntry {
  /** Timestamps (ms) of each request in the current window. */
  timestamps: number[];
  /** When to auto-clean this entry from the map (ms since epoch). */
  expiresAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Unix timestamp (seconds) when the window resets. */
  resetAt: number;
  /** How many seconds to wait before retrying (only when !allowed). */
  retryAfter?: number;
}

export interface RateLimitConfig {
  /** Maximum requests allowed per window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

/** Singleton map shared across all middleware invocations in the same process. */
const store = new Map<string, RateLimitEntry>();

/** Cleanup interval — runs every 5 minutes to evict expired keys. */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    store.forEach((entry, key) => {
      if (now > entry.expiresAt) {
        store.delete(key);
      }
    });
  }, 5 * 60 * 1000); // 5 minutes
  // Don't block Node process shutdown
  if (typeof cleanupInterval === 'object' && 'unref' in cleanupInterval) {
    (cleanupInterval as any).unref();
  }
}

/**
 * Check rate limit for a given key (typically `ip:routeGroup`).
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  startCleanup();

  const now = Date.now();
  const windowStart = now - config.windowMs;
  const resetAt = Math.ceil((now + config.windowMs) / 1000);

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [], expiresAt: now + config.windowMs * 2 };
    store.set(key, entry);
  }

  // Slide the window: remove timestamps older than windowStart
  entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);
  entry.expiresAt = now + config.windowMs * 2;

  const count = entry.timestamps.length;

  if (count >= config.limit) {
    // Oldest timestamp tells us when the earliest slot opens up
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = oldestInWindow + config.windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter: Math.ceil(retryAfterMs / 1000),
    };
  }

  // Allow — record this request
  entry.timestamps.push(now);

  return {
    allowed: true,
    remaining: config.limit - entry.timestamps.length,
    resetAt,
  };
}

/**
 * Route group definitions and their limits.
 * Tuned conservatively for CPU-heavy FFmpeg/yt-dlp workloads.
 */
export const RATE_LIMIT_GROUPS: Record<string, RateLimitConfig> = {
  /** Heavy: youtube download, convert, hevc compress, spotify batch */
  heavy: { limit: 30, windowMs: 60_000 },
  /** Medium: audio trim, mute */
  medium: { limit: 30, windowMs: 60_000 },
  /** Light: file download (streaming already limited by bandwidth) */
  download: { limit: 60, windowMs: 60_000 },
  /** Experimental endpoints — tightest limit */
  experimental: { limit: 5, windowMs: 60_000 },
};

/**
 * Classify a pathname into a rate limit group.
 */
export function classifyRouteGroup(pathname: string): string {
  if (pathname.startsWith('/api/experimental/')) return 'experimental';
  if (pathname.startsWith('/api/download')) return 'download';
  if (
    pathname.startsWith('/api/youtube') ||
    pathname.startsWith('/api/convert') ||
    pathname.startsWith('/api/hevc') ||
    pathname.startsWith('/api/spotify-convert')
  ) return 'heavy';
  // audio-trim, mute, and any unknown API routes
  return 'medium';
}


/** Exposed for testing: drain the in-memory store. */
export function __resetStoreForTesting() {
  store.clear();
}
