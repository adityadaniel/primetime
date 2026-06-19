import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gameFindUnique = vi.fn();
const wcFindUnique = vi.fn();
const qaFindUnique = vi.fn();
const wwFindUnique = vi.fn();

vi.mock('./db', () => ({
  prisma: {
    gameSession: {
      findUnique: (args: unknown) => gameFindUnique(args),
    },
    wordCloudSession: {
      findUnique: (args: unknown) => wcFindUnique(args),
    },
    qASession: {
      findUnique: (args: unknown) => qaFindUnique(args),
    },
    wonderWallSession: {
      findUnique: (args: unknown) => wwFindUnique(args),
    },
  },
}));

import {
  allocatePin,
  clearActivePinsProvidersForTesting,
  registerActivePinsProvider,
  tryAllocateAgainstActiveSet,
} from './pin-allocator';

beforeEach(() => {
  gameFindUnique.mockReset();
  wcFindUnique.mockReset();
  qaFindUnique.mockReset();
  wwFindUnique.mockReset();
  clearActivePinsProvidersForTesting();
});

afterEach(() => {
  clearActivePinsProvidersForTesting();
});

describe('allocatePin', () => {
  it('returns a 6-digit PIN that exists in no session table', async () => {
    gameFindUnique.mockResolvedValue(null);
    wcFindUnique.mockResolvedValue(null);
    qaFindUnique.mockResolvedValue(null);
    wwFindUnique.mockResolvedValue(null);
    const pin = await allocatePin();
    expect(pin).toMatch(/^\d{6}$/);
  });

  it('skips PINs that already exist in GameSession', async () => {
    let calls = 0;
    gameFindUnique.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ id: 'taken' });
      return Promise.resolve(null);
    });
    wcFindUnique.mockResolvedValue(null);
    qaFindUnique.mockResolvedValue(null);
    wwFindUnique.mockResolvedValue(null);
    const pin = await allocatePin();
    expect(pin).toMatch(/^\d{6}$/);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('skips PINs that already exist in WordCloudSession', async () => {
    gameFindUnique.mockResolvedValue(null);
    qaFindUnique.mockResolvedValue(null);
    wwFindUnique.mockResolvedValue(null);
    let calls = 0;
    wcFindUnique.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ id: 'taken' });
      return Promise.resolve(null);
    });
    const pin = await allocatePin();
    expect(pin).toMatch(/^\d{6}$/);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('skips PINs that already exist in QASession', async () => {
    gameFindUnique.mockResolvedValue(null);
    wcFindUnique.mockResolvedValue(null);
    wwFindUnique.mockResolvedValue(null);
    let calls = 0;
    qaFindUnique.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ id: 'taken' });
      return Promise.resolve(null);
    });
    const pin = await allocatePin();
    expect(pin).toMatch(/^\d{6}$/);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('skips PINs that already exist in WonderWallSession', async () => {
    gameFindUnique.mockResolvedValue(null);
    wcFindUnique.mockResolvedValue(null);
    qaFindUnique.mockResolvedValue(null);
    let calls = 0;
    wwFindUnique.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ id: 'taken' });
      return Promise.resolve(null);
    });
    const pin = await allocatePin();
    expect(pin).toMatch(/^\d{6}$/);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('skips PINs registered as active in-memory', async () => {
    gameFindUnique.mockResolvedValue(null);
    wcFindUnique.mockResolvedValue(null);
    qaFindUnique.mockResolvedValue(null);
    wwFindUnique.mockResolvedValue(null);
    const taken = new Set<string>();
    registerActivePinsProvider(() => taken);
    // pin first call returns one we'll claim, second returns a different one
    const original = Math.random;
    let n = 0;
    Math.random = () => {
      n += 1;
      // first 6-digit float gives 100001, second 200002, etc.
      return (n / 10) % 1;
    };
    try {
      const first = await allocatePin();
      taken.add(first);
      const second = await allocatePin();
      expect(second).not.toBe(first);
    } finally {
      Math.random = original;
    }
  });

  it('throws when no PIN is free after retry limit', async () => {
    gameFindUnique.mockResolvedValue({ id: 'always' });
    wcFindUnique.mockResolvedValue(null);
    qaFindUnique.mockResolvedValue(null);
    wwFindUnique.mockResolvedValue(null);
    await expect(allocatePin()).rejects.toThrow(/Could not allocate PIN/);
  });
});

describe('tryAllocateAgainstActiveSet', () => {
  it('returns a PIN not in the active set', () => {
    const taken = new Set<string>();
    const pin = tryAllocateAgainstActiveSet((p) => taken.has(p));
    expect(pin).toMatch(/^\d{6}$/);
  });

  it('returns null when allocation is impossible', () => {
    const pin = tryAllocateAgainstActiveSet(() => true);
    expect(pin).toBeNull();
  });
});
