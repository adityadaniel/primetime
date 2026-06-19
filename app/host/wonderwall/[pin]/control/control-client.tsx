'use client';

// WonderWall host review queue (MID-401). Master–detail control surface: a
// select-only LEFT sidebar lists every submission in three status groups
// (pending / on air / benched), and the RIGHT detail pane shows the selected
// post with its collapsed iframe preview, the drag-to-fit height handle, and the
// status-appropriate review actions. Only one iframe (the selected post) renders
// at a time, so the control room never pays for dozens of cross-origin embeds.
// Each row/pane states CAN DISPLAY: YES/NO explicitly so the host never guesses
// whether a post is on air.
//
// Refresh (MID-405): the queue keeps optimistic local state for snappy review,
// but it also polls router.refresh() so submissions participants send AFTER the
// page mounted surface as new PENDING rows without a manual reload — the server
// component re-runs against the DB (the source of truth) and hands fresh rows in
// as initialPosts, which the sync effect below reconciles into local state. This
// is the documented polling fallback; no Socket.IO and no in-memory WonderWall
// state machine are introduced. See docs/wonderwall-iframe-plan.md §8.3.

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WONDERWALL_RENDER_WIDTH } from '@/lib/wonderwall-height';
import { toCollapsedLinkedInEmbedUrl } from '@/lib/wonderwall-input';

// Poll cadence for the host queue. 8s matches the projector display
// (display-client.tsx): brisk enough that new submissions appear within a few
// seconds, slow enough that the auth'd page re-render and DB read stay cheap for
// a single host tab. Mutations stay HTTP + DB; this only re-reads.
const REFRESH_INTERVAL_MS = 8000;

type PostStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'HIDDEN' | 'FAILED';

export type ControlPost = {
  id: string;
  originalUrl: string;
  urn: string;
  embedUrl: string;
  status: PostStatus;
  canDisplay: boolean;
  position: number | null;
  submitterName: string | null;
  submitterKey: string | null;
  rejectionReason: string | null;
  failureReason: string | null;
  createdAt: string;
  // Dynamic-height masonry state (POC 3).
  measureStatus: string | null;
  measuredHeight: number | null;
  overrideHeight: number | null;
  displayHeight: number;
  // Embedded post's author display name (host-only), null until measured.
  authorName: string | null;
};

type ReviewAction = 'approve' | 'reject' | 'hide' | 'restore';

const STATUS_COLORS: Record<PostStatus, string> = {
  PENDING: 'var(--vermilion)',
  APPROVED: '#1f7a3d',
  REJECTED: 'var(--ash)',
  HIDDEN: 'var(--ash)',
  FAILED: 'var(--ash)',
};

