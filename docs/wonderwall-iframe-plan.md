# WonderWall — LinkedIn iframe Implementation Plan

> **Status:** Draft for review / comments
> **Date:** 2026-06-18
> **Scope:** Add a fourth standalone PRIMETIME activity that renders public LinkedIn posts in a waterfall dashboard using official LinkedIn iframe embeds.
> **Primary goal:** Let users submit LinkedIn post URLs, let the host approve what is displayable, and project only approved LinkedIn-native post cards alongside Quiz, Word Cloud, and Q&A.

---

## 0. Review questions for Aditya

Please comment on these first — they shape the implementation size.

| Decision | Recommended v1 | Notes |
|---|---|---|
| Product name | **WonderWall** | Keeps room for future platforms. UI copy can say “LinkedIn posts” in v1. |
| v1 content source | **Participant/user-submitted LinkedIn URLs with host approval** | Users paste URLs into a player surface; nothing appears on display until host approves it. Host may also add URLs from control, but they should still flow through the same review/status model. |
| Rendering | Official LinkedIn iframe embed | Closest to LinkedIn-native rendering and least custom UI. |
| Participant route | **Yes:** `/play/[pin]/wonderwall` | Users paste LinkedIn URLs here. Submissions enter a review queue and never display before host approval. |
| Display route | `/host/wonderwall/[pin]/display` | Public-by-PIN projection surface, consistent with Word Cloud/Q&A display routes. |
| Control route | `/host/wonderwall/[pin]/control` | Host-only management surface. |
| CSV export | **Yes:** host-only export from control | Export all submitted rows, not only approved/displayed posts. |
| Create route | `/host/wonderwall/new` | Mirrors `/host/wordcloud/new` and `/host/q-and-a/new`. |
| Display updates | Light realtime refresh | Mutations via HTTP API; control page emits a refresh event so display refetches. |
| Screenshot fallback | Not v1 | Keep v1 iframe-only. Add screenshot rendering later if iframe UX is insufficient. |
| LinkedIn data storage | Store URL + normalized URN + embed URL + review/display metadata only | Do not store post text, author, image, reactions, comments, or profile data. |

Recommended v1 one-liner:

> **WonderWall:** host creates a PIN-backed display wall, users paste public LinkedIn post URLs into a participant page, PRIMETIME validates whether each URL can become an official LinkedIn iframe embed, and the host approves items before they appear on the waterfall display. No unapproved content reaches the projector; no scraping, screenshots, or LinkedIn API in v1.

---

## 1. Current codebase fit

Verified in `~/Developer/primetime` before writing this plan:

- Stack: Next.js 15 App Router, React 19, TypeScript, Tailwind, Auth.js v5, Prisma/Postgres, Socket.IO, Biome, Vitest, Playwright.
- Existing standalone activity pattern:
  - Quiz: `/host/quiz/new`, `/host/[pin]/control`, `/host/[pin]/display`, `/play/[pin]`
  - Word Cloud: `/host/wordcloud/new`, `/host/wordcloud/[pin]/control`, `/host/wordcloud/[pin]/display`, `/play/[pin]/wordcloud`
  - Q&A: `/host/q-and-a/new`, `/host/q-and-a/[pin]/control`, `/host/q-and-a/[pin]/display`, `/play/[pin]/q-and-a`
- `/host` Quick Activities grid lives in `app/host/HostMenuClient.tsx`.
- Public display route exceptions live in `auth.config.ts:isPublicHostDisplayPath()`.
- Protected `/host/*` and activity API route matching lives in `middleware.ts`.
- Shared 6-digit PIN allocation lives in `lib/pin-allocator.ts` and currently checks quiz, word-cloud, and Q&A tables.
- API creation pattern exists in:
  - `app/api/wordcloud/route.ts`
  - `app/api/q-and-a/route.ts`
- Repo conventions require preserving PRIMETIME’s broadcast identity and public-origin behavior for display/projection routes.

WonderWall can therefore be built as a fourth standalone activity with the same route/auth/PIN conventions. Because Aditya wants user-submitted URLs with host approval before display, v1 should include a lightweight participant submission surface and review queue, but still avoid the heavier realtime state machinery used by Q&A.

---

## 2. Product scope

### 2.1 V1 user story

As a host, I want participants/users to submit public LinkedIn post URLs into PRIMETIME, review whether each submitted post can be displayed, approve the good ones, reject the unsuitable or unembeddable ones with feedback, and project only approved posts in a waterfall wall.

### 2.2 V1 host flow

```txt
/host
  ↓ click WonderWall
/host/wonderwall/new
  ↓ enter title + optional instructions, create wall
POST /api/wonderwall
  ↓ creates PIN-backed wall
/host/wonderwall/[pin]/control
  ↓ review pending submissions, approve/reject, export submissions CSV, reorder approved posts, open display
/play/[pin]/wonderwall
  ↓ users paste LinkedIn URLs and receive accepted/rejected/pending feedback
/host/wonderwall/[pin]/display
  ↓ public projector view renders approved iframe waterfall only
```

### 2.3 V1 display behavior

The display route renders:

- PRIMETIME broadcast frame/header.
- Wall title and optional description/instructions.
- PIN and submit instruction, e.g. `SUBMIT A LINKEDIN POST AT /JOIN`.
- Waterfall/masonry grid of **approved** embedded LinkedIn posts only.
- Empty state when there are no approved posts yet.
- No pending/rejected submissions on the projector.
- “Open on LinkedIn” affordance per approved card if useful.

### 2.4 V1 non-goals

- No scraping LinkedIn pages.
- No logged-in/headless LinkedIn account automation.
- No LinkedIn API integration.
- No screenshot generation.
- No AI summarization or OCR.
- No unmoderated participant-submitted URLs. User-submitted URLs are allowed only through a pending → approved/rejected review flow.
- No comments/reactions ingestion.
- No storing LinkedIn post content beyond URL/URN/embed URL.
- No automatic LinkedIn feed syncing.
- No generalized multi-platform support yet, though naming/data model should not block it.

---

## 3. Compliance and platform boundary

V1 should be deliberately conservative:

1. Use only public LinkedIn post URLs supplied by users/participants or the host.
2. Render posts with LinkedIn-hosted iframe embeds.
3. Store only:
   - original URL,
   - normalized LinkedIn URN,
   - generated embed URL,
   - submitter display name/session identity where needed for feedback,
   - review/display status,
   - optional rejection reason/message,
   - ordering metadata.
4. Do not extract or persist LinkedIn member/profile/post content.
5. Do not bypass visibility, login, rate limits, or access controls.
6. Always keep a path back to LinkedIn, e.g. card link or “Open on LinkedIn”.
7. If LinkedIn refuses to render a post, show a graceful placeholder instead of attempting fallback scraping.

