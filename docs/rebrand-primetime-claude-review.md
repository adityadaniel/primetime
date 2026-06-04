# Code-Aware Review — Rebrand Plan INPUT/OUTPUT → PRIMETIME

**Reviewer:** Claude Code (review only — no code changed)
**Reviewing:** `docs/rebrand-primetime-plan.md`
**Baseline inspected:** working tree on `main`, same as plan baseline
**Verdict:** Plan is **structurally sound and mostly complete** (the 4-phase shape, the visual-identity-stays / metaphor-copy-changes split, and the generic-`I/O` carve-out are all correct). It is **not yet safe to hand to an automated rename** as written: it drives replacement off a *token table* that misses several real textual variants in the tree, its done-check `grep` is under-scoped, one infra instruction (AASA) is factually wrong, and the locked landing wordmark instruction is under-specified for implementation. Fix the blockers below and it is ready.

---

## 1. Executive summary

The plan correctly separates the three identifiers (wordmark `PRIMETIME`, code id `primetime`, domain `theprimetime.id`) and correctly insists the domain keeps the `the-` prefix while code stays short. The "what does NOT change" discipline carried from the first rebrand is the strongest part: visual identity verbatim, schema/routes/protocol untouched, frozen `playtest/*` left alone, generic `I/O` preserved.

What needs work before implementation:

- **The replacement key is wrong.** Phase 2 says "flip `inputoutput` → `primetime`" but the tree contains brand text the §1 token list does not name: `INPUTOUTPUT.ID` (no slash, all-caps, in `landing/og.html`), `inputoutput.local` (wordcloud host default), the CSV filename prefix, the Postgres **password** `inputoutput`, and `inputoutput@localhost` connection strings. A literal find/replace on the listed tokens will leave residue.
- **The done-check `grep` (§6.2) can never pass.** It excludes only `node_modules`/`.git`, so it will always hit `.next/`, `coverage/`, `tsconfig.tsbuildinfo`, and `package-lock.json`.
- **The AASA instruction is factually incorrect.** `landing-techcanteen/.well-known/apple-app-site-association` contains **no** brand token — only Apple bundle IDs (`9H8AZ8D28D.com.adityadaniel.techcanteen…`). Those must **not** change. Only the host that serves the file moves (Phase 4b DNS), and that host isn't written inside the file.
- **Several user-facing files aren't enumerated**, and one rebrand-relevant asset (`landing/og.png`) is a **binary** that no text tool will catch.
- **The two-line PRIME/TIME wordmark is directionally clear but not build-ready** — it omits the markup restructure, the stacked-caps leading/alignment, and the OG raster.

Measured counts also disagree with the plan's §1 numbers (see §6) — the plan **undercounts** the wordmark and domain occurrences, so anyone reconciling "did I get them all?" against the plan's figures will stop short.

---

## 2. Blockers (must resolve before the rename runs)

### B1 — Drive replacement off a pattern, not the token table
The §1 table lists clean tokens, but real occurrences include variants it doesn't cover. Confirmed in-tree:

| Variant | Where | Correct target |
|---|---|---|
| `INPUTOUTPUT.ID` (caps, no slash) | `landing/og.html:184` chyron | `THEPRIMETIME.ID` |
| `inputoutput.local` | `app/host/wordcloud/[pin]/display/page.tsx:175` host default | `primetime.local` (code id, **not** domain) |
| `inputoutput-${pin}-…csv` | `server.ts:855`, `:884` | `primetime-${pin}-…` (plan notes this ✓) |
| `POSTGRES_PASSWORD: inputoutput` | `.github/workflows/*`, `README.md:52`, docker | `primetime` (plan names user/db, **not** password) |
| `inputoutput:inputoutput@localhost…/inputoutput_dev` | CI `DATABASE_URL`, README | full string flip |
| `▶ INPUT/OUTPUT ◀` ticker | signin/signup/reset (see B3) | `▶ PRIMETIME ◀` |

**Fix:** instruct the implementer to find with the broad case-insensitive pattern `inputoutput\|input/output\|inputoutput\.id` (which subsumes `INPUTOUTPUT.ID`, `inputoutput.local`, `inputoutput-`, the password, and connection strings), then classify each hit as wordmark / code-id / domain by context. Do **not** treat the §1 table as the search list — treat it as the *target* map.

### B2 — The §6.2 acceptance `grep` is under-scoped and will always fail
`grep -ri "inputoutput\|input/output" --exclude-dir=node_modules --exclude-dir=.git` will return hits in `.next/`, `coverage/`, `tsconfig.tsbuildinfo`, and `package-lock.json` regardless of how clean the source is — so "hits only in `DECISIONS.md`" is unreachable.

