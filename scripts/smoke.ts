// quick smoke test: 1 host + 2 players + 1 display, full game loop
import { io } from "socket.io-client";
import { PrismaClient } from "@prisma/client";
import {
  createGame,
  detachSocket,
  joinPlayer,
  setReconnectGraceForTesting,
} from "../lib/game";
import type { Quiz } from "../lib/types";

const URL = "http://localhost:4321";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const quiz: Quiz = {
  title: "Smoke Test",
  questions: [
    {
      id: "q1",
      type: "multiple",
      text: "2 + 2?",
      options: ["3", "4", "5", "6"],
      correct: 1,
      timeLimit: 10,
      doublePoints: false,
    },
    {
      id: "q2",
      type: "truefalse",
      text: "Sky is blue.",
      options: ["TRUE", "FALSE"],
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
  paused?: { reason: "host-disconnected"; resumeBy: number };
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
    ["host", host],
    ["display", display],
    ["a", a],
    ["b", b],
  ] as const) {
    s.on("state", (st: State) => {
      states.set(name, st);
    });
    s.on("personal", (_p: any) => {
      // optional: console.log(name, "personal", _p);
    });
  }

  const { pin } = await new Promise<{ pin: string }>((r) =>
    host.emit("host:create", quiz, r),
  );
  console.log("pin:", pin);
  display.emit("display:attach", pin);

  const ja = await new Promise<{ ok: boolean; playerId?: string; error?: string }>((r) =>
    a.emit("player:join", pin, "Alice", r),
  );
  const jb = await new Promise<{ ok: boolean; playerId?: string; error?: string }>((r) =>
    b.emit("player:join", pin, "Bob", r),
  );
  console.log("join Alice:", ja, "join Bob:", jb);

  await sleep(150);

  console.log("lobby players:", states.get("host")?.players.map((p) => p.nickname));

  host.emit("host:start", pin);
  await sleep(200);
  console.log("phase after start:", states.get("host")?.phase);

  // Alice answers correctly fast, Bob answers wrong slow
  await sleep(100);
  await new Promise<void>((r) => a.emit("player:answer", pin, 1, () => r()));
  await sleep(2000);
  await new Promise<void>((r) => b.emit("player:answer", pin, 0, () => r()));

  await sleep(300);
  // both answered → should auto lock to reveal
  console.log(
    "after Q1 answers, phase:",
    states.get("host")?.phase,
    "scores:",
    states.get("host")?.players.map((p) => `${p.nickname}=${p.score}`),
  );

  host.emit("host:advance", pin);
  await sleep(200);
  console.log("after reveal advance, phase:", states.get("host")?.phase);

  host.emit("host:advance", pin);
  await sleep(300);
  console.log("Q2 phase:", states.get("host")?.phase);

  // Q2: bob correct, alice wrong; double points
  await sleep(100);
  await new Promise<void>((r) => b.emit("player:answer", pin, 0, () => r()));
  await new Promise<void>((r) => a.emit("player:answer", pin, 1, () => r()));
  await sleep(300);
  console.log(
    "after Q2 answers, phase:",
    states.get("host")?.phase,
    "scores:",
    states.get("host")?.players.map((p) => `${p.nickname}=${p.score}`),
  );

  host.emit("host:advance", pin);
  await sleep(200);
  console.log("after Q2 advance →", states.get("host")?.phase);
  host.emit("host:advance", pin);
  await sleep(200);
  console.log("final phase:", states.get("host")?.phase);

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

  await assertPersistenceRowsWritten();
}

