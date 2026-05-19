# Product Requirements Document
**Kahoot — Real-Time Quiz & Learning Game Platform**
Version: 1.1 · Status: Draft · Last Updated: May 2026

## 1. Overview

### 1.1 Product Summary
A real-time, multiplayer quiz platform that lets hosts create and run interactive quiz games for live audiences. Players join via a game PIN on any device, answer timed questions, and compete on a live leaderboard — no account required to play.

### 1.2 Problem Statement
Traditional knowledge checks (polls, quizzes, tests) are passive and disengaging. Instructors, trainers, and facilitators need a low-friction, high-energy way to assess understanding and keep audiences active during sessions.

### 1.3 Goals
- Hosts can create a quiz in under 5 minutes
- Support up to 150 concurrent players per game
- Seamless real-time experience across mobile and desktop
- Near-zero barrier to play (no app download, no login)

### 1.4 Out of Scope (v1)
- Team/group mode
- Audio or video in questions
- Analytics dashboard beyond session-level stats
- Offline mode

## 2. Users & Roles

| Role | Description |
|------|-------------|
| Host | Creates quizzes, launches game sessions, controls pacing |
| Player | Joins via PIN, answers questions in real time |
| Guest Host | Can run an existing quiz without an account (stretch) |

### 2.1 Host Persona
Teachers, corporate trainers, workshop facilitators, event emcees. Prepares content ahead of time, runs the game live with minimal friction. Values reliability and control over the game flow.

### 2.2 Player Persona
Students, workshop attendees, event participants. Joins on a phone or laptop. Expects an instant, familiar, low-stakes experience. No tolerance for login friction.

## 3. Core Features

### 3.1 Quiz Builder
Hosts create and manage quizzes from a dashboard. Anonymous (unsaved) quizzes also supported for one-off use without an account.

**Requirements:**
- Quiz with title, optional description, optional cover image
- **Anonymous quiz mode:** build and run in a single session without saving or logging in. Discarded after session ends.
- Add, reorder, and delete questions
- Question types in v1:
  - Multiple choice (2–4 options, single correct answer)
  - True/False
- Per-question settings:
  - Question text (required, max 120 chars)
  - Answer options (required)
  - Correct answer designation (required)
  - Time limit: 5, 10, 20, 30, 60, 90, 120 seconds (default: 20s)
  - Point value: standard (1000 pts) or double points
  - Optional image per question (upload or URL)
- Autosave while editing
- Duplicate and delete quizzes

### 3.2 Game Session — Host View
**Lobby phase:**
- System generates unique 6-digit game PIN
- Host screen shows PIN prominently with player join list updating in real time
- Host can kick players before game starts
- Host manually advances from lobby to start

**In-game phase:**
- Host controls question advancement (manual "next" or auto-advance option)
- Host screen shows:
  - Current question text and options (dimmed — not shown to players until revealed)
  - Countdown timer
  - Live response count (X of Y players answered)
  - Answer distribution bar chart after time expires
  - Correct answer reveal with player count per option
- After each question: intermediate podium showing top 3 players

**End of game:**
- Final leaderboard (all players ranked)
- Option to export results as CSV
- Option to replay the same quiz

### 3.3 Presenter Mode (Projection View)
When host launches a session, two URLs are generated:

- **Control panel** (`/host/[gamePIN]/control`) — host's private screen. Player list, answer distribution, correct answer reveal, game controls. Optimized for laptop.
- **Projection view** (`/host/[gamePin]/display`) — minimal, audience-facing screen. Designed to be opened in a second window, shared via display mirroring or projector. Shows:
  - Game PIN and join URL prominently during lobby
  - Question text (large, readable from the back of a room)
  - Countdown timer
  - Answer option **shapes/colors only — no text** (players see text on their own devices)
  - Answer distribution bars after time expires
  - Leaderboard podium between questions

Host opens both URLs at session start. Control panel stays on laptop; display view goes fullscreen on projected screen. No plugins, no embeds.

### 3.4 Game Session — Player View
Players join at `kahoot.app/join` (or equivalent), enter PIN, pick nickname.

- **Lobby:** waiting screen with nickname displayed, animated until game starts
- **In-game:**
  - Question text displayed for a configurable reveal window (e.g., 3s) before options appear
  - Answer options as large colored buttons matching Kahoot's iconic 4-color grid:
    - red triangle, blue circle, yellow star, green square
  - Timer countdown visible
  - After answering: locked-in confirmation (cannot change answer)
  - After time expires: feedback screen showing correct/incorrect + points earned + current rank
