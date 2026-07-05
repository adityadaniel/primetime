# Plan 006: Restrict Socket.IO to trusted origins instead of `origin: '*'`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the linked Linear issue status;
> Linear is the authoritative status source.
>
> **Drift check (run first)**: `git diff --stat 4de99e7..HEAD -- server.ts`
> If `server.ts` changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `4de99e7`, 2026-07-05
- **Linear issue**: [MID-431](https://linear.app/midnight-labs/issue/MID-431/improve-006-harden-socketio-cors-origins)

## Why this matters

The Socket.IO server is configured with `cors: { origin: '*' }`. The socket
layer authenticates by reading the Auth.js session cookie from the handshake, so
an unrestricted origin widens the cross-site WebSocket surface: any web page can
attempt to open an authenticated socket. Today this is **partly** mitigated
because Auth.js session cookies default to `SameSite=Lax` (the browser won't
attach them to a cross-site WS handshake), so this is hardening rather than an
open hole — but `origin: '*'` is the wrong default for a credentialed real-time
server, and an explicit trusted-origin allow-list closes the gap and documents
intent. The fix must not break the legitimate deployment modes: local dev
(`http://localhost:4321`) and tunnel mode
(`NEXT_PUBLIC_SITE_URL=https://live.theprimetime.id`).

## Current state

- `server.ts` — the Socket.IO server construction:

```ts
// server.ts:271-274
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
  });
```

- Immediately below (lines 276–330) is the auth middleware that decodes the
  Auth.js JWT from the handshake cookie and sets `socket.data.userId`. Anonymous
  connections are intentionally allowed (players don't log in); only host actions
  require `userId`. Do NOT change this middleware.

- Relevant env vars (see `AGENTS.md` "Public URL rule"):
  - `NEXT_PUBLIC_SITE_URL` — the reachable public origin (e.g.
    `https://live.theprimetime.id` in tunnel mode; `http://localhost:4321` in
    plain dev). This is the source of truth for the app's own origin.
  - The dev server listens on port 4321.
- There is a helper `lib/public-origin.ts` (`publicUrl(...)`) used elsewhere for
  origin handling — read it to match how the repo already reasons about origins,
  but the socket CORS origin is simplest derived directly from env (below).

## Commands you will need

| Purpose        | Command                     | Expected on success   |
|----------------|-----------------------------|-----------------------|
| Typecheck      | `npx tsc --noEmit`          | exit 0                 |
| Lint           | `npm run lint`              | exit 0                 |
| Build          | `npm run build`             | exit 0                 |
| Socket smoke   | dev server + `npm run smoke`| smoke passes          |

Dev server for smoke (loads `.env`; server.ts does not read it on its own):
```bash
set -a; . ./.env 2>/dev/null; set +a
npm run dev &   # wait for http://localhost:4321, then:
npm run smoke
```

## Scope

**In scope** (the only file you should modify):
- `server.ts` — only the `cors` option of the `new Server(...)` call (and a
  small helper to build the allow-list, placed near it).

**Out of scope** (do NOT touch):
- The socket auth middleware (lines 276–330) — origin restriction and
  cookie-decoding auth are independent; leave auth alone.
- `transports` — keep both `websocket` and `polling`.
- Any client-side socket connection code — the client connects same-origin, so
  it is unaffected.

## Git workflow

- Branch: `advisor/006-harden-socket-cors-origin`
- Commit style: conventional commits, e.g. `fix(socket): restrict CORS to trusted origins`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Build a trusted-origin allow-list from env

Just above the `new Server(...)` call in `server.ts`, construct the allowed
origins from env, always including localhost dev and the configured public
origin:

```ts
  // Trusted origins for Socket.IO CORS. Same-origin app connections and the
  // configured public origin (tunnel/prod) are allowed; everything else is
  // rejected instead of the previous wildcard `origin: '*'`.
  const socketAllowedOrigins = [
    'http://localhost:4321',
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXTAUTH_URL,
  ].filter((o): o is string => Boolean(o));
```

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 2: Apply the allow-list to the server config

Replace the `cors` option:

```ts
  const io = new Server(httpServer, {
    cors: {
      origin: socketAllowedOrigins,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });
```

Passing an array makes Socket.IO reflect only matching origins.

**Verify**:
- `npx tsc --noEmit` → exit 0
- `npm run lint` → exit 0
- `npm run build` → exit 0

### Step 3: Confirm the real-time path still works same-origin

Start the dev server with `.env` loaded and run the socket smoke test — it
connects from the same origin, which is in the allow-list, so it must still pass.

**Verify**: socket smoke → passes. If it fails with a CORS/connection error,
confirm `http://localhost:4321` is in `socketAllowedOrigins` at runtime (log the
array once if needed, then remove the log) — STOP if same-origin is being
rejected.

## Test plan

- No new unit test (this is server bootstrap config). The regression signal is
  the existing socket smoke test connecting same-origin, plus a manual note:
  after deploy, a browser on the real public origin must still connect (covered
  by having `NEXT_PUBLIC_SITE_URL` in the allow-list).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "origin: '\*'" server.ts` returns 0
- [ ] `grep -c "socketAllowedOrigins" server.ts` returns ≥2
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] socket smoke passes (same-origin connection still works)
- [ ] `git status --porcelain` shows only `server.ts`
- [ ] Linear issue [MID-431](https://linear.app/midnight-labs/issue/MID-431/improve-006-harden-socketio-cors-origins) moved to `Done`

## STOP conditions

Stop and report back (do not improvise) if:

- The `new Server(...)` excerpt does not match "Current state" (drift).
- The socket smoke test fails because a same-origin connection is rejected —
  that means the allow-list is missing the dev origin; report before loosening
  back to `'*'`.
- You discover a legitimate cross-origin embed requirement (e.g. the WonderWall
  iframe surface connecting from a partner domain) — if a real trusted third
  party must connect, that origin needs to be added explicitly and deliberately;
  report it rather than reverting to a wildcard.

## Maintenance notes

- New deployment origins (a second tunnel host, a staging domain) must be added
  to `socketAllowedOrigins` via env, not by reverting to `'*'`.
- A reviewer should confirm `credentials: true` is paired with an explicit
  origin array (never with `'*'` — that combination is invalid and browsers
  reject it).
- This is defense-in-depth alongside the existing SameSite cookie protection;
  keep both.
