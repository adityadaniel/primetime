# AGENTS.md — PRIMETIME development guide

Use this as the quick operational guide before editing this repo.

## Source of truth

Read in this order:

1. `PRD.md` — product requirements and route semantics.
2. `DESIGN.md` — visual identity, palette, type, motion rules.
3. `DECISIONS.md` — durable architecture/product decisions; append, do not rewrite history.
4. `README.md` — setup, env vars, deployment, and current feature surface.
5. `docs/` — focused notes, reviews, and postmortems.

`CLAUDE.md` is an old M1 build brief. Treat it as historical context only when it conflicts with the files above.

## Dev commands

```bash
npm install
npm run db:up
cp .env.example .env
npm run db:migrate
npm run dev        # Next.js + Socket.IO on http://localhost:4321
```

Quality gates before PR:

```bash
npm run lint
npm test
npm run build
```

Use `npm run smoke` when touching Socket.IO/gameplay flows. Use `npm run test:e2e` when touching auth, signup/signin, saved quizzes, or browser lifecycle flows.

## Architecture map

- App Router pages live under `app/`.
- Socket.IO server and room lifecycle live in `server.ts`.
- Shared game/session types live in `lib/types.ts`.
- Quiz game state lives in `lib/game.ts`; word cloud state/layout lives in `lib/wordcloud-*`.
- Auth.js config is split:
  - `auth.config.ts` is edge-safe and used by middleware.
  - `auth.ts` imports providers/adapters and is server-only.
- Prisma schema/migrations live under `prisma/`.

## Route privacy model

Protected host surfaces require a host session:

- `/host`
- `/host/quiz/new`
- `/host/[pin]/control`
- `/host/wordcloud/new`
- `/host/wordcloud/[pin]/control`

Public room surfaces are reachable by PIN and must not require a host cookie:

- `/host/[pin]/display`
- `/host/wordcloud/[pin]/display`
- `/join`
- `/play/[pin]`
- `/play/[pin]/wordcloud`

See `docs/live-origin-auth.md` before changing public URL generation, Auth.js middleware, projection windows, QR codes, or join links.

## Public URL rule

Anything that leaves the current browser context must use the reachable public origin when configured:

- QR join links
- projection links
- `GO LIVE` windows
- invite/share links

Use `publicUrl(path, fallbackOrigin)` from `lib/public-origin.ts`; do not hand-roll `window.location.origin + path` for these flows.

Tunnel mode uses:

```bash
NEXT_PUBLIC_SITE_URL=https://live.theprimetime.id
```

Restart `npm run dev` after changing client-exposed env vars.

## Safety rules

- Never commit secrets, tokens, real `.env*`, database dumps, or local upload artifacts.
- Do not edit AASA bundle IDs/bytes under `landing-techcanteen/.well-known/` unless explicitly asked.
- Preserve the known-good state with a branch instead of destructive git resets.
- Keep PRs focused: one bug/feature/doc finding per branch unless the user asks otherwise.
- For UI changes, preserve the vintage broadcast identity in `DESIGN.md`: no generic SaaS look, no purple gradient, projection text must be readable from the back of a room.