Decision to later record in `DECISIONS.md`:

> WonderWall v1 uses official LinkedIn public iframe embeds only. User-submitted LinkedIn URLs enter a host review queue and are not shown on the public display until approved. PRIMETIME does not scrape LinkedIn, does not use a logged-in automation account, does not call LinkedIn APIs for member data, and does not store LinkedIn post content. Screenshots and API integrations are explicitly deferred.

---

## 4. URL normalization

### 4.1 Supported input examples

Support these common LinkedIn post URL shapes:

```txt
https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789
https://www.linkedin.com/posts/someone_activity-1234567890123456789-abc
https://www.linkedin.com/posts/someone_ugcPost-1234567890123456789-abc
https://www.linkedin.com/posts/someone_share-1234567890123456789-abc
```

Optional stretch if it appears in real examples:

```txt
https://www.linkedin.com/feed/update/urn:li:ugcPost:1234567890123456789
https://www.linkedin.com/feed/update/urn:li:share:1234567890123456789
```

### 4.2 Normalized internal form

```ts
type LinkedInPostUrn =
  | `urn:li:activity:${string}`
  | `urn:li:ugcPost:${string}`
  | `urn:li:share:${string}`;
```

### 4.3 Embed URL generation

```ts
function toLinkedInEmbedUrl(urn: LinkedInPostUrn) {
  return `https://www.linkedin.com/embed/feed/update/${urn}`;
}
```

### 4.4 Validation rules

- Accept only `https:` URLs.
- Accept only hostnames:
  - `linkedin.com`
  - `www.linkedin.com`
- Extract only known post identifiers:
  - `urn:li:activity:<digits>`
  - `urn:li:ugcPost:<digits>`
  - `urn:li:share:<digits>`
  - `activity-<digits>` from `/posts/...`
  - `ugcPost-<digits>` from `/posts/...`
  - `share-<digits>` from `/posts/...`
- Reject profile/company/search/feed URLs that are not specific posts.
- Deduplicate by normalized URN inside the same wall.
- Return explicit error codes for UI copy.

Suggested parser result:

```ts
type WonderWallParseResult =
  | {
      ok: true;
      platform: 'linkedin';
      originalUrl: string;
      urn: LinkedInPostUrn;
      embedUrl: string;
    }
  | {
      ok: false;
      reason:
        | 'invalid_url'
        | 'unsupported_host'
        | 'unsupported_protocol'
        | 'unsupported_linkedin_url'
        | 'missing_post_id';
    };
```

---

## 5. Data model

### 5.1 Prisma schema additions

Add to `prisma/schema.prisma`:

```prisma
enum WonderWallStatus {
  DRAFT
  LIVE
  ENDED
  ARCHIVED
}

enum WonderWallPostStatus {
  PENDING
  APPROVED
  REJECTED
  HIDDEN
  FAILED
}

model WonderWallSession {
  id          String           @id @default(cuid())
  pin         String           @unique
  title       String           @db.VarChar(100)
  description String?          @db.VarChar(200)
  instructions String?         @db.VarChar(240)
  status      WonderWallStatus @default(DRAFT)
  hostUserId  String?
  hostUser    User?            @relation(fields: [hostUserId], references: [id], onDelete: SetNull)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  endedAt     DateTime?
  posts       WonderWallPost[]

  @@index([hostUserId, createdAt])
  @@index([status])
}

model WonderWallPost {
  id          String               @id @default(cuid())
  sessionId   String
  session     WonderWallSession    @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  originalUrl String               @db.Text
  urn         String               @db.VarChar(120)
  embedUrl    String               @db.Text
  status      WonderWallPostStatus @default(PENDING)
  // Explicit projector gate requested by product review: display surfaces must
  // render only posts where canDisplay=true. Parsing a URL is not enough.
  canDisplay Boolean              @default(false)
  position    Int?
  submitterName String?           @db.VarChar(40)
  submitterKey  String?           @db.VarChar(120)
  rejectionReason String?         @db.VarChar(240)
  reviewedAt  DateTime?
  reviewedByHostUserId String?
  createdAt   DateTime             @default(now())
  updatedAt   DateTime             @updatedAt

  // Do not make this unique in v1. If a post was rejected as unembeddable or
  // inappropriate, a user may try again later after copying a cleaner URL. The
  // control surface can still group duplicates visually.
  @@index([sessionId, position])
  @@index([sessionId, status])
  @@index([sessionId, canDisplay, position])
}
```

Add to `User`:

```prisma
wonderWallSessions WonderWallSession[]
```

### 5.2 Status semantics

| Status | Meaning |
|---|---|
| `DRAFT` | Created, editable, accepting submissions/review, not necessarily being projected. |
| `LIVE` | Host considers wall active/on-air. Display can still render DRAFT, but LIVE gives future history semantics. |
| `ENDED` | Wall closed/frozen. Display remains viewable. |
| `ARCHIVED` | Hidden from default host history later. |

V1 can create sessions as `DRAFT` and allow display immediately, or create as `LIVE`. Recommended: create as `DRAFT`, then control page can switch to `LIVE` when opening display if we want lifecycle semantics. If this feels like unnecessary state, simplify to `LIVE` only for v1 and keep enum for future history.

### 5.3 Post review/display semantics

The important product rule from review: **a submitted LinkedIn URL must not appear on the display until the host approves it.** Parsing a URL into an embed URL only means “technically understood”; it does not mean “safe/appropriate/on-air”.

| Post status | `canDisplay` | Meaning |
|---|---:|---|
| `PENDING` | `false` | User submitted a URL. It is waiting for host review. Never shown on display. |
| `APPROVED` | `true` | Host approved the URL. It appears on display in `position` order. |
| `REJECTED` | `false` | Host rejected the URL. The submitter can see feedback and try again. |
| `HIDDEN` | `false` | Previously approved post temporarily removed from display by host. |
| `FAILED` | `false` | Parser/check determined the URL cannot become a supported embed. |

Implementation invariant:

```txt
Display query = posts where status = APPROVED and canDisplay = true, ordered by position.
```

The control surface should show a separate “Can display?” flag/chip for each row:

```txt
PENDING  → CAN DISPLAY: NO · NEEDS REVIEW
APPROVED → CAN DISPLAY: YES · ON AIR
REJECTED → CAN DISPLAY: NO · REJECTED
FAILED   → CAN DISPLAY: NO · UNSUPPORTED URL
HIDDEN   → CAN DISPLAY: NO · HIDDEN BY HOST
```

---

## 6. API design

### 6.1 Create wall

Create:

```txt
app/api/wonderwall/route.ts
```

`POST /api/wonderwall`

Auth: host required.

Request:

```ts
type CreateWonderWallRequest = {
  title: string;
  description?: string | null;
  instructions?: string | null;
};
```

Validation:

- `title`: required, trimmed, 1–100 chars.
- `description`: optional, trimmed, max 200 chars.
- `instructions`: optional, trimmed, max 240 chars. Display/player copy that tells users what kind of LinkedIn posts to submit.
- No initial URL list is required in the create call. Users submit links after the wall exists, and every link starts as `PENDING`/`canDisplay=false`.

Response:

```ts
type CreateWonderWallResponse = {
  pin: string;
  sessionId: string;
};
```

### 6.2 Fetch wall state

Create:

```txt
app/api/wonderwall/[pin]/route.ts
```

`GET /api/wonderwall/[pin]`

Auth:

- Public display/player payload can be unauthenticated.
- Host control details require ownership. Recommended v1: either add a `?view=host` host-only variant or a separate host endpoint that includes pending/rejected submissions and submitter feedback fields.

Response:

```ts
type WonderWallPublicState = {
  pin: string;
  title: string;
  description: string | null;
  instructions: string | null;
  status: 'DRAFT' | 'LIVE' | 'ENDED' | 'ARCHIVED';
  posts: Array<{
    id: string;
    originalUrl: string;
    urn: string;
    embedUrl: string;
    status: 'APPROVED';
    canDisplay: true;
    position: number;
  }>;
};
```

Display must render only posts with `status='APPROVED'` and `canDisplay=true`. Pending/rejected/failed rows are host/player feedback state only and must never leak onto the projector.

### 6.3 Submit LinkedIn URL

Create:

```txt
app/api/wonderwall/[pin]/posts/route.ts
```

`POST /api/wonderwall/[pin]/posts`

Auth: public-by-PIN. This is the participant/user submission endpoint. It must not require host auth, and it must never create a displayable post directly.

Request:

```ts
type SubmitWonderWallPostRequest = {
  url: string;
  submitterName?: string | null;
  submitterKey?: string | null;
};
```

Behavior:

- Parse and validate the LinkedIn URL.
- If unsupported, create no displayable post and return a user-facing error so the user can try again.
- If supported, create a `WonderWallPost` with `status='PENDING'`, `canDisplay=false`, and no `position`.
- Notify the host control surface that a new pending submission exists.
- Return a pending response to the submitter.

Response:

```ts
type SubmitWonderWallPostResponse = {
  post: {
    id: string;
    originalUrl: string;
    urn: string;
    status: 'PENDING';
    canDisplay: false;
  };
  message: 'Submitted for host review';
};
```

Error codes:

```txt
invalid_url
unsupported_host
unsupported_linkedin_url
session_not_found
submissions_closed
rate_limited
```

### 6.4 Review/approve/reject/hide post

Recommended v1 behavior: host review is the only way a post becomes displayable. Hiding an approved post should not delete it.

Create:

```txt
app/api/wonderwall/[pin]/posts/[postId]/route.ts
```

`PATCH /api/wonderwall/[pin]/posts/[postId]`

Auth: host required and must own the session.

Request:

```ts
type ReviewWonderWallPostRequest =
  | { action: 'approve' }
  | { action: 'reject'; reason?: string }
  | { action: 'hide' }
  | { action: 'restore' };
