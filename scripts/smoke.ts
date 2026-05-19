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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

setTimeout(() => {
  console.error("[smoke] hard timeout 20s");
  process.exit(2);
}, 20000).unref();
