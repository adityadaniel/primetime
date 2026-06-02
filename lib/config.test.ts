import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

// Each case passes an explicit env bag so the suite never depends on the
// ambient process environment.

describe('loadConfig — OSS defaults', () => {
  it('an empty env yields the password-only, no-billing OSS profile', () => {
    const c = loadConfig({});
    expect(c.authMode).toBe('password');
    expect(c.emailProvider).toBe('none');
    expect(c.uploadProvider).toBe('local');
    expect(c.billingEnabled).toBe(false);
    expect(c.playerCap).toBe(10);
    expect(c.oauthEnabled).toBe(false);
    expect(c.appleEnabled).toBe(false);
    expect(c.emailEnabled).toBe(false);
  });

  it('treats empty-string values as unset and falls back to defaults', () => {
    const c = loadConfig({
      AUTH_MODE: '',
      EMAIL_PROVIDER: '',
      UPLOAD_PROVIDER: '',
      BILLING_ENABLED: '',
      PLAYER_CAP: '',
    });
    expect(c.authMode).toBe('password');
    expect(c.emailProvider).toBe('none');
    expect(c.uploadProvider).toBe('local');
    expect(c.billingEnabled).toBe(false);
    expect(c.playerCap).toBe(10);
  });
});

describe('loadConfig — enum validation', () => {
  it('accepts valid AUTH_MODE values', () => {
    expect(loadConfig({ AUTH_MODE: 'password' }).authMode).toBe('password');
    expect(loadConfig({ AUTH_MODE: 'password+oauth' }).oauthEnabled).toBe(true);
  });

  it('rejects an invalid AUTH_MODE with a clear error', () => {
    expect(() => loadConfig({ AUTH_MODE: 'magic-link' })).toThrow(ConfigError);
    expect(() => loadConfig({ AUTH_MODE: 'magic-link' })).toThrow(/AUTH_MODE must be one of/);
  });

  it('rejects an invalid EMAIL_PROVIDER', () => {
    expect(() => loadConfig({ EMAIL_PROVIDER: 'mailgun' })).toThrow(
      /EMAIL_PROVIDER must be one of/,
    );
  });

  it('rejects an invalid UPLOAD_PROVIDER', () => {
    expect(() => loadConfig({ UPLOAD_PROVIDER: 'gcs' })).toThrow(/UPLOAD_PROVIDER must be one of/);
  });

  it('rejects a non-boolean BILLING_ENABLED', () => {
    expect(() => loadConfig({ BILLING_ENABLED: 'maybe' })).toThrow(ConfigError);
  });

  it('accepts common boolean spellings for BILLING_ENABLED', () => {
    expect(loadConfig({ BILLING_ENABLED: 'true' }).billingEnabled).toBe(true);
    expect(loadConfig({ BILLING_ENABLED: '1' }).billingEnabled).toBe(true);
    expect(loadConfig({ BILLING_ENABLED: 'YES' }).billingEnabled).toBe(true);
    expect(loadConfig({ BILLING_ENABLED: 'false' }).billingEnabled).toBe(false);
    expect(loadConfig({ BILLING_ENABLED: '0' }).billingEnabled).toBe(false);
  });
});

describe('loadConfig — PLAYER_CAP', () => {
  it('parses a valid integer string', () => {
    expect(loadConfig({ PLAYER_CAP: '50' }).playerCap).toBe(50);
  });

  it('rejects a non-numeric value', () => {
    expect(() => loadConfig({ PLAYER_CAP: 'lots' })).toThrow(/PLAYER_CAP must be an integer/);
  });

  it('rejects a non-integer value', () => {
    expect(() => loadConfig({ PLAYER_CAP: '10.5' })).toThrow(/PLAYER_CAP must be an integer/);
  });

  it('rejects values below the minimum', () => {
    expect(() => loadConfig({ PLAYER_CAP: '0' })).toThrow(/at least 1/);
    expect(() => loadConfig({ PLAYER_CAP: '-3' })).toThrow(/at least 1/);
  });
});

describe('loadConfig — email provider vars', () => {
  it('smtp requires host, port, user, and password', () => {
    expect(() => loadConfig({ EMAIL_PROVIDER: 'smtp' })).toThrow(/EMAIL_PROVIDER=smtp/);
    expect(() =>
      loadConfig({
        EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_USER: 'user',
      }),
    ).toThrow(/SMTP_PASSWORD/);
  });

  it('smtp passes when all vars are present', () => {
    const c = loadConfig({
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'secret',
    });
    expect(c.emailProvider).toBe('smtp');
    expect(c.emailEnabled).toBe(true);
  });

  it('resend requires RESEND_API_KEY', () => {
    expect(() => loadConfig({ EMAIL_PROVIDER: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(loadConfig({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_123' }).emailProvider).toBe(
      'resend',
    );
  });

  it('does not require email vars on the default (none) provider', () => {
    expect(() => loadConfig({})).not.toThrow();
  });

  it('accepts token-print without any SMTP vars', () => {
    const c = loadConfig({ EMAIL_PROVIDER: 'token-print' });
    expect(c.emailProvider).toBe('token-print');
    expect(c.emailEnabled).toBe(true);
  });
});

describe('loadConfig — upload provider vars', () => {
  it('s3 requires bucket, region, and credentials', () => {
    expect(() => loadConfig({ UPLOAD_PROVIDER: 's3' })).toThrow(/UPLOAD_PROVIDER=s3/);
    const c = loadConfig({
      UPLOAD_PROVIDER: 's3',
      S3_BUCKET: 'assets',
      S3_REGION: 'auto',
      S3_ACCESS_KEY_ID: 'AKIA',
      S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(c.uploadProvider).toBe('s3');
  });

  it('uploadthing requires UPLOADTHING_TOKEN', () => {
    expect(() => loadConfig({ UPLOAD_PROVIDER: 'uploadthing' })).toThrow(/UPLOADTHING_TOKEN/);
    expect(
      loadConfig({ UPLOAD_PROVIDER: 'uploadthing', UPLOADTHING_TOKEN: 'ut_1' }).uploadProvider,
    ).toBe('uploadthing');
  });

  it('does not require upload vars on the default (local) provider', () => {
    expect(() => loadConfig({})).not.toThrow();
  });
});

describe('loadConfig — Apple / OAuth gating', () => {
  it('Apple stays off when AUTH_MODE is password even with ENABLE_APPLE_SIGNIN=true', () => {
    const c = loadConfig({ AUTH_MODE: 'password', ENABLE_APPLE_SIGNIN: 'true' });
    expect(c.oauthEnabled).toBe(false);
    expect(c.appleEnabled).toBe(false);
  });

  it('Apple stays off in oauth mode when ENABLE_APPLE_SIGNIN is unset', () => {
    const c = loadConfig({ AUTH_MODE: 'password+oauth' });
    expect(c.oauthEnabled).toBe(true);
    expect(c.appleEnabled).toBe(false);
  });

  it('requires Apple credential vars when Apple is requested', () => {
    expect(() => loadConfig({ AUTH_MODE: 'password+oauth', ENABLE_APPLE_SIGNIN: 'true' })).toThrow(
      /ENABLE_APPLE_SIGNIN=true/,
    );
  });

  it('enables Apple when oauth mode + flag + credentials are all present', () => {
    const c = loadConfig({
      AUTH_MODE: 'password+oauth',
      ENABLE_APPLE_SIGNIN: 'true',
      APPLE_ID: 'com.example.app',
      APPLE_TEAM_ID: 'TEAM',
      APPLE_KEY_ID: 'KEY',
      APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----',
    });
    expect(c.appleEnabled).toBe(true);
  });
});
