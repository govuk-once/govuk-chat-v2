import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const AUTHORIZE_URL =
  'https://auth.example.com/oauth2/authorize?client_id=sign-in-client-id';

interface SignInSocialResult {
  headers: Headers;
  response: { url?: string };
}

const signedInSub = vi.fn<(headers: Headers) => Promise<string | undefined>>();
const signInSocial =
  vi.fn<(input: { body: { callbackURL: string } }) => SignInSocialResult>();

const testEnv = {} as {
  proxy: (
    request: NextRequest,
  ) => ReturnType<typeof import('./proxy.ts').proxy>;
};

beforeAll(async () => {
  vi.doMock('./auth/auth.ts', () => ({
    signedInSub,
    getAuth: () => Promise.resolve({ api: { signInSocial } }),
  }));

  const proxyModule = await import('./proxy.ts');
  testEnv.proxy = proxyModule.proxy;
});

beforeEach(() => {
  signedInSub.mockResolvedValue(undefined);
  signInSocial.mockReturnValue({
    headers: new Headers({ 'Set-Cookie': 'state=abc; Path=/; HttpOnly' }),
    response: { url: AUTHORIZE_URL },
  });
});

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

describe('proxy', () => {
  it('allows a request with a session', async () => {
    signedInSub.mockResolvedValue(crypto.randomUUID());

    const response = await testEnv.proxy(request('/'));

    expect(response.status).toBe(200);
  });

  it('redirects a page request without a session to Cognito', async () => {
    const response = await testEnv.proxy(request('/some/page?q=1'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(AUTHORIZE_URL);
    expect(signInSocial.mock.calls[0][0].body.callbackURL).toBe(
      '/some/page?q=1',
    );
  });

  it('passes on the sign-in state cookie with the redirect', async () => {
    const response = await testEnv.proxy(request('/'));

    expect(response.headers.getSetCookie()).toContain(
      'state=abc; Path=/; HttpOnly',
    );
  });

  it('returns 401 for an API request without a session', async () => {
    const response = await testEnv.proxy(request('/api/chat'));

    expect(response.status).toBe(401);
    expect(signInSocial).not.toHaveBeenCalled();
  });
});
