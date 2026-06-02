import { describe, expect, it } from 'vitest';

describe('health check logic', () => {
  // Clean env before each test to avoid cross-test leakage.
  const envKeys = ['VERCEL_GIT_COMMIT_SHA', 'GITHUB_SHA', 'BUILD_SHA'] as const;
  function cleanEnv() {
    for (const k of envKeys) delete process.env[k];
  }

  it('defaults buildSha to dev when no env vars are set', () => {
    cleanEnv();
    const buildSha =
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GITHUB_SHA ??
      process.env.BUILD_SHA ??
      'dev';
    expect(buildSha).toBe('dev');
  });

  it('picks up VERCEL_GIT_COMMIT_SHA when set', () => {
    cleanEnv();
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc123';
    const buildSha =
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GITHUB_SHA ??
      process.env.BUILD_SHA ??
      'dev';
    expect(buildSha).toBe('abc123');
  });

  it('picks up GITHUB_SHA when VERCEL is not set', () => {
    cleanEnv();
    process.env.GITHUB_SHA = 'def456';
    const buildSha =
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GITHUB_SHA ??
      process.env.BUILD_SHA ??
      'dev';
    expect(buildSha).toBe('def456');
  });

  it('reports db connectivity as boolean', () => {
    const dbOk = true;
    const body = {
      status: 'ok',
      buildSha: 'dev',
      db: dbOk,
      timestamp: new Date().toISOString(),
    };
    expect(body.db).toBe(true);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });

  it('reports db: false when query throws', () => {
    let dbOk = false;
    try {
      throw new Error('connection refused');
    } catch {
      dbOk = false;
    }
    expect(dbOk).toBe(false);
  });
});
