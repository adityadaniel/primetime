# Codex Review — BROADCAST Word Cloud v1 (PR #23, branch feat/wordcloud)

## Summary
The PR has the right broad shape, but it needs more work before merge. The main blocker is that the normal `/join` flow still emits quiz-only socket events, so players cannot join a word-cloud session through the advertised path. There is also a real host authorization gap in the word-cloud socket handlers, plus lifecycle/persistence problems around server restart, fire-and-forget DB writes, and moderation races. Targeted word-cloud Vitest coverage passes: `5 passed, 80 tests`.

## Findings

### F1 — `/join` cannot join a word-cloud PIN
**Severity:** critical  
**Files:** app/join/page.tsx:34, app/join/page.tsx:50, app/play/[pin]/page.tsx:21, app/play/[pin]/wordcloud/page.tsx:77  
**Category:** UX

The player entry route still always emits the quiz event:

```ts
socket.emit('player:join', pin, nickname.trim(), ...)
```

For a word-cloud PIN, `server.ts` quiz `player:join` looks only at in-memory quiz games, so it returns “Game not found” and never stores `bc:player:${pin}` / `bc:nick:${pin}` or routes the player to `/play/${pin}`. The server component redirect in `app/play/[pin]/page.tsx` is correct, but players never reach it from the normal join form.

This breaks the PRD’s “Join flow identical to quiz” requirement and is live-session-breaking. Fix by making `/join` detect the session type before joining, or by having the server expose a unified join event that branches to quiz vs word cloud and returns the correct destination. The smoke tests bypass this by directly emitting `wordcloud:player:join`, so they do not catch the real user flow.

### F2 — Host socket actions are not authorized against the session owner
**Severity:** critical  
**Files:** server.ts:399, server.ts:401, server.ts:417, server.ts:638, server.ts:675, app/host/wordcloud/[pin]/control/page.tsx:61  
**Category:** auth

`wordcloud:host:create` trusts socket payloads to attach a host socket to a PIN/session pair, and the later privileged events only check `state.hostSocketId === socket.id`. There is no Auth.js session verification on the socket and no DB lookup proving that the authenticated user owns `WordCloudSession.hostUserId`.

For API-created sessions, the control page does not send `hostUserId`, so `state.hostUserId` becomes `null` in memory even though the DB row has a real owner. For socket-created sessions, any client can create a host-owned-in-practice session with `hostUserId: null`. If a control URL/query leaks, or if memory is empty and a user can provide a PIN/sessionId, a non-owner socket can become the host socket and call `wordcloud:host:remove` or `wordcloud:host:set-status`.

Fix by authenticating Socket.IO connections or moving privileged host mutations behind auth-gated HTTP routes. At minimum, `wordcloud:host:create`/attach should load the DB session by `pin`, compare `session.hostUserId` to the authenticated user id, verify `session.id`, and only then set `state.hostSocketId`.

### F3 — Word-cloud state is not hydrated from Prisma after server restart
**Severity:** high  
**Files:** server.ts:163, server.ts:496, server.ts:662, server.ts:673, lib/wordcloud-repo.ts:72  
**Category:** lifecycle

All active word-cloud behavior depends on `wordCloudStates`, but player join, display attach, and host status changes only read that in-memory map. `getSessionByPin` exists in `lib/wordcloud-repo.ts`, but it is not used by the socket handlers.

After a dev-server restart mid-session, `/play/[pin]` still detects the DB row and redirects to `/play/[pin]/wordcloud`, but `wordcloud:player:join` returns `not_found`. The display attach silently returns nothing. The control page can recreate a fresh in-memory state only if the original query params are still present, and even then it recreates an empty LOBBY state with no persisted players/submissions/status.

Fix by adding a `loadOrCreateWordCloudState(pin)` path that reads `WordCloudSession`, players, non-removed submissions, and status from Prisma, rebuilds the maps, and is used by host attach, player join, and display attach.

