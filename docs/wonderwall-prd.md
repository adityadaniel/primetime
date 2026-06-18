# WonderWall — LinkedIn iframe PRD

Version: 1.0 · Status: Implemented · Last Updated: June 2026 · Owner: Aditya Daniel

Sister document to `PRD.md`, `docs/wordcloud-prd.md`, and `docs/q-and-a-prd.md`. Defines the fourth standalone activity type in PRIMETIME: a moderated wall of public LinkedIn posts rendered with official LinkedIn iframe embeds, reusing PRIMETIME's existing PIN / host / player / display architecture.

The implementation plan that drove the build lives in `docs/wonderwall-iframe-plan.md`. This PRD is the concise product/behavior reference aligned to the shipped code.

---

## 1. Why

### 1.1 Problem

Live sessions often want to surface what the room is already saying on LinkedIn — talks, launches, takeaways — on the projector. Doing that by hand means copy-pasting links, screenshotting posts, or eyeballing a feed. Hosts need a low-friction way to collect public LinkedIn post links from the room and project the good ones, without giving the audience direct control of the screen.

### 1.2 Goal

Let a host open a PIN-backed wall, let participants submit public LinkedIn post URLs, review each submission, and project only approved posts as native LinkedIn iframe embeds in a waterfall layout — alongside Quiz, Word Cloud, and Q&A.

### 1.3 Non-goals (v1)

- No scraping LinkedIn pages or logged-in/headless automation.
- No LinkedIn API integration.
- No screenshot generation or screenshot fallback when an embed fails.
- No storing LinkedIn post content (body, author, profile, reactions, comments, images).
- No unmoderated participant submissions — every link flows through a host review queue.
- No AI summarization/OCR, no automatic feed syncing.
- No generalized multi-platform support yet (the name and data model leave room for it).

---

## 2. Roles

| Role | Description |
|------|-------------|
| Host | Creates a wall, reviews submissions, approves/rejects/hides/reorders posts, exports the audit CSV. Requires a host session. |
| Participant | Joins by PIN, pastes public LinkedIn post URLs, sees per-submission feedback. No account required. |
| Audience | Views the public display projection by PIN. No account required. |

---

## 3. Route map

| Route | Who | Auth | Purpose |
|---|---|---|---|
| `/host/wonderwall/new` | Host | Protected | Create a wall (title, description, participant instructions) |
| `/host/wonderwall/[pin]/control` | Host | Protected | Review queue: approve/reject/hide/restore/reorder, export CSV, open display |
| `/host/wonderwall/[pin]/display` | Audience | Public-by-PIN | Waterfall projection of approved iframe posts |
| `/play/[pin]/wonderwall` | Participant | Public-by-PIN | Paste LinkedIn URLs, see pending/approved/rejected/failed feedback |

