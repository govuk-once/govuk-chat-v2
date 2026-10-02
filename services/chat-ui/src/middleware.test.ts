import { NextRequest } from 'next/server';
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const verifySession =
  vi.fn<(cookie: string | undefined) => { sub: string } | undefined>();

const testEnv = {} as {
  middleware: (
    request: NextRequest,
  ) => ReturnType<typeof import('./middleware.ts').middleware>;
};

beforeAll(async () => {
  vi.doMock('./auth/session.ts', () => ({
    verifySession,
    SESSION_COOKIE: 'session',
  }));

  const middlewareModule = await import('./middleware.ts');
  testEnv.middleware = middlewareModule.middleware;
});

beforeEach(() => {
  vi.stubEnv('COGNITO_TOKEN_ENDPOINT', 'https://auth.example.com/oauth2/token');
  vi.stubEnv('COGNITO_SIGN_IN_CLIENT_ID', 'sign-in-client-id');
  vi.stubEnv('SESSION_SECRET', 'test-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  verifySession.mockReset();
});

function request(path: string, sessionCookie?: string): NextRequest {
  const url = `http://localhost:3000${path}`;
  const headers: Record<string, string> = {};
  if (sessionCookie) {
    headers.cookie = `session=${sessionCookie}`;
  }
  return new NextRequest(url, { headers });
}

describe('middleware', () => {
  it('allows a request with a valid session', () => {
    verifySession.mockReturnValue({ sub: 'user-sub-123' });

    const response = testEnv.middleware(request('/', 'valid-session'));

    expect(response.status).toBe(200);
    expect(verifySession).toHaveBeenCalledWith('valid-session');
  });

  it('redirects to the Cognito authorize URL when there is no session', () => {
    verifySession.mockReturnValue(undefined);

    const response = testEnv.middleware(request('/'));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(
      'https://auth.example.com/oauth2/authorize',
    );
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('client_id')).toBe('sign-in-client-id');
    expect(location.searchParams.get('scope')).toBe('openid');
  });

  it('includes the current path as the state parameter', () => {
    verifySession.mockReturnValue(undefined);

    const response = testEnv.middleware(request('/some/page'));

    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('state')).toBe('/some/page');
  });

  it('redirects when the session cookie is invalid', () => {
    verifySession.mockReturnValue(undefined);

    const response = testEnv.middleware(request('/', 'invalid'));

    expect(response.status).toBe(307);
  });
});
