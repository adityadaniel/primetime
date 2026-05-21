# Decisions Log

This file is the durable record of architectural and product decisions for BROADCAST.
Each entry is dated. Latest first.

When a decision is reversed, do not delete the original — append a "Superseded by" line
and add a new entry below.

---

## 2026-05-21 · M3 scope back to full — real Stripe + Google + Apple

**Status:** Accepted (supersedes 2026-05-20 mock-billing decision for new tickets; mock decision stays valid for academy testing window only)

**Context:** M2.5 shipped; academy session tested cleanly. User now wants the full M3 scope back — real Stripe, Google OAuth, and Sign in with Apple. Apple Developer account is available.

**Decision:** Bring back original M3 scope. Real Stripe (test mode for M3, live keys before public launch). Google + Apple OAuth via Auth.js v5 alongside the credentials provider. The mock-billing decision from 2026-05-20 is preserved as a fallback if Stripe integration runs into trouble, but the default path is real Stripe end-to-end.

**Trade-off accepted:** more external services to provision (Stripe, Google Cloud, Apple Developer, Resend). Each is documented in `docs/m3-setup.md` with step-by-step setup. Apple Sign-In is gated on `ENABLE_APPLE_SIGNIN=true` and requires real domain DNS verification — wired up in code (MID-67) and rendered in UI (MID-68), activated post-domain.

**Implication:** MID-67/68 expanded scope to include Google + Apple providers (architecture-only for Apple until domain). MID-69 reactivated for Resend email. MID-73/74 rewritten as real Stripe integration. MID-75 unchanged. Subscriber sees real Stripe Checkout and a real subscription record.

---

## 2026-05-21 · Pricing tiers — Free 50 / Pro \$9 (200 players)

**Status:** Accepted

**Context:** BROADCAST needs a tier shape that drives mock-then-real billing without rework. Competitive pricing research (`docs/competitive-pricing-reference.md`) showed Kahoot Go free=40 players, Kahoot Silver \$7=100 players, Kahoot Gold \$12=200 players. Mentimeter Pro €28, Wayground individual paid is gone.

**Decision:** Two tiers only.

- **Free:** 50 players, 5 saved quizzes, full CSV export, BROADCAST watermark on display, 7-day session retention.
- **Pro \$9/mo or \$90/yr (2 months free):** 200 players, unlimited quizzes, image upload, custom logo, no watermark, full session-history retention.

Single price for academy and business — no separate education tier in MVP.

**Trade-off accepted:** \$9 is below Kahoot Gold (\$12) and beats Mentimeter (€28); the spread funds Stripe fees + R2 + Upstash + Vercel hosting per active user but isn't margin-heavy. Two-tier (vs three) keeps upgrade flow simple and lets us watch where users actually want more.

**Implication:** MID-73 (Stripe), MID-74 (pricing page), MID-75 (tier caps) all consume `CAP_FREE=50`, `CAP_PRO=200` constants. The hardcoded `HARD_CAP=150` from MID-84 gets replaced when MID-75 lands.

---

## 2026-05-21 · Single-domain architecture, marketing on `/`, app routes nested

**Status:** Accepted

**Context:** Public-launch question — should the marketing site and the app live on the same domain, or split via subdomain (`app.broadcast.x` for the app, apex for marketing)? Industry split: Notion/Linear/Cal.com use subdomain split; smaller-stage SaaS often start single-domain to ship faster.

**Decision:** Single domain, route-based separation. Marketing landing on `/`, app routes nested under `/host`, public player on `/play/[pin]` and `/join`. Reasons:

- One Vercel project, one DB, one CDN — simpler ops at this stage
- Sub-tld split can be added later once we have a real domain and traffic justifies it
- Marketing-vs-app SEO and caching can be handled with route-level config

**Trade-off accepted:** marketing and app share the same Next.js bundle and middleware. If marketing pages get heavy (analytics, A/B testing), they'll bloat the app bundle. Migration to a separate marketing site (e.g. Astro on a sub-tld) is straightforward when the time comes.

**Implication:** new MID ticket for "marketing landing + route reorg + noindex on app routes" (see Linear). `app/page.tsx` becomes the marketing landing. `app/host/page.tsx` becomes the auth-gated builder.

---

## 2026-05-21 · Cloudflare R2 for object storage, Upstash for Redis

**Status:** Accepted (supersedes implicit "Vercel Blob + Vercel KV" assumption from `docs/m3-setup.md` v1)

**Context:** User uncomfortable with full Vercel lock-in. Options reviewed:

- Vercel Blob + Vercel KV: native integration, but pricier on egress and storage; tied to Vercel
- Cloudflare R2 + Upstash Redis: multi-vendor, S3-compatible storage, generous free tiers, no egress fees on R2
- Cloudflare R2 + Cloudflare Workers KV: KV is eventually consistent, no pub/sub — wrong tool for socket sync

**Decision:**

- **Object storage:** Cloudflare R2. S3-compatible, $0.015/GB/mo storage, 10 GB free, **zero egress fees**. Used for quiz cover images (MID-72) and any future user-uploaded assets.
- **Redis (pub/sub for socket sync, MID-78):** Upstash Redis. Real Redis protocol over HTTP, 10K commands/day free, native Vercel integration but works equally from Cloudflare Workers, supports pub/sub.
- **Postgres:** stays Vercel Postgres (Neon-backed) for now — not worth the migration cost yet.

**Trade-off accepted:** multi-vendor (CF + Upstash + Vercel) means more accounts to manage. In exchange we get zero egress costs on images, no Vercel lock-in for the storage layer, and a clean S3 SDK boundary that lets us swap providers later.

**Implication:** `docs/m3-setup.md` rewritten to drop Vercel Blob/KV in favor of R2 + Upstash. MID-72 (image upload) uses `@aws-sdk/client-s3` against R2 endpoint. MID-78 (pub/sub) uses Upstash Redis URL. MID-79 (file upload prod) becomes "R2 bucket + presigned URL pattern". Cost projection added to `docs/m3-setup.md` for typical usage scenarios.

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
