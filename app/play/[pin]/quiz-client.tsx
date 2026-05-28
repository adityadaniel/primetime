'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSocket } from '@/lib/socket';
import type { AnswerIndex, PublicGameState } from '@/lib/types';
import { useSfx } from '@/lib/use-sfx';
import { type PersonalLike, PlayerView } from './player-views';

type Personal = PersonalLike;

function flashToast(setToast: (s: string | null) => void, msg: string) {
  setToast(msg);
  window.setTimeout(() => setToast(null), 3500);
}

export default function QuizClient({ pin }: { pin: string }) {
  const socket = useSocket();
  const sfx = useSfx();
  const [state, setState] = useState<PublicGameState | null>(null);
  const [personal, setPersonal] = useState<Personal | null>(null);
  const [me, setMe] = useState<{ id: string; nickname: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [evicted, setEvicted] = useState<string | null>(null);
  const [muted, setMutedState] = useState<boolean>(() => sfx.isMuted());

  const prevPhaseRef = useRef<string>('');
  const prevAnsweredRef = useRef(false);
  const lastTickSecRef = useRef(-1);
  const urgentArmedRef = useRef(false);

  useEffect(() => {
    if (!state) return;
    const phase = state.phase;
    if (phase === prevPhaseRef.current) return;

    sfx.stopAllLoops();

    if (phase === 'lobby') sfx.startLobbyAmbience();
    if (phase === 'question') sfx.startQuestionTension();
    if (phase === 'reveal') {
      if (personal && !personal.hasAnswered) sfx.sfxTimeUp();
      else if (personal?.lastCorrect) sfx.sfxCorrect();
      else sfx.sfxWrong();
    }
    if (phase === 'leaderboard') sfx.sfxLeaderboardSweep();
    if (phase === 'final') {
      sfx.sfxFinalFanfare();
      setTimeout(() => sfx.startFinalLoop(), 700);
    }

    prevPhaseRef.current = phase;
  }, [state, state?.phase, personal, personal?.lastCorrect, personal?.hasAnswered, sfx]);

  useEffect(() => {
    if (state?.phase !== 'question' || !state?.endsAt) return;
    urgentArmedRef.current = false;
    lastTickSecRef.current = -1;
    const id = window.setInterval(() => {
      const msLeft = Math.max(0, (state.endsAt ?? 0) - Date.now());
      const sec = Math.ceil(msLeft / 1000);
      if (sec !== lastTickSecRef.current && sec > 0 && sec <= 3 && !urgentArmedRef.current) {
        urgentArmedRef.current = true;
        sfx.crossfadeToUrgent();
      }
      if (sec === 0 && lastTickSecRef.current !== 0) {
        sfx.stopUrgentTickLoop();
      }
      lastTickSecRef.current = sec;
    }, 100);
    return () => clearInterval(id);
  }, [state?.phase, state?.endsAt, sfx]);

  useEffect(() => {
    if (personal?.hasAnswered && !prevAnsweredRef.current) {
      sfx.sfxLockIn();
    }
    prevAnsweredRef.current = !!personal?.hasAnswered;
  }, [personal?.hasAnswered, sfx]);

  useEffect(() => {
    return () => {
      sfx.stopAllLoops();
    };
  }, [sfx]);

  function toggleMute() {
    const next = !sfx.isMuted();
    sfx.setMuted(next);
    setMutedState(next);
  }

  useEffect(() => {
    if (!pin) return;
    const id = sessionStorage.getItem(`bc:player:${pin}`);
    const nick = sessionStorage.getItem(`bc:nick:${pin}`);
    if (id && nick) setMe({ id, nickname: nick });
  }, [pin]);

  useEffect(() => {
    if (!socket || !pin || !me) return;
    const onState = (s: PublicGameState) => {
      if (s.pin === pin) setState(s);
    };
    const onPersonal = (p: Personal) => setPersonal(p);
    const onReconnected = (e: { nickname: string }) => {
      if (e.nickname.toLowerCase() === me.nickname.toLowerCase()) {
        flashToast(setToast, 'Reconnected — score restored');
      }
    };
    socket.on('state', onState);
    socket.on('personal', onPersonal);
    socket.on('event:reconnected', onReconnected);

    const rejoin = () => {
      socket.emit(
        'player:join',
        pin,
        me.nickname,
        (res: {
          ok: boolean;
          error?: string;
          code?: string;
          playerId?: string;
          reconnected?: boolean;
        }) => {
          if (!res.ok) {
            setEvicted(res.error ?? "You're no longer in this game.");
            return;
          }
          if (res.playerId) {
            sessionStorage.setItem(`bc:player:${pin}`, res.playerId);
          }
        },
      );
    };
    if (socket.connected) rejoin();
    socket.on('connect', rejoin);
    return () => {
      socket.off('state', onState);
      socket.off('personal', onPersonal);
      socket.off('event:reconnected', onReconnected);
      socket.off('connect', rejoin);
    };
  }, [socket, pin, me]);

  function submit(i: AnswerIndex) {
    if (!socket || !pin) return;
    if (state?.phase !== 'question') return;
    if (personal?.hasAnswered) return;
    setSubmitting(true);
    setError(null);
    socket.emit('player:answer', pin, i, (res: { ok: boolean; error?: string }) => {
      setSubmitting(false);
      if (!res.ok) setError(res.error ?? 'Could not submit');
    });
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

  return (
    <PlayerView
      state={state}
      personal={personal}
      nickname={me.nickname}
      pin={pin}
      submitting={submitting}
      error={error}
      toast={toast}
      muted={muted}
      onToggleMute={toggleMute}
      onAnswer={submit}
    />
  );
}
