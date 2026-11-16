import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/api/**/*.test.ts'],
    // A run calls the deployed agent, and its Lambda can take up to 30
    // seconds, plus cold starts
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
