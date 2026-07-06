import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'lib/game.ts',
        // Core session libraries measured explicitly so coverage gaps stay visible.
        'lib/qa.ts',
        'lib/qa-repo.ts',
        'lib/wonderwall-repo.ts',
      ],
      // Baseline captured 2026-07-06 when qa/repo libs were added to coverage.
      // Ratchet these upward as tests are added; do not lower them.
      thresholds: {
        statements: 93,
        branches: 88,
        functions: 91,
        lines: 94,
      },
    },
    projects: [
      {
        resolve: {
          alias: {
            '@': path.resolve(__dirname, '.'),
          },
        },
        test: {
          name: 'node',
          environment: 'node',
          include: ['lib/**/*.test.ts', 'lib/**/*.integration.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@': path.resolve(__dirname, '.'),
          },
        },
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['app/**/*.test.tsx', 'app/**/*.test.ts'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});
