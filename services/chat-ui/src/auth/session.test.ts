import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignInFlow } from './cognito-sign-in.ts';
import {
  clearSignInFlow,
  readSession,
  readSignInFlow,
  setSession,
  setSignInFlow,
} from './session.ts';

const SUB = crypto.randomUUID();
const FLOW: SignInFlow = {
  codeVerifier: 'verifier',
  state: 'state',
  returnPath: '/chat',
};

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

async function signInFlowResponse(): Promise<NextResponse> {
  const response = new NextResponse();
  await setSignInFlow(response, FLOW);
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

describe('readSignInFlow', () => {
  it('returns the flow from a sign-in flow cookie', async () => {
    const response = await signInFlowResponse();

    expect(await readSignInFlow(response.cookies)).toEqual(FLOW);
  });

  it('returns undefined once the sign-in has taken too long', async () => {
    const response = await signInFlowResponse();
    const maxAge = response.cookies.get('sign_in_flow')?.maxAge ?? 0;
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (maxAge + 3600) * 1000);

    expect(await readSignInFlow(response.cookies)).toBeUndefined();
  });

  it('returns undefined for a session cookie', async () => {
    const response = await sessionResponse();
    const session = response.cookies.get('session')?.value;
    const request = new NextRequest('http://localhost/', {
      headers: { cookie: `sign_in_flow=${session}` },
    });

    expect(await readSignInFlow(request.cookies)).toBeUndefined();
  });
});

describe('clearSignInFlow', () => {
  it('clears the sign-in flow cookie', () => {
    const response = new NextResponse();

    clearSignInFlow(response);

    expect(response.cookies.get('sign_in_flow')?.value).toBe('');
  });
});
