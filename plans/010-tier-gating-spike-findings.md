# Plan 010 Findings: Tier caps and Pro watermark gating (MID-75)

## Grounding summary

This is a design spike only. It does **not** implement tier enforcement, edit Prisma schema, or change runtime behavior.

### Product-source conflict to resolve before implementation

The source material disagrees on tier policy, so a build plan must get maintainer approval before choosing constants:

- `PRD.md` still says:
  > `PRD.md:130` `### 3.7 Pricing & Player Limits`  
  > `PRD.md:131` `Free tier unlimited in games and quizzes, gated on players per session.`  
  > `PRD.md:133` `| Tier | Player Cap | Price |`  
  > `PRD.md:135` `| Free | 10 players/session | $0 |`  
  > `PRD.md:136` `| Pro | 150 players/session | TBD |`  
  > `PRD.md:138` `- 150-player cap is hard system limit across all tiers`  
  > `PRD.md:139` `- When free session reaches 10, new joins rejected with friendly upsell prompt`
- Accepted `DECISIONS.md` supersedes that with Free 50 / Pro 200, watermark, and `CAP_FREE` / `CAP_PRO` constants:
  > `DECISIONS.md:545` `- **Free:** 50 players, 5 saved quizzes, full CSV export, BROADCAST watermark on display, 7-day session retention.`  
  > `DECISIONS.md:546` `- **Pro \$9/mo or \$90/yr (2 months free):** 200 players, unlimited quizzes, image upload, custom logo, no watermark, full session-history retention.`  
  > `DECISIONS.md:552` **Implication:** MID-73 (Stripe), MID-74 (pricing page), MID-75 (tier caps) all consume `CAP_FREE=50`, `CAP_PRO=200` constants. The hardcoded `HARD_CAP=150` from MID-84 gets replaced when MID-75 lands.
- The word-cloud code has a separate TODO for a **250 submission** free-tier cap:
  > `app/api/wordcloud/route.ts:5` `// TODO MID-75: enforce free-tier 250-submission cap`  
  > `app/api/wordcloud/route.ts:6` `const FREE_TIER_SUBMISSION_CAP = 250;`

**Recommendation:** treat `DECISIONS.md` as the current pricing source for player caps and watermark policy, but do not infer the word-cloud `250` submission cap from the PRD. Approve or revise that number explicitly before implementation.

## 1. Cap enforcement design

### Recommended semantics

Enforce the word-cloud free-tier submission cap **per word-cloud session**, server-side, after the socket has verified the player identity and rate limit but before mutating in-memory word state.

The cap should count **accepted submissions for the session**, not currently visible words:

- Host moderation (`removeWord`) must not give Free hosts more quota by deleting words.
- Duplicate, profanity-filtered, over-per-player-limit, paused, and unauthenticated submissions should not consume the cap because they were already rejected by existing validation.
- Existing removed rows should still count if the word was accepted and later removed by the host; this makes quota resource-based and predictable.

### Current state and gap

Current word-cloud state can derive visible counts but not a durable quota count:

- `lib/wordcloud.ts:16` defines `WordCloudState` without tier or quota fields.
- `lib/wordcloud.ts:26` stores `players: Map<string, WordCloudPlayerEntry>`.
- `lib/wordcloud.ts:27` stores visible `words: Map<string, WordCloudWordEntry>`.
- `lib/wordcloud.ts:28-30` tracks removed normalized words in `trashedNormalized`.
- `lib/wordcloud.ts:143` pushes accepted normalized words into a player's `submissions` array.
- `lib/wordcloud.ts:164-173` `removeWord` deletes a word and removes that normalized value from every player's `submissions`, so `sum(player.submissions.length)` is **not** a lifetime session-submission count.
- `lib/wordcloud-repo.ts:91-110` persists each accepted submission as a `WordCloudSubmission` row.
- `lib/wordcloud-hydrate.ts:47-72` hydrates from persisted submissions but skips removed rows for visible state.

### Recommended implementation shape

Add explicit quota metadata to in-memory and persisted session state:

```ts
type Tier = 'free' | 'pro';

type WordCloudState = {
  // existing fields...
  tier: Tier;
  submissionCap: number | null; // null means unlimited / Pro
  acceptedSubmissionCount: number;
  showWatermark: boolean;
};
```

Then:

1. Snapshot the host tier at session creation.
2. Derive `submissionCap` from approved product constants (`FREE_WORDCLOUD_SUBMISSION_CAP`, Pro = `null`) and store it on the session snapshot, not by live-reading `User.tier` for every submit.
3. Hydrate `acceptedSubmissionCount` from `WordCloudSubmission` rows. Count removed rows too unless the maintainer decides moderation should refund quota.
4. In the submit path, reject before `submitWord` when `state.submissionCap !== null && state.acceptedSubmissionCount >= state.submissionCap`.
5. Add `session_cap_reached` to `SubmitReason` / `RejectReason` and emit through the existing `wordcloud:player:rejected` channel.
6. Increment `acceptedSubmissionCount` only once the submission is accepted and persistence succeeds; if persistence fails and `rollbackSubmit` runs, the count must not change.

