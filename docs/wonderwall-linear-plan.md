# WonderWall Linear Plan

> Status: All 14 WonderWall v1 Linear tickets created and verified in the PRIMETIME project on 2026-06-18.

## Linear context

| Field | Value |
|---|---|
| Team | MID / Midnight Labs |
| Project | PRIMETIME |
| Project URL | https://linear.app/midnight-labs/project/primetime-4a50abefef00 |
| Milestone | WonderWall v1 |
| Milestone ID | 53ac4dcf-cf20-4037-b878-b4602342cf6e |
| Source plan | `docs/wonderwall-iframe-plan.md` |
| Intended branch | `feat/wonderwall-iframe` |

## Required per-ticket agent loop

For every WonderWall Linear ticket:

1. Move only the active ticket to `In Progress`.
2. Ask Claude Code to implement the ticket scope.
3. Hermes inspects the diff and runs the ticket verification commands.
4. Ask Codex to review the diff against the ticket + `docs/wonderwall-iframe-plan.md`.
5. If Codex requests changes, ask Claude Code to implement the review feedback.
6. Re-run relevant gates and ask Codex to review again.
7. Repeat until Codex is satisfied / no blocking findings remain.
8. Commit atomically for that ticket.
9. Comment evidence back to Linear.
10. Do not mark `Done` until the accepted branch/PR/merge policy is satisfied.

## Created Linear tickets

All tickets are attached to the PRIMETIME project and `WonderWall v1` milestone. All start in `Todo`.

| Order | Linear | Title | URL |
|---:|---|---|---|
| 1 | MID-395 | [WonderWall] LinkedIn URL parser and embed helpers | https://linear.app/midnight-labs/issue/MID-395/wonderwall-linkedin-url-parser-and-embed-helpers |
| 2 | MID-396 | [WonderWall] Prisma schema, migration, and PIN allocator support | https://linear.app/midnight-labs/issue/MID-396/wonderwall-prisma-schema-migration-and-pin-allocator-support |
| 3 | MID-397 | [WonderWall] Repository helpers and public/host state shaping | https://linear.app/midnight-labs/issue/MID-397/wonderwall-repository-helpers-and-publichost-state-shaping |
| 4 | MID-398 | [WonderWall] Host create API and new wall page | https://linear.app/midnight-labs/issue/MID-398/wonderwall-host-create-api-and-new-wall-page |
| 5 | MID-399 | [WonderWall] Participant submission API | https://linear.app/midnight-labs/issue/MID-399/wonderwall-participant-submission-api |
| 6 | MID-400 | [WonderWall] Participant page and /join routing | https://linear.app/midnight-labs/issue/MID-400/wonderwall-participant-page-and-join-routing |
| 7 | MID-401 | [WonderWall] Host control review queue | https://linear.app/midnight-labs/issue/MID-401/wonderwall-host-control-review-queue |
| 8 | MID-402 | [WonderWall] Public display waterfall page | https://linear.app/midnight-labs/issue/MID-402/wonderwall-public-display-waterfall-page |
| 9 | MID-403 | [WonderWall] Host-only CSV export of submitted data | https://linear.app/midnight-labs/issue/MID-403/wonderwall-host-only-csv-export-of-submitted-data |
| 10 | MID-404 | [WonderWall] Auth, route privacy, and ownership hardening | https://linear.app/midnight-labs/issue/MID-404/wonderwall-auth-route-privacy-and-ownership-hardening |
| 11 | MID-405 | [WonderWall] Light refresh/polling updates across participant, control, and display | https://linear.app/midnight-labs/issue/MID-405/wonderwall-light-refreshpolling-updates-across-participant-control-and |
| 12 | MID-406 | [WonderWall] Host dashboard card and product copy | https://linear.app/midnight-labs/issue/MID-406/wonderwall-host-dashboard-card-and-product-copy |
| 13 | MID-407 | [WonderWall] Docs, DECISIONS, and implementation handoff updates | https://linear.app/midnight-labs/issue/MID-407/wonderwall-docs-decisions-and-implementation-handoff-updates |
| 14 | MID-408 | [WonderWall] End-to-end QA and release verification | https://linear.app/midnight-labs/issue/MID-408/wonderwall-end-to-end-qa-and-release-verification |

## Execution sequence

1. Create/switch to `feat/wonderwall-iframe`.
2. Start with MID-395.
3. Work tickets sequentially in the order above unless a blocker forces reordering.
4. Use one commit per ticket.
5. Use one final PR for WonderWall v1 after MID-408 passes.

## Verification performed

A Linear project query verified that MID-395 through MID-408 are all:

- in project `PRIMETIME`
- under milestone `WonderWall v1`
- in state `Todo`

The verification payload was saved locally during setup at:

```txt
/tmp/linear-wonderwall-all-verify.json
```
