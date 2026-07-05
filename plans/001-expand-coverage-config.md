# Plan 001: Coverage measurement covers the core game/session libs, not just `lib/game.ts`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the linked Linear issue status;
> Linear is the authoritative status source.
>
> **Drift check (run first)**: `git diff --stat 4de99e7..HEAD -- vitest.config.ts`
> If `vitest.config.ts` changed since this plan was written, compare the
> "Current state" excerpt against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `4de99e7`, 2026-07-05
- **Linear issue**: [MID-426](https://linear.app/midnight-labs/issue/MID-426/improve-001-expand-coverage-measurement-for-core-gamesession-libs)

## Why this matters

`npm run test:coverage` currently measures coverage for exactly one file —
`lib/game.ts`. The other high-churn, high-risk core libraries (`lib/qa.ts` at
940 LOC, `lib/qa-repo.ts`, `lib/wonderwall-repo.ts`) are excluded from the
report, so a green coverage run says nothing about them. This produces false
confidence ("coverage is at 80%") while the most-edited modules are unmeasured.
Expanding the `include` list turns coverage into an honest signal and makes the
gaps visible so later plans (002, 004) land their new tests inside a measured
surface. This is the first plan because it de-risks the others.

## Current state

- `vitest.config.ts` — the single Vitest config. The `coverage` block (lines
  12–22) sets one included file and a global 80% threshold:

```ts
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/game.ts'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    projects: [ /* node + dom projects, unchanged */ ],
  },
```

- The modules to add exist and are substantial: `lib/qa.ts` (940 LOC),
  `lib/qa-repo.ts` (597 LOC), `lib/wonderwall-repo.ts` (740 LOC). Each already
  has a sibling test file (`lib/qa.test.ts`, `lib/qa-repo.test.ts`,
  `lib/wonderwall-repo.test.ts`).
- The 80% threshold is currently satisfied by `lib/game.ts` alone. Adding files
  that are less-covered **will** drop the aggregate below 80% and fail the run.
  That failure is expected and is the point of this plan — you will lower the
  thresholds to the **current measured baseline** so the run passes, then the
  team can ratchet them up later.

## Commands you will need

| Purpose        | Command                     | Expected on success        |
|----------------|-----------------------------|----------------------------|
| Typecheck      | `npx tsc --noEmit`          | exit 0, no errors          |
| Lint           | `npm run lint`              | exit 0                     |
| Coverage run   | `npm run test:coverage`     | exit 0; prints a coverage table |

## Scope

**In scope** (the only file you should modify):
- `vitest.config.ts`

**Out of scope** (do NOT touch):
- Any source file under `lib/` — this plan changes measurement only, not code
  or tests.
- The `projects` array in `vitest.config.ts` — leave the node/dom test
  projects exactly as they are.

## Git workflow

- Branch: `advisor/001-expand-coverage-config`
- Commit style: conventional commits, e.g. `test(coverage): measure qa + repo libs`
  (matches `git log`, e.g. `feat(q-and-a): ...`, `fix(display): ...`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the core libs to the coverage `include` list

In `vitest.config.ts`, change the `include` line to:

```ts
      include: [
        'lib/game.ts',
        'lib/qa.ts',
        'lib/qa-repo.ts',
        'lib/wonderwall-repo.ts',
      ],
```

**Verify**: `npm run test:coverage` → runs to completion and prints a coverage
table listing all four files. It will likely **fail the threshold** at this
point (exit non-zero) — that is expected; continue to Step 2. If it fails for
any reason **other** than coverage thresholds (e.g. a test error, a config
parse error), that is a STOP condition.

### Step 2: Record the observed baseline and set thresholds to it

Read the coverage summary table printed by Step 1. Note the **aggregate**
`% Stmts`, `% Branch`, `% Funcs`, `% Lines` for the "All files" row. Set each
threshold in `vitest.config.ts` to the floor of the corresponding observed
value (round DOWN to the nearest whole number, then subtract 0 — do not pad).
For example, if the run reports Stmts 71.3 / Branch 64.8 / Funcs 68.0 / Lines
71.1, set:

```ts
      thresholds: {
        statements: 71,
        branches: 64,
        functions: 68,
        lines: 71,
      },
```

Add a one-line comment above the `thresholds` block:

```ts
      // Baseline captured 2026-07-05 when qa/repo libs were added to coverage.
      // Ratchet these upward as tests are added; do not lower them.
```

**Verify**: `npm run test:coverage` → exit 0. The coverage table lists all four
files and the run passes at the new thresholds.

## Test plan

No new tests in this plan — it changes measurement configuration only. The
follow-up plans (002, 004) add the tests that will let the thresholds ratchet
up.

- Verification: `npm run test:coverage` → exit 0 with all four files present in
  the report.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "lib/qa.ts\|lib/qa-repo.ts\|lib/wonderwall-repo.ts" vitest.config.ts` returns `3`
- [ ] `npm run test:coverage` exits 0
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run lint` exits 0
- [ ] `git status --porcelain` shows only `vitest.config.ts` modified
- [ ] Linear issue [MID-426](https://linear.app/midnight-labs/issue/MID-426/improve-001-expand-coverage-measurement-for-core-gamesession-libs) moved to `Done`

## STOP conditions

Stop and report back (do not improvise) if:

- The `coverage` block in `vitest.config.ts` does not match the "Current state"
  excerpt (the config drifted since this plan was written).
- `npm run test:coverage` fails for a reason other than coverage thresholds
  (a real test failure, a parse error) — that indicates a pre-existing problem
  this plan should not mask.
- The observed baseline for any metric is below 40% — that is surprising and
  worth a human eyeballing before you pin a threshold that low.

## Maintenance notes

- The thresholds are a **ratchet floor**, not a target. When plans 002 and 004
  add tests, re-run coverage and raise the floors to the new baseline in the
  same PR.
- If a future plan adds a new core lib (e.g. a `lib/wonderwall.ts` state
  machine), add it to `include` too — the point is that the most-edited files
  are always measured.
- A reviewer should confirm the thresholds were set to the *observed* baseline,
  not padded up (which would make the gate fail immediately) or padded down to
  0 (which would make it meaningless).
