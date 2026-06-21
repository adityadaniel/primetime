import { join } from 'node:path';
import { PLAYER_CAP } from './constants';

// ============================================================================
// OSS ⇄ SaaS configuration surface (MID-214 · OSS-CONFIG-01)
//
// The same codebase ships two ways:
//   • OSS self-host — no billing, no Resend/SMTP, no third-party OAuth. Boots
//     with ZERO extra env vars. This is the default for every flag below.
//   • SaaS — billing on, a real email provider, OAuth, cloud uploads.
//
// Rules of the road:
//   • Defaults are the OSS path. A fresh clone with an empty `.env` is valid
//     and never requires a SaaS provider account.
//   • We fail fast (throw at load) ONLY for (a) an invalid explicit enum value
//     or (b) a provider that was explicitly selected but is missing its
//     required vars. We never demand SaaS keys on the default OSS path.
// ============================================================================

/** AUTH_MODE — `password` (OSS default, credentials only) or
 * `password+oauth` (adds third-party providers like Apple on top). */
export type AuthMode = 'password' | 'password+oauth';

/** EMAIL_PROVIDER — `none` (OSS default, reset UI hidden),
 * `token-print` (log reset URL to server logs; warns in production),
 * `smtp`, or `resend`. */
export type EmailProvider = 'none' | 'token-print' | 'smtp' | 'resend';

/** UPLOAD_PROVIDER — `local` (OSS default, on-disk),
 * `s3` (S3-compatible incl. R2), or `uploadthing`. */
export type UploadProvider = 'local' | 's3' | 'uploadthing';

export interface AppConfig {
  /** `password` (default) or `password+oauth`. */
  authMode: AuthMode;
  /** `none` (default), `smtp`, or `resend`. */
  emailProvider: EmailProvider;
  /** `local` (default), `s3`, or `uploadthing`. */
  uploadProvider: UploadProvider;
  /** BILLING_ENABLED — `false` by default (OSS ships with no billing). */
  billingEnabled: boolean;
  /** WONDERWALL_ANALYSIS_ENABLED — `false` by default. When true, WonderWall
   * fetches submitted LinkedIn post content via Apify for host-only word-cloud
   * insights (requires APIFY_TOKEN). OFF for OSS/self-host; opt-in only, and the
   * operator accepts the LinkedIn-ToS risk. See DECISIONS.md 2026-06-21. */
  wonderwallAnalysisEnabled: boolean;
  /** Max players per game. Code-level constant in lib/constants.ts. */
  playerCap: number;
  /** UPLOAD_MAX_BYTES — max upload file size in bytes. Default 5 MB. */
  uploadMaxBytes: number;
  /** UPLOAD_DIR — absolute path to upload directory. Default: <cwd>/public/uploads. */
  uploadDir: string;

  // ---- derived helper booleans (cheap to read at call sites) ----
  /** True when AUTH_MODE=password+oauth, i.e. OAuth providers may attach. */
  oauthEnabled: boolean;
  /** True only when OAuth is enabled AND ENABLE_APPLE_SIGNIN=true AND the
   * Apple credential vars are present. Drives the Apple provider in auth.ts. */
  appleEnabled: boolean;
  /** True when EMAIL_PROVIDER is anything other than `none`. */
  emailEnabled: boolean;
}

const AUTH_MODES = ['password', 'password+oauth'] as const;
const EMAIL_PROVIDERS = ['none', 'token-print', 'smtp', 'resend'] as const;
const UPLOAD_PROVIDERS = ['local', 's3', 'uploadthing'] as const;

/** Coerce common truthy/falsy spellings; treat unset as the given default. */
function parseBool(raw: string | undefined, def: boolean): boolean {
  if (raw === undefined || raw === '') return def;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  throw new ConfigError(`expected a boolean (true/false), got "${raw}"`);
}

/** Thrown for any invalid configuration. Message is operator-facing. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(`[config] ${message}`);
    this.name = 'ConfigError';
  }
}

function enumOr<T extends readonly string[]>(
  name: string,
  raw: string | undefined,
  allowed: T,
  def: T[number],
): T[number] {
  if (raw === undefined || raw === '') return def;
  const v = raw.trim();
  if (!(allowed as readonly string[]).includes(v)) {
    throw new ConfigError(`${name} must be one of ${allowed.join(' | ')}, got "${raw}"`);
  }
  return v as T[number];
}

/** Require every var in `vars` to be present & non-empty, else fail fast. */
function requireVars(
  provider: string,
  env: Record<string, string | undefined>,
  vars: string[],
): void {
  const missing = vars.filter((k) => !env[k] || env[k]?.trim() === '');
  if (missing.length > 0) {
    throw new ConfigError(
      `${provider} selected but missing required env: ${missing.join(', ')}. ` +
        `Set them, or switch back to the OSS default.`,
    );
  }
}