**Fix:** before running the check, `rm -rf .next coverage playwright-report test-results tsconfig.tsbuildinfo` (or add them to `--exclude-dir` / `--exclude`), and **regenerate `package-lock.json`** (see B5). Updated check:
```
grep -rIi "inputoutput\|input/output" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next \
  --exclude-dir=coverage --exclude-dir=playwright-report --exclude-dir=test-results \
  --exclude=tsconfig.tsbuildinfo .
```
Expected residue after rebrand: `DECISIONS.md` (history) + the new decision entry + the plan/review docs themselves + frozen `playtest/*` (not on `main`).

### B3 — Enumerate the user-facing files the plan omits
Phase 3b lists `layout/page/pricing/terms/privacy`. The following also carry the in-app wordmark and are **not** named — they will be missed by a literal reading of the file list (text-grep catches them, but the plan should name them so the diff is reviewable):

- `app/signin/SignInClient.tsx:68` — `▶ INPUT/OUTPUT ◀`
- `app/signup/SignUpClient.tsx:111` — `▶ INPUT/OUTPUT ◀`
- `app/reset/page.tsx:53`, `app/reset/[token]/page.tsx:34`, `app/reset/[token]/ResetTokenClient.tsx:73` — `▶ INPUT/OUTPUT ◀`
- `app/host/wordcloud/[pin]/display/page.tsx:364` — `INPUT/OUTPUT` chyron, **and** `:175` `inputoutput.local` host default

Per §3a ("in-app chyrons/footers stay single-line uppercase PRIMETIME"), all the `▶ INPUT/OUTPUT ◀` tickers become `▶ PRIMETIME ◀`. The wordcloud feature is absent from the plan's scope entirely — add it.

### B4 — The AASA instruction is wrong; do not edit bundle IDs
Phase 3b says to change the techcanteen AASA "bundle prefix `com.adityadaniel.techcanteen` and host". The actual file:
```json
{ "applinks": { "details": [ { "appIDs": [
  "9H8AZ8D28D.com.adityadaniel.techcanteen",
  "9H8AZ8D28D.com.adityadaniel.techcanteen.Clip" ] … ] } },
  "appclips": { "apps": ["9H8AZ8D28D.com.adityadaniel.techcanteen.Clip"] } }
```
It contains **no brand token and no host** — AASA is *served at* a host, it doesn't name one. The bundle IDs are the shipped iOS app's real identifiers tied to Team `9H8AZ8D28D`; changing them would break the live App Clip and is out of scope for a web rebrand. **Tech Canteen is a separate product brand**, not "INPUT/OUTPUT". 

**Fix:** strike the AASA *content* edit from Phase 3b. The only AASA-related action is Phase 4b: move the serving host `techcanteen.inputoutput.id` → `techcanteen.theprimetime.id` (DNS + Pages custom domain) and re-fetch (`swcutil dl -d techcanteen.theprimetime.id`). The file bytes do not change. Separately confirm whether Tech Canteen's own landing copy even uses the INPUT/OUTPUT wordmark before applying the PRIME/TIME treatment to it (`landing-techcanteen/index.html` has only 2 hits — likely a footer/source link, not the hero).

### B5 — Regenerate the lockfile; it's not just `package.json`
`package-lock.json` carries the root `name: "inputoutput"` (2 occurrences). Editing `package.json`'s `name` without `npm install` leaves the lockfile inconsistent and keeps a brand token in-tree. Add an explicit "`npm install` to regenerate `package-lock.json`, commit it" step to Phase 2c.

---

## 3. Risks around automated token replacement (generic I/O)

The plan's §2/§5 carve-out is **correct and important** — keep it. Confirmed generic (must **NOT** change):

- `lib/config.ts:202` — `* …Pure; no I/O.` (doc comment, generic I/O)
- `lib/quiz-io.ts` — filename and module = serialization (`io`), unrelated to brand. Only its **content** `$schema: 'https://inputoutput.id/quiz-v1.json'` (`:47`) flips host → `theprimetime.id`. Do not rename the file.
- `server.ts:815` — `▶ I/O ready on…` **is** brand (flip to `▶ PRIMETIME ready on…` or neutral). Distinguish from the two above.

One subtle trap the plan should name explicitly:

