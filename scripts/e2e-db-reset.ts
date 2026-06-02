// Ensure the dedicated E2E Postgres database exists and is fully migrated.
//
// Strategy (portable across local + CI, no docker/psql client required):
//   1. Connect to the *dev* database (which already exists) and issue
//      CREATE DATABASE for the E2E DB — ignore "already exists".
//   2. Run `prisma migrate deploy` against the E2E DB (idempotent).
//
// We intentionally do NOT drop the DB: dropping fails while the dev server
// holds connections (local `reuseExistingServer`), and per-test truncation
// (tests/e2e/helpers/db.ts) keeps data clean anyway. `migrate deploy` is safe
// to re-run.

import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { deriveE2eDatabaseUrl } from '../lib/config';
import { E2E_DATABASE_URL } from '../tests/e2e/e2e-env';

const e2eDbName = new URL(E2E_DATABASE_URL).pathname.slice(1);
// Connect to the always-present `postgres` maintenance DB (same host/creds) to
// run a server-level CREATE DATABASE. Deriving from E2E_DATABASE_URL means this
// works whether DATABASE_URL points at the dev DB or already at the E2E DB.
const maintenanceUrl = deriveE2eDatabaseUrl(E2E_DATABASE_URL, 'postgres');

async function ensureDatabase(): Promise<void> {
  const admin = new PrismaClient({ datasources: { db: { url: maintenanceUrl } } });
  try {
    // Identifier can't be parameterized; e2eDbName is a fixed, code-controlled
    // constant (not user input), so interpolation here is safe.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${e2eDbName}"`);
    console.log(`[e2e-db] created database "${e2eDbName}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists')) {
      console.log(`[e2e-db] database "${e2eDbName}" already exists — reusing`);
    } else {
      throw err;
    }
  } finally {
    await admin.$disconnect();
  }
}

function migrate(): void {
  console.log(`[e2e-db] applying migrations to "${e2eDbName}"…`);
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
  });
}

async function main(): Promise<void> {
  await ensureDatabase();
  migrate();
  console.log('[e2e-db] ready.');
}

main().catch((err) => {
  console.error('[e2e-db] reset failed:', err);
  process.exit(1);
});
