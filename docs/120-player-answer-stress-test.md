# 120-player answer stress test — methodology

How to measure answer-phase fanout and player-feedback latency, and how to
read the numbers. The PR template's "Realtime answer/fanout instrumentation
gate" requires these measurements for any change touching answer submission,
Socket.IO broadcast behavior, the answer lock UI, room state computation, or
realtime transport behavior.

## Tools

| Tool | What it measures |
| --- | --- |
| `scripts/load-fanout.ts` | Socket-level: N clients burst-answer each question; counts every `state`/`personal` delivery per client, reports ack and confirmation latency percentiles, and pulls the server-side counters below. |
| `scripts/browser-lock-latency.ts` | Browser-level: one real Chromium player taps while N bots burst-answer; MutationObserver timestamps tap→`LOCKING…` (optimistic render) and tap→`LOCKED` (server-confirmed personal). |
| `lib/fanout-metrics.ts` + `GET /__fanout-metrics?reset=1` | Server-side, gated behind `FANOUT_METRICS=1` and loopback-only: `player:answer` handler-start→ack timings, event-loop delay histogram, `state`/`personal` emit counts split by cause (answer-driven / phase-transition / membership), rejection counts. |

## Running

```bash
# server (terminal 1) — lib/constants.ts PLAYER_CAP must exceed the simulated player count
ENABLE_SESSION_PERSISTENCE=false FANOUT_METRICS=1 npx tsx server.ts

# socket-level fanout (terminal 2)
PLAYERS=120 npx tsx scripts/load-fanout.ts

# browser-level feedback latency
BOTS=119 npx tsx scripts/browser-lock-latency.ts
```

`ENABLE_SESSION_PERSISTENCE=false` isolates fanout cost from Prisma writes;
run once with it on if the change touches the persistence path.

## Interpretation rules

- **Delivery counts are the primary signal.** Per question burst of N
  answers, a per-answer full broadcast produces ≈ N × room-size `state`
  deliveries and ≈ N² `personal` deliveries (O(N²): ~29k at N=120). Healthy
  is O(N): a handful of phase/coalesced broadcasts × room-size plus ≤ N
  targeted `personal` confirmations.
- **Answer-driven vs phase-transition emits must be read separately.** Phase
  flips (question start, all-answered lock, expiry) are supposed to broadcast
  immediately; per-answer traffic is what must stay flat. In a full burst the
  coalesced answer tick may legitimately read 0 — the all-answered phase flip
  cancels it. The harness opens each question's window before `host:advance`,
  so `phase = 2–3` per question is expected (advance ×2 + start/flip); only
  the `answer` column is the gate signal.
- **Browser tap→`LOCKED` measures the targeted-personal path** (one bot
  abstains so the question stays open). That is the path every answer takes
  except the question-closing one, whose confirmation rides the phase-flip
  broadcast and is visually superseded by the reveal cut.
- **`confirm` latency by answer order is the dead-button detector.** Flat
  across answer order = healthy. Growing with order (late answerers wait for
  everyone ahead) = fanout backlog, the original bug. Note since the
  optimistic-lock fix, `confirm` measures the server's authoritative
  confirmation, not visible feedback — visible feedback is tap→`LOCKING…` in
  the browser harness.
- **Event-loop delay baseline ≈ the sampler resolution (~10ms).** Read the
  spread above ~10–12ms, not the absolute p50. A p99 in the hundreds of ms
  means handlers/emits are starving the loop.
- **Handler-start→ack should be sub-millisecond.** If acks are slow at the
  client but fast at the handler, the cost moved into queueing/serialization
  (event-loop delay, transport), not the handler body.
- **Loopback numbers are a lower bound.** One process on localhost has no
  venue WiFi, no AP contention, no polling fallback, no slow phones. Treat
  ratios (before/after, first-10/last-10) as the signal, absolutes as
  optimistic.

## Alternative causes to rule out before blaming fanout

- Disconnect/reconnect storms (grace-window rejoin loops) rather than answers.
- Transport fallback: a client stuck on HTTP polling behaves far worse than
  websocket peers.
- Venue WiFi / tunnel (`NEXT_PUBLIC_SITE_URL` through live.theprimetime.id)
  adding latency unrelated to server fanout.
- Browser main-thread pressure (heavy animations/sfx during the question).
- Disabled-after-first-tap UX: a button that is correctly locked but looks
  unchanged reads as dead — verify the lock is *visible*, not just enforced.

## Reference numbers (2026-06-10, M-series laptop, loopback, N=120)

| Metric (per question burst) | Pre-fix | Post-fix |
| --- | --- | --- |
| `state` deliveries | ~14.8k | 244–366 |
| `personal` deliveries | ~14.6k | 359–479 (≈119 targeted + phase broadcasts) |
| Client ack p50 / max | 283ms / 338ms | 8–15ms / 21ms |
| Confirm, first-10 vs last-10 answerers | 43ms vs 330ms | ~8ms vs ~20ms |
| Browser tap→`LOCKING…` | n/a (state didn't exist; first visible change ≈ confirm) | 3.3–5.5ms |
| Browser tap→`LOCKED` | ≈ confirm latency (up to ~330ms+) | 7.8–8.8ms |

Background: `DECISIONS.md` entry "Answer-phase fanout is coalesced; player
feedback is optimistic" (2026-06-10).
