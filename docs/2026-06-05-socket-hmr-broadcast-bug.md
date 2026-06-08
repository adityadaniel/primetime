# Bug Fix: Host Control Page Not Receiving Player Join Broadcasts

**Date:** 2026-06-05
**Affected:** `/host/wordcloud/[pin]/control` (host control page)
**Root cause:** Socket.IO room orphaning during Next.js HMR (Hot Module Replacement)

## Symptom

When a player joins a wordcloud game from a remote device (e.g. phone via Tailscale), the host control page shows PLAYERS: 00 even though:

- The player successfully joined (player UI shows "Joined as [name]", WAITING ON HOST)
- The server-side state correctly has the player (verified via debug socket — `joinerCount` increments)
- The server's `wcEmitState()` broadcasts to room `wc:${pin}` after player join

The GO LIVE button appears enabled (host registration succeeded), but player count never updates. Clicking GO LIVE would technically work, but the host has no visibility into who joined.

## Root Cause

During Next.js Hot Module Replacement in dev mode, the socket singleton in `lib/socket.ts` gets reset to `null`. A new Socket.IO connection is created, but the **old socket** — which held the room membership for `wc:${pin}` on the server — becomes orphaned.

The sequence:

1. Host opens control page → socket connects → `wordcloud:host:create` succeeds → socket joins room `wc:${pin}` → `registered = true`
2. HMR fires (file save, Fast Refresh) → `lib/socket.ts` module re-evaluates → `singleton = null`
3. Next render calls `getSocket()` → creates a **new** socket instance → connects with a **new** socket ID
4. Player joins → server broadcasts to room `wc:${pin}` → broadcast goes to the **old** (orphaned) socket ID
5. New socket never receives the broadcast because it was never registered/joined to the room

The host UI still shows `registered = true` from step 1 because React state survived the HMR (Fast Refresh preserves component state). The button looks enabled but the underlying connection is dead.

## Fix

### `lib/socket.ts`

- Store the Socket.IO client on `window.__primetimeSocket` instead of in a
  module-level variable
- Reuse that browser-global socket across Fast Refresh module reloads, so the
  socket that joined `wc:${pin}` remains the same live connection
- Keep `getSocket()` server-safe by throwing when called without `window`
- Add a regression test that simulates a module reload while preserving the
  browser window object

### `app/host/wordcloud/[pin]/control/page.tsx`

- Reset `registered = false` on `disconnect` event
- Re-register automatically on Socket.IO `connect`, which covers legitimate
  reconnects with a new socket ID
- Attach `wordcloud:state` listeners before emitting `wordcloud:host:create`,
  so the initial state broadcast cannot be missed

## Reproduction (dev mode only)

1. Start the dev server: `npm run dev`
2. Open host control page, create a wordcloud activity
3. Join from another device/tab as a player
4. Save any file in the project (triggers HMR)
5. Join another player → host PLAYERS count won't update (before fix)

## Notes

- This bug only manifests in **development mode** with HMR. Production builds don't hot-reload modules.
- The fix is safe for production — it adds no overhead when HMR isn't active.
- The `disconnect` handler also catches legitimate network drops (mobile sleep, WiFi switch), making the UI more honest about connection state in all environments.

## Follow-up: Owned Host Registration Still Disabled

After the HMR socket fix, an owned wordcloud session could still show:

- `GO LIVE` disabled on `/host/wordcloud/[pin]/control`
- `PLAYERS: 00` on the control page
- Display page correctly showing `01 ON THE FLOOR`
- Player phone successfully joined and waiting

Example observed session:

- PIN: `217600`
- Session: `cmq0c2vvv0001y6rbcvoa5t7x`
- Host: `test@testing.com`
- Player: `Daniel`

Root cause: `server.ts` captured `AUTH_SECRET` before the NextAuth route had
necessarily initialized the dev fallback secret. Socket.IO connections were
therefore decoded as anonymous even when the browser had a valid signed-in
session. Owned wordcloud sessions rejected `wordcloud:host:create` as
`forbidden`, which left `registered = false` and kept host controls disabled.

Additional fix:

- Centralize dev secret initialization in `lib/auth-secret.ts`
- Call that helper from both `auth.ts` and `server.ts`
- Use the same secret for Socket.IO JWT decoding as NextAuth uses for sign-in
- Reconstruct chunked Auth.js cookies such as `authjs.session-token.0`,
  `authjs.session-token.1`, etc.

Validation:

- Started a validation server with a fixed `AUTH_SECRET`
- Created an owned wordcloud session for `test@testing.com`
- Connected a host socket with a matching Auth.js JWT cookie
- Connected an anonymous player socket as `Daniel`
- Verified host registration succeeded, the host received `joinerCount: 1`, and
  `wordcloud:host:set-status` changed the session to `LIVE`

Because this second fix touches `server.ts`, restart `npm run dev` before
retesting an already-running local server.
