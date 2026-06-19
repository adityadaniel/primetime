// Prisma client + reset/seed helpers for the E2E suite, pinned to the dedicated
// E2E database. Tests truncate between cases (beforeEach) so order never
// matters and the first-run banner test always sees an empty User table.

import { PrismaClient } from '@prisma/client';
import { E2E_DATABASE_URL } from '../e2e-env';

export const db = new PrismaClient({
  datasources: { db: { url: E2E_DATABASE_URL } },
});

// Truncate in one statement; RESTART IDENTITY + CASCADE clears dependents and
// resets sequences. Table names are Prisma's PascalCase defaults (no @@map),
// so they must be double-quoted.
const TABLES = [
  'WonderWallPost',
  'WonderWallSession',
  'SessionAnswer',
  'SessionPlayer',
  'GameSession',
  'WordCloudModeration',
  'WordCloudSubmission',
  'WordCloudPlayer',
  'WordCloudSession',
  'Question',
  'Quiz',
  'PasswordResetToken',
  'Session',
  'Account',
  'VerificationToken',
  'User',
] as const;

export async function resetDatabase(): Promise<void> {
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}

export interface SeededWordCloud {
  pin: string;
  sessionId: string;
  /** Number of submission rows seeded (CSV data-row count). */
  submissionCount: number;
}

/**
 * Seed an ENDED, anonymous (hostUserId=null → publicly exportable) word-cloud
 * session with `words.length` submissions from a single player. Used to assert
 * the CSV export route returns header + one row per submission.
 */
export async function seedWordCloud(pin: string, words: string[]): Promise<SeededWordCloud> {
  const session = await db.wordCloudSession.create({
    data: {
      pin,
      prompt: 'Favorite snack?',
      wordsPerPlayer: words.length,
      profanityFilter: true,
      hostUserId: null,
      status: 'ENDED',
      endedAt: new Date(),
      players: { create: { nickname: 'Alice' } },
    },
    include: { players: true },
  });
  const playerId = session.players[0].id;
  await db.wordCloudSubmission.createMany({
    data: words.map((w) => ({
      sessionId: session.id,
      playerId,
      rawText: w,
      normalized: w.toLowerCase(),
    })),
  });
  return { pin, sessionId: session.id, submissionCount: words.length };
}
