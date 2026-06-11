// quick smoke test: 1 host + 2 players + 1 display, full game loop

import { PrismaClient } from '@prisma/client';
import { io } from 'socket.io-client';
import { config } from '../lib/config';
import { createGame, detachSocket, joinPlayer, setReconnectGraceForTesting } from '../lib/game';
import type { Quiz } from '../lib/types';

const URL = 'http://localhost:4321';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const quiz: Quiz = {
  title: 'Smoke Test',
  questions: [
    {
      id: 'q1',
      type: 'multiple',
      text: '2 + 2?',
      options: ['3', '4', '5', '6'],
      correct: 1,
      timeLimit: 10,
      doublePoints: false,
    },
    {
      id: 'q2',
      type: 'truefalse',
      text: 'Sky is blue.',
      options: ['TRUE', 'FALSE'],
      correct: 0,
      timeLimit: 10,
      doublePoints: true,
    },
  ],
};

interface State {
  pin: string;
  phase: string;
  questionIndex: number;
  reveal?: { distribution: number[]; totalAnswers: number };
  paused?: { reason: 'host-disconnected'; resumeBy: number };
  players: Array<{ id: string; nickname: string; score: number }>;
}

async function main() {
  const [host, display, a, b] = await Promise.all([
    connectSock(),
    connectSock(),
    connectSock(),
    connectSock(),
  ]);

  const states = new Map<string, State>();
  for (const [name, s] of [
    ['host', host],
    ['display', display],
    ['a', a],
    ['b', b],
  ] as const) {
    s.on('state', (st: State) => {
      states.set(name, st);
    });
    s.on('personal', (_p: unknown) => {
      // optional: console.log(name, "personal", _p);
    });
  }

  const { pin } = await new Promise<{ pin: string }>((r) => host.emit('host:create', quiz, r));
  console.log('pin:', pin);
  display.emit('display:attach', pin);

  const ja = await new Promise<{ ok: boolean; playerId?: string; error?: string }>((r) =>
    a.emit('player:join', pin, 'Alice', r),
  );
  const jb = await new Promise<{ ok: boolean; playerId?: string; error?: string }>((r) =>
    b.emit('player:join', pin, 'Bob', r),
  );
  console.log('join Alice:', ja, 'join Bob:', jb);

  await sleep(150);

  console.log(
    'lobby players:',
    states.get('host')?.players.map((p) => p.nickname),
  );

  host.emit('host:start', pin);
  await sleep(200);
  console.log('phase after start:', states.get('host')?.phase);

  // Alice answers correctly fast, Bob answers wrong slow
  await sleep(100);
  await new Promise<void>((r) => a.emit('player:answer', pin, 1, () => r()));
  await sleep(2000);
  await new Promise<void>((r) => b.emit('player:answer', pin, 0, () => r()));

  await sleep(300);
  // both answered → should auto lock to reveal
  console.log(
    'after Q1 answers, phase:',
    states.get('host')?.phase,
    'scores:',
    states.get('host')?.players.map((p) => `${p.nickname}=${p.score}`),
  );

  host.emit('host:advance', pin);
  await sleep(200);
  console.log('after reveal advance, phase:', states.get('host')?.phase);

  host.emit('host:advance', pin);
  await sleep(300);
  console.log('Q2 phase:', states.get('host')?.phase);

  // Q2: bob correct, alice wrong; double points
  await sleep(100);
  await new Promise<void>((r) => b.emit('player:answer', pin, 0, () => r()));
  await new Promise<void>((r) => a.emit('player:answer', pin, 1, () => r()));
  await sleep(300);
  console.log(
    'after Q2 answers, phase:',
    states.get('host')?.phase,
    'scores:',
    states.get('host')?.players.map((p) => `${p.nickname}=${p.score}`),
  );

  host.emit('host:advance', pin);
  await sleep(200);
  console.log('after Q2 advance →', states.get('host')?.phase);
  host.emit('host:advance', pin);
  await sleep(200);
  console.log('final phase:', states.get('host')?.phase);

  host.disconnect();
  display.disconnect();
  a.disconnect();
  b.disconnect();

  await assertCapEnforcement();
  await assertPlayerReconnectInGrace();
  await assertPlayerRejoinAfterGrace();
  await assertHostDisconnectAndReconnect();
  await assertProfanityFilter();
  await assertCsvExport();
  await assertSameSocketDoubleSubmitIdempotent();
  await assertDisplayReconnectRejoinsRoom();
  await assertQ1AutoLockNoAnswers();
  await assertPausedQuestionRejectsAnswers();
  await assertLateAnswerRejected();
  await assertMalformedHostCreateRejected();
  await assertMalformedPlayerJoinRejected();
  await assertMalformedPlayerAnswerRejected();
  await assertCsvFormulaNeutralized();

  await assertWordCloudHappyPath();
  await assertWordCloudProfanityRejection();
  await assertWordCloudHostTrash();

  await assertQaSocketFoundation();
  await assertQaParticipantFlow();
  await assertQaVoting();
  await assertQaModerationQueue();
  await assertQaReplies();
  await assertQaSessionControls();
  await assertQaDisplayPresentMode();
  await assertQaFullLifecycleCsvExport();

  await assertPersistenceRowsWritten();
}

async function assertCapEnforcement() {
  // OSS: the cap is a code-level product constant. Server and this smoke run
  // share the same lib/config, so we fill exactly config.playerCap slots
  // and expect the next join to be rejected with code "full".
  const cap = config.playerCap;
  console.log(`\n--- cap enforcement: PLAYER_CAP = ${cap} ---`);
  const capHost = io(URL, { transports: ['websocket'] });
  await new Promise<void>((r) => capHost.on('connect', () => r()));

  const { pin } = await new Promise<{ pin: string }>((r) =>
    capHost.emit('host:create', quiz, 'free', r),
  );
  console.log('cap-test pin:', pin);

  const players: ReturnType<typeof io>[] = [];
  for (let i = 0; i < cap; i++) {
    const p = io(URL, { transports: ['websocket'] });
    await new Promise<void>((r) => p.on('connect', () => r()));
    const res = await new Promise<{ ok: boolean; error?: string; code?: string }>((r) =>
      p.emit('player:join', pin, `Player${i + 1}`, r),
    );
    if (!res.ok) throw new Error(`player ${i + 1} unexpectedly rejected: ${res.error}`);
    players.push(p);
  }
  console.log(`${cap} players joined OK`);

  const overflow = io(URL, { transports: ['websocket'] });
  await new Promise<void>((r) => overflow.on('connect', () => r()));
  const rej = await new Promise<{ ok: boolean; error?: string; code?: string }>((r) =>
    overflow.emit('player:join', pin, 'Overflow', r),
  );

  if (rej.ok) throw new Error(`player ${cap + 1} should have been rejected`);
  if (rej.code !== 'full') {
    throw new Error(`expected code "full", got "${rej.code}" (error: ${rej.error})`);
  }
  console.log(`player ${cap + 1} rejected with code:`, rej.code, '·', rej.error);

  await sleep(50);
  const capState = await new Promise<{
    playerCount?: number;
    cap?: { max: number };
  }>((r) => {
    capHost.once('state', (s) => r(s));
    capHost.emit('host:attach', pin);
  });
  if (capState.cap?.max !== cap) {
    throw new Error(`expected cap {max:${cap}}, got ${JSON.stringify(capState.cap)}`);
  }
  console.log('publicState cap:', capState.cap);
  console.log('cap enforcement: PASS');

  capHost.disconnect();
  overflow.disconnect();
  for (const p of players) p.disconnect();
}

// --- helpers shared by m2 scenarios ---

function connectSock() {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  return new Promise<ReturnType<typeof io>>((resolve) => {
    s.on('connect', () => resolve(s));
  });
}

// Socket carrying an Auth.js session cookie so server.ts authenticates it as
// a logged-in user (socket.data.userId). Used to prove host-user auth alone
// is not enough to moderate — the socket must be the attached host control.
function connectAuthedSock(sessionToken: string) {
  const s = io(URL, {
    transports: ['websocket'],
    forceNew: true,
    extraHeaders: { cookie: `authjs.session-token=${sessionToken}` },
  });
  return new Promise<ReturnType<typeof io>>((resolve) => {
    s.on('connect', () => resolve(s));
  });
}

async function createGameOverSocket(
  host: ReturnType<typeof io>,
  quiz: Quiz,
  tier?: 'free' | 'pro',
) {
  return new Promise<{ pin: string }>((r) => {
    if (tier) host.emit('host:create', quiz, tier, r);
    else host.emit('host:create', quiz, r);
  });
}

const oneQuestionQuiz: Quiz = {
  title: 'Single Q',
  questions: [
    {
      id: 'q1',
      type: 'multiple',
      text: 'Which is even?',
      options: ['1', '2', '3', '5'],
      correct: 1,
      timeLimit: 10,
      doublePoints: false,
    },
  ],
};

async function joinPlayerOverSocket(s: ReturnType<typeof io>, pin: string, nickname: string) {
  return new Promise<{
    ok: boolean;
    error?: string;
    code?: string;
    playerId?: string;
    reconnected?: boolean;
  }>((r) => s.emit('player:join', pin, nickname, r));
}

// --- scenario 1: player reconnect inside grace window ---

async function assertPlayerReconnectInGrace() {
  console.log('\n--- scenario 1: player reconnect inside grace ---');
  // generous grace window (default 30s) — we reconnect within ~300ms.
  setReconnectGraceForTesting(30_000);

  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);

  await joinPlayerOverSocket(a, pin, 'Alice');
  const jb1 = await joinPlayerOverSocket(b, pin, 'Bob');
  if (!jb1.ok) throw new Error(`Bob initial join failed: ${jb1.error}`);

  host.emit('host:start', pin);
  await sleep(150);

  await new Promise<void>((r) => a.emit('player:answer', pin, 1, () => r()));
  await new Promise<void>((r) => b.emit('player:answer', pin, 1, () => r()));
  await sleep(200);

  // grab Bob's score before disconnect
  const stateBefore = await new Promise<State>((r) => {
    host.once('state', (s: State) => r(s));
    host.emit('host:attach', pin);
  });
  const bobBefore = stateBefore.players.find((p) => p.nickname === 'Bob');
  if (!bobBefore) throw new Error('Bob missing pre-disconnect');
  if (bobBefore.score <= 0) throw new Error(`Bob should have score > 0, got ${bobBefore.score}`);

  // listen for the host-side reconnect event
  let reconnectedEvent: { playerId: string; nickname: string } | null = null;
  host.on('event:reconnected', (payload: { playerId: string; nickname: string }) => {
    reconnectedEvent = payload;
  });

  b.disconnect();
  await sleep(200);

  const bb = await connectSock();
  const jb2 = await joinPlayerOverSocket(bb, pin, 'Bob');

  if (!jb2.ok) throw new Error(`Bob reconnect failed: ${jb2.error}`);
  if (!jb2.reconnected) throw new Error('expected reconnected: true');
  if (jb2.playerId !== bobBefore.id) {
    throw new Error(`expected same playerId, got ${jb2.playerId} vs ${bobBefore.id}`);
  }

  await sleep(150);
  const stateAfter = await new Promise<State>((r) => {
    host.once('state', (s: State) => r(s));
    host.emit('host:attach', pin);
  });
  const bobAfter = stateAfter.players.find((p) => p.nickname === 'Bob');
  if (!bobAfter) throw new Error('Bob missing post-reconnect');
  if (bobAfter.score !== bobBefore.score) {
    throw new Error(`score lost on reconnect: ${bobBefore.score} → ${bobAfter.score}`);
  }
  if (!reconnectedEvent) throw new Error('event:reconnected was not emitted to host');
  if ((reconnectedEvent as { nickname: string }).nickname !== 'Bob') {
    throw new Error(`event:reconnected wrong nickname: ${JSON.stringify(reconnectedEvent)}`);
  }

  console.log('✓ player reconnect inside grace');

  host.disconnect();
  a.disconnect();
  bb.disconnect();
}

// --- scenario 2: rejoin AFTER grace (uses dev hatch + in-process calls) ---

async function assertPlayerRejoinAfterGrace() {
  console.log('\n--- scenario 2: rejoin after grace expires ---');
  setReconnectGraceForTesting(50);

  const game = createGame(quiz, 'free');

  const j1 = joinPlayer(game.pin, 'sock-orig', 'Carol');
  if (!j1.ok) throw new Error(`Carol join failed: ${j1.error}`);
  const originalId = j1.player.id;

  // simulate disconnect
  detachSocket('sock-orig');

  // wait past the grace window
  await sleep(150);

  const j2 = joinPlayer(game.pin, 'sock-new', 'Carol');
  if (!j2.ok) throw new Error(`Carol post-grace rejoin failed: ${j2.error}`);
  if (j2.reconnected) {
    throw new Error('rejoin after grace should NOT be flagged as reconnected');
  }
  if (j2.player.id === originalId) {
    throw new Error(`expected new playerId after grace, got same: ${j2.player.id}`);
  }
  if (j2.player.score !== 0) {
    throw new Error(`expected fresh score=0, got ${j2.player.score}`);
  }

  // restore default grace for any later scenarios
  setReconnectGraceForTesting(30_000);
  console.log('✓ rejoin after grace = new player');
}

// --- scenario 3: host disconnect + reconnect inside 60s ---

async function assertHostDisconnectAndReconnect() {
  console.log('\n--- scenario 3: host disconnect + reconnect inside 60s ---');

  const host = await connectSock();
  const player = await connectSock();
  const display = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);
  display.emit('display:attach', pin);

  await joinPlayerOverSocket(player, pin, 'Dave');
  host.emit('host:start', pin);
  await sleep(200);

  // capture next state pushed to player after host drops
  const pausedState = new Promise<State>((resolve) => {
    player.on('state', function onState(s: State) {
      if (s.paused) {
        player.off('state', onState);
        resolve(s);
      }
    });
  });

  host.disconnect();

  const paused = (await Promise.race([pausedState, sleep(2000).then(() => null)])) as State | null;

  if (!paused) throw new Error('player never received paused state');
  if (!paused.paused) throw new Error('expected paused on player state');
  if (paused.paused.reason !== 'host-disconnected') {
    throw new Error(`expected reason=host-disconnected, got ${paused.paused.reason}`);
  }
  if (typeof paused.paused.resumeBy !== 'number' || paused.paused.resumeBy <= Date.now()) {
    throw new Error(`bad resumeBy: ${paused.paused.resumeBy}`);
  }
  console.log('paused payload:', paused.paused);

  const phaseBeforePause = paused.phase;
  const qIndexBeforePause = paused.questionIndex;

  // reconnect host within grace
  const host2 = await connectSock();
  const resumedState = new Promise<State>((resolve) => {
    player.on('state', function onState(s: State) {
      if (!s.paused) {
        player.off('state', onState);
        resolve(s);
      }
    });
  });
  host2.emit('host:attach', pin);

  const resumed = (await Promise.race([
    resumedState,
    sleep(2000).then(() => null),
  ])) as State | null;
  if (!resumed) throw new Error('player never saw paused cleared');
  if (resumed.paused) throw new Error('paused should be cleared after host reconnect');
  if (resumed.phase !== phaseBeforePause) {
    throw new Error(`phase changed across pause: ${phaseBeforePause} → ${resumed.phase}`);
  }
  if (resumed.questionIndex !== qIndexBeforePause) {
    throw new Error(
      `questionIndex changed across pause: ${qIndexBeforePause} → ${resumed.questionIndex}`,
    );
  }
  console.log('✓ host pause + resume');

  host2.disconnect();
  player.disconnect();
  display.disconnect();
}

// --- scenario 5: profanity filter (scenario 4 = cap, already covered above) ---

