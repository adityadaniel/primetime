import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WonderWallNotFoundError,
  WonderWallOwnershipError,
  WonderWallReorderError,
} from '@/lib/wonderwall-repo';

const authMock = vi.fn();
const assertHostOwnsSessionMock = vi.fn();
const reorderApprovedPostsMock = vi.fn();

vi.mock('@/auth', () => ({
  auth: () => authMock(),
}));

vi.mock('@/lib/wonderwall-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wonderwall-repo')>();
  return {
    ...actual,
    assertHostOwnsSession: (...args: unknown[]) => assertHostOwnsSessionMock(...args),
    reorderApprovedPosts: (...args: unknown[]) => reorderApprovedPostsMock(...args),
  };
});

import { POST } from './route';

function postReq(body: unknown, opts: { raw?: boolean } = {}) {
  return new Request('http://test.local/api/wonderwall/123456/posts/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: opts.raw ? (body as string) : JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

function ctx(pin: string) {
  return { params: Promise.resolve({ pin }) };
}

const hostSession = {
  user: { id: 'host-1' },
  expires: new Date(Date.now() + 60_000).toISOString(),
};

const wall = { id: 'sess_1', pin: '123456', hostUserId: 'host-1' };

beforeEach(() => {
  authMock.mockReset();
  assertHostOwnsSessionMock.mockReset();
  reorderApprovedPostsMock.mockReset();
  authMock.mockResolvedValue(hostSession);
  assertHostOwnsSessionMock.mockResolvedValue(wall);
});

describe('POST /api/wonderwall/[pin]/posts/reorder', () => {
  it('reorders the wall and returns the applied order', async () => {
    reorderApprovedPostsMock.mockResolvedValue(undefined);

    const res = await POST(postReq({ orderedPostIds: ['a', 'b', 'c'] }), ctx('123456'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, orderedPostIds: ['a', 'b', 'c'] });
    expect(assertHostOwnsSessionMock).toHaveBeenCalledWith({ pin: '123456', hostUserId: 'host-1' });
    expect(reorderApprovedPostsMock).toHaveBeenCalledWith({
      sessionId: 'sess_1',
      orderedPostIds: ['a', 'b', 'c'],
    });
  });

  it('accepts an empty order', async () => {
    reorderApprovedPostsMock.mockResolvedValue(undefined);
    const res = await POST(postReq({ orderedPostIds: [] }), ctx('123456'));
    expect(res.status).toBe(200);
    expect(reorderApprovedPostsMock).toHaveBeenCalledWith({
      sessionId: 'sess_1',
      orderedPostIds: [],
    });
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(postReq({ orderedPostIds: ['a'] }), ctx('123456'));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthenticated' });
    expect(assertHostOwnsSessionMock).not.toHaveBeenCalled();
    expect(reorderApprovedPostsMock).not.toHaveBeenCalled();
  });

  it('returns 403 when a different host tries to reorder the wall', async () => {
    assertHostOwnsSessionMock.mockRejectedValue(new WonderWallOwnershipError('123456'));
    const res = await POST(postReq({ orderedPostIds: ['a'] }), ctx('123456'));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
    expect(reorderApprovedPostsMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the wall does not exist', async () => {
    assertHostOwnsSessionMock.mockRejectedValue(new WonderWallNotFoundError('123456'));
    const res = await POST(postReq({ orderedPostIds: ['a'] }), ctx('123456'));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
    expect(reorderApprovedPostsMock).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed pin', async () => {
    const res = await POST(postReq({ orderedPostIds: ['a'] }), ctx('12ab'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_pin' });
    expect(assertHostOwnsSessionMock).not.toHaveBeenCalled();
  });

  it('returns 400 when orderedPostIds is missing or not an array', async () => {
    const missing = await POST(postReq({}), ctx('123456'));
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({ error: 'invalid_ordered_post_ids' });

    const notArray = await POST(postReq({ orderedPostIds: 'a,b' }), ctx('123456'));
    expect(notArray.status).toBe(400);
    await expect(notArray.json()).resolves.toEqual({ error: 'invalid_ordered_post_ids' });

    expect(assertHostOwnsSessionMock).not.toHaveBeenCalled();
  });

  it('returns 400 when an id is not a non-empty string', async () => {
    const res = await POST(postReq({ orderedPostIds: ['a', 42] }), ctx('123456'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_ordered_post_ids' });

    const blank = await POST(postReq({ orderedPostIds: ['a', ''] }), ctx('123456'));
    expect(blank.status).toBe(400);
    await expect(blank.json()).resolves.toEqual({ error: 'invalid_ordered_post_ids' });

    expect(reorderApprovedPostsMock).not.toHaveBeenCalled();
  });

  it('maps a reorder validation failure to 400 invalid_order', async () => {
    reorderApprovedPostsMock.mockRejectedValue(
      new WonderWallReorderError('orderedPostIds must include every approved displayable post'),
    );
    const res = await POST(postReq({ orderedPostIds: ['a'] }), ctx('123456'));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe('invalid_order');
    expect(typeof json.message).toBe('string');
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await POST(postReq('not-json', { raw: true }), ctx('123456'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_json' });
    expect(assertHostOwnsSessionMock).not.toHaveBeenCalled();
  });

  it('returns 500 for an unexpected reorder failure', async () => {
    reorderApprovedPostsMock.mockRejectedValue(new Error('db down'));
    const res = await POST(postReq({ orderedPostIds: ['a'] }), ctx('123456'));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'reorder_failed' });
  });
});
