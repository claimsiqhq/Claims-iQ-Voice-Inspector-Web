import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['./tests/setup.ts'],
    environmentMatchGlobs: [
      ['tests/client/**', 'jsdom'],
      ['tests/server/**', 'node'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['server/**/*.ts', 'shared/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/node_modules/**',
      ],
      thresholds: {
        statements: 40,
        branches: 30,
        functions: 40,
        lines: 40,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