async function assertProfanityFilter() {
  console.log('\n--- scenario 5: profanity filter ---');
  const host = await connectSock();
  const dirty = await connectSock();
  const clean = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);

  const bad = await joinPlayerOverSocket(dirty, pin, 'fuckface');
  if (bad.ok) throw new Error('offensive nickname should have been rejected');
  if (bad.code !== 'nickname-rejected') {
    throw new Error(`expected code=nickname-rejected, got ${bad.code}`);
  }
  if (bad.error !== 'Pick another nickname') {
    throw new Error(`expected error="Pick another nickname", got ${bad.error}`);
  }

  const good = await joinPlayerOverSocket(clean, pin, 'alice');
  if (!good.ok) throw new Error(`clean nickname rejected: ${good.error}`);
  console.log('✓ profanity filter');

  host.disconnect();
  dirty.disconnect();
  clean.disconnect();
}

// --- scenario 6: CSV export (final phase only) ---

async function assertCsvExport() {
  console.log('\n--- scenario 6: CSV export ---');
  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();
  const { pin } = await createGameOverSocket(host, oneQuestionQuiz);

  await joinPlayerOverSocket(a, pin, 'Alice');
  await joinPlayerOverSocket(b, pin, 'Bob');

  // pre-final attempt should be 409
  const early = await fetch(`${URL}/host/${pin}/results.csv`);
  if (early.status !== 409) {
    throw new Error(`expected 409 before final, got ${early.status}`);
  }
  console.log('pre-final CSV → 409 ✓');

  host.emit('host:start', pin);
  await sleep(150);
  await new Promise<void>((r) => a.emit('player:answer', pin, 1, () => r()));
  await new Promise<void>((r) => b.emit('player:answer', pin, 0, () => r()));
  await sleep(200);
  // question → reveal → final
  host.emit('host:advance', pin);
  await sleep(100);
  host.emit('host:advance', pin);
  await sleep(200);

  const final = await fetch(`${URL}/host/${pin}/results.csv`);
  if (final.status !== 200) {
    throw new Error(`expected 200 at final, got ${final.status}`);
  }
  const ctype = final.headers.get('content-type') ?? '';
  if (!ctype.toLowerCase().includes('text/csv')) {
    throw new Error(`expected text/csv, got ${ctype}`);
  }
  const body = await final.text();
  const rows = body.split(/\r\n|\n/).filter((line) => line.length > 0);
  // header + 2 players = 3
  if (rows.length !== 3) {
    throw new Error(
      `expected 3 rows (header + 2 players), got ${rows.length}: ${JSON.stringify(rows)}`,
    );
  }
  console.log('✓ CSV export at final');

  host.disconnect();
  a.disconnect();
  b.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

async function assertPersistenceRowsWritten() {
  const flag = process.env.ENABLE_SESSION_PERSISTENCE;
  if (flag === 'false' || flag === '0') {
    console.log(
      '\n--- persistence: disabled (ENABLE_SESSION_PERSISTENCE=false), skipping DB count check ---',
    );
    return;
  }
  console.log('\n--- persistence: post-run DB row counts ---');
  // give fire-and-forget writes a moment to flush
  await sleep(500);
  const prisma = new PrismaClient();
  try {
    const [sessions, players, answers] = await Promise.all([
      prisma.gameSession.count(),
      prisma.sessionPlayer.count(),
      prisma.sessionAnswer.count(),
    ]);
    console.log(`GameSession=${sessions}, SessionPlayer=${players}, SessionAnswer=${answers}`);
    if (sessions === 0) throw new Error('expected GameSession rows > 0');
    if (players === 0) throw new Error('expected SessionPlayer rows > 0');
    if (answers === 0) throw new Error('expected SessionAnswer rows > 0');
    console.log('✓ persistence rows written');
  } finally {
    await prisma.$disconnect();
  }
}

async function assertSameSocketDoubleSubmitIdempotent() {
  console.log('\n--- scenario: same-socket double submit is idempotent ---');
  const host = await connectSock();
  const player = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);

  const j1 = await joinPlayerOverSocket(player, pin, 'Alice');
  const j2 = await joinPlayerOverSocket(player, pin, 'Alice');

  if (!j1.ok) throw new Error(`first join failed: ${j1.error}`);
  if (!j2.ok) throw new Error(`second join (duplicate) failed: ${j2.error}`);
  if (j1.playerId !== j2.playerId) {
    throw new Error(`expected same playerId on duplicate, got ${j1.playerId} vs ${j2.playerId}`);
  }

  const otherSocket = await connectSock();
  const j3 = await joinPlayerOverSocket(otherSocket, pin, 'Alice');
  if (j3.ok) throw new Error('different socket with same nickname should fail');

  console.log('✓ same-socket double submit is idempotent');
  host.disconnect();
  player.disconnect();
  otherSocket.disconnect();
}

setTimeout(() => {
  console.error('[smoke] hard timeout 360s');
  process.exit(2);
}, 360000).unref();

// --- scenario 7: display reconnect rejoins room ---

async function assertDisplayReconnectRejoinsRoom() {
  console.log('\n--- scenario 7: display reconnect rejoins room ---');
  const host = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);

  const display = await connectSock();
  // mirror the F3 client fix: re-emit display:attach on every connect so a
  // fresh socket (post-reconnect) rejoins pin:${pin} and receives broadcasts.
  display.on('connect', () => display.emit('display:attach', pin));
  display.emit('display:attach', pin);

  const firstState = await new Promise<State>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no initial state on display')), 3000);
    display.once('state', (s: State) => {
      clearTimeout(t);
      resolve(s);
    });
  });
  if (firstState.pin !== pin) throw new Error(`initial state pin mismatch: ${firstState.pin}`);

  display.disconnect();
  await sleep(100);
  const reconnected = new Promise<void>((resolve) => display.once('connect', () => resolve()));
  display.connect();
  await reconnected;

  const got = await new Promise<State>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no state after reconnect')), 3000);
    display.once('state', (s: State) => {
      clearTimeout(t);
      resolve(s);
    });
  });
  if (!got || got.pin !== pin) {
    throw new Error('display did not receive state after reconnect');
  }
  console.log('✓ display reconnect rejoins room');

  display.disconnect();
  host.disconnect();
}

// --- scenario 8 (F1): Q1 auto-lock with no answers ---

const shortQuiz: Quiz = {
  title: 'Short Quiz',
  questions: [
    {
      id: 'q1',
      type: 'multiple',
      text: 'Pick A',
      options: ['A', 'B', 'C', 'D'],
      correct: 0,
      timeLimit: 3,
      doublePoints: false,
    },
  ],
};

async function assertQ1AutoLockNoAnswers() {
  console.log('\n--- scenario 8 (F1): Q1 auto-lock with no answers ---');
  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();
  const { pin } = await createGameOverSocket(host, shortQuiz);

  await joinPlayerOverSocket(a, pin, 'Alice');
  await joinPlayerOverSocket(b, pin, 'Bob');

  // listen for the reveal-phase state on the host socket
  const revealed = new Promise<State>((resolve) => {
    host.on('state', function onState(s: State) {
      if (s.phase === 'reveal') {
        host.off('state', onState);
        resolve(s);
      }
    });
  });

  host.emit('host:start', pin);

  // timeLimit 3s + 50ms server slack + buffer
  const result = (await Promise.race([revealed, sleep(4500).then(() => null)])) as State | null;

  if (!result) {
    throw new Error('Q1 never auto-locked — host:start did not schedule auto-lock');
  }
  if (result.phase !== 'reveal') {
    throw new Error(`expected phase=reveal after timeout, got ${result.phase}`);
  }
  console.log('✓ Q1 auto-locks with no answers (F1)');

  host.disconnect();
  a.disconnect();
  b.disconnect();
}

// --- scenario 9 (F2): paused question rejects answers ---

async function assertPausedQuestionRejectsAnswers() {
  console.log('\n--- scenario 9 (F2): paused question rejects answers ---');
  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);

  await joinPlayerOverSocket(a, pin, 'Alice');
  await joinPlayerOverSocket(b, pin, 'Bob');

  host.emit('host:start', pin);
  await sleep(200);

  // wait for player a to see paused state
  const pausedSeen = new Promise<State>((resolve) => {
    a.on('state', function onState(s: State) {
      if (s.paused) {
        a.off('state', onState);
        resolve(s);
      }
    });
  });

  host.disconnect();

  const paused = (await Promise.race([pausedSeen, sleep(2000).then(() => null)])) as State | null;
  if (!paused) throw new Error('paused state never propagated to player');
  if (paused.phase !== 'question') {
    throw new Error(`expected phase to remain 'question' while paused, got ${paused.phase}`);
  }

  // remaining player tries to answer while paused
  const ack = await new Promise<{ ok: boolean; error?: string; reason?: string }>((r) =>
    a.emit('player:answer', pin, 1, r),
  );
  if (ack.ok) throw new Error('paused answer should have been rejected');
  if (ack.reason !== 'paused') {
    throw new Error(`expected reason='paused', got '${ack.reason}' (error: ${ack.error})`);
  }

  // the same is true for player b — and the phase must still be 'question'
  const ack2 = await new Promise<{ ok: boolean; reason?: string }>((r) =>
    b.emit('player:answer', pin, 1, r),
  );
  if (ack2.ok || ack2.reason !== 'paused') {
    throw new Error(`second paused answer not rejected as paused: ${JSON.stringify(ack2)}`);
  }

  // host returns and the question can resume normally
  const host2 = await connectSock();
  const resumed = new Promise<State>((resolve) => {
    a.on('state', function onState(s: State) {
      if (!s.paused && s.phase === 'question') {
        a.off('state', onState);
        resolve(s);
      }
    });
  });
  host2.emit('host:attach', pin);
  const after = (await Promise.race([resumed, sleep(2000).then(() => null)])) as State | null;
  if (!after) throw new Error('question did not resume after host reattach');

  console.log('✓ paused question rejects answers (F2)');

  host2.disconnect();
  a.disconnect();
  b.disconnect();
}

// --- scenario 10 (F4): late answer rejected after deadline ---

const veryShortQuiz: Quiz = {
  title: 'Very Short Quiz',
  questions: [
    {
      id: 'q1',
      type: 'multiple',
      text: 'Pick A',
      options: ['A', 'B', 'C', 'D'],
      correct: 0,
      timeLimit: 3,
      doublePoints: false,
    },
  ],
};

interface StateWithEndsAt extends State {
  endsAt?: number;
}

async function assertLateAnswerRejected() {
  console.log('\n--- scenario 10 (F4): late answer rejected ---');
  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();
  const { pin } = await createGameOverSocket(host, veryShortQuiz);

  await joinPlayerOverSocket(a, pin, 'Alice');
  await joinPlayerOverSocket(b, pin, 'Bob');

  // capture endsAt from the question-phase state broadcast
  const endsAtPromise = new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('never saw question state')), 2000);
    a.on('state', function onState(s: StateWithEndsAt) {
      if (s.phase === 'question' && typeof s.endsAt === 'number') {
        a.off('state', onState);
        clearTimeout(t);
        resolve(s.endsAt);
      }
    });
  });

  host.emit('host:start', pin);
  const endsAt = await endsAtPromise;

  // land in the 50ms window between endsAt and the server-side auto-lock
  // (scheduled at endsAt + 50ms). Aim 10ms past the deadline.
  const wait = Math.max(0, endsAt - Date.now() + 10);
  await sleep(wait);

  const ack = await new Promise<{ ok: boolean; error?: string; reason?: string }>((r) =>
    a.emit('player:answer', pin, 0, r),
  );
  if (ack.ok) throw new Error('late answer should have been rejected');
  if (ack.reason !== 'expired') {
    throw new Error(`expected reason='expired', got '${ack.reason}' (error: ${ack.error})`);
  }
  console.log('✓ late answer rejected with reason=expired (F4)');

  host.disconnect();
  a.disconnect();
  b.disconnect();
}

// --- scenario 11 (F5): malformed host:create rejected, server still alive ---

async function assertMalformedHostCreateRejected() {
  console.log('\n--- scenario 11 (F5): malformed host:create rejected ---');
  const host = await connectSock();

  // questions is not an array → must ack with reason: "invalid-quiz" and not crash
  const bad = await new Promise<{ ok?: boolean; pin?: string; reason?: string }>((r) =>
    host.emit('host:create', { title: 'Bad', questions: 'not-an-array' }, r),
  );
  if (bad.ok)
    throw new Error(`expected malformed host:create to be rejected, got ${JSON.stringify(bad)}`);
  if (bad.reason !== 'invalid-quiz') {
    throw new Error(`expected reason='invalid-quiz', got '${bad.reason}'`);
  }

  // server must still be alive — a well-formed create on the same socket should succeed
  const good = await new Promise<{ ok?: boolean; pin?: string; reason?: string }>((r) =>
    host.emit('host:create', quiz, r),
  );
  if (!good.ok || !good.pin) {
    throw new Error(`server unhealthy after malformed payload: ${JSON.stringify(good)}`);
  }
  console.log('✓ malformed host:create rejected, server alive (F5)');

  host.disconnect();
}

// --- scenario 12 (F5): malformed player:join rejected ---

async function assertMalformedPlayerJoinRejected() {
  console.log('\n--- scenario 12 (F5): malformed player:join rejected ---');
  const host = await connectSock();
  const player = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);

  const longNick = 'x'.repeat(100);
  const ack = await new Promise<{ ok: boolean; reason?: string; error?: string }>((r) =>
    player.emit('player:join', pin, longNick, r),
  );
  if (ack.ok) throw new Error('100-char nickname should have been rejected');
  if (ack.reason !== 'invalid-nickname') {
    throw new Error(
      `expected reason='invalid-nickname', got '${ack.reason}' (error: ${ack.error})`,
    );
  }

  // a clean follow-up join still works
  const good = await joinPlayerOverSocket(player, pin, 'Alice');
  if (!good.ok) throw new Error(`clean join failed after rejection: ${good.error}`);

  console.log('✓ malformed player:join rejected (F5)');

  host.disconnect();
  player.disconnect();
}

// --- scenario 13 (F5): malformed player:answer rejected ---

async function assertMalformedPlayerAnswerRejected() {
  console.log('\n--- scenario 13 (F5): malformed player:answer rejected ---');
  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);

  await joinPlayerOverSocket(a, pin, 'Alice');
  await joinPlayerOverSocket(b, pin, 'Bob');
  host.emit('host:start', pin);
  await sleep(200);

  // answerIndex=99 must be rejected with reason="invalid-answer"
  const ack = await new Promise<{ ok: boolean; reason?: string; error?: string }>((r) =>
    a.emit('player:answer', pin, 99, r),
  );
  if (ack.ok) throw new Error('answerIndex=99 should have been rejected');
  if (ack.reason !== 'invalid-answer') {
    throw new Error(`expected reason='invalid-answer', got '${ack.reason}' (error: ${ack.error})`);
  }

  // valid answer still works after the rejection
  const ok = await new Promise<{ ok: boolean; error?: string }>((r) =>
    a.emit('player:answer', pin, 1, r),
  );
  if (!ok.ok) throw new Error(`valid answer rejected after malformed: ${ok.error}`);

  console.log('✓ malformed player:answer rejected (F5)');

  host.disconnect();
  a.disconnect();
  b.disconnect();
}

// --- scenario 14 (F10): CSV formula injection neutralized ---

