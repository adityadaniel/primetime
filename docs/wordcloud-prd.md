# Word Cloud — Live Activity PRD

Version: 1.0 · Status: Draft · Last Updated: May 2026 · Owner: Aditya Daniel

Sister document to `PRD.md`. Defines the second activity type in BROADCAST: a live, prompted Word Cloud session — players submit short text responses, the display renders them as a typographic cloud where word size scales by frequency.

---

## 1. Why

### 1.1 Problem
The quiz format is competitive and answer-correct/incorrect. Many academy / workshop / classroom moments call for the opposite: a non-judgmental temperature read of the room. "What's one word for how you're feeling?" "What concept stuck with you most?" "Name a tool you'd recommend." Those don't fit a quiz. Today the host has to leave BROADCAST and use Mentimeter.

### 1.2 Goal
Add Word Cloud as a first-class **standalone live activity** so a host can run a non-quiz prompt without leaving the product. Match Mentimeter's polish on the display side, beat them on price (Free tier gets it; Mentimeter gates word clouds behind paid).

### 1.3 Non-goals (this version)
- Embedding a Word Cloud question inside a quiz flow (deferred)
- Other activity types: open-ended Q&A, polls, ranking, scales (deferred to future activities)
- Multi-language profanity filter beyond what `lib/profanity-filter.ts` already supports
- Host-approval queue for submissions (use auto-filter + trash button instead)
- Persistent/saved word clouds the host can re-run with the same prompt history (defer)

---

## 2. Users & Roles

Same as PRD.md §2. The Host role gains a new entry point ("Start a Word Cloud") on `/host`. Player role unchanged — joins via PIN.

---

## 3. Activity Lifecycle

```
HOST CREATE  →  LOBBY  →  LIVE (collecting)  →  ENDED (frozen)  →  ARCHIVED
```

| Phase | Host can | Player can | Display shows |
|---|---|---|---|
| Create | Set prompt, words-per-player (1-5), tier-aware caps | — | — |
| Lobby | See joiners, copy PIN, start | Join with nickname | PIN + joiner count, BROADCAST identity hero |
| Live | Pause/resume, trash any word, end | Submit up to N words (one at a time, or bulk-edit before send) | Cloud, growing live as words come in |
| Ended | Export CSV, archive | View frozen final cloud | Final cloud + submission count |
| Archived | Browse from /host history | — | — |

Live phase is open-ended — host decides when to end. No countdown, no auto-end.

---

## 4. Functional Requirements

### 4.1 Host — create
- New tile on `/host` dashboard under a "Quick Activities" section: **"Word Cloud"**
- Click → `/host/wordcloud/new` (or modal — implementation choice)
- Form fields:
  - **Prompt** (text, required, max 140 chars). Examples shown as placeholder rotation: "One word for how you're feeling", "Best book you read this year", "Name a tool you can't live without"
  - **Words per player** (slider 1–5, default 3)
  - **Profanity filter** (toggle, default on)
- Submit → server allocates 6-digit PIN (same range as quiz), creates `WordCloudSession` row, redirects to `/host/wordcloud/[pin]/control`

### 4.2 Host — control surface (`/host/wordcloud/[pin]/control`)
Phone or laptop friendly. Three sections:

1. **Header**: prompt (large), PIN (very large, copyable), joiner count
2. **Submissions list** (live-updating): each unique word with its count, sorted desc by count. Each row has a trash button (host-only) that removes the word from the cloud and from all players' "you submitted" view
3. **Controls**: 
   - **Open display** button (pops `/host/wordcloud/[pin]/display` in a new tab)
   - **Pause submissions** toggle (players see "host paused submissions" if they try to submit)
   - **End activity** button (with confirm) → freezes the cloud, transitions to ENDED state
   - **Export CSV** button (after end)

### 4.3 Host — display surface (`/host/wordcloud/[pin]/display`)
Projection-friendly. No host controls visible. Two states:

- **Lobby (no submissions yet)**: BROADCAST hero with prompt centered, PIN at bottom in oversized type, "join at broadcast.[domain]/join" tagline, joiner counter ticking up
- **Live / Ended**: typographic word cloud filling the frame. Word size scales by submission count using a perceptual scale (sqrt or log, not linear — prevents one runaway word from dwarfing the others). BROADCAST color palette: ink-on-bone, occasional accent ink-pink for the top word. Words arrange via a deterministic algorithm seeded on the session ID so the layout is stable across re-renders. New submissions animate in with a soft fade + scale-up. Ended state replaces the live ticker with a "FINAL" mark and submission total

Hard requirements:
- Readable from the back of a 30-person room (matches PRD.md projection rules)
- BROADCAST identity exact match — heavy serif display, ink-bleed accents, no purple gradient
- 60fps animations during normal load (≤200 unique words). Above 200 unique words, gracefully drop animation, render static layout updates only.

