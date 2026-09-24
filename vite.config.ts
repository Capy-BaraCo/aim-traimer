import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the production build can be hosted from any sub-path (GitHub Pages, itch.io, a USB stick).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
