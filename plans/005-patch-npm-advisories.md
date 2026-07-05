# Plan 005: Clear the production-reachable npm security advisories

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the linked Linear issue status;
> Linear is the authoritative status source.
>
> **Drift check (run first)**: `git diff --stat 4de99e7..HEAD -- package.json package-lock.json`
> If either changed since this plan was written, re-run `npm audit` and compare
> against the "Current state" advisory list before proceeding.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: MED
- **Depends on**: none
- **Category**: security / dependencies
- **Planned at**: commit `4de99e7`, 2026-07-05
- **Linear issue**: [MID-430](https://linear.app/midnight-labs/issue/MID-430/improve-005-clear-production-reachable-npm-advisories)

## Why this matters

`npm audit --omit=dev` reports 2 high and 8 moderate advisories in the
**runtime** dependency tree — not just dev tooling. The high-severity ones sit on
hot paths: `ws` (the WebSocket engine under Socket.IO, which is the core of this
real-time app) and `nodemailer` (auth emails). Leaving these unpatched means the
live socket layer and the password-reset path run on libraries with known CVEs.
Most are resolvable by moving transitive deps to patched versions without any
API change; the goal of this plan is to clear the reachable-runtime advisories
and add a CI gate so new high-severity ones fail the build instead of
accumulating silently.

## Current state

- Run `npm audit --omit=dev` to see the current runtime advisories. At planning
  time the reachable-runtime set was:
  - **high** `ws` — via `engine.io` / `socket.io` (`server.ts` real-time layer)
  - **high** `nodemailer` — via `@auth/core` → `next-auth` (auth email)
  - **moderate** `postcss` — via `next`
  - plus moderate advisories on `@auth/core`, `engine.io(-client)`,
    `socket.io-adapter`, `next-auth` (all resolving through the two highs above).
- These are **transitive** — they are not direct entries in `package.json`
  `dependencies`. `package.json` pins direct deps like `"next"`, `"next-auth"`,
  `"socket.io"`, `"nodemailer"` (a devDependency here — confirm which).
- CI (`.github/workflows/pr.yml`) runs typecheck + lint + coverage + smoke +
  e2e, but has **no `npm audit` gate**, so advisories accrue unnoticed.
- The socket smoke test (`npm run smoke`) exercises the real-time path and is the
  key regression check after a `ws`/`engine.io` bump. NOTE: `npm run smoke`
  requires a dev server started with env loaded — see "Commands you will need".

## Commands you will need

| Purpose            | Command                                    | Expected on success            |
|--------------------|--------------------------------------------|--------------------------------|
| See runtime audit  | `npm audit --omit=dev`                     | prints advisory list           |
| Auto-fix (safe)    | `npm audit fix`                            | updates lockfile, no `--force` |
| Typecheck          | `npx tsc --noEmit`                         | exit 0                         |
| Lint               | `npm run lint`                             | exit 0                         |
| Unit tests         | `npm test`                                 | all pass                       |
| Build              | `npm run build`                            | exit 0                         |
| Socket smoke       | start dev server (below), then `npm run smoke` | smoke passes               |

Starting the dev server for smoke (it does NOT read `.env` on its own — load it):
```bash
set -a; . ./.env 2>/dev/null; set +a
npm run dev &   # wait until http://localhost:4321 responds, then:
npm run smoke
```
If `.env` is absent, set at minimum `DATABASE_URL`, `AUTH_SECRET`,
`NEXT_PUBLIC_SITE_URL=http://localhost:4321` (mirror `.github/workflows/pr.yml`).

## Scope

**In scope**:
- `package.json` (only if a direct-dep bump is required)
- `package-lock.json` (updated by `npm audit fix` / `npm install`)
- `.github/workflows/pr.yml` (add the audit gate in Step 3)

**Out of scope**:
- Application source — no code changes are expected. If clearing an advisory
  requires a code change (a breaking major bump), STOP and report; do not
  refactor app code under this plan.
- Dev-only advisories (esbuild/vite/tsx on Windows) — out of scope; this plan
  targets runtime-reachable advisories. You may note them but do not chase them.

## Git workflow

- Branch: `advisor/005-patch-npm-advisories`
- Commit style: conventional commits, e.g. `chore(deps): patch ws/nodemailer advisories`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Apply safe auto-fixes

Run `npm audit fix` (NOT `--force`). This upgrades transitive deps to patched
versions within the existing semver ranges.

**Verify**: `npm audit --omit=dev` → the high-severity `ws` and `nodemailer`
advisories are gone (or reduced). Record the before/after counts. If `npm audit
fix` cannot resolve a high advisory without `--force`, do NOT run `--force`;
note which advisory is stuck and continue — Step 4 documents the residual.

### Step 2: Verify nothing regressed

Run the full gate. The `ws`/`engine.io` bump is the one to watch — the socket
smoke test is the regression signal.

**Verify**:
- `npx tsc --noEmit` → exit 0
- `npm test` → all pass
- `npm run build` → exit 0
- socket smoke (per "Commands you will need") → passes

### Step 3: Add a CI audit gate

In `.github/workflows/pr.yml`, add a step in the `check` job (after `npm ci`,
before or alongside the other checks) that fails on high/critical **runtime**
advisories:

```yaml
      - name: Security audit (runtime, high+)
        run: npm audit --omit=dev --audit-level=high
```

This keeps dev-only advisories from blocking PRs while gating on
reachable-runtime highs. Match the existing YAML indentation and step style in
the file.

**Verify**: `npm audit --omit=dev --audit-level=high` locally → exit 0 (after
Step 1). If it still exits non-zero because of a residual high that `npm audit
fix` could not clear without `--force`, do NOT add the gate yet — go to Step 4.

### Step 4: Document any residual

If a high advisory remains that only `--force` (a breaking major) would fix,
create a short note in `plans/README.md` under "Dependency notes" naming the
package, the advisory, and the blocking major bump — and set this plan's status
to `BLOCKED (residual: <pkg>)` rather than DONE. Otherwise skip this step.

## Test plan

- No new unit tests. The regression surface is exercised by the existing full
  gate + socket smoke; that is the verification.

## Done criteria

Machine-checkable. ALL must hold (unless Step 4 residual applies):

- [ ] `npm audit --omit=dev --audit-level=high` exits 0
- [ ] `npm test` exits 0
- [ ] `npm run build` exits 0
- [ ] socket smoke passes
- [ ] `.github/workflows/pr.yml` contains an `npm audit --omit=dev --audit-level=high` step
- [ ] `git status --porcelain` shows only `package.json`, `package-lock.json`, `.github/workflows/pr.yml`
- [ ] Linear issue [MID-430](https://linear.app/midnight-labs/issue/MID-430/improve-005-clear-production-reachable-npm-advisories) moved to `Done`

## STOP conditions

Stop and report back (do not improvise) if:

- Clearing a high advisory requires `npm audit fix --force` or a major-version
  bump of a direct dependency (`next`, `next-auth`, `socket.io`) — those carry
  breaking-change risk and deserve their own scoped plan.
- The socket smoke test fails after a `ws`/`engine.io` bump — that is a real
  runtime regression; report it rather than papering over it.
- `npm run build` or `npm test` fails after the fix.

## Maintenance notes

- With the CI gate in place, future high advisories fail PRs — that is intended.
  If a false-positive/dev-only advisory ever trips it, refine the audit command
  (e.g. document an allow-list) rather than deleting the gate.
- Re-audit after any `next` / `next-auth` / `socket.io` major upgrade; those pull
  the largest transitive trees.
