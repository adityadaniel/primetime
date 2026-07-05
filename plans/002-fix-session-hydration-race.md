# Plan 002: `loadOrCreateState` never hydrates a PIN twice under concurrent connects

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the linked Linear issue status;
> Linear is the authoritative status source.
>
> **Drift check (run first)**: `git diff --stat 4de99e7..HEAD -- lib/qa-hydrate.ts lib/wordcloud-hydrate.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-expand-coverage-config.md (so the new tests land in a measured surface — not a hard blocker)
- **Category**: bug
- **Planned at**: commit `4de99e7`, 2026-07-05
- **Linear issue**: [MID-427](https://linear.app/midnight-labs/issue/MID-427/improve-002-fix-per-pin-session-hydration-race)

## Why this matters

Live quiz/Q&A/word-cloud state is server-authoritative and held **in memory**
in a single process, keyed by PIN. `loadOrCreateState(states, pin)` lazily
hydrates that state from the database on first access. The current
implementation checks the cache, `await`s a DB load, then stores the result —
with **no guard against two concurrent callers doing this at once**. At game
start several sockets connect to the same fresh PIN nearly simultaneously (host
control attach, display attach, and participant joins — 5 distinct call sites in
`server.ts`). Two of them can both miss the cache, both `await` a DB load, both
hydrate **separate** state objects, and the second `states.set()` wins. The
first caller then holds a reference to an orphaned state object that is no
longer in the map: its later mutations (host assignment, votes, joins) are
written to state nobody else can see, and are silently lost. This plan
serializes hydration per-PIN so exactly one state object is ever created.

## Current state

Two files contain the identical bug. Both `loadOrCreateState` functions do
check-cache → await-load → set-map with no in-flight dedup.

- `lib/qa-hydrate.ts` — Q&A hydration. Imports its DB loader from `./qa-repo`:
  - `import { loadSessionForHydration, type QASessionWithRelations } from './qa-repo';` (line 5)
  - `import { createQAState, ..., type QAState } from './qa';` (line 4)

```ts
// lib/qa-hydrate.ts:85-96
export async function loadOrCreateState(
  states: Map<string, QAState>,
  pin: string,
): Promise<QAState | null> {
  const cached = states.get(pin);
  if (cached) return cached;
  const session = await loadSessionForHydration(pin);
  if (!session) return null;
  const state = hydrateStateFromSession(session);
  states.set(pin, state);
  return state;
}
```

- `lib/wordcloud-hydrate.ts` — word-cloud hydration. Imports its DB loader from
  `./wordcloud-repo`:
  - `import { getSessionByPin, type WordCloudSessionWithRelations } from './wordcloud-repo';` (line 10)

```ts
// lib/wordcloud-hydrate.ts:77-88
export async function loadOrCreateState(
  states: Map<string, WordCloudState>,
  pin: string,
): Promise<WordCloudState | null> {
  const cached = states.get(pin);
  if (cached) return cached;
  const session = await getSessionByPin(pin);
  if (!session) return null;
  const state = hydrateStateFromSession(session);
  states.set(pin, state);
  return state;
}
```

- Callers (context only — do NOT modify `server.ts`): `server.ts` calls these
  from 5 connect paths — around lines 970 (wordcloud join), 1159 (wordcloud
  display), 1228 (qa host attach), 1273 (qa display attach), 1319 (qa
  participant join). These are exactly the paths that fire concurrently at game
  start, which is why the race is reachable.

- Repo convention for module-local mutable singletons: the `states` map itself
  is a module-level `Map` passed in by `server.ts`. Follow the same style — a
  module-level `Map` for tracking in-flight loads, private to each hydrate file.

## Commands you will need

| Purpose        | Command                             | Expected on success       |
|----------------|-------------------------------------|---------------------------|
| Typecheck      | `npx tsc --noEmit`                  | exit 0, no errors         |
| Lint           | `npm run lint`                      | exit 0                    |
| Run these tests| `npm test -- lib/qa-hydrate.test.ts lib/wordcloud-hydrate.test.ts` | all pass |
| Full unit tests| `npm test`                          | all pass                  |

## Scope

**In scope** (the only files you should modify/create):
- `lib/qa-hydrate.ts` (modify `loadOrCreateState`)
- `lib/wordcloud-hydrate.ts` (modify `loadOrCreateState`)
- `lib/qa-hydrate.test.ts` (create)
- `lib/wordcloud-hydrate.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `server.ts` — the call sites do not change; the function signature stays
  identical. Changing server.ts is unnecessary and risks the socket lifecycle.
