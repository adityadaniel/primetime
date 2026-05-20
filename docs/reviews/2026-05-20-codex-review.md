# Codex Review — BROADCAST kahoot-clone (commit e60feda)

## Summary
The core loop is readable and the single-process state machine avoids true multithreaded races, but several academy-realistic lifecycle paths are still fragile. The biggest risks are that the first question often has no auto-lock timer, host-pause does not actually stop answer mutation, display sockets do not rejoin rooms after reconnect, and socket payloads are trusted enough to crash or corrupt a session. The M2.5 150-player hard cap is enforced in `joinPlayer`, including reconnect-grace players, but stale disconnected players and one hardcoded `/10` UI still undermine academy readiness.

## Findings

### F1 — First question started by `host:start` never schedules auto-lock
**Severity:** high  
**Files:** `server.ts:101`, `server.ts:108`, `server.ts:214`, `app/host/[pin]/control/page.tsx:44`, `app/host/[pin]/control/page.tsx:317`  
**Category:** race

The lobby “ROLL TAPE” button emits `host:start`, which calls `startGame(game)` and broadcasts, but it never calls `scheduleAutoLock(pin)`. Auto-lock is only scheduled from `host:advance` when the returned phase is `"question"`.

This means the first question can hang forever if not every connected player answers. In a 30-student academy session, one idle tab or distracted student is enough to block Q1 until the host manually clicks “LOCK ANSWERS”, contradicting the README’s timer behavior.

Concrete fix: after `startGame(game)`, detect whether the game entered `"question"` and call `scheduleAutoLock(pin)`. Also add a smoke scenario where Q1 starts through `host:start`, no players answer, and the phase becomes `reveal` after the configured timeout.

### F2 — Host pause does not stop player answers or early auto-lock
**Severity:** high  
**Files:** `lib/game.ts:106`, `lib/game.ts:120`, `lib/game.ts:357`, `lib/game.ts:393`, `server.ts:185`  
**Category:** race

`pauseForHostDisconnect` records pause metadata but leaves `game.phase` as `"question"`. `submitAnswer` only checks `game.phase !== "question"`, so players can still submit while the host is disconnected. If the remaining connected players answer during the pause, `submitAnswer` can call `lockQuestion(game)` and move the session to `reveal` while `pausedAt` is still set.

That creates inconsistent state: the display/player overlays say paused, but scoring and phase advancement have continued. When the host returns, `resumeFromPause` may no longer be resuming a question at all, so the preserved `pauseRemainingMs` is effectively meaningless.

Concrete fix: make pause a real guard in server-authoritative mutation paths. `submitAnswer`, `advance`, and `startGame` should reject or no-op while `isPaused(game)` is true, except for the explicit host reattach/resume path.

### F3 — Display sockets do not reattach after network reconnect
**Severity:** high  
**Files:** `app/host/[pin]/display/page.tsx:19`, `server.ts:125`, `lib/socket.ts:13`  
**Category:** socket-lifecycle

The display page emits `display:attach` once when the component effect runs. Unlike the host control and player page, it does not register a `connect` handler to re-emit `display:attach` after Socket.IO reconnects.

Socket.IO rooms are tied to the current socket connection. After a projector laptop sleeps, Wi-Fi blips, or polling/websocket reconnects, the display can be connected but no longer in `pin:${pin}`, so it stops receiving `state` broadcasts.

Concrete fix: mirror the control page pattern: add an `onConnect` handler that emits `display:attach`, and clean it up in the effect teardown. Add smoke coverage that disconnects/reconnects the display socket and verifies it receives the next state.

### F4 — Answers can be accepted after the deadline
**Severity:** high  
**Files:** `lib/game.ts:357`, `lib/game.ts:375`, `server.ts:214`  
**Category:** timing

`submitAnswer` does not compare `Date.now()` with `game.questionEndsAt`. It relies on the auto-lock timer to have already advanced the phase. Because the timer fires at `ms + 50`, and because the first question currently may not have a timer at all, late answers can be accepted as long as the phase is still `"question"`.

