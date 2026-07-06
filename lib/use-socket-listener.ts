'use client';

import { type DependencyList, useEffect } from 'react';
import type { Socket } from 'socket.io-client';

type SocketHandler = (...args: never[]) => void;
type SocketHandlers = Record<string, SocketHandler>;

type ListenableSocket = Pick<Socket, 'connected'> & {
  on(event: string, handler: SocketHandler): void;
  off(event: string, handler: SocketHandler): void;
};

export function useSocketListener(
  socket: Socket | null | undefined,
  enabled: boolean,
  handlers: SocketHandlers,
  onConnect: (() => void) | undefined,
  deps: DependencyList,
): void {
  useEffect(() => {
    if (!socket || !enabled) return;

    const listenable = socket as ListenableSocket;
    for (const [event, handler] of Object.entries(handlers)) {
      listenable.on(event, handler);
    }

    if (onConnect) {
      listenable.on('connect', onConnect);
      if (listenable.connected) onConnect();
    }

    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        listenable.off(event, handler);
      }
      if (onConnect) listenable.off('connect', onConnect);
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: caller supplies the same dependency list the manual socket effect used.
  }, deps);
}