- `lib/config.ts:201` comment reads *"across local (`broadcast_dev`) and CI (`inputoutput_dev`)"*. `broadcast_dev` is a **relic of the first rebrand** (BROADCAST → INPUT/OUTPUT) and is already stale. Flip `inputoutput_dev` → `primetime_dev` here, but **leave `broadcast_dev` as-is or fix it to `primetime_dev` deliberately** — an automated pass keyed on `inputoutput` will (correctly) ignore `broadcast_dev`, but a human "tidy the comment" pass might wrongly rewrite history. Call it out.
- `deriveE2eDatabaseUrl(base, dbName = 'inputoutput_e2e')` (`lib/config.ts:204`) default param → `primetime_e2e`, plus its asserting tests `lib/seo-routes.test.ts` (6 hits) and `lib/__tests__/session-persistence.integration.ts`. Plan names these ✓.

Recommendation: do the rename **case-sensitively in three deliberate passes** (code-id lowercase → `primetime`; wordmark `INPUT/OUTPUT`/`INPUTOUTPUT` → `PRIMETIME`/`THEPRIMETIME.ID`; domain `inputoutput.id` → `theprimetime.id`), reviewing each pass's diff, rather than one case-insensitive sweep. The three identifiers have different targets (short vs `the-` prefixed) and must not be flipped by the same rule — see §4.

---

## 4. Does the plan separate wordmark / code-id / domain correctly?

**Yes — this is the plan's strongest correctness property.** §1 table + the `theprimetime.id` ≠ `primetime.id` warning are exactly right, and the in-tree evidence confirms why it matters:

- Code id stays short: `package.json name`, `db:psql` user/db, docker container/volume names, `inputoutput.local`, CSV prefix, `_e2e`/`_dev` db names → `primetime`.
- Domain takes the prefix: every URL/host/email/`$schema`/OG/canonical/AASA-host → `theprimetime.id`.

The one place this *could* drift in practice is the **wordcloud host default** `inputoutput.local` — it looks domain-ish but is a code-id-style local hostname, so it becomes `primetime.local`, **not** `theprimetime.local`. Add it to the table so the implementer doesn't "the-prefix" it by reflex.

---

## 5. Is the two-line PRIME/TIME instruction precise enough?

**No — directionally clear, not build-ready.** The current hero (`landing/index.html:49-50`) is:
```html
<h1 class="display-num wordmark">
  INPUT<span class="slash">/</span>OUTPUT
</h1>
```
The instruction gives color (`--vermilion`, or `--marigold` "if the comp reads better"), typeface (Big Shoulders Display), and "two-line stacked." It omits everything an implementer must decide:

1. **Markup restructure.** The single-line `<span class="slash">` model doesn't express two block lines. Needs e.g. two `display:block` spans (`<span class="line-prime">PRIME</span><span class="line-time">TIME</span>`) so each line can be colored independently. The `.slash` rule becomes dead CSS — say whether to remove it.
2. **Leading / vertical rhythm.** Stacked weight-900 condensed caps need explicitly tightened `line-height` (~0.85–0.9) or the two lines float apart and read as two words, not a wordmark. Unspecified.
3. **Horizontal alignment.** `PRIME` (5 glyphs) and `TIME` (4) won't auto-align in condensed caps. Decide: left-flush (ragged right), or optically matched width. Unspecified.
4. **Color is a *choice*, not "locked."** "vermilion OR marigold if the comp reads better" leaves the accent undetermined — fine for design iteration, but then it isn't "locked (§3a header)". Pick one or make the visual-check the gate.
5. **The OG raster is missed.** `landing/og.png` is a **binary** (referenced at `landing/index.html:16,23` as the social card) generated from `landing/og.html`, whose chyron reads `INPUTOUTPUT.ID` (`:184`) — it does **not** render the hero wordmark at all. The PRIME/TIME hero will **not** appear on shared links unless `og.png` is **regenerated**. No text grep will flag this. Add: update `og.html`, regenerate `og.png`, verify the `og:image` dimensions (1200×630) still hold.
6. **Scope of "landings (plural)."** Confirm `landing-techcanteen/` actually uses this wordmark before applying it there (see B4) — likely it shouldn't.

**Fix:** add a short spec block to Phase 3a: target markup, `line-height`, alignment rule, the single locked accent token, and an explicit "regenerate `og.png`, screenshot-verify the hero" step. Given the repo's own standing guidance (*take a screenshot and inspect it — DOM evals miss overlap/clipping*), make a rendered screenshot of the two-line hero the acceptance gate, not a DOM assertion.

---

## 6. Measured occurrence counts vs the plan's §1 figures

