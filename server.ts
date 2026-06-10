import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { decode as decodeAuthJwt } from '@auth/core/jwt';
import next from 'next';
import { Server, type Socket } from 'socket.io';
import { ensureAuthSecret } from './lib/auth-secret';
import { config as appConfig } from './lib/config';
import {
  type BroadcastReason,
  fanoutMetricsEnabled,
  nowMs,
  recordAnswerAck,
  recordBroadcast,
  recordTargetedPersonal,
  snapshotFanoutMetrics,
} from './lib/fanout-metrics';
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
  leaderboard,
  pauseForHostDisconnect,
  personalState,
  publicState,
  resumeFromPause,
  startGame,
  submitAnswer,
} from './lib/game';
import {
  type QAQuestionEntry,
  type QAState,
  addParticipant as qaAddParticipant,
  applyVote as qaApplyVote,
  approveQuestion as qaApproveQuestion,
  archiveQuestion as qaArchiveQuestion,
  assignLabel as qaAssignLabel,
  bindParticipantSocket as qaBindParticipantSocket,
  createLabel as qaCreateLabel,
  dismissQuestion as qaDismissQuestion,
  editQuestion as qaEditQuestion,
  highlightQuestion as qaHighlightQuestion,
  hostState as qaHostState,
  markAnswered as qaMarkAnswered,
  personalState as qaPersonalState,
  publicState as qaPublicState,
  questionVoteCounts as qaQuestionVoteCounts,
  removeVote as qaRemoveVote,
  resolveJoinIdentity as qaResolveJoinIdentity,
  restoreQuestion as qaRestoreQuestion,
  submitQuestion as qaSubmitQuestion,
  unassignLabel as qaUnassignLabel,
  withdrawQuestion as qaWithdrawQuestion,
} from './lib/qa';
import { loadOrCreateState as loadOrCreateQaState } from './lib/qa-hydrate';
import {
  DuplicateLabelError,
  addParticipant as qaRepoAddParticipant,
  addQuestion as qaRepoAddQuestion,
  assignLabel as qaRepoAssignLabel,
  createLabel as qaRepoCreateLabel,
  editQuestionText as qaRepoEditQuestionText,
  recordVote as qaRepoRecordVote,
  removeVote as qaRepoRemoveVote,
  setHighlightedQuestion as qaRepoSetHighlightedQuestion,
  setQuestionStatus as qaRepoSetQuestionStatus,
  setQuestionStatusWithModerationEvent as qaRepoSetQuestionStatusWithModerationEvent,
  unassignLabel as qaRepoUnassignLabel,
} from './lib/qa-repo';
import { matchUploadsPath, resolveUploadFilePath, uploadContentType } from './lib/serve-upload';
import type {
  AnswerIndex,
  QAHostState,
  QAPersonalState,
  QAPublicLabel,
  QAPublicState,
  QAQuestionScore,
  QAQuestionStatus,
  QAVoteType,
  Quiz,
} from './lib/types';
import {
  addPlayerToCloud,
  isValidTransition,
  normalizeWord,
  playerSubmissions,
  removeWord,
  setStatus as setCloudStatus,
  snapshotWords,
  submitWord,
  type WordCloudState,
  type WordCloudStateStatus,
} from './lib/wordcloud';
import { loadOrCreateState as loadOrCreateWcState } from './lib/wordcloud-hydrate';
import {
  addPlayer as repoAddPlayer,
  addSubmission as repoAddSubmission,
  getSessionByPin as repoGetSessionByPin,
  logModeration as repoLogModeration,
  markSubmissionRemoved as repoMarkRemoved,
  setStatus as repoSetStatus,
} from './lib/wordcloud-repo';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 4321);
const hostname = 'localhost';
const authSecret = ensureAuthSecret();

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
    if (qq.imageUrl != null && typeof qq.imageUrl !== 'string') {
      throw new Error(`Q${i}: imageUrl must be string`);
    }
  }
  return input as Quiz;
}

