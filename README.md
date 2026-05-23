[![PR](https://github.com/adityadaniel/broadcast/actions/workflows/pr.yml/badge.svg)](https://github.com/adityadaniel/broadcast/actions/workflows/pr.yml)
[![Main](https://github.com/adityadaniel/broadcast/actions/workflows/main.yml/badge.svg)](https://github.com/adityadaniel/broadcast/actions/workflows/main.yml)

# BROADCAST — Kahoot-style live quiz (M1 + M2)

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
- Distinct **BROADCAST** visual identity executed across all five surfaces
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
npm run build    # next build
npm start        # production-ish start (still tsx-driven)
npm run smoke    # end-to-end ws smoke test (server must be running)
```

## Database setup

Local Postgres 16 required.

### Recommended: Postgres.app (one-click on macOS)
1. Download from <https://postgresapp.com> (already installed if `/Applications/Postgres.app` exists).
2. Open the app, click "Initialize" on first run.
3. Add to your shell: `export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"`
4. Create the dev database: `createdb broadcast_dev`

### Docker Compose

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: broadcast_dev
      POSTGRES_HOST_AUTH_METHOD: trust
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes: { pgdata: {} }
```

Then `docker compose up -d`.

### Homebrew

```bash
brew install postgresql@16
brew services start postgresql@16
createdb broadcast_dev
```

### After install

Set `DATABASE_URL` in `.env` (copy from `.env.example`), then:

```bash
npm run db:migrate    # creates schema + applies migrations
npm run db:reset      # nuke and rebuild (no seed yet)
npm run db:studio     # browse data at localhost:5555
```
