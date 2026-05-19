import type {
  AnswerIndex,
  AnswerRecord,
  GamePhase,
  Player,
  PublicGameState,
  Question,
  Quiz,
} from "./types";

const MAX_PLAYERS = 10;
const RECONNECT_GRACE_MS = 30_000;
const RESULT_BASE = 1000;
const PIN_RETRY_LIMIT = 50;

export interface GameSession {
  pin: string;
  hostSocketId?: string;
  displaySocketIds: Set<string>;
  quiz: Quiz;
  phase: GamePhase;
  questionIndex: number;
  players: Map<string, Player>;
  socketToPlayer: Map<string, string>;
  answers: Map<number, AnswerRecord[]>;
  questionStartedAt?: number;
  questionEndsAt?: number;
  questionTimer?: NodeJS.Timeout;
  createdAt: number;
}

const games = new Map<string, GameSession>();

export function listGames(): GameSession[] {
  return Array.from(games.values());
}

function generatePin(): string {
  for (let i = 0; i < PIN_RETRY_LIMIT; i++) {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    if (!games.has(pin)) return pin;
  }
  throw new Error("Could not allocate PIN");
}

export function createGame(quiz: Quiz): GameSession {
  if (!quiz.questions.length) {
    throw new Error("Quiz must have at least one question");
  }
  const pin = generatePin();
  const session: GameSession = {
    pin,
    displaySocketIds: new Set(),
    quiz,
    phase: "lobby",
    questionIndex: -1,
    players: new Map(),
    socketToPlayer: new Map(),
    answers: new Map(),
    createdAt: Date.now(),
  };
  games.set(pin, session);
  return session;
}

export function getGame(pin: string): GameSession | undefined {
  return games.get(pin);
}

export function attachHost(pin: string, socketId: string): GameSession | undefined {
  const game = games.get(pin);
  if (!game) return;
  game.hostSocketId = socketId;
  return game;
}

export function attachDisplay(pin: string, socketId: string): GameSession | undefined {
  const game = games.get(pin);
  if (!game) return;
  game.displaySocketIds.add(socketId);
  return game;
}

export function detachSocket(socketId: string): {
  pin: string;
  type: "host" | "display" | "player";
  playerId?: string;
}[] {
  const events: { pin: string; type: "host" | "display" | "player"; playerId?: string }[] = [];
  for (const game of games.values()) {
    if (game.hostSocketId === socketId) {
      game.hostSocketId = undefined;
      events.push({ pin: game.pin, type: "host" });
    }
    if (game.displaySocketIds.has(socketId)) {
      game.displaySocketIds.delete(socketId);
      events.push({ pin: game.pin, type: "display" });
    }
    const playerId = game.socketToPlayer.get(socketId);
    if (playerId) {
      const player = game.players.get(playerId);
      if (player) {
        player.connected = false;
        player.disconnectedAt = Date.now();
      }
      game.socketToPlayer.delete(socketId);
      events.push({ pin: game.pin, type: "player", playerId });
    }
  }
  return events;
}

export function isWithinReconnectGrace(player: Player): boolean {
  if (player.connected) return false;
  if (!player.disconnectedAt) return false;
  return Date.now() - player.disconnectedAt <= RECONNECT_GRACE_MS;
}

export function reapStalePlayers(game: GameSession): string[] {
  const dropped: string[] = [];
  const cutoff = Date.now() - RECONNECT_GRACE_MS;
  for (const [id, player] of game.players) {
    if (!player.connected && player.disconnectedAt && player.disconnectedAt < cutoff) {
      game.players.delete(id);
      dropped.push(id);
    }
  }
  return dropped;
}

export function joinPlayer(
  pin: string,
  socketId: string,
  nickname: string,
):
  | { ok: true; game: GameSession; player: Player; reconnected: boolean }
  | { ok: false; error: string; code?: string } {
  const game = games.get(pin);
  if (!game) return { ok: false, error: "Game not found" };
  const trimmed = nickname.trim().slice(0, 20);
  if (!trimmed) return { ok: false, error: "Nickname required" };

  const lower = trimmed.toLowerCase();
  const existing = Array.from(game.players.values()).find(
    (p) => p.nickname.toLowerCase() === lower,
  );

  if (existing) {
    if (existing.connected) {
      return { ok: false, error: "Nickname taken" };
    }
    if (!isWithinReconnectGrace(existing)) {
      game.players.delete(existing.id);
    } else {
      existing.connected = true;
      existing.disconnectedAt = undefined;
      for (const [sock, pid] of game.socketToPlayer) {
        if (pid === existing.id) game.socketToPlayer.delete(sock);
      }
      game.socketToPlayer.set(socketId, existing.id);
      return { ok: true, game, player: existing, reconnected: true };
    }
  }

  if (game.phase !== "lobby") return { ok: false, error: "Game already started" };
  const activeCount = Array.from(game.players.values()).filter(
    (p) => p.connected || isWithinReconnectGrace(p),
  ).length;
  if (activeCount >= MAX_PLAYERS) {
    return { ok: false, error: "Room is full", code: "full" };
  }
  const id = `p_${Math.random().toString(36).slice(2, 9)}`;
  const player: Player = { id, nickname: trimmed, score: 0, streak: 0, connected: true };
  game.players.set(id, player);
  game.socketToPlayer.set(socketId, id);
  return { ok: true, game, player, reconnected: false };
}

export function kickPlayer(pin: string, playerId: string) {
  const game = games.get(pin);
  if (!game) return;
  game.players.delete(playerId);
  for (const [sock, pid] of game.socketToPlayer) {
    if (pid === playerId) game.socketToPlayer.delete(sock);
  }
}