Counts taken on the current tree (excluding `node_modules/.git/.next/coverage/playwright-report/test-results`):

| Metric | Plan §1 | Measured | Note |
|---|---|---|---|
| Files containing `inputoutput`/`input/output` | 42 | 41 (excl. plan/review docs) | ~matches |
| Lowercase `inputoutput` (lines) | 203 | 174 | plan **over**counts (likely counted build artifacts) |
| Wordmark `INPUT/OUTPUT` | 59 | **70** | plan **under**counts by 11 |
| Domain `inputoutput.id` | 40 | **49** | plan **under**counts by 9 |

The wordmark/domain undercounts matter only if someone treats the plan's numbers as a completion target — they'd stop 11/9 short. The §6.2 grep (once fixed per B2) is the real guard, not these numbers; reword §1 to say "approximate, as of baseline — the green grep is the gate."

Highest-density files to review by hand (per-file `inputoutput`/`input/output` counts): `README.md` (22), `DECISIONS.md` (20, history — leave), `.github/workflows/{pr,main}.yml` (18 each), `landing-techcanteen/README.md` (14), `docker-compose.yml` (11), `landing/index.html` (9), `docs/m3-setup.md` (8), `app/layout.tsx` (8), `scripts/setup.sh` (6).

---

## 7. Scope additions (files/areas to add to the plan)

Confirmed present and brand-bearing, beyond what Phases 2–3 enumerate:

- **`app/signin`, `app/signup`, `app/reset` (×3 files)** — in-app `▶ INPUT/OUTPUT ◀` tickers (B3).
- **`app/host/wordcloud/[pin]/display/page.tsx`** — chyron + `inputoutput.local` host (B3); whole wordcloud feature unmentioned.
- **`landing/og.html`** (`INPUTOUTPUT.ID` chyron) **+ `landing/og.png`** (binary regen) **+ `landing/styles.css`** (1 hit) (B5/§5).
- **`landing-techcanteen/styles.css`** (1 hit); verify `index.html`/`README.md` brand usage vs Tech-Canteen-own-brand (B4).
- **`scripts/setup.sh`** — `:213` healthcheck user/db, `:250` tunnel-name fallback `'inputoutput'`, `:253` `live.inputoutput.id` example. Plan says "scripts/" generically — name it.
- **`scripts/generate-sounds.ts`, `scripts/sounds-manifest.ts`, `docs/sound-generation.md`** — 1 hit each.
- **`README.md`** — beyond the Postgres blocks the plan names: CI **badge URLs** (`:1-2`), `git clone …/inputoutput.git` + `cd inputoutput` (`:28-29`), full `DATABASE_URL` (`:52`), `docker build -t inputoutput` (`:89`), and `createuser/createdb inputoutput` (`:399,406`).
- **`.env.local`** (gitignored, machine-local) — `NEXTAUTH_URL`/`NEXT_PUBLIC_SITE_URL` = `https://live.inputoutput.id`. Not in the repo diff; a **dev-box manual step** (flag in Phase 4a, since `.env.local` isn't tracked). `.env` (tracked) is clean.
- **`package-lock.json`** — regenerate (B5).
- **`playwright.config.ts`** (1 hit), **`vitest`/CI db names** — plan names CI ✓; confirm the password too (B1).
- **Build artifacts** `.next/`, `coverage/`, `tsconfig.tsbuildinfo`, `playwright-report/`, `test-results/` — not edited, but must be excluded from the done-check or cleaned (B2).

Confirmed **clean** (no action): `prisma/**` (schema + 6 migrations, zero brand tokens — schema genuinely unchanged, as the plan asserts), `docs/reviews/**` (no tokens; the plan's "leave history" note is moot here but harmless), `auth.ts`/`auth.config.ts`/`middleware.ts`, `.env` (tracked).

---

## 8. Recommended implementation sequence

Keep the plan's 4 phases. Refine Phase 2–3 into reviewable, verifiable passes:

1. **Pass A — code identifier (case-sensitive `inputoutput` → `primetime`).** `server.ts`, `app/**`, `lib/**`, `scripts/**`, `docker-compose.yml`, `package.json`, CI workflows (user/db/**password**/connection strings), `.env.example`, README setup/badge/clone/docker lines, `inputoutput.local` → `primetime.local`, CSV prefix. Exclude generic `I/O`/`io` (§3). Then `npm install` to regen the lockfile.
2. **Pass B — domain (`inputoutput.id` → `theprimetime.id`, incl. `INPUTOUTPUT.ID`).** All URLs/hosts/email/`$schema` (`lib/quiz-io.ts:47`, `samples/*.json`), OG/twitter/canonical in `landing/index.html` + `landing/og.html`, subdomains. Regenerate `og.png`.
3. **Pass C — wordmark (`INPUT/OUTPUT` → `PRIMETIME`).** In-app chyrons/tickers/footers → single-line `PRIMETIME` (incl. signin/signup/reset/wordcloud). Landing hero → the two-line PRIME/TIME spec (§5). `DESIGN.md` title + the one bridging paragraph rewriting the `I/O` signal-flow metaphor (¶2) to the prime-time-slot framing — palette/type/shape prose verbatim.
4. **Phase 4 (orchestrator, post-merge, off-hours)** — as written, **minus the AASA content edit** (B4). Repo rename, remote, working-tree move, `.env.local` manual fix, DNS/Pages/tunnel, AASA host move + re-fetch, Linear/Hermes.

Review each pass as its own commit (the plan's 3-commit grouping ≈ this; just align the grouping to identifier-type, which makes the diff self-checking).

---

## 9. Verification commands

```bash
# 0. Clean artifacts so the done-check is meaningful (B2)
rm -rf .next coverage playwright-report test-results tsconfig.tsbuildinfo

# 1. THE GATE — must return only DECISIONS.md + the rebrand plan/review docs
grep -rIi "inputoutput\|input/output" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next \
  --exclude-dir=coverage --exclude-dir=playwright-report --exclude-dir=test-results \
  --exclude=tsconfig.tsbuildinfo .

# 2. Domain gate — zero hits expected (catches INPUTOUTPUT.ID too)
grep -rIi "inputoutput\.id\|inputoutput\.local" --exclude-dir=node_modules --exclude-dir=.git .

# 3. Generic I/O preserved — these SHOULD still match (must NOT be zero)
grep -n "Pure; no I/O" lib/config.ts
ls lib/quiz-io.ts

# 4. Lockfile consistent with package.json
grep -m1 '"name"' package.json            # → "primetime"
grep -c "inputoutput" package-lock.json   # → 0

# 5. Build / typecheck / tests
npm install
npm run lint
npm run db:reset            # forces docker compose down -v → primetime_dev
npm run dev                 # boots clean; host + 2 players play through
npm test                    # vitest, incl. config/seo-route db-name asserts
npm run test:e2e            # playwright against primetime_e2e

# 6. Visual gate (repo guidance: screenshot, don't DOM-assert)
#    Screenshot landing hero → confirm two-line PRIME (accent) / TIME (ink),
#    tight leading, no clipping. Re-render og.png and confirm 1200×630 social card.
```

---

## 10. Acceptance checklist

- [ ] **B1** Replacement driven off the broad pattern; all variants hit: `INPUTOUTPUT.ID`, `inputoutput.local`, CSV prefix, Postgres **password**, connection strings.
- [ ] **B2** §6.2 grep rewritten with full excludes / artifact clean; gate returns only history + rebrand docs.
- [ ] **B3** signin/signup/reset/wordcloud chyrons flipped to `PRIMETIME`; wordcloud feature in scope.
- [ ] **B4** AASA **bundle IDs unchanged**; AASA file content **not edited**; only its serving host moves in Phase 4b. Tech-Canteen-own-brand vs INPUT/OUTPUT clarified.
- [ ] **B5** `package-lock.json` regenerated; `name` = `primetime`; 0 residual tokens.
- [ ] Generic `I/O` preserved: `lib/config.ts:202`, `lib/quiz-io.ts` filename intact; `broadcast_dev` relic handled deliberately (§3).
- [ ] Three identifiers kept distinct: code `primetime`, domain `theprimetime.id`, `*.local` → `primetime.local` (not `theprimetime.local`).
- [ ] Landing hero spec complete: markup, `line-height`, alignment, single locked accent token, **`og.png` regenerated**, screenshot-verified.
- [ ] `DESIGN.md` — title + one bridging paragraph rewritten; palette/type/shape prose byte-for-byte unchanged.
- [ ] `.env.local` dev-box step flagged in Phase 4a (untracked file).
- [ ] Full pipeline green: `lint`, `db:reset` on `primetime_dev`, `dev` playthrough, `test`, `test:e2e` on `primetime_e2e`.
- [ ] CI workflow db user/db/password/`DATABASE_URL` + README badges/clone URL all flipped.
- [ ] §1 counts reworded as "approximate; the green grep is the gate" (measured: 70 wordmark, 49 domain — higher than plan).
