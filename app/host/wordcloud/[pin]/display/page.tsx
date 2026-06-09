'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Chyron, Clock, CornerMarks, FrameCounter, OnAir, SmpteBars } from '@/components/Broadcast';
import { publicHost } from '@/lib/public-origin';
import { useSocket } from '@/lib/socket';
import { type LayoutPlacement, layoutWords } from '@/lib/wordcloud-layout';

type CloudStatus = 'LOBBY' | 'LIVE' | 'PAUSED' | 'ENDED';

type Word = { normalized: string; display: string; count: number };

type CloudStatePayload = {
  pin: string;
  prompt: string;
  wordsPerPlayer: number;
  profanityFilter: boolean;
  status: CloudStatus;
  joinerCount: number;
  words: Word[];
};

const ANIMATION_THRESHOLD = 200;

export default function WordCloudDisplay({ params }: { params: Promise<{ pin: string }> }) {
  const socket = useSocket();
  const [pin, setPin] = useState<string>('');
  const [state, setState] = useState<CloudStatePayload | null>(null);

  useEffect(() => {
    params.then((p) => setPin(p.pin));
  }, [params]);

  useEffect(() => {
    if (!socket || !pin) return;

    const attach = () => socket.emit('wordcloud:display:attach', pin);
    const onState = (s: CloudStatePayload) => {
      if (s.pin === pin) setState(s);
    };
    const onAdded = (w: { normalized: string; display: string; count: number }) => {
      setState((prev) => {
        if (!prev) return prev;
        const idx = prev.words.findIndex((x) => x.normalized === w.normalized);
        const next = [...prev.words];
        if (idx >= 0) next[idx] = { ...next[idx], count: w.count, display: w.display };
        else next.push({ normalized: w.normalized, display: w.display, count: w.count });
        next.sort((a, b) =>
          b.count !== a.count ? b.count - a.count : a.normalized.localeCompare(b.normalized),
        );
        return { ...prev, words: next };
      });
    };
    const onRemoved = (w: { normalized: string }) => {
      setState((prev) =>
        prev ? { ...prev, words: prev.words.filter((x) => x.normalized !== w.normalized) } : prev,
      );
    };
    const onStatus = (s: { status: CloudStatus }) => {
      setState((prev) => (prev ? { ...prev, status: s.status } : prev));
    };

    if (socket.connected) attach();
    socket.on('connect', attach);
    socket.on('wordcloud:state', onState);
    socket.on('wordcloud:word:added', onAdded);
    socket.on('wordcloud:word:removed', onRemoved);
    socket.on('wordcloud:status:changed', onStatus);
    return () => {
      socket.off('connect', attach);
      socket.off('wordcloud:state', onState);
      socket.off('wordcloud:word:added', onAdded);
      socket.off('wordcloud:word:removed', onRemoved);
      socket.off('wordcloud:status:changed', onStatus);
    };
  }, [socket, pin]);

  const status: CloudStatus = state?.status ?? 'LOBBY';
  const live = status === 'LIVE' || status === 'PAUSED';
  const ended = status === 'ENDED';
  const words = state?.words ?? [];
  const totalSubmissions = useMemo(() => words.reduce((s, w) => s + w.count, 0), [words]);
  const showCloud = (live || ended) && words.length > 0;

  return (
    <main className="relative min-h-screen w-full overflow-hidden grain">
      <CornerMarks />

      <header className="px-8 pt-5 flex items-center justify-between">
        <Chyron label="LIVE FEED · WORD CLOUD" number="WC" />
        <div className="flex items-center gap-7">
          <FrameCounter index={Math.min(999, totalSubmissions)} />
          <Clock />
          <OnAir live={live && !ended} />
        </div>
      </header>
      <SmpteBars className="h-2 mt-3" />

      <section className="relative px-10 pt-8 pb-12 max-w-[1800px] mx-auto">
        {showCloud ? (
          <CloudStage words={words} seed={pin} ended={ended} totalSubmissions={totalSubmissions} />
        ) : (
          <LobbyHero pin={pin} prompt={state?.prompt ?? ''} joinerCount={state?.joinerCount ?? 0} />
        )}
      </section>

      {/* TODO MID-75: gate watermark on user.tier === 'PRO' */}
      <Watermark />
    </main>
  );
}

function LobbyHero({
  pin,
  prompt,
  joinerCount,
}: {
  pin: string;
  prompt: string;
  joinerCount: number;
}) {
  const promptText = prompt || '—';
  const joinHost = useJoinHost();
  const promptLength = promptText.length;
  // Long prompts get smaller hero type so they stay within ~8 visible lines
  // at any reasonable projection size.
  const promptSize =
    promptLength > 80
      ? 'clamp(56px, 7vw, 110px)'
      : promptLength > 40
        ? 'clamp(72px, 9vw, 150px)'
        : 'clamp(80px, 11vw, 180px)';

  return (
    <div className="relative grid grid-rows-[auto_1fr_auto] min-h-[calc(100vh-220px)]">
      <div>
        <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
          STAND BY · COLLECTING WORDS
        </p>
        <p className="ticker text-[14px] tracking-widest opacity-70">PROMPT · ON THE WIRE</p>
      </div>

      <div className="grid place-items-center text-center px-4">
        <p
          className="font-editorial leading-[1.04] teleprompter max-w-[18ch]"
          style={{ fontSize: promptSize }}
        >
          {promptText}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 mt-6">
        <p className="ticker text-[14px] tracking-widest opacity-70">GAME PIN · JOIN AT</p>
        <p
          className="display-num ticker"
          style={{
            fontSize: 'clamp(140px, 22vw, 320px)',
            lineHeight: 0.82,
            letterSpacing: '0.04em',
          }}
        >
          {pin || '······'}
        </p>
        <p className="font-editorial italic text-2xl opacity-80">
          join at <span className="not-italic">{joinHost}/join</span>
        </p>
        <p className="ticker text-[14px] tracking-widest mt-2">
          {String(joinerCount).padStart(2, '0')} ON THE FLOOR
        </p>
      </div>
    </div>
  );
}

