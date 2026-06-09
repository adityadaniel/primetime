# Design Audit — PRIMETIME

**Date:** 2026-06-09
**Method:** `hallmark audit` (anti-AI-slop design review), read-only. Graded against the declared
broadcast-graphics system in [`DESIGN.md`](../DESIGN.md) and the Hallmark anti-pattern catalogue.
**Scope:** every UI surface — landing, auth (signin/signup/reset), legal (privacy/terms/pricing),
host (dashboard, quiz builder, control room, projection display), player (join, quiz play),
and the Word Cloud surfaces.
**Branch:** `design/audit-findings`. No code was changed; this document is the deliverable.

---

## Verdict

**Close — fix the minors.** This is **not** AI-template slop. PRIMETIME ships a high-fidelity,
deliberately-authored "vintage broadcast graphics" identity that holds together across all
surfaces. The genre is intentional and documented, so several patterns that read as tells on a
generic SaaS page (a full-bleed centred hero, monospaced chyron eyebrows, an inverted dark
"on-air" surface) are **genre-correct here** and were not flagged.

The findings below are mostly accessibility and consistency polish, plus one section whose
skeleton sits closest to the generic feature-grid template. Severity uses the audit scale:
`critical` = ships as slop · `major` = looks AI-generated / real a11y gap · `minor` = small taste issue.

**Summary — 0 critical · 3 major · 6 minor.**

---

## What's working (protect these)

These are the wins the design system has already banked. Call them out so future edits don't
regress them:

- **No purple-gradient / aurora / blob tells.** Zero gradient heroes, zero `background-clip:text`
  headlines. The landing `<meta>` even states the position: "Editorial brutalist by design — no
  purple gradient."
- **Paired type system, no Inter-everywhere.** Big Shoulders Display (numerals) · Newsreader
  (editorial body) · JetBrains Mono (tickers/chyrons), applied by role via `.display-num` /
  `.ticker` / `.chyron`. No single-font templating.
