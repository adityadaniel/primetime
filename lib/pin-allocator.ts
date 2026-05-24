// Shared 6-digit PIN allocator. Checks both GameSession and WordCloudSession,
// plus optional in-memory active-pin sets so a PIN can never collide across
// the quiz and word-cloud routes (F7 from the codex review).

import { prisma } from './db';

const RETRY_LIMIT = 50;

export type ActivePinsProvider = () => Iterable<string>;

const inMemoryProviders: ActivePinsProvider[] = [];

export function registerActivePinsProvider(provider: ActivePinsProvider): void {
  inMemoryProviders.push(provider);
}

export function clearActivePinsProvidersForTesting(): void {
  inMemoryProviders.length = 0;
}

function generatePin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function inMemoryHas(pin: string): boolean {
  for (const provider of inMemoryProviders) {
    for (const p of provider()) {
      if (p === pin) return true;
    }
  }
  return false;
}

export async function allocatePin(): Promise<string> {
  for (let i = 0; i < RETRY_LIMIT; i++) {
    const pin = generatePin();
    if (inMemoryHas(pin)) continue;
    const [quiz, wc] = await Promise.all([
      prisma.gameSession.findUnique({ where: { pin }, select: { id: true } }),
      prisma.wordCloudSession.findUnique({ where: { pin }, select: { id: true } }),
    ]);
    if (!quiz && !wc) return pin;
  }
  throw new Error('Could not allocate PIN');
}

// Sync helper for the in-memory quiz allocator path that doesn't await DB.
// Returns null on collision so the caller can retry. Used by lib/game.ts
// where the original sync code expects to allocate from a small in-memory map.
export function tryAllocateAgainstActiveSet(activeHas: (pin: string) => boolean): string | null {
  for (let i = 0; i < RETRY_LIMIT; i++) {
    const pin = generatePin();
    if (activeHas(pin)) continue;
    if (inMemoryHas(pin)) continue;
    return pin;
  }
  return null;
}
