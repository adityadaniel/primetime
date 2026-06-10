# Q&A — Live Activity PRD

Version: 1.0 · Status: Draft · Last Updated: June 2026 · Owner: Aditya Daniel

Sister document to `PRD.md` and `docs/wordcloud-prd.md`. Defines the third activity type in PRIMETIME: a live audience Q&A session inspired by Slido, adapted to PRIMETIME's vintage broadcast identity and existing PIN / host / player / display architecture.

---

## 1. Why

### 1.1 Problem

Live sessions need more than quizzes and word clouds. Hosts often need to collect questions from a room, let the audience surface the most relevant ones, and answer them without losing control of the session. Today that use case pushes hosts out of PRIMETIME into Slido or Mentimeter.

### 1.2 Goal

Add Q&A as a first-class standalone live activity so a host can collect, moderate, prioritize, present, answer, and archive audience questions inside PRIMETIME.

The experience should match Slido's useful interaction model while feeling native to PRIMETIME:

- low-friction audience join via PIN, link, or QR code
- anonymous or named questions
- upvotes as the default prioritization mechanic
- optional moderation before questions go live
- host highlighting of the current question on the room display
- archive / answered states so the host can keep the board clean
- labels for organizing questions by topic or segment
- written host replies for questions that are not answered live

### 1.3 Non-goals for v1

- Embedding Q&A inside a quiz question sequence
- Free-form chat room
- Speaker hand-raise / live audio queue
- AI summarization, auto-merge, or semantic duplicate detection
- Multi-room Q&A routing across simultaneous tracks
- Anonymous identity de-anonymization for admins
- Full analytics dashboard beyond export/session evidence
- Slack/Teams/Webex integration

---

## 2. Users & Roles

Same base roles as `PRD.md`.

| Role | Description |
|---|---|
| Host | Creates and runs the Q&A session, configures privacy/moderation, presents and answers questions |
| Co-host / moderator | Optional future role that can approve, dismiss, label, reply, highlight, and archive questions |
| Participant | Joins via PIN/link/QR, submits questions, votes on questions, optionally replies if enabled |
| Audience viewer | Watches the projection display without controlling the session |

For v1, the existing authenticated host is enough. Co-host can be modeled in product language but may remain a future permission expansion unless the existing host-session model already supports it.

---

## 3. Activity Lifecycle

```txt
HOST CREATE → OPEN / COLLECTING → LIVE DISCUSSION → CLOSED → ARCHIVED
```

| Phase | Host can | Participant can | Display shows |
|---|---|---|---|
| Create | Configure title, privacy, moderation, labels, voting, character limit | — | — |
| Open / collecting | Share PIN/link/QR, review questions, approve/dismiss if moderated | Join, submit, upvote, optionally label/reply | Join instructions, question count, highlighted/latest/top questions |
| Live discussion | Highlight current question, reply, mark answered, archive, filter/sort | Submit/upvote unless closed, follow highlighted question | Highlighted question, top queue, labels/filter banner |
| Closed | Stop new questions, optionally stop voting, continue answering existing questions | View/upvote unless voting closed | Questions closed state, existing/highlighted questions |
| Archived | Export, review answered/archived/dismissed questions | View final public board if shared | Final / ended state |

Q&A is open-ended. There is no countdown and no automatic end. Host decides when to close submissions and when the session is finished.

---

## 4. Functional Requirements

### 4.1 Host — create Q&A

Entry points:

- `/host` dashboard gets a new Quick Activity card: **Audience Q&A**.
- Card opens `/host/q-and-a/new`.

Create form fields:

- **Session title**: required, max 100 characters. Example: `Ask us anything`.
- **Description / prompt**: optional, max 200 characters. Example: `Questions for the end of the workshop`.
- **Participant privacy**:
  - `Anonymous by default`
  - `Always anonymous`
  - `Named by default`
  - `Name required`
- **Moderation**: default off. When on, every incoming question waits for host approval before it appears publicly.
- **Participant replies**: default off. When on, participants can reply in a thread under live questions.
- **Labels**: optional list of host-defined labels. Host can decide per label whether participants may select it.
- **Downvotes**: default off. When on, popularity score = upvotes - downvotes.
- **Question character limit**: default 280 characters. Professional-style controls can allow 140 / 280 / 500 characters later.