```

Behavior:

- `approve`: set `status='APPROVED'`, `canDisplay=true`, assign next `position`, clear rejection reason, set `reviewedAt/reviewedByHostUserId`.
- `reject`: set `status='REJECTED'`, `canDisplay=false`, store optional `rejectionReason`, set review metadata. The submitter sees the message and can try again.
- `hide`: set `status='HIDDEN'`, `canDisplay=false`, keep position for possible restore.
- `restore`: set `status='APPROVED'`, `canDisplay=true` for a previously hidden approved post.

The host control must show a “Can display?” flag based on the returned state. The display refetch must only include approved/displayable posts.

Optional hard-delete can be deferred.

### 6.5 Reorder posts

Create:

```txt
app/api/wonderwall/[pin]/posts/reorder/route.ts
```

`POST /api/wonderwall/[pin]/posts/reorder`

Request:

```ts
{ orderedPostIds: string[] }
```

Rules:

- All IDs must belong to the wall and be approved/displayable.
- Update `position` sequentially in a transaction.
- Pending/rejected/failed posts have no display position. Hidden posts may retain their last position for restore, but should be excluded from the current display ordering.

### 6.6 Status update

Optional in v1:

```txt
app/api/wonderwall/[pin]/status/route.ts
```

`POST /api/wonderwall/[pin]/status`

Request:

```ts
{ status: 'DRAFT' | 'LIVE' | 'ENDED' | 'ARCHIVED' }
```

This can be skipped if we do not expose lifecycle controls yet.

### 6.7 Participant feedback/status

Create if the participant page needs to show “pending / approved / rejected” after refresh:

```txt
app/api/wonderwall/[pin]/my-posts/route.ts
```

`GET /api/wonderwall/[pin]/my-posts?submitterKey=...`

Auth: public-by-PIN, scoped by an opaque `submitterKey` stored in `sessionStorage` for that browser. This is not a security boundary; it is a convenience so users can see feedback for their own submissions.

Response:

```ts
type MyWonderWallPostsResponse = {
  posts: Array<{
    id: string;
    originalUrl: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'FAILED' | 'HIDDEN';
    canDisplay: boolean;
    rejectionReason: string | null;
    createdAt: string;
  }>;
};
```

Participant UX:

- `PENDING`: “Waiting for host approval.”
- `APPROVED`: “Approved — it may appear on the display.”
- `REJECTED`: show host reason if present, then invite the user to try another URL.
- `FAILED`: “We could not turn that URL into a supported LinkedIn embed. Try copying the post link again.”

### 6.8 Export submitted data as CSV

Create:

```txt
app/api/wonderwall/[pin]/export/route.ts
```

`GET /api/wonderwall/[pin]/export`

Auth: host required and must own the session. This endpoint is launched from host control only. It must not be public-by-PIN.

Behavior:

- Export **all submitted rows** for the wall, not only approved/displayed posts.
- Include `PENDING`, `APPROVED`, `REJECTED`, `HIDDEN`, and `FAILED` rows so the host has a complete moderation/audit log.
- Sort by `createdAt ASC`, then `id ASC` for stable output.
- Return `text/csv; charset=utf-8` with a download filename such as `wonderwall-${pin}-submissions.csv`.
- Use `Content-Disposition: attachment; filename="wonderwall-${pin}-submissions.csv"`.
- Quote CSV cells correctly, including commas, quotes, and newlines.
- Prevent spreadsheet formula injection: if a cell starts with `=`, `+`, `-`, `@`, tab, or carriage return, prefix it with a single quote before CSV quoting.

Recommended columns:

```txt
submittedAt,status,canDisplay,originalUrl,urn,embedUrl,submitterName,submitterKey,reviewedAt,reviewedByHostUserId,rejectionReason,displayOrder,failureReason
```

Column notes:

- `submittedAt`: `createdAt` in ISO-8601 UTC.
- `status`: one of `PENDING`, `APPROVED`, `REJECTED`, `HIDDEN`, `FAILED`.
- `canDisplay`: `true` only for rows allowed on the projector.
- `originalUrl`: user-submitted URL.
- `urn`: normalized LinkedIn URN if parsed.
- `embedUrl`: LinkedIn iframe embed URL if available.
- `submitterName`: participant nickname if provided via `/join`.
- `submitterKey`: opaque browser-scoped key for participant feedback correlation; acceptable in host-only CSV, but not public payload.
- `reviewedAt` / `reviewedByHostUserId`: filled after host approval/rejection/hide/restore actions when available.
- `rejectionReason`: host-provided user-facing feedback for rejected rows.
- `displayOrder`: `position` for approved/displayable rows; blank for pending/rejected/failed rows.
- `failureReason`: parser/embed validation failure reason if the row is marked failed.

Test cases:

- unauthenticated request returns `401`/redirect according to project API conventions.
- authenticated non-owner returns `403`.
- owner receives `200` with `text/csv; charset=utf-8`.
- output includes pending, approved, rejected, hidden, and failed rows.
- output escapes quotes/newlines/commas correctly.
- output neutralizes spreadsheet-formula cells.

---

## 7. Repository/helper modules

### 7.1 `lib/wonderwall-input.ts`

Responsibilities:

- URL parsing.
- URL normalization.
- LinkedIn URN generation.
- Embed URL generation.
- Request validation helpers if useful.

Exports:

```ts
export type LinkedInPostUrn =
  | `urn:li:activity:${string}`
  | `urn:li:ugcPost:${string}`
  | `urn:li:share:${string}`;

