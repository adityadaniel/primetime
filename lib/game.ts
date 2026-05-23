import { isClean } from './profanity';
import {
  createSessionRecord,
  finalizeSession,
  recordAnswer,
  recordPlayerJoin,
} from './session-repo';
import type {
  AnswerIndex,
  AnswerRecord,
  GamePhase,
  JoinErrorCode,
  Player,
  PublicGameState,
  Question,
  Quiz,
} from './types';

const HARD_CAP = 150;
// TEMP M2.5 unused: MID-75 restores tier-aware cap
const SOFT_CAP_FREE = 10;
// TEMP M2.5 unused: MID-75 restores tier-aware cap
const UPSELL_AT = 8;
let RECONNECT_GRACE_MS = 30_000;
const HOST_GRACE_MS = 60_000;

// dev-only hatch: smoke tests shrink the grace window so they don't sit
// idle for 30s. Not wired into any production code path.
export function setReconnectGraceForTesting(ms: number) {
  RECONNECT_GRACE_MS = ms;
}
const RESULT_BASE = 1000;
const PIN_RETRY_LIMIT = 50;

export type Tier = 'free' | 'pro';

export interface GameSession {
  pin: string;
  tier: Tier;
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
  pausedAt?: number;
  pauseReason?: 'host-disconnected';
  pauseResumeBy?: number;
  pauseRemainingMs?: number;
  endedReason?: 'host-left';
  createdAt: number;
  sessionDbId: string | null;
  finalized?: boolean;
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
  throw new Error('Could not allocate PIN');
}

