import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WonderWallNotFoundError, WonderWallOwnershipError } from '@/lib/wonderwall-repo';

const authMock = vi.fn();
const reviewPostMock = vi.fn();
const setPostHeightMock = vi.fn();
const measureBgMock = vi.fn();

vi.mock('@/auth', () => ({
  auth: () => authMock(),
}));

vi.mock('@/lib/wonderwall-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wonderwall-repo')>();
  return {
    ...actual,
    reviewPost: (...args: unknown[]) => reviewPostMock(...args),
    setPostHeight: (...args: unknown[]) => setPostHeightMock(...args),
    // Stub the fire-and-forget measurer so approvals don't hit the DB / launch
    // a headless browser during unit tests.
    measurePostHeightInBackground: (...args: unknown[]) => measureBgMock(...args),
  };
});

import { PATCH } from './route';

function patchReq(body: unknown, opts: { raw?: boolean } = {}) {
  return new Request('http://test.local/api/wonderwall/123456/posts/wwp_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: opts.raw ? (body as string) : JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

function ctx(pin: string, postId: string) {
  return { params: Promise.resolve({ pin, postId }) };
}

const hostSession = {
  user: { id: 'host-1' },
  expires: new Date(Date.now() + 60_000).toISOString(),
};

const reviewedAt = new Date('2026-06-18T12:00:00.000Z');
const createdAt = new Date('2026-06-18T00:00:00.000Z');

const approvedPost = {
  id: 'wwp_1',
  sessionId: 'sess_1',
  originalUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789',
  urn: 'urn:li:activity:1234567890123456789',
  embedUrl: 'https://www.linkedin.com/embed/feed/update/urn:li:activity:1234567890123456789',
  status: 'APPROVED' as const,
  canDisplay: true,
  position: 0,
  submitterName: 'Ada',
  submitterKey: 'browser-key',
  rejectionReason: null,
  failureReason: null,
  reviewedAt,
  reviewedByHostUserId: 'host-1',
  approvedAt: reviewedAt,
  rejectedAt: null,
  hiddenAt: null,
  restoredAt: null,
  createdAt,
  updatedAt: reviewedAt,
  measuredHeight: 540,
  overrideHeight: null,
  measureStatus: 'OK' as const,
  measuredAt: reviewedAt,
  authorName: 'Ada Lovelace',
};

beforeEach(() => {
  authMock.mockReset();
  reviewPostMock.mockReset();
  setPostHeightMock.mockReset();
  measureBgMock.mockReset();
  authMock.mockResolvedValue(hostSession);
});

describe('PATCH /api/wonderwall/[pin]/posts/[postId]', () => {
  it('approves a post and returns a host-safe shape', async () => {
    reviewPostMock.mockResolvedValue(approvedPost);

    const res = await PATCH(patchReq({ action: 'approve' }), ctx('123456', 'wwp_1'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      post: {
        id: 'wwp_1',
        originalUrl: approvedPost.originalUrl,
        urn: approvedPost.urn,
        embedUrl: approvedPost.embedUrl,
        status: 'APPROVED',
        canDisplay: true,
        position: 0,
        submitterName: 'Ada',
        submitterKey: 'browser-key',
        rejectionReason: null,
        failureReason: null,
        createdAt: '2026-06-18T00:00:00.000Z',
        reviewedAt: '2026-06-18T12:00:00.000Z',
        measuredHeight: 540,
        overrideHeight: null,
        measureStatus: 'OK',
        displayHeight: 540,
        authorName: 'Ada Lovelace',
      },
    });
    expect(reviewPostMock).toHaveBeenCalledWith({
      postId: 'wwp_1',
      pin: '123456',
      hostUserId: 'host-1',
      action: 'approve',
    });
    // Already measured OK → no re-measure.
    expect(measureBgMock).not.toHaveBeenCalled();
  });

  it('kicks off background measurement when approving an unmeasured post', async () => {
    reviewPostMock.mockResolvedValue({
      ...approvedPost,
      measureStatus: null,
      measuredHeight: null,
    });
    const res = await PATCH(patchReq({ action: 'approve' }), ctx('123456', 'wwp_1'));
    expect(res.status).toBe(200);
    expect(measureBgMock).toHaveBeenCalledWith('wwp_1');
  });

  it('sets a drag-to-fit height override', async () => {
    setPostHeightMock.mockResolvedValue({ ...approvedPost, overrideHeight: 712 });
    const res = await PATCH(
      patchReq({ action: 'set_height', height: 712 }),
      ctx('123456', 'wwp_1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { post: { overrideHeight: number; displayHeight: number } };
    expect(body.post.overrideHeight).toBe(712);
    expect(body.post.displayHeight).toBe(712);
    expect(setPostHeightMock).toHaveBeenCalledWith({
      postId: 'wwp_1',
      pin: '123456',
      hostUserId: 'host-1',
      height: 712,
    });
    // A height change is not a review action.
    expect(reviewPostMock).not.toHaveBeenCalled();
  });

  it('clears the override when height is null', async () => {
    setPostHeightMock.mockResolvedValue({ ...approvedPost, overrideHeight: null });
    const res = await PATCH(
      patchReq({ action: 'set_height', height: null }),
      ctx('123456', 'wwp_1'),
    );
    expect(res.status).toBe(200);
    expect(setPostHeightMock).toHaveBeenCalledWith(
      expect.objectContaining({ postId: 'wwp_1', height: null }),
    );
  });

  it('returns 400 for an out-of-range height', async () => {
    const res = await PATCH(patchReq({ action: 'set_height', height: 50 }), ctx('123456', 'wwp_1'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_height' });
    expect(setPostHeightMock).not.toHaveBeenCalled();
  });

  it('forwards an optional rejection reason', async () => {
    reviewPostMock.mockResolvedValue({
      ...approvedPost,
      status: 'REJECTED',
      canDisplay: false,
      rejectionReason: 'Off topic',
    });

    const res = await PATCH(
      patchReq({ action: 'reject', reason: 'Off topic' }),
      ctx('123456', 'wwp_1'),
    );

    expect(res.status).toBe(200);
    expect(reviewPostMock).toHaveBeenCalledWith({
      postId: 'wwp_1',
      pin: '123456',
      hostUserId: 'host-1',
      action: 'reject',
      reason: 'Off topic',
    });
  });

  it('rejects with a null reason when none is provided', async () => {
    reviewPostMock.mockResolvedValue({ ...approvedPost, status: 'REJECTED', canDisplay: false });
    await PATCH(patchReq({ action: 'reject' }), ctx('123456', 'wwp_1'));
    expect(reviewPostMock).toHaveBeenCalledWith({
      postId: 'wwp_1',
      pin: '123456',
      hostUserId: 'host-1',
      action: 'reject',
      reason: null,
    });
  });

  it('supports hide and restore actions', async () => {
    reviewPostMock.mockResolvedValue(approvedPost);
    await PATCH(patchReq({ action: 'hide' }), ctx('123456', 'wwp_1'));
    await PATCH(patchReq({ action: 'restore' }), ctx('123456', 'wwp_1'));
    expect(reviewPostMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: 'hide' }));
    expect(reviewPostMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: 'restore' }),
    );
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await PATCH(patchReq({ action: 'approve' }), ctx('123456', 'wwp_1'));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthenticated' });
    expect(reviewPostMock).not.toHaveBeenCalled();
  });

  it('returns 403 when a different host tries to mutate the wall', async () => {
    reviewPostMock.mockRejectedValue(new WonderWallOwnershipError('123456'));
    const res = await PATCH(patchReq({ action: 'approve' }), ctx('123456', 'wwp_1'));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('returns 404 when the post does not exist for this wall', async () => {
    reviewPostMock.mockRejectedValue(new WonderWallNotFoundError('wwp_1'));
    const res = await PATCH(patchReq({ action: 'approve' }), ctx('123456', 'wwp_1'));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('returns 400 for a malformed pin', async () => {
    const res = await PATCH(patchReq({ action: 'approve' }), ctx('12ab', 'wwp_1'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_pin' });
    expect(reviewPostMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an unknown action', async () => {
    const res = await PATCH(patchReq({ action: 'delete' }), ctx('123456', 'wwp_1'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_action' });
    expect(reviewPostMock).not.toHaveBeenCalled();
  });

  it('does not accept the reserved fail action from the review queue', async () => {
    const res = await PATCH(patchReq({ action: 'fail' }), ctx('123456', 'wwp_1'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_action' });
    expect(reviewPostMock).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-string rejection reason', async () => {
    const res = await PATCH(patchReq({ action: 'reject', reason: 42 }), ctx('123456', 'wwp_1'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_reason' });
    expect(reviewPostMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an overlong rejection reason', async () => {
    const res = await PATCH(
      patchReq({ action: 'reject', reason: 'x'.repeat(241) }),
      ctx('123456', 'wwp_1'),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_reason' });
    expect(reviewPostMock).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await PATCH(patchReq('not-json', { raw: true }), ctx('123456', 'wwp_1'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_json' });
    expect(reviewPostMock).not.toHaveBeenCalled();
  });

  it('returns 500 for an unexpected repo failure', async () => {
    reviewPostMock.mockRejectedValue(new Error('db down'));
    const res = await PATCH(patchReq({ action: 'approve' }), ctx('123456', 'wwp_1'));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'review_failed' });
  });
});
