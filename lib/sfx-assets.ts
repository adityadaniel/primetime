'use client';

import manifest from '@/public/sounds/manifest.json';

export type SoundAsset = {
  url: string;
  loop: boolean;
};

type ManifestEntry = {
  slug: string;
  file: string;
  loop: boolean;
  durationSec?: number;
};

type Manifest = {
  generatedAt: string;
  model: string;
  entries: Record<string, ManifestEntry>;
};

const typedManifest = manifest as Manifest;

export const SOUND_ASSETS: Record<string, SoundAsset> = Object.fromEntries(
  Object.entries(typedManifest.entries).map(([slug, entry]) => [
    slug,
    { url: entry.file, loop: entry.loop },
  ]),
);

export function hasAsset(slug: string): boolean {
  return slug in SOUND_ASSETS;
}

export function getAsset(slug: string): SoundAsset | undefined {
  return SOUND_ASSETS[slug];
}
