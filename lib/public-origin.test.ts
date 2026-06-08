import { afterEach, describe, expect, it } from 'vitest';
import { publicHost, publicOrigin, publicUrl } from './public-origin';

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
});

describe('public origin helpers', () => {
  it('prefers NEXT_PUBLIC_SITE_URL over the current browser origin', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://live.theprimetime.id/';

    expect(publicOrigin('http://localhost:4321')).toBe('https://live.theprimetime.id');
    expect(publicUrl('/join?pin=863786', 'http://localhost:4321')).toBe(
      'https://live.theprimetime.id/join?pin=863786',
    );
    expect(publicHost('http://localhost:4321')).toBe('live.theprimetime.id');
  });

  it('falls back to the current browser origin when no public site URL is configured', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;

    expect(publicUrl('/join?pin=863786', 'http://localhost:4321')).toBe(
      'http://localhost:4321/join?pin=863786',
    );
  });
});
