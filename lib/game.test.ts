import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./session-repo', () => ({
  createSessionRecord: vi.fn(async () => null),
  recordPlayerJoin: vi.fn(async () => undefined),
  recordAnswer: vi.fn(async () => undefined),
  finalizeSession: vi.fn(async () => undefined),
}));

import {
  advance,
  advanceToQuestion,
  attachDisplay,
  attachHost,
  capStatus,
  createGame,
  currentQuestion,
  detachSocket,
  distribution,
  endByHostLeft,
  exportAnswersCsv,
  exportResultsCsv,
  type GameSession,
  isPaused,
  isWithinReconnectGrace,
  joinPlayer,
  kickPlayer,
  leaderboard,
  listGames,
  lockQuestion,
  maybeExpireQuestion,
  neutralizeFormulaPrefix,
  pauseForHostDisconnect,
  personalState,
  publicState,
  reapStalePlayers,
  resumeFromPause,
  setReconnectGraceForTesting,
  startGame,
  submitAnswer,
} from './game';
import * as sessionRepo from './session-repo';
import type { AnswerIndex, Player, Quiz } from './types';

const mockedRepo = vi.mocked(sessionRepo);
const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

function makeQuiz(overrides?: Partial<Quiz>): Quiz {
  return {
    title: 'Test Quiz',
    questions: [
      {
        id: 'q1',
        type: 'multiple',
        text: 'Q1',
        options: ['a', 'b', 'c', 'd'],
        correct: 0,
        timeLimit: 10,
        doublePoints: false,
      },
      {
        id: 'q2',
        type: 'multiple',
        text: 'Q2',
        options: ['a', 'b', 'c', 'd'],
        correct: 1,
        timeLimit: 10,
        doublePoints: true,
      },
    ],
    ...overrides,
  };
}

function setupGame(quizOverrides?: Partial<Quiz>): GameSession {
  return createGame(makeQuiz(quizOverrides));
}

function mustJoin(
  pin: string,
  socketId: string,
  nickname: string,
): { game: GameSession; player: Player; reconnected: boolean } {
  const r = joinPlayer(pin, socketId, nickname);
  if (!r.ok) throw new Error(`join failed for ${nickname}: ${r.error}`);
  return { game: r.game, player: r.player, reconnected: r.reconnected };
}

describe('scoring (via submitAnswer)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('correct answer at full time = base + max time bonus (1000)', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    const res = submitAnswer(game, a.player.id, 0);
    expect(res.ok).toBe(true);
    expect(res.correct).toBe(true);
    expect(res.awarded).toBe(1000);
  });

  it('correct answer at 0ms remaining clamps to base only (500)', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    vi.advanceTimersByTime(10_000);
    const res = submitAnswer(game, a.player.id, 0);
    expect(res.awarded).toBe(500);
  });

  it('correct answer at 50% time remaining ≈ 750', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    vi.advanceTimersByTime(5_000);
    const res = submitAnswer(game, a.player.id, 0);
    expect(res.awarded).toBeGreaterThanOrEqual(740);
    expect(res.awarded).toBeLessThanOrEqual(760);
  });

  it('wrong answer awards 0 regardless of time', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    const res = submitAnswer(game, a.player.id, 1);
    expect(res.correct).toBe(false);
    expect(res.awarded).toBe(0);
  });

  it('doublePoints question doubles the awarded score', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    submitAnswer(game, a.player.id, 0); // q1 correct (auto-locks → reveal)
    expect(game.phase).toBe('reveal');
    advance(game); // reveal → leaderboard
    advance(game); // leaderboard → question (q2)
    expect(game.phase).toBe('question');
    expect(game.questionIndex).toBe(1);
    const res = submitAnswer(game, a.player.id, 1);
    expect(res.correct).toBe(true);
    expect(res.awarded).toBe(2000);
  });

  it('a player who never answers ends the question with score 0', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    const b = mustJoin(game.pin, 's2', 'Bob');
    startGame(game);
    submitAnswer(game, a.player.id, 0);
    lockQuestion(game);
    expect(b.player.score).toBe(0);
  });

  it('score and streak accumulate on correct answers', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    submitAnswer(game, a.player.id, 0);
    expect(a.player.score).toBe(1000);
    expect(a.player.streak).toBe(1);
    advance(game); // → leaderboard
    advance(game); // → q2
    submitAnswer(game, a.player.id, 1);
    expect(a.player.streak).toBe(2);
    expect(a.player.score).toBe(3000); // 1000 + 2000
  });

  it('wrong answer resets streak to 0', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    submitAnswer(game, a.player.id, 0);
    expect(a.player.streak).toBe(1);
    advance(game);
    advance(game);
    submitAnswer(game, a.player.id, 0); // wrong on q2 (correct=1)
    expect(a.player.streak).toBe(0);
  });
});

