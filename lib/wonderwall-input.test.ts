import { describe, expect, it } from 'vitest';
import { type LinkedInPostUrn, parseLinkedInPostUrl, toLinkedInEmbedUrl } from './wonderwall-input';

const ID = '1234567890123456789';

describe('parseLinkedInPostUrl — supported post URLs', () => {
  it('parses a feed/update activity URL to urn:li:activity:<id>', () => {
    const url = `https://www.linkedin.com/feed/update/urn:li:activity:${ID}`;
    expect(parseLinkedInPostUrl(url)).toEqual({
      ok: true,
      platform: 'linkedin',
      originalUrl: url,
      urn: `urn:li:activity:${ID}`,
      embedUrl: `https://www.linkedin.com/embed/feed/update/urn:li:activity:${ID}`,
    });
  });

  it('parses a posts activity-<id> URL to urn:li:activity:<id>', () => {
    const url = `https://www.linkedin.com/posts/someone_activity-${ID}-abc`;
    const result = parseLinkedInPostUrl(url);
    expect(result.ok).toBe(true);
    expect(result.ok && result.urn).toBe(`urn:li:activity:${ID}`);
  });

  it('parses a posts ugcPost-<id> URL to urn:li:ugcPost:<id>', () => {
    const url = `https://www.linkedin.com/posts/someone_ugcPost-${ID}-abc`;
    const result = parseLinkedInPostUrl(url);
    expect(result.ok).toBe(true);
    expect(result.ok && result.urn).toBe(`urn:li:ugcPost:${ID}`);
  });

  it('parses a posts share-<id> URL to urn:li:share:<id>', () => {
    const url = `https://www.linkedin.com/posts/someone_share-${ID}-abc`;
    const result = parseLinkedInPostUrl(url);
    expect(result.ok).toBe(true);
    expect(result.ok && result.urn).toBe(`urn:li:share:${ID}`);
  });

  it('parses the stretch feed/update ugcPost urn form', () => {
    const url = `https://www.linkedin.com/feed/update/urn:li:ugcPost:${ID}`;
    const result = parseLinkedInPostUrl(url);
    expect(result.ok).toBe(true);
    expect(result.ok && result.urn).toBe(`urn:li:ugcPost:${ID}`);
  });

  it('parses the stretch feed/update share urn form', () => {
    const url = `https://www.linkedin.com/feed/update/urn:li:share:${ID}`;
    const result = parseLinkedInPostUrl(url);
    expect(result.ok).toBe(true);
    expect(result.ok && result.urn).toBe(`urn:li:share:${ID}`);
  });

  it('accepts the bare linkedin.com host without www', () => {
    const url = `https://linkedin.com/feed/update/urn:li:activity:${ID}`;
    const result = parseLinkedInPostUrl(url);
    expect(result.ok).toBe(true);
    expect(result.ok && result.urn).toBe(`urn:li:activity:${ID}`);
  });

  it('tolerates a trailing slash on a feed/update URL', () => {
    const url = `https://www.linkedin.com/feed/update/urn:li:activity:${ID}/`;
    const result = parseLinkedInPostUrl(url);
    expect(result.ok).toBe(true);
    expect(result.ok && result.urn).toBe(`urn:li:activity:${ID}`);
  });

  it('ignores query strings and fragments around a valid post', () => {
    const url = `https://www.linkedin.com/feed/update/urn:li:activity:${ID}?utm=1#x`;
    const result = parseLinkedInPostUrl(url);
    expect(result.ok).toBe(true);
    expect(result.ok && result.urn).toBe(`urn:li:activity:${ID}`);
  });

  it('preserves the trimmed original URL when input has surrounding whitespace', () => {
    const url = `https://www.linkedin.com/feed/update/urn:li:activity:${ID}`;
    const result = parseLinkedInPostUrl(`   ${url}   `);
    expect(result.ok && result.originalUrl).toBe(url);
  });
});

