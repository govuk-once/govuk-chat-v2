import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { endUserIdFor } from './end-user-id.ts';

describe('endUserIdFor', () => {
  it('returns the same UUID every time for a sub in any format', () => {
    const endUserId = endUserIdFor('not-a-uuid');

    expect(z.uuid().safeParse(endUserId).success).toBe(true);
    expect(endUserIdFor('not-a-uuid')).toBe(endUserId);
  });

  it('returns a different UUID for each sub', () => {
    expect(endUserIdFor('sub-a')).not.toBe(endUserIdFor('sub-b'));
  });
});
