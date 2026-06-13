# Q&A 120-participant stress test — methodology and results

How to validate that the Q&A submission and voting paths handle ≥120
concurrent participants without losing any actions (PRD §8).

## Tools

| Tool | What it measures |
| --- | --- |
| `scripts/qa-stress.ts` | Socket-level: N participants burst-submit questions and burst-vote on a single question; counts successful acks, reports latency percentiles, and verifies final host state matches expected counts. |
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
  rejected by server-side dedup rules (implementation-dependent); all other
  votes must succeed.
- **Ack latency should stay flat.** If p95 grows significantly with
  participant count, there's a backlog or O(N²) broadcast path.
- **Host state verification:** after the burst, the host board must show
  exactly N live questions. Missing questions indicate a persistence or
  state-machine race condition.

## Reference numbers

To be filled after the first validated run. Format:

| Metric | Value |
| --- | --- |
| Participants | 120 |
| Submit duration (wall) | _ms |
| Submit ack p50 / p95 / max | _ms / _ms / _ms |
| Lost submissions | 0 |
| Vote duration (wall) | _ms |
| Vote ack p50 / p95 / max | _ms / _ms / _ms |
| Lost votes | ≤1 |
| Final live question count | 120 |

Background: `docs/120-player-answer-stress-test.md` (quiz precedent),
`docs/q-and-a-prd.md` §8 (realtime AC).