function useJoinHost() {
  const [host, setHost] = useState('primetime.local');
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setHost(publicHost(window.location.origin));
    }
  }, []);
  return host;
}

function CloudStage({
  words,
  seed,
  ended,
  totalSubmissions,
}: {
  words: Word[];
  seed: string;
  ended: boolean;
  totalSubmissions: number;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1600, height: 720 });

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setViewport({
        width: Math.max(320, Math.round(rect.width)),
        height: Math.max(320, Math.round(rect.height)),
      });
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const placements = useMemo(
    () =>
      layoutWords({
        words: words.map((w) => ({
          display: w.display,
          normalized: w.normalized,
          count: w.count,
        })),
        seed,
        viewport,
      }),
    [words, seed, viewport],
  );

  const animationsEnabled = words.length <= ANIMATION_THRESHOLD;

  return (
    <div className="relative">
      {ended && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-30 text-center pointer-events-none">
          <p
            className="display-num leading-none"
            style={{
              fontSize: 'clamp(72px, 11vw, 168px)',
              color: 'var(--vermilion)',
              letterSpacing: '0.02em',
            }}
          >
            FINAL.
          </p>
          <p className="ticker tabular-nums tracking-widest text-[14px] opacity-80 mt-1">
            {String(totalSubmissions).padStart(3, '0')} WORDS SUBMITTED ·{' '}
            {String(words.length).padStart(2, '0')} UNIQUE
          </p>
        </div>
      )}

      <div
        ref={stageRef}
        role="img"
        aria-label="Word cloud"
        className="relative w-full"
        style={{ height: 'min(78vh, 880px)', isolation: 'isolate' }}
      >
        {placements.map((p) => (
          <CloudWord
            key={p.normalized}
            placement={p}
            animationsEnabled={animationsEnabled}
            count={words.find((w) => w.normalized === p.normalized)?.count ?? 1}
          />
        ))}
      </div>
    </div>
  );
}

const COLOR_VAR: Record<LayoutPlacement['color'], string> = {
  ink: 'var(--ink)',
  'ink-pink': 'var(--vermilion)',
  'ink-blue': 'var(--cobalt)',
};

function CloudWord({
  placement,
  animationsEnabled,
  count,
}: {
  placement: LayoutPlacement;
  animationsEnabled: boolean;
  count: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prevSizeRef = useRef<number>(placement.fontSize);
  const prevCountRef = useRef<number>(count);
  const mountedRef = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (!mountedRef.current) {
      mountedRef.current = true;
      prevSizeRef.current = placement.fontSize;
      prevCountRef.current = count;
      if (animationsEnabled && typeof el.animate === 'function') {
        el.animate(
          [
            { transform: `${baseTransform(placement)} scale(0.7)`, opacity: 0 },
            { transform: `${baseTransform(placement)} scale(1)`, opacity: 1 },
          ],
          { duration: 200, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'both' },
        );
      }
      return;
    }

    if (animationsEnabled && count > prevCountRef.current && typeof el.animate === 'function') {
      const from = prevSizeRef.current;
      const to = placement.fontSize;
      el.animate(
        [{ fontSize: `${from}px` }, { fontSize: `${to * 1.06}px` }, { fontSize: `${to}px` }],
        { duration: 300, easing: 'cubic-bezier(0.4, 0.0, 0.2, 1)', fill: 'both' },
      );
    }
    prevSizeRef.current = placement.fontSize;
    prevCountRef.current = count;
  }, [placement, count, animationsEnabled]);

  return (
    <div
      ref={ref}
      className="absolute font-editorial leading-none select-none"
      style={{
        left: placement.x,
        top: placement.y,
        width: placement.width,
        height: placement.height,
        transform: baseTransform(placement),
        transformOrigin: 'center center',
        color: COLOR_VAR[placement.color],
        fontSize: placement.fontSize,
        display: 'grid',
        placeItems: 'center',
        whiteSpace: 'nowrap',
        willChange: animationsEnabled ? 'transform, opacity' : undefined,
      }}
    >
      <span style={{ fontWeight: 500, letterSpacing: '-0.01em' }}>{placement.word}</span>
    </div>
  );
}

function baseTransform(p: LayoutPlacement): string {
  // Box is laid out at top-left (x, y); rotate around its center so the
  // collision math (which already accounts for rotated bbox) lines up.
  return `rotate(${p.rotation}deg)`;
}

function Watermark() {
  return (
    <span
      className="ticker tracking-widest fixed bottom-3 right-4 text-[14px]"
      style={{ color: 'var(--ink)', opacity: 0.5, letterSpacing: '0.18em' }}
      aria-hidden
    >
      PRIMETIME
    </span>
  );
}
