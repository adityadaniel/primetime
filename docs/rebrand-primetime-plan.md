# Rebrand Plan — INPUT/OUTPUT → PRIMETIME (theprimetime.id)

**Status:** Approved plan, revised after Claude Code review
**Author:** orchestrator (hermes)
**Baseline:** `main` @ `18da972` (clean, MID-81 / #46 merged when first drafted)
**Review artifact:** `docs/rebrand-primetime-claude-review.md`
**Precedent:** This is the *second* rebrand of this codebase. The first
(BROADCAST → INPUT/OUTPUT, DECISIONS.md 2026-05-24, MID-124→132) is the
template. Reuse its 4-phase shape and its "what does NOT change" discipline.

---

## 1. The locked names

| Token | Old | New |
|---|---|---|
| Product wordmark | `INPUT/OUTPUT` | `PRIMETIME` |
| Product/landing wordmark text | `INPUT/OUTPUT` | `primetime` / `PRIMETIME` only — **never** `THE PRIMETIME` |
| Short form | `I/O` | none; use `PRIMETIME` or a neutral non-brand label |
| Code identifier | `inputoutput` | `primetime` |
| Local host-style identifier | `inputoutput.local` | `primetime.local` |
| Domain | `inputoutput.id` | `theprimetime.id` |
| Uppercase domain display | `INPUTOUTPUT.ID` | `THEPRIMETIME.ID` (domain display only, not product wordmark) |
| GitHub repo | `adityadaniel/inputoutput` | `adityadaniel/primetime` |
| Working tree | `~/Developer/inputoutput` | `~/Developer/primetime` |
| Postgres user/db/password | `inputoutput` / `inputoutput_dev` / `inputoutput_e2e` / password `inputoutput` | `primetime` / `primetime_dev` / `primetime_e2e` / password `primetime` |
| Quiz schema URL | `https://inputoutput.id/quiz-v1.json` | `https://theprimetime.id/quiz-v1.json` |
| Subdomains | `live.inputoutput.id`, `techcanteen.inputoutput.id`, `www.inputoutput.id` | `live.theprimetime.id`, `techcanteen.theprimetime.id`, `www.theprimetime.id` |
| Support email | `support@inputoutput.id` | `support@theprimetime.id` |
| Cloudflared tunnel | `inputoutput-live` | `primetime-live` |
| Linear project | "INPUT/OUTPUT (inputoutput.id)" | "PRIMETIME (theprimetime.id)" |

> ⚠️ **Domain is `theprimetime.id`, NOT `primetime.id`.** The code identifier
> and product wordmark stay the short `primetime` / `PRIMETIME` (repo, package,
> db, dirs, UI, landing hero). Only URLs, hosts, emails, schema URLs, and domain
> display strings use the full `theprimetime.id`. Do not let these drift.

### Scope of occurrences (approximate; do not use as the completion gate)
Claude Code review found the original counts were stale/undercounted. Treat
counts as orientation only. The completion gate is the cleaned grep in §6.
Known high-density files include `README.md`, `.github/workflows/{pr,main}.yml`,
`landing/index.html`, `landing/og.html`, `docker-compose.yml`, `docs/m3-setup.md`,
`app/layout.tsx`, `scripts/setup.sh`, and `landing-techcanteen/README.md`.

---

## 2. The one real subtlety — the slash is load-bearing, PRIMETIME has no metaphor

The last rebrand was *additive*: "INPUT/OUTPUT" **reinforced** the existing
vintage-broadcast visual identity (control panel = input port, projection =
output, players = signal). The slash is part of the wordmark **and** the spine
of `DESIGN.md`'s opening two paragraphs.

PRIMETIME has no slash and no I/O signal-flow metaphor. But it is **not** a
worse fit — it's arguably a better one: a real-time quiz already has "the bones
of a TV game show" (DESIGN.md line 3), and *prime time* is literally the
flagship broadcast slot. So:

- **Visual identity does NOT change** — vintage broadcast graphics, CRT,
  scanlines, SMPTE/ON-AIR motifs, the palette (bone/ink/vermilion/marigold/
  cobalt/ivy), condensed display numerals, monospace tickers. All verbatim.
- **The metaphor copy DOES change** — wherever the prose leans on "input port /
  output feed / signal flowing through" (DESIGN.md ¶2, the `I/O` log line in
  `server.ts`, any chyron text reading "INPUT/OUTPUT / NETWORK MASTER"), rewrite
  to the prime-time-slot framing: the show that goes out live in the marquee
  slot, the control room cutting the prime-time broadcast, the audience tuning
  in. **One new bridging paragraph in DESIGN.md** (Phase 3a) does this; it is the
  only substantive prose authored in the whole rebrand. Everything else is a
  token flip.
