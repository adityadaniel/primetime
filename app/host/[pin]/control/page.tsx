'use client';

import { useEffect, useRef, useState } from 'react';
import { useSocket } from '@/lib/socket';
import type { PublicGameState } from '@/lib/types';
import { useSfx } from '@/lib/use-sfx';
import { ControlView } from './control-views';

export default function ControlPanel({ params }: { params: Promise<{ pin: string }> }) {
  const socket = useSocket();
  const sfx = useSfx();
  const [pin, setPin] = useState<string>('');
  const [state, setState] = useState<PublicGameState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [muted, setMutedState] = useState<boolean>(true);

  const prevPhaseRef = useRef<string>('');
  const lastTickSecRef = useRef(-1);
  const urgentArmedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem('bc:sfx:muted-host') === null) {
      localStorage.setItem('bc:sfx:muted-host', '1');
    }
    const hostMuted = localStorage.getItem('bc:sfx:muted-host') !== '0';
    sfx.setMuted(hostMuted, { persist: false });
    setMutedState(hostMuted);
  }, [sfx]);

  useEffect(() => {
    params.then((p) => setPin(p.pin));
  }, [params]);

  useEffect(() => {
    if (!socket || !pin) return;
    socket.emit('host:attach', pin);
    const onState = (s: PublicGameState) => {
      if (s.pin === pin) setState(s);
    };
    const onReconnected = (e: { nickname: string }) => {
      setToast(`${e.nickname} reconnected`);
      window.setTimeout(() => setToast(null), 3500);
    };
    const onConnect = () => {
      socket.emit('host:attach', pin);
    };
    socket.on('state', onState);
    socket.on('event:reconnected', onReconnected);
    socket.on('connect', onConnect);
    return () => {
      socket.off('state', onState);
      socket.off('event:reconnected', onReconnected);
      socket.off('connect', onConnect);
    };
  }, [socket, pin]);

  useEffect(() => {
    if (!state) return;
    const phase = state.phase;
    if (phase === prevPhaseRef.current) return;

    sfx.stopAllLoops();

    if (phase === 'lobby') sfx.startLobbyAmbience();
    if (phase === 'question') sfx.startQuestionTension();
    if (phase === 'reveal') sfx.sfxCorrect();
    if (phase === 'leaderboard') sfx.sfxLeaderboardSweep();
    if (phase === 'final') {
      sfx.sfxFinalFanfare();
      setTimeout(() => sfx.startFinalLoop(), 700);
    }

    prevPhaseRef.current = phase;
  }, [state, state?.phase, sfx]);

  useEffect(() => {
    if (state?.phase !== 'question' || !state?.endsAt) return;
    if (state.paused) {
      sfx.stopUrgentTickLoop();
      sfx.stopQuestionTension();
      return;
    }
    urgentArmedRef.current = false;
    lastTickSecRef.current = -1;
    let cancelled = false;
    const msLeftAtMount = Math.max(0, (state.endsAt ?? 0) - Date.now());
    if (msLeftAtMount > 3000) {
      sfx.startQuestionTension();
    } else if (msLeftAtMount > 0) {
      urgentArmedRef.current = true;
      sfx.crossfadeToUrgent();
    }
    const id = window.setInterval(() => {
      if (cancelled) return;
      const msLeft = Math.max(0, (state.endsAt ?? 0) - Date.now());
      const sec = Math.ceil(msLeft / 1000);
      if (sec !== lastTickSecRef.current && sec > 0 && sec <= 3) {
        if (!urgentArmedRef.current) {
          urgentArmedRef.current = true;
          sfx.crossfadeToUrgent();
        }
      }
      if (sec === 0 && lastTickSecRef.current !== 0) {
        sfx.stopUrgentTickLoop();
      }
      lastTickSecRef.current = sec;
    }, 100);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [state?.phase, state?.endsAt, state?.paused, sfx]);

  useEffect(() => {
    return () => {
      sfx.stopAllLoops();
    };
  }, [sfx]);

  async function toggleMute() {
    const next = !sfx.isMuted();
    await sfx.unlockAudio();
    sfx.setMuted(next, { persist: false });
    try {
      localStorage.setItem('bc:sfx:muted-host', next ? '1' : '0');
    } catch {}
    setMutedState(next);
    if (!next) {
      if (state?.phase === 'lobby') sfx.startLobbyAmbience();
      if (state?.phase === 'question') sfx.startQuestionTension();
      if (state?.phase === 'final') sfx.startFinalLoop();
    }
  }

  function startGame() {
    if (!socket || !pin) return;
    socket.emit('host:start', pin);
  }
  function nextStep() {
    if (!socket || !pin) return;
    socket.emit('host:advance', pin);
  }
  function kick(playerId: string) {
    if (!socket || !pin) return;
    if (!confirm('Remove this player?')) return;
    socket.emit('host:kick', pin, playerId);
  }

  return (
    <ControlView
      state={state}
      pin={pin}
      toast={toast}
      muted={muted}
      onToggleMute={toggleMute}
      onStart={startGame}
      onAdvance={nextStep}
      onKick={kick}
    />
  );
}
