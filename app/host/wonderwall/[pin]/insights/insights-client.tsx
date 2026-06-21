'use client';

// WonderWall room insights (host-only client). Renders a word cloud built from
// the scraped LinkedIn post text using the SAME pure layout engine as the Word
// Cloud activity (lib/wordcloud-layout.ts `layoutWords`). The raw text never
// reaches here — the server hands us pre-aggregated word counts. Polls so newly
// fetched content surfaces without a manual reload. Opt-in content analysis
// (DECISIONS.md 2026-06-21).

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import AccountMenu from '@/components/AccountMenu';
import { Chyron, Clock, FrameCounter, SmpteBars } from '@/components/Broadcast';
import { type LayoutInputWord, type LayoutPlacement, layoutWords } from '@/lib/wordcloud-layout';

const REFRESH_INTERVAL_MS = 8000;

const COLOR_VAR: Record<LayoutPlacement['color'], string> = {
  ink: 'var(--ink)',
  'ink-pink': 'var(--vermilion)',
  'ink-blue': 'var(--cobalt)',
};

export default function WonderWallInsightsClient({
  pin,
  title,
  analysisEnabled,
  words,
  counts,
}: {
  pin: string;
  title: string;
  analysisEnabled: boolean;
  words: LayoutInputWord[];
  counts: { approved: number; ok: number; pending: number; failed: number };
}) {
  const router = useRouter();
  const cloudRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1180, height: 560 });

  useEffect(() => {
    const el = cloudRef.current;
    if (!el) return;
    const update = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Poll so content fetched in the background after approval appears on its own.
  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [router]);

  const placements = useMemo(
    () => (words.length > 0 ? layoutWords({ words, seed: pin, viewport }) : []),
    [words, pin, viewport],
  );

  return (
    <main className="relative min-h-screen pb-24">
      <header className="px-8 pt-6 flex items-center justify-between">
        <Chyron label="DIRECTOR · WONDERWALL · INSIGHTS" number="WW" />
        <div className="flex items-center gap-6">
          <FrameCounter index={counts.ok} />
          <Clock />
          <AccountMenu />
        </div>
      </header>
      <SmpteBars className="h-2 mt-4" />

      <section className="px-6 sm:px-8 pt-10 max-w-[1180px] mx-auto">
        <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
          PIN · {pin} · ROOM INSIGHTS
        </p>
        <h1 className="display-num leading-[0.9]" style={{ fontSize: 'clamp(40px, 6vw, 80px)' }}>
          {title}
        </h1>

        <div className="mt-6">
          <Link
            href={`/host/wonderwall/${pin}/control`}
            className="ink-border stamp px-4 py-3 ticker text-[12px] tracking-widest inline-flex"
            style={{ background: 'var(--ink)', color: 'var(--bone)' }}
          >
            ← BACK TO CONTROL
          </Link>
        </div>

        {!analysisEnabled ? (
          <DisabledState />
        ) : (
          <>
            <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Metric label="ON AIR" value={counts.approved} />
              <Metric label="ANALYZED" value={counts.ok} />
              <Metric label="PENDING" value={counts.pending} />
              <Metric label="FAILED" value={counts.failed} />
            </div>

            <div
              ref={cloudRef}
              className="ink-border mt-6 relative overflow-hidden"
              style={{ background: 'var(--bone)', height: 'min(70vh, 620px)' }}
            >
              {placements.length === 0 ? (
                <div className="absolute inset-0 grid place-items-center text-center p-8">
                  <div className="max-w-lg">
                    <p className="chyron mb-2" style={{ color: 'var(--vermilion)' }}>
                      NO WORDS YET
                    </p>
                    <p className="font-editorial italic opacity-70">
                      {counts.pending > 0
                        ? `Analyzing ${counts.pending} post${counts.pending === 1 ? '' : 's'}… this view refreshes on its own.`
                        : 'Approve posts to build the word cloud from their LinkedIn content.'}
                    </p>
                  </div>
                </div>
              ) : (
                placements.map((p) => (
                  <div
                    key={p.normalized}
                    className="absolute font-editorial leading-none select-none"
                    style={{
                      left: p.x,
                      top: p.y,
                      width: p.width,
                      height: p.height,
                      transform: `rotate(${p.rotation}deg)`,
                      transformOrigin: 'center center',
                      color: COLOR_VAR[p.color],
                      fontSize: p.fontSize,
                      display: 'grid',
                      placeItems: 'center',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ fontWeight: 500, letterSpacing: '-0.01em' }}>{p.word}</span>
                  </div>
                ))
              )}
            </div>
            {counts.failed > 0 && (
              <p className="ticker text-[11px] tracking-widest opacity-60 mt-3">
                {counts.failed} post{counts.failed === 1 ? '' : 's'} could not be fetched (e.g.
                login-gated or unavailable) and are excluded.
              </p>
            )}
          </>
        )}
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

function DisabledState() {
  return (
    <div className="ink-border mt-8 p-8" style={{ background: 'var(--bone)' }}>
      <p className="chyron mb-2" style={{ color: 'var(--vermilion)' }}>
        CONTENT ANALYSIS DISABLED
      </p>
      <p className="font-editorial italic text-lg max-w-2xl opacity-80">
        Room insights fetch each approved post's LinkedIn content to build a word cloud. This is an
        opt-in feature — set{' '}
        <span className="font-mono not-italic">WONDERWALL_ANALYSIS_ENABLED=true</span> and a{' '}
        <span className="font-mono not-italic">APIFY_TOKEN</span>, and accept the LinkedIn-ToS
        considerations (see DECISIONS.md), to enable it.
      </p>
    </div>
  );
}