API routes:

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/wonderwall` | `POST` | Host | Create a PIN-backed wall |
| `/api/wonderwall/[pin]` | `GET` | Public-by-PIN | Public state — `APPROVED` + `canDisplay=true` posts only |
| `/api/wonderwall/[pin]/posts` | `POST` | Public-by-PIN | Participant submission — creates a `PENDING` row only |
| `/api/wonderwall/[pin]/posts/[postId]` | `PATCH` | Host (owner) | `approve` / `reject` / `hide` / `restore` |
| `/api/wonderwall/[pin]/posts/reorder` | `POST` | Host (owner) | Reorder approved/displayable posts |
| `/api/wonderwall/[pin]/my-posts` | `GET` | Public-by-PIN | Per-browser submission feedback, scoped by `submitterKey` |
| `/api/wonderwall/[pin]/export` | `GET` | Host (owner) | CSV of all submissions across statuses |

`/join` and `/api/lookup-pin` recognize WonderWall PINs and route participants to `/play/[pin]/wonderwall`.

---

## 4. Public / private / auth model

WonderWall follows PRIMETIME's "classify by product role, not path prefix" rule (see `DECISIONS.md` 2026-06-09 and `docs/live-origin-auth.md`).

**Protected (host session required):**

- `/host/wonderwall/new`
- `/host/wonderwall/[pin]/control`
- `POST /api/wonderwall`
- `PATCH /api/wonderwall/[pin]/posts/[postId]`
- `POST /api/wonderwall/[pin]/posts/reorder`
- `GET /api/wonderwall/[pin]/export`

**Public-by-PIN (must work without a host cookie):**

- `/host/wonderwall/[pin]/display`
- `/play/[pin]/wonderwall`
- `GET /api/wonderwall/[pin]` (approved/displayable state only)
- `POST /api/wonderwall/[pin]/posts` (creates `PENDING` rows only)
- `GET /api/wonderwall/[pin]/my-posts` (feedback scoped by opaque `submitterKey`)

The display route is allowlisted in `auth.config.ts:isPublicHostDisplayPath()`. Host-only API routes are **not** protected by a blanket `/api/wonderwall/:path*` middleware matcher — that would break the public submission and display endpoints. Instead, host-only handlers enforce auth and ownership at the route level (e.g. the export route calls `auth()` then `listPostsForExport({ pin, hostUserId })`, which re-checks ownership in the repo: missing wall → 404, wrong host → 403).

`submitterKey` is a convenience correlation key stored in `sessionStorage` per browser, not a security boundary. The public `my-posts` payload is deliberately minimal (no `submitterName`, `submitterKey`, `position`, `reviewedByHostUserId`, or embed URL).

---

## 5. Display invariant

The projector renders **only posts where `status = APPROVED` and `canDisplay = true`, ordered by `position`.**

- Parsing a URL into a valid embed means "technically understood" — never "safe to display". The `canDisplay` gate lives in the data model, not the parser.
- `getPublicStateByPin()` queries `where: { status: 'APPROVED', canDisplay: true }` and types the returned posts as `status: 'APPROVED'` / `canDisplay: true` literals, so pending/rejected/hidden/failed rows cannot leak onto the projector even by accident.
- The empty state shows the PIN/title and "Waiting for approved LinkedIn posts."

### Post status semantics

| Post status | `canDisplay` | Meaning |
|---|---:|---|
| `PENDING` | `false` | Submitted, waiting for host review. Never displayed. |
| `APPROVED` | `true` | Host approved; appears on display in `position` order. |
| `REJECTED` | `false` | Host rejected; submitter sees feedback and can try again. |
| `HIDDEN` | `false` | Previously approved, temporarily pulled from display (position kept for restore). |
| `FAILED` | `false` | Determined unable to become a supported embed. |

Session lifecycle enum `WonderWallStatus` is `DRAFT` / `LIVE` / `ENDED` / `ARCHIVED`; walls are created as `DRAFT` and can display immediately.

---

## 6. Data model

`prisma/schema.prisma` adds `WonderWallSession` and `WonderWallPost` (plus `User.wonderWallSessions`). PRIMETIME stores **only**:

- original submitted URL,
- normalized LinkedIn URN,
- generated embed URL,
- submitter display name + opaque submitter key (for feedback correlation),
- review/display status and `canDisplay`,
- `position` ordering,
- optional `rejectionReason` / `failureReason`,
- review metadata (`reviewedAt`, `reviewedByHostUserId`).

It does **not** store LinkedIn post body, author/profile data, reactions, comments, or images.

Input limits (`lib/wonderwall-limits.ts`): title ≤ 100, description ≤ 200, instructions ≤ 240. Per-wall submission cap: `WONDERWALL_POST_LIMIT = 100` in `lib/wonderwall-repo.ts`.

---

## 7. URL normalization

`lib/wonderwall-input.ts` is pure (no network, no LinkedIn API, no Prisma). It accepts only:

- protocol `https:`,
- hostnames `linkedin.com` / `www.linkedin.com` (no arbitrary subdomains),
- post identifiers of type `activity`, `ugcPost`, or `share`, from either
  `/feed/update/urn:li:<type>:<digits>` or `/posts/<vanity>_<type>-<digits>-<suffix>`.

Normalized URN → embed URL: `https://www.linkedin.com/embed/feed/update/${urn}`.

