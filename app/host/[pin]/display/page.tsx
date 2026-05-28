'use client';

import { useEffect, useRef, useState } from 'react';
import { useSocket } from '@/lib/socket';
import type { PublicGameState } from '@/lib/types';
import { useSfx } from '@/lib/use-sfx';
import { DisplayView } from './display-views';

export default function DisplayPage({ params }: { params: Promise<{ pin: string }> }) {
  const socket = useSocket();
  const sfx = useSfx();
  const [pin, setPin] = useState<string>('');
  const [state, setState] = useState<PublicGameState | null>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);

  const prevPhaseRef = useRef<string>('');
  const lastTickSecRef = useRef(-1);
  const urgentArmedRef = useRef(false);

  useEffect(() => {
    params.then((p) => setPin(p.pin));
  }, [params]);

  useEffect(() => {
    if (!socket || !pin) return;
    const attach = () => socket.emit('display:attach', pin);
    const onState = (s: PublicGameState) => {
      if (s.pin === pin) setState(s);
    };
    if (socket.connected) attach();
    socket.on('connect', attach);
    socket.on('state', onState);
    return () => {
      socket.off('connect', attach);
      socket.off('state', onState);
    };
  }, [socket, pin]);

  useEffect(() => {
    const check = () => setNeedsUnlock(!sfx.isUnlocked());
    check();
    const id = window.setInterval(check, 500);
    return () => clearInterval(id);
  }, [sfx]);

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
    urgentArmedRef.current = false;
    lastTickSecRef.current = -1;
    const id = window.setInterval(() => {
      const msLeft = Math.max(0, (state.endsAt ?? 0) - Date.now());
      const sec = Math.ceil(msLeft / 1000);
      if (sec !== lastTickSecRef.current && sec > 0 && sec <= 3) {
        if (!urgentArmedRef.current) {
          urgentArmedRef.current = true;
          sfx.crossfadeToUrgent();
        }
      }
      if (sec === 0 && lastTickSecRef.current !== 0) {
        sfx.sfxTimeUp();
        sfx.stopUrgentTickLoop();
      }
      lastTickSecRef.current = sec;
    }, 100);
    return () => clearInterval(id);
  }, [state?.phase, state?.endsAt, sfx]);

  useEffect(() => {
    return () => {
      sfx.stopAllLoops();
    };
  }, [sfx]);

  async function enableSound() {
    await sfx.unlockAudio();
    setNeedsUnlock(false);
    if (state?.phase === 'lobby') sfx.startLobbyAmbience();
    if (state?.phase === 'question') sfx.startQuestionTension();
    if (state?.phase === 'final') sfx.startFinalLoop();
  }

  return (
    <>
      <DisplayView state={state} pin={pin} />
      {needsUnlock && (
        <button
          type="button"
          onClick={enableSound}
          className="fixed inset-0 z-50 grid place-items-center"
          style={{ background: 'rgba(15,15,15,0.55)', color: 'var(--bone)' }}
          aria-label="Enable sound"
        >
          <span
            className="ink-border ticker text-[14px] tracking-widest px-6 py-4"
            style={{ background: 'var(--ink)' }}
          >
            CLICK ANYWHERE TO ENABLE SOUND
          </span>
        </button>
      )}
    </>
  );
}
