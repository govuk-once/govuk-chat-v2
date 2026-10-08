import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignInFlow } from './auth/oidc.ts';
import { createSessionCookie, openSignInFlow } from './auth/session.ts';

const AUTHORIZE_URL = new URL(
  'https://auth.example.com/oauth2/authorize?client_id=sign-in-client-id',
);

const startSignIn =
  vi.fn<
    (
      redirectUri: string,
      returnPath: string,
    ) => Promise<{ url: URL; flow: SignInFlow }>
  >();

const testEnv = {} as {
  proxy: (
    request: NextRequest,
  ) => ReturnType<typeof import('./proxy.ts').proxy>;
};

beforeAll(async () => {
  vi.doMock('./auth/oidc.ts', () => ({ startSignIn }));

  const proxyModule = await import('./proxy.ts');
  testEnv.proxy = proxyModule.proxy;
});

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
  startSignIn.mockImplementation((_redirectUri, returnPath) =>
    Promise.resolve({
      url: AUTHORIZE_URL,
      flow: { codeVerifier: 'verifier', state: 'state', returnPath },
    }),
  );
});

function request(path: string, sessionCookie?: string): NextRequest {
  const headers: Record<string, string> = { host: 'localhost:3000' };
  if (sessionCookie) {
    headers.cookie = `session=${sessionCookie}`;
  }
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

describe('proxy', () => {
  it('allows a request with a session', async () => {
    const session = await createSessionCookie(crypto.randomUUID());

    const response = await testEnv.proxy(request('/', session));

    expect(response.status).toBe(200);
  });

  it('redirects a page request without a session to Cognito', async () => {
    const response = await testEnv.proxy(request('/some/page?q=1'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(AUTHORIZE_URL.href);
    expect(startSignIn).toHaveBeenCalledWith(
      'http://localhost:3000/api/auth/callback',
      '/some/page?q=1',
    );
  });

  it('keeps the sign-in in progress in a cookie for the callback', async () => {
    const response = await testEnv.proxy(request('/some/page'));

    const flow = await openSignInFlow(
      response.cookies.get('sign_in_flow')?.value,
    );
    expect(flow?.returnPath).toBe('/some/page');
  });

  it('returns 401 for an API request without a session', async () => {
    const response = await testEnv.proxy(request('/api/chat'));

    expect(response.status).toBe(401);
    expect(startSignIn).not.toHaveBeenCalled();
  });
});