### 4.4 Player — join + submit (`/play/[pin]` and `/play/[pin]/wordcloud`)
- Join flow identical to quiz: enter PIN at `/join`, then nickname, land in lobby
- During lobby: see "Waiting for host to start" + the prompt
- During live: form with one text input + submit button. After submitting word #1, form resets, ticker shows "1 of 3 sent" and a list of their own submissions. After max words: "You've sent your 3 words. The cloud is filling up — watch the display!"
- Each submission goes through:
  - Client-side: max 30 chars, trim whitespace, no leading/trailing punctuation, single line
  - Server-side: profanity filter (if enabled), dedupe within this player's history (don't let one player spam the same word to inflate count), light normalization (lowercase, strip diacritics for clustering — but display preserves original casing of the most-popular variant)
- If host pauses: form disabled with message "Host paused submissions"
- If host ends: form replaced with frozen view of the player's submitted words + "Activity ended"

### 4.5 Profanity filter + host trash
- Reuse `lib/profanity-filter.ts` from MID-60. Word fails filter → server rejects with toast on client ("Try a different word")
- Host trash button on control surface removes word from all players' clients via socket broadcast. Removal is permanent — re-submitting the same word from another player still works (filter doesn't blocklist)
- Trash action is logged (`WordCloudModeration` table: timestamp, host user id, word, reason: "trash"). Future-proofing for moderation review.

### 4.6 Aggregation rules
- Words clustered case-insensitively, accents stripped, leading/trailing punctuation removed
- Display variant = most popular original casing (so "Excited" beats "EXCITED" if more people typed the title-case version)
- Counts are cluster counts (singular-plural NOT auto-merged for v1 — too risky linguistically; revisit if users complain)

### 4.7 Tier gating
- **Free**: 50 concurrent players (matches quiz cap), unlimited submissions per word, full CSV export, BROADCAST watermark on display
- **Pro**: 200 concurrent players (matches quiz cap), no watermark, archive history
- Both tiers get profanity filter + trash button + every other feature in this PRD. Word Cloud is **not** Pro-gated as a feature.

---

## 5. Data Model

```prisma
model WordCloudSession {
  id              String   @id @default(cuid())
  pin             String   @unique
  prompt          String   @db.VarChar(200)
  wordsPerPlayer  Int      @default(3)
  profanityFilter Boolean  @default(true)
  hostUserId      String?
  hostUser        User?    @relation(fields: [hostUserId], references: [id])
  status          WordCloudStatus @default(LOBBY)
  createdAt       DateTime @default(now())
  startedAt       DateTime?
  endedAt         DateTime?

  players      WordCloudPlayer[]
  submissions  WordCloudSubmission[]
  moderation   WordCloudModeration[]

  @@index([hostUserId])
  @@index([status])
}

enum WordCloudStatus { LOBBY LIVE PAUSED ENDED ARCHIVED }

model WordCloudPlayer {
  id        String   @id @default(cuid())
  sessionId String
  session   WordCloudSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  nickname  String
  joinedAt  DateTime @default(now())
  submissions WordCloudSubmission[]

  @@unique([sessionId, nickname])
}

model WordCloudSubmission {
  id          String   @id @default(cuid())
  sessionId   String
  session     WordCloudSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  playerId    String
  player      WordCloudPlayer  @relation(fields: [playerId], references: [id], onDelete: Cascade)
  rawText     String   @db.VarChar(40)
  normalized  String   @db.VarChar(40)
  removed     Boolean  @default(false)
  removedAt   DateTime?
  createdAt   DateTime @default(now())

  @@index([sessionId, normalized])
  @@index([sessionId, removed])
}

model WordCloudModeration {
  id         String   @id @default(cuid())
  sessionId  String
  session    WordCloudSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  hostUserId String?
  word       String
  reason     String   // "trash" | "filter"
  createdAt  DateTime @default(now())
}
```

User model gains `wordCloudSessions WordCloudSession[]` back-ref (no schema change, just relation).

---

## 6. Socket Protocol

Same Socket.IO server as quiz. Different namespace prefix: `wordcloud:*`.

### Client → server
| Event | Payload | Auth |
|---|---|---|
| `wordcloud:host:create` | `{ prompt, wordsPerPlayer, profanityFilter }` | host JWT |
| `wordcloud:host:start` | `{ pin }` | host JWT, must own |
| `wordcloud:host:pause` | `{ pin, paused: boolean }` | host JWT |
| `wordcloud:host:trash` | `{ pin, normalized }` | host JWT |
| `wordcloud:host:end` | `{ pin }` | host JWT |
| `wordcloud:player:join` | `{ pin, nickname }` | none |
| `wordcloud:player:submit` | `{ pin, word }` | session player |

