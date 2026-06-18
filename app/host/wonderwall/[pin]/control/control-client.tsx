'use client';

// WonderWall host review queue (MID-401). Client surface for the control room:
// it renders every submission as a TEXT row (never dozens of cross-origin
// LinkedIn iframes — that would crawl) and drives the host-only mutation
// routes. Pending submissions sit first because reviewing them is the host's
// primary job; the approved/displayable list below is the live waterfall order
// the projector reads, with move up/down posting the whole approved id list to
// the reorder endpoint. Each row states CAN DISPLAY: YES/NO explicitly so the
// host is never guessing whether a post is on air. An optional collapsed iframe
// preview is available per row for spot-checking before approval.
// See docs/wonderwall-iframe-plan.md §8.3.

import { useCallback, useMemo, useState } from 'react';

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
  const [posts, setPosts] = useState<ControlPost[]>(initialPosts);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const pending = useMemo(() => posts.filter((p) => p.status === 'PENDING'), [posts]);
  const onAir = useMemo(() => displayOrder(posts), [posts]);
  const benched = useMemo(
    () =>
      posts
        .filter((p) => p.status === 'REJECTED' || p.status === 'HIDDEN' || p.status === 'FAILED')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [posts],
  );

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
        setRejectingId(null);
        setRejectReason('');
      } catch {
        setError('Network error — reload and try again.');
      } finally {
        setBusyId(null);
      }
    },
    [pin, replacePost],
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
      } catch {
        setError('Network error — reload and try again.');
      } finally {
        setBusyId(null);
      }
    },
    [pin, posts],
  );

  return (
    <div className="mt-10 space-y-12">
      {error && (
        <p
          className="ink-border px-4 py-3 ticker text-[12px]"
          style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
          role="alert"
        >
          {error}
        </p>
      )}

      <Section
        title="PENDING REVIEW"
        count={pending.length}
        empty="No submissions waiting for review."
      >
        {pending.map((post) => (
          <PostRow
            key={post.id}
            post={post}
            busy={busyId === post.id}
            previewOpen={previewId === post.id}
            onTogglePreview={() => setPreviewId((id) => (id === post.id ? null : post.id))}
            rejecting={rejectingId === post.id}
            rejectReason={rejectReason}
            onRejectReasonChange={setRejectReason}
            onCancelReject={() => setRejectingId(null)}
            actions={
              <>
                <ActionButton
                  label="APPROVE"
                  primary
                  disabled={busyId === post.id}
                  onClick={() => review(post.id, 'approve')}
                />
                <ActionButton
                  label="REJECT"
                  disabled={busyId === post.id}
                  onClick={() => {
                    setRejectingId(post.id);
                    setRejectReason('');
                  }}
                />
              </>
            }
            onSubmitReject={() => review(post.id, 'reject', rejectReason.trim() || undefined)}
          />
        ))}
      </Section>

      <Section
        title="ON AIR · DISPLAY ORDER"
        count={onAir.length}
        empty="No approved posts on the wall yet."
      >
        {onAir.map((post, index) => (
          <PostRow
            key={post.id}
            post={post}
            busy={busyId === post.id}
            previewOpen={previewId === post.id}
            onTogglePreview={() => setPreviewId((id) => (id === post.id ? null : post.id))}
            actions={
              <>
                <ActionButton
                  label="▲ UP"
                  disabled={busyId === post.id || index === 0}
                  onClick={() => move(post.id, -1)}
                />
                <ActionButton
                  label="▼ DOWN"
                  disabled={busyId === post.id || index === onAir.length - 1}
                  onClick={() => move(post.id, 1)}
                />
                <ActionButton
                  label="HIDE"
                  disabled={busyId === post.id}
                  onClick={() => review(post.id, 'hide')}
                />
              </>
            }
          />
        ))}
      </Section>

      <Section
        title="REJECTED · HIDDEN · FAILED"
        count={benched.length}
        empty="Nothing rejected, hidden, or failed."
      >
        {benched.map((post) => (
          <PostRow
            key={post.id}
            post={post}
            busy={busyId === post.id}
            previewOpen={previewId === post.id}
            onTogglePreview={() => setPreviewId((id) => (id === post.id ? null : post.id))}
            actions={
              post.status === 'HIDDEN' || post.status === 'REJECTED' ? (
                <ActionButton
                  label={post.status === 'HIDDEN' ? 'RESTORE' : 'APPROVE'}
                  primary
                  disabled={busyId === post.id}
                  onClick={() => review(post.id, post.status === 'HIDDEN' ? 'restore' : 'approve')}
                />
              ) : null
            }
          />
        ))}
      </Section>
    </div>
  );
}

