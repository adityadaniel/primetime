# Plan 008: Extract the repeated player-page Socket.IO listener plumbing into one hook

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the linked Linear issue status;
> Linear is the authoritative status source.
>
> **Drift check (run first)**: `git diff --stat 4de99e7..HEAD -- "app/play/[pin]/q-and-a/page.tsx" "app/play/[pin]/wordcloud/page.tsx"`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `4de99e7`, 2026-07-05
- **Linear issue**: [MID-433](https://linear.app/midnight-labs/issue/MID-433/improve-008-extract-shared-socketio-listener-hook)

## Why this matters

Each player page re-implements the same Socket.IO listener lifecycle by hand:
register N event handlers, register a `connect` handler that re-joins, call
`join()` immediately if already connected, and in cleanup `off()` every handler.
This boilerplate is duplicated across the Q&A, word-cloud, and quiz player
pages. It's bug-prone (each site must remember to remove every listener and
re-join on reconnect), and a change to the pattern means editing every copy.
Extracting a small `useSocketListener` hook gives one correct implementation of
the register/reconnect/cleanup dance, so the pages declare *what* they listen to,
not *how* to wire it. This is a maintainability refactor with no behavior change.

## Current state

Two confirmed exemplars of the identical pattern (the quiz player client has a
third — find it with `grep -rln "socket.on(" "app/play"`):

- `app/play/[pin]/wordcloud/page.tsx:106-174` — registers 5 handlers +
  `connect`→`join`, `if (socket.connected) join()`, cleanup `off()`s all:

```tsx
  useEffect(() => {
    if (!socket || !pin || !me) return;
    const onState = (s: {...}) => { if (s.pin !== pin) return; /* setState */ };
    const onStatusChanged = (s: {...}) => setStatus(s.status);
    // ...onMine, onRejected, onWordRemoved
    const join = () => { socket.emit('wordcloud:player:join', {...}, (res) => {...}); };
    socket.on('wordcloud:state', onState);
    // ...4 more socket.on(...)
    socket.on('connect', join);
    if (socket.connected) join();
    return () => {
      socket.off('wordcloud:state', onState);
      // ...4 more socket.off(...)
      socket.off('connect', join);
    };
  }, [socket, pin, me, wordsPerPlayer, showToast]);
```

- `app/play/[pin]/q-and-a/page.tsx:271-337` — same structure with 4 handlers
  (`qa:state`, `qa:scores`, `qa:questions`, `qa:personal`) + `connect`→`join`,
  `if (socket.connected) join()`, cleanup `off()`s all.

The invariant every copy shares: **the set of `(event, handler)` pairs passed to
`on` in the effect is exactly the set passed to `off` in cleanup, plus a
`connect` handler that runs `join`, plus an immediate `join()` when already
connected.**

- `socket` is the Socket.IO client instance (nullable). Find its type/source:
  `grep -rn "useSocket\|Socket\b" app/play "app/play/[pin]/q-and-a/page.tsx" | head`
  — the hook must accept the same nullable socket type the pages already use.
- Repo convention: shared hooks/libs live under `lib/` (e.g. `lib/public-origin.ts`).
  Client-only hooks belong in a `'use client'`-consuming module; a plain hook
  file that the client components import is fine.

## Commands you will need

| Purpose        | Command                     | Expected on success   |
|----------------|-----------------------------|-----------------------|
| Typecheck      | `npx tsc --noEmit`          | exit 0                 |
| Lint           | `npm run lint`              | exit 0                 |
| Related tests  | `npm test -- app/play`      | all pass               |
| Full unit tests| `npm test`                  | all pass               |
| Socket smoke   | dev server + `npm run smoke`| smoke passes          |

## Scope

**In scope** (create + modify):
- `lib/use-socket-listener.ts` (create the hook)
- `lib/use-socket-listener.test.ts` (create)
- `app/play/[pin]/wordcloud/page.tsx` (adopt the hook)
- `app/play/[pin]/q-and-a/page.tsx` (adopt the hook)
- The quiz player client, if you confirm it uses the identical pattern (adopt it
  too). If its shape differs meaningfully, leave it and note so.

**Out of scope** (do NOT touch):
- The event handler bodies / setState logic — copy them into the hook's
  `handlers` map unchanged. This refactor must not alter what any handler does.
- The `join()` payloads/acks — move them verbatim.
- `server.ts` and any emit side — server behavior is unaffected.

## Git workflow

- Branch: `advisor/008-extract-use-socket-listener`
- Commit style: conventional commits, e.g. `refactor(play): extract useSocketListener hook`
- Do NOT push or open a PR unless the operator instructed it. Adopt one page per
  commit so each is independently verifiable.

## Steps

### Step 1: Write the hook

Create `lib/use-socket-listener.ts`. It takes the (nullable) socket, an
`enabled` guard, a map of `event → handler`, an optional `onConnect` callback
(the re-join), and a deps array; it registers all handlers + `connect`, runs
`onConnect` immediately if already connected, and cleans up everything.

