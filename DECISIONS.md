# Decisions Log

This file is the durable record of architectural and product decisions for PRIMETIME
(formerly INPUT/OUTPUT, formerly BROADCAST — see the 2026-06-04 and 2026-05-24 rebrand
entries below).
Each entry is dated. Latest first.

When a decision is reversed, do not delete the original — append a "Superseded by" line
and add a new entry below.

---

## 2026-06-09 · Public projection routes behind live.theprimetime.id

**Status:** Accepted

**Context:** In tunnel mode the host signs in at `http://localhost:4321`, but QR,
projection, and `GO LIVE` links intentionally open on `https://live.theprimetime.id`
when `NEXT_PUBLIC_SITE_URL` is configured. The browser does not send the host's
`localhost` session cookie to the public tunnel domain, so Auth.js middleware that
protects every `/host/*` route redirected `/host/:pin/display` to sign-in.

**Decision:** Treat display/projection routes as public-by-PIN room surfaces, not
private host-control surfaces. Keep builders and control rooms authenticated, but allow
unauthenticated access to `/host/:pin/display` and `/host/wordcloud/:pin/display`.
Centralize public URL generation in `lib/public-origin.ts` and use it for QR links,
projection windows, and future share/invite links.

**Implication:** Any future route under `/host/*` must be classified by product role,
not path prefix alone. If it controls or edits host-owned data, protect it. If it is an
audience/player room surface addressed by PIN, it may be public and must not depend on
the host's auth cookie. The operational note and verification checklist live in
`docs/live-origin-auth.md`.

---

## 2026-06-04 · Rebrand INPUT/OUTPUT → PRIMETIME (theprimetime.id)

**Status:** Accepted

**Context:** User acquired the domain `theprimetime.id` and wants to retire the
working title INPUT/OUTPUT. This is the *second* rebrand of this codebase; the
2026-05-24 BROADCAST → INPUT/OUTPUT entry below is the template, and its
"what does NOT change" discipline is reused verbatim. The vintage broadcast-graphics
visual identity stays — the rebrand is naming and metaphor copy, not visual.
A real-time quiz already has the bones of a TV game show, and *prime time* is the
flagship broadcast slot, so PRIMETIME reframes the existing surfaces at least as
well as the I/O signal-flow metaphor did.

**The one real subtlety:** the old name's slash was load-bearing — `INPUT/OUTPUT`
*reinforced* the design language (control surface = input port, projection = output,
players = signal flowing through). PRIMETIME has no slash and no I/O metaphor, so the
metaphor copy is rewritten to the prime-time broadcast-slot framing (the show going out
live in the marquee slot, the control room cutting the prime-time broadcast, the audience
tuning in). One new bridging paragraph in `DESIGN.md` does this; everything else is a
token flip. Generic input/output (`lib/config.ts` "Pure; no I/O." comment, the
`lib/quiz-io.ts` serialization module filename) is preserved — only brand uses of `I/O`
retire.

**Decision (locked names):**

| Token | Old | New |
|---|---|---|
| Product wordmark | `INPUT/OUTPUT` | `PRIMETIME` |
| Landing wordmark | `INPUT/OUTPUT` | two-line `PRIME` / `TIME` (never `THE PRIMETIME`) |
| Short form | `I/O` | none; use `PRIMETIME` |
| Code identifier | `inputoutput` | `primetime` |
| Local host-style id | `inputoutput.local` | `primetime.local` |
| Domain | `inputoutput.id` | `theprimetime.id` |
| Uppercase domain display | `INPUTOUTPUT.ID` | `THEPRIMETIME.ID` |
| GitHub repo | `adityadaniel/inputoutput` | `adityadaniel/primetime` |
| Working tree | `~/Developer/inputoutput` | `~/Developer/primetime` |
| Postgres user/db/password | `inputoutput` / `inputoutput_dev` / `inputoutput_e2e` / pw `inputoutput` | `primetime` / `primetime_dev` / `primetime_e2e` / pw `primetime` |
| Quiz schema URL | `https://inputoutput.id/quiz-v1.json` | `https://theprimetime.id/quiz-v1.json` |
| Subdomains | `live`/`techcanteen`/`www`.`inputoutput.id` | same on `theprimetime.id` |
| Support email | `support@inputoutput.id` | `support@theprimetime.id` |
| Cloudflared tunnel | `inputoutput-live` | `primetime-live` |
| Linear project | "INPUT/OUTPUT (inputoutput.id)" | "PRIMETIME (theprimetime.id)" |

