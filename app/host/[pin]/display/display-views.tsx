'use client';

import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Chyron, Clock, FrameCounter, OnAir, SmpteBars } from '@/components/Broadcast';
import { Countdown } from '@/components/Countdown';
import { CHANNELS, Checkmark, Shape } from '@/components/Shape';
import type { PublicGameState } from '@/lib/types';

export function DisplayView({ state, pin }: { state: PublicGameState | null; pin: string }) {
  const phase = state?.phase ?? 'lobby';
  const dark = phase === 'question' || phase === 'reveal';
  const live = phase !== 'lobby' && phase !== 'final';
  const currentNo = Math.max(0, (state?.questionIndex ?? -1) + 1);

  return (
    <main
      className={`relative h-screen w-full overflow-hidden grain flex flex-col ${dark ? 'ink-bg' : ''}`}
      style={{
        background: dark ? 'var(--ink)' : 'var(--bone)',
        color: dark ? 'var(--bone)' : 'var(--ink)',
      }}
    >
      <CornerMarksDark dark={dark} />
      <header className="px-8 pt-5 flex items-center justify-between">
        <Chyron label="LIVE FEED · STUDIO 4" number="A" dark={dark} />
        <div className="flex items-center gap-7">
          <FrameCounter index={currentNo} dark={dark} />
          <Clock dark={dark} />
          <OnAir live={live} dark={dark} />
        </div>
      </header>
      <SmpteBars className="h-2 mt-3" />

      {state?.paused && <PausedOverlay resumeBy={state.paused.resumeBy} />}

      <section className="px-10 pt-8 pb-12 max-w-[1800px] w-full mx-auto flex-1 min-h-0 flex flex-col">
        {phase === 'lobby' && state && <LobbyDisplay state={state} pin={pin} />}
        {(phase === 'question' || phase === 'reveal') && state && <QuestionDisplay state={state} />}
        {phase === 'leaderboard' && state && <PodiumDisplay state={state} />}
        {phase === 'final' && state && <FinalDisplay state={state} />}
      </section>
    </main>
  );
}

export function CornerMarksDark({ dark }: { dark: boolean }) {
  const color = dark ? 'var(--bone)' : 'var(--ink)';
  return (
    <>
      <span
        className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2"
        style={{ borderColor: color }}
        aria-hidden
      />
      <span
        className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2"
        style={{ borderColor: color }}
        aria-hidden
      />
      <span
        className="absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2"
        style={{ borderColor: color }}
        aria-hidden
      />
      <span
        className="absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2"
        style={{ borderColor: color }}
        aria-hidden
      />
    </>
  );
}

