// Single source of truth for the E2E stack's environment.
//
// Three consumers import this module:
//   • scripts/e2e-db-reset.ts   — to know which DB to create + migrate
//   • playwright.config.ts      — to set `webServer.env` for `npm run dev`
//   • tests/e2e/helpers/db.ts   — to point its Prisma client at the E2E DB
//
// We deliberately DON'T use NODE_ENV=test: the app boots via `next dev`
// (tsx server.ts), which expects development mode. The reset route returns the
// reset `devUrl` whenever NODE_ENV !== 'production', so dev mode is all we need
// to capture reset tokens — no mailer harness or log scraping.

import { loadEnvConfig } from '@next/env';
import { deriveE2eDatabaseUrl } from '../../lib/config';
import { PLAYER_CAP } from '../../lib/constants';

// Populate process.env from .env / .env.local exactly like Next does, so the
// base DATABASE_URL resolves the same way the dev server would. In CI, where
// DATABASE_URL is set in the shell, that value wins (shell env > .env files).
loadEnvConfig(process.cwd());

const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) {
  throw new Error(
    '[e2e] DATABASE_URL is not set. Start Postgres (npm run db:up) and ensure ' +
      'DATABASE_URL is in .env / .env.local (local) or the shell (CI).',
  );
}

/** Dedicated Postgres database for the E2E suite, on the same server as dev. */
export const E2E_DATABASE_URL = deriveE2eDatabaseUrl(baseDatabaseUrl);

export const E2E_PORT = Number(process.env.E2E_PORT ?? 4321);
export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`;

/**
 * Env overrides handed to `npm run dev` when Playwright boots the server.
 * Pins the OSS config surface to a known test profile:
 *   • token-print email so /api/auth/reset returns a capturable devUrl
 *   • local uploads (no cloud provider)
 *   • code-level PLAYER_CAP from lib/constants.ts
 *   • session persistence on so GameSession rows are written
 * Shell env wins over .env files under @next/env, so these reliably override a
 * developer's local .env.local.
 */
export const webServerEnv: Record<string, string> = {
  DATABASE_URL: E2E_DATABASE_URL,
  PORT: String(E2E_PORT),
  NEXTAUTH_URL: E2E_BASE_URL,
  NEXT_PUBLIC_SITE_URL: E2E_BASE_URL,
  AUTH_SECRET: 'e2e-test-secret-not-for-prod',
  AUTH_TRUST_HOST: 'true',
  AUTH_MODE: 'password',
  EMAIL_PROVIDER: 'token-print',
  UPLOAD_PROVIDER: 'local',
  REQUIRE_INVITE_CODE: 'false',
  ENABLE_SESSION_PERSISTENCE: 'true',
  ENABLE_APPLE_SIGNIN: 'false',
  BILLING_ENABLED: 'false',
};

/** PLAYER_CAP the server boots with — the cap-rejection test reads this. */
export const E2E_PLAYER_CAP = PLAYER_CAP;
