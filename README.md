[![PR](https://github.com/adityadaniel/primetime/actions/workflows/pr.yml/badge.svg)](https://github.com/adityadaniel/primetime/actions/workflows/pr.yml)
[![Main](https://github.com/adityadaniel/primetime/actions/workflows/main.yml/badge.svg)](https://github.com/adityadaniel/primetime/actions/workflows/main.yml)

# PRIMETIME — Live quiz game (open-source)

> **OSS build uses sane defaults — no SaaS keys required.** Clone, install, and run with zero configuration beyond a database URL. See [Quickstart (local)](#quickstart-local) and [Environment reference](#environment-reference) below.

A real-time quiz game with a vintage broadcast-graphics aesthetic. Built end-to-end as the **M1 — Core Loop** and **M2 — Resilience & Scale** milestones described in `PRD.md` and `CLAUDE.md`.

> See **`DESIGN.md`** for the visual identity, palette, type stack, and motion principles.
>
> M3 issues tracked in <https://linear.app/midnight-labs/project/kahoot-clone-broadcast-4a50abefef00>.

---

## Quickstart (local)

**No SaaS accounts needed.** The defaults are password auth, no email, local uploads, and no billing.

### 1. Prerequisites

- Node.js 24+
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

Single command boots Next.js + the WebSocket server on the **same port**: <http://localhost:4321>.

> Port 3000 is intentionally avoided. To override: `PORT=4000 npm run dev`

### 7. Play

1. Open <http://localhost:4321> → click **Host**
2. Build a quiz → click **GO LIVE** → note the 6-digit PIN
3. Open <http://localhost:4321/join> → enter PIN + nickname
4. Play!

---

## Quickstart (Docker — self-host)

For production self-hosting, run the app + database in Docker:

```bash
# Build the app image
docker build -t primetime .

# Run with docker-compose (app + Postgres)
docker compose up -d
```

The app is available at `http://localhost:4321`. Expose via [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) or your reverse proxy of choice.

---

## Environment reference

All flags default to the OSS path. **Unset = OSS default.** You only need to set these when you want SaaS behavior.

| Env var | Values | Default | Owning ticket | Notes |
|---|---|---|---|---|
| `AUTH_MODE` | `password` · `password+oauth` | `password` | MID-213 | `password` = local email/password only. `password+oauth` enables Apple (gated by `ENABLE_APPLE_SIGNIN`). |
| `EMAIL_PROVIDER` | `none` · `token-print` · `smtp` · `resend` | `none` | MID-215 | `token-print` logs reset URLs to server console (dev). `smtp` requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`. `resend` requires `RESEND_API_KEY`. |
| `UPLOAD_PROVIDER` | `local` · `s3` · `uploadthing` | `local` | MID-217 | `local` = on-disk at `public/uploads/`. `s3` (incl. R2/MinIO) requires `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. `uploadthing` requires `UPLOADTHING_TOKEN`. |
| `BILLING_ENABLED` | `true` · `false` | `false` | MID-214 | OSS ships with no billing/upgrade flow. |
| `PLAYER_CAP` | integer ≥ 1 | `10` | MID-216 | Max players per game. |
| `UPLOAD_MAX_BYTES` | bytes (integer) | `5242880` (5 MB) | MID-217 | Max file upload size in bytes. |
| `UPLOAD_DIR` | absolute path | `<cwd>/public/uploads` | MID-217 | Upload directory on disk. |
| `AUTH_SECRET` | any non-empty string | — | MID-213 | **Required.** JWT session secret. Generate: `openssl rand -hex 32`. |
| `DATABASE_URL` | postgres connection URI | — | — | **Required.** |
| `ENABLE_APPLE_SIGNIN` | `true` · `false` | `false` | MID-213 | Only effective when `AUTH_MODE=password+oauth`. Requires `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`. |
| `NEXTAUTH_URL` | URL | `http://localhost:4321` | MID-213 | Your app's public URL. |
| `NEXT_PUBLIC_SITE_URL` | URL | — | — | Public origin used by client-side QR, projection, and share links. Set to `https://live.theprimetime.id` for Cloudflare Tunnel live mode. |

> **Self-hosting OSS?** Only `DATABASE_URL` and `AUTH_SECRET` are required. Leave everything else at defaults — password auth, no email, local uploads, no billing.
>
> **Tunnel/live-origin note:** when hosting locally but projecting through a public tunnel, host auth cookies stay on `localhost`; public projection/display routes must stay public-by-PIN. See [`docs/live-origin-auth.md`](docs/live-origin-auth.md) before changing QR/projection URL generation or Auth.js middleware.

---

## Auth modes

| Mode | What it does | Config |
|---|---|---|
| **Password-only** (default) | Email/password signup and login. No third-party OAuth. | `AUTH_MODE=password` |
| **Password + OAuth** | Password auth plus third-party providers (Apple). | `AUTH_MODE=password+oauth` + `ENABLE_APPLE_SIGNIN=true` + Apple credential vars |

See [MID-213](https://linear.app/midnight-labs/issue/MID-213) for implementation details.

---

## Email modes

| Mode | What it does | Config |
|---|---|---|
| **None** (default) | No email. Forgot-password link is hidden. | `EMAIL_PROVIDER=none` |
| **Token print** | Logs reset URL to server console instead of sending. Dev-only — shows a warning in production. | `EMAIL_PROVIDER=token-print` |
| **SMTP** | Sends real emails via an SMTP server (e.g. Mailpit, SES, Postmark). | `EMAIL_PROVIDER=smtp` + `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` |
| **Resend** | Sends via the Resend API. | `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` |

See [MID-215](https://linear.app/midnight-labs/issue/MID-215) for implementation details.

---

## Upload modes

| Mode | What it does | Config |
|---|---|---|
| **Local** (default) | Writes files to `public/uploads/` on disk. Served by Next.js static file serving. | `UPLOAD_PROVIDER=local` |
| **S3-compatible** | Uploads to any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, etc.). | `UPLOAD_PROVIDER=s3` + S3 credential vars |
| **UploadThing** | Uploads via the UploadThing SaaS. | `UPLOAD_PROVIDER=uploadthing` + `UPLOADTHING_TOKEN` |

See [MID-217](https://linear.app/midnight-labs/issue/MID-217) for implementation details.

---

## Live demo flow

Open three browser windows on the same machine (or use Chrome profiles):

1. **Host / Builder** — <http://localhost:4321/host> · build a quiz, click **GO LIVE**.
   - This auto-opens the projection display in a new tab and routes you to the control panel.
2. **Projection display** (auto-opened) — <http://localhost:4321/host/[PIN]/display> · drag this to a second monitor or fullscreen it on the projector.
3. **Players** — <http://localhost:4321/join> · enter the 6-digit PIN + a nickname. Repeat in another window for a second player.

In the **control panel** (`/host/[PIN]/control`) the host clicks the right-rail button to advance:
`ROLL TAPE → LOCK ANSWERS → SHOW LEADERBOARD → NEXT QUESTION → … → FADE OUT`

The timer auto-locks when it hits zero, and locks early once every connected player has answered.

---

## Surfaces

| Route | Who | Purpose |
|------|-----|---------|
| `/` | Anyone | Studio master · landing |
| `/host` | Host | Quiz builder (anonymous, in-memory) |
| `/host/[pin]/control` | Host | Director's console — PIN, players, timer, distribution, advance controls |
| `/host/[pin]/display` | Audience | On-air feed (fullscreen on projector) — PIN, question, shapes-only, podium |
| `/join` | Player | PIN + nickname |
| `/play/[pin]` | Player | Lobby → answer → reveal → final |

---

## What's done (M1 + M2)

- Next.js 15 App Router + TypeScript + Tailwind, single `npm run dev`
- Custom Node server in `server.ts` colocates Next + Socket.IO on one port
- Anonymous quiz builder (multiple choice + true/false, 10/20/30/60/90/120 s, double points)
- 6-digit PIN game session, in-memory state in `lib/game.ts`
- Server-authoritative scoring: `1000 × (½ + ½ × t_left/t_limit) × {1|2}`
- Lobby → question → reveal → leaderboard → final state machine
- Real-time WS: host, display, and player views all kept in sync
- Auto-lock at timer expiry **or** when all connected players have answered
- Live answer distribution + correct-answer reveal
- Top-3 podium between questions, full leaderboard at the end
- Player feedback: locked-in confirmation, correct/incorrect, points awarded, current rank
- Distinct **PRIMETIME** visual identity executed across all five surfaces
- **Player reconnect grace window** — disconnected players have 30 s to rejoin and reclaim their score, nickname, and socket binding
- **Host disconnect grace pause** — game pauses for 60 s on host drop; resumes seamlessly if the host returns, otherwise ends with `host-left`
- **Player cap enforcement** — a single, env-driven cap (`PLAYER_CAP`, default 10). The host lobby shows current/max; a join past the cap is rejected with the `full` code and the player sees a "room is full" message. No tiers, no upgrade prompts.
- **CSV export of session results** — `GET /host/[pin]/results.csv` once the game is in `final`; includes rank, nickname, score, correct count, total questions, average response time
- **Light profanity filter** for nicknames — rejects with `nickname-rejected` code so the join page can show a friendly retry
- Smoke test extended to cover reconnect, host pause, cap enforcement, CSV export, and profanity rejection: `npm run smoke`
- Word Cloud activity (alternative to quiz): host posts a prompt, players submit words, real-time projection cloud with CSV export
- **OSS configuration surface** — password auth, email, uploads, billing, player cap all configurable via env vars. Defaults require zero SaaS accounts.
- **Local file upload** — `POST /api/upload` for on-disk file uploads (quiz covers, etc.) with size and MIME validation
- **Password reset** — optional SMTP or token-print reset flow for OSS self-hosters

---

## What's stubbed / deferred (M3)

- **Postgres + Prisma persistence** — quizzes and session history still live in process memory
- **Auth.js v5 + Google OAuth** — anonymous host only
- **Quiz library** — no saved quizzes per host yet
- **Stripe billing + Pro tier upgrade** — tier flag exists in `createGame`, billing flow does not
- **Session history & analytics** — results vanish at process exit
- **Redis pub/sub for multi-node** — single-node only; would need the Socket.IO Redis adapter to scale horizontally
- **Image uploads in questions** — text-only questions for now (upload endpoint exists but isn't wired into the question builder yet)
- **Browser tested:** Chrome on macOS. Should work in modern Safari/Firefox but not exhaustively verified.

---

## Project layout

```
app/
  page.tsx                       landing
  host/page.tsx                  builder
  host/[pin]/control/page.tsx    director's console
  host/[pin]/display/page.tsx    on-air feed
  join/page.tsx                  player entry
  play/[pin]/page.tsx            player live view
  api/upload/route.ts            local file upload endpoint
components/
  Broadcast.tsx                  chyron, frame counter, on-air, smpte bars, clock
  Countdown.tsx                  ring countdown
  Shape.tsx                      4 answer shapes (triangle / diamond / circle / square)
lib/
  config.ts                      OSS ⇄ SaaS config surface (env flags)
  game.ts                        in-memory game state + scoring
  socket.ts                      browser socket singleton hook
  types.ts                       shared types
  upload.ts                      local file upload module
  mailer.ts                      email transport (SMTP / token-print)
  reset.ts                       password reset email wrapper
server.ts                        Next.js + Socket.IO on one port
scripts/
  smoke.ts                       Socket.IO realtime smoke test
  e2e-db-reset.ts                create + migrate the primetime_e2e database
tests/e2e/
  auth.spec.ts                   signup / signin / reset / first-run / duplicate
  quiz-lifecycle.spec.ts         quiz CRUD, socket game, upload, word-cloud CSV
  helpers/                       db reset/seed, auth flows, socket client
  e2e-env.ts                     shared E2E env (DB URL derivation, server env)
playwright.config.ts             E2E runner config (boots the server)
DESIGN.md                        visual identity rationale
```

---

## Scripts

```bash
npm run dev      # start everything on http://localhost:4321
npm run qa       # vanilla Next dev on :4322 for /dev/fixtures (no socket, no DB)
npm run build    # next build
npm run start    # production-ish start (still tsx-driven)
npm run smoke    # end-to-end ws smoke test (server must be running)
npm test         # vitest (lib/* unit tests + fixture × surface snapshots)
npm run test:e2e # Playwright browser E2E (auth + quiz lifecycle); boots its own server
npm run test:e2e:ui   # same, in Playwright's interactive UI
npm run db:up    # start Postgres via Docker Compose
npm run db:down  # stop Postgres
npm run db:reset # nuke and rebuild DB
npm run db:migrate  # apply Prisma migrations
npm run db:e2e:reset # create + migrate the dedicated primetime_e2e database
npm run db:studio   # browse data at localhost:5555
```

---

## Testing

Three layers, each with a distinct job:

| Layer | Command | Covers |
| --- | --- | --- |
| Unit | `npm test` / `npm run test:coverage` | `lib/*` logic, scoring, config parsing, fixture × surface snapshots |
| Smoke | `npm run smoke` | Socket.IO realtime: full game loop, reconnect/pause, cap, CSV, profanity, word cloud (server must already be running) |
| E2E | `npm run test:e2e` | Browser-level auth (signup → signin → reset) + quiz/game/upload lifecycle via Playwright |

### End-to-end (Playwright)

The E2E suite (`tests/e2e/`) drives a real Chromium browser through the OSS
auth flows and the authenticated quiz lifecycle. It is self-contained — you
only need Postgres running:

```bash
npm run db:up        # Postgres (if not already up)
npm run test:e2e     # installs nothing; boots the app itself
```

What it does for you:

- **Dedicated database.** Tests run against `primetime_e2e` (derived from your
  `DATABASE_URL`, same Postgres server), created + migrated by
  `npm run db:e2e:reset`. Your dev DB is never touched. Tables are truncated
  between tests, so order never matters.
- **Boots the server.** Playwright's `webServer` runs `db:e2e:reset` then
  `npm run dev`, pinning a known OSS profile via env (`EMAIL_PROVIDER=token-print`,
  `UPLOAD_PROVIDER=local`, `PLAYER_CAP=3`, session persistence on). Locally it
  reuses an already-running server on `:4321`; in CI it always boots a fresh one.
- **No SaaS, no real email.** Password-reset links are captured from the
  `devUrl` the reset endpoint returns in non-production mode — no SMTP, no log
  scraping.

First run only, install the browser:

```bash
npx playwright install chromium
```

Coverage:

- `tests/e2e/auth.spec.ts` — signup, sign out + sign back in, forgot/reset
  (UI + dev-token capture), first-run admin banner, duplicate signup rejected
- `tests/e2e/quiz-lifecycle.spec.ts` — create quiz + see it in the library, run
  a full game over Socket.IO and assert a finished `GameSession` row, player-cap
  rejection, local image upload, word-cloud CSV export

The HTML report lands in `playwright-report/` (open with
`npx playwright show-report`).

---

## Dev fixtures

For visual QA without standing up a real game, every presentational surface
(`display`, `control`, `player`) accepts plain `PublicGameState` props and is
catalogued under `lib/dev-fixtures/`.

```bash
npm run qa
# open http://localhost:4322/dev/fixtures
```

The browser has a sidebar of edge-case scenarios (lobby cap, long stems,
truncating answers, ties, host-left endings, paused-over-reveal, etc.) and a
`Display | Control | Player` segmented control to switch surfaces. Selection
is persisted in the URL (`?id=…&surface=…`) so refresh stays put.

### Bare mode (recommended for visual QA)

Append `&bare=1` to any fixtures URL to hide the sidebar, tab bar, notes
ribbon, and wrapping card. The surface renders edge-to-edge at full viewport
so what you see matches the real `/host/[pin]/display`,
`/host/[pin]/control`, and `/play/[pin]` routes — no harness distortion.

```
http://localhost:4322/dev/fixtures?id=question-long-stem&surface=display&bare=1
```

This is the mode QA agents should use when checking layout, font clamps,
or anything `vw`-based — the regular harness wraps the surface in chrome
that eats viewport height and skews `clamp()` math.

A small `← exit bare` pill in the bottom-right returns you to the regular
harness with the same fixture and surface preselected.

The route returns `notFound()` in production, so it ships only in dev builds.

The same fixture catalog drives Vitest snapshot tests
(`app/dev/fixtures/fixtures.test.tsx`) — run `npm test` and any unintended
visual change shows up as a snapshot diff.

---

## Database setup

Local Postgres 16 required.

### Docker Compose (recommended)

```bash
npm run db:up
```

Uses the same image, credentials, and database name as CI. See `docker-compose.yml`.

### Postgres.app (one-click on macOS)

1. Download from <https://postgresapp.com> (already installed if `/Applications/Postgres.app` exists).
2. Open the app, click "Initialize" on first run.
3. Add to your shell: `export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"`
4. Create role + dev database: `createuser primetime && createdb -O primetime primetime_dev`

### Homebrew

```bash
brew install postgresql@16
brew services start postgresql@16
createuser primetime && createdb -O primetime primetime_dev
```

### After install

Set `DATABASE_URL` in `.env` (copy from `.env.example`), then:

```bash
npm run db:migrate    # creates schema + applies migrations
npm run db:reset      # nuke and rebuild (no seed yet)
npm run db:studio     # browse data at localhost:5555
```

---

## Self-hosting (for other academies)

This is the internal tool we use to run live in-room workshop activities at our academy. It's not a SaaS and there's no hosted version — but the install path is open, and the repo is set up so any other academy can clone it, point it at their own domain, and run their own instance.

### What you need

- A machine (Mac mini, MacBook, or Linux server) with Node.js 24+
- A domain you control, with DNS managed by Cloudflare (free tier is fine)
- About 30 minutes for first-time setup

### Steps

1. Clone the repo on your server.
2. Run `bash scripts/setup.sh`. The script installs prerequisites, sets up the database, walks you through provisioning a Cloudflare Tunnel for your domain, and optionally seeds a sample quiz.
3. Start the app: `npm run dev` (or `npm run start` for production).
4. In a separate terminal, start the tunnel: `cloudflared tunnel run <your-tunnel-name>`.
5. Workshops happen at `https://live.<your-domain>` — players scan a QR code on the host's screen to join.

### Customize

This fork is branded **PRIMETIME**. You'll want to swap that out for your own academy's identity. The things to change:

- **Wordmark, colors, design tokens** — `app/globals.css`. Pick your own name, palette, and type stack.
- **Page metadata** — `app/layout.tsx` (title, description, OG tags).
- **Sample quiz content** — `prisma/seed.ts`.

Everything else (game logic, scoring, real-time wiring, host/display/player surfaces) is generic and shouldn't need touching.

---

## License

MIT — fork it, modify it, ship it at your academy. See [LICENSE](./LICENSE).
