/**
 * WonderWall dynamic-height measurement.
 *
 * Renders the OFFICIAL public LinkedIn embed (collapsed) in headless Chromium
 * and returns its rendered layout height as a single integer. Per DECISIONS.md
 * (2026-06-19 "WonderWall dynamic-height"): official `/embed/feed/update/<urn>`
 * URLs only, no login, no LinkedIn API, fail-soft, and it stores/extracts
 * NOTHING but the height integer — never post body, author, reactions, comments,
 * or images.
 *
 * NOTE: this is a runtime code path. `@playwright/test` (which re-exports
 * `chromium`) and its installed Chromium must be present in production, i.e.
 * Playwright must be a runtime dependency wherever this runs (v1: in-process in
 * `server.ts`). The diagnostic script `scripts/measure-embed.ts` exercises the
 * same render path.
 */
import { chromium } from '@playwright/test';
import { WONDERWALL_RENDER_WIDTH } from './wonderwall-height';
import { toCollapsedLinkedInEmbedUrl } from './wonderwall-input';

// Sanity clamp: a credible collapsed embed is taller than a bare avatar row and
// shorter than a runaway page. Anything outside this is treated as a bad read.
const HEIGHT_MIN = 160;
const HEIGHT_MAX = 4000;

const NAV_TIMEOUT_MS = 20_000;
const RENDER_SETTLE_MS = 3500;

export type MeasureResult =
  | { status: 'OK'; height: number; author: string | null }
  | { status: 'FAILED'; reason: string };

// In-page measurement, passed as a STRING so tsx/esbuild does not inject its
// `__name` helper (undefined in the page, breaks function-form page.evaluate).
// `author` is the embed's actor display name (the first non-empty anchor in the
// post article) — host-only moderation metadata (DECISIONS.md 2026-06-19
// "WonderWall author label"); nothing else (headline, profile URL, avatar) is read.
const MEASURE_SCRIPT = `(() => {
  var article = document.querySelector('article');
  var height = (article && article.offsetHeight) || document.body.scrollHeight || 0;
  var text = document.body.innerText || '';
  // The "post unavailable" page is a language picker with a <select> and no article.
  var fallback = !article && (/Select language|選擇語言/.test(text) || !!document.querySelector('select'));
  var author = null;
  if (article) {
    var anchors = article.querySelectorAll('a');
    for (var i = 0; i < anchors.length; i++) {
      var t = (anchors[i].textContent || '').trim();
      if (t && t !== 'LinkedIn' && t.length <= 80) { author = t; break; }
    }
  }
  return { height: Math.ceil(height), fallback: fallback, author: author };
})()`;

type RawMeasure = { height: number; fallback: boolean; author: string | null };

/**
 * Measure the rendered height of a LinkedIn embed. Always resolves (never
 * throws) — failures come back as `{ status: 'FAILED' }` so callers can fall
 * back to {@link WONDERWALL_DEFAULT_HEIGHT}.
 */
export async function measureEmbedHeight(embedUrl: string): Promise<MeasureResult> {
  let collapsedUrl: string;
  try {
    collapsedUrl = toCollapsedLinkedInEmbedUrl(embedUrl);
  } catch {
    return { status: 'FAILED', reason: 'invalid_embed_url' };
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: WONDERWALL_RENDER_WIDTH, height: 1200 },
    });
    // LinkedIn embeds keep beacons open, so `networkidle` never settles; wait
    // for DOM + the post container, then give it a fixed beat to lay out.
    await page.goto(collapsedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForSelector('article', { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(RENDER_SETTLE_MS);

    const raw = (await page.evaluate(MEASURE_SCRIPT)) as RawMeasure;

    if (raw.fallback) return { status: 'FAILED', reason: 'embed_unavailable' };
    if (!Number.isFinite(raw.height) || raw.height < HEIGHT_MIN)
      return { status: 'FAILED', reason: 'height_too_small' };

    const author = typeof raw.author === 'string' ? raw.author.slice(0, 120) : null;
    return { status: 'OK', height: Math.min(raw.height, HEIGHT_MAX), author };
  } catch (err) {
    const reason = err instanceof Error ? err.name : 'measure_error';
    return { status: 'FAILED', reason };
  } finally {
    await browser?.close().catch(() => {});
  }
}
