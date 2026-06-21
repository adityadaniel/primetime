import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLinkedInPost, normalizeApifyPost } from './wonderwall-apify';

describe('normalizeApifyPost', () => {
  it('pulls text/author/engagement across alternate keys', () => {
    const out = normalizeApifyPost({
      text: 'Hello #hiring',
      actor: { name: 'Ada', position: 'CTO' },
      numLikes: 10,
      numComments: '3',
      engagement: { shares: 2 },
      url: 'https://www.linkedin.com/posts/x',
      createdAt: '2026-06-20T10:00:00Z',
    });
    expect(out.text).toBe('Hello #hiring');
    expect(out.authorName).toBe('Ada');
    expect(out.authorHeadline).toBe('CTO');
    expect(out.numLikes).toBe(10);
    expect(out.numComments).toBe(3);
    expect(out.numShares).toBe(2);
    expect(out.postedAt?.toISOString()).toBe('2026-06-20T10:00:00.000Z');
  });

  it('returns nulls for missing fields', () => {
    const out = normalizeApifyPost({});
    expect(out.text).toBeNull();
    expect(out.authorName).toBeNull();
    expect(out.numLikes).toBeNull();
    expect(out.postedAt).toBeNull();
  });
});

describe('fetchLinkedInPost', () => {
  const original = process.env.APIFY_TOKEN;
  afterEach(() => {
    if (original === undefined) delete process.env.APIFY_TOKEN;
    else process.env.APIFY_TOKEN = original;
    vi.unstubAllGlobals();
  });

  it('returns apify_not_configured without a token', async () => {
    delete process.env.APIFY_TOKEN;
    expect(await fetchLinkedInPost('https://www.linkedin.com/posts/x')).toEqual({
      ok: false,
      error: 'apify_not_configured',
    });
  });

  it('returns ok with normalized data on success', async () => {
    process.env.APIFY_TOKEN = 'tok';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [{ text: 'Hi there', author: { name: 'B' } }],
      })),
    );
    const r = await fetchLinkedInPost('https://www.linkedin.com/posts/x');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.text).toBe('Hi there');
      expect(r.data.authorName).toBe('B');
    }
  });

  it('maps HTTP errors', async () => {
    process.env.APIFY_TOKEN = 'tok';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 402, text: async () => 'no credit' })),
    );
    const r = await fetchLinkedInPost('https://www.linkedin.com/posts/x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('apify_http_402');
  });

  it('returns apify_no_text when the item has no body', async () => {
    process.env.APIFY_TOKEN = 'tok';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => [{ author: { name: 'B' } }] })),
    );
    expect(await fetchLinkedInPost('https://www.linkedin.com/posts/x')).toEqual({
      ok: false,
      error: 'apify_no_text',
    });
  });
});
