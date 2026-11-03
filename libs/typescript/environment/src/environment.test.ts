import { describe, expect, it, vi } from 'vitest';
import { getEnvironment } from './environment.ts';

describe('getEnvironment', () => {
  it('uses ENVIRONMENT over USER', () => {
    vi.stubEnv('ENVIRONMENT', 'test-pr-123');
    vi.stubEnv('USER', 'alicesmith');

    expect(getEnvironment()).toBe('test-pr-123');
  });

  it('falls back to USER when ENVIRONMENT is unset', () => {
    vi.stubEnv('ENVIRONMENT', '');
    vi.stubEnv('USER', 'alicesmith');

    expect(getEnvironment()).toBe('alicesmith');
  });

  it('removes characters other than letters, digits and hyphens', () => {
    vi.stubEnv('ENVIRONMENT', 'alice.smith_test-1');

    expect(getEnvironment()).toBe('alicesmithtest-1');
  });

  it('throws when neither ENVIRONMENT nor USER is set', () => {
    vi.stubEnv('ENVIRONMENT', '');
    vi.stubEnv('USER', '');

    expect(() => getEnvironment()).toThrow(/Unable to determine environment/);
  });
});