export function createGame(
  quiz: Quiz,
  tierOrOpts: Tier | { tier?: Tier; hostUserId?: string | null } = 'free',
  legacyOpts?: { hostUserId?: string | null },
): GameSession {
  if (!quiz.questions.length) {
    throw new Error('Quiz must have at least one question');
  }
  const tier: Tier = typeof tierOrOpts === 'string' ? tierOrOpts : (tierOrOpts.tier ?? 'free');
  const hostUserId =
    typeof tierOrOpts === 'string'
      ? (legacyOpts?.hostUserId ?? null)
      : (tierOrOpts.hostUserId ?? null);
  const pin = generatePin();
  const session: GameSession = {
    pin,
    tier,
    displaySocketIds: new Set(),
    quiz,
    phase: 'lobby',
    questionIndex: -1,
    players: new Map(),
    socketToPlayer: new Map(),
    answers: new Map(),
    createdAt: Date.now(),
    sessionDbId: null,
  };
  games.set(pin, session);
  createSessionRecord({ pin, hostUserId, quizSnapshot: quiz })
    .then((row) => {
      if (row) session.sessionDbId = row.id;
    })
    .catch((err) => console.error('[session-repo]', err));
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

export function pauseForHostDisconnect(game: GameSession): boolean {
  if (game.pausedAt) return false;
  if (game.phase === 'final') return false;
  game.pausedAt = Date.now();
  game.pauseReason = 'host-disconnected';
  game.pauseResumeBy = game.pausedAt + HOST_GRACE_MS;
  if (game.phase === 'question' && game.questionEndsAt) {
    game.pauseRemainingMs = Math.max(0, game.questionEndsAt - game.pausedAt);
  } else {
    game.pauseRemainingMs = undefined;
  }
  return true;
}

export function resumeFromPause(game: GameSession): boolean {
  if (!game.pausedAt) return false;
  const now = Date.now();
  if (game.phase === 'question' && game.pauseRemainingMs !== undefined && game.questionStartedAt) {
    const elapsed = game.pausedAt - game.questionStartedAt;
    game.questionStartedAt = now - elapsed;
    game.questionEndsAt = now + game.pauseRemainingMs;
  }
  game.pausedAt = undefined;
  game.pauseReason = undefined;
  game.pauseResumeBy = undefined;
  game.pauseRemainingMs = undefined;
  return true;
}

export function endByHostLeft(game: GameSession) {
  if (game.questionTimer) {
    clearTimeout(game.questionTimer);
    game.questionTimer = undefined;
  }
  game.phase = 'final';
  game.endedReason = 'host-left';
  game.pausedAt = undefined;
  game.pauseReason = undefined;
  game.pauseResumeBy = undefined;
  game.pauseRemainingMs = undefined;
  game.questionStartedAt = undefined;
  game.questionEndsAt = undefined;
  finalizePersist(game, 'abandoned');
}

function finalizePersist(game: GameSession, status: 'finished' | 'abandoned'): void {
  if (!game.sessionDbId) return;
  if (game.finalized) return;
  game.finalized = true;
  const board = leaderboard(game);
  finalizeSession({
    sessionId: game.sessionDbId,
    status,
    finalLeaderboard: board.map((p) => ({
      playerId: p.id,
      nickname: p.nickname,
      score: p.score,
      rank: p.rank,
    })),
    playerFinalScores: board.map((p) => ({
      inGameId: p.id,
      finalScore: p.score,
      finalRank: p.rank,
    })),
  }).catch((err) => console.error('[session-repo]', err));
}

export function isPaused(game: GameSession): boolean {
  return !!game.pausedAt;
}

export function detachSocket(socketId: string): {
  pin: string;
  type: 'host' | 'display' | 'player';
  playerId?: string;
}[] {
  const events: { pin: string; type: 'host' | 'display' | 'player'; playerId?: string }[] = [];
  for (const game of games.values()) {
    if (game.hostSocketId === socketId) {
      game.hostSocketId = undefined;
      events.push({ pin: game.pin, type: 'host' });
    }
    if (game.displaySocketIds.has(socketId)) {
      game.displaySocketIds.delete(socketId);
      events.push({ pin: game.pin, type: 'display' });
    }
    const playerId = game.socketToPlayer.get(socketId);
    if (playerId) {
      const player = game.players.get(playerId);
      if (player) {
        player.connected = false;
        player.disconnectedAt = Date.now();
      }
      game.socketToPlayer.delete(socketId);
      events.push({ pin: game.pin, type: 'player', playerId });
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

export interface CapStatus {
  hard: number;
  soft: number;
  current: number;
  upsell: boolean;
  full: boolean;
}

export function capStatus(game: GameSession): CapStatus {
  // TEMP M2.5: hardcoded 150 until MID-75 ships tier-aware cap
  const current = Array.from(game.players.values()).filter(
    (p) => p.connected || isWithinReconnectGrace(p),
  ).length;
  return {
    hard: HARD_CAP,
    soft: HARD_CAP,
    current,
    upsell: false,
    full: current >= HARD_CAP,
  };
}

export function joinPlayer(
  pin: string,
  socketId: string,
  nickname: string,
):
  | { ok: true; game: GameSession; player: Player; reconnected: boolean }
  | { ok: false; error: string; code?: JoinErrorCode } {
  const game = games.get(pin);
  if (!game) return { ok: false, error: 'Game not found' };
  const trimmed = nickname.trim().slice(0, 20);
  if (!trimmed) return { ok: false, error: 'Nickname required' };
  if (!isClean(trimmed)) {
    return { ok: false, error: 'Pick another nickname', code: 'nickname-rejected' };
  }

  const lower = trimmed.toLowerCase();

  const existingPlayerId = game.socketToPlayer.get(socketId);
  if (existingPlayerId) {
    const owned = game.players.get(existingPlayerId);
    if (owned && owned.nickname.toLowerCase() === lower) {
      console.warn(
        `[joinPlayer] duplicate emit from same socket (pin=${pin}, nickname=${trimmed})`,
      );
      return { ok: true, game, player: owned, reconnected: false };
    }
  }

  const existing = Array.from(game.players.values()).find(
    (p) => p.nickname.toLowerCase() === lower,
  );

  if (existing) {
    if (existing.connected) {
      return { ok: false, error: 'Nickname taken' };
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

  if (game.phase !== 'lobby') return { ok: false, error: 'Game already started' };
  const status = capStatus(game);
  if (status.full) {
    return { ok: false, error: 'Room is full', code: 'full' satisfies JoinErrorCode };
  }
  const id = `p_${Math.random().toString(36).slice(2, 9)}`;
  const player: Player = { id, nickname: trimmed, score: 0, streak: 0, connected: true };
  game.players.set(id, player);
  game.socketToPlayer.set(socketId, id);
  if (game.sessionDbId) {
    recordPlayerJoin({
      sessionId: game.sessionDbId,
      inGameId: id,
      nickname: trimmed,
    }).catch((err) => console.error('[session-repo]', err));
  }
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
  if (game.phase !== 'lobby') return;
  if (isPaused(game)) return;
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
    game.phase = 'final';
    game.questionStartedAt = undefined;
    game.questionEndsAt = undefined;
    finalizePersist(game, 'finished');
    return;
  }
  game.questionIndex = index;
  game.phase = 'question';
  game.answers.set(index, []);
  const q = game.quiz.questions[index];
  const now = Date.now();
  game.questionStartedAt = now;
  game.questionEndsAt = now + q.timeLimit * 1000;
}

export function lockQuestion(game: GameSession) {
  if (game.phase !== 'question') return;
  clearTimer(game);
  game.phase = 'reveal';
}

export function maybeExpireQuestion(game: GameSession): boolean {
  if (game.phase !== 'question') return false;
  if (!game.questionEndsAt) return false;
  if (Date.now() <= game.questionEndsAt) return false;
  lockQuestion(game);
  return true;
}

export function advance(game: GameSession): GamePhase {
  if (isPaused(game)) return game.phase;
  switch (game.phase) {
    case 'lobby':
      if (game.players.size > 0) startGame(game);
      return game.phase;
    case 'question':
      lockQuestion(game);
      return game.phase;
    case 'reveal':
      if (game.questionIndex + 1 < game.quiz.questions.length) {
        game.phase = 'leaderboard';
      } else {
        game.phase = 'final';
        finalizePersist(game, 'finished');
      }
      return game.phase;
    case 'leaderboard':
      advanceToQuestion(game, game.questionIndex + 1);
      return game.phase;
    case 'final':
      return game.phase;
    default:
      return game.phase;
  }
}

export function submitAnswer(
  game: GameSession,
  playerId: string,
  optionIndex: AnswerIndex,
): {
  ok: boolean;
  error?: string;
  reason?: 'paused' | 'expired';
  awarded?: number;
  correct?: boolean;
} {
  if (isPaused(game)) return { ok: false, reason: 'paused', error: 'Game is paused' };
  if (game.phase !== 'question') return { ok: false, error: 'Not accepting answers' };
  if (maybeExpireQuestion(game)) {
    return { ok: false, reason: 'expired', error: 'Time is up' };
  }
  const q = currentQuestion(game);
  if (!q) return { ok: false, error: 'No active question' };
  if (optionIndex < 0 || optionIndex >= q.options.length) {
    return { ok: false, error: 'Invalid option' };
  }
  const records = game.answers.get(game.questionIndex) ?? [];
  if (records.find((r) => r.playerId === playerId)) {
    return { ok: false, error: 'Already answered' };
  }
  const player = game.players.get(playerId);
  if (!player) return { ok: false, error: 'Player not in game' };

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
  if (game.sessionDbId) {
    recordAnswer({
      sessionId: game.sessionDbId,
      questionIndex: game.questionIndex,
      playerInGameId: playerId,
      optionIndex,
      correct,
      msFromStart,
      awarded,
    }).catch((err) => console.error('[session-repo]', err));
  }

  const allAnswered =
    records.length >= Array.from(game.players.values()).filter((p) => p.connected).length;
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

// Prefix values that begin with a spreadsheet-formula trigger char with a
// single quote so Excel/Sheets render the literal text instead of evaluating
// it. Covers `=`, `+`, `-`, `@`, tab, and CR.
export function neutralizeFormulaPrefix(value: string): string {
  if (!value) return value;
  const first = value.charCodeAt(0);
  if (
    first === 0x3d /* = */ ||
    first === 0x2b /* + */ ||
    first === 0x2d /* - */ ||
    first === 0x40 /* @ */ ||
    first === 0x09 /* tab */ ||
    first === 0x0d /* CR */
  ) {
    return `'${value}`;
  }
  return value;
}

export function csvEscape(value: string): string {
  const safe = neutralizeFormulaPrefix(value);
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function exportResultsCsv(game: GameSession): string {
  const total = game.quiz.questions.length;
  const board = leaderboard(game);
  const rows: string[] = ['rank,nickname,score,correct,total,avg_response_ms'];
  for (const entry of board) {
    let correct = 0;
    let answeredCount = 0;
    let msSum = 0;
    for (let i = 0; i < total; i++) {
      const records = game.answers.get(i);
      if (!records) continue;
      const mine = records.find((r) => r.playerId === entry.id);
      if (!mine) continue;
      answeredCount += 1;
      msSum += mine.msFromStart;
      if (mine.correct) correct += 1;
    }
    const avg = answeredCount > 0 ? String(Math.round(msSum / answeredCount)) : '';
    rows.push([entry.rank, csvEscape(entry.nickname), entry.score, correct, total, avg].join(','));
  }
  return `${rows.join('\r\n')}\r\n`;
}

export function exportAnswersCsv(game: GameSession): string {
  const questions = game.quiz.questions;
  const rows: string[] = [
    'question_no,question,player,choice_index,choice_text,correct,ms_from_start,awarded',
  ];
  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi];
    const records = game.answers.get(qi) ?? [];
    const answeredIds = new Set(records.map((r) => r.playerId));
    for (const r of records) {
      const player = game.players.get(r.playerId);
      if (!player) continue;
      rows.push(
        [
          qi + 1,
          csvEscape(q.text),
          csvEscape(player.nickname),
          r.optionIndex,
          csvEscape(q.options[r.optionIndex] ?? ''),
          r.correct ? 'true' : 'false',
          r.msFromStart,
          r.awarded,
        ].join(','),
      );
    }
    for (const player of game.players.values()) {
      if (answeredIds.has(player.id)) continue;
      rows.push(
        [qi + 1, csvEscape(q.text), csvEscape(player.nickname), '', '', 'false', '', 0].join(','),
      );
    }
  }
  return `${rows.join('\r\n')}\r\n`;
}

export function publicState(game: GameSession): PublicGameState {
  const q = currentQuestion(game);
  const board = leaderboard(game);
  const cap = capStatus(game);
  const reveal =
    game.phase === 'reveal' || game.phase === 'leaderboard'
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
      q && (game.phase === 'question' || game.phase === 'reveal')
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
    paused:
      game.pausedAt && game.pauseReason
        ? { reason: game.pauseReason, resumeBy: game.pauseResumeBy ?? 0 }
        : undefined,
    endedReason: game.endedReason,
    playerCount: cap.current,
    cap: { hard: cap.hard, soft: cap.soft, upsell: cap.upsell },
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

export const config = { HARD_CAP, SOFT_CAP_FREE, UPSELL_AT };
