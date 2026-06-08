import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { ioMock } = vi.hoisted(() => ({
  ioMock: vi.fn(),
}));

vi.mock('socket.io-client', () => ({
  io: ioMock,
}));

function installWindow() {
  Object.defineProperty(globalThis, 'window', {
    value: {},
    configurable: true,
  });
}

describe('getSocket', () => {
  beforeEach(() => {
    vi.resetModules();
    installWindow();
    ioMock.mockReset();
    ioMock.mockImplementation(() => ({
      connected: true,
      id: `socket-${ioMock.mock.calls.length}`,
      on: vi.fn(),
      off: vi.fn(),
    }));
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('reuses the same browser socket across module reloads', async () => {
    const firstModule = await import('./socket');
    const first = firstModule.getSocket();

    vi.resetModules();
    const reloadedModule = await import('./socket');
    const second = reloadedModule.getSocket();

    expect(second).toBe(first);
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it('does not create sockets on the server', async () => {
    Reflect.deleteProperty(globalThis, 'window');
    const { getSocket } = await import('./socket');

    expect(() => getSocket()).toThrow('getSocket called on server');
    expect(ioMock).not.toHaveBeenCalled();
  });
});