async function assertCsvFormulaNeutralized() {
  console.log('\n--- scenario 14 (F10): CSV formula injection neutralized ---');
  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();
  const { pin } = await createGameOverSocket(host, oneQuestionQuiz);

  const ja = await joinPlayerOverSocket(a, pin, '=cmd');
  if (!ja.ok) throw new Error(`join '=cmd' failed: ${ja.error}`);
  const jb = await joinPlayerOverSocket(b, pin, '+1+1');
  if (!jb.ok) throw new Error(`join '+1+1' failed: ${jb.error}`);

  host.emit('host:start', pin);
  await sleep(150);
  await new Promise<void>((r) => a.emit('player:answer', pin, 1, () => r()));
  await new Promise<void>((r) => b.emit('player:answer', pin, 1, () => r()));
  await sleep(200);
  // question → reveal → final
  host.emit('host:advance', pin);
  await sleep(100);
  host.emit('host:advance', pin);
  await sleep(200);

  const final = await fetch(`${URL}/host/${pin}/results.csv`);
  if (final.status !== 200) {
    throw new Error(`expected 200 at final, got ${final.status}`);
  }
  const body = await final.text();
  // Neutralized cells start with a leading single-quote. None of the test
  // values contain CSV-special chars (",\n\r), so the cells appear bare —
  // not wrapped in double quotes.
  if (!body.includes(`'=cmd`)) {
    throw new Error(`CSV missing neutralized '=cmd:\n${body}`);
  }
  if (!body.includes(`'+1+1`)) {
    throw new Error(`CSV missing neutralized '+1+1:\n${body}`);
  }
  // sanity: the bare formula must NOT appear at the start of any cell.
  if (/(^|,)=cmd/.test(body)) {
    throw new Error(`CSV exposes raw =cmd at cell start:\n${body}`);
  }
  if (/(^|,)\+1\+1/.test(body)) {
    throw new Error(`CSV exposes raw +1+1 at cell start:\n${body}`);
  }
  console.log('✓ CSV formula injection neutralized (F10)');

  host.disconnect();
  a.disconnect();
  b.disconnect();
}

// --- scenario 15: word cloud happy path + CSV export ---

async function wcCreate(
  host: ReturnType<typeof io>,
  args: { prompt: string; wordsPerPlayer: number; profanityFilter: boolean },
) {
  // F6 fail-closed: socket-only creation is gone. Allocate + persist via the
  // shared lib (which is what the API route calls) and then bind the socket.
  const { allocatePin: allocateWcPin } = await import('../lib/pin-allocator');
  const { createSession } = await import('../lib/wordcloud-repo');
  const pin = await allocateWcPin();
  const created = await createSession({
    pin,
    prompt: args.prompt,
    wordsPerPlayer: args.wordsPerPlayer,
    profanityFilter: args.profanityFilter,
    hostUserId: null,
  });
  return new Promise<{ pin: string; sessionId: string }>((resolve, reject) => {
    host.emit(
      'wordcloud:host:create',
      { pin: created.pin, sessionId: created.id },
      (res: { pin?: string; sessionId?: string; error?: string }) => {
        if (!res.pin || !res.sessionId) {
          reject(new Error(`wordcloud:host:create failed: ${res.error ?? 'unknown'}`));
          return;
        }
        resolve({ pin: res.pin, sessionId: res.sessionId });
      },
    );
  });
}

