import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'src/ui',
  globalSetup: './src/ui/global-setup.ts',
  globalTeardown: './src/ui/global-teardown.ts',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Traces capture the Demo UI session cookie, which stays valid after the
    // test user is deleted, and CI artifacts on a public repo are
    // downloadable, so CI relies on screenshots instead.
    trace: process.env.CI ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