export type WonderWallParseResult = ...;

export function parseLinkedInPostUrl(input: string): WonderWallParseResult;
export function toLinkedInEmbedUrl(urn: LinkedInPostUrn): string;
```

### 7.2 `lib/wonderwall-repo.ts`

Responsibilities:

- Thin Prisma wrappers, mirroring `lib/wordcloud-repo.ts` and `lib/qa-repo.ts`.
- Create sessions.
- Allocate PIN via shared allocator.
- Fetch by PIN.
- Submit posts into pending review.
- Approve/reject/hide/restore posts.
- Reorder approved/displayable posts.
- Fetch participant-scoped feedback by submitter key.
- Fetch all submissions for host-only CSV export.
- Enforce ownership checks where needed.

Suggested exports:

```ts
export const WONDERWALL_TITLE_MAX = 100;
export const WONDERWALL_DESCRIPTION_MAX = 200;
export const WONDERWALL_INSTRUCTIONS_MAX = 240;
export const WONDERWALL_POST_LIMIT = 100;

export async function allocatePin(): Promise<string>;
export async function createSession(args: {...}): Promise<WonderWallSession>;
export async function getPublicStateByPin(pin: string): Promise<WonderWallPublicState | null>;
export async function getHostStateByPin(args: { pin: string; hostUserId: string }): Promise<WonderWallHostState | null>;
export async function assertHostOwnsSession(args: { pin: string; hostUserId: string }): Promise<WonderWallSession>;
export async function submitPost(args: {...}): Promise<WonderWallPost>;
export async function reviewPost(args: {...}): Promise<WonderWallPost>;
export async function getPostsForSubmitter(args: { pin: string; submitterKey: string }): Promise<WonderWallPost[]>;
export async function listPostsForExport(args: { pin: string; hostUserId: string }): Promise<WonderWallPost[]>;
export async function reorderApprovedPosts(args: {...}): Promise<void>;
```

### 7.3 `lib/wonderwall-export.ts`

Responsibilities:

- Convert host-only submission rows to CSV.
- Centralize CSV escaping and spreadsheet formula-injection prevention.
- Keep export formatting testable without constructing a Next.js `Response`.

Suggested exports:

```ts
export const WONDERWALL_EXPORT_COLUMNS = [
  'submittedAt',
  'status',
  'canDisplay',
  'originalUrl',
  'urn',
  'embedUrl',
  'submitterName',
  'submitterKey',
  'reviewedAt',
  'reviewedByHostUserId',
  'rejectionReason',
  'displayOrder',
  'failureReason',
] as const;

export function escapeCsvCell(value: unknown): string;
export function neutralizeSpreadsheetFormula(value: string): string;
export function buildWonderWallSubmissionsCsv(posts: WonderWallPost[]): string;
```

### 7.4 `lib/wonderwall.ts`

Optional pure domain module if we want state shaping separate from repo. Keep it minimal unless tests need it.

---

## 8. UI design

### 8.1 `/host` Quick Activity card

Modify:

```txt
app/host/HostMenuClient.tsx
```

Add a fourth card:

```txt
WONDERWALL · LINKEDIN POSTS
Collect public LinkedIn post links from the room, approve the ones that can go on air, and project them as native embeds.
▸ START ACTIVITY
```

Recommended route:

```txt
/host/wonderwall/new
```

### 8.2 New wall page

Create:

```txt
app/host/wonderwall/new/page.tsx
```

UX:

- Reuse PRIMETIME header components:
  - `Chyron`
  - `FrameCounter`
  - `Clock`
  - `SmpteBars`
  - `AccountMenu`
- Fields:
  - title, required, max 100
  - description, optional, max 200
  - participant instructions, optional, max 240
- No initial URL textarea in the create page. URLs are submitted from `/play/[pin]/wonderwall` and reviewed in control.
- Submit button: `▶ START WALL`

Copy direction:

```txt
ACTIVITY · WONDERWALL · LINKEDIN POSTS
CURATE THE SIGNAL.
OPEN THE WALL, SHARE THE PIN, AND APPROVE THE LINKEDIN POSTS THAT ARE READY TO GO ON AIR.
```

### 8.3 Control page

Create:

```txt
app/host/wonderwall/[pin]/control/page.tsx
```

Sections:

1. Header:
   - `DIRECTOR · WONDERWALL`
   - PIN
   - post count
   - status
   - account menu
2. Display/open/export controls:
   - copy display link
   - open display via `publicUrl('/host/wonderwall/${pin}/display', window.location.origin)`
   - export submitted data as CSV via `/api/wonderwall/${pin}/export`
   - export button label: `EXPORT SUBMISSIONS CSV`
3. Submission/review tools:
   - pending count
   - optional host add-URL form that still creates a review row before approval
   - validation errors
4. Post list:
   - platform badge: `LINKEDIN`
   - normalized URN
   - original URL
   - submitter name/key when available
   - review/display status
   - `CAN DISPLAY` chip
   - actions: preview/open original, approve/reject, hide/restore, move up/down
5. Optional preview:
   - collapsed iframe preview for one selected post

Avoid rendering dozens of iframes in the control page by default; it will be slow. Use text rows + optional preview.

### 8.4 Display page

Create:

```txt
app/host/wonderwall/[pin]/display/page.tsx
```

Responsibilities:

- Fetch public wall state by PIN.
- Render public projection surface without host controls.
- Render active posts in waterfall layout.
- Listen for refresh events or poll.

Recommended waterfall implementation for v1:

```tsx
<div className="columns-1 md:columns-2 2xl:columns-3 gap-5 [column-fill:_balance]">
  {posts.map((post) => (
    <article key={post.id} className="mb-5 break-inside-avoid ink-border bg-white p-0 overflow-hidden">
      <iframe
        src={post.embedUrl}
        width="504"
        height="700"
        frameBorder="0"
        allowFullScreen
        title="Embedded LinkedIn post"
        className="block w-full bg-white"
      />
    </article>
  ))}