### F4 — `/join` and socket smoke coverage do not test the same path
**Severity:** high  
**Files:** scripts/smoke.ts:988, scripts/smoke.ts:1043, app/join/page.tsx:34  
**Category:** test-gap

Scenarios 15-17 directly call `wordcloud:host:create`, `wordcloud:player:join`, and `wordcloud:player:submit`. That validates lower-level socket handlers, but it misses the advertised player path through `/join`, which is currently broken.

Before academy use, add either a browser-level test or a socket smoke helper that follows `/join` semantics: submit PIN + nickname through the same unified event/route the UI uses, assert redirection to `/play/[pin]/wordcloud`, then submit a word.

### F5 — Host trash can race with asynchronous submission persistence
**Severity:** high  
**Files:** server.ts:607, server.ts:621, server.ts:642, server.ts:646  
**Category:** race

`wordcloud:player:submit` mutates memory and broadcasts `wordcloud:word:added` before the submission row is persisted. The DB write is fire-and-forget. If the host trashes that word immediately after seeing it, `markSubmissionRemoved` can run before `addSubmission` creates the row, update zero rows, and then the late insert lands with `removed=false`.

That makes CSV export and future hydration inconsistent: a word removed from the live cloud can appear as an unremoved submission in the database. Fix by serializing per-session mutations, awaiting persistence before broadcasting moderation-sensitive state, or recording a removed-normalized set so late inserts for already-trashed normalized words are created with `removed=true`.

### F6 — Persistence failures are hidden while the live session continues
**Severity:** high  
**Files:** server.ts:447, server.ts:459, server.ts:541, server.ts:555, server.ts:620  
**Category:** lifecycle

If `repoCreateSession` fails in the socket-created path, the handler still returns a fake `sessionId` and runs the session in memory. If `repoAddPlayer` fails, the handler still accepts the player, but leaves `dbPlayerId` null. Later submissions from that player are accepted in memory but skipped for persistence because `dbPlayerId` is missing.

That means CSV export can silently omit participants/submissions after a transient DB issue. Since this feature promises full CSV export and Prisma is the durable record, session creation and player join should fail closed when persistence fails, or the server needs a retry/reconciliation queue before accepting submissions.

### F7 — PIN allocation can collide across quiz and word-cloud DB rows
**Severity:** high  
**Files:** lib/wordcloud-repo.ts:60, lib/wordcloud-repo.ts:63, app/play/[pin]/page.tsx:9  
**Category:** lifecycle

The HTTP word-cloud allocator checks only `WordCloudSession.pin`. It does not check `GameSession.pin`, while `/play/[pin]` explicitly gives quiz rows priority if both tables contain the same PIN.

A rare random collision would create a word-cloud session that is effectively unreachable from `/play/[pin]`, because the route will render the quiz client. The in-memory socket allocator checks `getGame(pin)`, but the API path used by `/host/wordcloud/new` does not. Fix with one shared allocator that checks both tables and active in-memory quiz pins, or move to a shared `PinReservation` table.

### F8 — Ended sessions can be reopened by socket status changes
**Severity:** high  
**Files:** server.ts:668, server.ts:679, lib/wordcloud.ts:172  
**Category:** lifecycle

`wordcloud:host:set-status` accepts any valid status from any current status. `setStatus` simply assigns the new value. A host socket can send `ENDED -> LIVE` and the server will resume accepting submissions, even though ENDED is supposed to freeze the cloud and enable final CSV export.

Add an explicit transition table: `LOBBY -> LIVE`, `LIVE -> PAUSED|ENDED`, `PAUSED -> LIVE|ENDED`, and make `ENDED`/`ARCHIVED` terminal for live sockets. Reject invalid transitions and include tests for terminal behavior.

### F9 — Display layout drops most words at normal academy scale
**Severity:** high  
**Files:** lib/wordcloud-layout.ts:34, lib/wordcloud-layout.ts:152, lib/wordcloud-layout.ts:154, lib/wordcloud-layout.test.ts:130  
**Category:** UX

