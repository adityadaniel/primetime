// Host reorder action (MID-401). Host-only and ownership-guarded: reassigns the
// display positions of a wall's approved/displayable posts. Ownership is
// asserted via assertHostOwnsSession() before any write, and reorderApprovedPosts()
// independently validates that every id is an approved/displayable post of THIS
// session inside a serializable transaction — so the waterfall can never end up
// half-renumbered or include a pending/hidden post. Route-level auth lives here
// (not middleware) so the sibling public WonderWall endpoints stay unprotected.
// See docs/wonderwall-iframe-plan.md §6.5 and §10.1 (protected routes).

import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  assertHostOwnsSession,
  reorderApprovedPosts,
  WonderWallNotFoundError,
  WonderWallOwnershipError,
  WonderWallReorderError,
} from '@/lib/wonderwall-repo';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ pin: string }> },
): Promise<NextResponse> {
  const { pin } = await ctx.params;
  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: 'invalid_pin' }, { status: 400 });
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
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

  const { orderedPostIds } = body as { orderedPostIds?: unknown };
  if (
    !Array.isArray(orderedPostIds) ||
    !orderedPostIds.every((id) => typeof id === 'string' && id.length > 0)
  ) {
    return NextResponse.json({ error: 'invalid_ordered_post_ids' }, { status: 400 });
  }

  let wall: Awaited<ReturnType<typeof assertHostOwnsSession>>;
  try {
    wall = await assertHostOwnsSession({ pin, hostUserId: userId });
  } catch (err) {
    if (err instanceof WonderWallOwnershipError) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (err instanceof WonderWallNotFoundError) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'reorder_failed' }, { status: 500 });
  }

  try {
    await reorderApprovedPosts({ sessionId: wall.id, orderedPostIds });
  } catch (err) {
    // The id set didn't match the wall's current approved/displayable posts
    // (stale client order, duplicate, or a non-displayable id) — the whole
    // reorder rolled back. 400 so the client refetches and retries.
    if (err instanceof WonderWallReorderError) {
      return NextResponse.json({ error: 'invalid_order', message: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'reorder_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, orderedPostIds });
}
