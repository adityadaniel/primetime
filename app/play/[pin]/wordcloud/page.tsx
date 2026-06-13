'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chyron, Clock, FrameCounter, SmpteBars } from '@/components/Broadcast';
import { useSocket } from '@/lib/socket';
import { validateWordInput, WORDCLOUD_INPUT_MAX } from '@/lib/wordcloud-input';

type CloudStatus = 'LOBBY' | 'LIVE' | 'PAUSED' | 'ENDED';
type Submission = { normalized: string; display: string };
type CloudWord = { normalized: string; display: string; count: number };
type RejectReason =
  | 'filter'
  | 'duplicate'
  | 'max_reached'
  | 'paused'
  | 'session_not_live'
  | 'unknown_player'
  | 'rate_limited'
  | 'not_authorized';

type JoinAck =
  | {
      playerId: string;
      prompt: string;
      wordsPerPlayer: number;
      status: CloudStatus;
      mySubmissions: Submission[];
      words: CloudWord[];
    }
  | { error: string };

type JoinSuccess = Exclude<JoinAck, { error: string }>;

const COOLDOWN_MS = 800;

function rejectMessage(reason: RejectReason | undefined, wordsPerPlayer: number): string {
  switch (reason) {
    case 'filter':
      return 'Try a different word.';
    case 'duplicate':
      return 'You already sent that one.';
    case 'max_reached':
      return `You've sent your ${wordsPerPlayer} word${wordsPerPlayer === 1 ? '' : 's'}.`;
    case 'paused':
      return 'Host paused submissions.';
    case 'rate_limited':
      return 'One sec — give it a moment.';
    default:
      return "Couldn't submit, try again.";
  }
}

