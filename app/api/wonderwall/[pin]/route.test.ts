import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WonderWallPublicState } from '@/lib/wonderwall-repo';

const getPublicStateByPinMock = vi.fn();

vi.mock('@/lib/wonderwall-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wonderwall-repo')>();
  return {
    ...actual,
    getPublicStateByPin: (...args: unknown[]) => getPublicStateByPinMock(...args),
  };
});

import { GET } from './route';

function ctx(pin: string) {
  return { params: Promise.resolve({ pin }) };
}

function getReq() {
  return new Request(
    'http://test.local/api/wonderwall/123456',
  ) as unknown as import('next/server').NextRequest;
}

function publicState(overrides: Partial<WonderWallPublicState> = {}): WonderWallPublicState {
  return {
    pin: '123456',
    title: 'Signal',
    description: null,
    instructions: null,
    status: 'LIVE',
    posts: [
      {
        id: 'wwp_1',
        originalUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789',
        urn: 'urn:li:activity:1234567890123456789',
        embedUrl: 'https://www.linkedin.com/embed/feed/update/urn:li:activity:1234567890123456789',
        status: 'APPROVED',
        canDisplay: true,
        position: 0,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  getPublicStateByPinMock.mockReset();
});

describe('GET /api/wonderwall/[pin]', () => {
  it('returns the public-safe state for a known wall', async () => {
    getPublicStateByPinMock.mockResolvedValue(publicState());

    const res = await GET(getReq(), ctx('123456'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual(publicState());
    expect(getPublicStateByPinMock).toHaveBeenCalledWith('123456');
  });

  it('returns only approved + displayable posts with safe fields, never host metadata', async () => {
    getPublicStateByPinMock.mockResolvedValue(publicState());

    const res = await GET(getReq(), ctx('123456'));
    const body = (await res.json()) as WonderWallPublicState;

    // Every returned post is approved and displayable.
    expect(body.posts.every((p) => p.status === 'APPROVED' && p.canDisplay === true)).toBe(true);
    // The DTO carries only the public-safe field set — no review/audit leakage.
    expect(Object.keys(body.posts[0]).sort()).toEqual(
      ['canDisplay', 'embedUrl', 'id', 'originalUrl', 'position', 'status', 'urn'].sort(),
    );
    for (const post of body.posts) {
      for (const leaked of [
        'submitterName',
        'submitterKey',
        'rejectionReason',
        'failureReason',
        'reviewedAt',
        'reviewedByHostUserId',
        'hostUserId',
      ]) {
        expect(post).not.toHaveProperty(leaked);
      }
    }
    // Session-level host/export metadata must not leak either.
    for (const leaked of ['hostUserId', 'id', 'createdAt', 'updatedAt', 'endedAt']) {
      expect(body).not.toHaveProperty(leaked);
    }
  });

  it('returns an empty wall as an empty posts array', async () => {
    getPublicStateByPinMock.mockResolvedValue(publicState({ posts: [] }));
    const res = await GET(getReq(), ctx('123456'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ pin: '123456', posts: [] });
  });

  it('returns 404 when the wall does not exist', async () => {
    getPublicStateByPinMock.mockResolvedValue(null);
    const res = await GET(getReq(), ctx('123456'));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('returns 400 for a malformed pin without touching the repo', async () => {
    const res = await GET(getReq(), ctx('12ab'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_pin' });
    expect(getPublicStateByPinMock).not.toHaveBeenCalled();
  });
});
