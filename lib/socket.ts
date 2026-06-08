'use client';

import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

type PrimetimeWindow = Window &
  typeof globalThis & {
    __primetimeSocket?: Socket;
  };

export function getSocket(): Socket {
  if (typeof window === 'undefined') {
    throw new Error('getSocket called on server');
  }

  const w = window as PrimetimeWindow;

  if (!w.__primetimeSocket) {
    w.__primetimeSocket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
    });
  }

  return w.__primetimeSocket;
}

export function useSocket(): Socket | null {
  const [s, setS] = useState<Socket | null>(null);

  useEffect(() => {
    setS(getSocket());
  }, []);

  return s;
}