The collision search tries only 60 spiral positions, with a maximum radius around 468px from center. In a local check at 1920×1080, 50 synthetic five-character words placed only 5 words, and 200 placed only 10. With 100 ten-character words, only 4 placed.

The tests only verify non-overlap for 8 words, so the PRD’s 50-player/200-player display requirements are not meaningfully covered. Increase the search area/retries, reduce font scale after the top ranks, allow denser overlap tolerance, or intentionally cap visible words with an explicit “top N” policy. Add tests that assert a minimum placement ratio for 50, 150, and 200 unique words.

### F10 — CSV export is available before the activity ends
**Severity:** medium  
**Files:** app/host/wordcloud/[pin]/answers.csv/route.ts:15, app/host/wordcloud/[pin]/answers.csv/route.ts:34, app/host/wordcloud/[pin]/control/page.tsx:299  
**Category:** csv

The control UI only enables export after ENDED, but the route itself does not select or check `WordCloudSession.status`. A direct GET to `/host/wordcloud/[pin]/answers.csv` exports live submissions during LOBBY/LIVE/PAUSED.

The PRD says export is after end. Add `status` to the session select and return `409` unless status is `ENDED` or `ARCHIVED`. This also prevents partial CSVs from being mistaken for final records.

### F11 — PAUSED is persisted as LIVE
**Severity:** medium  
**Files:** server.ts:683, prisma/schema.prisma:152, lib/wordcloud-repo.test.ts:280  
**Category:** lifecycle

The schema has a `PAUSED` enum and the repository tests expect `setStatus(..., 'PAUSED')` to persist `PAUSED`, but the socket handler maps `PAUSED` to `LIVE` before writing to Prisma:

```ts
const dbStatus = p.status === 'PAUSED' ? 'LIVE' : p.status;
```

This makes DB status inaccurate for history, restart hydration, and any later host/session list. Persist the actual `PAUSED` status; if paused should not affect `startedAt`, keep that logic in the repo layer without rewriting the status.

### F12 — Display variant does not update to the most popular casing
**Severity:** medium  
**Files:** lib/wordcloud.ts:141, lib/wordcloud.ts:147, lib/wordcloud-repo.ts:180  
**Category:** validation

The Prisma aggregation layer chooses the most popular original casing, but the hot in-memory path used by live display keeps the first submitted display forever. If the first player sends `EXCITED` and ten later players send `Excited`, the live cloud still displays `EXCITED`.

The PRD requires “display preserves original casing of the most-popular variant.” Track raw display counts in `WordCloudWordEntry`, update `display` when a variant overtakes the current one, and test that behavior in `lib/wordcloud.test.ts`.

### F13 — Word-cloud maps and rate-limit entries are never cleaned up
**Severity:** medium  
**Files:** server.ts:163, server.ts:165, server.ts:689  
**Category:** memory

`wordCloudStates` and `wcLastSubmitAt` live for the lifetime of the server. Disconnect cleanup removes socket bindings, but not ended sessions, old players, or rate-limit entries. Ended/abandoned word clouds will accumulate across long-running academy days.

Add cleanup on terminal status after a retention window, and remove `wcLastSubmitAt` entries when a player/session is reaped. If ended sessions need to remain exportable, rely on Prisma for that and keep only active sessions in memory.

### F14 — Display attach before state exists never joins the room
**Severity:** medium  
**Files:** server.ts:659, server.ts:662, app/host/wordcloud/[pin]/display/page.tsx:36  
**Category:** lifecycle

If the display page opens before the host control socket has registered state, `wordcloud:display:attach` returns without joining `wc:${pin}`. The display then waits only for socket reconnect, not for the host to later create/register the state, so it can stay blank/stuck in the lobby placeholder.