export default function WordCloudPlayerPage({ params }: { params: Promise<{ pin: string }> }) {
  const socket = useSocket();
  const [pin, setPin] = useState('');
  const [me, setMe] = useState<{ id: string | null; nickname: string } | null>(null);
  const [evicted, setEvicted] = useState<string | null>(null);
  const [status, setStatus] = useState<CloudStatus>('LOBBY');
  const [prompt, setPrompt] = useState<string>('');
  const [wordsPerPlayer, setWordsPerPlayer] = useState<number>(3);
  const [mySubmissions, setMySubmissions] = useState<Submission[]>([]);
  const [draft, setDraft] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const [now, setNow] = useState(Date.now());

  const toastTimerRef = useRef<number | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const inFlightSubmitRef = useRef(false);

  useEffect(() => {
    params.then((p) => setPin(p.pin));
  }, [params]);

  useEffect(() => {
    if (!pin) return;
    const id = sessionStorage.getItem(`bc:player:${pin}`);
    const nick = sessionStorage.getItem(`bc:nick:${pin}`);
    if (nick) setMe({ id: id || null, nickname: nick });
    playerIdRef.current = id || null;
  }, [pin]);

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

  // Tick once per 100ms while the cooldown is active so the disabled button
  // re-enables on time without a setTimeout dance.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [cooldownUntil]);

  useEffect(() => {
    if (!socket || !pin || !me) return;

    const onState = (s: {
      pin: string;
      prompt: string;
      wordsPerPlayer: number;
      status: CloudStatus;
    }) => {
      if (s.pin !== pin) return;
      setPrompt(s.prompt);
      setWordsPerPlayer(s.wordsPerPlayer);
      setStatus(s.status);
    };
    const onStatusChanged = (s: { status: CloudStatus }) => setStatus(s.status);
    const onMine = (e: { submissions: Submission[] }) => setMySubmissions(e.submissions);
    const onRejected = (e: { reason?: RejectReason }) => {
      inFlightSubmitRef.current = false;
      const msg = rejectMessage(e.reason, wordsPerPlayer);
      showToast(msg);
    };
    const onWordRemoved = (e: { normalized: string }) => {
      setMySubmissions((prev) => prev.filter((s) => s.normalized !== e.normalized));
    };

    const join = () => {
      socket.emit(
        'wordcloud:player:join',
        { pin, nickname: me.nickname, playerId: playerIdRef.current ?? undefined },
        (res: JoinAck) => {
          if ('error' in res) {
            const errMsg =
              res.error === 'not_found'
                ? "Activity isn't live anymore."
                : res.error === 'duplicate_nickname'
                  ? 'That name is taken in this room.'
                  : "Couldn't join, try again.";
            setEvicted(errMsg);
            return;
          }
          const ok = res as JoinSuccess;
          playerIdRef.current = ok.playerId;
          sessionStorage.setItem(`bc:player:${pin}`, ok.playerId);
          setMe((prev) => (prev ? { ...prev, id: ok.playerId } : prev));
          setPrompt(ok.prompt);
          setWordsPerPlayer(ok.wordsPerPlayer);
          setStatus(ok.status);
          setMySubmissions(ok.mySubmissions);
        },
      );
    };

    socket.on('wordcloud:state', onState);
    socket.on('wordcloud:status:changed', onStatusChanged);
    socket.on('wordcloud:player:my-submissions', onMine);
    socket.on('wordcloud:player:rejected', onRejected);
    socket.on('wordcloud:word:removed', onWordRemoved);
    socket.on('connect', join);
    if (socket.connected) join();

    return () => {
      socket.off('wordcloud:state', onState);
      socket.off('wordcloud:status:changed', onStatusChanged);
      socket.off('wordcloud:player:my-submissions', onMine);
      socket.off('wordcloud:player:rejected', onRejected);
      socket.off('wordcloud:word:removed', onWordRemoved);
      socket.off('connect', join);
    };
  }, [socket, pin, me, wordsPerPlayer, showToast]);

  const wordsLeft = Math.max(0, wordsPerPlayer - mySubmissions.length);
  const maxReached = mySubmissions.length >= wordsPerPlayer;
  const cooldownRemaining = Math.max(0, cooldownUntil - now);
  const cooldownActive = cooldownRemaining > 0;

  const canSubmit = useMemo(() => {
    if (!socket || !me?.id || !pin) return false;
    if (status !== 'LIVE') return false;
    if (maxReached) return false;
    if (cooldownActive) return false;
    if (inFlightSubmitRef.current) return false;
    return true;
  }, [socket, me?.id, pin, status, maxReached, cooldownActive]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInlineError(null);
    if (!socket || !me?.id || !pin) return;
    if (!canSubmit) return;
    const result = validateWordInput(draft);
    if (!result.ok) {
      setInlineError(
        result.reason === 'too_long'
          ? `Keep it under ${WORDCLOUD_INPUT_MAX} characters.`
          : result.reason === 'multiline'
            ? 'One line, please.'
            : 'Type a word first.',
      );
      return;
    }
    inFlightSubmitRef.current = true;
    setCooldownUntil(Date.now() + COOLDOWN_MS);
    setNow(Date.now());
    socket.emit('wordcloud:player:submit', {
      pin,
      playerId: me.id,
      word: result.value,
    });
    setDraft('');
    // Server may answer with `wordcloud:player:rejected` (toast) or
    // `wordcloud:player:my-submissions` (success). Either clears in-flight.
    window.setTimeout(() => {
      inFlightSubmitRef.current = false;
    }, COOLDOWN_MS + 50);
  }

  if (!me) {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="max-w-md text-center">
          <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
            NO CREDENTIAL FOUND
          </p>
          <p className="font-editorial text-xl mb-4">Looks like you arrived without checking in.</p>
          <Link
            href="/join"
            className="ink-border stamp ticker text-[12px] tracking-widest px-4 py-3 inline-block"
            style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
          >
            ↩ HEAD TO /JOIN
          </Link>
        </div>
      </main>
    );
  }

  if (evicted) {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="max-w-md text-center">
          <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
            SIGNAL LOST
          </p>
          <p className="font-editorial text-xl mb-4">{evicted}</p>
          <Link
            href="/join"
            className="ink-border stamp ticker text-[12px] tracking-widest px-4 py-3 inline-block"
            style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
          >
            ↩ REJOIN
          </Link>
        </div>
      </main>
    );
  }

  const ended = status === 'ENDED';
  const liveOrPaused = status === 'LIVE' || status === 'PAUSED';

  return (
    <main className="relative min-h-[100dvh] pb-10 flex flex-col">
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 ink-border stamp ticker text-[11px] tracking-widest px-3 py-2"
          style={{ background: 'var(--ink)', color: 'var(--bone)' }}
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}

      <header className="px-5 pt-4 flex items-center justify-between gap-3">
        <Chyron label="ON AIR · TALENT" number="WC" />
        <div className="flex items-center gap-4">
          <FrameCounter index={mySubmissions.length} />
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
            <span className="ml-1">{me.nickname}</span>
          </span>
          <span className="ticker text-[11px] tracking-widest opacity-70">PIN {pin}</span>
        </div>

        <section className="pt-5">
          <p className="chyron" style={{ color: 'var(--vermilion)' }}>
            PROMPT · ON THE WIRE
          </p>
          <p
            className="font-editorial leading-tight mt-2"
            style={{ fontSize: 'clamp(28px, 7vw, 44px)' }}
          >
            {prompt || '—'}
          </p>
          <p className="font-editorial italic text-[13px] mt-2 opacity-70">
            Up to {wordsPerPlayer} {wordsPerPlayer === 1 ? 'word' : 'words'} · keep it short.
          </p>
        </section>

        {status === 'LOBBY' && <LobbyState nickname={me.nickname} />}

        {liveOrPaused && !maxReached && (
          <LiveForm
            draft={draft}
            setDraft={setDraft}
            onSubmit={handleSubmit}
            inlineError={inlineError}
            paused={status === 'PAUSED'}
            canSubmit={canSubmit}
            cooldownRemaining={cooldownRemaining}
            wordsLeft={wordsLeft}
            wordsPerPlayer={wordsPerPlayer}
          />
        )}

        {!ended && maxReached && (
          <MaxReachedState wordsPerPlayer={wordsPerPlayer} submissions={mySubmissions} />
        )}

        {ended && <EndedState submissions={mySubmissions} />}

        {liveOrPaused && !maxReached && mySubmissions.length > 0 && (
          <SubmittedList submissions={mySubmissions} />
        )}
      </div>
    </main>
  );
}