async function assertCapEnforcement() {
  console.log("\n--- cap enforcement: hardcoded 150-player limit ---");
  const capHost = io(URL, { transports: ["websocket"] });
  await new Promise<void>((r) => capHost.on("connect", () => r()));

  const { pin } = await new Promise<{ pin: string }>((r) =>
    capHost.emit("host:create", quiz, "free", r),
  );
  console.log("cap-test pin:", pin);

  const players: ReturnType<typeof io>[] = [];
  for (let i = 0; i < 150; i++) {
    const p = io(URL, { transports: ["websocket"] });
    await new Promise<void>((r) => p.on("connect", () => r()));
    const res = await new Promise<{ ok: boolean; error?: string; code?: string }>((r) =>
      p.emit("player:join", pin, `Player${i + 1}`, r),
    );
    if (!res.ok) throw new Error(`player ${i + 1} unexpectedly rejected: ${res.error}`);
    players.push(p);
  }
  console.log("150 players joined OK");

  const overflow = io(URL, { transports: ["websocket"] });
  await new Promise<void>((r) => overflow.on("connect", () => r()));
  const rej = await new Promise<{ ok: boolean; error?: string; code?: string }>((r) =>
    overflow.emit("player:join", pin, "OneFiftyFirst", r),
  );

  if (rej.ok) throw new Error("151st join should have been rejected");
  if (rej.code !== "full") {
    throw new Error(`expected code "full", got "${rej.code}" (error: ${rej.error})`);
  }
  console.log("151st rejected with code:", rej.code, "·", rej.error);

  await sleep(50);
  const capState = await new Promise<{ playerCount?: number; cap?: { soft: number; hard: number; upsell: boolean } }>(
    (r) => {
      capHost.once("state", (s) => r(s));
      capHost.emit("host:attach", pin);
    },
  );
  if (capState.cap?.hard !== 150 || capState.cap?.soft !== 150 || capState.cap?.upsell !== false) {
    throw new Error(
      `expected cap {hard:150, soft:150, upsell:false}, got ${JSON.stringify(capState.cap)}`,
    );
  }
  console.log("publicState cap:", capState.cap);
  console.log("cap enforcement: PASS");

  capHost.disconnect();
  overflow.disconnect();
  for (const p of players) p.disconnect();
}

// --- helpers shared by m2 scenarios ---

function connectSock() {
  const s = io(URL, { transports: ["websocket"], forceNew: true });
  return new Promise<ReturnType<typeof io>>((resolve) => {
    s.on("connect", () => resolve(s));
  });
}

async function createGameOverSocket(host: ReturnType<typeof io>, quiz: Quiz, tier?: "free" | "pro") {
  return new Promise<{ pin: string }>((r) => {
    if (tier) host.emit("host:create", quiz, tier, r);
    else host.emit("host:create", quiz, r);
  });
}

const oneQuestionQuiz: Quiz = {
  title: "Single Q",
  questions: [
    {
      id: "q1",
      type: "multiple",
      text: "Which is even?",
      options: ["1", "2", "3", "5"],
      correct: 1,
      timeLimit: 10,
      doublePoints: false,
    },
  ],
};

async function joinPlayerOverSocket(
  s: ReturnType<typeof io>,
  pin: string,
  nickname: string,
) {
  return new Promise<{
    ok: boolean;
    error?: string;
    code?: string;
    playerId?: string;
    reconnected?: boolean;
  }>((r) => s.emit("player:join", pin, nickname, r));
}

// --- scenario 1: player reconnect inside grace window ---

async function assertPlayerReconnectInGrace() {
  console.log("\n--- scenario 1: player reconnect inside grace ---");
  // generous grace window (default 30s) — we reconnect within ~300ms.
  setReconnectGraceForTesting(30_000);

  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);

  await joinPlayerOverSocket(a, pin, "Alice");
  const jb1 = await joinPlayerOverSocket(b, pin, "Bob");
  if (!jb1.ok) throw new Error(`Bob initial join failed: ${jb1.error}`);

  host.emit("host:start", pin);
  await sleep(150);

  await new Promise<void>((r) => a.emit("player:answer", pin, 1, () => r()));
  await new Promise<void>((r) => b.emit("player:answer", pin, 1, () => r()));
  await sleep(200);

  // grab Bob's score before disconnect
  const stateBefore = await new Promise<State>((r) => {
    host.once("state", (s: State) => r(s));
    host.emit("host:attach", pin);
  });
  const bobBefore = stateBefore.players.find((p) => p.nickname === "Bob");
  if (!bobBefore) throw new Error("Bob missing pre-disconnect");
  if (bobBefore.score <= 0) throw new Error(`Bob should have score > 0, got ${bobBefore.score}`);

  // listen for the host-side reconnect event
  let reconnectedEvent: { playerId: string; nickname: string } | null = null;
  host.on("event:reconnected", (payload: { playerId: string; nickname: string }) => {
    reconnectedEvent = payload;
  });

  b.disconnect();
  await sleep(200);

  const bb = await connectSock();
  const jb2 = await joinPlayerOverSocket(bb, pin, "Bob");

  if (!jb2.ok) throw new Error(`Bob reconnect failed: ${jb2.error}`);
  if (!jb2.reconnected) throw new Error("expected reconnected: true");
  if (jb2.playerId !== bobBefore.id) {
    throw new Error(`expected same playerId, got ${jb2.playerId} vs ${bobBefore.id}`);
  }

  await sleep(150);
  const stateAfter = await new Promise<State>((r) => {
    host.once("state", (s: State) => r(s));
    host.emit("host:attach", pin);
  });
  const bobAfter = stateAfter.players.find((p) => p.nickname === "Bob");
  if (!bobAfter) throw new Error("Bob missing post-reconnect");
  if (bobAfter.score !== bobBefore.score) {
    throw new Error(`score lost on reconnect: ${bobBefore.score} → ${bobAfter.score}`);
  }
  if (!reconnectedEvent) throw new Error("event:reconnected was not emitted to host");
  if ((reconnectedEvent as { nickname: string }).nickname !== "Bob") {
    throw new Error(`event:reconnected wrong nickname: ${JSON.stringify(reconnectedEvent)}`);
  }

  console.log("✓ player reconnect inside grace");

  host.disconnect();
  a.disconnect();
  bb.disconnect();
}

