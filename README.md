[![PR](https://github.com/adityadaniel/inputoutput/actions/workflows/pr.yml/badge.svg)](https://github.com/adityadaniel/inputoutput/actions/workflows/pr.yml)
[![Main](https://github.com/adityadaniel/inputoutput/actions/workflows/main.yml/badge.svg)](https://github.com/adityadaniel/inputoutput/actions/workflows/main.yml)

# INPUT/OUTPUT — Kahoot-style live quiz (M1 + M2)

A real-time quiz game with a vintage broadcast-graphics aesthetic. Built end-to-end as the **M1 — Core Loop** and **M2 — Resilience & Scale** milestones described in `PRD.md` and `CLAUDE.md`.

> See **`DESIGN.md`** for the visual identity, palette, type stack, and motion principles.
>
> M3 issues tracked in Linear: <https://linear.app/midnight-labs/project/kahoot-clone-broadcast-4a50abefef00>

## Quick start

```bash
npm install
npm run dev
```

Single command boots Next.js + the WebSocket server on the **same port**: <http://localhost:4321>.

> Port 3000 is intentionally avoided because another local dev app on this machine occupies it. To override:
> ```bash
> PORT=4000 npm run dev
> ```

## Live demo flow

Open three browser windows on the same machine (or use Chrome profiles):

1. **Host / Builder** — <http://localhost:4321/host> · build a quiz, click **GO LIVE**.
   - This auto-opens the projection display in a new tab and routes you to the control panel.
2. **Projection display** (auto-opened) — <http://localhost:4321/host/[PIN]/display> · drag this to a second monitor or fullscreen it on the projector.
3. **Players** — <http://localhost:4321/join> · enter the 6-digit PIN + a nickname. Repeat in another window for a second player.

In the **control panel** (`/host/[PIN]/control`) the host clicks the right-rail button to advance:
`ROLL TAPE → LOCK ANSWERS → SHOW LEADERBOARD → NEXT QUESTION → … → FADE OUT`

The timer auto-locks when it hits zero, and locks early once every connected player has answered.

## Surfaces

| Route | Who | Purpose |
|------|-----|---------|
| `/` | Anyone | Studio master · landing |
| `/host` | Host | Quiz builder (anonymous, in-memory) |
| `/host/[pin]/control` | Host | Director's console — PIN, players, timer, distribution, advance controls |
| `/host/[pin]/display` | Audience | On-air feed (fullscreen on projector) — PIN, question, shapes-only, podium |
| `/join` | Player | PIN + nickname |
| `/play/[pin]` | Player | Lobby → answer → reveal → final |

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
- Distinct **INPUT/OUTPUT** visual identity executed across all five surfaces
- **Player reconnect grace window** — disconnected players have 30 s to rejoin and reclaim their score, nickname, and socket binding
- **Host disconnect grace pause** — game pauses for 60 s on host drop; resumes seamlessly if the host returns, otherwise ends with `host-left`
- **Player cap enforcement** — 10-player soft cap on free tier (upsell banner from 8), 150-player hard cap on pro tier
- **CSV export of session results** — `GET /host/[pin]/results.csv` once the game is in `final`; includes rank, nickname, score, correct count, total questions, average response time
- **Light profanity filter** for nicknames — rejects with `nickname-rejected` code so the join page can show a friendly retry
- Smoke test extended to cover reconnect, host pause, cap enforcement, CSV export, and profanity rejection: `npm run smoke`
- Word Cloud activity (alternative to quiz): host posts a prompt, players submit words, real-time projection cloud with CSV export

## What's stubbed / deferred (M3)

- **Postgres + Prisma persistence** — quizzes and session history still live in process memory
- **Auth.js v5 + Google OAuth** — anonymous host only
- **Quiz library** — no saved quizzes per host yet
- **Stripe billing + Pro tier upgrade** — tier flag exists in `createGame`, billing flow does not
- **Session history & analytics** — results vanish at process exit
- **Redis pub/sub for multi-node** — single-node only; would need the Socket.IO Redis adapter to scale horizontally
- **Image uploads in questions** — text-only questions for now
- **Playwright E2E** — coverage today is the headless smoke test
- **Browser tested:** Chrome on macOS. Should work in modern Safari/Firefox but not exhaustively verified.

## Project layout

```
app/
  page.tsx                       landing
  host/page.tsx                  builder
  host/[pin]/control/page.tsx    director's console
  host/[pin]/display/page.tsx    on-air feed
  join/page.tsx                  player entry
  play/[pin]/page.tsx            player live view
components/
  Broadcast.tsx                  chyron, frame counter, on-air, smpte bars, clock
  Countdown.tsx                  ring countdown
  Shape.tsx                      4 answer shapes (triangle / diamond / circle / square)
lib/
  game.ts                        in-memory game state + scoring
  socket.ts                      browser socket singleton hook
  types.ts                       shared types
server.ts                        Next.js + Socket.IO on one port
DESIGN.md                        visual identity rationale
```

## Scripts

```bash
npm run dev      # start everything on http://localhost:4321
npm run qa       # vanilla Next dev on :4322 for /dev/fixtures (no socket, no DB)
npm run build    # next build
npm start        # production-ish start (still tsx-driven)
npm run smoke    # end-to-end ws smoke test (server must be running)
npm test         # vitest (lib/* unit tests + fixture × surface snapshots)
```

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
that eats viewport width and height and skews `clamp()` math.

A small `← exit bare` pill in the bottom-right returns you to the regular
harness with the same fixture and surface preselected.

The route returns `notFound()` in production, so it ships only in dev builds.

The same fixture catalog drives Vitest snapshot tests
(`app/dev/fixtures/fixtures.test.tsx`) — run `npm test` and any unintended
visual change shows up as a snapshot diff.


## Database setup

Local Postgres 16 required.

### Recommended: Postgres.app (one-click on macOS)
1. Download from <https://postgresapp.com> (already installed if `/Applications/Postgres.app` exists).
2. Open the app, click "Initialize" on first run.
3. Add to your shell: `export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"`
4. Create role + dev database: `createuser inputoutput && createdb -O inputoutput inputoutput_dev`

### Docker Compose

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: inputoutput
      POSTGRES_PASSWORD: inputoutput
      POSTGRES_DB: inputoutput_dev
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes: { pgdata: {} }
```

Then `docker compose up -d`.

### Homebrew

```bash
brew install postgresql@16
brew services start postgresql@16
createuser inputoutput && createdb -O inputoutput inputoutput_dev
```

### After install

Set `DATABASE_URL` in `.env` (copy from `.env.example`), then:

```bash
npm run db:migrate    # creates schema + applies migrations
npm run db:reset      # nuke and rebuild (no seed yet)
npm run db:studio     # browse data at localhost:5555
```

## For other academies

This is the internal tool we use to run live in-room workshop activities at our academy. It's not a SaaS and there's no hosted version — but the install path is open, and the repo is set up so any other academy can clone it, point it at their own domain, and run their own instance.

### What you need

- A Mac (mini, Studio, or any modern MacBook) with at least 8 GB RAM — this is the machine that hosts the app during workshops
- A domain you control, with DNS managed by Cloudflare (free tier is fine)
- About 30 minutes for first-time setup

### Steps

1. Clone the repo on the Mac you want as the server.
2. Run `bash scripts/setup.sh`. The script installs prerequisites (Node, Postgres), sets up the database, walks you through provisioning a Cloudflare Tunnel for your domain, and optionally seeds a sample quiz.
3. Start the app: `npm run start`.
4. In a separate terminal, start the tunnel: `cloudflared tunnel run <your-tunnel-name>`.
5. Workshops happen at `https://live.<your-domain>` — players scan a QR code on the host's screen to join. The host machine stays in the room; players hit it through the tunnel from their phones.

### Customize

This fork is branded **INPUT/OUTPUT**. You'll want to swap that out for your own academy's identity. The things to change:

- **Wordmark, colors, design tokens** — `landing/` and `app/globals.css`. Pick your own name, palette, and type stack.
- **Page metadata** — `app/layout.tsx` (title, description, OG tags).
- **Sample quiz content** — `prisma/seed.ts` (lands with MID-140; safe to edit once it exists).

Everything else (game logic, scoring, real-time wiring, host/display/player surfaces) is generic and shouldn't need touching.

### License

MIT — fork it, modify it, ship it at your academy. See [LICENSE](./LICENSE).

## License

MIT. See [LICENSE](./LICENSE).