describe('joinPlayer lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    setReconnectGraceForTesting(50);
  });
  afterEach(() => {
    setReconnectGraceForTesting(30_000);
    vi.useRealTimers();
  });

  it('new player join → ok, reconnected: false, player added', () => {
    const game = setupGame();
    const r = joinPlayer(game.pin, 's1', 'Alice');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reconnected).toBe(false);
    expect(game.players.size).toBe(1);
    expect(r.player.nickname).toBe('Alice');
  });

  it('idempotent: same socket re-emits same nickname → same playerId, no duplicate', () => {
    const game = setupGame();
    const r1 = joinPlayer(game.pin, 's1', 'Alice');
    const r2 = joinPlayer(game.pin, 's1', 'Alice');
    if (!r1.ok || !r2.ok) throw new Error('expected both joins to succeed');
    expect(r1.player.id).toBe(r2.player.id);
    expect(r2.reconnected).toBe(false);
    expect(game.players.size).toBe(1);
  });

  it('different socket with same nickname while first is still connected → fails', () => {
    const game = setupGame();
    joinPlayer(game.pin, 's1', 'Alice');
    const r = joinPlayer(game.pin, 's2', 'Alice');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('Nickname taken');
    // current behavior: no code on duplicate path (codex baseline)
    expect(r.code).toBeUndefined();
  });

  it('disconnect → reconnect via new socket within grace → reconnected: true, same id', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    const origId = a.player.id;

    detachSocket('s1');
    expect(a.player.connected).toBe(false);

    vi.advanceTimersByTime(10);
    const r = joinPlayer(game.pin, 's2', 'Alice');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reconnected).toBe(true);
    expect(r.player.id).toBe(origId);
    expect(r.player.connected).toBe(true);
  });

  it('after grace expires, same nickname produces a new player with new id and 0 score', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    const origId = a.player.id;
    a.player.score = 999;

    detachSocket('s1');
    vi.advanceTimersByTime(100);

    const r = joinPlayer(game.pin, 's2', 'Alice');
    if (!r.ok) throw new Error('expected post-grace join to succeed');
    expect(r.reconnected).toBe(false);
    expect(r.player.id).not.toBe(origId);
    expect(r.player.score).toBe(0);
  });

  it("rejects with code: 'full' when room is at the configured cap", () => {
    const game = createGame(makeQuiz(), { playerCap: 3 });
    for (let i = 0; i < 3; i++) {
      const r = joinPlayer(game.pin, `s${i}`, `P${i}`);
      if (!r.ok) throw new Error(`unexpected reject at ${i}: ${r.error}`);
    }
    const overflow = joinPlayer(game.pin, 'sX', 'Overflow');
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.code).toBe('full');
    expect(overflow.error).toBe('Room is full');
  });

  it('admits the Nth player but rejects the (N+1)th at the cap boundary', () => {
    const game = createGame(makeQuiz(), { playerCap: 5 });
    for (let i = 0; i < 4; i++) {
      joinPlayer(game.pin, `s${i}`, `P${i}`);
    }
    expect(game.players.size).toBe(4);
    const r5 = joinPlayer(game.pin, 's4', 'P4');
    expect(r5.ok).toBe(true);
    const r6 = joinPlayer(game.pin, 's5', 'P5');
    expect(r6.ok).toBe(false);
    if (r6.ok) return;
    expect(r6.code).toBe('full');
  });

  it('a custom cap of 50 admits 50 players and rejects the 51st (acceptance)', () => {
    const game = createGame(makeQuiz(), { playerCap: 50 });
    for (let i = 0; i < 50; i++) {
      const r = joinPlayer(game.pin, `s${i}`, `P${i}`);
      if (!r.ok) throw new Error(`unexpected reject at ${i}: ${r.error}`);
    }
    expect(game.players.size).toBe(50);
    const r51 = joinPlayer(game.pin, 's50', 'P50');
    expect(r51.ok).toBe(false);
    if (r51.ok) return;
    expect(r51.code).toBe('full');
  });

  it('defaults to the OSS config cap (10) when none is injected', () => {
    const game = setupGame();
    for (let i = 0; i < 10; i++) {
      const r = joinPlayer(game.pin, `s${i}`, `P${i}`);
      expect(r.ok).toBe(true);
    }
    const overflow = joinPlayer(game.pin, 's10', 'P10');
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.code).toBe('full');
  });

  it('a reconnecting player is NOT blocked even when the game is at capacity', () => {
    const game = createGame(makeQuiz(), { playerCap: 2 });
    const a = mustJoin(game.pin, 's1', 'Alice');
    mustJoin(game.pin, 's2', 'Bob'); // full at 2
    detachSocket('s1'); // Alice within grace still holds her slot
    const stranger = joinPlayer(game.pin, 's3', 'Carol');
    expect(stranger.ok).toBe(false); // a new player can't take a slot
    const back = joinPlayer(game.pin, 's4', 'Alice'); // Alice reclaims hers
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.reconnected).toBe(true);
    expect(back.player.id).toBe(a.player.id);
  });

  it('rejects whitespace-only nickname (no code, baseline behavior)', () => {
    const game = setupGame();
    const r = joinPlayer(game.pin, 's1', '   ');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('Nickname required');
    expect(r.code).toBeUndefined();
  });

  it("rejects profane nickname with code 'nickname-rejected'", () => {
    const game = setupGame();
    const r = joinPlayer(game.pin, 's1', 'fuckface');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('nickname-rejected');
    expect(r.error).toBe('Pick another nickname');
  });

  it('rejects join after lobby phase', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    const r = joinPlayer(game.pin, 's2', 'Bob');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('Game already started');
  });

  it('returns error for unknown pin', () => {
    const r = joinPlayer('000000', 's1', 'Ghost');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('Game not found');
  });

  it('trims surrounding whitespace and clips to 20 characters', () => {
    const game = setupGame();
    const r = joinPlayer(game.pin, 's1', '   reallyLongNicknameOver20  ');
    if (!r.ok) throw new Error(r.error);
    expect(r.player.nickname.length).toBeLessThanOrEqual(20);
    expect(r.player.nickname).toBe('reallyLongNicknameOv');
  });
});

