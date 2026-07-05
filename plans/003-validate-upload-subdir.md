# Plan 003: Reject path-traversal in the upload `subdir` parameter

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the linked Linear issue status;
> Linear is the authoritative status source.
>
> **Drift check (run first)**: `git diff --stat 4de99e7..HEAD -- lib/upload.ts app/api/upload/route.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `4de99e7`, 2026-07-05
- **Linear issue**: [MID-428](https://linear.app/midnight-labs/issue/MID-428/improve-003-validate-upload-subdir-against-path-traversal)

## Why this matters

`POST /api/upload` accepts a `subdir` field from the multipart form and passes
it, unvalidated, into `join(uploadDir, subdir)` to build the write path. Because
`path.join` normalizes `..` segments, an authenticated user can send
`subdir = "../../something"` and cause the server to write the uploaded file
**outside** `public/uploads`, anywhere the Node process can write. The filename
itself is randomized (so an attacker can't overwrite a specific file like a
config), but writing arbitrary attacker-typed image bytes into arbitrary
directories is still a real integrity/DoS problem (e.g. planting files in code
or static paths, filling a disk). The fix is a small, well-contained input
validation at the trust boundary: constrain `subdir` to a simple safe segment
and reject anything else.

## Current state

- `app/api/upload/route.ts` — the upload route handler. It requires auth
  (good), then reads `subdir` from form data and forwards it unchecked:

```ts
// app/api/upload/route.ts:16-19 — auth is enforced
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
// ...
// app/api/upload/route.ts:44-52 — subdir taken from form data, passed through
  const subdir = formData.get('subdir');
  const result = await uploadLocal(
    file,
    {
      uploadDir: appConfig.uploadDir,
      maxBytes: appConfig.uploadMaxBytes,
    },
    typeof subdir === 'string' && subdir.length > 0 ? subdir : undefined,
  );
```

- `lib/upload.ts` — `uploadLocal` joins `subdir` onto the upload dir with no
  validation:

```ts
// lib/upload.ts:100-109
  const filename = safeFilename(file.type);
  const targetDir = subdir ? join(uploadDir, subdir) : uploadDir;
  const filePath = join(targetDir, filename);

  await mkdir(targetDir, { recursive: true });

  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, bytes);

  const urlPath = subdir ? `/uploads/${subdir}/${filename}` : `/uploads/${filename}`;
```

- Legitimate callers pass simple single-segment names. Search the repo for real
  usage to confirm the allowed shape before you constrain it:
  `grep -rn "subdir" app lib --include=*.ts --include=*.tsx | grep -iv test`
  The quiz builder uploads quiz stills; expect values like `"quiz-images"` /
  `"quiz-covers"` — a single lowercase/hyphen segment, no slashes. Your
  validation must allow those and reject anything with a path separator or `..`.

- Repo convention: `uploadLocal` returns a discriminated `UploadOutcome`
  (`{ ok: true, ... } | { ok: false, error }`). The route maps `!result.ok` to a
  `400`. Reuse that same channel for the rejection — do not throw.

## Commands you will need

| Purpose        | Command                          | Expected on success   |
|----------------|----------------------------------|-----------------------|
| Typecheck      | `npx tsc --noEmit`               | exit 0                 |
| Lint           | `npm run lint`                   | exit 0                 |
| Run these tests| `npm test -- lib/upload.test.ts` | all pass               |
| Full unit tests| `npm test`                       | all pass               |

## Scope

**In scope** (the only files you should modify/create):
- `lib/upload.ts` (add subdir validation inside `uploadLocal`)
- `lib/upload.test.ts` (create if it does not exist; otherwise extend)

**Out of scope** (do NOT touch):
- `app/api/upload/route.ts` — the validation belongs in `uploadLocal` so every
  caller (not just this route) is protected. The route already handles a
  `!result.ok` outcome, so no route change is needed.
- The auth check, MIME validation, or size validation — those already exist and
  are correct.

## Git workflow

- Branch: `advisor/003-validate-upload-subdir`
- Commit style: conventional commits, e.g. `fix(upload): reject path traversal in subdir`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Validate `subdir` at the top of `uploadLocal`

In `lib/upload.ts`, immediately **after** the existing `validateFile` block and
**before** computing `targetDir`, add a strict allow-list check. A safe subdir
is a single segment of `[A-Za-z0-9._-]`, not equal to `.` or `..`, with no path
separators. Reject everything else via the existing `UploadOutcome` error
channel:

```ts
  // Constrain subdir to a single safe path segment. Without this, a value like
  // "../../x" escapes uploadDir via path.join normalization (path traversal).
  if (subdir !== undefined) {
    const SAFE_SUBDIR = /^[A-Za-z0-9._-]+$/;
    if (subdir === '.' || subdir === '..' || !SAFE_SUBDIR.test(subdir)) {
      return { ok: false, error: 'invalid_subdir' };
    }
  }