// Displayable order the projector reads: approved + canDisplay, by position
// then submission time so the list is stable while a reorder is in flight.
function displayOrder(posts: ControlPost[]): ControlPost[] {
  return posts
    .filter((post) => post.status === 'APPROVED' && post.canDisplay)
    .sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

export default function WonderWallControlClient({
  pin,
  initialPosts,
}: {
  pin: string;
  initialPosts: ControlPost[];
}) {
  const router = useRouter();
  const [posts, setPosts] = useState<ControlPost[]>(initialPosts);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialPosts[0]?.id ?? null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // True while a review/reorder PATCH is in flight. Read by the sync effect so
  // an in-flight poll can't clobber an optimistic update with a row it fetched a
  // moment before the host acted (the mutation already persisted to the DB, so
  // the next poll reconciles to the same result).
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busyId !== null;
  }, [busyId]);

  // Reconcile server-refreshed rows into local state. router.refresh() (and any
  // navigation) re-runs the page server component with fresh DB rows handed in
  // as initialPosts; without this the optimistic local copy would never pick up
  // posts participants submit after mount. Form-only UI state (rejectReason,
  // rejecting, selectedId) lives outside `posts`, so a sync never disturbs it.
  useEffect(() => {
    if (busyRef.current) return;
    setPosts(initialPosts);
  }, [initialPosts]);

  // Light polling stand-in for full realtime refresh (MID-405): re-run the
  // server component so participant submissions surface as PENDING rows on their
  // own. Skip while a mutation is in flight to avoid a stale-read flicker.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!busyRef.current) router.refresh();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [router]);

  const pending = useMemo(() => posts.filter((p) => p.status === 'PENDING'), [posts]);
  const onAir = useMemo(() => displayOrder(posts), [posts]);
  const benched = useMemo(
    () =>
      posts
        .filter((p) => p.status === 'REJECTED' || p.status === 'HIDDEN' || p.status === 'FAILED')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [posts],
  );

  // Keep a valid selection: if the selected post vanished (or none is selected),
  // fall back to the first pending → on-air → benched post.
  useEffect(() => {
    if (selectedId && posts.some((p) => p.id === selectedId)) return;
    const next = pending[0] ?? onAir[0] ?? benched[0] ?? null;
    setSelectedId(next ? next.id : null);
    setRejecting(false);
    setRejectReason('');
  }, [selectedId, posts, pending, onAir, benched]);

  const selected = useMemo(
    () => posts.find((p) => p.id === selectedId) ?? null,
    [posts, selectedId],
  );

  // Select a post and reset the (per-post) reject form in one step.
  const selectPost = useCallback((id: string) => {
    setSelectedId(id);
    setRejecting(false);
    setRejectReason('');
  }, []);

  const replacePost = useCallback((next: ControlPost) => {
    setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  }, []);

  const review = useCallback(
    async (postId: string, action: ReviewAction, reason?: string) => {
      setBusyId(postId);
      setError(null);
      try {
        const res = await fetch(`/api/wonderwall/${pin}/posts/${postId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reason !== undefined ? { action, reason } : { action }),
        });
        const data = (await res.json().catch(() => null)) as { post?: ControlPost } | null;
        if (!res.ok || !data?.post) {
          setError(`Could not ${action} that post. Reload and try again.`);
          return;
        }
        replacePost(data.post);
        setRejecting(false);
        setRejectReason('');
        // Re-sync with the DB so a status change (e.g. approve assigning a
        // display position) reflects authoritative server state immediately
        // rather than waiting for the next poll tick.
        router.refresh();
      } catch {
        setError('Network error — reload and try again.');
      } finally {
        setBusyId(null);
      }
    },
    [pin, replacePost, router],
  );

  // Drag-to-fit height override (POC 3). PATCH set_height; height=null clears the
  // override back to the auto-measured/default value. Replaces the row with the
  // server's authoritative post (its resolved displayHeight).
  const setHeight = useCallback(
    async (postId: string, height: number | null) => {
      setBusyId(postId);
      setError(null);
      try {
        const res = await fetch(`/api/wonderwall/${pin}/posts/${postId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set_height', height }),
        });
        const data = (await res.json().catch(() => null)) as { post?: ControlPost } | null;
        if (!res.ok || !data?.post) {
          setError('Could not set the card height. Reload and try again.');
          return;
        }
        replacePost(data.post);
        router.refresh();
      } catch {
        setError('Network error — reload and try again.');
      } finally {
        setBusyId(null);
      }
    },
    [pin, replacePost, router],
  );

  const move = useCallback(
    async (postId: string, direction: -1 | 1) => {
      const order = displayOrder(posts);
      const index = order.findIndex((p) => p.id === postId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= order.length) return;
      const reordered = [...order];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      const orderedPostIds = reordered.map((p) => p.id);

      setBusyId(postId);
      setError(null);
      try {
        const res = await fetch(`/api/wonderwall/${pin}/posts/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderedPostIds }),
        });
        if (!res.ok) {
          setError('Could not reorder. The display order may have changed — reload.');
          return;
        }
        // Mirror the server's sequential position assignment locally.
        const positionById = new Map(orderedPostIds.map((id, i) => [id, i]));
        setPosts((prev) =>
          prev.map((p) =>
            positionById.has(p.id) ? { ...p, position: positionById.get(p.id)! } : p,
          ),
        );
        router.refresh();
      } catch {
        setError('Network error — reload and try again.');
      } finally {
        setBusyId(null);
      }
    },
    [pin, posts, router],
  );

  const onAirIndex = selected ? onAir.findIndex((p) => p.id === selected.id) : -1;

  return (
    <div className="mt-10">
      {error && (
        <p
          className="ink-border px-4 py-3 ticker text-[12px] mb-6"
          style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
        {/* LEFT: select-only sidebar, grouped by status. */}
        <aside className="space-y-7 lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto lg:pr-1">
          <SidebarSection title="PENDING REVIEW" count={pending.length} empty="Nothing waiting.">
            {pending.map((post) => (
              <SidebarRow
                key={post.id}
                post={post}
                selected={post.id === selectedId}
                busy={busyId === post.id}
                onSelect={() => selectPost(post.id)}
              />
            ))}
          </SidebarSection>

          <SidebarSection
            title="ON AIR · DISPLAY ORDER"
            count={onAir.length}
            empty="No approved posts yet."
          >
            {onAir.map((post) => (
              <SidebarRow
                key={post.id}
                post={post}
                selected={post.id === selectedId}
                busy={busyId === post.id}
                onSelect={() => selectPost(post.id)}
              />
            ))}
          </SidebarSection>

          <SidebarSection
            title="REJECTED · HIDDEN · FAILED"
            count={benched.length}
            empty="Nothing benched."
          >
            {benched.map((post) => (
              <SidebarRow
                key={post.id}
                post={post}
                selected={post.id === selectedId}
                busy={busyId === post.id}
                onSelect={() => selectPost(post.id)}
              />
            ))}
          </SidebarSection>
        </aside>

        {/* RIGHT: detail pane for the selected post. */}
        <div className="lg:sticky lg:top-6">
          {selected ? (
            <DetailPane
              post={selected}
              busy={busyId === selected.id}
              onAirIndex={onAirIndex}
              onAirCount={onAir.length}
              rejecting={rejecting}
              rejectReason={rejectReason}
              onStartReject={() => {
                setRejecting(true);
                setRejectReason('');
              }}
              onCancelReject={() => setRejecting(false)}
              onRejectReasonChange={setRejectReason}
              onReview={review}
              onMove={move}
              onSetHeight={setHeight}
            />
          ) : (
            <div className="ink-border p-10 text-center" style={{ background: 'var(--bone)' }}>
              <p className="chyron mb-2" style={{ color: 'var(--vermilion)' }}>
                NO POST SELECTED
              </p>
              <p className="font-editorial italic opacity-70">
                Submissions will appear in the list on the left. Pick one to review and fit.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SidebarSection({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        className="flex items-baseline justify-between border-b-2 pb-2"
        style={{ borderColor: 'var(--ink)' }}
      >
        <h2 className="chyron text-[12px] tracking-widest">{title}</h2>
        <span className="display-num text-xl">{String(count).padStart(2, '0')}</span>
      </div>
      {count === 0 ? (
        <p className="font-editorial italic opacity-50 text-sm mt-3">{empty}</p>
      ) : (
        <div className="mt-3 space-y-2">{children}</div>
      )}
    </section>
  );
}

function SidebarRow({
  post,
  selected,
  busy,
  onSelect,
}: {
  post: ControlPost;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="ink-border w-full text-left px-3 py-2 transition-opacity"
      style={{
        background: selected ? 'var(--ink)' : 'var(--bone)',
        color: selected ? 'var(--bone)' : 'var(--ink)',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ background: selected ? 'var(--bone)' : STATUS_COLORS[post.status] }}
        />
        {/* Primary label is the embedded post's AUTHOR so one submitter's many
            posts are distinguishable. Falls back to submitter/URN until measured. */}
        <span className="font-editorial text-[15px] leading-tight truncate">
          {post.authorName ??
            (post.measureStatus === 'PENDING' ? 'Measuring…' : post.submitterName) ??
            'Unknown author'}
        </span>
        {post.status === 'APPROVED' && post.canDisplay && post.position !== null && (
          <span className="ticker text-[10px] tracking-widest ml-auto opacity-70 shrink-0">
            POS {String(post.position + 1).padStart(2, '0')}
          </span>
        )}
        {post.measureStatus === 'FAILED' && (
          <span className="ml-auto shrink-0" title="May require LinkedIn login to display">
            ⚠
          </span>
        )}
      </div>
      {/* Secondary line: who submitted it (moderation context), else the URN. */}
      <p className="ticker text-[9px] tracking-widest truncate mt-1 opacity-60">
        {post.submitterName ? `FROM · ${post.submitterName}` : post.urn}
      </p>
    </button>
  );
}

function DetailPane({
  post,
  busy,
  onAirIndex,
  onAirCount,
  rejecting,
  rejectReason,
  onStartReject,
  onCancelReject,
  onRejectReasonChange,
  onReview,
  onMove,
  onSetHeight,
}: {
  post: ControlPost;
  busy: boolean;
  onAirIndex: number;
  onAirCount: number;
  rejecting: boolean;
  rejectReason: string;
  onStartReject: () => void;
  onCancelReject: () => void;
  onRejectReasonChange: (value: string) => void;
  onReview: (postId: string, action: ReviewAction, reason?: string) => void;
  onMove: (postId: string, direction: -1 | 1) => void;
  onSetHeight: (postId: string, height: number | null) => void;
}) {
  const onAir = post.status === 'APPROVED' && post.canDisplay;
  return (
    <article
      className="ink-border p-5"
      style={{ background: 'var(--bone)', opacity: busy ? 0.6 : 1 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="stamp ink-border px-2 py-1 ticker text-[10px] tracking-widest"
          style={{ background: 'var(--ink)', color: 'var(--bone)' }}
        >
          LINKEDIN
        </span>
        <span
          className="ticker text-[11px] tracking-widest"
          style={{ color: STATUS_COLORS[post.status] }}
        >
          {post.status}
        </span>
        <span
          className="ink-border px-2 py-1 ticker text-[10px] tracking-widest"
          style={{ background: post.canDisplay ? '#1f7a3d' : 'var(--ash)', color: 'var(--bone)' }}
        >
          CAN DISPLAY: {post.canDisplay ? 'YES' : 'NO'}
        </span>
        {onAir && post.position !== null && (
          <span className="ticker text-[10px] tracking-widest opacity-60">
            POS {String(post.position + 1).padStart(2, '0')}
          </span>
        )}
        {/* Measurement failed → LinkedIn served the logged-out wall, so this post
            likely won't render for a logged-out projector either (POC 3). */}
        {post.measureStatus === 'FAILED' && (
          <span
            className="ink-border px-2 py-1 ticker text-[10px] tracking-widest"
            style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
            title="LinkedIn would not render this embed to a logged-out viewer. It may show a sign-in wall on the projector; set the height manually and keep OPEN ON LINKEDIN as the fallback."
          >
            ⚠ MAY NEED LOGIN TO DISPLAY
          </span>
        )}
      </div>

      {/* Embedded post's author (host-only). Null until measured / on failure. */}
      <p className="font-editorial text-2xl mt-3 leading-tight">
        {post.authorName ??
          (post.measureStatus === 'PENDING' ? 'Measuring author…' : 'Author unavailable')}
      </p>
      <p className="font-mono text-[12px] break-all mt-2 opacity-70">{post.urn}</p>
      <a
        href={post.originalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[12px] break-all underline inline-block mt-1"
        style={{ color: 'var(--vermilion)' }}
      >
        OPEN ORIGINAL ↗
      </a>

      {post.submitterName && (
        <p className="ticker text-[10px] tracking-widest opacity-60 mt-2">
          FROM · {post.submitterName}
        </p>
      )}
      {post.rejectionReason && (
        <p className="font-editorial italic text-[13px] mt-2 opacity-80">
          Reason: {post.rejectionReason}
        </p>
      )}
      {post.failureReason && (
        <p className="font-editorial italic text-[13px] mt-2 opacity-80">
          Failure: {post.failureReason}
        </p>
      )}

      <HeightFitPreview post={post} busy={busy} onSetHeight={onSetHeight} />

      <div className="flex flex-wrap gap-2 mt-4">
        {post.status === 'PENDING' && (
          <>
            <ActionButton
              label="APPROVE"
              primary
              disabled={busy}
              onClick={() => onReview(post.id, 'approve')}
            />
            <ActionButton label="REJECT" disabled={busy} onClick={onStartReject} />
          </>
        )}
        {onAir && (
          <>
            <ActionButton
              label="▲ UP"
              disabled={busy || onAirIndex <= 0}
              onClick={() => onMove(post.id, -1)}
            />
            <ActionButton
              label="▼ DOWN"
              disabled={busy || onAirIndex < 0 || onAirIndex >= onAirCount - 1}
              onClick={() => onMove(post.id, 1)}
            />
            <ActionButton label="HIDE" disabled={busy} onClick={() => onReview(post.id, 'hide')} />
          </>
        )}
        {post.status === 'HIDDEN' && (
          <ActionButton
            label="RESTORE"
            primary
            disabled={busy}
            onClick={() => onReview(post.id, 'restore')}
          />
        )}
        {post.status === 'REJECTED' && (
          <ActionButton
            label="APPROVE"
            primary
            disabled={busy}
            onClick={() => onReview(post.id, 'approve')}
          />
        )}
      </div>

      {rejecting && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => onRejectReasonChange(e.target.value)}
            maxLength={240}
            placeholder="Optional reason (shown to submitter)"
            className="ink-border px-3 py-2 font-mono text-[12px] flex-1 min-w-[200px]"
            style={{ background: 'var(--bone)' }}
          />
          <ActionButton
            label="CONFIRM REJECT"
            primary
            disabled={busy}
            onClick={() => onReview(post.id, 'reject', rejectReason.trim() || undefined)}
          />
          <ActionButton label="CANCEL" disabled={busy} onClick={onCancelReject} />
        </div>
      )}
    </article>
  );
}

// Drag-to-fit height preview (POC 3). Renders the collapsed OFFICIAL embed at the
// projector's fixed width and lets the host drag the bottom edge to set the card
// height that the masonry wall will use. Changing the iframe's height attribute
// resizes without reloading it (only a src change reloads), so dragging is smooth.
const FIT_MIN = 140;
const FIT_MAX = 4000;

function HeightFitPreview({
  post,
  busy,
  onSetHeight,
}: {
  post: ControlPost;
  busy: boolean;
  onSetHeight: (postId: string, height: number | null) => void;
}) {
  const [height, setHeight] = useState(post.displayHeight);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  // Adopt a freshly measured/overridden height from the server, but never while
  // the host is mid-drag (that would fight their pointer).
  useEffect(() => {
    if (!dragRef.current) setHeight(post.displayHeight);
  }, [post.displayHeight]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const next = Math.round(
      Math.min(FIT_MAX, Math.max(FIT_MIN, d.startH + (e.clientY - d.startY))),
    );
    setHeight(next);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const rounded = Math.round(height);
  const dirty = rounded !== post.displayHeight;
  const source =
    post.overrideHeight != null
      ? `SET${post.measuredHeight != null ? ` · auto ${post.measuredHeight}` : ''}`
      : post.measureStatus === 'OK'
        ? `AUTO ${post.measuredHeight}`
        : post.measureStatus === 'PENDING'
          ? 'MEASURING…'
          : 'DEFAULT';

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3 mb-2 ticker text-[10px] tracking-widest opacity-70">
        <span>HEIGHT · {rounded}px</span>
        <span>· {source}</span>
      </div>
      <div
        className="ink-border overflow-hidden bg-white mx-auto"
        style={{ width: WONDERWALL_RENDER_WIDTH, maxWidth: '100%' }}
      >
        <iframe
          src={toCollapsedLinkedInEmbedUrl(post.embedUrl)}
          width={WONDERWALL_RENDER_WIDTH}
          height={rounded}
          title="Embedded LinkedIn post preview"
          className="block bg-white max-w-full"
          loading="lazy"
        />
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="select-none cursor-ns-resize text-center ticker text-[10px] tracking-widest py-1.5 border-t-2"
          style={{ borderColor: 'var(--ink)', background: 'var(--bone)', touchAction: 'none' }}
        >
          ⇕ DRAG TO FIT
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        <ActionButton
          label={dirty ? 'SAVE HEIGHT' : 'SAVED'}
          primary
          disabled={busy || !dirty}
          onClick={() => onSetHeight(post.id, rounded)}
        />
        {post.overrideHeight != null && (
          <ActionButton
            label="RESET TO AUTO"
            disabled={busy}
            onClick={() => onSetHeight(post.id, null)}
          />
        )}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  primary,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="ink-border stamp px-4 py-2 ticker text-[11px] tracking-widest disabled:opacity-40"
      style={primary ? { background: 'var(--vermilion)', color: 'var(--bone)' } : undefined}
    >
      {label}
    </button>
  );
}