describe('pauseForHostDisconnect / resumeFromPause', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('during a question records pausedAt, pauseReason, pauseRemainingMs, pauseResumeBy', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    vi.advanceTimersByTime(3_000);
    const ok = pauseForHostDisconnect(game);
    expect(ok).toBe(true);
    expect(game.pausedAt).toBe(Date.now());
    expect(game.pauseReason).toBe('host-disconnected');
    expect(game.pauseRemainingMs).toBe(7_000);
    expect(game.pauseResumeBy).toBe(game.pausedAt! + 60_000);
    expect(isPaused(game)).toBe(true);
  });

  it('outside a question phase still pauses but pauseRemainingMs is undefined', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    const ok = pauseForHostDisconnect(game);
    expect(ok).toBe(true);
    expect(game.pausedAt).toBeDefined();
    expect(game.pauseRemainingMs).toBeUndefined();
  });

  it('does not pause when already paused', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    pauseForHostDisconnect(game);
    expect(pauseForHostDisconnect(game)).toBe(false);
  });

  it("does not pause when game phase is 'final'", () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    endByHostLeft(game);
    expect(pauseForHostDisconnect(game)).toBe(false);
  });

  it('resumeFromPause clears all pause fields', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    pauseForHostDisconnect(game);
    expect(resumeFromPause(game)).toBe(true);
    expect(game.pausedAt).toBeUndefined();
    expect(game.pauseReason).toBeUndefined();
    expect(game.pauseResumeBy).toBeUndefined();
    expect(game.pauseRemainingMs).toBeUndefined();
  });

  it('resumeFromPause re-arms questionEndsAt to now + savedRemainingMs', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    vi.advanceTimersByTime(3_000);
    pauseForHostDisconnect(game);
    const remaining = game.pauseRemainingMs!;
    vi.advanceTimersByTime(20_000);
    resumeFromPause(game);
    expect(game.questionEndsAt).toBe(Date.now() + remaining);
  });

  it('resumeFromPause is a no-op when not paused', () => {
    const game = setupGame();
    expect(resumeFromPause(game)).toBe(false);
  });

  it('pauseResumeBy = pausedAt + 60s (encodes host grace window)', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    pauseForHostDisconnect(game);
    expect(game.pauseResumeBy).toBe(game.pausedAt! + 60_000);
  });
});

describe('phase transitions', () => {
  it("initial phase is 'lobby'", () => {
    expect(setupGame().phase).toBe('lobby');
  });

  it('startGame requires at least one player', () => {
    const game = setupGame();
    startGame(game);
    expect(game.phase).toBe('lobby');
  });

  it('startGame → question, questionIndex = 0, endsAt set', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    expect(game.phase).toBe('question');
    expect(game.questionIndex).toBe(0);
    expect(game.questionEndsAt).toBeGreaterThan(Date.now());
  });

  it('lockQuestion while in question → reveal', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    lockQuestion(game);
    expect(game.phase).toBe('reveal');
  });

  it('lockQuestion outside question phase is a no-op', () => {
    const game = setupGame();
    lockQuestion(game);
    expect(game.phase).toBe('lobby');
  });

  it('advance from reveal mid-quiz → leaderboard', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    lockQuestion(game);
    advance(game);
    expect(game.phase).toBe('leaderboard');
  });

  it('advance from leaderboard → question (next index)', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    lockQuestion(game);
    advance(game); // leaderboard
    advance(game); // question (q2)
    expect(game.phase).toBe('question');
    expect(game.questionIndex).toBe(1);
  });

  it('advance from reveal on the LAST question → final', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    lockQuestion(game);
    advance(game); // leaderboard
    advance(game); // q2
    lockQuestion(game); // reveal q2
    advance(game); // final
    expect(game.phase).toBe('final');
  });

  it("advance in 'final' is a no-op", () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    endByHostLeft(game);
    expect(game.phase).toBe('final');
    const phase = advance(game);
    expect(phase).toBe('final');
  });

  it('advance from lobby with players triggers startGame', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    advance(game);
    expect(game.phase).toBe('question');
  });

  it('advance from question calls lockQuestion → reveal', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    advance(game);
    expect(game.phase).toBe('reveal');
  });

  it("advanceToQuestion past last index moves to 'final'", () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    advanceToQuestion(game, 99);
    expect(game.phase).toBe('final');
  });
});

describe('capStatus (OSS env cap)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    setReconnectGraceForTesting(30_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('0 connected → not full, max = configured cap, no tier fields', () => {
    const game = createGame(makeQuiz(), { playerCap: 10 });
    expect(capStatus(game)).toEqual({ max: 10, current: 0, full: false });
  });

  it('max reflects the per-game configured cap', () => {
    const game = createGame(makeQuiz(), { playerCap: 50 });
    expect(capStatus(game).max).toBe(50);
  });

  it('one short of the cap → not full', () => {
    const game = createGame(makeQuiz(), { playerCap: 5 });
    for (let i = 0; i < 4; i++) joinPlayer(game.pin, `s${i}`, `P${i}`);
    const s = capStatus(game);
    expect(s.full).toBe(false);
    expect(s.current).toBe(4);
  });

  it('at the cap → full', () => {
    const game = createGame(makeQuiz(), { playerCap: 5 });
    for (let i = 0; i < 5; i++) joinPlayer(game.pin, `s${i}`, `P${i}`);
    const s = capStatus(game);
    expect(s.full).toBe(true);
    expect(s.current).toBe(5);
  });

  it('disconnected players within grace ARE counted (codex F6 baseline)', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    expect(capStatus(game).current).toBe(1);
    detachSocket('s1');
    expect(capStatus(game).current).toBe(1);
  });

  it('disconnected players past grace are NOT counted', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    detachSocket('s1');
    vi.advanceTimersByTime(31_000);
    expect(capStatus(game).current).toBe(0);
  });
});