```

Place this so it runs for every code path that uses `subdir`. Do not change the
`targetDir` / `filePath` / `urlPath` lines below it.

**Verify**: `npx tsc --noEmit` → exit 0. Confirm `'invalid_subdir'` is a valid
value for the `error` field of `UploadOutcome` — check the `UploadOutcome` type
definition near the top of `lib/upload.ts`; if `error` is typed as a fixed union
that does not include `'invalid_subdir'`, add that member to the union.

### Step 2: Add tests for the traversal rejection and the happy path

Create/extend `lib/upload.test.ts`. Cover:
1. A traversal `subdir` (`'../evil'`, `'a/b'`, `'..'`, `'.'`) → returns
   `{ ok: false, error: 'invalid_subdir' }` and writes nothing.
2. A valid `subdir` (`'quiz-images'`) → returns `{ ok: true }` (happy path
   preserved).
3. `undefined` subdir → still works (writes to the root upload dir).

Use a temporary directory as `uploadDir` so the test does not touch
`public/uploads`. Model the file/mock style after an existing `lib/*.test.ts`
(e.g. `lib/qa-repo.test.ts` for structure). Build a `File` from a small valid
image buffer whose MIME type is in the allowed list (check `DEFAULT_ALLOWED_TYPES`
in `lib/upload.ts` — e.g. `image/png`). Concrete shape:

```ts
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { uploadLocal } from './upload';

function pngFile(): File {
  // 1x1 PNG is fine; any bytes with an allowed MIME type work.
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  return new File([bytes], 'x.png', { type: 'image/png' });
}

describe('uploadLocal — subdir validation', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'upload-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each(['../evil', 'a/b', '..', '.', 'x/../../y'])(
    'rejects traversal subdir %s and writes nothing',
    async (bad) => {
      const res = await uploadLocal(pngFile(), { uploadDir: dir }, bad);
      expect(res).toEqual({ ok: false, error: 'invalid_subdir' });
      // Nothing should have been written anywhere under dir.
      const entries = await readdir(dir);
      expect(entries).toHaveLength(0);
    },
  );

  it('accepts a simple safe subdir', async () => {
    const res = await uploadLocal(pngFile(), { uploadDir: dir }, 'quiz-images');
    expect(res.ok).toBe(true);
  });

  it('works with no subdir', async () => {
    const res = await uploadLocal(pngFile(), { uploadDir: dir });
    expect(res.ok).toBe(true);
  });
});
```

If the MIME allow-list rejects the 1x1 PNG (size/type validation runs first),
use bytes/type that pass `validateFile` — read `DEFAULT_ALLOWED_TYPES` and
`DEFAULT_MAX_BYTES` in `lib/upload.ts` and adjust.

**Verify**: `npm test -- lib/upload.test.ts` → all pass. Temporarily revert
Step 1 and confirm the traversal tests FAIL (proving they exercise the guard),
then restore.

## Test plan

- `lib/upload.test.ts`: traversal rejection (several bad inputs, parametrized),
  valid-subdir happy path, no-subdir happy path.
- Pattern: model after any `lib/*.test.ts` in the repo.
- Verification: `npm test` → all pass including the new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "invalid_subdir" lib/upload.ts` returns ≥1
- [ ] `lib/upload.test.ts` exists and contains a traversal-rejection test
- [ ] `npm test` exits 0; new tests pass
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run lint` exits 0
- [ ] `git status --porcelain` shows only `lib/upload.ts` and `lib/upload.test.ts`
- [ ] Linear issue [MID-428](https://linear.app/midnight-labs/issue/MID-428/improve-003-validate-upload-subdir-against-path-traversal) moved to `Done`

## STOP conditions

Stop and report back (do not improvise) if:

- `uploadLocal` or the route excerpt does not match "Current state" (drift).
- A real caller in the repo passes a `subdir` containing a slash or multiple
  segments (find via the grep in "Current state") — the single-segment allow-list
  would break it. If so, report the real shape needed rather than loosening the
  regex to permit traversal.
- There is a second, non-local upload provider (e.g. an S3/`uploadRemote` path)
  that also takes `subdir` — note it; this plan covers `uploadLocal` only.

## Maintenance notes

- If nested upload subdirectories become a real requirement, replace the
  single-segment regex with a canonicalization check:
  `path.relative(uploadDir, path.resolve(uploadDir, subdir))` must not start with
  `..` and must not be absolute — that safely allows nesting without traversal.
- A reviewer should confirm the check runs before `mkdir`/`writeFile` and uses
  the existing `{ ok: false }` channel (no thrown exception, so the route's
  `400` mapping keeps working).
