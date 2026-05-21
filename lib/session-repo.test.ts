import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const upsert = vi.fn();
const answerCreate = vi.fn();
const sessionUpdate = vi.fn();
const playerUpdateMany = vi.fn();
const tx = vi.fn(async (ops: unknown[]) => ops);

vi.mock("./db", () => ({
  prisma: {
    gameSession: {
      create: (args: unknown) => create(args),
      update: (args: unknown) => sessionUpdate(args),
    },
    sessionPlayer: {
      upsert: (args: unknown) => upsert(args),
      updateMany: (args: unknown) => playerUpdateMany(args),
    },
    sessionAnswer: {
      create: (args: unknown) => answerCreate(args),
    },
    $transaction: (ops: unknown[]) => tx(ops),
  },
}));

import {
  createSessionRecord,
  finalizeSession,
  recordAnswer,
  recordPlayerJoin,
} from "./session-repo";

const ORIGINAL = process.env.ENABLE_SESSION_PERSISTENCE;

beforeEach(() => {
  create.mockReset();
  upsert.mockReset();
  answerCreate.mockReset();
  sessionUpdate.mockReset();
  playerUpdateMany.mockReset();
  tx.mockReset();
  tx.mockImplementation(async (ops: unknown[]) => ops);
  delete process.env.ENABLE_SESSION_PERSISTENCE;
});

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.ENABLE_SESSION_PERSISTENCE;
  } else {
    process.env.ENABLE_SESSION_PERSISTENCE = ORIGINAL;
  }
});

describe("session-repo (enabled)", () => {
  it("createSessionRecord stores pin, hostUserId, snapshot and returns id", async () => {
    create.mockResolvedValueOnce({ id: "sess_1" });
    const out = await createSessionRecord({
      pin: "123456",
      hostUserId: null,
      quizSnapshot: { title: "Q", questions: [] },
    });
    expect(out).toEqual({ id: "sess_1" });
    expect(create).toHaveBeenCalledWith({
      data: {
        pin: "123456",
        hostUserId: null,
        quizSnapshot: { title: "Q", questions: [] },
        status: "active",
      },
      select: { id: true },
    });
  });

  it("recordPlayerJoin upserts on (sessionId, inGameId)", async () => {
    upsert.mockResolvedValueOnce({});
    await recordPlayerJoin({
      sessionId: "sess_1",
      inGameId: "p_abc",
      nickname: "Alice",
    });
    expect(upsert).toHaveBeenCalledOnce();
    const call = upsert.mock.calls[0][0] as {
      where: { sessionId_inGameId: { sessionId: string; inGameId: string } };
      create: { sessionId: string; inGameId: string; nickname: string };
    };
    expect(call.where.sessionId_inGameId).toEqual({
      sessionId: "sess_1",
      inGameId: "p_abc",
    });
    expect(call.create.nickname).toBe("Alice");
  });

  it("recordAnswer writes a SessionAnswer row", async () => {
    answerCreate.mockResolvedValueOnce({});
    await recordAnswer({
      sessionId: "sess_1",
      questionIndex: 0,
      playerInGameId: "p_abc",
      optionIndex: 1,
      correct: true,
      msFromStart: 1234,
      awarded: 750,
    });
    expect(answerCreate).toHaveBeenCalledWith({
      data: {
        sessionId: "sess_1",
        questionIndex: 0,
        playerInGameId: "p_abc",
        optionIndex: 1,
        correct: true,
        msFromStart: 1234,
        awarded: 750,
      },
    });
  });

  it("finalizeSession updates status, leaderboard, and per-player scores", async () => {
    sessionUpdate.mockReturnValue({ kind: "session-update" });
    playerUpdateMany.mockReturnValue({ kind: "player-update" });
    await finalizeSession({
      sessionId: "sess_1",
      status: "finished",
      finalLeaderboard: [
        { playerId: "p_a", nickname: "Alice", score: 2000, rank: 1 },
        { playerId: "p_b", nickname: "Bob", score: 1000, rank: 2 },
      ],
      playerFinalScores: [
        { inGameId: "p_a", finalScore: 2000, finalRank: 1 },
        { inGameId: "p_b", finalScore: 1000, finalRank: 2 },
      ],
    });
    expect(sessionUpdate).toHaveBeenCalledOnce();
    const su = sessionUpdate.mock.calls[0][0] as {
      where: { id: string };
      data: { status: string; endedAt: Date; finalLeaderboard: unknown };
    };
    expect(su.where.id).toBe("sess_1");
    expect(su.data.status).toBe("finished");
    expect(su.data.endedAt).toBeInstanceOf(Date);
    expect(playerUpdateMany).toHaveBeenCalledTimes(2);
    expect(tx).toHaveBeenCalledOnce();
  });
});

describe("session-repo (disabled via ENABLE_SESSION_PERSISTENCE=false)", () => {
  beforeEach(() => {
    process.env.ENABLE_SESSION_PERSISTENCE = "false";
  });

  it("createSessionRecord is a no-op returning null", async () => {
    const out = await createSessionRecord({
      pin: "123456",
      hostUserId: null,
      quizSnapshot: {},
    });
    expect(out).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("recordPlayerJoin / recordAnswer / finalizeSession are no-ops", async () => {
    await recordPlayerJoin({ sessionId: "x", inGameId: "y", nickname: "z" });
    await recordAnswer({
      sessionId: "x",
      questionIndex: 0,
      playerInGameId: "y",
      optionIndex: 0,
      correct: false,
      msFromStart: 0,
      awarded: 0,
    });
    await finalizeSession({
      sessionId: "x",
      status: "finished",
      finalLeaderboard: [],
      playerFinalScores: [],
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(answerCreate).not.toHaveBeenCalled();
    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(tx).not.toHaveBeenCalled();
  });
});
