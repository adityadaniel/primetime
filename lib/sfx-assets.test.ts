import { describe, expect, it } from 'vitest';
import manifest from '@/public/sounds/manifest.json';
import { SOUNDS } from '@/scripts/sounds-manifest';
import { getAsset, hasAsset, SOUND_ASSETS } from './sfx-assets';

type ManifestEntry = {
  slug: string;
  label: string;
  surface: string;
  file: string;
  loop: boolean;
};

const typedManifest = manifest as { entries: Record<string, ManifestEntry> };

const EXPECTED_SLUGS = [
  'lock-in',
  'lobby-ambience',
  'question-tension',
  'question-tension-long',
  'final-bed',
  'correct',
  'wrong',
  'tick',
  'tick-urgent',
  'time-up',
  'leaderboard-sweep',
  'reveal-flash',
] as const;

describe('sfx-assets', () => {
  it('exposes every slug from the manifest', () => {
    for (const slug of EXPECTED_SLUGS) {
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
    expect(SOUND_ASSETS['question-tension-long'].loop).toBe(true);
    expect(SOUND_ASSETS['final-bed'].loop).toBe(true);
    expect(SOUND_ASSETS['tick-urgent'].loop).toBe(true);
    expect(SOUND_ASSETS['lock-in'].loop).toBe(false);
    expect(SOUND_ASSETS.correct.loop).toBe(false);
    expect(SOUND_ASSETS.tick.loop).toBe(false);
    expect(SOUND_ASSETS['leaderboard-sweep'].loop).toBe(false);
  });

  it('returns undefined for unknown slugs', () => {
    expect(hasAsset('not-a-real-slug')).toBe(false);
    expect(getAsset('not-a-real-slug')).toBeUndefined();
  });
});

describe('sounds source vs committed manifest', () => {
  // The source-of-truth in `scripts/sounds-manifest.ts` (used by
  // `scripts/generate-sounds.ts`) and the committed `public/sounds/manifest.json`
  // (consumed at runtime by `lib/sfx-assets.ts`) drift easily. This block
  // enforces that they agree on the contract that actually changes runtime
  // behavior: slug set, loop flags, and human-facing label/surface.

  const sourceBySlug = new Map(SOUNDS.map((s) => [s.slug, s]));
  const manifestBySlug = new Map(Object.entries(typedManifest.entries));

  it('source and manifest expose the same slug set', () => {
    const sourceSlugs = [...sourceBySlug.keys()].sort();
    const manifestSlugs = [...manifestBySlug.keys()].sort();
    expect(sourceSlugs).toEqual(manifestSlugs);
  });

  it.each([...sourceBySlug.keys()])('loop flag matches for %s', (slug) => {
    const source = sourceBySlug.get(slug);
    const entry = manifestBySlug.get(slug);
    expect(source).toBeDefined();
    expect(entry).toBeDefined();
    if (!source || !entry) return;
    expect({ slug, loop: source.soundLoop }).toEqual({ slug, loop: entry.loop });
  });

  it.each([...sourceBySlug.keys()])('label/surface match for %s', (slug) => {
    const source = sourceBySlug.get(slug);
    const entry = manifestBySlug.get(slug);
    expect(source).toBeDefined();
    expect(entry).toBeDefined();
    if (!source || !entry) return;
    expect({
      slug,
      label: source.label,
      surface: source.surface,
    }).toEqual({
      slug,
      label: entry.label,
      surface: entry.surface,
    });
  });
});
