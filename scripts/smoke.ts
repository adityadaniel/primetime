// quick smoke test: 1 host + 2 players + 1 display, full game loop
import { io } from "socket.io-client";

const URL = "http://localhost:4321";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const quiz = {
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
  players: Array<{ id: string; nickname: string; score: number }>;
}

async function main() {
  const host = io(URL, { transports: ["websocket"] });
  const display = io(URL, { transports: ["websocket"] });
  const a = io(URL, { transports: ["websocket"] });
  const b = io(URL, { transports: ["websocket"] });

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
    s.on("personal", (p: any) => {
      // optional: console.log(name, "personal", p);
    });
  }

  await new Promise<void>((r) => host.on("connect", () => r()));
  await new Promise<void>((r) => display.on("connect", () => r()));
  await new Promise<void>((r) => a.on("connect", () => r()));
  await new Promise<void>((r) => b.on("connect", () => r()));

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
}

async function assertCapEnforcement() {
  console.log("\n--- cap enforcement: free tier 10-player limit ---");
  const capHost = io(URL, { transports: ["websocket"] });
  await new Promise<void>((r) => capHost.on("connect", () => r()));

  const { pin } = await new Promise<{ pin: string }>((r) =>
    capHost.emit("host:create", quiz, "free", r),
  );
  console.log("cap-test pin:", pin);

  const players: ReturnType<typeof io>[] = [];
  for (let i = 0; i < 10; i++) {
    const p = io(URL, { transports: ["websocket"] });
    await new Promise<void>((r) => p.on("connect", () => r()));
    const res = await new Promise<{ ok: boolean; error?: string; code?: string }>((r) =>
      p.emit("player:join", pin, `Player${i + 1}`, r),
    );
    if (!res.ok) throw new Error(`player ${i + 1} unexpectedly rejected: ${res.error}`);
    players.push(p);
  }
  console.log("10 players joined OK");

  const overflow = io(URL, { transports: ["websocket"] });
  await new Promise<void>((r) => overflow.on("connect", () => r()));
  const rej = await new Promise<{ ok: boolean; error?: string; code?: string }>((r) =>
    overflow.emit("player:join", pin, "Eleventh", r),
  );

  if (rej.ok) throw new Error("11th join should have been rejected");
  if (rej.code !== "full") {
    throw new Error(`expected code "full", got "${rej.code}" (error: ${rej.error})`);
  }
  console.log("11th rejected with code:", rej.code, "·", rej.error);

  await sleep(50);
  const capState = await new Promise<{ playerCount?: number; cap?: { soft: number; hard: number; upsell: boolean } }>(
    (r) => {
      capHost.once("state", (s) => r(s));
      capHost.emit("host:attach", pin);
    },
  );
  if (capState.playerCount !== 10) {
    throw new Error(`expected playerCount=10, got ${capState.playerCount}`);
  }
  if (capState.cap?.soft !== 10 || capState.cap?.hard !== 150) {
    throw new Error(`expected cap {soft:10, hard:150}, got ${JSON.stringify(capState.cap)}`);
  }
  if (!capState.cap.upsell) {
    throw new Error("expected upsell=true at 10/10 free tier");
  }
  console.log("publicState cap:", capState.cap, "playerCount:", capState.playerCount);
  console.log("cap enforcement: PASS");

  capHost.disconnect();
  overflow.disconnect();
  for (const p of players) p.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

setTimeout(() => {
  console.error("[smoke] hard timeout 30s");
  process.exit(2);
}, 30000).unref();
