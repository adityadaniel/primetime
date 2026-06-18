import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
const allocatePinMock = vi.fn();
const createSessionMock = vi.fn();

vi.mock('@/auth', () => ({
  auth: () => authMock(),
}));

vi.mock('@/lib/wonderwall-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wonderwall-repo')>();
  return {
    ...actual,
    allocatePin: (...args: unknown[]) => allocatePinMock(...args),
    createSession: (...args: unknown[]) => createSessionMock(...args),
  };
});

import { POST } from './route';

function postReq(body: unknown) {
  return new Request('http://test.local/api/wonderwall', {
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
  title: 'Wall of LinkedIn wins',
  description: 'Drop the posts you want on the big screen',
  instructions: 'Paste a public LinkedIn post URL',
};

beforeEach(() => {
  authMock.mockReset();
  allocatePinMock.mockReset();
  createSessionMock.mockReset();
});

describe('POST /api/wonderwall', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthenticated' });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the authenticated session has no user id', async () => {
    authMock.mockResolvedValue({ user: {}, expires: hostSession.expires });
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthenticated' });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON', async () => {
    authMock.mockResolvedValue(hostSession);
    const res = await POST(
      new Request('http://test.local/api/wonderwall', {
        method: 'POST',
        body: 'not-json',
      }) as unknown as import('next/server').NextRequest,
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_json' });
  });

  it('rejects a non-object body', async () => {
    authMock.mockResolvedValue(hostSession);
    const res = await POST(postReq(42));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_body' });
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

  it('rejects a non-string description', async () => {
    authMock.mockResolvedValue(hostSession);
    const res = await POST(postReq({ ...validBody, description: 42 }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_description' });
  });

  it('rejects a too-long description', async () => {
    authMock.mockResolvedValue(hostSession);
    const res = await POST(postReq({ ...validBody, description: 'x'.repeat(201) }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'description_max_200' });
  });

  it('rejects a non-string instructions', async () => {
    authMock.mockResolvedValue(hostSession);
    const res = await POST(postReq({ ...validBody, instructions: 42 }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_instructions' });
  });

  it('rejects too-long instructions', async () => {
    authMock.mockResolvedValue(hostSession);
    const res = await POST(postReq({ ...validBody, instructions: 'x'.repeat(241) }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'instructions_max_240' });
  });

  it('creates a session and returns pin + sessionId', async () => {
    authMock.mockResolvedValue(hostSession);
    allocatePinMock.mockResolvedValue('123456');
    createSessionMock.mockResolvedValue({ id: 'wws_1', pin: '123456' });

    const res = await POST(
      postReq({
        title: '  Wall of LinkedIn wins  ',
        description: '  Drop the posts you want on the big screen  ',
        instructions: '  Paste a public LinkedIn post URL  ',
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ pin: '123456', sessionId: 'wws_1' });
    expect(createSessionMock).toHaveBeenCalledWith({
      pin: '123456',
      title: 'Wall of LinkedIn wins',
      description: 'Drop the posts you want on the big screen',
      instructions: 'Paste a public LinkedIn post URL',
      hostUserId: 'host-1',
    });
  });

  it('defaults optional fields to null when omitted or blank', async () => {
    authMock.mockResolvedValue(hostSession);
    allocatePinMock.mockResolvedValue('654321');
    createSessionMock.mockResolvedValue({ id: 'wws_2', pin: '654321' });

    const res = await POST(
      postReq({ title: 'Just a title', description: '   ', instructions: '' }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ pin: '654321', sessionId: 'wws_2' });
    expect(createSessionMock).toHaveBeenCalledWith({
      pin: '654321',
      title: 'Just a title',
      description: null,
      instructions: null,
      hostUserId: 'host-1',
    });
  });

  it('returns 503 when no PIN can be allocated', async () => {
    authMock.mockResolvedValue(hostSession);
    allocatePinMock.mockRejectedValue(new Error('Could not allocate PIN'));
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'pin_unavailable' });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('returns 500 with a safe message when create fails unexpectedly', async () => {
    authMock.mockResolvedValue(hostSession);
    allocatePinMock.mockResolvedValue('111222');
    createSessionMock.mockRejectedValue(
      new Error('Unique constraint failed on WonderWallSession.pin'),
    );
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'create_failed' });
  });
});
