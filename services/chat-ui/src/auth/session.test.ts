import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSession, setSession } from './session.ts';

const SUB = crypto.randomUUID();

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
});

afterEach(() => {
  vi.useRealTimers();
});

async function sessionResponse(): Promise<NextResponse> {
  const response = new NextResponse();
  await setSession(response, SUB);
  return response;
}

describe('readSession', () => {
  it('returns the sub from a session cookie', async () => {
    const response = await sessionResponse();

    expect(await readSession(response.cookies)).toEqual({ sub: SUB });
  });

  it('returns undefined without a session cookie', async () => {
    const request = new NextRequest('http://localhost/');

    expect(await readSession(request.cookies)).toBeUndefined();
  });

  it('returns undefined for a cookie sealed with another secret', async () => {
    const response = await sessionResponse();
    vi.stubEnv('SESSION_SECRET', 'b'.repeat(64));

    expect(await readSession(response.cookies)).toBeUndefined();
  });

  it('returns undefined once the session has expired', async () => {
    const response = await sessionResponse();
    const maxAge = response.cookies.get('session')?.maxAge ?? 0;
    vi.useFakeTimers();
    // iron-session accepts a cookie for 60 seconds past its expiry, to allow
    // for clock skew, so go well beyond that.
    vi.setSystemTime(Date.now() + (maxAge + 3600) * 1000);

    expect(await readSession(response.cookies)).toBeUndefined();
  });
});
