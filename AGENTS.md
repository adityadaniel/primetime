# PRIMETIME Agent Guide

PRIMETIME is a real-time live quiz / word-cloud platform with a vintage broadcast-graphics identity. Keep this file short and actionable; use the docs below for detail.

## Source of truth

- Product scope: `PRD.md`, plus `docs/wordcloud-prd.md` for Word Cloud.
- Visual system: `DESIGN.md` — preserve the PRIMETIME broadcast identity.
- Architecture and naming decisions: `DECISIONS.md`.
- End-user setup / feature status: `README.md`.
- Claude-specific entrypoint: `CLAUDE.md` points back here.

## Stack

- Next.js 15 App Router, React 19, TypeScript, Tailwind.
- Custom Node server in `server.ts` runs Next.js + Socket.IO on one port.
- Prisma + Postgres for persistence/auth; some live game state remains server-side/in-memory.
- Auth.js v5, Biome, Vitest, Playwright.
- Package manager: npm.

## Commands

```bash
npm install
npm run db:up          # Docker Postgres
cp .env.example .env   # set DATABASE_URL + AUTH_SECRET if needed
npm run db:migrate
npm run dev            # app + Socket.IO at http://localhost:4321
```

Useful checks:

```bash
npm run lint
npm test
npm run build
npm run smoke
npm run test:e2e
```

For UI-visible work, use `npm run qa` or Playwright/Chrome DevTools to inspect the actual rendered pages.

## Development rules

1. Protect the broadcast aesthetic: no generic SaaS UI, no Kahoot purple-gradient clone, no stock-illustration filler.
2. Answer options must remain distinguishable by shape, not color alone.
3. Projection views must be readable across a room; player views need large one-handed mobile tap targets.
4. Keep host, display, and player state server-authoritative. Do not trust client-only timers/scoring.
5. Socket.IO changes must cover reconnects, host disconnect grace, room membership, and HMR/dev-server edge cases.
6. Prefer small, focused changes. Update the relevant doc when product behavior, env vars, routes, or run steps change.
7. Preserve existing uncommitted work. Check `git status` before editing and do not reset/overwrite unrelated files.

## Verification expectation

Before handing off, run the narrowest meaningful checks for your change and report exact results. For production-affecting code, the default gate is:

```bash
npm run lint && npm test && npm run build
```

Add `npm run smoke` / Playwright when realtime flows or visible UI changed. Docs-only edits can use a lighter check, but still inspect the diff.

## Quick route map

- `/` landing
- `/host` quiz builder
- `/host/[pin]/control` host console
- `/host/[pin]/display` projection feed
- `/join` player entry
- `/play/[pin]` player game
- Word Cloud routes live under `/host/wordcloud/...`