The scoring formula clamps the fraction to zero, so a correct late answer still receives the minimum score: 500 points, or 1000 on double-points questions. That is a real fairness issue.

Concrete fix: in `submitAnswer`, reject when `game.questionEndsAt` is set and `Date.now() > game.questionEndsAt`. If the deadline has passed, lock the question before returning or route the event through a single `maybeExpireQuestion(game)` helper.

### F5 — Socket acks and payload shapes are trusted enough to crash handlers
**Severity:** high  
**Files:** `server.ts:66`, `server.ts:132`, `server.ts:162`, `lib/game.ts:67`, `lib/game.ts:223`, `lib/game.ts:357`  
**Category:** type-safety

Socket handlers assume client payloads match TypeScript types at runtime. Examples: `player:join` calls `ack(...)` unconditionally, `player:answer` calls `ack(...)` unconditionally, and `host:create` passes arbitrary `quiz` into `createGame`. A malformed socket event with a missing ack, invalid quiz, non-array `questions`, weird `timeLimit`, or bad `correct` value can throw inside the handler.

This matters even without public auth because academy students share a local app surface and Socket.IO is reachable from browser devtools. A single malformed event should not be able to crash or poison the in-memory session.

Concrete fix: add small runtime validators at the socket boundary. Check ack is a function before calling it, validate PIN/nickname/answer index/quiz shape, clamp or reject unsupported time limits, and wrap `host:create` in a try/catch that returns an error ack.

### F6 — Stale disconnected players are never reaped globally
**Severity:** medium  
**Files:** `lib/game.ts:189`, `lib/game.ts:209`, `lib/game.ts:223`, `lib/game.ts:455`  
**Category:** memory

`reapStalePlayers(game)` exists, but no production path calls it. `capStatus` stops counting disconnected players after the grace window, so the hard cap eventually frees capacity, but the old `Player` records remain in `game.players`.

Consequences: lobby/player lists can include long-dead players, leaderboards and CSV exports can include abandoned entries, and memory grows for every disconnect over the lifetime of the process. A 150-player cap does not prevent a single game from accumulating far more than 150 `Player` records over repeated disconnect/rejoin cycles.

Concrete fix: call `reapStalePlayers` before joins, before public state generation, and before cap calculation. Decide whether expired in-game players should remain in final results; if yes, separate “roster/results participants” from “active join capacity”.

### F7 — Game sessions are never deleted
**Severity:** medium  
**Files:** `lib/game.ts:53`, `lib/game.ts:67`, `lib/game.ts:135`, `server.ts:199`  
**Category:** memory

`games` is a process-global `Map` with no TTL, explicit deletion, or final-session cleanup. Every created game remains in memory after final state, including quiz content, players, answers, socket mappings, and disconnected-player records.

For normal local development this is fine, but academy prep sessions often involve repeated dry runs before class. Over a long day, this can produce stale PIN collisions pressure, stale exports, and unnecessary memory growth.

Concrete fix: add a cleanup policy. For example, delete final games after N hours, delete never-started empty lobbies after N minutes, and clear any related `lockTimers` / `hostGraceTimers` when deleting.

### F8 — Projector lobby still advertises `/10` despite the 150 hard cap
**Severity:** high  
**Files:** `app/host/[pin]/display/page.tsx:126`, `app/host/[pin]/display/page.tsx:129`, `lib/game.ts:209`  
**Category:** UX

The server cap now reports `soft: 150` and `hard: 150`, and the control panel uses that state. The display lobby, however, hardcodes the check-in denominator as `/ 10`.

This will be visible on the projector during a 20-30 student academy session and directly contradicts the intended M2.5 hardcode override. The server will accept students 11-30, but the public display will appear over capacity.

Concrete fix: use `state.cap?.soft ?? 150` or `state.cap?.hard ?? 150` in the display lobby, matching the control panel.

