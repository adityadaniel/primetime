import type {
  WordCloudModeration,
  WordCloudPlayer,
  WordCloudSession,
  WordCloudStatus,
  WordCloudSubmission,
} from '@prisma/client';
import { prisma } from './db';

export type WordCloudSessionWithRelations = WordCloudSession & {
  players: WordCloudPlayer[];
  submissions: WordCloudSubmission[];
};

export type AggregatedWord = {
  display: string;
  normalized: string;
  count: number;
};

export class DuplicateNicknameError extends Error {
  constructor(nickname: string) {
    super(`Nickname "${nickname}" already taken in this session`);
    this.name = 'DuplicateNicknameError';
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  );
}

export async function createSession(args: {
  pin: string;
  prompt: string;
  wordsPerPlayer: number;
  profanityFilter: boolean;
  hostUserId: string | null;
}): Promise<WordCloudSession> {
  if (!args.pin.trim()) throw new Error('PIN required');
  if (!args.prompt.trim()) throw new Error('Prompt required');
  if (args.wordsPerPlayer < 1 || args.wordsPerPlayer > 5) {
    throw new Error('wordsPerPlayer must be between 1 and 5');
  }
  return prisma.wordCloudSession.create({
    data: {
      pin: args.pin,
      prompt: args.prompt.trim(),
      wordsPerPlayer: args.wordsPerPlayer,
      profanityFilter: args.profanityFilter,
      hostUserId: args.hostUserId,
    },
  });
}

export async function getSessionByPin(pin: string): Promise<WordCloudSessionWithRelations | null> {
  return prisma.wordCloudSession.findUnique({
    where: { pin },
    include: {
      players: { orderBy: { joinedAt: 'asc' } },
      submissions: { orderBy: { createdAt: 'asc' } },
    },
  });
}

export async function addPlayer(args: {
  sessionId: string;
  nickname: string;
}): Promise<WordCloudPlayer> {
  const nickname = args.nickname.trim();
  if (!nickname) throw new Error('Nickname required');
  try {
    return await prisma.wordCloudPlayer.create({
      data: { sessionId: args.sessionId, nickname },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateNicknameError(nickname);
    throw err;
  }
}

export async function addSubmission(args: {
  sessionId: string;
  playerId: string;
  rawText: string;
  normalized: string;
}): Promise<WordCloudSubmission> {
  if (!args.rawText.trim()) throw new Error('rawText required');
  if (!args.normalized.trim()) throw new Error('normalized required');
  return prisma.wordCloudSubmission.create({
    data: {
      sessionId: args.sessionId,
      playerId: args.playerId,
      rawText: args.rawText,
      normalized: args.normalized,
    },
  });
}

export async function markSubmissionRemoved(args: {
  sessionId: string;
  normalized: string;
  hostUserId?: string | null;
}): Promise<number> {
  const result = await prisma.wordCloudSubmission.updateMany({
    where: {
      sessionId: args.sessionId,
      normalized: args.normalized,
      removed: false,
    },
    data: {
      removed: true,
      removedAt: new Date(),
    },
  });
  return result.count;
}

export async function setStatus(args: {
  sessionId: string;
  status: WordCloudStatus;
}): Promise<WordCloudSession> {
  const data: {
    status: WordCloudStatus;
    startedAt?: Date;
    endedAt?: Date;
  } = { status: args.status };
  if (args.status === 'LIVE') {
    const existing = await prisma.wordCloudSession.findUnique({
      where: { id: args.sessionId },
      select: { startedAt: true },
    });
    if (existing && existing.startedAt === null) data.startedAt = new Date();
  }
  if (args.status === 'ENDED') data.endedAt = new Date();
  return prisma.wordCloudSession.update({
    where: { id: args.sessionId },
    data,
  });
}

export async function logModeration(args: {
  sessionId: string;
  hostUserId: string | null;
  word: string;
  reason: string;
}): Promise<WordCloudModeration> {
  return prisma.wordCloudModeration.create({
    data: {
      sessionId: args.sessionId,
      hostUserId: args.hostUserId,
      word: args.word,
      reason: args.reason,
    },
  });
}

export async function getAggregatedWords(sessionId: string): Promise<AggregatedWord[]> {
  const rows = await prisma.wordCloudSubmission.findMany({
    where: { sessionId, removed: false },
    select: { rawText: true, normalized: true },
  });

  const groups = new Map<string, { count: number; rawCounts: Map<string, number> }>();

  for (const row of rows) {
    let group = groups.get(row.normalized);
    if (!group) {
      group = { count: 0, rawCounts: new Map() };
      groups.set(row.normalized, group);
    }
    group.count += 1;
    group.rawCounts.set(row.rawText, (group.rawCounts.get(row.rawText) ?? 0) + 1);
  }

  const aggregated: AggregatedWord[] = [];
  for (const [normalized, group] of groups) {
    let display = '';
    let topCount = -1;
    for (const [raw, c] of group.rawCounts) {
      if (c > topCount) {
        topCount = c;
        display = raw;
      }
    }
    aggregated.push({ display, normalized, count: group.count });
  }

  aggregated.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.normalized.localeCompare(b.normalized);
  });
  return aggregated;
}

export async function listSessionsForUser(
  userId: string,
  opts: { status?: WordCloudStatus; limit?: number; offset?: number } = {},
): Promise<WordCloudSession[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  return prisma.wordCloudSession.findMany({
    where: {
      hostUserId: userId,
      ...(opts.status ? { status: opts.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}
