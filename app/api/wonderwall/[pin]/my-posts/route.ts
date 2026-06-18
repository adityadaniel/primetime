// Participant feedback endpoint (MID-400). Public-by-PIN: lets a submitter see
// the status of their own WonderWall submissions for one browser, scoped by an
// opaque `submitterKey` they stored in sessionStorage. This is a convenience
// for feedback, NOT a security boundary (the key is client-controlled), so it
// is intentionally unauthenticated like /posts.
//
// Display-safety / privacy invariant: this route returns ONLY participant-safe
// fields (id, originalUrl, status, canDisplay, rejectionReason, failureReason,
// createdAt). It must never expose host-only moderation/export fields such as
// submitterName, submitterKey, position, reviewedByHostUserId, or the embed
// URL. See docs/wonderwall-iframe-plan.md §6.7 and §10.1 (public-by-PIN routes).

import { type NextRequest, NextResponse } from 'next/server';
import { getPostsForSubmitter } from '@/lib/wonderwall-repo';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ pin: string }> },
): Promise<NextResponse> {
  const { pin } = await ctx.params;
  // Malformed PIN is direct API misuse (the participant UI only ever holds a
  // valid six-digit PIN), so 400 it. A well-formed but unknown PIN falls
  // through to getPostsForSubmitter, which returns [] rather than leaking
  // whether the wall exists.
  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: 'invalid_pin' }, { status: 400 });
  }

  const submitterKey = new URL(req.url).searchParams.get('submitterKey')?.trim() ?? '';
  if (!submitterKey) {
    return NextResponse.json({ error: 'missing_submitter_key' }, { status: 400 });
  }
  if (submitterKey.length > 120) {
    return NextResponse.json({ error: 'invalid_submitter_key' }, { status: 400 });
  }

  // getPostsForSubmitter is the only data source: it scopes to this wall +
  // submitterKey and returns [] for an unknown pin/empty key, so an unknown
  // wall is indistinguishable from one with no submissions from this browser.
  const posts = await getPostsForSubmitter({ pin, submitterKey });

  return NextResponse.json({
    posts: posts.map((post) => ({
      id: post.id,
      originalUrl: post.originalUrl,
      status: post.status,
      canDisplay: post.canDisplay,
      rejectionReason: post.rejectionReason,
      failureReason: post.failureReason,
      createdAt: post.createdAt.toISOString(),
    })),
  });
}