This is likely in refresh/restart workflows or if the display tab is restored before the control tab. The attach path should either hydrate from DB and join immediately, or return an explicit “not ready” response and retry. Joining the room before state exists is also acceptable if later host registration emits `wordcloud:state`.

### F15 — Socket payload validation is stricter than before, but still ad hoc
**Severity:** low  
**Files:** server.ts:367, server.ts:466, server.ts:569, server.ts:631, server.ts:668  
**Category:** type-safety

The word-cloud socket handlers guard basic shape and scalar types, which is good, but validation is duplicated and uses `Record<string, unknown>` casts throughout. There is no shared schema for client/server payloads, and host attach accepts client-provided `prompt`, `wordsPerPlayer`, and `profanityFilter` instead of loading them from the DB.

Use Zod or a small local parser per event, and for existing sessions treat the DB as authoritative. This would also make auth/session checks easier to centralize.

## Acceptance criteria coverage

| criterion | status | notes |
|---|---:|---|
| Host can go from `/host` to a running word cloud in under 90 seconds | ⚠ partial | Creation path exists, but host control attach depends on query params and lacks owner validation. |
| Player can join via PIN and submit a word in under 15 seconds | ✗ missing | `/join` still uses quiz `player:join`, so normal word-cloud join fails. |
| Display reads cleanly from 8m back at 1080p projector | ⚠ partial | Visual surface exists, but layout drops most words at 50-200 unique scale. |
| Profanity filter blocks the standard test list | ✓ met | Server-side `submitWord` uses `isClean`; tests cover basic bad words. |
| Host trash button removes word from all connected clients within 500ms | ⚠ partial | Broadcast is immediate, but auth is weak and DB race can preserve trashed rows incorrectly. |
| 50-player Free tier × 3 words = 150 submissions handled without lag | ⚠ partial | No scale smoke; layout behavior is poor at 50 unique words. |
| 200-player Pro tier × 3 words = 600 submissions handled without lag | ⚠ partial | No scale test; display/layout not proven at this size. |
| CSV export contains all submissions including trashed ones | ⚠ partial | Basic tests pass, but submit/remove race and persistence failures can lose or mis-mark rows. |
| Smoke test extension: at least 3 new scenarios | ✓ met | Scenarios 15, 16, 17 exist. |
| BROADCAST identity preserved across all 4 surfaces | ⚠ partial | Surfaces are implemented; not manually projector/browser verified here. |
| Mobile-friendly host control | ⚠ partial | Responsive classes exist; no automated mobile/browser verification. |
| TypeScript strict, Vitest coverage on new helpers, smoke green | ⚠ partial | Targeted Vitest passed; smoke not run here and key integration paths are untested. |

## Test coverage gaps

- `/join` end-to-end path for a word-cloud PIN, including redirect to `/play/[pin]/wordcloud`.
- Authz test where logged-in user B attempts `wordcloud:host:remove` / `wordcloud:host:set-status` on user A’s session.
- Server restart/hydration test: create, join, submit, restart/rebuild state from Prisma, then display/player reconnect.
- Concurrent submit vs host trash ordering, proving CSV marks the trashed normalized word correctly.
- Invalid status transitions, especially `ENDED -> LIVE`.
- Scale layout tests for 50, 150, and 200 unique words with minimum placement expectations.
- Persistence failure tests for `repoAddPlayer` and `repoAddSubmission`.
- PIN collision test across `GameSession` and `WordCloudSession`.

## Recommendations

1. Fix the normal `/join` flow first; the feature is not usable by players until this works.
2. Add real host authorization for word-cloud socket attach/remove/status events against `WordCloudSession.hostUserId`.
3. Implement Prisma hydration for word-cloud socket state so refresh/restart does not strand sessions.
4. Serialize or otherwise harden submit/trash persistence so CSV and live state cannot diverge.
5. Rework the display layout for 50-200 unique words and add scale tests.

RECOMMEND: BLOCK — Normal player join is broken and privileged host socket actions are not authorized against the authenticated session owner.