export function LobbyDisplay({ state, pin }: { state: PublicGameState; pin: string }) {
  const [joinUrl, setJoinUrl] = useState('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const base = window.location.origin;
    setJoinUrl(pin ? `${base}/join?pin=${pin}` : `${base}/join`);
  }, [pin]);

  const ordered = [...state.players].map((p, i) => ({ p, no: i + 1 })).reverse();

  return (
    <div className="flex flex-col gap-8 flex-1 min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-10">
        <div className="min-w-0 flex-1">
          <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
            STAND BY · TRANSMITTING ON CHANNEL 4
          </p>
          <p className="ticker text-[14px] tracking-widest opacity-70">GAME PIN</p>
          <p
            className="display-num ticker"
            style={{
              fontSize: 'clamp(80px, 12vw, 200px)',
              lineHeight: 0.82,
              letterSpacing: '0.04em',
            }}
          >
            {pin || '······'}
          </p>
          <p className="font-editorial italic text-2xl mt-6 max-w-2xl">
            {state.players.length === 0
              ? 'Waiting for the first player to check in…'
              : `${state.players.length} on the floor — host signals ROLL TAPE to begin.`}
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 shrink-0">
          <div
            className="ink-border p-4 grid place-items-center"
            style={{ background: 'var(--bone)' }}
          >
            {joinUrl ? (
              <QRCodeSVG
                value={joinUrl}
                size={220}
                bgColor="transparent"
                fgColor="var(--ink)"
                level="M"
                marginSize={0}
              />
            ) : (
              <div style={{ width: 220, height: 220 }} aria-hidden />
            )}
          </div>
          <p className="ticker text-[12px] tracking-widest opacity-70 text-center">SCAN TO JOIN</p>
        </div>
      </div>

      <aside className="flex-1 min-h-0 flex flex-col">
        <div
          className="ink-border flex flex-col flex-1 min-h-[280px]"
          style={{ background: 'var(--bone)' }}
        >
          <div
            className="flex items-center justify-between px-5 py-4 border-b-2"
            style={{ borderColor: 'var(--ink)' }}
          >
            <span className="chyron">CHECK-IN</span>
            <span className="ticker text-[12px] tracking-widest">
              {String(state.players.length).padStart(2, '0')} /{' '}
              {String(state.cap?.max ?? 10).padStart(2, '0')}
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
            <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {ordered.length === 0 && (
                <li className="col-span-full font-editorial italic opacity-60">
                  No one on the floor.
                </li>
              )}
              {ordered.map(({ p, no }) => (
                <li
                  key={p.id}
                  className="ink-border px-3 py-2 flex items-center gap-2 teleprompter"
                  style={{ background: 'var(--bone)' }}
                >
                  <span className="ticker text-[11px] tracking-widest opacity-60">
                    {String(no).padStart(2, '0')}
                  </span>
                  <span className="font-editorial truncate text-lg">{p.nickname}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="ticker text-[11px] tracking-widest mt-4 opacity-70 shrink-0">
          PLAYER UI: open <span className="opacity-100">/join</span> on a phone, enter the PIN, pick
          a name.
        </p>
      </aside>
    </div>
  );
}

export function QuestionDisplay({ state }: { state: PublicGameState }) {
  const q = state.question;
  if (!q) return null;
  const qNum = String(state.questionIndex + 1).padStart(2, '0');
  const total = String(state.totalQuestions).padStart(2, '0');
  const dist = state.reveal?.distribution ?? new Array(q.options.length).fill(0);
  const totalAns = Math.max(
    1,
    dist.reduce((a, b) => a + b, 0),
  );
  const correct = state.reveal?.correct;
  const correctAnswer = correct !== undefined ? q.options[correct] : undefined;
  const correctAnswerLen = correctAnswer?.length ?? 0;

  return (
    <div className="flex flex-col gap-6 flex-1 min-h-0">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <span
            className="ticker text-[12px] tracking-widest px-2 py-[2px]"
            style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
          >
            CUE {qNum} / {total}
          </span>
          <span className="ticker text-[12px] tracking-widest opacity-80">
            {q.timeLimit}s · {q.doublePoints ? '2× POINTS' : '1× POINTS'}
          </span>
        </div>
        <Countdown endsAt={state.endsAt} startedAt={state.startedAt} size={120} dark />
      </div>

      <div
        className={`flex items-center ${q.imageUrl ? 'gap-6' : 'gap-8'} ${
          state.phase === 'reveal' ? 'shrink-0' : 'flex-1 min-h-0 overflow-hidden'
        }`}
      >
        {q.imageUrl && (
          <div
            className="ink-border relative shrink-0 overflow-hidden"
            style={{
              background: 'var(--bone)',
              ...(state.phase === 'reveal'
                ? { width: '18%', aspectRatio: '4 / 3' }
                : { height: '100%', width: '36%' }),
            }}
          >
            <Image src={q.imageUrl} alt="" fill unoptimized className="object-contain" />
          </div>
        )}
        <p
          className="font-editorial teleprompter flex-1 min-w-0"
          style={{
            fontSize:
              state.phase === 'reveal'
                ? 'clamp(14px, 1.6vw, 22px)'
                : q.imageUrl
                  ? q.text.length >= 200
                    ? 'clamp(15px, 1.6vw, 22px)'
                    : q.text.length >= 120
                      ? 'clamp(18px, 2vw, 28px)'
                      : q.text.length >= 60
                        ? 'clamp(22px, 2.6vw, 36px)'
                        : 'clamp(28px, 3.2vw, 48px)'
                  : q.text.length >= 200
                    ? 'clamp(22px, 2.4vw, 34px)'
                    : q.text.length >= 120
                      ? 'clamp(30px, 3.6vw, 56px)'
                      : q.text.length >= 60
                        ? 'clamp(40px, 5.5vw, 92px)'
                        : 'clamp(44px, 6.5vw, 108px)',
            lineHeight:
              state.phase === 'reveal'
                ? 1.25
                : q.imageUrl
                  ? 1.3
                  : q.text.length >= 120
                    ? 1.2
                    : 1.05,
          }}
        >
          {q.text}
        </p>
      </div>

      {state.phase === 'reveal' && correct !== undefined && (
        <div
          className="ink-border stamp px-6 py-3 flex items-center gap-4 shrink-0 overflow-hidden"
          style={{ background: 'var(--ivy)', color: 'var(--bone)' }}
        >
          <div className="shrink-0">
            <Shape
              kind={(CHANNELS[correct] ?? CHANNELS[0]).key}
              fill="var(--bone)"
              stroke="var(--ink)"
              size={48}
              strokeWidth={3}
            />
          </div>
          <p
            className="font-editorial min-w-0 flex-1 overflow-hidden"
            style={{
              fontSize:
                correctAnswerLen >= 72
                  ? 'clamp(18px, 2.2vw, 34px)'
                  : correctAnswerLen >= 40
                    ? 'clamp(20px, 2.5vw, 40px)'
                    : 'clamp(18px, 2.8vw, 48px)',
              lineHeight: correctAnswerLen >= 72 ? 1.1 : correctAnswerLen >= 40 ? 1.08 : 1.0,
              maxHeight: '3.2em',
            }}
          >
            {q.options[correct]}
          </p>
        </div>
      )}

      <div
        className={`grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2 ${state.phase === 'reveal' ? 'flex-1 min-h-0' : 'shrink-0'}`}
        style={state.phase === 'reveal' ? { gridAutoRows: '1fr' } : undefined}
      >
        {q.options.map((opt, i) => {
          const ch = CHANNELS[i] ?? CHANNELS[0];
          const pct = Math.round((dist[i] / totalAns) * 100);
          const isReveal = state.phase === 'reveal';
          const isCorrect = isReveal && correct === i;
          const isWrong = isReveal && correct !== undefined && correct !== i;
          return (
            <div
              key={i}
              className="relative ink-border overflow-hidden"
              style={{
                background: isCorrect ? 'var(--ivy)' : ch.color,
                opacity: isWrong ? 0.35 : 1,
                ...(isReveal ? {} : { aspectRatio: '1.05 / 1' }),
              }}
            >
              {!isReveal && (
                <div className="absolute inset-0 grid place-items-center">
                  <Shape
                    kind={ch.key}
                    fill="var(--bone)"
                    stroke="var(--ink)"
                    size={150}
                    strokeWidth={3}
                  />
                </div>
              )}
              {isReveal && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 pb-10">
                  <Shape
                    kind={ch.key}
                    fill="var(--bone)"
                    stroke="var(--ink)"
                    size={60}
                    strokeWidth={3}
                  />
                  <p
                    className="font-editorial text-center leading-tight"
                    style={{
                      color: 'var(--bone)',
                      fontSize: 'clamp(14px, 1.6vw, 26px)',
                      maxHeight: '3.6em',
                      overflow: 'hidden',
                    }}
                  >
                    {opt}
                  </p>
                </div>
              )}
              {isCorrect && (
                <div className="absolute top-3 right-3">
                  <Checkmark size={40} stroke="var(--bone)" strokeWidth={6} />
                </div>
              )}
              <div
                className="absolute top-2 left-2 ticker text-[11px] tracking-widest"
                style={{ color: 'var(--bone)' }}
              >
                CH.{String(i + 1).padStart(2, '0')}
              </div>
              {isReveal && (
                <div
                  className="absolute bottom-0 left-0 right-0 px-3 py-2 flex items-end justify-between"
                  style={{ background: 'rgba(15,15,15,0.78)' }}
                >
                  <span className="display-num text-4xl" style={{ color: 'var(--bone)' }}>
                    {dist[i]}
                  </span>
                  <span
                    className="ticker text-[12px] tracking-widest"
                    style={{ color: 'var(--bone)' }}
                  >
                    {pct}%
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PodiumDisplay({ state }: { state: PublicGameState }) {
  const order = state.podium ?? [];
  const slots = [order[1], order[0], order[2]];
  const heights = ['40%', '65%', '30%'];
  const colors = ['var(--ash)', 'var(--marigold)', 'var(--vermilion)'];
  const ranks = [2, 1, 3];
  return (
    <div>
      <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
        AFTER CUE {String(state.questionIndex + 1).padStart(2, '0')} · STANDINGS
      </p>
      <div className="grid grid-cols-3 gap-6 items-end h-[60vh]">
        {slots.map((p, i) => (
          <div key={i} className="flex flex-col items-center justify-end h-full">
            {p ? (
              <>
                <div className="font-editorial text-3xl truncate w-full text-center mb-2">
                  {p.nickname}
                </div>
                <div className="ticker tabular-nums text-2xl mb-3">{p.score.toLocaleString()}</div>
              </>
            ) : (
              <div className="font-editorial italic opacity-50 mb-3">—</div>
            )}
            <div
              className="w-full ink-border grid place-items-center"
              style={{ background: colors[i], height: heights[i] }}
            >
              <span
                className="display-num"
                style={{ fontSize: 'clamp(80px, 14vw, 220px)', color: 'var(--ink)' }}
              >
                {ranks[i]}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FinalDisplay({ state }: { state: PublicGameState }) {
  const board = [...state.players].sort((a, b) => b.score - a.score);
  const winner = board[0];
  const hostLeft = state.endedReason === 'host-left';
  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12">
        <p className="chyron" style={{ color: 'var(--vermilion)' }}>
          {hostLeft ? 'HOST LEFT · TRANSMISSION ENDED' : 'FADE TO BLACK · FINAL TRANSMISSION'}
        </p>
        <p
          className="display-num"
          style={{ fontSize: 'clamp(80px, 16vw, 240px)', lineHeight: 0.85 }}
        >
          {hostLeft ? 'OFF AIR.' : "THAT'S A WRAP."}
        </p>
      </div>
      {winner && (
        <div
          className="col-span-12 lg:col-span-7 ink-border p-8"
          style={{ background: 'var(--marigold)' }}
        >
          <span className="chyron">CHAMPION · CH.01</span>
          <p className="display-num mt-2" style={{ fontSize: 'clamp(56px, 10vw, 144px)' }}>
            {winner.nickname}
          </p>
          <p className="ticker tabular-nums text-3xl mt-2">{winner.score.toLocaleString()} pts</p>
        </div>
      )}
      <div className="col-span-12 lg:col-span-5 ink-border" style={{ background: 'var(--bone)' }}>
        <div className="px-4 py-2 border-b-2" style={{ borderColor: 'var(--ink)' }}>
          <span className="chyron">FINAL ORDER</span>
        </div>
        <ol>
          {board.map((p, i) => (
            <li
              key={p.id}
              className="px-4 py-2 flex items-center gap-3 border-b last:border-b-0"
              style={{ borderColor: 'rgba(15,15,15,.18)' }}
            >
              <span className="display-num text-3xl" style={{ minWidth: 40 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="font-editorial flex-1 truncate text-lg">{p.nickname}</span>
              <span className="ticker tabular-nums">{p.score.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function PausedOverlay({ resumeBy }: { resumeBy: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const remaining = Math.max(0, Math.ceil((resumeBy - now) / 1000));
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center"
      style={{ background: 'rgba(15,15,15,0.92)' }}
    >
      <div className="text-center px-8" style={{ color: 'var(--bone)' }}>
        <p className="chyron mb-3" style={{ color: 'var(--marigold)' }}>
          SIGNAL DROPPED · STAND BY
        </p>
        <p
          className="display-num"
          style={{ fontSize: 'clamp(80px, 14vw, 200px)', lineHeight: 0.85 }}
        >
          PAUSED.
        </p>
        <p className="font-editorial italic text-2xl mt-3 opacity-80">
          Host went off-air. Resuming if they reconnect.
        </p>
        <p
          className="display-num ticker tabular-nums mt-6"
          style={{ fontSize: 'clamp(64px, 10vw, 120px)', color: 'var(--marigold)' }}
        >
          {String(remaining).padStart(2, '0')}s
        </p>
      </div>
    </div>
  );
}