describe('leaderboard', () => {
  it('empty game returns empty list', () => {
    expect(leaderboard(setupGame())).toEqual([]);
  });

  it('sorts by score descending and assigns rank by index', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    const b = mustJoin(game.pin, 's2', 'Bob');
    const c = mustJoin(game.pin, 's3', 'Carol');
    a.player.score = 100;
    b.player.score = 300;
    c.player.score = 200;
    const board = leaderboard(game);
    expect(board.map((p) => p.nickname)).toEqual(['Bob', 'Carol', 'Alice']);
    expect(board.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it('ties use insertion order (codex F9 baseline behavior)', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    const b = mustJoin(game.pin, 's2', 'Bob');
    a.player.score = 50;
    b.player.score = 50;
    const board = leaderboard(game);
    expect(board[0].nickname).toBe('Alice');
    expect(board[0].rank).toBe(1);
    expect(board[1].nickname).toBe('Bob');
    expect(board[1].rank).toBe(2);
  });
});

describe('misc surfaces (coverage)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    setReconnectGraceForTesting(30_000);
  });
  afterEach(() => {
    setReconnectGraceForTesting(30_000);
    vi.useRealTimers();
  });

  it('createGame requires at least one question', () => {
    expect(() => createGame({ title: 'empty', questions: [] })).toThrow();
  });

  it('attachHost / attachDisplay set socket ids', () => {
    const game = setupGame();
    attachHost(game.pin, 'host-sock');
    expect(game.hostSocketId).toBe('host-sock');
    attachDisplay(game.pin, 'disp-sock');
    expect(game.displaySocketIds.has('disp-sock')).toBe(true);
  });

  it('attachHost / attachDisplay return undefined for unknown pin', () => {
    expect(attachHost('000000', 'x')).toBeUndefined();
    expect(attachDisplay('000000', 'x')).toBeUndefined();
  });

  it("detachSocket emits 'host', 'display', 'player' events appropriately", () => {
    const game = setupGame();
    attachHost(game.pin, 'h1');
    attachDisplay(game.pin, 'd1');
    mustJoin(game.pin, 'p1', 'Alice');

    const hostEvents = detachSocket('h1');
    expect(hostEvents.some((e) => e.type === 'host' && e.pin === game.pin)).toBe(true);

    const dispEvents = detachSocket('d1');
    expect(dispEvents.some((e) => e.type === 'display' && e.pin === game.pin)).toBe(true);

    const playerEvents = detachSocket('p1');
    expect(playerEvents.some((e) => e.type === 'player' && e.pin === game.pin)).toBe(true);
  });

  it('kickPlayer removes player and socket mapping', () => {
    const game = setupGame();
    const r = mustJoin(game.pin, 'p1', 'Alice');
    kickPlayer(game.pin, r.player.id);
    expect(game.players.has(r.player.id)).toBe(false);
    expect(game.socketToPlayer.has('p1')).toBe(false);
  });

  it('kickPlayer is a no-op for unknown pin', () => {
    expect(() => kickPlayer('000000', 'x')).not.toThrow();
  });

  it('currentQuestion: undefined before start, defined after', () => {
    const game = setupGame();
    expect(currentQuestion(game)).toBeUndefined();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    expect(currentQuestion(game)?.text).toBe('Q1');
  });

  it('distribution: counts answers per option index', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    const b = mustJoin(game.pin, 's2', 'Bob');
    const c = mustJoin(game.pin, 's3', 'Carol');
    startGame(game);
    submitAnswer(game, a.player.id, 0);
    submitAnswer(game, b.player.id, 0);
    submitAnswer(game, c.player.id, 2);
    expect(distribution(game)).toEqual([2, 0, 1, 0]);
  });

  it('distribution returns [] before any question', () => {
    expect(distribution(setupGame())).toEqual([]);
  });

  it('submitAnswer rejects when not in question phase', () => {
    const game = setupGame();
    const r = mustJoin(game.pin, 's1', 'Alice');
    const res = submitAnswer(game, r.player.id, 0);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Not accepting answers');
  });

  it('submitAnswer rejects invalid option index', () => {
    const game = setupGame();
    const r = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    const res = submitAnswer(game, r.player.id, 9 as unknown as AnswerIndex);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Invalid option');
  });

  it('submitAnswer rejects unknown player id', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    const res = submitAnswer(game, 'ghost', 0);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Player not in game');
  });

  it('submitAnswer rejects double-submit by same player', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    mustJoin(game.pin, 's2', 'Bob'); // keep 2 connected so the first answer doesn't auto-lock
    startGame(game);
    submitAnswer(game, a.player.id, 0);
    const res = submitAnswer(game, a.player.id, 1);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Already answered');
  });

  it('submitAnswer auto-locks when all connected players have answered', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    const b = mustJoin(game.pin, 's2', 'Bob');
    startGame(game);
    submitAnswer(game, a.player.id, 0);
    expect(game.phase).toBe('question');
    submitAnswer(game, b.player.id, 0);
    expect(game.phase).toBe('reveal');
  });

  it('publicState exposes pin, phase, players, podium, cap', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    const s = publicState(game);
    expect(s.pin).toBe(game.pin);
    expect(s.phase).toBe('lobby');
    expect(s.players).toHaveLength(1);
    expect(s.cap).toEqual({ max: 10 });
    expect(s.totalQuestions).toBe(2);
  });

  it('publicState includes question after startGame and reveal in reveal phase', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    expect(publicState(game).question?.text).toBe('Q1');
    lockQuestion(game);
    expect(publicState(game).reveal?.correct).toBe(0);
  });

  it('publicState surfaces question imageUrl when present (MID-278)', () => {
    const game = createGame(
      makeQuiz({
        questions: [
          {
            id: 'q1',
            type: 'multiple',
            text: 'Q1',
            options: ['a', 'b', 'c', 'd'],
            correct: 0,
            timeLimit: 10,
            doublePoints: false,
            imageUrl: '/uploads/quiz-images/pic.png',
          },
        ],
      }),
    );
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    expect(publicState(game).question?.imageUrl).toBe('/uploads/quiz-images/pic.png');
  });

  it('publicState omits imageUrl for text-only questions (MID-278)', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    expect(publicState(game).question?.imageUrl).toBeUndefined();
  });

  it('publicState includes paused metadata while paused', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    pauseForHostDisconnect(game);
    expect(publicState(game).paused?.reason).toBe('host-disconnected');
  });

  it('publicState in leaderboard phase still surfaces reveal info', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    lockQuestion(game);
    advance(game); // leaderboard
    const s = publicState(game);
    expect(s.phase).toBe('leaderboard');
    expect(s.reveal).toBeDefined();
  });

  it('publicState in final state surfaces endedReason when host-left', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    endByHostLeft(game);
    expect(publicState(game).endedReason).toBe('host-left');
  });

  it('personalState reflects answer state for known player', () => {
    const game = setupGame();
    const r = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    submitAnswer(game, r.player.id, 0);
    const ps = personalState(game, r.player.id);
    expect(ps?.hasAnswered).toBe(true);
    expect(ps?.lastCorrect).toBe(true);
    expect(ps?.score).toBe(1000);
  });

  it('personalState returns null for unknown player', () => {
    expect(personalState(setupGame(), 'ghost')).toBeNull();
  });

  it('personalState with a precomputed board matches the self-computed result', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    const b = mustJoin(game.pin, 's2', 'Bob');
    startGame(game);
    submitAnswer(game, a.player.id, 0);
    submitAnswer(game, b.player.id, 1);
    const board = leaderboard(game);
    for (const id of [a.player.id, b.player.id]) {
      expect(personalState(game, id, board)).toEqual(personalState(game, id));
    }
  });

  it('exportResultsCsv produces a header plus one row per player', () => {
    const game = setupGame();
    const r = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    submitAnswer(game, r.player.id, 0);
    advance(game); // leaderboard
    advance(game); // q2
    submitAnswer(game, r.player.id, 1);
    const csv = exportResultsCsv(game);
    const lines = csv.trim().split(/\r\n/);
    expect(lines[0]).toBe('rank,nickname,score,correct,total,avg_response_ms');
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith('1,Alice,')).toBe(true);
  });

  it('exportResultsCsv csvEscape handles commas, quotes, and newlines', () => {
    const game = setupGame();
    const r = mustJoin(game.pin, 's1', `wei,rd"name`);
    if (!r) return;
    const csv = exportResultsCsv(game);
    expect(csv).toContain('"wei,rd""name"');
  });

  it('exportResultsCsv produces empty avg when player never answered', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    const csv = exportResultsCsv(game);
    const lines = csv.trim().split(/\r\n/);
    // header + 1 player; trailing field for avg should be empty
    expect(lines[1].endsWith(',')).toBe(true);
  });

  it('isWithinReconnectGrace: false connected, true within window, false past it', () => {
    const game = setupGame();
    const r = mustJoin(game.pin, 's1', 'Alice');
    expect(isWithinReconnectGrace(r.player)).toBe(false);
    detachSocket('s1');
    expect(isWithinReconnectGrace(r.player)).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(isWithinReconnectGrace(r.player)).toBe(false);
  });

  it('isWithinReconnectGrace returns false when no disconnectedAt is set', () => {
    const player: Player = { id: 'x', nickname: 'x', score: 0, streak: 0, connected: false };
    expect(isWithinReconnectGrace(player)).toBe(false);
  });

  it('reapStalePlayers drops disconnected players past grace', () => {
    setReconnectGraceForTesting(50);
    const game = setupGame();
    const r = mustJoin(game.pin, 's1', 'Alice');
    detachSocket('s1');
    vi.advanceTimersByTime(100);
    const dropped = reapStalePlayers(game);
    expect(dropped).toContain(r.player.id);
    expect(game.players.has(r.player.id)).toBe(false);
  });

  it('listGames returns currently registered games', () => {
    const game = setupGame();
    expect(listGames().some((g) => g.pin === game.pin)).toBe(true);
  });

  it('endByHostLeft → final, endedReason set, pause + timing fields cleared', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    pauseForHostDisconnect(game);
    endByHostLeft(game);
    expect(game.phase).toBe('final');
    expect(game.endedReason).toBe('host-left');
    expect(game.pausedAt).toBeUndefined();
    expect(game.questionStartedAt).toBeUndefined();
    expect(game.questionEndsAt).toBeUndefined();
  });

  it('isPaused reflects pausedAt', () => {
    const game = setupGame();
    expect(isPaused(game)).toBe(false);
    mustJoin(game.pin, 's1', 'Alice');
    pauseForHostDisconnect(game);
    expect(isPaused(game)).toBe(true);
  });
});

