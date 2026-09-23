import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'cdk/cdk.out/**'],
    // Remove once chat-ui has its first test
    passWithNoTests: true,
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    env: { POWERTOOLS_LOG_LEVEL: 'SILENT' },
  },
});
