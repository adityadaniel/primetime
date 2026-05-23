# Codex Review: MID-93 Marketing Landing (PR #21)

**Date:** 2026-05-23
**Branch:** feat/marketing-landing vs main
**Reviewer:** Codex (high reasoning)

## Summary
Needs rework before merge. The landing keeps the BROADCAST visual language mostly intact and the new invite-code tests cover the happy/error paths, but the PR ships public `/pricing` links plus sitemap/robots entries for a route that does not exist, and the invite-code gate is brute-forceable because it has no throttling and compares raw codes directly.

## Critical (must fix before merge)
- None.

## High (should fix before merge)
- **[high] app/api/auth/signup/route.ts:43** — The invite-code gate has no rate limiting and accepts unlimited online guesses against the static `BETA_INVITE_CODES` list. Because validation runs before the user lookup and always returns a fast 403 for bad codes, attackers can brute-force low-entropy beta codes without paying bcrypt or DB cost. **Suggested fix:** add a signup/invite rate limiter keyed by IP plus normalized email before the code check, return 429 with `Retry-After`, and add tests for throttled attempts.
- **[high] app/api/auth/signup/route.ts:44** — Invite codes are compared as raw lowercase strings via `Set.has`; this is not constant-time and keeps production invite secrets as directly comparable strings. Rate limiting is the larger control, but the implementation still misses the security review requirement for timing-safe comparison. **Suggested fix:** parse configured codes once, compare normalized candidate/code byte buffers with `crypto.timingSafeEqual` only after equalizing lengths, or store HMAC digests of codes and timing-safe-compare digests.
- **[high] app/page.tsx:283** — The landing renders `FULL RATE CARD -> /pricing`, and the footer also links `/pricing` at app/page.tsx:319, but this branch has no `app/pricing/page.tsx`. The same non-existent URL is listed in `app/sitemap.ts:12` and allowed in `app/robots.ts:12`, so the public marketing surface advertises and sitemaps a 404. **Suggested fix:** add a minimal BROADCAST-styled pricing stub in this PR, or remove `/pricing` from the landing, sitemap, and robots allow-list until MID-74 lands.

## Medium (consider before merge)
- **[medium] app/api/auth/signup/route.ts:13** — `REQUIRE_INVITE_CODE` defaults on, but an unset or empty `BETA_INVITE_CODES` silently rejects every signup as "Invite code not recognized" at app/api/auth/signup/route.ts:47. That is hard to distinguish from user error and can lock production signup after a missed env var. **Suggested fix:** validate env config when the gate is required; fail with a server-side configuration error/503 and a log, and add a test for required gate plus empty code list.
- **[medium] app/page.tsx:255** — The Free tier copy says "No watermark on the projector", but the accepted pricing decision says Free includes a BROADCAST watermark on display (`DECISIONS.md:33`). This creates a public pricing promise that conflicts with the product model. **Suggested fix:** change the copy to "BROADCAST watermark on the projector" or update the durable pricing decision intentionally.
- **[medium] app/page.tsx:306** — Footer links are plain inline text links with no 44px touch target, and the same pattern appears on the legal pages at `app/privacy/page.tsx:49` and `app/terms/page.tsx:49`. This misses the MID-93 mobile tap-target constraint. **Suggested fix:** make footer/back links inline-flex with `min-h-11`, vertical padding, and visible focus styles while preserving the editorial treatment.
- **[medium] app/layout.tsx:6** — SEO canonical base, robots host, and sitemap host all derive from `NEXTAUTH_URL` (`app/robots.ts:3`, `app/sitemap.ts:3`). That env var is auth infrastructure, not necessarily the public canonical origin, and the fallback emits `http://localhost:4321` into production metadata if it is missing. **Suggested fix:** introduce a required `NEXT_PUBLIC_SITE_URL`/`SITE_URL` for metadata, sitemap, and robots, validate it in deployment, and keep `NEXTAUTH_URL` scoped to Auth.js.

## Low / Nits
- **[low] .env.example:25** — `BETA_INVITE_CODES=academy2026,daniel,early-access` looks like usable invite material. Teams often copy `.env.example` into local/staging/prod; if those values survive, the gate is public. **Suggested fix:** use placeholders such as `replace-me-1,replace-me-2` and add a comment that real codes must be generated and kept secret.
- **[low] app/privacy/page.tsx:39** — The legal pages are linked from the public footer and allowed in robots, but they say "coming soon" and use `support@broadcast.example`. That is acceptable only as an internal beta stub, not a coherent public page. **Suggested fix:** either noindex these stubs until real copy exists or replace the placeholder with real minimal terms/privacy copy and a working contact.

## Acceptance Criteria Coverage
| MID-93 acceptance item | Status | Notes |
|---|---|---|
| Marketing landing on `/` in BROADCAST editorial-brutalist identity | ✅ | Static server component, reuses existing Broadcast/Shape components, palette and typography remain aligned with `DESIGN.md`. |
| Landing uses shape-distinguishable answer markers, not color alone | ✅ | Uses existing `Shape` for triangle/diamond/circle/square; the channel strip shows all four. |
| Mobile-friendly tap targets ≥44px | ⚠️ | Main CTAs and form controls meet this, but footer/back links do not. |
| Lighthouse mobile ≥90 for landing | ⚠️ | Not demonstrated by tests or artifacts. Page is static, but external Google font loading and no Lighthouse run leave this unverified. |
| Invite-code signup gate | ⚠️ | Functional path exists and tests cover missing/unknown/valid/bypass, but security controls are incomplete: no rate limiting, no timing-safe comparison, no empty-env validation. |
| Invite codes are whitespace/case tolerant | ✅ | Covered in `lib/auth-flows.test.ts`. |
| SEO metadata, robots, sitemap | ⚠️ | Root metadata exists and `/host` has noindex, but `/pricing` is a sitemap/landing 404 and canonical origin is tied to `NEXTAUTH_URL`. |
| `/host`, `/play`, `/join`, `/signin` not modified except noindex metadata | ✅ | Diff only adds `app/host/layout.tsx`; no `/play`, `/join`, or `/signin` file changes. |
| Privacy/terms stubs | ⚠️ | Pages exist and match visual identity, but public copy still says "coming soon" and uses a fake `.example` contact. |
| `.env.example` documents `BETA_INVITE_CODES` and `REQUIRE_INVITE_CODE` | ✅ | Documented clearly, though sample invite codes should be placeholders. |
| Dependencies/package changes | ✅ | No package or lockfile changes in the PR diff. |

## Test Coverage Gaps
- No UI/render tests for the marketing landing links, so the missing `/pricing` route was not caught. Severity: high because it affects public SEO and CTA navigation.
- No tests for `robots.ts`, `sitemap.ts`, or metadata output. Severity: medium because sitemap correctness and canonical origin are part of MID-93.
- No tests for required invite gate with empty/missing `BETA_INVITE_CODES`. Severity: medium because this can silently lock all signups.
- No rate-limit tests for invite-code attempts. Severity: high because the new auth gate is the security boundary.
- No accessibility/mobile tests for 44px tap targets or keyboard focus on the landing/legal footer links. Severity: medium.

## RECOMMEND
REQUEST_CHANGES — fix the missing `/pricing` public route/link/sitemap issue and harden the invite-code gate with throttling plus safer comparison before merging.
