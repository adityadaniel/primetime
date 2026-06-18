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

const REFRESH_INTERVAL_MS = 8000;

export type DisplayPost = {
  id: string;
  originalUrl: string;
  embedUrl: string;
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
    <main className="relative min-h-[100dvh] flex flex-col grain pb-12">
      <header className="shrink-0 px-8 pt-5 flex items-center justify-between">
        <Chyron label="LIVE FEED · WONDERWALL · LINKEDIN" number="WW" />
        <div className="flex items-center gap-7">
          <FrameCounter index={Math.min(999, posts.length)} />
          <Clock />
        </div>
      </header>
      <SmpteBars className="h-2 mt-3 shrink-0" />

      <section className="px-8 sm:px-10 pt-7 max-w-[1800px] w-full mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-8">
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

          <div className="ink-border p-4 shrink-0" style={{ background: 'var(--bone)' }}>
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
          <div className="columns-1 md:columns-2 2xl:columns-3 gap-5 [column-fill:_balance]">
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
    <article className="mb-5 break-inside-avoid ink-border bg-white overflow-hidden">
      <iframe
        src={post.embedUrl}
        width="504"
        height="700"
        title="Embedded LinkedIn post"
        allowFullScreen
        loading="lazy"
        className="block w-full bg-white"
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
