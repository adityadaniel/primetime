// Thin Socket.IO client helpers for the realtime portions of the lifecycle
// suite. Mirrors the proven pattern in scripts/smoke.ts (websocket transport,
// promisified acks) but typed — no `any`.

import { io, type Socket } from 'socket.io-client';
import { E2E_BASE_URL } from '../e2e-env';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function connectSocket(): Promise<Socket> {
  const socket = io(E2E_BASE_URL, { transports: ['websocket'], forceNew: true });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 5_000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Emit an event and resolve with its ack payload. */
export function emitAck<T>(socket: Socket, event: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve) => {
    socket.emit(event, ...args, (res: T) => resolve(res));
  });
}

export interface HostCreateAck {
  pin: string;
}
export interface JoinAck {
  ok: boolean;
  playerId?: string;
  error?: string;
  code?: string;
}