> ⚠️ Domain is `theprimetime.id`, **not** `primetime.id`. The code identifier and
> product wordmark stay the short `primetime` / `PRIMETIME` (repo, package, db, dirs,
> UI). Only URLs, hosts, emails, schema URLs, and domain-display strings take the full
> `theprimetime.id`. The `*.local` hostname stays short (`primetime.local`).

**Landing wordmark treatment (locked):** the main landing hero (`landing/index.html`,
mirrored in the in-app `/` hero and `landing/og.html`) renders a two-line stacked mark —
`PRIME` on line 1 in `--vermilion` (#E5341F), `TIME` on line 2 in `--ink` — using the
existing Big Shoulders Display condensed face with tight leading. No slash. In-app
chyrons/footers stay single-line uppercase `PRIMETIME`.

**What deliberately does NOT change:** Visual identity / design language (vintage
broadcast graphics, CRT, scanlines, SMPTE/ON-AIR, palette, type stack); DB schema,
Prisma migrations, route shapes, in-app URL paths, WebSocket protocol, scoring, tier
limits; frozen `playtest/*` branches (stay on INPUT/OUTPUT forever); historical review
docs; the `quiz-v1.json` schema shape (only the `$schema` URL host flips); the Tech
Canteen separate product identity (only its old INPUT/OUTPUT attribution / old-domain
references change); the AASA file content (`landing-techcanteen/.well-known/
apple-app-site-association` — bundle IDs and bytes unchanged; only its serving host moves
in Phase 4).

**Sequencing (4 phases):** Phase 1 — this DECISIONS entry. Phase 2 — code & infra
rename in three passes (2a code-id, 2b tests + CI, 2c infra/config/lockfile). Phase 3 —
brand & copy (3a DESIGN.md bridging paragraph + landing wordmark, 3b user-facing copy +
landings). Phase 4 (orchestrator, post-merge, off-hours, OUT OF SCOPE for the coding
agent) — GitHub repo rename + working-tree move + `.env.local`; DNS / Pages / cloudflared
tunnel + AASA host move; Linear project + Hermes routing/memory. Phases 1–3 land on
branch `rebrand/primetime` off `main`.

**Risks accepted:** Dev DB rename wipes local volumes (throwaway). GH repo rename creates
a redirect Pages/tunnel integrations may transiently mishandle (run 4a off-hours). Two
domains in flight — keep `inputoutput.id` 301 → `theprimetime.id` until links age out
(retirement timeline deferred to its own ticket). Generic `I/O`/`io` occurrences must be
preserved, not flipped.

**Authoritative plan:** `docs/rebrand-primetime-plan.md` (with code-aware review
`docs/rebrand-primetime-claude-review.md`) is the single source of truth this entry
promotes.

---

## 2026-05-24 · Rebrand BROADCAST → INPUT/OUTPUT (inputoutput.id)

**Status:** Accepted

**Context:** User acquired the domain `inputoutput.id` and wants to retire the
working title BROADCAST in favor of a name that reads as a product, not a
descriptor. The vintage broadcast-graphics visual identity stays — the rebrand
is naming, not visual. The new name reframes the existing surfaces in signal-
flow terms that are already in the design language: control surface = INPUT,
projection display = OUTPUT, players = signal flowing through.

**Decision (locked names):**

- **Product name:** `INPUT/OUTPUT` (with the slash; the slash is part of the wordmark)
- **Short form:** `I/O`
- **Code identifier:** `inputoutput` (lowercase, no slash). Used for repo name,
  npm package name, Postgres user/db, working-tree directory, env var prefixes,
  CSS class prefixes if any.
- **Domain:** `inputoutput.id`
- **Tagline (suggested, not load-bearing):** "broadcast graphics for the I/O era"

**What changes:**

- Wordmark in every user-facing surface (builder, host control, projection
  display, player, marketing landing, legal pages, README, DESIGN.md headers).
- Code identifiers: `broadcast` → `inputoutput` in variable names, type names,
  log prefixes (`[broadcast]` → `[io]`), env var prefixes (`BROADCAST_*` →
  `INPUTOUTPUT_*` where the prefix is needed; drop the prefix where it isn't).
- Postgres user/db: `broadcast` / `broadcast_dev` → `inputoutput` /
  `inputoutput_dev`. Forces a `docker compose down -v` on dev (data is
  throwaway).
- `package.json` `name` field: `kahoot-clone` → `inputoutput`. (`kahoot-clone`
  was always a placeholder — the rename retires it directly.)
- GitHub repo: `adityadaniel/broadcast` → `adityadaniel/inputoutput`.
  Working-tree path: `~/Developer/broadcast` → `~/Developer/inputoutput`.
- Linear project: "Kahoot Clone (BROADCAST)" → "INPUT/OUTPUT (inputoutput.id)".
- Hermes routing skill (`hermes-routing-daniel`): topic-tag `broadcast` →
  `inputoutput`. Telegram topic ID itself stays the same.

**What deliberately does NOT change:**

- The visual identity. Vintage broadcast graphics (CRT, scanlines, test cards,
  signal motifs, monospace, Riso/limited palette) is the product's design
  language and the rebrand reinforces it rather than replacing it. DESIGN.md
  body paragraphs describing visuals stay verbatim; only product-name tokens
  flip.
- Database schema, Prisma migrations, route shapes, URL paths inside the app,
  WebSocket protocol, scoring rules, tier limits, M3 milestone scope.
- Frozen `playtest/*` branches. The academy is running live games off
  `playtest/with-sound` (and any sibling playtest branch). Those branches stay
  on the BROADCAST name forever — the rebrand lands on `main` only and merges
  forward to new feature branches off main. The academy host doesn't see a
  rename mid-event.
- Historical review docs and postmortems under `docs/reviews/`. They're
  snapshots of work done under the old name and stay readable as such. A new
  `docs/reviews/README.md` will note the rename for future readers.
- The "Always delegate coding to Claude Code CLI" rule from 2026-05-20. That
  rule applies to the rebrand work too — DECISIONS.md (this file) and the
  Linear project metadata are orchestrator territory; everything under `app/`,
  `lib/`, `server.ts`, `scripts/`, `prisma/`, `.github/workflows/`,
  `docker-compose.yml`, `package.json`, `DESIGN.md`, `README.md` ships through
  Claude.

**Sequencing (4 phases, 9 Linear tickets MID-124 through MID-132):**

1. **Phase 1 — Decisions.** This entry. Pin names + sequencing so every
   downstream ticket cites a single source of truth. (MID-124, this commit.)
2. **Phase 2 — Code rename.** Three parallel-safe tickets after Phase 1:
   2a app code (`server.ts`, `app/`, `lib/`, `scripts/`); 2b tests + CI
   workflows; 2c infra (`docker-compose.yml`, `.env.example`,
   `package.json`, DB user/db rename). (MID-125 / MID-126 / MID-127.)
3. **Phase 3 — Brand & copy.** Two parallel-safe tickets after Phase 1:
   3a `DESIGN.md` brand update with one new paragraph bridging the I/O
   metaphor and the existing vintage-broadcast aesthetic; 3b `README.md`,
   marketing landing, privacy, terms. (MID-128 / MID-129.)
4. **Phase 4 — Infra & ecosystem.** Sequential after Phase 2 + 3 are merged
   to main: 4a GitHub repo rename + local directory move + remotes;
   4b DNS for inputoutput.id + deploy target + canonical URL; 4c Linear
   project rename + Hermes routing skill update + memory + cron sweep.
   (MID-130 / MID-131 / MID-132.)

**Risks accepted:**

- Dev DB rename forces every dev's local volume to reset. Acceptable — dev DB
  is throwaway, and `npm run db:reset` already documents the wipe-and-migrate
  flow.
- GitHub repo rename creates a redirect that Vercel/host integrations and
  deploy webhooks may transiently mishandle. Phase 4a runs OUTSIDE academy
  event windows and verifies the deploy URL before/after the rename.
- Frozen playtest branches diverge from main forever. Their CI workflows still
  reference the old name; that's fine because they don't run in CI anymore
  (frozen = no pushes). If a hotfix is ever needed on a playtest branch, the
  fix lands on the playtest branch as-is without rename.
- The 28 source files containing "broadcast" include some intentional
  references to "broadcast graphics" as a *visual style*. Phase 2a's
  acceptance criteria explicitly preserve those — only the wordmark and code
  identifiers flip.

**Open questions (deferred to their tickets, not this decision):**

- Hosting provider for inputoutput.id (Vercel? Fly? self-hosted?) — MID-131.
- WWW vs apex redirect direction — MID-131.
- Transactional email on inputoutput.id (MX/SPF/DKIM/DMARC) — deferred until
  product launch unless MID-131 surfaces a real need sooner.

**Implication:** every rebrand ticket from MID-125 onward references this
entry. New tickets created during the rebrand work cite "Depends on: MID-124"
in their description. After Phase 4c lands, this DECISIONS.md is the only
remaining file in the repo that uses the old "BROADCAST" name in prose — and
it stays that way as the historical record.

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

---

## 2026-06-10 · Answer-phase fanout is coalesced; player feedback is optimistic

**Status:** Accepted

**Context:** At ~120-player playtests, answer buttons felt dead. Every
successful `player:answer` ran a full `broadcast(pin)`: public `state` to the
whole room plus a recomputed `personal` per player — O(players²) deliveries
per answer burst. Measured with `scripts/load-fanout.ts` at 120 players:
~14.7k state + ~14.5k personal deliveries per question, and personal
confirmation latency that grew with answer order (first answerers ~43ms, last
~330ms on localhost; far worse on venue WiFi). The player UI only showed the
LOCKED state once that server-confirmed personal arrived, so late answerers
saw an unresponsive button. Nothing public changes per answer mid-question
except standings scores — the control room's ANSWERS counter and the display's
distribution bars read from `state.reveal`, which only exists at reveal.

**Decision:** Two-sided fix. Server: `player:answer` acks and emits `personal`
to the answering socket only; full room broadcasts during the question phase
coalesce into one tick per 250ms (`scheduleBroadcast`), while phase flips
(all-answered lock, expiry) still broadcast immediately and cancel the pending
tick. `personalState` accepts a precomputed leaderboard so one broadcast sorts
once, not once per player. Client: the answer button locks optimistically on
tap (`pendingAnswer`, tagged to its questionIndex); a rejected ack rolls it
back; reveal and later phases always render server truth.

**Implication:** UI feedback no longer depends on broadcast latency, and
answer-burst traffic dropped ~38× (88,330 → 2,296 deliveries over 3 questions
at 120 players). Anything that wants per-answer realtime updates mid-question
(e.g. a live answer counter) must ride the coalesced tick, not per-answer
broadcasts. `scripts/load-fanout.ts` is the measurement harness; server must
run with `PLAYER_CAP >= PLAYERS`.
