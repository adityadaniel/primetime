# Plan 009: Add a pre-commit hook that runs lint + typecheck locally

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the linked Linear issue status;
> Linear is the authoritative status source.
>
> **Drift check (run first)**: `git diff --stat 4de99e7..HEAD -- package.json`
> If `package.json` changed since this plan was written, re-read its `scripts`
> block before proceeding.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `4de99e7`, 2026-07-05
- **Linear issue**: [MID-434](https://linear.app/midnight-labs/issue/MID-434/improve-009-add-pre-commit-lint-and-typecheck-hook)

## Why this matters

Lint, typecheck, and test gates exist only in CI (`.github/workflows/pr.yml`).
Nothing runs before `git commit`, so a lint or type error is discovered only
after a push and a 5–10 minute CI round-trip. A lightweight pre-commit hook that
runs the fast checks (Biome lint + `tsc --noEmit`) catches these locally in
seconds. The hook must be **fast** (so it isn't bypassed) and **skippable**
(`--no-verify`) for emergencies. The repo uses npm and Biome; this plan wires the
hook via Husky, the standard npm approach.

## Current state

- `.git/hooks/` contains only `*.sample` files — no active hooks.
- `package.json` scripts (relevant ones):

```json
    "dev": "tsx server.ts",
    "build": "prisma generate && next build",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "test": "TZ=UTC vitest run",
```

- Linter/formatter: Biome `2.4.15` (config in `biome.json`). `npm run lint`
  runs `biome check .`.
- No `husky`, `lint-staged`, or `simple-git-hooks` present (confirmed: no such
  keys in `package.json`, no `prepare` script).
- Package manager: npm (there is a `package-lock.json`).

## Commands you will need

| Purpose          | Command                     | Expected on success        |
|------------------|-----------------------------|----------------------------|
| Install husky    | `npm install --save-dev husky` | adds husky to devDeps   |
| Init husky       | `npx husky init`            | creates `.husky/` + `prepare` script |
| Lint             | `npm run lint`              | exit 0                     |
| Typecheck        | `npx tsc --noEmit`          | exit 0                     |
| Test the hook    | see Step 3                  | commit blocked on lint error |

## Scope

**In scope** (create + modify):
- `package.json` (adds `husky` devDep + a `prepare` script — `npx husky init`
  does this)
- `package-lock.json` (updated by install)
- `.husky/pre-commit` (create)

**Out of scope** (do NOT touch):
- `.github/workflows/pr.yml` — CI stays as the authoritative gate; the hook is a
  fast local pre-filter, not a replacement.
- `biome.json` / lint rules — do not change what lint checks, only when it runs.
- Do NOT put the **test suite** in the pre-commit hook — it's too slow for every
  commit and would push people to `--no-verify`. Lint + typecheck only. (Tests
  stay in CI.)

## Git workflow

- Branch: `advisor/009-add-precommit-hooks`
- Commit style: conventional commits, e.g. `chore(dx): add husky pre-commit lint+typecheck`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Install and initialize Husky

```bash
npm install --save-dev husky
npx husky init
```

`npx husky init` creates `.husky/pre-commit` (with a default `npm test`) and adds
a `"prepare": "husky"` script to `package.json` so hooks install on `npm
install` for everyone.

**Verify**: `.husky/pre-commit` exists; `package.json` contains `"prepare": "husky"`
and `husky` under `devDependencies`.

### Step 2: Set the hook to the fast checks

Replace the contents of `.husky/pre-commit` with lint + typecheck only:

```sh
npm run lint
npx tsc --noEmit
```

(No `npm test` — see "Out of scope".) Keep it minimal; Husky v9+ does not need a
shebang/sourcing preamble.

**Verify**: `cat .husky/pre-commit` shows exactly the two commands. `npm run lint`
and `npx tsc --noEmit` both exit 0 on the current tree.

### Step 3: Prove the hook actually blocks a bad commit

Create a temporary lint error, attempt a commit, confirm it is rejected, then
remove the error:

```bash
printf 'const x=1;const x=2;\n' > .husky/_tmp_lint_check.ts
git add .husky/_tmp_lint_check.ts
git commit -m "test: should be blocked by pre-commit" ; echo "exit=$?"
# Expect: the commit FAILS (non-zero exit) because biome/tsc reports the error.
git restore --staged .husky/_tmp_lint_check.ts
rm .husky/_tmp_lint_check.ts
```

**Verify**: the `git commit` above exits non-zero and prints a lint/type error
(the commit was blocked). Then confirm a clean commit works:
`git commit --allow-empty -m "chore: verify hook allows clean commit"` → succeeds
(exit 0). Delete that empty commit afterward if you don't want it
(`git reset --soft HEAD~1`).

### Step 4: Document the hook

Add two lines to `AGENTS.md` under the "Dev commands" / "Quality gates" area
noting that a Husky pre-commit hook runs `npm run lint` + `tsc --noEmit`, and
that `git commit --no-verify` skips it for emergencies. Keep it terse and match
the file's existing bullet style.

**Verify**: `grep -c "no-verify" AGENTS.md` returns ≥1.

## Test plan

- No automated test (this is tooling). The verification is the Step 3
  block-a-bad-commit demonstration.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.husky/pre-commit` exists and contains `npm run lint` and `npx tsc --noEmit`
- [ ] `package.json` has `"prepare": "husky"` and `husky` in devDependencies
- [ ] a commit containing a lint/type error is rejected (Step 3 demonstrated)
- [ ] a clean commit succeeds
- [ ] `AGENTS.md` mentions the hook and `--no-verify`
- [ ] `git status --porcelain` (after cleanup) shows only `package.json`, `package-lock.json`, `.husky/pre-commit`, `AGENTS.md`
- [ ] Linear issue [MID-434](https://linear.app/midnight-labs/issue/MID-434/improve-009-add-pre-commit-lint-and-typecheck-hook) moved to `Done`

## STOP conditions

Stop and report back (do not improvise) if:

- `npm run lint` or `npx tsc --noEmit` does NOT exit 0 on the current clean tree
  **before** you add the hook — that means there are pre-existing violations; a
  pre-commit hook would block all commits. Report the violations rather than
  installing a hook that blocks everyone. (Fixing them is a separate task.)
- The team already uses a different hook manager you discover mid-task — adapt to
  it and report, don't stack a second one.
- `npx husky init` overwrites an existing `test`/`prepare` script destructively —
  reconcile by hand and report.

## Maintenance notes

- Keep the hook fast. If it grows slow, developers will `--no-verify` habitually
  and it becomes worthless. Lint + typecheck is the right scope; leave tests in CI.
- If the repo later adopts `lint-staged`, the hook can be narrowed to changed
  files for even faster commits — but that's an optional follow-up, not required.
- A reviewer should confirm the hook does not run the full test suite (that was a
  deliberate exclusion).
