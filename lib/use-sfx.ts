'use client';
import { useEffect, useRef } from 'react';
import * as sfx from './sfx';

export function useSfx() {
  const unlockedRef = useRef(false);

  useEffect(() => {
    if (unlockedRef.current) return;
    const handler = async () => {
      await sfx.unlockAudio();
      unlockedRef.current = true;
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
    };
    window.addEventListener('pointerdown', handler);
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
    };
  }, []);

  return sfx;
}
