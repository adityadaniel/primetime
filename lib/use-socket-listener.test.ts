// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { describe, expect, it, vi } from 'vitest';
import { useSocketListener } from './use-socket-listener';

function fakeSocket(connected = false) {
  return {
    connected,
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Socket & {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
}

describe('useSocketListener', () => {
  it('registers handlers, registers connect, and immediately reconnects when already connected', () => {
    const socket = fakeSocket(true);
    const onState = vi.fn();
    const onPersonal = vi.fn();
    const onConnect = vi.fn();

    renderHook(() =>
      useSocketListener(
        socket,
        true,
        {
          state: onState,
          personal: onPersonal,
        },
        onConnect,
        [socket, onState, onPersonal, onConnect],
      ),
    );

    expect(socket.on).toHaveBeenCalledWith('state', onState);
    expect(socket.on).toHaveBeenCalledWith('personal', onPersonal);
    expect(socket.on).toHaveBeenCalledWith('connect', onConnect);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('cleans up every registered handler and the connect handler on unmount', () => {
    const socket = fakeSocket(false);
    const onState = vi.fn();
    const onConnect = vi.fn();

    const { unmount } = renderHook(() =>
      useSocketListener(socket, true, { state: onState }, onConnect, [socket, onState, onConnect]),
    );

    unmount();

    expect(socket.off).toHaveBeenCalledWith('state', onState);
    expect(socket.off).toHaveBeenCalledWith('connect', onConnect);
  });

  it('does not register anything when disabled or when the socket is missing', () => {
    const socket = fakeSocket(true);
    const onState = vi.fn();
    const onConnect = vi.fn();

    renderHook(() => useSocketListener(socket, false, { state: onState }, onConnect, [socket]));
    renderHook(() => useSocketListener(null, true, { state: onState }, onConnect, [onState]));

    expect(socket.on).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('allows listener-only usage without a reconnect callback', () => {
    const socket = fakeSocket(true);
    const onState = vi.fn();

    const { unmount } = renderHook(() =>
      useSocketListener(socket, true, { state: onState }, undefined, [socket, onState]),
    );

    expect(socket.on).toHaveBeenCalledWith('state', onState);
    expect(socket.on).not.toHaveBeenCalledWith('connect', expect.any(Function));

    unmount();

    expect(socket.off).toHaveBeenCalledWith('state', onState);
    expect(socket.off).not.toHaveBeenCalledWith('connect', expect.any(Function));
  });
});
