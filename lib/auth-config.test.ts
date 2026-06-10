import { describe, expect, it } from 'vitest';
import authConfig, { isPublicHostDisplayPath } from '../auth.config';

describe('auth route visibility', () => {
  it('allows projection display pages without a host session', () => {
    expect(isPublicHostDisplayPath('/host/123456/display')).toBe(true);
    expect(isPublicHostDisplayPath('/host/123456/display/')).toBe(true);
    expect(isPublicHostDisplayPath('/host/wordcloud/123456/display')).toBe(true);
    expect(isPublicHostDisplayPath('/host/wordcloud/123456/display/')).toBe(true);
    expect(isPublicHostDisplayPath('/host/q-and-a/123456/display')).toBe(true);
    expect(isPublicHostDisplayPath('/host/q-and-a/123456/display/')).toBe(true);
  });

  it('keeps builder and control-room routes protected', () => {
    expect(isPublicHostDisplayPath('/host')).toBe(false);
    expect(isPublicHostDisplayPath('/host/quiz/new')).toBe(false);
    expect(isPublicHostDisplayPath('/host/123456/control')).toBe(false);
    expect(isPublicHostDisplayPath('/host/wordcloud/new')).toBe(false);
    expect(isPublicHostDisplayPath('/host/wordcloud/123456/control')).toBe(false);
    expect(isPublicHostDisplayPath('/host/q-and-a/new')).toBe(false);
    expect(isPublicHostDisplayPath('/host/q-and-a/123456/control')).toBe(false);
  });

  it('lets Auth.js middleware pass unauthenticated display pages only', async () => {
    const authorized = authConfig.callbacks?.authorized;
    expect(authorized).toBeTypeOf('function');

    await expect(
      Promise.resolve(
        authorized?.({
          auth: null,
          request: { nextUrl: new URL('https://live.theprimetime.id/host/123456/display') },
        } as never),
      ),
    ).resolves.toBe(true);

    await expect(
      Promise.resolve(
        authorized?.({
          auth: null,
          request: { nextUrl: new URL('https://live.theprimetime.id/host/123456/control') },
        } as never),
      ),
    ).resolves.toBe(false);
  });
});