</div>
```

Initial iframe height recommendation:

```txt
700px
```

Why fixed height:

- LinkedIn iframe is cross-origin.
- PRIMETIME cannot inspect the inner document height.
- A fixed height is the simplest reliable v1.

Future enhancement:

```txt
WonderWallPost.size = COMPACT | STANDARD | TALL
```

where the host can choose `560px`, `700px`, or `900px` card height.

---

## 9. Light realtime refresh strategy

### 9.1 Why not full Socket.IO state in v1

Word Cloud and Q&A require rich server-authoritative live state because participants mutate visible content constantly. WonderWall v1 has participant submissions, but the mutation model is still simpler: users only create pending rows, and hosts review them through authenticated HTTP actions. A full in-memory state machine is unnecessary as long as the projector displays only DB-approved rows.

### 9.2 Recommended v1 approach

- Mutations happen through HTTP API routes.
- DB remains source of truth.
- Control page emits a small socket event after successful mutation.
- Display page receives event and refetches `GET /api/wonderwall/[pin]`.

Suggested socket events:

```txt
wonderwall:display:register { pin }
wonderwall:host:register { pin }
wonderwall:refresh { pin }
```

Server behavior:

```txt
wonderwall:display:register → socket.join(`wonderwall:${pin}`)
wonderwall:host:register    → socket.join(`wonderwall:${pin}`)
wonderwall:refresh          → io.to(`wonderwall:${pin}`).emit('wonderwall:refresh', { pin })
```

This can be added to `server.ts` without adding a WonderWall in-memory state machine.

### 9.3 Polling alternative

If we want to avoid touching `server.ts` in the first pass, display can poll every 5–10 seconds.

Recommended if implementing quickly:

```txt
V1A: polling display refresh
V1B: socket refresh event
```

But since PRIMETIME is a live display product, I recommend the socket refresh event.

---

## 10. Auth and route privacy

### 10.1 Protected routes

These require host auth:

```txt
/host/wonderwall/new
/host/wonderwall/[pin]/control
/api/wonderwall/[pin]/posts/[postId]
/api/wonderwall/[pin]/posts/reorder
/api/wonderwall/[pin]/status
/api/wonderwall/[pin]/export
```

These are public-by-PIN / participant-safe:

```txt
/host/wonderwall/[pin]/display
/play/[pin]/wonderwall
/api/wonderwall/[pin]                  # public approved/displayable state only
/api/wonderwall/[pin]/posts            # creates pending submissions only
/api/wonderwall/[pin]/my-posts         # scoped by submitterKey feedback only
```

### 10.2 Public-by-PIN route

This should be public, like other projection views:

```txt
/host/wonderwall/[pin]/display
```

Update `auth.config.ts`:

```ts
export function isPublicHostDisplayPath(pathname: string) {
  return (
    /^\/host\/[^/]+\/display\/?$/.test(pathname) ||
    /^\/host\/wordcloud\/[^/]+\/display\/?$/.test(pathname) ||
    /^\/host\/q-and-a\/[^/]+\/display\/?$/.test(pathname) ||
    /^\/host\/wonderwall\/[^/]+\/display\/?$/.test(pathname)
  );
}
```

Middleware note:

Do **not** blindly add `'/api/wonderwall/:path*'` to the Auth.js middleware if that would protect public submission/status endpoints. Prefer route-level auth inside the host-only API handlers, or add a matcher only for host-only API shapes if Next.js matcher supports the needed specificity. Public endpoints must remain reachable without a host cookie.

### 10.3 Public origin behavior

Use existing helper:

```ts
import { publicUrl } from '@/lib/public-origin';
```

All display links that leave the current browser context must use:

```ts
publicUrl(`/host/wonderwall/${pin}/display`, window.location.origin)
```

Do not hand-roll `window.location.origin + path`.

---

## 11. PIN lookup and `/join`

Recommended v1: **integrate WonderWall with `/join`**, because users need a low-friction way to submit LinkedIn URLs by PIN.

Changes:

```txt
app/api/lookup-pin/route.ts
app/join/page.tsx
app/play/[pin]/wonderwall/page.tsx
```

Behavior:

- `lookup-pin` checks `wonderWallSession` alongside quiz, wordcloud, and Q&A.
- If the PIN is a WonderWall session, `/join` stores the nickname in `sessionStorage` using the existing `bc:nick:${pin}` convention and routes to `/play/[pin]/wonderwall`.
- `/play/[pin]/wonderwall` lets the user paste a LinkedIn post URL.
- Submitted URLs create `PENDING` rows only; they never display before host approval.
- The participant page shows status for that browser's submissions: pending, approved, rejected, failed.
- If rejected/failed, the page gives a clear message and lets the user try another URL.

---

## 12. Implementation tasks

> **For Hermes:** when executing, use `subagent-driven-development` or delegate implementation to Claude Code task-by-task. Preserve current work, create a feature branch, and verify with real commands.

### Task 1 — Create feature branch

**Objective:** Isolate the WonderWall plan/implementation.

**Command:**

```bash
git checkout -b feat/wonderwall-iframe
```

If the branch exists, use it. Do not reset or overwrite unrelated work.

---

### Task 2 — Add parser tests

**Objective:** Lock the LinkedIn URL parser behavior before implementation.

**Create:**

```txt
lib/wonderwall-input.test.ts
```

Test cases:

- feed activity URL parses to `urn:li:activity:<id>`.
- posts `activity-<id>` URL parses to `urn:li:activity:<id>`.
- posts `ugcPost-<id>` URL parses to `urn:li:ugcPost:<id>`.
- posts `share-<id>` URL parses to `urn:li:share:<id>`.
- non-LinkedIn URL rejected.
- LinkedIn profile URL rejected.
- malformed URL rejected.
- generated embed URL equals `https://www.linkedin.com/embed/feed/update/${urn}`.

