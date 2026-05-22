import { createServer } from 'node:http';
import next from 'next';
import { Server, type Socket } from 'socket.io';
import type { Tier } from './lib/game';
import {
  advance,
  attachDisplay,
  attachHost,
  createGame,
  detachSocket,
  endByHostLeft,
  exportAnswersCsv,
  exportResultsCsv,
  getGame,
  joinPlayer,
  kickPlayer,
  pauseForHostDisconnect,
  personalState,
  publicState,
  resumeFromPause,
  startGame,
  submitAnswer,
} from './lib/game';
import type { AnswerIndex, Quiz } from './lib/types';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 4321);
const hostname = 'localhost';

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Runtime payload validators for socket events. The TypeScript handler
// signatures are not enforced at runtime — Socket.IO will hand us whatever a
// client sends, including arrays, nulls, or missing acks. These guards keep a
// malformed payload from crashing the handler or poisoning game state.

const NICKNAME_MAX = 20;
const TITLE_MAX = 100;
const QUESTION_TEXT_MAX = 500;
const MAX_QUESTIONS = 50;
const MIN_TIME_LIMIT = 3;
const MAX_TIME_LIMIT = 120;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

function isPin(v: unknown): v is string {
  return typeof v === 'string' && /^\d{6}$/.test(v);
}

function isNickname(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const trimmed = v.trim();
  return trimmed.length >= 1 && trimmed.length <= NICKNAME_MAX;
}

function isAnswerIndex(v: unknown): v is AnswerIndex {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3;
}

function isTier(v: unknown): v is Tier {
  return v === 'free' || v === 'pro';
}

function validateQuiz(input: unknown): Quiz {
  if (!input || typeof input !== 'object') throw new Error('quiz must be object');
  const q = input as Record<string, unknown>;
  if (typeof q.title !== 'string') throw new Error('title must be string');
  const title = q.title.trim();
  if (title.length < 1 || title.length > TITLE_MAX) {
    throw new Error('title length 1..100');
  }
  if (!Array.isArray(q.questions)) throw new Error('questions must be array');
  if (q.questions.length < 1 || q.questions.length > MAX_QUESTIONS) {
    throw new Error('questions length 1..50');
  }
  for (let i = 0; i < q.questions.length; i++) {
    const item = q.questions[i];
    if (!item || typeof item !== 'object') throw new Error(`Q${i}: not object`);
    const qq = item as Record<string, unknown>;
    if (typeof qq.text !== 'string') throw new Error(`Q${i}: text not string`);
    const txt = qq.text.trim();
    if (txt.length < 1 || txt.length > QUESTION_TEXT_MAX) {
      throw new Error(`Q${i}: text length 1..500`);
    }
    if (!Array.isArray(qq.options)) throw new Error(`Q${i}: options not array`);
    if (qq.options.length < MIN_OPTIONS || qq.options.length > MAX_OPTIONS) {
      throw new Error(`Q${i}: options length 2..4`);
    }
    for (let j = 0; j < qq.options.length; j++) {
      if (typeof qq.options[j] !== 'string') {
        throw new Error(`Q${i}: option ${j} not string`);
      }
    }
    if (
      typeof qq.correct !== 'number' ||
      !Number.isInteger(qq.correct) ||
      qq.correct < 0 ||
      qq.correct >= qq.options.length
    ) {
      throw new Error(`Q${i}: correct out of range`);
    }
    if (
      typeof qq.timeLimit !== 'number' ||
      !Number.isInteger(qq.timeLimit) ||
      qq.timeLimit < MIN_TIME_LIMIT ||
      qq.timeLimit > MAX_TIME_LIMIT
    ) {
      throw new Error(`Q${i}: timeLimit must be int 3..120`);
    }
  }
  return input as Quiz;
}

