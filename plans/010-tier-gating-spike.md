# Plan 010 (SPIKE): Define how free-tier caps and Pro watermark gating should work (MID-75)

> **Executor instructions**: This is a **design/spike** plan, not a build plan.
> Its deliverable is a written proposal + a short list of open questions, NOT a
> shipped feature. Do NOT implement tier enforcement as part of this plan — if
> you find yourself editing schema or handlers to enforce caps, STOP. Produce the
> design doc, then hand back for a human to approve scope before any build plan.
> When done, update the linked Linear issue status; Linear is the authoritative
> status source.
>
> **Drift check (run first)**: confirm the TODO markers still exist:
> `grep -rn "MID-75" app/ ` — if they're gone, the feature may have shipped;
> STOP and report.

## Status

- **Priority**: P3
- **Effort**: M (design only)
- **Risk**: LOW (no code shipped)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `4de99e7`, 2026-07-05
- **Linear issue**: [MID-435](https://linear.app/midnight-labs/issue/MID-435/improve-010-spike-define-tier-caps-and-pro-watermark-gating)

## Why this matters

The product defines tiers (Free vs Pro) in `PRD.md`, and the code carries a
`tier` concept through the quiz path — but two promised gates are stubbed and
inert:

- **Free-tier submission cap** — `app/api/wordcloud/route.ts:5` has
  `// TODO MID-75: enforce free-tier 250-submission cap` and a dead constant
  `const FREE_TIER_SUBMISSION_CAP = 250; void FREE_TIER_SUBMISSION_CAP;`.
- **Pro watermark gating** — `app/host/wordcloud/[pin]/display/page.tsx:104` has
  `{/* TODO MID-75: gate watermark on user.tier === 'PRO' */}` above an
  unconditional `<Watermark />`.

So a free-tier host currently gets unlimited word-cloud submissions and the same
watermark treatment as Pro — the tier promise is undelivered, and self-hosters
can't gate their own SaaS tiers. This is real, grounded, and worth doing — but
it touches schema, submission handlers, and billing assumptions, so it needs a
design pass before a build. This spike produces that design.

## Current state (facts to ground the design)

- **Tier today**: `tier` flows through the quiz game (`lib/game.ts` references a
  `tier`/`Tier` type and a `playerCap`) but is enforced only as a player cap for
  quizzes. Confirm the full picture:
  - `grep -rn "tier\|Tier" lib/game.ts lib/types.ts server.ts | grep -iv writer`
  - `grep -rn "playerCap\|PLAYER_CAP" lib/config.ts lib/constants.ts`
    (note: `lib/config.ts:133` sets `playerCap = PLAYER_CAP`, a code-level
    constant — tier is not currently sourced per-user from the DB for word cloud).
- **Where a WC submission enters**: read `app/api/wordcloud/route.ts` (session
  create) and the word-cloud submission socket handler in `server.ts`
  (`grep -n "wordcloud:.*submit\|submitWord" server.ts lib/wordcloud.ts`). The
  cap must be enforced at submission time, server-side.
- **Where the watermark renders**: `app/host/wordcloud/[pin]/display/page.tsx`
  (the `<Watermark />` at line ~105). The display page is public-by-PIN — it does
  NOT have the host's session, so it cannot read `user.tier` directly. The design
  must resolve **how tier reaches a public projection surface** (e.g. resolve it
  when the session is created/hydrated and carry a `tier`/`showWatermark` flag in
  the public snapshot). This is the crux question.
- **User/tier source of truth**: check the Prisma schema for a `tier` on the User
  model and on session models: `grep -n "tier\|Tier" prisma/schema.prisma`. The
  design must state where per-session tier is stored (likely snapshot the host's
  tier onto the session at creation, so mid-game tier changes don't retroactively
  apply).
- **Product intent**: read `PRD.md` for the tier structure (player caps,
  submission caps, watermark policy, pricing status). Quote the exact lines in
  the deliverable so the reader doesn't have to re-find them.
- **Decision log**: skim `DECISIONS.md` for any tier/billing entry that
  constrains this. If a decision already fixes part of this, honor it; if none
  exists, note that a decision entry will be needed.

## Deliverable

Create `plans/010-tier-gating-spike-findings.md` (a sibling doc, NOT code)
containing:

1. **Cap enforcement design** — where in the WC submission path the 250 cap is
   checked, what the server returns when exceeded (reuse the existing
   `wordcloud:player:rejected` reason channel — see
   `app/play/[pin]/wordcloud/page.tsx` `onRejected`/`rejectMessage`), and how the
   count is tracked (per-session submission count; is it already available in the
   word-cloud state?). Note whether Q&A needs an analogous cap.
2. **Tier propagation to the projector** — the recommended mechanism for making
   the host's tier visible on the public display page (snapshot tier onto the
   session at create; carry a `showWatermark` boolean in the public snapshot).
   State the alternative(s) and why the recommended one wins.