// --- scenario 2: rejoin AFTER grace (uses dev hatch + in-process calls) ---

async function assertPlayerRejoinAfterGrace() {
  console.log("\n--- scenario 2: rejoin after grace expires ---");
  setReconnectGraceForTesting(50);

  const game = createGame(quiz, "free");

  const j1 = joinPlayer(game.pin, "sock-orig", "Carol");
  if (!j1.ok) throw new Error(`Carol join failed: ${j1.error}`);
  const originalId = j1.player.id;

  // simulate disconnect
  detachSocket("sock-orig");

  // wait past the grace window
  await sleep(150);

  const j2 = joinPlayer(game.pin, "sock-new", "Carol");
  if (!j2.ok) throw new Error(`Carol post-grace rejoin failed: ${j2.error}`);
  if (j2.reconnected) {
    throw new Error("rejoin after grace should NOT be flagged as reconnected");
  }
  if (j2.player.id === originalId) {
    throw new Error(`expected new playerId after grace, got same: ${j2.player.id}`);
  }
  if (j2.player.score !== 0) {
    throw new Error(`expected fresh score=0, got ${j2.player.score}`);
  }

  // restore default grace for any later scenarios
  setReconnectGraceForTesting(30_000);
  console.log("✓ rejoin after grace = new player");
}

// --- scenario 3: host disconnect + reconnect inside 60s ---

async function assertHostDisconnectAndReconnect() {
  console.log("\n--- scenario 3: host disconnect + reconnect inside 60s ---");

  const host = await connectSock();
  const player = await connectSock();
  const display = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);
  display.emit("display:attach", pin);

  await joinPlayerOverSocket(player, pin, "Dave");
  host.emit("host:start", pin);
  await sleep(200);

  // capture next state pushed to player after host drops
  const pausedState = new Promise<State>((resolve) => {
    player.on("state", function onState(s: State) {
      if (s.paused) {
        player.off("state", onState);
        resolve(s);
      }
    });
  });

  host.disconnect();

  const paused = (await Promise.race([
    pausedState,
    sleep(2000).then(() => null),
  ])) as State | null;

  if (!paused) throw new Error("player never received paused state");
  if (!paused.paused) throw new Error("expected paused on player state");
  if (paused.paused.reason !== "host-disconnected") {
    throw new Error(`expected reason=host-disconnected, got ${paused.paused.reason}`);
  }
  if (typeof paused.paused.resumeBy !== "number" || paused.paused.resumeBy <= Date.now()) {
    throw new Error(`bad resumeBy: ${paused.paused.resumeBy}`);
  }
  console.log("paused payload:", paused.paused);

  const phaseBeforePause = paused.phase;
  const qIndexBeforePause = paused.questionIndex;

  // reconnect host within grace
  const host2 = await connectSock();
  const resumedState = new Promise<State>((resolve) => {
    player.on("state", function onState(s: State) {
      if (!s.paused) {
        player.off("state", onState);
        resolve(s);
      }
    });
  });
  host2.emit("host:attach", pin);

  const resumed = (await Promise.race([
    resumedState,
    sleep(2000).then(() => null),
  ])) as State | null;
  if (!resumed) throw new Error("player never saw paused cleared");
  if (resumed.paused) throw new Error("paused should be cleared after host reconnect");
  if (resumed.phase !== phaseBeforePause) {
    throw new Error(`phase changed across pause: ${phaseBeforePause} → ${resumed.phase}`);
  }
  if (resumed.questionIndex !== qIndexBeforePause) {
    throw new Error(
      `questionIndex changed across pause: ${qIndexBeforePause} → ${resumed.questionIndex}`,
    );
  }
  console.log("✓ host pause + resume");

  host2.disconnect();
  player.disconnect();
  display.disconnect();
}