- **Honest copy — no invented metrics.** Pricing is an honest stub ("Detailed pricing coming with
  billing launch"), not fabricated tiers or "+47% conversion" proof bars. Feature claims are real
  ("Up to 50 concurrent players").
- **Answer shapes are shape-distinct (WCAG).** Triangle / diamond / circle / square render as SVG
  geometry with bone fill + ink stroke, distinguishable without colour. Channel markers (CH.01–04)
  reinforce. `components/Shape.tsx`.
- **Colour discipline.** Brand palette lives as CSS custom properties (`--bone`, `--ink`,
  `--vermilion`, …); component files reference vars, not hex. No pure `#fff` / `#000` (bone + ink
  instead).
- **No emoji-as-icon, no card-in-card, no AI nav/footer.** The footer is a semantic nav with
  underlined links + copyright, not the 4-column-links + social-row template.
- **Mobile-first player.** `inputMode="numeric"` + `pattern="\d*"` on PIN entry; 56–70px tap
  targets; the Word Cloud word input is 20px to avoid iOS focus-zoom. Single-column thumb-zone layouts.
- **Restrained, purposeful motion.** Teleprompter slide, flash-cut reveal, stamp-in lock, single
  pulsing ON-AIR dot — all per `DESIGN.md`. No transition-all, no scroll-fade-everything, no bounce
  on UI state.
- **Curly typography.** Body copy uses curly apostrophes and em-dashes (verified on legal pages —
  the only straight quotes are JS string delimiters, not rendered text).

---

## Major findings

### M1 · Hover-only affordances with no focus/touch equivalent
**Tell:** Hover-only affordances.
**Where:**
- `app/host/[pin]/control/control-views.tsx:298` — kick-player button: `opacity-60 hover:opacity-100`
- `app/host/quiz/new/page.tsx:445` — run-order drag handle (`⋮⋮`): `opacity-60 hover:opacity-100`

**Why it's a tell:** The control affordance is only legible on hover. On a touch device there is no
hover, so it sits permanently at 60% opacity; keyboard focus doesn't brighten it either. The element
is technically reachable (the kick is a real `<button>`), but the *visual* affordance is gated behind
a pointer capability the host may not have (tablet director, touch laptop).

**Fix:** Give the resting state a readable opacity and add a focus reveal:
`opacity-70 hover:opacity-100 focus-visible:opacity-100`. For the drag handle, also ensure it's
keyboard-operable (or pair it with up/down reorder controls), since native drag handles are
inaccessible by default.

### M2 · Focus ring is near-invisible on accent-coloured buttons
**Tell:** Focus rings that don't meet 3:1 against their own element.
**Where:** `app/globals.css:214–220` — global `:focus-visible { outline: 2px solid var(--vermilion); outline-offset: 2px }`, applied to every button including vermilion-filled CTAs (GO LIVE, `app/join/page.tsx` GO ON AIR, Word Cloud SEND IT).

**Why it's a tell:** A vermilion outline around a vermilion button is low-contrast; the 2px offset
shows a sliver of page colour but the ring still reads weakly, and keyboard users can lose track of
focus on the primary CTAs. Accent-on-accent is the exact case the global rule doesn't cover.

**Fix:** Make the ring colour-independent of the button. Options: switch the outline to `var(--ink)`
(reads on bone, marigold, vermilion, and — with care — ink surfaces), or use a two-tone ring (ink
outline + bone offset gap) so it's visible on every channel colour. Never animate the ring in
(it must appear instantly).

### M3 · Inconsistent disabled-button treatment
**Tell:** Missing disabled state / state-discipline gap.
**Where:** Disabled affordances that change *text only* and keep full colour + stamp shadow:
- `app/join/page.tsx:179–187` — GO ON AIR (`disabled={pending}`, label flips to "JOINING…", but the
  vermilion fill and `stamp-lg` shadow stay)
- Several control buttons rely on browser-default `:disabled` styling.

Contrast with the surfaces that **do** handle it well — the Word Cloud control buttons and the quiz
control "ROLL TAPE" swap to an ash background when disabled. The treatment is inconsistent, not absent.

**Why it's a tell:** A disabled control that looks fully active (same colour, same drop shadow) reads
as "untested states." The drop shadow especially signals "pressable" on a button that isn't.

**Fix:** Standardise one disabled recipe and apply it everywhere: `disabled:opacity-60
disabled:cursor-not-allowed`, drop the `stamp`/`stamp-lg` shadow when disabled, or swap the fill to
`var(--ash)` (the pattern already used on the better surfaces). Promote it to a shared button helper.

---

## Minor findings

### m1 · The "WHAT IT IS" section is the generic 3-equal-column feature grid
**Tell:** The 3-column feature grid (softened).
**Where:** `app/page.tsx:142–161` — three equal `md:col-span-4` cards, each = icon row + heading + body.

**Why it's only minor:** The silhouette is the most-recognised AI feature-section shape, but the
execution genuinely differentiates it — broadcast channel shapes (not decorative icons), CH.0x
markers, `display-num` headings, ink borders, and honest content. The very next section ("WHY US",
`page.tsx:203–224`) already breaks to a 2-column rhythm, proving the system can.

**Fix (optional polish):** Break the equal grid so the page has no perfectly-templated section —
vary one card's span (e.g. 5/4/3), make one a wide feature tile, or mix card heights. Low priority;
flagged for structural-variety completeness.

### m2 · Podium uses a non-reflowing `grid-cols-3`
**Where:** `app/host/[pin]/control/control-views.tsx:402` and `app/host/[pin]/display/display-views.tsx:404`.
**Note:** On the projection display this is fine (full-screen, never phone-sized). On the **control
room** a phone-held director could see three cramped podium columns.
**Fix:** Acceptable as desktop-first, but add `min-w-0` + truncation on the podium cells, or
`grid-cols-1 sm:grid-cols-3`, so nicknames don't overflow on a narrow control view.

### m3 · SMPTE-bar colours bypass the token system
**Tell:** Mid-render token improvisation (mild).
**Where:** `app/globals.css:81,84` — `.smpte-bars` hard-codes `#4ea1c4` (cyan) and `#a06ba8` (magenta)
inline; every other colour in the file is a `var(--…)` token.
**Why it's minor:** They're legitimate SMPTE cyan/magenta with no palette equivalent — but they're the
only untokenised colours in the system.
**Fix:** Lift them into named tokens (`--smpte-cyan`, `--smpte-magenta`) for consistency and reuse.

### m4 · Primary CTAs have no `white-space: nowrap` guard
**Tell:** Wrap-to-two-lines clickable text (risk, not confirmed).
**Where:** Leading-glyph CTAs — "▶  GO ON AIR" (`app/join/page.tsx:187`), "▶  SEND IT", "CONTINUE WITH APPLE".
**Why it's minor:** Labels are short enough to hold one line at common widths, but none are pinned, so
a very narrow viewport (≤320px) could wrap a primary action onto two lines.
**Fix:** Add `white-space: nowrap` to primary CTA labels as cheap insurance; verify at 320px.

### m5 · Host dashboard card titles drop the display face
**Where:** `app/host/HostMenuClient.tsx` — Quick-Activity card titles use `font-editorial` at
`clamp(28px,3.2vw,40px)` rather than `.display-num`.
**Why it's minor:** Sizing is appropriate; it just doesn't showcase the broadcast numerals that
anchor every other surface, so the dashboard reads marginally softer than the rest of the kit.
**Fix:** Optional — consider `.display-num` on the activity titles to reinforce the type system.

### m6 · No "unsaved changes" guard in the quiz builder
**Where:** `app/host/quiz/new/page.tsx` — navigating away with an unsaved draft loses it silently.
**Why it's minor:** UX/data-loss polish rather than a visual tell.
**Fix:** Add a `beforeunload` guard when the draft is dirty.

---

## Notes for whoever fixes this

- **Respect the genre.** Do not "de-broadcast" anything to satisfy a generic checklist. The chyron
  eyebrows, the inverted on-air display, the SMPTE bars, the full-bleed hero, and the `stamp` shadows
  are the identity, not slop. `DESIGN.md` is the source of truth.
- **Most value is in M1–M3** — they're real accessibility gaps (touch + keyboard) and the cheapest to
  fix. A shared button component carrying the focus-ring, disabled, and hover/focus recipes would
  close M1, M2, and M3 at once and prevent drift.
- The rest are taste/variety polish and can be batched or deferred.

**Suggested sequencing:** (1) shared button/affordance states → closes M1–M3; (2) optional
structural break on `page.tsx` "WHAT IT IS" → m1; (3) tokenise SMPTE colours + nowrap CTAs → m3, m4;
(4) defer m2, m5, m6.