- `hydrateStateFromSession` in either file — the hydration logic is correct; only
  the concurrency wrapper is wrong.
- `lib/qa-repo.ts`, `lib/wordcloud-repo.ts` — the DB loaders are fine.

## Git workflow

- Branch: `advisor/002-fix-session-hydration-race`
- Commit style: conventional commits, e.g. `fix(hydrate): dedup concurrent loadOrCreateState per pin`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add an in-flight promise guard to `lib/qa-hydrate.ts`

Add a module-level in-flight map (near the top of the file, after imports), then
rewrite `loadOrCreateState` to reuse an in-flight load for the same PIN. The
signature and return type stay identical.

```ts
// module-level, after imports
const inFlightLoads = new Map<string, Promise<QAState | null>>();

export async function loadOrCreateState(
  states: Map<string, QAState>,
  pin: string,
): Promise<QAState | null> {
  const cached = states.get(pin);
  if (cached) return cached;

  // Serialize concurrent first-time loads for the same PIN: without this, two
  // sockets connecting to a fresh PIN both miss the cache, both hydrate, and
  // the second states.set() orphans the first caller's state object.
  const inFlight = inFlightLoads.get(pin);
  if (inFlight) return inFlight;

  const load = (async () => {
    const session = await loadSessionForHydration(pin);
    if (!session) return null;
    // Re-check the cache: a prior in-flight load for this PIN may have resolved
    // and populated it while we awaited the DB.
    const raced = states.get(pin);
    if (raced) return raced;
    const state = hydrateStateFromSession(session);
    states.set(pin, state);
    return state;
  })();

  inFlightLoads.set(pin, load);
  try {
    return await load;
  } finally {
    inFlightLoads.delete(pin);
  }
}
```

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 2: Apply the identical guard to `lib/wordcloud-hydrate.ts`

Same shape, but the type is `WordCloudState` and the loader is `getSessionByPin`:

```ts
// module-level, after imports
const inFlightLoads = new Map<string, Promise<WordCloudState | null>>();

export async function loadOrCreateState(
  states: Map<string, WordCloudState>,
  pin: string,
): Promise<WordCloudState | null> {
  const cached = states.get(pin);
  if (cached) return cached;

  const inFlight = inFlightLoads.get(pin);
  if (inFlight) return inFlight;

  const load = (async () => {
    const session = await getSessionByPin(pin);
    if (!session) return null;
    const raced = states.get(pin);
    if (raced) return raced;
    const state = hydrateStateFromSession(session);
    states.set(pin, state);
    return state;
  })();

  inFlightLoads.set(pin, load);
  try {
    return await load;
  } finally {
    inFlightLoads.delete(pin);
  }
}
```

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 3: Write the race-regression tests

Create `lib/qa-hydrate.test.ts` and `lib/wordcloud-hydrate.test.ts`. Each mocks
the repo's DB loader with an artificial delay, fires **two concurrent**
`loadOrCreateState` calls for the same PIN against a shared `states` map, and
asserts: (a) the loader was called **exactly once**, and (b) both calls resolve
to the **same object reference** (`toBe`, identity — not `toEqual`).

Use Vitest with `vi.mock`. Model the mock/structure after the existing
`lib/qa-repo.test.ts` (same directory, same Vitest style). Concrete shape for
the Q&A test:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the DB loader so no real database is needed.
vi.mock('./qa-repo', () => ({
  loadSessionForHydration: vi.fn(),
}));

import { loadSessionForHydration } from './qa-repo';
import { loadOrCreateState } from './qa-hydrate';
import type { QAState } from './qa';

const mockLoad = vi.mocked(loadSessionForHydration);

