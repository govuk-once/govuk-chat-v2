import { NextRequest, type NextResponse } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignInFlow } from '../../../../auth/oidc.ts';
import { sealSignInFlow, verifySession } from '../../../../auth/session.ts';

const USER_SUB = crypto.randomUUID();
const FLOW: SignInFlow = {
  codeVerifier: 'verifier',
  state: 'state',
  returnPath: '/chat',
};

const finishSignIn = vi.fn<(url: URL, flow: SignInFlow) => Promise<string>>();

const testEnv = {} as {
  GET: (request: NextRequest) => Promise<NextResponse>;
};

beforeAll(async () => {
  vi.doMock('../../../../auth/oidc.ts', () => ({ finishSignIn }));

  const routeModule = await import('./route.ts');
  testEnv.GET = routeModule.GET;
});

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
  finishSignIn.mockResolvedValue(USER_SUB);
});

async function callbackRequest(flow?: SignInFlow): Promise<NextRequest> {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    'x-forwarded-host': 'chat.example.com',
    'x-forwarded-proto': 'https',
  };
  if (flow) {
    headers.cookie = `sign_in_flow=${await sealSignInFlow(flow)}`;
  }
  return new NextRequest(
    'http://10.0.0.1:3000/api/auth/callback?code=code&state=state',
    { headers },
  );
}

describe('GET', () => {
  it('signs the user in and returns them to the page they asked for', async () => {
    const response = await testEnv.GET(await callbackRequest(FLOW));

    const session = response.cookies.get('session')?.value;
    expect(await verifySession(session)).toEqual({ sub: USER_SUB });
    expect(response.headers.get('location')).toBe(
      'https://chat.example.com/chat',
    );
  });

  it('finishes the sign-in on the public callback URL', async () => {
    await testEnv.GET(await callbackRequest(FLOW));

    expect(finishSignIn).toHaveBeenCalledWith(
      new URL(
        'https://chat.example.com/api/auth/callback?code=code&state=state',
      ),
      FLOW,
    );
  });

  it('returns to / when the return path is another site', async () => {
    const response = await testEnv.GET(
      await callbackRequest({ ...FLOW, returnPath: '//evil.example/' }),
    );

    expect(response.headers.get('location')).toBe('https://chat.example.com/');
  });

  it('returns 400 without a sign-in in progress', async () => {
    const response = await testEnv.GET(await callbackRequest());

    expect(response.status).toBe(400);
    expect(finishSignIn).not.toHaveBeenCalled();
  });

  it('fails without a session when the sub is not a UUID', async () => {
    finishSignIn.mockResolvedValue('not-a-uuid');

    await expect(testEnv.GET(await callbackRequest(FLOW))).rejects.toThrow(
      'Cognito sub is not a UUID',
    );
  });
});
