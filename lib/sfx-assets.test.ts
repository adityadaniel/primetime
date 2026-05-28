import { describe, expect, it } from 'vitest';
import { getAsset, hasAsset, SOUND_ASSETS } from './sfx-assets';

describe('sfx-assets', () => {
  it('exposes every slug from the manifest', () => {
    const expected = [
      'lock-in',
      'lobby-ambience',
      'question-tension',
      'final-bed',
      'correct',
      'wrong',
      'tick',
      'tick-urgent',
      'time-up',
      'leaderboard-sweep',
      'reveal-flash',
    ];
    for (const slug of expected) {
      expect(hasAsset(slug)).toBe(true);
      const asset = getAsset(slug);
      expect(asset).toBeDefined();
      expect(asset?.url.startsWith('/sounds/')).toBe(true);
      expect(asset?.url.endsWith('.mp3')).toBe(true);
    }
  });

  it('flags loop-style assets correctly', () => {
    expect(SOUND_ASSETS['lobby-ambience'].loop).toBe(true);
    expect(SOUND_ASSETS['question-tension'].loop).toBe(true);
    expect(SOUND_ASSETS['final-bed'].loop).toBe(true);
    expect(SOUND_ASSETS['lock-in'].loop).toBe(false);
    expect(SOUND_ASSETS.correct.loop).toBe(false);
    expect(SOUND_ASSETS['leaderboard-sweep'].loop).toBe(false);
  });

  it('returns undefined for unknown slugs', () => {
    expect(hasAsset('not-a-real-slug')).toBe(false);
    expect(getAsset('not-a-real-slug')).toBeUndefined();
  });
});