describe('loadOrCreateState — concurrent hydration', () => {
  beforeEach(() => {
    mockLoad.mockReset();
  });

  it('hydrates a PIN only once when two callers race', async () => {
    // Build a minimal session object shaped like QASessionWithRelations.
    // Inspect lib/qa-repo.ts for the exact fields loadSessionForHydration
    // returns, and construct the smallest object hydrateStateFromSession
    // accepts (a session with empty questions/labels arrays is typically
    // enough — if a required field is missing, tsc/the hydrate call will tell
    // you which). Return it after a short delay so both callers overlap.
    mockLoad.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(/* minimal session */ {} as never), 20);
        }),
    );

    const states = new Map<string, QAState>();
    const [a, b] = await Promise.all([
      loadOrCreateState(states, 'PIN123'),
      loadOrCreateState(states, 'PIN123'),
    ]);

    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(a).not.toBeNull();
    expect(a).toBe(b); // same object identity — the whole point
    expect(states.size).toBe(1);
  });

  it('returns null and caches nothing when the session does not exist', async () => {
    mockLoad.mockResolvedValue(null);
    const states = new Map<string, QAState>();
    const result = await loadOrCreateState(states, 'NOPE');
    expect(result).toBeNull();
    expect(states.size).toBe(0);
  });
});
```

Write the word-cloud test the same way, mocking `./wordcloud-repo`'s
`getSessionByPin` and importing from `./wordcloud-hydrate`.

If constructing the minimal session object proves fiddly (hydration reads many
fields), an acceptable alternative is to have the mock resolve a session and
assert the call-count + identity **without** asserting the state's internal
shape — the regression this test protects is "loaded once, same object", not the
hydration mapping (which other tests cover).

**Verify**: `npm test -- lib/qa-hydrate.test.ts lib/wordcloud-hydrate.test.ts`
→ all pass, 4 new tests green. Confirm that if you temporarily revert Step 1's
guard, the "hydrates a PIN only once" test FAILS (loader called twice) — this
proves the test actually exercises the race. Restore the guard afterward.

### Step 4: Full suite + baseline ratchet

**Verify**: `npm test` → all pass. Then `npm run test:coverage` → exit 0; if
plan 001 has landed, the qa-hydrate/wordcloud-hydrate lines now contribute — if
coverage rose, raise the thresholds in `vitest.config.ts` to the new baseline in
this same PR (see plan 001's ratchet note). If plan 001 has NOT landed, skip the
ratchet.

## Test plan

- New file `lib/qa-hydrate.test.ts`: (1) concurrent-race → single load + same
  identity; (2) missing session → null, nothing cached.
- New file `lib/wordcloud-hydrate.test.ts`: same two cases for word cloud.
- Structural pattern: model after `lib/qa-repo.test.ts`.
- Verification: `npm test` → all pass including 4 new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "inFlightLoads" lib/qa-hydrate.ts` returns `3` (declaration, get, set — plus delete makes 4; accept ≥3)
- [ ] `grep -c "inFlightLoads" lib/wordcloud-hydrate.ts` returns ≥3
- [ ] `lib/qa-hydrate.test.ts` and `lib/wordcloud-hydrate.test.ts` exist
- [ ] `npm test` exits 0; the 4 new tests pass
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run lint` exits 0
- [ ] `git status --porcelain` shows only the 4 in-scope files
- [ ] Linear issue [MID-427](https://linear.app/midnight-labs/issue/MID-427/improve-002-fix-per-pin-session-hydration-race) moved to `Done`

## STOP conditions

Stop and report back (do not improvise) if:

- Either `loadOrCreateState` does not match the "Current state" excerpt (drift).
- You find that `loadOrCreateState` is already called through an external lock
  or queue that serializes it (search `server.ts` for a mutex/`enqueue` wrapper
  around these calls) — if so, the race may already be mitigated and this plan
  needs re-scoping.
- Constructing a test session object cascades into mocking half the repo layer —
  fall back to the identity/call-count-only assertion described in Step 3 and
  note it, rather than expanding scope.
- Test verification fails twice after a reasonable fix attempt.

## Maintenance notes

- If hydration is ever moved to a shared/external store (Redis) or the process
  is scaled to multiple instances, this in-process guard no longer suffices —
  cross-instance dedup would be needed (related: the `MID-79` rate-limit note in
  `plans/README.md`).
- A reviewer should confirm the `finally { inFlightLoads.delete(pin) }` is
  present in both files — without it, a failed load would poison the PIN
  permanently.
- The `raced` re-check after the await is deliberate belt-and-suspenders; keep
  it.
