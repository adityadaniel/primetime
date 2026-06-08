'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AccountMenu from '@/components/AccountMenu';
import { Chyron, Clock, CornerMarks, FrameCounter, OnAir, SmpteBars } from '@/components/Broadcast';
import { publicUrl } from '@/lib/public-origin';
import { useSocket } from '@/lib/socket';

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

export default function WordCloudControl({ params }: { params: Promise<{ pin: string }> }) {
  const search = useSearchParams();
  const socket = useSocket();
  const [pin, setPin] = useState<string>('');
  const [state, setState] = useState<CloudStatePayload | null>(null);
  const [registered, setRegistered] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const toastTimerRef = useRef<number | null>(null);

  const seedPrompt = search?.get('prompt') ?? '';
  const seedSessionId = search?.get('sid') ?? '';
  const seedWpp = Number(search?.get('wpp') ?? '3') || 3;
  const seedPf = (search?.get('pf') ?? '1') === '1';

  useEffect(() => {
    params.then((p) => setPin(p.pin));
  }, [params]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!socket || !pin) return;

    function register() {
      if (!socket || !pin) return;
      socket.emit(
        'wordcloud:host:create',
        {
          pin,
          sessionId: seedSessionId || undefined,
          prompt: seedPrompt,
          wordsPerPlayer: seedWpp,
          profanityFilter: seedPf,
        },
        (res: { pin?: string; sessionId?: string; error?: string }) => {
          if (res?.error) {
            showToast(`register failed: ${res.error}`);
            return;
          }
          setRegistered(true);
        },
      );
    }

    register();

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
    const onConnect = () => register();

    socket.on('wordcloud:state', onState);
    socket.on('wordcloud:word:added', onAdded);
    socket.on('wordcloud:word:removed', onRemoved);
    socket.on('wordcloud:status:changed', onStatus);
    socket.on('connect', onConnect);

    return () => {
      socket.off('wordcloud:state', onState);
      socket.off('wordcloud:word:added', onAdded);
      socket.off('wordcloud:word:removed', onRemoved);
      socket.off('wordcloud:status:changed', onStatus);
      socket.off('connect', onConnect);
    };
  }, [socket, pin, seedPrompt, seedSessionId, seedWpp, seedPf, showToast]);

  const status: CloudStatus = state?.status ?? 'LOBBY';
  const live = status === 'LIVE';
  const ended = status === 'ENDED';
  const paused = status === 'PAUSED';
  const totalSubmissions = useMemo(
    () => (state?.words ?? []).reduce((s, w) => s + w.count, 0),
    [state?.words],
  );

  function copyPin() {
    if (!pin || typeof navigator === 'undefined') return;
    navigator.clipboard?.writeText(pin).then(
      () => showToast('PIN copied'),
      () => showToast('Copy failed — select the digits.'),
    );
  }

  function openDisplay() {
    if (!pin) return;
    window.open(
      publicUrl(`/host/wordcloud/${pin}/display`, window.location.origin),
      '_blank',
      'noopener,noreferrer',
    );
  }

  function startActivity() {
    if (!socket || !pin) return;
    socket.emit('wordcloud:host:set-status', { pin, status: 'LIVE' });
  }
  function togglePause() {
    if (!socket || !pin) return;
    const next: CloudStatus = paused ? 'LIVE' : 'PAUSED';
    socket.emit('wordcloud:host:set-status', { pin, status: next });
  }
  function endActivity() {
    if (!socket || !pin) return;
    socket.emit('wordcloud:host:set-status', { pin, status: 'ENDED' });
    setConfirmEnd(false);
  }
  function trashWord(normalized: string, display: string) {
    if (!socket || !pin) return;
    if (!window.confirm(`Remove “${display}” from the cloud?`)) return;
    socket.emit('wordcloud:host:remove', { pin, normalized });
  }

  const promptText = state?.prompt || seedPrompt || '—';
  const wpp = state?.wordsPerPlayer ?? seedWpp;
  const joinerCount = state?.joinerCount ?? 0;

  return (
    <main className="relative min-h-screen pb-24">
      <CornerMarks />
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 ink-border stamp ticker text-[11px] tracking-widest px-3 py-2"
          style={{ background: 'var(--ivy)', color: 'var(--bone)' }}
          role="status"
          aria-live="polite"
        >
          ✓ {toast}
        </div>
      )}

      <header className="px-6 pt-4 flex items-center justify-between">
        <Chyron label="DIRECTOR · WORD CLOUD" number="WC" />
        <div className="flex items-center gap-6">
          <FrameCounter index={Math.min(999, totalSubmissions)} />
          <Clock />
          <OnAir live={live} />
          <AccountMenu />
        </div>
      </header>
      <SmpteBars className="h-1.5 mt-3" />

      <section className="px-4 sm:px-6 pt-6 max-w-[1500px] mx-auto grid grid-cols-12 gap-5">
        <div
          className="col-span-12 lg:col-span-7 ink-border p-5 sm:p-6"
          style={{ background: 'var(--bone)' }}
        >
          <div className="flex flex-col-reverse md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <span className="chyron" style={{ color: 'var(--vermilion)' }}>
                PROMPT · ON THE WIRE
              </span>
              <p
                className="font-editorial leading-tight mt-2"
                style={{ fontSize: 'clamp(28px, 4vw, 48px)' }}
              >
                {promptText}
              </p>
              <p className="font-editorial italic text-[13px] mt-2 opacity-70">
                Up to {wpp} {wpp === 1 ? 'word' : 'words'} per player ·{' '}
                {(state?.profanityFilter ?? seedPf) ? 'filter on' : 'filter off'}
              </p>
            </div>
            <PhaseBadge status={status} />
          </div>

          <div className="mt-6 grid grid-cols-12 gap-3">
            <button
              type="button"
              onClick={copyPin}
              className="col-span-12 ink-border text-left p-4 transition-colors hover:bg-[var(--ink)] hover:text-[var(--bone)] focus:bg-[var(--ink)] focus:text-[var(--bone)] outline-none"
              style={{ background: 'var(--bone)', minHeight: 56 }}
              aria-label="Copy PIN to clipboard"
            >
              <span className="chyron opacity-70">GAME PIN · TAP TO COPY</span>
              <p
                className="display-num ticker mt-1"
                style={{ fontSize: 'clamp(56px, 9vw, 120px)', letterSpacing: '0.06em' }}
              >
                {pin || '······'}
              </p>
            </button>
            <PanelStat
              cols="col-span-6"
              label="PLAYERS"
              value={String(joinerCount).padStart(2, '0')}
            />
            <PanelStat
              cols="col-span-6"
              label="WORDS"
              value={String(state?.words.length ?? 0).padStart(2, '0')}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openDisplay}
              className="ink-border ticker text-[11px] tracking-widest px-3"
              style={{ minHeight: 56, background: 'var(--bone)', color: 'var(--ink)' }}
            >
              ⤴ OPEN DISPLAY
            </button>
            {status === 'LOBBY' && (
              <button
                type="button"
                onClick={startActivity}
                disabled={!registered}
                className="ink-border stamp ticker text-[12px] tracking-widest px-4"
                style={{
                  minHeight: 56,
                  background: registered ? 'var(--vermilion)' : 'var(--ash)',
                  color: 'var(--bone)',
                }}
              >
                ▶ GO LIVE
              </button>
            )}
            {(live || paused) && (
              <button
                type="button"
                onClick={togglePause}
                className="ink-border ticker text-[12px] tracking-widest px-4"
                style={{
                  minHeight: 56,
                  background: paused ? 'var(--marigold)' : 'var(--bone)',
                  color: 'var(--ink)',
                }}
              >
                {paused ? '▶ RESUME SUBMISSIONS' : '❚❚ PAUSE SUBMISSIONS'}
              </button>
            )}
            {!ended && (
              <button
                type="button"
                onClick={() => setConfirmEnd(true)}
                disabled={status === 'LOBBY'}
                className="ink-border ticker text-[12px] tracking-widest px-4"
                style={{
                  minHeight: 56,
                  background: status === 'LOBBY' ? 'var(--ash)' : 'var(--ink)',
                  color: 'var(--bone)',
                }}
              >
                ■ END ACTIVITY
              </button>
            )}
            <a
              href={ended && pin ? `/host/wordcloud/${pin}/answers.csv` : undefined}
              aria-disabled={!ended}
              className="ink-border ticker text-[12px] tracking-widest px-4 inline-flex items-center"
              style={{
                minHeight: 56,
                background: ended ? 'var(--cobalt)' : 'var(--ash)',
                color: 'var(--bone)',
                pointerEvents: ended ? 'auto' : 'none',
                opacity: ended ? 1 : 0.6,
              }}
              title={ended ? 'Download CSV' : 'Available after end (MID-99)'}
            >
              ⬇ EXPORT CSV
            </a>
          </div>

          {confirmEnd && (
            <div
              className="mt-5 ink-border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              style={{ background: 'var(--marigold)', color: 'var(--ink)' }}
              role="alertdialog"
              aria-label="End activity confirmation"
            >
              <p className="font-editorial italic">
                End the activity? Submissions freeze and the cloud is final.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmEnd(false)}
                  className="ink-border ticker text-[11px] tracking-widest px-3"
                  style={{ minHeight: 44, background: 'var(--bone)', color: 'var(--ink)' }}
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  onClick={endActivity}
                  className="ink-border ticker text-[11px] tracking-widest px-3"
                  style={{ minHeight: 44, background: 'var(--ink)', color: 'var(--bone)' }}
                >
                  CONFIRM · END
                </button>
              </div>
            </div>
          )}
        </div>

        <aside
          className="col-span-12 lg:col-span-5 ink-border p-5 flex flex-col"
          style={{ background: 'var(--bone)' }}
        >
          <div className="flex items-center justify-between">
            <span className="chyron">SUBMISSIONS · LIVE</span>
            <span className="ticker text-[11px] tracking-widest opacity-60">
              {String(state?.words.length ?? 0).padStart(2, '0')} UNIQUE ·{' '}
              {String(totalSubmissions).padStart(3, '0')} TOTAL
            </span>
          </div>

          <ol
            className="mt-3 divide-y overflow-y-auto pr-1"
            style={{ borderColor: 'rgba(15,15,15,.18)', maxHeight: 520 }}
          >
            {(state?.words.length ?? 0) === 0 && (
              <li className="font-editorial italic opacity-60 py-3">
                {status === 'LOBBY'
                  ? 'Open the display, share the PIN, then go live.'
                  : 'No submissions yet — players are typing.'}
              </li>
            )}
            {(state?.words ?? []).map((w, i) => (
              <li
                key={w.normalized}
                className="py-2 flex items-center gap-3 border-b last:border-b-0"
                style={{ borderColor: 'rgba(15,15,15,.18)' }}
              >
                <span className="display-num text-2xl tabular-nums" style={{ minWidth: 36 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span
                  className="font-editorial flex-1 truncate text-lg"
                  title={w.display}
                  style={{ wordBreak: 'break-word' }}
                >
                  {w.display}
                </span>
                <span className="ticker tabular-nums text-base">×{w.count}</span>
                <button
                  type="button"
                  onClick={() => trashWord(w.normalized, w.display)}
                  className="ink-border ticker text-[10px] tracking-widest px-2"
                  style={{
                    minHeight: 44,
                    minWidth: 44,
                    background: 'var(--bone)',
                    color: 'var(--vermilion)',
                  }}
                  aria-label={`Trash ${w.display}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>

          <div
            className="mt-auto pt-4 border-t-2 flex items-center justify-between"
            style={{ borderColor: 'var(--ink)' }}
          >
            <Link href="/host" className="ticker text-[11px] tracking-widest opacity-70">
              ← studio master
            </Link>
            <span className="ticker text-[11px] tracking-widest opacity-60">
              UP TO {wpp} {wpp === 1 ? 'WORD' : 'WORDS'}/PLAYER
            </span>
          </div>
        </aside>
      </section>
    </main>
  );
}

function PhaseBadge({ status }: { status: CloudStatus }) {
  const map: Record<CloudStatus, { label: string; bg: string; fg: string }> = {
    LOBBY: { label: 'LOBBY · STANDBY', bg: 'var(--ash)', fg: 'var(--ink)' },
    LIVE: { label: 'ON AIR · COLLECTING', bg: 'var(--vermilion)', fg: 'var(--bone)' },
    PAUSED: { label: 'PAUSED · HOLD', bg: 'var(--marigold)', fg: 'var(--ink)' },
    ENDED: { label: 'FADE OUT · FROZEN', bg: 'var(--ink)', fg: 'var(--bone)' },
  };
  const s = map[status];
  return (
    <span
      className="ticker tracking-widest text-[12px] px-3 py-1 ink-border self-start"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

function PanelStat({ cols, label, value }: { cols: string; label: string; value: string }) {
  return (
    <div className={`${cols} ink-border p-3 flex flex-col`} style={{ background: 'var(--bone)' }}>
      <span className="chyron opacity-70">{label}</span>
      <span className="display-num text-3xl mt-1 ticker">{value}</span>
    </div>
  );
}
