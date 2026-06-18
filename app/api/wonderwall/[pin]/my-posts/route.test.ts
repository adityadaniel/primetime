import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPostsForSubmitterMock = vi.fn();

vi.mock('@/lib/wonderwall-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wonderwall-repo')>();
  return {
    ...actual,
    getPostsForSubmitter: (...args: unknown[]) => getPostsForSubmitterMock(...args),
  };
});

import { GET } from './route';

function getReq(query = '') {
  return new Request(
    `http://test.local/api/wonderwall/123456/my-posts${query}`,
  ) as unknown as import('next/server').NextRequest;
}

function ctx(pin: string) {
  return { params: Promise.resolve({ pin }) };
}

const createdAt = new Date('2026-06-18T00:00:00.000Z');

// A repo row carries host-only fields too; the route must drop them.
const repoRow = {
  id: 'wwp_1',
  sessionId: 'wws_1',
  originalUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789',
  urn: 'urn:li:activity:1234567890123456789',
  embedUrl: 'https://www.linkedin.com/embed/feed/update/urn:li:activity:1234567890123456789',
  status: 'REJECTED' as const,
  canDisplay: false,
  position: null,
  submitterName: 'Ada',
  submitterKey: 'browser-key',
  rejectionReason: 'Off-topic for this wall.',
  failureReason: null,
  reviewedAt: createdAt,
  reviewedByHostUserId: 'user_host',
  approvedAt: null,
  rejectedAt: createdAt,
  hiddenAt: null,
  restoredAt: null,
  createdAt,
  updatedAt: createdAt,
};

describe('GET /api/wonderwall/[pin]/my-posts', () => {
  beforeEach(() => {
    getPostsForSubmitterMock.mockReset();
  });

  it('returns only participant-safe fields for the submitter', async () => {
    getPostsForSubmitterMock.mockResolvedValue([repoRow]);

    const res = await GET(getReq('?submitterKey=browser-key'), ctx('123456'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      posts: [
        {
          id: 'wwp_1',
          originalUrl: repoRow.originalUrl,
          status: 'REJECTED',
          canDisplay: false,
          rejectionReason: 'Off-topic for this wall.',
          failureReason: null,
          createdAt: '2026-06-18T00:00:00.000Z',
        },
      ],
    });
    expect(getPostsForSubmitterMock).toHaveBeenCalledWith({
      pin: '123456',
      submitterKey: 'browser-key',
    });
  });

  it('never leaks host-only moderation/export fields', async () => {
    getPostsForSubmitterMock.mockResolvedValue([repoRow]);
    const res = await GET(getReq('?submitterKey=browser-key'), ctx('123456'));
    const json = (await res.json()) as { posts: Array<Record<string, unknown>> };
    const post = json.posts[0];
    for (const leaked of [
      'urn',
      'embedUrl',
      'position',
      'submitterName',
      'submitterKey',
      'reviewedAt',
      'reviewedByHostUserId',
      'approvedAt',
      'rejectedAt',
      'hiddenAt',
      'restoredAt',
      'updatedAt',
      'sessionId',
    ]) {
      expect(post).not.toHaveProperty(leaked);
    }
  });

  it('returns an empty list when the browser has no submissions', async () => {
    getPostsForSubmitterMock.mockResolvedValue([]);
    const res = await GET(getReq('?submitterKey=unknown-browser'), ctx('123456'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ posts: [] });
  });

  it('trims the submitterKey before delegating', async () => {
    getPostsForSubmitterMock.mockResolvedValue([]);
    await GET(getReq('?submitterKey=%20%20browser-key%20%20'), ctx('123456'));
    expect(getPostsForSubmitterMock).toHaveBeenCalledWith({
      pin: '123456',
      submitterKey: 'browser-key',
    });
  });

  it('returns 400 invalid_pin for a malformed pin', async () => {
    const res = await GET(getReq('?submitterKey=browser-key'), ctx('12ab'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_pin' });
    expect(getPostsForSubmitterMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the submitterKey is missing or blank', async () => {
    for (const query of ['', '?submitterKey=', '?submitterKey=%20%20']) {
      const res = await GET(getReq(query), ctx('123456'));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: 'missing_submitter_key' });
    }
    expect(getPostsForSubmitterMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an overlong submitterKey', async () => {
    const res = await GET(getReq(`?submitterKey=${'x'.repeat(121)}`), ctx('123456'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_submitter_key' });
    expect(getPostsForSubmitterMock).not.toHaveBeenCalled();
  });
});