- **End of game:** final rank and total score, option to share score (stretch)

### 3.5 Leaderboard & Scoring
- Points based on correctness + speed
- Formula: `points = base_value × (time_remaining / time_limit) × speed_multiplier`
- Streak bonuses for consecutive correct answers (stretch)
- Leaderboard updates after every question
- Top 3 podium between questions (host screen only)

### 3.6 Authentication (Host Only)
- Email/password signup and login
- OAuth: Google sign-in
- Password reset via email
- Players never need an account

### 3.7 Pricing & Player Limits
Free tier unlimited in games and quizzes, gated on players per session.

| Tier | Player Cap | Price |
|------|-----------|-------|
| Free | 10 players/session | $0 |
| Pro | 150 players/session | TBD |

- 150-player cap is hard system limit across all tiers
- When free session reaches 10, new joins rejected with friendly upsell prompt
- Anonymous sessions follow same caps as free
- Upsell prompt in host lobby when player count approaches free limit

## 4. Technical Requirements

### 4.1 Real-Time Communication
- WebSocket-based connection for all in-game state
- Reconnection: dropped players can rejoin mid-game by re-entering PIN + nickname within grace window
- Host disconnect: game pauses, auto-resumes when host reconnects within 60 seconds

### 4.2 Scalability
- 150 concurrent players per room (hard cap)
- 1,000 concurrent rooms in v1
- Game state managed server-side; clients are thin
- Redis pub/sub or similar for room state

### 4.3 Latency
- Answer submission acknowledged within 500ms under normal conditions
- Leaderboard update delivered to all clients within 1s of question close

### 4.4 Platforms
- Web-first (responsive)
- Min browsers: Chrome 110+, Safari 16+, Firefox 110+
- No native app in v1

### 4.5 Data Persistence
- Quizzes: persisted per user account
- Game sessions: results stored 30 days
- Player data: nicknames only, no PII

## 5. UX & Design Principles
- **Immediacy:** every action feels instant. No loading screens during gameplay.
- **Clarity:** players never confused about what to do next.
- **Energy:** animations, color, sound (stretch) reinforce the game feel.
- **Accessibility:** min WCAG 2.1 AA. Color must not be the sole differentiator — shapes/icons must also distinguish options.
- **Mobile-first for players:** player UI for one-handed phone use.

## 6. User Stories

**Host**
- Create new quiz from scratch to run in next session
- Launch game from any saved quiz, get shareable PIN
- See per-option answer counts to spot confusion
- End game early
- Download session results as CSV

**Player**
- Join with PIN + nickname, no account needed
- See question and options clearly on phone
- Get instant feedback on correctness and rank
- See final score at end

## 7. Success Metrics (3 months post-launch)

| Metric | Target |
|--------|--------|
| Quizzes created | 1,000+ |
| Game sessions run | 500+ |
| Avg players per session | 15+ |
| Session completion rate | >80% |
| Player join-to-answer rate | >90% |
| Host NPS | >40 |

## 8. Milestones

| Milestone | Scope | Target |
|-----------|-------|--------|
| M1 — Core Loop | Quiz builder (saved + anonymous), single session, ≤10 players, presenter mode | Week 4 |
| M2 — Scale & Polish | 150 players/room, reconnect, CSV export, player cap enforcement | Week 8 |
| M3 — Public Beta | Auth, Pro tier, quiz library, session history | Week 12 |

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| WebSocket reliability on mobile | Medium | High | Fallback polling; reconnect with grace period |
| Leaderboard scoring disputes (latency unfairness) | Low | Medium | Server-side timestamps for answer submission |
| Nickname abuse / inappropriate content | Medium | Medium | Client-side profanity filter + host kick |
| Cheating (answer interception) | Low | Low | Correct answers never sent to client until reveal |

## 10. Decisions Log

1. **Host-configurable max player limit?** No. Hard system cap of 150/session across all tiers.
2. **Anonymous (unsaved) quizzes?** Yes. Build and run without account; discarded after session.
3. **Free tier model?** Gate on players. Free: 10/session. Pro: up to 150/session.
4. **Host screen mirroring / Keynote integration?** Presenter mode: two separate URLs per session — control panel (laptop) and projection view (fullscreen). No plugins.
