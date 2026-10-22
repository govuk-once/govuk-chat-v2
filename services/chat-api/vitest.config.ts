import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    env: { POWERTOOLS_LOG_LEVEL: 'SILENT' },
  },
});
