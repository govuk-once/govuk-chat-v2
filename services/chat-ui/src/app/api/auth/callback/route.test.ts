import { NextRequest, type NextResponse } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const createSessionCookie = vi.fn<(sub: string) => Promise<string>>();

const USER_SUB = crypto.randomUUID();

const verifyIdToken = vi.fn<(idToken: string) => Promise<{ sub: string }>>();
const describeUserPoolClientMock = vi.fn();
const cognitoSendMock = vi.fn();

const testEnv = {} as {
  GET: (request: NextRequest) => Promise<NextResponse>;
};

beforeAll(async () => {
  vi.doMock('../../../../auth/session.ts', () => ({
    createSessionCookie,
    SESSION_COOKIE: 'session',
    SESSION_MAX_AGE_SECONDS: 86_400,
  }));

  vi.doMock('aws-jwt-verify', () => ({
    CognitoJwtVerifier: { create: () => ({ verify: verifyIdToken }) },
  }));

  vi.doMock('@aws-sdk/client-cognito-identity-provider', () => ({
    CognitoIdentityProviderClient: class {
      send = cognitoSendMock;
    },
    DescribeUserPoolClientCommand: describeUserPoolClientMock,
  }));

  const routeModule = await import('./route.ts');
  testEnv.GET = routeModule.GET;
});

beforeEach(() => {
  vi.stubEnv('COGNITO_TOKEN_ENDPOINT', 'https://auth.example.com/oauth2/token');
  vi.stubEnv('COGNITO_USER_POOL_ID', 'eu-west-1_example');
  vi.stubEnv('COGNITO_SIGN_IN_CLIENT_ID', 'sign-in-client-id');
  vi.stubEnv('SESSION_SECRET', 'test-secret');

  cognitoSendMock.mockResolvedValue({
    UserPoolClient: { ClientSecret: 'test-client-secret' },
  });

  createSessionCookie.mockResolvedValue('signed-session-cookie');

  verifyIdToken.mockResolvedValue({ sub: USER_SUB });

  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ id_token: 'id-token' }),
  );
});

const defaultParameters: Record<string, string> = {
  code: 'auth-code',
  state: '/',
};

function callbackRequest(
  parameters: Record<string, string> = defaultParameters,
): NextRequest {
  const url = new URL('http://localhost:3000/api/auth/callback');
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

describe('GET', () => {
  it('exchanges the code for tokens and sets a session cookie', async () => {
    const response = await testEnv.GET(callbackRequest());

    expect(createSessionCookie).toHaveBeenCalledWith(USER_SUB);
    expect(response.cookies.get('session')?.value).toBe(
      'signed-session-cookie',
    );
  });

  it('redirects to the state parameter', async () => {
    const response = await testEnv.GET(
      callbackRequest({ code: 'auth-code', state: '/chat' }),
    );

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/chat');
  });

  it('redirects to / when state is absent', async () => {
    const response = await testEnv.GET(callbackRequest({ code: 'auth-code' }));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/');
  });

  it('redirects to / when state is not a same-origin path', async () => {
    const response = await testEnv.GET(
      callbackRequest({ code: 'auth-code', state: '//evil.example/' }),
    );

    const location = new URL(response.headers.get('location')!);
    expect(location.hostname).not.toBe('evil.example');
    expect(location.pathname).toBe('/');
  });

  it('returns 401 when the ID token fails verification', async () => {
    verifyIdToken.mockRejectedValue(new Error('Invalid signature'));

    const response = await testEnv.GET(callbackRequest());

    expect(response.status).toBe(401);
    expect(createSessionCookie).not.toHaveBeenCalled();
  });

  it('fails without a session when the sub is not a UUID', async () => {
    verifyIdToken.mockResolvedValue({ sub: 'not-a-uuid' });

    await expect(testEnv.GET(callbackRequest())).rejects.toThrow(
      'Cognito sub is not a UUID',
    );
    expect(createSessionCookie).not.toHaveBeenCalled();
  });

  it('returns 400 when the code parameter is missing', async () => {
    const response = await testEnv.GET(callbackRequest({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Missing code parameter' });
  });

  it('returns 500 when the token exchange fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(undefined, { status: 400 }),
    );

    const response = await testEnv.GET(callbackRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Token exchange failed' });
  });
});
