import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';

const ALLOWED = ['/', '/pricing', '/signin', '/signup', '/privacy', '/terms'] as const;
const DISALLOWED = ['/host', '/host/*', '/api/*', '/play/*', '/join'] as const;

const ORIGINAL_ENV = {
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://broadcast.example.com';
  process.env.NEXTAUTH_URL = 'https://auth.broadcast.example.com';
});

afterEach(() => {
  if (ORIGINAL_ENV.NEXT_PUBLIC_SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_ENV.NEXT_PUBLIC_SITE_URL;
  if (ORIGINAL_ENV.NEXTAUTH_URL === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = ORIGINAL_ENV.NEXTAUTH_URL;
});

describe('robots', () => {
  it('allows the public marketing surfaces and disallows app/api routes', () => {
    const out = robots();
    const rules = Array.isArray(out.rules) ? out.rules : [out.rules];
    const wildcardRule = rules.find((r) => r.userAgent === '*');
    expect(wildcardRule).toBeDefined();

    const allow = ([] as string[]).concat(wildcardRule?.allow ?? []);
    const disallow = ([] as string[]).concat(wildcardRule?.disallow ?? []);

    for (const path of ALLOWED) {
      expect(allow).toContain(path);
    }
    for (const path of DISALLOWED) {
      expect(disallow).toContain(path);
    }
  });

  it('uses NEXT_PUBLIC_SITE_URL as the canonical host', () => {
    const out = robots();
    expect(out.host).toBe('https://broadcast.example.com');
    expect(out.sitemap).toBe('https://broadcast.example.com/sitemap.xml');
  });

  it('falls back to NEXTAUTH_URL when NEXT_PUBLIC_SITE_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const out = robots();
    expect(out.host).toBe('https://auth.broadcast.example.com');
  });

  it('falls back to localhost:4321 when neither env var is set', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXTAUTH_URL;
    const out = robots();
    expect(out.host).toBe('http://localhost:4321');
  });
});

describe('sitemap', () => {
  it('lists every allowed marketing path with the canonical origin', () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    for (const path of ALLOWED) {
      expect(urls).toContain(`https://broadcast.example.com${path}`);
    }
  });

  it('does not advertise disallowed app routes', () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    for (const path of DISALLOWED) {
      const literal = path.replace('/*', '');
      expect(urls.some((u) => u.endsWith(literal))).toBe(false);
    }
  });
});