```tsx
import { useEffect } from 'react';
import type { Socket } from 'socket.io-client'; // match the repo's socket type

type Handlers = Record<string, (...args: never[]) => void>;

export function useSocketListener(
  socket: Socket | null | undefined,
  enabled: boolean,
  handlers: Handlers,
  onConnect: (() => void) | undefined,
  deps: React.DependencyList,
): void {
  // eslint/biome: deps are intentionally caller-provided; the hook mirrors the
  // manual pattern it replaces.
  // biome-ignore lint/correctness/useExhaustiveDependencies: caller owns deps
  useEffect(() => {
    if (!socket || !enabled) return;
    for (const [event, handler] of Object.entries(handlers)) {
      socket.on(event, handler as (...a: unknown[]) => void);
    }
    if (onConnect) {
      socket.on('connect', onConnect);
      if (socket.connected) onConnect();
    }
    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        socket.off(event, handler as (...a: unknown[]) => void);
      }
      if (onConnect) socket.off('connect', onConnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
```

Adjust the `Socket` import to whatever type the pages already use for `socket`
(check the grep from "Current state"). Confirm how the repo suppresses the
exhaustive-deps lint elsewhere and match it (Biome is the linter — use the
correct Biome ignore directive; the comment above is illustrative).

**Verify**: `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0.

### Step 2: Adopt the hook in the word-cloud player page

In `app/play/[pin]/wordcloud/page.tsx`, replace the hand-written `useEffect`
(lines ~106–174) with a `useSocketListener` call. Define the handlers and `join`
above it (unchanged bodies), pass `enabled = Boolean(me)`, and pass the same deps
array the effect used (`[socket, pin, me, wordsPerPlayer, showToast]`):

```tsx
  const join = () => { /* unchanged body */ };
  useSocketListener(
    socket,
    Boolean(pin && me),
    {
      'wordcloud:state': onState,
      'wordcloud:status:changed': onStatusChanged,
      'wordcloud:player:my-submissions': onMine,
      'wordcloud:player:rejected': onRejected,
      'wordcloud:word:removed': onWordRemoved,
    },
    join,
    [socket, pin, me, wordsPerPlayer, showToast],
  );
```

The handler functions (`onState`, etc.) must be defined in the component body so
they're referenced by the deps as before. Keep them identical.

**Verify**: `npx tsc --noEmit` → exit 0; `npm test -- app/play` → pass. Start the
dev server (`.env` loaded) and run the socket smoke test → the word-cloud join
flow still works.

### Step 3: Adopt the hook in the Q&A player page

Same transformation in `app/play/[pin]/q-and-a/page.tsx` for the four `qa:*`
handlers + `join`, with deps `[socket, pin, join]` (its current deps).

**Verify**: `npx tsc --noEmit` → exit 0; `npm test -- app/play` → pass; socket
smoke → passes.

### Step 4: (Conditional) adopt in the quiz player client

If the quiz player client uses the identical pattern, adopt it too. If its shape
differs, leave it untouched and note the difference in the PR description.

**Verify**: `npm test` → all pass; socket smoke → passes.

## Test plan

- `lib/use-socket-listener.test.ts`: with a fake socket object exposing
  `on/off/connected/emit` (plain vitest `vi.fn()` mocks), assert: (1) every
  handler in the map is registered via `on`; (2) `connect` is registered and
  `onConnect` fires immediately when `connected` is true; (3) unmount/cleanup
  calls `off` for every handler and for `connect`; (4) when `enabled` is false or
  `socket` is null, nothing is registered.
- Pattern: model after any `lib/*.test.ts`; no DOM needed if you test the hook
  via `@testing-library/react`'s `renderHook` (already available — the repo uses
  `@testing-library/react`). If `renderHook` setup is heavy, testing the register/
  cleanup logic by extracting the effect body is acceptable.
- Verification: `npm test` → all pass including the new hook tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `lib/use-socket-listener.ts` and `lib/use-socket-listener.test.ts` exist
- [ ] `grep -c "useSocketListener" "app/play/[pin]/wordcloud/page.tsx"` returns ≥1
- [ ] `grep -c "useSocketListener" "app/play/[pin]/q-and-a/page.tsx"` returns ≥1
- [ ] the two adopted pages no longer contain their own `socket.off(` cleanup loop for these events (`grep -c "socket.off(" <page>` dropped to 0 for the migrated effect)
- [ ] `npm test` exits 0; new hook tests pass
- [ ] `npx tsc --noEmit` exits 0; `npm run lint` exits 0
- [ ] socket smoke passes (join + live updates still work on both pages)
- [ ] `git status --porcelain` shows only in-scope files
- [ ] Linear issue [MID-433](https://linear.app/midnight-labs/issue/MID-433/improve-008-extract-shared-socketio-listener-hook) moved to `Done`

## STOP conditions

Stop and report back (do not improvise) if:

- Either page's effect does not match the "Current state" pattern (drift).
- A page's effect does something the hook signature can't express (e.g. it
  registers handlers conditionally mid-effect, or depends on handler-registration
  order) — leave that page manual and note it, rather than contorting the hook.
- The socket smoke test fails after adoption — a missing handler or a broken
  reconnect is a real regression; report it.
- The socket type import can't be resolved cleanly — report the actual type the
  pages use.

## Maintenance notes

- New player pages should use `useSocketListener` instead of hand-rolling the
  effect. Point new contributors at it.
- A reviewer should verify the handler set passed to the hook exactly matches the
  events the page previously registered (no event dropped, none added) and that
  the deps array is preserved per page.
- If the app later adds a global socket-ack error helper, this hook is the
  natural place to thread it through (related note: the ack-handling duplication
  observed in the control clients).
