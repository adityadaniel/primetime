'use client';

// WonderWall participant surface (MID-400). Mobile-first: paste a public
// LinkedIn post URL, send it for host review, then watch this browser's own
// submissions move through pending → approved / rejected / failed.
//
// This page is intentionally HTTP-only (no socket): submissions POST to
// /api/wonderwall/[pin]/posts and feedback comes from polling
// /api/wonderwall/[pin]/my-posts?submitterKey=…. The submitterKey is a browser
// convenience for correlating feedback, NOT auth (see lib/wonderwall-submitter).
//
// Privacy invariant: the only fields shown here are the participant-safe ones
// the my-posts endpoint returns (status, canDisplay, rejection/failure reason).
// Host-only moderation/export fields never reach this surface — the API does
// not send them.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, FrameCounter, SmpteBars } from '@/components/Broadcast';
import { ensureSubmitterKey } from '@/lib/wonderwall-submitter';

type MyPostStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'FAILED' | 'HIDDEN';

type MyPost = {
  id: string;
  originalUrl: string;
  status: MyPostStatus;
  canDisplay: boolean;
  rejectionReason: string | null;
  failureReason: string | null;
  createdAt: string;
};

const POLL_MS = 5000;

const STATUS_BADGES: Record<MyPostStatus, { label: string; bg: string; fg: string }> = {
  PENDING: { label: 'WAITING FOR REVIEW', bg: 'var(--marigold)', fg: 'var(--ink)' },
  APPROVED: { label: 'ON AIR', bg: 'var(--ivy)', fg: 'var(--bone)' },
  REJECTED: { label: 'NOT USED', bg: 'var(--vermilion)', fg: 'var(--bone)' },
  FAILED: { label: 'UNSUPPORTED LINK', bg: 'var(--ink)', fg: 'var(--bone)' },
  HIDDEN: { label: 'TAKEN DOWN', bg: 'var(--ash)', fg: 'var(--ink)' },
};

// Per-status one-liners shown under the badge. Reject/fail also surface the
// host/parser reason when present (rendered separately so it can be empty).
function statusHint(post: MyPost): string {
  switch (post.status) {
    case 'PENDING':
      return 'Waiting for the host to review it.';
    case 'APPROVED':
      return 'Approved — it may appear on the wall.';
    case 'REJECTED':
      return 'The host passed on this one. Try another post.';
    case 'FAILED':
      return 'We could not turn that into a LinkedIn embed. Copy the post link again.';
    case 'HIDDEN':
      return 'The host took this down from the wall.';
  }
}

