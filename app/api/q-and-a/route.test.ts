import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
const allocatePinMock = vi.fn();
const createSessionMock = vi.fn();

vi.mock('@/auth', () => ({
  auth: () => authMock(),
}));

vi.mock('@/lib/qa-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/qa-repo')>();
  return {
    ...actual,
    allocatePin: (...args: unknown[]) => allocatePinMock(...args),
    createSession: (...args: unknown[]) => createSessionMock(...args),
  };
});

import { POST } from './route';

function postReq(body: unknown) {
  return new Request('http://test.local/api/q-and-a', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

const hostSession = {
  user: { id: 'host-1' },
  expires: new Date(Date.now() + 60_000).toISOString(),
};

const validBody = {
  title: 'Ask us anything',
  description: 'Questions for the end of the workshop',
  privacyMode: 'ANONYMOUS_BY_DEFAULT',
  moderationEnabled: false,
  participantRepliesEnabled: false,
  downvotesEnabled: false,
  questionCharLimit: 280,
};

beforeEach(() => {
  authMock.mockReset();
  allocatePinMock.mockReset();
  createSessionMock.mockReset();
});

describe('POST /api/q-and-a', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthenticated' });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON', async () => {
    authMock.mockResolvedValue(hostSession);
    const res = await POST(
      new Request('http://test.local/api/q-and-a', {
        method: 'POST',
        body: 'not-json',
      }) as unknown as import('next/server').NextRequest,
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_json' });
  });

  it('rejects a missing title', async () => {
    authMock.mockResolvedValue(hostSession);
    const res = await POST(postReq({ ...validBody, title: undefined }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_title' });
  });

  it('rejects an empty / too-long title', async () => {
    authMock.mockResolvedValue(hostSession);
    const empty = await POST(postReq({ ...validBody, title: '   ' }));
    expect(empty.status).toBe(400);
    await expect(empty.json()).resolves.toEqual({ error: 'title_length_1_to_100' });

    const long = await POST(postReq({ ...validBody, title: 'x'.repeat(101) }));
    expect(long.status).toBe(400);
    await expect(long.json()).resolves.toEqual({ error: 'title_length_1_to_100' });
  });

  it('rejects a too-long description', async () => {
    authMock.mockResolvedValue(hostSession);
    const res = await POST(postReq({ ...validBody, description: 'x'.repeat(201) }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'description_max_200' });
  });

  it('rejects an unknown privacy mode', async () => {
    authMock.mockResolvedValue(hostSession);
    const res = await POST(postReq({ ...validBody, privacyMode: 'PUBLIC' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_privacy_mode' });
  });

  it('rejects non-boolean toggles', async () => {
    authMock.mockResolvedValue(hostSession);
    for (const key of ['moderationEnabled', 'participantRepliesEnabled', 'downvotesEnabled']) {
      const res = await POST(postReq({ ...validBody, [key]: 'yes' }));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: `invalid_${toSnake(key)}` });
    }
  });

  it('rejects a question char limit outside the preset set', async () => {
    authMock.mockResolvedValue(hostSession);
    const res = await POST(postReq({ ...validBody, questionCharLimit: 999 }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_question_char_limit' });
  });

  it('creates a session and returns pin + sessionId', async () => {
    authMock.mockResolvedValue(hostSession);
    allocatePinMock.mockResolvedValue('123456');
    createSessionMock.mockResolvedValue({ id: 'qas_1', pin: '123456' });

    const res = await POST(
      postReq({
        ...validBody,
        title: '  Ask us anything  ',
        privacyMode: 'NAME_REQUIRED',
        moderationEnabled: true,
        questionCharLimit: 500,
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ pin: '123456', sessionId: 'qas_1' });
    expect(createSessionMock).toHaveBeenCalledWith({
      pin: '123456',
      title: 'Ask us anything',
      description: 'Questions for the end of the workshop',
      privacyMode: 'NAME_REQUIRED',
      moderationEnabled: true,
      participantRepliesEnabled: false,
      downvotesEnabled: false,
      questionCharLimit: 500,
      hostUserId: 'host-1',
    });
  });

  it('defaults optional fields when omitted', async () => {
    authMock.mockResolvedValue(hostSession);
    allocatePinMock.mockResolvedValue('654321');
    createSessionMock.mockResolvedValue({ id: 'qas_2', pin: '654321' });

    const res = await POST(postReq({ title: 'Town hall' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ pin: '654321', sessionId: 'qas_2' });
    expect(createSessionMock).toHaveBeenCalledWith({
      pin: '654321',
      title: 'Town hall',
      description: null,
      privacyMode: 'ANONYMOUS_BY_DEFAULT',
      moderationEnabled: false,
      participantRepliesEnabled: false,
      downvotesEnabled: false,
      questionCharLimit: 280,
      hostUserId: 'host-1',
    });
  });

  it('returns 503 when no PIN can be allocated', async () => {
    authMock.mockResolvedValue(hostSession);
    allocatePinMock.mockRejectedValue(new Error('Could not allocate PIN'));
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'pin_unavailable' });
  });
});

function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
