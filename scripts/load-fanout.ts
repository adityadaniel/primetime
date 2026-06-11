// Load harness for the answer-burst fanout investigation (dead-button bug).
//
// Reproduces a ~120-player playtest: N players join one game, then answer each
// question in a synchronized burst. Every client socket counts the `state` and
// `personal` events it receives, and each player records two latencies:
//   - ack:      tap → server ack callback
//   - confirm:  tap → first `personal` with hasAnswered=true. Before the
//               optimistic-lock fix this gated the visible LOCKED feedback;
//               after it, the UI locks at tap time and this measures how
//               quickly the server's authoritative confirmation arrives.
//
// If the server does a full broadcast per answer, expect per question roughly:
//   state deliveries    ≈ answers × room size  (~N²)
//   personal deliveries ≈ answers × players    (~N²)
// and confirm latency that grows with answer order (late answerers wait for
// everyone ahead of them).
//
// Usage: server must already run on :4321 with lib/constants.ts PLAYER_CAP >= PLAYERS.
//   PLAYERS=120 npx tsx scripts/load-fanout.ts

import { io } from 'socket.io-client';
import type { Quiz } from '../lib/types';

const URL = process.env.LOAD_URL ?? 'http://localhost:4321';
const PLAYERS = Number(process.env.PLAYERS ?? 120);
const QUESTION_TIME_LIMIT = 120; // keep the question open during the burst

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const quiz: Quiz = {
  title: 'Fanout Load Test',
  questions: [1, 2, 3].map((n) => ({
    id: `q${n}`,
    type: 'multiple' as const,
    text: `Load question ${n}?`,
    options: ['A', 'B', 'C', 'D'],
    correct: 0,
    timeLimit: QUESTION_TIME_LIMIT,
    doublePoints: false,
  })),
};

type Sock = ReturnType<typeof io>;

interface PlayerSlot {
  sock: Sock;
  nickname: string;
  stateCount: number;
  personalCount: number;
  // per-burst bookkeeping (reset each question)
  tEmit: number;
  tAck: number;
  tConfirm: number;
}

