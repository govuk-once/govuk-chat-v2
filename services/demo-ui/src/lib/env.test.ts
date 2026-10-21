import { describe, expect, it, vi } from 'vitest';
import { requireEnv } from './env.ts';

describe('requireEnv', () => {
  it('returns the value of a set env var', () => {
    vi.stubEnv('EXAMPLE_VAR', 'example-value');

    expect(requireEnv('EXAMPLE_VAR')).toBe('example-value');
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('throws when the env var is %s', (_case, value) => {
    vi.stubEnv('EXAMPLE_VAR', value);

    expect(() => requireEnv('EXAMPLE_VAR')).toThrow(
      'EXAMPLE_VAR is not configured',
    );
  });
});
