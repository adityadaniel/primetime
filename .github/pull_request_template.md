## Summary

-

## Verification

Paste exact commands and relevant output.

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Narrow smoke/e2e/UI-visible checks, if applicable:

## Realtime answer/fanout instrumentation gate

Required for any change touching answer submission, Socket.IO broadcast behavior, player answer lock UI, room state computation, or realtime transport behavior. If not applicable, explain why.

- Applicability: applicable / not applicable because
- [ ] Server handler-start→ack timing reported: p50 / p95 / p99 / max
- [ ] Server event-loop delay reported: p50 / p95 / p99 / max
- [ ] Public `state` emit count reported, separated by answer-driven vs phase-transition emits
- [ ] `personal` emit count reported, separated by answer-driven vs phase-transition emits
- [ ] Browser/client tap→`LOCKING…` latency reported
- [ ] Browser/client tap→`LOCKED` latency reported separately
- [ ] Timeout/rejection counts reported
- [ ] Harness shape stated: one process / multi-process / multi-machine / real phone / tunnel
- [ ] Real dead-button symptom status stated: reproduced / not reproduced / not tested
- [ ] Alternative causes considered: disconnect/reconnect, venue WiFi/tunnel, browser main-thread pressure, disabled-after-first-tap UX

See `docs/120-player-answer-stress-test.md` for the required methodology and interpretation rules.
