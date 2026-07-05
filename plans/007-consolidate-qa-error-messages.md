# Plan 007: Consolidate the duplicated Q&A error-message handlers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the linked Linear issue status;
> Linear is the authoritative status source.
>
> **Drift check (run first)**: `git diff --stat 4de99e7..HEAD -- "app/host/q-and-a/[pin]/control/control-client.tsx"`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `4de99e7`, 2026-07-05
- **Linear issue**: [MID-432](https://linear.app/midnight-labs/issue/MID-432/improve-007-consolidate-qanda-error-message-handlers)

## Why this matters

The Q&A control client defines eight nearly-identical error-message functions
(`attachErrorMessage`, `moderationErrorMessage`, `highlightErrorMessage`,
`editErrorMessage`, `replyErrorMessage`, `labelErrorMessage`,
`controlErrorMessage`, `displaySettingsErrorMessage`). Seven of them are a
`switch` with a few context-specific cases that `default` to
`moderationErrorMessage`. Every new socket error code means editing multiple
handlers, and it's easy for one to drift (handle a code in one context but not
another). Consolidating to a single context-aware function removes ~70 lines of
duplicated switch/case and gives one source of truth, with no behavior change.

## Current state

- `app/host/q-and-a/[pin]/control/control-client.tsx` — lines 82–185 hold the
  eight functions. The shape (abridged; read the file for the full set):

```ts
// :82  attachErrorMessage(error) — cases: forbidden, not_found, session_mismatch; default: generic control-room message
// :95  moderationErrorMessage(error) — cases: invalid_transition, unknown_question, persistence_failed, forbidden; default: generic update message
// :110 highlightErrorMessage(error) — case not_live → message; else moderationErrorMessage(error)
// :116 editErrorMessage(error) — cases: empty_text, text_too_long, invalid_status; default: moderationErrorMessage(error)
// :129 replyErrorMessage(error) — cases: empty_text, text_too_long, invalid_status, unknown_reply, not_host_reply, session_ended; default: moderationErrorMessage(error)
// :148 labelErrorMessage(error) — cases: empty_label, label_too_long, duplicate_label, unknown_label, session_ended; default: moderationErrorMessage(error)
// :165 controlErrorMessage(error) — cases: invalid_transition, session_ended; default: moderationErrorMessage(error)
// :176 displaySettingsErrorMessage(error) — cases: unknown_label, private_label; default: moderationErrorMessage(error)
```

  `attachErrorMessage` (line 82) is the one that does NOT default to
  `moderationErrorMessage` — it has its own generic fallback. Preserve that
  difference.

- These functions are called at the socket-ack error sites throughout the file.
  Find every call site before refactoring:
  `grep -n "ErrorMessage(" "app/host/q-and-a/[pin]/control/control-client.tsx"`

- Constants referenced in messages (must stay in scope): `QA_HOST_REPLY_CHAR_LIMIT`,
  `QA_LABEL_NAME_LIMIT` (imported at the top of the file).

- Repo convention: this is a client component (`'use client'`). Keep these as
  plain module-level functions (they are pure string mappers, not hooks).

## Commands you will need

| Purpose        | Command                     | Expected on success   |
|----------------|-----------------------------|-----------------------|
| Typecheck      | `npx tsc --noEmit`          | exit 0                 |
| Lint           | `npm run lint`              | exit 0                 |
| Related tests  | `npm test -- app/host/q-and-a` | all pass           |
| Full unit tests| `npm test`                  | all pass               |

## Scope

**In scope** (the only files you should modify/create):
- `app/host/q-and-a/[pin]/control/control-client.tsx`
- A test for the consolidated function — either a new
  `app/host/q-and-a/[pin]/control/qa-error-message.test.ts`, or, if you extract
  the function into its own module (see Step 1 option B), the test sits beside it.

**Out of scope** (do NOT touch):
- The socket-ack logic or the messages' wording — this is a pure refactor. Every
  error code must map to the **exact same string** it does today.
- Other control clients (wonderwall/wordcloud) — leave their error handling
  alone; this plan is Q&A-scoped.

## Git workflow

- Branch: `advisor/007-consolidate-qa-error-messages`
- Commit style: conventional commits, e.g. `refactor(q-and-a): unify control error messages`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Introduce one context-aware `qaErrorMessage`

Replace the eight functions with a single function keyed by a context tag plus a
shared base. Preserve every existing code→string mapping exactly. Two structural
options — pick **A** unless you want the function unit-testable in isolation, in
which case pick **B**:

- **Option A (in place):** keep it in `control-client.tsx`. Define:

```ts
type QaErrorContext =
  | 'attach'
  | 'moderation'
  | 'highlight'
  | 'edit'
  | 'reply'
  | 'label'
  | 'control'
  | 'displaySettings';

function baseModerationMessage(error: string): string {
  switch (error) {
    case 'invalid_transition':
      return 'That question already moved on.';
    case 'unknown_question':
      return "That question isn't in this session.";
    case 'persistence_failed':
      return "Couldn't save — try again.";
    case 'forbidden':
      return 'This control room belongs to another host.';
    default:
      return "Couldn't update the question — try again.";
  }
}

// Per-context overrides; anything not overridden falls through to the base
// (except 'attach', which has its own generic fallback — see below).
function qaErrorMessage(context: QaErrorContext, error: string): string {
  switch (context) {
    case 'attach':
      switch (error) {
        case 'forbidden':
          return 'This control room belongs to another host.';
        case 'not_found':
          return "That session isn't on the air.";
        case 'session_mismatch':
          return 'Session credentials are stale — reopen from the studio.';
        default:
          return "Couldn't take the control room — try reloading.";
      }
    case 'highlight':
      return error === 'not_live'
        ? 'Only live questions can go on air.'
        : baseModerationMessage(error);
    case 'edit':
      switch (error) {
        case 'empty_text':
          return 'A question needs some words.';
        case 'text_too_long':
          return 'Too long — trim the copy.';
        case 'invalid_status':
          return 'That question already settled.';
        default:
          return baseModerationMessage(error);
      }
    // ...reply, label, control, displaySettings: copy each existing switch body
    //    verbatim, defaulting to baseModerationMessage(error).
    default:
      return baseModerationMessage(error);
  }
}
```

  Copy the `reply`, `label`, `control`, and `displaySettings` case bodies
  **verbatim** from the current functions (including the char-limit template
  strings). The `moderation` context is just `baseModerationMessage`.

- **Option B (extracted module):** move `qaErrorMessage` + `baseModerationMessage`
  into `app/host/q-and-a/[pin]/control/qa-error-message.ts` and import it into
  `control-client.tsx`. This lets you unit-test it without rendering the client
  component (preferred).

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 2: Update all call sites

Replace each `xxxErrorMessage(err)` call with `qaErrorMessage('<context>', err)`.
Use the grep from "Current state" to find them all. Mapping:
`attachErrorMessage`→`'attach'`, `moderationErrorMessage`→`'moderation'`,
`highlightErrorMessage`→`'highlight'`, `editErrorMessage`→`'edit'`,
`replyErrorMessage`→`'reply'`, `labelErrorMessage`→`'label'`,
`controlErrorMessage`→`'control'`, `displaySettingsErrorMessage`→`'displaySettings'`.
Then delete the eight now-unused functions.

**Verify**:
- `grep -c "ErrorMessage(" "app/host/q-and-a/[pin]/control/control-client.tsx"`
  returns only the count of `qaErrorMessage(` calls (the old names are gone).
- `npx tsc --noEmit` → exit 0 (an unused-function or undefined-reference error
  here means a call site or deletion was missed).

### Step 3: Test the mapping

Add a test that pins the code→string mapping for a representative sample across
contexts, so a future edit can't silently change a user-facing message. If you
chose Option B, import `qaErrorMessage` directly. If Option A, either export it
or move to Option B for testability (recommended). Cover at least: `attach`
default vs `moderation` default differ; `highlight` `not_live`; `edit`
`text_too_long`; `reply` `unknown_reply`; `label` `duplicate_label`; an unknown
code in `control` falls back to the base message.

Model the test file after an existing `app/**/*.test.ts(x)` (e.g. the display
snapshot test under `app/host/[pin]/display/`) for setup/imports.

**Verify**: `npm test -- app/host/q-and-a` → all pass including the new test.

## Test plan

- New test: `qaErrorMessage` returns the expected string for a sampled set of
  (context, code) pairs, and falls back correctly for unknown codes.
- Pattern: any `app/**/*.test.ts` in the repo.
- Verification: `npm test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -cE "function (attach|moderation|highlight|edit|reply|label|control|displaySettings)ErrorMessage" "app/host/q-and-a/[pin]/control/control-client.tsx"` returns 0
- [ ] `grep -c "qaErrorMessage(" "app/host/q-and-a/[pin]/control/control-client.tsx"` returns ≥8
- [ ] a test asserting the (context,code)→string mapping exists and passes
- [ ] `npm test` exits 0
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run lint` exits 0
- [ ] `git status --porcelain` shows only in-scope files
- [ ] Linear issue [MID-432](https://linear.app/midnight-labs/issue/MID-432/improve-007-consolidate-qanda-error-message-handlers) moved to `Done`

## STOP conditions

Stop and report back (do not improvise) if:

- The eight functions do not match the "Current state" summary (drift — codes or
  wording changed).
- Any existing code→string mapping would change during the refactor — this must
  be behavior-preserving; if you can't reproduce a mapping exactly, stop.
- A call site passes a computed/dynamic error name you can't map to a context —
  report it.

## Maintenance notes

- New Q&A error codes now go in one place: add a case to the right context (or to
  `baseModerationMessage` if it's a shared code).
- A reviewer should diff the message strings before/after and confirm they are
  byte-identical (this refactor must not reword any user-facing copy — the
  broadcast UI voice is deliberate per `DESIGN.md`).
