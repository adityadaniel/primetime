// Host-only CSV export of WonderWall submissions (MID-403). This is the ONLY
// WonderWall read endpoint that is not public-by-PIN: it returns the complete
// moderation/audit log (every status, plus submitter/review metadata), so it
// requires a host session AND wall ownership. Route-level auth lives here rather
// than in middleware because the sibling endpoints (GET state, POST posts,
// my-posts) must stay reachable without a host cookie. listPostsForExport
// re-checks ownership inside the repo, so a wrong host can never read another
// host's submissions. See docs/wonderwall-iframe-plan.md §6.8 and §10.1.

import type { WonderWallPost } from '@prisma/client';
import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { buildWonderWallSubmissionsCsv } from '@/lib/wonderwall-export';
import {
  listPostsForExport,
  WonderWallNotFoundError,
  WonderWallOwnershipError,
} from '@/lib/wonderwall-repo';

export async function GET(
  _req: NextRequest,
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

  let posts: WonderWallPost[];
  try {
    // Ownership-guarded inside the repo: missing wall → NotFound, wrong host →
    // Ownership. Both surface as the project's standard error envelope below.
    posts = await listPostsForExport({ pin, hostUserId: userId });
  } catch (err) {
    if (err instanceof WonderWallOwnershipError) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (err instanceof WonderWallNotFoundError) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'export_failed' }, { status: 500 });
  }

  const csv = buildWonderWallSubmissionsCsv(posts);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="wonderwall-${pin}-submissions.csv"`,
      // Audit data — never let an intermediary cache it.
      'Cache-Control': 'no-store',
    },
  });
}
