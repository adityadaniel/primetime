// WonderWall LinkedIn URL parsing/normalization (MID-395). Pure, side-effect
// free helpers shared by the participant submission flow and host review/API
// layers so the two can never drift on what counts as an embeddable LinkedIn
// post. No scraping, no network calls, no LinkedIn API, no Prisma/Next runtime
// imports — see docs/wonderwall-iframe-plan.md §4 (URL normalization).
//
// We only ever turn a public LinkedIn post URL into an official iframe embed
// URL. Parsing a URL means "technically understood", not "safe to display":
// the projector gate (canDisplay) lives in the data model, not here.

// Normalized internal form. Only these three URN types map to a LinkedIn
// `/embed/feed/update/` iframe.
export type LinkedInPostUrn =
  | `urn:li:activity:${string}`
  | `urn:li:ugcPost:${string}`
  | `urn:li:share:${string}`;

export type WonderWallParseResult =
  | {
      ok: true;
      platform: 'linkedin';
      originalUrl: string;
      urn: LinkedInPostUrn;
      embedUrl: string;
    }
  | {
      ok: false;
      reason:
        | 'invalid_url'
        | 'unsupported_host'
        | 'unsupported_protocol'
        | 'unsupported_linkedin_url'
        | 'missing_post_id';
    };

// Hostnames we accept. Exactly linkedin.com / www.linkedin.com — no arbitrary
// subdomains (e.g. a lookalike `linkedin.com.evil.example` parses to a
// different host, and `ads.linkedin.com` is not a post surface).
const ALLOWED_HOSTS = new Set(['linkedin.com', 'www.linkedin.com']);

// Supported post-id token types. Casing matches the LinkedIn URN segment, so
// the `/posts/...` token (e.g. `ugcPost-123`) maps straight onto the URN type
// (`urn:li:ugcPost:123`) with no rewriting.
const URN_TYPES = ['activity', 'ugcPost', 'share'] as const;
type UrnType = (typeof URN_TYPES)[number];

const URN_ALTERNATION = URN_TYPES.join('|');

// `/feed/update/urn:li:<type>:<digits>` — colons are kept verbatim in the
// pathname by the URL parser. Only numeric ids are accepted.
const FEED_URN_RE = new RegExp(`^urn:li:(${URN_ALTERNATION}):(\\d+)$`);

// `/posts/<slug>` — extract the `<type>-<digits>` token from the slug. Only
// numeric ids are accepted. LinkedIn slugs can prefix the token with either the
// vanity separator (`_`) or a keyword separator (`-`), e.g.
// `person_activity-123-suffix` and `person_topic-share-123-suffix`. The id must
// be followed by LinkedIn's suffix separator (`-`) or the slug end so malformed
// prefixes like `activity-123abc` are not treated as valid post ids.
const POSTS_TOKEN_RE = new RegExp(`(?:^|[_-])(${URN_ALTERNATION})-(\\d+)(?:-|$)`);

function buildUrn(type: UrnType, id: string): LinkedInPostUrn {
  return `urn:li:${type}:${id}` as LinkedInPostUrn;
}

// Pathname segments keep percent-encoding; decode defensively so an encoded
// colon (`%3A`) still matches. Fall back to the raw segment on malformed
// escapes rather than throwing.
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function toLinkedInEmbedUrl(urn: LinkedInPostUrn): string {
  return `https://www.linkedin.com/embed/feed/update/${urn}`;
}

// LinkedIn's official iframe supports `collapsed=1`, which mirrors the home
// timeline behavior for long text posts: show a shortened body with the native
// `…more` expander inside LinkedIn's own iframe. Apply this at display time so
// existing DB rows with canonical embed URLs also collapse without migration.
export function toCollapsedLinkedInEmbedUrl(embedUrl: string): string {
  const url = new URL(embedUrl);
  url.searchParams.set('collapsed', '1');
  return url.toString();
}

export function parseLinkedInPostUrl(input: string): WonderWallParseResult {
  if (typeof input !== 'string') return { ok: false, reason: 'invalid_url' };

  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: 'invalid_url' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'unsupported_protocol' };

  // URL lowercases the hostname, so this comparison is case-insensitive.
  if (!ALLOWED_HOSTS.has(url.hostname)) return { ok: false, reason: 'unsupported_host' };

  // Drop a single trailing slash so `/feed/update/<urn>/` is treated the same
  // as `/feed/update/<urn>`.
  const pathname = url.pathname.replace(/\/+$/, '');

  const feedToken = matchFeedUpdate(pathname);
  if (feedToken) return successOrMissingId(trimmed, feedToken);

  const postsToken = matchPosts(pathname);
  if (postsToken) return successOrMissingId(trimmed, postsToken);

  // A LinkedIn host but not a recognized post-bearing path: profile, company,
  // search, feed home, etc.
  return { ok: false, reason: 'unsupported_linkedin_url' };
}

// A recognized post path family was matched. `token` is the parsed
// type/id pair, or null when the path family is right but no numeric post id
// could be extracted.
function successOrMissingId(
  originalUrl: string,
  token: { type: UrnType; id: string } | 'missing',
): WonderWallParseResult {
  if (token === 'missing') return { ok: false, reason: 'missing_post_id' };
  const urn = buildUrn(token.type, token.id);
  return {
    ok: true,
    platform: 'linkedin',
    originalUrl,
    urn,
    embedUrl: toLinkedInEmbedUrl(urn),
  };
}

// Returns the parsed token for a `/feed/update/...` path, `'missing'` when the
// path is a feed-update path but carries no supported numeric urn, or null when
// it is not a feed-update path at all.
function matchFeedUpdate(pathname: string): { type: UrnType; id: string } | 'missing' | null {
  const prefix = '/feed/update/';
  if (!pathname.startsWith(prefix)) return null;
  const segment = safeDecode(pathname.slice(prefix.length));
  const match = FEED_URN_RE.exec(segment);
  if (!match) return 'missing';
  return { type: match[1] as UrnType, id: match[2] };
}

// Returns the parsed token for a `/posts/...` path, `'missing'` when the slug
// carries no supported numeric token, or null when it is not a posts path.
function matchPosts(pathname: string): { type: UrnType; id: string } | 'missing' | null {
  const prefix = '/posts/';
  if (!pathname.startsWith(prefix)) return null;
  const slug = safeDecode(pathname.slice(prefix.length));
  if (!slug) return 'missing';
  const match = POSTS_TOKEN_RE.exec(slug);
  if (!match) return 'missing';
  return { type: match[1] as UrnType, id: match[2] };
}
