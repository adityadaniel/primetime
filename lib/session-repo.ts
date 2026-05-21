import { prisma } from "./db";

function isEnabled(): boolean {
  const v = process.env.ENABLE_SESSION_PERSISTENCE;
  if (v === undefined) return true;
  return v !== "false" && v !== "0";
}

export async function createSessionRecord(args: {
  pin: string;
  hostUserId: string | null;
  quizSnapshot: unknown;
}): Promise<{ id: string } | null> {
  if (!isEnabled()) return null;
  const row = await prisma.gameSession.create({
    data: {
      pin: args.pin,
      hostUserId: args.hostUserId,
      quizSnapshot: args.quizSnapshot as object,
      status: "active",
    },
    select: { id: true },
  });
  return row;
}

export async function recordPlayerJoin(args: {
  sessionId: string;
  inGameId: string;
  nickname: string;
}): Promise<void> {
  if (!isEnabled()) return;
  await prisma.sessionPlayer.upsert({
    where: {
      sessionId_inGameId: {
        sessionId: args.sessionId,
        inGameId: args.inGameId,
      },
    },
    create: {
      sessionId: args.sessionId,
      inGameId: args.inGameId,
      nickname: args.nickname,
    },
    update: { nickname: args.nickname },
  });
}

export async function recordAnswer(args: {
  sessionId: string;
  questionIndex: number;
  playerInGameId: string;
  optionIndex: number;
  correct: boolean;
  msFromStart: number;
  awarded: number;
}): Promise<void> {
  if (!isEnabled()) return;
  await prisma.sessionAnswer.create({
    data: {
      sessionId: args.sessionId,
      questionIndex: args.questionIndex,
      playerInGameId: args.playerInGameId,
      optionIndex: args.optionIndex,
      correct: args.correct,
      msFromStart: args.msFromStart,
      awarded: args.awarded,
    },
  });
}

export async function finalizeSession(args: {
  sessionId: string;
  status: "finished" | "abandoned";
  finalLeaderboard: Array<{
    playerId: string;
    nickname: string;
    score: number;
    rank: number;
  }>;
  playerFinalScores: Array<{
    inGameId: string;
    finalScore: number;
    finalRank: number;
  }>;
}): Promise<void> {
  if (!isEnabled()) return;
  await prisma.$transaction([
    prisma.gameSession.update({
      where: { id: args.sessionId },
      data: {
        status: args.status,
        endedAt: new Date(),
        finalLeaderboard: args.finalLeaderboard as unknown as object,
      },
    }),
    ...args.playerFinalScores.map((p) =>
      prisma.sessionPlayer.updateMany({
        where: { sessionId: args.sessionId, inGameId: p.inGameId },
        data: { finalScore: p.finalScore, finalRank: p.finalRank },
      }),
    ),
  ]);
}