### Rejection channel and UX

Reuse the existing rejection channel:

- `server.ts:1066-1073` already maps `submitWord` rejection to `wordcloud:player:rejected`.
- `app/play/[pin]/wordcloud/page.tsx:13-21` defines the player-side `RejectReason` union.
- `app/play/[pin]/wordcloud/page.tsx:38-52` maps rejection reasons to user-facing toast copy.

Add a reason such as `session_cap_reached` and copy like:

> This room hit the Free submission limit. Ask the host to upgrade or start a new room.

### Does Q&A need an analogous cap?

No Q&A tier-cap TODO exists in this plan, and the current Q&A schema already carries per-question/per-reply limits rather than tier quota policy. However, Q&A is also participant-generated content. If the product promise is "Free has capped audience submissions across all activity types," add a separate follow-up decision/build plan for Q&A rather than silently folding it into MID-75.

## 2. Tier propagation to the projector

### Constraint

The word-cloud display page is public-by-PIN and cannot read the host's authenticated session directly:

- `app/host/wordcloud/[pin]/display/page.tsx:104` has the MID-75 TODO.
- `app/host/wordcloud/[pin]/display/page.tsx:105` renders `<Watermark />` unconditionally.
- `server.ts:1152-1165` lets a public display socket attach by PIN and receive `wcSnapshot(state)`.
- `server.ts:381-390` currently builds `wcSnapshot` without tier or `showWatermark` metadata.

### Recommended mechanism

Snapshot presentation entitlement at word-cloud session creation and carry a public-safe boolean in the socket snapshot:

- Persist `tierAtCreation` and `showWatermark` on `WordCloudSession`.
- Copy those fields into `WordCloudState` during create/hydrate.
- Add `showWatermark` to `wcSnapshot(state)`.
- Update the display client to render `<Watermark />` only when `state?.showWatermark !== false` (default visible while state is loading to preserve current behavior).

This keeps the public display page from needing host cookies and avoids leaking billing internals; the display sees only the presentation flag it needs.

### Alternatives considered

| Option | Why not |
|---|---|
| Public display calls an authenticated endpoint for `User.tier` | The display page is intentionally public-by-PIN and may run in a projector browser without host cookies. |
| Live-read `User.tier` in every `wcSnapshot` | Couples public projection to billing state, creates mid-session behavior changes, and adds DB I/O to socket broadcasts. |
| Store only `tier` and derive `showWatermark` on the client | Exposes more billing detail than necessary and duplicates product policy in client code. |
| Keep watermark unconditional until billing ships | Preserves current behavior but leaves the Pro promise undelivered after MID-75. |

Recommended winner: persisted `showWatermark` snapshot, with `tierAtCreation` retained for audit/debugging.

## 3. Schema changes

Do not apply these in the spike. Proposed Prisma migration for a follow-up implementation:

```prisma
model WordCloudSession {
  // existing fields...
  tierAtCreation       Tier    @default(free)
  submissionCap        Int?
  acceptedSubmissionCount Int  @default(0)
  showWatermark        Boolean @default(true)
}
```

Notes:

- `tierAtCreation @default(free)` is backwards-compatible for existing rows and matches current behavior for anonymous/unknown hosts.
- `showWatermark @default(true)` preserves today's unconditional watermark on deploy; Pro sessions created after the code change can set it to `false`.
- `submissionCap Int?` snapshots the approved cap at creation so future pricing changes do not retroactively change active rooms.
- `acceptedSubmissionCount Int @default(0)` is optional if the implementation hydrates count from `WordCloudSubmission`, but a column is useful for cheap checks and dashboard analytics. If stored, update it in the same transaction as `WordCloudSubmission.create` when the final implementation is multi-node-safe.
- `User.tier` already exists at `prisma/schema.prisma:21-28`, so no user-tier source needs to be invented.
- Existing rows with `submissionCap = null` should behave as uncapped or use a one-time data migration to set Free caps. Choose one deliberately; defaulting to current behavior avoids surprise production regressions.

## 4. Enforcement points list

Every enforcement point below is a real current `file:line` location.