### Server → all
| Event | Payload | Notes |
|---|---|---|
| `wordcloud:state` | `{ pin, status, prompt, wordsPerPlayer, joinerCount, words: [{ display, normalized, count }] }` | full state, sent on join + after material change |
| `wordcloud:word:added` | `{ normalized, display, count }` | delta — for animation triggers |
| `wordcloud:word:removed` | `{ normalized }` | host trash broadcast |
| `wordcloud:player:joined` | `{ nickname }` | for joiner ticker |
| `wordcloud:status:changed` | `{ status }` | LOBBY → LIVE → PAUSED → ENDED |

### Server → single player
| Event | Payload | Notes |
|---|---|---|
| `wordcloud:player:accepted` | `{ playerId, submissionsRemaining }` | post-join |
| `wordcloud:player:rejected` | `{ reason: "filter" \| "duplicate" \| "max_reached" \| "paused" }` | post-submit |
| `wordcloud:player:my-submissions` | `{ words: [...] }` | for player's own ticker |

Cap enforcement, rate limiting (max 1 submit per 800ms per player), and reconnect grace all reuse the patterns from quiz socket handlers.

---

## 7. Routes

```
/host                              Dashboard — adds "Quick Activities" section with Word Cloud tile
/host/wordcloud/new                Create form (or modal)
/host/wordcloud/[pin]/control      Host control surface
/host/wordcloud/[pin]/display      Projection display
/host/wordcloud/[pin]/answers.csv  CSV export (after end)
/play/[pin]                        Existing PIN lookup — routes to wordcloud or quiz based on session type
/play/[pin]/wordcloud              Player submit surface
/host/wordcloud                    History list (Pro only — Free has no archive)
```

The unified `/play/[pin]` PIN lookup route checks session type, redirects to `/play/[pin]/wordcloud` if it's a word cloud activity. This keeps the `/join` flow identical for players (PIN → nickname → activity, no need to know in advance what kind of activity it is).

---

## 8. Visual / Identity (BROADCAST)

The display surface is the marquee. References:
- Heavy serif as the primary type (matches quiz title screens)
- Color palette: ink (#0F0F0F), bone (#F5F1E8), ink-pink accent (sparingly), one secondary ink-blue for variety on >50-word clouds
- Font scale: perceptual sqrt scale, smallest word at 24px, largest at 200px on a 1080p projection
- Layout: not a literal cloud — more an editorial "headline pile" arrangement. Largest words near horizontal center, smaller words spiraling out with controlled rotation (max ±15°, never vertical). Rotate-by-frequency-bucket so similar-sized words share an angle and feel like a typeset block, not random rotation
- Animation: word arrives with 200ms ease-out scale from 0.7 to 1.0 + opacity 0 to 1. Frequency bumps animate the existing word's font-size with a 300ms ease-in-out tween
- BROADCAST watermark on Free tier: discreet, bottom-right, "BROADCAST" in caps, 14px, 50% opacity. On Pro, watermark hidden

DESIGN.md gets a new section "Word Cloud" appended documenting this. Don't modify existing DESIGN.md content.

---

## 9. Acceptance Criteria (PRD-level, not per-ticket)

- Host can go from `/host` to a running word cloud in under 90 seconds
- Player can join via PIN and submit a word in under 15 seconds (excluding nickname entry)
- Display reads cleanly from 8m back at 1080p projector — biggest word fully readable
- Profanity filter blocks the standard test list (existing `profanity-filter.ts` tests cover this)
- Host trash button removes word from all connected clients within 500ms
- 50-player Free tier × 3 words = 150 submissions handled without lag (matches quiz cap testing)
- 200-player Pro tier × 3 words = 600 submissions handled without lag
- CSV export contains all submissions (including trashed ones, marked as removed) with timestamp + nickname
- Smoke test extension: at least 3 new scenarios (host create, player submit, host trash)
- BROADCAST identity preserved across all 4 surfaces (host create, control, display, player)
- Mobile-friendly host control (works on phone)
- TypeScript strict, Vitest coverage on new game-logic helpers, smoke green

---

## 10. Future / Deferred

- **Embedded Word Cloud question inside a quiz** — natural fast-follow once standalone is validated
- **Q&A activity** (similar pattern, no aggregation, just live questions with upvotes)
- **Multiple-choice live poll** (same shape as quiz question but without scoring)
- **Word cloud templates / saved prompts** for hosts who run the same prompt repeatedly
- **Multi-language profanity filter** if real users hit gaps
- **Word cloud session history with playback** (replay submissions in order, useful for debriefing)
- **Anonymous mode** — current default is nickname-required; some hosts may want fully anonymous

These are not blockers for shipping standalone Word Cloud.

---

## 11. Open questions (resolved before kickoff)

- ~~Standalone vs. embedded vs. both?~~ → Standalone first
- ~~How many words per player?~~ → 3 default, slider 1–5
- ~~Profanity moderation approach?~~ → Filter + host trash button (no approval queue)
- ~~Tier gating?~~ → Free + Pro both, capped on player count only
- ~~Display polish level?~~ → Polished typographic, BROADCAST identity match
- ~~Socket plumbing?~~ → Same Socket.IO server, `wordcloud:*` namespace
