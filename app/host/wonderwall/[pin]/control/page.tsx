// WonderWall host control room (MID-401). Server component: it runs the same
// auth + ownership guard the shell established (host session required, wrong
// host → notFound so the wall's existence isn't leaked), loads the FULL host
// state (every status, not just displayable) via getHostStateByPin, and hands a
// serialized, host-safe post list to the client review queue. The display link
// and CSV export are placeholders here — those land with their own tickets; this
// ticket owns the review/approve/reject/hide/restore/reorder surface only.
// See docs/wonderwall-iframe-plan.md §8.3 and §10.1.

import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import AccountMenu from '@/components/AccountMenu';
import { Chyron, Clock, FrameCounter, SmpteBars } from '@/components/Broadcast';
import { getHostStateByPin, WonderWallOwnershipError } from '@/lib/wonderwall-repo';
import WonderWallControlClient, { type ControlPost } from './control-client';

export default async function WonderWallControlPage({
  params,
}: {
  params: Promise<{ pin: string }>;
}) {
  const { pin } = await params;
  if (!/^\d{6}$/.test(pin)) notFound();

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) notFound();

  let state: Awaited<ReturnType<typeof getHostStateByPin>>;
  try {
    state = await getHostStateByPin({ pin, hostUserId: userId });
  } catch (err) {
    if (err instanceof WonderWallOwnershipError) notFound();
    throw err;
  }
  if (!state) notFound();

  const pendingCount = state.posts.filter((post) => post.status === 'PENDING').length;
  const displayableCount = state.posts.filter((post) => post.canDisplay).length;

  // Host-safe serialization (Dates → ISO so the row data can cross to the
  // client). The host owns the wall, so review fields are fine to ship here.
  const posts: ControlPost[] = state.posts.map((post) => ({
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
  }));

  return (
    <main className="relative min-h-screen pb-24">
      <header className="px-8 pt-6 flex items-center justify-between">
        <Chyron label="DIRECTOR · WONDERWALL" number="WW" />
        <div className="flex items-center gap-6">
          <FrameCounter index={1} />
          <Clock />
          <AccountMenu />
        </div>
      </header>
      <SmpteBars className="h-2 mt-4" />

      <section className="px-6 sm:px-8 pt-10 max-w-[920px] mx-auto">
        <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
          PIN · {state.pin} · {state.status}
        </p>
        <h1 className="display-num leading-[0.9]" style={{ fontSize: 'clamp(48px, 7vw, 96px)' }}>
          {state.title}
        </h1>
        {state.description && (
          <p className="font-editorial italic mt-4 max-w-[680px] opacity-80 text-lg">
            {state.description}
          </p>
        )}

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Metric label="SUBMISSIONS" value={state.posts.length} />
          <Metric label="PENDING REVIEW" value={pendingCount} />
          <Metric label="CAN DISPLAY" value={displayableCount} />
        </div>

        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <span
            aria-disabled="true"
            className="ink-border stamp px-5 py-3 ticker tracking-widest text-[12px] text-center opacity-60"
            style={{ background: 'var(--ash)', color: 'var(--bone)' }}
          >
            DISPLAY ROUTE COMING NEXT
          </span>
          <span
            aria-disabled="true"
            className="ink-border stamp px-5 py-3 ticker tracking-widest text-[12px] text-center opacity-60"
            style={{ background: 'var(--ash)', color: 'var(--bone)' }}
          >
            EXPORT SUBMISSIONS CSV COMING NEXT
          </span>
        </div>

        <WonderWallControlClient pin={state.pin} initialPosts={posts} />
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="ink-border p-4" style={{ background: 'var(--bone)' }}>
      <p className="ticker text-[11px] tracking-widest opacity-60">{label}</p>
      <p className="display-num text-5xl mt-2">{String(value).padStart(2, '0')}</p>
    </div>
  );
}
