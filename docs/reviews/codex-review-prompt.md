You are reviewing the BROADCAST kahoot-clone codebase (Next.js 15 + Socket.IO + tsx server). Read the entire repository at /Users/adityadaniel/Developer/kahoot-clone.

## Context to read first
1. README.md — what the app is and the current ship state
2. DECISIONS.md — explicit decisions the team has made (Postgres, mock billing, hardcoded 150 cap, delegate-to-Claude rule, localhost-only binding for now, no real Stripe yet, no Google OAuth yet)
3. DESIGN.md if present — visual identity rules
4. server.ts — the custom Next.js + Socket.IO server, this is the heart of the app
5. lib/game.ts — in-memory game state machine, scoring, reconnect grace, host pause, cap enforcement, profanity filter
6. lib/profanity.ts — nickname filter
7. lib/types.ts — runtime types
8. app/host/page.tsx — quiz builder
9. app/host/[pin]/control/page.tsx — host control panel
10. app/host/[pin]/display/page.tsx — broadcast display
11. app/host/[pin]/results.csv/route.ts — CSV export
12. app/join/page.tsx — player join flow (recently fixed for mobile double-submit)
13. app/play/[pin]/page.tsx — player gameplay
14. scripts/smoke.ts — integration smoke harness covering 7 scenarios
15. package.json — deps and scripts

## What to review
The code is M1 (live quiz core loop) + M2 (resilience: reconnect grace, host pause, tier-aware cap with M2.5 hardcode override, CSV export, profanity filter, smoke). M2.5 (academy prep) just shipped the join double-submit fix and the 150-cap hardcode. Postgres + Quiz persistence are NEXT (not yet shipped).

Focus the review on:

1. **Race conditions and concurrency bugs** in lib/game.ts and server.ts — anything that could deadlock or produce inconsistent state when many players act simultaneously, when host disconnects, when reconnect grace fires while a phase is advancing, or when a single socket sends rapid bursts
2. **Socket lifecycle correctness** — what happens to game state when sockets disconnect, reconnect, refresh the page, lose network mid-question, etc.
3. **Cap enforcement edge cases** post-M2.5 hardcode — is 150 actually the right enforcement point everywhere, including reconnect-grace-window players still being counted?
4. **Score and timing correctness** — answer submission windows, time bonuses, leaderboard ordering, ties
5. **CSV export gaps** — what happens with empty answers, special characters in nicknames, very long quizzes
6. **Profanity filter false-positives / bypasses** — Scunthorpe-style problems
7. **Smoke coverage gaps** — what scenarios are NOT tested but should be
8. **Type safety and runtime validation gaps** — places where socket payloads are trusted without validation
9. **Memory leaks** — game state, socket maps, timers — anything that could grow unbounded
10. **Academy-readiness blockers** — anything that would break in a 30-student real session beyond what DECISIONS.md acknowledges

## Out of scope (already known/deferred)
- No Postgres yet — that's the next milestone
- No auth yet — that's M3
- Real billing/Stripe is deferred (mock-only in M3 plan)
- Google OAuth is deferred
- Tailscale/0.0.0.0 binding is deferred per DECISIONS.md
- Real email delivery is deferred per DECISIONS.md
- Session history / Redis pub-sub / image uploads / Playwright E2E — all post-M3

Don't flag these. We know.

## Output format
Return a markdown review structured as:

```
# Codex Review — BROADCAST kahoot-clone (commit <SHA>)

## Summary
1-paragraph overall assessment.

## Findings

### F1 — <short title>
**Severity:** critical | high | medium | low | info
**Files:** path/to/file.ts:LINE, ...
**Category:** race | type-safety | UX | perf | security | smoke-gap | maintainability

<2-4 paragraph description of the issue, what could go wrong, and a concrete suggested fix>

### F2 — ...
```

Number findings F1 onwards. Severity scale:
- critical: data loss, hang, crash in normal use
- high: would surface in academy session, fixable now
- medium: edge case but real
- low: cosmetic / future-proofing
- info: design observation, not a bug

Be specific with file paths and line numbers. Cite code excerpts when needed. No more than 25 findings — prioritize signal.

End with a "## Recommendations" section listing the top 3-5 findings to fix BEFORE academy testing, in order.