describe('phase/timer integrity (F2/F4 guards)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("submitAnswer rejects with reason 'paused' while paused", () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    mustJoin(game.pin, 's2', 'Bob');
    startGame(game);
    pauseForHostDisconnect(game);
    const res = submitAnswer(game, a.player.id, 0);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('paused');
    // phase preserved, no scoring side-effect
    expect(game.phase).toBe('question');
    expect(a.player.score).toBe(0);
    expect(game.answers.get(game.questionIndex) ?? []).toHaveLength(0);
  });

  it("submitAnswer rejects with reason 'expired' once Date.now() > questionEndsAt", () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    mustJoin(game.pin, 's2', 'Bob');
    startGame(game);
    // q1 timeLimit is 10s; jump just past it
    vi.advanceTimersByTime(10_001);
    const res = submitAnswer(game, a.player.id, 0);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('expired');
    // expired path locks the question synchronously
    expect(game.phase).toBe('reveal');
    expect(a.player.score).toBe(0);
  });

  it('advance is a no-op while paused (preserves phase + index)', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    pauseForHostDisconnect(game);
    const beforePhase = game.phase;
    const beforeIndex = game.questionIndex;
    const after = advance(game);
    expect(after).toBe(beforePhase);
    expect(game.phase).toBe(beforePhase);
    expect(game.questionIndex).toBe(beforeIndex);
  });

  it('startGame is a no-op while paused (lobby stays lobby)', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    pauseForHostDisconnect(game);
    startGame(game);
    expect(game.phase).toBe('lobby');
  });

  it('maybeExpireQuestion: false before deadline, true and locks after', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    expect(maybeExpireQuestion(game)).toBe(false);
    expect(game.phase).toBe('question');
    vi.advanceTimersByTime(10_001);
    expect(maybeExpireQuestion(game)).toBe(true);
    expect(game.phase).toBe('reveal');
  });

  it('after resume, submitAnswer accepts again with normal scoring', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    mustJoin(game.pin, 's2', 'Bob');
    startGame(game);
    pauseForHostDisconnect(game);
    const blocked = submitAnswer(game, a.player.id, 0);
    expect(blocked.reason).toBe('paused');
    resumeFromPause(game);
    const ok = submitAnswer(game, a.player.id, 0);
    expect(ok.ok).toBe(true);
    expect(ok.correct).toBe(true);
  });
});

