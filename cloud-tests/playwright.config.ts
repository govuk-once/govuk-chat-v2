import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'src/ui',
  globalSetup: './src/ui/global-setup.ts',
  globalTeardown: './src/ui/global-teardown.ts',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
  },
});
