import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionFindUnique = vi.fn();
const submissionFindMany = vi.fn();
const authMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    wordCloudSession: { findUnique: (args: unknown) => sessionFindUnique(args) },
    wordCloudSubmission: { findMany: (args: unknown) => submissionFindMany(args) },
  },
}));

vi.mock('@/auth', () => ({
  auth: () => authMock(),
}));

import { GET } from './route';

const ctx = { params: Promise.resolve({ pin: '123456' }) } as const;
const req = {} as unknown as import('next/server').NextRequest;

beforeEach(() => {
  sessionFindUnique.mockReset();
  submissionFindMany.mockReset();
  authMock.mockReset();
});

describe('GET /host/wordcloud/[pin]/answers.csv', () => {
  it('returns 400 for malformed pin', async () => {
    const r = await GET(req, { params: Promise.resolve({ pin: 'abc' }) });
    expect(r.status).toBe(400);
  });

  it('returns 404 if session does not exist', async () => {
    sessionFindUnique.mockResolvedValue(null);
    const r = await GET(req, ctx);
    expect(r.status).toBe(404);
  });

  it('returns 409 if status is LOBBY', async () => {
    sessionFindUnique.mockResolvedValue({
      id: 'wcs_1',
      hostUserId: null,
      prompt: 'p',
      status: 'LOBBY',
    });
    const r = await GET(req, ctx);
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.error).toBe('session_not_ended');
    expect(body.status).toBe('LOBBY');
  });

  it('returns 409 if status is LIVE', async () => {
    sessionFindUnique.mockResolvedValue({
      id: 'wcs_1',
      hostUserId: null,
      prompt: 'p',
      status: 'LIVE',
    });
    const r = await GET(req, ctx);
    expect(r.status).toBe(409);
  });

  it('returns 409 if status is PAUSED', async () => {
    sessionFindUnique.mockResolvedValue({
      id: 'wcs_1',
      hostUserId: null,
      prompt: 'p',
      status: 'PAUSED',
    });
    const r = await GET(req, ctx);
    expect(r.status).toBe(409);
  });

  it('returns 200 with CSV when status is ENDED', async () => {
    sessionFindUnique.mockResolvedValue({
      id: 'wcs_1',
      hostUserId: null,
      prompt: 'mood',
      status: 'ENDED',
    });
    submissionFindMany.mockResolvedValue([]);
    const r = await GET(req, ctx);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/csv');
  });

  it('returns 200 with CSV when status is ARCHIVED', async () => {
    sessionFindUnique.mockResolvedValue({
      id: 'wcs_1',
      hostUserId: null,
      prompt: 'mood',
      status: 'ARCHIVED',
    });
    submissionFindMany.mockResolvedValue([]);
    const r = await GET(req, ctx);
    expect(r.status).toBe(200);
  });

  it('returns 401 when host-owned session is fetched without auth', async () => {
    sessionFindUnique.mockResolvedValue({
      id: 'wcs_1',
      hostUserId: 'user_a',
      prompt: 'mood',
      status: 'ENDED',
    });
    authMock.mockResolvedValue(null);
    const r = await GET(req, ctx);
    expect(r.status).toBe(401);
  });

  it('returns 403 when authed user is not the host', async () => {
    sessionFindUnique.mockResolvedValue({
      id: 'wcs_1',
      hostUserId: 'user_a',
      prompt: 'mood',
      status: 'ENDED',
    });
    authMock.mockResolvedValue({ user: { id: 'user_b' } });
    const r = await GET(req, ctx);
    expect(r.status).toBe(403);
  });
});