Run:

```bash
npm test -- lib/wonderwall-input.test.ts
```

Expected first run: fail because implementation does not exist.

---

### Task 3 — Implement parser

**Objective:** Add pure URL parsing/normalization helpers.

**Create:**

```txt
lib/wonderwall-input.ts
```

Exports:

```ts
export type LinkedInPostUrn =
  | `urn:li:activity:${string}`
  | `urn:li:ugcPost:${string}`
  | `urn:li:share:${string}`;

export function parseLinkedInPostUrl(input: string): WonderWallParseResult;
export function toLinkedInEmbedUrl(urn: LinkedInPostUrn): string;
```

Run:

```bash
npm test -- lib/wonderwall-input.test.ts
```

Expected: parser tests pass.

---

### Task 4 — Add Prisma schema and migration

**Objective:** Persist WonderWall sessions/posts.

**Modify:**

```txt
prisma/schema.prisma
```

Add:

- `WonderWallStatus`
- `WonderWallPostStatus`
- `WonderWallSession`
- `WonderWallPost`
- `User.wonderWallSessions`

Run:

```bash
npm run db:migrate -- --name add-wonderwall
```

Expected:

- New migration under `prisma/migrations/*_add_wonderwall/`.
- Prisma client regenerated or ready for `npm run build` to generate.

---

### Task 5 — Extend shared PIN allocator

**Objective:** Prevent WonderWall PIN collisions with quiz, wordcloud, and Q&A.

**Modify:**

```txt
lib/pin-allocator.ts
```

Current allocator checks:

- `gameSession`
- `wordCloudSession`
- `qASession`

Add:

- `wonderWallSession`

Update comments to include WonderWall.

**Modify tests:**

```txt
lib/pin-allocator.test.ts
```

Add coverage that a WonderWall session collision is skipped.

Run:

```bash
npm test -- lib/pin-allocator.test.ts
```

---

### Task 6 — Add repository helpers and tests

**Objective:** Add DB access layer mirroring Word Cloud/Q&A patterns.

**Create:**

```txt
lib/wonderwall-repo.ts
lib/wonderwall-repo.test.ts
```

Helpers:

- `allocatePin()`
- `createSession()`
- `getPublicStateByPin()`
- `getHostStateByPin()`
- `assertHostOwnsSession()`
- `submitPost()`
- `reviewPost()`
- `getPostsForSubmitter()`
- `listPostsForExport()`
- `reorderApprovedPosts()`

Test:

- create session without initial posts.
- submitted posts start as `PENDING` and `canDisplay=false`.
- public state returns only `APPROVED` + `canDisplay=true` ordered posts.
- host state includes pending/rejected/hidden/failed rows for review.
- rejected/failed rows remain available for participant feedback.
- export listing returns all statuses in stable `createdAt ASC, id ASC` order.
- reorder persists positions for approved/displayable posts.
- ownership guard rejects wrong user.

Run:

```bash
npm test -- lib/wonderwall-repo.test.ts
```

---

### Task 7 — Add create API and tests

**Objective:** Let authenticated hosts create WonderWall sessions.

**Create:**

```txt
app/api/wonderwall/route.ts
app/api/wonderwall/route.test.ts
```

Behavior:

- `POST` requires auth.
- Valid body creates a PIN-backed WonderWall session.
- Invalid title rejected.
- Optional description/instructions validated by length.
- Pin allocation failure returns `503`.

Run:

```bash
npm test -- app/api/wonderwall/route.test.ts
```

---

### Task 8 — Add wall fetch/submit/review/reorder APIs

**Objective:** Support control and display pages.

**Create:**

```txt
app/api/wonderwall/[pin]/route.ts
app/api/wonderwall/[pin]/posts/route.ts
app/api/wonderwall/[pin]/posts/[postId]/route.ts
app/api/wonderwall/[pin]/posts/reorder/route.ts
```

Optional tests:

```txt
app/api/wonderwall/[pin]/route.test.ts
app/api/wonderwall/[pin]/posts/route.test.ts
```

Minimum behavior:

- `GET /api/wonderwall/[pin]` returns public-safe state with approved/displayable posts only.
- `POST /posts` is public-by-PIN and creates a `PENDING`/`canDisplay=false` submission.
- invalid/unsupported URLs return user-facing errors so the submitter can try again.
- `PATCH /posts/[postId]` requires host ownership and supports approve/reject/hide/restore.
- approve sets `canDisplay=true`; reject/hide/failed set `canDisplay=false`.
- `POST /posts/reorder` requires ownership and validates approved/displayable IDs.

Run relevant tests.

---

### Task 9 — Add submissions CSV export API and tests

**Objective:** Let hosts download all submitted WonderWall rows from host control as a CSV audit/export file.

**Create:**

```txt
lib/wonderwall-export.ts
lib/wonderwall-export.test.ts
app/api/wonderwall/[pin]/export/route.ts
app/api/wonderwall/[pin]/export/route.test.ts
```

Implementation notes:

- Keep CSV generation in `lib/wonderwall-export.ts` so escaping and formula-injection behavior can be tested as pure functions.
- `GET /api/wonderwall/[pin]/export` requires host auth and wall ownership.
- Use `listPostsForExport({ pin, hostUserId })` so the route exports all statuses in stable order.
- Return `text/csv; charset=utf-8` and attachment filename `wonderwall-${pin}-submissions.csv`.
- Include pending, approved, rejected, hidden, and failed submissions.
- Do not include LinkedIn post content, author/profile data, reactions, comments, or images.

Test cases:

- `escapeCsvCell()` quotes values containing comma, quote, newline, or carriage return.
- `neutralizeSpreadsheetFormula()` prefixes cells starting with `=`, `+`, `-`, `@`, tab, or carriage return.
- route rejects unauthenticated and non-owner requests.
- owner response contains the expected header row and all submitted rows.
- rejected rows include `rejectionReason`; approved rows include `displayOrder`.

Run:

```bash
npm test -- lib/wonderwall-export.test.ts
npm test -- 'app/api/wonderwall/[pin]/export/route.test.ts'
```

---

### Task 10 — Add `/host/wonderwall/new`

**Objective:** Add host creation form.

**Create:**

```txt
app/host/wonderwall/new/page.tsx
```

Implementation notes:

- Client page is acceptable, mirroring Word Cloud/Q&A new pages.
- Use `fetch('/api/wonderwall', { method: 'POST' })`.
- On success:

```ts
router.push(`/host/wonderwall/${data.pin}/control`);
```