| Point | Current line(s) | Required follow-up change |
|---|---:|---|
| User tier source | `prisma/schema.prisma:21-28` | Read `User.tier` when creating a room; keep billing source separate. |
| Word-cloud session schema | `prisma/schema.prisma:168-186` | Add `tierAtCreation`, `submissionCap`, `acceptedSubmissionCount` if approved, and `showWatermark`. |
| HTTP word-cloud creation route | `app/api/wordcloud/route.ts:11-16` and `app/api/wordcloud/route.ts:60-67` | Fetch authenticated host tier and pass tier/quota/presentation fields into `createSession`. |
| Repository create | `lib/wordcloud-repo.ts:37-57` | Accept and persist tier/quota/presentation snapshot fields. |
| Repository hydrate query | `lib/wordcloud-repo.ts:65-72` | Return new session fields and enough submissions data/count to hydrate quota count. |
| In-memory state type | `lib/wordcloud.ts:16-32` | Add tier/quota/presentation fields. |
| State creation | `lib/wordcloud.ts:78-100` | Initialize tier/quota/presentation fields from repo/session snapshot. |
| Hydration | `lib/wordcloud-hydrate.ts:20-29` and `lib/wordcloud-hydrate.ts:47-72` | Hydrate new fields and `acceptedSubmissionCount` from persisted session/submissions. |
| Submit validation | `server.ts:1041-1073` / `lib/wordcloud.ts:118-162` | Reject `session_cap_reached` before mutating word state; preserve rollback behavior on persistence failure. |
| Persistence after submit | `server.ts:1079-1101` and `lib/wordcloud-repo.ts:91-110` | Increment persisted count atomically with accepted submission if using a counter column. |
| Public snapshot builder | `server.ts:381-390` | Include `showWatermark` only; do not expose raw billing details unless needed. |
| Display attach | `server.ts:1152-1165` | Continue using `wcSnapshot(state)`; no auth required. |
| Display rendering | `app/host/wordcloud/[pin]/display/page.tsx:80-105` | Store `showWatermark` from state and conditionally render `<Watermark />`. |
| Player rejection typing/copy | `app/play/[pin]/wordcloud/page.tsx:13-21` and `app/play/[pin]/wordcloud/page.tsx:38-52` | Add `session_cap_reached` reason and friendly upsell copy. |

## 5. Open questions for the maintainer

1. **What is the current tier source of truth?** `PRD.md` says Free 10 / Pro 150, while accepted `DECISIONS.md` says Free 50 / Pro 200. Should `PRD.md` be updated to match decisions before MID-75 implementation?
2. **Is the word-cloud Free cap truly 250 submissions per session?** The value exists only in the code TODO, not in the quoted PRD tier section.
3. **Does Pro have unlimited word-cloud submissions or a higher cap?** If higher, what number?
4. **Do removed/moderated words count against the cap?** This proposal says yes for resource/quota predictability.
5. **What is the cap-hit UX?** Hard reject with toast only, or also host-side upsell/banner in the control room?
6. **Should anonymous/self-hosted sessions be treated as Free?** Current recommendation: yes, matching `PRD.md:140` for anonymous sessions.
7. **Should Q&A get a separate submission cap?** If yes, create a dedicated plan; do not hide it inside the word-cloud build.
8. **Should mid-session upgrades affect active sessions?** This proposal snapshots tier at creation; if an upgrade should immediately remove watermark/cap, add explicit host-triggered refresh semantics.
9. **Should `GameSession` also snapshot tier while replacing the hardcoded quiz cap?** `DECISIONS.md:659-660` says the `tier` field on `GameSession` should be reused when MID-75 lands, but current schema no longer shows a `tier` column on `GameSession`.
10. **Is `BillingEvent` still planned?** `DECISIONS.md:628-639` references it, but current Prisma schema has `User.tier` and no `BillingEvent` model.

## 6. Recommended build-plan breakdown

### 010a — Reconcile tier policy and add constants (S)

**Goal:** Make the source-of-truth explicit before enforcement.

- Update `PRD.md` or `DECISIONS.md` so player caps, word-cloud submission caps, watermark policy, and anonymous-session behavior agree.
- Add a small tier policy module, e.g. `lib/tier-policy.ts`, with approved constants:
  - `FREE_PLAYER_CAP`
  - `PRO_PLAYER_CAP`
  - `FREE_WORDCLOUD_SUBMISSION_CAP`
  - `PRO_WORDCLOUD_SUBMISSION_CAP` or `null`
  - `watermarkForTier(tier)`
- Add unit tests for the policy module.

### 010b — Snapshot tier/quota/presentation onto word-cloud sessions (M)

**Goal:** Persist the host's approved tier policy at room creation and hydrate it into socket state.

- Add Prisma migration for `WordCloudSession` snapshot fields.
- Update `app/api/wordcloud/route.ts` to read `User.tier` for the authenticated host.
- Update `lib/wordcloud-repo.ts`, `lib/wordcloud.ts`, and `lib/wordcloud-hydrate.ts` to persist/hydrate the snapshot fields.
- Add repository and hydrate tests covering Free, Pro, existing/default rows, and anonymous sessions.

### 010c — Enforce word-cloud cap and gate watermark (M)

**Goal:** Enforce Free word-cloud quota server-side and use the public-safe projection flag.

- Add `session_cap_reached` to server/client rejection types and copy.
- Reject over-cap submissions before mutating in-memory state.
- Keep persistence and rollback behavior correct.
- Add `showWatermark` to `wcSnapshot` and conditionally render `<Watermark />` on the display page.
- Add socket/unit tests for cap edge (`cap - 1`, `cap`, `cap + 1`), removed-word behavior, Pro/no-cap behavior, and display snapshot behavior.

### 010d — Optional Q&A quota decision/build plan (S design, M build)

Only create this if the maintainer decides participant-generated Q&A should share tier quota semantics. Keep it separate from word-cloud MID-75 to avoid mixing product policy with a narrow implementation task.