// --- scenario 5: profanity filter (scenario 4 = cap, already covered above) ---

async function assertProfanityFilter() {
  console.log("\n--- scenario 5: profanity filter ---");
  const host = await connectSock();
  const dirty = await connectSock();
  const clean = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);

  const bad = await joinPlayerOverSocket(dirty, pin, "fuckface");
  if (bad.ok) throw new Error("offensive nickname should have been rejected");
  if (bad.code !== "nickname-rejected") {
    throw new Error(`expected code=nickname-rejected, got ${bad.code}`);
  }
  if (bad.error !== "Pick another nickname") {
    throw new Error(`expected error="Pick another nickname", got ${bad.error}`);
  }

  const good = await joinPlayerOverSocket(clean, pin, "alice");
  if (!good.ok) throw new Error(`clean nickname rejected: ${good.error}`);
  console.log("✓ profanity filter");

  host.disconnect();
  dirty.disconnect();
  clean.disconnect();
}

// --- scenario 6: CSV export (final phase only) ---

async function assertCsvExport() {
  console.log("\n--- scenario 6: CSV export ---");
  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();
  const { pin } = await createGameOverSocket(host, oneQuestionQuiz);

  await joinPlayerOverSocket(a, pin, "Alice");
  await joinPlayerOverSocket(b, pin, "Bob");

  // pre-final attempt should be 409
  const early = await fetch(`${URL}/host/${pin}/results.csv`);
  if (early.status !== 409) {
    throw new Error(`expected 409 before final, got ${early.status}`);
  }
  console.log("pre-final CSV → 409 ✓");

  host.emit("host:start", pin);
  await sleep(150);
  await new Promise<void>((r) => a.emit("player:answer", pin, 1, () => r()));
  await new Promise<void>((r) => b.emit("player:answer", pin, 0, () => r()));
  await sleep(200);
  // question → reveal → final
  host.emit("host:advance", pin);
  await sleep(100);
  host.emit("host:advance", pin);
  await sleep(200);

  const final = await fetch(`${URL}/host/${pin}/results.csv`);
  if (final.status !== 200) {
    throw new Error(`expected 200 at final, got ${final.status}`);
  }
  const ctype = final.headers.get("content-type") ?? "";
  if (!ctype.toLowerCase().includes("text/csv")) {
    throw new Error(`expected text/csv, got ${ctype}`);
  }
  const body = await final.text();
  const rows = body.split(/\r\n|\n/).filter((line) => line.length > 0);
  // header + 2 players = 3
  if (rows.length !== 3) {
    throw new Error(`expected 3 rows (header + 2 players), got ${rows.length}: ${JSON.stringify(rows)}`);
  }
  console.log("✓ CSV export at final");

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
  if (flag === "false" || flag === "0") {
    console.log("\n--- persistence: disabled (ENABLE_SESSION_PERSISTENCE=false), skipping DB count check ---");
    return;
  }
  console.log("\n--- persistence: post-run DB row counts ---");
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
    if (sessions === 0) throw new Error("expected GameSession rows > 0");
    if (players === 0) throw new Error("expected SessionPlayer rows > 0");
    if (answers === 0) throw new Error("expected SessionAnswer rows > 0");
    console.log("✓ persistence rows written");
  } finally {
    await prisma.$disconnect();
  }
}

