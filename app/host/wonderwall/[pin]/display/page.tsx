// WonderWall public display / projection surface (MID-402). Server component:
// it is the public-by-PIN projector view, so it must work WITHOUT a host auth
// cookie — the exemption lives in auth.config.ts:isPublicHostDisplayPath(). It
// renders only DB-approved, displayable posts and never any host-only metadata.
//
// Data path: getPublicStateByPin() already enforces the projector gate (returns
// ONLY status=APPROVED + canDisplay=true rows, ordered for the waterfall), so
// pending/rejected/hidden/failed submissions can never reach this surface even
// in principle. We call the repo directly rather than through an HTTP route
// because this page needs no host session and the public state shape is exactly
// what the repo emits. force-dynamic keeps every projector load fresh; the
// client child adds light polling so approvals appear without a manual reload.
// Full realtime refresh (socket fan-out) is MID-405 and intentionally out of
// scope here. See docs/wonderwall-iframe-plan.md §8.4 and §10.1-10.2.

import { notFound } from 'next/navigation';
import { getPublicStateByPin } from '@/lib/wonderwall-repo';
import WonderWallDisplayClient from './display-client';

export const dynamic = 'force-dynamic';

export default async function WonderWallDisplayPage({
  params,
}: {
  params: Promise<{ pin: string }>;
}) {
  const { pin } = await params;
  if (!/^\d{6}$/.test(pin)) notFound();

  const state = await getPublicStateByPin(pin);
  if (!state) notFound();

  // Only the public, projector-safe fields cross to the client. This mirrors
  // the WonderWallPublicState DTO; no submitter/review metadata exists on it.
  return (
    <WonderWallDisplayClient
      pin={state.pin}
      title={state.title}
      description={state.description}
      instructions={state.instructions}
      posts={state.posts.map((post) => ({
        id: post.id,
        originalUrl: post.originalUrl,
        embedUrl: post.embedUrl,
        displayHeight: post.displayHeight,
      }))}
    />
  );
}
