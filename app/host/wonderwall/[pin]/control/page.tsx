// WonderWall host control room (MID-401). Server component: it runs the same
// auth + ownership guard the shell established (host session required, wrong
// host → notFound so the wall's existence isn't leaked), loads the FULL host
// state (every status, not just displayable) via getHostStateByPin, and hands a
// serialized, host-safe post list to the client review queue. The public display
// action opens the PIN-addressed projector route; the EXPORT SUBMISSIONS CSV
// action (MID-403) links to the host-only GET export route, which re-checks auth
// + ownership and streams every submission across statuses.
// See docs/wonderwall-iframe-plan.md §8.3, §6.8, §8.4 and §10.1.

import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import AccountMenu from '@/components/AccountMenu';
import { Chyron, Clock, FrameCounter, SmpteBars } from '@/components/Broadcast';
import { publicUrl } from '@/lib/public-origin';
import { resolveDisplayHeight } from '@/lib/wonderwall-height';
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
  const displayUrl = publicUrl(`/host/wonderwall/${state.pin}/display`);

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
    measureStatus: post.measureStatus,
    measuredHeight: post.measuredHeight,
    overrideHeight: post.overrideHeight,
    displayHeight: resolveDisplayHeight(post),
    authorName: post.authorName,
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

      <section className="px-6 sm:px-8 pt-10 max-w-[1180px] mx-auto">
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
          {/* Public projector route: no host cookie required, so use publicUrl()
              to prefer NEXT_PUBLIC_SITE_URL when a tunnel/live origin is configured. */}
          <a
            href={displayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ink-border stamp px-5 py-3 ticker tracking-widest text-[12px] text-center"
            style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
          >
            OPEN DISPLAY ↗
          </a>
          {/* Host-only CSV audit export (MID-403). Plain download anchor — the
              GET route enforces host auth + ownership and streams every
              submission (all statuses), not just displayable posts. `download`
              hints the filename; the route's Content-Disposition is the source
              of truth. */}
          <a
            href={`/api/wonderwall/${state.pin}/export`}
            download={`wonderwall-${state.pin}-submissions.csv`}
            className="ink-border stamp px-5 py-3 ticker tracking-widest text-[12px] text-center"
            style={{ background: 'var(--ink)', color: 'var(--bone)' }}
          >
            EXPORT SUBMISSIONS CSV ↓
          </a>
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