async function assertSameSocketDoubleSubmitIdempotent() {
  console.log("\n--- scenario: same-socket double submit is idempotent ---");
  const host = await connectSock();
  const player = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);

  const j1 = await joinPlayerOverSocket(player, pin, "Alice");
  const j2 = await joinPlayerOverSocket(player, pin, "Alice");

  if (!j1.ok) throw new Error(`first join failed: ${j1.error}`);
  if (!j2.ok) throw new Error(`second join (duplicate) failed: ${j2.error}`);
  if (j1.playerId !== j2.playerId) {
    throw new Error(`expected same playerId on duplicate, got ${j1.playerId} vs ${j2.playerId}`);
  }

  const otherSocket = await connectSock();
  const j3 = await joinPlayerOverSocket(otherSocket, pin, "Alice");
  if (j3.ok) throw new Error("different socket with same nickname should fail");

  console.log("✓ same-socket double submit is idempotent");
  host.disconnect();
  player.disconnect();
  otherSocket.disconnect();
}

setTimeout(() => {
  console.error("[smoke] hard timeout 180s");
  process.exit(2);
}, 180000).unref();

// --- scenario 7: display reconnect rejoins room ---

async function assertDisplayReconnectRejoinsRoom() {
  console.log("\n--- scenario 7: display reconnect rejoins room ---");
  const host = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);

  const display = await connectSock();
  // mirror the F3 client fix: re-emit display:attach on every connect so a
  // fresh socket (post-reconnect) rejoins pin:${pin} and receives broadcasts.
  display.on("connect", () => display.emit("display:attach", pin));
  display.emit("display:attach", pin);

  const firstState = await new Promise<State>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no initial state on display")), 3000);
    display.once("state", (s: State) => {
      clearTimeout(t);
      resolve(s);
    });
  });
  if (firstState.pin !== pin) throw new Error(`initial state pin mismatch: ${firstState.pin}`);

  display.disconnect();
  await sleep(100);
  const reconnected = new Promise<void>((resolve) => display.once("connect", () => resolve()));
  display.connect();
  await reconnected;

  const got = await new Promise<State>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no state after reconnect")), 3000);
    display.once("state", (s: State) => {
      clearTimeout(t);
      resolve(s);
    });
  });
  if (!got || got.pin !== pin) {
    throw new Error("display did not receive state after reconnect");
  }
  console.log("✓ display reconnect rejoins room");

  display.disconnect();
  host.disconnect();
}

// --- scenario 8 (F1): Q1 auto-lock with no answers ---

const shortQuiz: Quiz = {
  title: "Short Quiz",
  questions: [
    {
      id: "q1",
      type: "multiple",
      text: "Pick A",
      options: ["A", "B", "C", "D"],
      correct: 0,
      timeLimit: 3,
      doublePoints: false,
    },
  ],
};

async function assertQ1AutoLockNoAnswers() {
  console.log("\n--- scenario 8 (F1): Q1 auto-lock with no answers ---");
  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();
  const { pin } = await createGameOverSocket(host, shortQuiz);

  await joinPlayerOverSocket(a, pin, "Alice");
  await joinPlayerOverSocket(b, pin, "Bob");

  // listen for the reveal-phase state on the host socket
  const revealed = new Promise<State>((resolve) => {
    host.on("state", function onState(s: State) {
      if (s.phase === "reveal") {
        host.off("state", onState);
        resolve(s);
      }
    });
  });

  host.emit("host:start", pin);

  // timeLimit 3s + 50ms server slack + buffer
  const result = (await Promise.race([
    revealed,
    sleep(4500).then(() => null),
  ])) as State | null;

  if (!result) {
    throw new Error("Q1 never auto-locked — host:start did not schedule auto-lock");
  }
  if (result.phase !== "reveal") {
    throw new Error(`expected phase=reveal after timeout, got ${result.phase}`);
  }
  console.log("✓ Q1 auto-locks with no answers (F1)");

  host.disconnect();
  a.disconnect();
  b.disconnect();
}

// --- scenario 9 (F2): paused question rejects answers ---

