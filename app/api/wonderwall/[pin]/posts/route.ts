// Participant LinkedIn URL submission (MID-399). Public-by-PIN: this is the
// only WonderWall write path reachable without host auth, so it is the place
// the display-safety invariant has to hold. It delegates to submitPost(),
// which parses/normalizes the URL and persists ONLY a PENDING,
// canDisplay=false row — this handler never approves a post or sets
// canDisplay=true, and never scrapes or stores LinkedIn post content (only the
// URL/URN/embed URL the parser derives). See docs/wonderwall-iframe-plan.md
// §6.3 and §10.1 (public-by-PIN routes).

import { type NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  submitPost,
  WonderWallSubmissionError,
  type WonderWallSubmissionErrorReason,
} from '@/lib/wonderwall-repo';

// Machine-readable `reason` → user-facing copy. The participant page shows
// these verbatim and invites the user to try another URL.
const USER_MESSAGES: Record<WonderWallSubmissionErrorReason, string> = {
  invalid_url: 'That does not look like a valid URL. Paste a public LinkedIn post link.',
  unsupported_protocol: 'LinkedIn post links must start with https://.',
  unsupported_host: 'Only public linkedin.com post links are supported.',
  unsupported_linkedin_url:
    'That LinkedIn link is not a post. Open the post itself, then copy its link.',
  missing_post_id:
    'We could not find a LinkedIn post id in that link. Open the post and copy its link again.',
  session_not_found: 'That wall could not be found. Check the PIN and try again.',
  submissions_closed: 'This wall is no longer accepting submissions.',
};

const RATE_LIMIT_MESSAGE = 'Too many submissions. Wait a moment, then try again.';
const SUBMISSION_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

function ipRateLimitKey(req: NextRequest, pin: string): string {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwardedFor || req.headers.get('x-real-ip')?.trim() || 'unknown';
  return `wonderwall:submit:${pin}:ip:${ip}`;
}

function submitterRateLimitKey(pin: string, submitterKey: string): string {
  const participant = submitterKey?.trim();
  return `wonderwall:submit:${pin}:submitter:${participant}`;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ pin: string }> },
): Promise<NextResponse> {
  const { pin } = await ctx.params;
  // Malformed PIN is direct API misuse (the participant UI only ever holds a
  // valid six-digit PIN), so 400 it. A well-formed but unknown PIN is handled
  // below via submitPost → session_not_found → 404.
  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: 'invalid_pin' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { url, submitterName, submitterKey } = body as {
    url?: unknown;
    submitterName?: unknown;
    submitterKey?: unknown;
  };

  if (typeof url !== 'string' || !url.trim()) {
    return NextResponse.json(
      { error: 'invalid_url', message: USER_MESSAGES.invalid_url },
      { status: 400 },
    );
  }
  if (submitterName !== undefined && submitterName !== null && typeof submitterName !== 'string') {
    return NextResponse.json({ error: 'invalid_submitter_name' }, { status: 400 });
  }
  if (typeof submitterName === 'string' && submitterName.trim().length > 40) {
    return NextResponse.json({ error: 'invalid_submitter_name' }, { status: 400 });
  }
  if (submitterKey !== undefined && submitterKey !== null && typeof submitterKey !== 'string') {
    return NextResponse.json({ error: 'invalid_submitter_key' }, { status: 400 });
  }
  if (typeof submitterKey === 'string' && submitterKey.trim().length > 120) {
    return NextResponse.json({ error: 'invalid_submitter_key' }, { status: 400 });
  }

  const normalizedSubmitterKey =
    typeof submitterKey === 'string' ? submitterKey.trim() || null : null;
  // Apply the network-level bucket unconditionally. `submitterKey` is a
  // client-controlled browser convenience, not a security boundary, so it must
  // not let scripted clients rotate keys to bypass the per-IP abuse limit.
  const ipLimit = checkRateLimit(ipRateLimitKey(req, pin), SUBMISSION_RATE_LIMIT);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: 'rate_limited', message: RATE_LIMIT_MESSAGE },
      { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSec) } },
    );
  }

  if (normalizedSubmitterKey) {
    const submitterLimit = checkRateLimit(
      submitterRateLimitKey(pin, normalizedSubmitterKey),
      SUBMISSION_RATE_LIMIT,
    );
    if (!submitterLimit.ok) {
      return NextResponse.json(
        { error: 'rate_limited', message: RATE_LIMIT_MESSAGE },
        { status: 429, headers: { 'Retry-After': String(submitterLimit.retryAfterSec) } },
      );
    }
  }

  try {
    // submitPost centralizes the no-display invariant: it parses the URL and
    // persists only PENDING/canDisplay=false rows (trimming submitter fields),
    // and throws WonderWallSubmissionError for invalid/closed/missing walls.
    const post = await submitPost({
      pin,
      url,
      submitterName: submitterName ?? null,
      submitterKey: submitterKey ?? null,
    });
    return NextResponse.json({
      post: {
        id: post.id,
        originalUrl: post.originalUrl,
        urn: post.urn,
        status: 'PENDING' as const,
        canDisplay: false as const,
        createdAt: post.createdAt.toISOString(),
      },
      message: 'Submitted for host review',
    });
  } catch (err) {
    if (err instanceof WonderWallSubmissionError) {
      const message = USER_MESSAGES[err.reason];
      if (err.reason === 'session_not_found') {
        // Project-standard not-found shape (matches the host CSV routes).
        return NextResponse.json({ error: 'not_found', message }, { status: 404 });
      }
      if (err.reason === 'submissions_closed') {
        return NextResponse.json({ error: err.reason, message }, { status: 409 });
      }
      // Parser rejections: malformed/unsupported URL the user can fix and retry.
      return NextResponse.json({ error: err.reason, message }, { status: 400 });
    }
    return NextResponse.json({ error: 'submit_failed' }, { status: 500 });
  }
}
