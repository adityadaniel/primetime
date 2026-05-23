# Tech Debt — BROADCAST

Open follow-ups that are real but intentionally deferred. Each item names the
PR/review it surfaced from, the reason it's deferred, and a Linear ticket where
one exists. New items go at the top so the freshest debt is easy to see.

When fixing one, drop the entry rather than crossing it out — git history is
the audit trail.

---

## Open

### Word cloud — codex review followup observations (PR #24, 2026-05-23)

These came up during human review of `fix/wordcloud-codex-review-followup`.
None block the merge; they're follow-up cleanups.

- **Auth salt detection is fragile.** `server.ts` socket auth middleware picks
  the JWT salt by checking `cookieHeader.includes('__Secure-')`, which can
  match an unrelated third-party cookie on the same domain. Switch on which
  cookie name in `COOKIE_NAMES` actually matched instead. Low-impact (failure
  is graceful — user becomes anonymous), no Linear ticket, fix in passing
  next time anyone touches that file.

- **`setStatus` is double-validated.** `server.ts` `wordcloud:host:set-status`
  calls `isValidTransition` and then `setCloudStatus` also re-checks via its
  own `transition.ok` return. Pick one layer. Cosmetic, no ticket.

- **`wordcloud:player:rejected` is overloaded.** It carries player-side errors
  (`rate_limited`, `unknown_player`, `session_not_live`) AND host-side errors
  (`forbidden`, `invalid_transition`). The host UI listening for "rejected"
  receives player events and vice versa. Split into a separate
  `wordcloud:host:rejected` event when we touch the host control surface
  next. Minor UX issue, no live impact yet.

### Word cloud — codex findings deferred from PR #24 (2026-05-23)

The followup PR closed F1, F2, F3, F5, F6, F7, F8, F9, F10. These remain:

- **F4 — smoke `/join` flow** — MID-118. Smoke scenarios call
  `wordcloud:player:join` directly; add a path that posts the same lookup +
  redirect the UI uses.
- **F11 — persist `PAUSED` as `PAUSED`** — MID-119. Currently writes `LIVE`
  to Prisma when state goes paused, breaks restart hydration accuracy.
- **F12 — most-popular casing for display variant** — MID-120. Live cloud
  keeps the first-submitted display forever; should track raw display counts
  and update when a variant overtakes the current one.
- **F13 — cleanup `wordCloudStates` and `wcLastSubmitAt` for ended sessions**
  — MID-121. Both Maps grow unboundedly across long-running academy days.
  Add retention cleanup on terminal status.
- **F14 — display attach pre-state hydration** — MID-122. Edge case where the
  display tab opens before host control has registered state.
- **F15 — Zod schemas for socket payloads** — MID-123. Replace the ad-hoc
  `Record<string, unknown>` casts with shared schemas per event.

---

## How to file new debt here

1. Group by feature / review batch with a dated heading.
2. State the observation, where it surfaced, and the deferral reason.
3. Link the Linear ticket if one exists (MID-NNN). If small enough to fix
   opportunistically, say so explicitly so future readers don't keep filing
   duplicate tickets for it.