describe('neutralizeFormulaPrefix (F10 CSV injection)', () => {
  it('prefixes single-quote on dangerous leading characters', () => {
    expect(neutralizeFormulaPrefix('=cmd')).toBe("'=cmd");
    expect(neutralizeFormulaPrefix('+1+1')).toBe("'+1+1");
    expect(neutralizeFormulaPrefix('-2-3')).toBe("'-2-3");
    expect(neutralizeFormulaPrefix('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralizeFormulaPrefix('\tinjection')).toBe("'\tinjection");
    expect(neutralizeFormulaPrefix('\rinjection')).toBe("'\rinjection");
  });

  it('passes innocuous values through unchanged', () => {
    expect(neutralizeFormulaPrefix('Alice')).toBe('Alice');
    expect(neutralizeFormulaPrefix('Bob123')).toBe('Bob123');
    expect(neutralizeFormulaPrefix("O'Brien")).toBe("O'Brien");
    expect(neutralizeFormulaPrefix('')).toBe('');
    expect(neutralizeFormulaPrefix('a=b+c')).toBe('a=b+c');
    expect(neutralizeFormulaPrefix(' =leading-space')).toBe(' =leading-space');
  });

  it('exportResultsCsv neutralizes nicknames that start with formula triggers', () => {
    const game = setupGame();
    mustJoin(game.pin, 's1', '=cmd|calc');
    mustJoin(game.pin, 's2', '+1+1');
    mustJoin(game.pin, 's3', '@SUM');
    const csv = exportResultsCsv(game);
    // = and @ trigger CSV quoting only after neutralization adds the leading
    // quote; +/- alone don't trip the quote regex, so they appear bare with
    // the leading single-quote.
    expect(csv).toContain("'=cmd|calc");
    expect(csv).toContain("'+1+1");
    expect(csv).toContain("'@SUM");
  });
});

describe('exportAnswersCsv', () => {
  it('emits one row per answered record plus a blank row for non-answerers per question', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    const b = mustJoin(game.pin, 's2', 'Bob');
    startGame(game);
    submitAnswer(game, a.player.id, 0); // Alice correct on q1
    // Bob never answers q1 → exercises the unanswered branch in exportAnswersCsv.
    // Auto-lock only fires when ALL connected players have answered, so we
    // need to lock manually here before advancing to the next question.
    lockQuestion(game);
    advance(game); // → leaderboard
    advance(game); // → q2
    submitAnswer(game, a.player.id, 1); // Alice correct
    submitAnswer(game, b.player.id, 0); // Bob wrong; both answered → auto-lock
    const csv = exportAnswersCsv(game);
    const lines = csv.trim().split(/\r\n/);
    expect(lines[0]).toBe(
      'question_no,question,player,choice_index,choice_text,correct,ms_from_start,awarded',
    );
    // q1: 1 answered (Alice) + 1 unanswered (Bob) = 2 rows
    // q2: 2 answered = 2 rows
    expect(lines).toHaveLength(1 + 2 + 2);
    // unanswered row signature: trailing ",,false,,0"
    expect(lines.some((l) => l.includes(',Bob,,,false,,0'))).toBe(true);
  });

  it('skips answered rows whose player has been kicked between answer + export', () => {
    const game = setupGame();
    const a = mustJoin(game.pin, 's1', 'Alice');
    const b = mustJoin(game.pin, 's2', 'Bob');
    startGame(game);
    submitAnswer(game, a.player.id, 0);
    submitAnswer(game, b.player.id, 0);
    kickPlayer(game.pin, b.player.id);
    const csv = exportAnswersCsv(game);
    const lines = csv.trim().split(/\r\n/);
    // Header + Alice answered row only (Bob's record is skipped because the
    // player was removed; no unanswered row either since he's gone)
    expect(lines.some((l) => l.includes(',Bob,'))).toBe(false);
    expect(lines.some((l) => l.includes(',Alice,'))).toBe(true);
  });

  it('escapes question/option text containing commas and quotes', () => {
    const game = createGame({
      title: 'weird',
      questions: [
        {
          id: 'q1',
          type: 'multiple',
          text: 'Q, with "quotes"',
          options: ['a,b', 'c"d', 'e', 'f'],
          correct: 0,
          timeLimit: 10,
          doublePoints: false,
        },
      ],
    });
    const a = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    submitAnswer(game, a.player.id, 0);
    const csv = exportAnswersCsv(game);
    expect(csv).toContain('"Q, with ""quotes"""');
    expect(csv).toContain('"a,b"');
  });
});

describe('session persistence hooks', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedRepo.createSessionRecord.mockReset().mockResolvedValue(null);
    mockedRepo.recordPlayerJoin.mockReset().mockResolvedValue(undefined);
    mockedRepo.recordAnswer.mockReset().mockResolvedValue(undefined);
    mockedRepo.finalizeSession.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it('createGame calls createSessionRecord with pin, hostUserId, and quiz snapshot', async () => {
    mockedRepo.createSessionRecord.mockResolvedValueOnce({ id: 'sess-1' });
    const quiz = makeQuiz();
    const game = createGame(quiz, { tier: 'free', hostUserId: 'user-42' });
    expect(mockedRepo.createSessionRecord).toHaveBeenCalledTimes(1);
    expect(mockedRepo.createSessionRecord).toHaveBeenCalledWith({
      pin: game.pin,
      hostUserId: 'user-42',
      quizSnapshot: quiz,
    });
    await flushMicrotasks();
    expect(game.sessionDbId).toBe('sess-1');
  });

  it('createGame defaults hostUserId to null when not supplied', () => {
    createGame(makeQuiz());
    expect(mockedRepo.createSessionRecord).toHaveBeenCalledWith(
      expect.objectContaining({ hostUserId: null }),
    );
  });

  it('createGame supports the legacy positional opts signature', () => {
    createGame(makeQuiz(), 'free', { hostUserId: 'legacy-user' });
    expect(mockedRepo.createSessionRecord).toHaveBeenCalledWith(
      expect.objectContaining({ hostUserId: 'legacy-user' }),
    );
  });

  it('createGame does not crash if createSessionRecord rejects; logs the error', async () => {
    mockedRepo.createSessionRecord.mockRejectedValueOnce(new Error('db down'));
    const game = createGame(makeQuiz());
    await flushMicrotasks();
    expect(game.sessionDbId).toBeNull();
    expect(errSpy).toHaveBeenCalledWith('[session-repo]', expect.any(Error));
  });

  it('createGame leaves sessionDbId null when persistence is disabled (returns null row)', async () => {
    mockedRepo.createSessionRecord.mockResolvedValueOnce(null);
    const game = createGame(makeQuiz());
    await flushMicrotasks();
    expect(game.sessionDbId).toBeNull();
  });

  it('joinPlayer calls recordPlayerJoin with sessionId, in-game id, and nickname', async () => {
    mockedRepo.createSessionRecord.mockResolvedValueOnce({ id: 'sess-2' });
    const game = createGame(makeQuiz());
    await flushMicrotasks();
    const r = joinPlayer(game.pin, 's1', 'Alice');
    if (!r.ok) throw new Error('expected join ok');
    expect(mockedRepo.recordPlayerJoin).toHaveBeenCalledWith({
      sessionId: 'sess-2',
      inGameId: r.player.id,
      nickname: 'Alice',
    });
  });

  it('joinPlayer skips recordPlayerJoin when sessionDbId is null', () => {
    // Default mock resolves to null, so sessionDbId stays null
    const game = createGame(makeQuiz());
    const r = joinPlayer(game.pin, 's1', 'Alice');
    expect(r.ok).toBe(true);
    expect(mockedRepo.recordPlayerJoin).not.toHaveBeenCalled();
  });

  it('joinPlayer reconnect path does NOT re-call recordPlayerJoin', async () => {
    mockedRepo.createSessionRecord.mockResolvedValueOnce({ id: 'sess-3' });
    const game = createGame(makeQuiz());
    await flushMicrotasks();
    mustJoin(game.pin, 's1', 'Alice');
    expect(mockedRepo.recordPlayerJoin).toHaveBeenCalledTimes(1);
    detachSocket('s1');
    joinPlayer(game.pin, 's2', 'Alice'); // reconnect
    expect(mockedRepo.recordPlayerJoin).toHaveBeenCalledTimes(1);
  });

  it('joinPlayer logs error if recordPlayerJoin rejects but still admits the player', async () => {
    mockedRepo.createSessionRecord.mockResolvedValueOnce({ id: 'sess-4' });
    mockedRepo.recordPlayerJoin.mockRejectedValueOnce(new Error('write fail'));
    const game = createGame(makeQuiz());
    await flushMicrotasks();
    const r = joinPlayer(game.pin, 's1', 'Alice');
    expect(r.ok).toBe(true);
    expect(game.players.size).toBe(1);
    await flushMicrotasks();
    expect(errSpy).toHaveBeenCalledWith('[session-repo]', expect.any(Error));
  });

  it('submitAnswer calls recordAnswer with full answer record fields', async () => {
    mockedRepo.createSessionRecord.mockResolvedValueOnce({ id: 'sess-5' });
    const game = createGame(makeQuiz());
    await flushMicrotasks();
    const a = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    submitAnswer(game, a.player.id, 0);
    expect(mockedRepo.recordAnswer).toHaveBeenCalledTimes(1);
    expect(mockedRepo.recordAnswer).toHaveBeenCalledWith({
      sessionId: 'sess-5',
      questionIndex: 0,
      playerInGameId: a.player.id,
      optionIndex: 0,
      correct: true,
      msFromStart: expect.any(Number),
      awarded: expect.any(Number),
    });
  });

  it('submitAnswer skips recordAnswer when sessionDbId is null', () => {
    const game = createGame(makeQuiz());
    const a = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    submitAnswer(game, a.player.id, 0);
    expect(mockedRepo.recordAnswer).not.toHaveBeenCalled();
  });

  it('submitAnswer logs error if recordAnswer rejects but in-memory state stands', async () => {
    mockedRepo.createSessionRecord.mockResolvedValueOnce({ id: 'sess-6' });
    mockedRepo.recordAnswer.mockRejectedValueOnce(new Error('answer fail'));
    const game = createGame(makeQuiz());
    await flushMicrotasks();
    const a = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    const res = submitAnswer(game, a.player.id, 0);
    expect(res.ok).toBe(true);
    expect(a.player.score).toBe(1000);
    await flushMicrotasks();
    expect(errSpy).toHaveBeenCalledWith('[session-repo]', expect.any(Error));
  });

  it("endByHostLeft finalizes the session with status 'abandoned' and a leaderboard payload", async () => {
    mockedRepo.createSessionRecord.mockResolvedValueOnce({ id: 'sess-7' });
    const game = createGame(makeQuiz());
    await flushMicrotasks();
    const a = mustJoin(game.pin, 's1', 'Alice');
    a.player.score = 750;
    endByHostLeft(game);
    expect(mockedRepo.finalizeSession).toHaveBeenCalledTimes(1);
    expect(mockedRepo.finalizeSession).toHaveBeenCalledWith({
      sessionId: 'sess-7',
      status: 'abandoned',
      finalLeaderboard: [{ playerId: a.player.id, nickname: 'Alice', score: 750, rank: 1 }],
      playerFinalScores: [{ inGameId: a.player.id, finalScore: 750, finalRank: 1 }],
    });
    expect(game.finalized).toBe(true);
  });

  it("normal game completion finalizes with status 'finished'", async () => {
    mockedRepo.createSessionRecord.mockResolvedValueOnce({ id: 'sess-8' });
    const game = createGame(makeQuiz());
    await flushMicrotasks();
    const a = mustJoin(game.pin, 's1', 'Alice');
    startGame(game);
    submitAnswer(game, a.player.id, 0); // q1 → auto reveal
    advance(game); // → leaderboard
    advance(game); // → q2
    submitAnswer(game, a.player.id, 1); // q2 correct
    advance(game); // reveal → final (last question)
    expect(game.phase).toBe('final');
    expect(mockedRepo.finalizeSession).toHaveBeenCalledTimes(1);
    expect(mockedRepo.finalizeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-8',
        status: 'finished',
      }),
    );
  });

  it("advanceToQuestion past the last index also triggers 'finished' finalize", async () => {
    mockedRepo.createSessionRecord.mockResolvedValueOnce({ id: 'sess-9' });
    const game = createGame(makeQuiz());
    await flushMicrotasks();
    mustJoin(game.pin, 's1', 'Alice');
    advanceToQuestion(game, 99);
    expect(game.phase).toBe('final');
    expect(mockedRepo.finalizeSession).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'finished' }),
    );
  });

  it('finalizePersist runs only once even if both end paths trigger', async () => {
    mockedRepo.createSessionRecord.mockResolvedValueOnce({ id: 'sess-10' });
    const game = createGame(makeQuiz());
    await flushMicrotasks();
    mustJoin(game.pin, 's1', 'Alice');
    endByHostLeft(game);
    expect(mockedRepo.finalizeSession).toHaveBeenCalledTimes(1);
    // a second finalize attempt (e.g., advance from final) is a no-op
    advance(game);
    expect(mockedRepo.finalizeSession).toHaveBeenCalledTimes(1);
  });

  it('finalize is skipped when sessionDbId is null', () => {
    const game = createGame(makeQuiz());
    mustJoin(game.pin, 's1', 'Alice');
    endByHostLeft(game);
    expect(mockedRepo.finalizeSession).not.toHaveBeenCalled();
  });

  it('logs error if finalizeSession rejects but local game still ends', async () => {
    mockedRepo.createSessionRecord.mockResolvedValueOnce({ id: 'sess-11' });
    mockedRepo.finalizeSession.mockRejectedValueOnce(new Error('finalize fail'));
    const game = createGame(makeQuiz());
    await flushMicrotasks();
    mustJoin(game.pin, 's1', 'Alice');
    endByHostLeft(game);
    expect(game.phase).toBe('final');
    await flushMicrotasks();
    expect(errSpy).toHaveBeenCalledWith('[session-repo]', expect.any(Error));
  });
});