- **`I/O` short form retires.** Replace standalone `I/O` brand uses (e.g.
  `server.ts` `▶ I/O ready on…`, chyron short labels) with `PRIMETIME` or a
  neutral phrase. Do **not** touch `I/O` where it means *input/output* generically
  (e.g. `lib/config.ts` "Pure; no I/O." comment, `quiz-io.ts` filename — that's
  the io = serialization module, unrelated to the brand).

> **Acceptance guard:** after the rebrand, remaining old-name hits should be
> limited to historical docs (`DECISIONS.md`) and rebrand planning/review docs,
> never active app/code/config/landing/runtime surfaces.

---

## 3. What deliberately does NOT change (carried from the 2026-05-24 entry)

- **Visual identity / design language.** See §2.
- **Database schema, Prisma migrations, route shapes, in-app URL paths,
  WebSocket protocol, scoring rules, tier limits.** Only DB user/db/password,
  connection strings, container/volume names, and display copy change.
- **Frozen `playtest/*` branches.** The academy runs live games off
  `playtest/with-sound` and siblings. They stay on the INPUT/OUTPUT name
  forever. The rebrand lands on `main` only and merges forward to NEW feature
  branches off main. No rename mid-event.
- **Historical review docs / postmortems** under `docs/reviews/`. Snapshots of
  old work; stay readable as-is. Extend any historical note if useful; do not
  rewrite history.
- **The `quiz-v1.json` schema *shape*.** Only the `$schema` URL host flips
  (`inputoutput.id` → `theprimetime.id`); the schema version stays `v1` and the
  contract is unchanged. Old exported quizzes with the old `$schema` URL must
  still import — verify the loader doesn't hard-pin the host (it shouldn't;
  check `lib/quiz-io.ts`).
- **AASA file content.** `landing-techcanteen/.well-known/apple-app-site-association`
  contains Apple Team/bundle IDs for Tech Canteen and **does not name the host**.
  Do **not** edit the AASA file bytes or bundle IDs during this rebrand. Only the
  host serving the file moves during Phase 4 DNS/Pages (`techcanteen.inputoutput.id`
  → `techcanteen.theprimetime.id`).
- **Tech Canteen product identity.** Tech Canteen remains its own product/landing.
  Only references that attribute it to INPUT/OUTPUT or old domains should change.
  Do not force the PRIMETIME hero treatment onto the Tech Canteen hero unless the
  current file actually uses the INPUT/OUTPUT wordmark in that hero.
- **The "delegate all code to Claude Code / Codex" rule.** Orchestrator handles
  planning, Linear metadata, GitHub repo rename, DNS, Hermes routing/memory.
  Everything under `app/`, `lib/`, `server.ts`, `scripts/`, `prisma/`, `.github/`,
  `docker-compose.yml`, `package.json`, `package-lock.json`, `DESIGN.md`,
  `README.md`, `docs/`, `landing/`, `landing-techcanteen/` ships through the
  coding agent.

---

## 4. Sequencing — 4 phases

Mirrors the proven 2026-05-24 shape. Phases 1–3 are git/code work on a single
branch `rebrand/primetime` off `main`. Phase 4 is infra/ecosystem, runs only
after the branch merges, and runs OUTSIDE any academy event window.

### Phase 1 — Decision record
1. Promote this plan to a dated `DECISIONS.md` entry
   ("## 2026-06-04 · Rebrand INPUT/OUTPUT → PRIMETIME (theprimetime.id)"),
   latest-first, keeping the 2026-05-24 entry intact below it.
2. Pin the §1 name table as the single source of truth every downstream task
   cites.

### Phase 2 — Code & infra rename (single branch, three reviewable passes)
All on branch `rebrand/primetime`. Do the rename by identifier class, not a
single blind case-insensitive replacement:

- **2a — Code identifier pass.** Broad-search active source with
  `inputoutput|input/output|inputoutput.id`, classify every hit by context, then
  update code-id uses: `inputoutput` → `primetime`; `inputoutput.local` →
  `primetime.local`; CSV filename prefix `inputoutput-${pin}` →
  `primetime-${pin}`; package/docker/container/volume/db/user/password strings;
  CI `DATABASE_URL` and Postgres service credentials; `scripts/setup.sh`
  healthcheck/tunnel fallback/example host as appropriate. Preserve generic
  `I/O` and the `lib/quiz-io.ts` filename.
- **2b — Tests + CI.** Vitest/Playwright references, the `inputoutput_e2e`
  derived DB name in `lib/config.ts` `deriveE2eDatabaseUrl` default + asserting
  tests (`seo-routes.test.ts`, `session-persistence.integration.ts`, etc.),
  `.github/workflows/*` badges, db names, passwords, connection strings.
  Handle the stale `broadcast_dev` relic in `lib/config.ts` deliberately; do not
  rewrite history accidentally.
- **2c — Infra/config/lockfile.** `docker-compose.yml` (`POSTGRES_USER/DB/PASSWORD`,
  container names, volume name, healthcheck), `package.json` `name` + `db:psql`,
  `package-lock.json` regenerated via `npm install`, `.env.example` templates,
  README setup/badges/clone/docker/Postgres blocks, `docs/m3-setup.md` (R2 bucket,
  Redis, Vercel import name, token name), quiz schema `$schema` host in
  `samples/*.json` + `lib/quiz-io.ts`.

  > DB rename forces `docker compose down -v` on every dev box (data is
  > throwaway; `npm run db:reset` documents the wipe). Call it out in the PR body.

### Phase 3 — Brand & copy (same branch, after Phase 2)
- **3a — DESIGN.md.** Rename title and author the **one** new bridging paragraph
  (§2) that swaps the I/O signal-flow narrative for the prime-time-broadcast-slot
  narrative while keeping every palette/visual paragraph verbatim. This is the
  only real writing in the rebrand.

  > **Landing wordmark treatment (locked):** product wordmark is **primetime**
  > only; the domain alone is `theprimetime.id`. On the main landing page, render
  > the wordmark as a **two-line stacked** mark: `PRIME` on line 1, `TIME` on
  > line 2. Use `PRIME` in `--vermilion #E5341F` (red-orange) and `TIME` in
  > `--ink`. Keep the existing condensed display typeface (Big Shoulders Display)
  > and tracking. Implement with explicit two-line markup (e.g. two block spans),
  > remove/dead-code the old slash styling if no longer used, set tight leading
  > (`line-height` around 0.85–0.9), and align the two lines intentionally so the
  > mark reads as one word. Do **not** render `THE PRIMETIME` anywhere as a
  > product/landing wordmark. In-app chyrons/footers stay single-line uppercase
  > `PRIMETIME`.

- **3b — User-facing copy + landings.** `app/layout.tsx`, `app/page.tsx`,
  `app/pricing/page.tsx`, `app/terms/page.tsx`, `app/privacy/page.tsx`,
  `app/signin/SignInClient.tsx`, `app/signup/SignUpClient.tsx`, `app/reset/**`,
  `app/host/wordcloud/[pin]/display/page.tsx` (wordmark and `inputoutput.local`),
  `lib/mailer.ts`, `scripts/generate-sounds.ts`, `scripts/sounds-manifest.ts`,
  `docs/sound-generation.md`, `landing/` (index.html, styles.css, README,
  og.html, regenerate `og.png`), `landing-techcanteen/` (only old domain/source
  references and attribution copy; **do not edit AASA content**), and docs.

  > `landing/og.png` is binary and will not be caught by grep. Update
  > `landing/og.html`, regenerate `landing/og.png`, and verify the 1200×630 social
  > card still renders correctly.

### Phase 4 — Infra & ecosystem (orchestrator, sequential, AFTER merge, off-hours)
- **4a — GitHub + local.** Rename repo `adityadaniel/inputoutput` →
  `adityadaniel/primetime` (GH redirect kept). Update remote
  (`git remote set-url origin git@github.com:adityadaniel/primetime.git`).
  Move working tree `~/Developer/inputoutput` → `~/Developer/primetime`.
  Update local untracked `.env.local` values (`NEXTAUTH_URL`, `NEXT_PUBLIC_SITE_URL`,
  any `live.inputoutput.id` values) manually. Re-run `npm run db:reset` to
  recreate the `primetime_dev` DB locally.
