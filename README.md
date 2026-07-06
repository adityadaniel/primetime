[![PR](https://github.com/adityadaniel/primetime/actions/workflows/pr.yml/badge.svg)](https://github.com/adityadaniel/primetime/actions/workflows/pr.yml)
[![Main](https://github.com/adityadaniel/primetime/actions/workflows/main.yml/badge.svg)](https://github.com/adityadaniel/primetime/actions/workflows/main.yml)

# PRIMETIME — Live in-room engagement platform (open-source)

> **OSS build uses sane defaults — no SaaS keys required.** Clone, install, and run with only a database URL and an auth secret. See [Quickstart (local)](#quickstart-local) and [Environment reference](#environment-reference).

A real-time engagement platform with a vintage broadcast-graphics aesthetic,
built for running live activities in a room (workshops, classes, watch parties).
It hosts four activity types on one shared PIN / host / player / projection model:

- **Quiz** — Kahoot-style multiple-choice / true-false with a server-authoritative timer and scoring.
- **Word Cloud** — audience submits words to a live projected cloud.
- **Q&A** — Slido-style crowd questions with voting, moderation, highlight/present mode, labels, and replies.
- **WonderWall** — a moderated wall of official LinkedIn post embeds.

State is server-authoritative (Next.js + Socket.IO on one port) and persisted to
Postgres via Prisma. Hosts sign in; players join anonymously by PIN.

> **Source of truth for contributors:** read `AGENTS.md` first, then `PRD.md`
> (product/routes), `DESIGN.md` (visual identity), and `DECISIONS.md` (durable
> decisions). Per-activity specs live in `docs/wordcloud-prd.md`,
> `docs/q-and-a-prd.md`, and `docs/wonderwall-prd.md`.

---

## Quickstart (local)

**No SaaS accounts needed.** Defaults are password auth, no email, local uploads, no billing.

### 1. Prerequisites

- Node.js 22+ (CI and the reference deploy run Node 24)
- Postgres 16 (Docker, Postgres.app, or Homebrew — see [Database setup](#database-setup))

### 2. Clone and install

```bash
git clone https://github.com/adityadaniel/primetime.git
cd primetime
npm install
```

### 3. Database

The fastest path (Docker):

```bash
npm run db:up          # starts Postgres 16 via Docker Compose
```

Or with Postgres.app / Homebrew — see [Database setup](#database-setup).

### 4. Environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```
DATABASE_URL=postgresql://primetime:primetime@localhost:5432/primetime_dev
AUTH_SECRET=your-random-secret-here
```

Generate a secret: `openssl rand -hex 32`

### 5. Run migrations

```bash
npm run db:migrate
```

### 6. Boot

```bash
npm run dev
```

A single command boots Next.js + the WebSocket server on the **same port**:
<http://localhost:4321>.

> Port 3000 is intentionally avoided. To override: `PORT=4000 npm run dev`

### 7. Play

1. Open <http://localhost:4321> → **Sign up** (first account) → **Host**.
2. Create a quiz (or a Word Cloud / Q&A / WonderWall room) → **GO LIVE** → note the 6-digit PIN.
3. Open <http://localhost:4321/join> → enter the PIN + a nickname.
4. Play!

---

## Deployment / self-host

There is **no prebuilt Docker image** — `docker compose` here runs **Postgres
only**; the app runs directly with Node. Two supported ways to expose it:

### Production start

```bash
npm run build          # prisma generate + next build
npm run start          # NODE_ENV=production, Next + Socket.IO on :4321
```

### Public / live via Cloudflare Tunnel

```bash
npm run serve          # runs `npm run start` + `cloudflared tunnel run primetime-live` together
```

`npm run serve` starts the production server and the named Cloudflare Tunnel in
one process (Ctrl-C tears down both). Configure the public origin first:

```
NEXT_PUBLIC_SITE_URL=https://live.theprimetime.id
```

Full walkthroughs (local-IP mode for a room, and Cloudflare Tunnel for a public
domain, including one-time `cloudflared` provisioning) are in
[`DEPLOYMENT.md`](DEPLOYMENT.md). For a guided first-time academy setup, run
`bash scripts/setup.sh` — see [Self-hosting for other academies](#self-hosting-for-other-academies).

> **Tunnel/live-origin note:** when hosting locally but projecting through a
> public tunnel, host auth cookies stay on `localhost` while public
> projection/display routes stay public-by-PIN. Read
> [`docs/live-origin-auth.md`](docs/live-origin-auth.md) before changing QR /
> projection URL generation or Auth.js middleware.

---

## Environment reference

All flags default to the OSS path. **Unset = OSS default.** Set these only for SaaS/tunnel behavior.

| Env var | Values | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | postgres connection URI | — | **Required.** |
| `AUTH_SECRET` | any non-empty string | — | **Required.** JWT session secret. Generate: `openssl rand -hex 32`. |
| `NEXTAUTH_URL` | URL | `http://localhost:4321` | Your app's URL (server-side). |
| `NEXT_PUBLIC_SITE_URL` | URL | — | Public origin for client-side QR, projection, and share links. Set to your tunnel origin (e.g. `https://live.theprimetime.id`) for live mode. |
| `PORT` | integer | `4321` | Port for the combined Next + Socket.IO server. |
| `AUTH_MODE` | `password` · `password+oauth` | `password` | `password` = local email/password only. `password+oauth` enables Apple (gated by `ENABLE_APPLE_SIGNIN`). |
| `ENABLE_APPLE_SIGNIN` | `true` · `false` | `false` | Only effective with `AUTH_MODE=password+oauth`. Requires `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`. |
| `EMAIL_PROVIDER` | `none` · `token-print` · `resend` | `none` | `token-print` logs reset URLs to the server console (dev). `resend` sends real reset emails via the Resend HTTP API and requires `RESEND_API_KEY` plus `EMAIL_FROM`. |
| `UPLOAD_PROVIDER` | `local` · `s3` · `uploadthing` | `local` | `local` = on-disk at `public/uploads/`. `s3` (incl. R2/MinIO) needs `S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`. `uploadthing` needs `UPLOADTHING_TOKEN`. |
| `UPLOAD_MAX_BYTES` | bytes (integer) | `5242880` (5 MB) | Max upload size. |
| `UPLOAD_DIR` | absolute path | `<cwd>/public/uploads` | Upload directory on disk. |
| `ENABLE_SESSION_PERSISTENCE` | `true` · `false` | `true` | When on, quiz games persist to Postgres (players, answers, results, history). Set `false` to run purely in-memory. |
| `BILLING_ENABLED` | `true` · `false` | `false` | OSS ships with no billing/upgrade flow. |
| `WONDERWALL_ANALYSIS_ENABLED` | `true` · `false` | `false` | **Opt-in only.** When on, fetches + stores approved LinkedIn post text (via Apify) for a host-only word-cloud insights view. Requires `APIFY_TOKEN`. Carries LinkedIn-ToS/privacy risk the operator accepts — see `DECISIONS.md` (2026-06-21). |
| `APIFY_TOKEN` | token | — | Required only when `WONDERWALL_ANALYSIS_ENABLED=true`. |

> **Self-hosting OSS?** Only `DATABASE_URL` and `AUTH_SECRET` are required. Leave
> everything else at defaults — password auth, no email, local uploads, no
> billing, no scraping. Max players per game is a code-level constant in
> `lib/constants.ts` (`PLAYER_CAP`).

`.env.example` also documents optional beta-gating flags (`REQUIRE_INVITE_CODE`,
`BETA_INVITE_CODES`) and `NEXT_PUBLIC_DEMO_PIN`.

---

## Surfaces

Every activity reuses the same **PIN → host → player → display** model. Host
surfaces require a signed-in host; display and play surfaces are public-by-PIN.

| Route | Who | Purpose |
|------|-----|---------|
| `/` | Anyone | Landing / studio master |
| `/signup`, `/signin`, `/reset` | Anyone | Host auth (password; Apple optional) |
| `/host` | Host | Dashboard — saved quizzes, recent rooms, Q&A room history |
| `/pricing`, `/privacy`, `/terms` | Anyone | Informational pages |
| **Quiz** | | |
| `/host/quiz/new` | Host | Quiz builder (multiple-choice / true-false, per-question image, timer, double points) |
| `/host/[pin]/control` | Host | Director's console — PIN, players, timer, distribution, advance controls |
| `/host/[pin]/display` | Audience | On-air feed (projector) — PIN, question, shapes-only, podium |
| `/join` → `/play/[pin]` | Player | PIN + nickname → lobby → answer → reveal → final |
| **Word Cloud** | | |
| `/host/wordcloud/new`, `/host/wordcloud/[pin]/control`, `/host/wordcloud/[pin]/display` | Host / Audience | Create, moderate, project a live word cloud |
| `/play/[pin]/wordcloud` | Player | Submit words |
| **Q&A** | | |
| `/host/q-and-a/new`, `/host/q-and-a/[pin]/control`, `/host/q-and-a/[pin]/display` | Host / Audience | Create, moderate/highlight, present-mode projection |
| `/play/[pin]/q-and-a` | Player | Submit / upvote questions |
| **WonderWall** | | |
| `/host/wonderwall/new`, `/host/wonderwall/[pin]/control`, `/host/wonderwall/[pin]/display` | Host / Audience | Create, review queue, public waterfall of approved LinkedIn embeds |
| `/host/wonderwall/[pin]/insights` | Host | Word-cloud insights over approved posts (only when analysis is enabled) |
| `/play/[pin]/wonderwall` | Participant | Paste public LinkedIn post URLs, see review feedback |

**Exports:** `GET /host/[pin]/results.csv` (quiz results, once `final`),
`GET /host/wordcloud/[pin]/answers.csv`, `GET /host/q-and-a/[pin]/questions.csv`,
`GET /api/wonderwall/[pin]/export` (host-only), and quiz definition
import/export via `POST /api/quiz/import` and `GET /api/quiz/[id]/export` (the
`quiz-v1` JSON format, see `samples/`).

---

## What's shipped

**Platform**

- Next.js 15 App Router + React 19 + TypeScript + Tailwind; single `npm run dev`.
- Custom Node server (`server.ts`) colocates Next + Socket.IO on one port.
- **Postgres + Prisma persistence** — users, quizzes, game sessions, players,
  answers, and per-activity state all persisted (gated by
  `ENABLE_SESSION_PERSISTENCE`, on by default).
- **Auth.js v5** — email/password host accounts with password reset; optional
  Apple OAuth (`AUTH_MODE=password+oauth`). Socket.IO connections authenticate
  off the Auth.js session cookie; players stay anonymous.
- **OSS ⇄ SaaS config surface** — auth, email, uploads, billing, and WonderWall
  analysis are env-configurable; defaults need zero SaaS accounts.
- Distinct **PRIMETIME** broadcast identity across every surface; answer options
  are distinguishable by **shape**, not color alone.
- **Broadcast sound effects** — generated SFX for cues/reveals (`lib/sfx.ts`,
  `npm run sounds:generate`).

**Quiz**

- Quiz builder: multiple-choice + true/false, timers (10/20/30/60/90/120 s),
  double points, and an **optional per-question image** (local upload, wired
  into the builder).
- **Saved quiz library** per host, plus **JSON import/export** (`quiz-v1`).
- 6-digit PIN sessions; server-authoritative scoring
  `1000 × (½ + ½ × t_left/t_limit) × {1|2}`.
- Lobby → question → reveal → leaderboard → final state machine, kept in sync
  across host, display, and player over WebSocket.
- Auto-lock at timer expiry **or** when all connected players have answered;
  live answer distribution + correct-answer reveal; top-3 podium; final leaderboard.
- **Player reconnect grace** (30 s to reclaim score/nickname/socket) and
  **host-disconnect grace pause** (60 s; resumes if the host returns, else ends
  `host-left`).
- **Player cap** enforcement (`PLAYER_CAP` code constant); over-cap joins get a
  `full` rejection.
- Light **profanity filter** on nicknames; **results CSV** export.

**Word Cloud** — host posts a prompt, players submit words, real-time projected
cloud, answers CSV export.

**Q&A** (Slido-style) — participants submit and upvote questions; host moderates,
highlights, replies, and applies labels; public display + fullscreen present
mode; session controls (close/reopen/end); coalesced delta fan-out for scale
(see `docs/q-and-a-prd.md`); questions CSV export.

**WonderWall** (moderated LinkedIn wall) — participants paste public LinkedIn
post URLs by PIN; the host reviews each (approve/reject-with-feedback/hide/
restore/reorder); the public display projects **only** approved posts
(`status=APPROVED` + `canDisplay=true`) as official LinkedIn iframe embeds.
Host-only CSV export with formula-injection-safe escaping. By default **no
scraping, no LinkedIn API, no post-content storage** — only URL/URN/embed/review
metadata. An **opt-in** analysis path (`WONDERWALL_ANALYSIS_ENABLED`) fetches +
stores approved-post text for a host-only word-cloud insights view; off for
OSS/self-host. See `docs/wonderwall-prd.md` and `DECISIONS.md`.

---

## Deferred / not built

- **Billing + Pro tier upgrade** — a `tier` flag exists on sessions and a
  `/pricing` page is informational, but there is no payment flow
  (`BILLING_ENABLED=false`). Free-tier caps and the Pro watermark gate are
  stubbed (`MID-75`).
- **Redis pub/sub for multi-node** — single-node only; horizontal scaling would
  need the Socket.IO Redis adapter and a shared store for rate limiting.
- **Browser coverage** — developed/tested primarily on Chrome (macOS). Modern
  Safari/Firefox should work but aren't exhaustively verified.

---

## Project layout

```
app/
  page.tsx                         landing
  signup|signin|reset/             host auth pages
  host/page.tsx                    host dashboard (quizzes, rooms, Q&A history)
  host/quiz/new/page.tsx           quiz builder
  host/[pin]/control|display       quiz director console / on-air feed
  host/wordcloud/**                word-cloud host + projection
  host/q-and-a/**                  Q&A host control + display/present
  host/wonderwall/**               WonderWall review queue + display + insights
  join/page.tsx                    player entry
  play/[pin]/(page|wordcloud|q-and-a|wonderwall)   player views per activity
  api/                             quiz CRUD + import/export, upload, auth,
                                   wordcloud/q-and-a/wonderwall endpoints, health
components/
  Broadcast.tsx, Countdown.tsx, Shape.tsx          broadcast UI primitives
lib/
  config.ts, constants.ts          OSS⇄SaaS config surface + code constants
  game.ts                          quiz in-memory game state + scoring
  qa.ts, qa-repo.ts, qa-hydrate.ts Q&A state machine, persistence, hydration
  wordcloud*.ts                    word-cloud state / layout / repo / hydration
  wonderwall-repo.ts, wonderwall-apify.ts   WonderWall persistence + opt-in analysis
  session-repo.ts                  quiz session persistence (gated)
  repos/                           Prisma-backed repositories (quiz, etc.)
  sfx.ts, use-sfx.ts               broadcast sound effects
  socket.ts, use-socket-*.ts       browser socket singleton + hooks
  upload.ts, mailer.ts, reset.ts   uploads, email transport, password reset
  public-origin.ts, types.ts       public URL helper, shared types
  dev-fixtures/                    fixture catalog for visual QA + snapshots
auth.ts, auth.config.ts            Auth.js (server-only / edge-safe split)
server.ts                          Next.js + Socket.IO on one port
prisma/                            schema, migrations, seed
scripts/                           setup.sh, smoke.ts, qa-stress.ts, generate-sounds.ts, e2e-db-reset.ts
tests/e2e/                         Playwright suites (auth, quiz, q-and-a, wonderwall)
```

---

## Scripts

```bash
# Run
npm run dev            # Next + Socket.IO on http://localhost:4321
npm run qa             # vanilla Next dev on :4322 for /dev/fixtures (no socket, no DB)
npm run build          # prisma generate + next build
npm run start          # production start (NODE_ENV=production, tsx-driven)
npm run serve          # start + Cloudflare Tunnel (primetime-live) together
npm run setup          # guided first-time academy setup (scripts/setup.sh)

# Quality
npm run lint           # biome check .
npm run lint:fix       # biome check --write .
npm run format         # biome format --write .
npm test               # vitest run (lib unit tests + fixture × surface snapshots)
npm run test:watch     # vitest watch mode
npm run test:coverage  # vitest with V8 coverage
npm run smoke          # Socket.IO realtime smoke (server must be running)
npm run qa:stress      # Q&A 120-participant stress harness
npm run test:e2e       # Playwright browser E2E (boots its own server)
npm run test:e2e:ui    # Playwright interactive UI

# Assets
npm run sounds:generate  # (re)generate broadcast SFX

# Database
npm run db:up          # start Postgres via Docker Compose
npm run db:down        # stop Postgres
npm run db:reset       # nuke + rebuild + migrate
npm run db:migrate     # apply Prisma migrations
npm run db:logs        # tail Postgres logs
npm run db:psql        # psql shell into the dev DB
npm run db:studio      # Prisma Studio at localhost:5555
npm run db:e2e:reset   # create + migrate the dedicated primetime_e2e database
```

---

## Testing

Layers, each with a distinct job:

| Layer | Command | Covers |
| --- | --- | --- |
| Unit | `npm test` / `npm run test:coverage` | `lib/*` logic (scoring, config, Q&A/word-cloud/wonderwall repos + state) and fixture × surface snapshots |
| Smoke | `npm run smoke` | Socket.IO realtime: full game loop, reconnect/pause, cap, CSV, profanity, word cloud (server must be running) |
| Stress | `npm run qa:stress` | Q&A submission fan-out at ~120 participants |
| E2E | `npm run test:e2e` | Browser-level auth + quiz + Q&A + WonderWall lifecycles via Playwright |

> Coverage is configured in `vitest.config.ts`. Note it currently measures a
> subset of `lib/` — treat the reported percentage as scoped, not whole-repo.

### End-to-end (Playwright)

The E2E suite (`tests/e2e/`) drives a real Chromium browser through the OSS auth
flows and the authenticated activity lifecycles. It is self-contained — you only
need Postgres running:

```bash
npm run db:up        # Postgres (if not already up)
npm run test:e2e     # boots the app itself
```

What it does:

- **Dedicated database.** Runs against `primetime_e2e` (derived from your
  `DATABASE_URL`, same server), created + migrated by `npm run db:e2e:reset`.
  Your dev DB is never touched; tables truncate between tests, so order never
  matters.
- **Boots the server.** Playwright's `webServer` runs `db:e2e:reset` then
  `npm run dev`, pinning an OSS profile via env (`EMAIL_PROVIDER=token-print`,
  `UPLOAD_PROVIDER=local`, session persistence on). Locally it reuses a running
  `:4321`; in CI it boots fresh.
- **No SaaS, no real email.** Reset links are captured from the `devUrl` the
  reset endpoint returns in non-production mode.

First run only, install the browser: `npx playwright install chromium`.

Suites:

- `tests/e2e/auth.spec.ts` — signup, sign out + back in, forgot/reset (UI +
  dev-token capture), first-run admin banner, duplicate-signup rejection.
- `tests/e2e/quiz-lifecycle.spec.ts` — create quiz + see it in the library, run
  a full game over Socket.IO and assert a finished `GameSession` row, player-cap
  rejection, local image upload, word-cloud CSV export.
- `tests/e2e/qa-lifecycle.spec.ts` — Q&A submit / vote / moderate / display flow.
- `tests/e2e/wonderwall-lifecycle.spec.ts` — submission → review → approved
  projection and CSV export.

The HTML report lands in `playwright-report/` (`npx playwright show-report`).

---

## Dev fixtures

For visual QA without a live game, every presentational surface (`display`,
`control`, `player`) accepts plain props and is catalogued under
`lib/dev-fixtures/`.

```bash
npm run qa
# open http://localhost:4322/dev/fixtures
```

A sidebar lists edge-case scenarios (lobby cap, long stems, truncating answers,
ties, host-left endings, paused-over-reveal, etc.) with a `Display | Control |
Player` segmented control; selection persists in the URL (`?id=…&surface=…`).

### Bare mode (recommended for visual QA)

Append `&bare=1` to any fixtures URL to hide the sidebar, tab bar, notes ribbon,
and wrapping card so the surface renders edge-to-edge at full viewport — matching
the real `/host/[pin]/display`, `/host/[pin]/control`, and `/play/[pin]` routes
with no harness distortion.

```
http://localhost:4322/dev/fixtures?id=question-long-stem&surface=display&bare=1
```

Use bare mode when checking layout, font clamps, or anything `vw`-based; the
regular harness wraps the surface in chrome that skews `clamp()` math. A
`← exit bare` pill returns you to the full harness with the same fixture
preselected. The route returns `notFound()` in production. The same catalog
drives Vitest snapshot tests (`app/dev/fixtures/fixtures.test.tsx`) — run
`npm test` and any unintended visual change surfaces as a snapshot diff.

---

## Database setup

Local Postgres 16 required.

### Docker Compose (recommended)

```bash
npm run db:up
```

Uses the same image, credentials, and database name as CI. See
`docker-compose.yml` (Postgres only — the app is not containerized).

### Postgres.app (one-click on macOS)

1. Download from <https://postgresapp.com> (already installed if `/Applications/Postgres.app` exists).
2. Open it, click "Initialize" on first run.
3. Add to your shell: `export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"`
4. Create role + dev database: `createuser primetime && createdb -O primetime primetime_dev`

### Homebrew

```bash
brew install postgresql@16
brew services start postgresql@16
createuser primetime && createdb -O primetime primetime_dev
```

### After install

Set `DATABASE_URL` in `.env`, then:

```bash
npm run db:migrate    # creates schema + applies migrations
npm run db:reset      # nuke and rebuild
npm run db:studio     # browse data at localhost:5555
```

---

## Self-hosting for other academies

This is the internal tool we use to run live in-room activities at our academy.
It's not a SaaS and there's no hosted version — but the install path is open, and
the repo is set up so any academy can clone it, point it at their own domain, and
run their own instance.

### What you need

- A machine (Mac mini, MacBook, or Linux server) with Node.js 22+
- A domain you control, with DNS managed by Cloudflare (free tier is fine)
- About 30 minutes for first-time setup

### Steps

1. Clone the repo on your server.
2. Run `bash scripts/setup.sh`. It installs prerequisites, sets up the database,
   walks you through provisioning a Cloudflare Tunnel for your domain, and
   optionally seeds a sample quiz.
3. Start the app: `npm run start` (or `npm run dev` for development).
4. In a separate terminal, start the tunnel:
   `cloudflared tunnel run <your-tunnel-name>` — or run both together with
   `npm run serve`.
5. Workshops happen at `https://live.<your-domain>` — players scan a QR code on
   the host's screen to join.

### Customize

This build is branded **PRIMETIME**. To rebrand for your academy:

- **Wordmark, colors, design tokens** — `app/globals.css`.
- **Page metadata** — `app/layout.tsx` (title, description, OG tags).
- **Sample quiz content** — `prisma/seed.ts`.

Everything else (game logic, scoring, real-time wiring, host/display/player
surfaces) is generic and shouldn't need touching.

---

## License

MIT — fork it, modify it, ship it at your academy. See [LICENSE](./LICENSE).