async function assertPausedQuestionRejectsAnswers() {
  console.log("\n--- scenario 9 (F2): paused question rejects answers ---");
  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);

  await joinPlayerOverSocket(a, pin, "Alice");
  await joinPlayerOverSocket(b, pin, "Bob");

  host.emit("host:start", pin);
  await sleep(200);

  // wait for player a to see paused state
  const pausedSeen = new Promise<State>((resolve) => {
    a.on("state", function onState(s: State) {
      if (s.paused) {
        a.off("state", onState);
        resolve(s);
      }
    });
  });

  host.disconnect();

  const paused = (await Promise.race([
    pausedSeen,
    sleep(2000).then(() => null),
  ])) as State | null;
  if (!paused) throw new Error("paused state never propagated to player");
  if (paused.phase !== "question") {
    throw new Error(`expected phase to remain 'question' while paused, got ${paused.phase}`);
  }

  // remaining player tries to answer while paused
  const ack = await new Promise<{ ok: boolean; error?: string; reason?: string }>((r) =>
    a.emit("player:answer", pin, 1, r),
  );
  if (ack.ok) throw new Error("paused answer should have been rejected");
  if (ack.reason !== "paused") {
    throw new Error(`expected reason='paused', got '${ack.reason}' (error: ${ack.error})`);
  }

  // the same is true for player b — and the phase must still be 'question'
  const ack2 = await new Promise<{ ok: boolean; reason?: string }>((r) =>
    b.emit("player:answer", pin, 1, r),
  );
  if (ack2.ok || ack2.reason !== "paused") {
    throw new Error(`second paused answer not rejected as paused: ${JSON.stringify(ack2)}`);
  }

  // host returns and the question can resume normally
  const host2 = await connectSock();
  const resumed = new Promise<State>((resolve) => {
    a.on("state", function onState(s: State) {
      if (!s.paused && s.phase === "question") {
        a.off("state", onState);
        resolve(s);
      }
    });
  });
  host2.emit("host:attach", pin);
  const after = (await Promise.race([
    resumed,
    sleep(2000).then(() => null),
  ])) as State | null;
  if (!after) throw new Error("question did not resume after host reattach");

  console.log("✓ paused question rejects answers (F2)");

  host2.disconnect();
  a.disconnect();
  b.disconnect();
}

// --- scenario 10 (F4): late answer rejected after deadline ---

const veryShortQuiz: Quiz = {
  title: "Very Short Quiz",
  questions: [
    {
      id: "q1",
      type: "multiple",
      text: "Pick A",
      options: ["A", "B", "C", "D"],
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
  console.log("\n--- scenario 10 (F4): late answer rejected ---");
  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();
  const { pin } = await createGameOverSocket(host, veryShortQuiz);

  await joinPlayerOverSocket(a, pin, "Alice");
  await joinPlayerOverSocket(b, pin, "Bob");

  // capture endsAt from the question-phase state broadcast
  const endsAtPromise = new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("never saw question state")), 2000);
    a.on("state", function onState(s: StateWithEndsAt) {
      if (s.phase === "question" && typeof s.endsAt === "number") {
        a.off("state", onState);
        clearTimeout(t);
        resolve(s.endsAt);
      }
    });
  });

  host.emit("host:start", pin);
  const endsAt = await endsAtPromise;

  // land in the 50ms window between endsAt and the server-side auto-lock
  // (scheduled at endsAt + 50ms). Aim 10ms past the deadline.
  const wait = Math.max(0, endsAt - Date.now() + 10);
  await sleep(wait);

  const ack = await new Promise<{ ok: boolean; error?: string; reason?: string }>((r) =>
    a.emit("player:answer", pin, 0, r),
  );
  if (ack.ok) throw new Error("late answer should have been rejected");
  if (ack.reason !== "expired") {
    throw new Error(`expected reason='expired', got '${ack.reason}' (error: ${ack.error})`);
  }
  console.log("✓ late answer rejected with reason=expired (F4)");

  host.disconnect();
  a.disconnect();
  b.disconnect();
}

// --- scenario 11 (F5): malformed host:create rejected, server still alive ---

