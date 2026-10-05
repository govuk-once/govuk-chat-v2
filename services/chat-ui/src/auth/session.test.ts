import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSessionCookie, verifySession } from './session.ts';

const SECRET = 'test-session-secret';

describe('createSessionCookie', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', SECRET);
  });

  it('produces a payload.signature string', () => {
    const cookie = createSessionCookie('user-sub-123');
    expect(cookie).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('throws when SESSION_SECRET is not set', () => {
    vi.stubEnv('SESSION_SECRET', '');
    expect(() => createSessionCookie('user-sub-123')).toThrow(
      'SESSION_SECRET is not configured',
    );
  });
});

describe('verifySession', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', SECRET);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the sub from a valid cookie', () => {
    const cookie = createSessionCookie('user-sub-123');
    const session = verifySession(cookie);
    expect(session).toEqual({ sub: 'user-sub-123' });
  });

  it('returns undefined for an undefined cookie', () => {
    expect(verifySession(undefined)).toBeUndefined();
  });

  it('returns undefined for a tampered payload', () => {
    const cookie = createSessionCookie('user-sub-123');
    const tampered = 'dGFtcGVyZWQ.' + cookie.split('.', 2)[1];
    expect(verifySession(tampered)).toBeUndefined();
  });

  it('returns undefined for an expired cookie', () => {
    const cookie = createSessionCookie('user-sub-123');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    expect(verifySession(cookie)).toBeUndefined();
  });

  it('returns undefined for a cookie without a dot', () => {
    expect(verifySession('nodothere')).toBeUndefined();
  });

  it('returns undefined for a cookie signed with a different secret', () => {
    const cookie = createSessionCookie('user-sub-123');
    vi.stubEnv('SESSION_SECRET', 'different-secret');
    expect(verifySession(cookie)).toBeUndefined();
  });
});
