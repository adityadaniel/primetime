# AGENTS.md — PRIMETIME development guide

PRIMETIME is a real-time live quiz / word-cloud platform with a vintage broadcast-graphics identity. Use this as the quick operational guide before editing this repo; keep it short and actionable, and use the docs below for detail.

## Source of truth

Read in this order:

1. `PRD.md` — product requirements and route semantics.
2. `docs/wordcloud-prd.md` — Word Cloud product scope; `docs/q-and-a-prd.md` — Q&A; `docs/wonderwall-prd.md` — WonderWall (LinkedIn iframe wall).
3. `DESIGN.md` — visual identity, palette, type, motion rules; preserve the PRIMETIME broadcast identity.
4. `DECISIONS.md` — durable architecture/product decisions; append, do not rewrite history.
5. `README.md` — setup, env vars, deployment, and current feature surface.
6. `docs/` — focused notes, reviews, and postmortems.

`CLAUDE.md` points back here. Treat older brief-style content as historical context when it conflicts with the files above.

## Stack

- Next.js 15 App Router, React 19, TypeScript, Tailwind.
- Custom Node server in `server.ts` runs Next.js + Socket.IO on one port.
- Prisma + Postgres for persistence/auth; some live game state remains server-side/in-memory.
- Auth.js v5, Biome, Vitest, Playwright.
- Package manager: npm.

## Dev commands

```bash
npm install
npm run db:up          # Docker Postgres
cp .env.example .env   # set DATABASE_URL + AUTH_SECRET if needed
npm run db:migrate
npm run dev            # Next.js + Socket.IO at http://localhost:4321
```

Quality gates before PR:

```bash
npm run lint
npm test
npm run build
```

Use `npm run smoke` when touching Socket.IO/gameplay flows. Use `npm run test:e2e` when touching auth, signup/signin, saved quizzes, or browser lifecycle flows. For UI-visible work, use `npm run qa` or Playwright/Chrome DevTools to inspect the actual rendered pages.

Husky installs a pre-commit hook via `npm install`; it runs `npm run lint` and `npx tsc --noEmit`. Use `git commit --no-verify` only for emergency skips.

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
- `/host/wonderwall/new`
- `/host/wonderwall/[pin]/control`

Public room surfaces are reachable by PIN and must not require a host cookie:

- `/host/[pin]/display`
- `/host/wordcloud/[pin]/display`
- `/host/wonderwall/[pin]/display`
- `/join`
- `/play/[pin]`
- `/play/[pin]/wordcloud`
- `/play/[pin]/wonderwall`

Host-only API routes that share a public route family must enforce auth +
ownership at the route level, not via a blanket matcher. WonderWall's
`GET /api/wonderwall/[pin]/export` is host-only (it returns the full
moderation/audit CSV), while its siblings `GET /api/wonderwall/[pin]`,
`POST .../posts`, and `GET .../my-posts` stay public-by-PIN — so do **not** add
`/api/wonderwall/:path*` to the Auth.js middleware.

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

## Development and safety rules

1. Protect the broadcast aesthetic: no generic SaaS UI, no Kahoot purple-gradient clone, no stock-illustration filler.
2. Answer options must remain distinguishable by shape, not color alone.
3. Projection views must be readable across a room; player views need large one-handed mobile tap targets.
4. Keep host, display, and player state server-authoritative. Do not trust client-only timers/scoring.
5. Socket.IO changes must cover reconnects, host disconnect grace, room membership, and HMR/dev-server edge cases.
6. Prefer small, focused changes. Update the relevant doc when product behavior, env vars, routes, or run steps change.
7. Preserve existing uncommitted work. Check `git status` before editing and do not reset/overwrite unrelated files.
8. Never commit secrets, tokens, real `.env*`, database dumps, or local upload artifacts.
9. Do not edit AASA bundle IDs/bytes under `landing-techcanteen/.well-known/` unless explicitly asked.
10. Preserve the known-good state with a branch instead of destructive git resets.
11. Keep PRs focused: one bug/feature/doc finding per branch unless the user asks otherwise.

## Verification expectation

Before handing off, run the narrowest meaningful checks for your change and report exact results. For production-affecting code, the default gate is:

```bash
npm run lint && npm test && npm run build
```

Docs-only edits can use a lighter check, but still inspect the diff.

## Quick route map

- `/` landing
- `/host` quiz builder
- `/host/[pin]/control` host console
- `/host/[pin]/display` projection feed
- `/join` player entry
- `/play/[pin]` player game
- Word Cloud routes live under `/host/wordcloud/...`
- Q&A routes:
  - `/host/q-and-a/new` — create session
  - `/host/q-and-a/[pin]/control` — host control room
  - `/host/q-and-a/[pin]/display` — public projection / present mode
  - `/host/q-and-a/[pin]/questions.csv` — CSV export (host-only)
  - `/play/[pin]/q-and-a` — participant view
- WonderWall routes (moderated LinkedIn iframe wall — see `docs/wonderwall-prd.md`):
  - `/host/wonderwall/new` — create wall
  - `/host/wonderwall/[pin]/control` — review queue (approve/reject/hide/restore/reorder, CSV export)
  - `/host/wonderwall/[pin]/display` — public waterfall projection; renders only `APPROVED` + `canDisplay=true` posts
  - `/play/[pin]/wonderwall` — participant submission view
  - `GET /api/wonderwall/[pin]/export` — submissions CSV export (host-only)
  - Display invariant: a participant URL becomes `PENDING` on submit and is never projected until a host approves it (`canDisplay=true`).