async function wcJoinViaJoinPath(
  player: ReturnType<typeof io>,
  args: { pin: string; nickname: string },
) {
  // Mirror what /join does: HTTP precheck FIRST, then emit the wordcloud
  // socket event so a word-cloud PIN never tries the quiz flow (F1).
  const lookup = await fetch(`${URL}/api/lookup-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: args.pin }),
  });
  if (lookup.status !== 200) {
    throw new Error(`/api/lookup-pin failed for pin ${args.pin}: ${lookup.status}`);
  }
  const looked = (await lookup.json()) as { type?: string };
  if (looked.type !== 'wordcloud') {
    throw new Error(`expected lookup-pin to return wordcloud, got ${JSON.stringify(looked)}`);
  }
  return wcJoin(player, args);
}

async function wcJoin(player: ReturnType<typeof io>, args: { pin: string; nickname: string }) {
  return new Promise<{ playerId: string }>((resolve, reject) => {
    player.emit('wordcloud:player:join', args, (res: { playerId?: string; error?: string }) => {
      if (!res.playerId) {
        reject(new Error(`wordcloud:player:join failed: ${res.error ?? 'unknown'}`));
        return;
      }
      resolve({ playerId: res.playerId });
    });
  });
}

async function wcSetStatus(
  host: ReturnType<typeof io>,
  args: { pin: string; status: 'LOBBY' | 'LIVE' | 'PAUSED' | 'ENDED' },
) {
  host.emit('wordcloud:host:set-status', args);
  await sleep(150);
}

async function wcSubmit(
  player: ReturnType<typeof io>,
  args: { pin: string; playerId: string; word: string },
) {
  return new Promise<{ accepted: boolean; rejection?: { reason: string } }>((resolve) => {
    let resolved = false;
    const onAdded = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({ accepted: true });
    };
    const onRejected = (payload: { reason: string }) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({ accepted: false, rejection: payload });
    };
    function cleanup() {
      player.off('wordcloud:word:added', onAdded);
      player.off('wordcloud:player:rejected', onRejected);
      clearTimeout(t);
    }
    const t = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({ accepted: false, rejection: { reason: 'timeout' } });
    }, 3000);
    player.on('wordcloud:word:added', onAdded);
    player.on('wordcloud:player:rejected', onRejected);
    player.emit('wordcloud:player:submit', args);
  });
}

async function assertWordCloudHappyPath() {
  console.log('\n--- scenario 15: word cloud happy path + CSV export ---');
  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();

  const created = await wcCreate(host, {
    prompt: 'What snack?',
    wordsPerPlayer: 3,
    profanityFilter: true,
  });
  const { pin } = created;
  console.log('wc pin:', pin);

  const ja = await wcJoinViaJoinPath(a, { pin, nickname: 'Alice' });
  const jb = await wcJoinViaJoinPath(b, { pin, nickname: 'Bob' });

  await wcSetStatus(host, { pin, status: 'LIVE' });

  const aliceWords = ['apples', 'bananas', 'cherries'];
  const bobWords = ['donuts', 'eggrolls', 'fries'];

  for (const w of aliceWords) {
    const r = await wcSubmit(a, { pin, playerId: ja.playerId, word: w });
    if (!r.accepted) {
      throw new Error(`Alice submit '${w}' rejected: ${r.rejection?.reason}`);
    }
    await sleep(900);
  }
  for (const w of bobWords) {
    const r = await wcSubmit(b, { pin, playerId: jb.playerId, word: w });
    if (!r.accepted) {
      throw new Error(`Bob submit '${w}' rejected: ${r.rejection?.reason}`);
    }
    await sleep(900);
  }

  await wcSetStatus(host, { pin, status: 'ENDED' });
  // give fire-and-forget DB writes a moment to flush
  await sleep(500);

  const res = await fetch(`${URL}/host/wordcloud/${pin}/answers.csv`);
  if (res.status !== 200) {
    throw new Error(`expected 200, got ${res.status}`);
  }
  const ctype = res.headers.get('content-type') ?? '';
  if (!ctype.toLowerCase().includes('text/csv')) {
    throw new Error(`expected text/csv, got ${ctype}`);
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  if (!disposition.includes('wordcloud-') || !disposition.includes(pin)) {
    throw new Error(`bad Content-Disposition: ${disposition}`);
  }
  const body = await res.text();
  const rows = body.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (rows.length !== 7) {
    throw new Error(`expected 7 lines (header + 6 data), got ${rows.length}:\n${body}`);
  }
  if (rows[0] !== 'timestamp,nickname,raw_text,normalized,removed') {
    throw new Error(`bad header row: ${rows[0]}`);
  }
  const allWords = [...aliceWords, ...bobWords];
  for (const w of allWords) {
    if (!body.includes(`,${w},`)) {
      throw new Error(`CSV missing rawText '${w}':\n${body}`);
    }
  }
  for (const row of rows.slice(1)) {
    if (!row.endsWith(',false')) {
      throw new Error(`expected removed=false on every row, got: ${row}`);
    }
  }
  console.log('✓ word cloud happy path + CSV export');

  host.disconnect();
  a.disconnect();
  b.disconnect();
}

// --- scenario 16: word cloud profanity rejection ---

async function assertWordCloudProfanityRejection() {
  console.log('\n--- scenario 16: word cloud profanity rejection ---');
  const host = await connectSock();
  const a = await connectSock();

  const { pin } = await wcCreate(host, {
    prompt: 'Test prompt',
    wordsPerPlayer: 3,
    profanityFilter: true,
  });
  await wcSetStatus(host, { pin, status: 'LIVE' });
  const ja = await wcJoin(a, { pin, nickname: 'Alice' });

  // 'piss' is in lib/profanity.ts BAD_WORDS — short, mild, unambiguously filtered
  const r = await wcSubmit(a, { pin, playerId: ja.playerId, word: 'piss' });
  if (r.accepted) throw new Error('profane submit unexpectedly accepted');
  if (r.rejection?.reason !== 'filter') {
    throw new Error(`expected reason 'filter', got '${r.rejection?.reason}'`);
  }

  // attach as host to read state and verify zero words
  const stateP = new Promise<{ words: { count: number }[] }>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no wordcloud:state')), 3000);
    host.once('wordcloud:state', (s: { words: { count: number }[] }) => {
      clearTimeout(t);
      resolve(s);
    });
  });
  host.emit('wordcloud:display:attach', pin);
  const wcState = await stateP;
  if (wcState.words.length !== 0) {
    throw new Error(`expected 0 words after filter, got ${wcState.words.length}`);
  }
  console.log('✓ word cloud profanity rejection');

  host.disconnect();
  a.disconnect();
}

// --- scenario 18 (MID-334): Q&A socket foundation ---

type QaDisplaySettings = {
  sort: 'popular' | 'recent' | 'oldest';
  labelFilter: string | null;
  visibleCount: number;
  showTicker: boolean;
  highlightFullscreen: boolean;
};

type QaPublicSnapshot = {
  pin: string;
  title: string;
  participantCount: number;
  questionCount: number;
  highlightedQuestionId: string | null;
  status: 'OPEN' | 'CLOSED' | 'ENDED';
  submissionsOpen: boolean;
  votingOpen: boolean;
  labels: { id: string; name: string; participantSelectable: boolean }[];
  displaySettings: QaDisplaySettings;
  questions: {
    id: string;
    text: string;
    isAnonymous: boolean;
    authorDisplayName: string | null;
    score: number;
    upvotes: number;
    downvotes: number;
    labelIds: string[];
    highlighted: boolean;
  }[];
};

type QaJoinAck =
  | {
      participantId: string;
      reconnected: boolean;
      state: QaPublicSnapshot;
      personal: { participantId: string; displayName: string | null };
    }
  | { error: string };

async function qaCreateSession(args?: {
  privacyMode?: 'ANONYMOUS_BY_DEFAULT' | 'ALWAYS_ANONYMOUS' | 'NAMED_BY_DEFAULT' | 'NAME_REQUIRED';
  hostUserId?: string | null;
  moderationEnabled?: boolean;
  participantRepliesEnabled?: boolean;
  downvotesEnabled?: boolean;
  questionCharLimit?: number;
}) {
  // Mirror wcCreate: allocate + persist via the shared libs (what the API
  // route at /api/q-and-a does), then bind sockets via qa:host:attach.
  const { allocatePin: allocateQaPin } = await import('../lib/pin-allocator');
  const { createSession: createQaSession } = await import('../lib/qa-repo');
  const pin = await allocateQaPin();
  const created = await createQaSession({
    pin,
    title: 'Smoke Q&A',
    privacyMode: args?.privacyMode ?? 'ANONYMOUS_BY_DEFAULT',
    hostUserId: args?.hostUserId ?? null,
    moderationEnabled: args?.moderationEnabled ?? false,
    participantRepliesEnabled: args?.participantRepliesEnabled ?? false,
    downvotesEnabled: args?.downvotesEnabled ?? false,
    questionCharLimit: args?.questionCharLimit,
  });
  return { pin: created.pin, sessionId: created.id };
}

function qaEmit<T>(sock: ReturnType<typeof io>, event: string, payload: unknown) {
  return new Promise<T | { error: string }>((r) => sock.emit(event, payload, r));
}

function qaWaitForState(sock: ReturnType<typeof io>, predicate: (s: QaPublicSnapshot) => boolean) {
  return new Promise<QaPublicSnapshot>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no matching qa:state broadcast')), 3000);
    sock.on('qa:state', function onState(s: QaPublicSnapshot) {
      if (predicate(s)) {
        sock.off('qa:state', onState);
        clearTimeout(t);
        resolve(s);
      }
    });
  });
}

function qaWaitForDisplaySettings(
  sock: ReturnType<typeof io>,
  predicate: (settings: QaDisplaySettings) => boolean,
) {
  return new Promise<QaDisplaySettings>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error('no matching qa:display:settings broadcast')),
      3000,
    );
    sock.on('qa:display:settings', function onSettings(settings: QaDisplaySettings) {
      if (predicate(settings)) {
        sock.off('qa:display:settings', onSettings);
        clearTimeout(t);
        resolve(settings);
      }
    });
  });
}

async function assertQaSocketFoundation() {
  console.log('\n--- scenario 18 (MID-334): Q&A socket foundation ---');
  const prisma = new PrismaClient();
  const host = await connectSock();
  const display = await connectSock();
  const alice = await connectSock();
  const probe = await connectSock();
  let host2: ReturnType<typeof io> | null = null;
  let alice2: ReturnType<typeof io> | null = null;
  try {
    const { pin, sessionId } = await qaCreateSession();
    console.log('qa pin:', pin);

    // host attach: ack carries the hydrated public state
    const hostAck = await qaEmit<{ pin: string; sessionId: string; state: QaPublicSnapshot }>(
      host,
      'qa:host:attach',
      { pin, sessionId },
    );
    if ('error' in hostAck) throw new Error(`qa:host:attach failed: ${hostAck.error}`);
    if (hostAck.state.title !== 'Smoke Q&A' || hostAck.state.pin !== pin) {
      throw new Error(`bad host attach state: ${JSON.stringify(hostAck.state)}`);
    }

    // host attach with a mismatched sessionId is rejected
    const mismatch = await qaEmit<{ pin: string }>(host, 'qa:host:attach', {
      pin,
      sessionId: 'wrong-session',
    });
    if (!('error' in mismatch) || mismatch.error !== 'session_mismatch') {
      throw new Error(`expected session_mismatch, got ${JSON.stringify(mismatch)}`);
    }

    // display attach: public state only
    const dispAck = await qaEmit<{ state: QaPublicSnapshot }>(display, 'qa:display:attach', {
      pin,
    });
    if ('error' in dispAck) throw new Error(`qa:display:attach failed: ${dispAck.error}`);
    if (dispAck.state.participantCount !== 0) {
      throw new Error(`expected participantCount 0, got ${dispAck.state.participantCount}`);
    }

    // participant join broadcasts the public projection to host + display
    const hostSawJoin = qaWaitForState(host, (s) => s.participantCount === 1);
    const displaySawJoin = qaWaitForState(display, (s) => s.participantCount === 1);
    const joinAck = (await qaEmit(alice, 'qa:participant:join', {
      pin,
      displayName: 'Alice',
    })) as QaJoinAck;
    if ('error' in joinAck) throw new Error(`qa:participant:join failed: ${joinAck.error}`);
    if (joinAck.reconnected) throw new Error('fresh join must not be flagged reconnected');
    if (joinAck.personal.displayName !== 'Alice') {
      throw new Error(`expected personal displayName Alice, got ${joinAck.personal.displayName}`);
    }
    await hostSawJoin;
    await displaySawJoin;

    // reconnect with stored participantId rebinds without a duplicate row
    const rowsBefore = await prisma.qAParticipant.count({ where: { sessionId } });
    alice.disconnect();
    await sleep(100);
    alice2 = await connectSock();
    const rejoinAck = (await qaEmit(alice2, 'qa:participant:join', {
      pin,
      participantId: joinAck.participantId,
    })) as QaJoinAck;
    if ('error' in rejoinAck) throw new Error(`qa reconnect failed: ${rejoinAck.error}`);
    if (!rejoinAck.reconnected) throw new Error('expected reconnected: true');
    if (rejoinAck.participantId !== joinAck.participantId) {
      throw new Error(
        `expected same participantId, got ${rejoinAck.participantId} vs ${joinAck.participantId}`,
      );
    }
    const rowsAfter = await prisma.qAParticipant.count({ where: { sessionId } });
    if (rowsAfter !== rowsBefore) {
      throw new Error(`reconnect created a duplicate QAParticipant: ${rowsBefore} → ${rowsAfter}`);
    }

    // HMR/dev edge: host returns on a NEW socket, re-attaches, and must land
    // back in qa:${pin} — broadcasts go to the new socket, not the orphan.
    host.disconnect();
    await sleep(100);
    host2 = await connectSock();
    const reattach = await qaEmit<{ pin: string; state: QaPublicSnapshot }>(
      host2,
      'qa:host:attach',
      { pin, sessionId },
    );
    if ('error' in reattach) throw new Error(`host re-attach failed: ${reattach.error}`);
    const host2SawJoin = qaWaitForState(host2, (s) => s.participantCount === 2);
    const bobAck = (await qaEmit(probe, 'qa:participant:join', {
      pin,
      displayName: 'Bob',
    })) as QaJoinAck;
    if ('error' in bobAck) throw new Error(`Bob join failed: ${bobAck.error}`);
    await host2SawJoin;

    // unknown PIN rejected with a clear reason
    const ghostJoin = (await qaEmit(probe, 'qa:participant:join', {
      pin: '000000',
      displayName: 'Ghost',
    })) as QaJoinAck;
    if (!('error' in ghostJoin) || ghostJoin.error !== 'not_found') {
      throw new Error(`expected not_found, got ${JSON.stringify(ghostJoin)}`);
    }

    // NAME_REQUIRED rejects a missing name
    const named = await qaCreateSession({ privacyMode: 'NAME_REQUIRED' });
    const noName = (await qaEmit(probe, 'qa:participant:join', { pin: named.pin })) as QaJoinAck;
    if (!('error' in noName) || noName.error !== 'name_required') {
      throw new Error(`expected name_required, got ${JSON.stringify(noName)}`);
    }

    // ALWAYS_ANONYMOUS never stores the provided name (memory or DB)
    const anon = await qaCreateSession({ privacyMode: 'ALWAYS_ANONYMOUS' });
    const anonJoin = (await qaEmit(probe, 'qa:participant:join', {
      pin: anon.pin,
      displayName: 'Bob',
    })) as QaJoinAck;
    if ('error' in anonJoin) throw new Error(`anonymous join failed: ${anonJoin.error}`);
    if (anonJoin.personal.displayName !== null) {
      throw new Error(`ALWAYS_ANONYMOUS stored a name: ${anonJoin.personal.displayName}`);
    }
    const anonRow = await prisma.qAParticipant.findUnique({
      where: { id: anonJoin.participantId },
    });
    if (!anonRow || anonRow.displayName !== null) {
      throw new Error(`ALWAYS_ANONYMOUS persisted a name: ${JSON.stringify(anonRow)}`);
    }

    // owned session: an anonymous socket cannot attach as host
    const owner = await prisma.user.upsert({
      where: { email: 'qa-smoke@example.com' },
      update: {},
      create: { email: 'qa-smoke@example.com' },
    });
    const owned = await qaCreateSession({ hostUserId: owner.id });
    const forbidden = await qaEmit<{ pin: string }>(probe, 'qa:host:attach', {
      pin: owned.pin,
      sessionId: owned.sessionId,
    });
    if (!('error' in forbidden) || forbidden.error !== 'forbidden') {
      throw new Error(`expected forbidden, got ${JSON.stringify(forbidden)}`);
    }

    console.log('✓ Q&A socket foundation (MID-334)');
  } finally {
    host.disconnect();
    display.disconnect();
    alice.disconnect();
    probe.disconnect();
    host2?.disconnect();
    alice2?.disconnect();
    await prisma.$disconnect();
  }
}

// --- scenario 19 (MID-335): Q&A participant submit/withdraw/edit ---

type QaPersonalSnapshot = {
  participantId: string;
  displayName: string | null;
  questions: {
    id: string;
    text: string;
    status: string;
    isAnonymous: boolean;
    replies?: { id: string; isHostReply: boolean; text: string }[];
  }[];
};

type QaActionAck =
  | { questionId: string; status: string; personal: QaPersonalSnapshot }
  | { error: string };

function qaOk<T>(res: T | { error: string }, label: string): T {
  if (res && typeof res === 'object' && 'error' in res) {
    throw new Error(`${label} failed: ${(res as { error: string }).error}`);
  }
  return res as T;
}

function qaExpectError(res: unknown, expected: string, label: string) {
  const error =
    res && typeof res === 'object' && 'error' in res ? (res as { error: string }).error : undefined;
  if (error !== expected) {
    throw new Error(`${label}: expected error '${expected}', got ${JSON.stringify(res)}`);
  }
}

async function assertQaParticipantFlow() {
  console.log('\n--- scenario 19 (MID-335): Q&A participant submit/withdraw/edit ---');
  const prisma = new PrismaClient();
  const host = await connectSock();
  const display = await connectSock();
  const alice = await connectSock();
  const bob = await connectSock();
  const probe = await connectSock();
  try {
    // -- moderation OFF: submit goes live and reaches the room without refresh
    const { pin, sessionId } = await qaCreateSession();
    console.log('qa participant-flow pin:', pin);
    qaOk(await qaEmit(host, 'qa:host:attach', { pin, sessionId }), 'qa:host:attach');
    qaOk(await qaEmit(display, 'qa:display:attach', { pin }), 'qa:display:attach');
    const aliceJoin = qaOk<Exclude<QaJoinAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:join', { pin, displayName: 'Alice' })) as QaJoinAck,
      'alice join',
    );
    qaOk(
      (await qaEmit(bob, 'qa:participant:join', { pin, displayName: 'Bob' })) as QaJoinAck,
      'bob join',
    );

    // empty/whitespace and over-limit submissions rejected server-side
    qaExpectError(
      await qaEmit(alice, 'qa:participant:submit', { pin, text: '   ' }),
      'empty_text',
      'whitespace submit',
    );
    qaExpectError(
      await qaEmit(alice, 'qa:participant:submit', { pin, text: 'a'.repeat(281) }),
      'text_too_long',
      'over-limit submit',
    );

    // anonymous submit: live immediately, no author name in the public state
    const displaySawQ1 = qaWaitForState(display, (s) => s.questionCount === 1);
    const sub1 = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:submit', {
        pin,
        text: 'What is the roadmap?',
        isAnonymous: true,
      })) as QaActionAck,
      'anonymous submit',
    );
    if (sub1.status !== 'LIVE') throw new Error(`expected LIVE, got ${sub1.status}`);
    const snap1 = await displaySawQ1;
    const pubQ1 = snap1.questions.find((q) => q.id === sub1.questionId);
    if (!pubQ1 || pubQ1.text !== 'What is the roadmap?') {
      throw new Error(`public board missing question: ${JSON.stringify(snap1.questions)}`);
    }
    if (!pubQ1.isAnonymous || pubQ1.authorDisplayName !== null) {
      throw new Error(`anonymous question leaked identity: ${JSON.stringify(pubQ1)}`);
    }

    // rapid-fire second submit is rate limited with a clear error
    qaExpectError(
      await qaEmit(alice, 'qa:participant:submit', { pin, text: 'Too fast?' }),
      'rate_limited',
      'rapid-fire submit',
    );

    // after the window, a named submit carries the display name publicly
    await sleep(1100);
    const displaySawQ2 = qaWaitForState(display, (s) => s.questionCount === 2);
    const sub2 = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:submit', {
        pin,
        text: 'Named question?',
        isAnonymous: false,
      })) as QaActionAck,
      'named submit',
    );
    const snap2 = await displaySawQ2;
    const pubQ2 = snap2.questions.find((q) => q.id === sub2.questionId);
    if (!pubQ2 || pubQ2.isAnonymous || pubQ2.authorDisplayName !== 'Alice') {
      throw new Error(`named question lost its author: ${JSON.stringify(pubQ2)}`);
    }

    // a non-owner cannot withdraw someone else's question
    qaExpectError(
      await qaEmit(bob, 'qa:participant:withdraw', { pin, questionId: sub1.questionId }),
      'not_owner',
      'non-owner withdraw',
    );

    // owner withdraws: leaves the public board, persists WITHDRAWN
    const displaySawWithdraw = qaWaitForState(display, (s) => s.questionCount === 1);
    const wd = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:withdraw', {
        pin,
        questionId: sub1.questionId,
      })) as QaActionAck,
      'owner withdraw',
    );
    if (wd.status !== 'WITHDRAWN') throw new Error(`expected WITHDRAWN, got ${wd.status}`);
    const wdPersonal = wd.personal.questions.find((q) => q.id === sub1.questionId);
    if (wdPersonal?.status !== 'WITHDRAWN') {
      throw new Error(`personal state missing WITHDRAWN: ${JSON.stringify(wd.personal)}`);
    }
    await displaySawWithdraw;
    const wdRow = await prisma.qAQuestion.findUnique({ where: { id: sub1.questionId } });
    if (wdRow?.status !== 'WITHDRAWN' || wdRow.withdrawnAt === null) {
      throw new Error(`DB row not WITHDRAWN: ${JSON.stringify(wdRow)}`);
    }

    // edit of a live question (moderation off): board text updates, stays LIVE
    const displaySawEdit = qaWaitForState(display, (s) =>
      s.questions.some((q) => q.text === 'Named question, edited?'),
    );
    const edit = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:edit', {
        pin,
        questionId: sub2.questionId,
        text: 'Named question, edited?',
      })) as QaActionAck,
      'live edit',
    );
    if (edit.status !== 'LIVE') throw new Error(`expected LIVE after edit, got ${edit.status}`);
    await displaySawEdit;
    const editRow = await prisma.qAQuestion.findUnique({ where: { id: sub2.questionId } });
    if (editRow?.text !== 'Named question, edited?' || editRow.originalText !== 'Named question?') {
      throw new Error(`edit not persisted with audit text: ${JSON.stringify(editRow)}`);
    }

    // a participant cannot edit someone else's question
    qaExpectError(
      await qaEmit(bob, 'qa:participant:edit', {
        pin,
        questionId: sub2.questionId,
        text: 'hijacked',
      }),
      'not_owner',
      'non-owner edit',
    );

    // -- moderation ON: submission waits for review and never reaches the room
    // (the LIVE->IN_REVIEW edit demotion needs host approve, which ships with
    // the moderation queue ticket; lib/qa.test.ts covers that transition.)
    const mod = await qaCreateSession({ moderationEnabled: true });
    qaOk(
      (await qaEmit(probe, 'qa:participant:join', {
        pin: mod.pin,
        displayName: 'Cara',
      })) as QaJoinAck,
      'cara join',
    );
    const modSub = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(probe, 'qa:participant:submit', {
        pin: mod.pin,
        text: 'Moderate me?',
      })) as QaActionAck,
      'moderated submit',
    );
    if (modSub.status !== 'IN_REVIEW') {
      throw new Error(`expected IN_REVIEW, got ${modSub.status}`);
    }
    const modPersonal = modSub.personal.questions.find((q) => q.id === modSub.questionId);
    if (modPersonal?.status !== 'IN_REVIEW') {
      throw new Error(`personal state missing IN_REVIEW: ${JSON.stringify(modSub.personal)}`);
    }
    const modBoard = qaOk<{ state: QaPublicSnapshot }>(
      (await qaEmit(host, 'qa:display:attach', { pin: mod.pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'moderated display attach',
    );
    if (modBoard.state.questionCount !== 0 || modBoard.state.questions.length !== 0) {
      throw new Error(`in-review question leaked publicly: ${JSON.stringify(modBoard.state)}`);
    }
    // editing while pending keeps it in review
    const modEdit = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(probe, 'qa:participant:edit', {
        pin: mod.pin,
        questionId: modSub.questionId,
        text: 'Moderate me, edited?',
      })) as QaActionAck,
      'pending edit',
    );
    if (modEdit.status !== 'IN_REVIEW') {
      throw new Error(`expected IN_REVIEW after pending edit, got ${modEdit.status}`);
    }

    // -- ALWAYS_ANONYMOUS: identity never persists or leaks, even if requested
    const anon = await qaCreateSession({ privacyMode: 'ALWAYS_ANONYMOUS' });
    qaOk(
      (await qaEmit(bob, 'qa:participant:join', {
        pin: anon.pin,
        displayName: 'Bob',
      })) as QaJoinAck,
      'anon join',
    );
    const anonSub = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(bob, 'qa:participant:submit', {
        pin: anon.pin,
        text: 'Who am I?',
        isAnonymous: false,
      })) as QaActionAck,
      'anon submit',
    );
    const anonRow = await prisma.qAQuestion.findUnique({ where: { id: anonSub.questionId } });
    if (!anonRow?.isAnonymous || anonRow.authorDisplayName !== null) {
      throw new Error(`ALWAYS_ANONYMOUS persisted identity: ${JSON.stringify(anonRow)}`);
    }
    const anonBoard = qaOk<{ state: QaPublicSnapshot }>(
      (await qaEmit(host, 'qa:display:attach', { pin: anon.pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'anon display attach',
    );
    const anonPub = anonBoard.state.questions.find((q) => q.id === anonSub.questionId);
    if (!anonPub?.isAnonymous || anonPub.authorDisplayName !== null) {
      throw new Error(`ALWAYS_ANONYMOUS leaked identity publicly: ${JSON.stringify(anonPub)}`);
    }

    // foundation still intact: alice reconnects with her stored participantId
    const aliceAgain = (await qaEmit(alice, 'qa:participant:join', {
      pin,
      participantId: aliceJoin.participantId,
    })) as QaJoinAck;
    if ('error' in aliceAgain || !aliceAgain.reconnected) {
      throw new Error(`reconnect regressed: ${JSON.stringify(aliceAgain)}`);
    }

    console.log('✓ Q&A participant submit/withdraw/edit (MID-335)');
  } finally {
    host.disconnect();
    display.disconnect();
    alice.disconnect();
    bob.disconnect();
    probe.disconnect();
    await prisma.$disconnect();
  }
}

// --- scenario 20 (MID-336): Q&A voting ---

type QaVoteAck =
  | {
      questionId: string;
      vote: 'UP' | 'DOWN' | null;
      score: number;
      upvotes: number;
      downvotes: number;
    }
  | { error: string };

type QaScoresEvent = {
  pin: string;
  scores: { questionId: string; score: number; upvotes: number; downvotes: number }[];
};

function qaWaitForScores(sock: ReturnType<typeof io>, predicate: (e: QaScoresEvent) => boolean) {
  return new Promise<QaScoresEvent>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no matching qa:scores delta')), 3000);
    sock.on('qa:scores', function onScores(e: QaScoresEvent) {
      if (predicate(e)) {
        sock.off('qa:scores', onScores);
        clearTimeout(t);
        resolve(e);
      }
    });
  });
}

async function assertQaVoting() {
  console.log('\n--- scenario 20 (MID-336): Q&A voting ---');
  const prisma = new PrismaClient();
  const host = await connectSock();
  const display = await connectSock();
  const alice = await connectSock();
  const bob = await connectSock();
  let bob2: ReturnType<typeof io> | null = null;
  const burstVoters: ReturnType<typeof io>[] = [];
  try {
    const { pin, sessionId } = await qaCreateSession();
    console.log('qa voting pin:', pin);
    qaOk(await qaEmit(host, 'qa:host:attach', { pin, sessionId }), 'qa:host:attach');
    qaOk(await qaEmit(display, 'qa:display:attach', { pin }), 'qa:display:attach');
    qaOk(
      (await qaEmit(alice, 'qa:participant:join', { pin, displayName: 'Alice' })) as QaJoinAck,
      'alice join',
    );
    const bobJoin = qaOk<Exclude<QaJoinAck, { error: string }>>(
      (await qaEmit(bob, 'qa:participant:join', { pin, displayName: 'Bob' })) as QaJoinAck,
      'bob join',
    );

    const sub1 = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:submit', { pin, text: 'Vote for me?' })) as QaActionAck,
      'alice submit q1',
    );
    await sleep(1100); // submit rate-limit window
    const sub2 = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:submit', { pin, text: 'Or for me?' })) as QaActionAck,
      'alice submit q2',
    );

    // upvote: ack carries server-derived counts; the room gets a coalesced
    // qa:scores delta (not a full qa:state) without refresh
    const sawScore1 = qaWaitForScores(display, (e) =>
      e.scores.some((s) => s.questionId === sub1.questionId && s.score === 1),
    );
    const v1 = qaOk<Exclude<QaVoteAck, { error: string }>>(
      (await qaEmit(bob, 'qa:participant:vote', {
        pin,
        questionId: sub1.questionId,
        type: 'UP',
      })) as QaVoteAck,
      'bob upvote',
    );
    if (v1.vote !== 'UP' || v1.score !== 1 || v1.upvotes !== 1) {
      throw new Error(`bad upvote ack: ${JSON.stringify(v1)}`);
    }
    await sawScore1;

    // idempotent repeat from the same participant: still one vote
    const v2 = qaOk<Exclude<QaVoteAck, { error: string }>>(
      (await qaEmit(bob, 'qa:participant:vote', {
        pin,
        questionId: sub1.questionId,
        type: 'UP',
      })) as QaVoteAck,
      'bob repeat upvote',
    );
    if (v2.score !== 1) throw new Error(`repeat vote double-counted: ${JSON.stringify(v2)}`);

    // second tab / reconnect: same participantId on a NEW socket cannot
    // double-count (in-memory map + DB unique constraint)
    bob2 = await connectSock();
    qaOk(
      (await qaEmit(bob2, 'qa:participant:join', {
        pin,
        participantId: bobJoin.participantId,
      })) as QaJoinAck,
      'bob second-tab join',
    );
    const v3 = qaOk<Exclude<QaVoteAck, { error: string }>>(
      (await qaEmit(bob2, 'qa:participant:vote', {
        pin,
        questionId: sub1.questionId,
        type: 'UP',
      })) as QaVoteAck,
      'bob second-tab upvote',
    );
    if (v3.score !== 1) throw new Error(`second tab double-counted: ${JSON.stringify(v3)}`);
    const voteRows = await prisma.qAVote.count({ where: { questionId: sub1.questionId } });
    if (voteRows !== 1) {
      throw new Error(`expected 1 QAVote row after reconnect votes, got ${voteRows}`);
    }

    // removing the vote decrements the score
    const sawRemove = qaWaitForScores(display, (e) =>
      e.scores.some((s) => s.questionId === sub1.questionId && s.score === 0),
    );
    const v4 = qaOk<Exclude<QaVoteAck, { error: string }>>(
      (await qaEmit(bob2, 'qa:participant:vote', {
        pin,
        questionId: sub1.questionId,
        type: null,
      })) as QaVoteAck,
      'bob remove vote',
    );
    if (v4.vote !== null || v4.score !== 0) {
      throw new Error(`bad remove ack: ${JSON.stringify(v4)}`);
    }
    await sawRemove;
    const rowsAfterRemove = await prisma.qAVote.count({ where: { questionId: sub1.questionId } });
    if (rowsAfterRemove !== 0) {
      throw new Error(`expected 0 QAVote rows after removal, got ${rowsAfterRemove}`);
    }

    // downvotes rejected while the session has them disabled
    qaExpectError(
      await qaEmit(bob2, 'qa:participant:vote', { pin, questionId: sub1.questionId, type: 'DOWN' }),
      'downvotes_disabled',
      'downvote while disabled',
    );

    // unknown question / unbound socket rejected with clear reasons
    qaExpectError(
      await qaEmit(bob2, 'qa:participant:vote', { pin, questionId: 'nope', type: 'UP' }),
      'unknown_question',
      'vote on unknown question',
    );
    qaExpectError(
      await qaEmit(display, 'qa:participant:vote', {
        pin,
        questionId: sub1.questionId,
        type: 'UP',
      }),
      'unknown_participant',
      'vote from unbound socket',
    );

    // non-LIVE question (moderation queue) rejects votes
    const mod = await qaCreateSession({ moderationEnabled: true });
    qaOk(
      (await qaEmit(bob, 'qa:participant:join', { pin: mod.pin, displayName: 'Bob' })) as QaJoinAck,
      'bob joins moderated session',
    );
    const modSub = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(bob, 'qa:participant:submit', {
        pin: mod.pin,
        text: 'Pending question',
      })) as QaActionAck,
      'moderated submit',
    );
    qaExpectError(
      await qaEmit(bob, 'qa:participant:vote', {
        pin: mod.pin,
        questionId: modSub.questionId,
        type: 'UP',
      }),
      'not_live',
      'vote on in-review question',
    );

    // burst: 6 voters fire at once → coalesced qa:scores deltas (not one
    // room-wide emit per vote, and zero full-state emits)
    for (let i = 0; i < 6; i++) {
      const sock = await connectSock();
      burstVoters.push(sock);
      qaOk(
        (await qaEmit(sock, 'qa:participant:join', {
          pin,
          displayName: `V${i + 1}`,
        })) as QaJoinAck,
        `voter ${i + 1} join`,
      );
    }
    await sleep(400); // let membership broadcasts settle before counting
    let scoresEmits = 0;
    let stateEmits = 0;
    const countScores = () => {
      scoresEmits += 1;
    };
    const countState = () => {
      stateEmits += 1;
    };
    display.on('qa:scores', countScores);
    display.on('qa:state', countState);
    await Promise.all(
      burstVoters.map((sock, i) =>
        qaEmit(sock, 'qa:participant:vote', {
          pin,
          // 4 votes land on q2, 2 on q1 → q2 must outrank q1
          questionId: i < 4 ? sub2.questionId : sub1.questionId,
          type: 'UP',
        }).then((res) => qaOk(res as QaVoteAck, `burst vote ${i + 1}`)),
      ),
    );
    await sleep(600); // > BROADCAST_COALESCE_MS so the delta flushes
    display.off('qa:scores', countScores);
    display.off('qa:state', countState);
    if (scoresEmits < 1 || scoresEmits > 2) {
      throw new Error(`expected 1-2 coalesced qa:scores emits for the burst, got ${scoresEmits}`);
    }
    if (stateEmits !== 0) {
      throw new Error(`vote burst triggered ${stateEmits} full qa:state emits`);
    }

    // popular order: a fresh snapshot has q2 (4 votes) above q1 (2 votes)
    const board = qaOk<{ state: QaPublicSnapshot }>(
      (await qaEmit(display, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'post-burst display attach',
    );
    const [top, second] = board.state.questions;
    if (top?.id !== sub2.questionId || top.score !== 4 || second?.score !== 2) {
      throw new Error(`bad popular order after burst: ${JSON.stringify(board.state.questions)}`);
    }

    // downvotes enabled: DOWN counts against the score and switching UP↔DOWN
    // adjusts it without a second row
    const dv = await qaCreateSession({ downvotesEnabled: true });
    qaOk(
      (await qaEmit(alice, 'qa:participant:join', {
        pin: dv.pin,
        displayName: 'Alice',
      })) as QaJoinAck,
      'alice joins downvote session',
    );
    const dvSub = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:submit', {
        pin: dv.pin,
        text: 'Downvote me?',
      })) as QaActionAck,
      'downvote-session submit',
    );
    const dvDown = qaOk<Exclude<QaVoteAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:vote', {
        pin: dv.pin,
        questionId: dvSub.questionId,
        type: 'DOWN',
      })) as QaVoteAck,
      'downvote',
    );
    if (dvDown.score !== -1 || dvDown.downvotes !== 1) {
      throw new Error(`bad downvote ack: ${JSON.stringify(dvDown)}`);
    }
    const dvSwitch = qaOk<Exclude<QaVoteAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:vote', {
        pin: dv.pin,
        questionId: dvSub.questionId,
        type: 'UP',
      })) as QaVoteAck,
      'switch DOWN→UP',
    );
    if (dvSwitch.score !== 1 || dvSwitch.upvotes !== 1 || dvSwitch.downvotes !== 0) {
      throw new Error(`bad switch ack: ${JSON.stringify(dvSwitch)}`);
    }
    const dvRow = await prisma.qAVote.findMany({ where: { questionId: dvSub.questionId } });
    if (dvRow.length !== 1 || dvRow[0].type !== 'UP') {
      throw new Error(`switch persisted wrong: ${JSON.stringify(dvRow)}`);
    }

    console.log('✓ Q&A voting (MID-336)');
  } finally {
    host.disconnect();
    display.disconnect();
    alice.disconnect();
    bob.disconnect();
    bob2?.disconnect();
    for (const sock of burstVoters) sock.disconnect();
    await prisma.$disconnect();
  }
}

// --- scenario 21 (MID-338): Q&A moderation queue ---

type QaHostSnapshot = {
  pin: string;
  counts: {
    live: number;
    inReview: number;
    answered: number;
    archived: number;
    dismissed: number;
  };
  questions: { id: string; text: string; status: string }[];
};

type QaModerationAck =
  | { ok: true; questionId: string; status: string }
  | { ok: true; questionIds: string[]; failed: { questionId: string; error: string }[] }
  | { error: string };

function qaWaitForHostState(
  sock: ReturnType<typeof io>,
  predicate: (s: QaHostSnapshot) => boolean,
) {
  return new Promise<QaHostSnapshot>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no matching qa:host:state emit')), 3000);
    sock.on('qa:host:state', function onState(s: QaHostSnapshot) {
      if (predicate(s)) {
        sock.off('qa:host:state', onState);
        clearTimeout(t);
        resolve(s);
      }
    });
  });
}

function qaWaitForPersonal(
  sock: ReturnType<typeof io>,
  predicate: (p: QaPersonalSnapshot) => boolean,
) {
  return new Promise<QaPersonalSnapshot>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no matching qa:personal emit')), 3000);
    sock.on('qa:personal', function onPersonal(p: QaPersonalSnapshot) {
      if (predicate(p)) {
        sock.off('qa:personal', onPersonal);
        clearTimeout(t);
        resolve(p);
      }
    });
  });
}

async function assertQaModerationQueue() {
  console.log('\n--- scenario 21 (MID-338): Q&A moderation queue ---');
  const prisma = new PrismaClient();
  const host = await connectSock();
  const display = await connectSock();
  const alice = await connectSock();
  const bob = await connectSock();
  try {
    const { pin, sessionId } = await qaCreateSession({ moderationEnabled: true });
    console.log('qa moderation pin:', pin);
    qaOk(await qaEmit(host, 'qa:host:attach', { pin, sessionId }), 'qa:host:attach');
    const dispAck = qaOk<{ state: QaPublicSnapshot }>(
      (await qaEmit(display, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'qa:display:attach',
    );
    if (dispAck.state.questionCount !== 0) {
      throw new Error(`expected empty board, got ${dispAck.state.questionCount}`);
    }
    qaOk(
      (await qaEmit(alice, 'qa:participant:join', { pin, displayName: 'Alice' })) as QaJoinAck,
      'alice join',
    );
    qaOk(
      (await qaEmit(bob, 'qa:participant:join', { pin, displayName: 'Bob' })) as QaJoinAck,
      'bob join',
    );

    // moderated submit lands IN_REVIEW: the host board updates (targeted
    // emit), the public room stays silent
    const hostSawQ1 = qaWaitForHostState(host, (s) => s.counts.inReview === 1);
    const sub1 = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:submit', {
        pin,
        text: 'Moderate me first?',
      })) as QaActionAck,
      'moderated submit q1',
    );
    if (sub1.status !== 'IN_REVIEW') throw new Error(`expected IN_REVIEW, got ${sub1.status}`);
    await hostSawQ1;
    const boardBeforeApprove = qaOk<{ state: QaPublicSnapshot }>(
      (await qaEmit(display, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'pre-approve display attach',
    );
    if (boardBeforeApprove.state.questionCount !== 0) {
      throw new Error(
        `in-review question leaked publicly: ${JSON.stringify(boardBeforeApprove.state)}`,
      );
    }

    // a non-host socket cannot moderate
    qaExpectError(
      await qaEmit(alice, 'qa:host:approve', { pin, questionId: sub1.questionId }),
      'forbidden',
      'non-host approve',
    );

    // approve: question goes public without refresh, owner gets a personal
    // push, DB has the status + moderation event
    const displaySawApprove = qaWaitForState(display, (s) => s.questionCount === 1);
    const aliceSawApprove = qaWaitForPersonal(alice, (p) =>
      p.questions.some((q) => q.id === sub1.questionId && q.status === 'LIVE'),
    );
    const approveAck = (await qaEmit(host, 'qa:host:approve', {
      pin,
      questionId: sub1.questionId,
    })) as QaModerationAck;
    if (!('ok' in approveAck) || !('status' in approveAck) || approveAck.status !== 'LIVE') {
      throw new Error(`bad approve ack: ${JSON.stringify(approveAck)}`);
    }
    const approveSnap = await displaySawApprove;
    if (!approveSnap.questions.some((q) => q.id === sub1.questionId)) {
      throw new Error(
        `approved question missing from public board: ${JSON.stringify(approveSnap)}`,
      );
    }
    await aliceSawApprove;
    const approvedRow = await prisma.qAQuestion.findUnique({ where: { id: sub1.questionId } });
    if (approvedRow?.status !== 'LIVE' || approvedRow.approvedAt === null) {
      throw new Error(`DB row not LIVE after approve: ${JSON.stringify(approvedRow)}`);
    }

    // approving a LIVE question is rejected
    qaExpectError(
      await qaEmit(host, 'qa:host:approve', { pin, questionId: sub1.questionId }),
      'invalid_transition',
      'double approve',
    );

    // dismiss: never public, owner sees DISMISSED, host board moves it to the
    // spike pile
    await sleep(1100); // submit rate-limit window
    const sub2 = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:submit', {
        pin,
        text: 'Dismiss me quietly?',
      })) as QaActionAck,
      'moderated submit q2',
    );
    const aliceSawDismiss = qaWaitForPersonal(alice, (p) =>
      p.questions.some((q) => q.id === sub2.questionId && q.status === 'DISMISSED'),
    );
    const hostSawDismiss = qaWaitForHostState(host, (s) => s.counts.dismissed === 1);
    const dismissAck = (await qaEmit(host, 'qa:host:dismiss', {
      pin,
      questionId: sub2.questionId,
    })) as QaModerationAck;
    if (!('ok' in dismissAck) || !('status' in dismissAck) || dismissAck.status !== 'DISMISSED') {
      throw new Error(`bad dismiss ack: ${JSON.stringify(dismissAck)}`);
    }
    await aliceSawDismiss;
    const hostDismissSnap = await hostSawDismiss;
    if (!hostDismissSnap.questions.some((q) => q.id === sub2.questionId)) {
      throw new Error('dismissed question missing from host board (not restorable)');
    }
    const boardAfterDismiss = qaOk<{ state: QaPublicSnapshot }>(
      (await qaEmit(display, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'post-dismiss display attach',
    );
    if (
      boardAfterDismiss.state.questionCount !== 1 ||
      JSON.stringify(boardAfterDismiss.state).includes('Dismiss me quietly?')
    ) {
      throw new Error(`dismissed question leaked: ${JSON.stringify(boardAfterDismiss.state)}`);
    }
    const dismissedRow = await prisma.qAQuestion.findUnique({ where: { id: sub2.questionId } });
    if (dismissedRow?.status !== 'DISMISSED' || dismissedRow.dismissedAt === null) {
      throw new Error(`DB row not DISMISSED: ${JSON.stringify(dismissedRow)}`);
    }

    // restore: dismissed question returns to IN_REVIEW (still private)
    const aliceSawRestore = qaWaitForPersonal(alice, (p) =>
      p.questions.some((q) => q.id === sub2.questionId && q.status === 'IN_REVIEW'),
    );
    const restoreAck = (await qaEmit(host, 'qa:host:restore', {
      pin,
      questionId: sub2.questionId,
    })) as QaModerationAck;
    if (!('ok' in restoreAck) || !('status' in restoreAck) || restoreAck.status !== 'IN_REVIEW') {
      throw new Error(`bad restore ack: ${JSON.stringify(restoreAck)}`);
    }
    await aliceSawRestore;
    const boardAfterRestore = qaOk<{ state: QaPublicSnapshot }>(
      (await qaEmit(display, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'post-restore display attach',
    );
    if (boardAfterRestore.state.questionCount !== 1) {
      throw new Error(
        `restored question leaked publicly: ${JSON.stringify(boardAfterRestore.state)}`,
      );
    }

    // restore is dismissed-only (MID-338): LIVE and IN_REVIEW questions are
    // rejected. ANSWERED/ARCHIVED -> LIVE restores belong to MID-339 and are
    // covered as unit negatives in lib/qa.test.ts.
    qaExpectError(
      await qaEmit(host, 'qa:host:restore', { pin, questionId: sub1.questionId }),
      'invalid_transition',
      'restore LIVE question',
    );
    qaExpectError(
      await qaEmit(host, 'qa:host:restore', { pin, questionId: sub2.questionId }),
      'invalid_transition',
      'restore IN_REVIEW question',
    );

    // bulk approve: q2 (restored) + a fresh bob question + one bogus id —
    // good ids go live together, the bogus one is reported, not fatal
    const sub3 = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(bob, 'qa:participant:submit', {
        pin,
        text: 'Bulk approve me too?',
      })) as QaActionAck,
      'moderated submit q3',
    );
    const displaySawBulkApprove = qaWaitForState(display, (s) => s.questionCount === 3);
    const bulkApproveAck = (await qaEmit(host, 'qa:host:approve', {
      pin,
      questionIds: [sub2.questionId, sub3.questionId, 'qaq_bogus'],
    })) as QaModerationAck;
    if (
      !('ok' in bulkApproveAck) ||
      !('questionIds' in bulkApproveAck) ||
      bulkApproveAck.questionIds.length !== 2 ||
      bulkApproveAck.failed.length !== 1 ||
      bulkApproveAck.failed[0].error !== 'unknown_question'
    ) {
      throw new Error(`bad bulk approve ack: ${JSON.stringify(bulkApproveAck)}`);
    }
    await displaySawBulkApprove;

    // bulk dismiss: two fresh in-review questions never become public
    await sleep(1100);
    const sub4 = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:submit', {
        pin,
        text: 'Bulk spike one?',
      })) as QaActionAck,
      'moderated submit q4',
    );
    const sub5 = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(bob, 'qa:participant:submit', {
        pin,
        text: 'Bulk spike two?',
      })) as QaActionAck,
      'moderated submit q5',
    );
    const hostSawBulkDismiss = qaWaitForHostState(host, (s) => s.counts.dismissed === 2);
    const bulkDismissAck = (await qaEmit(host, 'qa:host:dismiss', {
      pin,
      questionIds: [sub4.questionId, sub5.questionId],
    })) as QaModerationAck;
    if (
      !('ok' in bulkDismissAck) ||
      !('questionIds' in bulkDismissAck) ||
      bulkDismissAck.questionIds.length !== 2 ||
      bulkDismissAck.failed.length !== 0
    ) {
      throw new Error(`bad bulk dismiss ack: ${JSON.stringify(bulkDismissAck)}`);
    }
    await hostSawBulkDismiss;
    const finalBoard = qaOk<{ state: QaPublicSnapshot }>(
      (await qaEmit(display, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'final display attach',
    );
    const finalSerialized = JSON.stringify(finalBoard.state);
    if (
      finalBoard.state.questionCount !== 3 ||
      finalSerialized.includes('Bulk spike one?') ||
      finalSerialized.includes('Bulk spike two?')
    ) {
      throw new Error(`bulk-dismissed question leaked: ${finalSerialized}`);
    }

    // moderation events persisted with enough history to explain every move
    const events = await prisma.qAModerationEvent.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    const byAction = (action: string) => events.filter((e) => e.action === action);
    if (byAction('approve').length !== 3) {
      throw new Error(`expected 3 approve events, got ${byAction('approve').length}`);
    }
    if (byAction('dismiss').length !== 3) {
      throw new Error(`expected 3 dismiss events, got ${byAction('dismiss').length}`);
    }
    if (byAction('restore').length !== 1) {
      throw new Error(`expected 1 restore event, got ${byAction('restore').length}`);
    }
    const bulkEvents = events.filter((e) => e.reason === 'bulk');
    if (bulkEvents.length !== 4) {
      throw new Error(`expected 4 bulk-flagged events, got ${bulkEvents.length}`);
    }
    const q2History = events.filter((e) => e.questionId === sub2.questionId).map((e) => e.action);
    if (JSON.stringify(q2History) !== JSON.stringify(['dismiss', 'restore', 'approve'])) {
      throw new Error(`q2 history cannot explain its disappearance: ${JSON.stringify(q2History)}`);
    }

    // same-auth non-host socket: a second socket authenticated as the SAME
    // host user (e.g. that host's participant tab) must NOT be able to
    // moderate — only the attached host control socket may. Needs the
    // server's AUTH_SECRET to forge a session cookie; skip when unset (the
    // server would have generated a random dev secret we cannot match).
    const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
    if (!authSecret) {
      console.warn('⚠ AUTH_SECRET not set — skipping same-auth non-host moderation check');
    } else {
      const owner = await prisma.user.upsert({
        where: { email: 'qa-smoke@example.com' },
        update: {},
        create: { email: 'qa-smoke@example.com' },
      });
      const { encode: encodeAuthJwt } = await import('@auth/core/jwt');
      const sessionToken = await encodeAuthJwt({
        token: { id: owner.id },
        secret: authSecret,
        salt: 'authjs.session-token',
        maxAge: 60 * 60,
      });
      const owned = await qaCreateSession({ moderationEnabled: true, hostUserId: owner.id });
      const hostCtl = await connectAuthedSock(sessionToken);
      const sameUser = await connectAuthedSock(sessionToken);
      try {
        qaOk(
          await qaEmit(hostCtl, 'qa:host:attach', { pin: owned.pin, sessionId: owned.sessionId }),
          'owned qa:host:attach',
        );
        qaOk(
          (await qaEmit(sameUser, 'qa:participant:join', {
            pin: owned.pin,
            displayName: 'HostTab',
          })) as QaJoinAck,
          'same-user participant join',
        );
        const subOwned = qaOk<Exclude<QaActionAck, { error: string }>>(
          (await qaEmit(sameUser, 'qa:participant:submit', {
            pin: owned.pin,
            text: 'Same-user, different socket?',
          })) as QaActionAck,
          'same-user submit',
        );
        qaExpectError(
          await qaEmit(sameUser, 'qa:host:approve', {
            pin: owned.pin,
            questionId: subOwned.questionId,
          }),
          'forbidden',
          'same-auth non-host approve',
        );
        // sanity: the attached host control socket CAN moderate with this
        // auth — proves the forged cookie works and the check above is real
        const ownedApprove = (await qaEmit(hostCtl, 'qa:host:approve', {
          pin: owned.pin,
          questionId: subOwned.questionId,
        })) as QaModerationAck;
        if (
          !('ok' in ownedApprove) ||
          !('status' in ownedApprove) ||
          ownedApprove.status !== 'LIVE'
        ) {
          throw new Error(`owned host approve failed: ${JSON.stringify(ownedApprove)}`);
        }
      } finally {
        hostCtl.disconnect();
        sameUser.disconnect();
      }
    }

    console.log('✓ Q&A moderation queue (MID-338)');
  } finally {
    host.disconnect();
    display.disconnect();
    alice.disconnect();
    bob.disconnect();
    await prisma.$disconnect();
  }
}

// --- scenario 22 (MID-341): Q&A replies ---

type QaReplyAck =
  | { ok: true; questionId: string; reply: { id: string; isHostReply: boolean; text: string } }
  | { error: string };

async function assertQaReplies() {
  console.log('\n--- scenario 22 (MID-341): Q&A replies ---');
  const prisma = new PrismaClient();
  const host = await connectSock();
  const display = await connectSock();
  const alice = await connectSock();
  const bob = await connectSock();
  try {
    const { pin, sessionId } = await qaCreateSession({
      moderationEnabled: true,
      participantRepliesEnabled: true,
    });
    console.log('qa replies pin:', pin);
    qaOk(await qaEmit(host, 'qa:host:attach', { pin, sessionId }), 'qa:host:attach');
    qaOk(
      (await qaEmit(display, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'qa:display:attach',
    );
    qaOk(
      (await qaEmit(alice, 'qa:participant:join', { pin, displayName: 'Alice' })) as QaJoinAck,
      'alice join',
    );
    const bobJoin = qaOk<Exclude<QaJoinAck, { error: string }>>(
      (await qaEmit(bob, 'qa:participant:join', { pin, displayName: 'Bob' })) as QaJoinAck,
      'bob join',
    );

    // a non-host socket cannot use the host reply route
    qaExpectError(
      await qaEmit(alice, 'qa:host:reply', { pin, questionId: 'whatever', text: 'hijack' }),
      'forbidden',
      'non-host reply',
    );

    // host reply to an IN_REVIEW question: private — the submitter gets a
    // targeted personal push, the public board never carries the text
    const sub = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:submit', {
        pin,
        text: 'Reply to me privately?',
      })) as QaActionAck,
      'moderated submit',
    );
    if (sub.status !== 'IN_REVIEW') throw new Error(`expected IN_REVIEW, got ${sub.status}`);
    const aliceSawPrivateReply = qaWaitForPersonal(alice, (p) =>
      p.questions.some(
        (q) =>
          q.id === sub.questionId &&
          (q.replies ?? []).some((r) => r.isHostReply && r.text === 'Soon — private answer.'),
      ),
    );
    const hostReplyAck = (await qaEmit(host, 'qa:host:reply', {
      pin,
      questionId: sub.questionId,
      text: 'Soon — private answer.',
    })) as QaReplyAck;
    if (!('ok' in hostReplyAck) || !hostReplyAck.reply.isHostReply) {
      throw new Error(`bad host reply ack: ${JSON.stringify(hostReplyAck)}`);
    }
    await aliceSawPrivateReply;
    const boardWhilePrivate = qaOk<{ state: QaPublicSnapshot }>(
      (await qaEmit(display, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'pre-approve display attach',
    );
    if (JSON.stringify(boardWhilePrivate.state).includes('Soon — private answer.')) {
      throw new Error(`private reply leaked publicly: ${JSON.stringify(boardWhilePrivate.state)}`);
    }

    // approval makes the existing reply public with the question
    const displaySawApprove = qaWaitForState(
      display,
      (s) => s.questionCount === 1 && JSON.stringify(s).includes('Soon — private answer.'),
    );
    const approveAck = (await qaEmit(host, 'qa:host:approve', {
      pin,
      questionId: sub.questionId,
    })) as QaModerationAck;
    if (!('ok' in approveAck)) throw new Error(`approve failed: ${JSON.stringify(approveAck)}`);
    await displaySawApprove;

    // participant reply threads under the LIVE question, anonymously
    const roomSawBobReply = qaWaitForState(display, (s) =>
      JSON.stringify(s).includes('Same question here!'),
    );
    const bobReplyAck = (await qaEmit(bob, 'qa:participant:reply', {
      pin,
      questionId: sub.questionId,
      text: 'Same question here!',
    })) as QaReplyAck;
    if (!('ok' in bobReplyAck) || bobReplyAck.reply.isHostReply) {
      throw new Error(`bad participant reply ack: ${JSON.stringify(bobReplyAck)}`);
    }
    const threadSnap = await roomSawBobReply;
    if (JSON.stringify(threadSnap).includes(bobJoin.participantId)) {
      throw new Error('participant reply leaked its author id into the public projection');
    }

    // host edits their own reply; the rewrite propagates to the room. A
    // participant reply cannot be rewritten through the host route.
    const roomSawRewrite = qaWaitForState(display, (s) =>
      JSON.stringify(s).includes('Soon — public answer.'),
    );
    const editAck = (await qaEmit(host, 'qa:host:reply:edit', {
      pin,
      questionId: sub.questionId,
      replyId: hostReplyAck.reply.id,
      text: 'Soon — public answer.',
    })) as QaReplyAck;
    if (!('ok' in editAck)) throw new Error(`reply edit failed: ${JSON.stringify(editAck)}`);
    await roomSawRewrite;
    qaExpectError(
      await qaEmit(host, 'qa:host:reply:edit', {
        pin,
        questionId: sub.questionId,
        replyId: bobReplyAck.reply.id,
        text: 'hijack',
      }),
      'not_host_reply',
      'host edit of participant reply',
    );

    // both replies persisted (persist-before-broadcast)
    const rows = await prisma.qAReply.findMany({
      where: { question: { sessionId } },
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length !== 2) throw new Error(`expected 2 reply rows, got ${rows.length}`);
    if (rows[0].text !== 'Soon — public answer.' || !rows[0].isHostReply) {
      throw new Error(`bad host reply row: ${JSON.stringify(rows[0])}`);
    }
    if (rows[1].participantId !== bobJoin.participantId || rows[1].isHostReply) {
      throw new Error(`bad participant reply row: ${JSON.stringify(rows[1])}`);
    }

    // participant replies are rejected in a room that never enabled them
    const plain = await qaCreateSession({});
    qaOk(
      (await qaEmit(alice, 'qa:participant:join', {
        pin: plain.pin,
        displayName: 'Alice',
      })) as QaJoinAck,
      'alice join (replies off)',
    );
    const plainSub = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:submit', {
        pin: plain.pin,
        text: 'No threads here?',
      })) as QaActionAck,
      'submit (replies off)',
    );
    if (plainSub.status !== 'LIVE') throw new Error(`expected LIVE, got ${plainSub.status}`);
    await sleep(1100); // submit rate-limit window is shared with replies
    qaExpectError(
      await qaEmit(alice, 'qa:participant:reply', {
        pin: plain.pin,
        questionId: plainSub.questionId,
        text: 'should bounce',
      }),
      'replies_disabled',
      'reply with feature off',
    );

    console.log('✓ Q&A replies (MID-341)');
  } finally {
    host.disconnect();
    display.disconnect();
    alice.disconnect();
    bob.disconnect();
    await prisma.$disconnect();
  }
}

type QaSessionControlAck =
  | { ok: true; status: 'OPEN' | 'CLOSED' | 'ENDED'; submissionsOpen: boolean; votingOpen: boolean }
  | { error: string };

type QaDisplaySettingsAck = { ok: true; settings: QaDisplaySettings } | { error: string };

type QaLabelAck =
  | { ok: true; label: { id: string; name: string; participantSelectable: boolean } }
  | { error: string };

type QaLabelAssignmentAck =
  | { ok: true; questionId: string; labelIds: string[] }
  | { error: string };

async function assertQaSessionControls() {
  console.log('\n--- scenario 23 (MID-342): Q&A session controls ---');
  const prisma = new PrismaClient();
  const host = await connectSock();
  const display = await connectSock();
  const alice = await connectSock();
  const bob = await connectSock();
  const probe = await connectSock();
  const reconnectDisplay = await connectSock();
  try {
    const { pin, sessionId } = await qaCreateSession({ participantRepliesEnabled: true });
    console.log('qa session-controls pin:', pin);
    qaOk(await qaEmit(host, 'qa:host:attach', { pin, sessionId }), 'qa:host:attach');
    qaOk(
      (await qaEmit(display, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'qa:display:attach',
    );
    const aliceJoin = qaOk<Exclude<QaJoinAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:join', { pin, displayName: 'Alice' })) as QaJoinAck,
      'alice join',
    );
    const bobJoin = qaOk<Exclude<QaJoinAck, { error: string }>>(
      (await qaEmit(bob, 'qa:participant:join', { pin, displayName: 'Bob' })) as QaJoinAck,
      'bob join',
    );

    const displaySawQuestion = qaWaitForState(display, (s) => s.questionCount === 1);
    const submit = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:submit', {
        pin,
        text: 'Can we still vote while questions are closed?',
      })) as QaActionAck,
      'initial submit',
    );
    await displaySawQuestion;

    qaExpectError(
      await qaEmit(probe, 'qa:host:set-voting-open', { pin, open: false }),
      'forbidden',
      'non-host voting control',
    );

    const displaySawClosedSubmissions = qaWaitForState(
      display,
      (s) => s.status === 'CLOSED' && !s.submissionsOpen && s.votingOpen,
    );
    const closeSubmissions = qaOk<Exclude<QaSessionControlAck, { error: string }>>(
      (await qaEmit(host, 'qa:host:set-submissions-open', {
        pin,
        open: false,
      })) as QaSessionControlAck,
      'close submissions',
    );
    if (closeSubmissions.status !== 'CLOSED' || closeSubmissions.votingOpen !== true) {
      throw new Error(`bad close submissions ack: ${JSON.stringify(closeSubmissions)}`);
    }
    await displaySawClosedSubmissions;
    const closedRow = await prisma.qASession.findUnique({ where: { id: sessionId } });
    if (!closedRow || closedRow.status !== 'CLOSED' || !closedRow.votingOpen) {
      throw new Error(`bad persisted closed-submissions state: ${JSON.stringify(closedRow)}`);
    }
    const reconnectClosed = qaOk(
      (await qaEmit(reconnectDisplay, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'display reconnect while questions closed',
    );
    if (
      reconnectClosed.state.status !== 'CLOSED' ||
      reconnectClosed.state.submissionsOpen ||
      !reconnectClosed.state.votingOpen
    ) {
      throw new Error(`bad reconnect closed state: ${JSON.stringify(reconnectClosed.state)}`);
    }

    qaExpectError(
      await qaEmit(bob, 'qa:participant:submit', { pin, text: 'late question' }),
      'submissions_closed',
      'submit while closed',
    );
    qaExpectError(
      await qaEmit(bob, 'qa:participant:reply', {
        pin,
        questionId: submit.questionId,
        text: 'same here',
      }),
      'submissions_closed',
      'reply while closed',
    );

    const voteWhileClosed = qaOk<{ score: number; upvotes: number; downvotes: number }>(
      (await qaEmit(bob, 'qa:participant:vote', {
        pin,
        questionId: submit.questionId,
        type: 'UP',
      })) as { score: number; upvotes: number; downvotes: number } | { error: string },
      'vote while submissions closed',
    );
    if (voteWhileClosed.score !== 1 || voteWhileClosed.upvotes !== 1) {
      throw new Error(`bad vote while closed: ${JSON.stringify(voteWhileClosed)}`);
    }

    const displaySawVotingClosed = qaWaitForState(display, (s) => !s.votingOpen);
    const closeVoting = qaOk<Exclude<QaSessionControlAck, { error: string }>>(
      (await qaEmit(host, 'qa:host:set-voting-open', { pin, open: false })) as QaSessionControlAck,
      'close voting',
    );
    if (closeVoting.votingOpen !== false) {
      throw new Error(`bad close voting ack: ${JSON.stringify(closeVoting)}`);
    }
    await displaySawVotingClosed;
    const votingClosedRow = await prisma.qASession.findUnique({ where: { id: sessionId } });
    if (!votingClosedRow || votingClosedRow.status !== 'CLOSED' || votingClosedRow.votingOpen) {
      throw new Error(`bad persisted voting-closed state: ${JSON.stringify(votingClosedRow)}`);
    }

    qaExpectError(
      await qaEmit(alice, 'qa:participant:vote', {
        pin,
        questionId: submit.questionId,
        type: 'UP',
      }),
      'voting_closed',
      'vote while voting closed',
    );

    const displaySawReopenedSubmissions = qaWaitForState(
      display,
      (s) => s.status === 'OPEN' && s.submissionsOpen && !s.votingOpen,
    );
    const reconnectSawReopenedSubmissions = qaWaitForState(
      reconnectDisplay,
      (s) => s.status === 'OPEN' && s.submissionsOpen && !s.votingOpen,
    );
    const reopenSubmissions = qaOk<Exclude<QaSessionControlAck, { error: string }>>(
      (await qaEmit(host, 'qa:host:set-submissions-open', {
        pin,
        open: true,
      })) as QaSessionControlAck,
      'reopen submissions',
    );
    if (reopenSubmissions.status !== 'OPEN' || !reopenSubmissions.submissionsOpen) {
      throw new Error(`bad reopen submissions ack: ${JSON.stringify(reopenSubmissions)}`);
    }
    await Promise.all([displaySawReopenedSubmissions, reconnectSawReopenedSubmissions]);
    const reopenedSubmissionsRow = await prisma.qASession.findUnique({ where: { id: sessionId } });
    if (
      !reopenedSubmissionsRow ||
      reopenedSubmissionsRow.status !== 'OPEN' ||
      reopenedSubmissionsRow.votingOpen
    ) {
      throw new Error(
        `bad persisted reopened-submissions state: ${JSON.stringify(reopenedSubmissionsRow)}`,
      );
    }
    const displaySawReopenedVoting = qaWaitForState(
      display,
      (s) => s.status === 'OPEN' && s.submissionsOpen && s.votingOpen,
    );
    const reconnectSawReopenedVoting = qaWaitForState(
      reconnectDisplay,
      (s) => s.status === 'OPEN' && s.submissionsOpen && s.votingOpen,
    );
    const reopenVoting = qaOk<Exclude<QaSessionControlAck, { error: string }>>(
      (await qaEmit(host, 'qa:host:set-voting-open', { pin, open: true })) as QaSessionControlAck,
      'reopen voting',
    );
    if (!reopenVoting.votingOpen) {
      throw new Error(`bad reopen voting ack: ${JSON.stringify(reopenVoting)}`);
    }
    await Promise.all([displaySawReopenedVoting, reconnectSawReopenedVoting]);
    const reopenedVotingRow = await prisma.qASession.findUnique({ where: { id: sessionId } });
    if (
      !reopenedVotingRow ||
      reopenedVotingRow.status !== 'OPEN' ||
      !reopenedVotingRow.votingOpen
    ) {
      throw new Error(`bad persisted reopened-voting state: ${JSON.stringify(reopenedVotingRow)}`);
    }

    const displaySawConcurrentVotingClosed = qaWaitForState(
      display,
      (s) => s.status === 'OPEN' && s.submissionsOpen && !s.votingOpen,
    );
    const displaySawConcurrentVotingOpen = qaWaitForState(
      display,
      (s) => s.status === 'OPEN' && s.submissionsOpen && s.votingOpen,
    );
    const [concurrentCloseVoting, concurrentReopenVoting] = await Promise.all([
      qaEmit(host, 'qa:host:set-voting-open', { pin, open: false }),
      qaEmit(host, 'qa:host:set-voting-open', { pin, open: true }),
    ]);
    const queuedCloseVoting = qaOk<Exclude<QaSessionControlAck, { error: string }>>(
      concurrentCloseVoting as QaSessionControlAck,
      'queued close voting',
    );
    const queuedReopenVoting = qaOk<Exclude<QaSessionControlAck, { error: string }>>(
      concurrentReopenVoting as QaSessionControlAck,
      'queued reopen voting',
    );
    if (queuedCloseVoting.votingOpen || !queuedReopenVoting.votingOpen) {
      throw new Error(
        `bad queued voting acks: ${JSON.stringify({ queuedCloseVoting, queuedReopenVoting })}`,
      );
    }
    await Promise.all([displaySawConcurrentVotingClosed, displaySawConcurrentVotingOpen]);
    const queuedVotingRow = await prisma.qASession.findUnique({ where: { id: sessionId } });
    if (!queuedVotingRow || queuedVotingRow.status !== 'OPEN' || !queuedVotingRow.votingOpen) {
      throw new Error(`bad persisted queued-voting state: ${JSON.stringify(queuedVotingRow)}`);
    }

    await sleep(1100); // Bob used a rejected reply attempt; keep the submit throttle unambiguous.
    qaOk(
      (await qaEmit(bob, 'qa:participant:submit', { pin, text: 'Back open?' })) as QaActionAck,
      'submit after reopen',
    );

    const displaySawEnded = qaWaitForState(
      display,
      (s) => s.status === 'ENDED' && !s.submissionsOpen && !s.votingOpen,
    );
    const end = qaOk<Exclude<QaSessionControlAck, { error: string }>>(
      (await qaEmit(host, 'qa:host:set-session-status', {
        pin,
        status: 'ENDED',
      })) as QaSessionControlAck,
      'end session',
    );
    if (end.status !== 'ENDED' || end.submissionsOpen || end.votingOpen) {
      throw new Error(`bad end ack: ${JSON.stringify(end)}`);
    }
    await displaySawEnded;

    const endedReconnect = qaOk(
      (await qaEmit(reconnectDisplay, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'display reconnect after end',
    );
    if (
      endedReconnect.state.status !== 'ENDED' ||
      endedReconnect.state.submissionsOpen ||
      endedReconnect.state.votingOpen
    ) {
      throw new Error(`bad reconnect ended state: ${JSON.stringify(endedReconnect.state)}`);
    }

    const persisted = await prisma.qASession.findUnique({ where: { id: sessionId } });
    if (!persisted || persisted.status !== 'ENDED' || persisted.votingOpen || !persisted.endedAt) {
      throw new Error(`bad persisted end state: ${JSON.stringify(persisted)}`);
    }
    qaExpectError(
      await qaEmit(bob, 'qa:participant:submit', { pin, text: 'ended question' }),
      'session_ended',
      'submit after end despite submit throttle',
    );
    qaExpectError(
      await qaEmit(alice, 'qa:participant:vote', {
        pin,
        questionId: submit.questionId,
        type: 'UP',
      }),
      'session_ended',
      'vote after end',
    );
    qaExpectError(
      await qaEmit(probe, 'qa:participant:join', { pin, displayName: 'Late' }),
      'session_ended',
      'join after end',
    );
    qaExpectError(
      await qaEmit(host, 'qa:host:set-voting-open', { pin, open: true }),
      'session_ended',
      'reopen voting after end',
    );

    if (aliceJoin.participantId === bobJoin.participantId) {
      throw new Error('participants were not distinct');
    }
    console.log('✓ Q&A session controls (MID-342)');
  } finally {
    host.disconnect();
    display.disconnect();
    alice.disconnect();
    bob.disconnect();
    probe.disconnect();
    reconnectDisplay.disconnect();
    await prisma.$disconnect();
  }
}

async function assertQaDisplayPresentMode() {
  console.log('\n--- scenario 24 (MID-343): Q&A display / present mode ---');
  const host = await connectSock();
  const display = await connectSock();
  const mirrorDisplay = await connectSock();
  const reconnectDisplay = await connectSock();
  const alice = await connectSock();
  const bob = await connectSock();
  const probe = await connectSock();
  try {
    const { pin, sessionId } = await qaCreateSession();
    console.log('qa display pin:', pin);
    qaOk(await qaEmit(host, 'qa:host:attach', { pin, sessionId }), 'qa:host:attach');
    const initialDisplay = qaOk<{ state: QaPublicSnapshot }>(
      (await qaEmit(display, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'qa:display:attach',
    );
    qaOk(
      (await qaEmit(mirrorDisplay, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'qa:display:attach mirror',
    );
    if (
      JSON.stringify(initialDisplay.state.displaySettings) !==
      JSON.stringify({
        sort: 'popular',
        labelFilter: null,
        visibleCount: 4,
        showTicker: true,
        highlightFullscreen: true,
      })
    ) {
      throw new Error(`bad default display settings: ${JSON.stringify(initialDisplay.state)}`);
    }

    qaOk(
      (await qaEmit(alice, 'qa:participant:join', { pin, displayName: 'Alice' })) as QaJoinAck,
      'alice join',
    );
    qaOk(
      (await qaEmit(bob, 'qa:participant:join', { pin, displayName: 'Bob' })) as QaJoinAck,
      'bob join',
    );

    const publicLabel = qaOk<Exclude<QaLabelAck, { error: string }>>(
      (await qaEmit(host, 'qa:host:label:create', {
        pin,
        name: 'Roadmap',
        participantSelectable: true,
      })) as QaLabelAck,
      'create public display label',
    ).label;
    const privateLabel = qaOk<Exclude<QaLabelAck, { error: string }>>(
      (await qaEmit(host, 'qa:host:label:create', {
        pin,
        name: 'Backstage',
        participantSelectable: false,
      })) as QaLabelAck,
      'create private display label',
    ).label;

    const displaySawQ1 = qaWaitForState(display, (s) => s.questionCount === 1);
    const q1 = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:submit', {
        pin,
        text: 'What ships next?',
      })) as QaActionAck,
      'display submit q1',
    );
    await displaySawQ1;
    await sleep(1100);
    const displaySawQ2 = qaWaitForState(display, (s) => s.questionCount === 2);
    const q2 = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(bob, 'qa:participant:submit', {
        pin,
        text: 'Internal-only launch detail?',
      })) as QaActionAck,
      'display submit q2',
    );
    await displaySawQ2;

    const displaySawPublicLabel = qaWaitForState(display, (s) =>
      s.questions.some((q) => q.id === q1.questionId && q.labelIds.includes(publicLabel.id)),
    );
    const assignPublic = qaOk<Exclude<QaLabelAssignmentAck, { error: string }>>(
      (await qaEmit(host, 'qa:host:label:assign', {
        pin,
        questionId: q1.questionId,
        labelId: publicLabel.id,
      })) as QaLabelAssignmentAck,
      'assign public display label',
    );
    if (!assignPublic.labelIds.includes(publicLabel.id)) {
      throw new Error(`public label assignment missing in ack: ${JSON.stringify(assignPublic)}`);
    }
    await displaySawPublicLabel;

    const displaySawPrivateLabelAssignment = qaWaitForState(
      display,
      (s) => s.questionCount === 2 && s.labels.every((label) => label.id !== privateLabel.id),
    );
    const assignPrivate = qaOk<Exclude<QaLabelAssignmentAck, { error: string }>>(
      (await qaEmit(host, 'qa:host:label:assign', {
        pin,
        questionId: q2.questionId,
        labelId: privateLabel.id,
      })) as QaLabelAssignmentAck,
      'assign private display label',
    );
    if (!assignPrivate.labelIds.includes(privateLabel.id)) {
      throw new Error(
        `private label assignment missing in host ack: ${JSON.stringify(assignPrivate)}`,
      );
    }
    const publicAfterPrivateAssignment = await displaySawPrivateLabelAssignment;
    const q2Public = publicAfterPrivateAssignment.questions.find((q) => q.id === q2.questionId);
    if (!q2Public || q2Public.labelIds.includes(privateLabel.id)) {
      throw new Error(
        `private label leaked to display state: ${JSON.stringify(publicAfterPrivateAssignment)}`,
      );
    }

    qaExpectError(
      await qaEmit(probe, 'qa:host:display-settings', { pin, sort: 'recent' }),
      'forbidden',
      'non-host display settings',
    );
    qaExpectError(
      await qaEmit(host, 'qa:host:display-settings', { pin, labelFilter: 'qal_missing' }),
      'unknown_label',
      'unknown display label filter',
    );
    qaExpectError(
      await qaEmit(host, 'qa:host:display-settings', { pin, labelFilter: privateLabel.id }),
      'private_label',
      'private display label filter',
    );

    const displaySawSettings = qaWaitForDisplaySettings(
      display,
      (settings) =>
        settings.sort === 'recent' &&
        settings.labelFilter === publicLabel.id &&
        settings.visibleCount === 6 &&
        !settings.showTicker &&
        !settings.highlightFullscreen,
    );
    const mirrorSawSettings = qaWaitForDisplaySettings(
      mirrorDisplay,
      (settings) => settings.labelFilter === publicLabel.id && settings.visibleCount === 6,
    );
    const settingsAck = qaOk<Exclude<QaDisplaySettingsAck, { error: string }>>(
      (await qaEmit(host, 'qa:host:display-settings', {
        pin,
        sort: 'recent',
        labelFilter: publicLabel.id,
        visibleCount: 99,
        showTicker: false,
        highlightFullscreen: false,
      })) as QaDisplaySettingsAck,
      'update display settings',
    );
    if (
      settingsAck.settings.visibleCount !== 6 ||
      settingsAck.settings.labelFilter !== publicLabel.id
    ) {
      throw new Error(`display settings were not normalized: ${JSON.stringify(settingsAck)}`);
    }
    await Promise.all([displaySawSettings, mirrorSawSettings]);

    const reattach = qaOk<{ state: QaPublicSnapshot }>(
      (await qaEmit(reconnectDisplay, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'display reconnect with settings',
    );
    if (
      reattach.state.displaySettings.sort !== 'recent' ||
      reattach.state.displaySettings.labelFilter !== publicLabel.id ||
      reattach.state.displaySettings.visibleCount !== 6 ||
      reattach.state.labels.some((label) => label.id === privateLabel.id)
    ) {
      throw new Error(`bad display settings hydration: ${JSON.stringify(reattach.state)}`);
    }

    const displaySawHighlight = qaWaitForState(
      display,
      (s) => s.highlightedQuestionId === q1.questionId && s.questions.some((q) => q.highlighted),
    );
    qaOk(
      (await qaEmit(host, 'qa:host:highlight', { pin, questionId: q1.questionId })) as
        | { ok: true; questionId: string | null }
        | { error: string },
      'highlight display question',
    );
    const highlighted = await displaySawHighlight;
    if (!highlighted.questions.some((q) => q.id === q1.questionId && q.highlighted)) {
      throw new Error(`highlight did not reach display: ${JSON.stringify(highlighted)}`);
    }

    const moderated = await qaCreateSession({ moderationEnabled: true });
    qaOk(
      await qaEmit(host, 'qa:host:attach', {
        pin: moderated.pin,
        sessionId: moderated.sessionId,
      }),
      'moderated display host attach',
    );
    qaOk(
      (await qaEmit(display, 'qa:display:attach', { pin: moderated.pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'moderated display attach',
    );
    qaOk(
      (await qaEmit(alice, 'qa:participant:join', {
        pin: moderated.pin,
        displayName: 'Alice',
      })) as QaJoinAck,
      'moderated alice join',
    );
    const inReview = qaOk<Exclude<QaActionAck, { error: string }>>(
      (await qaEmit(alice, 'qa:participant:submit', {
        pin: moderated.pin,
        text: 'Do not project while in review',
      })) as QaActionAck,
      'moderated display submit',
    );
    if (inReview.status !== 'IN_REVIEW')
      throw new Error(`expected IN_REVIEW, got ${inReview.status}`);
    qaExpectError(
      await qaEmit(host, 'qa:host:display-settings', {
        pin: moderated.pin,
        labelFilter: privateLabel.id,
      }),
      'unknown_label',
      'label from another session as display filter',
    );
    const moderatedAttach = qaOk<{ state: QaPublicSnapshot }>(
      (await qaEmit(display, 'qa:display:attach', { pin: moderated.pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'moderated display privacy attach',
    );
    if (JSON.stringify(moderatedAttach.state).includes('Do not project while in review')) {
      throw new Error(`in-review text leaked to display: ${JSON.stringify(moderatedAttach.state)}`);
    }

    console.log('✓ Q&A display / present mode (MID-343)');
  } finally {
    host.disconnect();
    display.disconnect();
    mirrorDisplay.disconnect();
    reconnectDisplay.disconnect();
    alice.disconnect();
    bob.disconnect();
    probe.disconnect();
  }
}

// --- scenario 17: word cloud host trash + CSV preserves trashed rows ---

async function assertWordCloudHostTrash() {
  console.log('\n--- scenario 17: word cloud host trash + CSV removed=true ---');
  const host = await connectSock();
  const a = await connectSock();

  const { pin } = await wcCreate(host, {
    prompt: 'Trash test',
    wordsPerPlayer: 3,
    profanityFilter: true,
  });
  await wcSetStatus(host, { pin, status: 'LIVE' });
  const ja = await wcJoin(a, { pin, nickname: 'Alice' });

  const r1 = await wcSubmit(a, { pin, playerId: ja.playerId, word: 'pizza' });
  if (!r1.accepted) throw new Error(`first submit rejected: ${r1.rejection?.reason}`);
  await sleep(900);
  const r2 = await wcSubmit(a, { pin, playerId: ja.playerId, word: 'salad' });
  if (!r2.accepted) throw new Error(`second submit rejected: ${r2.rejection?.reason}`);
  await sleep(300);

  // listen for word:removed broadcast on the player socket
  const removedP = new Promise<{ normalized: string }>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no wordcloud:word:removed')), 3000);
    a.once('wordcloud:word:removed', (payload: { normalized: string }) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
  host.emit('wordcloud:host:remove', { pin, normalized: 'pizza' });
  const removed = await removedP;
  if (removed.normalized !== 'pizza') {
    throw new Error(`bad removed payload: ${JSON.stringify(removed)}`);
  }

  // verify in-memory state lost the word — re-attach host as display to inspect
  const stateP = new Promise<{ words: { normalized: string }[] }>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no wordcloud:state')), 3000);
    host.once('wordcloud:state', (s: { words: { normalized: string }[] }) => {
      clearTimeout(t);
      resolve(s);
    });
  });
  host.emit('wordcloud:display:attach', pin);
  const wcState = await stateP;
  if (wcState.words.some((w) => w.normalized === 'pizza')) {
    throw new Error('pizza still in state after trash');
  }
  if (!wcState.words.some((w) => w.normalized === 'salad')) {
    throw new Error('salad missing from state');
  }

  await wcSetStatus(host, { pin, status: 'ENDED' });
  await sleep(500);

  const res = await fetch(`${URL}/host/wordcloud/${pin}/answers.csv`);
  if (res.status !== 200) {
    throw new Error(`expected 200, got ${res.status}`);
  }
  const body = await res.text();
  const rows = body.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (rows.length !== 3) {
    throw new Error(`expected 3 lines (header + 2 data), got ${rows.length}:\n${body}`);
  }
  const pizzaRow = rows.find((r) => r.includes(',pizza,'));
  const saladRow = rows.find((r) => r.includes(',salad,'));
  if (!pizzaRow) throw new Error(`CSV missing pizza row:\n${body}`);
  if (!saladRow) throw new Error(`CSV missing salad row:\n${body}`);
  if (!pizzaRow.endsWith(',true')) {
    throw new Error(`expected pizza removed=true, got: ${pizzaRow}`);
  }
  if (!saladRow.endsWith(',false')) {
    throw new Error(`expected salad removed=false, got: ${saladRow}`);
  }
  console.log('✓ word cloud host trash + CSV removed=true');

  host.disconnect();
  a.disconnect();
}

// --- scenario 25 (MID-345): Q&A full lifecycle + CSV export ---

async function assertQaFullLifecycleCsvExport() {
  console.log('\n--- scenario 25 (MID-345): Q&A full lifecycle + CSV export ---');
  const host = await connectSock();
  const display = await connectSock();
  const alice = await connectSock();
  const bob = await connectSock();

  try {
    // 1. Create session with moderation + downvotes + replies enabled
    const { pin } = await qaCreateSession({
      moderationEnabled: true,
      downvotesEnabled: true,
      participantRepliesEnabled: true,
      privacyMode: 'NAMED_BY_DEFAULT',
    });

    // 2. Host attaches
    const hostAck = qaOk(
      (await qaEmit(host, 'qa:host:attach', { pin })) as
        | { pin: string; sessionId: string; hostState: unknown }
        | { error: string },
      'host attach',
    );
    if (!('pin' in hostAck)) throw new Error('host attach failed');

    // 3. Display attaches
    const displayAck = qaOk(
      (await qaEmit(display, 'qa:display:attach', { pin })) as
        | { state: QaPublicSnapshot }
        | { error: string },
      'display attach',
    );
    if (!('state' in displayAck)) throw new Error('display attach failed');

    // 4. Participants join
    const aliceJoin = qaOk(
      (await qaEmit(alice, 'qa:participant:join', { pin, displayName: 'Alice' })) as QaJoinAck,
      'alice join',
    );
    if (!('participantId' in aliceJoin)) throw new Error('alice join failed');
    const alicePid = aliceJoin.participantId;

    const bobJoin = qaOk(
      (await qaEmit(bob, 'qa:participant:join', { pin, displayName: 'Bob' })) as QaJoinAck,
      'bob join',
    );
    if (!('participantId' in bobJoin)) throw new Error('bob join failed');
    const bobPid = bobJoin.participantId;

    // 5. Alice submits a question (goes to IN_REVIEW because moderation is on)
    const submitAck = qaOk(
      (await qaEmit(alice, 'qa:participant:submit', {
        pin,
        participantId: alicePid,
        text: 'What is the roadmap for 2027?',
        isAnonymous: false,
      })) as { ok: true; questionId: string } | { error: string },
      'alice submit',
    );
    if (!('questionId' in submitAck)) throw new Error('submit failed');
    const q1Id = submitAck.questionId;

    // Bob submits an anonymous question
    const submitAck2 = qaOk(
      (await qaEmit(bob, 'qa:participant:submit', {
        pin,
        participantId: bobPid,
        text: 'Will there be layoffs?',
        isAnonymous: true,
      })) as { ok: true; questionId: string } | { error: string },
      'bob submit',
    );
    if (!('questionId' in submitAck2)) throw new Error('submit2 failed');
    const q2Id = submitAck2.questionId;

    // 6. Host approves both questions (moderate: IN_REVIEW -> LIVE)
    qaOk(
      (await qaEmit(host, 'qa:host:moderate', {
        pin,
        questionId: q1Id,
        action: 'approve',
      })) as { ok: true } | { error: string },
      'approve q1',
    );
    qaOk(
      (await qaEmit(host, 'qa:host:moderate', {
        pin,
        questionId: q2Id,
        action: 'approve',
      })) as { ok: true } | { error: string },
      'approve q2',
    );

    await sleep(200);

    // 7. Bob upvotes Alice's question, Alice downvotes Bob's question
    qaOk(
      (await qaEmit(bob, 'qa:participant:vote', {
        pin,
        participantId: bobPid,
        questionId: q1Id,
        type: 'UP',
      })) as { ok: true } | { error: string },
      'bob upvote q1',
    );
    qaOk(
      (await qaEmit(alice, 'qa:participant:vote', {
        pin,
        participantId: alicePid,
        questionId: q2Id,
        type: 'DOWN',
      })) as { ok: true } | { error: string },
      'alice downvote q2',
    );

    await sleep(200);

    // 8. Host creates a label and assigns it to q1
    const labelAck = qaOk(
      (await qaEmit(host, 'qa:host:label:create', {
        pin,
        name: 'strategy',
        participantSelectable: true,
      })) as { ok: true; label: { id: string; name: string } } | { error: string },
      'create label',
    );
    if (!('label' in labelAck)) throw new Error('label create failed');
    const labelId = labelAck.label.id;

    qaOk(
      (await qaEmit(host, 'qa:host:label:assign', {
        pin,
        questionId: q1Id,
        labelIds: [labelId],
      })) as { ok: true } | { error: string },
      'assign label',
    );

    // 9. Host highlights q1
    qaOk(
      (await qaEmit(host, 'qa:host:highlight', {
        pin,
        questionId: q1Id,
      })) as { ok: true } | { error: string },
      'highlight q1',
    );

    // 10. Host replies to q1
    const replyAck = qaOk(
      (await qaEmit(host, 'qa:host:reply', {
        pin,
        questionId: q1Id,
        text: 'Great question, we will share soon.',
      })) as { ok: true; questionId: string; reply: { id: string } } | { error: string },
      'host reply',
    );
    if (!('reply' in replyAck)) throw new Error('reply failed');

    // 11. Host marks q1 as answered
    qaOk(
      (await qaEmit(host, 'qa:host:moderate', {
        pin,
        questionId: q1Id,
        action: 'answer',
      })) as { ok: true } | { error: string },
      'mark answered',
    );

    await sleep(200);

    // 12. Host closes submissions, closes voting, ends session
    qaOk(
      (await qaEmit(host, 'qa:host:set-submissions-open', {
        pin,
        open: false,
      })) as { ok: true } | { error: string },
      'close submissions',
    );
    qaOk(
      (await qaEmit(host, 'qa:host:set-voting-open', {
        pin,
        open: false,
      })) as { ok: true } | { error: string },
      'close voting',
    );
    qaOk(
      (await qaEmit(host, 'qa:host:set-session-status', {
        pin,
        status: 'ENDED',
      })) as { ok: true } | { error: string },
      'end session',
    );

    await sleep(500);

    // 13. Verify CSV export
    const res = await fetch(`${URL}/host/q-and-a/${pin}/questions.csv`);
    if (res.status !== 200) {
      throw new Error(`CSV export expected 200, got ${res.status}`);
    }
    const csv = await res.text();
    const lines = csv.split(/\r\n|\n/).filter((l) => l.length > 0);
    // header + 2 questions
    if (lines.length !== 3) {
      throw new Error(`CSV expected 3 lines (header + 2 data), got ${lines.length}:\n${csv}`);
    }
    // header check
    if (!lines[0].includes('question_id') || !lines[0].includes('host_replies')) {
      throw new Error(`unexpected CSV header: ${lines[0]}`);
    }
    // q1 row: named, has label "strategy", has host reply, status ANSWERED
    const q1Row = lines.find((l) => l.includes(q1Id));
    if (!q1Row) throw new Error(`CSV missing q1 row (${q1Id})`);
    if (!q1Row.includes('Alice')) throw new Error('q1 row missing author Alice');
    if (!q1Row.includes('named')) throw new Error('q1 row missing named privacy');
    if (!q1Row.includes('strategy')) throw new Error('q1 row missing label strategy');
    if (!q1Row.includes('ANSWERED')) throw new Error('q1 row missing ANSWERED status');
    if (!q1Row.includes('Great question')) throw new Error('q1 row missing host reply');

    // q2 row: anonymous, no labels, LIVE status
    const q2Row = lines.find((l) => l.includes(q2Id));
    if (!q2Row) throw new Error(`CSV missing q2 row (${q2Id})`);
    if (!q2Row.includes('[anonymous]')) throw new Error('q2 row missing anonymous marker');
    if (!q2Row.includes('anonymous')) throw new Error('q2 row missing anonymous privacy');

    console.log('✓ Q&A full lifecycle + CSV export (MID-345)');
  } finally {
    host.disconnect();
    display.disconnect();
    alice.disconnect();
    bob.disconnect();
  }
}