function connect(): Promise<Sock> {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 10_000);
    s.on('connect', () => {
      clearTimeout(t);
      resolve(s);
    });
    s.on('connect_error', (e: Error) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

interface ServerMetrics {
  enabled: boolean;
  ackTimingMs: { count: number; p50: number; p95: number; p99: number; max: number };
  eventLoopDelayMs: { p50: number; p95: number; p99: number; max: number } | null;
  stateEmits: Record<string, number>;
  stateDeliveries: Record<string, number>;
  personalEmits: Record<string, number>;
  personalTargetedEmits: number;
  rejections: Record<string, number>;
}

// Server-side counters (lib/fanout-metrics.ts); present only when the server
// runs with FANOUT_METRICS=1. reset=true zeroes the window after reading.
async function fetchServerMetrics(reset: boolean): Promise<ServerMetrics | null> {
  try {
    const res = await fetch(`${URL}/__fanout-metrics${reset ? '?reset=1' : ''}`);
    if (!res.ok) return null;
    const data = (await res.json()) as ServerMetrics;
    return data.enabled ? data : null;
  } catch {
    return null;
  }
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarize(label: string, values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const fmt = (v: number) => (Number.isNaN(v) ? 'n/a' : `${Math.round(v)}ms`);
  console.log(
    `    ${label}: p50=${fmt(pct(sorted, 50))} p90=${fmt(pct(sorted, 90))} p99=${fmt(pct(sorted, 99))} max=${fmt(sorted[sorted.length - 1] ?? Number.NaN)}`,
  );
  return { p50: pct(sorted, 50), p90: pct(sorted, 90), p99: pct(sorted, 99), max: sorted.at(-1) };
}

async function main() {
  console.log(`fanout load test: ${PLAYERS} players against ${URL}`);

  const host = await connect();
  const display = await connect();
  let hostStateCount = 0;
  let displayStateCount = 0;
  let hostPhase = '';
  host.on('state', (s: { phase: string }) => {
    hostStateCount++;
    hostPhase = s.phase;
  });
  display.on('state', () => {
    displayStateCount++;
  });

  const { pin } = await new Promise<{ pin: string }>((r) => host.emit('host:create', quiz, r));
  if (!pin) throw new Error('host:create failed');
  console.log(`pin: ${pin}`);
  display.emit('display:attach', pin);

  // join N players in modest batches so the connect storm itself isn't the test
  const players: PlayerSlot[] = [];
  const BATCH = 20;
  for (let start = 0; start < PLAYERS; start += BATCH) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(BATCH, PLAYERS - start) }, async (_, j) => {
        const i = start + j;
        const sock = await connect();
        const slot: PlayerSlot = {
          sock,
          nickname: `LT${String(i + 1).padStart(3, '0')}`,
          stateCount: 0,
          personalCount: 0,
          tEmit: 0,
          tAck: 0,
          tConfirm: 0,
        };
        sock.on('state', () => {
          slot.stateCount++;
        });
        sock.on('personal', (p: { hasAnswered?: boolean }) => {
          slot.personalCount++;
          if (p?.hasAnswered && slot.tEmit > 0 && slot.tConfirm === 0) {
            slot.tConfirm = performance.now();
          }
        });
        const res = await new Promise<{ ok: boolean; error?: string }>((r) =>
          sock.emit('player:join', pin, slot.nickname, r),
        );
        if (!res.ok) throw new Error(`join ${slot.nickname} failed: ${res.error}`);
        return slot;
      }),
    );
    players.push(...batch);
  }
  console.log(`${players.length} players joined`);
  await sleep(500);

  const roomSize = players.length + 2; // players + host + display
  const totals = { state: 0, personal: 0 };

  for (let q = 0; q < quiz.questions.length; q++) {
    // reset counters so each question window is measured in isolation
    for (const p of players) {
      p.stateCount = 0;
      p.personalCount = 0;
      p.tEmit = 0;
      p.tAck = 0;
      p.tConfirm = 0;
    }
    hostStateCount = 0;
    displayStateCount = 0;
    // Zero the server window BEFORE advancing so the question's own phase
    // broadcasts (advance ×2, start, all-answered flip) are counted — they
    // show up under `phase`, deliberately separate from the `answer` counts
    // the gate cares about.
    await fetchServerMetrics(true);

    if (q === 0) {
      host.emit('host:start', pin);
    } else {
      host.emit('host:advance', pin); // reveal -> leaderboard
      await sleep(300);
      host.emit('host:advance', pin); // leaderboard -> next question
    }
    await sleep(500);
    if (hostPhase !== 'question') throw new Error(`expected question phase, got ${hostPhase}`);

    // synchronized burst: every player answers in the same tick
    let rejectedAcks = 0;
    let timedOutAcks = 0;
    const burstStart = performance.now();
    const acks = players.map(
      (p) =>
        new Promise<void>((resolve) => {
          // a dropped socket never acks — don't let one player hang the run
          const bail = setTimeout(() => {
            timedOutAcks++;
            console.error(`  !! ack timeout for ${p.nickname}`);
            resolve();
          }, 10_000);
          p.tEmit = performance.now();
          p.sock.emit('player:answer', pin, (p.tEmit % 4) | 0, (res: { ok: boolean }) => {
            clearTimeout(bail);
            p.tAck = performance.now();
            if (!res.ok) {
              rejectedAcks++;
              console.error(`  !! answer rejected for ${p.nickname}`);
            }
            resolve();
          });
        }),
    );
    await Promise.all(acks);
    const allAcked = performance.now() - burstStart;

    // wait for confirmations (first personal with hasAnswered=true) to settle
    const confirmDeadline = Date.now() + 30_000;
    while (Date.now() < confirmDeadline && players.some((p) => p.tConfirm === 0)) {
      await sleep(100);
    }
    await sleep(700); // let trailing broadcasts drain into the counters
    const server = await fetchServerMetrics(true);

    const unconfirmed = players.filter((p) => p.tConfirm === 0).length;
    const stateDeliveries =
      players.reduce((a, p) => a + p.stateCount, 0) + hostStateCount + displayStateCount;
    const personalDeliveries = players.reduce((a, p) => a + p.personalCount, 0);
    totals.state += stateDeliveries;
    totals.personal += personalDeliveries;

    console.log(`\n— question ${q + 1} (burst of ${players.length} answers) —`);
    console.log(
      `    state deliveries: ${stateDeliveries} (O(N²) prediction ≈ answers×room = ${players.length * roomSize})`,
    );
    console.log(
      `    personal deliveries: ${personalDeliveries} (O(N²) prediction ≈ answers×players = ${players.length * players.length})`,
    );
    console.log(
      `    all acks returned in ${Math.round(allAcked)}ms; rejected: ${rejectedAcks}; ack timeouts: ${timedOutAcks}; unconfirmed after 30s: ${unconfirmed}`,
    );
    if (unconfirmed > 0) {
      console.log(
        `    !! ${unconfirmed} unconfirmed players are EXCLUDED from the confirm percentiles below`,
      );
    }
    if (server) {
      const a = server.ackTimingMs;
      const e = server.eventLoopDelayMs;
      const se = server.stateEmits;
      const pe = server.personalEmits;
      console.log(
        `    server handler→ack: p50=${a.p50}ms p95=${a.p95}ms p99=${a.p99}ms max=${a.max}ms (n=${a.count})`,
      );
      if (e) {
        console.log(
          `    server event-loop delay: p50=${e.p50}ms p95=${e.p95}ms p99=${e.p99}ms max=${e.max}ms`,
        );
      }
      console.log(
        `    server state emits: answer=${se.answer} phase=${se.phase} membership=${se.membership} other=${se.other}`,
      );
      console.log(
        `    server personal emits: broadcast answer=${pe.answer} phase=${pe.phase}; targeted=${server.personalTargetedEmits}`,
      );
      console.log(`    server rejections: ${JSON.stringify(server.rejections)}`);
    } else {
      console.log('    (server-side metrics unavailable — start server with FANOUT_METRICS=1)');
    }
    summarize(
      'ack latency    ',
      players.filter((p) => p.tAck > 0).map((p) => p.tAck - p.tEmit),
    );
    summarize(
      'confirm latency',
      players.filter((p) => p.tConfirm > 0).map((p) => p.tConfirm - p.tEmit),
    );

    // confirm latency by answer order: first 10 vs last 10 answerers
    const byOrder = [...players].filter((p) => p.tConfirm > 0).sort((a, b) => a.tEmit - b.tEmit);
    if (byOrder.length >= 20) {
      const avg = (arr: PlayerSlot[]) =>
        Math.round(arr.reduce((s, p) => s + (p.tConfirm - p.tEmit), 0) / arr.length);
      console.log(
        `    confirm by answer order: first 10 avg=${avg(byOrder.slice(0, 10))}ms, last 10 avg=${avg(byOrder.slice(-10))}ms`,
      );
    }
  }

  console.log(`\n=== totals across ${quiz.questions.length} questions ===`);
  console.log(`state deliveries: ${totals.state}`);
  console.log(`personal deliveries: ${totals.personal}`);
  console.log(`grand total: ${totals.state + totals.personal}`);
  console.log(
    'harness shape: single Node process, websocket transport, loopback to a local server',
  );

  host.disconnect();
  display.disconnect();
  for (const p of players) p.sock.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

setTimeout(() => {
  console.error('[load-fanout] hard timeout 240s');
  process.exit(2);
}, 240_000).unref();