Submit behavior:

- Server allocates a unique six-digit PIN using the same collision rules as other live activities.
- Session starts in `OPEN` state.
- Host lands on `/host/q-and-a/[pin]/control`.

### 4.2 Host — control surface

Route candidate: `/host/q-and-a/[pin]/control`

Host control surface sections:

1. **Session header**
   - title / prompt
   - large PIN
   - copyable join link
   - QR code
   - participant count
   - question count by state: live, in review, answered, archived
   - open display button

2. **Incoming / in-review queue** when moderation is enabled
   - pending question text
   - submitted name or anonymous marker
   - timestamp
   - approve button
   - dismiss button
   - private reply button
   - bulk approve / dismiss for selected questions

3. **Live question board**
   - question text
   - author display: participant name or anonymous
   - score / upvote count
   - reply count if replies enabled
   - label chips
   - state markers: highlighted, answered, archived
   - actions: highlight, reply, label, edit text, mark answered, archive

4. **Filters and sorting**
   - sort by popular
   - sort by recent
   - sort by oldest
   - filter by label
   - search question text across live and in-review questions

5. **Session controls**
   - close / reopen new questions
   - close / reopen voting if enabled by plan/scope
   - end session
   - export CSV after or during session

Host must be able to run the session from Host mode without opening Present mode, but Present mode should be optimized for the room display.

### 4.3 Host — question actions

#### Highlight

Host highlights the question currently being answered.

Behavior:

- Only one highlighted question at a time.
- Highlighted question is emphasized in host mode, participant mode, and display mode.
- Display mode can show the highlighted question fullscreen-style using PRIMETIME broadcast composition.

#### Mark answered

Host marks a question as answered.

Behavior:

- Question moves out of the live board.
- Question enters archive with status `ANSWERED`.
- Question no longer appears in participant live queue.
- Question remains visible to the original author if it has a host reply.
- Host can restore it later.

#### Archive

Host archives a question without marking it answered.

Behavior:

- Question leaves live participant/display view.
- Question remains in host archive as `ARCHIVED`.
- Host can restore it.

#### Dismiss

Only applies to moderated questions.

Behavior:

- Question never becomes public.
- It moves to archive as `DISMISSED`.
- Host can restore it back to `IN_REVIEW`.
- If host sent a private reply first, the submitter can still see that reply.

#### Edit

Host can edit a participant-submitted question before or after approval.

Use cases:

- typo cleanup
- removing duplicated punctuation
- shortening a question for projection readability

Editing must preserve the original text in audit/export metadata if feasible.

#### Label

Host can assign one or more labels to a question.

Labels can be created from settings or on the fly during the session.

#### Reply

Host can add a written reply up to 1,000 characters.

Reply visibility:

- reply to live question: public to participants
- reply to in-review question: private to submitter until approved
- if a privately replied in-review question is approved, the reply becomes public
- host can edit own replies

### 4.4 Participant — join and identity

Participants join through the existing `/join` flow using the Q&A PIN.

Join behavior:

- If privacy is `Name required`, participant must enter a display name.
- If privacy is `Named by default`, participant is prompted for a display name but can switch to anonymous.
- If privacy is `Anonymous by default`, participant can submit anonymously unless they switch to named.
- If privacy is `Always anonymous`, no name is shown publicly and the participant cannot switch to named.

Anonymous means anonymous to the host and export, not merely hidden from other participants. Do not build admin de-anonymization.

### 4.5 Participant — submit question

Route candidate: `/play/[pin]/q-and-a`

Participant UI:

- title / prompt
- question input
- remaining character count
- anonymous/named toggle if allowed
- label selector if participant-visible labels exist
- submit button
- success state after submission
- personal list of questions they submitted

Submission behavior:

- Trim whitespace.
- Reject empty questions.
- Enforce character limit client-side and server-side.
- Submit optimistically with clear local feedback.
- If moderation is off, question appears live immediately.
- If moderation is on, participant sees `Waiting for review`.
- Participant can withdraw their own question while it is pending/live.
- Participant can edit their own question for a short window after approval; edited approved questions return to review if moderation is enabled.