function LobbyState({ nickname }: { nickname: string }) {
  return (
    <div className="pt-8 flex flex-col items-start text-left">
      <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
        STAND BY · MIC HOT
      </p>
      <p className="display-num" style={{ fontSize: 'clamp(56px, 14vw, 110px)', lineHeight: 0.9 }}>
        WAITING ON HOST.
      </p>
      <p className="font-editorial italic text-lg mt-3 opacity-80">
        Joined as <span className="font-bold not-italic">{nickname}</span>. We'll cut in when the
        host opens the room.
      </p>
    </div>
  );
}

function LiveForm({
  draft,
  setDraft,
  onSubmit,
  inlineError,
  paused,
  canSubmit,
  cooldownRemaining,
  wordsLeft,
  wordsPerPlayer,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  inlineError: string | null;
  paused: boolean;
  canSubmit: boolean;
  cooldownRemaining: number;
  wordsLeft: number;
  wordsPerPlayer: number;
}) {
  const sentCount = wordsPerPlayer - wordsLeft;
  return (
    <form onSubmit={onSubmit} className="pt-6 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span
          className="ticker text-[11px] tracking-widest px-2 py-[2px] ink-border"
          style={{
            background: paused ? 'var(--marigold)' : 'var(--vermilion)',
            color: paused ? 'var(--ink)' : 'var(--bone)',
          }}
        >
          {paused ? 'PAUSED · STAND BY' : 'CUE · YOUR WORD'}
        </span>
        <span className="ticker tabular-nums text-[11px] tracking-widest opacity-70">
          {String(sentCount).padStart(2, '0')} / {String(wordsPerPlayer).padStart(2, '0')} SENT
        </span>
      </div>

      <label className="block">
        <span className="sr-only">Your word</span>
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={WORDCLOUD_INPUT_MAX}
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[\r\n]/g, ''))}
          disabled={paused}
          placeholder={paused ? 'Host paused submissions' : 'Type your word'}
          className="w-full mt-1 ink-border bg-transparent font-editorial px-4 py-3"
          aria-label="Your word"
          style={{
            // 16px+ avoids the iOS Safari focus-zoom.
            fontSize: '20px',
            background: 'var(--bone)',
            minHeight: 64,
            opacity: paused ? 0.6 : 1,
          }}
        />
      </label>

      {inlineError && (
        <p
          className="ticker text-[11px] tracking-widest"
          role="alert"
          style={{ color: 'var(--vermilion)' }}
        >
          ⚠ {inlineError}
        </p>
      )}

      {paused ? (
        <p className="font-editorial italic text-base opacity-70">
          Host paused submissions. We'll pick back up when they're ready.
        </p>
      ) : (
        <button
          type="submit"
          disabled={!canSubmit}
          className="ink-border stamp ticker text-[14px] tracking-widest"
          style={{
            background: canSubmit ? 'var(--vermilion)' : 'var(--ash)',
            color: canSubmit ? 'var(--bone)' : 'var(--ink)',
            minHeight: 64,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >
          {cooldownRemaining > 0 ? 'HOLD…' : '▶  SEND IT'}
        </button>
      )}

      <p className="ticker text-[11px] tracking-widest opacity-60">
        {String(wordsLeft).padStart(2, '0')} LEFT · {WORDCLOUD_INPUT_MAX} CHAR MAX
      </p>
    </form>
  );
}

