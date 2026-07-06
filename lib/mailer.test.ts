import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildResetMailer } from './mailer';

const BASE_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in BASE_ENV)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(BASE_ENV)) {
    process.env[k] = v;
  }
}

describe('buildResetMailer — provider modes', () => {
  beforeEach(() => restoreEnv());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv();
  });

  it('returns a function for none provider', () => {
    const mailer = buildResetMailer('none');
    expect(typeof mailer).toBe('function');
  });

  it('returns a function for token-print provider', () => {
    const mailer = buildResetMailer('token-print');
    expect(typeof mailer).toBe('function');
  });

  it('returns a function for resend provider', () => {
    const mailer = buildResetMailer('resend');
    expect(typeof mailer).toBe('function');
  });
});

describe('buildResetMailer — runtime behavior', () => {
  beforeEach(() => restoreEnv());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv();
  });

  it('token-print returns devUrl and logs a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mailer = buildResetMailer('token-print');
    const result = await mailer({ to: 'dev@example.test', url: 'http://localhost:4321/reset/abc' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.devUrl).toBe('http://localhost:4321/reset/abc');
    }
    expect(warn.mock.calls.length).toBeGreaterThan(0);
    expect(warn.mock.calls.flat().join(' ')).toContain('http://localhost:4321/reset/abc');
  });

  it('default/unknown mode logs a dev warning with the reset URL', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mailer = buildResetMailer('none');
    const result = await mailer({ to: 'dev@example.test', url: 'http://localhost:4321/reset/xyz' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.devUrl).toBe('http://localhost:4321/reset/xyz');
    }
    expect(warn.mock.calls.length).toBeGreaterThan(0);
  });

  it('resend posts the password-reset email through the Resend HTTP API', async () => {
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.EMAIL_FROM = 'PRIMETIME <reset@example.test>';
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: 'email_123' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const mailer = buildResetMailer('resend');
    const result = await mailer({
      to: 'host@example.test',
      url: 'http://localhost:4321/reset/token',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer re_test_123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'PRIMETIME <reset@example.test>',
          to: 'host@example.test',
          subject: 'Reset your PRIMETIME password',
          text: 'Open this link to reset your password: http://localhost:4321/reset/token\n\nIf you did not request this, ignore this email.',
          html: '<p>Open this link to reset your password: <a href="http://localhost:4321/reset/token">http://localhost:4321/reset/token</a></p><p>If you did not request this, ignore this email.</p>',
        }),
      }),
    );
  });

  it('resend reports a failed HTTP response without exposing the API key', async () => {
    process.env.RESEND_API_KEY = 're_secret_should_not_leak';
    process.env.EMAIL_FROM = 'PRIMETIME <reset@example.test>';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ message: 'invalid sender' }), { status: 403 }),
      ),
    );

    const mailer = buildResetMailer('resend');
    const result = await mailer({
      to: 'host@example.test',
      url: 'http://localhost:4321/reset/token',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Resend API returned 403');
      expect(result.error).toContain('invalid sender');
      expect(result.error).not.toContain('re_secret_should_not_leak');
    }
  });
});
