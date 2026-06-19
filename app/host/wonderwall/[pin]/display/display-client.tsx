'use client';

// WonderWall projector client (MID-402). Renders the public waterfall and the
// join affordances that need `window` (public origin → join URL/host/QR). All
// posts handed in are already APPROVED + canDisplay — the repo enforces that —
// so this file never filters by status and never shows host/review metadata.
//
// Refresh: a light router.refresh() poll re-runs the server page so newly
// approved posts appear without a manual reload. It is deliberately simple;
// socket-driven realtime refresh is MID-405. Because props are read directly
// (no local copy), a refresh that returns the same posts re-reconciles the
// existing iframes by key instead of remounting them, so stable cards don't
// flicker or reload. See docs/wonderwall-iframe-plan.md §8.4 and §9.3.

import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Chyron, Clock, FrameCounter, SmpteBars } from '@/components/Broadcast';
import { publicHost, publicUrl } from '@/lib/public-origin';
import { WONDERWALL_RENDER_WIDTH } from '@/lib/wonderwall-height';
import { toCollapsedLinkedInEmbedUrl } from '@/lib/wonderwall-input';

const REFRESH_INTERVAL_MS = 8000;

// The wall is capped to exactly three 504px columns + two 10px gaps (matching the
// `gap-2.5` column-gap) so columns equal the card width with no centering slack.
// The header (title + QR) shares this width so its left/right edges line up with
// the wall's outer columns.
const WALL_COLUMN_GAP = 10;
const WALL_MAX_WIDTH = 3 * WONDERWALL_RENDER_WIDTH + 2 * WALL_COLUMN_GAP;

export type DisplayPost = {
  id: string;
  originalUrl: string;
  embedUrl: string;
  // Resolved per-post card height (px) for the masonry wall.
  displayHeight: number;
};

export default function WonderWallDisplayClient({
  pin,
  title,
  description,
  instructions,
  posts,
}: {
  pin: string;
  title: string;
  description: string | null;
  instructions: string | null;
  posts: DisplayPost[];
}) {
  const router = useRouter();
  const [joinUrl, setJoinUrl] = useState('');
  const [joinHost, setJoinHost] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setJoinUrl(publicUrl(`/join?pin=${pin}`, window.location.origin));
    setJoinHost(publicHost(window.location.origin));
  }, [pin]);

  // Light polling stand-in for full realtime refresh (MID-405): re-run the
  // server component so host approvals surface on the wall on their own.
  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  const joinLabel = joinHost ? `${joinHost}/join` : '/join';

  return (
    <main className="ink-bg relative min-h-[100dvh] flex flex-col grain pb-12">
      <header className="shrink-0 px-8 pt-5 flex items-center justify-between">
        <Chyron label="LIVE FEED · WONDERWALL · LINKEDIN" number="WW" dark />
        <div className="flex items-center gap-7">
          <FrameCounter index={Math.min(999, posts.length)} dark />
          <Clock dark />
        </div>
      </header>
      <SmpteBars className="h-2 mt-3 shrink-0" />

      <section className="px-8 sm:px-10 pt-7 max-w-[1800px] w-full mx-auto">
        <div
          className="flex flex-wrap items-start justify-between gap-8 mx-auto"
          style={{ maxWidth: WALL_MAX_WIDTH }}
        >
          <div className="min-w-0">
            <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
              ON AIR · {String(posts.length).padStart(2, '0')} APPROVED POSTS
            </p>
            <h1
              className="font-editorial leading-none"
              style={{ fontSize: 'clamp(40px, 5vw, 92px)' }}
            >
              {title}
            </h1>
            {description && (
              <p className="font-editorial italic text-2xl mt-4 opacity-75 max-w-[900px]">
                {description}
              </p>
            )}
            <p className="ticker text-[13px] tracking-widest mt-6 opacity-80">
              SUBMIT A LINKEDIN POST AT {joinLabel.toUpperCase()} · PIN {pin}
            </p>
            {instructions && (
              <p className="font-editorial italic text-lg mt-2 opacity-70 max-w-[900px]">
                {instructions}
              </p>
            )}
          </div>

          {/* Keep the QR/PIN card light on the dark wall so the code stays
              scannable; force ink text so the PIN reads on the bone box. */}
          <div
            className="ink-border p-4 shrink-0"
            style={{ background: 'var(--bone)', color: 'var(--ink)' }}
          >
            {joinUrl ? (
              <QRCodeSVG
                value={joinUrl}
                size={150}
                bgColor="transparent"
                fgColor="var(--ink)"
                level="M"
              />
            ) : (
              <div style={{ width: 150, height: 150 }} aria-hidden />
            )}
            <p
              className="display-num ticker mt-3 tabular-nums text-center"
              style={{ fontSize: 28, letterSpacing: '0.08em' }}
            >
              {pin || '······'}
            </p>
          </div>
        </div>
      </section>

      <section className="flex-1 min-h-0 px-8 sm:px-10 pt-8 max-w-[1800px] w-full mx-auto">
        {posts.length === 0 ? (
          <EmptyState pin={pin} joinLabel={joinLabel} />
        ) : (
          // Capped to WALL_MAX_WIDTH so each column equals the 504px card width
          // (no `mx-auto` slack) and the only horizontal space between cards is
          // the 10px column-gap. The header above shares this exact width.
          <div
            className="columns-1 md:columns-3 gap-2.5 [column-fill:_balance] mx-auto"
            style={{ maxWidth: WALL_MAX_WIDTH }}
          >
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function PostCard({ post }: { post: DisplayPost }) {
  return (
    <article
      className="mb-2.5 break-inside-avoid ink-border bg-white overflow-hidden mx-auto"
      style={{ width: WONDERWALL_RENDER_WIDTH, maxWidth: '100%' }}
    >
      {/* Width is pinned to WONDERWALL_RENDER_WIDTH so the rendered height
          matches the height we measured at that same width (text reflow is
          width-bound). The per-post height drives the masonry waterfall. */}
      <iframe
        src={toCollapsedLinkedInEmbedUrl(post.embedUrl)}
        width={WONDERWALL_RENDER_WIDTH}
        height={post.displayHeight}
        title="Embedded LinkedIn post"
        allowFullScreen
        loading="lazy"
        className="block bg-white max-w-full"
      />
      {/* Cross-origin iframes can silently fail to render and PRIMETIME cannot
          detect that, so every card keeps a manual path back to LinkedIn. */}
      <a
        href={post.originalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block px-4 py-3 ticker text-[11px] tracking-widest border-t-2"
        style={{ borderColor: 'var(--ink)', color: 'var(--ink)' }}
      >
        OPEN ON LINKEDIN ↗
      </a>
    </article>
  );
}

function EmptyState({ pin, joinLabel }: { pin: string; joinLabel: string }) {
  return (
    <div className="grid place-items-center text-center py-24">
      <div className="max-w-2xl">
        <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
          STAND BY · NO POSTS ON AIR
        </p>
        <h2 className="font-editorial leading-tight" style={{ fontSize: 'clamp(32px, 4vw, 64px)' }}>
          Waiting for approved LinkedIn posts.
        </h2>
        <p className="font-editorial italic text-2xl mt-6 opacity-75">
          Submit a LinkedIn post at {joinLabel} and the host will put the good ones up here.
        </p>
        <p
          className="display-num ticker mt-8 tabular-nums"
          style={{
            fontSize: 'clamp(64px, 12vw, 160px)',
            lineHeight: 0.85,
            letterSpacing: '0.06em',
          }}
        >
          {pin || '······'}
        </p>
      </div>
    </div>
  );
}