describe('parseLinkedInPostUrl — rejections', () => {
  it('rejects a non-LinkedIn host with unsupported_host', () => {
    expect(parseLinkedInPostUrl(`https://example.com/feed/update/urn:li:activity:${ID}`)).toEqual({
      ok: false,
      reason: 'unsupported_host',
    });
  });

  it('rejects lookalike/subdomain hosts with unsupported_host', () => {
    expect(
      parseLinkedInPostUrl(`https://ads.linkedin.com/feed/update/urn:li:activity:${ID}`),
    ).toEqual({ ok: false, reason: 'unsupported_host' });
    expect(
      parseLinkedInPostUrl(`https://linkedin.com.evil.example/feed/update/urn:li:activity:${ID}`),
    ).toEqual({ ok: false, reason: 'unsupported_host' });
  });

  it('rejects non-https protocols with unsupported_protocol', () => {
    expect(
      parseLinkedInPostUrl(`http://www.linkedin.com/feed/update/urn:li:activity:${ID}`),
    ).toEqual({ ok: false, reason: 'unsupported_protocol' });
  });

  it('rejects a LinkedIn profile URL with unsupported_linkedin_url', () => {
    expect(parseLinkedInPostUrl('https://www.linkedin.com/in/some-person')).toEqual({
      ok: false,
      reason: 'unsupported_linkedin_url',
    });
  });

  it('rejects a LinkedIn company URL with unsupported_linkedin_url', () => {
    expect(parseLinkedInPostUrl('https://www.linkedin.com/company/some-co')).toEqual({
      ok: false,
      reason: 'unsupported_linkedin_url',
    });
  });

  it('rejects the LinkedIn feed home with unsupported_linkedin_url', () => {
    expect(parseLinkedInPostUrl('https://www.linkedin.com/feed/')).toEqual({
      ok: false,
      reason: 'unsupported_linkedin_url',
    });
  });

  it('rejects a feed/update path with a non-numeric id as missing_post_id', () => {
    expect(
      parseLinkedInPostUrl('https://www.linkedin.com/feed/update/urn:li:activity:notanumber'),
    ).toEqual({ ok: false, reason: 'missing_post_id' });
  });

  it('rejects a feed/update path with an unsupported urn type as missing_post_id', () => {
    expect(
      parseLinkedInPostUrl(`https://www.linkedin.com/feed/update/urn:li:comment:${ID}`),
    ).toEqual({ ok: false, reason: 'missing_post_id' });
  });

  it('rejects a posts path without a recognized token as missing_post_id', () => {
    expect(parseLinkedInPostUrl('https://www.linkedin.com/posts/just-a-slug')).toEqual({
      ok: false,
      reason: 'missing_post_id',
    });
  });

  it('rejects posts tokens with non-numeric suffixes as missing_post_id', () => {
    expect(parseLinkedInPostUrl('https://www.linkedin.com/posts/someone_activity-123abc')).toEqual({
      ok: false,
      reason: 'missing_post_id',
    });
    expect(parseLinkedInPostUrl('https://www.linkedin.com/posts/user_ugcPost-456extra')).toEqual({
      ok: false,
      reason: 'missing_post_id',
    });
  });

  it('rejects posts tokens outside the LinkedIn vanity slug as missing_post_id', () => {
    expect(
      parseLinkedInPostUrl('https://www.linkedin.com/posts/not-a-real-path/activity-123'),
    ).toEqual({
      ok: false,
      reason: 'missing_post_id',
    });
  });

  it('rejects a malformed URL with invalid_url', () => {
    expect(parseLinkedInPostUrl('not a url')).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('rejects empty/whitespace input with invalid_url', () => {
    expect(parseLinkedInPostUrl('')).toEqual({ ok: false, reason: 'invalid_url' });
    expect(parseLinkedInPostUrl('   ')).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('rejects non-string input defensively with invalid_url', () => {
    expect(parseLinkedInPostUrl(undefined as unknown as string)).toEqual({
      ok: false,
      reason: 'invalid_url',
    });
    expect(parseLinkedInPostUrl(null as unknown as string)).toEqual({
      ok: false,
      reason: 'invalid_url',
    });
  });
});

describe('toLinkedInEmbedUrl', () => {
  it('builds the exact LinkedIn embed URL for a URN', () => {
    const urn: LinkedInPostUrn = `urn:li:activity:${ID}`;
    expect(toLinkedInEmbedUrl(urn)).toBe(
      `https://www.linkedin.com/embed/feed/update/urn:li:activity:${ID}`,
    );
  });

  it('matches the embedUrl returned by the parser', () => {
    const url = `https://www.linkedin.com/feed/update/urn:li:share:${ID}`;
    const result = parseLinkedInPostUrl(url);
    expect(result.ok && result.embedUrl).toBe(toLinkedInEmbedUrl(`urn:li:share:${ID}`));
  });
});