Validation:

- title required.
- description optional.
- participant instructions optional.
- No LinkedIn URL textarea on create; submissions happen through `/play/[pin]/wonderwall`.

---

### Task 11 — Add `/host/wonderwall/[pin]/control`

**Objective:** Add host management screen.

**Create:**

```txt
app/host/wonderwall/[pin]/control/page.tsx
```

Implementation notes:

- Fetch host state on mount, including pending/rejected/failed/hidden/approved rows.
- Show a pending review queue first.
- Every row must show an explicit `CAN DISPLAY` flag/chip.
- Approve calls `PATCH /api/wonderwall/[pin]/posts/[postId]` with `{ action: 'approve' }`.
- Reject calls the same endpoint with `{ action: 'reject', reason }`; the participant can see the message and try again.
- Hide/restore approved posts through the same endpoint.
- Reorder can be simple up/down buttons for approved/displayable posts in v1.
- Open display uses `publicUrl()`.
- Add an `EXPORT SUBMISSIONS CSV` button/link that opens `/api/wonderwall/${pin}/export` in the same tab or a download anchor.
- Export must include all submitted rows across statuses, not only currently displayable posts.
- Avoid rendering all iframes by default to keep host surface fast; use an optional single-row preview for review.

---

### Task 12 — Add `/host/wonderwall/[pin]/display`

**Objective:** Render public waterfall display.

**Create:**

```txt
app/host/wonderwall/[pin]/display/page.tsx
```

Implementation notes:

- Public route, no account menu.
- Fetch public state by PIN.
- Render PRIMETIME broadcast frame.
- Render approved/displayable posts in CSS column waterfall.
- Use fixed iframe height, initially `700`.
- Empty state shows PIN/title and “Waiting for approved LinkedIn posts.”
- Pending/rejected/failed submissions must never render here.
- Failed iframe render cannot be reliably detected cross-origin. Provide manual “Open on LinkedIn” link per approved card.

---

### Task 13 — Add participant submission route and `/join` integration

**Objective:** Let users submit LinkedIn URLs by PIN and see whether their submissions are pending, approved, rejected, or failed.

**Create:**

```txt
app/play/[pin]/wonderwall/page.tsx
app/api/wonderwall/[pin]/my-posts/route.ts
```

**Modify:**

```txt
app/api/lookup-pin/route.ts
app/join/page.tsx
```

Implementation notes:

- Extend lookup to return `{ type: 'wonderwall' }` for WonderWall PINs.
- Route `/join` to `/play/[pin]/wonderwall` when the lookup type is `wonderwall`.
- Use `sessionStorage` to keep:
  - `bc:nick:${pin}` for submitter display name.
  - `bc:wonderwall:submitter:${pin}` as an opaque submitter key.
- Participant page form posts to `POST /api/wonderwall/[pin]/posts`.
- On valid URL, show “Submitted for host review.”
- Poll or refresh `GET /api/wonderwall/[pin]/my-posts?submitterKey=...` to show pending/approved/rejected/failed feedback.
- On rejected/failed, show the reason/message and keep the form open so the user can try another URL.

---

### Task 14 — Add route auth/middleware wiring

**Objective:** Make WonderWall routes follow PRIMETIME privacy model.

**Modify:**

```txt
auth.config.ts
# middleware.ts only if a safe matcher can avoid public endpoints
```

Changes:

- Add `/host/wonderwall/[pin]/display` to public-by-PIN display allowlist.
- Keep `/host/wonderwall/new` and `/host/wonderwall/[pin]/control` protected by existing `/host` matcher.
- Do not protect public WonderWall API submission/status endpoints with a blanket `/api/wonderwall/:path*` matcher.
- Enforce host ownership inside host-only API handlers.
- Verify `/api/wonderwall/[pin]/export` is host-only even though `/api/wonderwall/[pin]`, `/posts`, and `/my-posts` are public/participant-safe.

Tests:

```txt
lib/auth-config.test.ts
```

Add coverage:

- display path returns public.
- control/new paths still require auth.
- export API route rejects unauthenticated and non-owner requests.

Run:

```bash
npm test -- lib/auth-config.test.ts
```

---

### Task 15 — Add light realtime refresh

**Objective:** Let display update when host changes the wall without implementing full socket state.

**Modify:**

```txt
server.ts
```

Add event handling:

```txt
wonderwall:host:register
wonderwall:display:register
wonderwall:refresh
```

Minimal server behavior:

```ts
socket.on('wonderwall:display:register', ({ pin }) => {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) return;
  socket.join(`wonderwall:${pin}`);
});

socket.on('wonderwall:host:register', ({ pin }) => {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) return;
  socket.join(`wonderwall:${pin}`);
});

socket.on('wonderwall:refresh', ({ pin }) => {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) return;
  io.to(`wonderwall:${pin}`).emit('wonderwall:refresh', { pin });
});
```

Security note:

- Refresh events are only hints; they do not mutate data, so they are safe if a public display/player also emits one accidentally.
- Data mutations still happen through HTTP routes: public routes can only create pending submissions, while approve/reject/hide/reorder actions require host ownership.

Participant page emits after successful submission so host control can refetch pending rows. Control page emits after approve/reject/hide/restore/reorder so display and participants can refetch public/personal state.

---

### Task 16 — Add `/host` activity card

**Objective:** Expose WonderWall from host dashboard.

**Modify:**

```txt
app/host/HostMenuClient.tsx
```

Add card route:

```txt
/host/wonderwall/new
```

Suggested label:

```txt
WONDERWALL · LINKEDIN POSTS
```

Suggested headline:

```txt
Curate a WonderWall.
```

Suggested body:

```txt
Paste public LinkedIn posts and project them as a waterfall of native embeds for the room.
```

---

### Task 17 — Add docs updates

**Objective:** Make future agents aware of the new route family and constraints.

**Create:**

```txt
docs/wonderwall-prd.md
```

**Modify:**

```txt
PRD.md
README.md
AGENTS.md
DECISIONS.md
```

Specific changes:

- `PRD.md`: Add WonderWall to companion activities.
- `README.md`: Add route rows and “what’s done” bullet once implemented.
- `AGENTS.md`: Add route map and privacy model entries.
- `DECISIONS.md`: Add iframe/no-scraping decision.

This file (`docs/wonderwall-iframe-plan.md`) can either remain as the implementation plan or be superseded by the PRD after review.

---

## 13. Test plan

### 13.1 Unit tests

Run targeted tests as tasks are built:

```bash
npm test -- lib/wonderwall-input.test.ts
npm test -- lib/wonderwall-repo.test.ts
npm test -- lib/wonderwall-export.test.ts
npm test -- lib/pin-allocator.test.ts
npm test -- lib/auth-config.test.ts
```