### 4.6 Participant — vote

Participants can upvote live questions.

Rules:

- One upvote per participant per question.
- Participant can remove their upvote.
- Participant cannot upvote their own question if that creates poor incentives; decide explicitly during implementation.
- Upvotes are core and should not be disabled in v1.

If downvotes are enabled:

- one downvote per participant per question
- participant cannot both upvote and downvote the same question
- displayed score is cumulative unless separate counts are implemented

### 4.7 Participant — sort, filter, and topics

Participant default view:

- sorted by popularity

Participant can switch to:

- recent

If labels are visible:

- participant can filter by label

Auto-generated topics are deferred for v1 unless cheap to add. Slido’s topic model requires enough question volume and English text; PRIMETIME v1 should prefer host labels first.

### 4.8 Participant replies

If participant replies are enabled:

- each live question can have a thread
- participants can view and add replies in participant mode
- replies do not appear in projection display
- replies follow the same character limit as questions unless configured separately
- host can archive/remove inappropriate replies if moderation tools are present

If moderation is enabled, replies may either:

- go live immediately, or
- require review like questions

Implementation must choose one behavior and document it.

### 4.9 Display / Present mode

Route candidate: `/host/q-and-a/[pin]/display`

Display mode is projection-first and must preserve PRIMETIME’s vintage broadcast identity.

States:

1. **Join / collecting state**
   - title / prompt
   - oversized PIN
   - join URL
   - QR code
   - participant count
   - live question count

2. **Question board state**
   - top questions by current Present-mode sort/filter
   - large readable typography
   - upvote score
   - label chips if enabled
   - latest question may appear as a small ticker if enabled

3. **Highlighted question state**
   - highlighted question dominates the frame
   - label / score / author marker shown only if useful
   - no dense controls
   - fullscreen-compatible composition

4. **Closed / ended state**
   - clear `Questions closed` or `Q&A ended` mark
   - existing highlighted or top questions may remain visible

Display controls:

- Host can sort Present mode by popular / recent / oldest.
- Host can filter Present mode by label.
- Host can configure number of visible questions: default 4, max 6.
- Host can hide latest-question ticker.
- Host can make highlighted question fullscreen.

### 4.10 Close Q&A and close voting

Host can close new questions.

When Q&A is closed:

- participants cannot submit new questions
- participants can still view existing questions
- participants can still vote unless voting is also closed
- host can continue highlighting, replying, answering, and archiving
- host can reopen new questions

If voting is closed:

- participants cannot upvote/downvote
- participant view shows `Questions and voting closed`
- host can reopen voting if session is not ended

### 4.11 Export

Host can export Q&A data as CSV.

Export fields:

- question id
- public question text
- original question text if edited
- submitted at
- approved at
- answered / archived / dismissed at
- state
- author display name or anonymous marker
- privacy mode
- score
- upvotes
- downvotes if enabled
- labels
- host replies
- participant reply count

Anonymous questions must remain anonymous in export.

---

## 5. Data Model Direction

Exact schema can change during implementation, but v1 likely needs durable persistence for sessions, questions, votes, labels, replies, and moderation history.

Candidate model names:

```prisma
model QASession
model QAQuestion
model QAVote
model QALabel
model QAQuestionLabel
model QAReply
model QAModerationEvent
model QAParticipant
```

Core enums:

```prisma
enum QASessionStatus { OPEN CLOSED ENDED ARCHIVED }
enum QAQuestionStatus { IN_REVIEW LIVE ANSWERED ARCHIVED DISMISSED WITHDRAWN }
enum QAPrivacyMode { ANONYMOUS_BY_DEFAULT ALWAYS_ANONYMOUS NAMED_BY_DEFAULT NAME_REQUIRED }
enum QAVoteType { UP DOWN }
```

Persistence principles:

- Host-controlled state is server authoritative.
- Vote counts are derived from votes or updated atomically; avoid trusting client counts.
- Anonymous mode must not expose submitter identity through host UI or export.
- Moderation events should preserve enough history to explain why a question disappeared.
- Labels should be session-scoped for v1.

