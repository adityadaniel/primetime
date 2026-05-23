// Simple in-memory fixed-window rate limiter, keyed by an arbitrary string key.
// TODO(MID-79): replace with Upstash Redis for production multi-instance correctness.
//
// Usage:
//   const result = checkRateLimit(`signup:${ip}:${email}`, { limit: 5, windowMs: 15 * 60_000 });
//   if (!result.ok) return new Response(..., { status: 429, headers: { 'Retry-After': result.retryAfterSec } });

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
  /** Override Date.now() for tests. */
  now?: () => number;
};

export type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; retryAfterSec: number; resetAt: number };

type Entry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, Entry>();

export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = (opts.now ?? Date.now)();
  const existing = store.get(key);

  // Expired window — reset entry.
  if (!existing || existing.resetAt <= now) {
    const next: Entry = { count: 1, resetAt: now + opts.windowMs };
    store.set(key, next);
    return { ok: true, remaining: Math.max(0, opts.limit - 1), resetAt: next.resetAt };
  }

  if (existing.count >= opts.limit) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return { ok: false, retryAfterSec, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    ok: true,
    remaining: Math.max(0, opts.limit - existing.count),
    resetAt: existing.resetAt,
  };
}

/**
 * Reset the underlying store. Test-only helper — do not call from request handlers.
 */
export function __resetRateLimitForTests(): void {
  store.clear();
}
