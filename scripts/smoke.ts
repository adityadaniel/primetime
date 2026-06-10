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

  await assertPersistenceRowsWritten();
}

async function assertCapEnforcement() {
  // OSS: the cap is env-driven (PLAYER_CAP, default 10). Server and this smoke
  // run share the same lib/config, so we fill exactly config.playerCap slots
  // and expect the next join to be rejected with code "full".
  const cap = config.playerCap;
  console.log(`\n--- cap enforcement: env PLAYER_CAP = ${cap} ---`);
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

type QaPublicSnapshot = {
  pin: string;
  title: string;
  participantCount: number;
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
