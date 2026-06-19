// Pure WonderWall height helpers — NO Playwright/browser imports, so the
// display server component and public repo can resolve a card height without
// pulling headless Chromium into their bundle. The headless renderer lives in
// lib/wonderwall-measure.ts and imports these constants. See DECISIONS.md
// (2026-06-19 "WonderWall dynamic-height").

/** Fixed fallback height (matches the iframe's historical fixed height). */
export const WONDERWALL_DEFAULT_HEIGHT = 620;

/**
 * Render width. LinkedIn's native embed width — fixing it makes the measured
 * height deterministic across projector resolutions (text reflow is width-bound,
 * so the display MUST render the iframe at this same width).
 */
export const WONDERWALL_RENDER_WIDTH = 504;

/**
 * Resolve the height a card should render at, given stored measurement state.
 * Host override always wins; then a successful measurement; else the default.
 */
export function resolveDisplayHeight(post: {
  overrideHeight?: number | null;
  measuredHeight?: number | null;
}): number {
  return post.overrideHeight ?? post.measuredHeight ?? WONDERWALL_DEFAULT_HEIGHT;
}
