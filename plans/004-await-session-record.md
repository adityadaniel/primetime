# Plan 004: Quiz session persistence is not silently lost when the DB write is slow or fails

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the linked Linear issue status;
> Linear is the authoritative status source.
>
> **Drift check (run first)**: `git diff --stat 4de99e7..HEAD -- lib/game.ts`
> If `lib/game.ts` changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-expand-coverage-config.md (so new tests are measured); read plans/002 first if unfamiliar with the in-memory game model
- **Category**: bug
- **Planned at**: commit `4de99e7`, 2026-07-05
- **Linear issue**: [MID-429](https://linear.app/midnight-labs/issue/MID-429/improve-004-surface-quiz-session-persistence-failures)

## Why this matters

When a quiz game is created, `createGame` fires the DB write that creates the
session row **without awaiting it** and returns immediately. `session.sessionDbId`
stays `null` until (and unless) that promise resolves. Two problems follow:
(1) if the write **rejects** (DB briefly unavailable at game start), `sessionDbId`
stays `null` forever and every downstream persistence call — player joins,
answers, final results — is silently skipped, so the host later finds an empty
history with no error ever surfaced; (2) even on success, there is a window at
game start where early joins/answers happen before `sessionDbId` is set, and
those records are dropped. This plan closes the silent-failure path: the write
failure must be observable (logged distinctly and flagged on the session) so it
can be surfaced, and the fix must not regress the deliberate "game still runs if
the DB is down" behavior.

## Current state

- `lib/game.ts` — `createGame`. The DB write is fire-and-forget:

```ts
// lib/game.ts:97-119
  const pin = generatePin();
  const session: GameSession = {
    pin,
    tier,
    playerCap,
    displaySocketIds: new Set(),
    quiz,
    phase: 'lobby',
    questionIndex: -1,
    players: new Map(),
    socketToPlayer: new Map(),
    answers: new Map(),
    createdAt: Date.now(),
    sessionDbId: null,
  };
  games.set(pin, session);
  createSessionRecord({ pin, hostUserId, quizSnapshot: quiz })
    .then((row) => {
      if (row) session.sessionDbId = row.id;
    })
    .catch((err) => console.error('[session-repo]', err));
  return session;
```

- Downstream persistence is guarded by `if (game.sessionDbId)` / equivalent
  checks (that is the intended "best effort" fallback). Find them to understand
  the blast radius: `grep -n "sessionDbId" lib/game.ts`. The behavior we must
  preserve is: the in-memory game is fully playable even when the DB write has
  not completed or has failed. The behavior we must fix is the **silent** part —
  a failed write currently looks identical to a not-yet-completed one.

- `GameSession` is the in-memory session type (defined in `lib/game.ts` or
  `lib/types.ts` — confirm with `grep -rn "sessionDbId" lib/types.ts lib/game.ts`).
  You will add one optional flag to it.

- Repo convention: logging uses bracketed tags, e.g.
  `console.error('[session-repo]', err)`. Match that style.

## Commands you will need

| Purpose        | Command                     | Expected on success   |
|----------------|-----------------------------|-----------------------|
| Typecheck      | `npx tsc --noEmit`          | exit 0                 |
| Lint           | `npm run lint`              | exit 0                 |
| Run these tests| `npm test -- lib/game.test.ts` | all pass            |
| Full unit tests| `npm test`                  | all pass               |

## Scope

**In scope** (the only files you should modify):
- `lib/game.ts` (the `createGame` write, plus a small flag on the session type
  if it is declared here)
- `lib/types.ts` (only if `GameSession` is declared there — add the flag)
- `lib/game.test.ts` (extend)

**Out of scope** (do NOT touch):
- `server.ts` socket handlers — this plan does not change how/when the game is
  created relative to socket acks. (Making `createGame` fully synchronous with
  the DB would require an ack refactor; that is explicitly deferred — see
  Maintenance notes.)
- `lib/session-repo.ts` / `createSessionRecord` internals — the write itself is
  fine; the problem is how its failure is handled.

## Git workflow

- Branch: `advisor/004-await-session-record`
- Commit style: conventional commits, e.g. `fix(game): surface failed session-record writes`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a `sessionDbFailed` flag to the session type

Locate the `GameSession` type (grep as noted above). Add an optional boolean
field next to `sessionDbId`:

```ts
  sessionDbId: string | null;
  /** True once the create-session DB write has rejected; distinguishes a failed
   *  write from one that simply has not resolved yet. */
  sessionDbFailed?: boolean;
```

Initialize it in `createGame`'s session literal as `sessionDbFailed: false`.

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 2: Make the write outcome observable

Update the fire-and-forget block in `createGame` so a rejection sets the flag and
logs distinctly (so it is greppable/alertable), while still not blocking the
returned game:

```ts
  games.set(pin, session);
  createSessionRecord({ pin, hostUserId, quizSnapshot: quiz })
    .then((row) => {
      if (row) session.sessionDbId = row.id;
      else {
        session.sessionDbFailed = true;
        console.error('[session-repo] create returned no row', { pin });
      }
    })
    .catch((err) => {
      session.sessionDbFailed = true;
      console.error('[session-repo] create failed — game history will not persist', {
        pin,
        err,
      });
    });
  return session;
```

The game is still returned synchronously and stays playable — we have only made
failure **visible** (a distinct log line + a queryable flag), not fatal.

**Verify**: `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0.

### Step 3: Tests for both outcomes

Extend `lib/game.test.ts`. Mock `createSessionRecord` (the module it comes
from — check the import at the top of `lib/game.ts`, likely `./session-repo`)
and cover:
1. **Success**: resolves a row → after the microtask flush, `session.sessionDbId`
   equals the row id and `sessionDbFailed` is falsy.
2. **Rejection**: rejects → after flush, `sessionDbId` stays `null` and
   `sessionDbFailed === true`.
3. **Playable regardless**: `createGame` returns a usable session synchronously
   even before the write settles (the returned object is non-null and has the
   expected `pin`/`phase: 'lobby'`).

To await the fire-and-forget settlement in the test, flush microtasks (e.g.
`await Promise.resolve()` a couple of times, or `await vi.waitFor(() => expect(...).toBe(...))`).
Model the mock/structure after the existing tests already in `lib/game.test.ts`.

**Verify**: `npm test -- lib/game.test.ts` → all pass including the 3 new cases.

## Test plan

- `lib/game.test.ts` new cases: write success sets `sessionDbId`; write rejection
  sets `sessionDbFailed` and leaves `sessionDbId` null; `createGame` returns a
  playable session synchronously.
- Pattern: match the existing describe/it structure in `lib/game.test.ts`.
- Verification: `npm test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "sessionDbFailed" lib/game.ts` returns ≥2 (init + set on failure)
- [ ] `grep -c "history will not persist" lib/game.ts` returns 1
- [ ] `npm test -- lib/game.test.ts` passes with the 3 new cases
- [ ] `npm test` exits 0
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run lint` exits 0
- [ ] `git status --porcelain` shows only in-scope files
- [ ] Linear issue [MID-429](https://linear.app/midnight-labs/issue/MID-429/improve-004-surface-quiz-session-persistence-failures) moved to `Done`

## STOP conditions

Stop and report back (do not improvise) if:

- The `createGame` excerpt does not match "Current state" (drift).
- `GameSession` turns out to be a Prisma-generated or otherwise non-editable
  type — report it; do not fight the type system.
- You conclude the correct fix is actually to block game creation on the DB
  write (fail-fast) — that is a larger design change touching socket acks and is
  explicitly out of scope here; report the recommendation instead of doing it.
- Test verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **Deferred follow-up (intentional):** this plan makes failure *observable*, not
  *recoverable*. Two larger options were considered and left out: (a) fail-fast —
  block accepting players until `sessionDbId` is set (needs a socket-ack
  refactor); (b) a retry/backfill job that retroactively creates the row and
  replays buffered joins/answers. Pick one deliberately if lost history becomes a
  real support issue.
- A reviewer should confirm the game is still returned synchronously (no `await`
  added in the create path) — the whole point is that gameplay survives a DB
  outage; we only stopped hiding the outage.
- Whoever later surfaces `sessionDbFailed` to the host UI (a "recording failed"
  indicator) should read this flag; wire an alert on the distinct log line in the
  meantime.