export function currentQuestion(game: GameSession): Question | undefined {
  if (game.questionIndex < 0) return undefined;
  return game.quiz.questions[game.questionIndex];
}

export function startGame(game: GameSession) {
  if (game.phase !== "lobby") return;
  if (!game.players.size) return;
  advanceToQuestion(game, 0);
}

function clearTimer(game: GameSession) {
  if (game.questionTimer) {
    clearTimeout(game.questionTimer);
    game.questionTimer = undefined;
  }
}

export function advanceToQuestion(game: GameSession, index: number) {
  clearTimer(game);
  if (index >= game.quiz.questions.length) {
    game.phase = "final";
    game.questionStartedAt = undefined;
    game.questionEndsAt = undefined;
    return;
  }
  game.questionIndex = index;
  game.phase = "question";
  game.answers.set(index, []);
  const q = game.quiz.questions[index];
  const now = Date.now();
  game.questionStartedAt = now;
  game.questionEndsAt = now + q.timeLimit * 1000;
}

export function lockQuestion(game: GameSession) {
  if (game.phase !== "question") return;
  clearTimer(game);
  game.phase = "reveal";
}

export function advance(game: GameSession): GamePhase {
  switch (game.phase) {
    case "lobby":
      if (game.players.size > 0) startGame(game);
      return game.phase;
    case "question":
      lockQuestion(game);
      return game.phase;
    case "reveal":
      if (game.questionIndex + 1 < game.quiz.questions.length) {
        game.phase = "leaderboard";
      } else {
        game.phase = "final";
      }
      return game.phase;
    case "leaderboard":
      advanceToQuestion(game, game.questionIndex + 1);
      return game.phase;
    case "final":
      return game.phase;
    default:
      return game.phase;
  }
}

export function submitAnswer(
  game: GameSession,
  playerId: string,
  optionIndex: AnswerIndex,
): { ok: boolean; error?: string; awarded?: number; correct?: boolean } {
  if (game.phase !== "question") return { ok: false, error: "Not accepting answers" };
  const q = currentQuestion(game);
  if (!q) return { ok: false, error: "No active question" };
  if (optionIndex < 0 || optionIndex >= q.options.length) {
    return { ok: false, error: "Invalid option" };
  }
  const records = game.answers.get(game.questionIndex) ?? [];
  if (records.find((r) => r.playerId === playerId)) {
    return { ok: false, error: "Already answered" };
  }
  const player = game.players.get(playerId);
  if (!player) return { ok: false, error: "Player not in game" };

  const now = Date.now();
  const startedAt = game.questionStartedAt ?? now;
  const msFromStart = now - startedAt;
  const totalMs = q.timeLimit * 1000;
  const fraction = Math.max(0, Math.min(1, 1 - msFromStart / totalMs));
  const correct = optionIndex === q.correct;
  let awarded = 0;
  if (correct) {
    const speed = q.doublePoints ? 2 : 1;
    awarded = Math.round(RESULT_BASE * (0.5 + 0.5 * fraction) * speed);
    player.streak += 1;
    player.score += awarded;
  } else {
    player.streak = 0;
  }
  records.push({ playerId, optionIndex, msFromStart, awarded, correct });
  game.answers.set(game.questionIndex, records);

  const allAnswered = records.length >= Array.from(game.players.values()).filter((p) => p.connected).length;
  if (allAnswered) {
    lockQuestion(game);
  }

  return { ok: true, awarded, correct };
}

export function distribution(game: GameSession): number[] {
  const q = currentQuestion(game);
  if (!q) return [];
  const records = game.answers.get(game.questionIndex) ?? [];
  const out = new Array(q.options.length).fill(0);
  for (const r of records) out[r.optionIndex] = (out[r.optionIndex] ?? 0) + 1;
  return out;
}

export function leaderboard(game: GameSession) {
  return Array.from(game.players.values())
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ id: p.id, nickname: p.nickname, score: p.score, rank: i + 1 }));
}

export function publicState(game: GameSession): PublicGameState {
  const q = currentQuestion(game);
  const board = leaderboard(game);
  const reveal =
    game.phase === "reveal" || game.phase === "leaderboard"
      ? q
        ? {
            correct: q.correct as AnswerIndex,
            distribution: distribution(game),
            totalAnswers: (game.answers.get(game.questionIndex) ?? []).length,
          }
        : undefined
      : undefined;
  return {
    pin: game.pin,
    phase: game.phase,
    questionIndex: game.questionIndex,
    totalQuestions: game.quiz.questions.length,
    question:
      q && (game.phase === "question" || game.phase === "reveal")
        ? {
            text: q.text,
            type: q.type,
            options: q.options,
            timeLimit: q.timeLimit,
            doublePoints: q.doublePoints,
          }
        : undefined,
    startedAt: game.questionStartedAt,
    endsAt: game.questionEndsAt,
    reveal,
    players: Array.from(game.players.values()).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      connected: p.connected,
    })),
    podium: board.slice(0, 3),
  };
}

export function personalState(game: GameSession, playerId: string) {
  const player = game.players.get(playerId);
  if (!player) return null;
  const records = game.answers.get(game.questionIndex) ?? [];
  const mine = records.find((r) => r.playerId === playerId);
  const board = leaderboard(game);
  const rank = board.findIndex((p) => p.id === playerId) + 1;
  return {
    hasAnswered: !!mine,
    lastAnswer: mine?.optionIndex,
    lastAwarded: mine?.awarded,
    lastCorrect: mine?.correct,
    rank: rank || undefined,
    total: board.length,
    score: player.score,
  };
}

export const config = { MAX_PLAYERS };
