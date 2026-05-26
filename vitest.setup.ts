import '@testing-library/jest-dom/vitest';
import { afterAll, beforeAll, vi } from 'vitest';

// Freeze the clock so snapshot tests are deterministic.
// Components like <Clock> in components/Broadcast.tsx read `new Date()` on render.
beforeAll(() => {
  vi.useFakeTimers({
    shouldAdvanceTime: false,
    toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
  });
  vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
});

afterAll(() => {
  vi.useRealTimers();
});