### F9 — Leaderboard tie handling is unstable from a product standpoint
**Severity:** low  
**Files:** `lib/game.ts:410`, `lib/game.ts:423`, `app/host/[pin]/control/page.tsx:73`, `app/host/[pin]/display/page.tsx:282`  
**Category:** maintainability

The leaderboard sorts by score only and assigns ranks by array index. Equal scores receive different ranks based on insertion order, and UI components sometimes re-sort independently instead of using the server’s ranked `podium`/leaderboard semantics.

This is deterministic in modern JS, but it is not an explicit product rule. In a classroom quiz with many tied scores, two students with identical points can see rank 5 and rank 6 without any tie-break explanation.

Concrete fix: define tie behavior. Either use competition ranking (`1, 1, 3`) or add a documented tie-breaker such as earliest last correct answer. Then centralize rank calculation server-side and expose it in public/personal state.

### F10 — CSV export is vulnerable to spreadsheet formula injection
**Severity:** medium  
**Files:** `lib/game.ts:416`, `lib/game.ts:423`, `server.ts:257`  
**Category:** security

`csvEscape` handles quotes, commas, and newlines, but it does not neutralize spreadsheet formulas. A nickname beginning with `=`, `+`, `-`, or `@` will be exported as-is. If the host opens the CSV in Excel or Google Sheets, it may be interpreted as a formula.

The 20-character nickname limit reduces blast radius but does not remove the issue. This is still worth fixing because CSV export is a host-facing academy workflow.

Concrete fix: when exporting user-controlled text, prefix dangerous leading characters with a single quote or tab before CSV escaping. Add smoke coverage for nicknames with commas, quotes, newlines, and formula prefixes.

### F11 — Profanity filter has both Scunthorpe false positives and Unicode bypasses
**Severity:** medium  
**Files:** `lib/profanity.ts:1`, `lib/profanity.ts:34`, `lib/profanity.ts:54`  
**Category:** UX

The filter normalizes to ASCII letters and then does substring matching. That blocks obvious bad nicknames, but it also rejects innocent names containing listed substrings, such as `Scunthorpe`, `Fagan`, `Dicken`, or `Ignazio`. In a real classroom, false positives on student names are a high-friction failure mode.

At the same time, non-ASCII homoglyphs are dropped rather than normalized, so some offensive words can be bypassed with Cyrillic/Greek lookalikes.

Concrete fix: use a boundary-aware matcher for short words, maintain an allowlist for common proper-name false positives, and normalize Unicode with `NFKC` plus a small homoglyph map if this filter remains custom.

### F12 — Smoke tests miss the highest-risk lifecycle paths
**Severity:** medium  
**Files:** `scripts/smoke.ts:92`, `scripts/smoke.ts:143`, `scripts/smoke.ts:463`, `scripts/smoke.ts:519`  
**Category:** smoke-gap

The smoke harness covers a useful happy path plus cap, reconnect, host pause, CSV, profanity, and duplicate join. It does not cover the failure paths most likely to break academy sessions: first-question timer expiry after `host:start`, display reconnect, answer during host pause, malformed socket payloads, late answers after `endsAt`, CSV escaping edge cases, or stale-player reaping.

Because the current happy path has every player answer, it masks the missing Q1 auto-lock timer.

Concrete fix: add targeted scenarios with short time limits or test-only timer hooks. The top additions should be: Q1 auto-lock with no answers, display reconnect receives state, paused question rejects answers, 151st join while grace players are disconnected still rejects, and CSV escaping/formula-prefix export.

## Recommendations
1. Fix `host:start` auto-lock scheduling before any academy run.
2. Make host pause block answer submission and phase advancement.
3. Add display reattach-on-connect so the projector survives network reconnects.
4. Add runtime socket payload validation and ack guards.
5. Replace the display lobby `/10` hardcode and add smoke tests for the timer/reconnect/pause gaps.
