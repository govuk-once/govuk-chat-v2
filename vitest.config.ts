import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'cdk/cdk.out/**'],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
  },
});