void app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    // Load-test instrumentation readout; only mounted when the operator
    // opted in via FANOUT_METRICS=1, and loopback-only even then so a flag
    // left on in production never exposes counters to the room.
    if (fanoutMetricsEnabled && req.url?.startsWith('/__fanout-metrics')) {
      const remote = req.socket.remoteAddress;
      if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
        res.statusCode = 403;
        res.end('forbidden');
        return;
      }
      const reset = req.url.includes('reset=1');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(snapshotFanoutMetrics(reset)));
      return;
    }
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
    // Serve uploaded media (question stills, etc.) straight from the configured
    // upload dir. Next.js only serves files that exist in `public/` when the
    // server boots, so runtime-written uploads 404 if we leave this to `handle`.
    const uploadRel = matchUploadsPath(req.url);
    if (uploadRel !== null && (req.method === 'GET' || req.method === 'HEAD')) {
      handleUploadFile(uploadRel, req, res);
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

  // Authenticate Socket.IO connections off the Next-Auth session cookie.
  // Sets socket.data.userId for handlers to authorize against. Unauthenticated
  // connections are still allowed (anonymous players) — handlers that require
  // an owner enforce that explicitly.
  const COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'];

  io.use(async (socket, next) => {
    try {
      if (!authSecret) {
        socket.data.userId = null;
        return next();
      }
      const cookieHeader = socket.handshake.headers.cookie ?? '';
      const cookies = parseRawCookieHeader(cookieHeader);
      let token: string | null = null;
      let salt = 'authjs.session-token';
      for (const cookieName of COOKIE_NAMES) {
        token = readCookieValue(cookies, cookieName);
        if (token) {
          salt = cookieName;
          break;
        }
      }
      if (!token) {
        socket.data.userId = null;
        return next();
      }
      const decoded = await decodeAuthJwt({
        token,
        secret: authSecret,
        salt,
      });
      const id = decoded && typeof decoded === 'object' ? (decoded as { id?: unknown }).id : null;
      socket.data.userId = typeof id === 'string' ? id : null;
      next();
    } catch (err) {
      console.warn('[socket auth] decode failed:', err);
      socket.data.userId = null;
      next();
    }
  });

  const lockTimers = new Map<string, NodeJS.Timeout>();
  const hostGraceTimers = new Map<string, NodeJS.Timeout>();
  const HOST_GRACE_MS = 60_000;

  const wordCloudStates = new Map<string, WordCloudState>();
  const wcSocketToPin = new Map<string, { pin: string; role: 'host' | 'player' }>();
  const wcLastSubmitAt = new Map<string, number>();
  const WC_RATE_LIMIT_MS = 800;

  const qaStates = new Map<string, QAState>();
  const qaSocketToPin = new Map<
    string,
    { pin: string; role: 'host' | 'display' | 'participant' }
  >();
  // Per-participant submit throttle (WC_RATE_LIMIT_MS pattern). Questions are
  // longer-form than word-cloud words, so the window is wider: a human typing
  // a real question never hits it, rapid-fire scripts do. Only accepted
  // submissions arm the window so a typo'd empty submit doesn't burn it.
  const qaLastSubmitAt = new Map<string, number>();
  const QA_SUBMIT_RATE_LIMIT_MS = 1_000;
  // Sanity cap on labels per submission (MID-340): a session never has more
  // than a handful of labels, so anything past this is a hostile payload.
  const QA_LABELS_PER_QUESTION_CAP = 20;

  // Vote-burst fanout guard (MID-336, PRD §9): nothing public changes per
  // vote except the affected questions' counts, so per-room dirty question
  // ids coalesce into one compact `qa:scores` delta per tick instead of a
  // full qa:state emit per vote. Clients patch scores and re-sort locally.
  const qaPendingScoreFlushes = new Map<string, NodeJS.Timeout>();
  const qaDirtyScores = new Map<string, Set<string>>();

  function isValidStatus(v: unknown): v is WordCloudStateStatus {
    return v === 'LOBBY' || v === 'LIVE' || v === 'PAUSED' || v === 'ENDED';
  }

  function wcSnapshot(state: WordCloudState) {
    return {
      pin: state.pin,
      prompt: state.prompt,
      wordsPerPlayer: state.wordsPerPlayer,
      profanityFilter: state.profanityFilter,
      status: state.status,
      joinerCount: state.players.size,
      words: snapshotWords(state),
    };
  }

  function rollbackSubmit(state: WordCloudState, playerId: string, normalized: string): void {
    const player = state.players.get(playerId);
    if (player) {
      player.submissions = player.submissions.filter((n) => n !== normalized);
    }
    const entry = state.words.get(normalized);
    if (entry) {
      entry.count -= 1;
      if (entry.count <= 0) state.words.delete(normalized);
    }
  }

  function parseRawCookieHeader(header: string): Record<string, string> {
    if (!header) return {};
    const out: Record<string, string> = {};
    for (const part of header.split(/;\s*/)) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const k = part.slice(0, eq).trim();
      const v = decodeURIComponent(part.slice(eq + 1).trim());
      if (k) out[k] = v;
    }
    return out;
  }

  function readCookieValue(cookies: Record<string, string>, name: string): string | null {
    const value = cookies[name];
    if (value) return value;

    const chunks: string[] = [];
    for (let i = 0; ; i++) {
      const chunk = cookies[`${name}.${i}`];
      if (!chunk) break;
      chunks.push(chunk);
    }
    return chunks.length > 0 ? chunks.join('') : null;
  }

  function wcEmitState(state: WordCloudState) {
    io.to(`wc:${state.pin}`).emit('wordcloud:state', wcSnapshot(state));
  }

  // Public projection only: the qa:${pin} room mixes host, displays, and
  // participants, so personal/private payloads must never go through here —
  // they are targeted at a single participant socket instead.
  function qaEmitPublicState(state: QAState) {
    // A full snapshot carries the latest scores, so it supersedes (and
    // cancels) any pending coalesced score delta for this room.
    const pending = qaPendingScoreFlushes.get(state.pin);
    if (pending) {
      clearTimeout(pending);
      qaPendingScoreFlushes.delete(state.pin);
    }
    qaDirtyScores.delete(state.pin);
    io.to(`qa:${state.pin}`).emit('qa:state', qaPublicState(state));
    // Anything that changes the public board also changes the host board.
    qaEmitHostState(state);
  }

  // Host control projection (MID-337): includes IN_REVIEW questions and
  // counts by state, so it is targeted at the host socket and never the
  // mixed qa:${pin} room.
  function qaEmitHostState(state: QAState) {
    if (!state.hostSocketId) return;
    io.to(state.hostSocketId).emit('qa:host:state', qaHostState(state));
  }

  // Personal projection push (MID-338): when a host moderation action changes
  // a participant's own question (approve/dismiss/restore), the owner's
  // currently-bound socket(s) get a fresh personal state. Targeted emits
  // only — personal state never goes through the mixed qa:${pin} room.
  function qaEmitPersonalState(state: QAState, participantId: string) {
    const personal = qaPersonalState(state, participantId);
    if (!personal) return;
    for (const [socketId, pid] of state.socketToParticipant.entries()) {
      if (pid === participantId) io.to(socketId).emit('qa:personal', personal);
    }
  }

  function qaFlushScores(pin: string) {
    const dirty = qaDirtyScores.get(pin);
    qaDirtyScores.delete(pin);
    const state = qaStates.get(pin);
    if (!state || !dirty || dirty.size === 0) return;
    const scores: QAQuestionScore[] = [];
    for (const questionId of dirty) {
      const question = state.questions.get(questionId);
      // Questions that left LIVE since the vote landed stay private.
      if (!question || question.status !== 'LIVE') continue;
      scores.push({ questionId, ...qaQuestionVoteCounts(question) });
    }
    if (scores.length === 0) return;
    io.to(`qa:${pin}`).emit('qa:scores', { pin, scores });
    recordBroadcast('other', io.sockets.adapter.rooms.get(`qa:${pin}`)?.size ?? 0, 0);
  }

  function qaScheduleScoreBroadcast(pin: string, questionId: string) {
    let dirty = qaDirtyScores.get(pin);
    if (!dirty) {
      dirty = new Set();
      qaDirtyScores.set(pin, dirty);
    }
    dirty.add(questionId);
    if (qaPendingScoreFlushes.has(pin)) return;
    const t = setTimeout(() => {
      qaPendingScoreFlushes.delete(pin);
      qaFlushScores(pin);
    }, BROADCAST_COALESCE_MS);
    qaPendingScoreFlushes.set(pin, t);
  }

  // F2: a socket is authorized as host iff (a) it owns the host slot for this
  // state AND (b) the authenticated user matches state.hostUserId, OR the
  // session is anonymous (state.hostUserId === null) and any socket bound as
  // host can drive it. Trusting hostSocketId alone is insufficient because
  // sockets reconnect freely and another socket could race to claim the slot.
  // Structural param so word cloud and Q&A states share the same gate.
  function isHostAuthorized(
    socket: Socket,
    state: { hostUserId: string | null; hostSocketId?: string },
  ): boolean {
    const userId = (socket.data as { userId?: string | null }).userId ?? null;
    if (state.hostUserId === null) {
      return state.hostSocketId === socket.id;
    }
    return userId !== null && userId === state.hostUserId;
  }

  // Answer bursts must not trigger a full room broadcast per answer: at N
  // players that is N state emits × N answers plus N personal recomputes per
  // answer (~O(N²) deliveries, ~29k at 120 players), which backs up the event
  // loop and delays the acks/personal confirmations late answerers are
  // waiting on. Nothing public changes per answer mid-question except
  // creeping standings scores, so those broadcasts coalesce into one tick.
  const pendingBroadcasts = new Map<string, NodeJS.Timeout>();
  const BROADCAST_COALESCE_MS = 250;

  function broadcast(pin: string, reason: BroadcastReason = 'other') {
    const pending = pendingBroadcasts.get(pin);
    if (pending) {
      clearTimeout(pending);
      pendingBroadcasts.delete(pin);
    }
    const game = getGame(pin);
    if (!game) return;
    const state = publicState(game);
    // Personal goes out before the room state: per-socket delivery is ordered,
    // so each player sees a phase flip only after their own fresh personal
    // (reveal SFX/banners read personal at the moment state changes phase).
    const board = leaderboard(game);
    for (const [socketId, playerId] of game.socketToPlayer.entries()) {
      io.to(socketId).emit('personal', personalState(game, playerId, board));
    }
    io.to(`pin:${pin}`).emit('state', state);
    recordBroadcast(
      reason,
      io.sockets.adapter.rooms.get(`pin:${pin}`)?.size ?? 0,
      game.socketToPlayer.size,
    );
  }

  function scheduleBroadcast(pin: string, reason: BroadcastReason) {
    if (pendingBroadcasts.has(pin)) return;
    const t = setTimeout(() => {
      pendingBroadcasts.delete(pin);
      broadcast(pin, reason);
    }, BROADCAST_COALESCE_MS);
    pendingBroadcasts.set(pin, t);
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
        broadcast(game.pin, 'membership');
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
      broadcast(pin, 'membership');
    });

    socket.on('host:start', (pin: string) => {
      const game = getGame(pin);
      if (!game || game.hostSocketId !== socket.id) return;
      startGame(game);
      broadcast(pin, 'phase');
      if (game.phase === 'question') {
        scheduleAutoLock(pin);
      }
    });

    socket.on('host:advance', (pin: string) => {
      const game = getGame(pin);
      if (!game || game.hostSocketId !== socket.id) return;
      const phase = advance(game);
      broadcast(pin, 'phase');
      if (phase === 'question') {
        scheduleAutoLock(pin);
      }
    });

    socket.on('host:kick', (pin: string, playerId: string) => {
      const game = getGame(pin);
      if (!game || game.hostSocketId !== socket.id) return;
      kickPlayer(pin, playerId);
      broadcast(pin, 'membership');
    });

    socket.on('display:attach', (pin: string) => {
      const game = attachDisplay(pin, socket.id);
      if (!game) return;
      socket.join(`pin:${pin}`);
      broadcast(pin, 'membership');
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
      broadcast(pin, 'membership');
    });

    socket.on('player:answer', (pin: unknown, optionIndex: unknown, ack: unknown) => {
      const handlerStart = nowMs();
      if (typeof ack !== 'function') {
        console.warn('[player:answer] missing ack — ignoring');
        return;
      }
      const rawCb = ack as (res: {
        ok: boolean;
        error?: string;
        reason?: 'paused' | 'expired' | 'invalid-pin' | 'invalid-answer';
      }) => void;
      const cb: typeof rawCb = (res) => {
        recordAnswerAck(nowMs() - handlerStart, res.ok ? undefined : (res.reason ?? 'error'));
        rawCb(res);
      };
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
        if (r.reason === 'expired') broadcast(pin, 'phase');
        return;
      }
      cb({ ok: true });
      if (game.phase === 'question') {
        // The answering player gets their confirmation immediately; everyone
        // else can wait for the coalesced tick.
        const personal = personalState(game, playerId);
        if (personal) {
          socket.emit('personal', personal);
          recordTargetedPersonal();
        }
        scheduleBroadcast(pin, 'answer');
      } else {
        // Last answer locked the question: the immediate broadcast already
        // delivers this player's personal ahead of the phase-flip state.
        broadcast(pin, 'phase');
      }
    });

    socket.on('wordcloud:host:create', async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        console.warn('[wordcloud:host:create] missing ack — ignoring');
        return;
      }
      const cb = ack as (res: { pin: string; sessionId: string } | { error: string }) => void;
      if (!payload || typeof payload !== 'object') {
        cb({ error: 'invalid' });
        return;
      }
      const p = payload as Record<string, unknown>;
      const userId = (socket.data as { userId?: string | null }).userId ?? null;

      // API-allocated path is the only path we now support: the HTTP route at
      // /api/wordcloud/route.ts is the single source of truth for PIN
      // allocation, ownership, and persistence (F6 fail-closed: no socket
      // fallback that runs an in-memory session detached from Prisma).
      const providedPin = typeof p.pin === 'string' && /^\d{6}$/.test(p.pin) ? p.pin : null;
      const providedSessionId =
        typeof p.sessionId === 'string' && p.sessionId.length > 0 ? p.sessionId : null;
      if (!providedPin || !providedSessionId) {
        cb({ error: 'missing_session' });
        return;
      }

      let session: Awaited<ReturnType<typeof repoGetSessionByPin>>;
      try {
        session = await repoGetSessionByPin(providedPin);
      } catch (err) {
        console.error('[wordcloud-repo] getSessionByPin', err);
        cb({ error: 'persistence_failed' });
        return;
      }
      if (!session || session.id !== providedSessionId) {
        cb({ error: 'session_mismatch' });
        return;
      }
      // Anonymous sessions (hostUserId === null) can be bound by any socket —
      // these come from the smoke harness and the legacy anonymous host flow.
      // Owned sessions require the authenticated user to match the host.
      if (session.hostUserId !== null && session.hostUserId !== userId) {
        cb({ error: 'forbidden' });
        return;
      }

      let state = wordCloudStates.get(providedPin);
      if (!state) {
        const hydrated = await loadOrCreateWcState(wordCloudStates, providedPin);
        if (!hydrated) {
          cb({ error: 'session_mismatch' });
          return;
        }
        state = hydrated;
      }
      state.hostSocketId = socket.id;
      state.hostUserId = session.hostUserId;
      wcSocketToPin.set(socket.id, { pin: providedPin, role: 'host' });
      socket.join(`wc:${providedPin}`);
      cb({ pin: providedPin, sessionId: providedSessionId });
      wcEmitState(state);
    });

    socket.on('wordcloud:player:join', async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        console.warn('[wordcloud:player:join] missing ack — ignoring');
        return;
      }
      const cb = ack as (
        res:
          | {
              playerId: string;
              prompt: string;
              wordsPerPlayer: number;
              status: WordCloudStateStatus;
              mySubmissions: { normalized: string; display: string }[];
              words: { normalized: string; display: string; count: number }[];
            }
          | { error: string },
      ) => void;
      if (!payload || typeof payload !== 'object') {
        cb({ error: 'invalid' });
        return;
      }
      const p = payload as Record<string, unknown>;
      if (!isPin(p.pin)) {
        cb({ error: 'invalid_pin' });
        return;
      }
      if (!isNickname(p.nickname)) {
        cb({ error: 'invalid_nickname' });
        return;
      }
      let state: WordCloudState | null;
      try {
        state = await loadOrCreateWcState(wordCloudStates, p.pin);
      } catch (err) {
        console.error('[wordcloud-repo] loadOrCreateState (join)', err);
        cb({ error: 'persistence_failed' });
        return;
      }
      if (!state) {
        cb({ error: 'not_found' });
        return;
      }

      // Reconnect path: if the client kept a playerId from a prior socket
      // (page refresh, mobile sleep) and it still exists in memory under the
      // same nickname, rebind the socket and return current state. Word cloud
      // has no disconnect grace per PRD — submissions stick until session end.
      const providedPlayerId = typeof p.playerId === 'string' ? p.playerId : null;
      const trimmedNick = p.nickname.trim();
      if (providedPlayerId) {
        const existing = state.players.get(providedPlayerId);
        if (existing && existing.nickname.toLowerCase() === trimmedNick.toLowerCase()) {
          for (const [socketId, pid] of state.socketToPlayer.entries()) {
            if (pid === providedPlayerId) state.socketToPlayer.delete(socketId);
          }
          state.socketToPlayer.set(socket.id, providedPlayerId);
          wcSocketToPin.set(socket.id, { pin: state.pin, role: 'player' });
          socket.join(`wc:${state.pin}`);
          cb({
            playerId: providedPlayerId,
            prompt: state.prompt,
            wordsPerPlayer: state.wordsPerPlayer,
            status: state.status,
            mySubmissions: playerSubmissions(state, providedPlayerId),
            words: snapshotWords(state),
          });
          wcEmitState(state);
          return;
        }
      }

      const result = addPlayerToCloud(state, { nickname: trimmedNick });
      if (result.error || !result.playerId) {
        cb({ error: result.error ?? 'unknown' });
        return;
      }
      const playerId = result.playerId;

      // F6: await persistence before binding the in-memory socket so we
      // never accept a player whose row failed to write.
      try {
        const row = await repoAddPlayer({ sessionId: state.sessionId, nickname: trimmedNick });
        const entry = state.players.get(playerId);
        if (entry) entry.dbPlayerId = row.id;
      } catch (err) {
        console.error('[wordcloud-repo] addPlayer', err);
        state.players.delete(playerId);
        cb({ error: 'persistence_failed' });
        return;
      }

      state.socketToPlayer.set(socket.id, playerId);
      wcSocketToPin.set(socket.id, { pin: state.pin, role: 'player' });
      socket.join(`wc:${state.pin}`);
      cb({
        playerId,
        prompt: state.prompt,
        wordsPerPlayer: state.wordsPerPlayer,
        status: state.status,
        mySubmissions: playerSubmissions(state, playerId),
        words: snapshotWords(state),
      });
      wcEmitState(state);
    });

    socket.on('wordcloud:player:submit', async (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const p = payload as Record<string, unknown>;
      if (!isPin(p.pin)) return;
      if (typeof p.playerId !== 'string') return;
      if (typeof p.word !== 'string') return;
      const state = wordCloudStates.get(p.pin);
      if (!state) {
        socket.emit('wordcloud:player:rejected', { reason: 'session_not_live' });
        return;
      }
      const ownPlayerId = state.socketToPlayer.get(socket.id);
      if (!ownPlayerId || ownPlayerId !== p.playerId) {
        socket.emit('wordcloud:player:rejected', { reason: 'unknown_player' });
        return;
      }

      const now = Date.now();
      const last = wcLastSubmitAt.get(p.playerId) ?? 0;
      if (now - last < WC_RATE_LIMIT_MS) {
        socket.emit('wordcloud:player:rejected', { reason: 'rate_limited' });
        return;
      }
      wcLastSubmitAt.set(p.playerId, now);

      const result = submitWord(state, { playerId: p.playerId, word: p.word });
      if (!result.accepted) {
        socket.emit('wordcloud:player:rejected', {
          reason: result.reason,
          normalized: result.normalized,
        });
        return;
      }

      const normalized = result.normalized as string;
      const display = result.display as string;
      const count = result.count as number;

      // F5+F6: persist BEFORE broadcasting so a failed write rolls back the
      // in-memory state and the live cloud stays consistent with Prisma. If
      // the host already trashed this normalized word (race window), persist
      // with removed=true so CSV reflects moderation correctly.
      const norm = normalizeWord(p.word);
      const player = state.players.get(p.playerId);
      const dbPlayerId = player?.dbPlayerId ?? null;
      if (norm && dbPlayerId) {
        const wasTrashed = state.trashedNormalized.has(normalized);
        try {
          await repoAddSubmission({
            sessionId: state.sessionId,
            playerId: dbPlayerId,
            rawText: norm.display,
            normalized: norm.normalized,
            removed: wasTrashed,
          });
        } catch (err) {
          console.error('[wordcloud-repo] addSubmission', err);
          rollbackSubmit(state, p.playerId, normalized);
          socket.emit('wordcloud:player:rejected', { reason: 'persistence_failed' });
          return;
        }
        if (wasTrashed) {
          // Race lost: roll the in-memory accept back so the trashed word
          // doesn't surface to the live cloud.
          rollbackSubmit(state, p.playerId, normalized);
          socket.emit('wordcloud:player:rejected', { reason: 'session_not_live' });
          return;
        }
      }

      io.to(`wc:${state.pin}`).emit('wordcloud:word:added', {
        normalized,
        display,
        count,
      });
      socket.emit('wordcloud:player:my-submissions', {
        submissions: playerSubmissions(state, p.playerId),
      });
    });

    socket.on('wordcloud:host:remove', (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const p = payload as Record<string, unknown>;
      if (!isPin(p.pin)) return;
      if (typeof p.normalized !== 'string') return;
      const state = wordCloudStates.get(p.pin);
      if (!state) return;
      if (!isHostAuthorized(socket, state)) {
        socket.emit('wordcloud:player:rejected', { reason: 'forbidden' });
        return;
      }
      // F5: record the trash decision BEFORE the persist so a concurrent
      // submit for the same normalized lands as removed=true.
      state.trashedNormalized.add(p.normalized);
      const result = removeWord(state, { normalized: p.normalized });
      if (!result.removed) return;
      io.to(`wc:${state.pin}`).emit('wordcloud:word:removed', { normalized: p.normalized });

      repoMarkRemoved({
        sessionId: state.sessionId,
        normalized: p.normalized,
        hostUserId: state.hostUserId,
      }).catch((err) => console.error('[wordcloud-repo] markSubmissionRemoved', err));
      repoLogModeration({
        sessionId: state.sessionId,
        hostUserId: state.hostUserId,
        word: p.normalized,
        reason: 'trash',
      }).catch((err) => console.error('[wordcloud-repo] logModeration', err));
    });

    socket.on('wordcloud:display:attach', async (payload: unknown) => {
      const pin = typeof payload === 'string' ? payload : null;
      if (!pin || !isPin(pin)) return;
      let state: WordCloudState | null;
      try {
        state = await loadOrCreateWcState(wordCloudStates, pin);
      } catch (err) {
        console.error('[wordcloud-repo] loadOrCreateState (display)', err);
        return;
      }
      if (!state) return;
      socket.join(`wc:${pin}`);
      socket.emit('wordcloud:state', wcSnapshot(state));
    });

    socket.on('wordcloud:host:set-status', (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const p = payload as Record<string, unknown>;
      if (!isPin(p.pin)) return;
      if (!isValidStatus(p.status)) return;
      const state = wordCloudStates.get(p.pin);
      if (!state) return;
      if (!isHostAuthorized(socket, state)) {
        socket.emit('wordcloud:player:rejected', { reason: 'forbidden' });
        return;
      }
      if (!isValidTransition(state.status, p.status)) {
        socket.emit('wordcloud:player:rejected', {
          reason: 'invalid_transition',
          from: state.status,
          to: p.status,
        });
        return;
      }
      const transition = setCloudStatus(state, p.status);
      if (!transition.ok) return;
      io.to(`wc:${state.pin}`).emit('wordcloud:status:changed', { status: p.status });
      wcEmitState(state);

      repoSetStatus({ sessionId: state.sessionId, status: p.status }).catch((err) =>
        console.error('[wordcloud-repo] setStatus', err),
      );
    });

    // Q&A socket foundation (MID-334): room lifecycle, host/display attach,
    // participant join with privacy modes, reconnect-safe identity. Attach
    // handlers are idempotent so an HMR/dev reconnect (new socket id, see
    // docs/2026-06-05-socket-hmr-broadcast-bug.md) can simply re-emit attach
    // and land back in qa:${pin} with fresh state.
    socket.on('qa:host:attach', async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        console.warn('[qa:host:attach] missing ack — ignoring');
        return;
      }
      const cb = ack as (
        res:
          | { pin: string; sessionId: string; state: QAPublicState; hostState: QAHostState }
          | { error: string },
      ) => void;
      if (!payload || typeof payload !== 'object') {
        cb({ error: 'invalid' });
        return;
      }
      const p = payload as Record<string, unknown>;
      if (!isPin(p.pin)) {
        cb({ error: 'invalid_pin' });
        return;
      }
      if (typeof p.sessionId !== 'string' || p.sessionId.length === 0) {
        cb({ error: 'missing_session' });
        return;
      }
      let state: QAState | null;
      try {
        state = await loadOrCreateQaState(qaStates, p.pin);
      } catch (err) {
        console.error('[qa-repo] loadOrCreateState (host attach)', err);
        cb({ error: 'persistence_failed' });
        return;
      }
      if (!state) {
        cb({ error: 'not_found' });
        return;
      }
      if (state.sessionId !== p.sessionId) {
        cb({ error: 'session_mismatch' });
        return;
      }
      // Anonymous sessions (hostUserId === null) can be bound by any socket —
      // smoke harness and dev flows. Owned sessions require the authenticated
      // user to match the host.
      const userId = (socket.data as { userId?: string | null }).userId ?? null;
      if (state.hostUserId !== null && state.hostUserId !== userId) {
        cb({ error: 'forbidden' });
        return;
      }
      state.hostSocketId = socket.id;
      qaSocketToPin.set(socket.id, { pin: state.pin, role: 'host' });
      socket.join(`qa:${state.pin}`);
      cb({
        pin: state.pin,
        sessionId: state.sessionId,
        state: qaPublicState(state),
        hostState: qaHostState(state),
      });
    });

    socket.on('qa:display:attach', async (payload: unknown, ack: unknown) => {
      const cb =
        typeof ack === 'function'
          ? (ack as (res: { state: QAPublicState } | { error: string }) => void)
          : undefined;
      const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      if (!isPin(p.pin)) {
        cb?.({ error: 'invalid_pin' });
        return;
      }
      let state: QAState | null;
      try {
        state = await loadOrCreateQaState(qaStates, p.pin);
      } catch (err) {
        console.error('[qa-repo] loadOrCreateState (display attach)', err);
        cb?.({ error: 'persistence_failed' });
        return;
      }
      if (!state) {
        cb?.({ error: 'not_found' });
        return;
      }
      state.displaySocketIds.add(socket.id);
      qaSocketToPin.set(socket.id, { pin: state.pin, role: 'display' });
      socket.join(`qa:${state.pin}`);
      // Displays are public and get the public projection only.
      const publicSnapshot = qaPublicState(state);
      socket.emit('qa:state', publicSnapshot);
      cb?.({ state: publicSnapshot });
    });

    socket.on('qa:participant:join', async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        console.warn('[qa:participant:join] missing ack — ignoring');
        return;
      }
      const cb = ack as (
        res:
          | {
              participantId: string;
              reconnected: boolean;
              state: QAPublicState;
              personal: QAPersonalState;
            }
          | { error: string },
      ) => void;
      if (!payload || typeof payload !== 'object') {
        cb({ error: 'invalid' });
        return;
      }
      const p = payload as Record<string, unknown>;
      if (!isPin(p.pin)) {
        cb({ error: 'invalid_pin' });
        return;
      }
      let state: QAState | null;
      try {
        state = await loadOrCreateQaState(qaStates, p.pin);
      } catch (err) {
        console.error('[qa-repo] loadOrCreateState (participant join)', err);
        cb({ error: 'persistence_failed' });
        return;
      }
      if (!state) {
        cb({ error: 'not_found' });
        return;
      }

      // Reconnect path: a stored participantId from a prior socket (page
      // refresh, mobile sleep, HMR) rebinds the new socket without creating a
      // duplicate QAParticipant. Allowed even after the session ended so a
      // returning participant can still view the final state.
      const providedParticipantId = typeof p.participantId === 'string' ? p.participantId : null;
      if (providedParticipantId && state.participants.has(providedParticipantId)) {
        qaBindParticipantSocket(state, socket.id, providedParticipantId);
        qaSocketToPin.set(socket.id, { pin: state.pin, role: 'participant' });
        socket.join(`qa:${state.pin}`);
        const personal = qaPersonalState(state, providedParticipantId);
        if (!personal) {
          cb({ error: 'unknown_participant' });
          return;
        }
        // Personal state goes to the joining socket only — never the room.
        cb({
          participantId: providedParticipantId,
          reconnected: true,
          state: qaPublicState(state),
          personal,
        });
        return;
      }

      const displayName = typeof p.displayName === 'string' ? p.displayName : null;
      const identity = qaResolveJoinIdentity(state, displayName);
      if (!identity.ok) {
        cb({ error: identity.reason });
        return;
      }

      // Persist BEFORE accepting so we never bind a participant whose row
      // failed to write; the in-memory entry is keyed by the DB id so
      // ownership and votes line up across restarts.
      let participantId: string;
      try {
        const row = await qaRepoAddParticipant({
          sessionId: state.sessionId,
          displayName: identity.displayName,
        });
        participantId = row.id;
      } catch (err) {
        console.error('[qa-repo] addParticipant', err);
        cb({ error: 'persistence_failed' });
        return;
      }
      const added = qaAddParticipant(state, {
        displayName: identity.displayName,
        participantId,
      });
      if (!added.ok) {
        cb({ error: added.reason });
        return;
      }
      qaBindParticipantSocket(state, socket.id, participantId);
      qaSocketToPin.set(socket.id, { pin: state.pin, role: 'participant' });
      socket.join(`qa:${state.pin}`);
      const personal = qaPersonalState(state, participantId);
      if (!personal) {
        cb({ error: 'unknown_participant' });
        return;
      }
      cb({
        participantId,
        reconnected: false,
        state: qaPublicState(state),
        personal,
      });
      // participantCount changed: refresh the room's public projection.
      qaEmitPublicState(state);
    });

    // Shared preamble for participant question actions (MID-335): the acting
    // socket must already be bound to a participant in this room via
    // qa:participant:join, so no hydration is needed — if the state isn't in
    // memory the participant can't be bound to it either.
    function qaResolveParticipantAction(
      payload: unknown,
    ): { state: QAState; participantId: string; p: Record<string, unknown> } | { error: string } {
      if (!payload || typeof payload !== 'object') return { error: 'invalid' };
      const p = payload as Record<string, unknown>;
      if (!isPin(p.pin)) return { error: 'invalid_pin' };
      const state = qaStates.get(p.pin);
      if (!state) return { error: 'not_found' };
      const participantId = state.socketToParticipant.get(socket.id);
      if (!participantId) return { error: 'unknown_participant' };
      return { state, participantId, p };
    }

    // Ack shape for submit/withdraw/edit. `personal` rides in the ack so it
    // only ever reaches the acting participant's socket — never the room.
    type QaActionAck =
      | { questionId: string; status: string; personal: QAPersonalState }
      | { error: string };

    socket.on('qa:participant:submit', async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        console.warn('[qa:participant:submit] missing ack — ignoring');
        return;
      }
      const cb = ack as (res: QaActionAck) => void;
      const resolved = qaResolveParticipantAction(payload);
      if ('error' in resolved) {
        cb(resolved);
        return;
      }
      const { state, participantId, p } = resolved;
      if (typeof p.text !== 'string') {
        cb({ error: 'invalid' });
        return;
      }
      // Optional participant-selected labels (MID-340). Shape-validated here;
      // lib/qa.ts enforces that each id exists and is participant-selectable.
      let labelIds: string[] | undefined;
      if (p.labelIds !== undefined) {
        if (
          !Array.isArray(p.labelIds) ||
          p.labelIds.length > QA_LABELS_PER_QUESTION_CAP ||
          !p.labelIds.every((id) => typeof id === 'string' && id.length > 0)
        ) {
          cb({ error: 'invalid' });
          return;
        }
        labelIds = p.labelIds as string[];
      }
      const now = Date.now();
      const last = qaLastSubmitAt.get(participantId) ?? 0;
      if (now - last < QA_SUBMIT_RATE_LIMIT_MS) {
        cb({ error: 'rate_limited' });
        return;
      }

      // In-memory accept first (validates submissions-open, text, privacy),
      // then persist BEFORE broadcasting — wordcloud:player:submit pattern.
      const result = qaSubmitQuestion(state, {
        participantId,
        text: p.text,
        isAnonymous: typeof p.isAnonymous === 'boolean' ? p.isAnonymous : undefined,
        labelIds,
      });
      if (!result.ok) {
        cb({ error: result.reason });
        return;
      }
      qaLastSubmitAt.set(participantId, now);
      const question = result.question;
      try {
        const row = await qaRepoAddQuestion({
          sessionId: state.sessionId,
          participantId,
          text: question.text,
          isAnonymous: question.isAnonymous,
          authorDisplayName: question.authorDisplayName,
          status: question.status === 'IN_REVIEW' ? 'IN_REVIEW' : 'LIVE',
          labelIds: [...question.labelIds],
        });
        // Re-key the in-memory entry to the DB id so ownership, votes, and
        // personal projections line up across restarts (lib/qa-hydrate.ts
        // keys everything by DB ids).
        state.questions.delete(question.id);
        question.id = row.id;
        state.questions.set(row.id, question);
      } catch (err) {
        console.error('[qa-repo] addQuestion', err);
        state.questions.delete(question.id);
        cb({ error: 'persistence_failed' });
        return;
      }
      const personal = qaPersonalState(state, participantId);
      if (!personal) {
        cb({ error: 'unknown_participant' });
        return;
      }
      cb({ questionId: question.id, status: question.status, personal });
      // Moderated submissions are IN_REVIEW: nothing public changed, so the
      // room gets no broadcast and the question stays invisible to displays.
      // The host board still updates — targeted at the host socket only.
      if (question.status === 'LIVE') qaEmitPublicState(state);
      else qaEmitHostState(state);
    });

    socket.on('qa:participant:withdraw', async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        console.warn('[qa:participant:withdraw] missing ack — ignoring');
        return;
      }
      const cb = ack as (res: QaActionAck) => void;
      const resolved = qaResolveParticipantAction(payload);
      if ('error' in resolved) {
        cb(resolved);
        return;
      }
      const { state, participantId, p } = resolved;
      if (typeof p.questionId !== 'string') {
        cb({ error: 'invalid' });
        return;
      }
      const prevHighlight = state.highlightedQuestionId;
      const result = qaWithdrawQuestion(state, { questionId: p.questionId, participantId });
      if (!result.ok) {
        cb({ error: result.reason });
        return;
      }
      const question = state.questions.get(p.questionId);
      try {
        await qaRepoSetQuestionStatus({ questionId: p.questionId, status: 'WITHDRAWN' });
      } catch (err) {
        console.error('[qa-repo] setQuestionStatus (withdraw)', err);
        if (question) {
          question.status = result.from;
          question.withdrawnAt = null;
        }
        state.highlightedQuestionId = prevHighlight;
        cb({ error: 'persistence_failed' });
        return;
      }
      // If the withdrawn question was highlighted, the in-memory transition
      // already cleared it and the repo write cleared the persisted pointer
      // in the same transaction (lib/qa-repo.ts applyQuestionStatus).
      const personal = qaPersonalState(state, participantId);
      if (!personal) {
        cb({ error: 'unknown_participant' });
        return;
      }
      cb({ questionId: p.questionId, status: 'WITHDRAWN', personal });
      // Only a withdrawal out of LIVE changes the public board; one out of
      // IN_REVIEW still changes the host board (review count, search pool).
      if (result.from === 'LIVE') qaEmitPublicState(state);
      else if (result.from === 'IN_REVIEW') qaEmitHostState(state);
    });

    // Participant edit window (PRD §4.5): allowed while the question is
    // IN_REVIEW or LIVE — no wall-clock cap in v1. Editing a LIVE question
    // returns it to review when moderation is enabled (enforced in lib/qa.ts).
    socket.on('qa:participant:edit', async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        console.warn('[qa:participant:edit] missing ack — ignoring');
        return;
      }
      const cb = ack as (res: QaActionAck) => void;
      const resolved = qaResolveParticipantAction(payload);
      if ('error' in resolved) {
        cb(resolved);
        return;
      }
      const { state, participantId, p } = resolved;
      if (typeof p.questionId !== 'string' || typeof p.text !== 'string') {
        cb({ error: 'invalid' });
        return;
      }
      const question = state.questions.get(p.questionId);
      const snapshot = question
        ? {
            text: question.text,
            originalText: question.originalText,
            status: question.status,
            highlightedQuestionId: state.highlightedQuestionId,
          }
        : null;
      const result = qaEditQuestion(state, {
        questionId: p.questionId,
        text: p.text,
        editor: { role: 'participant', participantId },
      });
      if (!result.ok) {
        cb({ error: result.reason });
        return;
      }
      const edited = result.question;
      const statusChanged = snapshot !== null && snapshot.status !== edited.status;
      try {
        await qaRepoEditQuestionText({ questionId: edited.id, text: edited.text });
        if (statusChanged) {
          await qaRepoSetQuestionStatus({ questionId: edited.id, status: edited.status });
        }
      } catch (err) {
        console.error('[qa-repo] editQuestion (participant)', err);
        // Full in-memory rollback. If the text write landed but the status
        // write failed, the DB keeps the new text — hydration would surface
        // it, which is benign next to lying to the participant about status.
        if (snapshot) {
          edited.text = snapshot.text;
          edited.originalText = snapshot.originalText;
          edited.status = snapshot.status;
          state.highlightedQuestionId = snapshot.highlightedQuestionId;
        }
        cb({ error: 'persistence_failed' });
        return;
      }
      const personal = qaPersonalState(state, participantId);
      if (!personal) {
        cb({ error: 'unknown_participant' });
        return;
      }
      cb({ questionId: edited.id, status: edited.status, personal });
      // Public board changed if the question was LIVE before the edit
      // (text update, or moderated edit pulling it back to review). An
      // IN_REVIEW-only edit still refreshes the host board text.
      if (snapshot?.status === 'LIVE' || edited.status === 'LIVE') qaEmitPublicState(state);
      else qaEmitHostState(state);
    });

    // Participant voting (MID-336). One vote per participant per question is
    // enforced twice: the in-memory votes map keys on participantId, and the
    // DB has @@unique([questionId, participantId]) behind an upsert — so a
    // reconnect or second tab collapsing onto the same participantId can
    // never double-count. `type: null` removes the vote. The ack carries the
    // server-derived counts for the voter only; the room gets a coalesced
    // qa:scores delta, never a per-vote full-state emit.
    socket.on('qa:participant:vote', async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        console.warn('[qa:participant:vote] missing ack — ignoring');
        return;
      }
      type QaVoteAck =
        | {
            questionId: string;
            vote: QAVoteType | null;
            score: number;
            upvotes: number;
            downvotes: number;
          }
        | { error: string };
      const cb = ack as (res: QaVoteAck) => void;
      const resolved = qaResolveParticipantAction(payload);
      if ('error' in resolved) {
        cb(resolved);
        return;
      }
      const { state, participantId, p } = resolved;
      if (typeof p.questionId !== 'string') {
        cb({ error: 'invalid' });
        return;
      }
      const type =
        p.type === 'UP' || p.type === 'DOWN' ? p.type : p.type === null ? null : undefined;
      if (type === undefined) {
        cb({ error: 'invalid' });
        return;
      }
      const question = state.questions.get(p.questionId);
      const prevVote = question?.votes.get(participantId) ?? null;

      if (type === null) {
        const result = qaRemoveVote(state, { questionId: p.questionId, participantId });
        if (!result.ok) {
          cb({ error: result.reason });
          return;
        }
        // Persist BEFORE acking/broadcasting; roll the in-memory vote back if
        // the delete fails so memory and DB never disagree.
        if (result.removed) {
          try {
            await qaRepoRemoveVote({ questionId: p.questionId, participantId });
          } catch (err) {
            console.error('[qa-repo] removeVote', err);
            if (question && prevVote) question.votes.set(participantId, prevVote);
            cb({ error: 'persistence_failed' });
            return;
          }
        }
        cb({
          questionId: p.questionId,
          vote: null,
          score: result.score,
          upvotes: result.upvotes,
          downvotes: result.downvotes,
        });
        if (result.removed && question?.status === 'LIVE') {
          qaScheduleScoreBroadcast(state.pin, p.questionId);
        }
        return;
      }

      const result = qaApplyVote(state, { questionId: p.questionId, participantId, type });
      if (!result.ok) {
        cb({ error: result.reason });
        return;
      }
      // Idempotent repeat (same vote again, e.g. a second tab): nothing
      // changed, so skip the DB write and the room delta.
      if (prevVote !== type) {
        try {
          await qaRepoRecordVote({ questionId: p.questionId, participantId, type });
        } catch (err) {
          console.error('[qa-repo] recordVote', err);
          if (question) {
            if (prevVote) question.votes.set(participantId, prevVote);
            else question.votes.delete(participantId);
          }
          cb({ error: 'persistence_failed' });
          return;
        }
      }
      cb({
        questionId: p.questionId,
        vote: type,
        score: result.score,
        upvotes: result.upvotes,
        downvotes: result.downvotes,
      });
      if (prevVote !== type) qaScheduleScoreBroadcast(state.pin, p.questionId);
    });

    // --- Q&A host moderation queue (MID-338) ---

    // Shared preamble for host moderation actions: the state must already be
    // in memory (the host attached to get a control surface), and the acting
    // socket must pass the same host gate as word cloud host actions. On top
    // of that ownership gate, moderation requires the acting socket to BE the
    // attached host control socket for this pin — a participant/display
    // socket from the same logged-in host user must not be able to moderate.
    function qaResolveHostAction(
      payload: unknown,
    ): { state: QAState; p: Record<string, unknown> } | { error: string } {
      if (!payload || typeof payload !== 'object') return { error: 'invalid' };
      const p = payload as Record<string, unknown>;
      if (!isPin(p.pin)) return { error: 'invalid_pin' };
      const state = qaStates.get(p.pin);
      if (!state) return { error: 'not_found' };
      if (!isHostAuthorized(socket, state)) return { error: 'forbidden' };
      const link = qaSocketToPin.get(socket.id);
      if (state.hostSocketId !== socket.id || link?.role !== 'host' || link.pin !== state.pin) {
        return { error: 'forbidden' };
      }
      return { state, p };
    }

    // Single id or bulk (`questionIds`) — both normalize to a list. Bulk is
    // capped to keep one event from holding the loop on a huge board.
    const QA_BULK_MODERATION_CAP = 100;
    function qaParseQuestionIds(p: Record<string, unknown>): string[] | null {
      if (typeof p.questionId === 'string' && p.questionId.length > 0) return [p.questionId];
      if (
        Array.isArray(p.questionIds) &&
        p.questionIds.length > 0 &&
        p.questionIds.length <= QA_BULK_MODERATION_CAP &&
        p.questionIds.every((id) => typeof id === 'string' && id.length > 0)
      ) {
        return [...new Set(p.questionIds as string[])];
      }
      return null;
    }

    type QaModerationOutcome = {
      transitioned: { questionId: string; from: QAQuestionStatus; to: QAQuestionStatus }[];
      failed: { questionId: string; error: string }[];
    };

    // Applies one host status action across a list of questions with the
    // persist-before-broadcast contract per question: in-memory transition,
    // then ONE transactional DB write covering the status change AND its
    // QAModerationEvent so the export/audit trail can always explain why a
    // question disappeared (PRD §4.3). If the transaction fails, the
    // in-memory transition rolls back and the id reports persistence_failed.
    // Bulk is per-question best-effort: one bad id never blocks the rest.
    async function qaModerateQuestions(
      state: QAState,
      action: 'approve' | 'dismiss' | 'restore' | 'answered' | 'archive',
      questionIds: string[],
      bulk: boolean,
    ): Promise<QaModerationOutcome> {
      const hostUserId = (socket.data as { userId?: string | null }).userId ?? null;
      const outcome: QaModerationOutcome = { transitioned: [], failed: [] };
      for (const questionId of questionIds) {
        const question = state.questions.get(questionId);
        if (!question) {
          outcome.failed.push({ questionId, error: 'unknown_question' });
          continue;
        }
        // Full rollback snapshot: transitionQuestion stamps status timestamps
        // and may clear the highlight, so capture everything it can touch.
        const snapshot = {
          status: question.status,
          approvedAt: question.approvedAt,
          answeredAt: question.answeredAt,
          archivedAt: question.archivedAt,
          dismissedAt: question.dismissedAt,
          withdrawnAt: question.withdrawnAt,
          highlightedQuestionId: state.highlightedQuestionId,
        };
        // Restore is status-directed (PRD §4.3): DISMISSED -> IN_REVIEW keeps
        // the MID-338 moderation-queue behavior; ANSWERED/ARCHIVED -> LIVE is
        // the MID-339 host-board restore. LIVE/IN_REVIEW/WITHDRAWN restores
        // are still rejected by the transition matrix in lib/qa.ts.
        const result =
          action === 'approve'
            ? qaApproveQuestion(state, { questionId })
            : action === 'dismiss'
              ? qaDismissQuestion(state, { questionId })
              : action === 'restore'
                ? qaRestoreQuestion(state, { questionId })
                : action === 'answered'
                  ? qaMarkAnswered(state, { questionId })
                  : qaArchiveQuestion(state, { questionId });
        if (!result.ok) {
          outcome.failed.push({ questionId, error: result.reason });
          continue;
        }
        try {
          await qaRepoSetQuestionStatusWithModerationEvent({
            questionId,
            status: result.to,
            sessionId: state.sessionId,
            hostUserId,
            action,
            reason: bulk ? 'bulk' : null,
          });
        } catch (err) {
          console.error(`[qa-repo] setQuestionStatusWithModerationEvent (${action})`, err);
          rollbackQaQuestion(state, question, snapshot);
          outcome.failed.push({ questionId, error: 'persistence_failed' });
          continue;
        }
        // If the question left LIVE while highlighted, the in-memory
        // transition already cleared the highlight and the transactional
        // repo write cleared the persisted QASession.highlightedQuestionId
        // pointer alongside the status + moderation event, so a later
        // restore + hydration can never resurrect the highlight.
        outcome.transitioned.push({ questionId, from: result.from, to: result.to });
      }
      return outcome;
    }

    function rollbackQaQuestion(
      state: QAState,
      question: QAQuestionEntry,
      snapshot: {
        status: QAQuestionStatus;
        approvedAt: number | null;
        answeredAt: number | null;
        archivedAt: number | null;
        dismissedAt: number | null;
        withdrawnAt: number | null;
        highlightedQuestionId: string | null;
      },
    ) {
      question.status = snapshot.status;
      question.approvedAt = snapshot.approvedAt;
      question.answeredAt = snapshot.answeredAt;
      question.archivedAt = snapshot.archivedAt;
      question.dismissedAt = snapshot.dismissedAt;
      question.withdrawnAt = snapshot.withdrawnAt;
      state.highlightedQuestionId = snapshot.highlightedQuestionId;
    }

    // Broadcast policy after moderation: anything that entered or left LIVE
    // changes the public board (one full snapshot — supersedes score deltas);
    // moves between private states (IN_REVIEW <-> DISMISSED) only refresh the
    // host board. Owners always get a targeted personal push so their "my
    // questions" panel tracks approve/dismiss/restore without a refresh.
    // IN_REVIEW and DISMISSED never reach the mixed qa:${pin} room.
    function qaBroadcastAfterModeration(state: QAState, outcome: QaModerationOutcome) {
      if (outcome.transitioned.length === 0) return;
      const touchedLive = outcome.transitioned.some((t) => t.from === 'LIVE' || t.to === 'LIVE');
      if (touchedLive) qaEmitPublicState(state);
      else qaEmitHostState(state);
      const owners = new Set<string>();
      for (const t of outcome.transitioned) {
        const owner = state.questions.get(t.questionId)?.participantId;
        if (owner) owners.add(owner);
      }
      for (const owner of owners) qaEmitPersonalState(state, owner);
    }

    // Explicit ack shapes (MID-338): single actions ack { ok, questionId,
    // status } or { error }; bulk acks { ok, questionIds, failed } so the
    // host UI can report partial success.
    type QaModerationAck =
      | { ok: true; questionId: string; status: QAQuestionStatus }
      | { ok: true; questionIds: string[]; failed: { questionId: string; error: string }[] }
      | { error: string };

    function qaHostModerationHandler(
      action: 'approve' | 'dismiss' | 'restore' | 'answered' | 'archive',
    ) {
      return async (payload: unknown, ack: unknown) => {
        if (typeof ack !== 'function') {
          console.warn(`[qa:host:${action}] missing ack — ignoring`);
          return;
        }
        const cb = ack as (res: QaModerationAck) => void;
        const resolved = qaResolveHostAction(payload);
        if ('error' in resolved) {
          cb(resolved);
          return;
        }
        const { state, p } = resolved;
        // Restore, answered, and archive are deliberately single-question:
        // they are presenting/corrective actions, not queue-clearing ones
        // (PRD §4.3). Only approve/dismiss take bulk ids.
        const ids =
          action === 'approve' || action === 'dismiss'
            ? qaParseQuestionIds(p)
            : typeof p.questionId === 'string' && p.questionId.length > 0
              ? [p.questionId]
              : null;
        if (!ids) {
          cb({ error: 'invalid' });
          return;
        }
        const bulk = !('questionId' in p && typeof p.questionId === 'string');
        const outcome = await qaModerateQuestions(state, action, ids, bulk);
        if (!bulk) {
          const [only] = ids;
          const t = outcome.transitioned.find((x) => x.questionId === only);
          if (t) cb({ ok: true, questionId: only, status: t.to });
          else cb({ error: outcome.failed[0]?.error ?? 'invalid' });
        } else {
          cb({
            ok: true,
            questionIds: outcome.transitioned.map((t) => t.questionId),
            failed: outcome.failed,
          });
        }
        qaBroadcastAfterModeration(state, outcome);
      };
    }

    socket.on('qa:host:approve', qaHostModerationHandler('approve'));
    socket.on('qa:host:dismiss', qaHostModerationHandler('dismiss'));
    socket.on('qa:host:restore', qaHostModerationHandler('restore'));

    // --- Q&A host live-board actions (MID-339) ---

    socket.on('qa:host:answered', qaHostModerationHandler('answered'));
    socket.on('qa:host:archive', qaHostModerationHandler('archive'));

    // Highlight the question currently being answered (PRD §4.3). One
    // highlighted question at a time: the single highlightedQuestionId field
    // holds the invariant, so highlighting a new question implicitly replaces
    // the previous one; `questionId: null` un-highlights. Persisted to the
    // session row so restart hydration restores the on-air marker.
    socket.on('qa:host:highlight', async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        console.warn('[qa:host:highlight] missing ack — ignoring');
        return;
      }
      const cb = ack as (
        res: { ok: true; highlightedQuestionId: string | null } | { error: string },
      ) => void;
      const resolved = qaResolveHostAction(payload);
      if ('error' in resolved) {
        cb(resolved);
        return;
      }
      const { state, p } = resolved;
      const questionId =
        p.questionId === null
          ? null
          : typeof p.questionId === 'string' && p.questionId.length > 0
            ? p.questionId
            : undefined;
      if (questionId === undefined) {
        cb({ error: 'invalid' });
        return;
      }
      const previous = state.highlightedQuestionId;
      const result = qaHighlightQuestion(state, { questionId });
      if (!result.ok) {
        cb({ error: result.reason });
        return;
      }
      if (state.highlightedQuestionId !== previous) {
        try {
          await qaRepoSetHighlightedQuestion({
            sessionId: state.sessionId,
            questionId: state.highlightedQuestionId,
          });
        } catch (err) {
          console.error('[qa-repo] setHighlightedQuestion', err);
          state.highlightedQuestionId = previous;
          cb({ error: 'persistence_failed' });
          return;
        }
      }
      cb({ ok: true, highlightedQuestionId: state.highlightedQuestionId });
      // Highlight is part of the public projection — every connected client
      // (host, displays, participants) re-renders the on-air marker.
      if (state.highlightedQuestionId !== previous) qaEmitPublicState(state);
    });

    // Host edit of a question's text (PRD §4.3). The first edit preserves the
    // submitted text in originalText (in memory and in the DB) so export/audit
    // can show what the participant actually wrote. Host edits never demote a
    // LIVE question back to review — that rule is participant-edit-only.
    socket.on('qa:host:edit', async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        console.warn('[qa:host:edit] missing ack — ignoring');
        return;
      }
      const cb = ack as (
        res: { ok: true; questionId: string; text: string } | { error: string },
      ) => void;
      const resolved = qaResolveHostAction(payload);
      if ('error' in resolved) {
        cb(resolved);
        return;
      }
      const { state, p } = resolved;
      if (
        typeof p.questionId !== 'string' ||
        p.questionId.length === 0 ||
        typeof p.text !== 'string'
      ) {
        cb({ error: 'invalid' });
        return;
      }
      const question = state.questions.get(p.questionId);
      const snapshot = question
        ? { text: question.text, originalText: question.originalText }
        : null;
      const result = qaEditQuestion(state, {
        questionId: p.questionId,
        text: p.text,
        editor: { role: 'host' },
      });
      if (!result.ok) {
        cb({ error: result.reason });
        return;
      }
      const edited = result.question;
      try {
        await qaRepoEditQuestionText({ questionId: edited.id, text: edited.text });
      } catch (err) {
        console.error('[qa-repo] editQuestionText (host)', err);
        if (question && snapshot) {
          question.text = snapshot.text;
          question.originalText = snapshot.originalText;
        }
        cb({ error: 'persistence_failed' });
        return;
      }
      cb({ ok: true, questionId: edited.id, text: edited.text });
      // A LIVE question's text is public — everyone re-renders. An IN_REVIEW
      // edit stays host-only. The owner always gets a personal push so their
      // "my questions" panel shows the edited text without a refresh.
      if (edited.status === 'LIVE') qaEmitPublicState(state);
      else qaEmitHostState(state);
      if (edited.participantId) qaEmitPersonalState(state, edited.participantId);
    });

    // --- Q&A labels (MID-340, PRD §4.1 / §4.3) ---

    // Mid-session label creation. Same strict host gate as moderation: only
    // the attached host control socket may create labels. In-memory create
    // first (validates name + per-session uniqueness), persist BEFORE
    // broadcasting, re-key to the DB id, roll back on failure.
    socket.on('qa:host:label:create', async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        console.warn('[qa:host:label:create] missing ack — ignoring');
        return;
      }
      const cb = ack as (res: { ok: true; label: QAPublicLabel } | { error: string }) => void;
      const resolved = qaResolveHostAction(payload);
      if ('error' in resolved) {
        cb(resolved);
        return;
      }
      const { state, p } = resolved;
      if (typeof p.name !== 'string') {
        cb({ error: 'invalid' });
        return;
      }
      if (p.participantSelectable !== undefined && typeof p.participantSelectable !== 'boolean') {
        cb({ error: 'invalid' });
        return;
      }
      const result = qaCreateLabel(state, {
        name: p.name,
        participantSelectable: p.participantSelectable,
      });
      if (!result.ok) {
        cb({ error: result.reason });
        return;
      }
      let labelId = result.labelId;
      try {
        const row = await qaRepoCreateLabel({
          sessionId: state.sessionId,
          name: result.label.name,
          participantSelectable: result.label.participantSelectable,
        });
        // Re-key to the DB id so assignments and hydration line up.
        state.labels.delete(labelId);
        state.labels.set(row.id, result.label);
        labelId = row.id;
      } catch (err) {
        console.error('[qa-repo] createLabel', err);
        state.labels.delete(labelId);
        // A racing duplicate (e.g. a second control tab) surfaces as the
        // same duplicate_label the in-memory check would have produced.
        cb({
          error: err instanceof DuplicateLabelError ? 'duplicate_label' : 'persistence_failed',
        });
        return;
      }
      cb({
        ok: true,
        label: {
          id: labelId,
          name: result.label.name,
          participantSelectable: result.label.participantSelectable,
        },
      });
      // The label list rides in the public projection (participants need new
      // selectable labels for submission/filtering), so everyone refreshes.
      qaEmitPublicState(state);
    });

    // Assign/unassign a label on a question. Idempotent both ways. Broadcast
    // policy: chips on a LIVE question are public; label changes on private
    // questions (IN_REVIEW/DISMISSED/…) refresh the host board only.
    function qaHostLabelAssignmentHandler(action: 'assign' | 'unassign') {
      return async (payload: unknown, ack: unknown) => {
        if (typeof ack !== 'function') {
          console.warn(`[qa:host:label:${action}] missing ack — ignoring`);
          return;
        }
        const cb = ack as (
          res: { ok: true; questionId: string; labelIds: string[] } | { error: string },
        ) => void;
        const resolved = qaResolveHostAction(payload);
        if ('error' in resolved) {
          cb(resolved);
          return;
        }
        const { state, p } = resolved;
        if (
          typeof p.questionId !== 'string' ||
          p.questionId.length === 0 ||
          typeof p.labelId !== 'string' ||
          p.labelId.length === 0
        ) {
          cb({ error: 'invalid' });
          return;
        }
        const args = { questionId: p.questionId, labelId: p.labelId };
        const result =
          action === 'assign' ? qaAssignLabel(state, args) : qaUnassignLabel(state, args);
        if (!result.ok) {
          cb({ error: result.reason });
          return;
        }
        const question = state.questions.get(p.questionId);
        const changed =
          ('assigned' in result && result.assigned) || ('removed' in result && result.removed);
        if (changed) {
          try {
            if (action === 'assign') await qaRepoAssignLabel(args);
            else await qaRepoUnassignLabel(args);
          } catch (err) {
            console.error(`[qa-repo] ${action}Label`, err);
            if (question) {
              if (action === 'assign') question.labelIds.delete(p.labelId);
              else question.labelIds.add(p.labelId);
            }
            cb({ error: 'persistence_failed' });
            return;
          }
        }
        cb({ ok: true, questionId: p.questionId, labelIds: [...(question?.labelIds ?? [])] });
        if (!changed) return;
        if (question?.status === 'LIVE') qaEmitPublicState(state);
        else qaEmitHostState(state);
      };
    }

    socket.on('qa:host:label:assign', qaHostLabelAssignmentHandler('assign'));
    socket.on('qa:host:label:unassign', qaHostLabelAssignmentHandler('unassign'));

    socket.on('disconnect', () => {
      const wcLink = wcSocketToPin.get(socket.id);
      if (wcLink) {
        wcSocketToPin.delete(socket.id);
        const wcState = wordCloudStates.get(wcLink.pin);
        if (wcState) {
          if (wcLink.role === 'player') {
            wcState.socketToPlayer.delete(socket.id);
          }
        }
      }

      const qaLink = qaSocketToPin.get(socket.id);
      if (qaLink) {
        qaSocketToPin.delete(socket.id);
        const qaState = qaStates.get(qaLink.pin);
        if (qaState) {
          if (qaLink.role === 'participant') {
            qaState.socketToParticipant.delete(socket.id);
          } else if (qaLink.role === 'display') {
            qaState.displaySocketIds.delete(socket.id);
          } else if (qaState.hostSocketId === socket.id) {
            // Only clear if this socket still owns the slot: an HMR/dev
            // reconnect attaches the new socket first, then the orphaned old
            // socket disconnects — it must not unbind the new host.
            qaState.hostSocketId = undefined;
          }
        }
      }

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
            broadcast(event.pin, 'phase');
          }, HOST_GRACE_MS + 50);
          hostGraceTimers.set(event.pin, t);
        }
      }
      for (const pin of pins) broadcast(pin, 'membership');
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
        broadcast(pin, 'phase');
      }
      lockTimers.delete(pin);
    }, ms + 50);
    lockTimers.set(pin, t);
  }

  httpServer.listen(port, () => {
    console.log(`▶ PRIMETIME ready on http://${hostname}:${port}`);
  });
});

function handleUploadFile(
  relPath: string,
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
) {
  const resolved = resolveUploadFilePath(appConfig.uploadDir, relPath);
  if (resolved === null) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }
  stat(resolved)
    .then((st) => {
      if (!st.isFile()) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', uploadContentType(resolved));
      res.setHeader('Content-Length', st.size);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Filenames are random and content is immutable once written.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(resolved);
      stream.on('error', () => {
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
      stream.pipe(res);
    })
    .catch(() => {
      res.statusCode = 404;
      res.end('not found');
    });
}

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
  res.setHeader('Content-Disposition', `attachment; filename="primetime-${pin}-${utcDate}.csv"`);
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
    `attachment; filename="primetime-${pin}-${utcDate}-answers.csv"`,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}
