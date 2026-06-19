/**
 * POC 1 — WonderWall dynamic-height measurement probe.
 *
 * Renders the OFFICIAL public LinkedIn embed (collapsed) in headless Chromium
 * at a fixed width and reports candidate heights so we can pick the canonical
 * measurement element. Stores/extracts NOTHING but layout height integers.
 *
 * Per DECISIONS.md (2026-06-19): official `/embed/feed/update/<urn>` URLs only,
 * no login, no content stored. This script is a diagnostic; it intentionally
 * prints several height candidates rather than committing to one.
 *
 * Usage:
 *   npx tsx scripts/measure-embed.ts                # default addyosmani post
 *   npx tsx scripts/measure-embed.ts <embedUrl|urn> # custom
 */
import { chromium } from '@playwright/test';

// Fixed render width so measured height is deterministic across projector
// resolutions (LinkedIn's native embed width).
const RENDER_WIDTH = 504;
const NAV_TIMEOUT_MS = 20_000;

function toCollapsedEmbedUrl(input: string): string {
  // Accept a full embed URL, a feed URL, or a bare urn:li:... token.
  let urlStr = input;
  if (input.startsWith('urn:li:')) {
    urlStr = `https://www.linkedin.com/embed/feed/update/${input}`;
  }
  const url = new URL(urlStr);
  url.searchParams.set('collapsed', '1');
  return url.toString();
}

async function main() {
  const arg =
    process.argv[2] ??
    'https://www.linkedin.com/embed/feed/update/urn:li:ugcPost:7472391481375346688';
  const embedUrl = toCollapsedEmbedUrl(arg);
  console.log(`\n▶ measuring: ${embedUrl}`);
  console.log(`  render width: ${RENDER_WIDTH}px (collapsed)\n`);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: RENDER_WIDTH, height: 1200 },
    });
    // LinkedIn embeds keep beacons/long-polls open, so `networkidle` never
    // resolves. Wait for DOM, then give the embed a fixed beat to render.
    await page.goto(embedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForTimeout(3500);

    // Passed as a STRING so tsx/esbuild does not inject its `__name` helper
    // (which is undefined inside the page and breaks function-based evaluate).
    const diag = (await page.evaluate(`(() => {
      var candidates = [];
      function push(what, el) {
        if (el && el.offsetHeight !== undefined) {
          var cls = (el.className || '').toString().split(/\\s+/).slice(0, 2).join('.');
          candidates.push({ what: what, height: el.offsetHeight, tag: el.tagName.toLowerCase() + '.' + cls });
        }
      }
      push('body', document.body);
      push('documentElement', document.documentElement);
      push('main', document.querySelector('main'));
      push('article', document.querySelector('article'));
      push('body>firstChild', document.body.firstElementChild);
      push('[class*=embed]', document.querySelector('[class*="embed"]'));
      var text = document.body.innerText || '';
      var looksLikeFallback =
        /Select language|選擇語言/.test(text) || !!document.querySelector('select');
      return {
        bodyScrollHeight: document.body.scrollHeight,
        docScrollHeight: document.documentElement.scrollHeight,
        candidates: candidates,
        looksLikeFallback: looksLikeFallback,
        title: document.title,
      };
    })()`)) as {
      bodyScrollHeight: number;
      docScrollHeight: number;
      candidates: Array<{ what: string; height: number; tag: string }>;
      looksLikeFallback: boolean;
      title: string;
    };

    console.log(`  title: ${diag.title}`);
    console.log(`  fallback page?: ${diag.looksLikeFallback ? 'YES ⚠' : 'no'}`);
    console.log(`  body.scrollHeight: ${diag.bodyScrollHeight}`);
    console.log(`  documentElement.scrollHeight: ${diag.docScrollHeight}`);
    console.log('  element candidates:');
    for (const c of diag.candidates) {
      console.log(`    - ${c.what.padEnd(18)} ${String(c.height).padStart(5)}px  (${c.tag})`);
    }
    console.log('');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('measure-embed failed:', err);
  process.exit(1);
});
