import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetRateLimitForTests, checkRateLimit } from '@/lib/rate-limit';

beforeEach(() => {
  __resetRateLimitForTests();
});

afterEach(() => {
  __resetRateLimitForTests();
});

describe('checkRateLimit', () => {
  it('allows up to limit attempts within the window', () => {
    const opts = { limit: 3, windowMs: 60_000, now: () => 1_000 };
    expect(checkRateLimit('k', opts).ok).toBe(true);
    expect(checkRateLimit('k', opts).ok).toBe(true);
    expect(checkRateLimit('k', opts).ok).toBe(true);
    const fourth = checkRateLimit('k', opts);
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) {
      expect(fourth.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it('isolates keys', () => {
    const opts = { limit: 1, windowMs: 60_000, now: () => 1_000 };
    expect(checkRateLimit('a', opts).ok).toBe(true);
    expect(checkRateLimit('b', opts).ok).toBe(true);
    expect(checkRateLimit('a', opts).ok).toBe(false);
    expect(checkRateLimit('b', opts).ok).toBe(false);
  });

  it('resets after the window expires', () => {
    let nowMs = 1_000;
    const opts = { limit: 2, windowMs: 60_000, now: () => nowMs };
    expect(checkRateLimit('k', opts).ok).toBe(true);
    expect(checkRateLimit('k', opts).ok).toBe(true);
    expect(checkRateLimit('k', opts).ok).toBe(false);

    // Advance past the window.
    nowMs = 1_000 + 60_001;
    const recovered = checkRateLimit('k', opts);
    expect(recovered.ok).toBe(true);
  });

  it('reports a Retry-After at least 1 second from the window edge', () => {
    let nowMs = 1_000;
    const opts = { limit: 1, windowMs: 30_000, now: () => nowMs };
    expect(checkRateLimit('k', opts).ok).toBe(true);

    // 1ms before the window closes — Retry-After should still be at least 1.
    nowMs = 1_000 + 29_999;
    const denied = checkRateLimit('k', opts);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1);
    }
  });
});
