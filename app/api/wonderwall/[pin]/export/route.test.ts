import type { WonderWallPost } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WonderWallNotFoundError, WonderWallOwnershipError } from '@/lib/wonderwall-repo';

const authMock = vi.fn();
const listPostsForExportMock = vi.fn();

vi.mock('@/auth', () => ({
  auth: () => authMock(),
}));

vi.mock('@/lib/wonderwall-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wonderwall-repo')>();
  return {
    ...actual,
    listPostsForExport: (...args: unknown[]) => listPostsForExportMock(...args),
  };
});

import { GET } from './route';

function ctx(pin: string) {
  return { params: Promise.resolve({ pin }) };
}

function getReq() {
  return new Request(
    'http://test.local/api/wonderwall/123456/export',
  ) as unknown as import('next/server').NextRequest;
}

const hostSession = {
  user: { id: 'host-1' },
  expires: new Date(Date.now() + 60_000).toISOString(),
};

function post(overrides: Partial<WonderWallPost> = {}): WonderWallPost {
  return {
    id: 'wwp_1',
    sessionId: 'sess_1',
    originalUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789',
    urn: 'urn:li:activity:1234567890123456789',
    embedUrl: 'https://www.linkedin.com/embed/feed/update/urn:li:activity:1234567890123456789',
    status: 'PENDING',
    canDisplay: false,
    position: null,
    submitterName: null,
    submitterKey: null,
    rejectionReason: null,
    failureReason: null,
    reviewedAt: null,
    reviewedByHostUserId: null,
    approvedAt: null,
    rejectedAt: null,
    hiddenAt: null,
    restoredAt: null,
    createdAt: new Date('2026-06-18T00:00:00.000Z'),
    updatedAt: new Date('2026-06-18T00:00:00.000Z'),
    ...overrides,
  } as WonderWallPost;
}

beforeEach(() => {
  authMock.mockReset();
  listPostsForExportMock.mockReset();
  authMock.mockResolvedValue(hostSession);
});

describe('GET /api/wonderwall/[pin]/export', () => {
  it('returns a CSV download for the owning host', async () => {
    listPostsForExportMock.mockResolvedValue([
      post({ id: 'a', status: 'PENDING' }),
      post({ id: 'b', status: 'APPROVED', canDisplay: true, position: 0 }),
      post({
        id: 'c',
        status: 'REJECTED',
        rejectionReason: 'Off topic',
        reviewedByHostUserId: 'host-1',
        reviewedAt: new Date('2026-06-18T12:00:00.000Z'),
      }),
      post({ id: 'd', status: 'HIDDEN', position: 1 }),
      post({ id: 'e', status: 'FAILED', failureReason: 'missing_post_id' }),
    ]);

    const res = await GET(getReq(), ctx('123456'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="wonderwall-123456-submissions.csv"',
    );

    const body = await res.text();
    const lines = body.split('\r\n');
    expect(lines[0]).toBe(
      'submittedAt,status,canDisplay,originalUrl,urn,embedUrl,submitterName,submitterKey,reviewedAt,reviewedByHostUserId,rejectionReason,displayOrder,failureReason',
    );
    // All five statuses present, in the order the repo returned them.
    expect(lines.slice(1, 6).map((l) => l.split(',')[1])).toEqual([
      'PENDING',
      'APPROVED',
      'REJECTED',
      'HIDDEN',
      'FAILED',
    ]);
    expect(body).toContain('Off topic');
    expect(body).toContain('missing_post_id');

    expect(listPostsForExportMock).toHaveBeenCalledWith({ pin: '123456', hostUserId: 'host-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(getReq(), ctx('123456'));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthenticated' });
    expect(listPostsForExportMock).not.toHaveBeenCalled();
  });

  it('returns 403 when a non-owner host requests the export', async () => {
    listPostsForExportMock.mockRejectedValue(new WonderWallOwnershipError('123456'));
    const res = await GET(getReq(), ctx('123456'));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('returns 404 when the wall does not exist', async () => {
    listPostsForExportMock.mockRejectedValue(new WonderWallNotFoundError('123456'));
    const res = await GET(getReq(), ctx('123456'));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('returns 400 for a malformed pin without touching the repo', async () => {
    const res = await GET(getReq(), ctx('12ab'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_pin' });
    expect(listPostsForExportMock).not.toHaveBeenCalled();
  });

  it('returns 500 on an unexpected repo failure', async () => {
    listPostsForExportMock.mockRejectedValue(new Error('db down'));
    const res = await GET(getReq(), ctx('123456'));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'export_failed' });
  });

  it('serves an empty wall as a header-only CSV', async () => {
    listPostsForExportMock.mockResolvedValue([]);
    const res = await GET(getReq(), ctx('123456'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(
      'submittedAt,status,canDisplay,originalUrl,urn,embedUrl,submitterName,submitterKey,reviewedAt,reviewedByHostUserId,rejectionReason,displayOrder,failureReason\r\n',
    );
  });
});
