// Playwright runs global setup and teardown in a different process from the
// tests, so setup passes on what it created through environment variables.
export const RUN_CONTEXT = {
  demoUiUrl: 'CLOUD_TEST_DEMO_UI_URL',
  userPoolId: 'CLOUD_TEST_USER_POOL_ID',
  username: 'CLOUD_TEST_USERNAME',
  password: 'CLOUD_TEST_PASSWORD',
} as const;

export function requireRunContext(key: keyof typeof RUN_CONTEXT): string {
  const value = process.env[RUN_CONTEXT[key]];
  if (!value) {
    throw new Error(`${RUN_CONTEXT[key]} is not set; global setup sets it`);
  }
  return value;
}
