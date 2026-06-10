# Q&A Live Activity — Linear Planning Index

Generated: 2026-06-10 · Source PRD: `docs/q-and-a-prd.md` · Planning pass only (no feature code in this pass).

## Linear references

- **Team**: Midnight Labs (`MID`)
- **Project**: PRIMETIME — https://linear.app/midnight-labs/project/primetime-4a50abefef00
- **Milestone**: `Q&A Live Activity` — ID `e11cdc62-afbb-4299-82ca-c66d791b00f4`
  (milestone view: project URL above, milestone tab; Linear does not expose a standalone milestone URL via API)

## Issues (all created in `Todo`, attached to project + milestone)

| # | Issue | Title | URL |
|---|---|---|---|
| 1 | MID-331 | [Q&A] Prisma schema, migration, and repo layer for Q&A sessions | https://linear.app/midnight-labs/issue/MID-331/qanda-prisma-schema-migration-and-repo-layer-for-qanda-sessions |
| 2 | MID-332 | [Q&A] In-memory Q&A state module and DB hydration | https://linear.app/midnight-labs/issue/MID-332/qanda-in-memory-qanda-state-module-and-db-hydration |
| 3 | MID-333 | [Q&A] Session creation: API route, /host/q-and-a/new form, /host card, lookup-pin routing | https://linear.app/midnight-labs/issue/MID-333/qanda-session-creation-api-route-hostq-and-anew-form-host-card-lookup |
| 4 | MID-334 | [Q&A] Socket.IO foundation: rooms, host/display attach, participant join with privacy modes, reconnect | https://linear.app/midnight-labs/issue/MID-334/qanda-socketio-foundation-rooms-hostdisplay-attach-participant-join |
| 5 | MID-335 | [Q&A] Participant submit/withdraw/edit flow and /play/[pin]/q-and-a page | https://linear.app/midnight-labs/issue/MID-335/qanda-participant-submitwithdrawedit-flow-and-playpinq-and-a-page |
| 6 | MID-336 | [Q&A] Voting: upvote/downvote with reconnect-safe identity and coalesced fanout | https://linear.app/midnight-labs/issue/MID-336/qanda-voting-upvotedownvote-with-reconnect-safe-identity-and-coalesced |
| 7 | MID-337 | [Q&A] Host control surface: session header, live question board, sort/filter/search | https://linear.app/midnight-labs/issue/MID-337/qanda-host-control-surface-session-header-live-question-board |
| 8 | MID-338 | [Q&A] Moderation queue: approve/dismiss/restore with private state separation | https://linear.app/midnight-labs/issue/MID-338/qanda-moderation-queue-approvedismissrestore-with-private-state |
| 9 | MID-339 | [Q&A] Host question actions: highlight, mark answered, archive/restore, edit | https://linear.app/midnight-labs/issue/MID-339/qanda-host-question-actions-highlight-mark-answered-archiverestore |
| 10 | MID-340 | [Q&A] Labels: session-scoped labels, host assignment, participant selection and filtering | https://linear.app/midnight-labs/issue/MID-340/qanda-labels-session-scoped-labels-host-assignment-participant |
| 11 | MID-341 | [Q&A] Replies: host replies (public/private) and optional participant reply threads | https://linear.app/midnight-labs/issue/MID-341/qanda-replies-host-replies-publicprivate-and-optional-participant |
| 12 | MID-342 | [Q&A] Session controls: close/reopen questions and voting, end session | https://linear.app/midnight-labs/issue/MID-342/qanda-session-controls-closereopen-questions-and-voting-end-session |
| 13 | MID-343 | [Q&A] Display / Present mode: board, highlighted fullscreen, closed/ended states, display controls | https://linear.app/midnight-labs/issue/MID-343/qanda-display-present-mode-board-highlighted-fullscreen-closedended |
| 14 | MID-344 | [Q&A] CSV export of questions, votes, labels, and replies | https://linear.app/midnight-labs/issue/MID-344/qanda-csv-export-of-questions-votes-labels-and-replies |
| 15 | MID-345 | [Q&A] Verification pass: smoke/stress (120 participants), e2e, docs and decision updates | https://linear.app/midnight-labs/issue/MID-345/qanda-verification-pass-smokestress-120-participants-e2e-docs-and |

## Recommended implementation order

Sequential backbone (each blocks the next unless noted):

1. **MID-331** schema/migration/repo — foundation for everything.
2. **MID-332** in-memory state + hydration (`lib/qa.ts`, `lib/qa-hydrate.ts`).
3. **MID-333** create API + `/host/q-and-a/new` + `/host` card + lookup-pin routing — can run in parallel with MID-332 once MID-331 lands.
4. **MID-334** Socket.IO foundation (rooms, attach, join, reconnect).
5. **MID-335** participant submit/withdraw/edit + player page.
6. **MID-336** voting + coalesced fanout.
7. **MID-337** host control surface (board, sort/filter/search).
8. **MID-338** moderation queue — parallelizable with MID-339/MID-340 after MID-337.
9. **MID-339** highlight / answered / archive / edit actions.
10. **MID-340** labels — parallelizable with MID-338/MID-339.
11. **MID-341** replies (host public/private + participant threads) — needs MID-338 + MID-339.
12. **MID-342** close/reopen submissions & voting, end session.
13. **MID-343** display / Present mode — needs highlight (MID-339), labels (MID-340), closed states (MID-342).
14. **MID-344** CSV export — needs edit/labels/replies data (MID-339–MID-341).
15. **MID-345** verification pass: smoke/stress/e2e/docs — closes the milestone.

## Architectural anchors (from codebase inspection)

Q&A mirrors the Word Cloud activity pattern:

- Routes: `app/host/q-and-a/new`, `app/host/q-and-a/[pin]/control` (protected), `app/host/q-and-a/[pin]/display` (public via `isPublicHostDisplayPath()`), `app/play/[pin]/q-and-a` (public), `app/host/q-and-a/[pin]/questions.csv` (host-auth in route).
- Sockets in `server.ts`: room `qa:${pin}`; event namespaces `qa:host:*`, `qa:participant:*`, `qa:display:*`; persist-before-broadcast; coalesced fanout per `scheduleBroadcast` + `lib/fanout-metrics.ts`.
- Persistence: Prisma models `QASession`, `QAQuestion`, `QAVote`, `QALabel`, `QAQuestionLabel`, `QAReply`, `QAModerationEvent`, `QAParticipant`; shared PIN space via `lib/pin-allocator.ts`; restart hydration per `lib/wordcloud-hydrate.ts` pattern.
- Strict separation of public projection (display/participants) vs personal projection (own questions, private replies); anonymous means anonymous to host and export.

## Milestone-wide verification gate

Per `AGENTS.md`, every production-affecting issue runs:

```bash
npm run lint && npm test && npm run build
```

Additional checks by surface:

```bash
npm run smoke        # Socket.IO / gameplay flow changes (MID-334–MID-336, MID-338–MID-342)
npm run test:e2e     # auth/browser lifecycle flows + final pass (MID-333, MID-345)
npm run qa           # UI-visible work: control + display surfaces (MID-337, MID-343)
npm run db:up && npm run db:migrate   # schema changes (MID-331)
FANOUT_METRICS=1     # vote-burst fanout spot checks (MID-336, MID-345)
```

Milestone close (MID-345): 120-participant submit/vote stress run without lost actions, e2e spec green, docs updated (`README.md`, `DECISIONS.md`, `AGENTS.md` route map, PRD status).