async function assertMalformedHostCreateRejected() {
  console.log("\n--- scenario 11 (F5): malformed host:create rejected ---");
  const host = await connectSock();

  // questions is not an array → must ack with reason: "invalid-quiz" and not crash
  const bad = await new Promise<{ ok?: boolean; pin?: string; reason?: string }>((r) =>
    host.emit(
      "host:create",
      { title: "Bad", questions: "not-an-array" },
      r,
    ),
  );
  if (bad.ok) throw new Error(`expected malformed host:create to be rejected, got ${JSON.stringify(bad)}`);
  if (bad.reason !== "invalid-quiz") {
    throw new Error(`expected reason='invalid-quiz', got '${bad.reason}'`);
  }

  // server must still be alive — a well-formed create on the same socket should succeed
  const good = await new Promise<{ ok?: boolean; pin?: string; reason?: string }>((r) =>
    host.emit("host:create", quiz, r),
  );
  if (!good.ok || !good.pin) {
    throw new Error(`server unhealthy after malformed payload: ${JSON.stringify(good)}`);
  }
  console.log("✓ malformed host:create rejected, server alive (F5)");

  host.disconnect();
}

// --- scenario 12 (F5): malformed player:join rejected ---

async function assertMalformedPlayerJoinRejected() {
  console.log("\n--- scenario 12 (F5): malformed player:join rejected ---");
  const host = await connectSock();
  const player = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);

  const longNick = "x".repeat(100);
  const ack = await new Promise<{ ok: boolean; reason?: string; error?: string }>((r) =>
    player.emit("player:join", pin, longNick, r),
  );
  if (ack.ok) throw new Error("100-char nickname should have been rejected");
  if (ack.reason !== "invalid-nickname") {
    throw new Error(`expected reason='invalid-nickname', got '${ack.reason}' (error: ${ack.error})`);
  }

  // a clean follow-up join still works
  const good = await joinPlayerOverSocket(player, pin, "Alice");
  if (!good.ok) throw new Error(`clean join failed after rejection: ${good.error}`);

  console.log("✓ malformed player:join rejected (F5)");

  host.disconnect();
  player.disconnect();
}

// --- scenario 13 (F5): malformed player:answer rejected ---

async function assertMalformedPlayerAnswerRejected() {
  console.log("\n--- scenario 13 (F5): malformed player:answer rejected ---");
  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();
  const { pin } = await createGameOverSocket(host, quiz);

  await joinPlayerOverSocket(a, pin, "Alice");
  await joinPlayerOverSocket(b, pin, "Bob");
  host.emit("host:start", pin);
  await sleep(200);

  // answerIndex=99 must be rejected with reason="invalid-answer"
  const ack = await new Promise<{ ok: boolean; reason?: string; error?: string }>((r) =>
    a.emit("player:answer", pin, 99, r),
  );
  if (ack.ok) throw new Error("answerIndex=99 should have been rejected");
  if (ack.reason !== "invalid-answer") {
    throw new Error(`expected reason='invalid-answer', got '${ack.reason}' (error: ${ack.error})`);
  }

  // valid answer still works after the rejection
  const ok = await new Promise<{ ok: boolean; error?: string }>((r) =>
    a.emit("player:answer", pin, 1, r),
  );
  if (!ok.ok) throw new Error(`valid answer rejected after malformed: ${ok.error}`);

  console.log("✓ malformed player:answer rejected (F5)");

  host.disconnect();
  a.disconnect();
  b.disconnect();
}

// --- scenario 14 (F10): CSV formula injection neutralized ---

async function assertCsvFormulaNeutralized() {
  console.log("\n--- scenario 14 (F10): CSV formula injection neutralized ---");
  const host = await connectSock();
  const a = await connectSock();
  const b = await connectSock();
  const { pin } = await createGameOverSocket(host, oneQuestionQuiz);

  const ja = await joinPlayerOverSocket(a, pin, "=cmd");
  if (!ja.ok) throw new Error(`join '=cmd' failed: ${ja.error}`);
  const jb = await joinPlayerOverSocket(b, pin, "+1+1");
  if (!jb.ok) throw new Error(`join '+1+1' failed: ${jb.error}`);

  host.emit("host:start", pin);
  await sleep(150);
  await new Promise<void>((r) => a.emit("player:answer", pin, 1, () => r()));
  await new Promise<void>((r) => b.emit("player:answer", pin, 1, () => r()));
  await sleep(200);
  // question → reveal → final
  host.emit("host:advance", pin);
  await sleep(100);
  host.emit("host:advance", pin);
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
  console.log("✓ CSV formula injection neutralized (F10)");

  host.disconnect();
  a.disconnect();
  b.disconnect();
}
