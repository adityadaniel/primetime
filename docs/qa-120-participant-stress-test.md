# Q&A 120-participant stress test — methodology and results

How to validate that the Q&A submission and voting paths handle ≥120
concurrent participants without losing any actions (PRD §8), and that
the submission fanout is coalesced rather than per-submit (fanout fix).

## Tools

| Tool | What it measures |
| --- | --- |
| `scripts/qa-stress.ts` | Socket-level: N participants burst-submit questions and burst-vote on a single question; counts successful acks, reports latency percentiles, verifies final host state, and **counts qa:state / qa:questions / qa:scores room deliveries** to detect fanout regressions. |
| `lib/fanout-metrics.ts` + `GET /__fanout-metrics?reset=1` | Server-side (gated behind `FANOUT_METRICS=1`): emit counts, event-loop delay, ack timings — same instrumentation as the quiz fanout harness. |

## Running

```bash
# server (terminal 1)
ENABLE_SESSION_PERSISTENCE=false FANOUT_METRICS=1 npx tsx server.ts

# stress (terminal 2)
PARTICIPANTS=120 npm run qa:stress
```

## Interpretation

- **Zero lost submissions is the primary gate.** Every participant's submit
  must ack with a `questionId`. Any `error` response counts as lost.
- **≤1 lost vote is acceptable.** The question owner's self-upvote may be
  rejected by server-side dedup rules; all other votes must succeed.
- **Ack latency should stay flat.** If p95 grows significantly with
  participant count, there's a backlog or O(N²) broadcast path.
- **Host state verification:** after the burst, the host board must show
  exactly N live questions. Missing questions indicate a persistence or
  state-machine race condition.
- **Fanout regression gate (submit phase):** After all participants join, the
  script waits 500ms to drain join-triggered `qa:state` broadcasts, then resets
  all per-socket counters. Any `qa:state` seen after that reset is from the
  submit burst itself — expected count is **0**. The expected path is coalesced
  `qa:questions` deltas (one per BROADCAST_COALESCE_MS tick regardless of how
  many submits land in that window); the script asserts at least one
  `qa:questions` delivery to confirm the delta path is active.
- **Fanout regression gate (vote phase):** `qa:state` deliveries during the
  vote burst must be **0**. The expected path is coalesced `qa:scores` deltas;
  the script asserts at least one `qa:scores` delivery.

## Submission fanout fix (MID-345)

Before the fix, each unmoderated submit called `qaEmitPublicState()`, sending
a full `qa:state` to every socket in the `qa:${pin}` room. At 120 participants
that is ~14,520 deliveries per burst (120 submits × 121 sockets). After the
fix, submits are coalesced: dirty question ids accumulate for
`BROADCAST_COALESCE_MS` (250ms) and a single `qa:questions` delta is flushed
once per tick. Clients upsert by id and update `questionCount`. A full
`qa:state` on reconnect/join/structural change still delivers the complete
snapshot; the delta path is additive.

## Reference numbers

To be filled after the first validated run. Format:

| Metric | Value |
| --- | --- |
| Participants | 120 |
| Submit duration (wall) | _ms |
| Submit ack p50 / p95 / max | _ms / _ms / _ms |
| Lost submissions | 0 |
| qa:state deliveries (submit phase) | 0 (join-drain before counter reset) |
| qa:questions deliveries (submit phase) | ≥1, ~120 (one batch flush) |
| Vote duration (wall) | _ms |
| Vote ack p50 / p95 / max | _ms / _ms / _ms |
| Lost votes | ≤1 |
| qa:state deliveries (vote phase) | 0 |
| qa:scores deliveries (vote phase) | ≥1, ~120 (one batch flush) |
| Final live question count | 120 |

Background: `docs/120-player-answer-stress-test.md` (quiz precedent),
`docs/q-and-a-prd.md` §8 (realtime AC).
