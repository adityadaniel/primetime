// WonderWall content fetch via the Apify actor `harvestapi~linkedin-profile-posts`.
//
// FLAG-GATED LinkedIn scraping (DECISIONS.md 2026-06-21 "WonderWall content
// analysis (Apify)"). Only invoked when WONDERWALL_ANALYSIS_ENABLED=true AND
// APIFY_TOKEN is set; otherwise WonderWall stores no post content (the OSS
// default). Ports the normalization from the POC at
// /Users/adityadaniel/Developer/linkedin-apify-test/linkedin_posts_fetch.py.

const ACTOR_ID = 'harvestapi~linkedin-profile-posts';
const ENDPOINT = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items`;
const DEFAULT_TIMEOUT_MS = 120_000;

export type ApifyPostData = {
  text: string | null;
  authorName: string | null;
  authorHeadline: string | null;
  url: string | null;
  numLikes: number | null;
  numComments: number | null;
  numShares: number | null;
  postedAt: Date | null;
};

export type ApifyFetchResult = { ok: true; data: ApifyPostData } | { ok: false; error: string };

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === 'string' && v.trim() !== '') return v;
  return null;
}

function firstNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Best-effort normalization — actor output fields evolve, so try several keys. */
export function normalizeApifyPost(item: Record<string, unknown>): ApifyPostData {
  const actor = asObject(item.actor);
  const author = asObject(item.author);
  const engagement = asObject(item.engagement);
  const postedAt = asObject(item.postedAt);

  const createdRaw = firstString(item.createdAt, item.postedAtISO, postedAt.date, item.date);
  let posted: Date | null = null;
  if (createdRaw) {
    const d = new Date(createdRaw);
    if (!Number.isNaN(d.getTime())) posted = d;
  }

  return {
    text: firstString(
      item.text,
      item.commentary,
      item.content,
      item.socialContent,
      item.description,
    ),
    authorName: firstString(actor.name, author.name, item.authorName),
    authorHeadline: firstString(actor.position, actor.info, author.position, author.info),
    url: firstString(item.url, item.linkedinUrl, item.shareLinkedinUrl, item.postUrl),
    numLikes: firstNumber(item.numLikes, item.likesCount, item.reactionCount, engagement.likes),
    numComments: firstNumber(item.numComments, item.commentsCount, engagement.comments),
    numShares: firstNumber(item.numShares, item.sharesCount, item.repostsCount, engagement.shares),
    postedAt: posted,
  };
}

function extractItems(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.map(asObject);
  const inner = (data as { data?: unknown } | null)?.data;
  if (Array.isArray(inner)) return inner.map(asObject);
  return [];
}

/**
 * Fetch a single LinkedIn post's content via Apify. Always resolves (never
 * throws): failures come back as `{ ok: false, error }`. Reads APIFY_TOKEN from
 * the environment; returns `apify_not_configured` if absent.
 */
export async function fetchLinkedInPost(targetUrl: string): Promise<ApifyFetchResult> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, error: 'apify_not_configured' };

  const payload = {
    targetUrls: [targetUrl],
    maxPosts: 1,
    scrapeComments: false,
    scrapeReactions: false,
    includeQuotePosts: true,
    includeReposts: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `apify_http_${res.status}: ${body.slice(0, 200)}` };
    }
    const items = extractItems(await res.json());
    if (items.length === 0) return { ok: false, error: 'apify_empty' };
    const data = normalizeApifyPost(items[0]);
    if (!data.text) return { ok: false, error: 'apify_no_text' };
    return { ok: true, data };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const reason =
      name === 'AbortError' ? 'apify_timeout' : err instanceof Error ? err.message : 'apify_error';
    return { ok: false, error: reason.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}
