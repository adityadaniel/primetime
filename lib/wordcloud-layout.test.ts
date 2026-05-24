import { describe, expect, it } from 'vitest';
import { hashString, layoutWords, mulberry32 } from './wordcloud-layout';

const VIEWPORT = { width: 1920, height: 1080 };

function makeWords(spec: Array<[string, number]>) {
  return spec.map(([display, count]) => ({
    display,
    normalized: display.toLowerCase(),
    count,
  }));
}

describe('mulberry32', () => {
  it('produces a deterministic stream from a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces a different stream for a different seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(43);
    let same = 0;
    for (let i = 0; i < 10; i++) {
      if (a() === b()) same++;
    }
    expect(same).toBeLessThan(2);
  });
});

describe('hashString', () => {
  it('is deterministic', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
  });
  it('differs for different inputs', () => {
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('layoutWords', () => {
  it('returns [] for empty input', () => {
    const result = layoutWords({ words: [], seed: 'sess', viewport: VIEWPORT });
    expect(result).toEqual([]);
  });

  it('is deterministic for the same seed and words', () => {
    const words = makeWords([
      ['excited', 12],
      ['curious', 8],
      ['tired', 5],
      ['happy', 3],
      ['focused', 2],
    ]);
    const a = layoutWords({ words, seed: 'sess_abc', viewport: VIEWPORT });
    const b = layoutWords({ words, seed: 'sess_abc', viewport: VIEWPORT });
    expect(a).toEqual(b);
  });

  it('produces a different layout for a different seed', () => {
    const words = makeWords([
      ['excited', 12],
      ['curious', 8],
      ['tired', 5],
      ['happy', 3],
      ['focused', 2],
    ]);
    const a = layoutWords({ words, seed: 'sess_abc', viewport: VIEWPORT });
    const b = layoutWords({ words, seed: 'sess_xyz', viewport: VIEWPORT });
    // Top word is centered identically, but smaller words spiral from a
    // seed-jittered angle, so at least one placement should differ.
    const sameAt = a.filter((p, i) => b[i] && p.x === b[i].x && p.y === b[i].y).length;
    expect(sameAt).toBeLessThan(a.length);
  });

  it('marks the top word ink-pink and gives it the largest fontSize', () => {
    const words = makeWords([
      ['focus', 10],
      ['drive', 5],
      ['care', 3],
      ['ship', 1],
    ]);
    const result = layoutWords({ words, seed: 's', viewport: VIEWPORT });
    expect(result[0].normalized).toBe('focus');
    expect(result[0].color).toBe('ink-pink');
    for (const p of result.slice(1)) {
      expect(p.fontSize).toBeLessThanOrEqual(result[0].fontSize);
    }
  });

  it('uses a perceptual sqrt scale for top-rank font sizes', () => {
    const words = makeWords([
      ['top', 100],
      ['mid', 25],
      ['low', 1],
    ]);
    const result = layoutWords({ words, seed: 's', viewport: VIEWPORT });
    const top = result.find((p) => p.normalized === 'top');
    const mid = result.find((p) => p.normalized === 'mid');
    const low = result.find((p) => p.normalized === 'low');
    expect(top && mid && low).toBeTruthy();
    if (!top || !mid || !low) return;

    // All three are top-5 ranks (cap = 200), so the sqrt curve still lands
    // top at 200, mid at ~112, low at ~41.6.
    expect(top.fontSize).toBeCloseTo(200, 1);
    expect(mid.fontSize).toBeCloseTo(112, 1);
    expect(low.fontSize).toBeCloseTo(41.6, 1);
  });

  it('caps mid-rank words (rank 5-19) at 90px and tail-rank at 50px', () => {
    // 21 words all with the same count so the sqrt curve hits 1.0 for every
    // rank — that lets us check the rank-tier cap is what limits font size.
    const words = makeWords(
      Array.from(
        { length: 21 },
        (_, i) => [`word${String(i).padStart(2, '0')}`, 5] as [string, number],
      ),
    );
    const result = layoutWords({ words, seed: 'tier', viewport: VIEWPORT });
    const sortedByCountThenName = [...words].sort((a, b) =>
      b.count !== a.count ? b.count - a.count : a.normalized.localeCompare(b.normalized),
    );
    const indexOf = (norm: string) => result.findIndex((p) => p.normalized === norm);
    // Rank 0-4 should be ≤ 200 (we don't assert top exactly 200 since they
    // all tie and ordering inside the tier is by name).
    for (let i = 0; i <= 4; i++) {
      const p = result[indexOf(sortedByCountThenName[i].normalized)];
      if (p) expect(p.fontSize).toBeLessThanOrEqual(200);
    }
    // Rank 5-19 capped at 90.
    for (let i = 5; i <= 19; i++) {
      const target = sortedByCountThenName[i].normalized;
      const p = result[indexOf(target)];
      if (p) expect(p.fontSize).toBeLessThanOrEqual(90.001);
    }
    // Rank 20+ capped at 50.
    const tailTarget = sortedByCountThenName[20].normalized;
    const tail = result[indexOf(tailTarget)];
    if (tail) expect(tail.fontSize).toBeLessThanOrEqual(50.001);
  });

  it('keeps rotation within bucketed ±15° range, never vertical', () => {
    const words = makeWords([
      ['alpha', 9],
      ['bravo', 7],
      ['charlie', 5],
      ['delta', 4],
      ['echo', 3],
      ['foxtrot', 2],
      ['golf', 1],
    ]);
    const result = layoutWords({ words, seed: 'rot', viewport: VIEWPORT });
    const allowed = new Set([-15, -7, 0, 7, 15]);
    for (const p of result) {
      expect(allowed.has(p.rotation)).toBe(true);
    }
  });

  it('avoids overlapping placements (axis-aligned bounding boxes)', () => {
    const words = makeWords([
      ['focus', 12],
      ['drive', 9],
      ['care', 7],
      ['ship', 6],
      ['craft', 5],
      ['build', 4],
      ['learn', 3],
      ['grow', 2],
    ]);
    const result = layoutWords({ words, seed: 'collide', viewport: VIEWPORT });
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i];
        const b = result[j];
        const overlapX = a.x < b.x + b.width && b.x < a.x + a.width;
        const overlapY = a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it('scales font sizes down for narrower viewports', () => {
    const words = makeWords([['focus', 10]]);
    const big = layoutWords({ words, seed: 's', viewport: { width: 1920, height: 1080 } });
    const small = layoutWords({ words, seed: 's', viewport: { width: 960, height: 540 } });
    expect(big[0].fontSize).toBeCloseTo(200, 1);
    expect(small[0].fontSize).toBeCloseTo(100, 1);
  });

  it('keeps every placement inside the viewport bounds', () => {
    const words = makeWords([
      ['one', 10],
      ['two', 8],
      ['three', 6],
      ['four', 4],
      ['five', 2],
    ]);
    const result = layoutWords({ words, seed: 'bounds', viewport: VIEWPORT });
    for (const p of result) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(VIEWPORT.width);
      expect(p.y + p.height).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });
});
