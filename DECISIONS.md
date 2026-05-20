# Decisions Log

This file is the durable record of architectural and product decisions for BROADCAST.
Each entry is dated. Latest first.

When a decision is reversed, do not delete the original — append a "Superseded by" line
and add a new entry below.

---

## 2026-05-20 · Postgres for academy + production

**Status:** Accepted

**Context:** Academy testing requires quiz persistence — quizzes built before class
should survive a server restart. The original M3 plan called for Postgres on the
production deploy. Two options for the academy prep phase:

- SQLite first, switch to Postgres in M3 when going public
- Postgres from day one

**Decision:** Postgres from day one. Same Prisma schema, no SQLite → Postgres
migration ever needed.

**Trade-off accepted:** the academy host laptop now needs a running Postgres
instance. Documented setup paths (Postgres.app, Docker Compose, Homebrew) live
in `README.md`. Postgres.app is the recommended primary path for academy use —
it's a single .app to launch before a session and adds zero terminal overhead.

**Implication:** M3 issue MID-64 (originally "install Postgres") moves out of M3
into the academy prep milestone. M3-DB-02 (MID-65) is split: Quiz + Question
tables ship in academy prep, User + Session + BillingEvent tables stay in M3.

---

## 2026-05-20 · Mock billing through academy + early M3

**Status:** Accepted

**Context:** User has not done Stripe integration before and wants to test the
upgrade UX with academy students before going public.

**Decision:** Implement billing as a mock — env-gated `MOCK_BILLING=true` endpoint
that flips `User.tier` and writes a `BillingEvent` audit row. Real Stripe deferred
until post-academy testing.

**Trade-off accepted:** mock billing is not production-safe; the env gate
prevents prod deploys from accepting mock upgrades. When real Stripe ships, it
writes the same `User.tier` field and the cap-enforcement code path is unchanged.

**Implication:** M3 issue MID-73 (Stripe integration) is rewritten as a mock
endpoint. MID-74 (pricing page) calls the mock endpoint instead of Stripe
checkout. MID-75 (tier-aware cap) is unchanged — it always read from `User.tier`,
not from Stripe. A future M4 issue will swap the mock for Stripe.

---

## 2026-05-20 · Hardcode player cap to 150 until billing exists

**Status:** Accepted, time-boxed (revert when MID-75 ships)

**Context:** Academy classes are 20–30 students. The current default tier on
`createGame` is `free` → 10-player soft cap. Without a tier UI or billing,
academy hosts cannot raise the cap.

**Decision:** Remove the tier-based cap calculation in `lib/game.ts`. Hardcode
`HARD_CAP = 150` and apply it to every game regardless of tier. Drop the upsell
banner.

**Trade-off accepted:** the cap-enforcement test path that was carefully
parameterized in M2 (MID-58) is temporarily simplified. M3-BILL-03 (MID-75)
restores tier-aware enforcement once `User.tier` is real.

**Implication:** the `tier` field on `GameSession` becomes vestigial during the
academy phase. Don't remove it from the schema — M3-BILL-03 will reuse it.

---

## 2026-05-20 · Quiz JSON export/import as portability layer

**Status:** Accepted

**Context:** Even with Postgres persistence, hosts may want to share quizzes
between laptops, back up their work, or seed a fresh DB.

**Decision:** Add quiz JSON export/import in the builder. The shape is the
serialized `Quiz` Prisma model with nested `Question[]`. Roundtrip through the
file system: download .json, upload .json, both produce identical DB rows.

**Implication:** the academy prep phase ships persistence + export/import
together. No JSON-only quiz storage workflow — the file is always a portable
snapshot of a DB row, not the source of truth.

---

## 2026-05-20 · localhost-only dev binding (deferred Tailscale)

**Status:** Accepted, time-boxed (revisit when academy moves to phone-joiners)

**Context:** Dev server in `server.ts` binds to `hostname = "localhost"`. Phones
on the same Tailnet cannot join games. Academy use today is host laptop +
projector + students-on-laptops, which works on localhost.

**Decision:** Keep localhost binding for now. When academy moves to a "students
join from their own phones" model, add a single ticket to bind to `0.0.0.0` and
plumb `next.config.ts` `allowedDevOrigins`.

**Implication:** the bug report on 2026-05-20 about iPhone join failures is NOT
about Tailscale — the user was joining on the same laptop's localhost. See the
join-double-submit fix (MID-86) for the actual root cause.

---

## 2026-05-20 · Always delegate coding to Claude Code CLI

**Status:** Accepted, permanent

**Context:** This repo is a side-project the user works on through an agent
orchestrator. The user's role is planning, prompts, Linear management, and
review. The orchestrator's role is to NOT touch application source directly.

**Decision:** every code change in this repo is shipped via a Claude Code CLI
run. The orchestrator may patch its own tooling under `.claude/` (orchestrator
script, prompts, queue) and may write non-code repo files like `DECISIONS.md`
and `README.md` content review notes — but `app/`, `lib/`, `server.ts`,
`scripts/`, `prisma/` etc. are Claude's territory.

**Implication:** when a Claude run hits max-turns without committing, the
orchestrator restarts the dev server and commits the diff that Claude already
produced. The orchestrator does not write *new* application code to "finish
the job".
