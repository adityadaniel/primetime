# Kahoot Clone — Build Brief

You are building a real-time multiplayer quiz platform from `PRD.md` in this directory. Read it before starting.

## Scope for THIS run
Deliver a working **M1 — Core Loop** that runs end-to-end on `localhost`:

- Quiz builder (anonymous mode is enough; saved/auth not required this run)
- Single live game session with 6-digit PIN
- Lobby → in-game → final leaderboard flow, fully playable
- Presenter mode: separate `/host/[pin]/control` and `/host/[pin]/display` routes
- Player join page with nickname
- WebSocket real-time updates between host + players + display
- Up to 10 concurrent players (M1 cap)
- Server-side scoring (`base × time_remaining/time_limit × speed_multiplier`)

You do NOT need to build: auth, Pro tier, Redis, quiz persistence, CSV export, mobile apps. Stub or note these clearly.

## Stack
- **Next.js 15+ App Router** with TypeScript and Tailwind CSS
- **Server-side state:** in-memory Map keyed by game PIN (no DB needed for M1)
- **Realtime:** WebSocket via a custom Node server colocated with Next.js, OR Socket.IO. Pick whichever is faster to ship and keeps a single `npm run dev`.
- Single repo, single dev command, single port

## Design direction — THIS IS THE CORE OF THE TASK
The user explicitly asked for **a distinct and unique design**. Do NOT clone Kahoot's purple gradient and chunky cartoon style. Do NOT default to generic shadcn slate-on-white SaaS aesthetics.

Use the `frontend-design` plugin / skill for this build. Pick a coherent visual identity and commit to it. Some directions worth considering (pick ONE and execute fully):

- **Editorial brutalist** — heavy serif display type, off-white paper background, hand-drawn answer shapes, ink-bleed accents, Risograph color palette
- **Arcade CRT** — pixel-perfect monospace, scanline overlay, neon-on-black, 8-bit answer shape sprites, chiptune-feel motion easing
- **Swiss broadcast** — strict grid, oversized numerals as the dominant element, monochrome with a single accent color, teletype-like score ticker, sparse motion
- **Liquid glass / aurora** — translucent layers, animated mesh gradients, frosted cards, color-shifting answer tiles, soft physics on transitions
- **Or something better that you invent.** Justify the choice in `DESIGN.md` (one paragraph), then execute it consistently across builder, host control, projection display, and player views.

Hard constraints regardless of direction:
- The 4 answer shapes (triangle / circle / star / square) MUST remain distinguishable by shape alone (WCAG — color is not the only signal). Reinterpret them in your chosen style, don't drop them.
- Projection view must be readable from the back of a room: huge type, high contrast.
- Player view must be one-handed-phone usable: tap targets ≥ 56px, thumb-reachable.
- Animations should feel intentional, not decorative noise. Every motion serves the game pulse (countdown tension, answer lock-in, reveal moment, podium climb).
- No generic stock illustrations. No emoji as load-bearing UI. No purple-pink gradient.

Write `DESIGN.md` first, then build to match it.

## Dev environment notes
- macOS, dev server on `localhost` only this run (user explicitly said simplify repro before adding Tailscale/LAN — keep it local)
- Permissive CORS / dev origins are fine but not required at this stage
- `npm run dev` should be the single command to start everything
- If Next.js dev port differs from WebSocket port, document it in README

## Definition of done for this run
1. `npm install && npm run dev` boots clean
2. Host can: create a quiz, launch a game, get a PIN, see lobby fill, advance through questions, see distribution + reveal, see final leaderboard
3. Player can: join with PIN + nickname, see lobby, answer timed questions, see correct/incorrect + score after each, see final rank
4. Projection display: shows PIN in lobby, question + shapes (no text) + timer in-game, podium between questions
5. Two browser windows simulating host + 2 players actually plays a complete short game
6. `DESIGN.md` exists and the visual identity is coherent across all four surfaces (builder, control, display, player)
7. `README.md` documents how to run it and what's stubbed vs done

Use the `frontend-design` skill aggressively. Commit incrementally. End with a one-paragraph summary of what was built and what's deferred.
