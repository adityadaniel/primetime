import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionByPin = vi.fn();
vi.mock('./wordcloud-repo', () => ({
  getSessionByPin: (pin: string) => getSessionByPin(pin),
}));

import type { WordCloudState } from './wordcloud';
import { hydrateStateFromSession, loadOrCreateState } from './wordcloud-hydrate';

beforeEach(() => {
  getSessionByPin.mockReset();
});

const baseSession = {
  id: 'wcs_1',
  pin: '123456',
  prompt: 'mood',
  wordsPerPlayer: 3,
  profanityFilter: true,
  hostUserId: 'user_a',
  status: 'LIVE' as const,
  createdAt: new Date(),
  startedAt: new Date(),
  endedAt: null,
};

describe('hydrateStateFromSession', () => {
  it('rebuilds in-memory state from session, players, and non-removed submissions', () => {
    const state = hydrateStateFromSession({
      ...baseSession,
      players: [
        {
          id: 'p1',
          sessionId: 'wcs_1',
          nickname: 'Alice',
          joinedAt: new Date(),
        },
        {
          id: 'p2',
          sessionId: 'wcs_1',
          nickname: 'Bob',
          joinedAt: new Date(),
        },
      ],
      submissions: [
        {
          id: 's1',
          sessionId: 'wcs_1',
          playerId: 'p1',
          rawText: 'Excited',
          normalized: 'excited',
          removed: false,
          createdAt: new Date(),
          removedAt: null,
        },
        {
          id: 's2',
          sessionId: 'wcs_1',
          playerId: 'p2',
          rawText: 'excited',
          normalized: 'excited',
          removed: false,
          createdAt: new Date(),
          removedAt: null,
        },
        {
          id: 's3',
          sessionId: 'wcs_1',
          playerId: 'p1',
          rawText: 'tired',
          normalized: 'tired',
          removed: true,
          createdAt: new Date(),
          removedAt: new Date(),
        },
      ],
    });
    expect(state.pin).toBe('123456');
    expect(state.sessionId).toBe('wcs_1');
    expect(state.hostUserId).toBe('user_a');
    expect(state.status).toBe('LIVE');
    expect(state.players.size).toBe(2);
    const aliceEntry = [...state.players.values()].find((p) => p.nickname === 'Alice');
    expect(aliceEntry?.dbPlayerId).toBe('p1');
    expect(aliceEntry?.submissions).toEqual(['excited']);
    expect(state.words.get('excited')?.count).toBe(2);
    expect(state.words.has('tired')).toBe(false);
    expect(state.trashedNormalized.has('tired')).toBe(true);
  });

  it('collapses ARCHIVED to ENDED for live socket purposes', () => {
    const state = hydrateStateFromSession({
      ...baseSession,
      status: 'ARCHIVED' as 'ENDED',
      players: [],
      submissions: [],
    });
    expect(state.status).toBe('ENDED');
  });
});

describe('loadOrCreateState', () => {
  it('returns the cached state when present without hitting Prisma', async () => {
    const cache = new Map<string, WordCloudState>();
    const cached = { pin: '111111' } as unknown as WordCloudState;
    cache.set('111111', cached);
    const r = await loadOrCreateState(cache, '111111');
    expect(r).toBe(cached);
    expect(getSessionByPin).not.toHaveBeenCalled();
  });

  it('hydrates from Prisma when not in cache, then caches the result', async () => {
    const cache = new Map<string, WordCloudState>();
    getSessionByPin.mockResolvedValue({
      ...baseSession,
      players: [],
      submissions: [],
    });
    const r1 = await loadOrCreateState(cache, '123456');
    expect(r1?.sessionId).toBe('wcs_1');
    expect(cache.has('123456')).toBe(true);
    const r2 = await loadOrCreateState(cache, '123456');
    expect(r2).toBe(r1);
    expect(getSessionByPin).toHaveBeenCalledTimes(1);
  });

  it('returns null if Prisma has no row', async () => {
    const cache = new Map<string, WordCloudState>();
    getSessionByPin.mockResolvedValue(null);
    const r = await loadOrCreateState(cache, '999999');
    expect(r).toBeNull();
    expect(cache.has('999999')).toBe(false);
  });
});