function SubmittedList({ submissions }: { submissions: Submission[] }) {
  return (
    <section className="pt-6">
      <p className="chyron opacity-70">YOUR SUBMISSIONS</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {submissions.map((s, i) => (
          <li
            key={`${s.normalized}-${i}`}
            className="ink-border ticker tabular-nums text-[12px] tracking-widest px-3 py-2"
            style={{ background: 'var(--bone)' }}
          >
            <span className="opacity-60 mr-2">{String(i + 1).padStart(2, '0')}</span>
            <span className="font-editorial italic text-[15px] tracking-normal">{s.display}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MaxReachedState({
  wordsPerPlayer,
  submissions,
}: {
  wordsPerPlayer: number;
  submissions: Submission[];
}) {
  return (
    <div className="pt-8">
      <p className="chyron mb-2" style={{ color: 'var(--ivy)' }}>
        WRAP · ALL SENT
      </p>
      <p className="display-num" style={{ fontSize: 'clamp(48px, 12vw, 96px)', lineHeight: 0.9 }}>
        YOU'RE&nbsp;DONE.
      </p>
      <p className="font-editorial italic text-lg mt-3 opacity-80">
        You've sent your {wordsPerPlayer} {wordsPerPlayer === 1 ? 'word' : 'words'}. The cloud is
        filling up — watch the display.
      </p>
      <SubmittedList submissions={submissions} />
    </div>
  );
}

function EndedState({ submissions }: { submissions: Submission[] }) {
  return (
    <div className="pt-8">
      <p className="chyron mb-2" style={{ color: 'var(--vermilion)' }}>
        FADE OUT · TRANSMISSION ENDED
      </p>
      <p className="display-num" style={{ fontSize: 'clamp(48px, 12vw, 96px)', lineHeight: 0.9 }}>
        ACTIVITY ENDED.
      </p>
      <p className="font-editorial italic text-lg mt-3 opacity-80">
        Thanks for playing. Your words are on the wall.
      </p>
      {submissions.length > 0 && <SubmittedList submissions={submissions} />}
      <Link
        href="/"
        className="mt-8 ink-border stamp ticker text-[12px] tracking-widest px-4 py-3 inline-block"
        style={{ background: 'var(--ink)', color: 'var(--bone)' }}
      >
        ← back to studio master
      </Link>
    </div>
  );
}
