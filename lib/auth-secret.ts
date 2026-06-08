import { randomBytes } from 'node:crypto';

export function ensureAuthSecret(): string {
  const existing = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (existing) return existing;

  if (process.env.NODE_ENV === 'production') return '';

  const devSecret = randomBytes(32).toString('hex');
  process.env.AUTH_SECRET = devSecret;
  console.warn(
    '[auth] AUTH_SECRET not set - generated a dev secret for this session. Set AUTH_SECRET in .env for persistent sessions.',
  );
  return devSecret;
}