### 13.2 API tests

Run targeted route tests:

```bash
npm test -- app/api/wonderwall/route.test.ts
npm test -- app/api/wonderwall/[pin]/posts/route.test.ts
npm test -- app/api/wonderwall/[pin]/export/route.test.ts
```

Exact test paths may need adjustment if Vitest does not like bracket-path shell expansion. Quote paths when running manually:

```bash
npm test -- 'app/api/wonderwall/[pin]/posts/route.test.ts'
npm test -- 'app/api/wonderwall/[pin]/export/route.test.ts'
```

### 13.3 Full gates

Before handoff:

```bash
npm run lint
npm test
npm run build
```

If `server.ts` socket events are touched:

```bash
npm run smoke
```

### 13.4 Browser QA

Manual browser verification:

1. Start dev server:

   ```bash
   npm run dev
   ```

2. Sign in.
3. Open `/host`.
4. Confirm WonderWall card appears.
5. Create a wall with title/instructions.
6. Confirm redirect to `/host/wonderwall/[pin]/control`.
7. Open display in a separate/incognito window.
8. Confirm `/host/wonderwall/[pin]/display` works without auth and shows empty/waiting state, not pending submissions.
9. Open `/join`, enter the WonderWall PIN + nickname, and confirm it routes to `/play/[pin]/wonderwall`.
10. Submit 2–3 known public LinkedIn post URLs from the participant page.
11. Confirm host control shows them as `PENDING` with `CAN DISPLAY: NO`.
12. Reject one submission and confirm participant sees the rejection message and can try again.
13. Approve one or more submissions and confirm display updates with only approved iframe cards.
14. Click `EXPORT SUBMISSIONS CSV` in host control and confirm the downloaded CSV includes pending, approved, rejected, hidden/failed rows when present.
15. Confirm rejected rows include `rejectionReason`, approved rows include display order, and no LinkedIn post body/profile content is exported.
16. Hide/restore an approved post and confirm display reflects `canDisplay` changes.
17. Test public-origin link behavior if `NEXT_PUBLIC_SITE_URL` is configured.

---

## 14. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| LinkedIn iframe refuses some posts | Some cards fail/blank | Show clear placeholder + “Open on LinkedIn”; do not scrape fallback. |
| Cross-origin iframe height cannot be measured | Cards may have inner scroll/blank space | Fixed 700px v1; later add compact/standard/tall per post. |
| Many iframes are heavy | Slow projector page | Add post limit; lazy loading if compatible; recommend 12–24 posts per wall for live display. |
| User pastes non-post LinkedIn URL | Confusing failure | Parser gives specific error and examples; participant page invites them to try again. |
| Public display route accidentally protected | Projection breaks through tunnel | Add auth-config tests and browser incognito check. |
| Public submission endpoint accidentally displays content | Moderation breach | Enforce `PENDING` + `canDisplay=false` at creation and display query only `APPROVED` + `canDisplay=true`. |
| CSV export leaks through public API | Privacy/audit data leak | Keep `/api/wonderwall/[pin]/export` host-only with ownership checks; never include it in public-by-PIN allowlists. |
| CSV spreadsheet formula injection | Host opens dangerous cell in spreadsheet app | Prefix dangerous leading characters before CSV quoting and test this helper directly. |
| Future agent tries to scrape LinkedIn | Compliance/maintenance risk | Document no-scraping decision in `DECISIONS.md` and PRD non-goals. |
| Socket refresh event misused | Minor extra refetches | Refresh event is non-mutating; all display-affecting changes still require approved DB state. |

---

## 15. Future enhancements after v1

Do not include these in v1 unless explicitly requested.

1. **Card height controls**
   - compact / standard / tall per post.
2. **Screenshot preview mode**
   - generated static image for dashboard performance/export.
3. **Bulk/moderation power tools**
   - bulk approve/reject, saved rejection templates, duplicate grouping, keyboard shortcuts.
4. **Multi-platform WonderWall**
   - X/Twitter, YouTube, Instagram, TikTok, generic oEmbed where available.
5. **Collections/history**
   - saved reusable walls.
6. **PDF/report export**
   - export a styled wall report with source links and thumbnails if allowed.
7. **Auto-refresh validation**
   - background job to mark broken embeds as failed.
8. **Browser extension/bookmarklet**
   - save LinkedIn posts directly into a wall.

---

## 16. Recommended build order summary

1. Parser + tests.
2. Prisma schema + migration.
3. PIN allocator update.
4. Repo helpers + tests.
5. Create/fetch/submit/review/reorder APIs.
6. CSV export helper + host-only export API.
7. `/host/wonderwall/new`.
8. `/host/wonderwall/[pin]/control`.
9. `/host/wonderwall/[pin]/display`.
10. `/play/[pin]/wonderwall` + `/join` lookup routing.
11. Auth/public display wiring.
12. Light realtime refresh.
13. `/host` Quick Activity card.
14. Docs/DECISIONS updates.
15. Full lint/test/build + browser QA.

---

## 17. Acceptance criteria

A v1 implementation is done when:

- [ ] Host sees WonderWall as a fourth Quick Activity on `/host`.
- [ ] Host can create a wall from `/host/wonderwall/new` with title, description, and participant instructions.
- [ ] `/join` recognizes WonderWall PINs and routes users to `/play/[pin]/wonderwall`.
- [ ] Users can paste supported LinkedIn post URLs from the WonderWall participant page.
- [ ] Submitted URLs create `PENDING` posts with `canDisplay=false`.
- [ ] Host control shows pending submissions and an explicit “Can display?” flag per row.
- [ ] Host can approve, reject with feedback, hide/restore, and reorder approved posts.
- [ ] Host control has an `EXPORT SUBMISSIONS CSV` action that downloads all submitted rows across statuses.
- [ ] CSV export is host-only, includes moderation/review fields, escapes CSV correctly, and neutralizes spreadsheet-formula cells.
- [ ] Rejected/failed submissions never display and users can see feedback and try again.
- [ ] App parses supported LinkedIn post URLs into normalized URNs.
- [ ] App stores only original URL, URN, embed URL, submitter feedback metadata, review/display status, and ordering metadata — no LinkedIn post content.
- [ ] Public display route renders only `APPROVED` + `canDisplay=true` posts in a waterfall iframe layout.
- [ ] Display route is public-by-PIN and works without host auth cookie.
- [ ] No scraping, LinkedIn API, screenshot generation, or LinkedIn post-content storage exists in v1.
- [ ] Invalid/unsupported URLs show clear errors.
- [ ] `npm run lint`, `npm test`, and `npm run build` pass.
- [ ] Browser QA confirms pending posts stay off-display, rejected posts notify the submitter, and approved real public LinkedIn posts render on the display page.
