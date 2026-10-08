import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionCookie, verifySession } from './session.ts';

const SUB = crypto.randomUUID();

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('verifySession', () => {
  it('returns the sub from a session cookie', async () => {
    const cookie = await createSessionCookie(SUB);

    expect(await verifySession(cookie)).toEqual({ sub: SUB });
  });

  it('returns undefined without a cookie', async () => {
    expect(await verifySession(undefined)).toBeUndefined();
  });

  it('returns undefined for a cookie sealed with another secret', async () => {
    const cookie = await createSessionCookie(SUB);
    vi.stubEnv('SESSION_SECRET', 'b'.repeat(64));

    expect(await verifySession(cookie)).toBeUndefined();
  });

  it('returns undefined once the session has expired', async () => {
    const cookie = await createSessionCookie(SUB);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);

    expect(await verifySession(cookie)).toBeUndefined();
  });
});