void app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const csv = matchResultsCsv(req.url);
    if (csv) {
      handleResultsCsv(csv, res);
      return;
    }
    const answersCsv = matchAnswersCsv(req.url);
    if (answersCsv) {
      handleAnswersCsv(answersCsv, res);
      return;
    }
    handle(req, res).catch((err) => {
      console.error('[next handler]', err);
      res.statusCode = 500;
      res.end('internal error');
    });
  });

  const io = new Server(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
  });

  const lockTimers = new Map<string, NodeJS.Timeout>();
  const hostGraceTimers = new Map<string, NodeJS.Timeout>();
  const HOST_GRACE_MS = 60_000;

  function broadcast(pin: string) {
    const game = getGame(pin);
    if (!game) return;
    const state = publicState(game);
    io.to(`pin:${pin}`).emit('state', state);
    for (const [socketId, playerId] of game.socketToPlayer.entries()) {
      io.to(socketId).emit('personal', personalState(game, playerId));
    }
  }

  io.on('connection', (socket: Socket) => {
    socket.on('host:create', (quiz: unknown, tierOrAck: unknown, maybeAck?: unknown) => {
      const ack =
        typeof tierOrAck === 'function'
          ? (tierOrAck as (res: { ok?: boolean; pin?: string; reason?: string }) => void)
          : typeof maybeAck === 'function'
            ? (maybeAck as (res: { ok?: boolean; pin?: string; reason?: string }) => void)
            : undefined;
      if (!ack) {
        console.warn('[host:create] missing ack — ignoring');
        return;
      }
      const tier: Tier = isTier(tierOrAck) ? tierOrAck : 'free';
      try {
        const validated = validateQuiz(quiz);
        const game = createGame(validated, tier);
        attachHost(game.pin, socket.id);
        socket.join(`pin:${game.pin}`);
        ack({ ok: true, pin: game.pin });
        broadcast(game.pin);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'invalid';
        console.warn('[host:create] rejected:', message);
        ack({ ok: false, reason: 'invalid-quiz' });
      }
    });

    socket.on('host:attach', (pin: string) => {
      const game = attachHost(pin, socket.id);
      if (!game) return;
      socket.join(`pin:${pin}`);
      const wasPaused = !!game.pausedAt && game.pauseReason === 'host-disconnected';
      const pendingExit = hostGraceTimers.get(pin);
      if (pendingExit) {
        clearTimeout(pendingExit);
        hostGraceTimers.delete(pin);
      }
      if (wasPaused) {
        const wasInQuestion = game.phase === 'question';
        resumeFromPause(game);
        if (wasInQuestion) scheduleAutoLock(pin);
      }
      broadcast(pin);
    });

    socket.on('host:start', (pin: string) => {
      const game = getGame(pin);
      if (!game || game.hostSocketId !== socket.id) return;
      startGame(game);
      broadcast(pin);
      if (game.phase === 'question') {
        scheduleAutoLock(pin);
      }
    });

    socket.on('host:advance', (pin: string) => {
      const game = getGame(pin);
      if (!game || game.hostSocketId !== socket.id) return;
      const phase = advance(game);
      broadcast(pin);
      if (phase === 'question') {
        scheduleAutoLock(pin);
      }
    });

    socket.on('host:kick', (pin: string, playerId: string) => {
      const game = getGame(pin);
      if (!game || game.hostSocketId !== socket.id) return;
      kickPlayer(pin, playerId);
      broadcast(pin);
    });

    socket.on('display:attach', (pin: string) => {
      const game = attachDisplay(pin, socket.id);
      if (!game) return;
      socket.join(`pin:${pin}`);
      broadcast(pin);
    });

    socket.on('player:join', (pin: unknown, nickname: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        console.warn('[player:join] missing ack — ignoring');
        return;
      }
      const cb = ack as (res: {
        ok: boolean;
        error?: string;
        code?: string;
        reason?: string;
        playerId?: string;
        reconnected?: boolean;
      }) => void;
      if (!isPin(pin)) {
        cb({ ok: false, reason: 'invalid-pin', error: 'Invalid pin' });
        return;
      }
      if (!isNickname(nickname)) {
        cb({ ok: false, reason: 'invalid-nickname', error: 'Invalid nickname' });
        return;
      }
      const result = joinPlayer(pin, socket.id, nickname);
      if (!result.ok) {
        cb({ ok: false, error: result.error, code: result.code });
        return;
      }
      socket.join(`pin:${pin}`);
      cb({ ok: true, playerId: result.player.id, reconnected: result.reconnected });
      if (result.reconnected) {
        io.to(`pin:${pin}`).emit('event:reconnected', {
          playerId: result.player.id,
          nickname: result.player.nickname,
        });
      }
      broadcast(pin);
    });

    socket.on('player:answer', (pin: unknown, optionIndex: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        console.warn('[player:answer] missing ack — ignoring');
        return;
      }
      const cb = ack as (res: {
        ok: boolean;
        error?: string;
        reason?: 'paused' | 'expired' | 'invalid-pin' | 'invalid-answer';
      }) => void;
      if (!isPin(pin)) {
        cb({ ok: false, reason: 'invalid-pin', error: 'Invalid pin' });
        return;
      }
      if (!isAnswerIndex(optionIndex)) {
        cb({ ok: false, reason: 'invalid-answer', error: 'Invalid answer index' });
        return;
      }
      const game = getGame(pin);
      if (!game) {
        cb({ ok: false, error: 'Game not found' });
        return;
      }
      const playerId = game.socketToPlayer.get(socket.id);
      if (!playerId) {
        cb({ ok: false, error: 'Not in game' });
        return;
      }
      const r = submitAnswer(game, playerId, optionIndex);
      if (!r.ok) {
        cb({ ok: false, error: r.error, reason: r.reason });
        if (r.reason === 'expired') broadcast(pin);
        return;
      }
      cb({ ok: true });
      broadcast(pin);
    });

    socket.on('disconnect', () => {
      const events = detachSocket(socket.id);
      const pins = new Set(events.map((e) => e.pin));
      for (const event of events) {
        if (event.type === 'host') {
          const game = getGame(event.pin);
          if (!game) continue;
          if (game.phase === 'final') continue;
          const ok = pauseForHostDisconnect(game);
          if (!ok) continue;
          if (lockTimers.has(event.pin)) {
            clearTimeout(lockTimers.get(event.pin)!);
            lockTimers.delete(event.pin);
          }
          const t = setTimeout(() => {
            const g = getGame(event.pin);
            hostGraceTimers.delete(event.pin);
            if (!g) return;
            if (g.hostSocketId) return;
            endByHostLeft(g);
            broadcast(event.pin);
          }, HOST_GRACE_MS + 50);
          hostGraceTimers.set(event.pin, t);
        }
      }
      for (const pin of pins) broadcast(pin);
    });
  });

  function scheduleAutoLock(pin: string) {
    const game = getGame(pin);
    if (!game?.questionEndsAt) return;
    const ms = Math.max(0, game.questionEndsAt - Date.now());
    if (lockTimers.has(pin)) clearTimeout(lockTimers.get(pin)!);
    const t = setTimeout(() => {
      const g = getGame(pin);
      if (!g) return;
      if (g.phase === 'question') {
        advance(g);
        broadcast(pin);
      }
      lockTimers.delete(pin);
    }, ms + 50);
    lockTimers.set(pin, t);
  }

  httpServer.listen(port, () => {
    console.log(`▶ broadcast ready on http://${hostname}:${port}`);
  });
});

