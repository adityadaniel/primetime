// Public WonderWall state (MID-404). Public-by-PIN: this is the projector/player
// read endpoint, the HTTP counterpart to the server-rendered display page. It
// delegates to getPublicStateByPin(), which is the projector gate — it returns
// ONLY status=APPROVED + canDisplay=true rows mapped to the public DTO, so
// pending/rejected/hidden/failed content and every host-only field (submitter
// name/key, rejectionReason, failureReason, review timestamps,
// reviewedByHostUserId) can never leak onto a display surface. It requires no
// host cookie, which is why this route is intentionally NOT covered by the
// middleware matcher and the host-only sibling (`/export`) keeps its own
// route-level auth. See docs/wonderwall-iframe-plan.md §6.2 and §10.1–10.2.

import { type NextRequest, NextResponse } from 'next/server';
import { getPublicStateByPin } from '@/lib/wonderwall-repo';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ pin: string }> },
): Promise<NextResponse> {
  const { pin } = await ctx.params;
  // Malformed PIN is direct API misuse (display/player UIs only ever hold a
  // valid six-digit PIN), so 400 it before touching the database.
  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: 'invalid_pin' }, { status: 400 });
  }

  // getPublicStateByPin returns the public-safe DTO (approved + displayable only)
  // or null when the wall does not exist.
  const state = await getPublicStateByPin(pin);
  if (!state) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json(state, {
    headers: {
      // Approvals/hides must surface promptly on the projector, so never let an
      // intermediary serve a stale wall.
      'Cache-Control': 'no-store',
    },
  });
}
