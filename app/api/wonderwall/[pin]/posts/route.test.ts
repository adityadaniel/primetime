import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests } from '@/lib/rate-limit';
import { WonderWallSubmissionError } from '@/lib/wonderwall-repo';

const submitPostMock = vi.fn();

vi.mock('@/lib/wonderwall-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wonderwall-repo')>();
  return {
    ...actual,
    submitPost: (...args: unknown[]) => submitPostMock(...args),
  };
});

import { POST } from './route';

function postReq(body: unknown, opts: { raw?: boolean } = {}) {
  return new Request('http://test.local/api/wonderwall/123456/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: opts.raw ? (body as string) : JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

function ctx(pin: string) {
  return { params: Promise.resolve({ pin }) };
}

const createdAt = new Date('2026-06-18T00:00:00.000Z');

const pendingPost = {
  id: 'wwp_1',
  originalUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789',
  urn: 'urn:li:activity:1234567890123456789',
  embedUrl: 'https://www.linkedin.com/embed/feed/update/urn:li:activity:1234567890123456789',
  status: 'PENDING' as const,
  canDisplay: false,
  position: null,
  submitterName: 'Ada',
  submitterKey: 'browser-key',
  rejectionReason: null,
  failureReason: null,
  createdAt,
};

const validUrl = 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789';

beforeEach(() => {
  submitPostMock.mockReset();
  __resetRateLimitForTests();
});

describe('POST /api/wonderwall/[pin]/posts', () => {
  it('creates a PENDING/canDisplay=false post for a valid URL without host auth', async () => {
    submitPostMock.mockResolvedValue(pendingPost);

    const res = await POST(
      postReq({ url: validUrl, submitterName: 'Ada', submitterKey: 'browser-key' }),
      ctx('123456'),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      post: {
        id: 'wwp_1',
        originalUrl: pendingPost.originalUrl,
        urn: pendingPost.urn,
        status: 'PENDING',
        canDisplay: false,
        createdAt: '2026-06-18T00:00:00.000Z',
      },
      message: 'Submitted for host review',
    });
    expect(submitPostMock).toHaveBeenCalledWith({
      pin: '123456',
      url: validUrl,
      submitterName: 'Ada',
      submitterKey: 'browser-key',
    });
  });

  it('does not leak host-only fields or approve/display controls', async () => {
    submitPostMock.mockResolvedValue({ ...pendingPost, status: 'APPROVED', canDisplay: true });
    const res = await POST(postReq({ url: validUrl }), ctx('123456'));
    const json = (await res.json()) as { post: Record<string, unknown> };
    // The submission response must never expose review-only or display fields.
    expect(json.post).not.toHaveProperty('position');
    expect(json.post).not.toHaveProperty('submitterName');
    expect(json.post).not.toHaveProperty('submitterKey');
    expect(json.post).not.toHaveProperty('rejectionReason');
    expect(json.post).not.toHaveProperty('failureReason');
    expect(json.post).not.toHaveProperty('embedUrl');
    // The route asserts the public submission invariant even if a future repo
    // regression returns displayable state.
    expect(json.post.status).toBe('PENDING');
    expect(json.post.canDisplay).toBe(false);
  });

  it('passes null submitter fields through when omitted', async () => {
    submitPostMock.mockResolvedValue(pendingPost);
    await POST(postReq({ url: validUrl }), ctx('123456'));
    expect(submitPostMock).toHaveBeenCalledWith({
      pin: '123456',
      url: validUrl,
      submitterName: null,
      submitterKey: null,
    });
  });

  it('returns 400 invalid_pin for a malformed pin', async () => {
    const res = await POST(postReq({ url: validUrl }), ctx('12ab'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_pin' });
    expect(submitPostMock).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await POST(postReq('not-json', { raw: true }), ctx('123456'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_json' });
    expect(submitPostMock).not.toHaveBeenCalled();
  });

  it('rejects a non-object body', async () => {
    const res = await POST(postReq(42), ctx('123456'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_body' });
    expect(submitPostMock).not.toHaveBeenCalled();
  });

  it('rejects a missing/blank/non-string url', async () => {
    for (const url of [undefined, '   ', 42]) {
      const res = await POST(postReq({ url }), ctx('123456'));
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('invalid_url');
    }
    expect(submitPostMock).not.toHaveBeenCalled();
  });

  it('rejects non-string or overlong submitterName / submitterKey', async () => {
    const name = await POST(postReq({ url: validUrl, submitterName: 42 }), ctx('123456'));
    expect(name.status).toBe(400);
    await expect(name.json()).resolves.toEqual({ error: 'invalid_submitter_name' });

    const longName = await POST(
      postReq({ url: validUrl, submitterName: 'x'.repeat(41) }),
      ctx('123456'),
    );
    expect(longName.status).toBe(400);
    await expect(longName.json()).resolves.toEqual({ error: 'invalid_submitter_name' });

    const key = await POST(postReq({ url: validUrl, submitterKey: 42 }), ctx('123456'));
    expect(key.status).toBe(400);
    await expect(key.json()).resolves.toEqual({ error: 'invalid_submitter_key' });

    const longKey = await POST(
      postReq({ url: validUrl, submitterKey: 'x'.repeat(121) }),
      ctx('123456'),
    );
    expect(longKey.status).toBe(400);
    await expect(longKey.json()).resolves.toEqual({ error: 'invalid_submitter_key' });

    expect(submitPostMock).not.toHaveBeenCalled();
  });

  it('rate limits repeated submissions by submitter key before touching the repo', async () => {
    submitPostMock.mockResolvedValue(pendingPost);
    for (let i = 0; i < 10; i++) {
      const ok = await POST(
        postReq({ url: validUrl, submitterKey: 'same-browser' }),
        ctx('123456'),
      );
      expect(ok.status).toBe(200);
    }

    const limited = await POST(
      postReq({ url: validUrl, submitterKey: 'same-browser' }),
      ctx('123456'),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    await expect(limited.json()).resolves.toEqual({
      error: 'rate_limited',
      message: 'Too many submissions. Wait a moment, then try again.',
    });
    expect(submitPostMock).toHaveBeenCalledTimes(10);
  });

  it('rate limits repeated submissions by forwarded IP when no submitter key exists', async () => {
    submitPostMock.mockResolvedValue(pendingPost);
    for (let i = 0; i < 10; i++) {
      await POST(
        new Request('http://test.local/api/wonderwall/123456/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.1, proxy' },
          body: JSON.stringify({ url: validUrl }),
        }) as unknown as import('next/server').NextRequest,
        ctx('123456'),
      );
    }

    const limited = await POST(
      new Request('http://test.local/api/wonderwall/123456/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.1, proxy' },
        body: JSON.stringify({ url: validUrl }),
      }) as unknown as import('next/server').NextRequest,
      ctx('123456'),
    );
    expect(limited.status).toBe(429);
    expect(submitPostMock).toHaveBeenCalledTimes(10);
  });

  it('keeps the IP rate limit when clients rotate submitter keys', async () => {
    submitPostMock.mockResolvedValue(pendingPost);
    for (let i = 0; i < 10; i++) {
      const ok = await POST(
        new Request('http://test.local/api/wonderwall/123456/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.2' },
          body: JSON.stringify({ url: validUrl, submitterKey: `rotating-${i}` }),
        }) as unknown as import('next/server').NextRequest,
        ctx('123456'),
      );
      expect(ok.status).toBe(200);
    }

    const limited = await POST(
      new Request('http://test.local/api/wonderwall/123456/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.2' },
        body: JSON.stringify({ url: validUrl, submitterKey: 'rotating-last' }),
      }) as unknown as import('next/server').NextRequest,
      ctx('123456'),
    );
    expect(limited.status).toBe(429);
    expect(submitPostMock).toHaveBeenCalledTimes(10);
  });

  it('maps an unknown wall to the project-standard 404 not-found shape', async () => {
    submitPostMock.mockRejectedValue(new WonderWallSubmissionError('session_not_found'));
    const res = await POST(postReq({ url: validUrl }), ctx('999999'));
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe('not_found');
    expect(typeof json.message).toBe('string');
  });

  it('maps a closed wall to 409 with a user-facing message', async () => {
    submitPostMock.mockRejectedValue(new WonderWallSubmissionError('submissions_closed'));
    const res = await POST(postReq({ url: validUrl }), ctx('123456'));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe('submissions_closed');
    expect(typeof json.message).toBe('string');
  });

  it('maps parser rejections to 400 with reason + user-facing message', async () => {
    const reasons = [
      'invalid_url',
      'unsupported_protocol',
      'unsupported_host',
      'unsupported_linkedin_url',
      'missing_post_id',
    ] as const;
    for (const reason of reasons) {
      submitPostMock.mockReset();
      submitPostMock.mockRejectedValue(new WonderWallSubmissionError(reason));
      const res = await POST(postReq({ url: 'https://example.com' }), ctx('123456'));
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; message: string };
      expect(json.error).toBe(reason);
      expect(typeof json.message).toBe('string');
    }
  });

  it('returns 500 for an unexpected repo failure', async () => {
    submitPostMock.mockRejectedValue(new Error('db down'));
    const res = await POST(postReq({ url: validUrl }), ctx('123456'));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'submit_failed' });
  });
});
