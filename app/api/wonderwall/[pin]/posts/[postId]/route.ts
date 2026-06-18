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
import {
  reviewPost,
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

  const { action, reason } = body as { action?: unknown; reason?: unknown };
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
