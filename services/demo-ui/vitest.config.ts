import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Next compiles JSX itself, so tsconfig preserves it and vitest needs to
  // be told to use React's automatic runtime for component tests.
  esbuild: { jsx: 'automatic' },
  test: {
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
  },
});
