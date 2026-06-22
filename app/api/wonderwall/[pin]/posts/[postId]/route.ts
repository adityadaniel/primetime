// Host review action (MID-401). Host-only and ownership-guarded: this is the
// authenticated counterpart to the public-by-PIN submission route, and the
// ONLY path that flips a post to displayable. It delegates to reviewPost(),
// which re-checks pin + host ownership inside its serializable transaction, so
// a wrong host can never mutate another host's wall even if they craft the
// request. Route-level auth lives here (not middleware) because the sibling
// public WonderWall endpoints must stay unprotected. See
// docs/wonderwall-iframe-plan.md §6.4 and §10.1 (protected routes).

import type { WonderWallPost } from '@prisma/client';
import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { config } from '@/lib/config';
import { fetchPostContentInBackground } from '@/lib/wonderwall-content';
import { resolveDisplayHeight } from '@/lib/wonderwall-height';
import {
  measurePostHeightInBackground,
  reviewPost,
  setPostHeight,
  WonderWallNotFoundError,
  WonderWallOwnershipError,
  type WonderWallReviewAction,
} from '@/lib/wonderwall-repo';

// The control surface exposes only these four host actions. The repo also
// supports `fail`, but that audit transition is reserved for the parser/embed
// pipeline, not the manual review queue, so it is intentionally not accepted.
const REVIEW_ACTIONS = ['approve', 'reject', 'hide', 'restore'] as const;
type HostReviewActionName = (typeof REVIEW_ACTIONS)[number];

function isReviewAction(value: unknown): value is HostReviewActionName {
  return typeof value === 'string' && (REVIEW_ACTIONS as readonly string[]).includes(value);
}

// VarChar(240) in the schema; reject the request rather than silently truncate.
const REJECTION_REASON_MAX = 240;

// Drag-to-fit override bounds. Mirrors lib/wonderwall-repo OVERRIDE_HEIGHT_*.
const OVERRIDE_HEIGHT_MIN = 140;
const OVERRIDE_HEIGHT_MAX = 4000;

// Host-only response shape. The host already owns the wall, so review/audit
// fields (embedUrl, submitterKey, position, reviewedAt) are safe to return here
// — unlike the public/participant routes, which must never echo them.
function serializeHostPost(post: WonderWallPost) {
  return {
    id: post.id,
    originalUrl: post.originalUrl,
    urn: post.urn,
    embedUrl: post.embedUrl,
    status: post.status,
    canDisplay: post.canDisplay,
    position: post.position,
    submitterName: post.submitterName,
    submitterKey: post.submitterKey,
    rejectionReason: post.rejectionReason,
    failureReason: post.failureReason,
    createdAt: post.createdAt.toISOString(),
    reviewedAt: post.reviewedAt ? post.reviewedAt.toISOString() : null,
    // Dynamic-height masonry state. displayHeight is the resolved value the
    // projector renders; the raw fields let the control room show AUTO vs SET
    // and the "may require login" warning when measurement failed.
    measuredHeight: post.measuredHeight,
    overrideHeight: post.overrideHeight,
    measureStatus: post.measureStatus,
    displayHeight: resolveDisplayHeight(post),
    // Host-only author label (DECISIONS.md 2026-06-19 "WonderWall author label").
    authorName: post.authorName,
  };
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ pin: string; postId: string }> },
): Promise<NextResponse> {
  const { pin, postId } = await ctx.params;
  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: 'invalid_pin' }, { status: 400 });
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  if (!postId) {
    return NextResponse.json({ error: 'invalid_post_id' }, { status: 400 });
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

  const { action, reason, height } = body as {
    action?: unknown;
    reason?: unknown;
    height?: unknown;
  };

  // Drag-to-fit height override. Separate from the review state machine: it does
  // not change status/canDisplay, only the rendered card height. height=null
  // clears the override (falls back to auto-measured/default).
  if (action === 'set_height') {
    let overrideHeight: number | null;
    if (height === null) {
      overrideHeight = null;
    } else if (
      typeof height === 'number' &&
      Number.isFinite(height) &&
      height >= OVERRIDE_HEIGHT_MIN &&
      height <= OVERRIDE_HEIGHT_MAX
    ) {
      overrideHeight = Math.round(height);
    } else {
      return NextResponse.json({ error: 'invalid_height' }, { status: 400 });
    }
    try {
      const post = await setPostHeight({ postId, pin, hostUserId: userId, height: overrideHeight });
      return NextResponse.json({ post: serializeHostPost(post) });
    } catch (err) {
      if (err instanceof WonderWallOwnershipError) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
      if (err instanceof WonderWallNotFoundError) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      return NextResponse.json({ error: 'set_height_failed' }, { status: 500 });
    }
  }

  if (!isReviewAction(action)) {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  }

  let reviewAction: WonderWallReviewAction;
  if (action === 'reject') {
    if (reason !== undefined && reason !== null && typeof reason !== 'string') {
      return NextResponse.json({ error: 'invalid_reason' }, { status: 400 });
    }
    if (typeof reason === 'string' && reason.trim().length > REJECTION_REASON_MAX) {
      return NextResponse.json({ error: 'invalid_reason' }, { status: 400 });
    }
    reviewAction = { action: 'reject', reason: typeof reason === 'string' ? reason : null };
  } else {
    reviewAction = { action };
  }

  try {
    // reviewPost re-verifies pin + host ownership inside its transaction, so the
    // ownership check is centralized in the repo rather than trusted here.
    const post = await reviewPost({ postId, pin, hostUserId: userId, ...reviewAction });
    // When a post becomes displayable, auto-measure its card height in the
    // background (unless already measured OK). Fire-and-forget: the response
    // returns now and the next control/display poll surfaces the stored height.
    if ((action === 'approve' || action === 'restore') && post.measureStatus !== 'OK') {
      measurePostHeightInBackground(post.id);
    }
    // Opt-in content analysis (DECISIONS.md 2026-06-21): on approval, fetch the
    // post's LinkedIn content via Apify in the background for host-only insights.
    // Flag-gated and OFF by default; the Apify client also no-ops without a token.
    if ((action === 'approve' || action === 'restore') && config.wonderwallAnalysisEnabled) {
      fetchPostContentInBackground(post.id);
    }
    return NextResponse.json({ post: serializeHostPost(post) });
  } catch (err) {
    // Wrong host owns the wall → 403 (do not reveal more); unknown post/pin
    // mismatch → 404. Both shapes match the project's standard error envelope.
    if (err instanceof WonderWallOwnershipError) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (err instanceof WonderWallNotFoundError) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'review_failed' }, { status: 500 });
  }
}