export default function WonderWallPlayerPage({ params }: { params: Promise<{ pin: string }> }) {
  const [pin, setPin] = useState('');
  const [submitterKey, setSubmitterKey] = useState<string | null>(null);
  const [nickname, setNickname] = useState<string | null>(null);

  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [posts, setPosts] = useState<MyPost[]>([]);
  const [loaded, setLoaded] = useState(false);

  const inFlight = useRef(false);

  useEffect(() => {
    params.then((p) => setPin(p.pin));
  }, [params]);

  // Mint/read the browser-scoped submitter key + nickname once we know the PIN.
  // ensureSubmitterKey mints one if the user reached this page directly rather
  // than through /join, so the form works either way.
  useEffect(() => {
    if (!pin) return;
    setSubmitterKey(ensureSubmitterKey(pin));
    setNickname(sessionStorage.getItem(`bc:nick:${pin}`)?.trim() || null);
  }, [pin]);

  const refresh = useCallback(async () => {
    if (!pin || !submitterKey) return;
    try {
      const res = await fetch(
        `/api/wonderwall/${pin}/my-posts?submitterKey=${encodeURIComponent(submitterKey)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { posts: MyPost[] };
      setPosts(data.posts);
    } catch {
      // Transient network blip — keep the last good list and try next tick.
    } finally {
      setLoaded(true);
    }
  }, [pin, submitterKey]);

  // Poll for feedback while the page is open.
  useEffect(() => {
    if (!pin || !submitterKey) return;
    refresh();
    const t = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(t);
  }, [pin, submitterKey, refresh]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Paste a public LinkedIn post link first.');
      return;
    }
    if (!pin || inFlight.current) return;
    if (!submitterKey) {
      setError(
        'This browser cannot store your submission key. Enable session storage and try again.',
      );
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/wonderwall/${pin}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: trimmed,
          submitterName: nickname,
          submitterKey,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        message?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        // The API returns a user-facing `message` for every recoverable error
        // (invalid/unsupported URL, closed wall, rate limit). Fall back to a
        // generic line if it is somehow missing.
        setError(data?.message ?? 'Could not submit that link — try again.');
        return;
      }
      setUrl('');
      setNotice(data?.message ?? 'Submitted for host review.');
      // Reflect the new pending row immediately instead of waiting a poll tick.
      refresh();
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (!pin) {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <p className="ticker text-[12px] tracking-widest opacity-70">TUNING IN…</p>
      </main>
    );
  }

  const orderedPosts = [...posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <main className="relative min-h-[100dvh] pb-10 flex flex-col">
      {notice && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 ink-border stamp ticker text-[11px] tracking-widest px-3 py-2"
          style={{ background: 'var(--ink)', color: 'var(--bone)' }}
          role="status"
          aria-live="polite"
        >
          {notice}
        </div>
      )}

      <header className="px-5 pt-4 flex items-center justify-between gap-3">
        <span className="chyron" style={{ color: 'var(--vermilion)' }}>
          WONDERWALL · LINKEDIN
        </span>
        <div className="flex items-center gap-4">
          <FrameCounter index={posts.length} />
          <Clock />
        </div>
      </header>
      <SmpteBars className="h-1.5 mt-3" />

      <div className="px-5 pt-4 max-w-[680px] mx-auto w-full flex-1 flex flex-col">
        <div
          className="flex items-center justify-between border-b-2 pb-2"
          style={{ borderColor: 'var(--ink)' }}
        >
          <span className="font-editorial text-lg">
            <span className="opacity-60">ID·</span>
            <span className="ml-1">{nickname ? nickname.toUpperCase() : 'GUEST'}</span>
          </span>
          <span className="ticker text-[11px] tracking-widest opacity-70">PIN {pin}</span>
        </div>

        <section className="pt-5">
          <p className="chyron" style={{ color: 'var(--vermilion)' }}>
            SUBMIT A POST
          </p>
          <h1
            className="font-editorial leading-tight mt-2"
            style={{ fontSize: 'clamp(28px, 7vw, 44px)' }}
          >
            Paste a public LinkedIn post.
          </h1>
          <p className="font-editorial italic text-[15px] mt-2 opacity-80">
            Open the post on LinkedIn, copy its link, and drop it in. The host approves what goes on
            the wall.
          </p>
        </section>

        <form onSubmit={handleSubmit} className="pt-6 flex flex-col gap-3">
          <span
            className="ticker text-[11px] tracking-widest px-2 py-[2px] ink-border self-start"
            style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
          >
            CUE · LINKEDIN URL
          </span>

          <label className="block">
            <span className="sr-only">LinkedIn post URL</span>
            <textarea
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.linkedin.com/posts/…"
              aria-label="LinkedIn post URL"
              rows={3}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full mt-1 ink-border bg-transparent font-mono px-4 py-3 resize-none break-all"
              style={{
                // 16px+ avoids the iOS Safari focus-zoom.
                fontSize: '16px',
                background: 'var(--bone)',
                minHeight: 96,
              }}
            />
          </label>

          {error && (
            <p
              className="ink-border px-4 py-3 ticker text-[12px] tracking-widest"
              role="alert"
              style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
            >
              ⚠ {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="ink-border stamp ticker text-[14px] tracking-widest"
            style={{
              background: submitting ? 'var(--ash)' : 'var(--vermilion)',
              color: submitting ? 'var(--ink)' : 'var(--bone)',
              minHeight: 64,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'SENDING…' : '▶  SEND FOR REVIEW'}
          </button>
        </form>

        <section className="pt-8">
          <div className="flex items-center justify-between">
            <p className="chyron opacity-70">YOUR SUBMISSIONS</p>
            <span className="ticker tabular-nums text-[11px] tracking-widest opacity-60">
              {String(orderedPosts.length).padStart(2, '0')} SENT
            </span>
          </div>

          {!loaded ? (
            <p className="ticker text-[11px] tracking-widest mt-3 opacity-60">LOADING…</p>
          ) : orderedPosts.length === 0 ? (
            <p className="font-editorial italic text-[15px] mt-3 opacity-70">
              Nothing sent yet — paste your first LinkedIn post above.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {orderedPosts.map((post) => (
                <MyPostCard key={post.id} post={post} />
              ))}
            </ul>
          )}
        </section>

        <div className="pt-8">
          <Link
            href="/join"
            className="ink-border ticker text-[11px] tracking-widest px-4 py-3 inline-block"
            style={{ background: 'var(--bone)', minHeight: 44 }}
          >
            ↩ JOIN ANOTHER ROOM
          </Link>
        </div>
      </div>
    </main>
  );
}

function MyPostCard({ post }: { post: MyPost }) {
  const badge = STATUS_BADGES[post.status];
  // A reject/fail can carry a host/parser reason; show it when present.
  const reason =
    post.status === 'REJECTED'
      ? post.rejectionReason
      : post.status === 'FAILED'
        ? post.failureReason
        : null;
  // Reject/fail are recoverable — nudge the user to try another link.
  const canRetry = post.status === 'REJECTED' || post.status === 'FAILED';
  const settled = post.status !== 'PENDING' && post.status !== 'APPROVED';

  return (
    <li
      className="ink-border px-4 py-3"
      style={{ background: 'var(--bone)', opacity: settled ? 0.85 : 1 }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="ticker text-[10px] tracking-widest px-2 py-[2px] ink-border"
          style={{ background: badge.bg, color: badge.fg }}
        >
          {badge.label}
        </span>
        <span className="ticker text-[10px] tracking-widest opacity-50">
          {new Date(post.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>

      <p
        className="font-mono text-[13px] leading-snug mt-2 break-all opacity-80"
        title={post.originalUrl}
      >
        {post.originalUrl}
      </p>

      <p className="font-editorial text-[15px] leading-snug mt-2">{statusHint(post)}</p>

      {reason && (
        <p
          className="mt-2 pl-3 border-l-2 font-editorial text-[14px] italic"
          style={{ borderColor: 'var(--vermilion)' }}
        >
          “{reason}”
        </p>
      )}

      {canRetry && (
        <p className="ticker text-[10px] tracking-widest mt-2 opacity-60">
          ↑ PASTE A NEW LINK ABOVE TO TRY AGAIN
        </p>
      )}
    </li>
  );
}