function matchResultsCsv(url: string | undefined): string | null {
  if (!url) return null;
  const path = url.split('?')[0];
  const m = /^\/host\/([^/]+)\/results\.csv$/.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

function matchAnswersCsv(url: string | undefined): string | null {
  if (!url) return null;
  const path = url.split('?')[0];
  const m = /^\/host\/([^/]+)\/answers\.csv$/.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

function handleResultsCsv(pin: string, res: import('node:http').ServerResponse) {
  const game = getGame(pin);
  if (!game) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Game not found' }));
    return;
  }
  if (game.phase !== 'final') {
    res.statusCode = 409;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Game not finished' }));
    return;
  }
  const body = exportResultsCsv(game);
  const now = new Date();
  const utcDate =
    String(now.getUTCFullYear()) +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="broadcast-${pin}-${utcDate}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function handleAnswersCsv(pin: string, res: import('node:http').ServerResponse) {
  const game = getGame(pin);
  if (!game) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Game not found' }));
    return;
  }
  if (game.phase !== 'final') {
    res.statusCode = 409;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Game not finished' }));
    return;
  }
  const body = exportAnswersCsv(game);
  const now = new Date();
  const utcDate =
    String(now.getUTCFullYear()) +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="broadcast-${pin}-${utcDate}-answers.csv"`,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}
