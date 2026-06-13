import { beforeEach, describe, expect, it, vi } from 'vitest';

const gameFindUnique = vi.fn();
const wcFindUnique = vi.fn();
const qaFindUnique = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    gameSession: { findUnique: (args: unknown) => gameFindUnique(args) },
    wordCloudSession: { findUnique: (args: unknown) => wcFindUnique(args) },
    qASession: { findUnique: (args: unknown) => qaFindUnique(args) },
  },
}));

import { POST } from './route';

function postReq(body: unknown) {
  return new Request('http://test.local/api/lookup-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

beforeEach(() => {
  gameFindUnique.mockReset().mockResolvedValue(null);
  wcFindUnique.mockReset().mockResolvedValue(null);
  qaFindUnique.mockReset().mockResolvedValue(null);
});

describe('POST /api/lookup-pin', () => {
  it('rejects a malformed pin', async () => {
    const res = await POST(postReq({ pin: 'abc' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_pin' });
  });

  it('returns quiz for a quiz pin', async () => {
    gameFindUnique.mockResolvedValue({ id: 'gs_1' });
    const res = await POST(postReq({ pin: '123456' }));
    await expect(res.json()).resolves.toEqual({ type: 'quiz' });
  });

  it('returns wordcloud with status for a word-cloud pin', async () => {
    wcFindUnique.mockResolvedValue({ id: 'wcs_1', status: 'LIVE' });
    const res = await POST(postReq({ pin: '123456' }));
    await expect(res.json()).resolves.toEqual({ type: 'wordcloud', status: 'LIVE' });
  });

  it('returns q-and-a with status for a Q&A pin', async () => {
    qaFindUnique.mockResolvedValue({ id: 'qas_1', status: 'OPEN' });
    const res = await POST(postReq({ pin: '123456' }));
    await expect(res.json()).resolves.toEqual({ type: 'q-and-a', status: 'OPEN' });
  });

  it('prefers quiz when a pin somehow exists in multiple tables', async () => {
    gameFindUnique.mockResolvedValue({ id: 'gs_1' });
    wcFindUnique.mockResolvedValue({ id: 'wcs_1', status: 'LIVE' });
    qaFindUnique.mockResolvedValue({ id: 'qas_1', status: 'OPEN' });
    const res = await POST(postReq({ pin: '123456' }));
    await expect(res.json()).resolves.toEqual({ type: 'quiz' });
  });

  it('returns null type for an unknown pin', async () => {
    const res = await POST(postReq({ pin: '123456' }));
    await expect(res.json()).resolves.toEqual({ type: null });
  });
});