Profile/company/search/feed-home URLs are rejected with explicit reason codes (`invalid_url`, `unsupported_protocol`, `unsupported_host`, `unsupported_linkedin_url`, `missing_post_id`) for participant-facing copy.

---

## 8. CSV export — scope and safety

Host-only audit/moderation export (`GET /api/wonderwall/[pin]/export`, `lib/wonderwall-export.ts`):

- **Scope:** **all** submitted rows across **every** status (`PENDING`, `APPROVED`, `REJECTED`, `HIDDEN`, `FAILED`), sorted `createdAt ASC, id ASC` for a stable log — not only displayed posts.
- **Auth:** host session + wall ownership, re-checked in the repo. Unauthenticated → 401, non-owner → 403, missing wall → 404. This is the only WonderWall read endpoint that is not public-by-PIN; it is never added to a public allowlist.
- **Columns:** `submittedAt, status, canDisplay, originalUrl, urn, embedUrl, submitterName, submitterKey, reviewedAt, reviewedByHostUserId, rejectionReason, displayOrder, failureReason`. `displayOrder` is the `position` only for displayable rows; blank otherwise.
- **No post content:** the export carries only URL/URN/embed/review metadata — never LinkedIn post body, author/profile data, reactions, comments, or images (PRIMETIME does not store those).
- **Safety:** RFC 4180 escaping (cells with comma/quote/CR/LF are quoted, embedded quotes doubled); CRLF-delimited and CRLF-terminated. Spreadsheet formula-injection is neutralized — a cell starting with `=`, `+`, `-`, `@`, tab, or CR is prefixed with a single quote before quoting. Response is `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="wonderwall-${pin}-submissions.csv"`, `Cache-Control: no-store`.

---

## 9. Flows

### 9.1 Host

```txt
/host → WonderWall card
/host/wonderwall/new            create wall (title + optional description/instructions)
POST /api/wonderwall            allocate PIN
/host/wonderwall/[pin]/control  review pending submissions, approve/reject/hide/restore,
                                reorder approved posts, EXPORT SUBMISSIONS CSV, open display
/host/wonderwall/[pin]/display  public projection of approved iframe posts only
```

Each control row states `CAN DISPLAY: YES/NO` explicitly so the host never guesses whether a post is on air. The control surface uses text rows plus an optional single-row iframe preview rather than rendering every embed at once.

### 9.2 Participant

```txt
/join → enter WonderWall PIN + nickname → /play/[pin]/wonderwall
POST /api/wonderwall/[pin]/posts        paste a public LinkedIn URL → PENDING
GET  /api/wonderwall/[pin]/my-posts     poll feedback for this browser's submissions
```

Feedback states: `PENDING` (waiting for approval), `APPROVED` (may appear on display), `REJECTED` (shows host reason; try another URL), `FAILED` (unsupported URL; try again). Unsupported URLs return a reason code and do not create a displayable post.

---

## 10. Realtime refresh

v1 ships a light polling refresh, not a Socket.IO state machine. The display client calls `router.refresh()` on an interval (8 s) so newly approved posts appear without a manual reload; the participant page polls `my-posts` for feedback. Because the DB is the source of truth and the public query only returns approved/displayable rows, a stale poll can never display unapproved content. A socket-driven refresh event was scoped (plan §9, MID-405) but the shipped v1 uses polling; `server.ts` has no WonderWall events.

---

## 11. Compliance boundary

1. Only public LinkedIn post URLs supplied by participants/host.
2. Rendered via LinkedIn-hosted iframe embeds.
3. No scraping, no logged-in automation, no LinkedIn API, no screenshot fallback.
4. Store only URL/URN/embed/review metadata — never post content.
5. Always keep a path back to LinkedIn ("OPEN ON LINKEDIN" per approved card). A blank/failed cross-origin iframe is not auto-detected; the manual link is the graceful path.

See `DECISIONS.md` (2026-06-19 WonderWall iframe entry) for the durable record.