---

## 6. Realtime Events Direction

Reuse the existing Socket.IO architecture and PIN routing where possible.

Expected event groups:

- participant joins Q&A session
- participant submits question
- participant edits/withdraws own question
- participant upvotes/downvotes question
- participant replies to question
- host approves/dismisses question
- host highlights question
- host marks answered / archives / restores question
- host updates labels
- host closes/reopens questions
- host closes/reopens voting
- host changes display sort/filter/settings

Realtime requirements:

- Participants should receive immediate local feedback after submit/vote.
- Host queue should update without refresh.
- Display mode should receive only the projection-safe public state.
- Participant mode should receive personal state for own pending/private questions.
- Do not broadcast private in-review replies to everyone.
- Avoid O(participants × questions) fanout patterns; use targeted personal updates where needed.

---

## 7. UX and Design Requirements

- Preserve PRIMETIME broadcast identity: bone background, ink/print texture, strong editorial type, mechanical controls, no generic SaaS card soup.
- Projection text must be readable from the back of a classroom/event room.
- Participant UI must be mobile-first with thumb-friendly controls.
- Host moderation actions must be fast: approve/dismiss/highlight should be one-click where safe.
- Empty states must explain what to do next: share PIN, wait for questions, enable moderation, close Q&A.
- Destructive actions such as dismiss/archive all/end session require confirmation or easy undo.
- Anonymous affordances must be clear to participants before submission.

---

## 8. Acceptance Criteria

### Host

- Host can create a Q&A session from `/host`.
- Host receives PIN, join link, QR code, control route, and display route.
- Host can approve/dismiss questions when moderation is enabled.
- Host can highlight exactly one live question.
- Host can mark questions answered and archive/restore them.
- Host can sort/filter/search questions in control mode.
- Host can label questions and optionally expose labels to participants.
- Host can close/reopen submissions and voting according to settings.
- Host can export session questions.

### Participant

- Participant can join with PIN and submit a question without an account.
- Participant privacy behavior matches the configured mode.
- Participant can upvote live questions and remove their vote.
- Participant can sort by popular/recent.
- Participant can see highlighted question.
- Participant can see moderation status for their own question.
- Participant can withdraw their own question.
- Participant replies work if enabled.

### Display

- Display route shows join instructions before questions arrive.
- Display route shows top questions in a projection-safe layout.
- Highlighted question is clear and room-readable.
- Closed/ended states are visible and unambiguous.

### Realtime / reliability

- Submit, vote, approve, highlight, answer, archive, close, and restore actions update relevant clients without refresh.
- Personal-only/private moderation states are not leaked into public display state.
- Reconnect returns host and participant to correct current state.
- Local stress/smoke test covers at least 120 participants submitting/voting without losing actions.

---

## 9. Risks and Open Decisions

| Risk / decision | Notes |
|---|---|
| Anonymous privacy | Treat anonymous as actually anonymous in host UI/export. Do not create a hidden deanonymization path. |
| Upvote abuse | Need one vote per participant per question and reconnect-safe vote identity. |
| Moderation complexity | In-review/private replies/personal state can leak if public and personal projections are not separated carefully. |
| Scope creep into chat | Participant replies are thread-like, but Q&A should not become a general chat room. |
| Fanout | Large sessions can create many vote updates; batch or derive public state carefully. |
| Labels vs topics | Labels are explicit and controllable; auto-topics are deferred until there is evidence users need them. |
| Persistence depth | Need enough data for export and restore without overbuilding a full analytics system. |

---

## 10. Milestone Suggestion

Suggested Linear milestone name: **Q&A Live Activity**

Suggested implementation slices for planning agent:

1. Product/data model and route skeleton
2. Q&A session creation and host control shell
3. Participant join/submit flow
4. Realtime question board + voting
5. Moderation queue and private/personal states
6. Display mode and highlight flow
7. Labels, sorting, filtering, search
8. Replies, close controls, archive/answered states
9. Export, tests, stress/smoke verification, documentation

These are not final tickets. Devin should inspect the current codebase and split the milestone into Linear issues with acceptance criteria and verification commands.