/**
 * Parse a configuration from an env bag (defaults to `process.env`). Throws
 * `ConfigError` on an invalid explicit value or a selected-provider gap.
 * Pure: pass a custom `env` in tests to exercise every branch.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const authMode = enumOr('AUTH_MODE', env.AUTH_MODE, AUTH_MODES, 'password');
  const emailProvider = enumOr('EMAIL_PROVIDER', env.EMAIL_PROVIDER, EMAIL_PROVIDERS, 'none');
  const uploadProvider = enumOr('UPLOAD_PROVIDER', env.UPLOAD_PROVIDER, UPLOAD_PROVIDERS, 'local');
  const billingEnabled = parseBool(env.BILLING_ENABLED, false);

  // WonderWall content analysis (Apify scraping) is OFF by default. When an
  // operator opts in, APIFY_TOKEN is required so a misconfigured deploy fails
  // loudly rather than silently never fetching.
  const wonderwallAnalysisEnabled = parseBool(env.WONDERWALL_ANALYSIS_ENABLED, false);
  if (wonderwallAnalysisEnabled) {
    requireVars('WONDERWALL_ANALYSIS_ENABLED=true', env, ['APIFY_TOKEN']);
  }

  const playerCap = PLAYER_CAP;

  // Upload settings
  const uploadMaxBytesRaw = env.UPLOAD_MAX_BYTES ?? '';
  const uploadMaxBytes = uploadMaxBytesRaw === '' ? 5 * 1024 * 1024 : Number(uploadMaxBytesRaw);
  if (!Number.isFinite(uploadMaxBytes) || uploadMaxBytes < 1) {
    throw new ConfigError(
      `UPLOAD_MAX_BYTES must be a positive integer (got "${env.UPLOAD_MAX_BYTES}")`,
    );
  }
  const uploadDir = env.UPLOAD_DIR ?? join(process.cwd(), 'public', 'uploads');

  // ---- provider-specific var validation (only when explicitly selected) ----
  if (emailProvider === 'smtp') {
    requireVars('EMAIL_PROVIDER=smtp', env, [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASSWORD',
    ]);
  } else if (emailProvider === 'resend') {
    requireVars('EMAIL_PROVIDER=resend', env, ['RESEND_API_KEY']);
  }

  if (uploadProvider === 's3') {
    requireVars('UPLOAD_PROVIDER=s3', env, [
      'S3_BUCKET',
      'S3_REGION',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ]);
  } else if (uploadProvider === 'uploadthing') {
    requireVars('UPLOAD_PROVIDER=uploadthing', env, ['UPLOADTHING_TOKEN']);
  }

  const oauthEnabled = authMode === 'password+oauth';

  // Apple stays opt-in even within OAuth mode: it needs a real Apple Services
  // ID + key, so it's gated behind ENABLE_APPLE_SIGNIN. When both are on we
  // require the Apple credential vars so a misconfigured deploy fails loudly
  // instead of silently dropping the provider.
  const appleRequested = oauthEnabled && parseBool(env.ENABLE_APPLE_SIGNIN, false);
  if (appleRequested) {
    requireVars('ENABLE_APPLE_SIGNIN=true', env, [
      'APPLE_ID',
      'APPLE_TEAM_ID',
      'APPLE_KEY_ID',
      'APPLE_PRIVATE_KEY',
    ]);
  }

  return {
    authMode,
    emailProvider,
    uploadProvider,
    billingEnabled,
    wonderwallAnalysisEnabled,
    playerCap,
    uploadMaxBytes,
    uploadDir,
    oauthEnabled,
    appleEnabled: appleRequested,
    emailEnabled: emailProvider !== 'none',
  };
}

/**
 * Derive the E2E test database URL from a base connection string by swapping
 * the database name (the URL pathname) to `dbName`. Keeps host, credentials,
 * port, and any query params (e.g. `?schema=public`, `?sslmode=require`) intact
 * so the test DB lives on the same Postgres server as the dev DB. Portable
 * across whatever dev DB name is in scope (`primetime_dev` locally and in CI) —
 * both resolve from whatever `DATABASE_URL` is set. Pure; no I/O.
 */
export function deriveE2eDatabaseUrl(base: string, dbName = 'primetime_e2e'): string {
  const u = new URL(base);
  u.pathname = `/${dbName}`;
  return u.toString();
}

/**
 * Process-wide config, parsed once from `process.env` at import. Because every
 * flag defaults to the OSS path, this never throws on a fresh clone — it only
 * throws when an operator has set an invalid value or selected a provider
 * without its required vars (the intended fail-fast).
 */
export const config: AppConfig = loadConfig();
