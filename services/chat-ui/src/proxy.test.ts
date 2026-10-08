import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const verifySession =
  vi.fn<(cookie: string | undefined) => Promise<{ sub: string } | undefined>>();

const testEnv = {} as {
  proxy: (
    request: NextRequest,
  ) => ReturnType<typeof import('./proxy.ts').proxy>;
};

beforeAll(async () => {
  vi.doMock('./auth/session.ts', () => ({
    verifySession,
    SESSION_COOKIE: 'session',
  }));

  const proxyModule = await import('./proxy.ts');
  testEnv.proxy = proxyModule.proxy;
});

beforeEach(() => {
  vi.stubEnv('COGNITO_TOKEN_ENDPOINT', 'https://auth.example.com/oauth2/token');
  vi.stubEnv('COGNITO_SIGN_IN_CLIENT_ID', 'sign-in-client-id');
  vi.stubEnv('SESSION_SECRET', 'test-secret');
});

function request(path: string, sessionCookie?: string): NextRequest {
  const url = `http://localhost:3000${path}`;
  const headers: Record<string, string> = {};
  if (sessionCookie) {
    headers.cookie = `session=${sessionCookie}`;
  }
  return new NextRequest(url, { headers });
}

describe('proxy', async () => {
  it('allows a request with a valid session', async () => {
    verifySession.mockResolvedValue({ sub: 'user-sub-123' });

    const response = await testEnv.proxy(request('/', 'valid-session'));

    expect(response.status).toBe(200);
    expect(verifySession).toHaveBeenCalledWith('valid-session');
  });

  it('redirects to the Cognito authorize URL when there is no session', async () => {
    verifySession.mockResolvedValue(undefined);

    const response = await testEnv.proxy(request('/'));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(
      'https://auth.example.com/oauth2/authorize',
    );
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('client_id')).toBe('sign-in-client-id');
    expect(location.searchParams.get('scope')).toBe('openid');
  });

  it('includes the current path and query as the state parameter', async () => {
    verifySession.mockResolvedValue(undefined);

    const response = await testEnv.proxy(request('/some/page?q=1'));

    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('state')).toBe('/some/page?q=1');
  });

  it('returns 401 for an API request without a session', async () => {
    verifySession.mockResolvedValue(undefined);

    const response = await testEnv.proxy(request('/api/chat'));

    expect(response.status).toBe(401);
  });

  it('redirects when the session cookie is invalid', async () => {
    verifySession.mockResolvedValue(undefined);

    const response = await testEnv.proxy(request('/', 'invalid'));

    expect(response.status).toBe(307);
  });
});