function Section({
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
        <h2 className="chyron text-[13px] tracking-widest">{title}</h2>
        <span className="display-num text-2xl">{String(count).padStart(2, '0')}</span>
      </div>
      {count === 0 ? (
        <p className="font-editorial italic opacity-60 mt-4">{empty}</p>
      ) : (
        <div className="mt-4 space-y-3">{children}</div>
      )}
    </section>
  );
}

function PostRow({
  post,
  busy,
  actions,
  previewOpen,
  onTogglePreview,
  rejecting,
  rejectReason,
  onRejectReasonChange,
  onCancelReject,
  onSubmitReject,
}: {
  post: ControlPost;
  busy: boolean;
  actions: React.ReactNode;
  previewOpen: boolean;
  onTogglePreview: () => void;
  rejecting?: boolean;
  rejectReason?: string;
  onRejectReasonChange?: (value: string) => void;
  onCancelReject?: () => void;
  onSubmitReject?: () => void;
}) {
  return (
    <article
      className="ink-border p-4"
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
          style={{
            background: post.canDisplay ? '#1f7a3d' : 'var(--ash)',
            color: 'var(--bone)',
          }}
        >
          CAN DISPLAY: {post.canDisplay ? 'YES' : 'NO'}
        </span>
        {post.status === 'APPROVED' && post.canDisplay && post.position !== null && (
          <span className="ticker text-[10px] tracking-widest opacity-60">
            POS {String(post.position + 1).padStart(2, '0')}
          </span>
        )}
      </div>

      <p className="font-mono text-[12px] break-all mt-3 opacity-70">{post.urn}</p>
      <div className="flex flex-wrap items-center gap-3 mt-1">
        <a
          href={post.originalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[12px] break-all underline"
          style={{ color: 'var(--vermilion)' }}
        >
          OPEN ORIGINAL ↗
        </a>
        <button
          type="button"
          onClick={onTogglePreview}
          className="ticker text-[10px] tracking-widest underline opacity-70"
        >
          {previewOpen ? 'HIDE PREVIEW' : 'PREVIEW'}
        </button>
      </div>

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

      {previewOpen && (
        <div className="ink-border mt-3 overflow-hidden bg-white">
          <iframe
            src={post.embedUrl}
            width="504"
            height="500"
            title="Embedded LinkedIn post preview"
            className="block w-full bg-white"
            loading="lazy"
          />
        </div>
      )}

      {actions && <div className="flex flex-wrap gap-2 mt-4">{actions}</div>}

      {rejecting && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={rejectReason ?? ''}
            onChange={(e) => onRejectReasonChange?.(e.target.value)}
            maxLength={240}
            placeholder="Optional reason (shown to submitter)"
            className="ink-border px-3 py-2 font-mono text-[12px] flex-1 min-w-[200px]"
            style={{ background: 'var(--bone)' }}
          />
          <ActionButton label="CONFIRM REJECT" primary disabled={busy} onClick={onSubmitReject} />
          <ActionButton label="CANCEL" disabled={busy} onClick={onCancelReject} />
        </div>
      )}
    </article>
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