3. **Schema changes** — the exact Prisma migration(s): which model gets a `tier`
   (or `showWatermark`) column, nullable-with-default for existing rows (default
   to the current behavior so nothing regresses on deploy).
4. **Enforcement points list** — every server-side site that must check tier
   (WC submission handler, WC session create, display snapshot builder), each as
   a `file:line`.
5. **Open questions for the maintainer** — e.g. is Free = 250 WC submissions per
   *session* or per *host*? Does the cap reject or soft-degrade? Is watermark the
   only Pro-gated display treatment? Is per-user tier already persisted or does it
   need a source (billing integration)? What's the upgrade/upsell UX when a Free
   host hits the cap?
6. **Recommended build-plan breakdown** — 1–3 follow-up build plans this spike
   would spawn (e.g. "010a: snapshot tier onto WC/QA sessions + migration",
   "010b: enforce WC submission cap", "010c: gate watermark on snapshot flag"),
   each with a coarse S/M/L estimate. Do NOT write those build plans here.

## Commands you will need

| Purpose                 | Command                                             |
|-------------------------|-----------------------------------------------------|
| Find tier usage         | `grep -rn "tier\|Tier" lib server.ts prisma/schema.prisma app/api/wordcloud` |
| Find WC submit path     | `grep -n "submitWord\|wordcloud:.*submit" server.ts lib/wordcloud.ts` |
| Read the TODOs          | `grep -rn "MID-75" app/`                             |
| Read product intent     | open `PRD.md`, `DECISIONS.md`                        |

## Scope

**In scope**: reading code/docs and writing `plans/010-tier-gating-spike-findings.md`.

**Out of scope** (this is a spike — touching any of these means you've overstepped):
- Prisma schema/migrations — propose them in the doc; do not apply them.
- `app/api/wordcloud/route.ts`, `server.ts` handlers, the display page — analyze,
  don't edit.
- Any billing/payment integration.

## Git workflow

- Branch: `advisor/010-tier-gating-spike`
- Commit: a single commit adding the findings doc, e.g. `docs(spike): tier gating design (MID-75)`
- Do NOT push or open a PR unless the operator instructed it.

## Done criteria

- [ ] `plans/010-tier-gating-spike-findings.md` exists and contains all six
      deliverable sections
- [ ] Every "enforcement point" in the doc is a real `file:line` (spot-check 3)
- [ ] The doc quotes the relevant `PRD.md` tier lines verbatim
- [ ] No source/schema files were modified (`git status` shows only the new doc)
- [ ] The doc ends with a concrete recommended build-plan breakdown
- [ ] Linear issue [MID-435](https://linear.app/midnight-labs/issue/MID-435/improve-010-spike-define-tier-caps-and-pro-watermark-gating) moved to `Done`

## STOP conditions

Stop and report back (do not improvise) if:

- The MID-75 TODOs are gone (feature may have shipped) — verify before designing.
- `PRD.md` and the code disagree on tier limits — surface the contradiction; do
  not silently pick one.
- You cannot determine where per-user tier is persisted (no `tier` on the User
  model and no billing source) — this is a blocking open question; record it
  prominently rather than inventing a source.
- You're tempted to "just implement the cap since it's small" — that's the exact
  overreach this spike exists to prevent. Stop and hand back the design.

## Maintenance notes

- This spike deliberately produces a design, not code, because tier gating
  crosses schema, real-time handlers, a public projection surface that can't see
  the host session, and billing assumptions — decisions a human should approve
  before a build. The follow-up build plans it recommends are where code lands.
- Whoever approves the design should also decide whether a `DECISIONS.md` entry
  is warranted (tier/billing policy is exactly the kind of durable decision that
  file records).