- **4b — DNS / deploy / Cloudflare.** On the `theprimetime.id` zone: apex →
  apex landing Pages project; `www` → apex redirect; `live` CNAME for the
  cloudflared tunnel (rename tunnel config `inputoutput-live` →
  `primetime-live`, `~/.cloudflared/config.yml` hostname); `techcanteen` CNAME →
  techcanteen Pages project. Point both Cloudflare Pages projects at the new
  custom domains. Verify deploy URL before/after the GH rename. Re-fetch AASA
  from its new host (`swcutil dl -d techcanteen.theprimetime.id`) — Apple caches
  up to 24h. **Do not edit AASA file content.**
- **4c — Linear + Hermes + memory.** Rename Linear project to
  "PRIMETIME (theprimetime.id)". Update `hermes-routing-daniel` SKILL.md
  (`~/.hermes/skills/productivity/hermes-routing-daniel/SKILL.md`) topic-tag
  `inputoutput` → `primetime` (Telegram topic ID unchanged). Update hermes
  memory entry (the INPUT/OUTPUT block) to PRIMETIME / theprimetime.id. Sweep
  any cron jobs referencing the old name/path.

---

## 5. Risks accepted

- Dev DB rename wipes local volumes (throwaway — fine).
- GH repo rename creates a redirect Pages/tunnel integrations may transiently
  mishandle. Run 4a off-hours; verify deploy URLs around the rename.
- Frozen `playtest/*` branches keep the old name forever (correct — no pushes,
  no CI). A hotfix on a playtest branch lands as-is without rename.
- Some `I/O` and `io` occurrences are *generic input/output*, not brand (config
  comment, `quiz-io.ts` module). Phase 2 acceptance MUST preserve those —
  flip only brand uses (§2).
- The three identifiers have different targets: product/code `primetime`, domain
  `theprimetime.id`, local hostname `primetime.local`. Automated replacements
  must classify by context.
- Two domains in flight (`theprimetime.id` live, `inputoutput.id` legacy). Keep
  `inputoutput.id` resolving with a 301 → `theprimetime.id` until analytics/links
  age out; decide retirement separately (new open question, not this plan).

---

## 6. Definition of done

1. `rebrand/primetime` merges to `main`; CI green.
2. Clean artifacts, then run the old-name gate:
   ```bash
   rm -rf .next coverage playwright-report test-results tsconfig.tsbuildinfo
   grep -rIi "inputoutput\|input/output" \
     --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next \
     --exclude-dir=coverage --exclude-dir=playwright-report --exclude-dir=test-results \
     --exclude=tsconfig.tsbuildinfo .
   ```
   Expected residue: `DECISIONS.md` history and rebrand planning/review docs only;
   no active app/code/config/landing/runtime files.
3. Domain gate returns no active old-domain hits:
   ```bash
   grep -rIi "inputoutput\.id\|INPUTOUTPUT\.ID\|inputoutput\.local" \
     --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next \
     --exclude-dir=coverage --exclude-dir=playwright-report --exclude-dir=test-results \
     --exclude=tsconfig.tsbuildinfo .
   ```
4. Generic I/O preserved: `grep -n "Pure; no I/O" lib/config.ts` still matches;
   `lib/quiz-io.ts` filename still exists.
5. `package.json` and `package-lock.json` both use `primetime`; lockfile has zero
   `inputoutput` hits.
6. `npm install && npm run lint && npm run db:reset && npm run dev` boots clean
   on the `primetime_dev` DB; a full host+2-player game plays end-to-end.
7. `npm test` and `npm run test:e2e` pass against `primetime_e2e`.
8. Landing pages, legal pages, emails, OG tags read PRIMETIME / `theprimetime.id`;
   the main landing hero renders two-line `PRIME`/`TIME` with `PRIME` red-orange;
   screenshot verification shows no clipping/overlap; `landing/og.png` regenerated.
9. AASA validates from `techcanteen.theprimetime.id` after Phase 4 DNS, with AASA
   file content unchanged.
10. Repo, local dir, DNS, tunnel, Linear, Hermes routing/memory all on the new
    name after Phase 4.
11. DESIGN.md visual identity unchanged; the single new bridging paragraph reads
    coherently and palette/aesthetic prose is preserved.

---

## 7. Open questions (defer to their tickets, not this plan)

- Retirement timeline for the legacy `inputoutput.id` domain (301 how long?).
- Transactional email on `theprimetime.id` (MX/SPF/DKIM/DMARC) — deferred to
  product launch unless 4b surfaces a need.
